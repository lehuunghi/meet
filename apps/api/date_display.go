package main

import (
	"fmt"
	"time"
)

var vietnamZone = time.FixedZone("ICT", 7*3600)

func vietnamDateText(value any, dateOnly bool) string {
	if value == nil {
		return ""
	}
	var t time.Time
	if v, ok := value.(time.Time); ok {
		t = v
	} else {
		raw := fmt.Sprint(value)
		if b, ok := value.([]byte); ok {
			raw = string(b)
		}
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999", "2006-01-02"} {
			v, e := time.Parse(layout, raw)
			if e == nil {
				t = v
				break
			}
		}
		if t.IsZero() {
			return raw
		}
	}
	if dateOnly {
		return t.In(vietnamZone).Format("02/01/2006")
	}
	return t.In(vietnamZone).Format("02/01/2006 15:04")
}
