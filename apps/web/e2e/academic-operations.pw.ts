import { test, expect } from "@playwright/test";
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
