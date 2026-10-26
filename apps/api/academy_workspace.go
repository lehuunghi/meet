package main

import (
	"context"
	"net/http"
)

// Return only role-scoped work, never answer keys or another learner's progress.
func (a *app) workspaceRows(ctx context.Context, q string, args ...any) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range values {
			ptr[i] = &values[i]
		}
		if err = rows.Scan(ptr...); err != nil {
			return nil, err
		}
		v := map[string]any{}
		for i, k := range cols {
			if b, ok := values[i].([]byte); ok {
				v[k] = string(b)
			} else {
				v[k] = values[i]
			}
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (a *app) academyWorkspace(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "student" && u.Role != "teacher" {
		problem(w, 403, "Không gian dành cho giáo viên và học sinh")
		return
	}
	ctx := r.Context()
	meetings, tasks, resume := []map[string]any{}, []map[string]any{}, []map[string]any{}
	var err error
	if u.Role == "teacher" || a.hasVIP(ctx, u.School, u.ID, true) {
		meetings, err = a.workspaceRows(ctx, `SELECT m.id,m.title,m.starts_at,m.status,c.name AS course,cl.name AS class_name,c.id AS course_id FROM meetings m JOIN courses c ON c.id=m.course_id AND c.school_id=m.school_id JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id WHERE `+courseAccess+` AND (m.status='live' OR (m.status='scheduled' AND m.starts_at BETWEEN UTC_TIMESTAMP()-INTERVAL 1 HOUR AND UTC_TIMESTAMP()+INTERVAL 7 DAY)) ORDER BY (m.status='live') DESC,m.starts_at LIMIT 6`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
		if err != nil {
			problem(w, 503, "Chưa tải được lịch học")
			return
		}
	}
	if u.Role == "teacher" {
		tasks, err = a.workspaceRows(ctx, `SELECT a.id,a.course_id,a.title,a.due_at,ac.title AS course,
 (SELECT COUNT(*) FROM academy_submissions s WHERE s.school_id=a.school_id AND s.assignment_id=a.id AND s.score IS NULL) AS ungraded,
 (SELECT COUNT(*) FROM enrollments e JOIN users learner ON learner.id=e.user_id AND learner.school_id=e.school_id JOIN academy_memberships vip ON vip.user_id=e.user_id AND vip.school_id=e.school_id WHERE e.school_id=a.school_id AND e.class_id=c.class_id AND learner.active=TRUE AND vip.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM academy_submissions s WHERE s.school_id=a.school_id AND s.assignment_id=a.id AND s.user_id=e.user_id)) AS missing
 FROM academy_assignments a JOIN academy_courses ac ON ac.id=a.course_id AND ac.school_id=a.school_id JOIN courses c ON c.id=ac.academic_course_id AND c.school_id=ac.school_id WHERE a.school_id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?)) HAVING ungraded>0 OR (missing>0 AND a.due_at>UTC_TIMESTAMP()-INTERVAL 30 DAY) ORDER BY a.due_at LIMIT 8`, u.School, u.ID, u.ID)
	} else if a.hasVIP(ctx, u.School, u.ID, false) {
		tasks, err = a.workspaceRows(ctx, `SELECT a.id,a.course_id,a.title,a.due_at,c.title AS course FROM academy_assignments a JOIN academy_courses c ON c.id=a.course_id AND c.school_id=a.school_id LEFT JOIN courses academic ON academic.id=c.academic_course_id AND academic.school_id=c.school_id WHERE a.school_id=? AND c.published=TRUE AND a.due_at>UTC_TIMESTAMP()-INTERVAL 7 DAY AND (c.academic_course_id IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.class_id=academic.class_id AND e.user_id=?)) AND NOT EXISTS(SELECT 1 FROM academy_submissions s WHERE s.school_id=a.school_id AND s.assignment_id=a.id AND s.user_id=?) ORDER BY a.due_at LIMIT 8`, u.School, u.ID, u.ID)
	}
	if err != nil {
		problem(w, 503, "Chưa tải được việc cần làm")
		return
	}
	if u.Role == "student" {
		resume, err = a.workspaceRows(ctx, `SELECT l.id AS lesson_id,l.course_id,l.title,c.title AS course,p.seconds,l.duration_seconds FROM academy_progress p JOIN academy_lessons l ON l.id=p.lesson_id AND l.school_id=p.school_id JOIN academy_courses c ON c.id=l.course_id AND c.school_id=l.school_id WHERE p.school_id=? AND p.user_id=? AND p.completed=FALSE AND p.seconds>0 AND p.seconds<l.duration_seconds AND l.status='ready' AND c.published=TRUE ORDER BY p.updated_at DESC LIMIT 4`, u.School, u.ID)
		if err != nil {
			problem(w, 503, "Chưa tải được bài xem dở")
			return
		}
	}
	send(w, 200, map[string]any{"meetings": meetings, "tasks": tasks, "resume": resume})
}
