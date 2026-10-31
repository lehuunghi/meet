package main

import (
	"encoding/json"
	"net"
	"net/mail"
	"os"
	"strings"
)

// Shared infrastructure mail never becomes a locally saved commerce setting.
// A website with its own SMTP address always takes precedence.
func academySMTP(c commerceSettings) commerceSettings {
	if c.SMTPAddress != "" {
		return c
	}
	raw, err := os.ReadFile(configPath("shared-smtp.json"))
	if err != nil {
		return c
	}
	var shared struct {
		Enabled bool `json:"enabled"`
		commerceSettings
	}
	if json.Unmarshal(raw, &shared) != nil || !shared.Enabled {
		return c
	}
	h, p, err := net.SplitHostPort(shared.SMTPAddress)
	if err != nil || h == "" || (p != "465" && p != "587") {
		return c
	}
	if a, err := mail.ParseAddress(shared.SMTPFrom); err != nil || a.Address != shared.SMTPFrom {
		return c
	}
	for _, s := range []string{shared.SMTPAddress, shared.SMTPFrom, shared.SMTPUser, shared.SMTPPassword} {
		if strings.ContainsAny(s, "\r\n\x00") {
			return c
		}
	}
	c.SMTPAddress = shared.SMTPAddress
	c.SMTPFrom = shared.SMTPFrom
	c.SMTPUser = shared.SMTPUser
	c.SMTPPassword = shared.SMTPPassword
	return c
}
func academySMTPConfigured(c commerceSettings) bool {
	c = academySMTP(c)
	return c.SMTPAddress != "" && c.SMTPFrom != ""
}
