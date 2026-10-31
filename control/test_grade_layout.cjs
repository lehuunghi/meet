// Render the actual Go template, then measure the real public stylesheet in Chrome.
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const {chromium}=require('../apps/web/node_modules/@playwright/test');
(async()=>{const repo=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'meet-grade-layout-'));let server,browser;
 try{
  const result=spawnSync(process.env.MEET_TEST_GO||'go',['test','-count=1','-run','^TestAcademyGradeRows$'],{cwd:path.join(repo,'apps/api'),env:{...process.env,MEET_WEBSITE_PREVIEW_DIR:tmp},encoding:'utf8',timeout:180000});if(result.status!==0)throw Error('Go template fixture failed: '+(result.stderr||result.error||result.stdout));
  const html=fs.readFileSync(path.join(tmp,'academy-grade-rows.html')),css=fs.readFileSync(path.join(repo,'apps/web/public/academy-site.css'));
  server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/academy-site.css'?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/academy-site.css'?css:html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{});const p=await browser.newPage();
  for(const width of [1440,390,360]){
   await p.setViewportSize({width,height:960});await p.goto('http://127.0.0.1:'+server.address().port);assert.equal(await p.locator('.grade-course-group').count(),3);
   for(const row of await p.locator('.grade-course-row').all()){
    assert.deepEqual(await row.locator('h4').allTextContents(),['Toán','Vật lí','Hóa học','Ngữ văn','Tiếng Anh']);
    const geometry=await row.evaluate(el=>{const r=el.getBoundingClientRect(),cards=Array.from(el.querySelectorAll('.course-card')).map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,width:b.width}});return {left:r.left,right:r.right,width:r.width,client:el.clientWidth,scroll:el.scrollWidth,cards}});
    assert.ok(geometry.right<=width && geometry.left>=0);
    if(width===1440){assert.ok(geometry.scroll<=geometry.client+1);assert.ok(geometry.cards.every(c=>Math.abs(c.top-geometry.cards[0].top)<1));assert.ok(geometry.cards[4].right<=geometry.right+1)}
    else{
     assert.ok(geometry.scroll>geometry.client);assert.ok(geometry.cards[1].right<=geometry.right);const third=(geometry.right-geometry.cards[2].left)/geometry.cards[2].width;assert.ok(third>.46&&third<.54,'Expected half of the third card, got '+third);
     await row.hover();await p.mouse.wheel(300,0);await p.waitForFunction(el=>el.scrollLeft>10,await row.elementHandle());
     await p.waitForTimeout(250);await row.evaluate(el=>el.scrollTo({left:el.scrollWidth,behavior:'instant'}));await p.waitForTimeout(300);const last=await row.locator('.course-card').last().boundingBox();assert.ok(last.x+last.width<=geometry.right+1,JSON.stringify({width,last,right:geometry.right,scroll:await row.evaluate(el=>({left:el.scrollLeft,width:el.scrollWidth,client:el.clientWidth}))}));
    }
   }
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.MEET_GRADE_LAYOUT_SCREENSHOTS){const directory=path.resolve(process.env.MEET_GRADE_LAYOUT_SCREENSHOTS);fs.mkdirSync(directory,{recursive:true});await p.locator('.grade-course-row').evaluateAll(rows=>rows.forEach(el=>el.scrollTo({left:0,behavior:'instant'})));await p.waitForTimeout(200);await p.locator('.grade-course-group').first().screenshot({path:path.join(directory,'grade-row-'+width+'.png')})}
  }
  console.log('SSR course rows: three grades, fixed subject order, five desktop cards, 2.5 mobile cards, native horizontal scroll at 390/360 passed');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e.message);process.exitCode=1});
