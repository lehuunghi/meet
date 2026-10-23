package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
)

//go:embed schema.sql
var schema string

type app struct {
	db     *sql.DB
	cache  *redis.Client
	client *http.Client
	origin string
	secure bool
}
type identity struct {
	ID      string `json:"id"`
	School  string `json:"school_id"`
	Role    string `json:"role"`
	Name    string `json:"name"`
	Version int    `json:"session_version"`
}
type authKey struct{}

func uid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func secret(k string) string {
	if p := os.Getenv(k + "_FILE"); p != "" {
		b, e := os.ReadFile(p)
		if e != nil {
			panic(e)
		}
		return strings.TrimSpace(string(b))
	}
	return os.Getenv(k)
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, msg string) {
	send(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		problem(w, 400, "Invalid request")
		return false
	}
	return true
}
func who(r *http.Request) identity { return r.Context().Value(authKey{}).(identity) }
func (a *app) audit(r *http.Request, action, target string) {
	u := who(r)
	if _, e := a.db.ExecContext(r.Context(), "INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,?,?)", u.School, u.ID, action, target); e != nil {
		slog.Error("audit failed", "error", e)
	}
}
func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, e := r.Cookie("meet_session")
		if e != nil {
			problem(w, 401, "Sign in required")
			return
		}
		raw, e := a.cache.Get(r.Context(), "session:"+digest(c.Value)).Result()
		if e != nil {
			problem(w, 401, "Session expired")
			return
		}
		var u identity
		if json.Unmarshal([]byte(raw), &u) != nil {
			problem(w, 401, "Invalid session")
			return
		}
		var active bool
		var version int
		if a.db.QueryRowContext(r.Context(), "SELECT active,session_version FROM users WHERE id=? AND school_id=? AND role=?", u.ID, u.School, u.Role).Scan(&active, &version) != nil || !active || version != u.Version {
			problem(w, 401, "Account unavailable")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), authKey{}, u)))
	}
}
func (a *app) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, c := context.WithTimeout(r.Context(), 2*time.Second)
		defer c()
		if a.db.PingContext(ctx) != nil || a.cache.Ping(ctx).Err() != nil {
			problem(w, 503, "Dependencies unavailable")
			return
		}
		send(w, 200, map[string]string{"status": "ok"})
	})
	m.HandleFunc("POST /api/login", a.login)
	m.HandleFunc("POST /api/logout", a.auth(a.logout))
	m.HandleFunc("GET /api/me", a.auth(func(w http.ResponseWriter, r *http.Request) { send(w, 200, who(r)) }))
	m.HandleFunc("POST /api/password", a.auth(a.password))
	m.HandleFunc("GET /api/catalog", a.auth(a.catalog))
	m.HandleFunc("POST /api/classes", a.auth(a.createClass))
	m.HandleFunc("POST /api/courses", a.auth(a.createCourse))
	m.HandleFunc("POST /api/enrollments", a.auth(a.enroll))
	m.HandleFunc("POST /api/import", a.auth(a.importUsers))
	m.HandleFunc("GET /api/users", a.auth(a.users))
	m.HandleFunc("GET /api/classes", a.auth(func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		a.query(w, r, "SELECT id,name FROM classes WHERE school_id=? ORDER BY name LIMIT 1000", who(r).School)
	}))
	m.HandleFunc("GET /api/audit", a.auth(func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		a.query(w, r, "SELECT actor_id,action,target,at FROM audit_log WHERE school_id=? ORDER BY id DESC LIMIT 200", who(r).School)
	}))
	m.HandleFunc("GET /api/meetings", a.auth(a.meetings))
	m.HandleFunc("GET /api/attendance/report", a.auth(a.attendanceReport))
	m.HandleFunc("POST /api/meetings", a.auth(a.createMeeting))
	m.HandleFunc("POST /api/meetings/{id}/state", a.auth(a.meetingState))
	m.HandleFunc("POST /api/meetings/{id}/presence", a.auth(a.presence))
	m.HandleFunc("GET /api/meetings/{id}/attendance", a.auth(a.attendance))
	m.HandleFunc("POST /api/meetings/{id}/sfu", a.auth(a.sfu))
	m.HandleFunc("GET /api/meetings/{id}/tracks", a.auth(a.tracks))
	m.HandleFunc("POST /api/meetings/{id}/ice", a.auth(a.ice))
	m.HandleFunc("POST /api/meetings/{id}/recordings", a.auth(a.recordingCreate))
	m.HandleFunc("GET /api/meetings/{id}/recordings", a.auth(a.recordingList))
	m.HandleFunc("POST /api/meetings/{id}/recordings/{recording}/complete", a.auth(a.recordingComplete))
	m.HandleFunc("GET /api/meetings/{id}/recordings/{recording}/download", a.auth(a.recordingDownload))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.origin {
				problem(w, 403, "Origin rejected")
				return
			}
		}
		defer func() {
			if e := recover(); e != nil {
				slog.Error("request panic", "error", fmt.Sprint(e))
				problem(w, 500, "Internal error")
			}
		}()
		m.ServeHTTP(w, r)
	})
}
func migrate(db *sql.DB) error {
	// One connection keeps the advisory lock through all DDL. DDL is intentionally restartable.
	c, e := db.Conn(context.Background())
	if e != nil {
		return e
	}
	defer c.Close()
	var locked int
	if e = c.QueryRowContext(context.Background(), "SELECT GET_LOCK('meet_schema',30)").Scan(&locked); e != nil || locked != 1 {
		return errors.New("migration lock unavailable")
	}
	defer c.ExecContext(context.Background(), "SELECT RELEASE_LOCK('meet_schema')")
	for _, q := range strings.Split(schema, ";") {
		if strings.TrimSpace(q) != "" {
			if _, e = c.ExecContext(context.Background(), q); e != nil {
				return e
			}
		}
	}
	_, e = c.ExecContext(context.Background(), "INSERT IGNORE INTO schema_migrations VALUES(1)")
	return e
}
func main() {
	db, e := sql.Open("mysql", secret("MYSQL_DSN"))
	if e != nil {
		panic(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "migrate":
			e = migrate(db)
		case "seed":
			e = seed(db)
		case "bootstrap":
			e = bootstrap(db)
		default:
			e = errors.New("unknown command")
		}
		if e != nil {
			panic(e)
		}
		return
	}
	opt, e := redis.ParseURL(secret("REDIS_URL"))
	if e != nil {
		panic(e)
	}
	cache := redis.NewClient(opt)
	defer cache.Close()
	origin := os.Getenv("APP_ORIGIN")
	if origin == "" {
		panic("APP_ORIGIN required")
	}
	a := &app{db: db, cache: cache, client: &http.Client{Timeout: 20 * time.Second}, origin: origin, secure: strings.HasPrefix(origin, "https://")}
	srv := &http.Server{Addr: ":8080", Handler: a.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	slog.Info("API listening", "addr", srv.Addr)
	if e = srv.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		panic(e)
	}
}
