import { test, expect } from "@playwright/test";
test("a focused course collapses and reopens; checkout retains selected course after reload", async ({
  page,
}) => {
  await page.goto("/hoc/khoa-hoc/demo-course?academy_demo=1&role=student");
  const table = page.locator(".academy-course table");
  await expect(table).toBeVisible();
  await page.getByRole("button", { name: "Thu gọn", exact: true }).click();
  await expect(table).toBeHidden();
  await page.getByRole("button", { name: "Xem bài học", exact: true }).click();
  await expect(table).toBeVisible();
  await page
    .getByRole("button", { name: "Gói học & quyền lợi", exact: true })
    .click();
  await page.getByRole("button", { name: "Chọn gói", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("khoa")).toBe("demo-course");
  await page.reload();
  await page
    .getByRole("button", { name: "Tiếp tục khóa học đã chọn", exact: true })
    .click();
  await expect(page).toHaveURL(/\/hoc\/khoa-hoc\/demo-course\?/);
});
test("reloading settings asks before discarding and resets same-revision values without false dirty warnings", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me") data = { id: "admin", role: "admin", name: "VA" };
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/academy/settings") {
      reads++;
      data = {
        settings: { free_videos: 4, bank_name: "Tên đã lưu" },
        revision: 1,
        secrets: {},
      };
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/quan-tri/cai-dat");
  await page.locator("[name=bank_name]").fill("Chưa lưu");
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  expect(reads).toBe(1);
  await expect(page.locator("[name=bank_name]")).toHaveValue("Chưa lưu");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Tải lại", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator("[name=bank_name]")).toHaveValue("Tên đã lưu");
  await page
    .getByRole("button", { name: "Quản lý nội dung", exact: true })
    .click();
  await expect(page).toHaveURL(/noi-dung$/);
});
test("successful schedule polling does not erase a failed user action", async ({
  page,
}) => {
  await page.clock.install();
  let schedules = 0;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = { id: "s", role: "student", name: "Học viên" };
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/meetings") {
      schedules++;
      data = [];
    }
    if (path === "/api/academy/workspace")
      data = {
        meetings: [
          {
            id: "meeting-1",
            title: "Buổi thử",
            course: "Toán",
            status: "live",
            starts_at: "2030-01-01T00:00:00Z",
          },
        ],
        tasks: [],
        resume: [],
      };
    if (path === "/api/meetings/meeting-1")
      return r.fulfill({
        status: 403,
        json: { error: "Không thể mở phòng thử" },
      });
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc");
  await page.getByRole("button", { name: "Vào lớp học", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Không thể mở phòng thử");
  await page.clock.runFor(11000);
  await expect.poll(() => schedules).toBeGreaterThan(1);
  await expect(page.getByRole("alert")).toContainText("Không thể mở phòng thử");
});
test("switching from two-factor login to registration clears the login challenge", async ({
  page,
}) => {
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/me")
      return r.fulfill({ status: 401, json: { error: "Login" } });
    await r.fulfill({
      json:
        path === "/api/public-config"
          ? { platform_mode: "academy" }
          : path === "/api/login"
            ? { requires_2fa: true, challenge: "login-challenge" }
            : [],
    });
  });
  await page.goto("/dang-nhap");
  await page.getByLabel("Email", { exact: true }).fill("learner@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .last()
    .click();
  await expect(
    page.getByLabel("Mã xác thực hai bước", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "Đăng ký học thử", exact: true })
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Mã xác thực hai bước", { exact: true }),
  ).toHaveCount(0);
});

test("website reload protects checkbox-only edits", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me") data = { id: "admin", role: "admin", name: "VA" };
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/academy/site") {
      reads++;
      data = [
        {
          content: JSON.stringify({ headline: "VA đã lưu", published: true }),
          revision: "unchanged",
        },
      ];
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/quan-tri/website?muc=tat-ca");
  const published = page.getByLabel("Xuất bản website", { exact: true });
  await expect(published).toBeChecked();
  await published.uncheck();
  page.once("dialog", (d) => void d.dismiss());
  await page
    .getByRole("button", {
      name: "Tải lại nội dung website đã lưu",
      exact: true,
    })
    .click();
  expect(reads).toBe(1);
  await expect(published).not.toBeChecked();
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", {
      name: "Tải lại nội dung website đã lưu",
      exact: true,
    })
    .click();
  await expect.poll(() => reads).toBe(2);
  await expect(published).toBeChecked();
  await page
    .getByRole("button", { name: "Cài đặt kinh doanh", exact: true })
    .click();
  await expect(page).toHaveURL(/cai-dat$/);
});

test("logout clears previous account data before a different user signs in", async ({
  page,
}) => {
  let current = "admin",
    release: () => void = () => {};
  const delay = new Promise<void>((r) => (release = r));
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = { id: "owner", role: "admin", name: "Quản trị" };
    if (path === "/api/public-config") data = { platform_mode: "academy" };
    if (path === "/api/academy/admin/courses")
      data = [
        {
          id: "private",
          title: "Khóa riêng tài khoản trước",
          published: false,
        },
      ];
    if (path === "/api/academy/courses" && current !== "admin") {
      await delay;
      data = [];
    }
    if (path === "/api/academy/me")
      data = [{ name: current === "admin" ? "Quản trị" : "Học viên mới" }];
    if (path === "/api/logout") {
      current = "logged-out";
      data = { ok: true };
    }
    if (path === "/api/login") {
      current = "student";
      data = { id: "new", role: "student", name: "Học viên mới" };
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc");
  await expect(
    page.getByRole("heading", {
      name: "Khóa riêng tài khoản trước",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page
    .getByRole("button", { name: "Đăng nhập", exact: true })
    .last()
    .click();
  await expect(page.locator(".academy-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Khóa riêng tài khoản trước",
      exact: true,
    }),
  ).toHaveCount(0);
  release();
});
