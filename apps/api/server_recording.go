package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// Status only: the isolated recorder owns media reception and R2 uploads.
// No recorder secrets or provider responses are returned to participants.
func (a *app) serverRecordingStatus(r *http.Request) map[string]any {
	cfg, e := loadSettings()
	if e != nil || !cfg.R2.Enabled {
		return map[string]any{"state": "disabled"}
	}
	if a.cache.Exists(r.Context(), "server-recorder:seen").Val() == 0 {
		return map[string]any{"state": "unavailable"}
	}
	if seconds, _ := a.cache.Get(r.Context(), "server-recording-duration:"+who(r).School+":"+r.PathValue("id")).Int64(); seconds >= 8*3600 {
		return map[string]any{"state": "limit"}
	}
	raw, e := a.cache.Get(r.Context(), "server-recording:"+who(r).School+":"+r.PathValue("id")).Result()
	var status struct {
		State string `json:"state"`
		Seen  int64  `json:"seen"`
	}
	if e != nil || json.Unmarshal([]byte(raw), &status) != nil {
		return map[string]any{"state": "queued"}
	}
	if time.Now().Unix()-status.Seen > 30 && status.State != "complete" {
		return map[string]any{"state": "interrupted"}
	}
	switch status.State {
	case "starting", "recording", "waiting", "saving", "complete", "error", "interrupted", "limit":
		return map[string]any{"state": status.State}
	}
	return map[string]any{"state": "unavailable"}
}
