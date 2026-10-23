package main

import (
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func storage() *s3.Client {
	return s3.New(s3.Options{Region: "auto", BaseEndpoint: aws.String("https://" + secret("R2_ACCOUNT_ID") + ".r2.cloudflarestorage.com"), Credentials: credentials.NewStaticCredentialsProvider(secret("R2_ACCESS_KEY_ID"), secret("R2_SECRET_ACCESS_KEY"), "")})
}
func r2ready(w http.ResponseWriter) bool {
	for _, k := range []string{"R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"} {
		if secret(k) == "" {
			problem(w, 503, "R2 is not configured")
			return false
		}
	}
	return true
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
	if !r2ready(w) {
		return
	}
	u := who(r)
	id := uid()
	key := u.School + "/" + r.PathValue("id") + "/" + id + ".webm"
	signed, e := s3.NewPresignClient(storage()).PresignPutObject(r.Context(), &s3.PutObjectInput{Bucket: aws.String(secret("R2_BUCKET")), Key: &key, ContentType: aws.String("video/webm")}, s3.WithPresignExpires(15*time.Minute))
	if e != nil {
		problem(w, 502, "Upload signing failed")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key) VALUES(?,?,?,?,?)", id, u.School, r.PathValue("id"), u.ID, key); e != nil {
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
	a.query(w, r, "SELECT id,status,size_bytes,created_at FROM recordings WHERE school_id=? AND meeting_id=? AND status='ready' ORDER BY created_at DESC LIMIT 100", u.School, r.PathValue("id"))
}
func (a *app) recordingComplete(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, true); !ok {
		return
	}
	if !r2ready(w) {
		return
	}
	u := who(r)
	var key string
	if a.db.QueryRowContext(r.Context(), "SELECT object_key FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND owner_id=? AND status='pending'", r.PathValue("recording"), u.School, r.PathValue("id"), u.ID).Scan(&key) != nil {
		problem(w, 404, "Pending recording not found")
		return
	}
	head, e := storage().HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: aws.String(secret("R2_BUCKET")), Key: &key})
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
	if !r2ready(w) {
		return
	}
	var key string
	if a.db.QueryRowContext(r.Context(), "SELECT object_key FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND status='ready'", r.PathValue("recording"), who(r).School, r.PathValue("id")).Scan(&key) != nil {
		problem(w, 404, "Recording not found")
		return
	}
	out, e := s3.NewPresignClient(storage()).PresignGetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(secret("R2_BUCKET")), Key: &key}, s3.WithPresignExpires(5*time.Minute))
	if e != nil {
		problem(w, 502, "Download signing failed")
		return
	}
	send(w, 200, map[string]string{"url": out.URL})
}
