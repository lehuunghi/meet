package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

func (a *app) query(w http.ResponseWriter, r *http.Request, q string, args ...any) {
	pageSize := 1000
	if r.URL.Path == "/api/academic/operations" && strings.HasSuffix(q, "LIMIT 200") {
		pageSize = 200
	}
	directory := (strings.HasSuffix(q, "LIMIT 1000") && (r.URL.Path == "/api/catalog" || r.URL.Path == "/api/users" || r.URL.Path == "/api/accounts" || r.URL.Path == "/api/classes" || strings.HasSuffix(r.URL.Path, "/students"))) || (pageSize == 200)
	page := 0
	if directory {
		var err error
		if raw := r.URL.Query().Get("page"); raw != "" {
			page, err = strconv.Atoi(raw)
		}
		if err != nil || page < 0 || page > 100000 {
			problem(w, 400, "Trang không hợp lệ")
			return
		}
		q = strings.TrimSuffix(q, fmt.Sprintf("LIMIT %d", pageSize)) + fmt.Sprintf("LIMIT %d OFFSET ?", pageSize+1)
		args = append(args, page*pageSize)
	}
	rows, e := a.db.QueryContext(r.Context(), q, args...)
	if e != nil {
		problem(w, 500, "Database unavailable")
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	out := make([]map[string]any, 0)
	for rows.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if rows.Scan(p...) != nil {
			problem(w, 500, "Read failed")
			return
		}
		m := map[string]any{}
		for i, c := range cols {
			if b, ok := v[i].([]byte); ok {
				m[c] = string(b)
			} else {
				m[c] = v[i]
			}
		}
		out = append(out, m)
	}
	if rows.Err() != nil {
		problem(w, 500, "Read failed")
		return
	}
	if r.URL.Path == "/api/attendance/report" && r.URL.Query().Get("format") == "xlsx" {
		exportAttendance(w, r, out)
		return
	}
	if directory && len(out) > pageSize {
		out = out[:pageSize]
		w.Header().Set("X-Next-Page", strconv.Itoa(page+1))
	}
	send(w, 200, out)
}
func (a *app) catalog(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, `SELECT c.id,c.short_id,c.revision,
(SELECT lm.id FROM meetings lm WHERE NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=lm.school_id AND bx.meeting_id=lm.id) AND lm.school_id=c.school_id AND lm.course_id=c.id AND lm.status IN ('live','scheduled') ORDER BY (lm.status='live') DESC,lm.starts_at ASC LIMIT 1) AS ready_meeting_id,
(SELECT lm.status FROM meetings lm WHERE NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=lm.school_id AND bx.meeting_id=lm.id) AND lm.school_id=c.school_id AND lm.course_id=c.id AND lm.status IN ('live','scheduled') ORDER BY (lm.status='live') DESC,lm.starts_at ASC LIMIT 1) AS ready_status,(SELECT COUNT(*) FROM meetings lm WHERE NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms bx WHERE bx.school_id=lm.school_id AND bx.meeting_id=lm.id) AND lm.school_id=c.school_id AND lm.course_id=c.id AND NOT EXISTS(SELECT 1 FROM lesson_cancellations lc WHERE lc.school_id=lm.school_id AND lc.meeting_id=lm.id)) AS lesson_count,COALESCE((SELECT JSON_ARRAYAGG(ca.user_id) FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id),JSON_ARRAY()) AS assistant_ids,c.name,c.class_id,cl.name AS class_name,COALESCE((SELECT state FROM class_controls cc WHERE cc.school_id=c.school_id AND cc.class_id=c.class_id),'active') AS class_state,c.teacher_id,COALESCE(u.name,'Chưa phân công') AS teacher FROM courses c JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id LEFT JOIN users u ON u.id=c.teacher_id AND u.school_id=c.school_id WHERE c.school_id=? AND (?='admin' OR (?='teacher' AND EXISTS(SELECT 1 FROM users assigned WHERE assigned.id=? AND assigned.school_id=c.school_id AND (assigned.id=c.teacher_id OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=assigned.id)))) OR (?='student' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.class_id=c.class_id AND e.user_id=?))) ORDER BY c.name LIMIT 1000`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
}
func (a *app) users(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	a.query(w, r, "SELECT u.id,u.short_id,u.student_code,u.revision,u.email,u.name,u.role,u.active,COALESCE(uc.state,IF(u.active,'active','disabled')) AS state FROM users u LEFT JOIN user_controls uc ON uc.user_id=u.id WHERE u.school_id=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=u.school_id AND d.user_id=u.id) ORDER BY name LIMIT 1000", who(r).School)
}
func (a *app) createClass(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 100 {
		problem(w, 400, "Invalid class name")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	id := uid()
	code, e := shortCode(tx, "LH", id)
	if e != nil {
		problem(w, 500, "Không cấp được ID")
		return
	}
	if _, e := tx.ExecContext(r.Context(), "INSERT INTO classes(id,school_id,name,short_id) VALUES(?,?,?,?)", id, who(r).School, in.Name, code); e != nil {
		problem(w, 409, "Class already exists or cannot be created")
		return
	}
	if tx.Commit() != nil {
		problem(w, 500, "Không lưu được lớp")
		return
	}
	a.audit(r, "class.create", code)
	send(w, 201, map[string]string{"id": id, "short_id": code})
}
func (a *app) createCourse(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Name    string `json:"name"`
		Class   string `json:"class_id"`
		Teacher string `json:"teacher_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 {
		problem(w, 400, "Invalid name")
		return
	}
	school := who(r).School
	var class, teacher string
	if a.db.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND (id=? OR short_id=?) AND NOT EXISTS(SELECT 1 FROM class_controls cc WHERE cc.school_id=classes.school_id AND cc.class_id=classes.id AND cc.state='deleted')", school, in.Class, in.Class).Scan(&class) != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	if in.Teacher != "" && a.db.QueryRowContext(r.Context(), "SELECT id FROM users WHERE school_id=? AND role='teacher' AND active=TRUE AND (id=? OR short_id=?)", school, in.Teacher, in.Teacher).Scan(&teacher) != nil {
		problem(w, 404, "Không tìm thấy giáo viên")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	id := uid()
	code, e := shortCode(tx, "MH", id)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "INSERT INTO courses(id,school_id,class_id,teacher_id,name,short_id) VALUES(?,?,?,NULLIF(?,''),?,?)", id, school, class, teacher, strings.TrimSpace(in.Name), code)
	}
	if e != nil || tx.Commit() != nil {
		problem(w, 409, "Không tạo được môn")
		return
	}
	a.audit(r, "course.create", code)
	send(w, 201, map[string]string{"id": id, "short_id": code})
}
func (a *app) enroll(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Class string `json:"class_id"`
		User  string `json:"user_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	u := who(r)
	var resolvedClass, resolvedUser string
	if a.db.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND (id=? OR short_id=?) AND NOT EXISTS(SELECT 1 FROM class_controls cc WHERE cc.school_id=classes.school_id AND cc.class_id=classes.id AND cc.state='deleted')", u.School, in.Class, in.Class).Scan(&resolvedClass) != nil || a.db.QueryRowContext(r.Context(), "SELECT id FROM users WHERE school_id=? AND role='student' AND active=TRUE AND (id=? OR short_id=?)", u.School, in.User, in.User).Scan(&resolvedUser) != nil {
		problem(w, 404, "Không tìm thấy lớp/học sinh")
		return
	}
	in.Class = resolvedClass
	in.User = resolvedUser
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa lưu được học sinh")
		return
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(r.Context(), `INSERT IGNORE INTO enrollments(school_id,class_id,user_id) SELECT ?,c.id,u.id FROM classes c JOIN users u ON u.school_id=c.school_id AND u.id=? AND u.role='student' WHERE c.school_id=? AND c.id=?`, u.School, in.User, u.School, in.Class)
	if e != nil {
		problem(w, 400, "Enrollment failed")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 409, "Invalid or existing enrollment")
		return
	}
	if e = syncLiveRoster(r.Context(), tx, u.School, in.Class, in.User); e != nil {
		problem(w, 503, "Chưa cập nhật buổi đang học")
		return
	}
	if e = tx.Commit(); e != nil {
		problem(w, 503, "Chưa lưu được học sinh")
		return
	}
	a.audit(r, "enrollment.create", in.User)
	send(w, 201, map[string]bool{"ok": true})
}

type importRow struct{ Email, Name, Role, Password, Class string }

func validateImport(rows [][]string) ([]importRow, error) {
	if len(rows) < 2 || len(rows) > 101 {
		return nil, fmt.Errorf("Workbook must contain 1–100 users")
	}
	expected := []string{"email", "name", "role", "password", "class"}
	if len(rows[0]) != 5 {
		return nil, fmt.Errorf("Header: email,name,role,password,class")
	}
	for i, h := range expected {
		if rows[0][i] != h {
			return nil, fmt.Errorf("Header: email,name,role,password,class")
		}
	}
	seen := map[string]bool{}
	out := []importRow{}
	for i, row := range rows[1:] {
		if len(row) < 4 || len(row) > 5 {
			return nil, fmt.Errorf("Row %d: expected 4–5 cells", i+2)
		}
		v := importRow{Email: strings.ToLower(strings.TrimSpace(row[0])), Name: strings.TrimSpace(row[1]), Role: row[2], Password: row[3]}
		if len(row) == 5 {
			v.Class = strings.TrimSpace(row[4])
		}
		addr, e := mail.ParseAddress(v.Email)
		if e != nil || addr.Address != v.Email || len(v.Email) > 190 || v.Name == "" || len(v.Name) > 200 || len(v.Class) > 100 || !validAccountPassword(v.Role, v.Password) || (v.Role != "student" && v.Role != "teacher") || seen[v.Email] {
			return nil, fmt.Errorf("Row %d: invalid email/name/role/password/class or duplicate email", i+2)
		}
		if v.Role != "student" && v.Class != "" {
			return nil, fmt.Errorf("Row %d: class only applies to students", i+2)
		}
		seen[v.Email] = true
		out = append(out, v)
	}
	return out, nil
}
func (a *app) importUsers(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if r.ParseMultipartForm(4<<20) != nil {
		problem(w, 400, "Upload XLSX under 4 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("file")
	if e != nil {
		problem(w, 400, "Missing file")
		return
	}
	defer f.Close()
	book, e := excelize.OpenReader(f, excelize.Options{UnzipSizeLimit: 20 << 20, UnzipXMLSizeLimit: 8 << 20})
	if e != nil {
		problem(w, 400, "Invalid XLSX")
		return
	}
	defer book.Close()
	sheets := book.GetSheetList()
	if len(sheets) != 1 {
		problem(w, 400, "Exactly one worksheet required")
		return
	}
	cells, e := book.GetRows(sheets[0])
	if e != nil {
		problem(w, 400, "Invalid worksheet")
		return
	}
	rows, e := validateImport(cells)
	if e != nil {
		problem(w, 400, e.Error())
		return
	}
	// Hash before transaction, then commit all rows or none; existing users are never overwritten.
	hashes := make([][]byte, len(rows))
	for i, v := range rows {
		hashes[i], e = bcrypt.GenerateFromPassword([]byte(v.Password), 12)
		if e != nil {
			problem(w, 500, "Password hashing failed")
			return
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	u := who(r)
	for i, v := range rows {
		id := uid()
		kind := "GV"
		if v.Role == "student" {
			kind = "SV"
		}
		code, err := shortCode(tx, kind, id)
		if err != nil {
			problem(w, 500, "Không cấp ID")
			return
		}
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role,short_id) VALUES(?,?,?,?,?,?,?)", id, u.School, v.Email, v.Name, hashes[i], v.Role, code); e != nil {
			problem(w, 409, fmt.Sprintf("Row %d conflicts; no users imported", i+2))
			return
		}
		if v.Class != "" {
			var class string
			e = tx.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND name=?", u.School, v.Class).Scan(&class)
			if e == sql.ErrNoRows {
				class = uid()
				classCode, err := shortCode(tx, "LH", class)
				if err != nil {
					problem(w, 500, "Không cấp ID lớp")
					return
				}
				_, e = tx.ExecContext(r.Context(), "INSERT INTO classes(id,school_id,name,short_id) VALUES(?,?,?,?)", class, u.School, v.Class, classCode)
			}
			if e != nil {
				problem(w, 409, "Class conflict; no users imported")
				return
			}
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO enrollments VALUES(?,?,?)", u.School, class, id); e != nil {
				problem(w, 409, "Enrollment failed; no users imported")
				return
			}
			if e = syncLiveRoster(r.Context(), tx, u.School, class, id); e != nil {
				problem(w, 503, "Chưa cập nhật danh sách buổi đang học")
				return
			}
		}
	}
	if tx.Commit() != nil {
		problem(w, 500, "Import commit failed")
		return
	}
	a.audit(r, "users.import", fmt.Sprint(len(rows)))
	send(w, 201, map[string]int{"imported": len(rows)})
}
