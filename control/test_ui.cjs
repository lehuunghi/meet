// Uses disposable local data; queued installation jobs never execute SSH.
const { chromium } = require("../apps/web/node_modules/@playwright/test");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const port = process.env.CONTROL_TEST_PORT || "8092";
const origin = `http://127.0.0.1:${port}`;
(async () => {
  const server = spawn(
    process.env.CONTROL_TEST_PYTHON || "python3",
    [path.join(__dirname, "preview.py")],
    {
      env: { ...process.env, CONTROL_TEST_PORT: port },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Preview did not start")),
        15000,
      );
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error(`Preview exited ${code}`));
      });
      server.stdout.on("data", (data) => {
        if (String(data).includes("preview ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.stderr.on("data", (data) => process.stderr.write(data));
    });
    browser = await chromium.launch(
      process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
    );
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.locator("[name=email]").fill("owner@demo.test");
    await page.locator("[name=password]").fill("demo-control-12345");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.getByRole("heading", { name: "Nền tảng & VPS" }).waitFor();
    await page
      .getByRole("button", { name: "+ Nền tảng khóa học / VIP", exact: true })
      .click();
    await page.locator("[name=name]").fill("Academy thử nghiệm");
    await page.locator("[name=domain]").fill("academy.example.test");
    await page.locator("[name=ip]").fill("8.8.4.4");
    await page.locator("[name=admin_email]").fill("admin@academy.example.test");
    await page
      .locator("[name=admin_password]")
      .fill("academy-initial-password");
    await page
      .getByRole("button", {
        name: /^(Nền tảng \/ VIP|Email & thanh toán)$/,
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("[name=platform_mode]").inputValue(),
      "academy",
    );
    assert.equal(await page.locator("[name=platform_mode]").isDisabled(), true);
    await page.locator("[name=smtp_address]").fill("smtp.example.test:587");
    await page.locator("[name=smtp_from]").fill("academy@example.test");
    await page
      .getByRole("button", { name: "Lưu & đồng bộ", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    assert.equal(await page.locator("#workspace").count(), 1);
    assert.equal(await page.locator("#modal").evaluate((el) => el.open), false);
    assert.match(page.url(), /#academy\/[a-f0-9]{32}$/);
    assert.match(await page.locator('#sync-status').innerText(), /Liên kết API bảo mật được tạo tự động/);
    const syncRoute = async route => {
      const response = await route.fetch();
      const units = await response.json();
      for (const unit of units.filter(s => s.platform_mode === 'academy')) {
        unit.sync = { linked: true, online: true, state: 'failed', code: 'CONFIG_R2_REJECTED', revision: unit.revision, applied: 0 };
      }
      await route.fulfill({response, json: units});
    };
    await page.route('**/api/schools', syncRoute);
    await page.locator('#sync-status').getByText('Đồng bộ thất bại', {exact: true}).waitFor({timeout: 12000});
    assert.match(await page.locator('#sync-status').innerText(), /Admin Read & Write/);
    await page.unroute('**/api/schools', syncRoute);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(__dirname, `../outputs/control-academy-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Cài đặt / Nâng cấp", exact: true })
      .click();
    const install = page.getByRole("button", {
      name: "Cài nền tảng lên VPS",
      exact: true,
    });
    await install.waitFor();
    assert.equal(await install.isEnabled(), true);
    await page
      .getByRole("button", {
        name: /^(Nền tảng \/ VIP|Email & thanh toán)$/,
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("[name=smtp_address]").inputValue(),
      "smtp.example.test:587",
    );
    await page.locator("[name=bank_name]").fill("Chủ tài khoản thử");
    // Background acknowledgement polling must not replace a partially edited form.
    const poll = page.waitForResponse(r => r.url() === origin + '/api/schools' && r.request().method() === 'GET');
    await poll;
    assert.equal(await page.locator('[name=bank_name]').inputValue(), 'Chủ tài khoản thử');
    await page
      .getByRole("button", { name: "Cài đặt / Nâng cấp", exact: true })
      .click();
    await install.waitFor();
    assert.equal(await install.isDisabled(), true); // Never install with an unsaved draft.
    await page
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: /^(Đóng|Danh sách nền tảng)$/, exact: true })
      .click();
    await page.locator("#modefilter").selectOption("academy");
    assert.equal(await page.locator("#rows tr").count(), 1);
    assert.match(await page.locator("#rows").innerText(), /Academy thử nghiệm/);
    await page.locator("#modefilter").selectOption("school");
    await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Quản trị kinh doanh", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Cài đặt / Nâng cấp", exact: true })
      .click();
    await install.waitFor();
    assert.equal(await install.isDisabled(), true); // Existing school must not be reinstalled.
    await page
      .getByRole("button", { name: /^(Đóng|Danh sách nền tảng)$/, exact: true })
      .click();
    await page.locator("#modefilter").selectOption("academy");
    await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
    await page
      .locator("#tabs")
      .getByRole("button", { name: "SFU", exact: true })
      .click();
    assert.equal(await page.getByText("TURN keys", { exact: true }).count(), 0);
    await page
      .getByRole("button", { name: "API tích hợp", exact: true })
      .click();
    await page.locator("#new-key [name=label]").fill("UI integration");
    await page
      .getByRole("button", { name: "Tạo API key", exact: true })
      .click();
    await page.locator("#issued-api-key").waitFor();
    const token = await page.locator("#issued-api-key").inputValue();
    const endpoint = await page.locator("#api-example").innerText();
    const url = endpoint.split("\n")[0].replace("GET ", "");
    const before = await (
      await page.request.get(url, {
        headers: { Authorization: "Bearer " + token },
      })
    ).json();
    const patched = await page.request.patch(url, {
      headers: { Authorization: "Bearer " + token },
      data: { revision: before.revision, name: "Academy API" },
    });
    assert.equal(patched.status(), 200);
    await page
      .getByRole("button", { name: "Hoạt động / Xóa", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Tạm ngưng đơn vị", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Hoạt động / Xóa", exact: true })
      .click();
    await page
      .locator("#archive-school [name=confirm]")
      .fill("academy.example.test");
    await page
      .getByRole("button", { name: "Xóa vào thùng rác", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    assert.equal(
      (
        await page.request.get(url, {
          headers: { Authorization: "Bearer " + token },
        })
      ).status(),
      401,
    );
    await page
      .getByRole("button", { name: "Hoạt động / Xóa", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Khôi phục từ thùng rác", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Kiểm tra trước khi cài", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Backup / Chuyển VPS", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Backup và chuyển sang VPS mới",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Academy creation, saved drafts, readiness, mobile layout, school isolation and reinstall guards passed.",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
