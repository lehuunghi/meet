package main

import (
	"context"
	"database/sql"
	"fmt"
)

func migrateV2(c *sql.Conn) error {
	ctx := context.Background()
	for _, col := range []struct{ name, ddl string }{{"expires_at", "DATETIME(6) NULL"}, {"deleted_at", "DATETIME(6) NULL"}, {"bucket", "VARCHAR(63) NOT NULL DEFAULT ''"}} {
		var n int
		if e := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='recordings' AND column_name=?", col.name).Scan(&n); e != nil {
			return e
		}
		if n == 0 {
			if _, e := c.ExecContext(ctx, fmt.Sprintf("ALTER TABLE recordings ADD COLUMN %s %s", col.name, col.ddl)); e != nil {
				return e
			}
		}
	}
	if _, e := c.ExecContext(ctx, "UPDATE recordings SET expires_at=DATE_ADD(created_at,INTERVAL 30 DAY) WHERE expires_at IS NULL"); e != nil {
		return e
	}
	var indexed int
	if e := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='recordings' AND index_name='retention_due'").Scan(&indexed); e != nil {
		return e
	}
	if indexed == 0 {
		if _, e := c.ExecContext(ctx, "CREATE INDEX retention_due ON recordings(deleted_at,expires_at)"); e != nil {
			return e
		}
	}
	_, e := c.ExecContext(ctx, "INSERT IGNORE INTO schema_migrations VALUES(2)")
	return e
}
