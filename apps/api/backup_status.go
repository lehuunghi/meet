package main

import (
	"encoding/json"
	"os"
)

func backupStatus() any {
	p := configPath("backup-status.json")
	b, e := os.ReadFile(p)
	if e != nil {
		return nil
	}
	var v map[string]any
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	return v
}
