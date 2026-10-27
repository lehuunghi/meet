package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func exerciseWebsiteAssets(t *testing.T, a *app, db *sql.DB, request func(string, string, string, *http.Cookie) *httptest.ResponseRecorder, admin, student, other *http.Cookie) {
	t.Helper()
	must := func(r *httptest.ResponseRecorder, want int) {
		t.Helper()
		if r.Code != want {
			t.Fatalf("website assets want %d got %d %s", want, r.Code, r.Body.String())
		}
	}
	cfg, e := loadSettings()
	if e != nil {
		t.Fatal(e)
	}
	original := cfg
	cfg.R2.Enabled = false
	if e = saveSettings(cfg); e != nil {
		t.Fatal(e)
	}
	defer saveSettings(original)
	must(request("GET", "/api/academy/logo", "", nil), 404)
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	img.Set(2, 2, color.NRGBA{R: 20, G: 80, B: 200, A: 255})
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	payload, _ := json.Marshal(map[string]any{"image_data": base64.StdEncoding.EncodeToString(buf.Bytes()), "revision": ""})
	must(request("POST", "/api/academy/site/logo", string(payload), student), 403)
	saved := request("POST", "/api/academy/site/logo", string(payload), admin)
	must(saved, 200)
	var logo map[string]string
	_ = json.Unmarshal(saved.Body.Bytes(), &logo)
	shown := request("GET", logo["url"], "", nil)
	must(shown, 200)
	if shown.Header().Get("Content-Type") != "image/png" || !bytes.Equal(shown.Body.Bytes(), buf.Bytes()) || shown.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("logo bytes or content type invalid")
	}
	must(request("POST", "/api/academy/site/logo", string(payload), admin), 409)
	must(request("GET", "/api/academy/logo?v=wrong", "", nil), 404)
	bad, _ := json.Marshal(map[string]any{"image_data": base64.StdEncoding.EncodeToString([]byte(`<svg onload="alert(1)"></svg>`)), "revision": logo["revision"]})
	must(request("POST", "/api/academy/site/logo", string(bad), admin), 400)
	oversized, _ := json.Marshal(map[string]any{"image_data": base64.StdEncoding.EncodeToString(make([]byte, (512<<10)+1)), "revision": logo["revision"]})
	must(request("POST", "/api/academy/site/logo", string(oversized), admin), 400)
	deletion, _ := json.Marshal(map[string]any{"delete": true, "revision": logo["revision"]})
	must(request("POST", "/api/academy/site/logo", string(deletion), other), 409)
	must(request("GET", logo["url"], "", nil), 200)
	page := request("GET", "/website", "", nil)
	must(page, 200)
	if !strings.Contains(page.Body.String(), `class="website-logo"`) {
		t.Fatal("logo not rendered in site")
	}
	req := httptest.NewRequest("GET", logo["url"], nil)
	req.Header.Set("If-None-Match", `"`+logo["revision"]+`"`)
	w := httptest.NewRecorder()
	a.routes().ServeHTTP(w, req)
	must(w, 304)
	must(request("POST", "/api/academy/site/logo", string(deletion), admin), 200)
	must(request("GET", logo["url"], "", nil), 404)
	before := request("GET", "/api/academy/site", "", admin)
	must(before, 200)
	var siteRows []map[string]string
	_ = json.Unmarshal(before.Body.Bytes(), &siteRows)
	posts := []academyPost{}
	for i := 0; i < 11; i++ {
		posts = append(posts, academyPost{Slug: fmt.Sprintf("news-%d", i), Title: fmt.Sprintf("News %d", i), Published: i != 2 && i != 7})
	}
	data, _ := json.Marshal(map[string]any{"revision": siteRows[0]["revision"], "content": map[string]any{"headline": "News QA", "published": true, "posts": posts}})
	must(request("POST", "/api/academy/site", string(data), admin), 200)
	for i, count := range []int{4, 4, 1} {
		r := request("GET", fmt.Sprintf("/website?tin=%d", i+1), "", nil)
		must(r, 200)
		if strings.Count(r.Body.String(), `class="post-card"`) != count || !strings.Contains(r.Body.String(), `class="news-pagination"`) {
			t.Fatal("bad rendered news page", i+1)
		}
	}
	must(request("GET", "/website?tin=4", "", nil), 404)
	must(request("GET", "/website?tin=bad", "", nil), 400)
	after := request("GET", "/api/academy/site", "", admin)
	_ = json.Unmarshal(after.Body.Bytes(), &siteRows)
	// Fixture database is isolated; no production website or customer logo is modified.
}
