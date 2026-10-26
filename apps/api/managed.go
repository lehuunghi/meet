package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// This command is available only inside the VPS container to its root-owned agent.
// It reuses all existing storage/SFU validation, without exposing another HTTP operator API.
func managedCommand(db *sql.DB, action string) error {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return errors.New("invalid managed input")
	}
	opt, err := redis.ParseURL(secret("REDIS_URL"))
	if err != nil {
		return err
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: 45 * time.Second}, origin: os.Getenv("APP_ORIGIN")}
	if action == "managed-academy" {
		var in struct {
			Method, Path string
			Body         json.RawMessage
			RequestID    string `json:"request_id"`
		}
		if json.Unmarshal(raw, &in) != nil || !academyManagedPath(in.Method, in.Path) {
			return errors.New("unsupported academy operation")
		}
		var count int
		if db.QueryRow("SELECT COUNT(*) FROM schools").Scan(&count) != nil || count != 1 {
			return errors.New("single academy deployment required")
		}
		if in.Method == "POST" && (in.Path == "/api/academy/courses" || in.Path == "/api/academy/plans" || in.Path == "/api/academy/finance") {
			var body map[string]any
			if json.Unmarshal(in.Body, &body) != nil {
				return errors.New("invalid business payload")
			}
			if body["id"] == nil || body["id"] == "" {
				if !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(in.RequestID) {
					return errors.New("request ID required")
				}
				body["id"] = in.RequestID
				in.Body, _ = json.Marshal(body)
			}
		}
		var u identity
		u.Role = "admin"
		if db.QueryRow("SELECT u.id,u.school_id,u.name FROM users u LEFT JOIN user_controls c ON c.user_id=u.id WHERE u.role='admin' AND u.active=TRUE AND c.permissions IS NULL ORDER BY u.id LIMIT 1").Scan(&u.ID, &u.School, &u.Name) != nil {
			return errors.New("active root administrator required")
		}
		req := httptest.NewRequest(in.Method, in.Path, bytes.NewReader(in.Body))
		req.Header.Set("Origin", a.origin)
		req = req.WithContext(context.WithValue(context.WithValue(req.Context(), authKey{}, u), managedAcademyKey{}, true))
		rec := httptest.NewRecorder()
		a.routes().ServeHTTP(rec, req)
		if rec.Code < 200 || rec.Code >= 300 {
			return fmt.Errorf("academy operation rejected (%d)", rec.Code)
		}
		var data any
		if json.Unmarshal(rec.Body.Bytes(), &data) != nil {
			return errors.New("non-JSON academy response")
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": rec.Code, "data": data})
	}
	if action == "managed-status" {
		var live int
		if err = db.QueryRow("SELECT COUNT(*) FROM meetings WHERE status='live'").Scan(&live); err != nil {
			return err
		}
		rows, err := db.Query("SELECT id,email,name,active,revision FROM users WHERE role='admin' ORDER BY name LIMIT 100")
		if err != nil {
			return err
		}
		defer rows.Close()
		accounts := []map[string]any{}
		for rows.Next() {
			var id, email, name string
			var active bool
			var rev int
			if err = rows.Scan(&id, &email, &name, &active, &rev); err != nil {
				return err
			}
			accounts = append(accounts, map[string]any{"id": id, "email": email, "name": name, "active": active, "revision": rev})
		}
		if err = rows.Err(); err != nil {
			return err
		}
		cfg, _ := loadSettings()
		mode := cfg.Platform
		if mode == "" {
			mode = "school"
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"live": live, "admins": accounts, "version": buildVersion, "commit": buildCommit, "platform_mode": mode, "features": []string{"academy_management"}})
	}
	if action == "managed-config" {
		var in struct {
			Settings systemSettings `json:"settings"`
			School   firstSchool    `json:"school"`
			Domain   string         `json:"domain"`
		}
		if json.Unmarshal(raw, &in) != nil || !regexp.MustCompile(`^([a-z0-9][a-z0-9-]*\.)+[a-z]{2,63}$`).MatchString(in.Domain) {
			return errors.New("invalid managed config")
		}
		var n int
		var slug string
		if db.QueryRow("SELECT COUNT(*),COALESCE(MIN(slug),'') FROM schools").Scan(&n, &slug) != nil {
			return errors.New("database unavailable")
		}
		if n > 1 || n == 1 && slug != in.School.Slug {
			return errors.New("deployment school mismatch")
		}
		body, _ := json.Marshal(map[string]any{"settings": in.Settings, "school": in.School})
		req := httptest.NewRequest("POST", "/api/setup/settings", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		a.setupSave(rec, req)
		if rec.Code != 200 {
			return fmt.Errorf("managed config rejected (%d): %s", rec.Code, rec.Body.String())
		}
		if _, err = db.Exec("UPDATE schools SET name=? WHERE slug=?", in.School.Name, in.School.Slug); err != nil {
			return err
		}
		binding, _ := json.Marshal(map[string]string{"school": in.School.Slug, "domain": in.Domain})
		path := configPath("managed.json")
		temp := filepath.Join(filepath.Dir(path), ".managed-next")
		if err = os.WriteFile(temp, binding, 0600); err != nil {
			return err
		}
		if err = os.Rename(temp, path); err != nil {
			return err
		}
		os.Remove(configPath("setup-token"))
		fmt.Println(`{"ok":true}`)
		return nil
	}
	if action == "managed-account" {
		var school string
		var count int
		if db.QueryRow("SELECT COUNT(*),COALESCE(MIN(id),'') FROM schools").Scan(&count, &school) != nil || count != 1 {
			return errors.New("single school required")
		}
		// A virtual operator has no login identity and cannot be used on public routes.
		req := httptest.NewRequest("POST", "/api/accounts", bytes.NewReader(raw))
		req = req.WithContext(context.WithValue(req.Context(), authKey{}, identity{ID: "control-plane", School: school, Role: "admin"}))
		rec := httptest.NewRecorder()
		a.accountSave(rec, req)
		if rec.Code != 200 && rec.Code != 201 {
			return fmt.Errorf("account rejected (%d)", rec.Code)
		}
		os.Stdout.Write(rec.Body.Bytes())
		return nil
	}
	return errors.New("unsupported managed command")
}

// Central operator also updates profile fields, preserving the password and TOTP unless explicitly changed.
