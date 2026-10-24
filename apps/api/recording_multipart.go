package main

import (
	"encoding/json"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"net/http"
	"strconv"
	"time"
)

const recordingPartSize int64 = 16 << 20
const recordingMaxSize int64 = 8 << 30

type multipartRecording struct{ Upload, Key, Bucket string }

func (a *app) recordingMutation(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lock := "recording-mutation:" + r.PathValue("recording")
		nonce := uid()
		got, e := a.cache.SetNX(r.Context(), lock, nonce, 120*time.Second).Result()
		if e != nil || !got {
			problem(w, 409, "Bản ghi đang được xử lý; thử lại sau")
			return
		}
		defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
		next(w, r)
	}
}

func (a *app) recordingMultipartStart(w http.ResponseWriter, r *http.Request) {
	m, ok := a.access(w, r, true)
	if !ok {
		return
	}
	if m.Status != "live" || !m.Recording {
		problem(w, 409, "Recording is not enabled for this live meeting")
		return
	}
	store, ok := r2ready(w)
	if !ok {
		return
	}
	u := who(r)
	lock := "recording-start:" + u.ID
	nonce := uid()
	got, e := a.cache.SetNX(r.Context(), lock, nonce, 30*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Đang khởi tạo bản ghi")
		return
	}
	defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
	var pending int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM recordings WHERE school_id=? AND owner_id=? AND status='pending' AND deleted_at IS NULL AND created_at>UTC_TIMESTAMP()-INTERVAL 7 DAY", u.School, u.ID).Scan(&pending) != nil || pending >= 3 {
		problem(w, 409, "Hoàn tất hoặc hủy các bản ghi đang chờ trước")
		return
	}
	id := uid()
	key := recordingPrefix + u.School + "/" + r.PathValue("id") + "/" + id + ".webm"
	client := a.s3Client(store)
	out, e := client.CreateMultipartUpload(r.Context(), &s3.CreateMultipartUploadInput{Bucket: &store.Bucket, Key: &key, ContentType: aws.String("video/webm")})
	if e != nil || aws.ToString(out.UploadId) == "" {
		problem(w, 502, "Không khởi tạo được tải từng phần")
		return
	}
	upload := aws.ToString(out.UploadId)
	raw, _ := json.Marshal(multipartRecording{upload, key, store.Bucket})
	abort := func() {
		client.AbortMultipartUpload(r.Context(), &s3.AbortMultipartUploadInput{Bucket: &store.Bucket, Key: &key, UploadId: &upload})
	}
	if _, e = a.db.ExecContext(r.Context(), "INSERT INTO recordings(id,school_id,meeting_id,owner_id,object_key,bucket,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? DAY))", id, u.School, r.PathValue("id"), u.ID, key, store.Bucket, configuredRetention()); e != nil {
		abort()
		problem(w, 503, "Không lưu được bản ghi")
		return
	}
	if a.cache.Set(r.Context(), "recording-multipart:"+id, string(raw), 7*24*time.Hour).Err() != nil {
		abort()
		a.db.ExecContext(r.Context(), "UPDATE recordings SET deleted_at=UTC_TIMESTAMP(6) WHERE id=?", id)
		problem(w, 503, "Không lưu được phiên tải")
		return
	}
	a.audit(r, "recording.multipart.start", id)
	send(w, 201, map[string]any{"id": id, "part_size": recordingPartSize, "max_size": recordingMaxSize})
}
func (a *app) multipartAccess(w http.ResponseWriter, r *http.Request) (r2Settings, multipartRecording, bool) {
	if _, ok := a.access(w, r, true); !ok {
		return r2Settings{}, multipartRecording{}, false
	}
	store, ok := r2ready(w)
	if !ok {
		return store, multipartRecording{}, false
	}
	u := who(r)
	id := r.PathValue("recording")
	var n int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND owner_id=? AND status='pending' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", id, u.School, r.PathValue("id"), u.ID).Scan(&n) != nil || n != 1 {
		problem(w, 404, "Không tìm thấy bản ghi đang chờ")
		return store, multipartRecording{}, false
	}
	raw, e := a.cache.Get(r.Context(), "recording-multipart:"+id).Result()
	var state multipartRecording
	if e != nil || json.Unmarshal([]byte(raw), &state) != nil || state.Upload == "" || state.Bucket != store.Bucket {
		problem(w, 409, "Phiên tải đã hết hạn hoặc cấu hình R2 thay đổi; giữ bản lưu trên thiết bị")
		return store, state, false
	}
	return store, state, true
}
func (a *app) recordingMultipartPart(w http.ResponseWriter, r *http.Request) {
	store, state, ok := a.multipartAccess(w, r)
	if !ok {
		return
	}
	part, e := strconv.Atoi(r.PathValue("part"))
	if e != nil || part < 1 || part > 512 {
		problem(w, 400, "Số phần tải không hợp lệ")
		return
	}
	var in struct {
		Size int64 `json:"size"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Size <= 0 || in.Size > recordingPartSize {
		problem(w, 400, "Kích thước phần tải không hợp lệ")
		return
	}
	out, e := s3.NewPresignClient(a.s3Client(store)).PresignUploadPart(r.Context(), &s3.UploadPartInput{Bucket: &state.Bucket, Key: &state.Key, UploadId: &state.Upload, PartNumber: aws.Int32(int32(part)), ContentLength: aws.Int64(in.Size)}, s3.WithPresignExpires(15*time.Minute))
	if e != nil {
		problem(w, 502, "Không ký được phần tải")
		return
	}
	send(w, 200, map[string]string{"url": out.URL})
}
func (a *app) recordingMultipartFinish(w http.ResponseWriter, r *http.Request) {
	// Idempotent completion: a lost browser response must not strand an uploaded file.
	if _, ok := a.access(w, r, true); !ok {
		return
	}
	u := who(r)
	var ready int
	if a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM recordings WHERE id=? AND school_id=? AND meeting_id=? AND owner_id=? AND status='ready' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(6)", r.PathValue("recording"), u.School, r.PathValue("id"), u.ID).Scan(&ready) == nil && ready == 1 {
		send(w, 200, map[string]bool{"ok": true})
		return
	}
	store, state, ok := a.multipartAccess(w, r)
	if !ok {
		return
	}
	var in struct {
		Parts int `json:"parts"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Parts < 1 || in.Parts > 512 {
		problem(w, 400, "Số phần tải không hợp lệ")
		return
	}
	client := a.s3Client(store)
	// HEAD first recovers a previous successful CompleteMultipartUpload whose reply was lost.
	head, e := client.HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &state.Bucket, Key: &state.Key})
	if e != nil {
		list, e := client.ListParts(r.Context(), &s3.ListPartsInput{Bucket: &state.Bucket, Key: &state.Key, UploadId: &state.Upload, MaxParts: aws.Int32(1000)})
		if e != nil {
			problem(w, 502, "Không đọc được các phần đã tải")
			return
		}
		if aws.ToBool(list.IsTruncated) || len(list.Parts) != in.Parts {
			problem(w, 409, "Chưa đủ các phần tải")
			return
		}
		completed := []types.CompletedPart{}
		var total int64
		for i, p := range list.Parts {
			size := aws.ToInt64(p.Size)
			if aws.ToInt32(p.PartNumber) != int32(i+1) || size <= 0 || size > recordingPartSize || (i < len(list.Parts)-1 && size != recordingPartSize) || aws.ToString(p.ETag) == "" {
				problem(w, 409, "Kích thước hoặc thứ tự phần tải không hợp lệ")
				return
			}
			total += size
			completed = append(completed, types.CompletedPart{PartNumber: p.PartNumber, ETag: p.ETag})
		}
		if total > recordingMaxSize {
			problem(w, 409, "Bản ghi vượt quá 8 GiB")
			return
		}
		if _, e = client.CompleteMultipartUpload(r.Context(), &s3.CompleteMultipartUploadInput{Bucket: &state.Bucket, Key: &state.Key, UploadId: &state.Upload, MultipartUpload: &types.CompletedMultipartUpload{Parts: completed}}); e != nil {
			problem(w, 502, "Hoàn tất tải thất bại; có thể thử lại")
			return
		}
		head, e = client.HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &state.Bucket, Key: &state.Key})
	}
	if e != nil || aws.ToInt64(head.ContentLength) <= 0 || aws.ToInt64(head.ContentLength) > recordingMaxSize || aws.ToString(head.ContentType) != "video/webm" {
		problem(w, 409, "Không xác minh được bản ghi trên R2")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE recordings SET status='ready',size_bytes=? WHERE id=? AND school_id=? AND status='pending'", aws.ToInt64(head.ContentLength), r.PathValue("recording"), u.School); e != nil {
		problem(w, 503, "Không lưu được trạng thái hoàn tất")
		return
	}
	a.cache.Del(r.Context(), "recording-multipart:"+r.PathValue("recording"))
	a.audit(r, "recording.multipart.complete", r.PathValue("recording"))
	send(w, 200, map[string]bool{"ok": true})
}
func (a *app) recordingMultipartAbort(w http.ResponseWriter, r *http.Request) {
	store, state, ok := a.multipartAccess(w, r)
	if !ok {
		return
	}
	if _, e := a.s3Client(store).HeadObject(r.Context(), &s3.HeadObjectInput{Bucket: &state.Bucket, Key: &state.Key}); e == nil {
		problem(w, 409, "Video đã được tải lên; hãy hoàn tất để xác minh thay vì hủy")
		return
	} else if !missingRule(e, "NotFound") && !missingRule(e, "NoSuchKey") {
		problem(w, 502, "Không kiểm tra được trạng thái bản ghi")
		return
	}
	_, e := a.s3Client(store).AbortMultipartUpload(r.Context(), &s3.AbortMultipartUploadInput{Bucket: &state.Bucket, Key: &state.Key, UploadId: &state.Upload})
	if e != nil && !missingRule(e, "NoSuchUpload") {
		problem(w, 502, "Không hủy được phiên tải; thử lại sau")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "UPDATE recordings SET deleted_at=UTC_TIMESTAMP(6) WHERE id=? AND school_id=? AND status='pending'", r.PathValue("recording"), who(r).School); e != nil {
		problem(w, 503, "Không lưu được trạng thái hủy")
		return
	}
	a.cache.Del(r.Context(), "recording-multipart:"+r.PathValue("recording"))
	a.audit(r, "recording.multipart.abort", r.PathValue("recording"))
	send(w, 200, map[string]bool{"ok": true})
}
