export const leaseTTL = 90;
export function recordingStopReason(
  humans,
  emptySince,
  seconds,
  now = Date.now(),
) {
  if (seconds >= 8 * 3600) return "limit";
  if (humans === 0 && emptySince && now - emptySince >= 30000) return "empty";
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
