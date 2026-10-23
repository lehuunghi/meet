package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/mail"
	"strings"

	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

func (a *app) query(w http.ResponseWriter, r *http.Request, q string, args ...any) {
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
	send(w, 200, out)
}
func (a *app) catalog(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, `SELECT c.id,c.name,c.class_id,cl.name AS class_name,c.teacher_id,u.name AS teacher FROM courses c JOIN classes cl ON cl.id=c.class_id AND cl.school_id=c.school_id JOIN users u ON u.id=c.teacher_id AND u.school_id=c.school_id WHERE c.school_id=? AND (?='admin' OR (?='teacher' AND c.teacher_id=?) OR (?='student' AND EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.class_id=c.class_id AND e.user_id=?))) ORDER BY c.name LIMIT 1000`, u.School, u.Role, u.Role, u.ID, u.Role, u.ID)
}
func (a *app) users(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	a.query(w, r, "SELECT id,email,name,role,active FROM users WHERE school_id=? ORDER BY name LIMIT 1000", who(r).School)
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
	id := uid()
	if _, e := a.db.ExecContext(r.Context(), "INSERT INTO classes(id,school_id,name) VALUES(?,?,?)", id, who(r).School, in.Name); e != nil {
		problem(w, 409, "Class already exists or cannot be created")
		return
	}
	a.audit(r, "class.create", id)
	send(w, 201, map[string]string{"id": id})
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
	id := uid()
	u := who(r)
	res, e := a.db.ExecContext(r.Context(), `INSERT INTO courses(id,school_id,name,class_id,teacher_id) SELECT ?,?,?,c.id,t.id FROM classes c JOIN users t ON t.school_id=c.school_id AND t.id=? AND t.role='teacher' AND t.active=TRUE WHERE c.id=? AND c.school_id=?`, id, u.School, in.Name, in.Teacher, in.Class, u.School)
	if e != nil {
		problem(w, 400, "Invalid class or teacher")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 400, "Invalid class or teacher")
		return
	}
	a.audit(r, "course.create", id)
	send(w, 201, map[string]string{"id": id})
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
	res, e := a.db.ExecContext(r.Context(), `INSERT IGNORE INTO enrollments(school_id,class_id,user_id) SELECT ?,c.id,u.id FROM classes c JOIN users u ON u.school_id=c.school_id AND u.id=? AND u.role='student' WHERE c.school_id=? AND c.id=?`, u.School, in.User, u.School, in.Class)
	if e != nil {
		problem(w, 400, "Enrollment failed")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 409, "Invalid or existing enrollment")
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
		if e != nil || addr.Address != v.Email || len(v.Email) > 190 || v.Name == "" || len(v.Name) > 200 || len(v.Class) > 100 || len(v.Password) < 12 || len(v.Password) > 72 || (v.Role != "student" && v.Role != "teacher") || seen[v.Email] {
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
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,?)", id, u.School, v.Email, v.Name, hashes[i], v.Role); e != nil {
			problem(w, 409, fmt.Sprintf("Row %d conflicts; no users imported", i+2))
			return
		}
		if v.Class != "" {
			var class string
			e = tx.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND name=?", u.School, v.Class).Scan(&class)
			if e == sql.ErrNoRows {
				class = uid()
				_, e = tx.ExecContext(r.Context(), "INSERT INTO classes(id,school_id,name) VALUES(?,?,?)", class, u.School, v.Class)
			}
			if e != nil {
				problem(w, 409, "Class conflict; no users imported")
				return
			}
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO enrollments VALUES(?,?,?)", u.School, class, id); e != nil {
				problem(w, 409, "Enrollment failed; no users imported")
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
