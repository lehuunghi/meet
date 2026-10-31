import { test, expect } from "@playwright/test";
test("host creates and assigns breakout rooms with accessible mobile controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/hoc/buoi-hoc/preview?academy_demo=1&role=teacher");
  await page.getByLabel("Thêm tùy chọn", { exact: true }).click();
  await page
    .getByRole("button", { name: "Phòng họp nhóm", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Phòng họp nhóm",
    exact: true,
  });
  await dialog.getByLabel("Số phòng nhóm", { exact: true }).fill("3");
  await dialog
    .getByRole("button", { name: "Tạo phòng nhóm", exact: true })
    .click();
  await expect(dialog.getByLabel("Danh sách phòng nhóm")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Nguyễn Hoàng An/ }).check();
  await dialog.getByRole("checkbox", { name: /Lê Thanh Bình/ }).check();
  await dialog
    .getByRole("button", { name: "Phân 2 vào nhóm", exact: true })
    .first()
    .click();
  const rooms = dialog.locator(".breakout-room");
  await expect(rooms.first().getByRole("checkbox")).toHaveCount(2);
  await rooms
    .first()
    .getByRole("textbox", { name: "Tên Nhóm 1", exact: true })
    .fill("Nhóm nghiên cứu");
  await rooms
    .first()
    .getByRole("button", { name: "Lưu tên", exact: true })
    .click();
  await expect(
    rooms
      .first()
      .getByRole("textbox", { name: "Tên Nhóm nghiên cứu", exact: true }),
  ).toHaveValue("Nhóm nghiên cứu");
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Xóa Nhóm 3", exact: true }).click();
  await expect(rooms).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "Bắt đầu thảo luận nhóm", exact: true })
    .click();
  await rooms
    .first()
    .getByRole("button", { name: "Vào nhóm", exact: true })
    .click();
  await expect(
    rooms.first().getByRole("button", { name: "Đang ở nhóm", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "Đóng tất cả nhóm", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Tạo phòng nhóm", exact: true }),
  ).toBeVisible();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
});
test("student moves to their assigned group, resumes there, and returns when groups close", async ({
  page,
}) => {
  let state = "active",
    current = "",
    rootJoins = 0,
    childJoins = 0,
    parentLeaves = 0,
    failMove = true;
  const moves: string[] = [];
  const root = {
    id: "root",
    title: "Phòng chính",
    status: "live",
    course_id: "math",
    recording_allowed: true,
    short_code: "root01",
    can_manage: false,
    admission: "admitted",
  };
  const child = {
    ...root,
    id: "group1",
    title: "Nhóm nghiên cứu",
    recording_allowed: false,
    short_code: "grpa01",
    breakout_parent_id: "root",
  };
  await page.route("**/api/**", async (route) => {
    const q = route.request(),
      path = new URL(q.url()).pathname;
    let data: any = [];
    if (path === "/api/public-config") data = { platform_mode: "school" };
    else if (path === "/api/setup/status") data = { initialized: true };
    else if (path === "/api/me")
      data = {
        id: "student",
        school_id: "school",
        name: "Học sinh",
        role: "student",
        session_version: 1,
      };
    else if (path === "/api/meetings") data = [root];
    else if (path === "/api/meetings/root" || path === "/api/rooms/root01")
      data = root;
    else if (path === "/api/meetings/group1" || path === "/api/rooms/grpa01")
      data = child;
    else if (path.endsWith("/breakouts")) {
      if (q.method() === "POST") {
        if (failMove) {
          failMove = false;
          await route.fulfill({
            status: 503,
            json: { error: "Chưa đóng được kết nối phòng cũ" },
          });
          return;
        }
        current = q.postDataJSON().room_id;
        moves.push(current);
        data = { meeting_id: current || "root" };
      } else
        data = {
          round_id: "round",
          status: state,
          revision: 1,
          rooms: [{ id: "group1", name: "Nhóm nghiên cứu" }],
          participants: [],
          assigned_room_id: "group1",
          current_room_id: state === "active" ? current : "",
          can_manage: false,
        };
    } else if (path.endsWith("/admission")) data = { admission: "admitted" };
    else if (path.endsWith("/presence")) {
      const k = q.postDataJSON().kind;
      if (path.includes("/root/")) {
        if (k === "join") rootJoins++;
        if (k === "leave") parentLeaves++;
      } else if (k === "join") childJoins++;
      data = { seconds: 30 };
    } else if (q.method() === "POST") data = { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=root");
  await page.getByRole("button", { name: "Vào lớp học", exact: true }).click();
  for (const [width, height] of [[1366,650],[390,640],[844,390]]) {
    await page.setViewportSize({width,height});
    // Toolbar size is observed after resize; assert the settled layout.
    await expect.poll(async()=>page.locator(".room").evaluate(e=>{
      const stage=e.querySelector(".video-grid")!.getBoundingClientRect(), toolbar=e.querySelector(".room-toolbar")!.getBoundingClientRect();
      return toolbar.top-stage.bottom;
    })).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height+1);
  }
  await page.setViewportSize({width:1280,height:720});
  await page.getByRole("button", { name: "Vào nhóm", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Chưa đóng được kết nối phòng cũ",
  );
  await expect(page.locator(".room>header h2")).toHaveText("Phòng chính");
  await page.getByRole("button", { name: "Vào nhóm", exact: true }).click();
  await expect(page.locator(".room>header h2")).toHaveText("Nhóm nghiên cứu");
  await expect.poll(() => childJoins).toBe(1);
  expect(parentLeaves).toBe(0);
  expect(rootJoins).toBe(2);
  expect(moves).toEqual(["group1"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".room>header h2")).toHaveText("Nhóm nghiên cứu");
  await expect.poll(() => childJoins).toBe(2);
  await page.getByRole("button", { name: "Rời lớp", exact: true }).click();
  await expect(page.locator(".room")).toHaveCount(0);
  await page.goto("/?room=root", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".prejoin")).toBeVisible();
  await page.getByRole("button", { name: "Vào lớp học", exact: true }).click();
  await expect.poll(() => childJoins).toBe(3);
  await expect(page.locator(".room>header h2")).toHaveText("Nhóm nghiên cứu");
  state = "closed";
  await expect(page.locator(".room>header h2")).toHaveText("Phòng chính", {
    timeout: 12000,
  });
  await expect.poll(() => rootJoins).toBeGreaterThanOrEqual(4);
  expect(moves).toEqual(["group1", ""]);
  await page.getByLabel("Thêm tùy chọn", { exact: true }).click();
  await page
    .getByRole("button", { name: "Phòng họp nhóm", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Tạo phòng nhóm", exact: true }),
  ).toHaveCount(0);
});
