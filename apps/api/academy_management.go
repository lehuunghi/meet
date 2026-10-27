package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

func (a *app) academyPlanSave(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	var in struct {
		ID, Name string
		Price    int64 `json:"price_vnd"`
		Days     int
		Live     bool `json:"live_enabled"`
		Active   bool
		Revision int
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 160 || in.Price < 1000 || in.Price > 1000000000 || in.Days < 1 || in.Days > 3650 {
		problem(w, 400, "Gói học không hợp lệ")
		return
	}
	u := who(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được gói")
		return
	}
	defer tx.Rollback()
	if in.ID == "" {
		in.ID = uid()
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_plans(id,school_id,name,price_vnd,days,live_enabled,active) VALUES(?,?,?,?,?,?,?)", in.ID, u.School, in.Name, in.Price, in.Days, in.Live, in.Active)
	} else {
		var id string
		if tx.QueryRowContext(r.Context(), "SELECT id FROM academy_plans WHERE school_id=? AND id=? FOR UPDATE", u.School, in.ID).Scan(&id) != nil {
			problem(w, 404, "Không tìm thấy gói")
			return
		}
		var revision int
		var deleted sql.NullTime
		err := tx.QueryRowContext(r.Context(), "SELECT revision,deleted_at FROM academy_plan_controls WHERE school_id=? AND plan_id=? FOR UPDATE", u.School, in.ID).Scan(&revision, &deleted)
		if err != nil && err != sql.ErrNoRows {
			problem(w, 503, "Chưa đọc được phiên bản gói")
			return
		}
		if deleted.Valid {
			problem(w, 404, "Gói đã xóa")
			return
		}
		if revision != in.Revision {
			problem(w, 409, "Gói đã thay đổi; tải lại trước khi sửa")
			return
		}
		_, e = tx.ExecContext(r.Context(), "UPDATE academy_plans SET name=?,price_vnd=?,days=?,live_enabled=?,active=? WHERE school_id=? AND id=?", in.Name, in.Price, in.Days, in.Live, in.Active, u.School, in.ID)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_plan_controls(school_id,plan_id) VALUES(?,?) ON DUPLICATE KEY UPDATE revision=revision+1", u.School, in.ID)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được gói")
		return
	}
	a.audit(r, "academy.plan.save", in.ID)
	send(w, 200, map[string]string{"id": in.ID})
}
func (a *app) academyPlanDelete(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "finance") {
		return
	}
	var in struct {
		Confirm  string
		Revision int
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	id := r.PathValue("plan")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa xóa được gói")
		return
	}
	defer tx.Rollback()
	var name string
	if tx.QueryRowContext(r.Context(), "SELECT name FROM academy_plans WHERE school_id=? AND id=? FOR UPDATE", u.School, id).Scan(&name) != nil {
		problem(w, 404, "Không tìm thấy gói")
		return
	}
	var revision int
	var deleted sql.NullTime
	e = tx.QueryRowContext(r.Context(), "SELECT revision,deleted_at FROM academy_plan_controls WHERE school_id=? AND plan_id=? FOR UPDATE", u.School, id).Scan(&revision, &deleted)
	if e != nil && e != sql.ErrNoRows {
		problem(w, 503, "Chưa đọc được gói")
		return
	}
	if deleted.Valid {
		problem(w, 404, "Gói đã xóa")
		return
	}
	if in.Confirm != name || in.Revision != revision {
		problem(w, 409, "Nhập đúng tên gói và tải lại dữ liệu mới nhất")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE academy_plans SET active=FALSE WHERE school_id=? AND id=?", u.School, id); e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO academy_plan_controls(school_id,plan_id,deleted_at) VALUES(?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE deleted_at=UTC_TIMESTAMP(6),revision=revision+1", u.School, id)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa xóa được gói")
		return
	}
	a.audit(r, "academy.plan.delete", id)
	send(w, 200, map[string]bool{"ok": true, "history_preserved": true})
}
func (a *app) accountDelete(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	if !permitted(who(r), "accounts") {
		problem(w, 403, "Chưa được cấp quyền tài khoản")
		return
	}
	u := who(r)
	id := r.PathValue("user")
	var in struct {
		Confirm  string
		Revision int
	}
	if !decode(w, r, &in) {
		return
	}
	if id == u.ID {
		problem(w, 409, "Không thể xóa tài khoản đang đăng nhập")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa xóa được tài khoản")
		return
	}
	defer tx.Rollback()
	var role, email string
	var revision int
	var grants []byte
	if tx.QueryRowContext(r.Context(), "SELECT u.role,u.email,u.revision,c.permissions FROM users u LEFT JOIN user_controls c ON c.user_id=u.id WHERE u.school_id=? AND u.id=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id) FOR UPDATE", u.School, id).Scan(&role, &email, &revision, &grants) != nil {
		problem(w, 404, "Không tìm thấy tài khoản")
		return
	}
	if role == "admin" {
		if grants == nil {
			problem(w, 403, "Không thể xóa quản trị gốc")
			return
		}
		var rights []string
		if json.Unmarshal(grants, &rights) != nil {
			problem(w, 503, "Chưa đọc được quyền")
			return
		}
		for _, p := range rights {
			if !permitted(u, p) {
				problem(w, 403, "Không thể xóa quản trị có quyền vượt tài khoản hiện tại")
				return
			}
		}
	}
	if in.Confirm != email || in.Revision != revision {
		problem(w, 409, "Nhập đúng email và tải lại dữ liệu mới nhất")
		return
	}
	var avatar string
	_ = tx.QueryRowContext(r.Context(), "SELECT avatar_key FROM academy_profiles WHERE school_id=? AND user_id=?", u.School, id).Scan(&avatar)
	if !strings.HasPrefix(avatar, "academy/avatars/"+u.School+"/"+id+"/") || strings.Contains(avatar, "..") {
		avatar = ""
	}
	cfg, _ := loadSettings()
	queries := []string{"DELETE FROM account_security WHERE user_id=?", "DELETE FROM academy_memberships WHERE user_id=?", "DELETE FROM academy_live_memberships WHERE user_id=?", "DELETE FROM academy_profiles WHERE user_id=?", "DELETE FROM academy_registration_avatars WHERE user_id=?", "DELETE FROM academy_email_links WHERE user_id=?", "DELETE FROM enrollments WHERE user_id=?", "DELETE FROM course_assistants WHERE user_id=?"}
	for _, q := range queries {
		if _, e = tx.ExecContext(r.Context(), q, id); e != nil {
			problem(w, 503, "Chưa thu hồi được tài khoản")
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE courses SET teacher_id=NULL WHERE school_id=? AND teacher_id=?", u.School, id); e != nil {
		problem(w, 503, "Chưa gỡ được phân công")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "UPDATE users SET email=?,name='Tài khoản đã xóa',student_code=NULL,password_hash=?,active=FALSE,session_version=session_version+1,revision=revision+1 WHERE school_id=? AND id=?", id+"@deleted.invalid", digest(uid()), u.School, id); e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO user_controls(user_id,state,permissions) VALUES(?,'disabled','[]') ON DUPLICATE KEY UPDATE state='disabled',permissions='[]'", id)
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO account_deletions(school_id,user_id,avatar_key,storage_account,bucket,avatar_deleted) VALUES(?,?,?,?,?,?)", u.School, id, avatar, cfg.R2.Account, cfg.R2.Bucket, avatar == "")
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa xóa được tài khoản")
		return
	}
	a.cache.Del(r.Context(), "current-session:"+id, "password-recovery-user:"+id)
	a.audit(r, "account.delete", id)
	send(w, 200, map[string]bool{"ok": true, "history_preserved": true})
}
