package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Discovery deliberately excludes roster, chat, recordings and provider credentials.
const openAcademyClass = `NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=m.school_id AND bx.meeting_id=m.id) AND m.school_id=? AND m.status IN ('scheduled','live') AND COALESCE(cc.state,'active')='active'`

func (a *app) academyLiveClasses(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	page := 0
	var e error
	if raw := r.URL.Query().Get("page"); raw != "" {
		page, e = strconv.Atoi(raw)
	}
	state, q := r.URL.Query().Get("status"), strings.TrimSpace(r.URL.Query().Get("q"))
	if e != nil || page < 0 || page > 10000 || len(q) > 200 || (state != "" && state != "live" && state != "scheduled") {
		problem(w, 400, "Bộ lọc lớp học không hợp lệ")
		return
	}
	rows, e := a.workspaceRows(r.Context(), `SELECT m.id,m.title,m.status,m.starts_at,c.id AS course_id,c.name AS course,c.class_id,cl.name AS class_name,COALESCE(t.name,'Chưa phân công') AS teacher
 FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id
 LEFT JOIN class_controls cc ON cc.school_id=cl.school_id AND cc.class_id=cl.id LEFT JOIN users t ON t.school_id=c.school_id AND t.id=c.teacher_id
 WHERE `+openAcademyClass+` AND (?='' OR m.status=?) AND (?='' OR CONCAT_WS(' ',cl.name,c.name,m.title,t.name) LIKE ?) ORDER BY (m.status='live') DESC,m.starts_at DESC,m.id LIMIT 51 OFFSET ?`, u.School, state, state, q, "%"+q+"%", page*50)
	if e != nil {
		problem(w, 503, "Chưa tải được lớp đang mở")
		return
	}
	more := len(rows) > 50
	if more {
		rows = rows[:50]
	}
	send(w, 200, map[string]any{"rows": rows, "has_more": more, "can_live": u.Role != "student" || a.hasVIP(r.Context(), u.School, u.ID, false)})
}

func (a *app) academyEnterLiveClass(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" {
		problem(w, 403, "Học sinh sử dụng danh sách lớp để vào học")
		return
	}
	if !a.hasVIP(r.Context(), u.School, u.ID, false) {
		problem(w, 402, "Cần VIP còn hạn để tham gia Live")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa mở được lớp")
		return
	}
	defer tx.Rollback()
	var course, class, state string
	if tx.QueryRowContext(r.Context(), `SELECT c.id,c.class_id,m.status FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE m.school_id=? AND m.id=? FOR UPDATE`, u.School, r.PathValue("meeting")).Scan(&course, &class, &state) != nil {
		problem(w, 404, "Không tìm thấy buổi học")
		return
	}
	if state != "live" {
		problem(w, 409, "Giáo viên chưa bắt đầu hoặc buổi học đã kết thúc; tải lại danh sách")
		return
	}
	if e = a.lockActiveClass(tx, r, course); e != nil {
		problem(w, 409, "Lớp đang ngưng hoặc đã xóa")
		return
	}
	var expires time.Time
	if tx.QueryRowContext(r.Context(), "SELECT expires_at FROM academy_memberships WHERE school_id=? AND user_id=? FOR UPDATE", u.School, u.ID).Scan(&expires) != nil || !expires.After(time.Now().UTC()) {
		problem(w, 402, "VIP đã hết hạn; vui lòng kiểm tra gói học")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", u.School, class, u.ID); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa đăng ký được lớp; thử lại")
		return
	}
	a.audit(r, "academy.live.enter", r.PathValue("meeting"))
	send(w, 200, map[string]any{"id": r.PathValue("meeting"), "status": state, "course_id": course, "class_id": class})
}
