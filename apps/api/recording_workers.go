package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Remote recorders receive job-scoped capabilities, never database or provider keys.
type recordingWorkerJob struct {
	ID      string `json:"id"`
	School  string `json:"school"`
	Meeting string `json:"meeting"`
	Owner   string `json:"owner"`
	Node    string `json:"node"`
	Lease   string `json:"lease"`
	Created int64  `json:"created"`
}
type recordingJobKey struct{}

const recordingLeaseSeconds = 60
const renewRecordingLease = `if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('EXPIRE',KEYS[1],60) return 1 end return 0`
const releaseRecordingLease = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`

func recordingLeaseKey(j recordingWorkerJob) string {
	return "server-recording-lease:" + j.School + ":" + j.Meeting
}
func (a *app) recordingBackendReady(ctx context.Context, mode string) bool {
	if mode == "vps" {
		return true
	}
	seen, e := a.cache.Exists(ctx, "server-recorder:seen").Result()
	if e != nil {
		return false
	}
	if seen == 0 {
		return true
	}
	protocol, e := a.cache.Get(ctx, "server-recorder:protocol").Int()
	return e == nil && protocol >= 2
}
func validRecordingMode(s string) bool { return s == "vps" || s == "browser" || s == "cluster" }
func (a *app) recordingMode(ctx context.Context, school string) (string, error) {
	var mode string
	e := a.db.QueryRowContext(ctx, "SELECT mode FROM recording_policies WHERE school_id=?", school).Scan(&mode)
	if e == sql.ErrNoRows {
		return "vps", nil
	}
	return mode, e
}
func (a *app) recordingRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/recording-workers", a.auth(a.recordingWorkers))
	m.HandleFunc("POST /api/recording-workers", a.auth(a.recordingWorkers))
	m.HandleFunc("POST /api/meetings/{id}/browser-recording", a.auth(a.browserRecordingClaim))
	m.HandleFunc("POST /api/recorder-agent/enroll", a.recorderEnroll)
	m.HandleFunc("POST /api/recorder-agent/claim", a.recorderClaim)
	m.HandleFunc("POST /api/recorder-agent/jobs/{job}/{action}", a.recorderJobAction)
	m.HandleFunc("POST /api/meetings/{id}/browser-recording/{job}/{action}", a.auth(a.browserJobAction))
}
func (a *app) recordingWorkers(w http.ResponseWriter, r *http.Request) {
	if _, e := os.Stat(configPath("managed.json")); e == nil && who(r).ID != "control-plane" {
		problem(w, 403, "Cụm ghi được quản lý tại trung tâm")
		return
	}

	if !admin(w, r) {
		return
	}
	if !permitted(who(r), "recordings") {
		problem(w, 403, "Chưa được cấp quyền ghi hình")
		return
	}
	u := who(r)
	if r.Method == "GET" {
		mode, e := a.recordingMode(r.Context(), u.School)
		if e != nil {
			problem(w, 503, "Không đọc được phương thức ghi")
			return
		}
		rows, e := a.db.QueryContext(r.Context(), "SELECT id,name,enabled,last_seen,platform,version FROM recorder_nodes WHERE school_id=? ORDER BY name LIMIT 200", u.School)
		if e != nil {
			problem(w, 503, "Không đọc được máy ghi")
			return
		}
		defer rows.Close()
		nodes := []map[string]any{}
		for rows.Next() {
			var id, name, platform, version string
			var enabled bool
			var seen sql.NullTime
			if rows.Scan(&id, &name, &enabled, &seen, &platform, &version) != nil {
				problem(w, 503, "Không đọc được máy ghi")
				return
			}
			nodes = append(nodes, map[string]any{"id": id, "name": name, "enabled": enabled, "last_seen": seen.Time, "online": seen.Valid && time.Since(seen.Time) < 45*time.Second, "platform": platform, "version": version})
		}
		if rows.Err() != nil {
			problem(w, 503, "Không đọc được máy ghi")
			return
		}
		send(w, 200, map[string]any{"mode": mode, "nodes": nodes})
		return
	}
	var in struct {
		Action, Mode, Name, Node, Code string
		Enabled                        bool
	}
	if !decode(w, r, &in) {
		return
	}
	switch in.Action {
	case "mode":
		if !a.recordingBackendReady(r.Context(), in.Mode) {
			problem(w, 409, "Cập nhật bộ ghi VPS tương thích trước khi đổi phương thức")
			return
		}
		if !validRecordingMode(in.Mode) {
			problem(w, 400, "Phương thức ghi không hợp lệ")
			return
		}
		// A policy switch is an infrastructure operation and must not duplicate a live capture.
		tx, e := a.db.BeginTx(r.Context(), nil)
		if e != nil {
			problem(w, 503, "Không lưu được cấu hình")
			return
		}
		defer tx.Rollback()
		var school string
		if tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&school) != nil {
			problem(w, 503, "Không khóa được cấu hình")
			return
		}
		var n int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings WHERE school_id=? AND status='live' AND recording_allowed=TRUE", u.School).Scan(&n) != nil || n > 0 {
			problem(w, 409, "Dừng ghi các buổi đang diễn ra trước khi đổi phương thức")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO recording_policies(school_id,mode) VALUES(?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode)", u.School, in.Mode); e != nil || tx.Commit() != nil {
			problem(w, 503, "Không lưu được cấu hình")
			return
		}
	case "enroll":
		name := strings.TrimSpace(in.Name)
		if len(name) < 1 || len(name) > 100 {
			problem(w, 400, "Tên máy từ 1 đến 100 byte")
			return
		}
		code := uid() + uid()
		if u.ID == "control-plane" && len(in.Code) == 64 {
			code = in.Code
		}
		raw, _ := json.Marshal(map[string]string{"school": u.School, "name": name})
		if a.cache.SetNX(r.Context(), "recorder-enroll:"+digest(code), raw, 10*time.Minute).Err() != nil {
			problem(w, 503, "Không tạo được mã đăng ký")
			return
		}
		a.audit(r, "recorder.enrollment.create", name)
		send(w, 201, map[string]any{"code": code, "expires_in": 600})
		return
	case "node":
		if _, e := a.db.ExecContext(r.Context(), "UPDATE recorder_nodes SET enabled=? WHERE school_id=? AND id=?", in.Enabled, u.School, in.Node); e != nil {
			problem(w, 503, "Không cập nhật được máy")
			return
		}
	default:
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	a.audit(r, "recorder."+in.Action, in.Node)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) recorderEnroll(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code, Platform, Version string }
	if !decode(w, r, &in) {
		return
	}
	if len(in.Code) != 64 || (in.Platform != "win32" && in.Platform != "linux") {
		problem(w, 400, "Thông tin đăng ký không hợp lệ")
		return
	}
	raw, e := a.cache.GetDel(r.Context(), "recorder-enroll:"+digest(in.Code)).Result()
	var entry map[string]string
	if e != nil || json.Unmarshal([]byte(raw), &entry) != nil {
		problem(w, 403, "Mã đăng ký sai, đã dùng hoặc hết hạn")
		return
	}
	id, token := uid(), uid()+uid()
	if _, e = a.db.ExecContext(r.Context(), "INSERT INTO recorder_nodes(id,school_id,name,token_hash,platform,version) VALUES(?,?,?,?,?,?)", id, entry["school"], entry["name"], digest(token), in.Platform, "1"); e != nil {
		problem(w, 503, "Không đăng ký được máy; tạo mã mới")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	send(w, 201, map[string]string{"id": id, "token": token})
}
func (a *app) recorderNode(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if len(token) != 64 {
		problem(w, 401, "Máy ghi chưa xác thực")
		return "", "", false
	}
	var id, school string
	if a.db.QueryRowContext(r.Context(), "SELECT id,school_id FROM recorder_nodes WHERE token_hash=? AND enabled=TRUE", digest(token)).Scan(&id, &school) != nil {
		problem(w, 401, "Máy ghi đã bị thu hồi hoặc ngừng hoạt động")
		return "", "", false
	}
	count, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end return n`, []string{"recorder-rate:" + id}).Int()
	if e != nil || count > 300 {
		problem(w, 429, "Máy ghi gửi quá nhiều yêu cầu")
		return "", "", false
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE recorder_nodes SET last_seen=UTC_TIMESTAMP(6) WHERE id=?", id); e != nil {
		problem(w, 503, "Không cập nhật được máy ghi")
		return "", "", false
	}
	return id, school, true
}
func (a *app) claimRecording(r *http.Request, school, meeting, owner, node string) (recordingWorkerJob, bool) {
	j := recordingWorkerJob{ID: uid(), School: school, Meeting: meeting, Owner: owner, Node: node, Lease: uid() + uid(), Created: time.Now().Unix()}
	// One active job per remote node; one capture per room across all backends.
	keys := []string{recordingLeaseKey(j)}
	if node != "" {
		keys = append(keys, "recorder-node-job:"+node)
	}
	ok, e := a.cache.Eval(r.Context(), `for _,k in ipairs(KEYS) do if redis.call('EXISTS',k)==1 then return 0 end end for _,k in ipairs(KEYS) do redis.call('SET',k,ARGV[1],'EX',60) end return 1`, keys, j.Lease).Int()
	if e != nil || ok != 1 {
		return j, false
	}
	raw, _ := json.Marshal(j)
	if a.cache.Set(r.Context(), "recorder-job:"+j.ID, raw, 7*24*time.Hour).Err() != nil {
		for _, k := range keys {
			a.cache.Eval(r.Context(), releaseRecordingLease, []string{k}, j.Lease)
		}
		return j, false
	}
	return j, true
}
func (a *app) recorderClaim(w http.ResponseWriter, r *http.Request) {
	node, school, ok := a.recorderNode(w, r)
	if !ok {
		return
	}
	var availability struct{ Available *bool }
	if !decode(w, r, &availability) {
		return
	}
	if availability.Available != nil && !*availability.Available {
		send(w, 200, map[string]any{"job": nil})
		return
	}
	mode, e := a.recordingMode(r.Context(), school)
	if e != nil || mode != "cluster" {
		send(w, 200, map[string]any{"job": nil})
		return
	}
	cfg, e := loadSettings()
	if e != nil || !cfg.R2.Enabled {
		send(w, 200, map[string]any{"job": nil})
		return
	}
	rows, e := a.db.QueryContext(r.Context(), `SELECT m.id,c.teacher_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN users u ON u.school_id=c.school_id AND u.id=c.teacher_id AND u.active=TRUE JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id AND tw.started_at IS NOT NULL AND tw.ended_at IS NULL WHERE m.school_id=? AND m.status='live' AND m.recording_allowed=TRUE ORDER BY m.starts_at LIMIT 100`, school)
	if e != nil {
		problem(w, 503, "Không đọc được lớp cần ghi")
		return
	}
	type candidate struct{ meeting, owner string }
	list := []candidate{}
	for rows.Next() {
		var c candidate
		if rows.Scan(&c.meeting, &c.owner) != nil {
			rows.Close()
			problem(w, 503, "Không đọc được lớp")
			return
		}
		list = append(list, c)
	}
	err := rows.Err()
	rows.Close()
	if err != nil {
		problem(w, 503, "Không đọc được lớp")
		return
	}
	for _, c := range list {
		if j, ok := a.claimRecording(r, school, c.meeting, c.owner, node); ok {
			send(w, 200, map[string]any{"job": j})
			return
		}
	}
	send(w, 200, map[string]any{"job": nil})
}
func (a *app) browserRecordingClaim(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, true)
	if !ok {
		return
	}
	u := who(r)
	mode, e := a.recordingMode(r.Context(), u.School)
	if e != nil || mode != "browser" || m.Status != "live" || !m.Recording || !a.liveMember(r) {
		problem(w, 409, "Chưa thể ghi bằng trình duyệt")
		return
	}
	var n int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meeting_teaching_windows WHERE school_id=? AND meeting_id=? AND started_at IS NOT NULL AND ended_at IS NULL", u.School, r.PathValue("id")).Scan(&n) != nil || n != 1 {
		problem(w, 409, "Chờ giáo viên bắt đầu dạy")
		return
	}
	j, ok := a.claimRecording(r, u.School, r.PathValue("id"), u.ID, "")
	if !ok {
		problem(w, 409, "Buổi học đã có máy ghi")
		return
	}
	send(w, 201, j)
}
func (a *app) recorderJob(r *http.Request) (recordingWorkerJob, error) {
	var j recordingWorkerJob
	raw, e := a.cache.Get(r.Context(), "recorder-job:"+r.PathValue("job")).Result()
	if e == nil {
		e = json.Unmarshal([]byte(raw), &j)
	}
	return j, e
}
func (a *app) recorderJobAction(w http.ResponseWriter, r *http.Request) {
	node, school, ok := a.recorderNode(w, r)
	if !ok {
		return
	}
	j, e := a.recorderJob(r)
	if e != nil || j.Node != node || j.School != school || r.Header.Get("X-Recording-Lease") != j.Lease {
		problem(w, 403, "Công việc không thuộc máy ghi")
		return
	}
	var u identity
	if a.db.QueryRowContext(r.Context(), "SELECT id,school_id,role,name FROM users WHERE id=? AND school_id=? AND active=TRUE", j.Owner, j.School).Scan(&u.ID, &u.School, &u.Role, &u.Name) != nil {
		problem(w, 403, "Chủ bản ghi không còn hoạt động")
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), authKey{}, u))
	r = r.WithContext(context.WithValue(r.Context(), recordingJobKey{}, j))
	r.SetPathValue("id", j.Meeting)
	a.recordingJobDispatch(w, r, j)
}
func (a *app) browserJobAction(w http.ResponseWriter, r *http.Request) {
	j, e := a.recorderJob(r)
	u := who(r)
	if e != nil || j.Node != "" || j.Owner != u.ID || j.School != u.School || j.Meeting != r.PathValue("id") || r.Header.Get("X-Recording-Lease") != j.Lease {
		problem(w, 403, "Công việc không thuộc tài khoản")
		return
	}
	a.recordingJobDispatch(w, r, j)
}
func (a *app) recordingJobDispatch(w http.ResponseWriter, r *http.Request, j recordingWorkerJob) {
	action := r.PathValue("action")
	if action == "release" {
		raw, _ := json.Marshal(map[string]any{"state": "stopped", "seen": time.Now().Unix()})
		a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('DEL',KEYS[1]);redis.call('SET',KEYS[2],ARGV[2],'EX',180);return 1 end return 0`, []string{recordingLeaseKey(j), "server-recording:" + j.School + ":" + j.Meeting}, j.Lease, string(raw))
		if j.Node != "" {
			a.cache.Eval(r.Context(), releaseRecordingLease, []string{"recorder-node-job:" + j.Node}, j.Lease)
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	if action == "part" || action == "finish" || action == "abort" {
		// Upload recovery remains available after lease expiry, but only for this job's files.
		var in struct {
			Recording string
			Part      int
			Size      int64
			Parts     int
		}
		if !decode(w, r, &in) {
			return
		}
		bound := a.cache.Get(r.Context(), "recorder-file-job:"+in.Recording).Val()
		if bound != j.ID {
			problem(w, 403, "Bản ghi không thuộc công việc")
			return
		}
		r.SetPathValue("recording", in.Recording)
		r.SetPathValue("part", fmtInt(in.Part))
		payload := map[string]any{}
		if action == "part" {
			payload["size"] = in.Size
		}
		if action == "finish" {
			payload["parts"] = in.Parts
		}
		raw, _ := json.Marshal(payload)
		r.Body = ioBody(raw)
		switch action {
		case "part":
			a.recordingMultipartPart(w, r)
		case "finish":
			a.recordingMutation(a.recordingMultipartFinish)(w, r)
		case "abort":
			a.recordingMutation(a.recordingMultipartAbort)(w, r)
		}
		return
	}
	if a.cache.Get(r.Context(), recordingLeaseKey(j)).Val() != j.Lease {
		problem(w, 409, "Quyền ghi đã hết hạn; dừng ghi ngay")
		return
	}
	if action == "tick" {
		var tick struct{ State string }
		if !decode(w, r, &tick) {
			return
		}
		if tick.State != "recording" && tick.State != "saving" {
			tick.State = "starting"
		}

		var live bool
		e := a.db.QueryRowContext(r.Context(), `SELECT m.status='live' AND m.recording_allowed AND tw.started_at IS NOT NULL AND tw.ended_at IS NULL FROM meetings m JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id WHERE m.school_id=? AND m.id=?`, j.School, j.Meeting).Scan(&live)
		mode, err := a.recordingMode(r.Context(), j.School)
		expected := "browser"
		if j.Node != "" {
			expected = "cluster"
		}
		cfg, ce := loadSettings()
		if e != nil || err != nil || ce != nil {
			problem(w, 503, "Không kiểm tra được trạng thái lớp")
			return
		}
		if !live || mode != expected || !cfg.R2.Enabled || time.Now().Unix()-j.Created >= 8*3600 {
			send(w, 200, map[string]bool{"stop": true})
			return
		}
		if a.cache.Eval(r.Context(), renewRecordingLease, []string{recordingLeaseKey(j)}, j.Lease).Val() != int64(1) {
			problem(w, 409, "Quyền ghi đã hết hạn")
			return
		}
		if j.Node != "" {
			if a.cache.Eval(r.Context(), renewRecordingLease, []string{"recorder-node-job:" + j.Node}, j.Lease).Val() != int64(1) {
				problem(w, 409, "Máy ghi đã mất công việc")
				return
			}
		}
		raw, _ := json.Marshal(map[string]any{"state": tick.State, "seen": time.Now().Unix()})
		a.cache.Set(r.Context(), "server-recording:"+j.School+":"+j.Meeting, raw, 90*time.Second)
		rows, e := a.db.QueryContext(r.Context(), `SELECT p.session_id,p.track_name,p.user_id,u.name FROM publications p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id JOIN presence a ON a.school_id=p.school_id AND a.meeting_id=p.meeting_id AND a.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND a.online=TRUE AND a.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND LIMIT 200`, j.School, j.Meeting)
		if e != nil {
			problem(w, 503, "Không đọc được media")
			return
		}
		list := []map[string]string{}
		for rows.Next() {
			var sid, track, user, name string
			if rows.Scan(&sid, &track, &user, &name) != nil {
				rows.Close()
				problem(w, 503, "Không đọc được media")
				return
			}
			list = append(list, map[string]string{"session_id": sid, "track_name": track, "user_id": user, "name": name})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			problem(w, 503, "Không đọc được media")
			return
		}
		var ink json.RawMessage
		var content string
		de := a.db.QueryRowContext(r.Context(), "SELECT content FROM meeting_drawing_state WHERE school_id=? AND meeting_id=?", j.School, j.Meeting).Scan(&content)
		if de != nil && de != sql.ErrNoRows {
			problem(w, 503, "Không đọc được bảng trắng")
			return
		}
		if content != "" {
			ink = json.RawMessage(content)
		}
		send(w, 200, map[string]any{"stop": false, "list": list, "drawing": ink})
		return
	}
	if action == "usage" {
		var in usageSample
		if !decode(w, r, &in) {
			return
		}
		p, e := a.meetingProvider(r.Context(), j.School, j.Meeting)
		if e != nil || in.Session == "" || len(in.Session) > 100 || in.Sent > 9007199254740991 || in.Received > 9007199254740991 || a.cache.Get(r.Context(), "recorder-session:"+j.ID+":"+in.Session).Val() != p.AppID+":"+fmtInt64(p.Generation) {
			problem(w, 403, "Phiên ghi không hợp lệ")
			return
		}
		if recordSFUUsage(r.Context(), a.db, j.School, p.ID, p.AppID, in) != nil {
			problem(w, 503, "Không lưu được lưu lượng")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	var active int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings WHERE school_id=? AND id=? AND status='live' AND recording_allowed=TRUE", j.School, j.Meeting).Scan(&active) != nil || active != 1 {
		problem(w, 409, "Buổi học đã dừng ghi")
		return
	}
	if action == "start" {
		r = r.WithContext(context.WithValue(r.Context(), recordingJobKey{}, j))
		a.recordingMultipartStart(w, r)
		return
	}
	if action == "sfu" {
		a.recorderSFU(w, r, j)
		return
	}
	if action == "failover" {
		p, e := a.meetingProvider(r.Context(), j.School, j.Meeting)
		if e != nil {
			problem(w, 503, "SFU chưa sẵn sàng")
			return
		}
		raw, _ := json.Marshal(map[string]any{"school": j.School, "meeting": j.Meeting, "provider_id": p.ID, "app_id": p.AppID, "generation": p.Generation, "verified": false})
		if a.cache.Set(r.Context(), "sfu-failover-request:"+j.School+":"+j.Meeting, raw, 20*time.Second).Err() != nil {
			problem(w, 503, "Không kiểm tra được SFU dự phòng")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	if action == "provider" {
		p, e := a.meetingProvider(r.Context(), j.School, j.Meeting)
		if e != nil {
			problem(w, 503, "SFU chưa sẵn sàng")
			return
		}
		send(w, 200, map[string]any{"generation": p.Generation})
		return
	}
	if action == "reset" {
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	problem(w, 400, "Thao tác máy ghi không hợp lệ")
}
func (a *app) recorderSFU(w http.ResponseWriter, r *http.Request, j recordingWorkerJob) {
	var in struct {
		Op          string          `json:"op"`
		Session     string          `json:"session_id"`
		Description json.RawMessage `json:"sessionDescription"`
		Tracks      []mediaTrack    `json:"tracks"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, e := a.meetingProvider(r.Context(), j.School, j.Meeting)
	if e != nil {
		problem(w, 503, "SFU chưa sẵn sàng")
		return
	}
	lock := "recorder-sfu:" + j.ID
	nonce := uid()
	got, e := a.cache.SetNX(r.Context(), lock, nonce, 30*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Đang kết nối media")
		return
	}
	defer a.cache.Eval(r.Context(), releaseRecordingLease, []string{lock}, nonce)
	path := "apps/" + url.PathEscape(p.AppID) + "/sessions/"
	method := "POST"
	var body any
	switch in.Op {
	case "new":
		count, e := a.cache.Incr(r.Context(), "recorder-sessions-count:"+j.ID).Result()
		if e != nil || count > 64 {
			problem(w, 429, "Vượt giới hạn phiên ghi")
			return
		}
		a.cache.Expire(r.Context(), "recorder-sessions-count:"+j.ID, 8*time.Hour)
		path += "new"
	case "tracks", "renegotiate":
		binding := a.cache.Get(r.Context(), "recorder-session:"+j.ID+":"+in.Session).Val()
		if binding != p.AppID+":"+fmtInt64(p.Generation) {
			problem(w, 409, "Phiên SFU đã đổi")
			return
		}
		path += url.PathEscape(in.Session)
		if in.Op == "tracks" {
			if len(in.Tracks) < 1 || len(in.Tracks) > 64 {
				problem(w, 400, "Số luồng không hợp lệ")
				return
			}
			for _, t := range in.Tracks {
				var n int
				if t.Location != "remote" || a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM publications WHERE school_id=? AND meeting_id=? AND session_id=? AND track_name=?", j.School, j.Meeting, t.Session, t.Name).Scan(&n) != nil || n != 1 {
					problem(w, 403, "Máy ghi chỉ được nhận media của lớp được giao")
					return
				}
			}
			path += "/tracks/new"
			body = map[string]any{"tracks": in.Tracks}
		} else {
			method = "PUT"
			path += "/renegotiate"
			body = map[string]any{"sessionDescription": in.Description}
		}
	default:
		problem(w, 403, "Máy ghi không được phát media")
		return
	}
	out, e := a.cloud(r, method, path, p.Secret, body)
	if e != nil && retrySFUFailure(r.Context(), e) {
		raw, _ := json.Marshal(map[string]any{"school": j.School, "meeting": j.Meeting, "provider_id": p.ID, "app_id": p.AppID, "generation": p.Generation, "verified": true})
		a.cache.Set(r.Context(), "sfu-failover-request:"+j.School+":"+j.Meeting, raw, 20*time.Second)
	}
	if e != nil {
		problem(w, 502, "Không kết nối được SFU")
		return
	}
	if in.Op == "new" {
		sid, _ := out["sessionId"].(string)
		if sid == "" {
			problem(w, 502, "SFU không trả phiên")
			return
		}
		if a.cache.Set(r.Context(), "recorder-session:"+j.ID+":"+sid, p.AppID+":"+fmtInt64(p.Generation), 8*time.Hour).Err() != nil {
			problem(w, 503, "Không lưu được phiên")
			return
		}
		out["meet_generation"] = p.Generation
	}
	send(w, 200, out)
}

func fmtInt(n int) string           { return strconv.Itoa(n) }
func fmtInt64(n int64) string       { return strconv.FormatInt(n, 10) }
func ioBody(b []byte) io.ReadCloser { return io.NopCloser(bytes.NewReader(b)) }
