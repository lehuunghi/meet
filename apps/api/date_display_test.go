package main

import (
	"testing"
	"time"
)

func TestVietnamDateExport(t *testing.T) {
	v, _ := time.Parse(time.RFC3339, "2026-01-02T18:05:00Z")
	if vietnamDateText(v, false) != "03/01/2026 01:05" || vietnamDateText([]byte("2010-02-03"), true) != "03/02/2010" {
		t.Fatal("Vietnam date format/timezone mismatch")
	}
}
