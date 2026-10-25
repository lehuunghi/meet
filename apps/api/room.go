package main

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (a *app) roomParticipants(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	a.query(w, r, `SELECT u.id,u.short_id,u.name,u.role,COALESCE(h.raised,FALSE) AS hand_raised FROM presence p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id LEFT JOIN meeting_hands h ON h.school_id=p.school_id AND h.meeting_id=p.meeting_id AND h.user_id=p.user_id JOIN meetings m ON m.school_id=p.school_id AND m.id=p.meeting_id WHERE p.school_id=? AND p.meeting_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND m.status='live' ORDER BY hand_raised DESC,u.name LIMIT 200`, u.School, r.PathValue("id"))
}
func (a *app) liveMember(r *http.Request) bool {
	u := who(r)
	var n int
	return a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM presence p JOIN meetings m ON m.school_id=p.school_id AND m.id=p.meeting_id WHERE p.school_id=? AND p.meeting_id=? AND p.user_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND m.status='live'", u.School, r.PathValue("id"), u.ID).Scan(&n) == nil && n == 1
}
func (a *app) roomMessages(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	after := int64(0)
	if raw := r.URL.Query().Get("after"); raw != "" {
		var e error
		after, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || after < 0 {
			problem(w, 400, "Invalid cursor")
			return
		}
	}
	a.query(w, r, "SELECT m.id,m.user_id,u.name,m.content,m.created_at FROM meeting_messages m JOIN users u ON u.school_id=m.school_id AND u.id=m.user_id WHERE m.school_id=? AND m.meeting_id=? AND m.id>? ORDER BY m.id LIMIT 100", who(r).School, r.PathValue("id"), after)
}
func (a *app) sendMessage(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	rules, _, _, err := a.roomView(r)
	if err != nil {
		problem(w, 503, "Không đọc được quyền trò chuyện")
		return
	}
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if !rules.Chat && !a.roomHost(r, m) {
		problem(w, 403, "Giáo viên đã tắt gửi tin nhắn")
		return
	}
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	if !a.liveMember(r) {
		problem(w, 409, "Tham gia buổi live trước khi gửi tin nhắn")
		return
	}
	var in struct {
		Content string `json:"content"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Content = strings.TrimSpace(in.Content)
	if in.Content == "" || utf8.RuneCountInString(in.Content) > 2000 {
		problem(w, 400, "Tin nhắn từ 1–2000 ký tự")
		return
	}
	u := who(r)
	n, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],5) end;return n`, []string{"chat:" + u.School + ":" + u.ID + ":" + r.PathValue("id")}).Int()
	if e != nil || n > 10 {
		problem(w, 429, "Gửi chậm lại")
		return
	}
	res, e := a.db.ExecContext(r.Context(), `INSERT INTO meeting_messages(school_id,meeting_id,user_id,content) SELECT ?,?,?,? FROM meetings m JOIN presence p ON p.school_id=m.school_id AND p.meeting_id=m.id AND p.user_id=? LEFT JOIN room_settings s ON s.school_id=m.school_id AND s.meeting_id=m.id LEFT JOIN room_members rm ON rm.school_id=m.school_id AND rm.meeting_id=m.id AND rm.user_id=p.user_id WHERE m.school_id=? AND m.id=? AND m.status='live' AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND COALESCE(rm.state,'') NOT IN ('removed','denied') AND (? OR (COALESCE(s.chat_enabled,TRUE)=TRUE AND (COALESCE(s.lobby,FALSE)=FALSE OR rm.state='admitted')))`, u.School, r.PathValue("id"), u.ID, in.Content, u.ID, u.School, r.PathValue("id"), a.roomHost(r, m))
	if e != nil {
		problem(w, 500, "Không gửi được tin nhắn")
		return
	}
	count, _ := res.RowsAffected()
	if count != 1 {
		problem(w, 409, "Buổi đã kết thúc")
		return
	}
	id, _ := res.LastInsertId()
	send(w, 201, map[string]int64{"id": id})
}
func (a *app) raiseHand(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	if !a.liveMember(r) {
		problem(w, 409, "Tham gia buổi live trước")
		return
	}
	var in struct {
		Raised bool `json:"raised"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	if _, e := a.db.ExecContext(r.Context(), "INSERT INTO meeting_hands(school_id,meeting_id,user_id,raised) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE raised=VALUES(raised)", u.School, r.PathValue("id"), u.ID, in.Raised); e != nil {
		problem(w, 500, "Không cập nhật được giơ tay")
		return
	}
	send(w, 200, map[string]bool{"raised": in.Raised})
}
