package main

import (
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func r2ready(w http.ResponseWriter) (r2Settings, bool) {
	c, e := loadSettings()
	if e != nil || !c.R2.Enabled {
		problem(w, 503, "R2 is not configured")
		return r2Settings{}, false
	}
	return c.R2, true
}
func (a *app) recordingCreate(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, true)
	if !ok {
		return
	}
	if !m.Recording || m.Status != "live" {
		problem(w, 409, "Recording is not enabled for this live meeting")
		return
	}
	store, ready := r2ready(w)
	if !ready {
		return
	}
	u := who(r)
	id := uid()
	key := recordingPrefix + u.School + "/" + r.PathValue("id") + "/" + id + ".webm"
	signed, e := s3.NewPresignClient(a.s3Client(store)).PresignPutObject(r.Context(), &s3.PutObjectInput{Bucket: &store.Bucket, Key: &key, ContentType: aws.String("video/webm")}, s3.WithPresignExpires(15*time.Minute))
	if e != nil {
		problem(w, 502, "Upload signing failed")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 DAY))", id, u.School, r.PathValue("id"), u.ID, key, store.Bucket); e != nil {
		problem(w, 500, "Recording persistence failed")
		return
	}
	a.audit(r, "recording.create", id)
	send(w, 201, map[string]string{"id": id, "upload_url": signed.URL, "content_type": "video/webm"})
}
func (a *app) recordingList(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	a.query(w, r, "SELECT id,status,size_bytes,created_at,expires_at FROM recordings WHERE school_id=? AND meeting_id=? AND status='ready' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6) ORDER BY created_at DESC LIMIT 100", u.School, r.PathValue("id"))
}
func (a *app) recordingComplete(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, true); !ok {
		return
	}
	store, ready := r2ready(w)
	if !ready {
		return
	}
	u := who(r)
	var key string
	if a.db.QueryRowContext(r.Context(), "SELECT object_key FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND owner_id=? AND status='pending' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", r.PathValue("recording"), u.School, r.PathValue("id"), u.ID).Scan(&key) != nil {
		problem(w, 404, "Pending recording not found")
		return
	}
	head, e := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &store.Bucket, Key: &key})
	if e != nil || aws.ToInt64(head.ContentLength) <= 0 || aws.ToInt64(head.ContentLength) > 1<<30 || aws.ToString(head.ContentType) != "video/webm" {
		problem(w, 409, "Uploaded WebM missing or outside 1 byte–1 GiB limit")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE recordings SET status='ready',size_bytes=? WHERE id=? AND school_id=?", aws.ToInt64(head.ContentLength), r.PathValue("recording"), u.School); e != nil {
		problem(w, 500, "Finalize failed")
		return
	}
	a.audit(r, "recording.complete", r.PathValue("recording"))
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) recordingDownload(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	store, ready := r2ready(w)
	if !ready {
		return
	}
	var key string
	var expires time.Time
	if a.db.QueryRowContext(r.Context(), "SELECT object_key,expires_at FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND status='ready' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", r.PathValue("recording"), who(r).School, r.PathValue("id")).Scan(&key, &expires) != nil {
		problem(w, 404, "Recording not found")
		return
	}
	ttl := remainingLifetime(time.Now().UTC(), expires)
	if ttl < time.Second {
		problem(w, 410, "Recording expired")
		return
	}
	out, e := s3.NewPresignClient(a.s3Client(store)).PresignGetObject(r.Context(), &s3.GetObjectInput{Bucket: &store.Bucket, Key: &key}, s3.WithPresignExpires(ttl))
	if e != nil {
		problem(w, 502, "Download signing failed")
		return
	}
	send(w, 200, map[string]string{"url": out.URL})
}
