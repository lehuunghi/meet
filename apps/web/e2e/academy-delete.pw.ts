import {test,expect} from '@playwright/test';
test('permanent course delete requires exact title and keeps editor after dependency rejection',async({page})=>{
 let deleted=false,calls=0,blocked=true;
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/academy/courses/qa/delete'){
   calls++;expect(r.request().postDataJSON()).toEqual({confirm:'Toán – Lớp 10'});
   if(blocked)return r.fulfill({status:409,json:{error:'Khóa có bài giảng hoặc bài tập.'}});
   deleted=true;return r.fulfill({json:{ok:true}});
  }
  const data=path==='/api/me'?{id:'admin',role:'admin',name:'VA'}:path==='/api/public-config'?{platform_mode:'academy'}:path==='/api/academy/admin/courses'&&!deleted?[{id:'qa',title:'Toán – Lớp 10',description:'Toán lớp 10',published:1}]:[];
  return r.fulfill({json:data});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/quan-tri/noi-dung');
 await page.getByLabel('Khóa học cần chỉnh sửa').selectOption('qa');
 const area=page.getByRole('region',{name:'Xóa vĩnh viễn khóa học'}),button=area.getByRole('button',{name:'Xóa vĩnh viễn khóa học',exact:true});
 await expect(button).toBeDisabled();await area.getByRole('textbox').fill('Toán');await expect(button).toBeDisabled();expect(calls).toBe(0);
 await area.getByRole('textbox').fill('Toán – Lớp 10');page.once('dialog',d=>d.dismiss());await button.click();expect(calls).toBe(0);
 page.once('dialog',d=>d.accept());await button.click();await expect.poll(()=>calls).toBe(1);await expect(area).toBeVisible();
 await expect(button).toBeEnabled();blocked=false;page.once('dialog',d=>d.accept());await button.click();await expect.poll(()=>deleted).toBe(true);await expect(area).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
