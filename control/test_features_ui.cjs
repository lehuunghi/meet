const { chromium } = require("../apps/web/node_modules/@playwright/test"),
  { spawn } = require("node:child_process"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const port = process.env.CONTROL_FEATURE_TEST_PORT || "8094",
  origin = "http://127.0.0.1:" + port;
(async () => {
  const server = spawn(
    process.env.CONTROL_TEST_PYTHON || "python3",
    [path.join(__dirname, "preview.py")],
    {
      env: {
        ...process.env,
        CONTROL_TEST_PORT: port,
        CONTROL_FEATURE_FIXTURES: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Preview timeout")), 15000);
      server.once("exit", () => reject(Error("Preview exited")));
      server.stdout.on("data", (d) => {
        if (String(d).includes("preview ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.stderr.on("data", (d) => process.stderr.write(d));
    });
    browser = await chromium.launch(
      process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
    );
    const p = await browser.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(origin);
    await p.locator("[name=email]").fill("owner@demo.test");
    await p.locator("[name=password]").fill("demo-control-12345");
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.locator("#statefilter").selectOption("suspended");
    await p.getByRole("button", { name: "Chi tiết", exact: true }).click();
    await p.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await p
      .getByRole("button", { name: "Mở màn hình cài đặt", exact: true })
      .click();
    await p.waitForFunction(() =>
      document
        .querySelector("#job-console")
        ?.textContent.includes("Dựng ứng dụng"),
    );
    assert.match(await p.locator("#job-console").innerText(), /Xác thực SSH/);
    assert.match(await p.locator("#job-console").innerText(), /Dựng ứng dụng/);
    assert.equal(
      await p.locator("#job-monitor progress").getAttribute("value"),
      "55",
    );
    await p.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await p.getByRole("button", { name: "Đóng màn hình", exact: true }).click();
    await p
      .getByRole("button", { name: "Phục hồi sao lưu", exact: true })
      .click();
    await p.locator("[name=object_key]").selectOption("backups/2026/qa.meet");
    assert.equal(
      await p.locator("#restore-backup [name=object_key]").inputValue(),
      "backups/2026/qa.meet",
    );
    assert.equal(
      await p
        .getByRole("button", { name: "Xác nhận phục hồi", exact: true })
        .isEnabled(),
      true,
    );
    await p.evaluate(() => document.querySelector("#modal").close());
    await p
      .getByRole("button", { name: "Bảo mật tài khoản", exact: true })
      .click();
    await p
      .locator("#own-profile [name=email]")
      .fill("updated-owner@example.test");
    await p
      .locator("#own-profile [name=current_password]")
      .fill("demo-control-12345");
    await p
      .locator("#own-profile [name=new_password]")
      .fill("updated-demo-password-123");
    await p
      .getByRole("button", { name: "Lưu email / mật khẩu", exact: true })
      .click();
    await p.locator("#login [name=email]").fill("updated-owner@example.test");
    await p.locator("#login [name=password]").fill("updated-demo-password-123");
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p
      .getByRole("button", { name: "Bảo mật tài khoản", exact: true })
      .click();
    await p
      .locator("#security [name=password]")
      .fill("updated-demo-password-123");
    await p.getByRole("button", { name: "Thiết lập 2FA", exact: true }).click();
    const secret = await p.locator("#modal input[readonly]").inputValue();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of secret)
      bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const bytes = Buffer.from(
      (bits.match(/.{8}/g) || []).map((x) => parseInt(x, 2)),
    );
    const step = Buffer.alloc(8);
    step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const raw = crypto.createHmac("sha1", bytes).update(step).digest(),
      off = raw[19] & 15,
      code = ((raw.readUInt32BE(off) & 0x7fffffff) % 1000000)
        .toString()
        .padStart(6, "0");
    await p.locator("#enablemfa [name=code]").fill(code);
    await p.getByRole("button", { name: "Bật 2FA", exact: true }).click();
    await p.locator("#recoverycodes").waitFor();
    const codes = (await p.locator("#recoverycodes").innerText())
      .trim()
      .split("\n");
    assert.equal(codes.length, 8);
    await p
      .getByRole("button", { name: "Đã lưu · Đăng nhập lại", exact: true })
      .click();
    await p.locator("#login [name=email]").fill("updated-owner@example.test");
    await p.locator("#login [name=password]").fill("updated-demo-password-123");
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.locator("#login [name=code]").fill(codes[0]);
    await p.getByRole("button", { name: "Xác thực", exact: true }).click();
    await p
      .getByRole("heading", { name: "Nền tảng & VPS", exact: true })
      .waitFor();
    await p.locator("#statefilter").selectOption("deleted");
    await p.getByRole("button", { name: "Chi tiết", exact: true }).click();
    await p
      .getByRole("button", { name: "Hoạt động / Xóa", exact: true })
      .click();
    await p.locator("#purge-school").waitFor();
    assert.equal(
      await p.locator("#purge-school [name=erase_vps]").isChecked(),
      false,
    );
    assert.equal(
      await p.locator("#purge-school [name=confirm]").getAttribute("required"),
      "",
    );
    assert.equal(
      await p
        .locator("#purge-school [name=admin_password]")
        .getAttribute("type"),
      "password",
    );
    assert.equal(await p.locator("#purge-school [name=code]").count(), 1);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Central UI: installation progress/console, snapshot selection, own credentials and real TOTP/recovery authentication passed (disposable fixtures)",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
