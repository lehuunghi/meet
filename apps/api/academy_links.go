package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func validCheckoutURL(value string) bool {
	p, e := url.Parse(value)
	return e == nil && len(value) <= 2000 && p.Scheme == "https" && p.User == nil && (p.Port() == "" || p.Port() == "443") && (strings.EqualFold(p.Hostname(), "pay.payos.vn") || strings.HasSuffix(strings.ToLower(p.Hostname()), ".payos.vn"))
}
func (a *app) academyOrderDetail(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" {
		problem(w, 403, "Đơn thanh toán dành cho học sinh")
		return
	}
	var code, amount int64
	var status string
	id := r.PathValue("order")
	if a.db.QueryRowContext(r.Context(), "SELECT code,price_vnd,status FROM academy_orders WHERE school_id=? AND user_id=? AND id=?", u.School, u.ID, id).Scan(&code, &amount, &status) != nil {
		problem(w, 404, "Không tìm thấy đơn thanh toán")
		return
	}
	cfg, _ := loadSettings()
	memo := "NAPVIP " + strconv.FormatInt(code, 10)
	qr := ""
	if status == "pending" && cfg.Commerce.BankBIN != "" && cfg.Commerce.BankAccount != "" {
		params := url.Values{"amount": {strconv.FormatInt(amount, 10)}, "addInfo": {memo}, "accountName": {cfg.Commerce.BankName}}
		qr = "https://img.vietqr.io/image/" + url.PathEscape(cfg.Commerce.BankBIN) + "-" + url.PathEscape(cfg.Commerce.BankAccount) + "-compact2.png?" + params.Encode()
	}
	out := map[string]any{"id": id, "code": code, "amount": amount, "status": status, "description": memo, "bank_account": cfg.Commerce.BankAccount, "bank_name": cfg.Commerce.BankName, "qr_url": qr}
	if status == "pending" {
		var checkout string
		if a.db.QueryRowContext(r.Context(), "SELECT checkout_url FROM academy_order_links WHERE school_id=? AND order_id=?", u.School, id).Scan(&checkout) == nil && validCheckoutURL(checkout) {
			out["checkout_url"] = checkout
		}
	}
	send(w, 200, out)
}
func (a *app) academyStudentCourse(r *http.Request, course string) bool {
	u := who(r)
	var n int
	return u.Role == "student" && a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM academy_courses ac LEFT JOIN courses c ON c.school_id=ac.school_id AND c.id=ac.academic_course_id WHERE ac.school_id=? AND ac.id=? AND ac.published=TRUE AND (ac.academic_course_id IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=ac.school_id AND e.class_id=c.class_id AND e.user_id=?))`, u.School, course, u.ID).Scan(&n) == nil && n == 1
}
func (a *app) academyResolve(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	var course, id, title, raw string
	var due time.Time
	assignment := r.PathValue("assignment") != ""
	var err error
	if !assignment {
		err = a.db.QueryRowContext(r.Context(), "SELECT course_id,id,title FROM academy_lessons WHERE school_id=? AND id=? AND status='ready'", u.School, r.PathValue("lesson")).Scan(&course, &id, &title)
	} else {
		err = a.db.QueryRowContext(r.Context(), "SELECT course_id,id,title,questions,due_at FROM academy_assignments WHERE school_id=? AND id=?", u.School, r.PathValue("assignment")).Scan(&course, &id, &title, &raw, &due)
	}
	if err != nil {
		problem(w, 404, "Không tìm thấy nội dung")
		return
	}
	teacher := a.academyTeach(r, course)
	if u.Role == "student" {
		// Free video previews are public, but assignments belong to the enrolled class.
		var published bool
		if a.db.QueryRowContext(r.Context(), "SELECT published FROM academy_courses WHERE school_id=? AND id=?", u.School, course).Scan(&published) != nil || !published || (assignment && !a.academyStudentCourse(r, course)) {
			problem(w, 404, "Không tìm thấy nội dung")
			return
		}
		if assignment && !a.hasVIP(r.Context(), u.School, u.ID, false) {
			problem(w, 402, "Bài tập cần quyền của gói học")
			return
		}
	} else if !teacher && !(u.Role == "admin" && !assignment && permitted(u, "content")) {
		problem(w, 403, "Chưa có quyền nội dung")
		return
	}
	out := map[string]any{"id": id, "course_id": course, "title": title}
	if assignment {
		var questions []academyQuestion
		_ = json.Unmarshal([]byte(raw), &questions)
		if !teacher {
			for i := range questions {
				questions[i].Answer = ""
			}
		}
		out["questions"] = questions
		out["due_at"] = due
		var score, feedback, submitted any
		_ = a.db.QueryRowContext(r.Context(), "SELECT score,feedback,submitted_at FROM academy_submissions WHERE school_id=? AND assignment_id=? AND user_id=?", u.School, id, u.ID).Scan(&score, &feedback, &submitted)
		out["score"] = score
		out["feedback"] = feedback
		out["submitted_at"] = submitted
	}
	send(w, 200, out)
}
