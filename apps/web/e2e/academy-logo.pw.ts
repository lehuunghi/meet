import {test,expect} from '@playwright/test';
test('logo upload is separate from content and can be removed',async({page})=>{
 let logo={url:'',revision:''},writes=0,siteWrites=0;
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;
 if(path==='/api/academy/site/logo'){if(r.request().method()==='POST'){writes++;const data=r.request().postDataJSON();expect(data.revision).toBe(logo.revision);logo=data.delete?{url:'',revision:''}:{url:'/logo-test.png',revision:'logo-v1'};}return r.fulfill({json:logo})}
 if(path==='/api/academy/site'&&r.request().method()==='POST')siteWrites++;
 return r.fulfill({json:path==='/api/me'?{id:'admin',name:'VA',role:'admin'}:path==='/api/public-config'?{platform_mode:'academy'}:path==='/api/academy/site'?[{content:JSON.stringify({headline:'VA',published:true}),revision:'site-v1'}]:[]})
 });
 await page.goto('/quan-tri/website?muc=logo');
 const input=page.getByLabel('Chọn tệp logo',{exact:true});await expect(input).toBeEnabled();
 await input.setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2sAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'Lưu logo',exact:true}).click();await expect(page.getByRole('status')).toContainText('Đã cập nhật logo');expect(writes).toBe(1);expect(siteWrites).toBe(0);
 await page.getByRole('button',{name:'Xóa logo',exact:true}).click();await expect(page.getByRole('status')).toContainText('Đã xóa logo');expect(writes).toBe(2);expect(siteWrites).toBe(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
