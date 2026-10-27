package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
)

type commerceSettings struct {
	SMTPAddress  string `json:"smtp_address"`
	SMTPFrom     string `json:"smtp_from"`
	SMTPUser     string `json:"smtp_user"`
	SMTPPassword string `json:"smtp_password"`
	FreeVideos   int    `json:"free_videos"`
	BankBIN      string `json:"bank_bin"`
	BankAccount  string `json:"bank_account"`
	BankName     string `json:"bank_name"`
	ClientID     string `json:"client_id"`
	APIKey       string `json:"api_key"`
	ChecksumKey  string `json:"checksum_key"`
}

func academyEnabled() bool { c, e := loadSettings(); return e == nil && c.Platform == "academy" }
func (a *app) academy(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !academyEnabled() {
			problem(w, 404, "Phân hệ khóa học chưa bật")
			return
		}
		next(w, r)
	}
}
func (a *app) businessAdmin(w http.ResponseWriter, r *http.Request, p string) bool {
	if who(r).Role != "admin" || !permitted(who(r), p) {
		problem(w, 403, "Chưa được cấp quyền "+p)
		return false
	}
	return true
}
func (a *app) publicSchool(r *http.Request) (string, error) {
	slug, e := a.loginSchool(r)
	if e != nil || slug == "" {
		return "", errors.New("domain chưa gắn trung tâm")
	}
	var id string
	e = a.db.QueryRowContext(r.Context(), "SELECT id FROM schools WHERE slug=?", slug).Scan(&id)
	return id, e
}
func (a *app) academyPublic(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	var data string
	if a.db.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=?", school).Scan(&data) != nil {
		data = `{"headline":"Học trực tuyến cùng giáo viên","description":"Khóa học, lớp Live và bài giảng xem lại","published":false}`
	}
	var site map[string]any
	_ = json.Unmarshal([]byte(data), &site)
	if site == nil {
		site = map[string]any{}
	}
	if site["published"] != true {
		site = map[string]any{"headline": "Trung tâm đang chuẩn bị nội dung", "published": false}
	} else if posts, ok := site["posts"].([]any); ok {
		visible := []any{}
		for _, item := range posts {
			if post, ok := item.(map[string]any); ok && (post["Published"] == true || post["published"] == true) {
				visible = append(visible, post)
			}
		}
		site["posts"] = visible
	}
	var profiles academySite
	_ = json.Unmarshal([]byte(data), &profiles)
	if site["published"] == true {
		site["teachers"] = profiles.PublicTeachers()
		site["testimonials"] = profiles.PublicTestimonials()
	}
	cfg, _ := loadSettings()
	send(w, 200, map[string]any{"site": site, "free_videos": cfg.Commerce.FreeVideos, "bank_configured": cfg.Commerce.BankBIN != "" && cfg.Commerce.BankAccount != ""})
}
func (a *app) academyCatalog(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	a.query(w, r, "SELECT id,title,description,teacher_name,academic_course_id FROM academy_courses WHERE school_id=? AND published=TRUE ORDER BY created_at DESC LIMIT 200", school)
}
func (a *app) academyPlans(w http.ResponseWriter, r *http.Request) {
	school, e := a.publicSchool(r)
	if e != nil {
		problem(w, 404, "Chưa có trung tâm")
		return
	}
	a.query(w, r, "SELECT id,name,price_vnd,days,live_enabled FROM academy_plans WHERE school_id=? AND active=TRUE ORDER BY price_vnd", school)
}
func (a *app) academyAdmin(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	u := who(r)
	if r.Method == "GET" {
		var raw string
		err := a.db.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=?", u.School).Scan(&raw)
		if err == sql.ErrNoRows {
			send(w, 200, []any{})
			return
		}
		if err != nil {
			problem(w, 503, "Chưa tải được website")
			return
		}
		send(w, 200, []map[string]string{{"content": raw, "revision": digest(raw)}})
		return
	}
	var in struct {
		Content  json.RawMessage `json:"content"`
		Revision *string         `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	var site academySite
	if len(in.Content) > 100000 || json.Unmarshal(in.Content, &site) != nil {
		problem(w, 400, "Nội dung không hợp lệ")
		return
	}
	if site.ContactEmail != "" {
		parsed, err := mail.ParseAddress(site.ContactEmail)
		if err != nil || parsed.Address != site.ContactEmail {
			problem(w, 400, "Email liên hệ không hợp lệ")
			return
		}
	}
	seenPosts := map[string]bool{}
	for _, post := range site.Posts {
		if post.Published {
			if !regexp.MustCompile(`^[a-z0-9-]{1,100}$`).MatchString(post.Slug) || strings.TrimSpace(post.Title) == "" || seenPosts[post.Slug] {
				problem(w, 400, "Bài viết xuất bản cần tiêu đề và đường dẫn duy nhất (chữ thường, số, gạch ngang)")
				return
			}
			seenPosts[post.Slug] = true
		}
	}
	for _, teacher := range site.Teachers {
		if site.Published && visibleProfile(teacher.Published) && strings.TrimSpace(teacher.Name) == "" {
			problem(w, 400, "Nhập tên giáo viên giới thiệu trước khi xuất bản")
			return
		}
	}
	for _, review := range site.Testimonials {
		if review.Rating < 0 || review.Rating > 5 || (review.Audience != "" && review.Audience != "student" && review.Audience != "parent") {
			problem(w, 400, "Cảm nhận cần đúng đối tượng và điểm đánh giá từ 0–5")
			return
		}
		if site.Published && visibleProfile(review.Published) && (strings.TrimSpace(review.Name) == "" || strings.TrimSpace(review.Text) == "") {
			problem(w, 400, "Cảm nhận công khai cần tên hiển thị và nội dung thực tế")
			return
		}
	}
	if len(site.CoursePages) > 500 {
		problem(w, 400, "Tối đa 500 trang khóa học")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		problem(w, 503, "Chưa lưu được website")
		return
	}
	defer tx.Rollback()
	var old string
	err = tx.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=? FOR UPDATE", u.School).Scan(&old)
	if err != nil && err != sql.ErrNoRows {
		problem(w, 503, "Chưa tải được website")
		return
	}
	expected := ""
	if err == nil {
		expected = digest(old)
	}
	if expected != "" && in.Revision == nil {
		problem(w, 409, "Trang quản trị đã cũ. Tải lại trang trước khi lưu website.")
		return
	}
	if in.Revision != nil && *in.Revision != expected {
		problem(w, 409, "Website đã được thay đổi. Tải lại nội dung trước khi lưu.")
		return
	}
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO academy_site(school_id,content) VALUES(?,?) ON DUPLICATE KEY UPDATE content=VALUES(content)", u.School, string(in.Content)); err != nil {
		problem(w, 503, "Không lưu được website")
		return
	}
	if tx.QueryRowContext(r.Context(), "SELECT content FROM academy_site WHERE school_id=?", u.School).Scan(&old) != nil || tx.Commit() != nil {
		problem(w, 503, "Không hoàn tất lưu website")
		return
	}
	a.audit(r, "academy.site.save", u.School)
	send(w, 200, map[string]any{"ok": true, "revision": digest(old)})
}

func (a *app) academyCourseSave(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		ID, Title, Description, Teacher string
		Academic                        string `json:"academic_course_id"`
		Published                       bool
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Title == "" || len(in.Title) > 200 || len(in.Description) > 20000 {
		problem(w, 400, "Tên/nội dung khóa học không hợp lệ")
		return
	}
	u := who(r)
	if in.ID == "" {
		in.ID = uid()
	}
	var owner string
	if err := a.db.QueryRowContext(r.Context(), "SELECT school_id FROM academy_courses WHERE id=?", in.ID).Scan(&owner); err == nil && owner != u.School {
		problem(w, 404, "Không tìm thấy khóa học")
		return
	}
	var academic any
	if in.Academic != "" {
		var n int
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM courses WHERE school_id=? AND id=?", u.School, in.Academic).Scan(&n) != nil || n != 1 {
			problem(w, 400, "Môn học không thuộc trung tâm")
			return
		}
		var state string
		if a.db.QueryRowContext(r.Context(), "SELECT COALESCE(cc.state,'active') FROM courses c LEFT JOIN class_controls cc ON cc.school_id=c.school_id AND cc.class_id=c.class_id WHERE c.school_id=? AND c.id=?", u.School, in.Academic).Scan(&state) != nil {
			problem(w, 503, "Chưa kiểm tra được lớp liên kết")
			return
		}
		if state == "deleted" {
			var current string
			if a.db.QueryRowContext(r.Context(), "SELECT COALESCE(academic_course_id,'') FROM academy_courses WHERE school_id=? AND id=?", u.School, in.ID).Scan(&current) != nil || current != in.Academic {
				problem(w, 409, "Không liên kết mới với lớp đã xóa")
				return
			}
		}
		academic = in.Academic
	}
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_courses(id,school_id,title,description,teacher_name,academic_course_id,published) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=IF(school_id=VALUES(school_id),VALUES(title),title),description=IF(school_id=VALUES(school_id),VALUES(description),description),teacher_name=IF(school_id=VALUES(school_id),VALUES(teacher_name),teacher_name),academic_course_id=IF(school_id=VALUES(school_id),VALUES(academic_course_id),academic_course_id),published=IF(school_id=VALUES(school_id),VALUES(published),published)", in.ID, u.School, in.Title, in.Description, in.Teacher, academic, in.Published)
	if e != nil {
		problem(w, 400, "Không lưu được khóa học")
		return
	}
	_ = res
	a.audit(r, "academy.course.save", in.ID)
	send(w, 200, map[string]string{"id": in.ID})
}
func (a *app) academyTeaching(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	if u.Role != "teacher" {
		problem(w, 403, "Dành cho giáo viên")
		return
	}
	a.query(w, r, "SELECT ac.id,ac.title,ac.description,ac.teacher_name,ac.academic_course_id FROM academy_courses ac JOIN courses c ON c.school_id=ac.school_id AND c.id=ac.academic_course_id WHERE ac.school_id=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM course_assistants ca WHERE ca.school_id=c.school_id AND ca.course_id=c.id AND ca.user_id=?)) ORDER BY ac.title", u.School, u.ID, u.ID)
}
func (a *app) academyMe(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, "SELECT u.id,u.name,u.email,p.dob,p.address,p.school_name,p.phone,p.parent_phone,p.avatar_key,p.marketing_consent,p.email_verified,(COALESCE(p.avatar_key,'')<>'' OR EXISTS(SELECT 1 FROM academy_registration_avatars av WHERE av.school_id=u.school_id AND av.user_id=u.id)) AS registration_avatar,m.expires_at,CASE WHEN lm.expires_at>UTC_TIMESTAMP(6) THEN lm.expires_at ELSE NULL END AS live_expires_at,(m.expires_at>UTC_TIMESTAMP(6) AND COALESCE(lm.expires_at,IF(m.live_enabled,m.expires_at,NULL))>UTC_TIMESTAMP(6)) AS live_enabled FROM users u LEFT JOIN academy_profiles p ON p.school_id=u.school_id AND p.user_id=u.id LEFT JOIN academy_memberships m ON m.school_id=u.school_id AND m.user_id=u.id LEFT JOIN academy_live_memberships lm ON lm.school_id=u.school_id AND lm.user_id=u.id WHERE u.school_id=? AND u.id=?", u.School, u.ID)
}
func (a *app) hasVIP(ctx context.Context, school, user string, live bool) bool {
	var n int
	e := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM academy_memberships m LEFT JOIN academy_live_memberships lm ON lm.school_id=m.school_id AND lm.user_id=m.user_id WHERE m.school_id=? AND m.user_id=? AND m.expires_at>UTC_TIMESTAMP(6) AND (?=FALSE OR COALESCE(lm.expires_at,IF(m.live_enabled,m.expires_at,NULL))>UTC_TIMESTAMP(6))", school, user, live).Scan(&n)
	return e == nil && n == 1
}
func (a *app) academyLiveGate(w http.ResponseWriter, r *http.Request) bool {
	if academyEnabled() && who(r).Role == "student" && !a.hasVIP(r.Context(), who(r).School, who(r).ID, true) {
		problem(w, 402, "Gói hiện tại chưa có quyền học Live")
		return false
	}
	return true
}
func (a *app) academyLists(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	kind := r.PathValue("kind")
	switch kind {
	case "courses":
		if !a.businessAdmin(w, r, "content") {
			return
		}
		a.query(w, r, "SELECT * FROM academy_courses WHERE school_id=? ORDER BY created_at DESC LIMIT 500", u.School)
	case "plans":
		if !a.businessAdmin(w, r, "finance") {
			return
		}
		a.query(w, r, "SELECT p.*,COALESCE(c.revision,0) AS revision FROM academy_plans p LEFT JOIN academy_plan_controls c ON c.school_id=p.school_id AND c.plan_id=p.id WHERE p.school_id=? AND c.deleted_at IS NULL ORDER BY p.price_vnd", u.School)
	case "orders":
		if !a.businessAdmin(w, r, "finance") {
			return
		}
		a.query(w, r, "SELECT o.*,u.name,u.email FROM academy_orders o JOIN users u ON u.id=o.user_id AND u.school_id=o.school_id WHERE o.school_id=? ORDER BY o.created_at DESC LIMIT 500", u.School)
	case "students":
		if !a.businessAdmin(w, r, "accounts") {
			return
		}
		a.query(w, r, "SELECT u.id,u.name,u.email,p.dob,p.phone,p.parent_phone,p.school_name,p.address,p.marketing_consent,m.expires_at FROM users u LEFT JOIN academy_profiles p ON p.school_id=u.school_id AND p.user_id=u.id LEFT JOIN academy_memberships m ON m.school_id=u.school_id AND m.user_id=u.id WHERE u.school_id=? AND u.role='student' AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=u.id AND d.school_id=u.school_id) ORDER BY u.name LIMIT 1000", u.School)
	default:
		problem(w, 404, "Danh sách không tồn tại")
	}
}
func monthlyPeriod(now time.Time) string {
	zone := time.FixedZone("ICT", 7*3600)
	return now.In(zone).Format("2006-01")
}
func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

var _ = sql.ErrNoRows
