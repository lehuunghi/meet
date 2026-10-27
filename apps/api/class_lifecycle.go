package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
)

func (a *app) classList(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	a.query(w, r, "SELECT cl.id,cl.short_id,cl.name,COALESCE(cc.state,'active') AS state,COALESCE(cc.revision,0) AS revision,(SELECT COUNT(*) FROM courses c WHERE c.school_id=cl.school_id AND c.class_id=cl.id) AS subject_count,(SELECT COUNT(*) FROM enrollments e WHERE e.school_id=cl.school_id AND e.class_id=cl.id) AS student_count FROM classes cl LEFT JOIN class_controls cc ON cc.school_id=cl.school_id AND cc.class_id=cl.id WHERE cl.school_id=? AND (?='1' OR COALESCE(cc.state,'active')<>'deleted') ORDER BY cl.name LIMIT 1000", who(r).School, r.URL.Query().Get("include_deleted"))
}
func (a *app) classManage(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Name, State, Confirm string
		Revision             int
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 100 || (in.State != "active" && in.State != "suspended" && in.State != "deleted") {
		problem(w, 400, "Tên hoặc trạng thái lớp không hợp lệ")
		return
	}
	u := who(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được lớp")
		return
	}
	defer tx.Rollback()
	var id, name string
	if tx.QueryRowContext(r.Context(), "SELECT id,name FROM classes WHERE school_id=? AND (id=? OR short_id=?) FOR UPDATE", u.School, r.PathValue("id"), r.PathValue("id")).Scan(&id, &name) != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	var state string
	var rev int
	e = tx.QueryRowContext(r.Context(), "SELECT state,revision FROM class_controls WHERE school_id=? AND class_id=? FOR UPDATE", u.School, id).Scan(&state, &rev)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa đọc được trạng thái lớp")
		return
	}
	if state == "deleted" {
		problem(w, 409, "Lớp đã xóa; chỉ được xem lịch sử")
		return
	}
	if rev != in.Revision {
		problem(w, 409, "Lớp đã thay đổi; tải lại trước khi lưu")
		return
	}
	if in.State == "deleted" && in.Confirm != name {
		problem(w, 409, "Nhập đúng tên lớp để xác nhận xóa")
		return
	}
	if in.State != "active" {
		var count int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id WHERE c.school_id=? AND c.class_id=? AND m.status='live'", u.School, id).Scan(&count) != nil {
			problem(w, 503, "Chưa kiểm tra được buổi đang học")
			return
		}
		if count > 0 {
			problem(w, 409, "Lớp còn buổi đang học; kết thúc buổi trước khi ngưng hoặc xóa lớp")
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE classes SET name=? WHERE school_id=? AND id=?", in.Name, u.School, id); e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO class_controls(school_id,class_id,state) VALUES(?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),revision=revision+1", u.School, id, in.State)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 409, "Chưa lưu được lớp; kiểm tra tên trùng")
		return
	}
	a.audit(r, "class."+in.State, id)
	send(w, 200, map[string]bool{"ok": true, "history_preserved": true})
}
func (a *app) lockActiveClass(tx *sql.Tx, r *http.Request, subject string) error {
	var class string
	if e := tx.QueryRowContext(r.Context(), "SELECT cl.id FROM classes cl JOIN courses c ON c.school_id=cl.school_id AND c.class_id=cl.id WHERE c.school_id=? AND c.id=? FOR UPDATE", who(r).School, subject).Scan(&class); e != nil {
		return e
	}
	var state string
	e := tx.QueryRowContext(r.Context(), "SELECT state FROM class_controls WHERE school_id=? AND class_id=?", who(r).School, class).Scan(&state)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if state != "active" {
		return fmt.Errorf("Lớp đã ngưng hoặc đã xóa; không thể mở lớp trực tuyến")
	}
	return nil
}
func (a *app) liveClassState(w http.ResponseWriter, r *http.Request, subject string) bool {
	var state string
	e := a.db.QueryRowContext(r.Context(), "SELECT COALESCE(cc.state,'active') FROM courses c LEFT JOIN class_controls cc ON cc.school_id=c.school_id AND cc.class_id=c.class_id WHERE c.school_id=? AND c.id=?", who(r).School, subject).Scan(&state)
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return false
	}
	if state != "active" {
		problem(w, 409, "Lớp đã ngưng hoặc đã xóa; không thể vào lớp trực tuyến")
		return false
	}
	return true
}
