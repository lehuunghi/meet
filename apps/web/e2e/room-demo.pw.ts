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
    .getByRole("button", { name: "Người tham gia", exact: true })
    .click();
  await page.getByRole("button",{name:"Điều hành",exact:true}).click();
  await expect(
    page.getByRole("button", { name: "Cho vào", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cho vào", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cho vào", exact: true }),
  ).toHaveCount(0);
  await page.locator(".room-tools").getByRole("button", { name: "Khảo sát", exact: true }).click();
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
    .getByRole("button", { name: "Người tham gia", exact: true })
    .click();
  await expect(page.locator(".room-moderation")).toHaveCount(0);
  await page.locator(".room-tools").getByRole("button", { name: "Khảo sát", exact: true }).click();
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


test("shared controls keep mobile actions usable and require explicit room-end confirmation", async ({page}) => {
  await page.goto('/?demo=1&role=teacher&page=overview');
  await page.getByRole('button',{name:'Xem môn học',exact:true}).first().click();
  await page.getByRole('button',{name:/Vào phòng dạy|Chuẩn bị dạy/}).first().click();
  await page.getByRole('button',{name:'Rời lớp',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Rời khỏi phòng học?'})).toBeVisible();
  await page.getByRole('button',{name:'Kết thúc cho tất cả',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Kết thúc cho tất cả mọi người?'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.room')).toBeVisible();
  await page.screenshot({path:'../../outputs/meet-controls-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Thêm tùy chọn',{exact:true}).click();
  await page.locator('.meeting-menu').getByRole('button',{name:'Giơ tay',exact:true}).click();
  await page.getByLabel('Thêm tùy chọn',{exact:true}).click();
  await expect(page.locator('.meeting-menu').getByRole('button',{name:'Hạ tay',exact:true})).toBeVisible();
  await page.locator('.meeting-menu').getByRole('button',{name:'Người tham gia',exact:true}).click();
  await expect(page.locator('.room-tools')).toBeVisible();
  await expect(page.getByText('· ✋ Đang giơ tay',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Đóng công cụ',exact:true}).click();
  await page.getByLabel('Thêm tùy chọn',{exact:true}).click();
  await page.locator('.meeting-menu').getByRole('button',{name:'Cài đặt thiết bị',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Cài đặt thiết bị'})).toBeVisible();
  await page.getByRole('button',{name:'Đóng hộp thoại'}).click();
  await expect(page.locator('.meeting-menu')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../../outputs/meet-controls-mobile.png',fullPage:true});
  await page.goto('/?demo=1&role=student&page=overview');
  await page.getByRole('button',{name:/^Vào lớp/}).first().click();
  await page.getByLabel('Thêm tùy chọn',{exact:true}).click();
  await expect(page.locator('.meeting-menu').getByRole('button',{name:'Điều hành phòng'})).toHaveCount(0);
  await expect(page.locator('.meeting-menu').getByRole('button',{name:'Kết thúc buổi học'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Rời lớp',exact:true}).click();
  await expect(page.locator('.room')).toHaveCount(0);
});
