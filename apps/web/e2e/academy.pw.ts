import { test, expect } from "@playwright/test";
test("academy demos are role-specific, mobile-friendly and never make real payment requests", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() === "POST")
      writes.push(r.url());
  });
  for (const role of ["student", "teacher", "admin"])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/hoc?academy_demo=1&role=${role}`);
      await expect(
        page.getByRole("heading", {
          name: "Học từng bước. Tiến bộ mỗi ngày.",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (role === "student") {
        await expect(
          page.getByRole("button", { name: "Quản lý nội dung", exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Gói học & thanh toán", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Chọn gói", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText("mô phỏng");
      }
      if (role === "admin") {
        await page
          .getByRole("button", { name: "Duyệt thanh toán", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Kích hoạt VIP", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText("mô phỏng");
        await expect(
          page.getByRole("cell", { name: "paid", exact: true }),
        ).toBeVisible();
      }
      await page.screenshot({
        path: `../../outputs/academy-${role}-${width}.png`,
        fullPage: true,
      });
    }
  expect(writes).toEqual([]);
});
