package main

import (
	"database/sql"
	"net/http"
	"time"
)

func (a *app) scheduleConflict(tx *sql.Tx, r *http.Request, course string, start, end time.Time) (bool, error) {
	var n int
	e := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN courses target ON target.school_id=c.school_id AND target.id=? LEFT JOIN lesson_schedule ls ON ls.school_id=m.school_id AND ls.meeting_id=m.id WHERE m.school_id=? AND m.status IN ('scheduled','live') AND m.starts_at<? AND COALESCE(ls.ends_at,DATE_ADD(m.starts_at,INTERVAL 60 MINUTE))>? AND NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms b WHERE b.school_id=m.school_id AND b.meeting_id=m.id) AND (c.class_id=target.class_id OR EXISTS(SELECT 1 FROM users staff WHERE staff.school_id=c.school_id AND (staff.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=staff.id)) AND (staff.id=target.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=target.school_id AND ca.course_id=target.id AND ca.user_id=staff.id))))`, course, who(r).School, end.UTC(), start.UTC()).Scan(&n)
	return n > 0, e
}
