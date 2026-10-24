package main

import "testing"

func TestAcademicValidation(t *testing.T) {
	valid := []accountRow{{Email: "Student@example.test", Code: "sv01", Name: "Nguyễn An", Password: "unique-password-123"}}
	if e := validateAccounts(valid, "student"); e != nil || valid[0].Email != "student@example.test" || valid[0].Code != "SV01" {
		t.Fatal("normalization/validation failed")
	}
	for _, rows := range [][]accountRow{{{Email: "bad", Code: "SV1", Name: "Name", Password: "unique-password-123"}}, {{Email: "a@example.test", Code: "a@b", Name: "Name", Password: "unique-password-123"}}, {{Email: "a@example.test", Code: "SV1", Name: "Name", Password: "unique-password-123"}, {Email: "b@example.test", Code: "sv1", Name: "Other", Password: "unique-password-123"}}} {
		if validateAccounts(rows, "student") == nil {
			t.Fatal("invalid/duplicate student accepted")
		}
	}
	if validateAccounts([]accountRow{{ID: "SV000001", Revision: 1, Email: "a@example.test", Code: "SV01", Name: "Name", Password: ""}}, "student") != nil {
		t.Fatal("blank password on existing row rejected")
	}
	if validateAccounts([]accountRow{{Email: "a@example.test", Code: "SV1", Name: "Teacher", Password: "unique-password-123"}}, "teacher") == nil {
		t.Fatal("teacher received student code")
	}
}
