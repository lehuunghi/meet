package main

import (
	"fmt"
	"net/http"
	"time"
)

// School reports use Vietnam's UTC+7 calendar month, independently of the browser's location.
func reportMonth(r *http.Request) (string, time.Time, time.Time, error) {
	raw := r.URL.Query().Get("month")
	if raw == "" {
		return "", time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2101, 1, 1, 0, 0, 0, 0, time.UTC), nil
	}
	t, e := time.ParseInLocation("2006-01", raw, time.FixedZone("ICT", 7*3600))
	if e != nil || t.Year() < 2000 || t.Year() > 2100 {
		return "", time.Time{}, time.Time{}, fmt.Errorf("Chọn tháng hợp lệ từ năm 2000 đến 2100")
	}
	return raw, t.UTC(), t.AddDate(0, 1, 0).UTC(), nil
}
