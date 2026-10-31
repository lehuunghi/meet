package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

func (a *app) sessionProvider(ctx context.Context, school, meeting, sid string) (sfuProvider, error) {
	var id, app string
	var generation int64
	e := a.db.QueryRowContext(ctx, "SELECT p.provider_id,p.app_id,p.generation FROM media_session_routes p JOIN media_sessions s ON s.id=p.session_id WHERE s.school_id=? AND s.meeting_id=? AND s.id=?", school, meeting, sid).Scan(&id, &app, &generation)
	if e == sql.ErrNoRows {
		return a.meetingProvider(ctx, school, meeting)
	}
	if e != nil {
		return sfuProvider{}, e
	}
	cfg, e := loadSettings()
	if e != nil {
		return sfuProvider{}, e
	}
	p, e := providerByID(cfg.SFU, id, app)
	p.Generation = generation
	return p, e
}
func (a *app) providerMatches(ctx context.Context, school, meeting string, p sfuProvider) bool {
	var n int
	return a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM meeting_sfu_bindings b LEFT JOIN meeting_sfu_epochs e ON e.school_id=b.school_id AND e.meeting_id=b.meeting_id WHERE b.school_id=? AND b.meeting_id=? AND b.provider_id=? AND b.app_id=? AND COALESCE(e.generation,0)=?`, school, meeting, p.ID, p.AppID, p.Generation).Scan(&n) == nil && n == 1
}
func (a *app) registerMediaSession(ctx context.Context, school, meeting, user, sid string, p sfuProvider) (bool, error) {
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	var id, app string
	var generation int64
	e = tx.QueryRowContext(ctx, `SELECT b.provider_id,b.app_id,COALESCE(e.generation,0) FROM meeting_sfu_bindings b LEFT JOIN meeting_sfu_epochs e ON e.school_id=b.school_id AND e.meeting_id=b.meeting_id WHERE b.school_id=? AND b.meeting_id=? FOR UPDATE`, school, meeting).Scan(&id, &app, &generation)
	if e != nil {
		return false, e
	}
	stale := id != p.ID || app != p.AppID || generation != p.Generation
	if _, e = tx.ExecContext(ctx, "INSERT INTO media_sessions(id,school_id,meeting_id,user_id) VALUES(?,?,?,?)", sid, school, meeting, user); e != nil {
		return false, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO media_session_routes(session_id,provider_id,app_id,generation) VALUES(?,?,?,?)", sid, p.ID, p.AppID, p.Generation); e != nil {
		return false, e
	}
	if e = tx.Commit(); e != nil {
		return false, e
	}
	return stale, nil
}
func (a *app) mediaProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	if !a.roomGate(w, r) {
		return
	}
	var generation int64
	e := a.db.QueryRowContext(r.Context(), "SELECT generation FROM meeting_sfu_epochs WHERE school_id=? AND meeting_id=?", who(r).School, r.PathValue("id")).Scan(&generation)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa đọc được phiên SFU")
		return
	}
	send(w, 200, map[string]any{"generation": generation})
}
func (a *app) mediaFailover(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if m.Status != "live" || !a.liveMember(r) || !a.roomGate(w, r) {
		problem(w, 409, "Tham gia phòng đang học trước khi thử kết nối lại")
		return
	}
	p, e := a.meetingProvider(r.Context(), who(r).School, r.PathValue("id"))
	if e != nil {
		problem(w, 503, "Chưa có SFU sẵn sàng")
		return
	}
	changed, _ := a.trySFUFailover(r.Context(), who(r).School, r.PathValue("id"), p)
	send(w, 200, map[string]bool{"changed": changed})
}
func retrySFUFailure(ctx context.Context, e error) bool {
	if ctx.Err() != nil {
		return false
	}
	var p *providerError
	if errors.As(e, &p) {
		return p.Status == 401 || p.Status == 403 || p.Status == 429 || p.Status >= 500
	}
	return e != nil
}
func (a *app) probeSFU(ctx context.Context, p sfuProvider) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "POST", "http://internal", nil)
	out, e := a.cloud(r, "POST", "apps/"+url.PathEscape(p.AppID)+"/sessions/new", p.Secret, nil)
	if e != nil {
		return false
	}
	sid, ok := out["sessionId"].(string)
	return ok && sid != ""
}

// A failed browser connection alone is not authority to move a class. Confirm
// the current app fails server-side and a different enabled app answers first.
func (a *app) trySFUFailover(ctx context.Context, school, meeting string, failed sfuProvider, verified ...bool) (bool, error) {
	if _, err := os.Stat(configPath("maintenance")); !os.IsNotExist(err) {
		return false, nil
	}
	if !a.providerMatches(ctx, school, meeting, failed) {
		return true, nil
	}
	root := meeting
	var parent string
	if a.db.QueryRowContext(ctx, `SELECT br.parent_id FROM meeting_breakout_rooms rr JOIN meeting_breakout_rounds br ON br.school_id=rr.school_id AND br.id=rr.round_id WHERE rr.school_id=? AND rr.meeting_id=?`, school, meeting).Scan(&parent) == nil {
		p, e := a.meetingProvider(ctx, school, parent)
		if e == nil && p.ID == failed.ID && p.AppID == failed.AppID {
			root = parent
		}
	}
	cfg, e := loadSettings()
	if e != nil {
		return false, e
	}
	candidates := []sfuProvider{}
	start := -1
	for i, p := range cfg.SFU {
		if p.ID == failed.ID {
			start = i
		}
	}
	for i := 1; i <= len(cfg.SFU); i++ {
		p := cfg.SFU[(start+i+len(cfg.SFU))%len(cfg.SFU)]
		if p.Enabled && p.ID != failed.ID {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 0 {
		return false, nil
	}
	nonce := uid()
	key := "sfu-failover:" + school + ":" + root
	got, e := a.cache.SetNX(ctx, key, nonce, 12*time.Second).Result()
	if e != nil || !got {
		return false, e
	}
	// Retain a short cooldown even if all providers fail, avoiding a retry storm.
	defer a.cache.Eval(context.Background(), `if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('EXPIRE',KEYS[1],5) end return 0`, []string{key}, nonce)
	if !(len(verified) > 0 && verified[0]) && a.probeSFU(ctx, failed) {
		return false, nil
	}
	a.cache.Set(ctx, "sfu-unhealthy:"+digest(failed.ID+":"+failed.AppID), "1", 20*time.Second)
	var target sfuProvider
	attempts := 0
	for _, p := range candidates {
		bad := "sfu-unhealthy:" + digest(p.ID+":"+p.AppID)
		if a.cache.Exists(ctx, bad).Val() > 0 {
			continue
		}
		attempts++
		if a.probeSFU(ctx, p) {
			target = p
			break
		}
		a.cache.Set(ctx, bad, "1", 20*time.Second)
		if attempts >= 3 {
			break
		}
	}
	if target.ID == "" {
		return false, nil
	}
	conn, release, e := lockAllocation(ctx, a.db)
	if e != nil {
		return false, e
	}
	defer release()
	cfg, e = loadSettings()
	if e != nil {
		return false, e
	}
	found := false
	for _, p := range cfg.SFU {
		if p.ID == target.ID && p.AppID == target.AppID && p.Secret == target.Secret && p.Enabled {
			found = true
		}
	}
	if !found {
		return false, nil
	}
	if !a.providerMatches(ctx, school, meeting, failed) {
		return true, nil
	}
	for _, p := range cfg.SFU {
		if p.ID == failed.ID && p.AppID == failed.AppID && p.Secret != failed.Secret {
			return false, nil
		}
	}
	if _, err := os.Stat(configPath("maintenance")); !os.IsNotExist(err) {
		return false, nil
	}
	tx, e := conn.BeginTx(ctx, nil)
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, `SELECT b.meeting_id FROM meeting_sfu_bindings b JOIN meetings m ON m.school_id=b.school_id AND m.id=b.meeting_id WHERE b.school_id=? AND b.provider_id=? AND b.app_id=? AND m.status='live' AND (b.meeting_id=? OR EXISTS(SELECT 1 FROM meeting_breakout_rooms rr JOIN meeting_breakout_rounds br ON br.school_id=rr.school_id AND br.id=rr.round_id WHERE rr.school_id=b.school_id AND rr.meeting_id=b.meeting_id AND br.parent_id=? AND br.status='active')) ORDER BY b.meeting_id FOR UPDATE`, school, failed.ID, failed.AppID, root, root)
	if e != nil {
		return false, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return false, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return false, e
	}
	if len(ids) == 0 {
		return true, nil
	}
	for _, id := range ids {
		if _, e = tx.ExecContext(ctx, `INSERT IGNORE INTO media_session_routes(session_id,provider_id,app_id,generation) SELECT s.id,b.provider_id,b.app_id,COALESCE(ep.generation,0) FROM media_sessions s JOIN meeting_sfu_bindings b ON b.school_id=s.school_id AND b.meeting_id=s.meeting_id LEFT JOIN meeting_sfu_epochs ep ON ep.school_id=b.school_id AND ep.meeting_id=b.meeting_id WHERE s.school_id=? AND s.meeting_id=?`, school, id); e != nil {
			return false, e
		}
		sessions, e := tx.QueryContext(ctx, "SELECT id FROM media_sessions WHERE school_id=? AND meeting_id=?", school, id)
		if e != nil {
			return false, e
		}
		sids := []string{}
		for sessions.Next() {
			var sid string
			if e = sessions.Scan(&sid); e != nil {
				sessions.Close()
				return false, e
			}
			sids = append(sids, sid)
		}
		e = sessions.Err()
		sessions.Close()
		if e != nil {
			return false, e
		}
		for _, sid := range sids {
			if e = a.cache.SetNX(ctx, "media-retired:"+sid, time.Now().Unix(), 0).Err(); e != nil {
				return false, e
			}
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM publications WHERE school_id=? AND meeting_id=?", school, id); e != nil {
			return false, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE meeting_sfu_bindings SET provider_id=?,app_id=? WHERE school_id=? AND meeting_id=?", target.ID, target.AppID, school, id); e != nil {
			return false, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO meeting_sfu_epochs(school_id,meeting_id,generation) VALUES(?,?,1) ON DUPLICATE KEY UPDATE generation=generation+1", school, id); e != nil {
			return false, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO meeting_sfu_failovers(school_id,meeting_id,from_provider,to_provider) VALUES(?,?,?,?)", school, id, failed.ID, target.ID); e != nil {
			return false, e
		}
	}
	if e = tx.Commit(); e != nil {
		return false, e
	}
	return true, nil
}
func (a *app) sfuFailoverLoop(ctx context.Context) {
	timer := time.NewTicker(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if _, err := os.Stat(configPath("maintenance")); !os.IsNotExist(err) {
				continue
			}
			keys, e := a.cache.SPopN(ctx, "sfu-failover-pending", 5).Result()
			if e != nil {
				continue
			}
			var wg sync.WaitGroup
			for i, key := range keys {
				if i >= 5 {
					break
				}
				raw, e := a.cache.GetDel(ctx, key).Result()
				if e != nil {
					continue
				}
				var in struct {
					School     string `json:"school"`
					Meeting    string `json:"meeting"`
					Provider   string `json:"provider_id"`
					App        string `json:"app_id"`
					Generation int64  `json:"generation"`
					Verified   bool   `json:"verified"`
				}
				if json.Unmarshal([]byte(raw), &in) != nil {
					continue
				}
				cfg, e := loadSettings()
				if e != nil {
					continue
				}
				p, e := providerByID(cfg.SFU, in.Provider, in.App)
				if e != nil {
					continue
				}
				p.Generation = in.Generation
				wg.Add(1)
				go func() {
					defer wg.Done()
					c, cancel := context.WithTimeout(ctx, 9*time.Second)
					defer cancel()
					a.trySFUFailover(c, in.School, in.Meeting, p, in.Verified)
				}()
			}
			wg.Wait()
		}
	}
}

// Avoid global keyspace scans when multiple websites share Redis.
func (a *app) queueSFUFailover(ctx context.Context, school, meeting string, raw []byte) error {
	key := "sfu-failover-request:" + school + ":" + meeting
	pipe := a.cache.TxPipeline()
	pipe.Set(ctx, key, raw, 20*time.Second)
	pipe.SAdd(ctx, "sfu-failover-pending", key)
	pipe.Expire(ctx, "sfu-failover-pending", time.Minute)
	_, err := pipe.Exec(ctx)
	return err
}
