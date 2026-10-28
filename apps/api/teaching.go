package main

import (
	"database/sql"
	"net/http"
	"time"
)

// The meeting row is already locked by the caller. Preparing a room is not teaching.
func (a *app) startTeaching(tx *sql.Tx, r *http.Request, m meetingInfo, now time.Time) error {
	u := who(r)
	if u.Role != "teacher" {
		return nil
	}
	var assigned int
	if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM courses c WHERE c.school_id=? AND c.id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?))`, u.School, m.CourseID, u.ID, u.ID).Scan(&assigned); err != nil {
		return err
	}
	if assigned != 1 {
		return nil
	}
	if _, err := tx.ExecContext(r.Context(), `INSERT IGNORE INTO meeting_teaching_windows(school_id,meeting_id) VALUES(?,?)`, u.School, r.PathValue("id")); err != nil {
		return err
	}
	res, err := tx.ExecContext(r.Context(), `UPDATE meeting_teaching_windows SET started_at=?,teacher_id=? WHERE school_id=? AND meeting_id=? AND started_at IS NULL AND ended_at IS NULL`, now, u.ID, u.School, r.PathValue("id"))
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil
	}
	// Discard preparation time without refreshing anyone else's heartbeat lease.
	_, err = tx.ExecContext(r.Context(), `UPDATE presence SET seconds=0,joined_at=IF(online AND last_seen>=?-INTERVAL 45 SECOND,?,joined_at) WHERE school_id=? AND meeting_id=?`, now, now, u.School, r.PathValue("id"))
	return err
}

func teachingCredit(last, now time.Time, online bool, tracked bool, start, end sql.NullTime) int64 {
	if tracked && !start.Valid {
		return 0
	}
	// Check the original lease before clipping so a stale client cannot earn time.
	if credit(last, now, online) == 0 {
		return 0
	}
	if start.Valid && last.Before(start.Time) {
		last = start.Time
	}
	if end.Valid && now.After(end.Time) {
		now = end.Time
	}
	if now.Before(last) {
		return 0
	}
	return int64(now.Sub(last) / time.Second)
}

func teachingWindow(tx *sql.Tx, r *http.Request) (bool, sql.NullTime, sql.NullTime, error) {
	var start, end sql.NullTime
	err := tx.QueryRowContext(r.Context(), `SELECT started_at,ended_at FROM meeting_teaching_windows WHERE school_id=? AND meeting_id=?`, who(r).School, r.PathValue("id")).Scan(&start, &end)
	if err == sql.ErrNoRows {
		return false, start, end, nil
	}
	return err == nil, start, end, err
}

func (a *app) recordingTeachingGate(w http.ResponseWriter, r *http.Request) bool {
	var waiting int
	if e := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meeting_teaching_windows WHERE school_id=? AND meeting_id=? AND (started_at IS NULL OR ended_at IS NOT NULL)", who(r).School, r.PathValue("id")).Scan(&waiting); e != nil {
		problem(w, 503, "Chưa đọc được mốc giảng dạy")
		return false
	}
	if waiting > 0 {
		problem(w, 409, "Ghi hình bắt đầu khi giáo viên đã vào dạy và dừng khi kết thúc lớp")
		return false
	}
	return true
}
