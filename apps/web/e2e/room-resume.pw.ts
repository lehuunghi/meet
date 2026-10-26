import { test, expect } from "@playwright/test";
test("reload automatically rejoins the authenticated room, while explicit leave clears resume", async ({
  page,
}) => {
  let joins = 0,
    devices = 0;
  await page.exposeFunction("unexpectedDevice", () => devices++);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          await (window as any).unexpectedDevice();
          throw new DOMException("blocked", "NotAllowedError");
        },
      },
    }),
  );
  const lesson = {
    id: "lesson",
    title: "Buổi kiểm tra vào lại",
    course: "Toán",
    class_name: "10A1",
    course_id: "math",
    starts_at: new Date().toISOString(),
    status: "live",
    recording_allowed: false,
    short_code: "abc123",
    admission: "admitted",
    can_manage: false,
    rules: {
      lobby: false,
      present_enabled: true,
      chat_enabled: true,
      revision: 0,
    },
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname;
    let data: any = [];
    if (p === "/api/me")
      data = {
        id: "student",
        school_id: "school",
        role: "student",
        name: "Học sinh",
        session_version: 7,
      };
    else if (p === "/api/setup/status") data = { initialized: true };
    else if (p === "/api/meetings") data = [lesson];
    else if (p === "/api/meetings/lesson" || p === "/api/rooms/abc123")
      data = lesson;
    else if (p.endsWith("/admission")) data = { admission: "admitted" };
    else if (p.endsWith("/presence")) {
      if (req.postDataJSON()?.kind === "join") joins++;
      data = { seconds: 0 };
    } else if (req.method() === "POST") data = { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=lesson");
  await expect(
    page
      .locator(".prejoin-device-icons")
      .getByRole("button", { name: "Bật mic", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Vào lớp học", exact: true }).click();
  await expect(
    page
      .locator(".room-toolbar")
      .getByRole("button", { name: "Bật mic", exact: true }),
  ).toBeVisible();
  expect(joins).toBe(1);
  expect(devices).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => joins).toBe(2);
  await expect(
    page
      .locator(".room-toolbar")
      .getByRole("button", { name: "Bật mic", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".prejoin")).toHaveCount(0);
  expect(devices).toBe(0);
  await page.getByRole("button", { name: "Rời lớp", exact: true }).click();
  if(await page.getByRole("button",{name:"Chỉ mình tôi rời đi",exact:true}).isVisible())await page.getByRole("button",{name:"Chỉ mình tôi rời đi",exact:true}).click();
  await expect(page.locator(".room")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByTitle("Đăng xuất", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".room")).toHaveCount(0);
  expect(joins).toBe(2);
});
