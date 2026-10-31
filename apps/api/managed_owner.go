package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"net/mail"
	"os"
	"regexp"
	"strings"
)

// Operator-only credential update; roles, grants, account state and 2FA are preserved.
func managedOwner(db *sql.DB, raw []byte) error {
	var in struct {
		ID, Email, Password string
		Revision            int
	}
	if json.Unmarshal(raw, &in) != nil || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(in.ID) {
		return errors.New("INVALID_OWNER_INPUT")
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	address, err := mail.ParseAddress(in.Email)
	if err != nil || address.Address != in.Email || len(in.Email) > 190 {
		return errors.New("INVALID_OWNER_EMAIL")
	}
	if in.Password != "" && !validAccountPassword("admin", in.Password) {
		return errors.New("INVALID_OWNER_PASSWORD")
	}
	var hash string
	if in.Password != "" {
		value, err := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
		if err != nil {
			return err
		}
		hash = string(value)
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	var school, email string
	var revision int
	if err = tx.QueryRow("SELECT COUNT(*),COALESCE(MIN(id),'') FROM schools").Scan(&count, &school); err != nil || count != 1 {
		return errors.New("SINGLE_SCHOOL_REQUIRED")
	}
	if err = tx.QueryRow("SELECT email,revision FROM users WHERE school_id=? AND id=? AND role='admin' AND active=TRUE AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.school_id=users.school_id AND d.user_id=users.id) FOR UPDATE", school, in.ID).Scan(&email, &revision); err != nil {
		return errors.New("OWNER_NOT_FOUND")
	}
	if revision != in.Revision {
		return errors.New("OWNER_CHANGED")
	}
	if email == in.Email && hash == "" {
		return json.NewEncoder(os.Stdout).Encode(map[string]bool{"ok": true})
	}
	if _, err = tx.Exec("UPDATE users SET email=?,password_hash=IF(?='',password_hash,?),session_version=session_version+1,revision=revision+1 WHERE school_id=? AND id=?", in.Email, hash, hash, school, in.ID); err != nil {
		return errors.New("OWNER_EMAIL_CONFLICT")
	}
	if _, err = tx.Exec("INSERT INTO audit_log(school_id,actor_id,action,target) VALUES(?,?,'hosting.owner.update',?)", school, in.ID, in.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]bool{"ok": true})
}
