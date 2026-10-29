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
		return errors.New("business management is available only on the website")
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
		state := "active"
		if schoolSuspended() {
			state = "suspended"
		}
		usage, err := readSFUUsage(context.Background(), db)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"sfu_usage": usage, "sfu_usage_kind": "estimated_webrtc", "live": live, "admins": accounts, "version": buildVersion, "commit": buildCommit, "platform_mode": mode, "school_state": state, "features": []string{"local_academy_management", "lifecycle", "relocation", "sfu_round_robin", "sfu_usage", "sfu_failover"}})
	}
	if action == "managed-config" {
		var in struct {
			Settings      systemSettings `json:"settings"`
			School        firstSchool    `json:"school"`
			Domain        string         `json:"domain"`
			ControlOrigin string         `json:"control_origin"`
			ControlID     string         `json:"control_id"`
		}
		if json.Unmarshal(raw, &in) != nil || !regexp.MustCompile(`^([a-z0-9][a-z0-9-]*\.)+[a-z]{2,63}$`).MatchString(in.Domain) {
			return errors.New("invalid managed config")
		}
		if in.ControlOrigin != "" && (!validControlOrigin(in.ControlOrigin) || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(in.ControlID)) {
			return errors.New("invalid control binding")
		}
		a.controlOrigin = in.ControlOrigin
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
		if in.Settings.Platform == "academy" {
			content, _ := json.Marshal(map[string]any{"headline": in.School.Name, "description": "Khóa học trực tuyến, lớp Live và bài giảng xem lại.", "published": true})
			if _, err = db.Exec("INSERT IGNORE INTO academy_site(school_id,content) SELECT id,? FROM schools WHERE slug=?", string(content), in.School.Slug); err != nil {
				return err
			}
		}
		binding, _ := json.Marshal(map[string]string{"school": in.School.Slug, "domain": in.Domain, "control_origin": in.ControlOrigin, "control_id": in.ControlID})
		path := configPath("managed.json")
		temp := filepath.Join(filepath.Dir(path), ".managed-next")
		if err = os.WriteFile(temp, binding, 0600); err != nil {
			return err
		}
		if err = os.Rename(temp, path); err != nil {
			return err
		}
		os.Remove(configPath("setup-token"))
		os.Remove(configPath("managed-install.json"))
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
