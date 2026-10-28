package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// Recording preference belongs to the lesson, not a particular browser.
func (a *app) controlRecording(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, true); !ok {
		return
	}
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Enabled == nil {
		problem(w, 400, "Cần chọn ghi hình hoặc không ghi hình")
		return
	}
	u := who(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Không lưu được ghi hình")
		return
	}
	defer tx.Rollback()
	var teacher sql.NullString
	// Same course lock order as meeting state changes and assignment edits.
	if tx.QueryRowContext(r.Context(), `SELECT c.teacher_id FROM courses c JOIN meetings m ON m.course_id=c.id AND m.school_id=c.school_id WHERE m.school_id=? AND m.id=? FOR UPDATE`, u.School, r.PathValue("id")).Scan(&teacher) != nil {
		problem(w, 404, "Không tìm thấy buổi học")
		return
	}
	if u.Role != "admin" && (!teacher.Valid || teacher.String != u.ID) {
		var n int
		if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM course_assistants ca JOIN meetings m ON m.school_id=ca.school_id AND m.course_id=ca.course_id WHERE m.school_id=? AND m.id=? AND ca.user_id=?`, u.School, r.PathValue("id"), u.ID).Scan(&n) != nil || n != 1 {
			problem(w, 403, "Phân công giáo viên đã thay đổi")
			return
		}
	}
	var status string
	var enabled bool
	if tx.QueryRowContext(r.Context(), "SELECT status,recording_allowed FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, r.PathValue("id")).Scan(&status, &enabled) != nil {
		problem(w, 404, "Không tìm thấy buổi học")
		return
	}
	if status == "ended" {
		problem(w, 409, "Buổi học đã kết thúc")
		return
	}
	if *in.Enabled && !enabled {
		n, err := a.cache.Exists(r.Context(), "server-recording-lease:"+u.School+":"+r.PathValue("id")).Result()
		if err != nil {
			problem(w, 503, "Chưa kiểm tra được bộ ghi hình")
			return
		}
		if n != 0 {
			problem(w, 409, "Đang hoàn tất bản ghi trước. Chờ lưu xong rồi ghi tiếp.")
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE meetings SET recording_allowed=? WHERE school_id=? AND id=?", *in.Enabled, u.School, r.PathValue("id")); e != nil {
		problem(w, 503, "Không lưu được ghi hình")
		return
	}
	if tx.Commit() != nil {
		problem(w, 503, "Không lưu được ghi hình")
		return
	}
	a.audit(r, "meeting.recording", r.PathValue("id"))
	send(w, 200, map[string]any{"recording_allowed": *in.Enabled})
}

// Status only: the isolated recorder owns media reception and R2 uploads.
// No recorder secrets or provider responses are returned to participants.
func (a *app) serverRecordingStatus(r *http.Request, enabled bool) map[string]any {
	if !enabled {
		if a.cache.Exists(r.Context(), "server-recording-lease:"+who(r).School+":"+r.PathValue("id")).Val() != 0 {
			return map[string]any{"state": "saving"}
		}
		return map[string]any{"state": "stopped"}
	}
	cfg, e := loadSettings()
	if e != nil || !cfg.R2.Enabled {
		return map[string]any{"state": "disabled"}
	}
	if a.cache.Exists(r.Context(), "server-recorder:seen").Val() == 0 {
		return map[string]any{"state": "unavailable"}
	}
	if seconds, _ := a.cache.Get(r.Context(), "server-recording-duration:"+who(r).School+":"+r.PathValue("id")).Int64(); seconds >= 8*3600 {
		return map[string]any{"state": "limit"}
	}
	raw, e := a.cache.Get(r.Context(), "server-recording:"+who(r).School+":"+r.PathValue("id")).Result()
	var status struct {
		State string `json:"state"`
		Seen  int64  `json:"seen"`
	}
	if e != nil || json.Unmarshal([]byte(raw), &status) != nil {
		return map[string]any{"state": "queued"}
	}
	if time.Now().Unix()-status.Seen > 30 && status.State != "complete" {
		return map[string]any{"state": "interrupted"}
	}
	switch status.State {
	case "starting", "recording", "waiting", "saving", "complete", "error", "interrupted", "limit":
		return map[string]any{"state": status.State}
	}
	return map[string]any{"state": "unavailable"}
}
