package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	mysql "github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/bcrypt"
)

func TestManagedDemoImport(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN required")
	}
	base, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	for _, mode := range []string{"school", "academy"} {
		t.Run(mode, func(t *testing.T) {
			name := "demo_test_" + uid()
			if _, err := base.Exec("CREATE DATABASE " + name); err != nil {
				t.Fatal(err)
			}
			defer base.Exec("DROP DATABASE " + name)
			opt, _ := mysql.ParseDSN(dsn)
			opt.DBName = name
			db, err := sql.Open("mysql", opt.FormatDSN())
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if err = migrate(db); err != nil {
				t.Fatal(err)
			}
			t.Setenv("CONFIG_DIR", t.TempDir())
			if err = saveSettings(systemSettings{Platform: mode, Retention: 30}); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec("INSERT INTO schools(id,slug,name) VALUES('demo-school','demo','Demo')"); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES('demo-admin','demo-school','admin@example.test','Admin','preserve-admin','admin')"); err != nil {
				t.Fatal(err)
			}
			var preset demoPreset
			json.Unmarshal(demoVAPublic, &preset)
			passwords := map[string]string{}
			for _, account := range preset.Accounts {
				passwords[account.Key] = "test-random-" + uid()
			}
			raw, _ := json.Marshal(map[string]any{"passwords": passwords})
			if err = managedDemo(db, raw); err != nil {
				t.Fatal(err)
			}
			if err = managedDemo(db, raw); err != nil {
				t.Fatal("repeat import", err)
			}
			for table, expected := range map[string]int{"classes": 3, "courses": 15, "users": 15, "meetings": 15} {
				var n int
				if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != expected {
					t.Fatalf("%s count %d: %v", table, n, err)
				}
			}
			var hash, code string
			if err = db.QueryRow("SELECT password_hash,short_id FROM users WHERE email='student-10-1@demo.example.test'").Scan(&hash, &code); err != nil {
				t.Fatal(err)
			}
			if bcrypt.CompareHashAndPassword([]byte(hash), []byte(passwords["student-10-1"])) != nil || code == "" {
				t.Fatal("test account password/code missing")
			}
			if err = db.QueryRow("SELECT password_hash FROM users WHERE id='demo-admin'").Scan(&hash); err != nil || hash != "preserve-admin" {
				t.Fatal("existing admin changed")
			}
			if mode == "academy" {
				var content string
				if err = db.QueryRow("SELECT content FROM academy_site").Scan(&content); err != nil {
					t.Fatal(err)
				}
				var site academySite
				json.Unmarshal([]byte(content), &site)
				if len(site.CoursePages) != 15 || len(site.Posts) != 12 || len(site.Teachers) != 5 {
					t.Fatal("public content incomplete")
				}
			}
		})
	}
}
