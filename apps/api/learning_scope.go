package main

import (
	"net/http"
)

// Every optional learner filter is authorized; an empty filter never changes account scope.
func (a *app) learningScope(w http.ResponseWriter, r *http.Request, course, class, meeting string) bool {
	if course == "" && class == "" && meeting == "" {
		return true
	}
	u := who(r)
	var id string
	if meeting == "" {
		q := `SELECT c.id FROM courses c WHERE ` + courseAccess + ` AND (?='' OR c.id=?) AND (?='' OR c.class_id=?) LIMIT 1`
		if a.db.QueryRowContext(r.Context(), q, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, course, course, class, class).Scan(&id) == nil {
			return true
		}
	}

	q := `SELECT c.id FROM courses c JOIN meetings m ON m.school_id=c.school_id AND m.course_id=c.id WHERE ` + lessonAccess + ` AND (?='' OR c.id=?) AND (?='' OR c.class_id=?) AND (?='' OR m.id=?) LIMIT 1`
	if a.db.QueryRowContext(r.Context(), q, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, course, course, class, class, meeting, meeting).Scan(&id) != nil {
		problem(w, 404, "Không tìm thấy lớp/môn/buổi trong phạm vi tài khoản")
		return false
	}
	return true
}
