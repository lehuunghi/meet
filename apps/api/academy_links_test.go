package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestReportMonthAndCheckoutLinks(t *testing.T) {
	_, from, to, e := reportMonth(httptest.NewRequest("GET", "/?month=2026-11", nil))
	if e != nil || from.Format(time.RFC3339) != "2026-10-31T17:00:00Z" || to.Format(time.RFC3339) != "2026-11-30T17:00:00Z" {
		t.Fatal(from, to, e)
	}
	for _, v := range []string{"2026-13", "2026-1", "1999-12", "2101-01"} {
		if _, _, _, e := reportMonth(httptest.NewRequest("GET", "/?month="+v, nil)); e == nil {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"https://pay.payos.vn/web/id", "https://payos.vn.evil.test/id", "https://evil.payos.vn@evil.test/", "javascript:alert(1)", "https://pay.payos.vn:444/id"} {
		want := v == "https://pay.payos.vn/web/id"
		if validCheckoutURL(v) != want {
			t.Fatal(v)
		}
	}
}
