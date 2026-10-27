import {test,expect} from '@playwright/test';
test('CMS menu has stable section URLs and preserves unsaved content between sections',async({page})=>{
 let content:any={headline:'VA',description:'Đã lưu',published:true,terms:'Giữ chính sách',teachers:[],testimonials:[],posts:[]},saves=0,dialogs=0;
 page.on('dialog',d=>{dialogs++;void d.dismiss()});
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;
  if(path==='/api/academy/site'&&r.request().method()==='POST'){saves++;content=r.request().postDataJSON().content;return r.fulfill({json:{revision:'new'}})}
  return r.fulfill({json:path==='/api/me'?{id:'admin',name:'VA',role:'admin'}:path==='/api/public-config'?{platform_mode:'academy'}:path==='/api/academy/site'?[{content:JSON.stringify(content),revision:'old'}]:[]})
 });
 await page.setViewportSize({width:1440,height:1000});await page.goto('/quan-tri/website');
 const nav=page.getByRole('navigation',{name:'Chuyên mục quản trị website'});
 await expect(nav.getByRole('link')).toHaveCount(10);await expect(page.getByLabel('Thông điệp giới thiệu',{exact:true})).not.toBeVisible();
 await nav.getByRole('link',{name:'Trang chủ & giới thiệu',exact:true}).click();await expect(page).toHaveURL(/muc=trang-chu/);
 await page.getByLabel('Thông điệp giới thiệu',{exact:true}).fill('Nháp giữ qua các mục');
 await nav.getByRole('link',{name:'Giáo viên',exact:true}).click();await expect(page.getByRole('button',{name:'Thêm hồ sơ giáo viên',exact:true})).toBeVisible();
 await expect(page.getByLabel('Thông điệp giới thiệu',{exact:true})).not.toBeVisible();await page.getByRole('button',{name:'Thêm hồ sơ giáo viên',exact:true}).click();
 await page.getByLabel('Họ tên',{exact:true}).fill('Tên thử riêng');
 await nav.getByRole('link',{name:'Bài viết',exact:true}).click();await page.getByRole('button',{name:'Thêm bài viết',exact:true}).click();
 expect(saves).toBe(0);expect(dialogs).toBe(0);
 await page.setViewportSize({width:390,height:844});const mobile=page.getByLabel('Chuyên mục quản trị',{exact:false}).and(page.locator('select'));await mobile.selectOption('trang-chu');
 await expect(page.getByLabel('Thông điệp giới thiệu',{exact:true})).toHaveValue('Nháp giữ qua các mục');
 await page.getByRole('button',{name:'Lưu website',exact:true}).click();await expect.poll(()=>saves).toBe(1);expect(content.terms).toBe('Giữ chính sách');expect(content.teachers[0].Name).toBe('Tên thử riêng');expect(content.teachers[0].Published).toBe(false);expect(content.posts).toHaveLength(1);
 await mobile.selectOption('giao-vien');await page.reload();await expect(page).toHaveURL(/muc=giao-vien/);await expect(page.getByLabel('Họ tên',{exact:true})).toHaveValue('Tên thử riêng');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(dialogs).toBe(0);
});
