import { afterEach, expect, it, vi } from "vitest";
import { loadRoomResume, saveRoomResume, clearRoomResume } from "./room-resume";
afterEach(() => vi.unstubAllGlobals());
it("restores only this tab/account/session's joined meeting, respecting mute and explicit leave", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const user = { id: "teacher", school_id: "school", session_version: 2 };
  saveRoomResume(user, "lesson", false, true);
  expect(loadRoomResume(user, "lesson")).toMatchObject({
    meeting: "lesson",
    mic: false,
    camera: true,
  });
  expect(loadRoomResume({ ...user, id: "student" })).toBeNull();
  expect(loadRoomResume({ ...user, school_id: "other" })).toBeNull();
  expect(loadRoomResume({ ...user, session_version: 3 })).toBeNull();
  expect(loadRoomResume(user, "other-lesson")).toBeNull();
  clearRoomResume(user);
  expect(loadRoomResume(user)).toBeNull();
});
it("expired or malformed resume hints never trigger rejoin", () => {
  const user = { id: "u", school_id: "s" };
  vi.stubGlobal("sessionStorage", {
    getItem: () =>
      JSON.stringify({
        meeting: "lesson",
        mic: true,
        camera: true,
        seen: Date.now() - 3 * 3600000,
      }),
  });
  expect(loadRoomResume(user)).toBeNull();
  vi.stubGlobal("sessionStorage", { getItem: () => "broken" });
  expect(loadRoomResume(user)).toBeNull();
});
