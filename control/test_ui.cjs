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
      .getByRole("button", { name: "Nền tảng / VIP", exact: true })
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
      .getByRole("button", { name: "Nền tảng / VIP", exact: true })
      .click();
    assert.equal(
      await page.locator("[name=smtp_address]").inputValue(),
      "smtp.example.test:587",
    );
    await page.locator("[name=bank_name]").fill("Chủ tài khoản thử");
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
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
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
