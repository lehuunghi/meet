// Privileged updater: installed separately from the low-privilege recording task.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),home=path.dirname(fileURLToPath(import.meta.url));
const win=process.platform==='win32',parent=win?path.join(process.env.ProgramData,'MeetRecorder'):'/opt';
const app=win?path.join(parent,'app'):path.join(parent,'meet-recorder-agent');
const data=win?path.join(parent,'data'):'/var/lib/meet-recorder-agent';
const expectedHome=win?path.join(parent,'updater'):'/opt/meet-recorder-updater';
export function validTarget(plan,current,platform){
 const semver=v=>/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v||'')?v.split('.').map(Number):null;
 const a=semver(plan?.version),b=semver(current);
 if(!a||!b||!/^([a-f0-9]{32})$/.test(plan.id||'')||!/^([a-f0-9]{64})$/.test(plan.sha256||'')||plan.protocol!==1)return false;
 if(!a.some((v,i)=>v>b[i]&&a.slice(0,i).every((x,j)=>x===b[j])))return false;
 let u;try{u=new URL(plan.url)}catch{return false};if(u.protocol!=='https:'||u.username||u.password)return false;
 if(u.hostname==='github.com'&&!u.pathname.startsWith('/lehuunghi/meet/releases/download/recorder-agent-v'+plan.version+'/'))return false;
 if(!['github.com','release-assets.githubusercontent.com'].includes(u.hostname))return false;
 return platform==='linux'?plan.asset==='meet-recorder-linux-x64.tar.gz':platform==='win32'&&plan.asset==='meet-recorder-win32-x64.zip';
}
function inside(candidate){const resolved=path.resolve(candidate),root=path.resolve(parent)+path.sep;if(!resolved.startsWith(root)||!/^\.(meet-update|meet-before)-[a-f0-9]{32}$/.test(path.basename(resolved)))throw Error('UNSAFE_UPDATE_PATH');return resolved}
async function readJSON(file,max=32768){if((await fs.stat(file)).size>max)throw Error('UPDATER_METADATA_TOO_LARGE');return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''))}
async function main(){
 if(path.resolve(home)!==path.resolve(expectedHome))throw Error('UPDATER_INSTALL_PATH_INVALID');
 const cfg=await readJSON(path.join(home,'trusted.json'));
 const origin=new URL(cfg.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!/^([a-f0-9]{64})$/.test(cfg.token||''))throw Error('INVALID_PINNED_CONTROL');
 const api=async(route,body)=>{const response=await fetch(origin.origin+'/api/recorder-agent/'+route,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('UPDATE_CONTROL_REJECTED');return response.json()};
 const pending=await api('update-plan',{});if(!pending.plan)return;
 const plan=pending.plan,current=await readJSON(path.join(app,'package.json'));
 if(!validTarget(plan,current.version===plan.version?'0.0.0':current.version,process.platform))throw Error('UPDATE_MANIFEST_REJECTED');
 const state=await readJSON(path.join(data,'agent-state.json'));
 if(Date.now()-state.seen>20000||state.active_jobs||state.upload_queue||state.uploading)return;
 if(current.version===plan.version&&state.agent_version===plan.version){await api('update-result',{id:plan.id,ok:true});return}
 const stage=inside(path.join(parent,'.meet-update-'+plan.id)),backup=inside(path.join(parent,'.meet-before-'+plan.id));
 try{await fs.mkdir(stage,{mode:0o700})}catch{await api('update-result',{id:plan.id,ok:false}).catch(()=>{});return}
 let switched=false,stopped=false,completed=false;
 const service=async(start)=>{
  if(win){await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',(start?'Start':'Stop')+'-ScheduledTask -TaskName MeetRecorder'],{timeout:30000})}
  else await run('/usr/bin/systemctl',[start?'start':'stop','meet-recorder-agent'],{timeout:120000});
 };
 try{
  const archive=path.join(stage,plan.asset);let url=plan.url,response;
  for(let count=0;count<6;count++){
   const u=new URL(url);if(u.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com'].includes(u.hostname)||u.username||u.password)throw Error('UPDATE_DOWNLOAD_REJECTED');
   response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(300000)});
   if(response.status===302||response.status===301){url=new URL(response.headers.get('location'),u).href;await response.body?.cancel();continue}
   break;
  }
  if(!response?.ok)throw Error('UPDATE_DOWNLOAD_FAILED');
  const file=await fs.open(archive,'wx',0o600),digest=createHash('sha256');let bytes=0;
  try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>1024**3)throw Error('UPDATE_TOO_LARGE');digest.update(chunk);await file.write(chunk)}await file.sync()}finally{await file.close()}
  if(digest.digest('hex')!==plan.sha256)throw Error('UPDATE_CHECKSUM_FAILED');
  if(win)await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(home,'unpack-windows.ps1')],{env:{...process.env,MEET_UPDATE_ARCHIVE:archive,MEET_UPDATE_STAGE:stage},timeout:180000});
  else await run('/usr/bin/python3',[path.join(home,'unpack-linux.py'),archive,stage],{timeout:180000});
  const payload=path.join(stage,win?'meet-recorder-win32-x64':'meet-recorder-linux-x64');
  if((await readJSON(path.join(payload,'package.json'))).version!==plan.version)throw Error('UPDATE_VERSION_MISMATCH');
  const latest=await readJSON(path.join(data,'agent-state.json'));if(Date.now()-latest.seen>20000||latest.active_jobs||latest.upload_queue||latest.uploading)throw Error('RECORDER_NOT_DRAINED');
  await service(false);stopped=true;
  await fs.rename(app,backup);try{await fs.rename(payload,app);switched=true}catch(error){await fs.rename(backup,app);throw error}
  // Restore the root-pinned enrollment identity before reinstalling the task.
  await fs.writeFile(path.join(data,'identity.json'),JSON.stringify({origin:cfg.origin,id:cfg.id,token:cfg.token}),{mode:0o600});
  if(win)await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(app,'install-windows.ps1')],{env:{...process.env,MEET_SETUP_ORIGIN:cfg.origin},timeout:180000});
  else await run('/bin/bash',[path.join(app,'install-linux.sh')],{env:{...process.env,MEET_ORIGIN:cfg.origin,DEBIAN_FRONTEND:'noninteractive'},timeout:600000});
  const deadline=Date.now()+30000;let good=false;
  while(Date.now()<deadline){try{const status=await readJSON(path.join(data,'agent-state.json'));if(status.agent_version===plan.version&&Date.now()-status.seen<15000){good=true;break}}catch{}await new Promise(r=>setTimeout(r,1000))}
  if(!good)throw Error('UPDATED_AGENT_HEARTBEAT_MISSING');
  completed=true;await api('update-result',{id:plan.id,ok:true}).catch(()=>{});
  console.log('RECORDER_UPDATE_OK',plan.version);
 }catch(error){
  if(switched){
   await service(false).catch(()=>{});
   // Keep failed files for diagnosis, move only validated directories inside the install root.
   await fs.rename(app,path.join(stage,'failed-app'));await fs.rename(backup,app);
   if(win)await run(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',path.join(app,'install-windows.ps1')],{env:{...process.env,MEET_SETUP_ORIGIN:cfg.origin},timeout:180000});
   else await run('/bin/bash',[path.join(app,'install-linux.sh')],{env:{...process.env,MEET_ORIGIN:cfg.origin,DEBIAN_FRONTEND:'noninteractive'},timeout:600000});
  }else if(stopped)await service(true).catch(()=>{});
  await api('update-result',{id:plan.id,ok:false}).catch(()=>{});
  throw Error('RECORDER_UPDATE_FAILED_PRESERVED_DATA');
 }finally{
  // Retain the previous application for rollback; only remove this operation's private staging tree.
  if(completed||!switched)await fs.rm(inside(stage),{recursive:true,force:true}).catch(()=>{});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('RECORDER_UPDATER_NEEDS_REVIEW');process.exitCode=1});
