package main

import (
	"context"
	"database/sql"
	"net/http"
)

// Historical access follows the lesson roster, never today's enrolment alone.
const lessonAccess = `c.school_id=? AND (?='admin' OR (?='teacher' AND EXISTS(SELECT 1 FROM users assigned WHERE assigned.school_id=c.school_id AND assigned.id=? AND (assigned.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=assigned.id) OR (m.status='ended' AND EXISTS(SELECT 1 FROM lesson_staff ls WHERE ls.school_id=m.school_id AND ls.meeting_id=m.id AND ls.user_id=assigned.id))))) OR (?='student' AND EXISTS(SELECT 1 FROM users learner WHERE learner.school_id=c.school_id AND learner.id=? AND ((m.status='ended' AND (EXISTS(SELECT 1 FROM lesson_roster lr WHERE lr.school_id=m.school_id AND lr.meeting_id=m.id AND lr.user_id=learner.id) OR (NOT EXISTS(SELECT 1 FROM lesson_history lh WHERE lh.school_id=m.school_id AND lh.meeting_id=m.id) AND EXISTS(SELECT 1 FROM enrollments en WHERE en.school_id=c.school_id AND en.class_id=c.class_id AND en.user_id=learner.id)))) OR (m.status<>'ended' AND EXISTS(SELECT 1 FROM enrollments en WHERE en.school_id=c.school_id AND en.class_id=c.class_id AND en.user_id=learner.id))))))`

func snapshotLesson(ctx context.Context, tx *sql.Tx, school, meeting string) error {
	queries := []string{
		`INSERT IGNORE INTO lesson_history(school_id,meeting_id,legacy,term_id) SELECT m.school_id,m.id,FALSE,ct.term_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id LEFT JOIN class_terms ct ON ct.school_id=c.school_id AND ct.class_id=c.class_id WHERE m.school_id=? AND m.id=?`,
		`INSERT IGNORE INTO lesson_roster(school_id,meeting_id,user_id) SELECT m.school_id,m.id,en.user_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN enrollments en ON en.school_id=c.school_id AND en.class_id=c.class_id JOIN users u ON u.school_id=en.school_id AND u.id=en.user_id AND u.role='student' AND u.active=TRUE WHERE m.school_id=? AND m.id=?`,
		`INSERT IGNORE INTO lesson_staff(school_id,meeting_id,user_id) SELECT m.school_id,m.id,c.teacher_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE m.school_id=? AND m.id=? AND c.teacher_id IS NOT NULL`,
		`INSERT IGNORE INTO lesson_staff(school_id,meeting_id,user_id) SELECT m.school_id,m.id,ca.user_id FROM meetings m JOIN course_assistants ca ON ca.school_id=m.school_id AND ca.course_id=m.course_id WHERE m.school_id=? AND m.id=?`,
	}
	for _, q := range queries {
		if _, e := tx.ExecContext(ctx, q, school, meeting); e != nil {
			return e
		}
	}
	return nil
}

func migrateAcademicHistory(c *sql.Conn) error {
	ctx := context.Background()
	var n int
	if e := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version=20").Scan(&n); e != nil {
		return e
	}
	if n > 0 {
		return nil
	}
	// Old records cannot reveal past roster changes. Mark reconstructed history explicitly.
	for _, q := range []string{
		`INSERT IGNORE INTO lesson_history(school_id,meeting_id,legacy) SELECT school_id,id,TRUE FROM meetings WHERE status IN ('live','ended')`,
		`INSERT IGNORE INTO lesson_roster(school_id,meeting_id,user_id) SELECT m.school_id,m.id,en.user_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id JOIN enrollments en ON en.school_id=c.school_id AND en.class_id=c.class_id WHERE m.status IN ('live','ended')`,
		`INSERT IGNORE INTO lesson_staff(school_id,meeting_id,user_id) SELECT m.school_id,m.id,COALESCE(tw.teacher_id,c.teacher_id) FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id LEFT JOIN meeting_teaching_windows tw ON tw.school_id=m.school_id AND tw.meeting_id=m.id WHERE m.status IN ('live','ended') AND COALESCE(tw.teacher_id,c.teacher_id) IS NOT NULL`,
		`INSERT IGNORE INTO schema_migrations VALUES(20)`,
	} {
		if _, e := c.ExecContext(ctx, q); e != nil {
			return e
		}
	}
	return nil
}

func syncLiveRoster(ctx context.Context, tx *sql.Tx, school, class, user string) error {
	_, e := tx.ExecContext(ctx, `INSERT IGNORE INTO lesson_roster(school_id,meeting_id,user_id) SELECT m.school_id,m.id,? FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE c.school_id=? AND c.class_id=? AND m.status='live' AND NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms b WHERE b.school_id=m.school_id AND b.meeting_id=m.id)`, user, school, class)
	return e
}

func (a *app) historicalCatalog(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, `SELECT DISTINCT c.id,c.name,c.class_id,cl.name AS class_name,COALESCE(t.name,'') AS teacher FROM courses c JOIN classes cl ON cl.school_id=c.school_id AND cl.id=c.class_id JOIN meetings m ON m.school_id=c.school_id AND m.course_id=c.id LEFT JOIN users t ON t.school_id=c.school_id AND t.id=c.teacher_id WHERE `+lessonAccess+` ORDER BY cl.name,c.name,c.id`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
}
