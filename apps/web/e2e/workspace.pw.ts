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
test("listen-only classroom keeps the mobile toolbar clear of page content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("blocked", "NotAllowedError")),
      },
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/me")
      data = {
        id: "teacher",
        school_id: "school-demo",
        role: "teacher",
        name: "Giáo viên thử",
      };
    else if (path === "/api/setup/status") data = { initialized: true };
    else if (path === "/api/meetings")
      data = [
        {
          id: "lesson",
          title: "Buổi học thử",
          class_name: "10A1",
          course: "Toán",
          course_id: "math",
          starts_at: new Date().toISOString(),
          status: "live",
          recording_allowed: true,
        },
      ];
    else if (path === "/api/meetings/lesson")
      data = {
        id: "lesson",
        title: "Buổi học thử",
        status: "live",
        class_name: "10A1",
        course: "Toán",
        course_id: "math",
        starts_at: new Date().toISOString(),
        recording_allowed: true,
      };
    else if (route.request().method === "POST") data = { ok: true };
    await route.fulfill({ json: data });
  });
  await page.goto("/?room=lesson");
  await expect(
    page.getByText("Camera chưa được mở", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bật camera", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("đang bị chặn");
  await page
    .getByRole("button", {
      name: "Vào lớp học",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Bật mic", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator(".room")
        .evaluate(
          (el) =>
            parseFloat(getComputedStyle(el).paddingBottom) -
            el.querySelector(".room-toolbar")!.getBoundingClientRect().height,
        ),
    )
    .toBeGreaterThanOrEqual(23);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("class/subject reports include per-lesson statistics and videos in compact mobile tables", async ({
  page,
}) => {
  for (const role of ["admin", "teacher", "student"]) {
    await page.goto(`/?demo=1&role=${role}&page=attendance`);
    await expect(
      page.getByRole("button", { name: "Bản ghi bài học", exact: true }),
    ).toHaveCount(0);
    if (role !== "student")
      await page
        .getByRole("combobox", { name: "Lớp học", exact: true })
        .selectOption({ label: "10A1" });
    await page
      .getByRole("button", { name: "Xem thống kê & video", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Xem video", exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Xem thống kê buổi", exact: true })
      .first()
      .click();
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
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
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
