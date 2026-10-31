package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"regexp"
	"time"
)

func validRestoreProbe(database, user, prefix string) bool {
	return regexp.MustCompile(`^meetcheck_[a-f0-9]{20}$`).MatchString(database) && regexp.MustCompile(`^mcheck_[a-f0-9]{20}$`).MatchString(user) && regexp.MustCompile(`^meet:[a-f0-9]{32}:$`).MatchString(prefix)
}

// Runs HTTP authentication/catalog against a disposable SQL database and a distinct
// Redis ACL. It never starts background jobs or calls mail, storage, payment or SFU.
func restoreProbe(db *sql.DB) error {
	var database, user string
	if err := db.QueryRow("SELECT DATABASE(),SUBSTRING_INDEX(CURRENT_USER(),'@',1)").Scan(&database, &user); err != nil {
		return err
	}
	if !validRestoreProbe(database, user, os.Getenv("REDIS_KEY_PREFIX")) {
		return errors.New("disposable restore database and identity required")
	}
	if _, err := os.Stat(configPath("managed.json")); !os.IsNotExist(err) {
		return errors.New("isolated empty configuration required")
	}
	opt, err := redis.ParseURL(secret("REDIS_URL"))
	if err != nil {
		return err
	}
	if opt.Username != user {
		return errors.New("disposable Redis identity required")
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	if err := configureRedisNamespace(cache); err != nil {
		return err
	}
	var school, slug string
	if err := db.QueryRow("SELECT id,slug FROM schools ORDER BY id LIMIT 1").Scan(&school, &slug); err != nil {
		return err
	}
	counts := map[string]int{}
	for _, table := range []string{"users", "classes", "meetings"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			return err
		}
		counts[table] = count
	}
	id, password := uid(), uid()+uid()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	email := "restore-" + id + "@example.invalid"
	if _, err := db.Exec("INSERT INTO users(id,school_id,email,name,password_hash,role,active) VALUES(?,?,?,?,?,'admin',TRUE)", id, school, email, "Restore verification", string(hash)); err != nil {
		return err
	}
	defer db.Exec("DELETE FROM users WHERE id=?", id)
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: 3 * time.Second}}
	server := httptest.NewServer(a.routes())
	defer server.Close()
	a.origin = server.URL
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	request := func(method, path string, body any) error {
		raw, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(context.Background(), method, server.URL+path, bytes.NewReader(raw))
		if err != nil {
			return err
		}
		req.Header.Set("Origin", server.URL)
		req.Header.Set("Content-Type", "application/json")
		response, err := client.Do(req)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		io.Copy(io.Discard, io.LimitReader(response.Body, 4<<20))
		if response.StatusCode != 200 {
			return fmt.Errorf("restore HTTP probe failed at %s (%d)", path, response.StatusCode)
		}
		return nil
	}
	if err := request("GET", "/api/health", nil); err != nil {
		return err
	}
	if err := request("POST", "/api/login", map[string]string{"school": slug, "email": email, "password": password}); err != nil {
		return err
	}
	if err := request("GET", "/api/me", nil); err != nil {
		return err
	}
	if err := request("GET", "/api/catalog", nil); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "checks": []string{"sql", "redis", "http_health", "login", "session", "catalog"}, "counts": counts})
}
