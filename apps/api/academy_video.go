package main

import (
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"net/http"
	"strings"
	"time"
)

func (a *app) academyLessons(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	a.query(w, r, "SELECT l.id,l.title,l.duration_seconds,l.position,l.status,COALESCE(p.seconds,0) AS progress_seconds,COALESCE(p.completed,FALSE) AS completed FROM academy_lessons l JOIN academy_courses c ON c.school_id=l.school_id AND c.id=l.course_id LEFT JOIN academy_progress p ON p.school_id=l.school_id AND p.lesson_id=l.id AND p.user_id=? WHERE l.school_id=? AND l.course_id=? AND (c.published=TRUE OR ?='admin') AND (l.status='ready' OR ?='admin') ORDER BY l.position,l.created_at", u.ID, u.School, r.PathValue("course"), u.Role, u.Role)
}
func (a *app) academyLessonUpload(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	var in struct {
		ID          string `json:"id"`
		Title, Type string
		Size        int64
		Duration    int `json:"duration_seconds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Title == "" || len(in.Title) > 200 || in.Size < 1 || in.Size > 1<<30 || in.Duration < 1 || in.Duration > 28800 || (in.Type != "video/mp4" && in.Type != "video/webm") {
		problem(w, 400, "Video tối đa 1 GiB, MP4/WebM và thời lượng hợp lệ")
		return
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	u := who(r)
	var n int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_courses WHERE school_id=? AND id=?", u.School, r.PathValue("course")).Scan(&n) != nil || n != 1 {
		problem(w, 404, "Không thấy khóa học")
		return
	}
	id := uid()
	if in.ID != "" {
		if r.Context().Value(managedAcademyKey{}) != true || !configID.MatchString(in.ID) || len(in.ID) != 32 {
			problem(w, 400, "Invalid upload request ID")
			return
		}
		id = in.ID
	}
	ext := ".mp4"
	if in.Type == "video/webm" {
		ext = ".webm"
	}
	key := "academy/vod/" + u.School + "/" + id + ext
	result, e := s3.NewPresignClient(a.s3Client(store)).PresignPutObject(r.Context(), &s3.PutObjectInput{Bucket: &store.Bucket, Key: &key, ContentType: &in.Type, ContentLength: &in.Size}, s3.WithPresignExpires(15*time.Minute))
	if e != nil {
		problem(w, 502, "Không cấp được link tải")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,duration_seconds) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id", id, u.School, r.PathValue("course"), in.Title, key, store.Bucket, in.Duration); e != nil {
		problem(w, 500, "Không tạo được bài giảng")
		return
	}
	var own int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_lessons WHERE id=? AND school_id=? AND course_id=?", id, u.School, r.PathValue("course")).Scan(&own) != nil || own != 1 {
		problem(w, 409, "Upload ID conflict")
		return
	}
	send(w, 201, map[string]any{"id": id, "url": result.URL, "content_type": in.Type})
}
func (a *app) academyLessonFinish(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	var key, bucket string
	u := who(r)
	if a.db.QueryRowContext(r.Context(), "SELECT object_key,bucket FROM academy_lessons WHERE school_id=? AND id=? AND status='draft'", u.School, r.PathValue("lesson")).Scan(&key, &bucket) != nil || bucket != store.Bucket {
		problem(w, 404, "Không thấy video chờ")
		return
	}
	head, e := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &bucket, Key: &key})
	if e != nil || aws.ToInt64(head.ContentLength) < 1 || aws.ToInt64(head.ContentLength) > 1<<30 || (aws.ToString(head.ContentType) != "video/mp4" && aws.ToString(head.ContentType) != "video/webm") {
		problem(w, 409, "Video chưa hoàn tất hoặc sai định dạng")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE academy_lessons SET status='ready',size_bytes=? WHERE school_id=? AND id=?", aws.ToInt64(head.ContentLength), u.School, r.PathValue("lesson")); e != nil {
		problem(w, 500, "Không xuất bản được video")
		return
	}
	a.audit(r, "academy.lesson.publish", r.PathValue("lesson"))
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyPlay(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	store, ok := r2ready(w)
	if !ok {
		return
	}
	id := r.PathValue("lesson")
	var key, bucket string
	var duration int
	if a.db.QueryRowContext(r.Context(), "SELECT l.object_key,l.bucket,l.duration_seconds FROM academy_lessons l JOIN academy_courses c ON c.school_id=l.school_id AND c.id=l.course_id WHERE l.school_id=? AND l.id=? AND l.status='ready' AND (c.published=TRUE OR ?='admin')", u.School, id, u.Role).Scan(&key, &bucket, &duration) != nil || bucket != store.Bucket {
		problem(w, 404, "Video chưa xuất bản")
		return
	}
	link, e := s3.NewPresignClient(a.s3Client(store)).PresignGetObject(r.Context(), &s3.GetObjectInput{Bucket: &bucket, Key: &key}, s3.WithPresignExpires(2*time.Minute))
	if e != nil {
		problem(w, 502, "Không cấp được quyền xem")
		return
	}
	cfg, _ := loadSettings()
	limit := cfg.Commerce.FreeVideos
	if limit == 0 {
		limit = 4
	}
	vip := u.Role != "student" || a.hasVIP(r.Context(), u.School, u.ID, false)
	if !vip {
		tx, e := a.db.BeginTx(r.Context(), nil)
		if e != nil {
			problem(w, 503, "Chưa kiểm tra được lượt xem")
			return
		}
		defer tx.Rollback()
		period := monthlyPeriod(time.Now())
		// Acquire an exclusive row lock before reading quota. INSERT IGNORE can
		// leave concurrent readers holding shared locks and deadlock on upgrade.
		if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_monthly_usage(school_id,user_id,period) VALUES(?,?,?) ON DUPLICATE KEY UPDATE used=used", u.School, u.ID, period); e != nil {
			problem(w, 503, "Không cập nhật được hạn mức")
			return
		}
		var used, seen int
		if tx.QueryRowContext(r.Context(), "SELECT used FROM academy_monthly_usage WHERE school_id=? AND user_id=? AND period=? FOR UPDATE", u.School, u.ID, period).Scan(&used) != nil || tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_views WHERE school_id=? AND user_id=? AND period=? AND lesson_id=?", u.School, u.ID, period, id).Scan(&seen) != nil {
			problem(w, 503, "Không kiểm tra được lượt xem")
			return
		}
		if seen == 0 {
			if used >= limit {
				problem(w, 402, "Đã hết lượt xem miễn phí tháng này. Nâng cấp VIP để tiếp tục.")
				return
			}
			if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_views(school_id,user_id,period,lesson_id) VALUES(?,?,?,?)", u.School, u.ID, period, id); e != nil {
				problem(w, 409, "Lượt xem đang được xử lý")
				return
			}
			if _, e = tx.ExecContext(r.Context(), "UPDATE academy_monthly_usage SET used=used+1 WHERE school_id=? AND user_id=? AND period=?", u.School, u.ID, period); e != nil {
				problem(w, 503, "Không cập nhật được hạn mức")
				return
			}
		}
		if tx.Commit() != nil {
			problem(w, 503, "Không xác nhận được lượt xem")
			return
		}
	}
	send(w, 200, map[string]any{"url": link.URL, "duration_seconds": duration, "expires_in": 120, "vip": vip})
}
func (a *app) academyProgress(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	var in struct {
		Seconds   int
		Completed bool
	}
	if !decode(w, r, &in) {
		return
	}
	var duration int
	if a.db.QueryRowContext(r.Context(), "SELECT duration_seconds FROM academy_lessons WHERE school_id=? AND id=? AND status='ready'", u.School, r.PathValue("lesson")).Scan(&duration) != nil {
		problem(w, 404, "Không thấy bài giảng")
		return
	}
	if in.Seconds < 0 || in.Seconds > duration {
		problem(w, 400, "Vị trí không hợp lệ")
		return
	}
	var seen int
	if !a.hasVIP(r.Context(), u.School, u.ID, false) {
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_views WHERE school_id=? AND user_id=? AND lesson_id=?", u.School, u.ID, r.PathValue("lesson")).Scan(&seen) != nil || seen == 0 {
			problem(w, 403, "Chưa có quyền học bài này")
			return
		}
	}
	_, e := a.db.ExecContext(r.Context(), "INSERT INTO academy_progress(school_id,user_id,lesson_id,seconds,completed) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE seconds=VALUES(seconds),completed=completed OR VALUES(completed),updated_at=UTC_TIMESTAMP(6)", u.School, u.ID, r.PathValue("lesson"), in.Seconds, in.Completed && in.Seconds >= duration*9/10)
	if e != nil {
		problem(w, 500, "Không lưu được tiến độ")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) academyFileUpload(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind, Type, Order string
		Size              int64
	}
	if !decode(w, r, &in) {
		return
	}
	if (in.Kind != "avatars" && in.Kind != "receipts") || (in.Type != "image/png" && in.Type != "image/jpeg") || in.Size < 1 || in.Size > 2<<20 {
		problem(w, 400, "Ảnh PNG/JPEG tối đa 2 MiB")
		return
	}
	u := who(r)
	if in.Kind == "receipts" {
		var n int
		if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_orders WHERE school_id=? AND user_id=? AND id=? AND status='pending'", u.School, u.ID, in.Order).Scan(&n) != nil || n != 1 {
			problem(w, 404, "Không thấy đơn chờ")
			return
		}
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	key := "academy/" + in.Kind + "/" + u.School + "/" + u.ID + "/" + uid()
	link, e := s3.NewPresignClient(a.s3Client(store)).PresignPutObject(r.Context(), &s3.PutObjectInput{Bucket: &store.Bucket, Key: &key, ContentType: &in.Type, ContentLength: &in.Size}, s3.WithPresignExpires(5*time.Minute))
	if e != nil {
		problem(w, 502, "Không cấp được link tải")
		return
	}
	send(w, 200, map[string]string{"key": key, "url": link.URL, "content_type": in.Type})
}
func (a *app) academyReceipt(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	store, ok := r2ready(w)
	if !ok {
		return
	}
	order := r.PathValue("order")
	var key string
	if r.Method == "POST" {
		var in struct{ Key string }
		if !decode(w, r, &in) {
			return
		}
		if !strings.HasPrefix(in.Key, "academy/receipts/"+u.School+"/"+u.ID+"/") {
			problem(w, 403, "Biên lai không thuộc tài khoản")
			return
		}
		head, e := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &store.Bucket, Key: &in.Key})
		if e != nil || aws.ToInt64(head.ContentLength) < 1 || aws.ToInt64(head.ContentLength) > 2<<20 || (aws.ToString(head.ContentType) != "image/png" && aws.ToString(head.ContentType) != "image/jpeg") {
			problem(w, 409, "Ảnh chưa hoàn tất")
			return
		}
		res, e := a.db.ExecContext(r.Context(), "UPDATE academy_orders SET receipt_key=? WHERE school_id=? AND user_id=? AND id=? AND status='pending'", in.Key, u.School, u.ID, order)
		if e != nil {
			problem(w, 500, "Không lưu được biên lai")
			return
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			problem(w, 409, "Đơn đã được xử lý")
			return
		}
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	if u.Role == "admin" && permitted(u, "finance") {
		if a.db.QueryRowContext(r.Context(), "SELECT receipt_key FROM academy_orders WHERE school_id=? AND id=?", u.School, order).Scan(&key) != nil {
			key = ""
		}
	} else {
		_ = a.db.QueryRowContext(r.Context(), "SELECT receipt_key FROM academy_orders WHERE school_id=? AND user_id=? AND id=?", u.School, u.ID, order).Scan(&key)
	}
	if key == "" {
		problem(w, 404, "Chưa có biên lai")
		return
	}
	link, e := s3.NewPresignClient(a.s3Client(store)).PresignGetObject(r.Context(), &s3.GetObjectInput{Bucket: &store.Bucket, Key: &key}, s3.WithPresignExpires(2*time.Minute))
	if e != nil {
		problem(w, 502, "Không mở được biên lai")
		return
	}
	send(w, 200, map[string]string{"url": link.URL})
}

var _ = fmt.Sprint
