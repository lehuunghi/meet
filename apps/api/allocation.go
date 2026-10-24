package main

import (
	"context"
	"database/sql"
	"errors"
	"math"
)

func lockAllocation(ctx context.Context, db *sql.DB) (*sql.Conn, func(), error) {
	c, e := db.Conn(ctx)
	if e != nil {
		return nil, nil, e
	}
	var locked int
	e = c.QueryRowContext(ctx, "SELECT GET_LOCK('meet_sfu_allocation',10)").Scan(&locked)
	if e != nil || locked != 1 {
		c.Close()
		return nil, nil, errors.New("SFU allocation busy")
	}
	return c, func() { c.ExecContext(context.Background(), "SELECT RELEASE_LOCK('meet_sfu_allocation')"); c.Close() }, nil
}
func chooseProvider(pool []sfuProvider, counts map[string]int64) (sfuProvider, error) {
	best := sfuProvider{}
	score := math.Inf(1)
	for _, p := range pool {
		if !p.Enabled || p.Weight < 1 {
			continue
		}
		s := float64(counts[p.ID]) / float64(p.Weight)
		if s < score || (s == score && (best.ID == "" || p.ID < best.ID)) {
			best = p
			score = s
		}
	}
	if best.ID == "" {
		return best, errors.New("no enabled SFU provider")
	}
	return best, nil
}
func providerByID(pool []sfuProvider, id, appID string) (sfuProvider, error) {
	for _, p := range pool {
		if p.ID == id && p.AppID == appID && p.Secret != "" {
			return p, nil
		}
	}
	return sfuProvider{}, errors.New("pinned SFU credential unavailable")
}
func (a *app) meetingProvider(ctx context.Context, school, meeting string) (sfuProvider, error) {
	// Existing rooms do not wait for a configuration save or unrelated class assignment.
	current, e := loadSettings()
	if e != nil {
		return sfuProvider{}, e
	}
	var existingID, existingApp string
	e = a.db.QueryRowContext(ctx, "SELECT provider_id,app_id FROM meeting_sfu_bindings WHERE school_id=? AND meeting_id=?", school, meeting).Scan(&existingID, &existingApp)
	if e == nil {
		return providerByID(current.SFU, existingID, existingApp)
	}
	if e != sql.ErrNoRows {
		return sfuProvider{}, e
	}
	c, release, e := lockAllocation(ctx, a.db)
	if e != nil {
		return sfuProvider{}, e
	}
	defer release()
	cfg, e := loadSettings()
	if e != nil {
		return sfuProvider{}, e
	}
	var pid, appID string
	e = c.QueryRowContext(ctx, "SELECT provider_id,app_id FROM meeting_sfu_bindings WHERE school_id=? AND meeting_id=?", school, meeting).Scan(&pid, &appID)
	if e == nil {
		return providerByID(cfg.SFU, pid, appID)
	}
	if e != sql.ErrNoRows {
		return sfuProvider{}, e
	}
	var class string
	if e = c.QueryRowContext(ctx, "SELECT c.class_id FROM meetings m JOIN courses c ON c.school_id=m.school_id AND c.id=m.course_id WHERE m.school_id=? AND m.id=?", school, meeting).Scan(&class); e != nil {
		return sfuProvider{}, e
	}
	// Upgrade an already-connected legacy meeting without splitting its existing SFU sessions.
	var sessions int
	if e = c.QueryRowContext(ctx, "SELECT COUNT(*) FROM media_sessions WHERE school_id=? AND meeting_id=?", school, meeting).Scan(&sessions); e != nil {
		return sfuProvider{}, e
	}
	var p sfuProvider
	if sessions > 0 {
		for _, v := range cfg.SFU {
			if v.AppID == secret("CF_SFU_APP_ID") {
				p = v
				break
			}
		}
		if p.ID == "" {
			return p, errors.New("legacy active meeting needs its original app credential")
		}
	} else {
		e = c.QueryRowContext(ctx, "SELECT provider_id,app_id FROM class_sfu_bindings WHERE school_id=? AND class_id=?", school, class).Scan(&pid, &appID)
		if e == nil {
			p, e = providerByID(cfg.SFU, pid, appID)
			if e != nil {
				return p, e
			}
		} else if e == sql.ErrNoRows {
			counts := map[string]int64{}
			rows, e := c.QueryContext(ctx, "SELECT provider_id,COUNT(*) FROM class_sfu_bindings GROUP BY provider_id")
			if e != nil {
				return p, e
			}
			for rows.Next() {
				var id string
				var n int64
				if e = rows.Scan(&id, &n); e != nil {
					rows.Close()
					return p, e
				}
				counts[id] = n
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return p, e
			}
			p, e = chooseProvider(cfg.SFU, counts)
			if e != nil {
				return p, e
			}
		} else {
			return p, e
		}
	}
	if _, e = c.ExecContext(ctx, "INSERT IGNORE INTO class_sfu_bindings(school_id,class_id,provider_id,app_id) VALUES(?,?,?,?)", school, class, p.ID, p.AppID); e != nil {
		return p, e
	}
	if _, e = c.ExecContext(ctx, "INSERT INTO meeting_sfu_bindings(school_id,meeting_id,provider_id,app_id) VALUES(?,?,?,?)", school, meeting, p.ID, p.AppID); e != nil {
		return p, e
	}
	return p, nil
}
