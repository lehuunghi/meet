export const leaseTTL = 90;
export function recordingStopReason(
  humans,
  emptySince,
  seconds,
  now = Date.now(),
) {
  if (seconds >= 8 * 3600) return "limit";
  // Empty rooms and browser closure do not end a teacher-started lesson.
  return "";
}
export const renewScript = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) end return 0`;
export const releaseScript = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
export function parseDSN(value) {
  const m = /^([^:]+):(.+)@tcp\(([^:]+):(\d+)\)\/([^?]+)\?/.exec(value);
  if (!m) throw new Error("MYSQL_DSN format unsupported");
  return {
    user: m[1],
    password: m[2],
    host: m[3],
    port: Number(m[4]),
    database: m[5],
    timezone: "Z",
    charset: "utf8mb4",
    connectionLimit: 6,
  };
}
export function pinnedProvider(settings, binding) {
  const provider = settings.sfu?.find(
    (p) =>
      p.id === binding.provider_id && p.app_id === binding.app_id && p.secret,
  );
  if (!provider) throw new Error("PINNED_SFU_UNAVAILABLE");
  return provider;
}
export function recordingKey(meta) {
  for (const v of [meta.school_id, meta.meeting_id, meta.id])
    if (!/^[a-f0-9-]{1,36}$/.test(v)) throw new Error("INVALID_RECORDING_ID");
  return `recordings/${meta.school_id}/${meta.meeting_id}/${meta.id}.webm`;
}
export function assertRemoteTracks(tracks, publications) {
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > 50)
    throw new Error("INVALID_TRACK_BATCH");
  for (const t of tracks)
    if (
      t.location !== "remote" ||
      !publications.some(
        (p) => p.session_id === t.sessionId && p.track_name === t.trackName,
      )
    )
      throw new Error("PUBLICATION_NOT_IN_MEETING");
}
export function retentionDays(settings) {
  return Number.isInteger(settings.retention_days) &&
    settings.retention_days >= 1 &&
    settings.retention_days <= 365
    ? settings.retention_days
    : 30;
}

// Cumulative, idempotent telemetry; a recorder's receive bytes are SFU egress.
export async function recordSFUUsage(db, school, provider, sample) {
 if(!sample?.session_id || ![sample.bytes_sent,sample.bytes_received].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('INVALID_USAGE');
 const c=await db.getConnection();try{
  await c.beginTransaction();const key=[school,provider.id,provider.app_id,sample.session_id];
  await c.execute('INSERT INTO sfu_usage_sessions(school_id,provider_id,app_id,session_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE session_id=VALUES(session_id)',key);
  const [rows]=await c.execute('SELECT bytes_sent,bytes_received FROM sfu_usage_sessions WHERE school_id=? AND provider_id=? AND app_id=? AND session_id=? FOR UPDATE',key);
  const old=rows[0],sent=BigInt(sample.bytes_sent)>BigInt(old.bytes_sent)?BigInt(sample.bytes_sent):BigInt(old.bytes_sent),received=BigInt(sample.bytes_received)>BigInt(old.bytes_received)?BigInt(sample.bytes_received):BigInt(old.bytes_received);
  await c.execute('UPDATE sfu_usage_sessions SET bytes_sent=?,bytes_received=?,updated_at=UTC_TIMESTAMP(6) WHERE school_id=? AND provider_id=? AND app_id=? AND session_id=?',[sent.toString(),received.toString(),...key]);
  await c.execute('INSERT INTO sfu_usage_daily(school_id,provider_id,app_id,day,ingress_bytes,egress_bytes,sample_count) VALUES(?,?,?,UTC_DATE(),?,?,1) ON DUPLICATE KEY UPDATE ingress_bytes=ingress_bytes+VALUES(ingress_bytes),egress_bytes=egress_bytes+VALUES(egress_bytes),sample_count=sample_count+1,updated_at=UTC_TIMESTAMP(6)',[...key.slice(0,3),(sent-BigInt(old.bytes_sent)).toString(),(received-BigInt(old.bytes_received)).toString()]);
  await c.commit();
 }catch(e){await c.rollback();throw e}finally{c.release()}
}
