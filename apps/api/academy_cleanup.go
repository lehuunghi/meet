package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/redis/go-redis/v9"
	"net/http"
	"strings"
	"time"
)

// Metadata removal and the durable object deletion outbox commit together.
// Never delete by bucket prefix: a bucket can be shared with other tenants.
func (a *app) academyCleanup(w http.ResponseWriter, r *http.Request) {
	u := who(r)
	var in struct {
		Kind      string `json:"kind"`
		Meeting   string `json:"meeting_id"`
		Recording string `json:"recording_id"`
		Lesson    string `json:"lesson_id"`
		Confirm   string `json:"confirm"`
	}
	if r.Method == "GET" {
		in.Kind = r.URL.Query().Get("kind")
	} else if !decode(w, r, &in) {
		return
	}
	attendance := in.Kind == "attendance" || in.Kind == "all"
	videos := in.Kind == "videos" || in.Kind == "all"
	if !attendance && !videos {
		problem(w, 400, "Chọn điểm danh hoặc video")
		return
	}
	if u.Role != "admin" || (attendance && !permitted(u, "attendance")) || (videos && ((in.Lesson == "" && !permitted(u, "recordings")) || (in.Recording == "" && in.Meeting == "" && !permitted(u, "content")))) {
		problem(w, 403, "Không có quyền xóa dữ liệu này")
		return
	}
	if r.Method == "GET" {
		a.query(w, r, `SELECT (SELECT COUNT(*) FROM presence WHERE school_id=?) AS attendance_rows,(SELECT COUNT(*) FROM attendance_events WHERE school_id=?) AS attendance_events,(SELECT COUNT(*) FROM recordings WHERE school_id=? AND deleted_at IS NULL) AS recordings,(SELECT COUNT(*) FROM academy_lessons WHERE school_id=?) AS lessons,(SELECT COUNT(*) FROM media_delete_queue WHERE school_id=? AND completed_at IS NULL) AS pending_objects`, u.School, u.School, u.School, u.School, u.School)
		return
	}
	if in.Confirm != "XÓA" || (in.Meeting != "" && (in.Lesson != "" || in.Recording != "")) || (in.Lesson != "" && in.Recording != "") || (attendance && (in.Lesson != "" || in.Recording != "")) {
		problem(w, 400, "Nhập XÓA để xác nhận đúng phạm vi")
		return
	}
	cfg, e := loadSettings()
	if e != nil {
		problem(w, 503, "Chưa đọc được cấu hình")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa thể xóa")
		return
	}
	defer tx.Rollback()
	// Serialize against join/start/import/upload, which lock meeting or course rows.
	rows, e := tx.QueryContext(r.Context(), "SELECT id,status FROM meetings WHERE school_id=? AND (?='' OR id=?) ORDER BY id FOR UPDATE", u.School, in.Meeting, in.Meeting)
	if e != nil {
		problem(w, 503, "Chưa kiểm tra được buổi học")
		return
	}
	count := 0
	live := false
	for rows.Next() {
		var id, state string
		if e = rows.Scan(&id, &state); e != nil {
			break
		}
		count++
		live = live || state == "live"
	}
	if rows.Err() != nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		problem(w, 503, "Chưa kiểm tra được buổi học")
		return
	}
	if in.Meeting != "" && count != 1 {
		problem(w, 404, "Không thấy buổi học")
		return
	}
	if live {
		problem(w, 409, "Còn buổi đang học; kết thúc buổi trước khi xóa dữ liệu")
		return
	}
	if videos {
		rows, e = tx.QueryContext(r.Context(), "SELECT id FROM academy_courses WHERE school_id=? ORDER BY id FOR UPDATE", u.School)
		if e != nil {
			problem(w, 503, "Chưa khóa được khóa học")
			return
		}
		for rows.Next() {
			var id string
			e = rows.Scan(&id)
			if e != nil {
				break
			}
		}
		if rows.Err() != nil {
			e = rows.Err()
		}
		rows.Close()
		if e != nil {
			problem(w, 503, "Chưa khóa được khóa học")
			return
		}
		var busy int
		if tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_lesson_details WHERE school_id=? AND import_state IN ('queued','copying')", u.School).Scan(&busy) != nil || busy > 0 {
			problem(w, 409, "Đợi sao chép bài giảng hoàn tất rồi xóa")
			return
		}
	}
	affected := map[string]int64{}
	exec := func(name, q string, args ...any) bool {
		res, err := tx.ExecContext(r.Context(), q, args...)
		if err != nil {
			problem(w, 503, "Chưa hoàn tất xóa; dữ liệu chưa thay đổi")
			return false
		}
		n, _ := res.RowsAffected()
		affected[name] += n
		return true
	}
	if attendance {
		if !exec("hidden_sessions", `INSERT IGNORE INTO attendance_report_deletions(school_id,meeting_id) SELECT school_id,id FROM meetings WHERE school_id=? AND status='ended' AND (?='' OR id=?)`, u.School, in.Meeting, in.Meeting) {
			return
		}
		for _, table := range []string{"attendance_events", "attendance_adjustments", "meeting_timings", "presence"} {
			if !exec(table, "DELETE FROM "+table+" WHERE school_id=? AND (?='' OR meeting_id=?)", u.School, in.Meeting, in.Meeting) {
				return
			}
		}
	}
	if videos {
		// Direct PUT URLs last 15 minutes. Do not allow an outstanding URL
		// to recreate an object after deletion; multipart is aborted by the worker.
		var recent int
		if in.Lesson == "" {
			e = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM recordings WHERE school_id=? AND deleted_at IS NULL AND created_at>UTC_TIMESTAMP()-INTERVAL 20 MINUTE AND (?='' OR meeting_id=?) AND (?='' OR id=?)", u.School, in.Meeting, in.Meeting, in.Recording, in.Recording).Scan(&recent)
		}
		if e != nil || recent > 0 {
			problem(w, 409, "Video vừa tạo còn liên kết tải lên; đợi 20 phút sau khi tạo rồi xóa")
			return
		}
		if in.Recording == "" && in.Meeting == "" {
			e = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM academy_lessons WHERE school_id=? AND created_at>UTC_TIMESTAMP()-INTERVAL 20 MINUTE AND (?='' OR id=?)", u.School, in.Lesson, in.Lesson).Scan(&recent)
		}
		if e != nil || recent > 0 {
			problem(w, 409, "Video vừa tạo còn liên kết tải lên; đợi 20 phút sau khi tạo rồi xóa")
			return
		}
		type object struct {
			id, key, bucket string
			lesson          bool
		}
		objects := []object{}
		if in.Lesson == "" {
			rows, e = tx.QueryContext(r.Context(), "SELECT id,object_key,bucket FROM recordings WHERE school_id=? AND deleted_at IS NULL AND (?='' OR meeting_id=?) AND (?='' OR id=?) FOR UPDATE", u.School, in.Meeting, in.Meeting, in.Recording, in.Recording)
			if e != nil {
				problem(w, 503, "Chưa đọc được bản ghi")
				return
			}
			for rows.Next() {
				var o object
				if e = rows.Scan(&o.id, &o.key, &o.bucket); e != nil {
					break
				}
				objects = append(objects, o)
			}
			if rows.Err() != nil {
				e = rows.Err()
			}
			rows.Close()
			if e != nil {
				problem(w, 503, "Chưa đọc được bản ghi")
				return
			}
		}
		if in.Recording == "" && in.Meeting == "" {
			rows, e = tx.QueryContext(r.Context(), "SELECT id,object_key,bucket FROM academy_lessons WHERE school_id=? AND (?='' OR id=?) FOR UPDATE", u.School, in.Lesson, in.Lesson)
			if e != nil {
				problem(w, 503, "Chưa đọc được bài giảng")
				return
			}
			for rows.Next() {
				o := object{lesson: true}
				if e = rows.Scan(&o.id, &o.key, &o.bucket); e != nil {
					break
				}
				objects = append(objects, o)
			}
			if rows.Err() != nil {
				e = rows.Err()
			}
			rows.Close()
			if e != nil {
				problem(w, 503, "Chưa đọc được bài giảng")
				return
			}
		}
		if (in.Lesson != "" || in.Recording != "") && len(objects) == 0 {
			problem(w, 404, "Không thấy video")
			return
		}
		for _, o := range objects {
			if o.bucket == "" {
				o.bucket = cfg.R2.Bucket
			}
			if o.key != "" {
				if !cfg.R2.Enabled || o.bucket != cfg.R2.Bucket || strings.Contains(o.key, "..") {
					problem(w, 409, "Cấu hình R2 không khớp video; kiểm tra trước khi xóa")
					return
				}
				if !exec("queued", `INSERT INTO media_delete_queue(id,school_id,storage_account,bucket,object_key,recording_id) VALUES(?,?,?,?,?,?)`, uid(), u.School, cfg.R2.Account, o.bucket, o.key, func() string {
					if o.lesson {
						return ""
					}
					return o.id
				}()) {
					return
				}
			}
			if o.lesson {
				for _, table := range []string{"academy_views", "academy_progress", "academy_lesson_details"} {
					if !exec(table, "DELETE FROM "+table+" WHERE school_id=? AND lesson_id=?", u.School, o.id) {
						return
					}
				}
				if !exec("lessons", "DELETE FROM academy_lessons WHERE school_id=? AND id=?", u.School, o.id) {
					return
				}
			} else if !exec("recordings", "UPDATE recordings SET deleted_at=UTC_TIMESTAMP(6),expires_at=UTC_TIMESTAMP(6) WHERE school_id=? AND id=?", u.School, o.id) {
				return
			}
		}
	}
	if tx.Commit() != nil {
		problem(w, 503, "Chưa hoàn tất xóa")
		return
	}
	a.audit(r, "academy.data.delete", in.Kind+":"+in.Meeting+in.Recording+in.Lesson)
	send(w, 200, map[string]any{"ok": true, "affected": affected, "message": "Đã xóa dữ liệu. File R2 được dọn tự động; kiểm tra số file chờ để xác nhận hoàn tất."})
}

func (a *app) cleanupDeletedMedia(ctx context.Context) error {
	cfg, e := loadSettings()
	if e != nil || !cfg.R2.Enabled {
		return e
	}
	var id, key, bucket, recording string
	e = a.db.QueryRowContext(ctx, "SELECT id,object_key,bucket,recording_id FROM media_delete_queue WHERE completed_at IS NULL AND storage_account=? AND bucket=? ORDER BY created_at,id LIMIT 1", cfg.R2.Account, cfg.R2.Bucket).Scan(&id, &key, &bucket, &recording)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if key == "" || strings.Contains(key, "..") {
		return errors.New("invalid media cleanup key")
	}
	call, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if recording != "" {
		lock := "recording-mutation:" + recording
		nonce := uid()
		got, err := a.cache.SetNX(ctx, lock, nonce, 120*time.Second).Result()
		if err != nil || !got {
			return errors.New("recording busy")
		}
		defer a.cache.Eval(ctx, `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
		raw, err := a.cache.Get(ctx, "recording-multipart:"+recording).Result()
		if err == nil {
			var state multipartRecording
			if json.Unmarshal([]byte(raw), &state) != nil || state.Key != key || state.Bucket != bucket {
				return errors.New("multipart storage mismatch")
			}
			_, abortErr := a.s3Client(cfg.R2).AbortMultipartUpload(call, &s3.AbortMultipartUploadInput{Bucket: &bucket, Key: &key, UploadId: &state.Upload})
			if abortErr != nil {
				var apiError smithy.APIError
				if !errors.As(abortErr, &apiError) || apiError.ErrorCode() != "NoSuchUpload" {
					return errors.New("multipart cleanup pending")
				}
			}
			a.cache.Del(ctx, "recording-multipart:"+recording)
		} else if err != redis.Nil {
			return errors.New("multipart state unavailable")
		}
	}
	if _, e = a.s3Client(cfg.R2).DeleteObject(call, &s3.DeleteObjectInput{Bucket: &bucket, Key: &key}); e != nil {
		return errors.New("R2 cleanup pending")
	}
	_, e = a.db.ExecContext(ctx, "UPDATE media_delete_queue SET completed_at=UTC_TIMESTAMP(6) WHERE id=?", id)
	return e
}
