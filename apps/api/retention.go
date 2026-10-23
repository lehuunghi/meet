package main

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

const recordingDays = 30
const recordingPrefix = "recordings/"

// s3Client keeps all R2 traffic on a bounded, injectable HTTP client.
func (a *app) s3Client(c r2Settings) *s3.Client {
	return s3.New(s3.Options{Region: "auto", BaseEndpoint: aws.String("https://" + c.Account + ".r2.cloudflarestorage.com"), Credentials: credentials.NewStaticCredentialsProvider(c.Access, c.Secret, ""), HTTPClient: a.client})
}
func missingRule(err error, code string) bool {
	var api smithy.APIError
	return errors.As(err, &api) && api.ErrorCode() == code
}
func retentionRules(existing []types.LifecycleRule) []types.LifecycleRule {
	out := []types.LifecycleRule{}
	for _, r := range existing {
		if aws.ToString(r.ID) != "meet-recordings-30d" {
			out = append(out, r)
		}
	}
	return append(out, types.LifecycleRule{ID: aws.String("meet-recordings-30d"), Status: types.ExpirationStatusEnabled, Filter: &types.LifecycleRuleFilter{Prefix: aws.String(recordingPrefix)}, Expiration: &types.LifecycleExpiration{Days: aws.Int32(recordingDays)}})
}
func (a *app) configureBucket(ctx context.Context, c r2Settings) error {
	client := a.s3Client(c)
	old, e := client.GetBucketLifecycleConfiguration(ctx, &s3.GetBucketLifecycleConfigurationInput{Bucket: &c.Bucket})
	if e != nil && !missingRule(e, "NoSuchLifecycleConfiguration") {
		return e
	}
	rules := []types.LifecycleRule{}
	if old != nil {
		rules = old.Rules
	}
	if _, e = client.PutBucketLifecycleConfiguration(ctx, &s3.PutBucketLifecycleConfigurationInput{Bucket: &c.Bucket, LifecycleConfiguration: &types.BucketLifecycleConfiguration{Rules: retentionRules(rules)}}); e != nil {
		return e
	}
	cors, e := client.GetBucketCors(ctx, &s3.GetBucketCorsInput{Bucket: &c.Bucket})
	if e != nil && !missingRule(e, "NoSuchCORSConfiguration") {
		return e
	}
	cr := []types.CORSRule{}
	if cors != nil {
		for _, r := range cors.CORSRules {
			if aws.ToString(r.ID) != "meet-origin" {
				cr = append(cr, r)
			}
		}
	}
	cr = append(cr, types.CORSRule{ID: aws.String("meet-origin"), AllowedOrigins: []string{a.origin}, AllowedMethods: []string{"PUT", "GET", "HEAD"}, AllowedHeaders: []string{"Content-Type"}, ExposeHeaders: []string{"ETag"}, MaxAgeSeconds: aws.Int32(3600)})
	if _, e = client.PutBucketCors(ctx, &s3.PutBucketCorsInput{Bucket: &c.Bucket, CORSConfiguration: &types.CORSConfiguration{CORSRules: cr}}); e != nil {
		return e
	}
	// Re-read lifecycle: the UI only reports applied after provider confirmation.
	verify, e := client.GetBucketLifecycleConfiguration(ctx, &s3.GetBucketLifecycleConfigurationInput{Bucket: &c.Bucket})
	if e != nil {
		return e
	}
	for _, r := range verify.Rules {
		if aws.ToString(r.ID) == "meet-recordings-30d" && r.Expiration != nil && aws.ToInt32(r.Expiration.Days) == 30 && r.Status == types.ExpirationStatusEnabled && r.Filter != nil && aws.ToString(r.Filter.Prefix) == recordingPrefix {
			return nil
		}
	}
	return errors.New("lifecycle not confirmed")
}
func remainingLifetime(now, expires time.Time) time.Duration {
	d := expires.Sub(now)
	if d > 5*time.Minute {
		return 5 * time.Minute
	}
	return d
}
func (a *app) purgeExpired(ctx context.Context) error {
	cfg, e := loadSettings()
	if e != nil {
		return e
	}
	if !cfg.R2.Enabled {
		return nil
	}
	rows, e := a.db.QueryContext(ctx, "SELECT id,object_key,bucket FROM recordings WHERE deleted_at IS NULL AND expires_at<=UTC_TIMESTAMP(6) ORDER BY expires_at LIMIT 100")
	if e != nil {
		return e
	}
	type object struct{ id, key, bucket string }
	objects := []object{}
	for rows.Next() {
		var o object
		if e = rows.Scan(&o.id, &o.key, &o.bucket); e != nil {
			rows.Close()
			return e
		}
		objects = append(objects, o)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, o := range objects {
		if o.bucket == "" {
			o.bucket = cfg.R2.Bucket
		}
		if o.bucket != cfg.R2.Bucket || strings.Contains(o.key, "..") || o.key == "" {
			return errors.New("recording storage mismatch")
		}
		call, cancel := context.WithTimeout(ctx, 20*time.Second)
		_, e = a.s3Client(cfg.R2).DeleteObject(call, &s3.DeleteObjectInput{Bucket: &o.bucket, Key: &o.key})
		cancel()
		if e != nil {
			return errors.New("R2 retention delete failed; retry next cycle")
		}
		if _, e = a.db.ExecContext(ctx, "UPDATE recordings SET deleted_at=UTC_TIMESTAMP(6) WHERE id=? AND expires_at<=UTC_TIMESTAMP(6)", o.id); e != nil {
			return e
		}
	}
	return nil
}
func (a *app) retentionLoop(ctx context.Context) {
	timer := time.NewTicker(time.Hour)
	defer timer.Stop()
	for {
		job, cancel := context.WithTimeout(ctx, 10*time.Minute)
		if e := a.purgeExpired(job); e != nil && ctx.Err() == nil {
			slog.Error("recording retention cycle failed")
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
