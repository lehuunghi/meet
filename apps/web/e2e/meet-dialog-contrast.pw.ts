import { test, expect, type Locator } from '@playwright/test';
function light(s:string){const v=s.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722}
async function readable(root:Locator){
 const rows=await root.locator('h2,h3,p,small,label,summary,strong,input,select,button').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(e.textContent?.trim()||e instanceof HTMLInputElement)}).map(e=>{
  let bg='rgb(255, 255, 255)',opacity=1;for(let x:Element|null=e;x;x=x.parentElement){const s=getComputedStyle(x);opacity*=Number(s.opacity);const c=s.backgroundColor;if(c!=='transparent'&&!c.endsWith(', 0)')){bg=c;break}}
  return {text:(e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,80),fg:getComputedStyle(e).color,bg,opacity};
 }));expect(rows.length).toBeGreaterThan(0);
 for(const r of rows){const a=light(r.fg),b=light(r.bg);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05),r.text).toBeGreaterThanOrEqual(4.5);expect(r.opacity,r.text+' opacity').toBe(1)}
}
for(const role of ['teacher','student'])for(const width of [1440,390])test(`Meet dialogs have readable text for ${role} at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const lesson={id:'lesson',title:'Kiểm tra thông tin phòng',short_code:'abc123',status:'live',recording_allowed:false,starts_at:new Date().toISOString()};
 await page.route('**/api/**',async r=>{const q=r.request(),p=new URL(q.url()).pathname;let d:any=[];
 if(p==='/api/me')d={id:role,name:'Người kiểm tra',school_id:'school',role};
 else if(p==='/api/setup/status')d={initialized:true};
 else if(p==='/api/meetings')d=[lesson];
 else if(p==='/api/meetings/lesson')d={...lesson,can_manage:role==='teacher',admission:'admitted'};
 else if(p.endsWith('/admission'))d={admission:'admitted'};
 else if(q.method()==='POST')d={ok:true};
 if(p.endsWith('/recording-control'))return r.fulfill({status:503,json:{error:'Không lưu được lựa chọn ghi hình'}});
 await r.fulfill({json:d});});
 await page.goto('/?room=lesson');
 await expect(page.locator('.room-brand')).toHaveText('Meet');
 await expect(page.locator('.prejoin h2')).toHaveCSS('font-size',width<700?'20px':'22px');
 const open=async(name:string)=>{await page.getByLabel('Thêm tùy chọn',{exact:true}).click();await page.getByRole('button',{name,exact:true}).click()};
 await open('Thông tin phòng học');let d=page.getByRole('dialog',{name:'Thông tin phòng học',exact:true});await readable(d);
 await expect(d.getByRole('textbox')).toHaveValue(/\/abc123$/);await expect(d.locator('h2')).toHaveCSS('font-size','18px');
 await page.screenshot({path:`outputs/v0313/info-${role}-${width}.png`});
 await page.getByLabel('Đóng hộp thoại',{exact:true}).click();
 await page.getByRole('button',{name:'Vào lớp học',exact:true}).click();
 await open('Thông tin phòng học');await readable(page.getByRole('dialog'));await page.getByLabel('Đóng hộp thoại',{exact:true}).click();
 await open('Cài đặt thiết bị');await readable(page.getByRole('dialog'));await page.getByLabel('Đóng hộp thoại',{exact:true}).click();
 if(role==='teacher'){
  await open('Phòng họp nhóm');await readable(page.getByRole('dialog'));await page.getByLabel('Đóng hộp thoại',{exact:true}).click();
  await page.getByRole('button',{name:'Rời lớp',exact:true}).click();await readable(page.getByRole('dialog'));await page.getByRole('button',{name:'Ở lại',exact:true}).click();
  await page.getByRole('button',{name:'Bắt đầu ghi hình',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Không lưu được lựa chọn ghi hình');await readable(page.locator('.room-notices'));
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`outputs/v0313/dialog-${role}-${width}.png`});
});
