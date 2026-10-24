package main

import (
	"context"
	"database/sql"
	"fmt"
)

func migrateV3(c *sql.Conn) error {
	ctx := context.Background()
	for _, v := range []struct{ table, name, ddl string }{{"users", "short_id", "VARCHAR(20) NULL"}, {"users", "student_code", "VARCHAR(40) NULL"}, {"users", "revision", "INT NOT NULL DEFAULT 1"}, {"classes", "short_id", "VARCHAR(20) NULL"}, {"courses", "short_id", "VARCHAR(20) NULL"}, {"courses", "revision", "INT NOT NULL DEFAULT 1"}} {
		var n int
		if e := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?", v.table, v.name).Scan(&n); e != nil {
			return e
		}
		if n == 0 {
			if _, e := c.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", v.table, v.name, v.ddl)); e != nil {
				return e
			}
		}
	}
	var nullable string
	if e := c.QueryRowContext(ctx, "SELECT is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='courses' AND column_name='teacher_id'").Scan(&nullable); e != nil {
		return e
	}
	if nullable != "YES" {
		if _, e := c.ExecContext(ctx, "ALTER TABLE courses MODIFY teacher_id CHAR(36) NULL"); e != nil {
			return e
		}
	}
	for _, v := range []struct{ table, name, cols string }{{"users", "user_short", "short_id"}, {"users", "tenant_student_code", "school_id,student_code"}, {"classes", "class_short", "short_id"}, {"courses", "course_short", "short_id"}} {
		var n int
		if e := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?", v.table, v.name).Scan(&n); e != nil {
			return e
		}
		if n == 0 {
			if _, e := c.ExecContext(ctx, fmt.Sprintf("CREATE UNIQUE INDEX %s ON %s(%s)", v.name, v.table, v.cols)); e != nil {
				return e
			}
		}
	}
	for _, v := range []struct{ table, kind string }{{"users", ""}, {"classes", "LH"}, {"courses", "MH"}} {
		q := "SELECT id,'' FROM " + v.table + " WHERE short_id IS NULL"
		if v.table == "users" {
			q = "SELECT id,role FROM users WHERE short_id IS NULL"
		}
		rows, e := c.QueryContext(ctx, q)
		if e != nil {
			return e
		}
		type entry struct{ id, role string }
		all := []entry{}
		for rows.Next() {
			var x entry
			if e = rows.Scan(&x.id, &x.role); e != nil {
				rows.Close()
				return e
			}
			all = append(all, x)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, x := range all {
			kind := v.kind
			if v.table == "users" {
				kind = map[string]string{"admin": "QT", "teacher": "GV", "student": "SV"}[x.role]
			}
			if _, e = c.ExecContext(ctx, "INSERT IGNORE INTO entity_codes(kind,entity_id) VALUES(?,?)", kind, x.id); e != nil {
				return e
			}
			var n int64
			if e = c.QueryRowContext(ctx, "SELECT id FROM entity_codes WHERE entity_id=?", x.id).Scan(&n); e != nil {
				return e
			}
			if _, e = c.ExecContext(ctx, "UPDATE "+v.table+" SET short_id=? WHERE id=?", fmt.Sprintf("%s%06d", kind, n), x.id); e != nil {
				return e
			}
		}
	}
	_, e := c.ExecContext(ctx, "INSERT IGNORE INTO schema_migrations VALUES(3)")
	return e
}
