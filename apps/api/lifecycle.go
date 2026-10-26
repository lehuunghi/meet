package main

import (
	"encoding/json"
	"os"
)

// Only the root-owned agent changes this file; there is no public write endpoint.
func schoolSuspended() bool {
	raw, err := os.ReadFile(configPath("school-state.json"))
	if os.IsNotExist(err) || configPath("school-state.json") == "" {
		return false
	}
	if err != nil {
		return true
	}
	var state struct {
		State string `json:"state"`
	}
	return json.Unmarshal(raw, &state) != nil || state.State != "active"
}
