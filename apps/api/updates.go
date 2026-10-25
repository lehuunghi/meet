package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"time"
)

var buildCommit = "development"
var buildVersion = "0.5.0"

func (a *app) updateStatus(w http.ResponseWriter, r *http.Request) {
	var status map[string]any
	b, e := os.ReadFile(configPath("update-status.json"))
	if e != nil || len(b) > 16384 || json.Unmarshal(b, &status) != nil {
		send(w, 200, map[string]any{"state": "unavailable", "agent_available": false, "message": "Chưa kết nối dịch vụ cập nhật trên VPS. Xem hướng dẫn bật dịch vụ."})
		return
	}
	seen, _ := status["agent_seen"].(float64)
	status["agent_available"] = time.Now().Unix()-int64(seen) < 180
	status["running_commit"] = buildCommit
	status["running_version"] = buildVersion
	send(w, 200, status)
}

func (a *app) updateRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string `json:"action"`
		Target string `json:"target"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Action != "check" && in.Action != "apply" || in.Action == "apply" && !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(in.Target) {
		problem(w, 400, "Yêu cầu cập nhật không hợp lệ")
		return
	}
	if configPath("update-request.json") == "" {
		problem(w, 503, "CONFIG_DIR required")
		return
	}
	var status struct {
		Seen   int64  `json:"agent_seen"`
		State  string `json:"state"`
		Target string `json:"available_sha"`
		Ready  bool   `json:"can_update"`
	}
	b, e := os.ReadFile(configPath("update-status.json"))
	if e != nil || json.Unmarshal(b, &status) != nil || time.Now().Unix()-status.Seen > 180 {
		problem(w, 503, "Dịch vụ cập nhật chưa hoạt động trên VPS")
		return
	}
	if status.State == "updating" || status.State == "checking" || status.State == "recovery_required" {
		problem(w, 409, "Đang xử lý hoặc cần phục hồi; chưa nhận thêm cập nhật")
		return
	}
	if in.Action == "apply" && (!status.Ready || status.Target != in.Target) {
		problem(w, 409, "Kiểm tra phiên bản mới trước khi cập nhật")
		return
	}
	ok, e := a.cache.SetNX(r.Context(), "update-request:"+in.Action, "pending", 30*time.Second).Result()
	if e != nil || !ok {
		problem(w, 429, "Đợi 30 giây trước khi gửi lại")
		return
	}
	rawID := uid()
	id := fmt.Sprintf("%s-%s-%s-%s-%s", rawID[:8], rawID[8:12], rawID[12:16], rawID[16:20], rawID[20:])
	file, e := os.CreateTemp(os.Getenv("CONFIG_DIR"), ".update-request-*")
	if e != nil {
		problem(w, 500, "Không tạo được yêu cầu cập nhật")
		return
	}
	name := file.Name()
	defer os.Remove(name)
	e = json.NewEncoder(file).Encode(map[string]any{"id": id, "action": in.Action, "target": in.Target, "created_at": time.Now().Unix()})
	if e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e != nil || closeErr != nil {
		problem(w, 500, "Không lưu được yêu cầu")
		return
	}
	// Link publishes a complete file atomically and never overwrites an existing request.
	if e = os.Link(name, configPath("update-request.json")); e != nil {
		problem(w, 409, "Đã có yêu cầu chờ; đợi dịch vụ cập nhật")
		return
	}
	send(w, 202, map[string]string{"id": id, "message": "Đã gửi yêu cầu. Dịch vụ VPS sẽ xử lý trong khoảng một phút."})
}
