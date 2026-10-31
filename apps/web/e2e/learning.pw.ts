import { test, expect } from "@playwright/test";
test("student sees only subjects, active first, with waiting state and scoped videos", async ({
  page,
}) => {
  await page.goto("/?demo=1&role=student&page=overview");
  await expect(
    page.getByRole("button", { name: "Lớp & môn học", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Buổi học", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Chuẩn bị dạy", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".classroom-card").first()).toContainText(
    "Đang học",
  );
  await page
    .getByRole("button", { name: "Các buổi học & video", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Xem video", exact: true })
    .first()
    .click();
  await expect(page.locator(".learning-videos")).toBeVisible();
});
test("teacher prepares a course without a separate create-lesson form; six-character link resolves after login", async ({
  page,
}) => {
  const course = {
    id: "course-a",
    name: "Toán",
    class_id: "class-a",
    class_name: "10A1",
    teacher: "Teacher",
    lesson_count: 0,
  };
  const lesson = {
    id: "lesson-a",
    course_id: course.id,
    course: "Toán",
    class_name: "10A1",
    title: "Toán",
    status: "scheduled",
    starts_at: "2026-10-25T01:00:00Z",
    recording_allowed: false,
    can_manage: true,
    admission: "admitted",
    rules: {
      lobby: false,
      chat_enabled: true,
      present_enabled: true,
      revision: 0,
    },
    short_code: "beyney",
  };
  let prepared = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "teacher",
        name: "Teacher",
        role: "teacher",
        school_id: "school",
      };
    else if (path === "/api/public-config")
      data = { managed: true, school_name: "Trường thử" };
    else if (path === "/api/catalog") data = [course];
    else if (path === "/api/meetings") data = prepared ? [lesson] : [];
    else if (path === "/api/courses/course-a/prepare") {
      prepared++;
      expect(route.request().postDataJSON()).toEqual({});
      data = lesson;
    } else if (
      path === "/api/meetings/lesson-a" ||
      path === "/api/rooms/beyney"
    )
      data = lesson;
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Xem môn học", exact: true }).click();
  await expect(page.getByText("Tạo buổi học", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Chuẩn bị dạy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bắt đầu buổi học", exact: true }),
  ).toBeVisible();
  expect(prepared).toBe(1);
  await page.goto("/beyney");
  await expect(
    page.getByRole("heading", { name: "Toán", exact: true }),
  ).toHaveText("Toán");
});
