package main

import (
	"net/http"
	"strconv"
)

// A course is a subject taught to one class. Authorize it before querying the roster.
func (a *app) attendanceReport(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	course := r.URL.Query().Get("course_id")
	class := r.URL.Query().Get("class_id")
	meeting := r.URL.Query().Get("meeting_id")
	page := 0
	var err error
	if raw := r.URL.Query().Get("page"); raw != "" {
		page, err = strconv.Atoi(raw)
	}
	if (course == "" && u.Role != "student") || err != nil || page < 0 || page > 10000 {
		problem(w, 400, "Select a course and valid page")
		return
	}
	if u.Role == "student" {
		if !a.learningScope(w, r, course, class, meeting) {
			return
		}
		a.renderAttendance(w, r, course, class, meeting, page)
		return
	}
	var actualClass string
	err = a.db.QueryRowContext(r.Context(), `SELECT c.class_id FROM courses c WHERE c.id=? AND `+courseAccess, course, u.School, u.Role, u.Role, u.ID, u.Role, u.ID).Scan(&actualClass)
	if err != nil || (class != "" && class != actualClass) {
		problem(w, 404, "Course not found")
		return
	}
	if meeting != "" {
		var n int
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings WHERE school_id=? AND course_id=? AND id=?", u.School, course, meeting).Scan(&n) != nil || n != 1 {
			problem(w, 404, "Meeting not found in this course")
			return
		}
	}
	a.renderAttendance(w, r, course, actualClass, meeting, page)
}
func (a *app) renderAttendance(w http.ResponseWriter, r *http.Request, course, class, meeting string, page int) {
	u := who(r)
	limit := 51
	if r.URL.Query().Get("format") == "xlsx" {
		limit = 10001
		page = 0
	}
	a.query(w, r, `SELECT u.id,u.name,u.email,c.id AS course_id,c.name AS course,cl.id AS class_id,cl.name AS class_name,
 m.id AS meeting_id,m.title AS meeting_title,m.starts_at,1 AS session_count,CASE WHEN p.joined_at IS NOT NULL THEN 1 ELSE 0 END AS participated_sessions,
 COALESCE(p.seconds,0) AS seconds,p.joined_at AS joined_at,p.last_seen AS last_seen,COALESCE(mt.starts_at,m.starts_at) AS lesson_start,COALESCE(mt.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE)) AS lesson_end,
 CASE WHEN m.status='live' THEN 'Đang học' WHEN p.joined_at IS NULL THEN 'Vắng' WHEN p.joined_at<=DATE_ADD(COALESCE(mt.starts_at,m.starts_at),INTERVAL COALESCE(policy.late_minutes,10) MINUTE) AND p.last_seen>=DATE_SUB(COALESCE(mt.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE)),INTERVAL COALESCE(policy.early_minutes,10) MINUTE) AND (COALESCE(p.seconds,0))*100>=TIMESTAMPDIFF(SECOND,COALESCE(mt.starts_at,m.starts_at),COALESCE(mt.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE)))*COALESCE(policy.min_percent,75) THEN 'Đạt' ELSE 'Chưa đạt' END AS attendance_result,
 COALESCE(p.online AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND m.status='live',FALSE) AS online
 FROM courses c JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id
 JOIN enrollments e ON e.school_id=c.school_id AND e.class_id=c.class_id
 JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id AND u.role='student'
 JOIN meetings m ON m.school_id=c.school_id AND m.course_id=c.id AND m.status IN ('live','ended')
 LEFT JOIN presence p ON p.school_id=m.school_id AND p.meeting_id=m.id AND p.user_id=u.id
 LEFT JOIN meeting_timings mt ON mt.school_id=m.school_id AND mt.meeting_id=m.id
 LEFT JOIN attendance_policies policy ON policy.school_id=c.school_id
 WHERE `+courseAccess+` AND (?='' OR c.id=?) AND (?='' OR c.class_id=?) AND (?='' OR m.id=?) AND (?<>'student' OR u.id=?)
 ORDER BY m.starts_at DESC,m.id,u.name,u.id LIMIT ? OFFSET ?`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, course, course, class, class, meeting, meeting, u.Role, u.ID, limit, page*50)
}
