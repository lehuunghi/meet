package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (a *app) cloud(r *http.Request, method, path, token string, body any) (map[string]any, error) {
	var payload io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		payload = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(r.Context(), method, "https://rtc.live.cloudflare.com/v1/"+path, payload)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, e := a.client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if e != nil {
		return nil, e
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, &providerError{Status: res.StatusCode}
	}
	var out map[string]any
	e = json.Unmarshal(raw, &out)
	return out, e
}

type providerError struct{ Status int }

func (*providerError) Error() string { return "Cloudflare request rejected" }

type mediaTrack struct {
	Location string `json:"location"`
	Session  string `json:"sessionId,omitempty"`
	Name     string `json:"trackName"`
	MID      string `json:"mid,omitempty"`
}

func (a *app) sfu(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if m.Status != "live" {
		problem(w, 409, "Meeting is not live")
		return
	}
	if !a.roomGate(w, r) {
		return
	}
	if !a.liveMember(r) {
		problem(w, 409, "Tham gia buổi học trước khi tạo media")
		return
	}
	var in struct {
		Op          string          `json:"op"`
		Session     string          `json:"session_id"`
		Description json.RawMessage `json:"sessionDescription,omitempty"`
		Tracks      []mediaTrack    `json:"tracks,omitempty"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	id := r.PathValue("id")
	provider, err := a.meetingProvider(r.Context(), u.School, id)
	if err != nil {
		problem(w, 503, "SFU chưa sẵn sàng hoặc credential đã gán không còn hợp lệ; kiểm tra cấu hình hệ thống")
		return
	}
	// Redis lease serializes upstream session mutations across API replicas.
	lock := "sfu-lock:" + u.School + ":" + u.ID + ":" + id
	nonce := uid()
	got, e := a.cache.SetNX(r.Context(), lock, nonce, 30*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Media negotiation busy; retry")
		return
	}
	defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
	// Recheck after taking the negotiation lease: room closure may have raced access().
	var live string
	if a.db.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=?", u.School, id).Scan(&live) != nil || live != "live" {
		problem(w, 409, "Meeting is not live")
		return
	}
	path := "apps/" + url.PathEscape(provider.AppID) + "/sessions/"
	method := "POST"
	body := map[string]any{}
	if in.Op == "new" {
		rows, e := a.db.QueryContext(r.Context(), "SELECT id FROM media_sessions WHERE school_id=? AND user_id=? AND meeting_id=?", u.School, u.ID, id)
		if e != nil {
			problem(w, 503, "Media sessions unavailable")
			return
		}
		active, total := 0, 0
		for rows.Next() {
			var sid string
			if rows.Scan(&sid) != nil {
				rows.Close()
				problem(w, 503, "Media sessions unavailable")
				return
			}
			retired, e := a.cache.Exists(r.Context(), "media-retired:"+sid).Result()
			if e != nil {
				rows.Close()
				problem(w, 503, "Media sessions unavailable")
				return
			}
			total++
			if retired == 0 {
				active++
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil || active >= 8 || total >= 32 {
			problem(w, 429, "Session limit reached for this meeting")
			return
		}
		path += "new"
		// The endpoint distinguishes an absent body from an empty JSON object.
		// {} selects SDP validation and is rejected without sessionDescription.
	} else {
		retired, e := a.cache.Exists(r.Context(), "media-retired:"+in.Session).Result()
		if e != nil {
			problem(w, 503, "Media sessions unavailable")
			return
		}
		if retired > 0 {
			problem(w, 409, "Phiên media đã thu hồi; hãy kết nối lại")
			return
		}
		var count int
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM media_sessions WHERE id=? AND school_id=? AND meeting_id=? AND user_id=?", in.Session, u.School, id, u.ID).Scan(&count) != nil || count != 1 {
			problem(w, 404, "Session not found")
			return
		}
		route, err := a.sessionProvider(r.Context(), u.School, id, in.Session)
		if err != nil || route.ID != provider.ID || route.AppID != provider.AppID || route.Generation != provider.Generation {
			problem(w, 409, "SFU đã chuyển; đang kết nối lại")
			return
		}
		path += url.PathEscape(in.Session)
		switch in.Op {
		case "tracks":
			path += "/tracks/new"
			if len(in.Tracks) < 1 || len(in.Tracks) > 50 {
				problem(w, 400, "Expected 1–50 tracks")
				return
			}
			for _, t := range in.Tracks {
				if t.Location == "local" && strings.HasPrefix(t.Name, "screen-") {
					rules, _, _, err := a.roomView(r)
					if err != nil {
						problem(w, 503, "Không đọc được quyền trình bày")
						return
					}
					if !rules.Present && !a.roomHost(r, m) {
						problem(w, 403, "Giáo viên đã tắt quyền trình bày")
						return
					}
				}
				if len(t.Name) == 0 || len(t.Name) > 100 {
					problem(w, 400, "Invalid track")
					return
				}
				if t.Location == "remote" {
					var n int
					e = a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM publications p JOIN presence a ON a.school_id=p.school_id AND a.meeting_id=p.meeting_id AND a.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.session_id=? AND p.track_name=? AND a.online=TRUE AND a.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND`, u.School, id, t.Session, t.Name).Scan(&n)
					if e != nil || n != 1 {
						problem(w, 403, "Publication unavailable in this room")
						return
					}
				} else if t.Location != "local" || t.Session != "" || t.MID == "" {
					problem(w, 400, "Invalid local track")
					return
				}
			}
			body["tracks"] = in.Tracks
		case "renegotiate":
			path += "/renegotiate"
			method = "PUT"
		default:
			problem(w, 400, "Invalid SFU operation")
			return
		}
		if len(in.Description) > 0 {
			body["sessionDescription"] = in.Description
		}
	}
	var requestBody any = body
	if in.Op == "new" {
		requestBody = nil
	}
	out, e := a.cloud(r, method, path, provider.Secret, requestBody)
	if e != nil && retrySFUFailure(r.Context(), e) {
		changed, _ := a.trySFUFailover(r.Context(), u.School, id, provider, true)
		if changed {
			if in.Op != "new" {
				problem(w, 409, "Đã chuyển SFU dự phòng; đang kết nối lại")
				return
			}
			provider, e = a.meetingProvider(r.Context(), u.School, id)
			if e == nil {
				out, e = a.cloud(r, "POST", "apps/"+url.PathEscape(provider.AppID)+"/sessions/new", provider.Secret, nil)
			}
		}
	}
	if e != nil {
		problem(w, 502, "SFU chưa sẵn sàng; hệ thống sẽ tự thử lại")
		return
	}
	if in.Op == "new" {
		sid, _ := out["sessionId"].(string)
		if sid == "" {
			problem(w, 502, "SFU returned no session")
			return
		}
		stale, err := a.registerMediaSession(r.Context(), u.School, id, u.ID, sid, provider)
		if err != nil {
			problem(w, 500, "Session persistence failed")
			return
		}
		if stale {
			a.cache.SetNX(r.Context(), "media-retired:"+sid, time.Now().Unix(), 0)
			problem(w, 409, "SFU đã chuyển; đang kết nối lại")
			return
		}
		out["meet_generation"] = provider.Generation
		if cookie, e := r.Cookie("meet_session"); e == nil {
			if a.cache.MSet(r.Context(), "media-owner:"+sid, digest(cookie.Value), "media-version:"+sid, u.Version).Err() != nil {
				a.cache.SetNX(r.Context(), "media-retired:"+sid, time.Now().Unix(), 0)
				problem(w, 503, "Media ownership unavailable")
				return
			}
		}
	}
	if in.Op == "tracks" {
		for _, t := range in.Tracks {
			if t.Location == "local" && strings.HasPrefix(t.Name, "screen-") {
				rules, _, _, err := a.roomView(r)
				if err != nil || (!rules.Present && !a.roomHost(r, m)) {
					a.cache.SetNX(r.Context(), "media-retired:"+in.Session, time.Now().Unix(), 0)
					problem(w, 403, "Quyền trình bày đã thay đổi")
					return
				}
			}
		}
		var state string
		retired, err := a.cache.Exists(r.Context(), "media-retired:"+in.Session).Result()
		if err != nil || retired > 0 || a.db.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=?", u.School, id).Scan(&state) != nil || state != "live" {
			a.cache.SetNX(r.Context(), "media-retired:"+in.Session, time.Now().Unix(), 0)
			problem(w, 409, "Media session retired during negotiation")
			return
		}
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			problem(w, 503, "Không lưu được media")
			return
		}
		defer tx.Rollback()
		var boundID, boundApp string
		var generation int64
		err = tx.QueryRowContext(r.Context(), `SELECT b.provider_id,b.app_id,COALESCE(ep.generation,0) FROM meeting_sfu_bindings b LEFT JOIN meeting_sfu_epochs ep ON ep.school_id=b.school_id AND ep.meeting_id=b.meeting_id WHERE b.school_id=? AND b.meeting_id=? FOR UPDATE`, u.School, id).Scan(&boundID, &boundApp, &generation)
		if err != nil || boundID != provider.ID || boundApp != provider.AppID || generation != provider.Generation {
			a.cache.SetNX(r.Context(), "media-retired:"+in.Session, time.Now().Unix(), 0)
			problem(w, 409, "SFU đã chuyển; đang kết nối lại")
			return
		}
		results, _ := out["tracks"].([]any)
		for i, t := range in.Tracks {
			if t.Location != "local" || i >= len(results) {
				continue
			}
			result, _ := results[i].(map[string]any)
			if result == nil || (result["errorCode"] != nil && result["errorCode"] != "") {
				continue
			}
			if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO publications(school_id,meeting_id,session_id,track_name,user_id) VALUES(?,?,?,?,?)", u.School, id, in.Session, t.Name, u.ID); e != nil {
				problem(w, 500, "Publication persistence failed")
				return
			}
		}
		if e = tx.Commit(); e != nil {
			problem(w, 503, "Không lưu được media")
			return
		}

	}
	send(w, 200, out)
}
func (a *app) tracks(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	a.query(w, r, `SELECT p.session_id,p.track_name,p.user_id,u.name FROM publications p JOIN users u ON u.id=p.user_id AND u.school_id=p.school_id JOIN presence a ON a.school_id=p.school_id AND a.meeting_id=p.meeting_id AND a.user_id=p.user_id JOIN meetings m ON m.id=p.meeting_id AND m.school_id=p.school_id WHERE p.school_id=? AND p.meeting_id=? AND a.online=TRUE AND a.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND m.status='live' LIMIT 200`, u.School, r.PathValue("id"))
}

type turnKey struct {
	ID       string `json:"id"`
	Token    string `json:"token"`
	TokenSet bool   `json:"token_set,omitempty"`
}

func (a *app) ice(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if m.Status != "live" {
		problem(w, 409, "Meeting is not live")
		return
	}
	send(w, 200, map[string]any{"iceServers": []any{map[string]string{"urls": "stun:stun.cloudflare.com:3478"}}})
}
