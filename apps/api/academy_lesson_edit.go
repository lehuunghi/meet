package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

func (a *app) academyLessonEdit(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		Title, Chapter, Notes string
		Published             bool
		Revision              int
		Duration              int `json:"duration_seconds"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || len(in.Title) > 200 || len(in.Chapter) > 200 || len(in.Notes) > 20000 || in.Duration < 0 || in.Duration > 28800 {
		problem(w, 400, "Tên/chủ đề/ghi chú không hợp lệ")
		return
	}
	u := who(r)
	id := r.PathValue("lesson")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được bài giảng")
		return
	}
	defer tx.Rollback()
	var course string
	var size int64
	if tx.QueryRowContext(r.Context(), "SELECT course_id,size_bytes FROM academy_lessons WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&course, &size) != nil {
		problem(w, 404, "Không thấy bài giảng")
		return
	}
	var revision int
	var state string
	e = tx.QueryRowContext(r.Context(), "SELECT revision,import_state FROM academy_lesson_details WHERE school_id=? AND lesson_id=? FOR UPDATE", u.School, id).Scan(&revision, &state)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa kiểm tra được phiên bản bài giảng")
		return
	}
	if revision != in.Revision {
		problem(w, 409, "Bài giảng đã thay đổi; tải lại trước khi sửa")
		return
	}
	if in.Published && (size < 1 || state == "queued" || state == "copying" || state == "failed") {
		problem(w, 409, "Video chưa sẵn sàng để công khai")
		return
	}
	status := "draft"
	if in.Published {
		status = "ready"
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE academy_lessons SET title=?,status=?,duration_seconds=IF(?=0,duration_seconds,?) WHERE school_id=? AND id=?", in.Title, status, in.Duration, in.Duration, u.School, id); e != nil {
		problem(w, 503, "Chưa lưu được tên bài giảng")
		return
	}
	_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_lesson_details(school_id,lesson_id,course_id,chapter,notes,desired_published) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE chapter=VALUES(chapter),notes=VALUES(notes),desired_published=VALUES(desired_published),revision=revision+1", u.School, id, course, in.Chapter, in.Notes, in.Published)
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được ghi chú bài giảng")
		return
	}
	a.audit(r, "academy.lesson.edit", id)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyLessonOrder(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		IDs      []string `json:"ids"`
		Expected []string `json:"expected"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 1000 {
		problem(w, 400, "Danh sách sắp xếp không hợp lệ")
		return
	}
	u := who(r)
	course := r.PathValue("course")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa sắp xếp được")
		return
	}
	defer tx.Rollback()
	var own string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM academy_courses WHERE school_id=? AND id=? FOR UPDATE", u.School, course).Scan(&own) != nil {
		problem(w, 404, "Không thấy khóa học")
		return
	}
	rows, e := tx.QueryContext(r.Context(), "SELECT id FROM academy_lessons WHERE school_id=? AND course_id=? ORDER BY position,created_at,id FOR UPDATE", u.School, course)
	if e != nil {
		problem(w, 503, "Chưa đọc được thứ tự")
		return
	}
	current := []string{}
	allowed := map[string]bool{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil {
			rows.Close()
			problem(w, 503, "Dữ liệu thứ tự lỗi")
			return
		}
		current = append(current, id)
		allowed[id] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		problem(w, 503, "Chưa đọc hết bài giảng")
		return
	}
	before, _ := json.Marshal(current)
	expected, _ := json.Marshal(in.Expected)
	if string(before) != string(expected) || len(current) != len(in.IDs) {
		problem(w, 409, "Danh sách đã thay đổi; tải lại trước khi sắp xếp")
		return
	}
	for i, id := range in.IDs {
		if !allowed[id] {
			problem(w, 400, "Danh sách trùng hoặc chứa bài giảng ngoài khóa")
			return
		}
		delete(allowed, id)
		if _, e = tx.ExecContext(r.Context(), "UPDATE academy_lessons SET position=? WHERE school_id=? AND course_id=? AND id=?", i+1, u.School, course, id); e != nil {
			problem(w, 503, "Chưa lưu được thứ tự")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa hoàn tất sắp xếp")
		return
	}
	a.audit(r, "academy.lesson.reorder", course)
	send(w, 200, map[string]bool{"ok": true})
}
