import { test, expect, type Page } from "@playwright/test";
import { emptyDrawing } from "../src/drawing-model";

async function room(page: Page, draw: (route: any) => Promise<void>) {
  await page.route("**/api/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    if (path.endsWith("/drawing")) return draw(route);
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "teacher",
        school_id: "qa",
        name: "Giáo viên",
        role: "teacher",
      };
    else if (path === "/api/setup/status") data = { initialized: true };
    else if (path === "/api/meetings/net")
      data = {
        id: "net",
        title: "Kiểm tra mạng",
        course_id: "math",
        status: "live",
        can_manage: true,
        admission: "admitted",
        rules: {
          lobby: false,
          chat_enabled: true,
          present_enabled: true,
          revision: 0,
        },
      };
    else if (r.method() === "POST")
      data = path.endsWith("/admission")
        ? { admission: "admitted" }
        : { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=net");
  await page.getByRole("button", { name: "Vào lớp học", exact: true }).click();
}

test("temporary polling/post errors recover without dropping or duplicating the final stroke", async ({
  page,
}) => {
  const state = emptyDrawing();
  state.active = true;
  state.control_revision = 1;
  let revision = 1,
    failGet = true,
    failPost = 2;
  const ids: string[] = [];
  await room(page, async (route) => {
    if (route.request().method() === "GET" && failGet) {
      failGet = false;
      return route.fulfill({
        status: 503,
        json: { error: "Máy chủ đang kết nối lại" },
      });
    }
    if (route.request().method() === "POST") {
      const b = route.request().postDataJSON();
      if (b.action === "stroke") {
        ids.push(b.stroke.id);
        if (failPost-- > 0)
          return route.fulfill({
            status: 503,
            json: { error: "Tạm gián đoạn" },
          });
        state.pages[0].strokes = [{ ...b.stroke, owner: "teacher" }];
        revision++;
      }
    }
    await route.fulfill({
      json: { state: structuredClone(state), revision, targets: [] },
    });
  });
  const canvas = page.getByLabel("Bảng trắng dùng chung", { exact: true });
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Chọn công cụ viết vẽ", { exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Bút", exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("được giữ");
  await expect
    .poll(() => state.pages[0].strokes.length, { timeout: 15000 })
    .toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Hoàn tác nét của tôi" }),
  ).toBeEnabled();
  expect(new Set(ids).size).toBe(1);
  expect(ids.length).toBeGreaterThanOrEqual(3);
  expect(state.pages[0].strokes[0].points.length).toBeGreaterThan(4);
});

test("successful teacher sharing retries missing publication metadata and respects a newer board choice", async ({
  page,
}) => {
  const state = emptyDrawing();
  state.active = true;
  state.control_revision = 1;
  let revision = 1,
    available = Infinity,
    failures = 0,
    switches = 0;
  await room(page, async (route) => {
    if (route.request().method() === "GET" && failures-- > 0)
      return route.fulfill({ status: 503, json: { error: "Tạm lỗi" } });
    if (route.request().method() === "POST") {
      const b = route.request().postDataJSON();
      if (b.action === "show_presentation") {
        switches++;
        state.active = false;
        state.mode = "screen";
        state.target = b.target;
        state.control_revision++;
      }
      if (b.action === "open_board") {
        state.active = true;
        state.mode = "board";
        state.control_revision++;
      }
      revision++;
    }
    await route.fulfill({
      json: {
        state: structuredClone(state),
        revision,
        targets:
          Date.now() >= available
            ? [{ key: "share", user_id: "teacher", name: "Màn hình" }]
            : [],
      },
    });
  });
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  available = Date.now() + 1500;
  failures = 2;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("meeting:drawing", {
        detail: { meeting: "net", mode: "present" },
      }),
    ),
  );
  await expect.poll(() => switches, { timeout: 10000 }).toBe(1);
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toHaveCount(0);
  available = Infinity;
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("meeting:drawing", {
        detail: { meeting: "net", mode: "present" },
      }),
    ),
  );
  await page.getByRole("button", { name: "Bảng trắng", exact: true }).click();
  available = Date.now();
  await page.waitForTimeout(1800);
  expect(switches).toBe(1);
  expect(state.active).toBe(true);
  expect(state.mode).toBe("board");
});

test("slow drawing polling does not accumulate parallel requests", async ({
  page,
}) => {
  const state = emptyDrawing();
  state.active = true;
  let slow = false,
    pending = 0,
    peak = 0;
  await room(page, async (route) => {
    pending++;
    peak = Math.max(peak, pending);
    try {
      if (slow) await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ json: { state, revision: 1, targets: [] } });
    } finally {
      pending--;
    }
  });
  await expect(
    page.getByLabel("Bảng trắng dùng chung", { exact: true }),
  ).toBeVisible();
  slow = true;
  peak = 0;
  await page.waitForTimeout(3500);
  expect(peak).toBe(1);
});
