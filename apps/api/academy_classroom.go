package main

import (
	"database/sql"
	"net/http"
)

type academyClassLink struct {
	Linked    bool   `json:"linked"`
	ClassID   string `json:"class_id"`
	SubjectID string `json:"subject_id"`
	ClassName string `json:"class_name"`
	Subject   string `json:"subject"`
	Teacher   string `json:"teacher"`
	State     string `json:"state"`
	Enrolled  bool   `json:"enrolled"`
	CanLive   bool   `json:"can_live"`
}

func (a *app) academyClassLink(r *http.Request, course string) (academyClassLink, error) {
	u := who(r)
	var v academyClassLink
	var published bool
	e := a.db.QueryRowContext(r.Context(), "SELECT ac.published,COALESCE(c.id,''),COALESCE(cl.id,''),COALESCE(cl.name,''),COALESCE(c.name,''),COALESCE(t.name,'Chưa phân công'),COALESCE(cc.state,'active') FROM academy_courses ac LEFT JOIN courses c ON c.school_id=ac.school_id AND c.id=ac.academic_course_id LEFT JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id LEFT JOIN class_controls cc ON cc.school_id=cl.school_id AND cc.class_id=cl.id LEFT JOIN users t ON t.id=c.teacher_id AND t.school_id=c.school_id WHERE ac.school_id=? AND ac.id=?", u.School, course).Scan(&published, &v.SubjectID, &v.ClassID, &v.ClassName, &v.Subject, &v.Teacher, &v.State)
	if e != nil {
		return v, e
	}
	if (u.Role == "student" && !published) || (u.Role == "teacher" && !a.academyTeach(r, course)) || (u.Role == "admin" && !permitted(u, "content") && !permitted(u, "academic")) {
		return v, sql.ErrNoRows
	}
	v.Linked = v.SubjectID != ""
	v.CanLive = u.Role != "student" || a.hasVIP(r.Context(), u.School, u.ID, true)
	if v.Linked && u.Role == "student" {
		var n int
		e = a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM enrollments WHERE school_id=? AND class_id=? AND user_id=?", u.School, v.ClassID, u.ID).Scan(&n)
		v.Enrolled = n == 1
	}
	return v, e
}
func (a *app) academyClassroom(w http.ResponseWriter, r *http.Request) {
	v, e := a.academyClassLink(r, r.PathValue("course"))
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp của khóa học")
		return
	}
	send(w, 200, v)
}
func (a *app) academyEnroll(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" || !a.hasVIP(r.Context(), u.School, u.ID, true) {
		problem(w, 402, "Gói VIP hiện tại chưa có quyền học Live")
		return
	}
	course := r.PathValue("course")
	v, e := a.academyClassLink(r, course)
	if e != nil || !v.Linked {
		problem(w, 404, "Khóa học chưa liên kết lớp trực tuyến")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa đăng ký được lớp")
		return
	}
	defer tx.Rollback()
	if e = a.lockActiveClass(tx, r, v.SubjectID); e != nil {
		problem(w, 409, "Lớp đã ngưng hoặc đã xóa; video khóa học vẫn xem theo quyền VIP")
		return
	}
	var subject string
	if tx.QueryRowContext(r.Context(), "SELECT academic_course_id FROM academy_courses WHERE school_id=? AND id=? AND published=TRUE FOR UPDATE", u.School, course).Scan(&subject) != nil || subject != v.SubjectID {
		problem(w, 409, "Liên kết lớp đã thay đổi; tải lại khóa học")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", u.School, v.ClassID, u.ID); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa đăng ký được lớp")
		return
	}
	a.audit(r, "academy.class.enroll", course)
	send(w, 200, map[string]any{"ok": true, "class_id": v.ClassID, "subject_id": v.SubjectID})
}
func (a *app) academyClassCourses(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role == "admin" && !permitted(u, "content") {
		problem(w, 403, "Chưa có quyền quản lý nội dung")
		return
	}
	var subject string
	if a.db.QueryRowContext(r.Context(), "SELECT c.id FROM courses c WHERE c.id=? AND "+courseAccess, r.PathValue("subject"), u.School, u.Role, u.Role, u.ID, u.Role, u.ID).Scan(&subject) != nil {
		problem(w, 404, "Không tìm thấy môn học")
		return
	}
	a.query(w, r, "SELECT ac.id,ac.title,ac.published FROM academy_courses ac WHERE ac.school_id=? AND ac.academic_course_id=? AND (ac.published=TRUE OR ?<>'student') ORDER BY ac.title", u.School, subject, u.Role)
}
