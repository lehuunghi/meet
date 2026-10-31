package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestForcedMediaClose(t *testing.T) {
	for _, tc := range []struct {
		name, inspect, closed string
		status                int
		wantError             bool
		wantPUT               bool
	}{
		{"active tracks", `{"tracks":[{"mid":"0","status":"active"},{"mid":"1","status":"inactive"}]}`, `{"tracks":[{"mid":"0"}]}`, 200, false, true},
		{"already inactive", `{"tracks":[{"mid":"0","status":"inactive"}]}`, `{}`, 200, false, false},
		{"expired", `{}`, `{}`, 410, false, false},
		{"provider unavailable", `{}`, `{}`, 503, true, false},
		{"unknown response", `{}`, `{}`, 200, true, false},
		{"per-track error", `{"tracks":[{"mid":"0","status":"active"}]}`, `{"tracks":[{"mid":"0","errorCode":"provider_error"}]}`, 200, true, true},
		{"partial close", `{"tracks":[{"mid":"0","status":"active"}]}`, `{"tracks":[]}`, 200, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			put := false
			a := &app{client: &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Authorization") != "Bearer test-secret" {
					t.Fatal("missing server credential")
				}
				body := tc.inspect
				status := tc.status
				if r.Method == "PUT" {
					put = true
					if !strings.HasSuffix(r.URL.Path, "/tracks/close") {
						t.Fatal(r.URL.Path)
					}
					var in struct {
						Force  bool `json:"force"`
						Tracks []struct {
							MID string `json:"mid"`
						} `json:"tracks"`
					}
					if json.NewDecoder(r.Body).Decode(&in) != nil || !in.Force || len(in.Tracks) != 1 || in.Tracks[0].MID != "0" {
						t.Fatal("unsafe close request")
					}
					body = tc.closed
					status = 200
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
			})}}
			err := a.closeProviderSession(context.Background(), sfuProvider{AppID: "app", Secret: "test-secret"}, "session")
			if (err != nil) != tc.wantError || put != tc.wantPUT {
				t.Fatalf("err=%v put=%v", err, put)
			}
		})
	}
}
