import { test, expect } from "@playwright/test";
test.describe("Vietnam calendar timezone", () => {
  test.use({ timezoneId: "America/New_York" });
  test("schedule input remains UTC+7 on a device abroad", async ({ page }) => {
    let submitted: any;
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      let data: any = [];
      if (u.pathname === "/api/me")
        data = {
          id: "admin",
          role: "admin",
          name: "Quản trị",
          school_id: "school",
        };
      if (u.pathname === "/api/public-config")
        data = { managed: true, school_name: "Kiểm tra" };
      if (u.pathname === "/api/setup/status") data = { initialized: true };
      if (u.pathname === "/api/classes")
        data = [{ id: "class", short_id: "LH0001", name: "10A1" }];
      if (u.pathname === "/api/catalog")
        data = [
          {
            id: "course",
            class_id: "class",
            class_name: "10A1",
            name: "Toán",
            teacher_id: "teacher",
          },
        ];
      if (
        u.pathname === "/api/academic/operations" &&
        route.request().method() === "POST"
      ) {
        submitted = route.request().postDataJSON();
        data = { ok: true, id: "scheduled" };
      }
      await route.fulfill({ json: data });
    });
    await page.goto("/?page=admin");
    await page
      .getByRole("tab", { name: "Năm học & lịch dạy", exact: true })
      .click();
    const form = page
      .locator("fieldset")
      .filter({
        has: page.locator("legend", {
          hasText: "Lịch dạy và buổi cần kiểm tra",
        }),
      });
    await form
      .getByRole("combobox", { name: "Môn", exact: true })
      .selectOption("course");
    await form
      .getByLabel("Tên buổi", { exact: true })
      .fill("Lịch theo giờ Việt Nam");
    await form.getByLabel("Ngày bắt đầu", { exact: true }).fill("29/10/2026");
    await form.getByLabel("Ngày kết thúc", { exact: true }).fill("29/10/2026");
    await form.getByLabel("Giờ bắt đầu", { exact: true }).fill("08:30");
    await form.getByLabel("Giờ kết thúc", { exact: true }).fill("09:30");
    await form
      .getByRole("button", { name: "Lưu lịch dạy", exact: true })
      .click();
    await expect.poll(() => submitted?.Starts).toBe("2026-10-29T01:30:00.000Z");
    expect(submitted.Ends).toBe("2026-10-29T02:30:00.000Z");
  });
});
test("academic dates show the full Vietnamese day, month and year", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    let data: any = [];
    if (u.pathname === "/api/me")
      data = {
        id: "admin",
        role: "admin",
        name: "Quản trị",
        school_id: "school",
      };
    if (u.pathname === "/api/public-config")
      data = { managed: true, school_name: "Kiểm tra" };
    if (u.pathname === "/api/setup/status") data = { initialized: true };
    if (
      u.pathname === "/api/academic/operations" &&
      u.searchParams.get("kind") === "terms"
    )
      data = [
        {
          id: "term",
          name: "2026–2027",
          starts_on: "2026-09-01T00:00:00Z",
          ends_on: "2027-06-30T00:00:00Z",
          closed: 0,
          revision: 1,
        },
      ];
    if (
      u.pathname === "/api/academic/operations" &&
      u.searchParams.get("kind") === "sessions"
    )
      data = [
        {
          id: "session",
          title: "Buổi kiểm tra",
          subject: "Toán",
          class_name: "10A1",
          status: "scheduled",
          starts_at: "2026-10-29T01:30:00Z",
          ends_at: "2026-10-29T02:30:00Z",
        },
      ];
    await route.fulfill({ json: data });
  });
  await page.goto("/?page=admin");
  await page
    .getByRole("tab", { name: "Năm học & lịch dạy", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "01/09/2026 – 30/06/2027", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "29/10/2026 08:30 – 29/10/2026 09:30",
      exact: true,
    }),
  ).toBeVisible();
});
for (const width of [1440, 390])
  test(`academic operations are readable at ${width}`, async ({ page }) => {
    const writes: string[] = [];
    await page.route("**/api/**", async (route) => {
      if (route.request().method() !== "GET")
        writes.push(route.request().url());
      await route.fulfill({ json: [] });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?demo=1&role=admin&page=admin");
    await page
      .getByRole("tab", { name: "Năm học & lịch dạy", exact: true })
      .click();
    await expect(
      page.getByText("Tra cứu toàn bộ tài khoản", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Chuyển lớp", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Lưu lịch dạy", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(writes).toEqual([]);
  });
