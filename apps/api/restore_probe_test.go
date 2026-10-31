package main

import "testing"

func TestRestoreProbeRefusesProductionIdentities(t *testing.T) {
	goodDB := "meetcheck_0123456789abcdef0123"
	goodUser := "mcheck_0123456789abcdef0123"
	goodPrefix := "meet:0123456789abcdef0123456789abcdef:"
	if !validRestoreProbe(goodDB, goodUser, goodPrefix) {
		t.Fatal("valid disposable identity rejected")
	}
	for _, v := range [][3]string{{"meet_school", goodUser, goodPrefix}, {goodDB, "root", goodPrefix}, {goodDB, goodUser, ""}, {goodDB, goodUser, "meet:*:"}} {
		if validRestoreProbe(v[0], v[1], v[2]) {
			t.Fatal("unsafe probe identity accepted")
		}
	}
}
