package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type drawPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type drawStroke struct {
	ID     string      `json:"id"`
	Owner  string      `json:"owner"`
	Kind   string      `json:"kind"`
	Color  string      `json:"color"`
	Width  int         `json:"width"`
	Points []drawPoint `json:"points"`
	Text   string      `json:"text"`
	Seq    int         `json:"seq"`
}
type drawPage struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Epoch   int          `json:"epoch"`
	Strokes []drawStroke `json:"strokes"`
	Deleted []string     `json:"deleted"`
}
type drawingState struct {
	Control int64                `json:"control_revision"`
	Active  bool                 `json:"active"`
	Mode    string               `json:"mode"`
	Target  string               `json:"target"`
	Page    string               `json:"page"`
	Allow   bool                 `json:"allow_students"`
	Pages   []drawPage           `json:"pages"`
	Screens map[string]*drawPage `json:"screens"`
}
type drawTarget struct {
	Key  string `json:"key"`
	User string `json:"user_id"`
	Name string `json:"name"`
}
type drawingInput struct {
	Action   string     `json:"action"`
	Context  string     `json:"context"`
	Epoch    int        `json:"epoch"`
	Revision int64      `json:"revision"`
	Target   string     `json:"target"`
	Page     string     `json:"page"`
	Allow    bool       `json:"allow_students"`
	Stroke   drawStroke `json:"stroke"`
	ID       string     `json:"id"`
}

func newDrawPage(id, name string) *drawPage {
	return &drawPage{ID: id, Name: name, Strokes: []drawStroke{}, Deleted: []string{}}
}
func newDrawingState() drawingState {
	return drawingState{Mode: "board", Page: "p1", Pages: []drawPage{*newDrawPage("p1", "Trang 1")}, Screens: map[string]*drawPage{}}
}
func (s *drawingState) current() (*drawPage, string) {
	if s.Mode == "screen" {
		return s.Screens[s.Target], "screen:" + s.Target
	}
	for i := range s.Pages {
		if s.Pages[i].ID == s.Page {
			return &s.Pages[i], "board:" + s.Page
		}
	}
	return nil, ""
}

var drawingID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,96}$`)

func validDrawStroke(v drawStroke) bool {
	if !drawingID.MatchString(v.ID) || v.Seq < 1 || v.Seq > 10000 || v.Width < 1 || v.Width > 16 || len(v.Points) < 1 || len(v.Points) > 1000 || len(v.Text) > 2000 {
		return false
	}
	if !strings.Contains("|#0B4ED8|#00C2E8|#FFAA1D|#FF4D4F|#162B49|#FFFFFF|#006F86|", "|"+v.Color+"|") {
		return false
	}
	switch v.Kind {
	case "pen", "marker", "line", "rect", "ellipse", "text":
	default:
		return false
	}
	if v.Kind == "text" && strings.TrimSpace(v.Text) == "" {
		return false
	}
	for _, p := range v.Points {
		if math.IsNaN(p.X) || math.IsNaN(p.Y) || math.IsInf(p.X, 0) || math.IsInf(p.Y, 0) || p.X < 0 || p.X > 1600 || p.Y < 0 || p.Y > 900 {
			return false
		}
	}
	return true
}
func (a *app) drawingTargets(ctx context.Context, school, meeting string) ([]drawTarget, error) {
	rows, e := a.db.QueryContext(ctx, `SELECT p.session_id,p.track_name,p.user_id,u.name FROM publications p JOIN users u ON u.school_id=p.school_id AND u.id=p.user_id JOIN presence pr ON pr.school_id=p.school_id AND pr.meeting_id=p.meeting_id AND pr.user_id=p.user_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.track_name LIKE 'screen-video-%' AND pr.online=TRUE AND pr.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND u.active=TRUE AND COALESCE(rm.state,'') NOT IN ('removed','denied') ORDER BY p.session_id,p.track_name LIMIT 20`, school, meeting)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []drawTarget{}
	for rows.Next() {
		var session, track, user, name string
		if e = rows.Scan(&session, &track, &user, &name); e != nil {
			return nil, e
		}
		out = append(out, drawTarget{Key: digest(session + ":" + track), User: user, Name: name})
	}
	return out, rows.Err()
}
func applyDrawing(s *drawingState, in drawingInput, actor string, host bool, targets []drawTarget, revision int64) (int, string) {
	targetOwner := false
	validTarget := false
	for _, t := range targets {
		if t.Key == s.Target {
			validTarget = true
			targetOwner = s.Mode == "screen" && t.User == actor
		}
	}
	control := host || (s.Mode == "screen" && validTarget && targetOwner)
	switch in.Action {
	case "open_board":
		if !host {
			return 403, "Chỉ giáo viên mở bảng trắng"
		}
		if in.Revision != revision {
			return 409, "Bảng đã thay đổi. Vui lòng thử lại"
		}
		s.Active = true
		s.Mode = "board"
		return 200, ""
	case "open_screen":
		owner := false
		found := false
		for _, t := range targets {
			if t.Key == in.Target {
				found = true
				owner = t.User == actor
			}
		}
		if !found {
			return 409, "Màn hình đã dừng hoặc thay đổi"
		}
		if !host && !owner {
			return 403, "Chỉ giáo viên hoặc người trình bày mở chú thích"
		}
		if in.Revision != revision {
			return 409, "Bảng đã thay đổi. Vui lòng thử lại"
		}
		if s.Screens[in.Target] == nil {
			if len(s.Screens) >= 20 {
				for k := range s.Screens {
					live := false
					for _, t := range targets {
						if t.Key == k {
							live = true
						}
					}
					if !live {
						delete(s.Screens, k)
					}
				}
			}
			s.Screens[in.Target] = newDrawPage(in.Target, "Chú thích màn hình")
		}
		s.Active = true
		s.Mode = "screen"
		s.Target = in.Target
		return 200, ""
	case "allow", "close", "page_add", "page_select", "page_delete", "clear":
		if !control {
			return 403, "Chỉ giáo viên hoặc người trình bày điều khiển"
		}
		if in.Revision != revision {
			return 409, "Bảng đã thay đổi. Vui lòng thử lại"
		}
		switch in.Action {
		case "allow":
			if !host {
				return 403, "Chỉ giáo viên cấp quyền vẽ"
			}
			s.Allow = in.Allow
		case "close":
			s.Active = false
		case "page_add":
			if !host || s.Mode != "board" {
				return 403, "Chỉ giáo viên thêm trang bảng trắng"
			}
			if len(s.Pages) >= 20 {
				return 409, "Tối đa 20 trang; xuất ảnh hoặc xóa trang cũ"
			}
			id := uid()
			s.Pages = append(s.Pages, *newDrawPage(id, fmt.Sprintf("Trang %d", len(s.Pages)+1)))
			s.Page = id
		case "page_select":
			if !host || s.Mode != "board" {
				return 403, "Chỉ giáo viên chuyển trang"
			}
			found := false
			for _, p := range s.Pages {
				if p.ID == in.Page {
					found = true
				}
			}
			if !found {
				return 404, "Không tìm thấy trang"
			}
			s.Page = in.Page
		case "page_delete":
			if !host || s.Mode != "board" {
				return 403, "Chỉ giáo viên xóa trang"
			}
			if len(s.Pages) <= 1 {
				return 409, "Giữ lại ít nhất một trang"
			}
			for i, p := range s.Pages {
				if p.ID == s.Page {
					s.Pages = append(s.Pages[:i], s.Pages[i+1:]...)
					break
				}
			}
			s.Page = s.Pages[0].ID
		case "clear":
			p, c := s.current()
			if p == nil || in.Context != c {
				return 409, "Trang đã thay đổi"
			}
			p.Epoch++
			p.Strokes = []drawStroke{}
			p.Deleted = []string{}
		}
		return 200, ""
	}
	if !s.Active || (s.Mode == "screen" && !validTarget) {
		return 409, "Bảng chưa mở hoặc màn hình đã dừng"
	}
	if !host && !targetOwner && !s.Allow {
		return 403, "Giáo viên chưa cho phép bạn vẽ"
	}
	p, c := s.current()
	if p == nil || in.Context != c || in.Epoch != p.Epoch {
		return 409, "Trang đã thay đổi; nét vẽ cũ không được khôi phục"
	}
	switch in.Action {
	case "stroke":
		v := in.Stroke
		if !validDrawStroke(v) {
			return 400, "Nét vẽ không hợp lệ"
		}
		for _, id := range p.Deleted {
			if id == v.ID {
				return 409, "Nét vẽ đã được xóa"
			}
		}
		if !strings.HasPrefix(v.ID, actor+"-") {
			return 403, "Nét vẽ không thuộc tài khoản"
		}
		v.Owner = actor
		for i, old := range p.Strokes {
			if old.ID == v.ID {
				if old.Owner != actor {
					return 403, "Không sửa nét vẽ của người khác"
				}
				if v.Seq > old.Seq {
					p.Strokes[i] = v
				}
				return 200, ""
			}
		}
		if len(p.Strokes) >= 800 {
			return 409, "Trang đã đầy; xuất ảnh rồi tạo trang mới"
		}
		p.Strokes = append(p.Strokes, v)
	case "erase":
		if !control && !strings.HasPrefix(in.ID, actor+"-") {
			return 403, "Chỉ xóa nét của bạn"
		}
		if !drawingID.MatchString(in.ID) {
			return 400, "Nét vẽ không hợp lệ"
		}
		for i, v := range p.Strokes {
			if v.ID == in.ID {
				if !control && v.Owner != actor {
					return 403, "Chỉ xóa nét của bạn"
				}
				if len(p.Deleted) >= 2000 {
					return 409, "Xuất ảnh rồi xóa toàn bộ trang để tiếp tục"
				}
				p.Strokes = append(p.Strokes[:i], p.Strokes[i+1:]...)
				break
			}
		}
		if len(p.Deleted) >= 2000 {
			return 409, "Xuất ảnh rồi xóa trang để tiếp tục"
		}
		found := false
		for _, id := range p.Deleted {
			if id == in.ID {
				found = true
			}
		}
		if !found {
			p.Deleted = append(p.Deleted, in.ID)
		}
	default:
		return 400, "Thao tác bảng không hợp lệ"
	}
	return 200, ""
}
func (a *app) roomDrawing(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	m, ok := a.access(w, r, false)
	if !ok {
		return
	}
	if m.Status != "live" || !a.liveMember(r) {
		problem(w, 403, "Vào buổi học trước khi dùng bảng")
		return
	}
	u := who(r)
	targets, e := a.drawingTargets(r.Context(), u.School, r.PathValue("id"))
	if e != nil {
		problem(w, 503, "Chưa tải được màn hình chia sẻ")
		return
	}
	w.Header().Set("Cache-Control", "private,no-store")
	if r.Method == "GET" {
		var raw string
		var rev int64
		e = a.db.QueryRowContext(r.Context(), "SELECT content,revision FROM meeting_drawing_state WHERE school_id=? AND meeting_id=?", u.School, r.PathValue("id")).Scan(&raw, &rev)
		if e != nil && e != sql.ErrNoRows {
			problem(w, 503, "Chưa tải được bảng")
			return
		}
		if since := r.URL.Query().Get("since"); since != "" {
			v, err := strconv.ParseInt(since, 10, 64)
			if err != nil || v < 0 {
				problem(w, 400, "Phiên bản không hợp lệ")
				return
			}
			if v == rev {
				send(w, 200, map[string]any{"unchanged": true, "revision": rev, "targets": targets})
				return
			}
		}
		state := newDrawingState()
		if raw != "" && json.Unmarshal([]byte(raw), &state) != nil {
			problem(w, 503, "Chưa đọc được bảng")
			return
		}
		send(w, 200, map[string]any{"state": state, "revision": rev, "targets": targets})
		return
	}
	var in drawingInput
	if !decode(w, r, &in) {
		return
	}
	key := "drawing-rate:" + u.School + ":" + r.PathValue("id") + ":" + u.ID
	n, err := a.cache.Incr(r.Context(), key).Result()
	if err != nil {
		problem(w, 503, "Chưa gửi được nét vẽ")
		return
	}
	if n == 1 {
		a.cache.Expire(r.Context(), key, time.Second)
	}
	if n > 20 {
		problem(w, 429, "Vẽ quá nhanh; đợi một giây rồi thử lại")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được bảng")
		return
	}
	defer tx.Rollback()
	var status string
	if tx.QueryRowContext(r.Context(), "SELECT status FROM meetings WHERE school_id=? AND id=? FOR UPDATE", u.School, r.PathValue("id")).Scan(&status) != nil || status != "live" {
		problem(w, 409, "Buổi học đã kết thúc")
		return
	}
	host := a.roomHost(r, m)
	var admitted int
	if tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM presence p LEFT JOIN room_settings rs ON rs.school_id=p.school_id AND rs.meeting_id=p.meeting_id LEFT JOIN room_members rm ON rm.school_id=p.school_id AND rm.meeting_id=p.meeting_id AND rm.user_id=p.user_id WHERE p.school_id=? AND p.meeting_id=? AND p.user_id=? AND p.online=TRUE AND p.last_seen>=UTC_TIMESTAMP()-INTERVAL 45 SECOND AND COALESCE(rm.state,'') NOT IN ('removed','denied') AND (? OR COALESCE(rs.lobby,FALSE)=FALSE OR rm.state='admitted')`, u.School, r.PathValue("id"), u.ID, host).Scan(&admitted) != nil || admitted != 1 {
		problem(w, 403, "Bạn không còn quyền trong phòng")
		return
	}
	var raw string
	var rev int64
	e = tx.QueryRowContext(r.Context(), "SELECT content,revision FROM meeting_drawing_state WHERE school_id=? AND meeting_id=? FOR UPDATE", u.School, r.PathValue("id")).Scan(&raw, &rev)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được bảng")
		return
	}
	state := newDrawingState()
	if raw != "" && json.Unmarshal([]byte(raw), &state) != nil {
		problem(w, 503, "Chưa đọc được bảng")
		return
	}
	code, message := applyDrawing(&state, in, u.ID, host, targets, state.Control)
	if code != 200 {
		problem(w, code, message)
		return
	}
	if in.Action != "stroke" && in.Action != "erase" {
		state.Control++
	}
	data, e := json.Marshal(state)
	if e != nil || len(data) > 1<<20 {
		problem(w, 409, "Bảng đã đầy; xuất ảnh và xóa trang cũ")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO meeting_drawing_state(school_id,meeting_id,content,revision) VALUES(?,?,?,1) ON DUPLICATE KEY UPDATE content=VALUES(content),revision=revision+1", u.School, r.PathValue("id"), string(data)); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được bảng")
		return
	}
	send(w, 200, map[string]any{"state": state, "revision": rev + 1, "targets": targets})
}
