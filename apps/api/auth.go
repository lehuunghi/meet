package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		School   string `json:"school"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	// Atomic fixed window; never trust forwarded headers from the client.
	const limit = `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],300) end;return n`
	n, e := a.cache.Eval(r.Context(), limit, []string{"login:" + digest(ip+":"+in.School+":"+strings.ToLower(strings.TrimSpace(in.Email)))}).Int()
	if e != nil {
		problem(w, 503, "Authentication unavailable")
		return
	}
	if n > 30 {
		problem(w, 429, "Try again in five minutes")
		return
	}
	var u identity
	var hash string
	e = a.db.QueryRowContext(r.Context(), `SELECT u.id,u.school_id,u.role,u.name,u.password_hash,u.session_version FROM users u JOIN schools s ON s.id=u.school_id WHERE s.slug=? AND (u.email=? OR u.student_code=?) AND u.active=TRUE`, in.School, strings.ToLower(strings.TrimSpace(in.Email)), strings.ToUpper(strings.TrimSpace(in.Email))).Scan(&u.ID, &u.School, &u.Role, &u.Name, &hash, &u.Version)
	if e != nil {
		hash = "$2a$12$w1qX8hnTqNx9IXiB6P1szepjXpJsa42Qe.PQ0.rgjGkFrP7sXkPqK"
	}
	valid := bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) == nil
	if e != nil || !valid {
		problem(w, 401, "Invalid school, email or password")
		return
	}
	token := uid() + uid()
	raw, _ := json.Marshal(u)
	if a.cache.Set(r.Context(), "session:"+digest(token), raw, 12*time.Hour).Err() != nil {
		problem(w, 503, "Authentication unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "meet_session", Value: token, Path: "/api", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: 43200})
	send(w, 200, u)
}
func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("meet_session")
	if a.cache.Del(r.Context(), "session:"+digest(c.Value)).Err() != nil {
		problem(w, 503, "Session store unavailable")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "meet_session", Value: "", Path: "/api", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) password(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.New) < 12 || len(in.New) > 72 {
		problem(w, 400, "Password must contain 12–72 bytes")
		return
	}
	u := who(r)
	var hash string
	if a.db.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE school_id=? AND id=?", u.School, u.ID).Scan(&hash) != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Current)) != nil {
		problem(w, 403, "Current password incorrect")
		return
	}
	h, e := bcrypt.GenerateFromPassword([]byte(in.New), 12)
	if e != nil {
		problem(w, 500, "Password unavailable")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE users SET password_hash=?,session_version=session_version+1 WHERE school_id=? AND id=?", h, u.School, u.ID); e != nil {
		problem(w, 500, "Update failed")
		return
	}
	a.audit(r, "password.change", u.ID)
	send(w, 200, map[string]bool{"ok": true})
}
func admin(w http.ResponseWriter, r *http.Request) bool {
	if who(r).Role != "admin" {
		problem(w, 403, "Administrator required")
		return false
	}
	return true
}
func seed(db *sql.DB) error {
	if os.Getenv("ALLOW_DEMO_SEED") != "true" {
		return fmt.Errorf("set ALLOW_DEMO_SEED=true explicitly; never seed production")
	}
	pass := secret("DEMO_PASSWORD")
	if len(pass) < 12 || len(pass) > 72 {
		return fmt.Errorf("DEMO_PASSWORD must contain 12–72 bytes")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(pass), 12)
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, s := range []struct{ ID, Slug, Name string }{{"school-demo", "demo", "Trường Nguyễn Trãi"}, {"school-other", "other", "Trường Lê Lợi"}} {
		if _, e = tx.Exec("INSERT IGNORE INTO schools(id,slug,name) VALUES(?,?,?)", s.ID, s.Slug, s.Name); e != nil {
			return e
		}
		for _, role := range []string{"admin", "teacher", "student"} {
			if _, e = tx.Exec("INSERT IGNORE INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,?)", s.Slug+"-"+role, s.ID, role+"@example.test", strings.Title(role), hash, role); e != nil {
				return e
			}
		}
		if _, e = tx.Exec("INSERT IGNORE INTO classes(id,school_id,name) VALUES(?,?,?)", s.Slug+"-class", s.ID, "10A1"); e != nil {
			return e
		}
		if _, e = tx.Exec("INSERT IGNORE INTO enrollments VALUES(?,?,?)", s.ID, s.Slug+"-class", s.Slug+"-student"); e != nil {
			return e
		}
		if _, e = tx.Exec("INSERT IGNORE INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,?,?,?,?)", s.Slug+"-math", s.ID, s.Slug+"-class", s.Slug+"-teacher", "Toán học"); e != nil {
			return e
		}
		if _, e = tx.Exec("INSERT IGNORE INTO meetings(id,school_id,course_id,title,starts_at) VALUES(?,?,?,?,UTC_TIMESTAMP())", s.Slug+"-meeting", s.ID, s.Slug+"-math", "Hàm số và đồ thị"); e != nil {
			return e
		}
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	return migrate(db)
}
