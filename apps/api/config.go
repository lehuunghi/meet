package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type sfuProvider struct {
	Generation int64  `json:"-"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	AppID      string `json:"app_id"`
	Secret     string `json:"secret"`
	Weight     int    `json:"weight"`
	Enabled    bool   `json:"enabled"`
	SecretSet  bool   `json:"secret_set,omitempty"`
}
type r2Settings struct {
	Enabled   bool   `json:"enabled"`
	Account   string `json:"account_id"`
	Bucket    string `json:"bucket"`
	Access    string `json:"access_key_id"`
	Secret    string `json:"secret_access_key"`
	Lifecycle bool   `json:"lifecycle_applied"`
	AccessSet bool   `json:"access_key_set,omitempty"`
	SecretSet bool   `json:"secret_set,omitempty"`
}
type backupSettings struct {
	Enabled  bool `json:"enabled"`
	Interval int  `json:"interval_hours"`
}
type systemSettings struct {
	RecordingMode    string           `json:"recording_mode"`
	Platform         string           `json:"platform_mode"`
	Commerce         commerceSettings `json:"commerce"`
	CommerceRevision int              `json:"commerce_revision"`
	Backup           backupSettings   `json:"backup"`
	SFU              []sfuProvider    `json:"sfu"`
	TURN             []turnKey        `json:"turn"`
	R2               r2Settings       `json:"r2"`
	Retention        int              `json:"retention_days"`
}

func configPath(name string) string {
	d := os.Getenv("CONFIG_DIR")
	if d == "" {
		return ""
	}
	return filepath.Join(d, name)
}
func loadSettings() (systemSettings, error) {
	c := systemSettings{Retention: 30, SFU: []sfuProvider{}, TURN: []turnKey{}}
	if p := configPath("settings.json"); p != "" {
		b, e := os.ReadFile(p)
		if e == nil {
			e = json.Unmarshal(b, &c)
			c.TURN = []turnKey{}
			if c.Retention == 0 {
				c.Retention = 30
			}
			return c, e
		}
		if !errors.Is(e, os.ErrNotExist) {
			return c, e
		}
	}
	if id, key := secret("CF_SFU_APP_ID"), secret("CF_SFU_SECRET"); id != "" && key != "" {
		c.SFU = append(c.SFU, sfuProvider{ID: "legacy", Name: "SFU mặc định", AppID: id, Secret: key, Weight: 1, Enabled: true})
	}
	c.R2 = r2Settings{Account: secret("R2_ACCOUNT_ID"), Bucket: secret("R2_BUCKET"), Access: secret("R2_ACCESS_KEY_ID"), Secret: secret("R2_SECRET_ACCESS_KEY")}
	c.R2.Enabled = c.R2.Account != "" && c.R2.Bucket != "" && c.R2.Access != "" && c.R2.Secret != ""
	return c, nil
}
func saveSettings(c systemSettings) error {
	c.TURN = []turnKey{}
	p := configPath("settings.json")
	if p == "" {
		return errors.New("CONFIG_DIR is not configured")
	}
	b, e := json.MarshalIndent(c, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(p), ".settings-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, p)
}
func redactSettings(c systemSettings) systemSettings {
	c.Commerce.ChecksumKey = ""
	c.Commerce.APIKey = ""
	c.Commerce.SMTPPassword = ""
	c.SFU = append([]sfuProvider{}, c.SFU...)
	for i := range c.SFU {
		c.SFU[i].SecretSet = c.SFU[i].Secret != ""
		c.SFU[i].Secret = ""
	}
	c.TURN = append([]turnKey{}, c.TURN...)
	for i := range c.TURN {
		c.TURN[i].TokenSet = c.TURN[i].Token != ""
		c.TURN[i].Token = ""
	}
	c.R2.AccessSet = c.R2.Access != ""
	c.R2.SecretSet = c.R2.Secret != ""
	c.R2.Access = ""
	c.R2.Secret = ""
	return c
}

var configID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var cfID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

func validateSettings(next *systemSettings, old systemSettings) error {
	if next.RecordingMode != "" && !validRecordingMode(next.RecordingMode) {
		return errors.New("Phương thức ghi không hợp lệ")
	}
	if next.Platform == "" {
		next.Platform = "school"
	}
	if next.Platform != "school" && next.Platform != "academy" {
		return errors.New("Loại nền tảng không hợp lệ")
	}
	if next.Commerce.FreeVideos == 0 {
		next.Commerce.FreeVideos = 4
	}
	if next.Commerce.FreeVideos < 1 || next.Commerce.FreeVideos > 100 {
		return errors.New("Hạn mức video từ 1 đến 100")
	}
	if next.Commerce.ChecksumKey == "" {
		next.Commerce.ChecksumKey = old.Commerce.ChecksumKey
	}
	if next.Commerce.APIKey == "" {
		next.Commerce.APIKey = old.Commerce.APIKey
	}
	if next.Commerce.SMTPPassword == "" {
		next.Commerce.SMTPPassword = old.Commerce.SMTPPassword
	}
	if next.Retention == 0 {
		next.Retention = 30
	}
	if next.Retention < 1 || next.Retention > 3650 {
		return errors.New("Thời hạn ghi hình từ 1 đến 3650 ngày")
	}
	if next.Backup.Interval == 0 {
		next.Backup.Interval = 24
	}
	if next.Backup.Interval < 1 || next.Backup.Interval > 720 {
		return errors.New("Lịch sao lưu từ 1 đến 720 giờ")
	}
	if next.Backup.Enabled && !next.R2.Enabled {
		return errors.New("Bật R2 trước khi bật sao lưu")
	}
	next.R2.Lifecycle = false
	if len(next.SFU) > 32 {
		return errors.New("Tối đa 32 SFU app")
	}
	seen := map[string]bool{}
	apps := map[string]bool{}
	for i := range next.SFU {
		p := &next.SFU[i]
		if p.Secret == "" {
			for _, v := range old.SFU {
				if v.ID == p.ID && v.AppID == p.AppID {
					p.Secret = v.Secret
				}
			}
		}
		if !configID.MatchString(p.ID) || !cfID.MatchString(p.AppID) || p.Name == "" || len(p.Name) > 100 || len(p.Secret) < 8 || len(p.Secret) > 4096 || p.Weight < 1 || p.Weight > 100 || seen[p.ID] || apps[p.AppID] {
			return errors.New("SFU cần ID duy nhất, tên, App ID duy nhất, App Secret và trọng số 1–100")
		}
		seen[p.ID] = true
		apps[p.AppID] = true
		p.SecretSet = false
	}
	next.TURN = []turnKey{} // Legacy field accepted for backup compatibility; TURN is no longer used.
	if next.R2.Account == old.R2.Account && next.R2.Bucket == old.R2.Bucket {
		if next.R2.Access == "" {
			next.R2.Access = old.R2.Access
		}
		if next.R2.Secret == "" {
			next.R2.Secret = old.R2.Secret
		}
	}
	if next.R2.Enabled {
		if !regexp.MustCompile(`^[a-fA-F0-9]{32}$`).MatchString(next.R2.Account) || !regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`).MatchString(next.R2.Bucket) || len(next.R2.Access) < 8 || len(next.R2.Access) > 256 || len(next.R2.Secret) < 8 || len(next.R2.Secret) > 4096 {
			return errors.New("R2 cần Account ID 32 ký tự hex, bucket hợp lệ và cặp Access/Secret key")
		}
	}
	next.R2.AccessSet = false
	next.R2.SecretSet = false
	return nil
}
func setupTokenMatches(token string) bool {
	p := configPath("setup-token")
	if p == "" || len(token) < 32 {
		return false
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(digest(strings.TrimSpace(string(b)))), []byte(digest(token))) == 1
}
