package main

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Retire first; preserve the durable SQL session until upstream teardown succeeds.
// Redis stores retirement/owner markers, never provider credentials.
func (a *app) mediaReset(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	var in struct {
		Session string `json:"session_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Session) > 100 {
		problem(w, 400, "Session không hợp lệ")
		return
	}
	lock := "sfu-lock:" + u.School + ":" + u.ID + ":" + r.PathValue("id")
	nonce := uid()
	got, e := a.cache.SetNX(r.Context(), lock, nonce, 30*time.Second).Result()
	if e != nil || !got {
		problem(w, 409, "Media negotiation busy; retry")
		return
	}
	defer a.cache.Eval(r.Context(), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
	rows, e := a.db.QueryContext(r.Context(), "SELECT id FROM media_sessions WHERE school_id=? AND meeting_id=? AND user_id=? AND (?='' OR id=?)", u.School, r.PathValue("id"), u.ID, in.Session, in.Session)
	if e != nil {
		problem(w, 503, "Không đọc được phiên media")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil || a.cache.SetNX(r.Context(), "media-retired:"+id, time.Now().Unix(), 0).Err() != nil {
			problem(w, 503, "Không thu hồi được phiên media")
			return
		}
	}
	if rows.Err() != nil {
		problem(w, 503, "Không đọc được phiên media")
		return
	}
	rows.Close()
	if _, e = a.db.ExecContext(r.Context(), "DELETE FROM publications WHERE school_id=? AND meeting_id=? AND user_id=? AND (?='' OR session_id=?)", u.School, r.PathValue("id"), u.ID, in.Session, in.Session); e != nil {
		problem(w, 503, "Không thu hồi được track")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}

// Inspect identifiers from the provider rather than trusting client-supplied mids.
func (a *app) closeSFUSession(ctx context.Context, school, meeting, sid string) error {
	provider, e := a.sessionProvider(ctx, school, meeting, sid)

	if e != nil {
		return e
	}
	return a.closeProviderSession(ctx, provider, sid)
}
func (a *app) closeProviderSession(ctx context.Context, provider sfuProvider, sid string) error {
	path := "apps/" + url.PathEscape(provider.AppID) + "/sessions/" + url.PathEscape(sid)
	r, _ := http.NewRequestWithContext(ctx, "GET", "http://internal", nil)
	info, e := a.cloud(r, "GET", path, provider.Secret, nil)
	if e != nil {
		if p, ok := e.(*providerError); ok && (p.Status == 404 || p.Status == 410) {
			return nil
		}
		return e
	}
	if info["errorCode"] != nil && info["errorCode"] != "" {
		return fmt.Errorf("session inspection rejected")
	}
	raw, ok := info["tracks"].([]any)
	if !ok {
		return fmt.Errorf("invalid session inspection")
	}
	tracks := []map[string]string{}
	for _, v := range raw {
		t, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid track")
		}
		if t["status"] == "inactive" {
			continue
		}
		mid, ok := t["mid"].(string)
		if !ok || mid == "" {
			return fmt.Errorf("track mid missing")
		}
		tracks = append(tracks, map[string]string{"mid": mid})
	}
	for len(tracks) > 0 {
		n := len(tracks)
		if n > 50 {
			n = 50
		}
		out, e := a.cloud(r, "PUT", path+"/tracks/close", provider.Secret, map[string]any{"force": true, "tracks": tracks[:n]})
		if e != nil {
			return e
		}
		if out["errorCode"] != nil && out["errorCode"] != "" {
			return fmt.Errorf("media close rejected")
		}
		results, ok := out["tracks"].([]any)
		if !ok || len(results) != n {
			return fmt.Errorf("incomplete close result")
		}
		for _, v := range results {
			t, ok := v.(map[string]any)
			if !ok || (t["errorCode"] != nil && t["errorCode"] != "") {
				return fmt.Errorf("track close unresolved")
			}
		}
		tracks = tracks[n:]
	}
	return nil
}

func (a *app) cleanupMedia(ctx context.Context) error {
	if _, e := os.Stat(configPath("maintenance")); e == nil {
		return nil
	}
	nonce := uid()
	got, err := a.cache.SetNX(ctx, "media-sweep-lock", nonce, 150*time.Second).Result()
	if err != nil {
		return err
	}
	if !got {
		return nil
	}
	defer a.cache.Eval(context.WithoutCancel(ctx), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{"media-sweep-lock"}, nonce)
	cursor, e := a.cache.Get(ctx, "media-sweep-cursor").Result()
	if e != nil && e != redis.Nil {
		return e
	}
	rows, e := a.db.QueryContext(ctx, `SELECT s.id,s.school_id,s.meeting_id,s.user_id,u.session_version,
 (m.status<>'live' OR u.active=FALSE OR p.user_id IS NULL OR p.online=FALSE OR p.last_seen<UTC_TIMESTAMP()-INTERVAL 60 SECOND) AS retire
 FROM media_sessions s JOIN meetings m ON m.id=s.meeting_id AND m.school_id=s.school_id JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id LEFT JOIN presence p ON p.school_id=s.school_id AND p.meeting_id=s.meeting_id AND p.user_id=s.user_id WHERE s.id>? ORDER BY s.id LIMIT 100`, cursor)
	if e != nil {
		return e
	}
	type item struct {
		id, school, meeting, user string
		version                   int
		retire                    bool
	}
	items := []item{}
	for rows.Next() {
		var v item
		if e = rows.Scan(&v.id, &v.school, &v.meeting, &v.user, &v.version, &v.retire); e != nil {
			rows.Close()
			return e
		}
		items = append(items, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range items {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Advance before an upstream call. One failing provider must not pin the
		// next cycle to the same first few sessions until its deadline expires.
		if e = a.cache.Set(ctx, "media-sweep-cursor", v.id, 0).Err(); e != nil {
			return e
		}
		owner, e := a.cache.Get(ctx, "media-owner:"+v.id).Result()
		if e != nil && e != redis.Nil {
			return e
		}
		if owner != "" {
			current, e := a.cache.Get(ctx, "current-session:"+v.user).Result()
			if e != nil && e != redis.Nil {
				return e
			}
			v.retire = v.retire || current != owner
			present, e := a.cache.Exists(ctx, "session:"+owner).Result()
			if e != nil {
				return e
			}
			v.retire = v.retire || present == 0
		}
		version, e := a.cache.Get(ctx, "media-version:"+v.id).Int()
		if e != nil && e != redis.Nil {
			return e
		}
		if e == nil {
			v.retire = v.retire || version != v.version
		}
		if v.retire {
			if e = a.cache.SetNX(ctx, "media-retired:"+v.id, time.Now().Unix(), 0).Err(); e != nil {
				return e
			}
		}
		retired, e := a.cache.Get(ctx, "media-retired:"+v.id).Int64()
		if e != nil {
			if e != redis.Nil {
				return e
			}
			continue
		}
		if _, e = a.db.ExecContext(ctx, "DELETE FROM publications WHERE session_id=?", v.id); e != nil {
			return e
		}
		// A timed-out negotiation may finish late upstream. Allow a quiet period,
		// then inspect and close all allocations; never resume a retired session.
		lock := "sfu-lock:" + v.school + ":" + v.user + ":" + v.meeting
		nonce := uid()
		got, e := a.cache.SetNX(ctx, lock, nonce, 150*time.Second).Result()
		if e != nil {
			return e
		}
		if !got {
			continue
		}
		func() {
			defer a.cache.Eval(context.WithoutCancel(ctx), `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`, []string{lock}, nonce)
			if e := a.closeSFUSession(ctx, v.school, v.meeting, v.id); e != nil {
				slog.Warn("media cleanup pending", "session", v.id)
				return
			}
			if time.Now().Unix()-retired < 60 {
				return
			}
			tx, e := a.db.BeginTx(ctx, nil)
			if e != nil {
				return
			}
			defer tx.Rollback()
			if _, e = tx.ExecContext(ctx, "DELETE FROM publications WHERE session_id=?", v.id); e != nil {
				return
			}
			if _, e = tx.ExecContext(ctx, "DELETE FROM media_sessions WHERE id=?", v.id); e != nil {
				return
			}
			if tx.Commit() == nil {
				a.cache.Del(ctx, "media-owner:"+v.id, "media-retired:"+v.id, "media-version:"+v.id)
			}
		}()
	}
	next := ""
	if len(items) == 100 {
		next = items[len(items)-1].id
	}
	return a.cache.Set(ctx, "media-sweep-cursor", next, 0).Err()
}
func (a *app) mediaCleanupLoop(ctx context.Context) {
	timer := time.NewTicker(15 * time.Second)
	defer timer.Stop()
	for {
		job, cancel := context.WithTimeout(ctx, 2*time.Minute)
		if e := a.cleanupMedia(job); e != nil && ctx.Err() == nil {
			slog.Error("media cleanup cycle failed")
		}
		if _, err := os.Stat(configPath("maintenance")); os.IsNotExist(err) {
			if e := a.cleanupDeletedMedia(job); e != nil && ctx.Err() == nil {
				slog.Error("recording object deletion pending")
			}
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
