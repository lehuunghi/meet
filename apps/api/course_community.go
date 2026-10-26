package main

import (
	"net/http"
	"strings"
)

func (a *app) courseCommunity(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	id := r.PathValue("id")
	var class string
	if a.db.QueryRowContext(r.Context(), "SELECT c.class_id FROM courses c WHERE c.id=? AND "+courseAccess, id, u.School, u.Role, u.Role, u.ID, u.Role, u.ID).Scan(&class) != nil {
		problem(w, 404, "Không tìm thấy môn học")
		return
	}
	manage := u.Role == "teacher" || (u.Role == "admin" && permitted(u, "academic"))
	if u.Role == "admin" && !manage {
		problem(w, 403, "Chưa có quyền quản lý lớp học")
		return
	}
	if r.Method == "POST" {
		if !manage {
			problem(w, 403, "Giáo viên phụ trách mới được đăng thông báo")
			return
		}
		var in struct{ Title, Body string }
		if !decode(w, r, &in) {
			return
		}
		in.Title = strings.TrimSpace(in.Title)
		in.Body = strings.TrimSpace(in.Body)
		if in.Title == "" || len(in.Title) > 200 || in.Body == "" || len(in.Body) > 10000 {
			problem(w, 400, "Nhập tiêu đề và nội dung thông báo hợp lệ")
			return
		}
		post := uid()
		res, err := a.db.ExecContext(r.Context(), "INSERT INTO course_announcements(id,school_id,course_id,author_id,title,body) SELECT ?,c.school_id,c.id,?,?,? FROM courses c WHERE c.id=? AND "+courseAccess, post, u.ID, in.Title, in.Body, id, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
		if err != nil {
			problem(w, 503, "Không lưu được thông báo")
			return
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			problem(w, 403, "Phân công đã thay đổi; tải lại môn học")
			return
		}
		a.audit(r, "course.announcement.create", post)
		send(w, 201, map[string]string{"id": post})
		return
	}
	posts, err := a.workspaceRows(r.Context(), `SELECT p.id,p.title,p.body,p.created_at,u.name AS author FROM course_announcements p JOIN users u ON u.school_id=p.school_id AND u.id=p.author_id WHERE p.school_id=? AND p.course_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 50`, u.School, id)
	if err != nil {
		problem(w, 503, "Chưa tải được bảng tin")
		return
	}
	teachers, err := a.workspaceRows(r.Context(), `SELECT u.id,u.name FROM users u JOIN courses c ON c.school_id=u.school_id WHERE c.school_id=? AND c.id=? AND (u.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=u.id)) AND u.active=TRUE ORDER BY u.name`, u.School, id)
	if err != nil {
		problem(w, 503, "Chưa tải được giáo viên")
		return
	}
	students := []map[string]any{}
	var count int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM enrollments e JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id WHERE e.school_id=? AND e.class_id=? AND u.role='student' AND u.active=TRUE", u.School, class).Scan(&count) != nil {
		problem(w, 503, "Chưa tải được thành viên")
		return
	}
	if manage {
		students, err = a.workspaceRows(r.Context(), "SELECT u.id,u.name,u.short_id FROM enrollments e JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id WHERE e.school_id=? AND e.class_id=? AND u.role='student' AND u.active=TRUE ORDER BY u.name LIMIT 1000", u.School, class)
		if err != nil {
			problem(w, 503, "Chưa tải được thành viên")
			return
		}
	}
	send(w, 200, map[string]any{"announcements": posts, "teachers": teachers, "students": students, "student_count": count, "can_manage": manage})
}
