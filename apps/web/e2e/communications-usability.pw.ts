import { test, expect, type Page } from "@playwright/test";
async function admin(
  page: Page,
  extra?: (r: any, path: string) => Promise<boolean>,
  permissions?: string[],
) {
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (extra && (await extra(r, path))) return;
    await r.fulfill({
      json:
        path === "/api/me"
          ? { id: "admin", name: "Admin", role: "admin", permissions }
          : path === "/api/public-config"
            ? { platform_mode: "academy" }
            : path === "/api/academy/mail-templates"
              ? [
                  {
                    kind: "verification",
                    subject: "Xác thực",
                    body: "Bấm {{verification_link}}",
                    revision: 0,
                  },
                  {
                    kind: "notification",
                    subject: "{{title}}",
                    body: "{{content}}",
                    revision: 0,
                  },
                ]
              : [],
    });
  });
}

test("communications panels retain drafts and stable URLs on mobile", async ({
  page,
}) => {
  await page.goto("/quan-tri/email?academy_demo=1&role=admin&muc=soan-email");
  await page
    .getByLabel("Tiêu đề email", { exact: true })
    .fill("Lịch học tháng tới");
  await page
    .getByLabel("Nội dung email", { exact: true })
    .fill("Nội dung đang soạn");
  await page.getByRole("tab", { name: "Thông báo chung", exact: true }).click();
  await page
    .getByLabel("Tiêu đề thông báo", { exact: true })
    .fill("Thông báo đang soạn");
  await page.getByRole("tab", { name: "Soạn email", exact: true }).click();
  await expect(page.getByLabel("Tiêu đề email", { exact: true })).toHaveValue(
    "Lịch học tháng tới",
  );
  await expect(page).toHaveURL(/muc=soan-email/);
  await page.getByRole("tab", { name: "Thông báo chung", exact: true }).click();
  await expect(
    page.getByLabel("Tiêu đề thông báo", { exact: true }),
  ).toHaveValue("Thông báo đang soạn");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("saving one email template keeps another unsaved template protected", async ({
  page,
}) => {
  await admin(page, async (r, path) => {
    if (
      path === "/api/academy/mail-templates" &&
      r.request().method() === "POST"
    ) {
      await r.fulfill({ json: { revision: 1 } });
      return true;
    }
    return false;
  });
  await page.goto("/quan-tri/email?muc=mau-email");
  await page
    .getByLabel("Tiêu đề email tự động", { exact: true })
    .fill("Mẫu xác thực đã sửa");
  await page
    .getByRole("button", { name: "Thông báo chung", exact: true })
    .click();
  await page
    .getByLabel("Nội dung email tự động", { exact: true })
    .fill("{{content}}\nNội dung chưa lưu");
  await page
    .getByRole("button", { name: "Xác thực tài khoản", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Lưu mẫu email", exact: true })
    .click();
  await expect(
    page.getByText("Có 1 mẫu email chưa lưu.", { exact: false }),
  ).toBeVisible();
  let warned = false;
  page.once("dialog", async (d) => {
    warned = true;
    await d.dismiss();
  });
  await page
    .locator("#academy-navigation")
    .getByRole("button", { name: "Tài khoản của bạn", exact: true })
    .click();
  expect(warned).toBe(true);
  await expect(page).toHaveURL(/quan-tri\/email/);
  await page
    .getByRole("button", { name: "Thông báo chung", exact: true })
    .click();
  await expect(
    page.getByLabel("Nội dung email tự động", { exact: true }),
  ).toHaveValue("{{content}}\nNội dung chưa lưu");
  await page
    .getByRole("button", { name: "Lưu mẫu email", exact: true })
    .click();
  await expect(page.getByText(/mẫu email chưa lưu/)).toHaveCount(0);
  await page
    .locator("#academy-navigation")
    .getByRole("button", { name: "Tài khoản của bạn", exact: true })
    .click();
  await expect(page).toHaveURL(/hoc\/tai-khoan/);
});

test("successful email enqueue remains successful when history refresh fails and pending fields are locked", async ({
  page,
}) => {
  let posts = 0,
    failRead = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await admin(page, async (r, path) => {
    if (path === "/api/academy/mail-campaigns") {
      if (r.request().method() === "POST") {
        posts++;
        await gate;
        await r.fulfill({ json: { id: "campaign", recipients: 1 } });
      } else if (posts && failRead)
        await r.fulfill({
          status: 503,
          json: { error: "Tạm mất kết nối lịch sử" },
        });
      else
        await r.fulfill({
          json: posts
            ? [
                {
                  id: "campaign",
                  title: "Lịch mới",
                  recipients: 1,
                  sent: 0,
                  pending: 1,
                  failed: 0,
                  cancelled: 0,
                },
              ]
            : [],
        });
      return true;
    }
    return false;
  });
  await page.goto("/quan-tri/email?muc=soan-email");
  const title = page.getByLabel("Tiêu đề email", { exact: true });
  await title.fill("Lịch mới");
  await page
    .getByLabel("Nội dung email", { exact: true })
    .fill("Nội dung lịch");
  await page
    .getByRole("button", { name: "Xác nhận gửi email", exact: true })
    .click();
  await expect(title).toBeDisabled();
  expect(posts).toBe(1);
  release();
  await expect(page.getByRole("status")).toContainText("Đã xếp hàng 1 email");
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue("");
  await page.getByRole("tab", { name: "Lịch sử gửi", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Chưa tải được lịch sử");
  expect(posts).toBe(1);
  failRead = false;
  await page
    .getByRole("button", { name: "Tải lại lịch sử", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Lịch mới", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .locator("#academy-navigation")
    .getByRole("button", { name: "Tài khoản của bạn", exact: true })
    .click();
  await expect(page).toHaveURL(/hoc\/tai-khoan/);
});

test("communications permission controls administration while personal notifications stay separate", async ({
  page,
}) => {
  await admin(page, undefined, ["finance"]);
  await page.goto("/quan-tri/email");
  await expect(
    page.getByRole("tablist", { name: "Quản lý thông báo và email" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Tiêu đề thông báo", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/hoc/thong-bao");
  await expect(page.locator(".academy-notifications")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gửi thông báo", exact: true }),
  ).toHaveCount(0);
});
