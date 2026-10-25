import { test, expect } from "@playwright/test";
test("login hides school and asks for OTP only after password verification", async ({
  page,
}) => {
  const calls: any[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me")
      return route.fulfill({ status: 401, json: { error: "Sign in" } });
    if (path === "/api/login") {
      calls.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        json: { requires_2fa: true, challenge: "pending-test" },
      });
    }
    if (path === "/api/login/2fa") {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ status: 401, json: { error: "Mã chưa đúng" } });
    }
    return route.fulfill({
      json:
        path === "/api/public-config"
          ? { managed: true }
          : { initialized: true },
    });
  });
  await page.goto("/");
  await expect(page.locator('input[name="school"]')).toHaveCount(0);
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
  await page.locator('input[name="email"]').fill("SV0001");
  await page.locator('input[name="password"]').fill("password-12345");
  await page.getByRole("button", { name: "Đăng nhập →", exact: true }).click();
  await expect(page.locator('input[name="code"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await page.locator('input[name="code"]').fill("123456");
  await page.getByRole("button", { name: "Xác thực →", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Mã chưa đúng");
  expect(calls).toEqual([
    { email: "SV0001", password: "password-12345" },
    { challenge: "pending-test", code: "123456" },
  ]);
});
