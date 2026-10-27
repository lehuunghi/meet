package main

import (
	"context"
	"database/sql"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"strings"
)

// Erase only the deleted profile's own private avatar in its pinned storage account.
func (a *app) cleanupDeletedAvatar(ctx context.Context) error {
	cfg, e := loadSettings()
	if e != nil {
		return e
	}
	if !cfg.R2.Enabled {
		return nil
	}
	var school, user, key string
	e = a.db.QueryRowContext(ctx, "SELECT school_id,user_id,avatar_key FROM account_deletions WHERE avatar_deleted=FALSE AND avatar_key<>'' AND storage_account=? AND bucket=? ORDER BY deleted_at LIMIT 1", cfg.R2.Account, cfg.R2.Bucket).Scan(&school, &user, &key)
	if e == sql.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if !strings.HasPrefix(key, "academy/avatars/"+school+"/"+user+"/") || strings.Contains(key, "..") {
		return nil
	}
	if _, e = a.s3Client(cfg.R2).DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &cfg.R2.Bucket, Key: &key}); e != nil {
		return e
	}
	_, e = a.db.ExecContext(ctx, "UPDATE account_deletions SET avatar_deleted=TRUE,avatar_key='' WHERE school_id=? AND user_id=? AND avatar_key=?", school, user, key)
	return e
}
