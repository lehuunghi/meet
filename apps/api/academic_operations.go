package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (a *app) academicOperations(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		kind := r.URL.Query().Get("kind")
		switch kind {
		case "terms":
			a.query(w, r, `SELECT id,name,starts_on,ends_on,closed,revision FROM academic_terms WHERE school_id=? ORDER BY starts_on DESC LIMIT 200`, u.School)
		case "transfers":
			a.query(w, r, `SELECT t.id,u.short_id,u.name,f.name AS from_name,d.name AS to_name,t.reason,t.at FROM student_transfers t JOIN users u ON u.school_id=t.school_id AND u.id=t.user_id JOIN classes f ON f.school_id=t.school_id AND f.id=t.from_class JOIN classes d ON d.school_id=t.school_id AND d.id=t.to_class WHERE t.school_id=? ORDER BY t.at DESC LIMIT 200`, u.School)
		case "sessions":
			a.query(w, r, `SELECT m.id,m.title,c.name AS subject,cl.name AS class_name,m.status,EXISTS(SELECT 1 FROM lesson_cancellations lc WHERE lc.school_id=m.school_id AND lc.meeting_id=m.id) AS cancelled,m.starts_at,ls.ends_at,tw.started_at,tw.ended_at,(m.status='scheduled' AND m.starts_at<UTC_TIMESTAMP()-INTERVAL 2 HOUR) AS stale_preparation,(m.status='live' AND NOT EXISTS(SELECT 1 FROM presence p WHERE p.school_id=m.school_id AND p.meeting_id=m.id AND (p.user_id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=p.user_id)) AND p.online=TRUE AND p.last_seen>UTC_TIMESTAMP()-INTERVAL 90 SECOND)) AS teacher_missing FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id LEFT JOIN lesson_schedule ls ON ls.school_id=m.school_id AND ls.meeting_id=m.id LEFT JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id WHERE m.school_id=? AND NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms b WHERE b.school_id=m.school_id AND b.meeting_id=m.id) ORDER BY (m.status='live') DESC,m.starts_at DESC LIMIT 200`, u.School)
		case "directory":
			page := 0
			if raw := r.URL.Query().Get("page"); raw != "" {
				var err error
				page, err = strconv.Atoi(raw)
				if err != nil || page < 0 || page > 100000 {
					problem(w, 400, "Trang không hợp lệ")
					return
				}
			}
			q := strings.TrimSpace(r.URL.Query().Get("q"))
			if len(q) > 200 {
				problem(w, 400, "Từ khóa quá dài")
				return
			}
			a.query(w, r, `SELECT u.id,u.short_id,u.student_code,u.name,u.email,u.role,u.active FROM users u WHERE u.school_id=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id) AND (?='' OR CONCAT_WS(' ',u.short_id,u.student_code,u.name,u.email) LIKE CONCAT('%',?,'%')) ORDER BY u.name,u.id LIMIT 51 OFFSET ?`, u.School, q, q, page*50)
		default:
			problem(w, 400, "Chọn danh sách hợp lệ")
		}
		return
	}
	var in struct {
		Action, ID, Name, Starts, Ends, User, From, To, Reason, Class, Term, Course string
		Revision                                                                    int
		Closed                                                                      bool
	}
	if !decode(w, r, &in) {
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa mở được giao dịch")
		return
	}
	defer tx.Rollback()
	var lock string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE id=? FOR UPDATE", u.School).Scan(&lock) != nil {
		problem(w, 503, "Chưa khóa được dữ liệu trường")
		return
	}
	id := in.ID
	switch in.Action {
	case "term":
		if id != "" && in.Closed {
			var live int
			if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN class_terms ct ON ct.school_id=c.school_id AND ct.class_id=c.class_id WHERE ct.school_id=? AND ct.term_id=? AND m.status='live'", u.School, id).Scan(&live) != nil || live > 0 {
				problem(w, 409, "Kết thúc các buổi đang học trước khi khóa năm học")
				return
			}
		}
		start, e1 := time.Parse("2006-01-02", in.Starts)
		end, e2 := time.Parse("2006-01-02", in.Ends)
		if strings.TrimSpace(in.Name) == "" || len(in.Name) > 100 || e1 != nil || e2 != nil || end.Before(start) {
			problem(w, 400, "Nhập tên và ngày năm học/học kỳ hợp lệ")
			return
		}
		if id == "" {
			id = uid()
			_, e = tx.ExecContext(r.Context(), "INSERT INTO academic_terms(id,school_id,name,starts_on,ends_on,closed) VALUES(?,?,?,?,?,?)", id, u.School, strings.TrimSpace(in.Name), start, end, in.Closed)
		} else {
			var n int
			if tx.QueryRowContext(r.Context(), "SELECT revision FROM academic_terms WHERE id=? AND school_id=? FOR UPDATE", id, u.School).Scan(&n) != nil || n != in.Revision {
				problem(w, 409, "Năm học đã thay đổi; tải lại trước khi lưu")
				return
			}
			_, e = tx.ExecContext(r.Context(), "UPDATE academic_terms SET name=?,starts_on=?,ends_on=?,closed=?,revision=revision+1 WHERE id=? AND school_id=?", strings.TrimSpace(in.Name), start, end, in.Closed, id, u.School)
		}
	case "cancel-schedule":
		var state string
		if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&state) != nil || state != "scheduled" {
			problem(w, 409, "Chỉ hủy được buổi chưa bắt đầu")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO lesson_cancellations(school_id,meeting_id,actor_id) VALUES(?,?,?)", u.School, id, u.ID); e == nil {
			_, e = tx.ExecContext(r.Context(), "UPDATE meetings SET status='ended' WHERE school_id=? AND id=?", u.School, id)
		}
	case "class-term":
		var active int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE c.school_id=? AND c.class_id=? AND m.status='live'", u.School, in.Class).Scan(&active) != nil || active > 0 {
			problem(w, 409, "Không đổi năm học của lớp khi đang có buổi học")
			return
		}
		var n int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM classes cl JOIN academic_terms t ON t.school_id=cl.school_id WHERE cl.school_id=? AND cl.id=? AND t.id=?", u.School, in.Class, in.Term).Scan(&n) != nil || n != 1 {
			problem(w, 404, "Lớp hoặc năm học không thuộc trường")
			return
		}
		_, e = tx.ExecContext(r.Context(), "INSERT INTO class_terms(school_id,class_id,term_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE term_id=VALUES(term_id)", u.School, in.Class, in.Term)
	case "transfer":
		if in.From == in.To || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 500 {
			problem(w, 400, "Chọn hai lớp khác nhau và nhập lý do")
			return
		}
		var student, from, to string
		if tx.QueryRowContext(r.Context(), "SELECT u.id FROM users u JOIN enrollments en ON en.school_id=u.school_id AND en.user_id=u.id WHERE u.school_id=? AND u.role='student' AND u.active=TRUE AND (u.id=? OR u.short_id=? OR u.student_code=?) AND en.class_id=? FOR UPDATE", u.School, in.User, in.User, in.User, in.From).Scan(&student) != nil {
			problem(w, 404, "Học sinh không thuộc lớp nguồn")
			return
		}
		for _, cl := range []string{in.From, in.To} {
			var found string
			if tx.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM class_controls cc WHERE cc.school_id=classes.school_id AND cc.class_id=classes.id AND cc.state<>'active') FOR UPDATE", u.School, cl).Scan(&found) != nil {
				problem(w, 404, "Lớp không hoạt động")
				return
			}
			if cl == in.From {
				from = found
			} else {
				to = found
			}
		}
		var live int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE c.school_id=? AND c.class_id IN (?,?) AND m.status='live'", u.School, from, to).Scan(&live) != nil || live > 0 {
			problem(w, 409, "Kết thúc buổi học của hai lớp trước khi chuyển")
			return
		}
		id = uid()
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO student_transfers(id,school_id,user_id,from_class,to_class,actor_id,reason) VALUES(?,?,?,?,?,?,?)", id, u.School, student, from, to, u.ID, strings.TrimSpace(in.Reason)); e == nil {
			_, e = tx.ExecContext(r.Context(), "INSERT INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", u.School, to, student)
		}
		if e == nil {
			_, e = tx.ExecContext(r.Context(), "DELETE FROM enrollments WHERE school_id=? AND class_id=? AND user_id=?", u.School, from, student)
		}
	case "schedule":
		start, e1 := time.Parse(time.RFC3339, in.Starts)
		end, e2 := time.Parse(time.RFC3339, in.Ends)
		if e1 != nil || e2 != nil || !end.After(start) || end.Sub(start) > 8*time.Hour || strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 {
			problem(w, 400, "Nhập tên, giờ bắt đầu/kết thúc hợp lệ, tối đa 8 giờ")
			return
		}
		var course, class, teacher string
		if tx.QueryRowContext(r.Context(), "SELECT c.id,c.class_id,COALESCE(c.teacher_id,'') FROM courses c WHERE c.school_id=? AND (c.id=? OR c.short_id=?) FOR UPDATE", u.School, in.Course, in.Course).Scan(&course, &class, &teacher) != nil || teacher == "" {
			problem(w, 404, "Môn chưa có giáo viên")
			return
		}
		if e = a.lockActiveClass(tx, r, course); e != nil {
			problem(w, 409, e.Error())
			return
		}
		var conflicts int
		if e = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id LEFT JOIN lesson_schedule ls ON ls.school_id=m.school_id AND ls.meeting_id=m.id WHERE m.school_id=? AND m.status IN ('scheduled','live') AND m.starts_at<? AND COALESCE(ls.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE))>? AND (c.class_id=? OR EXISTS(SELECT 1 FROM users staff WHERE staff.school_id=c.school_id AND (staff.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=staff.id)) AND (staff.id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=? AND ca.user_id=staff.id)))) AND NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms b WHERE b.school_id=m.school_id AND b.meeting_id=m.id)`, u.School, end.UTC(), start.UTC(), class, teacher, course).Scan(&conflicts); e != nil || conflicts > 0 {
			problem(w, 409, "Lịch trùng lớp hoặc giáo viên")
			return
		}
		id = uid()
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO meetings(id,school_id,course_id,title,starts_at) VALUES(?,?,?,?,?)", id, u.School, course, strings.TrimSpace(in.Name), start.UTC()); e == nil {
			_, e = tx.ExecContext(r.Context(), "INSERT INTO lesson_schedule(school_id,meeting_id,ends_at) VALUES(?,?,?)", u.School, id, end.UTC())
		}
	default:
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 409, "Không lưu được: kiểm tra dữ liệu trùng hoặc thay đổi đồng thời")
		return
	}
	a.audit(r, "academic."+in.Action, id)
	send(w, 200, map[string]any{"ok": true, "id": id})
}
