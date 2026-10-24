package main

import (
	"net/http"
	"time"
)

func (a *app) attendancePolicy(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		a.query(w, r, "SELECT COALESCE(p.late_minutes,10) AS late_minutes,COALESCE(p.early_minutes,10) AS early_minutes,COALESCE(p.min_percent,75) AS min_percent FROM schools s LEFT JOIN attendance_policies p ON p.school_id=s.id WHERE s.id=?", u.School)
		return
	}
	var in struct {
		Late    int `json:"late_minutes"`
		Early   int `json:"early_minutes"`
		Percent int `json:"min_percent"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Late < 0 || in.Late > 240 || in.Early < 0 || in.Early > 240 || in.Percent < 1 || in.Percent > 100 {
		problem(w, 400, "Số phút 0–240; tỷ lệ 1–100%")
		return
	}
	if _, e := a.db.ExecContext(r.Context(), "INSERT INTO attendance_policies VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE late_minutes=VALUES(late_minutes),early_minutes=VALUES(early_minutes),min_percent=VALUES(min_percent)", u.School, in.Late, in.Early, in.Percent); e != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, "attendance.policy", u.School)
	send(w, 200, map[string]bool{"ok": true})
}

// Legacy individual corrections remain in the audit/history tables, but new changes are per lesson.
func (a *app) attendanceAdjust(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	problem(w, 410, "Chỉnh khung giờ chung của buổi học; không chỉnh riêng từng học sinh.")
}

const timingSelect = `SELECT COALESCE(t.starts_at,m.starts_at),COALESCE(t.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE)),m.title FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id LEFT JOIN meeting_timings t ON t.school_id=m.school_id AND t.meeting_id=m.id WHERE m.school_id=? AND m.id=? AND c.id=? AND c.class_id=?`

func (a *app) attendanceTiming(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	u := who(r)
	var in struct {
		Meeting       string    `json:"meeting_id"`
		Class         string    `json:"class_id"`
		Course        string    `json:"course_id"`
		Start         time.Time `json:"starts_at"`
		End           time.Time `json:"ends_at"`
		ExpectedStart time.Time `json:"expected_starts_at"`
		ExpectedEnd   time.Time `json:"expected_ends_at"`
	}
	if r.Method == "GET" {
		in.Meeting = r.URL.Query().Get("meeting_id")
		in.Class = r.URL.Query().Get("class_id")
		in.Course = r.URL.Query().Get("course_id")
	} else if !decode(w, r, &in) {
		return
	}
	if in.Meeting == "" || in.Class == "" || in.Course == "" {
		problem(w, 400, "Chọn đúng lớp, môn và buổi học")
		return
	}
	var start, end time.Time
	var title string
	if r.Method == "GET" {
		if a.db.QueryRowContext(r.Context(), timingSelect, u.School, in.Meeting, in.Course, in.Class).Scan(&start, &end, &title) != nil {
			problem(w, 404, "Không tìm thấy buổi trong lớp/môn")
			return
		}
		send(w, 200, map[string]any{"meeting_id": in.Meeting, "starts_at": start, "ends_at": end, "title": title})
		return
	}
	if in.Start.IsZero() || !in.End.After(in.Start) || in.End.Sub(in.Start) > 24*time.Hour || in.ExpectedStart.IsZero() || in.ExpectedEnd.IsZero() {
		problem(w, 400, "Giờ ra phải sau giờ vào, tối đa 24 giờ. Tải lại khung giờ trước khi lưu.")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	if tx.QueryRowContext(r.Context(), timingSelect+" FOR UPDATE", u.School, in.Meeting, in.Course, in.Class).Scan(&start, &end, &title) != nil {
		problem(w, 404, "Không tìm thấy buổi trong lớp/môn")
		return
	}
	if !start.Equal(in.ExpectedStart) || !end.Equal(in.ExpectedEnd) {
		problem(w, 409, "Khung giờ đã được thay đổi; chọn lại buổi để tải dữ liệu mới.")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO meeting_timings(school_id,meeting_id,starts_at,ends_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at),ends_at=VALUES(ends_at)", u.School, in.Meeting, in.Start.UTC(), in.End.UTC()); e != nil {
		problem(w, 500, "Không lưu được khung giờ")
		return
	}
	if tx.Commit() != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, "attendance.lesson-timing", in.Meeting)
	send(w, 200, map[string]bool{"ok": true})
}
