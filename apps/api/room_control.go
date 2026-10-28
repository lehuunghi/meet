package main

import (
	"database/sql"
	"net/http"
	"time"
)

type roomRules struct {
	Lobby    bool `json:"lobby"`
	Chat     bool `json:"chat_enabled"`
	Present  bool `json:"present_enabled"`
	Revision int  `json:"revision"`
}

func (a *app) roomHost(r *http.Request, m meetingInfo) bool {
	u := who(r)
	if u.Role == "admin" || m.Teacher == u.ID {
		return true
	}
	var n int
	return u.Role == "teacher" && a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM course_assistants ca JOIN meetings m ON m.course_id=ca.course_id AND m.school_id=ca.school_id WHERE m.school_id=? AND m.id=? AND ca.user_id=?`, u.School, r.PathValue("id"), u.ID).Scan(&n) == nil && n == 1
}
func (a *app) roomView(r *http.Request) (roomRules, string, int64, error) {
	u := who(r)
	var rules roomRules
	rules.Chat = true
	rules.Present = true
	e := a.db.QueryRowContext(r.Context(), "SELECT lobby,chat_enabled,present_enabled,revision FROM room_settings WHERE school_id=? AND meeting_id=?", u.School, r.PathValue("id")).Scan(&rules.Lobby, &rules.Chat, &rules.Present, &rules.Revision)
	if e != nil && e != sql.ErrNoRows {
		return rules, "", 0, e
	}
	state := ""
	var mute int64
	e = a.db.QueryRowContext(r.Context(), "SELECT state,mute_request FROM room_members WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, r.PathValue("id"), u.ID).Scan(&state, &mute)
	if e != nil && e != sql.ErrNoRows {
		return rules, state, mute, e
	}
	return rules, state, mute, nil
}
func (a *app) roomGate(w http.ResponseWriter, r *http.Request) bool {
	m, ok := a.access(w, r, false)
	if !ok {
		return false
	}
	rules, state, _, e := a.roomView(r)
	if e != nil {
		problem(w, 503, "Không đọc được quyền phòng học")
		return false
	}
	if state == "removed" || state == "denied" {
		problem(w, 403, "Bạn chưa được phép tham gia buổi này. Liên hệ giáo viên.")
		return false
	}
	if rules.Lobby && !a.roomHost(r, m) && state != "admitted" {
		problem(w, 403, "Đang chờ giáo viên duyệt vào lớp")
		return false
	}
	return true
}
func (a *app) roomState(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	rules, state, mute, e := a.roomView(r)
	if e != nil {
		problem(w, 503, "Không đọc được phòng học")
		return
	}
	host := a.roomHost(r, m)
	if state == "" {
		if host || !rules.Lobby {
			state = "admitted"
		} else {
			state = "not_requested"
		}
	}
	code, e := a.meetingCode(r.Context(), who(r).School, r.PathValue("id"))
	if e != nil {
		problem(w, 503, "Chưa tạo được liên kết phòng")
		return
	}
	send(w, 200, map[string]any{"server_recording": a.serverRecordingStatus(r, m.Recording), "short_code": code, "id": r.PathValue("id"), "title": m.Title, "course_id": m.CourseID, "course": m.Course, "class_name": m.Class, "starts_at": m.Starts, "recording_allowed": m.Recording, "status": m.Status, "can_manage": host, "rules": rules, "admission": state, "mute_request": mute})
}
func (a *app) requestAdmission(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if m.Status != "live" {
		problem(w, 409, "Buổi học chưa bắt đầu hoặc đã kết thúc")
		return
	}
	host := a.roomHost(r, m)
	u := who(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var state string
	if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, r.PathValue("id")).Scan(&state) != nil || state != "live" {
		problem(w, 409, "Buổi không còn diễn ra")
		return
	}
	lobby := false
	e = tx.QueryRowContext(r.Context(), "SELECT lobby FROM room_settings WHERE school_id=? AND meeting_id=?", u.School, r.PathValue("id")).Scan(&lobby)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Không đọc được phòng chờ")
		return
	}
	state = "admitted"
	if lobby && !host {
		state = "waiting"
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO room_members(school_id,meeting_id,user_id,state) VALUES(?,?,?,?)", u.School, r.PathValue("id"), u.ID, state); e != nil {
		problem(w, 503, "Không gửi được yêu cầu")
		return
	}
	if tx.QueryRowContext(r.Context(), "SELECT state FROM room_members WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, r.PathValue("id"), u.ID).Scan(&state) != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được yêu cầu")
		return
	}
	send(w, 200, map[string]string{"admission": state})
}
func (a *app) roomMembers(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !a.roomHost(r, m) {
		problem(w, 403, "Chỉ người điều hành được duyệt thành viên")
		return
	}
	a.query(w, r, `SELECT rm.user_id AS id,u.short_id,u.name,u.role,rm.state,rm.requested_at FROM room_members rm JOIN users u ON u.id=rm.user_id AND u.school_id=rm.school_id WHERE rm.school_id=? AND rm.meeting_id=? ORDER BY FIELD(rm.state,'waiting','removed','denied','admitted'),rm.requested_at LIMIT 1000`, who(r).School, r.PathValue("id"))
}
func (a *app) roomControl(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !a.roomHost(r, m) {
		problem(w, 403, "Chỉ người điều hành được đổi cài đặt")
		return
	}
	var in roomRules
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	id := r.PathValue("id")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var status string
	if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&status) != nil || status == "ended" {
		problem(w, 409, "Không sửa buổi đã kết thúc")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO room_settings(school_id,meeting_id) VALUES(?,?)", u.School, id); e != nil {
		problem(w, 503, "Không lưu được cài đặt")
		return
	}
	res, e := tx.ExecContext(r.Context(), "UPDATE room_settings SET lobby=?,chat_enabled=?,present_enabled=?,revision=revision+1 WHERE school_id=? AND meeting_id=? AND revision=?", in.Lobby, in.Chat, in.Present, u.School, id, in.Revision)
	if e != nil {
		problem(w, 503, "Không lưu được cài đặt")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 409, "Cài đặt đã thay đổi; tải lại")
		return
	}
	// Enabling the lobby does not evict participants who are already in class.
	if in.Lobby {
		if _, e = tx.ExecContext(r.Context(), `INSERT IGNORE INTO room_members(school_id,meeting_id,user_id,state) SELECT school_id,meeting_id,user_id,'admitted' FROM presence WHERE school_id=? AND meeting_id=? AND online=TRUE AND last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND`, u.School, id); e != nil {
			problem(w, 503, "Không giữ được thành viên đang học")
			return
		}
	} else {
		if _, e = tx.ExecContext(r.Context(), "UPDATE room_members SET state='admitted',updated_at=UTC_TIMESTAMP(6) WHERE school_id=? AND meeting_id=? AND state='waiting'", u.School, id); e != nil {
			problem(w, 503, "Không cập nhật được phòng chờ")
			return
		}
	}
	if !in.Present {
		rows, err := tx.QueryContext(r.Context(), `SELECT DISTINCT p.session_id FROM publications p JOIN users u ON u.id=p.user_id AND u.school_id=p.school_id WHERE p.school_id=? AND p.meeting_id=? AND u.role='student' AND p.track_name LIKE 'screen-%'`, u.School, id)
		if err != nil {
			problem(w, 503, "Không thu hồi được quyền trình bày")
			return
		}
		for rows.Next() {
			var sid string
			if rows.Scan(&sid) != nil || a.cache.SetNX(r.Context(), "media-retired:"+sid, time.Now().Unix(), 0).Err() != nil {
				rows.Close()
				problem(w, 503, "Không thu hồi được trình bày")
				return
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			problem(w, 503, "Không đọc được trình bày")
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'room.settings',?)", u.School, u.ID, id); e != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được nhật ký")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) moderateMember(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !a.roomHost(r, m) {
		problem(w, 403, "Chỉ người điều hành được quản lý thành viên")
		return
	}
	var in struct {
		Action string `json:"action"`
		User   string `json:"user_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	_, valid := map[string]bool{"admit": true, "deny": true, "remove": true, "request_mute": true, "request_mute_all": true, "lower_hands_all": true}[in.Action]
	bulk := in.Action == "request_mute_all" || in.Action == "lower_hands_all"
	if !valid || (!bulk && in.User == "") {
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	u := who(r)
	id := r.PathValue("id")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var status string
	if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&status) != nil || status != "live" {
		problem(w, 409, "Buổi không còn diễn ra")
		return
	}
	var n int
	if bulk {
		query := `UPDATE room_members rm JOIN users u ON u.school_id=rm.school_id AND u.id=rm.user_id SET rm.mute_request=rm.mute_request+1,rm.updated_at=UTC_TIMESTAMP(6) WHERE rm.school_id=? AND rm.meeting_id=? AND rm.state='admitted' AND u.role='student'`
		if in.Action == "lower_hands_all" {
			query = "UPDATE meeting_hands SET raised=FALSE WHERE school_id=? AND meeting_id=?"
		}
		if _, e = tx.ExecContext(r.Context(), query, u.School, id); e != nil {
			problem(w, 503, "Không thực hiện được thao tác chung")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,?,?)", u.School, u.ID, "room."+in.Action, id); e != nil || tx.Commit() != nil {
			problem(w, 503, "Không lưu được nhật ký")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users u JOIN enrollments e ON e.user_id=u.id AND e.school_id=u.school_id JOIN courses c ON c.class_id=e.class_id AND c.school_id=e.school_id JOIN meetings m ON m.course_id=c.id AND m.school_id=c.school_id WHERE m.school_id=? AND m.id=? AND u.id=? AND u.role='student' AND u.active=TRUE`, u.School, id, in.User).Scan(&n) != nil || n < 1 {
		problem(w, 404, "Không tìm thấy học sinh thuộc lớp")
		return
	}
	state := map[string]string{"admit": "admitted", "deny": "denied", "remove": "removed", "request_mute": "admitted"}[in.Action]
	if in.Action == "request_mute" {
		res, e := tx.ExecContext(r.Context(), "UPDATE room_members SET mute_request=mute_request+1,updated_at=UTC_TIMESTAMP(6) WHERE school_id=? AND meeting_id=? AND user_id=? AND state='admitted'", u.School, id, in.User)
		if e != nil {
			problem(w, 503, "Không gửi được yêu cầu")
			return
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			problem(w, 409, "Học sinh chưa được duyệt vào lớp")
			return
		}
	} else {
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO room_members(school_id,meeting_id,user_id,state) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),updated_at=UTC_TIMESTAMP(6)", u.School, id, in.User, state); e != nil {
			problem(w, 503, "Không cập nhật được thành viên")
			return
		}
	}
	if in.Action == "deny" || in.Action == "remove" {
		rows, err := tx.QueryContext(r.Context(), "SELECT id FROM media_sessions WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, id, in.User)
		if err != nil {
			problem(w, 503, "Không đọc được media")
			return
		}
		for rows.Next() {
			var sid string
			if rows.Scan(&sid) != nil || a.cache.SetNX(r.Context(), "media-retired:"+sid, time.Now().Unix(), 0).Err() != nil {
				rows.Close()
				problem(w, 503, "Không thu hồi được media")
				return
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			problem(w, 503, "Không đọc được media")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "UPDATE presence SET online=FALSE WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, id, in.User); e != nil {
			problem(w, 503, "Không thu hồi được presence")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM publications WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, id, in.User); e != nil {
			problem(w, 503, "Không thu hồi được media")
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,?,?)", u.School, u.ID, "room."+in.Action, id+":"+in.User); e != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được nhật ký")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
