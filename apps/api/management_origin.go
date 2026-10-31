package main

import (
	"encoding/json"
	"net/url"
	"os"
	"regexp"
)

func validControlOrigin(origin string) bool {
	u, e := url.Parse(origin)
	return e == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/") && u.Port() == ""
}
func controlBinding() (string, string) {
	var v struct {
		Origin string `json:"control_origin"`
		ID     string `json:"control_id"`
	}
	raw, e := os.ReadFile(configPath("managed.json"))
	if e != nil || json.Unmarshal(raw, &v) != nil || !validControlOrigin(v.Origin) || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(v.ID) {
		return "", ""
	}
	return v.Origin, v.ID
}
func managementURL() string {
	origin, id := controlBinding()
	if origin == "" {
		return ""
	}
	return origin + "/#academy/" + id
}
