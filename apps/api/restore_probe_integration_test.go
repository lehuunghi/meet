package main

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestRestoreProbeDisposableIntegration(t *testing.T) {
	if os.Getenv("CI") != "true" || os.Getenv("TEST_MYSQL_DSN") == "" {
		t.Skip("disposable CI database required")
	}
	cfg, err := mysql.ParseDSN(os.Getenv("TEST_MYSQL_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cfg.DBName, "test") {
		t.Fatal("refuse non-test SQL target")
	}
	admin, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	suffix := uid()[:20]
	database, user, password := "meetcheck_"+suffix, "mcheck_"+suffix, uid()+uid()
	if _, err := admin.Exec("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + database + "`")
	if _, err := admin.Exec("CREATE USER '" + user + "'@'%' IDENTIFIED BY '" + password + "'"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP USER '" + user + "'@'%'")
	if _, err := admin.Exec("GRANT ALL ON `" + database + "`.* TO '" + user + "'@'%'"); err != nil {
		t.Fatal(err)
	}
	cfg.DBName, cfg.User, cfg.Passwd = database, user, password
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ALLOW_DEMO_SEED", "true")
	t.Setenv("DEMO_PASSWORD", "restore-test-only-password")
	t.Setenv("CONFIG_DIR", t.TempDir())
	if err := seed(db); err != nil {
		t.Fatal(err)
	}
	opt, err := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if err != nil {
		t.Fatal(err)
	}
	controller := redis.NewClient(opt)
	defer controller.Close()
	prefix := "meet:" + uid() + ":"
	args := []any{"ACL", "SETUSER", user, "reset", "on", ">" + password, "~" + prefix + "*", "resetchannels"}
	for _, command := range strings.Fields("ping get getdel set setnx setex psetex getset del unlink exists expire pexpire ttl pttl incr incrby decr mget mset lpush lrange ltrim sadd spop eval evalsha multi exec discard watch unwatch hello client|setinfo client|setname script|load script|exists") {
		args = append(args, "+"+command)
	}
	if err := controller.Do(context.Background(), args...).Err(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		it := controller.Scan(context.Background(), 0, prefix+"*", 100).Iterator()
		for it.Next(context.Background()) {
			controller.Del(context.Background(), it.Val())
		}
		controller.Do(context.Background(), "ACL", "DELUSER", user)
	}()
	t.Setenv("REDIS_URL", "redis://"+user+":"+password+"@"+opt.Addr+"/"+strconv.Itoa(opt.DB))
	t.Setenv("REDIS_KEY_PREFIX", prefix)
	var before, after int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&before)
	if err := restoreProbe(db); err != nil {
		t.Fatal(err)
	}
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&after)
	if before != after {
		t.Fatal("temporary login account not cleaned up")
	}
}
