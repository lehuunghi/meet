package main

import (
	"database/sql"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"net/mail"
	"os"
	"regexp"
)

// Explicit CLI provisioning: no public self-registration or shared global tenant bypass.
func bootstrap(db *sql.DB) error {
	slug := os.Getenv("SCHOOL_SLUG")
	name := os.Getenv("SCHOOL_NAME")
	email := os.Getenv("ADMIN_EMAIL")
	pass := secret("ADMIN_PASSWORD")
	addr, e := mail.ParseAddress(email)
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,79}$`).MatchString(slug) || name == "" || len(name) > 200 || e != nil || addr.Address != email || len(email) > 190 || len(pass) < 12 || len(pass) > 72 {
		return fmt.Errorf("set SCHOOL_SLUG, SCHOOL_NAME, ADMIN_EMAIL and ADMIN_PASSWORD_FILE (12–72 bytes)")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(pass), 12)
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	school := uid()
	if _, e = tx.Exec("INSERT INTO schools(id,slug,name) VALUES(?,?,?)", school, slug, name); e != nil {
		return e
	}
	if _, e = tx.Exec("INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES(?,?,?,?,?,'admin')", uid(), school, email, "Administrator", hash); e != nil {
		return e
	}
	return tx.Commit()
}
