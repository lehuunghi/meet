package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
)

type usageSample struct {
	Session  string `json:"session_id"`
	Sent     uint64 `json:"bytes_sent"`
	Received uint64 `json:"bytes_received"`
}

func (a *app) mediaUsage(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.access(w, r, false); !ok {
		return
	}
	u := who(r)
	var in usageSample
	if !decode(w, r, &in) {
		return
	}
	if in.Session == "" || len(in.Session) > 100 || in.Sent > 9007199254740991 || in.Received > 9007199254740991 {
		problem(w, 400, "Số liệu lưu lượng không hợp lệ")
		return
	}
	var pid, aid string
	e := a.db.QueryRowContext(r.Context(), `SELECT COALESCE(p.provider_id,b.provider_id),COALESCE(p.app_id,b.app_id) FROM media_sessions s JOIN meeting_sfu_bindings b ON b.school_id=s.school_id AND b.meeting_id=s.meeting_id LEFT JOIN media_session_routes p ON p.session_id=s.id WHERE s.school_id=? AND s.meeting_id=? AND s.user_id=? AND s.id=?`, u.School, r.PathValue("id"), u.ID, in.Session).Scan(&pid, &aid)
	if e != nil {
		problem(w, 404, "Phiên media không tồn tại")
		return
	}
	if e = recordSFUUsage(r.Context(), a.db, u.School, pid, aid, in); e != nil {
		problem(w, 503, "Chưa lưu được số liệu lưu lượng")
		return
	}
	send(w, 200, map[string]bool{"ok": true})
}
func recordSFUUsage(ctx context.Context, db *sql.DB, school, pid, aid string, in usageSample) error {
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `INSERT INTO sfu_usage_sessions(school_id,provider_id,app_id,session_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE session_id=VALUES(session_id)`, school, pid, aid, in.Session); e != nil {
		return e
	}
	var sent, received uint64
	if e = tx.QueryRowContext(ctx, `SELECT bytes_sent,bytes_received FROM sfu_usage_sessions WHERE school_id=? AND provider_id=? AND app_id=? AND session_id=? FOR UPDATE`, school, pid, aid, in.Session).Scan(&sent, &received); e != nil {
		return e
	}
	if in.Sent < sent {
		in.Sent = sent
	}
	if in.Received < received {
		in.Received = received
	}
	if _, e = tx.ExecContext(ctx, `UPDATE sfu_usage_sessions SET bytes_sent=?,bytes_received=?,updated_at=UTC_TIMESTAMP(6) WHERE school_id=? AND provider_id=? AND app_id=? AND session_id=?`, in.Sent, in.Received, school, pid, aid, in.Session); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO sfu_usage_daily(school_id,provider_id,app_id,day,ingress_bytes,egress_bytes,sample_count) VALUES(?,?,?,UTC_DATE(),?,?,1) ON DUPLICATE KEY UPDATE ingress_bytes=ingress_bytes+VALUES(ingress_bytes),egress_bytes=egress_bytes+VALUES(egress_bytes),sample_count=sample_count+1,updated_at=UTC_TIMESTAMP(6)`, school, pid, aid, in.Sent-sent, in.Received-received); e != nil {
		return e
	}
	return tx.Commit()
}

type sfuUsage struct {
	ID           string `json:"id"`
	AppID        string `json:"app_id"`
	Ingress      uint64 `json:"ingress_bytes"`
	Egress       uint64 `json:"egress_bytes"`
	MonthIngress uint64 `json:"month_ingress_bytes"`
	MonthEgress  uint64 `json:"month_egress_bytes"`
	Samples      uint64 `json:"samples"`
	Updated      string `json:"updated_at"`
	FirstDay     string `json:"first_day"`
	Meetings     int64  `json:"meetings"`
}

func readSFUUsage(ctx context.Context, db *sql.DB) ([]sfuUsage, error) {
	cfg, e := loadSettings()
	if e != nil {
		return nil, e
	}
	if len(cfg.SFU) == 0 {
		return []sfuUsage{}, nil
	}
	args := []any{}
	for _, p := range cfg.SFU {
		args = append(args, p.ID, p.AppID)
	}
	filter := "(" + strings.TrimSuffix(strings.Repeat("(?,?),", len(cfg.SFU)), ",") + ")"

	rows, e := db.QueryContext(ctx, `SELECT provider_id,app_id,CAST(SUM(ingress_bytes) AS UNSIGNED),CAST(SUM(egress_bytes) AS UNSIGNED),CAST(SUM(IF(day>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01'),ingress_bytes,0)) AS UNSIGNED),CAST(SUM(IF(day>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01'),egress_bytes,0)) AS UNSIGNED),CAST(SUM(sample_count) AS UNSIGNED),DATE_FORMAT(MAX(updated_at),'%Y-%m-%dT%H:%i:%sZ'),DATE_FORMAT(MIN(day),'%Y-%m-%d') FROM sfu_usage_daily WHERE (provider_id,app_id) IN `+filter+` GROUP BY provider_id,app_id LIMIT 50`, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []sfuUsage{}
	for rows.Next() {
		var v sfuUsage
		if e = rows.Scan(&v.ID, &v.AppID, &v.Ingress, &v.Egress, &v.MonthIngress, &v.MonthEgress, &v.Samples, &v.Updated, &v.FirstDay); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows.Close()
	counts, e := db.QueryContext(ctx, `SELECT b.provider_id,b.app_id,COUNT(*) FROM meeting_sfu_bindings b WHERE NOT EXISTS(SELECT 1 FROM meeting_breakout_rooms rr WHERE rr.school_id=b.school_id AND rr.meeting_id=b.meeting_id) AND (b.provider_id,b.app_id) IN `+filter+` GROUP BY b.provider_id,b.app_id`, args...)
	if e != nil {
		return nil, e
	}
	defer counts.Close()
	for counts.Next() {
		var id, app string
		var n int64
		if e = counts.Scan(&id, &app, &n); e != nil {
			return nil, e
		}
		found := false
		for i := range out {
			if out[i].ID == id && out[i].AppID == app {
				out[i].Meetings = n
				found = true
			}
		}
		if !found {
			if len(out) >= 50 {
				return nil, fmt.Errorf("too many SFU identities")
			}
			out = append(out, sfuUsage{ID: id, AppID: app, Meetings: n})
		}
	}
	return out, counts.Err()
}
