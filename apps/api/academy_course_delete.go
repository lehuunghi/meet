package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Delete the catalog entry only. Academic classes, meetings and financial records
// have independent ownership and are never cascaded from a catalog action.
func (a *app) academyCourseDelete(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		Confirm string `json:"confirm"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	id := r.PathValue("course")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa thể xóa khóa học")
		return
	}
	defer tx.Rollback()
	var title string
	if e = tx.QueryRowContext(r.Context(), "SELECT title FROM academy_courses WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&title); e != nil {
		if e == sql.ErrNoRows {
			problem(w, 404, "Không tìm thấy khóa học")
		} else {
			problem(w, 503, "Chưa tải được khóa học")
		}
		return
	}
	if in.Confirm != title {
		problem(w, 400, "Nhập đúng tên khóa học để xác nhận xóa vĩnh viễn")
		return
	}
	var lessons, tasks int
	if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_lessons WHERE school_id=? AND course_id=?", u.School, id).Scan(&lessons) != nil || tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_assignments WHERE school_id=? AND course_id=?", u.School, id).Scan(&tasks) != nil {
		problem(w, 503, "Chưa kiểm tra được dữ liệu liên quan")
		return
	}
	if lessons > 0 || tasks > 0 {
		problem(w, 409, "Khóa có bài giảng hoặc bài tập. Bỏ chọn Xuất bản để ngừng hiển thị; không xóa dữ liệu học tập bằng thao tác này.")
		return
	}
	var raw string
	e = tx.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=? FOR UPDATE", u.School).Scan(&raw)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa kiểm tra được nội dung website")
		return
	}
	if e == nil {
		var content map[string]json.RawMessage
		if json.Unmarshal([]byte(raw), &content) != nil {
			problem(w, 409, "Nội dung website cần được kiểm tra trước khi xóa khóa học")
			return
		}
		if pagesRaw, ok := content["course_pages"]; ok {
			var pages map[string]json.RawMessage
			if json.Unmarshal(pagesRaw, &pages) != nil {
				problem(w, 409, "Thông tin trang khóa học không hợp lệ")
				return
			}
			delete(pages, id)
			content["course_pages"], _ = json.Marshal(pages)
			updated, _ := json.Marshal(content)
			if _, e = tx.ExecContext(r.Context(), "UPDATE academy_site SET content=? WHERE school_id=?", string(updated), u.School); e != nil {
				problem(w, 503, "Chưa xóa được trang giới thiệu khóa học")
				return
			}
		}
	}
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM academy_courses WHERE school_id=? AND id=?", u.School, id); e != nil {
		problem(w, 409, "Khóa học vừa có dữ liệu liên quan; tải lại trước khi tiếp tục")
		return
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa hoàn tất xóa khóa học")
		return
	}
	a.audit(r, "academy.course.delete", id)
	send(w, 200, map[string]any{"ok": true, "id": id})
}
