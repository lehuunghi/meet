package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAcademyPrimitives(t *testing.T) {
	now := time.Date(2026, 10, 31, 18, 0, 0, 0, time.UTC)
	if monthlyPeriod(now) != "2026-11" {
		t.Fatal("month must use UTC+7")
	}
	previous := now.AddDate(0, 0, 20)
	if !extendVIP(now, previous, 30).Equal(now.AddDate(0, 0, 50)) {
		t.Fatal("renewal lost remaining days")
	}
	if !extendVIP(now, now.AddDate(0, 0, -1), 30).Equal(now.AddDate(0, 0, 30)) {
		t.Fatal("expired renewal incorrect")
	}
	data := map[string]any{"amount": json.Number("3000"), "orderCode": json.Number("123"), "description": "NAPVIP 123"}
	first, _ := paySignature(data, "test-key")
	data["amount"] = json.Number("4000")
	second, _ := paySignature(data, "test-key")
	if first == second {
		t.Fatal("amount not signed")
	}
	p := studentProfile{Name: "Học sinh", DOB: "2010-02-03", Address: "Địa chỉ đầy đủ", School: "Trường phổ thông", Phone: "0901234567", Parent: "0912345678"}
	if !validStudentProfile(p) {
		t.Fatal("valid profile rejected")
	}
	p.DOB = "2999-01-01"
	if validStudentProfile(p) {
		t.Fatal("future birth accepted")
	}
}
