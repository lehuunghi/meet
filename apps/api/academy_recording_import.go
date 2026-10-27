package main

import (
	"context"
	"database/sql"
	"errors"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const academyCopyLimit = int64(5 << 30)

func (a *app) academyRecordingImport(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	var in struct {
		Recording             string `json:"recording_id"`
		Title, Chapter, Notes string
		Duration              int `json:"duration_seconds"`
		Published             bool
	}
	if !decode(w, r, &in) {
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || len(in.Title) > 200 || len(in.Chapter) > 200 || len(in.Notes) > 20000 || in.Duration < 1 || in.Duration > 28800 {
		problem(w, 400, "Nhập tên, thời lượng 1–28800 giây và ghi chú hợp lệ")
		return
	}
	u := who(r)
	course := r.PathValue("course")
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		problem(w, 503, "Chưa tạo được bài giảng")
		return
	}
	defer tx.Rollback()
	var own string
	if tx.QueryRowContext(r.Context(), "SELECT id FROM academy_courses WHERE school_id=? AND id=? FOR UPDATE", u.School, course).Scan(&own) != nil {
		problem(w, 404, "Không thấy khóa học")
		return
	}
	var existing, state string
	e = tx.QueryRowContext(r.Context(), "SELECT lesson_id,import_state FROM academy_lesson_details WHERE school_id=? AND course_id=? AND source_recording_id=?", u.School, course, in.Recording).Scan(&existing, &state)
	if e == nil {
		send(w, 200, map[string]string{"id": existing, "state": state})
		return
	}
	if e != sql.ErrNoRows {
		problem(w, 503, "Chưa kiểm tra được bài giảng đã có")
		return
	}
	var key, bucket string
	var size int64
	if tx.QueryRowContext(r.Context(), "SELECT object_key,bucket,size_bytes FROM recordings WHERE school_id=? AND id=? AND status='ready' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", u.School, in.Recording).Scan(&key, &bucket, &size) != nil {
		problem(w, 404, "Bản ghi không còn sẵn sàng hoặc không thuộc đơn vị")
		return
	}
	if bucket == "" {
		bucket = store.Bucket
	}
	if bucket != store.Bucket || !strings.HasPrefix(key, recordingPrefix+u.School+"/") || strings.Contains(key, "..") || size < 1 || size > academyCopyLimit {
		problem(w, 409, "Bản ghi cần đúng kho lưu trữ và có dung lượng tối đa 5 GiB")
		return
	}
	ext := ".webm"
	if strings.HasSuffix(key, ".mp4") {
		ext = ".mp4"
	} else if !strings.HasSuffix(key, ".webm") {
		problem(w, 409, "Chỉ hỗ trợ bản ghi MP4/WebM")
		return
	}
	id := uid()
	dest := "academy/vod/" + u.School + "/" + id + ext
	var position int
	if tx.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(position),0)+1 FROM academy_lessons WHERE school_id=? AND course_id=?", u.School, course).Scan(&position) != nil {
		problem(w, 503, "Chưa sắp được vị trí bài giảng")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_lessons(id,school_id,course_id,title,object_key,bucket,duration_seconds,position) VALUES(?,?,?,?,?,?,?,?)", id, u.School, course, in.Title, dest, bucket, in.Duration, position); e != nil {
		problem(w, 503, "Chưa tạo được bài giảng")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO academy_lesson_details(school_id,lesson_id,course_id,chapter,notes,source_recording_id,import_state,desired_published,storage_account) VALUES(?,?,?,?,?,?,'queued',?,?)", u.School, id, course, in.Chapter, in.Notes, in.Recording, in.Published, store.Account); e != nil || tx.Commit() != nil {
		problem(w, 503, "Chưa lưu được yêu cầu sao chép")
		return
	}
	a.audit(r, "academy.lesson.import", id)
	send(w, 202, map[string]string{"id": id, "state": "queued"})
}
func (a *app) academyRetryRecordingImport(w http.ResponseWriter, r *http.Request) {
	if !a.businessAdmin(w, r, "content") {
		return
	}
	u := who(r)
	res, e := a.db.ExecContext(r.Context(), "UPDATE academy_lesson_details SET import_state='queued',error_code='',lease=NULL,lease_until=NULL,attempts=0,revision=revision+1 WHERE school_id=? AND lesson_id=? AND import_state='failed'", u.School, r.PathValue("lesson"))
	if e != nil {
		problem(w, 503, "Chưa thể thử lại")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		problem(w, 409, "Chỉ thử lại bài giảng sao chép thất bại")
		return
	}
	a.audit(r, "academy.lesson.import.retry", r.PathValue("lesson"))
	send(w, 200, map[string]bool{"ok": true})
}

type academyCopyJob struct{ School, Lesson, Source, Destination, Bucket, Account, Lease string }

func (a *app) claimAcademyCopy(ctx context.Context) (*academyCopyJob, error) {
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	j := &academyCopyJob{}
	e = tx.QueryRowContext(ctx, `SELECT d.school_id,d.lesson_id,d.source_recording_id,l.object_key,l.bucket,d.storage_account FROM academy_lesson_details d JOIN academy_lessons l ON l.school_id=d.school_id AND l.id=d.lesson_id WHERE d.import_state IN ('queued','copying') AND (d.lease_until IS NULL OR d.lease_until<UTC_TIMESTAMP(6)) ORDER BY l.created_at,l.id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&j.School, &j.Lesson, &j.Source, &j.Destination, &j.Bucket, &j.Account)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	j.Lease = uid()
	_, e = tx.ExecContext(ctx, "UPDATE academy_lesson_details SET import_state='copying',lease=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 3 MINUTE),attempts=attempts+1 WHERE school_id=? AND lesson_id=?", j.Lease, j.School, j.Lesson)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return j, nil
}
func (a *app) copyAcademyRecording(ctx context.Context, j *academyCopyJob) error {
	cfg, e := loadSettings()
	if e != nil || !cfg.R2.Enabled || cfg.R2.Bucket != j.Bucket || cfg.R2.Account != j.Account {
		return errors.New("R2_CONFIG_CHANGED")
	}
	var source, bucket string
	var size int64
	var valid bool
	if e = a.db.QueryRowContext(ctx, "SELECT object_key,bucket,size_bytes,(status='ready' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)) FROM recordings WHERE school_id=? AND id=?", j.School, j.Source).Scan(&source, &bucket, &size, &valid); e != nil {
		return errors.New("SOURCE_MISSING")
	}
	if bucket == "" {
		bucket = cfg.R2.Bucket
	}
	if bucket != j.Bucket || size < 1 || size > academyCopyLimit || !strings.HasPrefix(source, recordingPrefix+j.School+"/") || !strings.HasPrefix(j.Destination, "academy/vod/"+j.School+"/") {
		return errors.New("STORAGE_MISMATCH")
	}
	slow := *a
	client := *a.client
	client.Timeout = 90 * time.Second
	slow.client = &client
	s3c := slow.s3Client(cfg.R2)
	matches := func(h *s3.HeadObjectOutput) bool {
		return h != nil && aws.ToInt64(h.ContentLength) == size && (aws.ToString(h.ContentType) == "video/webm" || aws.ToString(h.ContentType) == "video/mp4")
	}
	// A completed destination can outlive a cancelled API process. Reuse it on retry.
	dest, headErr := s3c.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &j.Bucket, Key: &j.Destination})
	if headErr != nil || !matches(dest) {
		if !valid {
			return errors.New("SOURCE_EXPIRED")
		}
		h, e := s3c.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &bucket, Key: &source})
		if e != nil {
			return errors.New("SOURCE_UNAVAILABLE")
		}
		if !matches(h) {
			return errors.New("SOURCE_SIZE_OR_TYPE")
		}
		copySource := url.PathEscape(bucket + "/" + source)
		result, e := s3c.CopyObject(ctx, &s3.CopyObjectInput{Bucket: &j.Bucket, Key: &j.Destination, CopySource: &copySource, CopySourceIfMatch: h.ETag})
		if e != nil {
			return errors.New("R2_COPY_FAILED")
		}
		dest, e = s3c.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &j.Bucket, Key: &j.Destination})
		if e != nil || !matches(dest) || result.CopyObjectResult == nil || aws.ToString(dest.ETag) != aws.ToString(result.CopyObjectResult.ETag) {
			return errors.New("COPY_NOT_VERIFIED")
		}
	}
	tx, e := a.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var own string
	var publish bool
	if tx.QueryRowContext(ctx, "SELECT id FROM academy_lessons WHERE school_id=? AND id=? FOR UPDATE", j.School, j.Lesson).Scan(&own) != nil {
		return errors.New("LESSON_MISSING")
	}
	if e = tx.QueryRowContext(ctx, "SELECT desired_published FROM academy_lesson_details WHERE school_id=? AND lesson_id=? AND lease=? AND import_state='copying' FOR UPDATE", j.School, j.Lesson, j.Lease).Scan(&publish); e != nil {
		return errors.New("COPY_LEASE_CHANGED")
	}
	status := "draft"
	if publish {
		status = "ready"
	}
	if _, e = tx.ExecContext(ctx, "UPDATE academy_lessons SET status=?,size_bytes=? WHERE school_id=? AND id=?", status, size, j.School, j.Lesson); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE academy_lesson_details SET import_state='ready',error_code='',lease=NULL,lease_until=NULL,revision=revision+1 WHERE school_id=? AND lesson_id=?", j.School, j.Lesson); e != nil {
		return e
	}
	return tx.Commit()
}
func (a *app) academyRecordingImportLoop(ctx context.Context) {
	timer := time.NewTicker(10 * time.Second)
	defer timer.Stop()
	for {
		if _, e := os.Stat(configPath("maintenance")); os.IsNotExist(e) && academyEnabled() {
			jobCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
			j, e := a.claimAcademyCopy(jobCtx)
			if e == nil && j != nil {
				if e = a.copyAcademyRecording(jobCtx, j); e != nil && ctx.Err() == nil {
					code := e.Error()
					allowed := map[string]bool{"R2_CONFIG_CHANGED": true, "SOURCE_MISSING": true, "STORAGE_MISMATCH": true, "SOURCE_EXPIRED": true, "SOURCE_UNAVAILABLE": true, "SOURCE_SIZE_OR_TYPE": true, "R2_COPY_FAILED": true, "COPY_NOT_VERIFIED": true}
					if !allowed[code] {
						code = "COPY_FAILED"
					}
					a.db.ExecContext(ctx, "UPDATE academy_lesson_details SET import_state='failed',error_code=?,lease=NULL,lease_until=NULL,revision=revision+1 WHERE school_id=? AND lesson_id=? AND lease=?", code, j.School, j.Lesson, j.Lease)
				}
			}
			cancel()
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
