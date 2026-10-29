package main

import (
	"net/http"
	"strconv"
)

// Browsing recordings uses the same tenant/course authorization as meetings and attendance.
func (a *app) recordingLibrary(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	course, class, meeting := r.URL.Query().Get("course_id"), r.URL.Query().Get("class_id"), r.URL.Query().Get("meeting_id")
	page := 0
	var err error
	if raw := r.URL.Query().Get("page"); raw != "" {
		page, err = strconv.Atoi(raw)
	}
	if ((course == "" || class == "") && u.Role == "admin") || err != nil || page < 0 || page > 10000 {
		problem(w, 400, "Chọn lớp, môn và trang hợp lệ")
		return
	}
	if !a.learningScope(w, r, course, class, meeting) {
		return
	}
	a.query(w, r, `SELECT rec.id,rec.meeting_id,m.title AS meeting_title,m.starts_at,c.id AS course_id,c.name AS course,c.class_id,cl.name AS class_name,rec.size_bytes,rec.created_at,rec.expires_at
 FROM recordings rec JOIN meetings m ON m.school_id=rec.school_id AND m.id=rec.meeting_id
 JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id
 JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id
 WHERE `+lessonAccess+` AND (?='' OR c.id=?) AND (?='' OR c.class_id=?) AND (?='' OR m.id=?) AND rec.status='ready' AND rec.deleted_at IS NULL AND rec.expires_at>UTC_TIMESTAMP(6)
 ORDER BY m.starts_at DESC,m.id,rec.created_at DESC,rec.id LIMIT 51 OFFSET ?`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, course, course, class, class, meeting, meeting, page*50)
}
