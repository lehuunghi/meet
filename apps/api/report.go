package main

import (
	"net/http"
	"strconv"
)

// A course is a subject taught to one class. Authorize it before querying the roster.
func (a *app) attendanceReport(w http.ResponseWriter, r *http.Request) {
	if _, _, _, e := reportMonth(r); e != nil {
		problem(w, 400, e.Error())
		return
	}
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

const lessonStartSQL = `COALESCE(mt.starts_at,tw.started_at,m.starts_at)`
const lessonEndSQL = `COALESCE(mt.ends_at,tw.ended_at,IF(tw.started_at IS NOT NULL,UTC_TIMESTAMP(6),DATE_ADD(m.starts_at,INTERVAL 60 MINUTE)))`
const noTeachingPresenceSQL = `(tw.meeting_id IS NOT NULL AND (tw.started_at IS NULL OR p.last_seen<tw.started_at))`
const attendanceSecondsSQL = `CASE WHEN ` + noTeachingPresenceSQL + ` THEN 0 ELSE COALESCE(p.seconds,0) END`

func (a *app) renderAttendance(w http.ResponseWriter, r *http.Request, course, class, meeting string, page int) {
	u := who(r)
	month, from, to, _ := reportMonth(r)
	limit := 51
	if r.URL.Query().Get("format") == "xlsx" {
		limit = 10001
		page = 0
	}
	a.query(w, r, `SELECT u.id,u.name,u.email,c.id AS course_id,c.name AS course,cl.id AS class_id,cl.name AS class_name,
 m.id AS meeting_id,m.title AS meeting_title,m.starts_at,1 AS session_count,CASE WHEN p.joined_at IS NOT NULL AND NOT COALESCE(`+noTeachingPresenceSQL+`,FALSE) THEN 1 ELSE 0 END AS participated_sessions,
 `+attendanceSecondsSQL+` AS seconds,CASE WHEN `+noTeachingPresenceSQL+` THEN NULL ELSE GREATEST(p.joined_at,COALESCE(tw.started_at,p.joined_at)) END AS joined_at,CASE WHEN `+noTeachingPresenceSQL+` THEN NULL ELSE LEAST(p.last_seen,COALESCE(tw.ended_at,p.last_seen)) END AS last_seen,`+lessonStartSQL+` AS lesson_start,`+lessonEndSQL+` AS lesson_end,tw.started_at AS teaching_started_at,tw.ended_at AS teaching_ended_at,
 CASE WHEN tw.meeting_id IS NOT NULL AND tw.started_at IS NULL THEN IF(m.status='live','Chờ giáo viên','Chưa giảng dạy') WHEN m.status='live' THEN 'Đang học' WHEN p.joined_at IS NULL OR `+noTeachingPresenceSQL+` THEN 'Vắng' WHEN p.joined_at<=DATE_ADD(`+lessonStartSQL+`,INTERVAL COALESCE(policy.late_minutes,10) MINUTE) AND p.last_seen>=DATE_SUB(`+lessonEndSQL+`,INTERVAL COALESCE(policy.early_minutes,10) MINUTE) AND (`+attendanceSecondsSQL+`)*100>=TIMESTAMPDIFF(SECOND,`+lessonStartSQL+`,`+lessonEndSQL+`)*COALESCE(policy.min_percent,75) THEN 'Đạt' ELSE 'Chưa đạt' END AS attendance_result,
 COALESCE(p.online AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND m.status='live',FALSE) AS online
 FROM courses c JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id
 JOIN enrollments e ON e.school_id=c.school_id AND e.class_id=c.class_id
 JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id AND u.role='student'
 JOIN meetings m ON m.school_id=c.school_id AND m.course_id=c.id AND m.status IN ('live','ended') AND NOT EXISTS(SELECT 1 FROM attendance_report_deletions ad WHERE ad.school_id=m.school_id AND ad.meeting_id=m.id)
 LEFT JOIN presence p ON p.school_id=m.school_id AND p.meeting_id=m.id AND p.user_id=u.id
 LEFT JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id
 LEFT JOIN meeting_timings mt ON mt.school_id=m.school_id AND mt.meeting_id=m.id
 LEFT JOIN attendance_policies policy ON policy.school_id=c.school_id
 WHERE `+courseAccess+` AND (?='' OR c.id=?) AND (?='' OR c.class_id=?) AND (?='' OR m.id=?) AND (?<>'student' OR u.id=?) AND (?='' OR (m.starts_at>=? AND m.starts_at<?))
 ORDER BY m.starts_at DESC,m.id,u.name,u.id LIMIT ? OFFSET ?`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID, course, course, class, class, meeting, meeting, u.Role, u.ID, month, from, to, limit, page*50)
}
