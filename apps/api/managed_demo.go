package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

//go:embed demo_va_public.json
var demoVAPublic []byte

type demoAccount struct {
	Key, Email, Name, Role string
	Grade                  int
}
type demoCourse struct {
	Key, Subject, Title, Description string
	Grade                            int
	TeacherKey                       string `json:"teacher_key"`
	Page                             academyCoursePage
}
type demoPreset struct {
	Logo struct {
		Media string `json:"media_type"`
		Data  []byte `json:"data"`
	} `json:"logo"`
	Version  string
	Site     academySite
	Courses  []demoCourse
	Accounts []demoAccount
	Plans    []struct {
		Name  string
		Price int64 `json:"price_vnd"`
		Days  int
		Live  int `json:"live_enabled"`
	}
}

func demoID(school, key string) string { return digest(school + ":va-public-v1:" + key)[:32] }

// A narrow, operator-only seed command. It never copies VA accounts, credentials,
// payments or recordings, and never sends email. Real business data blocks import.
func managedDemo(db *sql.DB, raw []byte) error {
	var input struct{ Passwords map[string]string }
	if json.Unmarshal(raw, &input) != nil {
		return errors.New("INVALID_DEMO_INPUT")
	}
	var preset demoPreset
	if json.Unmarshal(demoVAPublic, &preset) != nil || preset.Version != "va-public-v1" || len(preset.Courses) != 15 {
		return errors.New("INVALID_DEMO_PRESET")
	}
	hashes := map[string]string{}
	for _, account := range preset.Accounts {
		pass := input.Passwords[account.Key]
		if len(pass) < 12 || len(pass) > 72 {
			return errors.New("DEMO_PASSWORD_REQUIRED")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(pass), 12)
		if err != nil {
			return err
		}
		hashes[account.Key] = string(hash)
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var school string
	var count int
	if err = tx.QueryRow("SELECT COUNT(*),COALESCE(MIN(id),'') FROM schools").Scan(&count, &school); err != nil || count != 1 {
		return errors.New("SINGLE_SCHOOL_REQUIRED")
	}
	if err = tx.QueryRow("SELECT id FROM schools WHERE id=? FOR UPDATE", school).Scan(&school); err != nil {
		return err
	}
	var report string
	err = tx.QueryRow("SELECT target FROM audit_log WHERE school_id=? AND action='hosting.demo.va-v1' LIMIT 1", school).Scan(&report)
	if err == nil {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"already_imported": true})
	}
	if err != sql.ErrNoRows {
		return err
	}
	// These tables must be empty. No UPDATE/DELETE is used on existing user data.
	for _, table := range []string{"classes", "courses", "academy_courses", "academy_plans", "meetings", "academy_orders", "academy_memberships"} {
		if err = tx.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE school_id=?", school).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return errors.New("DEMO_TARGET_NOT_EMPTY")
		}
	}
	if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE school_id=? AND role<>'admin'", school).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return errors.New("DEMO_TARGET_NOT_EMPTY")
	}
	var existing string
	err = tx.QueryRow("SELECT content FROM academy_site WHERE school_id=?", school).Scan(&existing)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	var current academySite
	_ = json.Unmarshal([]byte(existing), &current)
	if current.About != "" || len(current.Posts) > 0 || len(current.Teachers) > 0 {
		return errors.New("DEMO_WEBSITE_CONTENT_EXISTS")
	}
	var actor string
	if err = tx.QueryRow("SELECT id FROM users WHERE school_id=? AND role='admin' ORDER BY id LIMIT 1", school).Scan(&actor); err != nil {
		return err
	}
	for _, a := range preset.Accounts {
		id := demoID(school, a.Key)
		if _, err = tx.Exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,?)", id, school, a.Email, a.Name, hashes[a.Key], a.Role); err != nil {
			return err
		}
		kind := "GV"
		if a.Role == "student" {
			kind = "SV"
		}
		code, codeErr := shortCode(tx, kind, id)
		if codeErr != nil {
			return codeErr
		}
		if _, err = tx.Exec("UPDATE users SET short_id=?,student_code=IF(role='student',?,student_code) WHERE school_id=? AND id=?", code, code, school, id); err != nil {
			return err
		}
		if a.Role == "student" {
			if _, err = tx.Exec("INSERT INTO academy_profiles(school_id,user_id,dob,address,school_name,phone,parent_phone,avatar_key,email_verified) VALUES(?,?,?,'Việt Nam','THPT','0000000000','0000000000','',TRUE)", school, id, fmt.Sprintf("%d-01-01", 2020-a.Grade)); err != nil {
				return err
			}
			if academyEnabled() {
				if _, err = tx.Exec("INSERT INTO academy_memberships(school_id,user_id,expires_at,live_enabled) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 30 DAY,TRUE)", school, id); err != nil {
					return err
				}
			}
		}
	}
	for _, grade := range []int{10, 11, 12} {
		id := demoID(school, fmt.Sprintf("class-%d", grade))
		if _, err = tx.Exec("INSERT INTO classes(id,school_id,name) VALUES(?,?,?)", id, school, fmt.Sprintf("Khối %d", grade)); err != nil {
			return err
		}
		code, codeErr := shortCode(tx, "LH", id)
		if codeErr != nil {
			return codeErr
		}
		if _, err = tx.Exec("UPDATE classes SET short_id=? WHERE school_id=? AND id=?", code, school, id); err != nil {
			return err
		}
		for _, a := range preset.Accounts {
			if a.Role == "student" && a.Grade == grade {
				if _, err = tx.Exec("INSERT INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", school, id, demoID(school, a.Key)); err != nil {
					return err
				}
			}
		}
	}
	preset.Site.CoursePages = map[string]academyCoursePage{}
	for _, c := range preset.Courses {
		id := demoID(school, "course-"+c.Key)
		teacher := demoID(school, c.TeacherKey)
		if _, err = tx.Exec("INSERT INTO courses(id,school_id,class_id,teacher_id,name) VALUES(?,?,?,?,?)", id, school, demoID(school, fmt.Sprintf("class-%d", c.Grade)), teacher, c.Subject); err != nil {
			return err
		}
		code, codeErr := shortCode(tx, "MH", id)
		if codeErr != nil {
			return codeErr
		}
		if _, err = tx.Exec("UPDATE courses SET short_id=? WHERE school_id=? AND id=?", code, school, id); err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO meetings(id,school_id,course_id,title,starts_at,status,recording_allowed) VALUES(?,?,?,?,UTC_TIMESTAMP()+INTERVAL 1 DAY,'scheduled',FALSE)", demoID(school, "meeting-"+c.Key), school, id, "Giới thiệu "+c.Title); err != nil {
			return err
		}
		if academyEnabled() {
			aid := demoID(school, "academy-"+c.Key)
			name := ""
			for _, a := range preset.Accounts {
				if a.Key == c.TeacherKey {
					name = a.Name
				}
			}
			if _, err = tx.Exec("INSERT INTO academy_courses(id,school_id,title,description,teacher_name,academic_course_id,published) VALUES(?,?,?,?,?,?,TRUE)", aid, school, c.Title, c.Description, name, id); err != nil {
				return err
			}
			preset.Site.CoursePages[aid] = c.Page
		}
	}
	if academyEnabled() {
		for i, p := range preset.Plans {
			if _, err = tx.Exec("INSERT INTO academy_plans(id,school_id,name,price_vnd,days,live_enabled,active) VALUES(?,?,?,?,?,?,TRUE)", demoID(school, fmt.Sprintf("plan-%d", i)), school, p.Name, p.Price, p.Days, p.Live != 0); err != nil {
				return err
			}
		}
		if len(preset.Logo.Data) > 0 && len(preset.Logo.Data) <= 512<<10 && (preset.Logo.Media == "image/jpeg" || preset.Logo.Media == "image/png") {
			if _, err = tx.Exec("INSERT IGNORE INTO academy_logos(school_id,media_type,image_data,revision) VALUES(?,?,?,?)", school, preset.Logo.Media, preset.Logo.Data, uid()); err != nil {
				return err
			}
		}
		content, err := json.Marshal(preset.Site)
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO academy_site(school_id,content) VALUES(?,?) ON DUPLICATE KEY UPDATE content=VALUES(content)", school, string(content)); err != nil {
			return err
		}
	}
	result := map[string]any{"classes": 3, "subjects": 15, "teachers": 5, "students": 9, "scheduled_lessons": 15, "source": "va.tn.edu.vn"}
	if academyEnabled() {
		result["courses"] = 15
		result["plans"] = len(preset.Plans)
		result["posts"] = len(preset.Site.Posts)
	}
	packed, _ := json.Marshal(result)
	if len(packed) > 200 {
		return errors.New("DEMO_REPORT_TOO_LARGE")
	}
	if _, err = tx.Exec("INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'hosting.demo.va-v1',?)", school, actor, string(packed)); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}
