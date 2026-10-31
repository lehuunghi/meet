package main

import (
	"encoding/json"
	"fmt"
	"github.com/xuri/excelize/v2"
	"math"
	"net/http"
	"strconv"
	"time"
)

func (a *app) academyTeach(r *http.Request, course string) bool {
	u := who(r)
	if u.Role == "admin" {
		return permitted(u, "academic")
	}
	if u.Role != "teacher" {
		return false
	}
	var n int
	return a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_courses ac JOIN courses c ON c.school_id=ac.school_id AND c.id=ac.academic_course_id WHERE ac.school_id=? AND ac.id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?))", u.School, course, u.ID, u.ID).Scan(&n) == nil && n == 1
}

type academyQuestion struct {
	ID      string   `json:"id"`
	Prompt  string   `json:"prompt"`
	Options []string `json:"options"`
	Answer  string   `json:"answer,omitempty"`
}

func (a *app) academyAssignments(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	course := r.PathValue("course")
	teacher := a.academyTeach(r, course)
	if !teacher && (!a.academyStudentCourse(r, course) || !a.hasVIP(r.Context(), u.School, u.ID, false)) {
		problem(w, 403, "Chưa có quyền bài tập")
		return
	}
	if r.Method == "POST" {
		if !teacher {
			problem(w, 403, "Giáo viên phụ trách mới được giao bài")
			return
		}
		var in struct {
			Title     string
			Questions []academyQuestion
			Due       time.Time `json:"due_at"`
		}
		if !decode(w, r, &in) {
			return
		}
		if len(in.Title) < 2 || len(in.Title) > 200 || len(in.Questions) < 1 || len(in.Questions) > 100 || !in.Due.After(time.Now()) {
			problem(w, 400, "Bài tập/thời hạn không hợp lệ")
			return
		}
		for i := range in.Questions {
			q := &in.Questions[i]
			if q.ID == "" {
				q.ID = strconv.Itoa(i + 1)
			}
			if q.Prompt == "" || len(q.Prompt) > 4000 || len(q.Options) > 10 {
				problem(w, 400, "Câu hỏi không hợp lệ")
				return
			}
		}
		raw, _ := json.Marshal(in.Questions)
		id := uid()
		if _, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_assignments(id,school_id,course_id,teacher_id,title,questions,due_at) VALUES(?,?,?,?,?,?,?)", id, u.School, course, u.ID, in.Title, string(raw), in.Due.UTC()); e != nil {
			problem(w, 400, "Không giao được bài")
			return
		}
		a.audit(r, "academy.assignment.create", id)
		send(w, 201, map[string]string{"id": id})
		return
	}
	rows, e := a.db.QueryContext(r.Context(), "SELECT a.id,a.title,a.questions,a.due_at,s.score,s.feedback,s.submitted_at FROM academy_assignments a LEFT JOIN academy_submissions s ON s.school_id=a.school_id AND s.assignment_id=a.id AND s.user_id=? WHERE a.school_id=? AND a.course_id=? ORDER BY a.due_at DESC LIMIT 100", u.ID, u.School, course)
	if e != nil {
		problem(w, 500, "Không tải được bài tập")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, title, raw string
		var due time.Time
		var score, feedback, submitted any
		if rows.Scan(&id, &title, &raw, &due, &score, &feedback, &submitted) != nil {
			problem(w, 500, "Dữ liệu lỗi")
			return
		}
		var questions []academyQuestion
		_ = json.Unmarshal([]byte(raw), &questions)
		if !teacher {
			for i := range questions {
				questions[i].Answer = ""
			}
		}
		out = append(out, map[string]any{"id": id, "title": title, "questions": questions, "due_at": due, "score": score, "feedback": feedback, "submitted_at": submitted})
	}
	send(w, 200, out)
}
func (a *app) academySubmission(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	id := r.PathValue("assignment")
	var course string
	if a.db.QueryRowContext(r.Context(), "SELECT course_id FROM academy_assignments WHERE school_id=? AND id=?", u.School, id).Scan(&course) != nil {
		problem(w, 404, "Không thấy bài tập")
		return
	}
	if r.Method == "GET" {
		if !a.academyTeach(r, course) {
			problem(w, 403, "Không được xem bài nộp")
			return
		}
		a.query(w, r, "SELECT s.user_id,u.name,s.answers,s.score,s.feedback,s.submitted_at FROM academy_submissions s JOIN users u ON u.school_id=s.school_id AND u.id=s.user_id WHERE s.school_id=? AND s.assignment_id=? ORDER BY u.name", u.School, id)
		return
	}
	if !a.academyStudentCourse(r, course) || !a.hasVIP(r.Context(), u.School, u.ID, false) {
		problem(w, 402, "Cần quyền học bài tập")
		return
	}
	var in struct{ Answers map[string]string }
	if !decode(w, r, &in) {
		return
	}
	raw, _ := json.Marshal(in.Answers)
	if len(raw) > 100000 {
		problem(w, 400, "Bài nộp quá lớn")
		return
	}
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_submissions(school_id,assignment_id,user_id,answers) SELECT school_id,id,?,? FROM academy_assignments WHERE school_id=? AND id=? AND due_at>=UTC_TIMESTAMP(6) ON DUPLICATE KEY UPDATE answers=VALUES(answers),submitted_at=UTC_TIMESTAMP(6),score=NULL,feedback=NULL,graded_by=NULL", u.ID, string(raw), u.School, id)
	if e != nil {
		problem(w, 400, "Không nộp được bài")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		problem(w, 409, "Đã hết hạn nộp")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyGrade(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	id := r.PathValue("assignment")
	var course string
	if a.db.QueryRowContext(r.Context(), "SELECT course_id FROM academy_assignments WHERE school_id=? AND id=?", u.School, id).Scan(&course) != nil || !a.academyTeach(r, course) {
		problem(w, 403, "Chưa được phân công chấm bài")
		return
	}
	var in struct {
		User     string `json:"user_id"`
		Score    float64
		Feedback string
	}
	if !decode(w, r, &in) {
		return
	}
	if math.IsNaN(in.Score) || math.IsInf(in.Score, 0) || in.Score < 0 || in.Score > 10 || len(in.Feedback) > 10000 {
		problem(w, 400, "Điểm từ 0 đến 10")
		return
	}
	res, e := a.db.ExecContext(r.Context(), "UPDATE academy_submissions SET score=?,feedback=?,graded_by=? WHERE school_id=? AND assignment_id=? AND user_id=?", in.Score, in.Feedback, u.ID, u.School, id, in.User)
	if e != nil {
		problem(w, 500, "Không lưu được điểm")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 404, "Chưa có bài nộp")
		return
	}
	a.audit(r, "academy.grade", id+":"+in.User)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyFinance(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	u := who(r)
	if r.Method == "POST" {
		var in struct {
			ID     string
			Title  string
			Amount int64  `json:"amount_vnd"`
			Date   string `json:"paid_on"`
		}
		if !decode(w, r, &in) {
			return
		}
		if _, e := time.Parse("2006-01-02", in.Date); e != nil || in.Title == "" || len(in.Title) > 200 || in.Amount < 1 || in.Amount > 100000000000 {
			problem(w, 400, "Khoản chi không hợp lệ")
			return
		}
		id := in.ID
		if id == "" {
			id = uid()
		}
		if _, e := a.db.ExecContext(r.Context(), "INSERT IGNORE INTO academy_expenses(id,school_id,title,amount_vnd,paid_on,actor_id) VALUES(?,?,?,?,?,?)", id, u.School, in.Title, in.Amount, in.Date, u.ID); e != nil {
			problem(w, 500, "Không lưu được khoản chi")
			return
		}
		a.audit(r, "academy.expense", id)
		send(w, 201, map[string]string{"id": id})
		return
	}
	a.query(w, r, "SELECT DATE(paid_at) AS day,SUM(price_vnd) AS revenue,COUNT(*) AS orders FROM academy_orders WHERE school_id=? AND status='paid' GROUP BY DATE(paid_at) ORDER BY day DESC LIMIT 366", u.School)
}
func (a *app) academyExport(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	kind := r.PathValue("kind")
	var query string
	switch kind {
	case "students":
		if !a.businessAdmin(w, r, "accounts") {
			return
		}
		query = "SELECT u.short_id AS 'Mã',u.name AS 'Họ tên',u.email AS 'Email',p.dob AS 'Ngày sinh',p.address AS 'Địa chỉ',p.school_name AS 'Trường',p.phone AS 'Điện thoại',p.parent_phone AS 'Điện thoại phụ huynh',p.avatar_key AS 'Mã ảnh',m.expires_at AS 'Hết hạn VIP' FROM users u JOIN academy_profiles p ON p.school_id=u.school_id AND p.user_id=u.id LEFT JOIN academy_memberships m ON m.school_id=u.school_id AND m.user_id=u.id WHERE u.school_id=? AND u.role='student'"
		if r.URL.Query().Get("marketing") == "1" {
			query += " AND p.marketing_consent=TRUE"
		}
	case "finance":
		if !a.businessAdmin(w, r, "finance") {
			return
		}
		query = "SELECT code AS 'Mã đơn',price_vnd AS 'Số tiền VND',status AS 'Trạng thái',paid_at AS 'Ngày thu',provider_ref AS 'Mã giao dịch' FROM academy_orders WHERE school_id=? ORDER BY created_at DESC"
	default:
		problem(w, 404, "Không có báo cáo")
		return
	}
	rows, e := a.db.QueryContext(r.Context(), query+" LIMIT 10000", u.School)
	if e != nil {
		problem(w, 500, "Không xuất được báo cáo")
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	f := excelize.NewFile()
	defer f.Close()
	for i, c := range cols {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellStr("Sheet1", cell, c)
	}
	n := 2
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if rows.Scan(ptrs...) != nil {
			problem(w, 500, "Dữ liệu lỗi")
			return
		}
		for i, v := range values {
			cell, _ := excelize.CoordinatesToCellName(i+1, n)
			text := fmt.Sprint(v)
			if v == nil {
				text = ""
			}
			if b, ok := v.([]byte); ok {
				text = string(b)
			}
			if cols[i] == "Ngày sinh" || cols[i] == "Hết hạn VIP" || cols[i] == "Ngày thu" {
				text = vietnamDateText(v, cols[i] == "Ngày sinh")
			}
			_ = f.SetCellStr("Sheet1", cell, text)
		}
		n++
	}
	_ = f.SetColWidth("Sheet1", "A", "L", 23)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=\"academy-"+kind+".xlsx\"")
	a.audit(r, "academy.export", kind)
	_ = f.Write(w)
}
