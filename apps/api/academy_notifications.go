package main

import (
	"fmt"
	"net/http"
	"regexp"
	"time"
)

type academyNotification struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Read   bool   `json:"read"`
}

func (a *app) academyNotifications(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	w.Header().Set("Cache-Control", "private,no-store")
	if r.Method == "POST" {
		var in struct {
			IDs []string `json:"ids"`
		}
		if !decode(w, r, &in) {
			return
		}
		if len(in.IDs) < 1 || len(in.IDs) > 100 {
			problem(w, 400, "Chọn tối đa 100 thông báo")
			return
		}
		for _, id := range in.IDs {
			if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(id) {
				problem(w, 400, "Thông báo không hợp lệ")
				return
			}
		}
		tx, e := a.db.BeginTx(r.Context(), nil)
		if e != nil {
			problem(w, 503, "Chưa cập nhật được thông báo")
			return
		}
		defer tx.Rollback()
		for _, id := range in.IDs {
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_notification_reads(school_id,user_id,notification_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE read_at=UTC_TIMESTAMP(6)", u.School, u.ID, id); e != nil {
				problem(w, 503, "Chưa lưu được trạng thái")
				return
			}
		}
		if tx.Commit() != nil {
			problem(w, 503, "Chưa lưu được trạng thái")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	out := []academyNotification{}
	add := func(kind, id, title, detail, path string) {
		out = append(out, academyNotification{ID: digest(kind + ":" + id), Title: title, Detail: detail, Path: path, Kind: kind})
	}
	broadcasts, e := a.workspaceRows(r.Context(), "SELECT id,title,body FROM academy_broadcasts WHERE school_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100", u.School)
	if e != nil {
		problem(w, 503, "Chưa tải được thông báo chung")
		return
	}
	for _, b := range broadcasts {
		add("broadcast", fmt.Sprint(b["id"]), fmt.Sprint(b["title"]), fmt.Sprint(b["body"]), "/hoc/thong-bao?thong-bao="+fmt.Sprint(b["id"]))
	}
	if u.Role == "student" || u.Role == "teacher" || (u.Role == "admin" && permitted(u, "academic")) {
		posts, e := a.workspaceRows(r.Context(), `SELECT p.id,p.title,c.id AS course_id,c.name AS course FROM course_announcements p JOIN courses c ON c.school_id=p.school_id AND c.id=p.course_id WHERE `+courseAccess+` AND p.created_at>UTC_TIMESTAMP()-INTERVAL 90 DAY ORDER BY p.created_at DESC LIMIT 15`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được thông báo")
			return
		}
		for _, p := range posts {
			add("announcement", fmt.Sprint(p["id"]), fmt.Sprint(p["title"]), fmt.Sprint(p["course"]), "/hoc/mon/"+fmt.Sprint(p["course_id"])+"/bang-tin")
		}
		meetings, e := a.workspaceRows(r.Context(), `SELECT m.id,m.title,m.starts_at,c.name AS course FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id WHERE `+courseAccess+` AND (m.status='live' OR (m.status='scheduled' AND m.starts_at BETWEEN UTC_TIMESTAMP() AND UTC_TIMESTAMP()+INTERVAL 7 DAY)) ORDER BY m.starts_at LIMIT 8`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được lịch học")
			return
		}
		if u.Role != "student" || a.hasVIP(r.Context(), u.School, u.ID, true) {
			for _, m := range meetings {
				when, _ := m["starts_at"].(time.Time)
				add("meeting", fmt.Sprint(m["id"])+when.UTC().Format(time.RFC3339), "Buổi học: "+fmt.Sprint(m["title"]), fmt.Sprint(m["course"]), "/hoc/buoi-hoc/"+fmt.Sprint(m["id"]))
			}
		}
	}
	if u.Role == "student" {
		if a.hasVIP(r.Context(), u.School, u.ID, false) {
			tasks, e := a.workspaceRows(r.Context(), `SELECT a.id,a.title,c.title AS course,s.score,s.feedback FROM academy_assignments a JOIN academy_courses c ON c.school_id=a.school_id AND c.id=a.course_id LEFT JOIN courses academic ON academic.id=c.academic_course_id AND academic.school_id=c.school_id LEFT JOIN academy_submissions s ON s.school_id=a.school_id AND s.assignment_id=a.id AND s.user_id=? WHERE a.school_id=? AND c.published=TRUE AND (c.academic_course_id IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.class_id=academic.class_id AND e.user_id=?)) AND ((s.score IS NOT NULL AND s.submitted_at>UTC_TIMESTAMP()-INTERVAL 90 DAY) OR (s.user_id IS NULL AND a.due_at BETWEEN UTC_TIMESTAMP() AND UTC_TIMESTAMP()+INTERVAL 7 DAY)) ORDER BY a.due_at DESC LIMIT 15`, u.ID, u.School, u.ID)
			if e != nil {
				problem(w, 503, "Chưa tải được bài tập")
				return
			}
			for _, t := range tasks {
				kind, title := "assignment", "Bài gần hạn: "+fmt.Sprint(t["title"])
				stamp := fmt.Sprint(t["id"])
				if t["score"] != nil {
					kind, title = "grade", "Đã chấm: "+fmt.Sprint(t["title"])
					stamp += fmt.Sprint(t["score"]) + fmt.Sprint(t["feedback"])
				}
				add(kind, stamp, title, fmt.Sprint(t["course"]), "/hoc/bai-tap/"+fmt.Sprint(t["id"]))
			}
		}
		orders, e := a.workspaceRows(r.Context(), "SELECT id,code FROM academy_orders WHERE school_id=? AND user_id=? AND status='paid' ORDER BY paid_at DESC LIMIT 10", u.School, u.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được thanh toán")
			return
		}
		for _, o := range orders {
			add("payment", fmt.Sprint(o["id"]), "Thanh toán đã được duyệt", "Đơn "+fmt.Sprint(o["code"]), "/hoc/thanh-toan/"+fmt.Sprint(o["id"]))
		}
	} else if u.Role == "teacher" {
		tasks, e := a.workspaceRows(r.Context(), `SELECT a.id,a.title,COUNT(s.user_id) AS total FROM academy_assignments a JOIN academy_courses ac ON ac.id=a.course_id AND ac.school_id=a.school_id JOIN courses c ON c.id=ac.academic_course_id AND c.school_id=ac.school_id JOIN academy_submissions s ON s.assignment_id=a.id AND s.school_id=a.school_id AND s.score IS NULL WHERE a.school_id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?)) GROUP BY a.id,a.title ORDER BY MIN(s.submitted_at) LIMIT 15`, u.School, u.ID, u.ID)
		if e != nil {
			problem(w, 503, "Chưa tải được bài cần chấm")
			return
		}
		for _, t := range tasks {
			add("grading", fmt.Sprint(t["id"])+fmt.Sprint(t["total"]), "Bài cần chấm: "+fmt.Sprint(t["title"]), fmt.Sprint(t["total"])+" bài chưa chấm", "/hoc/bai-tap/"+fmt.Sprint(t["id"]))
		}
	} else if u.Role == "admin" && permitted(u, "finance") {
		orders, e := a.workspaceRows(r.Context(), "SELECT id,code FROM academy_orders WHERE school_id=? AND status='pending' ORDER BY created_at DESC LIMIT 15", u.School)
		if e != nil {
			problem(w, 503, "Chưa tải được đơn chờ")
			return
		}
		for _, o := range orders {
			add("review", fmt.Sprint(o["id"]), "Đơn chờ thanh toán / đối soát", "Đơn "+fmt.Sprint(o["code"]), "/quan-tri/thanh-toan?don="+fmt.Sprint(o["id"]))
		}
	}
	reads, e := a.workspaceRows(r.Context(), "SELECT notification_id FROM academy_notification_reads WHERE school_id=? AND user_id=? ORDER BY read_at DESC LIMIT 1000", u.School, u.ID)
	if e != nil {
		problem(w, 503, "Chưa tải được trạng thái thông báo")
		return
	}
	seen := map[string]bool{}
	for _, v := range reads {
		seen[fmt.Sprint(v["notification_id"])] = true
	}
	for i := range out {
		out[i].Read = seen[out[i].ID]
	}
	send(w, 200, out)
}
