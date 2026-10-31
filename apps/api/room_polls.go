package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

type roomPoll struct {
	ID       string   `json:"id"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
	Active   bool     `json:"active"`
	Counts   []int    `json:"counts"`
	MyChoice int      `json:"my_choice"`
}

func (a *app) roomPolls(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !a.roomGate(w, r) {
		return
	}
	host := a.roomHost(r, m)
	if !host && !a.liveMember(r) {
		problem(w, 409, "Vào lớp trước khi xem khảo sát")
		return
	}
	u := who(r)
	id := r.PathValue("id")
	if r.Method == "GET" {
		rows, e := a.db.QueryContext(r.Context(), "SELECT id,question,choices,active FROM room_polls WHERE school_id=? AND meeting_id=? ORDER BY created_at DESC LIMIT 10", u.School, id)
		if e != nil {
			problem(w, 503, "Không đọc được khảo sát")
			return
		}
		out := []roomPoll{}
		positions := map[string]int{}
		for rows.Next() {
			var p roomPoll
			var raw []byte
			if rows.Scan(&p.ID, &p.Question, &raw, &p.Active) != nil || json.Unmarshal(raw, &p.Options) != nil {
				rows.Close()
				problem(w, 503, "Dữ liệu khảo sát lỗi")
				return
			}
			p.MyChoice = -1
			p.Counts = make([]int, len(p.Options))
			positions[p.ID] = len(out)
			out = append(out, p)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			problem(w, 503, "Không đọc được khảo sát")
			return
		}
		votes, e := a.db.QueryContext(r.Context(), "SELECT poll_id,choice,COUNT(*) FROM room_votes WHERE school_id=? AND meeting_id=? GROUP BY poll_id,choice", u.School, id)
		if e != nil {
			problem(w, 503, "Không đọc được kết quả")
			return
		}
		for votes.Next() {
			var poll string
			var choice, count int
			if votes.Scan(&poll, &choice, &count) != nil {
				votes.Close()
				problem(w, 503, "Không đọc được kết quả")
				return
			}
			if pos, ok := positions[poll]; ok && choice >= 0 && choice < len(out[pos].Counts) {
				out[pos].Counts[choice] = count
			}
		}
		e = votes.Err()
		votes.Close()
		if e != nil {
			problem(w, 503, "Không đọc được kết quả")
			return
		}
		mine, e := a.db.QueryContext(r.Context(), "SELECT poll_id,choice FROM room_votes WHERE school_id=? AND meeting_id=? AND user_id=?", u.School, id, u.ID)
		if e != nil {
			problem(w, 503, "Không đọc được lựa chọn")
			return
		}
		for mine.Next() {
			var poll string
			var choice int
			if mine.Scan(&poll, &choice) != nil {
				mine.Close()
				problem(w, 503, "Không đọc được lựa chọn")
				return
			}
			if pos, ok := positions[poll]; ok {
				out[pos].MyChoice = choice
			}
		}
		e = mine.Err()
		mine.Close()
		if e != nil {
			problem(w, 503, "Không đọc được lựa chọn")
			return
		}
		send(w, 200, out)
		return
	}
	if !host {
		problem(w, 403, "Chỉ người điều hành được tạo khảo sát")
		return
	}
	var in struct {
		Question string   `json:"question"`
		Options  []string `json:"options"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Question = strings.TrimSpace(in.Question)
	if in.Question == "" || utf8.RuneCountInString(in.Question) > 200 || len(in.Options) < 2 || len(in.Options) > 6 {
		problem(w, 400, "Câu hỏi tối đa 200 ký tự và 2–6 lựa chọn")
		return
	}
	seen := map[string]bool{}
	for i, v := range in.Options {
		v = strings.TrimSpace(v)
		if v == "" || utf8.RuneCountInString(v) > 100 || seen[strings.ToLower(v)] {
			problem(w, 400, "Lựa chọn phải khác nhau, từ 1–100 ký tự")
			return
		}
		seen[strings.ToLower(v)] = true
		in.Options[i] = v
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	if !lockLiveMeeting(w, r, tx, u.School, id) {
		return
	}
	var count int
	if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM room_polls WHERE school_id=? AND meeting_id=?", u.School, id).Scan(&count) != nil || count >= 10 {
		problem(w, 409, "Tối đa 10 khảo sát mỗi buổi")
		return
	}
	poll := uid()
	raw, _ := json.Marshal(in.Options)
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO room_polls(id,school_id,meeting_id,question,choices) VALUES(?,?,?,?,?)", poll, u.School, id, in.Question, string(raw)); e != nil {
		problem(w, 503, "Không lưu được khảo sát")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'room.poll.create',?)", u.School, u.ID, id+":"+poll); e != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được nhật ký")
		return
	}
	send(w, 201, map[string]string{"id": poll})
}
func lockLiveMeeting(w http.ResponseWriter, r *http.Request, tx *sql.Tx, school, id string) bool {
	var state string
	if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", school, id).Scan(&state) != nil || state != "live" {
		problem(w, 409, "Buổi không còn diễn ra")
		return false
	}
	return true
}
func (a *app) roomVote(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !a.roomGate(w, r) {
		return
	}
	u := who(r)
	id := r.PathValue("id")
	poll := r.PathValue("poll")
	var in struct {
		Action string `json:"action"`
		Choice int    `json:"choice"`
	}
	if !decode(w, r, &in) {
		return
	}
	host := a.roomHost(r, m)
	if in.Action != "vote" && in.Action != "close" {
		problem(w, 400, "Thao tác không hợp lệ")
		return
	}
	if (in.Action == "close" && !host) || (in.Action == "vote" && u.Role != "student") {
		problem(w, 403, "Không có quyền thực hiện")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	if !lockLiveMeeting(w, r, tx, u.School, id) {
		return
	}
	var raw []byte
	var active bool
	if tx.QueryRowContext(r.Context(), "SELECT choices,active FROM room_polls WHERE school_id=? AND meeting_id=? AND id=?", u.School, id, poll).Scan(&raw, &active) != nil {
		problem(w, 404, "Không tìm thấy khảo sát")
		return
	}
	if in.Action == "close" {
		if _, e = tx.ExecContext(r.Context(), "UPDATE room_polls SET active=FALSE WHERE school_id=? AND meeting_id=? AND id=?", u.School, id, poll); e != nil {
			problem(w, 503, "Không đóng được khảo sát")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'room.poll.close',?)", u.School, u.ID, id+":"+poll); e != nil || tx.Commit() != nil {
			problem(w, 503, "Không lưu được nhật ký")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	var options []string
	if !active {
		problem(w, 409, "Khảo sát đã đóng")
		return
	}
	if json.Unmarshal(raw, &options) != nil || in.Choice < 0 || in.Choice >= len(options) {
		problem(w, 400, "Lựa chọn không hợp lệ")
		return
	}
	var allowed int
	if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM presence p LEFT JOIN room_settings s ON s.school_id=p.school_id AND s.meeting_id=p.meeting_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.user_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND COALESCE(rm.state,'') NOT IN ('removed','denied') AND (COALESCE(s.lobby,FALSE)=FALSE OR rm.state='admitted')`, u.School, id, u.ID).Scan(&allowed) != nil || allowed != 1 {
		problem(w, 403, "Bạn chưa tham gia hoặc đã bị mời ra")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO room_votes(school_id,meeting_id,poll_id,user_id,choice) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE choice=VALUES(choice)", u.School, id, poll, u.ID, in.Choice); e != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được lựa chọn")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
