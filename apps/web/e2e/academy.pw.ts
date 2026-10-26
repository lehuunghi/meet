import { test, expect } from "@playwright/test";
test('managed academy administrators stay on the website and edit business settings locally', async ({page})=>{
 let posted:any=null;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data:any=[];
  if(path==='/api/public-config')data={managed:true,platform_mode:'academy',management_url:'https://admin.example.test/#academy/'+'1'.repeat(32)};
  if(path==='/api/me')data={id:'local-admin',name:'Quản trị VA',role:'admin',school_id:'va'};
  if(path==='/api/academy/me')data=[{name:'Quản trị VA'}];
  if(path==='/api/academy/settings'){
   if(route.request().method()==='POST'){posted=route.request().postDataJSON();data={ok:true,revision:1};}
   else data={settings:{free_videos:4},revision:0,secrets:{smtp_password:true}};
  }
  await route.fulfill({json:data});
 });
 await page.goto('/hoc');
 await expect(page.getByRole('button',{name:'Quản lý nội dung',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Mở bảng quản trị nền tảng'})).toHaveCount(0);
 await page.getByRole('button',{name:'Email & thanh toán',exact:true}).click();
 await page.locator('[name=bank_name]').fill('Người nhận VA');
 await page.getByRole('button',{name:'Lưu cài đặt',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Đã lưu và áp dụng');
 expect(posted.settings.bank_name).toBe('Người nhận VA');expect(posted.revision).toBe(0);expect(posted.settings.r2).toBeUndefined();
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
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
          name: role === 'admin' ? 'Tổng quan khóa học' : role === 'teacher' ? 'Không gian giảng dạy' : "Học từng bước. Tiến bộ mỗi ngày.",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 390 && role !== "teacher") await page.getByRole("button",{name:"Danh mục",exact:true}).click();
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
