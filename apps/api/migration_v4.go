package main

import (
	"context"
	"database/sql"
)

// Display-only codes are allocated independently by prefix. UUID relationships never change.
func migrateV4(c *sql.Conn) error {
	ctx := context.Background()
	rows, e := c.QueryContext(ctx, "SELECT e.kind,e.entity_id FROM entity_codes e LEFT JOIN entity_short_codes s ON s.entity_id=e.entity_id WHERE s.entity_id IS NULL ORDER BY e.id")
	if e != nil {
		return e
	}
	type item struct{ kind, id string }
	all := []item{}
	for rows.Next() {
		var v item
		if e = rows.Scan(&v.kind, &v.id); e != nil {
			rows.Close()
			return e
		}
		all = append(all, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range all {
		tx, err := c.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		_, err = shortCode(tx, v.kind, v.id)
		if err != nil {
			tx.Rollback()
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	for _, table := range []string{"users", "classes", "courses"} {
		if _, e = c.ExecContext(ctx, "UPDATE "+table+" t JOIN entity_short_codes e ON e.entity_id=t.id SET t.short_id=CONCAT(e.kind,LPAD(e.number,4,'0')) WHERE t.short_id IS NULL OR t.short_id<>CONCAT(e.kind,LPAD(e.number,4,'0'))"); e != nil {
			return e
		}
	}
	_, e = c.ExecContext(ctx, "INSERT IGNORE INTO schema_migrations VALUES(4)")
	return e
}
