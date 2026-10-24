import { test, expect } from "@playwright/test";
test("all roles retain compact pages and working mobile navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const role of ["admin", "teacher", "student"])
    for (const section of [
      "overview",
      "courses",
      "meetings",
      "settings",
      ...(role === "admin" ? ["admin", "audit"] : []),
    ]) {
      await page.goto(`/?demo=1&role=${role}&page=${section}`);
      await expect(page.locator(".heading h1")).toBeVisible();
      await expect(page.locator('nav [aria-current="page"]')).toHaveCount(1);
      for (const width of [1440, 390, 360]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.locator(".mobile-menu-control").click();
      await expect(page.locator("nav")).toBeVisible();
      await page.locator("nav button").first().click();
      await expect(page.locator("nav")).toBeHidden();
    }
  expect(errors).toEqual([]);
});
test("password recovery keeps the bearer out of the URL and requires a deliberate submission", async ({
  page,
}) => {
  let body: any;
  await page.route("**/api/reset-password", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/reset-password#token=" + "a".repeat(64));
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("token=");
  await page.locator('input[name="password"]').fill("new-password-12345");
  await page.locator('input[name="code"]').fill("123456");
  await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Đã đổi mật khẩu");
  expect(body).toEqual({
    token: "a".repeat(64),
    password: "new-password-12345",
    code: "123456",
  });
});
test("attendance and recordings stay comparison tables on small screens", async ({
  page,
}) => {
  for (const role of ["admin", "teacher", "student"])
    for (const section of ["attendance", "recordings"]) {
      await page.goto(`/?demo=1&role=${role}&page=${section}`);
      if (role === "admin") {
        await page
          .getByRole("combobox", { name: "Lớp học", exact: true })
          .fill("10a1");
        await page.getByRole("option", { name: /^10A1/ }).click();
        await page
          .getByRole("combobox", { name: "Môn học", exact: true })
          .fill("toan");
        await page.getByRole("option", { name: /^Toán học/ }).click();
      }
      const region = page.locator(".comparison-scroll");
      await expect(region.locator("tbody tr").first()).toBeVisible();
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 844 });
        expect(
          await region
            .locator("table")
            .evaluate((el) => getComputedStyle(el).display),
        ).toBe("table");
        await expect(region.locator("thead")).toBeVisible();
        const first = region.locator("tbody tr").first().locator("td").first();
        const before = await first.boundingBox();
        await region.evaluate((el) => (el.scrollLeft = 250));
        const after = await first.boundingBox();
        expect(Math.abs(before!.x - after!.x)).toBeLessThan(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await region.evaluate((el) => (el.scrollLeft = 0));
      }
    }
});
test("recording survives reload and retries only the failed multipart upload", async ({
  page,
}) => {
  let fail = true;
  const sizes: number[] = [];
  const signedParts: number[] = [];
  let completed = 0;
  await page.route(
    "**/api/meetings/lesson/recordings/local-job/parts/*",
    async (route) => {
      const part = Number(route.request().url().split("/").pop());
      signedParts.push(part);
      await route.fulfill({
        json: { url: `http://127.0.0.1:5173/mock-part/${part}` },
      });
    },
  );
  await page.route("**/mock-part/*", async (route) => {
    const n = Number(route.request().url().split("/").pop());
    if (n === 2 && fail) {
      fail = false;
      await route.fulfill({ status: 503 });
      return;
    }
    sizes.push(route.request().postDataBuffer()!.length);
    await route.fulfill({ status: 200 });
  });
  await page.route(
    "**/api/meetings/lesson/recordings/local-job/finish",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({ parts: 2 });
      completed++;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.goto("/?demo=1&role=teacher");
  await page.evaluate(async () => {
    const s = await import("/src/recording-store.ts");
    await s.saveJob({
      id: "local-job",
      owner: "owner",
      school: "school",
      meeting: "lesson",
      title: "Test",
      bytes: 0,
      chunks: 0,
      uploaded: 0,
      stopped: false,
      created: Date.now(),
    });
    for (let i = 0; i < 17; i++)
      await s.appendChunk(
        "local-job",
        new Blob([new Uint8Array(1024 * 1024).fill(i)]),
      );
    await s.uploadRecording("local-job");
    await s.stopJob("local-job");
    try {
      await s.uploadRecording("local-job");
    } catch {}
  });
  await page.reload();
  const pending = await page.evaluate(async () => {
    const s = await import("/src/recording-store.ts");
    return {
      job: await s.getJob("local-job"),
      other: await s.listJobs("other", "school"),
    };
  });
  expect(pending.job.uploaded).toBe(1);
  expect(pending.job.bytes).toBe(17 * 1024 * 1024);
  expect(pending.other).toEqual([]);
  await page.evaluate(async () => {
    const s = await import("/src/recording-store.ts");
    const data = await s.readRecordingRange(
      "local-job",
      16 * 1024 * 1024,
      1024,
    );
    if (new Uint8Array(await data.arrayBuffer())[0] !== 16)
      throw Error("Wrong byte range");
    await s.uploadRecording("local-job");
    if (await s.getJob("local-job")) throw Error("Completed data not removed");
  });
  expect(signedParts).toEqual([1, 2, 2]);
  expect(sizes).toEqual([16 * 1024 * 1024, 1024 * 1024]);
  expect(completed).toBe(1);
});
