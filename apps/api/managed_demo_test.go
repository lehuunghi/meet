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
	for _, mode := range []string{"school", "academy", "academy-merge"} {
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
			if err = saveSettings(systemSettings{Platform: func() string {
				if mode == "academy-merge" {
					return "academy"
				}
				return mode
			}(), Retention: 30}); err != nil {
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
			input := map[string]any{"passwords": passwords}
			if mode == "academy-merge" {
				statements := []string{
					"INSERT INTO classes(id,school_id,name) VALUES('old-class','demo-school','Lớp cũ')",
					"INSERT INTO courses(id,school_id,class_id,name) VALUES('old-subject','demo-school','old-class','Môn cũ')",
					"INSERT INTO academy_courses(id,school_id,title,description,published) VALUES('old-course','demo-school','Khóa cũ','Giữ mô tả',TRUE)",
					`INSERT INTO academy_site(school_id,content) VALUES('demo-school','{"headline":"Tiêu đề cũ","published":false,"posts":[{"Slug":"bai-cu","Title":"Bài cũ"}],"course_pages":{"old-course":{"outline":"Nội dung cũ"}},"custom":"preserved"}')`,
				}
				for _, statement := range statements {
					if _, err = db.Exec(statement); err != nil {
						t.Fatal(err)
					}
				}
				blocked, _ := json.Marshal(input)
				if err = managedDemo(db, blocked); err == nil || err.Error() != "DEMO_TARGET_NOT_EMPTY" {
					t.Fatal("strict import must block existing data", err)
				}
				input["mode"] = "merge"
			}
			raw, _ := json.Marshal(input)
			if err = managedDemo(db, raw); err != nil {
				t.Fatal(err)
			}
			if err = managedDemo(db, raw); err != nil {
				t.Fatal("repeat import", err)
			}
			for table, expected := range map[string]int{"classes": 3, "courses": 15, "users": 15, "meetings": 15} {
				if mode == "academy-merge" && (table == "classes" || table == "courses") {
					expected++
				}
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
			if mode == "academy" || mode == "academy-merge" {
				var content string
				if err = db.QueryRow("SELECT content FROM academy_site").Scan(&content); err != nil {
					t.Fatal(err)
				}
				var site academySite
				json.Unmarshal([]byte(content), &site)
				pages, posts := 15, 12
				if mode == "academy-merge" {
					pages++
					posts++
					if site.Headline != "Tiêu đề cũ" || site.Published || site.CoursePages["old-course"].Outline != "Nội dung cũ" {
						t.Fatal("existing website content changed")
					}
					var title, description string
					if err = db.QueryRow("SELECT title,description FROM academy_courses WHERE id='old-course'").Scan(&title, &description); err != nil || title != "Khóa cũ" || description != "Giữ mô tả" {
						t.Fatal("existing course changed", err)
					}
				}
				if len(site.CoursePages) != pages || len(site.Posts) != posts || len(site.Teachers) != 5 {
					t.Fatal("public content incomplete")
				}
			}
		})
	}
}

func TestDemoContentMergePreservesExistingAndDeduplicates(t *testing.T) {
	old := []byte(`{"headline":"Keep","published":false,"custom":{"keep":true},"posts":[{"Slug":"a","Title":"Original"}],"faqs":[{"Question":"Q","Answer":"Keep"}]}`)
	incoming := []byte(`{"headline":"Replace","published":true,"posts":[{"Slug":"a","Title":"Replace"},{"Slug":"b","Title":"New"}],"faqs":[{"Question":"Q","Answer":"Replace"},{"Question":"Other","Answer":"New"}]}`)
	merged, err := mergeDemoContent(old, incoming)
	if err != nil {
		t.Fatal(err)
	}
	again, err := mergeDemoContent(merged, incoming)
	if err != nil || string(again) != string(merged) {
		t.Fatal("merge is not idempotent", err)
	}
	var site academySite
	json.Unmarshal(merged, &site)
	if site.Headline != "Keep" || site.Published || len(site.Posts) != 2 || site.Posts[0].Title != "Original" || len(site.FAQs) != 2 || site.FAQs[0].Answer != "Keep" {
		t.Fatal("existing content overwritten or duplicates appended")
	}
	var raw map[string]json.RawMessage
	json.Unmarshal(merged, &raw)
	if _, ok := raw["custom"]; !ok {
		t.Fatal("unknown settings lost")
	}
}
