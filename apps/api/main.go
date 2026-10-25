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
	Permissions []string `json:"permissions"`
	ID          string   `json:"id"`
	School      string   `json:"school_id"`
	Role        string   `json:"role"`
	Name        string   `json:"name"`
	Version     int      `json:"session_version"`
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
		current, err := a.cache.Get(r.Context(), "current-session:"+u.ID).Result()
		if err != nil || current != digest(c.Value) {
			problem(w, 401, "Bạn đã đăng nhập trên thiết bị khác")
			return
		}
		var active bool
		var version int
		if a.db.QueryRowContext(r.Context(), "SELECT active,session_version FROM users WHERE id=? AND school_id=? AND role=?", u.ID, u.School, u.Role).Scan(&active, &version) != nil || !active || version != u.Version {
			problem(w, 401, "Account unavailable")
			return
		}
		if u.Role == "admin" {
			var raw []byte
			e := a.db.QueryRowContext(r.Context(), "SELECT permissions FROM user_controls WHERE user_id=?", u.ID).Scan(&raw)
			if e != nil && e != sql.ErrNoRows {
				problem(w, 503, "Permissions unavailable")
				return
			}
			if raw != nil {
				if json.Unmarshal(raw, &u.Permissions) != nil {
					problem(w, 503, "Invalid permissions")
					return
				}
			}
			if p := permissionFor(r.URL.Path); p != "" && !permitted(u, p) && !(p == "meetings" && r.Method == "GET" && r.URL.Path == "/api/meetings" && (permitted(u, "attendance") || permitted(u, "recordings"))) {
				problem(w, 403, "Tài khoản chưa được cấp quyền cho chức năng này")
				return
			}
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
		send(w, 200, map[string]string{"status": "ok", "commit": buildCommit, "version": buildVersion})
	})
	m.HandleFunc("GET /api/public-config", func(w http.ResponseWriter, r *http.Request) {
		_, e := os.Stat(configPath("managed.json"))
		name := ""
		var count int
		if a.db != nil {
			if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*),COALESCE(MIN(name),'') FROM schools").Scan(&count, &name) != nil || count != 1 {
				name = ""
			}
		}
		send(w, 200, map[string]any{"managed": e == nil, "school_name": name})
	})
	m.HandleFunc("POST /api/login", a.login)
	m.HandleFunc("POST /api/login/2fa", a.loginOTP)
	m.HandleFunc("POST /api/reset-password", a.resetPassword)
	m.HandleFunc("POST /api/accounts/{user}/recovery", a.auth(a.issuePasswordRecovery))
	m.HandleFunc("GET /api/setup/status", a.setupStatus)
	m.HandleFunc("POST /api/setup/unlock", a.setupUnlock)
	m.HandleFunc("POST /api/setup/lock", a.operator(a.setupLock))
	m.HandleFunc("GET /api/setup/settings", a.operator(a.setupGet))
	m.HandleFunc("POST /api/setup/settings", a.operator(a.setupSave))
	m.HandleFunc("POST /api/setup/check-sfu", a.operator(a.setupCheckSFU))
	m.HandleFunc("GET /api/setup/updates", a.operator(a.updateStatus))
	m.HandleFunc("POST /api/setup/updates", a.operator(a.updateRequest))
	m.HandleFunc("POST /api/logout", a.auth(a.logout))
	m.HandleFunc("GET /api/me", a.auth(func(w http.ResponseWriter, r *http.Request) { send(w, 200, who(r)) }))
	m.HandleFunc("POST /api/password", a.auth(a.password))
	m.HandleFunc("GET /api/profile", a.auth(a.profile))
	m.HandleFunc("GET /api/accounts", a.auth(a.accounts))
	m.HandleFunc("POST /api/accounts", a.auth(a.accountSave))
	m.HandleFunc("POST /api/2fa", a.auth(a.twoFactor))
	m.HandleFunc("GET /api/catalog", a.auth(a.catalog))
	m.HandleFunc("POST /api/classes", a.auth(a.createClass))
	m.HandleFunc("POST /api/courses", a.auth(a.createCourse))
	m.HandleFunc("POST /api/classes/{id}/courses/batch", a.auth(a.courseBatch))
	m.HandleFunc("POST /api/classes/{id}/courses/{course}/delete", a.auth(a.deleteCourse))
	m.HandleFunc("GET /api/classes/{id}/students", a.auth(a.classStudents))
	m.HandleFunc("POST /api/classes/{id}/students/batch", a.auth(a.studentBatch))
	m.HandleFunc("POST /api/teachers/batch", a.auth(a.teacherBatch))
	m.HandleFunc("POST /api/teachers/import", a.auth(a.teacherImport))
	m.HandleFunc("POST /api/assignments", a.auth(a.assignTeachers))
	m.HandleFunc("POST /api/enrollments", a.auth(a.enroll))
	m.HandleFunc("POST /api/import", a.auth(a.importUsers))
	m.HandleFunc("GET /api/users", a.auth(a.users))
	m.HandleFunc("GET /api/classes", a.auth(func(w http.ResponseWriter, r *http.Request) {
		if !admin(w, r) {
			return
		}
		a.query(w, r, "SELECT id,short_id,name FROM classes WHERE school_id=? ORDER BY name LIMIT 1000", who(r).School)
	}))
	m.HandleFunc("GET /api/audit", a.auth(a.auditReport))
	m.HandleFunc("GET /api/meetings", a.auth(a.meetings))
	m.HandleFunc("GET /api/meetings/{id}", a.auth(func(w http.ResponseWriter, r *http.Request) {
		a.roomState(w, r)
	}))
	m.HandleFunc("POST /api/meetings/{id}/admission", a.auth(a.requestAdmission))
	m.HandleFunc("GET /api/meetings/{id}/members", a.auth(a.roomMembers))
	m.HandleFunc("POST /api/meetings/{id}/controls", a.auth(a.roomControl))
	m.HandleFunc("POST /api/meetings/{id}/moderate", a.auth(a.moderateMember))
	m.HandleFunc("GET /api/attendance/report", a.auth(a.attendanceReport))
	m.HandleFunc("GET /api/recordings", a.auth(a.recordingLibrary))
	m.HandleFunc("GET /api/attendance/policy", a.auth(a.attendancePolicy))
	m.HandleFunc("POST /api/attendance/policy", a.auth(a.attendancePolicy))
	m.HandleFunc("POST /api/attendance/adjust", a.auth(a.attendanceAdjust))
	m.HandleFunc("GET /api/attendance/timing", a.auth(a.attendanceTiming))
	m.HandleFunc("POST /api/attendance/timing", a.auth(a.attendanceTiming))
	m.HandleFunc("POST /api/meetings", a.auth(a.createMeeting))
	m.HandleFunc("POST /api/meetings/{id}/state", a.auth(a.meetingState))
	m.HandleFunc("POST /api/meetings/{id}/presence", a.auth(a.presence))
	m.HandleFunc("GET /api/meetings/{id}/attendance", a.auth(a.attendance))
	m.HandleFunc("POST /api/meetings/{id}/sfu", a.auth(a.sfu))
	m.HandleFunc("POST /api/meetings/{id}/media/reset", a.auth(a.mediaReset))
	m.HandleFunc("GET /api/meetings/{id}/tracks", a.auth(a.tracks))
	m.HandleFunc("GET /api/meetings/{id}/participants", a.auth(a.roomParticipants))
	m.HandleFunc("GET /api/meetings/{id}/messages", a.auth(a.roomMessages))
	m.HandleFunc("POST /api/meetings/{id}/messages", a.auth(a.sendMessage))
	m.HandleFunc("POST /api/meetings/{id}/hand", a.auth(a.raiseHand))
	m.HandleFunc("GET /api/meetings/{id}/reactions", a.auth(a.roomReactions))
	m.HandleFunc("POST /api/meetings/{id}/reactions", a.auth(a.roomReactions))
	m.HandleFunc("GET /api/meetings/{id}/polls", a.auth(a.roomPolls))
	m.HandleFunc("POST /api/meetings/{id}/polls", a.auth(a.roomPolls))
	m.HandleFunc("POST /api/meetings/{id}/polls/{poll}", a.auth(a.roomVote))
	m.HandleFunc("POST /api/meetings/{id}/ice", a.auth(a.ice))
	m.HandleFunc("POST /api/meetings/{id}/recordings", a.auth(a.recordingCreate))
	m.HandleFunc("POST /api/meetings/{id}/recordings/multipart", a.auth(a.recordingMultipartStart))
	m.HandleFunc("POST /api/meetings/{id}/recordings/{recording}/parts/{part}", a.auth(a.recordingMultipartPart))
	m.HandleFunc("POST /api/meetings/{id}/recordings/{recording}/finish", a.auth(a.recordingMutation(a.recordingMultipartFinish)))
	m.HandleFunc("POST /api/meetings/{id}/recordings/{recording}/abort", a.auth(a.recordingMutation(a.recordingMultipartAbort)))
	m.HandleFunc("GET /api/meetings/{id}/recordings", a.auth(a.recordingList))
	m.HandleFunc("POST /api/meetings/{id}/recordings/{recording}/complete", a.auth(a.recordingComplete))
	m.HandleFunc("GET /api/meetings/{id}/recordings/{recording}/download", a.auth(a.recordingDownload))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if _, err := os.Stat(configPath("managed.json")); err == nil && strings.HasPrefix(r.URL.Path, "/api/setup/") {
			problem(w, 404, "Cấu hình được quản lý tại trung tâm")
			return
		}
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
		if _, e := os.Stat(configPath("maintenance")); e == nil && r.URL.Path != "/api/health" && r.URL.Path != "/api/setup/unlock" && r.URL.Path != "/api/setup/status" && !(r.Method == "GET" && r.URL.Path == "/api/setup/updates") {
			w.Header().Set("Retry-After", "10")
			problem(w, 503, "Hệ thống đang cập nhật an toàn. Vui lòng chờ hoàn tất.")
			return
		}
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
	if e != nil {
		return e
	}
	if e = migrateV2(c); e != nil {
		return e
	}
	if e = migrateV3(c); e != nil {
		return e
	}
	if e = migrateV4(c); e != nil {
		return e
	}
	_, e = c.ExecContext(context.Background(), "INSERT IGNORE INTO schema_migrations VALUES(5)")
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
		case "configure-storage":
			cfg, err := loadSettings()
			e = err
			if e == nil && cfg.R2.Enabled {
				a := &app{client: &http.Client{Timeout: 40 * time.Second}, origin: os.Getenv("APP_ORIGIN")}
				e = a.configureBucket(context.Background(), cfg.R2, cfg.Retention)
			}
		case "managed-config", "managed-account", "managed-status":
			e = managedCommand(db, os.Args[1])
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
	go a.retentionLoop(ctx)
	go a.mediaCleanupLoop(ctx)
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
