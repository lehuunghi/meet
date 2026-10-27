import {test,expect} from '@playwright/test';
test('public profile editor keeps new content in draft and preserves publication on editing',async({page})=>{
 let saved:any=null;
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/academy/site'&&r.request().method()==='POST'){saved=r.request().postDataJSON();return r.fulfill({json:{ok:true,revision:'next'}})}
  return r.fulfill({json:path==='/api/me'?{id:'admin',role:'admin',name:'VA'}:path==='/api/public-config'?{platform_mode:'academy'}:path==='/api/academy/site'?[{content:JSON.stringify({headline:'VA',published:true,teachers:[],testimonials:[]}),revision:'initial'}]:[]});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/quan-tri/website');
 await page.getByText('Hồ sơ giáo viên',{exact:true}).click();
 await page.getByLabel('Hiện mục giáo viên tiêu biểu kể cả khi đang cập nhật').check();
 await page.getByRole('button',{name:'Thêm hồ sơ giáo viên',exact:true}).click();
 await expect(page.getByLabel('Công khai hồ sơ giáo viên này')).not.toBeChecked();
 await page.getByLabel('Họ tên',{exact:true}).fill('Giáo viên minh họa');
 await page.getByLabel('Công khai hồ sơ giáo viên này').check();
 await page.getByLabel('Môn phụ trách').fill('Toán');await expect(page.getByLabel('Công khai hồ sơ giáo viên này')).toBeChecked();
 await page.getByText('Cảm nhận học sinh & phụ huynh',{exact:true}).click();
 await page.getByLabel('Hiện mục cảm nhận kể cả khi đang cập nhật').check();
 await page.getByRole('button',{name:'Thêm cảm nhận',exact:true}).click();
 await expect(page.getByLabel('Công khai cảm nhận này — đã được người chia sẻ đồng ý')).not.toBeChecked();
 await page.getByLabel('Tên hiển thị',{exact:true}).fill('Tên nháp thử nghiệm');
 await page.getByLabel('Người chia sẻ').filter({visible:true}).and(page.locator('select')).selectOption('parent');
 await page.getByRole('button',{name:'Lưu website',exact:true}).click();
 await expect.poll(()=>!!saved).toBe(true);
 expect(saved.content.show_teachers).toBe(true);expect(saved.content.show_testimonials).toBe(true);
 expect(saved.content.teachers[0].Published).toBe(true);expect(saved.content.testimonials[0]).toMatchObject({Name:'Tên nháp thử nghiệm',Audience:'parent',Published:false,Rating:0});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

