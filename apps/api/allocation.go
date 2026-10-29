package main

import (
	"context"
	"database/sql"
	"errors"
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

// Every newly bound lesson advances one position in configured order.
func chooseProvider(pool []sfuProvider, last string) (sfuProvider, error) {
	active := []sfuProvider{}
	for _, p := range pool {
		if p.Enabled {
			active = append(active, p)
		}
	}
	if len(active) == 0 {
		return sfuProvider{}, errors.New("no enabled SFU provider")
	}
	for i, p := range active {
		if p.ID == last {
			return active[(i+1)%len(active)], nil
		}
	}
	return active[0], nil
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
	var generation int64
	e = a.db.QueryRowContext(ctx, "SELECT b.provider_id,b.app_id,COALESCE(e.generation,0) FROM meeting_sfu_bindings b LEFT JOIN meeting_sfu_epochs e ON e.school_id=b.school_id AND e.meeting_id=b.meeting_id WHERE b.school_id=? AND b.meeting_id=?", school, meeting).Scan(&existingID, &existingApp, &generation)
	if e == nil {
		p, err := providerByID(current.SFU, existingID, existingApp)
		p.Generation = generation
		return p, err
	}
	if e != sql.ErrNoRows {
		return sfuProvider{}, e
	}
	var parent, parentID, parentApp string
	e = a.db.QueryRowContext(ctx, "SELECT br.parent_id FROM meeting_breakout_rounds br JOIN meeting_breakout_rooms rr ON rr.round_id=br.id AND rr.school_id=br.school_id WHERE rr.school_id=? AND rr.meeting_id=?", school, meeting).Scan(&parent)
	if e == nil {
		pp, err := a.meetingProvider(ctx, school, parent)
		if err != nil {
			return sfuProvider{}, err
		}
		parentID, parentApp = pp.ID, pp.AppID
	} else if e != sql.ErrNoRows {
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
	e = c.QueryRowContext(ctx, "SELECT b.provider_id,b.app_id,COALESCE(e.generation,0) FROM meeting_sfu_bindings b LEFT JOIN meeting_sfu_epochs e ON e.school_id=b.school_id AND e.meeting_id=b.meeting_id WHERE b.school_id=? AND b.meeting_id=?", school, meeting).Scan(&pid, &appID, &generation)
	if e == nil {
		p, err := providerByID(cfg.SFU, pid, appID)
		p.Generation = generation
		return p, err
	}
	if e != sql.ErrNoRows {
		return sfuProvider{}, e
	}
	if parent != "" {
		if e = c.QueryRowContext(ctx, "SELECT provider_id,app_id FROM meeting_sfu_bindings WHERE school_id=? AND meeting_id=?", school, parent).Scan(&parentID, &parentApp); e != nil {
			return sfuProvider{}, e
		}
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
	} else if parentID != "" {
		p, e = providerByID(cfg.SFU, parentID, parentApp)
		if e != nil {
			return p, e
		}
	} else {
		var last string
		e = c.QueryRowContext(ctx, "SELECT last_provider FROM sfu_allocation_cursor WHERE id=1").Scan(&last)
		if e != nil && e != sql.ErrNoRows {
			return p, e
		}
		p, e = chooseProvider(cfg.SFU, last)
		if e != nil {
			return p, e
		}
	}
	tx, e := c.BeginTx(ctx, nil)
	if e != nil {
		return p, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "INSERT INTO meeting_sfu_bindings(school_id,meeting_id,provider_id,app_id) VALUES(?,?,?,?)", school, meeting, p.ID, p.AppID); e != nil {
		return p, e
	}
	if sessions == 0 && parentID == "" {
		if _, e = tx.ExecContext(ctx, "INSERT INTO sfu_allocation_cursor(id,last_provider) VALUES(1,?) ON DUPLICATE KEY UPDATE last_provider=VALUES(last_provider)", p.ID); e != nil {
			return p, e
		}
	}
	p.Generation = 1
	if _, e = tx.ExecContext(ctx, "INSERT IGNORE INTO meeting_sfu_epochs(school_id,meeting_id,generation) VALUES(?,?,1)", school, meeting); e != nil {
		return p, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT IGNORE INTO media_session_routes(session_id,provider_id,app_id,generation) SELECT id,?,?,1 FROM media_sessions WHERE school_id=? AND meeting_id=?", p.ID, p.AppID, school, meeting); e != nil {
		return p, e
	}
	if e = tx.Commit(); e != nil {
		return p, e
	}

	return p, nil
}
