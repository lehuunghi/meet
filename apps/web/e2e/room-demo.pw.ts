import { test, expect } from "@playwright/test";
test("demo shows host moderation and poll creation, and students can change a vote", async ({
  page,
}) => {
  let pollRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.url().includes("/polls")) pollRequests++;
  });
  await page.goto("/?demo=1&role=teacher&page=overview");
  await page
    .getByRole("button", { name: "Xem môn học", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Vào phòng dạy|Chuẩn bị dạy/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Người tham gia & trò chuyện", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cho vào", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cho vào", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cho vào", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Khảo sát", exact: true }).click();
  await page.getByText("Tạo khảo sát", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Câu hỏi", exact: true })
    .fill("Câu hỏi thử");
  await page
    .getByRole("textbox", {
      name: "Lựa chọn · mỗi dòng một lựa chọn",
      exact: true,
    })
    .fill("A\nB");
  await page.getByRole("button", { name: "Mở khảo sát", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Câu hỏi thử", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Đóng khảo sát", exact: true })
    .first()
    .click();
  await expect(page.locator(".room-poll").first()).toContainText("Đã đóng");
  await page.goto("/?demo=1&role=student&page=overview");
  await page
    .getByRole("button", { name: /^Vào lớp/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Người tham gia & trò chuyện", exact: true })
    .click();
  await expect(page.locator(".room-moderation")).toHaveCount(0);
  await page.getByRole("button", { name: "Khảo sát", exact: true }).click();
  await expect(page.getByText("Tạo khảo sát", { exact: true })).toHaveCount(0);
  const poll = page.locator(".room-poll");
  await poll.getByRole("button", { name: /^Đã hiểu/ }).click();
  await expect(poll.getByRole("button", { name: /^Đã hiểu/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await poll.getByRole("button", { name: /^Cần giảng lại/ }).click();
  await expect(
    poll.getByRole("button", { name: /^Cần giảng lại/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(poll).toContainText("6 phiếu");
  expect(pollRequests).toBe(0);
});
