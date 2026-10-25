type Owner = { id: string; school_id: string; session_version?: number };
export type RoomResume = {
  meeting: string;
  mic: boolean;
  camera: boolean;
  seen: number;
  version?: number;
};
const key = (user: Owner) => `meet-resume:${user.school_id}:${user.id}`;
export function loadRoomResume(
  user: Owner,
  meeting?: string,
): RoomResume | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(user)) || "null");
    if (
      !value ||
      typeof value.meeting !== "string" ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(value.meeting) ||
      typeof value.mic !== "boolean" ||
      typeof value.camera !== "boolean" ||
      !Number.isFinite(value.seen) ||
      Date.now() - value.seen > 2 * 3600000 ||
      value.seen > Date.now() + 60000 ||
      value.version !== user.session_version
    )
      return null;
    return meeting && value.meeting !== meeting ? null : value;
  } catch {
    return null;
  }
}
export function saveRoomResume(
  user: Owner,
  meeting: string,
  mic: boolean,
  camera: boolean,
) {
  try {
    sessionStorage.setItem(
      key(user),
      JSON.stringify({
        meeting,
        mic,
        camera,
        seen: Date.now(),
        version: user.session_version,
      }),
    );
  } catch {
    /* Calls still work if browser storage is unavailable. */
  }
}
export function clearRoomResume(user: Owner) {
  try {
    sessionStorage.removeItem(key(user));
  } catch {}
}
