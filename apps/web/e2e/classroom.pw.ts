import { test, expect } from "@playwright/test";
test("classroom cards, real lesson tabs and role actions work on desktop and mobile", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() === "POST")
      writes.push(r.url());
  });
  for (const role of ["teacher", "student"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/hoc?academy_demo=1&role=" + role);
    await expect(page.locator(".academy-shell")).toHaveClass(/classroom-shell/);
    if (role === "teacher") {
      await expect(page.locator(".classroom-card")).toHaveCount(2);
      await page
        .getByRole("button", { name: "Xem môn học", exact: true })
        .first()
        .click();
    }
    await expect(page.locator(".classroom-card").first()).toContainText(
      "Đang học",
    );
    if (role === "student")
      await expect(
        page.getByRole("button", { name: "Chuẩn bị dạy", exact: true }),
      ).toHaveCount(0);
    await page.screenshot({
      path: `../../outputs/classroom-${role}-desktop.png`,
      fullPage: true,
    });
    await page.locator(".classroom-card-cover h3 button").first().click();
    await expect(
      page.getByRole("tab", { name: "Bảng tin", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Hàm số và đồ thị");
    await page.getByRole("tab", { name: "Bài tập", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Bài tập & nhận xét", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Giao bài tập", { exact: true })).toHaveCount(
      role === "teacher" ? 1 : 0,
    );
    await page.getByRole("tab", { name: "Thông tin lớp", exact: true }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Nguyễn Minh Anh");
    await page
      .getByRole("tab", { name: "Thông tin lớp", exact: true })
      .press("Home");
    await expect(
      page.getByRole("tab", { name: "Bảng tin", exact: true }),
    ).toBeFocused();
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `../../outputs/classroom-${role}-${width}.png`,
        fullPage: true,
      });
    }
    await page
      .getByRole("tab", { name: "Buổi học & video", exact: true })
      .click();
    await expect(page.locator(".learning-detail table")).toBeVisible();
    await page
      .getByRole("button", { name: "← Danh sách lớp", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Tìm lớp hoặc môn học" })
      .fill("không tồn tại");
    await expect(
      page.getByRole("heading", { name: "Không tìm thấy lớp học" }),
    ).toBeVisible();
  }
  expect(writes).toEqual([]);
});
