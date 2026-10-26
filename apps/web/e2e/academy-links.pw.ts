import { test, expect } from "@playwright/test";
test("class links support reload, browser history, copyable tabs and mobile breadcrumbs", async ({
  page,
}) => {
  await page.goto("/hoc?academy_demo=1&role=teacher");
  await page
    .getByRole("button", { name: "Xem môn học", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/hoc\/lop\/demo-class-10a1/);
  const subject = page
    .locator(".classroom-card-cover h3 [role=button]")
    .first();
  await expect(subject).toHaveAttribute("href", /\/hoc\/mon\/.*\/bang-tin/);
  await subject.click();
  await page
    .getByRole("tab", { name: "Buổi học & video", exact: true })
    .click();
  await expect(page).toHaveURL(/\/buoi-hoc\?/);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Buổi học & video", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "Bảng tin", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(
    page.getByRole("tab", { name: "Buổi học & video", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(
    page.getByRole("navigation", { name: "Đường dẫn trang" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("unsaved forms protect navigation and duplicate saves are blocked until the request completes", async ({
  page,
}) => {
  let posts = 0,
    release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = { id: "admin", role: "admin", name: "VA", school_id: "va" };
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/academy/settings") {
      if (r.request().method() === "POST") {
        posts++;
        await wait;
        data = { ok: true, revision: 2 };
      } else data = { settings: { free_videos: 4 }, revision: 1, secrets: {} };
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/quan-tri/cai-dat");
  await page.locator("[name=bank_name]").fill("Tên mới");
  page.once("dialog", (d) => void d.dismiss());
  await page
    .getByRole("button", { name: "Quản lý nội dung", exact: true })
    .click();
  await expect(page).toHaveURL(/\/quan-tri\/cai-dat/);
  await expect(page.locator("[name=bank_name]")).toHaveValue("Tên mới");
  await page.getByRole("button", { name: "Lưu cài đặt", exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await page
    .locator("[name=bank_name]")
    .evaluate((el) => (el as HTMLInputElement).form!.requestSubmit());
  expect(posts).toBe(1);
  release();
  await expect(page.getByRole("status")).toContainText("Đã lưu");
  await page
    .getByRole("button", { name: "Quản lý nội dung", exact: true })
    .click();
  await expect(page).toHaveURL(/\/quan-tri\/noi-dung/);
});
test("login resumes the requested internal URL, direct task loads only that task, notifications link to it", async ({
  page,
}) => {
  let signed = false,
    reads = 0;
  const nid = "a".repeat(64);
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me") {
      if (!signed)
        return r.fulfill({ status: 401, json: { error: "Đăng nhập" } });
      data = {
        id: "student",
        role: "student",
        name: "Học viên",
        school_id: "va",
      };
    }
    if (path === "/api/login") {
      signed = true;
      data = {
        id: "student",
        role: "student",
        name: "Học viên",
        school_id: "va",
      };
    }
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/academy/courses")
      data = [{ id: "course-1", title: "Toán", published: 1 }];
    if (path === "/api/academy/assignments/task-1")
      data = {
        id: "task-1",
        title: "Bài riêng",
        course_id: "course-1",
        questions: [{ id: "1", prompt: "Câu hỏi riêng", options: [] }],
        due_at: "2030-01-01T00:00:00Z",
      };
    if (path === "/api/academy/notifications")
      data = [
        {
          id: nid,
          title: "Bài mới",
          detail: "Toán",
          path: "/hoc/bai-tap/task-1",
          read: false,
        },
      ];
    if (path === "/api/academy/notifications/read") {
      reads++;
      data = { ok: true };
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc/bai-tap/task-1");
  await expect(page).toHaveURL(/\/dang-nhap\?next=/);
  await page.getByLabel("Email", { exact: true }).fill("student@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/hoc\/bai-tap\/task-1$/);
  await expect(page.getByLabel("Câu hỏi riêng", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Câu hỏi riêng", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Thông báo/ }).click();
  await page.getByRole("link", { name: "Xem nội dung →" }).click();
  await expect(page).toHaveURL(/\/hoc\/bai-tap\/task-1$/);
  await expect.poll(() => reads).toBe(1);
  await page.goto("/quan-tri/tai-khoan");
  await expect(page.getByRole("alert")).toContainText("không có quyền");
  await expect(
    page.getByRole("button", { name: "Tạo tài khoản", exact: true }),
  ).toHaveCount(0);
});
