package main

import (
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWeightedClassAllocation(t *testing.T) {
	pool := []sfuProvider{{ID: "a", Weight: 2, Enabled: true}, {ID: "b", Weight: 1, Enabled: true}}
	counts := map[string]int64{}
	for i := 0; i < 300; i++ {
		p, e := chooseProvider(pool, counts)
		if e != nil {
			t.Fatal(e)
		}
		counts[p.ID]++
	}
	if counts["a"] != 200 || counts["b"] != 100 {
		t.Fatalf("weighted counts: %v", counts)
	}
	pool[0].Enabled = false
	p, e := chooseProvider(pool, counts)
	if e != nil || p.ID != "b" {
		t.Fatal("disabled app received a new class")
	}
	pool[1].Enabled = false
	if _, e = chooseProvider(pool, counts); e == nil {
		t.Fatal("empty enabled pool accepted")
	}
}
func TestConfigSecretsAndValidation(t *testing.T) {
	t.Setenv("CONFIG_DIR", t.TempDir())
	old := systemSettings{Retention: 30, SFU: []sfuProvider{{ID: "a", Name: "A", AppID: "app-a", Secret: "test-secret-a", Weight: 1, Enabled: true}}, TURN: []turnKey{{ID: "turn-a", Token: "test-turn-token"}}}
	next := redactSettings(old)
	if next.SFU[0].Secret != "" || !next.SFU[0].SecretSet || next.TURN[0].Token != "" || !next.TURN[0].TokenSet {
		t.Fatal("secrets not redacted")
	}
	if e := validateSettings(&next, old); e != nil || next.SFU[0].Secret != old.SFU[0].Secret || len(next.TURN) != 0 {
		t.Fatal("blank update did not preserve secret")
	}
	if e := saveSettings(next); e != nil {
		t.Fatal(e)
	}
	read, e := loadSettings()
	if e != nil || read.SFU[0].Secret != old.SFU[0].Secret {
		t.Fatal("settings round trip")
	}
	next.SFU = append(next.SFU, next.SFU[0])
	if validateSettings(&next, old) == nil {
		t.Fatal("duplicate app accepted")
	}
	if e = os.WriteFile(filepath.Join(os.Getenv("CONFIG_DIR"), "setup-token"), []byte(strings.Repeat("a", 64)), 0600); e != nil {
		t.Fatal(e)
	}
	if !setupTokenMatches(strings.Repeat("a", 64)) || setupTokenMatches(strings.Repeat("b", 64)) {
		t.Fatal("setup token verification")
	}
}
func TestRetentionRuleAndURLExpiry(t *testing.T) {
	if !conflictingExpiry([]types.LifecycleRule{{ID: aws.String("global-7d"), Status: types.ExpirationStatusEnabled, Expiration: &types.LifecycleExpiration{Days: aws.Int32(7)}}}) || conflictingExpiry([]types.LifecycleRule{{ID: aws.String("other-7d"), Status: types.ExpirationStatusEnabled, Filter: &types.LifecycleRuleFilter{Prefix: aws.String("unrelated/")}, Expiration: &types.LifecycleExpiration{Days: aws.Int32(7)}}}) {
		t.Fatal("conflicting expiration rule not detected")
	}
	rules := retentionRules([]types.LifecycleRule{{ID: aws.String("other-app"), Status: types.ExpirationStatusEnabled}, {ID: aws.String("meet-recordings-30d")}})
	if len(rules) != 2 || aws.ToString(rules[0].ID) != "other-app" || aws.ToInt32(rules[1].Expiration.Days) != 30 || aws.ToString(rules[1].Filter.Prefix) != "recordings/" {
		t.Fatal("retention must preserve unrelated rules and scope to recordings")
	}
	now := time.Now()
	if remainingLifetime(now, now.Add(time.Minute)) != time.Minute || remainingLifetime(now, now.Add(time.Hour)) != 5*time.Minute || remainingLifetime(now, now.Add(-time.Second)) >= 0 {
		t.Fatal("signed URL could outlive recording")
	}
}
