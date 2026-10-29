package main

import (
	"database/sql"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const mainLessonSQL = `NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=m.school_id AND bx.meeting_id=m.id)`

func (a *app) breakoutParent(r *http.Request) (string, error) {
	var id string
	e := a.db.QueryRowContext(r.Context(), `SELECT b.parent_id FROM meeting_breakout_rooms br JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id WHERE br.school_id=? AND br.meeting_id=?`, who(r).School, r.PathValue("id")).Scan(&id)
	if e == sql.ErrNoRows {
		return "", nil
	}
	return id, e
}

// Children are real, independent media/chat/drawing rooms. A shared course does not grant admission.
func (a *app) breakoutAccess(r *http.Request, host bool) bool {
	u := who(r)
	var parent, status, live, current string
	var lobby bool
	var member string
	e := a.db.QueryRowContext(r.Context(), `SELECT b.parent_id,b.status,p.status,COALESCE(bm.current_room_id,''),COALESCE(rs.lobby,FALSE),COALESCE(rm.state,'') FROM meeting_breakout_rooms br JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id JOIN meetings p ON p.school_id=b.school_id AND p.id=b.parent_id LEFT JOIN meeting_breakout_members bm ON bm.school_id=b.school_id AND bm.round_id=b.id AND bm.user_id=? LEFT JOIN room_settings rs ON rs.school_id=p.school_id AND rs.meeting_id=p.id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.id AND rm.user_id=? WHERE br.school_id=? AND br.meeting_id=?`, u.ID, u.ID, u.School, r.PathValue("id")).Scan(&parent, &status, &live, &current, &lobby, &member)
	if e == sql.ErrNoRows {
		return true
	}
	return e == nil && status == "active" && live == "live" && current == r.PathValue("id") && member != "removed" && member != "denied" && (host || !lobby || member == "admitted")
}
func (a *app) breakoutMainMedia(w http.ResponseWriter, r *http.Request) bool {
	var n int
	e := a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_members bm JOIN meeting_breakout_rounds b ON b.school_id=bm.school_id AND b.id=bm.round_id WHERE b.school_id=? AND b.parent_id=? AND b.status='active' AND bm.user_id=? AND bm.current_room_id IS NOT NULL`, who(r).School, r.PathValue("id"), who(r).ID).Scan(&n)
	if e != nil {
		problem(w, 503, "Chưa kiểm tra được phòng nhóm")
		return false
	}
	if n > 0 {
		problem(w, 409, "Bạn đang ở phòng nhóm; quay về phòng chính trước")
		return false
	}
	return true
}
func closeBreakoutsTx(tx *sql.Tx, r *http.Request, parent string) error {
	u := who(r)
	for _, q := range []string{
		`DELETE p FROM publications p JOIN meeting_breakout_rooms br ON br.school_id=p.school_id AND br.meeting_id=p.meeting_id JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id WHERE b.school_id=? AND b.parent_id=?`,
		`UPDATE presence p JOIN meeting_breakout_rooms br ON br.school_id=p.school_id AND br.meeting_id=p.meeting_id JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id SET p.online=FALSE WHERE b.school_id=? AND b.parent_id=?`,
		`UPDATE meetings m JOIN meeting_breakout_rooms br ON br.school_id=m.school_id AND br.meeting_id=m.id JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id SET m.status='ended' WHERE b.school_id=? AND b.parent_id=?`,
		`UPDATE meeting_breakout_rounds SET status='closed',revision=revision+1 WHERE school_id=? AND parent_id=? AND status<>'closed'`,
	} {
		if _, e := tx.ExecContext(r.Context(), q, u.School, parent); e != nil {
			return e
		}
	}
	return nil
}
func (a *app) breakoutSnapshot(w http.ResponseWriter, r *http.Request, host bool) {
	u := who(r)
	id := r.PathValue("id")
	var round, status string
	var rev int
	e := a.db.QueryRowContext(r.Context(), `SELECT id,status,revision FROM meeting_breakout_rounds WHERE school_id=? AND parent_id=? ORDER BY created_at DESC,id DESC LIMIT 1`, u.School, id).Scan(&round, &status, &rev)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được phòng nhóm")
		return
	}
	rooms, e := a.workspaceRows(r.Context(), `SELECT m.id,m.title AS name FROM meeting_breakout_rooms br JOIN meetings m ON m.school_id=br.school_id AND m.id=br.meeting_id LEFT JOIN meeting_breakout_members bm ON bm.school_id=br.school_id AND bm.round_id=br.round_id AND bm.user_id=? WHERE br.school_id=? AND br.round_id=? AND (? OR bm.room_id=m.id OR bm.current_room_id=m.id) ORDER BY br.position,m.id`, u.ID, u.School, round, host)
	if e != nil {
		problem(w, 503, "Chưa tải được phòng nhóm")
		return
	}
	people := []map[string]any{}
	if host {
		people, e = a.workspaceRows(r.Context(), `SELECT u.id,u.name,u.role,COALESCE(bm.room_id,'') AS room_id,COALESCE(bm.current_room_id,'') AS current_room_id FROM presence p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id LEFT JOIN meeting_breakout_members bm ON bm.school_id=p.school_id AND bm.round_id=? AND bm.user_id=p.user_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND u.active=TRUE AND COALESCE(rm.state,'') NOT IN ('denied','removed') ORDER BY u.name LIMIT 200`, round, u.School, id)
		if e != nil {
			problem(w, 503, "Chưa tải được thành viên")
			return
		}
	}
	var assigned, current string
	e = a.db.QueryRowContext(r.Context(), `SELECT COALESCE(room_id,''),COALESCE(current_room_id,'') FROM meeting_breakout_members WHERE school_id=? AND round_id=? AND user_id=?`, u.School, round, u.ID).Scan(&assigned, &current)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được phân nhóm")
		return
	}
	if status != "active" {
		current = ""
	}
	send(w, 200, map[string]any{"round_id": round, "status": status, "revision": rev, "rooms": rooms, "participants": people, "assigned_room_id": assigned, "current_room_id": current, "can_manage": host, "parent_id": id})
}
func (a *app) breakouts(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	p, e := a.breakoutParent(r)
	if e != nil {
		problem(w, 503, "Không đọc được phòng")
		return
	}
	if p != "" {
		problem(w, 400, "Quản lý nhóm tại phòng chính")
		return
	}
	if !a.roomGate(w, r) {
		return
	}
	host := a.roomHost(r, m)
	if r.Method == "GET" {
		a.breakoutSnapshot(w, r, host)
		return
	}
	var in struct {
		Action   string   `json:"action"`
		Count    int      `json:"count"`
		Room     string   `json:"room_id"`
		Name     string   `json:"name"`
		Revision int      `json:"revision"`
		Users    []string `json:"users"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Action == "join" {
		a.joinBreakout(w, r, in.Room, host)
		return
	}
	if !host {
		problem(w, 403, "Chỉ người điều hành được chia nhóm")
		return
	}
	if m.Status != "live" || !a.liveMember(r) {
		problem(w, 409, "Vào phòng chính trước khi chia nhóm")
		return
	}
	u := who(r)
	parent := r.PathValue("id")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Không lưu được phòng nhóm")
		return
	}
	defer tx.Rollback()
	var course string
	if e = tx.QueryRowContext(r.Context(), `SELECT c.id FROM courses c JOIN meetings m ON m.school_id=c.school_id AND m.course_id=c.id WHERE m.school_id=? AND m.id=? FOR UPDATE`, u.School, parent).Scan(&course); e != nil {
		problem(w, 404, "Không tìm thấy buổi học")
		return
	}
	var live string
	if tx.QueryRowContext(r.Context(), `SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE`, u.School, parent).Scan(&live) != nil || live != "live" {
		problem(w, 409, "Buổi học đã kết thúc")
		return
	}
	// Assignment may have changed while waiting for the course lock.
	var assigned int
	if u.Role != "admin" && (tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM courses c WHERE c.school_id=? AND c.id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?))`, u.School, course, u.ID, u.ID).Scan(&assigned) != nil || assigned != 1) {
		problem(w, 403, "Phân công đã thay đổi")
		return
	}
	var round, status string
	var rev int
	e = tx.QueryRowContext(r.Context(), `SELECT id,status,revision FROM meeting_breakout_rounds WHERE school_id=? AND parent_id=? ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, u.School, parent).Scan(&round, &status, &rev)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Không đọc được lượt nhóm")
		return
	}
	fail := func(err error) bool {
		if err != nil {
			problem(w, 503, "Không lưu được phòng nhóm")
			return true
		}
		return false
	}
	add := func(name string) error {
		var position int
		if e := tx.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(position),0)+1 FROM meeting_breakout_rooms WHERE school_id=? AND round_id=?`, u.School, round).Scan(&position); e != nil {
			return e
		}
		if name == "" {
			name = fmt.Sprintf("Nhóm %d", position)
		}
		child := uid()
		_, e := tx.ExecContext(r.Context(), `INSERT INTO meetings(id,school_id,course_id,title,starts_at,recording_allowed) VALUES(?,?,?,?,UTC_TIMESTAMP(6),FALSE)`, child, u.School, course, name)
		if e != nil {
			return e
		}
		_, e = tx.ExecContext(r.Context(), `INSERT INTO meeting_breakout_rooms(school_id,round_id,meeting_id,position) VALUES(?,?,?,?)`, u.School, round, child, position)
		return e
	}
	if in.Action == "create" {
		if round != "" && status != "closed" {
			problem(w, 409, "Đã có lượt nhóm; tải lại để chỉnh sửa")
			return
		}
		if in.Count < 2 || in.Count > 20 {
			problem(w, 400, "Chọn từ 2 đến 20 phòng nhóm")
			return
		}
		round = uid()
		_, e = tx.ExecContext(r.Context(), `INSERT INTO meeting_breakout_rounds(id,school_id,parent_id) VALUES(?,?,?)`, round, u.School, parent)
		if fail(e) {
			return
		}
		for n := 1; n <= in.Count; n++ {
			if fail(add(fmt.Sprintf("Nhóm %d", n))) {
				return
			}
		}
	} else {
		if round == "" || status == "closed" || rev != in.Revision {
			problem(w, 409, "Lượt nhóm đã thay đổi; tải lại trước khi lưu")
			return
		}
		if in.Action == "close" {
			if fail(closeBreakoutsTx(tx, r, parent)) {
				return
			}
		} else {
			if status != "draft" {
				problem(w, 409, "Đóng lượt nhóm trước khi chỉnh phân công")
				return
			}
			switch in.Action {
			case "add":
				var n int
				if fail(tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_rooms WHERE school_id=? AND round_id=?`, u.School, round).Scan(&n)) {
					return
				}
				if n >= 20 {
					problem(w, 400, "Tối đa 20 phòng nhóm")
					return
				}
				if fail(add("")) {
					return
				}
			case "rename", "delete":
				var count int
				if fail(tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_rooms WHERE school_id=? AND round_id=? AND meeting_id=?`, u.School, round, in.Room).Scan(&count)) {
					return
				}
				if count != 1 {
					problem(w, 404, "Không tìm thấy nhóm")
					return
				}
				if in.Action == "rename" {
					name := strings.TrimSpace(in.Name)
					if name == "" || utf8.RuneCountInString(name) > 80 {
						problem(w, 400, "Tên nhóm từ 1 đến 80 ký tự")
						return
					}
					_, e = tx.ExecContext(r.Context(), `UPDATE meetings SET title=? WHERE school_id=? AND id=?`, name, u.School, in.Room)
					if fail(e) {
						return
					}
				} else {
					for _, q := range []string{`UPDATE meeting_breakout_members SET room_id=NULL WHERE school_id=? AND round_id=? AND room_id=?`, `DELETE FROM meeting_breakout_rooms WHERE school_id=? AND round_id=? AND meeting_id=?`} {
						_, e = tx.ExecContext(r.Context(), q, u.School, round, in.Room)
						if fail(e) {
							return
						}
					}
					_, e = tx.ExecContext(r.Context(), `DELETE FROM meetings WHERE school_id=? AND id=?`, u.School, in.Room)
					if fail(e) {
						return
					}
				}
			case "assign":
				if len(in.Users) < 1 || len(in.Users) > 200 {
					problem(w, 400, "Chọn từ 1 đến 200 người")
					return
				}
				if in.Room != "" {
					var n int
					if fail(tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_rooms WHERE school_id=? AND round_id=? AND meeting_id=?`, u.School, round, in.Room).Scan(&n)) {
						return
					}
					if n != 1 {
						problem(w, 404, "Không tìm thấy nhóm")
						return
					}
				}
				for _, user := range in.Users {
					var n int
					if fail(tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM presence p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.user_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND u.active=TRUE AND COALESCE(rm.state,'') NOT IN ('denied','removed')`, u.School, parent, user).Scan(&n)) {
						return
					}
					if n != 1 {
						problem(w, 409, "Có thành viên đã rời lớp; tải lại danh sách")
						return
					}
					_, e = tx.ExecContext(r.Context(), `INSERT INTO meeting_breakout_members(school_id,round_id,user_id,room_id) VALUES(?,?,?,NULLIF(?,'')) ON DUPLICATE KEY UPDATE room_id=VALUES(room_id)`, u.School, round, user, in.Room)
					if fail(e) {
						return
					}
				}
			case "shuffle":
				rows, e := tx.QueryContext(r.Context(), `SELECT meeting_id FROM meeting_breakout_rooms WHERE school_id=? AND round_id=? ORDER BY position`, u.School, round)
				if fail(e) {
					return
				}
				ids := []string{}
				for rows.Next() {
					var id string
					if e = rows.Scan(&id); e != nil {
						break
					}
					ids = append(ids, id)
				}
				if e == nil {
					e = rows.Err()
				}
				rows.Close()
				if fail(e) {
					return
				}
				if len(ids) < 2 {
					problem(w, 400, "Cần ít nhất 2 nhóm")
					return
				}
				rows, e = tx.QueryContext(r.Context(), `SELECT p.user_id FROM presence p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND u.role='student' AND u.active=TRUE AND COALESCE(rm.state,'') NOT IN ('denied','removed') ORDER BY p.user_id LIMIT 200`, u.School, parent)
				if fail(e) {
					return
				}
				users := []string{}
				for rows.Next() {
					var id string
					if e = rows.Scan(&id); e != nil {
						break
					}
					users = append(users, id)
				}
				if e == nil {
					e = rows.Err()
				}
				rows.Close()
				if fail(e) {
					return
				}
				rand.Shuffle(len(users), func(i, j int) { users[i], users[j] = users[j], users[i] })
				for i, user := range users {
					_, e = tx.ExecContext(r.Context(), `INSERT INTO meeting_breakout_members(school_id,round_id,user_id,room_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE room_id=VALUES(room_id)`, u.School, round, user, ids[i%len(ids)])
					if fail(e) {
						return
					}
				}
			case "start":
				var n int
				if fail(tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_rooms WHERE school_id=? AND round_id=?`, u.School, round).Scan(&n)) {
					return
				}
				if n < 2 || n > 20 {
					problem(w, 400, "Cần từ 2 đến 20 nhóm")
					return
				}
				_, e = tx.ExecContext(r.Context(), `INSERT INTO room_settings(school_id,meeting_id,lobby,chat_enabled,present_enabled) SELECT br.school_id,br.meeting_id,FALSE,COALESCE(rs.chat_enabled,TRUE),COALESCE(rs.present_enabled,TRUE) FROM meeting_breakout_rooms br JOIN meeting_breakout_rounds b ON b.school_id=br.school_id AND b.id=br.round_id LEFT JOIN room_settings rs ON rs.school_id=b.school_id AND rs.meeting_id=b.parent_id WHERE br.school_id=? AND br.round_id=?`, u.School, round)
				if fail(e) {
					return
				}
				_, e = tx.ExecContext(r.Context(), `UPDATE meetings m JOIN meeting_breakout_rooms br ON br.school_id=m.school_id AND br.meeting_id=m.id SET m.status='live' WHERE br.school_id=? AND br.round_id=?`, u.School, round)
				if fail(e) {
					return
				}
				_, e = tx.ExecContext(r.Context(), `INSERT IGNORE INTO meeting_teaching_windows(school_id,meeting_id) SELECT school_id,meeting_id FROM meeting_breakout_rooms WHERE school_id=? AND round_id=?`, u.School, round)
				if fail(e) {
					return
				}
				_, e = tx.ExecContext(r.Context(), `UPDATE meeting_breakout_rounds SET status='active' WHERE school_id=? AND id=?`, u.School, round)
				if fail(e) {
					return
				}
			default:
				problem(w, 400, "Thao tác phòng nhóm không hợp lệ")
				return
			}
			_, e = tx.ExecContext(r.Context(), `UPDATE meeting_breakout_rounds SET revision=revision+1 WHERE school_id=? AND id=?`, u.School, round)
			if fail(e) {
				return
			}
		}
	}
	if fail(tx.Commit()) {
		return
	}
	a.audit(r, "breakout."+in.Action, parent)
	a.breakoutSnapshot(w, r, host)
}

// Close the old transport before changing membership: knowing another group's track ID must never bridge rooms.
func (a *app) joinBreakout(w http.ResponseWriter, r *http.Request, target string, host bool) {
	u := who(r)
	parent := r.PathValue("id")
	nonce := uid()
	key := "breakout-move:" + u.School + ":" + parent + ":" + u.ID
	got, e := a.cache.SetNX(r.Context(), key, nonce, 120*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Đang chuyển phòng, chờ hoàn tất")
		return
	}
	defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{key}, nonce)
	var round, status, old string
	e = a.db.QueryRowContext(r.Context(), `SELECT b.id,b.status,COALESCE(bm.current_room_id,'') FROM meeting_breakout_rounds b LEFT JOIN meeting_breakout_members bm ON bm.school_id=b.school_id AND bm.round_id=b.id AND bm.user_id=? WHERE b.school_id=? AND b.parent_id=? ORDER BY b.created_at DESC,b.id DESC LIMIT 1`, u.ID, u.School, parent).Scan(&round, &status, &old)
	if e != nil {
		problem(w, 404, "Không tìm thấy lượt nhóm")
		return
	}
	if target != "" {
		var n int
		e = a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM meeting_breakout_rooms br JOIN meetings m ON m.school_id=br.school_id AND m.id=br.meeting_id LEFT JOIN meeting_breakout_members bm ON bm.school_id=br.school_id AND bm.round_id=br.round_id AND bm.user_id=? WHERE br.school_id=? AND br.round_id=? AND br.meeting_id=? AND m.status='live' AND (? OR bm.room_id=br.meeting_id)`, u.ID, u.School, round, target, host).Scan(&n)
		if e != nil || n != 1 || status != "active" {
			problem(w, 403, "Bạn chưa được phân công vào nhóm này")
			return
		}
		if !a.liveMember(r) {
			problem(w, 409, "Vào buổi học trước khi chuyển nhóm")
			return
		}
	}
	if old == target {
		send(w, 200, map[string]any{"meeting_id": parentIfEmpty(target, parent)})
		return
	}
	previous := parentIfEmpty(old, parent)
	lock := "sfu-lock:" + u.School + ":" + u.ID + ":" + previous
	got, e = a.cache.SetNX(r.Context(), lock, nonce, 120*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Media đang kết nối; thử chuyển nhóm lại sau")
		return
	}
	defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
	rows, e := a.db.QueryContext(r.Context(), `SELECT id FROM media_sessions WHERE school_id=? AND meeting_id=? AND user_id=?`, u.School, previous, u.ID)
	if e != nil {
		problem(w, 503, "Không đọc được phiên gọi")
		return
	}
	sessions := []string{}
	for rows.Next() {
		var sid string
		if e = rows.Scan(&sid); e != nil {
			break
		}
		sessions = append(sessions, sid)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		problem(w, 503, "Không đọc được phiên gọi")
		return
	}
	for _, sid := range sessions {
		if a.cache.SetNX(r.Context(), "media-retired:"+sid, time.Now().Unix(), 0).Err() != nil {
			problem(w, 503, "Không thu hồi được media cũ")
			return
		}
	}
	for _, sid := range sessions {
		if e = a.closeSFUSession(r.Context(), u.School, previous, sid); e != nil {
			problem(w, 503, "Chưa đóng được kết nối phòng cũ; vẫn giữ phòng hiện tại, thử lại sau")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Không chuyển được phòng")
		return
	}
	defer tx.Rollback()
	var currentStatus string
	if tx.QueryRowContext(r.Context(), `SELECT status FROM meeting_breakout_rounds WHERE school_id=? AND id=? FOR UPDATE`, u.School, round).Scan(&currentStatus) != nil || (target != "" && currentStatus != "active") {
		problem(w, 409, "Lượt nhóm đã đóng; quay lại phòng chính")
		return
	}
	if _, e = tx.ExecContext(r.Context(), `DELETE FROM publications WHERE school_id=? AND meeting_id=? AND user_id=?`, u.School, previous, u.ID); e != nil {
		problem(w, 503, "Không thu hồi được media cũ")
		return
	}
	if old != "" {
		if _, e = tx.ExecContext(r.Context(), `UPDATE presence SET online=FALSE WHERE school_id=? AND meeting_id=? AND user_id=?`, u.School, old, u.ID); e != nil {
			problem(w, 503, "Không cập nhật được phòng cũ")
			return
		}
	}
	_, e = tx.ExecContext(r.Context(), `INSERT INTO meeting_breakout_members(school_id,round_id,user_id,current_room_id) VALUES(?,?,?,NULLIF(?,'')) ON DUPLICATE KEY UPDATE current_room_id=VALUES(current_room_id)`, u.School, round, u.ID, target)
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Không lưu được phòng mới")
		return
	}
	a.audit(r, "breakout.join", parent)
	send(w, 200, map[string]any{"meeting_id": parentIfEmpty(target, parent)})
}
func parentIfEmpty(child, parent string) string {
	if child == "" {
		return parent
	}
	return child
}
