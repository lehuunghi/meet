package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

func shortCode(tx *sql.Tx, kind, id string) (string, error) {
	if _, e := tx.Exec("INSERT IGNORE INTO entity_codes(kind,entity_id) VALUES(?,?)", kind, id); e != nil {
		return "", e
	}
	var n int
	err := tx.QueryRow("SELECT number FROM entity_short_codes WHERE entity_id=?", id).Scan(&n)
	if err == nil {
		return fmt.Sprintf("%s%04d", kind, n), nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}
	if _, err = tx.Exec("INSERT IGNORE INTO code_counters(kind,value) VALUES(?,0)", kind); err != nil {
		return "", err
	}
	if _, err = tx.Exec("UPDATE code_counters SET value=value+1 WHERE kind=?", kind); err != nil {
		return "", err
	}
	if err = tx.QueryRow("SELECT value FROM code_counters WHERE kind=?", kind).Scan(&n); err != nil {
		return "", err
	}
	if n > 9999 {
		return "", fmt.Errorf("four-digit %s identifier capacity exhausted", kind)
	}
	if _, err = tx.Exec("INSERT INTO entity_short_codes(kind,number,entity_id) VALUES(?,?,?)", kind, n, id); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%04d", kind, n), nil
}
func (a *app) teacherImport(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if r.ParseMultipartForm(4<<20) != nil {
		problem(w, 400, "Chọn XLSX dưới 4 MiB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, e := r.FormFile("file")
	if e != nil {
		problem(w, 400, "Thiếu file")
		return
	}
	defer f.Close()
	book, e := excelize.OpenReader(f, excelize.Options{UnzipSizeLimit: 20 << 20, UnzipXMLSizeLimit: 8 << 20})
	if e != nil {
		problem(w, 400, "XLSX không hợp lệ")
		return
	}
	defer book.Close()
	sheets := book.GetSheetList()
	if len(sheets) != 1 {
		problem(w, 400, "File chỉ có 1 sheet")
		return
	}
	cells, e := book.GetRows(sheets[0])
	if e != nil || len(cells) < 2 || len(cells) > 101 || len(cells[0]) != 3 || strings.Join(cells[0], ",") != "email,name,password" {
		problem(w, 400, "Header đúng: email,name,password; 1–100 giáo viên")
		return
	}
	rows := []accountRow{}
	for i, v := range cells[1:] {
		if len(v) != 3 {
			problem(w, 400, fmt.Sprintf("Dòng %d cần đủ 3 cột", i+2))
			return
		}
		rows = append(rows, accountRow{Email: v[0], Name: v[1], Password: v[2]})
	}
	a.saveAccounts(w, r, rows, "teacher", "")
}
func (a *app) classID(r *http.Request) (string, error) {
	var id string
	e := a.db.QueryRowContext(r.Context(), "SELECT id FROM classes WHERE school_id=? AND (id=? OR short_id=?)", who(r).School, r.PathValue("id"), r.PathValue("id")).Scan(&id)
	return id, e
}
func (a *app) classStudents(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	id, e := a.classID(r)
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	a.query(w, r, `SELECT u.id,u.short_id,u.student_code,u.email,u.name,u.revision FROM enrollments e JOIN users u ON u.id=e.user_id AND u.school_id=e.school_id WHERE e.school_id=? AND e.class_id=? AND u.role='student' ORDER BY u.short_id LIMIT 1000`, who(r).School, id)
}

type accountRow struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Code     string `json:"student_code"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Revision int    `json:"revision"`
}

var studentCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9._-]{0,39}$`)

func validateAccounts(rows []accountRow, role string) error {
	if len(rows) < 1 || len(rows) > 100 {
		return fmt.Errorf("Nhập 1–100 dòng mỗi lượt")
	}
	emails, codes, ids := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i := range rows {
		v := &rows[i]
		v.Email = strings.ToLower(strings.TrimSpace(v.Email))
		v.Code = strings.ToUpper(strings.TrimSpace(v.Code))
		v.Name = strings.TrimSpace(v.Name)
		addr, e := mail.ParseAddress(v.Email)
		if e != nil || addr.Address != v.Email || len(v.Email) > 190 || len(v.Name) == 0 || len(v.Name) > 200 || emails[v.Email] || (v.ID != "" && (ids[v.ID] || v.Revision < 1)) || (v.ID == "" && v.Password == "") || (v.Password != "" && !validAccountPassword(role, v.Password)) {
			return fmt.Errorf("Dòng %d: kiểm tra email, tên, ID/phiên bản hoặc mật khẩu ít nhất 6 ký tự, tối đa 72 byte", i+1)
		}
		if role == "student" && (!studentCodePattern.MatchString(v.Code) || codes[v.Code]) {
			return fmt.Errorf("Dòng %d: mã SV duy nhất, 1–40 ký tự A–Z, 0–9, dấu . _ -", i+1)
		}
		if role == "teacher" && v.Code != "" {
			return fmt.Errorf("Giáo viên không dùng cột mã SV")
		}
		emails[v.Email] = true
		codes[v.Code] = true
		if v.ID != "" {
			ids[v.ID] = true
		}
	}
	return nil
}
func (a *app) saveAccounts(w http.ResponseWriter, r *http.Request, rows []accountRow, role, class string) {
	if e := validateAccounts(rows, role); e != nil {
		problem(w, 400, e.Error())
		return
	}
	hashes := make([][]byte, len(rows))
	for i, v := range rows {
		if v.Password != "" {
			h, e := bcrypt.GenerateFromPassword([]byte(v.Password), 12)
			if e != nil {
				problem(w, 500, "Không tạo được mật khẩu")
				return
			}
			hashes[i] = h
		}
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	out := []map[string]string{}
	school := who(r).School
	for i, v := range rows {
		id, code := uid(), ""
		if v.ID == "" {
			kind := "GV"
			if role == "student" {
				kind = "SV"
			}
			code, e = shortCode(tx, kind, id)
			if e == nil {
				_, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,school_id,short_id,student_code,email,name,password_hash,role) VALUES(?,?,?,NULLIF(?,''),?,?,?,?)", id, school, code, v.Code, v.Email, v.Name, hashes[i], role)
			}
		} else {
			var revision int
			e = tx.QueryRowContext(r.Context(), "SELECT id,short_id,revision FROM users WHERE school_id=? AND role=? AND (id=? OR short_id=?) FOR UPDATE", school, role, v.ID, v.ID).Scan(&id, &code, &revision)
			if e == nil && revision != v.Revision {
				problem(w, 409, fmt.Sprintf("Dòng %d đã thay đổi, tải lại trước khi sửa", i+1))
				return
			}
			if e == nil && role == "student" && class != "" {
				var n int
				e = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM enrollments WHERE school_id=? AND class_id=? AND user_id=?", school, class, id).Scan(&n)
				if e == nil && n != 1 {
					problem(w, 404, "Học sinh không thuộc lớp này; dùng mục gán tài khoản có sẵn")
					return
				}
			}
			if e == nil {
				_, e = tx.ExecContext(r.Context(), "UPDATE users SET email=?,student_code=NULLIF(?,''),name=?,password_hash=IF(?='',password_hash,?),revision=revision+1,session_version=session_version+1 WHERE school_id=? AND id=?", v.Email, v.Code, v.Name, string(hashes[i]), hashes[i], school, id)
			}
		}
		if e != nil {
			problem(w, 409, fmt.Sprintf("Dòng %d bị trùng email/mã SV hoặc ID không hợp lệ; chưa lưu dòng nào", i+1))
			return
		}
		if class != "" {
			if _, e = tx.ExecContext(r.Context(), "INSERT IGNORE INTO enrollments(school_id,class_id,user_id) VALUES(?,?,?)", school, class, id); e != nil {
				problem(w, 409, "Không phân lớp được; chưa lưu dòng nào")
				return
			}
		}
		out = append(out, map[string]string{"id": id, "short_id": code})
	}
	if tx.Commit() != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, role+".batch", fmt.Sprint(len(rows)))
	send(w, 200, map[string]any{"saved": len(rows), "items": out})
}
func (a *app) studentBatch(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	class, e := a.classID(r)
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	var in struct {
		Rows []accountRow `json:"rows"`
	}
	if !decode(w, r, &in) {
		return
	}
	a.saveAccounts(w, r, in.Rows, "student", class)
}
func (a *app) teacherBatch(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Rows []accountRow `json:"rows"`
	}
	if !decode(w, r, &in) {
		return
	}
	a.saveAccounts(w, r, in.Rows, "teacher", "")
}

type courseRow struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Revision int    `json:"revision"`
}

func (a *app) courseBatch(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	class, e := a.classID(r)
	if e != nil {
		problem(w, 404, "Không tìm thấy lớp")
		return
	}
	var in struct {
		Rows []courseRow `json:"rows"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Rows) < 1 || len(in.Rows) > 100 {
		problem(w, 400, "Nhập 1–100 môn")
		return
	}
	seen := map[string]bool{}
	for _, v := range in.Rows {
		if strings.TrimSpace(v.Name) == "" || len(v.Name) > 200 || seen[v.ID] && v.ID != "" {
			problem(w, 400, "Tên môn trống/quá dài hoặc ID trùng")
			return
		}
		seen[v.ID] = true
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	school := who(r).School
	for i, v := range in.Rows {
		if v.ID == "" {
			id := uid()
			code, err := shortCode(tx, "MH", id)
			e = err
			if e == nil {
				_, e = tx.ExecContext(r.Context(), "INSERT INTO courses(id,school_id,class_id,teacher_id,name,short_id) VALUES(?,?,?,NULL,?,?)", id, school, class, strings.TrimSpace(v.Name), code)
			}
		} else {
			var id string
			var rev int
			e = tx.QueryRowContext(r.Context(), "SELECT id,revision FROM courses WHERE school_id=? AND class_id=? AND (id=? OR short_id=?) FOR UPDATE", school, class, v.ID, v.ID).Scan(&id, &rev)
			if e == nil && rev != v.Revision {
				problem(w, 409, "Môn đã được sửa; tải lại trước khi lưu")
				return
			}
			if e == nil {
				_, e = tx.ExecContext(r.Context(), "UPDATE courses SET name=?,revision=revision+1 WHERE school_id=? AND id=?", strings.TrimSpace(v.Name), school, id)
			}
		}
		if e != nil {
			problem(w, 409, fmt.Sprintf("Môn dòng %d không hợp lệ; chưa lưu dòng nào", i+1))
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, "courses.batch", class)
	send(w, 200, map[string]int{"saved": len(in.Rows)})
}
func (a *app) assignTeachers(w http.ResponseWriter, r *http.Request) {
	if !admin(w, r) {
		return
	}
	var in struct {
		Rows []struct {
			Assistants []string `json:"assistant_ids"`
			Course     string   `json:"course_id"`
			Teacher    string   `json:"teacher_id"`
			Revision   int      `json:"revision"`
		} `json:"rows"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Rows) < 1 || len(in.Rows) > 100 {
		problem(w, 400, "Nhập 1–100 phân công")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Database unavailable")
		return
	}
	defer tx.Rollback()
	school := who(r).School
	seen := map[string]bool{}
	for _, v := range in.Rows {
		var course string
		var rev int
		e = tx.QueryRowContext(r.Context(), "SELECT id,revision FROM courses WHERE school_id=? AND (id=? OR short_id=?) FOR UPDATE", school, v.Course, v.Course).Scan(&course, &rev)
		if e != nil {
			problem(w, 404, "Không tìm thấy môn")
			return
		}
		if seen[course] || rev != v.Revision {
			problem(w, 409, "Dòng trùng hoặc môn đã thay đổi; tải lại bảng")
			return
		}
		seen[course] = true
		var live int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM meetings WHERE school_id=? AND course_id=? AND status='live'", school, course).Scan(&live) != nil || live > 0 {
			problem(w, 409, "Không đổi phân công khi môn có buổi đang học")
			return
		}
		teacher := ""
		if v.Teacher != "" {
			e = tx.QueryRowContext(r.Context(), "SELECT id FROM users WHERE school_id=? AND role='teacher' AND active=TRUE AND (id=? OR short_id=?)", school, v.Teacher, v.Teacher).Scan(&teacher)
			if e != nil {
				problem(w, 404, "Không tìm thấy giáo viên trong trường")
				return
			}
		}
		if len(v.Assistants) > 10 {
			problem(w, 400, "Tối đa 10 trợ giảng mỗi môn")
			return
		}
		assistantIDs := map[string]bool{}
		for _, candidate := range v.Assistants {
			var id string
			if tx.QueryRowContext(r.Context(), "SELECT id FROM users WHERE school_id=? AND role='teacher' AND active=TRUE AND (id=? OR short_id=?)", school, candidate, candidate).Scan(&id) != nil || id == teacher || assistantIDs[id] {
				problem(w, 400, "Trợ giảng không hợp lệ, trùng hoặc trùng giáo viên chính")
				return
			}
			assistantIDs[id] = true
		}
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM course_assistants WHERE school_id=? AND course_id=?", school, course); e != nil {
			problem(w, 500, "Lưu trợ giảng thất bại")
			return
		}
		for id := range assistantIDs {
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO course_assistants(school_id,course_id,user_id) VALUES(?,?,?)", school, course, id); e != nil {
				problem(w, 500, "Lưu trợ giảng thất bại")
				return
			}
		}
		if _, e = tx.ExecContext(r.Context(), "UPDATE courses SET teacher_id=NULLIF(?,''),revision=revision+1 WHERE school_id=? AND id=?", teacher, school, course); e != nil {
			problem(w, 409, "Không lưu được phân công")
			return
		}
	}
	if tx.Commit() != nil {
		problem(w, 500, "Lưu thất bại")
		return
	}
	a.audit(r, "assignments.batch", fmt.Sprint(len(in.Rows)))
	send(w, 200, map[string]int{"saved": len(in.Rows)})
}
