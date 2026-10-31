import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import ffmpeg from "ffmpeg-static";
import {validateOrigin,partSize,allowedRPC,targetDrawing} from "./protocol.mjs";
process.env.PLAYWRIGHT_BROWSERS_PATH??="0";
const {chromium}=await import("playwright");
const run=promisify(execFile),root=path.resolve(process.env.MEET_AGENT_DATA||(process.argv.includes("--data")?process.argv[process.argv.indexOf("--data")+1]:"./data")),configFile=path.join(root,"identity.json");
await fs.mkdir(root,{recursive:true,mode:0o700});
if(process.argv.includes("--self-test")){
 await run(ffmpeg,["-version"],{timeout:10000});
 await Promise.all([0,1].map(async slot=>{
  const browser=await chromium.launch({headless:true,chromiumSandbox:true,args:["--autoplay-policy=no-user-gesture-required"]});
  try{
   const page=await browser.newPage();let bytes=0;
   await page.exposeFunction("recorderChunk",encoded=>{bytes+=Buffer.from(encoded,"base64").length});
   await page.exposeFunction("recorderRPC",()=>({ok:true}));
   await page.exposeFunction("recorderSegment",()=>{});await page.exposeFunction("recorderOpen",()=>{});
   await page.goto("about:blank");await page.addScriptTag({content:await fs.readFile(new URL("./dist/browser.js",import.meta.url),"utf8")});
   await page.evaluate(()=>window.capture.start("self-test"));await new Promise(r=>setTimeout(r,1000));await page.evaluate(()=>window.capture.stop());
   if(bytes<100)throw Error("CAPTURE_SELF_TEST_FAILED");console.log("SELF_TEST_OK",slot,bytes);
  }finally{await browser.close()}
 }));
 process.exit(0);
}
let cfg;
async function request(route,body={},job){
 const res=await fetch(cfg.origin+"/api/recorder-agent/"+route,{method:"POST",redirect:"error",headers:{Origin:cfg.origin,"Content-Type":"application/json",...(cfg.token?{Authorization:"Bearer "+cfg.token}:{}),...(job?{"X-Recording-Lease":job.lease}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||"RECORDER_API_ERROR"),{status:res.status});return data;
}
if(process.argv.includes("--enroll")){
 const origin=validateOrigin(process.env.MEET_ORIGIN||"");
 // Installer passes the one-time code through stdin, not command-line arguments.
 let code="";for await(const part of process.stdin)code+=part;
 cfg={origin};const identity=await request("enroll",{Code:code.trim(),Platform:process.platform,Version:"2"});
 await fs.writeFile(configFile,JSON.stringify({origin,...identity}),{mode:0o600,flag:"wx"});console.log("Máy ghi đã đăng ký.");process.exit(0);
}
cfg=JSON.parse(await fs.readFile(configFile,"utf8"));cfg.origin=validateOrigin(cfg.origin);
const bundle=await fs.readFile(new URL("./dist/browser.js",import.meta.url),"utf8"),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let stopping=false;
process.on("SIGINT",()=>stopping=true);process.on("SIGTERM",()=>stopping=true);
const jobCall=(job,action,body={})=>request(`jobs/${job.id}/${action}`,body,job);
const hash=s=>createHash("sha256").update(s).digest("hex");
async function atomic(file,value){const temp=file+".tmp";await fs.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.rename(temp,file);}
async function finalize(file){
 const meta=JSON.parse(await fs.readFile(file,"utf8")),base=file.slice(0,-5);
 try{await fs.access(base+".webm");}catch{
  const raw=await fs.stat(base+".partial");if(!raw.size){await jobCall(meta.job,"abort",{Recording:meta.recording});await fs.rm(base+".partial");await fs.rm(file);return;}
  await run(ffmpeg,["-nostdin","-v","error","-y","-i",base+".partial","-c","copy",base+".remux.webm"],{timeout:120000});
  await fs.rename(base+".remux.webm",base+".webm");
 }
 const stat=await fs.stat(base+".webm");
 if(stat.size>8*1024**3)throw Error("RECORDING_TOO_LARGE");
 if(!meta.recording){const start=await jobCall(meta.job,"start");meta.recording=start.id;await atomic(file,meta);}
 const handle=await fs.open(base+".webm","r");
 try{
  const parts=Math.ceil(stat.size/partSize);
  for(let part=1;part<=parts;part++){
   const data=Buffer.alloc(Math.min(partSize,stat.size-(part-1)*partSize));
   const {bytesRead}=await handle.read(data,0,data.length,(part-1)*partSize);if(bytesRead!==data.length)throw Error("SPOOL_READ_INCOMPLETE");
   const signed=await jobCall(meta.job,"part",{Recording:meta.recording,Part:part,Size:data.length});
   const u=new URL(signed.url);if(u.protocol!=="https:"||!u.hostname.endsWith(".r2.cloudflarestorage.com"))throw Error("UNTRUSTED_UPLOAD_URL");
   const res=await fetch(u,{method:"PUT",body:data,redirect:"error",signal:AbortSignal.timeout(300000)});if(!res.ok)throw Error("R2_UPLOAD_RETRY");
  }
  await jobCall(meta.job,"finish",{Recording:meta.recording,Parts:parts});
 }finally{await handle.close();}
 for(const ext of [".partial",".webm",".remux.webm",".json"])await fs.rm(base+ext,{force:true});
}
const writing=new Set();
async function recover(){
 for(const name of await fs.readdir(root)){
  if(stopping)break;
  if(!/^[a-f0-9]{32}-\d+\.json$/.test(name)||writing.has(name))continue;
  const f=path.join(root,name);
  try{await finalize(f)}catch(e){console.error("Bản ghi chờ tải lại",name,e.status||"LOCAL_OR_NETWORK_ERROR")}
 }
}
async function record(job){
 let browser,page,handle,currentFile="",sequence=0,lost=false,lastLease=Date.now(),ticking=false,currentState;
 const heartbeat=setInterval(async()=>{
  if(ticking)return;ticking=true;
  try{currentState=await jobCall(job,"tick",{State:"recording"});lastLease=Date.now();if(currentState.stop)lost=true;}
  catch(e){if([401,403,409].includes(e.status))lost=true;}
  finally{ticking=false;if(Date.now()-lastLease>45000)lost=true;}
 },5000);
 async function open(){
  const disk=await fs.statfs(root);if(Number(disk.bavail)*Number(disk.bsize)<1024**3)throw Error("SPOOL_DISK_LOW");
  const recording=await jobCall(job,"start");
  currentFile=path.join(root,job.id+"-"+(sequence++)+".json");writing.add(path.basename(currentFile));
  await atomic(currentFile,{job,recording:recording.id,created:Date.now()});
  handle=await fs.open(currentFile.slice(0,-5)+".partial","wx",0o600);
 }
 async function seal(){await handle?.sync();await handle?.close();handle=undefined;writing.delete(path.basename(currentFile));currentFile="";}
 try{
  currentState=await jobCall(job,"tick",{State:"starting"});if(currentState.stop)return;
  await open();
  browser=await chromium.launch({headless:true,chromiumSandbox:true,args:["--autoplay-policy=no-user-gesture-required"]});
  const context=await browser.newContext({permissions:[]});page=await context.newPage();
  await page.route("**/*",route=>route.request().url()==="http://localhost/recorder"?route.fulfill({contentType:"text/html",body:"<!doctype html><title>Meet Recorder</title><style>video{display:none}</style>"}):route.abort());
  await page.exposeFunction("recorderRPC",async(route,body)=>{
   if(lost||stopping||Date.now()-lastLease>45000)throw Error("RECORDING_LEASE_LOST");
   const action=allowedRPC(job.meeting,route);if(!action)throw Error("RPC_NOT_ALLOWED");
   if(action==="ice")return {iceServers:[]};
   if(action==="tracks")return currentState?.list||[];
   return jobCall(job,action,body||{});
  });
  await page.exposeFunction("recorderChunk",async encoded=>{
   if(lost)throw Error("RECORDING_LEASE_LOST");
   const data=Buffer.from(encoded,"base64");if(data.length>16*1024**2)throw Error("CHUNK_TOO_LARGE");
   await handle.write(data);await handle.sync();
  });
  await page.exposeFunction("recorderSegment",seal);await page.exposeFunction("recorderOpen",open);
  await page.goto("http://localhost/recorder");await page.addScriptTag({content:bundle});await page.evaluate(id=>window.capture.start(id),job.meeting);
  let rotated=Date.now();
  while(!stopping&&!lost){
   if(currentState?.stop)break;
   const list=currentState?.list||[],ink=targetDrawing(currentState?.drawing,list,hash);
   await page.evaluate(({list,ink})=>window.capture.tick(list,ink),{list,ink});
   if(Date.now()-rotated>=300000){await page.evaluate(()=>window.capture.rotate());rotated=Date.now();}
   await sleep(1000);
  }
 }finally{
  // Flush while the lease is still ours, then release; late ownership loss never writes more media.
  try{await page?.evaluate(()=>window.capture?.stop())}catch{}
  await handle?.close().catch(()=>{});writing.delete(path.basename(currentFile));
  await browser?.close().catch(()=>{});clearInterval(heartbeat);
  await jobCall(job,"release").catch(()=>{});
 }
}
console.log("Meet Recorder đang chờ lớp học",os.platform());
let recovering=false;
let previousCPU=os.cpus().reduce((v,c)=>({idle:v.idle+c.times.idle,total:v.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
function capacity(){const cpu=os.cpus().reduce((v,c)=>({idle:v.idle+c.times.idle,total:v.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});const total=cpu.total-previousCPU.total,busy=total>0?1-(cpu.idle-previousCPU.idle)/total:0;previousCPU=cpu;return os.freemem()>=2*1024**3&&busy<0.75;}

const recoveryTimer=setInterval(()=>{if(!recovering&&!stopping){recovering=true;void recover().catch(()=>{}).finally(()=>recovering=false)}},15000);
const active=new Map();let slots=1;
while(!stopping){
 try{
  const disk=await fs.statfs(root),available=capacity()&&Number(disk.bavail)*Number(disk.bsize)>=5*1024**3;
  // Heartbeat even when every slot is busy, so the hub can change the limit.
  const probe=await request("claim",{Available:false,Protocol:2});
  slots=Number.isInteger(probe.capacity)?Math.max(1,Math.min(32,probe.capacity)):1;
  if(available){
   const slot=Array.from({length:slots},(_,i)=>i).find(i=>!active.has(i));
   if(slot!==undefined){
    const {job}=await request("claim",{Available:true,Protocol:2,Slot:slot});
    if(job){const task=record(job).catch(e=>console.error("Lớp ghi cần thử lại",e.status||"LOCAL_OR_NETWORK_ERROR")).finally(()=>active.delete(slot));active.set(slot,task)}
   }
  }
 }catch(e){console.error("Máy ghi đang thử kết nối lại",e.status||"LOCAL_OR_NETWORK_ERROR")}
 await sleep(5000);
}
await Promise.allSettled(active.values());
clearInterval(recoveryTimer);while(recovering)await sleep(250);
