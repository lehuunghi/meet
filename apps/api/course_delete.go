package main

import (
	"net/http"
)

func (a *app) deleteCourse(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	class, e := a.classID(r)
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	var in struct {
		Revision int `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var id string
	var rev int
	if tx.QueryRowContext(r.Context(), "SELECT id,revision FROM courses WHERE school_id=? AND class_id=? AND id=? FOR UPDATE", who(r).School, class, r.PathValue("course")).Scan(&id, &rev) != nil {
		problem(w, 404, "Không tìm thấy môn")
		return
	}
	if rev != in.Revision {
		problem(w, 409, "Môn đã thay đổi; tải lại bảng")
		return
	}
	var used int
	if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings WHERE school_id=? AND course_id=?", who(r).School, id).Scan(&used) != nil || used > 0 {
		problem(w, 409, "Môn đã có buổi học; giữ lại để bảo toàn lịch sử điểm danh")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM courses WHERE school_id=? AND id=?", who(r).School, id); e != nil {
		problem(w, 409, "Môn còn liên kết, không thể xóa")
		return
	}
	if tx.Commit() != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, "course.delete", id)
	send(w, 200, map[string]bool{"ok": true})
}
