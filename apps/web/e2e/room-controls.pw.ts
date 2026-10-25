import { test, expect } from "@playwright/test";
const lesson = {
  id: "lesson",
  title: "Lớp kiểm tra",
  course: "Toán",
  class_name: "10A1",
  course_id: "math",
  starts_at: new Date().toISOString(),
  status: "live",
  recording_allowed: false,
};
test("host admits waiting students, updates rules, pins video and sends reactions", async ({
  page,
}) => {
  let rules = {
    lobby: true,
    chat_enabled: true,
    present_enabled: true,
    revision: 0,
  };
  let members = [
    {
      id: "student",
      name: "Học sinh chờ",
      short_id: "SV0001",
      role: "student",
      state: "waiting",
    },
  ];
  const moderated: any[] = [];
  let reactions: any[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "teacher",
        school_id: "school",
        name: "Giáo viên",
        role: "teacher",
      };
    else if (path === "/api/setup/status") data = { initialized: true };
    else if (path === "/api/meetings") data = [lesson];
    else if (path === "/api/meetings/lesson")
      data = {
        ...lesson,
        can_manage: true,
        rules,
        admission: "admitted",
        mute_request: 0,
      };
    else if (path.endsWith("/members")) data = members;
    else if (path.endsWith("/moderate")) {
      const b = req.postDataJSON();
      moderated.push(b);
      members = members.map((m) =>
        m.id === b.user_id
          ? {
              ...m,
              state:
                b.action === "admit"
                  ? "admitted"
                  : b.action === "remove"
                    ? "removed"
                    : "denied",
            }
          : m,
      );
      data = { ok: true };
    } else if (path.endsWith("/controls")) {
      const b = req.postDataJSON();
      expect(b.revision).toBe(rules.revision);
      rules = { ...b, revision: b.revision + 1 };
      data = { ok: true };
    } else if (path.endsWith("/reactions")) {
      if (req.method() === "POST") {
        reactions = [
          {
            id: "reaction",
            emoji: req.postDataJSON().emoji,
            name: "Giáo viên",
          },
        ];
        data = { ok: true };
      } else data = reactions;
    } else if (req.method() === "POST")
      data = path.endsWith("/admission")
        ? { admission: "admitted" }
        : { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=lesson");
  await expect(page.locator(".room>header h2")).toHaveText("Lớp kiểm tra");
  await page.getByRole("button", { name: "Cho vào", exact: true }).click();
  expect(moderated).toEqual([{ action: "admit", user_id: "student" }]);
  const panel = page.locator(".room-moderation");
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open)))
    await panel.locator(":scope>summary").click();
  await page
    .getByRole("checkbox", { name: "Cho học sinh gửi tin nhắn" })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "Cho học sinh gửi tin nhắn" }),
  ).not.toBeChecked();
  expect(rules.chat_enabled).toBe(false);
  await page
    .getByRole("button", {
      name: "Vào lớp không dùng camera/micro",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Bật mic", exact: true }),
  ).toBeVisible();
  await page
    .locator(".video-grid .tile-actions")
    .getByRole("button", { name: "Ghim", exact: true })
    .click();
  await expect(page.locator(".video-grid .is-pinned")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Bố cục", exact: true })
    .selectOption("grid");
  await expect(page.locator(".video-grid .is-pinned")).toHaveCount(0);
  await page.getByRole("button", { name: "Phản ứng 👍", exact: true }).click();
  await expect(page.locator(".room-reaction-overlay")).toContainText("👍", {
    timeout: 10000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("student waits without opening devices or crediting attendance, then joins after admission", async ({
  page,
}) => {
  let admission = "not_requested",
    presence = 0,
    devices = 0;
  const rules = {
    lobby: true,
    chat_enabled: false,
    present_enabled: false,
    revision: 1,
  };
  await page.exposeFunction("unexpectedDevice", () => devices++);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () => {
          (window as any).unexpectedDevice();
          return Promise.reject(new Error("No devices needed"));
        },
      },
      configurable: true,
    }),
  );
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "student",
        school_id: "school",
        name: "Học sinh",
        role: "student",
      };
    else if (path === "/api/setup/status") data = { initialized: true };
    else if (path === "/api/meetings") data = [lesson];
    else if (path === "/api/meetings/lesson")
      data = {
        ...lesson,
        can_manage: false,
        rules,
        admission,
        mute_request: 0,
      };
    else if (path.endsWith("/admission")) {
      if (admission === "not_requested") admission = "waiting";
      data = { admission };
    } else if (path.endsWith("/presence")) {
      presence++;
      data = { seconds: 0 };
    } else if (req.method() === "POST") data = { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=lesson");
  await page.getByRole("button", { name: "Xin vào lớp", exact: true }).click();
  await expect(page.locator(".prejoin").getByRole("status")).toContainText(
    "Chờ giáo viên duyệt",
  );
  expect(presence).toBe(0);
  expect(devices).toBe(0);
  await expect(page.locator(".room-moderation")).toHaveCount(0);
  admission = "admitted";
  await expect(
    page.getByRole("button", {
      name: "Vào lớp không dùng camera/micro",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 10000 });
  await page
    .getByRole("button", {
      name: "Vào lớp không dùng camera/micro",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Bật mic", exact: true }),
  ).toBeVisible();
  expect(presence).toBeGreaterThan(0);
  expect(devices).toBe(0);
  await expect(
    page.getByRole("button", { name: "Chia sẻ màn hình", exact: true }),
  ).toBeDisabled();
  admission = "removed";
  await expect(page.locator(".prejoin").getByRole("status")).toContainText(
    "chưa được phép",
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("button", {
      name: "Vào lớp không dùng camera/micro",
      exact: true,
    }),
  ).toBeDisabled();
});
