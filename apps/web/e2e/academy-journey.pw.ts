import { test, expect } from "@playwright/test";
test("registration keeps the selected course across two steps and requires a deliberate final submission", async ({
  page,
}) => {
  let registered: any = null;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      return r.fulfill({ status: 401, json: { error: "Login" } });
    if (path === "/api/public-config")
      data = { platform_mode: "academy", school_name: "VA Academy" };
    if (path === "/api/academy/register") {
      registered = r.request().postDataJSON();
      data = { ok: true };
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc?register=1&course=course-one");
  await page.getByLabel("Email", { exact: true }).fill("learner@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  expect(registered).toBeNull();
  await expect(page.getByRole("status")).toContainText("Bước 2/2");
  for (const [name, value] of [
    ["Họ tên", "Nguyễn An"],
    ["Ngày sinh", "01/01/2010"],
    ["Địa chỉ", "Hà Nội"],
    ["Trường đang học", "Trường thử"],
    ["Số điện thoại", "0901234567"],
    ["Số điện thoại phụ huynh", "0912345678"],
    ["Mã xác thực email", "123456"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("button", { name: "← Quay lại tài khoản" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "learner@example.test",
  );
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByLabel("Họ tên", { exact: true })).toHaveValue(
    "Nguyễn An",
  );
  await page
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect.poll(() => registered?.profile.name).toBe("Nguyễn An");
  expect(registered.email).toBe("learner@example.test");
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    "/hoc/khoa-hoc/course-one",
  );
});
test("workspace actions open the intended lesson and teacher cannot post through a student view", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/"))
      writes.push(r.url());
  });
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "learner",
        role: "student",
        name: "Học sinh thử",
        school_id: "school",
      };
    if (path === "/api/public-config")
      data = { platform_mode: "academy", school_name: "VA" };
    if (path === "/api/academy/courses")
      data = [
        {
          id: "course-one",
          title: "Toán",
          description: "Giới thiệu",
          academic_course_id: "subject",
        },
      ];
    if (path === "/api/academy/lessons/lesson-one")
      data = {
        id: "lesson-one",
        course_id: "course-one",
        title: "Bài đang xem",
      };
    if (path === "/api/academy/workspace")
      data = {
        meetings: [],
        tasks: [],
        resume: [
          {
            course_id: "course-one",
            lesson_id: "lesson-one",
            title: "Xem dở",
            course: "Toán",
            seconds: 100,
            duration_seconds: 1000,
          },
        ],
      };
    if (path === "/api/academy/courses/course-one/lessons")
      data = [
        {
          id: "lesson-one",
          title: "Bài đang xem",
          progress_seconds: 100,
          duration_seconds: 1000,
          status: "ready",
        },
      ];
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc");
  await page
    .getByRole("button", { name: "Tiếp tục bài học", exact: true })
    .click();
  await expect(page.locator(".academy-selected-lesson")).toContainText(
    "Bài đang xem",
  );
  expect(writes).toEqual([]);
  await page.goto("/hoc?academy_demo=1&role=teacher");
  await page
    .getByRole("button", { name: "Xem môn học", exact: true })
    .first()
    .click();
  await page.locator(".classroom-card-cover h3 [role=button]").first().click();
  await page.getByText("Đăng thông báo cho môn học", { exact: true }).click();
  await page
    .getByLabel("Tiêu đề thông báo", { exact: true })
    .fill("Lịch ôn tập");
  await page
    .getByLabel("Nội dung thông báo", { exact: true })
    .fill("Ôn tập chương một");
  await page
    .getByRole("button", { name: "Đăng thông báo", exact: true })
    .click();
  await expect(page.locator(".classroom-announcement")).toContainText(
    "Ôn tập chương một",
  );
  expect(writes).toEqual([]);
  await page.goto("/hoc?academy_demo=1&role=student");
  await page.locator(".classroom-card-cover h3 [role=button]").first().click();
  await expect(
    page.getByText("Đăng thông báo cho môn học", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Thành viên", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "Danh sách chi tiết học sinh do giáo viên",
  );
});

test("website editor preserves existing content, sends revision and edits course information", async ({
  page,
}) => {
  let posted: any = null;
  await page.route("**/api/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    let data: any = [];
    if (path === "/api/me")
      data = {
        id: "owner",
        role: "admin",
        name: "Quản trị",
        school_id: "school",
      };
    if (path === "/api/public-config")
      data = { platform_mode: "academy", school_name: "VA" };
    if (path === "/api/academy/admin/courses")
      data = [
        {
          id: "course-one",
          title: "Toán",
          description: "Giới thiệu",
          teacher_name: "Giáo viên",
          published: true,
        },
      ];
    if (path === "/api/academy/site") {
      if (r.request().method() === "POST") {
        posted = r.request().postDataJSON();
        data = { ok: true, revision: "next-revision" };
      } else
        data = [
          {
            content: JSON.stringify({
              headline: "VA",
              description: "Nội dung thật",
              published: true,
              posts: [
                {
                  Slug: "bai-cu",
                  Title: "Bài cũ",
                  Summary: "Tóm tắt",
                  Body: "Giữ nguyên",
                  Published: true,
                },
              ],
              terms: "Điều khoản đã duyệt",
            }),
            revision: "saved-revision",
          },
        ];
    }
    await r.fulfill({ json: data });
  });
  await page.goto("/hoc");
  await page
    .getByRole("button", { name: "Quản trị website", exact: true })
    .click();
  await page.getByRole("link", {name:"Tất cả nội dung",exact:true}).click();
  await page.getByText("Liên hệ & chính sách", { exact: true }).click();
  await page
    .getByLabel("Email liên hệ", { exact: true })
    .fill("support@example.test");
  await page.getByText("Trang chi tiết khóa học", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Chọn khóa học để biên tập", exact: true })
    .selectOption("course-one");
  await page
    .getByLabel("Đối tượng học", { exact: true })
    .fill("Học sinh lớp 10");
  await page
    .getByLabel("Mục tiêu · mỗi dòng một mục", { exact: true })
    .fill("Nắm kiến thức\nVận dụng");
  await page.getByRole("button", { name: "Lưu website", exact: true }).click();
  await expect.poll(() => posted?.revision).toBe("saved-revision");
  expect(posted.content.posts[0].Body).toBe("Giữ nguyên");
  expect(posted.content.terms).toBe("Điều khoản đã duyệt");
  expect(posted.content.contact_email).toBe("support@example.test");
  expect(posted.content.course_pages["course-one"].audience).toBe(
    "Học sinh lớp 10",
  );
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
