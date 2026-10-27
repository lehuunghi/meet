export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
function date(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value : null;
  let raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw))
    raw = raw.replace(" ", "T") + "Z";
  const d = typeof value === "number" ? new Date(value) : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}
export function vnDate(value: unknown) {
  const d = date(value);
  if (!d) return "—";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (key: string) => p.find((x) => x.type === key)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}
export function vnTime(value: unknown) {
  const d = date(value);
  return d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: VN_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(d)
    : "—";
}
export function vnDateTime(value: unknown) {
  return date(value) ? `${vnDate(value)} ${vnTime(value)}` : "—";
}
export function dateInputISO(text: string, withTime = false) {
  const m = text.match(
    withTime
      ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/
      : /^(\d{2})\/(\d{2})\/(\d{4})$/,
  );
  if (!m) return "";
  const [, dd, mm, yyyy, hh = "00", min = "00"] = m,
    day = Number(dd),
    month = Number(mm),
    year = Number(yyyy);
  if (year < 1900 || year > 2200 || Number(hh) > 23 || Number(min) > 59)
    return "";
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return "";
  const iso = `${yyyy}-${mm}-${dd}`;
  return withTime
    ? new Date(`${iso}T${hh}:${min}:00+07:00`).toISOString()
    : iso;
}
export function vnDateCell(value: unknown, key: string) {
  if (value == null) return "—";
  if (
    /(?:_at|^dob$|^paid_on$|^date$|^day$)/.test(key) &&
    /^\d{4}-\d{2}-\d{2}/.test(String(value))
  )
    return key === "dob" || key === "paid_on" || key === "day"
      ? vnDate(value)
      : vnDateTime(value);
  return String(value);
}
