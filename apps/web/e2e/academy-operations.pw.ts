import { test, expect, Page } from "@playwright/test";
const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2sAAAAASUVORK5CYII=",
  "base64",
);
test("CMS uploads an image, blocks premature saves and preserves unrelated content", async ({
  page,
}) => {
  let uploaded: any, done!: () => void, saved: any;
  const pending = new Promise<void>((r) => (done = r));
  let value: any = {
    headline: "VA",
    published: true,
    terms: "Giữ điều khoản",
    posts: [
      {
        Slug: "bai-viet",
        Title: "Bài viết",
        Body: "Giữ nội dung",
        Image: "/images/math.svg",
        Published: true,
      },
    ],
  };
  const url = "/api/academy/images/" + "a".repeat(32);
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === url)
      return r.fulfill({ body: photo, contentType: "image/png" });
    if (
      path === "/api/academy/site/images" &&
      r.request().method() === "POST"
    ) {
      uploaded = r.request();
      await pending;
      return r.fulfill({ status: 201, json: { url } });
    }
    if (path === "/api/academy/site" && r.request().method() === "POST") {
      saved = r.request().postDataJSON().content;
      return r.fulfill({ json: { revision: "new" } });
    }
    return r.fulfill({
      json:
        path === "/api/me"
          ? { id: "admin", name: "Admin", role: "admin" }
          : path === "/api/public-config"
            ? { platform_mode: "academy" }
            : path === "/api/academy/site"
              ? [{ content: JSON.stringify(value), revision: "old" }]
              : [],
    });
  });
  await page.goto("/quan-tri/website?muc=bai-viet");
  const input = page.getByLabel("Tải ảnh bài viết", { exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await expect.poll(() => !!uploaded).toBe(true);
  await expect(
    page.getByRole("button", { name: "Lưu website", exact: true }),
  ).toBeDisabled();
  expect(uploaded.headers()["content-type"]).toContain("multipart/form-data");
  done();
  await expect(
    page.getByAltText("Ảnh bài viết", { exact: true }),
  ).toHaveAttribute("src", url);
  await page.getByRole("button", { name: "Lưu website", exact: true }).click();
  await expect.poll(() => !!saved).toBe(true);
  expect(saved.posts[0].Image).toBe(url);
  expect(saved.posts[0].Body).toBe("Giữ nội dung");
  expect(saved.terms).toBe("Giữ điều khoản");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("receipt needs explicit confirmation and produces a pending invoice without VIP activation", async ({
  page,
}) => {
  let attached = false,
    confirmed = 0,
    uploaded = 0;
  const order: any = {
    id: "pay-order",
    code: 123,
    amount: 100000,
    status: "pending",
    description: "NAPVIP 123",
    invoice_number: "",
    has_receipt: false,
  };
  await page.route("**/receipt-put", async (r) => {
    uploaded++;
    return r.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/academy/uploads")
      return r.fulfill({
        json: {
          url: "/receipt-put",
          key: "academy/receipts/s/student/fixture",
        },
      });
    if (path.endsWith("/receipt") && r.request().method() === "POST") {
      attached = true;
      order.has_receipt = true;
      return r.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/confirm-transfer")) {
      expect(attached).toBe(true);
      confirmed++;
      order.invoice_number = "HD123";
      return r.fulfill({ status: 201, json: { ok: true } });
    }
    if (path.endsWith("/invoice"))
      return r.fulfill({
        json: {
          number: "HD123",
          school_name: "VA",
          buyer_name: "Học sinh",
          plan_name: "VIP",
          amount_vnd: 100000,
          days: 30,
          status: "pending",
          created_at: "2026-10-28T01:00:00Z",
        },
      });
    return r.fulfill({
      json:
        path === "/api/me"
          ? { id: "student", name: "HS", role: "student" }
          : path === "/api/public-config"
            ? { platform_mode: "academy" }
            : path === "/api/academy/orders/pay-order"
              ? order
              : path === "/api/academy/orders"
                ? [{ ...order, price_vnd: 100000 }]
                : [],
    });
  });
  await page.goto("/hoc/thanh-toan/pay-order");
  const confirm = page.getByRole("button", {
    name: "Đã chuyển khoản — Tạo hóa đơn",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("Đính kèm biên lai", { exact: true })
    .setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: photo,
    });
  await expect(confirm).toBeEnabled();
  expect(confirmed).toBe(0);
  expect(uploaded).toBe(1);
  await confirm.click();
  await expect(
    page.getByText("Hóa đơn:", { exact: false }).first(),
  ).toBeVisible();
  expect(confirmed).toBe(1);
  await page
    .getByRole("button", { name: "Xem hóa đơn", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("HD123");
  await expect(dialog).toContainText("chờ đối soát");
  await expect(page.locator(".academy-badge")).toContainText("Học thử");
  await dialog
    .getByRole("button", { name: "Đóng hóa đơn", exact: true })
    .click();
});
test("global notice reaches a second account and deletion removes it there too", async ({
  page,
  context,
}) => {
  let broadcasts: any[] = [],
    feed: any[] = [],
    emailRequested = false;
  const teacher = await context.newPage();
  async function mock(p: Page, role: string) {
    await p.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname,
        method = r.request().method();
      if (path === "/api/academy/broadcasts" && method === "POST") {
        const v = r.request().postDataJSON();
        emailRequested = v.email;
        broadcasts = [
          {
            id: "notice",
            title: v.title,
            body: v.body,
            email_requested: v.email,
          },
        ];
        feed = [
          {
            id: "a".repeat(64),
            kind: "broadcast",
            title: v.title,
            detail: v.body,
            path: "/hoc/thong-bao",
            read: false,
          },
        ];
        return r.fulfill({
          status: 201,
          json: { id: "notice", email_recipients: 3 },
        });
      }
      if (path.endsWith("/notice/delete")) {
        broadcasts = [];
        feed = [];
        return r.fulfill({ json: { ok: true } });
      }
      return r.fulfill({
        json:
          path === "/api/me"
            ? { id: role, name: role, role }
            : path === "/api/public-config"
              ? { platform_mode: "academy" }
              : path === "/api/academy/broadcasts"
                ? broadcasts
                : path === "/api/academy/notifications"
                  ? feed
                  : [],
      });
    });
  }
  await mock(page, "admin");
  await mock(teacher, "teacher");
  await page.goto("/hoc/thong-bao");
  await teacher.goto("/hoc/thong-bao");
  await page
    .getByLabel("Tiêu đề thông báo", { exact: true })
    .fill("Thông báo kiểm thử");
  await page
    .getByLabel("Nội dung thông báo", { exact: true })
    .fill("Nội dung cho mọi tài khoản");
  await page.getByLabel("Đồng thời gửi thông báo đến email").check();
  await page
    .getByRole("button", { name: "Gửi thông báo", exact: true })
    .click();
  await expect.poll(() => emailRequested).toBe(true);
  await teacher.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(teacher.locator(".academy-notifications")).toContainText(
    "Thông báo kiểm thử",
  );
  await expect(
    teacher.getByRole("button", { name: "Gửi thông báo", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Xóa thông báo", exact: true })
    .click();
  await expect(page.locator(".academy-notifications")).not.toContainText(
    "Thông báo kiểm thử",
  );
  await teacher.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(teacher.locator(".academy-notifications")).not.toContainText(
    "Thông báo kiểm thử",
  );
  await teacher.close();
});
test("email templates and composing use the dedicated administration page", async ({
  page,
}) => {
  let template: any, mail: any;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (
      path === "/api/academy/mail-templates" &&
      r.request().method() === "POST"
    ) {
      template = r.request().postDataJSON();
      return r.fulfill({ json: { revision: 1 } });
    }
    if (
      path === "/api/academy/mail-campaigns" &&
      r.request().method() === "POST"
    ) {
      mail = r.request().postDataJSON();
      return r.fulfill({
        status: 201,
        json: { id: "campaign", recipients: 1 },
      });
    }
    return r.fulfill({
      json:
        path === "/api/me"
          ? { id: "admin", name: "Admin", role: "admin" }
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
  await page.goto("/quan-tri/email");
  await page
    .getByLabel("Tiêu đề email tự động", { exact: true })
    .fill("Xác thực email VA");
  await page
    .getByRole("button", { name: "Lưu mẫu email", exact: true })
    .click();
  await expect.poll(() => template?.subject).toBe("Xác thực email VA");
  expect(template.body).toContain("{{verification_link}}");
  await page.getByLabel("Tiêu đề email", { exact: true }).fill("Lịch học mới");
  await page
    .getByLabel("Nội dung email", { exact: true })
    .fill("Chào {{name}}, xem lịch học mới.");
  await page
    .getByRole("button", { name: "Xác nhận gửi email", exact: true })
    .click();
  await expect.poll(() => mail?.audience).toBe("self");
  expect(mail.request_id).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
