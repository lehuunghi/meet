import { test, expect } from "@playwright/test";
test("class lifecycle supports rename, suspend, activation and confirmed archive", async ({
  page,
}) => {
  let row: any = {
      id: "class-one",
      name: "10A1",
      short_id: "LH0001",
      state: "active",
      revision: 0,
    },
    saved: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/classes/class-one/manage") {
      saved = r.request().postDataJSON();
      row = { ...row, ...saved, revision: row.revision + 1 };
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/classes"
              ? [row]
              : [],
    });
  });
  await page.goto("/quan-tri/lop-hoc");
  await page.getByRole("tab", { name: "Lớp học", exact: true }).click();
  const area = page.locator(".class-manager");
  await area.getByRole("button", { name: "Sửa lớp", exact: true }).click();
  await area.getByLabel("Tên lớp mới", { exact: true }).fill("10A1 mới");
  await area.getByRole("button", { name: "Lưu lớp", exact: true }).click();
  await expect.poll(() => saved?.name).toBe("10A1 mới");
  await area.getByRole("button", { name: "Ngưng lớp", exact: true }).click();
  await expect.poll(() => saved?.state).toBe("suspended");
  await area
    .getByRole("button", { name: "Kích hoạt lớp", exact: true })
    .click();
  await expect.poll(() => saved?.state).toBe("active");
  page.once("dialog", (d) => d.accept("10A1 mới"));
  await area.getByRole("button", { name: "Xóa lớp", exact: true }).click();
  await expect.poll(() => saved?.state).toBe("deleted");
  await expect(
    area.getByRole("button", { name: "Sửa lớp", exact: true }),
  ).toHaveCount(0);
  await area.getByLabel("Hiện lớp đã xóa để đối chiếu lịch sử").check();
  await expect(
    area.getByText("Đã xóa / lưu lịch sử", { exact: true }),
  ).toBeVisible();
});
test("teacher table can edit an account, suspend it and remove it with confirmation", async ({
  page,
}) => {
  let teacher: any = {
      id: "teacher",
      email: "teacher@example.test",
      name: "Thầy A",
      role: "teacher",
      active: true,
      state: "active",
      revision: 1,
    },
    saved: any = null,
    removed: any = null,
    edited: any = null;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/teachers/batch") {
      edited = r.request().postDataJSON();
      teacher = { ...teacher, ...edited.rows[0], revision: 2 };
      return r.fulfill({ json: { saved: 1 } });
    }
    if (p === "/api/accounts") {
      saved = r.request().postDataJSON();
      teacher = { ...teacher, ...saved, revision: 3, active: false };
      return r.fulfill({ json: { ok: true } });
    }
    if (p === "/api/accounts/teacher/delete") {
      removed = r.request().postDataJSON();
      teacher = null;
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/users"
              ? teacher
                ? [teacher]
                : []
              : [],
    });
  });
  await page.goto("/quan-tri/lop-hoc");
  await page.getByRole("tab", { name: "Giáo viên", exact: true }).click();
  await page.getByLabel("Họ tên dòng 1").fill("Thầy đã sửa");
  await page
    .getByRole("button", { name: "Lưu các dòng thay đổi", exact: true })
    .click();
  await expect.poll(() => edited?.rows[0].name).toBe("Thầy đã sửa");
  await page
    .getByRole("button", { name: "Ngưng giáo viên", exact: true })
    .click();
  await expect.poll(() => saved?.state).toBe("suspended");
  page.once("dialog", (d) => d.accept("teacher@example.test"));
  await page
    .getByRole("button", { name: "Xóa giáo viên", exact: true })
    .click();
  await expect.poll(() => removed?.confirm).toBe("teacher@example.test");
});
test("course editor selects a live class by its name and student opens its subject without entering IDs", async ({
  page,
}) => {
  let saved: any = null,
    enrolled = 0;
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/academy/courses" && r.request().method() === "POST") {
      saved = r.request().postDataJSON();
      return r.fulfill({ json: { id: "course" } });
    }
    if (p === "/api/academy/courses/course/enroll") {
      enrolled++;
      return r.fulfill({ json: { class_id: "class", subject_id: "subject" } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "admin", role: "admin", name: "VA" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/academy/admin/courses"
              ? [
                  {
                    id: "course",
                    title: "Toán 10",
                    description: "Môn Toán",
                    published: true,
                    academic_course_id: "subject",
                  },
                ]
              : p === "/api/catalog"
                ? [
                    {
                      id: "subject",
                      class_id: "class",
                      class_name: "10A1",
                      name: "Toán",
                      teacher: "Thầy A",
                      class_state: "active",
                    },
                  ]
                : p === "/api/academy/courses/course/classroom"
                  ? {
                      linked: true,
                      class_id: "class",
                      subject_id: "subject",
                      class_name: "10A1",
                      subject: "Toán",
                      state: "active",
                      can_live: true,
                      enrolled: false,
                    }
                  : [],
    });
  });
  await page.goto("/quan-tri/noi-dung");
  await page.getByLabel("Khóa học cần chỉnh sửa").selectOption("course");
  await page
    .getByLabel("Lớp & môn trực tuyến liên kết")
    .selectOption({ label: "10A1 · Toán · Thầy A" });
  await page.getByRole("button", { name: "Lưu khóa học", exact: true }).click();
  await expect.poll(() => saved?.academic_course_id).toBe("subject");
  await page.unroute("**/api/**");
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === "/api/academy/courses/course/enroll") {
      enrolled++;
      return r.fulfill({ json: { class_id: "class", subject_id: "subject" } });
    }
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "student", role: "student", name: "HS" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/academy/courses"
              ? [
                  {
                    id: "course",
                    title: "Toán 10",
                    academic_course_id: "subject",
                  },
                ]
              : p === "/api/academy/courses/course/classroom"
                ? {
                    linked: true,
                    class_id: "class",
                    subject_id: "subject",
                    class_name: "10A1",
                    subject: "Toán",
                    state: "active",
                    can_live: true,
                    enrolled: false,
                  }
                : p === "/api/academy/workspace"
                  ? { meetings: [], tasks: [], resume: [] }
                  : p === "/api/catalog"
                    ? [
                        {
                          id: "subject",
                          class_id: "class",
                          class_name: "10A1",
                          name: "Toán",
                          teacher: "Thầy A",
                        },
                      ]
                    : [],
    });
  });
  await page.goto("/hoc/khoa-hoc/course");
  await page
    .getByRole("button", { name: "Đăng ký & mở lớp Live", exact: true })
    .click();
  await expect(page).toHaveURL(/\/hoc\/mon\/subject\/buoi-hoc$/);
  expect(enrolled).toBe(1);
});
test("the linked classroom shows a return path to its published course", async ({
  page,
}) => {
  await page.route("**/api/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({
      json:
        p === "/api/me"
          ? { id: "teacher", role: "teacher", name: "GV" }
          : p === "/api/public-config"
            ? { platform_mode: "academy" }
            : p === "/api/academy/workspace"
              ? { meetings: [], tasks: [], resume: [] }
              : p === "/api/courses/subject/classroom"
                ? {
                    announcements: [],
                    teachers: [],
                    students: [],
                    student_count: 0,
                    can_manage: true,
                  }
                : p === "/api/catalog"
                  ? [
                      {
                        id: "subject",
                        class_id: "class",
                        class_name: "10A1",
                        name: "Toán",
                        teacher: "Thầy A",
                      },
                    ]
                  : p === "/api/academy/classrooms/subject/courses"
                    ? [{ id: "course", title: "Toán 10" }]
                    : [],
    });
  });
  await page.goto("/hoc/mon/subject/bang-tin");
  const link = page.locator(".classroom-course-links a");
  await expect(link).toHaveAttribute("href", "/hoc/khoa-hoc/course");
  await expect(link).toContainText("Bài giảng & bài tập");
});
