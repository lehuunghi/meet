import { test, expect } from "@playwright/test";
test.use({ timezoneId: "America/New_York" });
test("content admin imports a class recording with notes, then edits and reorders lessons", async ({
  page,
}) => {
  let lessons: any[] = [
      {
        id: "old",
        title: "Bài cũ",
        duration_seconds: 600,
        position: 1,
        status: "ready",
        chapter: "Chương 1",
        notes: "",
        revision: 0,
        import_state: "none",
      },
    ],
    queued: any = null,
    edited: any = null,
    order: any = null;
  await page.route("**/api/**", async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname;
    if (path === "/api/academy/courses/course-one/recordings") {
      queued = r.request().postDataJSON();
      lessons.push({
        id: "copied",
        title: queued.title,
        chapter: queued.chapter,
        notes: queued.notes,
        duration_seconds: queued.duration_seconds,
        status: "ready",
        import_state: "ready",
        revision: 2,
        source_recording_id: "rec",
      });
      return r.fulfill({
        status: 202,
        json: { id: "copied", state: "queued" },
      });
    }
    if (path === "/api/academy/lessons/copied/edit") {
      edited = r.request().postDataJSON();
      lessons[1] = { ...lessons[1], ...edited };
      return r.fulfill({ json: { ok: true } });
    }
    if (path === "/api/academy/courses/course-one/lesson-order") {
      order = r.request().postDataJSON();
      lessons = order.ids.map((id: string) => lessons.find((v) => v.id === id));
      return r.fulfill({ json: { ok: true } });
    }
    const data =
      path === "/api/me"
        ? { id: "admin", role: "admin", name: "VA" }
        : path === "/api/public-config"
          ? { platform_mode: "academy" }
          : path === "/api/academy/admin/courses"
            ? [{ id: "course-one", title: "Toán – Lớp 10", published: 1 }]
            : path === "/api/catalog"
              ? [
                  {
                    id: "subject",
                    class_id: "class",
                    class_name: "10A1",
                    name: "Toán",
                  },
                ]
              : path === "/api/recordings"
                ? [
                    {
                      id: "rec",
                      meeting_id: "meeting",
                      meeting_title: "Buổi ôn tập",
                      starts_at: "2026-01-02T18:05:00Z",
                      expires_at: "2026-02-01T18:05:00Z",
                      size_bytes: 10000,
                    },
                  ]
                : path.endsWith("/recordings/rec/download")
                  ? { url: "" }
                  : path === "/api/academy/courses/course-one/lessons"
                    ? lessons
                    : [];
    return r.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/quan-tri/noi-dung");
  const area = page.locator(".academy-lesson-editor");
  await area
    .getByLabel("Khóa học quản lý bài giảng")
    .selectOption("course-one");
  await area
    .getByText("Chọn bản ghi buổi học để đăng", { exact: true })
    .click();
  await area.getByLabel("Lớp và môn của bản ghi").selectOption("subject");
  await expect(area.getByLabel("Video buổi học")).toContainText(
    "03/01/2026 01:05",
  );
  await area.getByLabel("Video buổi học").selectOption("rec");
  const form = area.locator(".academy-lesson-import-form");
  await form
    .getByLabel("Tên bài giảng", { exact: true })
    .fill("Bài 2 · Ôn tập");
  await form.getByLabel("Chương / chủ đề").fill("Chương 1");
  await form
    .getByLabel("Ghi chú cho học sinh", { exact: true })
    .fill("Đọc lại ví dụ và làm bài 1–3.");
  await form.getByLabel("Thời lượng (phút)").fill("10");
  await form.getByRole("button", { name: "Đăng video vào khóa học" }).click();
  await expect.poll(() => queued?.duration_seconds).toBe(600);
  expect(queued).toMatchObject({
    recording_id: "rec",
    chapter: "Chương 1",
    published: true,
  });
  await area
    .getByRole("row")
    .filter({ hasText: "Bài 2 · Ôn tập" })
    .getByRole("button", { name: "Sửa bài giảng", exact: true })
    .click();
  const edit = area.locator(".academy-lesson-edit-form");
  await edit
    .getByLabel("Ghi chú cho học sinh", { exact: true })
    .fill("Ghi chú đã sửa");
  await edit
    .getByRole("button", { name: "Lưu bài giảng", exact: true })
    .click();
  await expect.poll(() => edited?.notes).toBe("Ghi chú đã sửa");
  await area
    .getByRole("button", { name: "Đưa lên Bài 2 · Ôn tập", exact: true })
    .click();
  await expect.poll(() => order?.ids[0]).toBe("copied");
  expect(order.expected).toEqual(["old", "copied"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("Vietnam date entry posts ISO and shows padded dates independently of browser timezone", async ({
  page,
}) => {
  let expense: any = null;
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/academy/finance" && r.request().method() === "POST") {
      expense = r.request().postDataJSON();
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json:
        path === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : path === "/api/public-config"
            ? { platform_mode: "academy" }
            : path === "/api/academy/finance"
              ? [{ day: "2026-01-03", revenue: 100000, orders: 1 }]
              : [],
    });
  });
  await page.goto("/quan-tri/thu-chi");
  await expect(
    page.getByRole("cell", { name: "03/01/2026", exact: true }),
  ).toBeVisible();
  const form = page
    .locator("form")
    .filter({ has: page.locator("[name=paid_on]") });
  await form.locator("[name=title]").fill("Khoản chi thử");
  await form.locator("[name=amount_vnd]").fill("1000");
  await form.locator('input[placeholder="dd/mm/yyyy"]').fill("31/02/2026");
  await form.locator("button[type=submit],button:not([type])").click();
  expect(expense).toBeNull();
  await form.locator('input[placeholder="dd/mm/yyyy"]').fill("03/01/2026");
  await form.locator("button[type=submit],button:not([type])").click();
  await expect.poll(() => expense?.paid_on).toBe("2026-01-03");
});
