package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSessionCreationOmitsBody(t *testing.T) {
	a := &app{client: &http.Client{Transport: testTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "POST" || r.ContentLength != 0 || r.Body != nil {
			t.Fatal("new session must not send {}, null or SDP")
		}
		return &http.Response{StatusCode: 201, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"sessionId":"test-session"}`)), Request: r}, nil
	})}}
	out, e := a.cloud(httptest.NewRequest("POST", "http://local", nil), "POST", "apps/test/sessions/new", "test-secret", nil)
	if e != nil || out["sessionId"] != "test-session" {
		t.Fatal(e, out)
	}
}
