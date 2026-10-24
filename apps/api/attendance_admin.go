package main

import (
	"net/http"
	"strings"
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
func (a *app) attendanceAdjust(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Meeting string    `json:"meeting_id"`
		User    string    `json:"user_id"`
		Joined  time.Time `json:"joined_at"`
		Left    time.Time `json:"left_at"`
		Reason  string    `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Joined.IsZero() || !in.Left.After(in.Joined) || in.Left.Sub(in.Joined) > 24*time.Hour || len(strings.TrimSpace(in.Reason)) < 3 || len(in.Reason) > 500 {
		problem(w, 400, "Giờ ra phải sau giờ vào, tối đa 24 giờ và có lý do")
		return
	}
	u := who(r)
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO attendance_adjustments(school_id,meeting_id,user_id,joined_at,left_at,reason,actor_id) SELECT ?,m.id,?, ?,?,?,? FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id JOIN enrollments en ON en.school_id=c.school_id AND en.class_id=c.class_id WHERE m.school_id=? AND m.id=? AND en.user_id=? AND m.status IN ('live','ended')", u.School, in.User, in.Joined.UTC(), in.Left.UTC(), strings.TrimSpace(in.Reason), u.ID, u.School, in.Meeting, in.User)
	if e != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 404, "Không tìm thấy buổi học/học sinh")
		return
	}
	a.audit(r, "attendance.adjust", in.Meeting+":"+in.User)
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) attendanceTiming(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Meeting string    `json:"meeting_id"`
		Start   time.Time `json:"starts_at"`
		End     time.Time `json:"ends_at"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Start.IsZero() || !in.End.After(in.Start) || in.End.Sub(in.Start) > 24*time.Hour {
		problem(w, 400, "Khoảng buổi học từ 1 giây đến 24 giờ")
		return
	}
	u := who(r)
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO meeting_timings(school_id,meeting_id,starts_at,ends_at) SELECT school_id,id,?,? FROM meetings WHERE school_id=? AND id=? ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at),ends_at=VALUES(ends_at)", in.Start.UTC(), in.End.UTC(), u.School, in.Meeting)
	if e != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		problem(w, 404, "Không tìm thấy buổi hoặc không thay đổi")
		return
	}
	a.audit(r, "attendance.timing", in.Meeting)
	send(w, 200, map[string]bool{"ok": true})
}
