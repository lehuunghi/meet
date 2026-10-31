import { test, expect } from '@playwright/test';
for (const [width,height] of [[1440,900],[1366,650],[390,844],[360,640],[844,390]]) {
 test(`call fits ${width}x${height} with board and panels`, async ({page})=>{
  await page.setViewportSize({width,height});
  await page.goto('/hoc/buoi-hoc/preview?academy_demo=1&role=teacher');
  const fits=async()=>{
   await expect(page.locator('.room')).toBeVisible();
   const metrics=await page.locator('.room').evaluate(e=>{const r=e.getBoundingClientRect(),s=e.querySelector('.preview-classroom')!.getBoundingClientRect(),t=e.querySelector('.room-toolbar')!.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,stageBottom:s.bottom,toolbarTop:t.top,pageHeight:document.documentElement.scrollHeight}});
   expect(metrics.top).toBe(0);expect(metrics.bottom).toBeLessThanOrEqual(height+1);expect(metrics.stageBottom).toBeLessThanOrEqual(metrics.toolbarTop+1);expect(metrics.pageHeight).toBeLessThanOrEqual(height+1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  };
  await fits();
  if(!await page.getByRole('button',{name:'Bảng trắng',exact:true}).isVisible())await page.getByLabel('Thêm tùy chọn',{exact:true}).click();
  await page.getByRole('button',{name:'Bảng trắng',exact:true}).click();
  const c=page.getByLabel('Bảng trắng dùng chung',{exact:true});await expect(c).toBeVisible();
  await fits();const b=(await c.boundingBox())!;expect(b.height).toBeGreaterThan(40);expect(b.y+b.height).toBeLessThanOrEqual(height-70);
  await page.getByLabel('Thêm tùy chọn',{exact:true}).click();await page.getByRole('button',{name:'Phòng họp nhóm',exact:true}).click();
  const d=page.getByRole('dialog',{name:'Phòng họp nhóm',exact:true});await expect(d).toBeVisible();const r=(await d.boundingBox())!;expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual(height+1);
 });
}
