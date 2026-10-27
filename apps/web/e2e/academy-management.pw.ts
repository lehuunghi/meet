import { test, expect } from "@playwright/test";
test("custom interface labels change nested login controls without changing submitted credentials", async ({
  page,
}) => {
  let login: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/me")
      return r.fulfill({ status: 401, json: { error: "Login" } });
    if (p === "/api/login") {
      login = r.request().postDataJSON();
      return r.fulfill({
        json: { requires_2fa: true, challenge: "challenge" },
      });
    }
    return r.fulfill({
      json:
        p === "/api/public-config"
          ? { platform_mode: "academy" }
          : p === "/api/academy/ui-texts"
            ? {
                texts: {
                  "Đăng nhập": "Sign in",
                  Email: "Email address",
                  "Mật khẩu": "Password",
                  "Mã xác thực hai bước": "Second factor",
                },
              }
            : [],
    });
  });
  await page.goto("/dang-nhap");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("learner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Mật khẩu");
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByLabel("Second factor", { exact: true })).toBeVisible();
  expect(login).toEqual({
    email: "learner@example.test",
    password: "Mật khẩu",
  });
});
test("language editor saves a revision and keeps default text and form values intact", async ({
  page,
}) => {
  let saved: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (
      p === "/api/academy/admin/ui-texts" &&
      r.request().method() === "POST"
    ) {
      saved = r.request().postDataJSON();
      return r.fulfill({ json: { revision: 1 } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/academy/ui-texts"
              ? { texts: {} }
              : p === "/api/academy/admin/ui-texts"
                ? {
                    catalog: [{ key: "Website giới thiệu", area: "Quản trị" }],
                    texts: {},
                    revision: 0,
                  }
                : [],
    });
  });
  await page.goto("/quan-tri/website?muc=ngon-ngu");
  await page
    .getByLabel("Thay thế: Website giới thiệu", { exact: true })
    .fill("Website VA");
  await page.getByRole("button", { name: "Lưu ngôn ngữ", exact: true }).click();
  await expect
    .poll(() => saved?.texts["Website giới thiệu"])
    .toBe("Website VA");
  expect(saved.revision).toBe(0);
  await expect(
    page.getByRole("heading", { name: "Website VA", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Thay thế: Website giới thiệu", { exact: true }),
  ).toHaveValue("Website VA");
});
test("email fragment verifies automatically once, removes the token and requires no code entry", async ({
  page,
}) => {
  let calls = 0,
    token = "";
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/me")
      return r.fulfill({ status: 401, json: { error: "Login" } });
    if (p === "/api/academy/verify-email-link") {
      calls++;
      token = r.request().postDataJSON().token;
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json: p === "/api/public-config" ? { platform_mode: "academy" } : [],
    });
  });
  await page.goto("/dang-nhap#xac-thuc-email=" + "a".repeat(64));
  await expect(page.getByRole("status")).toContainText("Email đã xác thực");
  expect(calls).toBe(1);
  expect(token).toBe("a".repeat(64));
  expect(new URL(page.url()).hash).toBe("");
  await expect(
    page.getByLabel("Mã xác thực email", { exact: true }),
  ).toHaveCount(0);
});
test("VIP plan controls support edit, suspend and confirmed removal", async ({
  page,
}) => {
  let rows: any[] = [
      {
        id: "vip",
        name: "VIP thử",
        price_vnd: 100000,
        days: 30,
        live_enabled: 1,
        active: 1,
        revision: 0,
      },
    ],
    saved: any = null,
    removed: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/academy/plans" && r.request().method() === "POST") {
      saved = r.request().postDataJSON();
      rows = [{ ...rows[0], ...saved, revision: 1 }];
      return r.fulfill({ json: { id: "vip" } });
    }
    if (p === "/api/academy/plans/vip/delete") {
      removed = r.request().postDataJSON();
      rows = [];
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/academy/admin/plans"
              ? rows
              : [],
    });
  });
  await page.goto("/quan-tri/thanh-toan");
  const panel = page.locator(".academy-vip-plans");
  await panel.getByRole("button", { name: "Sửa gói", exact: true }).click();
  await panel.getByLabel("Tên gói", { exact: true }).fill("VIP mới");
  await panel.getByRole("button", { name: "Lưu gói VIP", exact: true }).click();
  await expect.poll(() => saved?.name).toBe("VIP mới");
  await panel.getByRole("button", { name: "Ngưng bán", exact: true }).click();
  await expect.poll(() => saved?.active).toBe(false);
  page.once("dialog", (d) => d.accept("VIP mới"));
  await panel.getByRole("button", { name: "Xóa gói", exact: true }).click();
  await expect.poll(() => removed?.confirm).toBe("VIP mới");
  await expect(
    panel.getByRole("button", { name: "Sửa gói", exact: true }),
  ).toHaveCount(0);
});
test("account deletion requires email confirmation and leaves protected root without a delete button", async ({
  page,
}) => {
  let rows: any[] = [
      {
        id: "root",
        role: "admin",
        email: "root@example.test",
        name: "Root",
        permissions: null,
        state: "active",
        revision: 0,
      },
      {
        id: "student",
        role: "student",
        email: "student@example.test",
        name: "Học viên",
        permissions: [],
        state: "active",
        revision: 0,
      },
    ],
    deleted: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/accounts/student/delete") {
      deleted = r.request().postDataJSON();
      rows = rows.filter((v) => v.id !== "student");
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "root", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/accounts"
              ? rows
              : [],
    });
  });
  await page.goto("/quan-tri/tai-khoan");
  await expect(
    page.getByRole("button", { name: "Xóa tài khoản", exact: true }),
  ).toHaveCount(1);
  page.once("dialog", (d) => d.accept("student@example.test"));
  await page
    .getByRole("button", { name: "Xóa tài khoản", exact: true })
    .click();
  await expect.poll(() => deleted?.confirm).toBe("student@example.test");
  await expect(
    page.getByText("student@example.test · student", { exact: true }),
  ).toHaveCount(0);
});
