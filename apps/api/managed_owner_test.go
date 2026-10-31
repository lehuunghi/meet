package main

import (
	"database/sql"
	"encoding/json"
	mysql "github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/bcrypt"
	"os"
	"strings"
	"testing"
)

func TestManagedOwnerPreservesPermissionsAndState(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN required")
	}
	base, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	name := "owner_test_" + uid()
	if _, err = base.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer base.Exec("DROP DATABASE " + name)
	opt, _ := mysql.ParseDSN(dsn)
	opt.DBName = name
	db, err := sql.Open("mysql", opt.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		t.Fatal(err)
	}
	id := strings.Repeat("a", 32)
	for _, statement := range []string{"INSERT INTO schools(id,slug,name) VALUES('school','school','School')", "INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES('" + id + "','school','old@example.test','Owner','keep-hash','admin')"} {
		if _, err = db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(email, password string, rev int) error {
		raw, _ := json.Marshal(map[string]any{"id": id, "email": email, "password": password, "revision": rev})
		return managedOwner(db, raw)
	}
	var rev, version int
	var email, hash, role string
	var active bool
	db.QueryRow("SELECT revision FROM users WHERE id=?", id).Scan(&rev)
	if err = apply("new@example.test", "new-owner-password-123", rev); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT email,password_hash,role,active,revision,session_version FROM users WHERE id=?", id).Scan(&email, &hash, &role, &active, &rev, &version); err != nil {
		t.Fatal(err)
	}
	if email != "new@example.test" || role != "admin" || !active || bcrypt.CompareHashAndPassword([]byte(hash), []byte("new-owner-password-123")) != nil {
		t.Fatal("Owner update failed")
	}
	var grants int
	db.QueryRow("SELECT COUNT(*) FROM user_controls WHERE user_id=?", id).Scan(&grants)
	if grants != 0 {
		t.Fatal("Full admin permissions changed")
	}
	if err = apply(email, "", rev); err != nil {
		t.Fatal(err)
	}
	var nextVersion int
	db.QueryRow("SELECT session_version FROM users WHERE id=?", id).Scan(&nextVersion)
	if nextVersion != version {
		t.Fatal("No-op changed sessions")
	}
	if err = apply(email, "short", rev); err == nil {
		t.Fatal("Short password accepted")
	}
	if err = apply("other@example.test", "", rev-1); err == nil {
		t.Fatal("Stale update accepted")
	}
}
