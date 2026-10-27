import {test,expect} from '@playwright/test';
test('website is separate, previews unsaved content privately and protects structural edits',async({page})=>{
 let saves=0,previews=0;
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/academy/site/preview'){previews++;expect(r.request().postDataJSON().content.description).toBe('Nội dung chưa lưu');return r.fulfill({json:{html:'<!doctype html><h1>Bản nháp riêng</h1><p>Nội dung chưa lưu</p>'}})}
  if(path==='/api/academy/site'&&r.request().method()==='POST'){saves++;return r.fulfill({json:{revision:'saved'}})}
  return r.fulfill({json:path==='/api/me'?{id:'owner',role:'admin',name:'VA'}:path==='/api/public-config'?{platform_mode:'academy'}:path==='/api/academy/site'?[{content:JSON.stringify({headline:'VA',description:'Đã lưu',published:true,posts:[{Title:'Bài thật',Slug:'bai-that',Body:'Nội dung',Published:true}]}),revision:'original'}]:[]});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/quan-tri/website');
 await expect(page.getByRole('heading',{name:'Quản trị nội dung website',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Tạo & sửa khóa học',exact:true})).toHaveCount(0);
 await page.getByLabel('Thông điệp giới thiệu',{exact:true}).fill('Nội dung chưa lưu');
 await page.getByRole('button',{name:'Xem trước toàn website',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Xem trước website'});await expect(dialog).toBeVisible();
 await expect(page.frameLocator('iframe[title="Nội dung website đang chỉnh"]').getByRole('heading',{name:'Bản nháp riêng'})).toBeVisible();
 await expect(dialog.locator('iframe')).toHaveAttribute('sandbox','');
 await dialog.getByLabel('Thiết bị').selectOption('390px');
 expect(await dialog.locator('iframe').evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 await dialog.getByRole('button',{name:'Đóng bản xem trước'}).click();expect(previews).toBe(1);expect(saves).toBe(0);
 await page.getByRole('button',{name:'Danh mục',exact:true}).click();
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Quản lý nội dung',exact:true}).click();await expect(page).toHaveURL(/\/quan-tri\/website/);
 await page.getByRole('button',{name:'Lưu website',exact:true}).click();await expect.poll(()=>saves).toBe(1);
 await page.getByText('Bài viết & lịch khai giảng',{exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Xóa bài viết',exact:true}).click();
 await page.getByRole('button',{name:'Danh mục',exact:true}).click();page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Quản lý nội dung',exact:true}).click();await expect(page).toHaveURL(/\/quan-tri\/website/);expect(saves).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
