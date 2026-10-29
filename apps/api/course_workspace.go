package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"math/big"
	"net/http"
	"regexp"
	"time"
)

func shortRoomCode() (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 6)
	for i := range out {
		n, e := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if e != nil {
			return "", e
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out), nil
}
func (a *app) meetingCode(ctx context.Context, school, id string) (string, error) {
	for attempt := 0; attempt < 32; attempt++ {
		var code string
		e := a.db.QueryRowContext(ctx, "SELECT code FROM meeting_links WHERE school_id=? AND meeting_id=?", school, id).Scan(&code)
		if e == nil {
			return code, nil
		}
		if e != sql.ErrNoRows {
			return "", e
		}
		code, e = shortRoomCode()
		if code == "assets" || code == "health" {
			continue
		}
		if e != nil {
			return "", e
		}
		if _, e = a.db.ExecContext(ctx, "INSERT IGNORE INTO meeting_links(code,school_id,meeting_id) VALUES(?,?,?)", code, school, id); e != nil {
			return "", e
		}
	}
	return "", errors.New("short room link unavailable")
}
func (a *app) resolveRoom(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	if !regexp.MustCompile(`^[a-z0-9]{6}$`).MatchString(code) {
		problem(w, 404, "Không tìm thấy phòng học")
		return
	}
	var id string
	if a.db.QueryRowContext(r.Context(), "SELECT meeting_id FROM meeting_links WHERE school_id=? AND code=?", who(r).School, code).Scan(&id) != nil {
		problem(w, 404, "Không tìm thấy phòng học")
		return
	}
	r.SetPathValue("id", id)
	a.roomState(w, r)
}

// Preparing is idempotent per course; students see the scheduled lesson on the next refresh.
func (a *app) prepareCourse(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role == "student" {
		problem(w, 403, "Chỉ giáo viên được chuẩn bị dạy")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	var name string
	if tx.QueryRowContext(r.Context(), "SELECT c.name FROM courses c WHERE c.id=? AND "+courseAccess+" FOR UPDATE", r.PathValue("id"), u.School, u.Role, u.Role, u.ID, u.Role, u.ID).Scan(&name) != nil {
		problem(w, 404, "Không tìm thấy môn đã phân công")
		return
	}
	if e = a.lockActiveClass(tx, r, r.PathValue("id")); e != nil {
		problem(w, 409, "Lớp đã ngưng hoặc đã xóa; không thể chuẩn bị dạy")
		return
	}
	var id string
	e = tx.QueryRowContext(r.Context(), "SELECT id FROM meetings WHERE NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=meetings.school_id AND bx.meeting_id=meetings.id) AND school_id=? AND course_id=? AND (status='live' OR (status='scheduled' AND starts_at BETWEEN UTC_TIMESTAMP()-INTERVAL 2 HOUR AND UTC_TIMESTAMP()+INTERVAL 30 MINUTE)) ORDER BY (status='live') DESC,starts_at ASC LIMIT 1", u.School, r.PathValue("id")).Scan(&id)
	if e == sql.ErrNoRows {
		id = uid()
		_, e = tx.ExecContext(r.Context(), "INSERT INTO meetings(id,school_id,course_id,title,starts_at,recording_allowed) VALUES(?,?,?,?,?,TRUE)", id, u.School, r.PathValue("id"), name, time.Now().UTC())
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa chuẩn bị được buổi học")
		return
	}
	code, e := a.meetingCode(r.Context(), u.School, id)
	if e != nil {
		problem(w, 503, "Chưa tạo được liên kết phòng")
		return
	}
	a.audit(r, "course.prepare", r.PathValue("id"))
	r.SetPathValue("id", id)
	// Return the same authorized metadata consumed by the room, including stable short code.
	_ = code
	a.roomState(w, r)
}
