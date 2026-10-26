package main

import (
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/mail"
	"strings"
)

var permissionNames = []string{"academic", "accounts", "attendance", "meetings", "recordings", "audit", "content", "finance"}

func permitted(u identity, p string) bool {
	if u.Role != "admin" {
		return false
	}
	if u.Permissions == nil {
		return true
	}
	for _, v := range u.Permissions {
		if v == p {
			return true
		}
	}
	return false
}
func permissionFor(path string) string {
	switch {
	case strings.HasPrefix(path, "/api/academy/"):
		return ""
	case strings.HasPrefix(path, "/api/accounts"):
		return "accounts"
	case strings.HasPrefix(path, "/api/attendance"):
		return "attendance"
	case path == "/api/audit":
		return "audit"
	case strings.Contains(path, "/recordings"):
		return "recordings"
	case strings.HasPrefix(path, "/api/rooms/") || (strings.HasPrefix(path, "/api/courses/") && strings.HasSuffix(path, "/prepare")):
		return "meetings"
	case strings.HasPrefix(path, "/api/meetings"):
		return "meetings"
	case path == "/api/catalog":
		return ""
	case path == "/api/profile" || path == "/api/me" || path == "/api/logout" || path == "/api/password" || path == "/api/2fa":
		return ""
	default:
		return "academic"
	}
}
func (a *app) accounts(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	a.query(w, r, "SELECT u.id,u.short_id,u.email,u.name,u.role,u.active,u.revision,COALESCE(c.state,IF(u.active,'active','disabled')) AS state,c.permissions FROM users u LEFT JOIN user_controls c ON c.user_id=u.id WHERE u.school_id=? ORDER BY u.role,u.name LIMIT 1000", who(r).School)
}
func (a *app) accountSave(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	actor := who(r)
	var in struct {
		ID          string   `json:"id"`
		Email       string   `json:"email"`
		Name        string   `json:"name"`
		Password    string   `json:"password"`
		State       string   `json:"state"`
		Permissions []string `json:"permissions"`
		Revision    int      `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.State != "active" && in.State != "suspended" && in.State != "disabled" {
		problem(w, 400, "Trạng thái không hợp lệ")
		return
	}
	for _, p := range in.Permissions {
		valid := false
		for _, v := range permissionNames {
			if p == v {
				valid = true
			}
		}
		if !valid || !permitted(actor, p) {
			problem(w, 403, "Không thể cấp quyền vượt quyền hiện có")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	id := in.ID
	if id == "" {
		email := strings.ToLower(strings.TrimSpace(in.Email))
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email || len(email) > 190 || len(strings.TrimSpace(in.Name)) < 1 || len(in.Name) > 200 || len(in.Password) < 12 || len(in.Password) > 72 {
			problem(w, 400, "Kiểm tra tên, email và mật khẩu 12–72 byte")
			return
		}
		h, err := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
		if err != nil {
			problem(w, 503, "Password unavailable")
			return
		}
		id = uid()
		code, err := shortCode(tx, "QT", id)
		if err != nil {
			problem(w, 409, "Không cấp được ID")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role,short_id,active) VALUES(?,?,?,?,?,'admin',?,?)", id, actor.School, email, strings.TrimSpace(in.Name), h, code, in.State == "active"); e != nil {
			problem(w, 409, "Email đã có hoặc không tạo được tài khoản")
			return
		}
	} else {
		var role string
		var rev int
		var grants []byte
		if tx.QueryRowContext(r.Context(), "SELECT u.role,u.revision,c.permissions FROM users u LEFT JOIN user_controls c ON c.user_id=u.id WHERE u.school_id=? AND u.id=? FOR UPDATE", actor.School, id).Scan(&role, &rev, &grants) != nil {
			problem(w, 404, "Không tìm thấy tài khoản")
			return
		}
		if id == actor.ID {
			problem(w, 409, "Không tự sửa trạng thái/quyền của mình")
			return
		}
		if role == "admin" && grants == nil && actor.ID != "control-plane" {
			problem(w, 403, "Tài khoản quản trị gốc được bảo vệ")
			return
		}
		if rev != in.Revision {
			problem(w, 409, "Dữ liệu đã thay đổi; tải lại")
			return
		}
		if role != "admin" {
			in.Permissions = []string{}
		}
		if actor.ID == "control-plane" {
			email := strings.ToLower(strings.TrimSpace(in.Email))
			parsed, err := mail.ParseAddress(email)
			if err != nil || parsed.Address != email || len(email) > 190 || len(strings.TrimSpace(in.Name)) < 1 || len(in.Name) > 200 {
				problem(w, 400, "Tên/email không hợp lệ")
				return
			}
			if _, e = tx.ExecContext(r.Context(), "UPDATE users SET name=?,email=? WHERE school_id=? AND id=?", strings.TrimSpace(in.Name), email, actor.School, id); e != nil {
				problem(w, 409, "Email bị trùng")
				return
			}
			if in.Password != "" {
				if !validAccountPassword(role, in.Password) {
					problem(w, 400, "Mật khẩu 12–72 byte")
					return
				}
				hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
				if err != nil {
					problem(w, 503, "Password unavailable")
					return
				}
				if _, e = tx.ExecContext(r.Context(), "UPDATE users SET password_hash=? WHERE school_id=? AND id=?", hash, actor.School, id); e != nil {
					problem(w, 503, "Update failed")
					return
				}
			}
		}
		if _, e = tx.ExecContext(r.Context(), "UPDATE users SET active=?,session_version=session_version+1,revision=revision+1 WHERE school_id=? AND id=?", in.State == "active", actor.School, id); e != nil {
			problem(w, 500, "Update failed")
			return
		}
	}
	if in.Permissions == nil {
		in.Permissions = []string{}
	}
	raw, _ := json.Marshal(in.Permissions)
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO user_controls(user_id,state,permissions) VALUES(?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),permissions=VALUES(permissions)", id, in.State, string(raw)); e != nil {
		problem(w, 500, "Lưu quyền thất bại")
		return
	}
	if tx.Commit() != nil {
		problem(w, 500, "Commit failed")
		return
	}
	a.audit(r, "account.save", id)
	send(w, 200, map[string]string{"id": id})
}
