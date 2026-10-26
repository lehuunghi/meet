package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"
)

const courseAccess = `c.school_id=? AND (?='admin' OR (?='teacher' AND EXISTS(SELECT 1 FROM users assigned WHERE assigned.id=? AND assigned.school_id=c.school_id AND (assigned.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=assigned.id)))) OR (?='student' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.class_id=c.class_id AND e.user_id=?)))`

type meetingInfo struct {
	Status    string
	Recording bool
	Teacher   string
	Title     string
	CourseID  string
	Course    string
	Class     string
	Starts    time.Time
}

func (a *app) access(w http.ResponseWriter, r *http.Request, manage bool) (meetingInfo, bool) {
	u := who(r)
	var m meetingInfo
	e := a.db.QueryRowContext(r.Context(), `SELECT m.status,m.recording_allowed,COALESCE(c.teacher_id,''),m.title,c.id,c.name,cl.name,m.starts_at FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id WHERE m.id=? AND `+courseAccess, r.PathValue("id"), u.School, u.Role, u.Role, u.ID, u.Role, u.ID).Scan(&m.Status, &m.Recording, &m.Teacher, &m.Title, &m.CourseID, &m.Course, &m.Class, &m.Starts)
	if e != nil {
		problem(w, 404, "Meeting not found")
		return m, false
	}
	if manage && !a.roomHost(r, m) {
		problem(w, 403, "Teacher required")
		return m, false
	}
	if !a.academyLiveGate(w, r) {
		return m, false
	}
	return m, true
}
func (a *app) meetings(w http.ResponseWriter, r *http.Request) {
	page := 0
	if value := r.URL.Query().Get("page"); value != "" {
		var e error
		page, e = strconv.Atoi(value)
		if e != nil || page < 0 || page > 100000 {
			problem(w, 400, "Trang không hợp lệ")
			return
		}
	}
	u := who(r)
	a.query(w, r, `SELECT m.id,m.title,m.starts_at,m.status,m.recording_allowed,c.id AS course_id,c.class_id,c.name AS course,cl.name AS class_name FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id WHERE `+courseAccess+` AND (?='' OR c.id=?) ORDER BY (m.status='live') DESC,(m.status='scheduled') DESC,m.starts_at DESC,m.id DESC LIMIT 200 OFFSET ?`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, r.URL.Query().Get("course_id"), r.URL.Query().Get("course_id"), page*200)
}
func (a *app) createMeeting(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role == "student" {
		problem(w, 403, "Teacher required")
		return
	}
	var in struct {
		Course    string    `json:"course_id"`
		Title     string    `json:"title"`
		Starts    time.Time `json:"starts_at"`
		Recording bool      `json:"recording_allowed"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Title == "" || len(in.Title) > 200 || in.Starts.IsZero() {
		problem(w, 400, "Title and start time required")
		return
	}
	id := uid()
	res, e := a.db.ExecContext(r.Context(), `INSERT INTO meetings(id,school_id,course_id,title,starts_at,recording_allowed) SELECT ?,?,?, ?,?,? FROM courses WHERE id=? AND school_id=? AND (?='admin' OR teacher_id=?)`, id, u.School, in.Course, in.Title, in.Starts.UTC(), in.Recording, in.Course, u.School, u.Role, u.ID)
	if e != nil {
		problem(w, 400, "Create failed")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 404, "Course not found")
		return
	}
	a.audit(r, "meeting.create", id)
	send(w, 201, map[string]string{"id": id})
}
func (a *app) meetingState(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, true); !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &in) {
		return
	}
	from := "scheduled"
	if in.Status == "ended" {
		from = "live"
	} else if in.Status != "live" {
		problem(w, 400, "Status must be live or ended")
		return
	}
	u := who(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var assigned sql.NullString
	if e = tx.QueryRowContext(r.Context(), "SELECT c.teacher_id FROM courses c JOIN meetings m ON m.course_id=c.id AND m.school_id=c.school_id WHERE m.school_id=? AND m.id=? FOR UPDATE", u.School, r.PathValue("id")).Scan(&assigned); e != nil {
		problem(w, 404, "Meeting not found")
		return
	}
	if u.Role != "admin" && (!assigned.Valid || assigned.String != u.ID) {
		var n int
		if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM course_assistants ca JOIN meetings m ON m.school_id=ca.school_id AND m.course_id=ca.course_id WHERE m.school_id=? AND m.id=? AND ca.user_id=?`, u.School, r.PathValue("id"), u.ID).Scan(&n) != nil || n != 1 {
			problem(w, 403, "Phân công giáo viên đã thay đổi")
			return
		}
	}
	if in.Status == "live" && !assigned.Valid {
		problem(w, 409, "Phân công giáo viên trước khi bắt đầu buổi học")
		return
	}
	res, e := tx.ExecContext(r.Context(), "UPDATE meetings SET status=? WHERE school_id=? AND id=? AND status=?", in.Status, u.School, r.PathValue("id"), from)
	if e != nil {
		problem(w, 500, "Update failed")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 409, "Invalid state transition")
		return
	}
	if in.Status == "ended" {
		if _, e = tx.ExecContext(r.Context(), "UPDATE presence SET online=FALSE WHERE school_id=? AND meeting_id=?", u.School, r.PathValue("id")); e != nil {
			problem(w, 500, "Update failed")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM publications WHERE school_id=? AND meeting_id=?", u.School, r.PathValue("id")); e != nil {
			problem(w, 500, "Update failed")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 500, "Update failed")
		return
	}
	a.audit(r, "meeting."+in.Status, r.PathValue("id"))
	send(w, 200, map[string]bool{"ok": true})
}

// Credit only intervals backed by two server observations within a 45s lease.
// Multiple tabs cannot increase time: the presence row is locked per user/meeting.
func credit(last, now time.Time, online bool) int64 {
	d := now.Sub(last)
	if !online || d < 0 || d > 45*time.Second {
		return 0
	}
	return int64(d / time.Second)
}
func (a *app) presence(w http.ResponseWriter, r *http.Request) {
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
	var in struct {
		Kind string `json:"kind"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Kind != "join" && in.Kind != "heartbeat" && in.Kind != "leave" {
		problem(w, 400, "Invalid presence event")
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
	// Lock meeting first so an end transition cannot race a late heartbeat.
	var state string
	if e = tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&state); e != nil || state != "live" {
		problem(w, 409, "Meeting is not live")
		return
	}
	var permitted int
	if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meetings m LEFT JOIN room_settings s ON s.school_id=m.school_id AND s.meeting_id=m.id LEFT JOIN room_members rm ON rm.school_id=m.school_id AND rm.meeting_id=m.id AND rm.user_id=? WHERE m.school_id=? AND m.id=? AND COALESCE(rm.state,'') NOT IN ('denied','removed') AND (? OR COALESCE(s.lobby,FALSE)=FALSE OR rm.state='admitted')`, u.ID, u.School, id, a.roomHost(r, m)).Scan(&permitted) != nil || permitted != 1 {
		problem(w, 403, "Chưa được phép vào phòng học")
		return
	}
	var now time.Time
	if tx.QueryRowContext(r.Context(), "SELECT UTC_TIMESTAMP(6)").Scan(&now) != nil {
		problem(w, 500, "Clock unavailable")
		return
	}
	_, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO presence(school_id,meeting_id,user_id,joined_at,last_seen,online) VALUES(?,?,?,?,?,FALSE)", u.School, id, u.ID, now, now)
	if e != nil {
		problem(w, 500, "Presence failed")
		return
	}
	var last time.Time
	var online bool
	var seconds int64
	e = tx.QueryRowContext(r.Context(), "SELECT last_seen,online,seconds FROM presence WHERE school_id=? AND meeting_id=? AND user_id=? FOR UPDATE", u.School, id, u.ID).Scan(&last, &online, &seconds)
	if e != nil {
		problem(w, 500, "Presence failed")
		return
	}
	seconds += credit(last, now, online)
	_, e = tx.ExecContext(r.Context(), "UPDATE presence SET last_seen=?,seconds=?,online=? WHERE school_id=? AND meeting_id=? AND user_id=?", now, seconds, in.Kind != "leave", u.School, id, u.ID)
	if e != nil {
		problem(w, 500, "Presence failed")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO attendance_events(school_id,meeting_id,user_id,kind) VALUES(?,?,?,?)", u.School, id, u.ID, in.Kind); e != nil {
		problem(w, 500, "Presence failed")
		return
	}
	if in.Kind == "leave" {
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM publications WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, id, u.ID); e != nil {
			problem(w, 500, "Presence failed")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 500, "Presence failed")
		return
	}
	send(w, 200, map[string]int64{"seconds": seconds})
}
func (a *app) attendance(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	a.query(w, r, `SELECT u.id,u.name,u.email,COALESCE(p.seconds,0) AS seconds,p.joined_at,p.last_seen,COALESCE(p.online AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND,FALSE) AS online FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id JOIN enrollments e ON e.class_id=c.class_id AND e.school_id=c.school_id JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id LEFT JOIN presence p ON p.meeting_id=m.id AND p.school_id=m.school_id AND p.user_id=u.id WHERE m.school_id=? AND m.id=? AND (?<>'student' OR u.id=?) ORDER BY u.name LIMIT 1000`, u.School, r.PathValue("id"), u.Role, u.ID)
}
