// Run on each target OS after npm ci, npm run build and a local Chromium install.
import fs from "node:fs/promises";
import path from "node:path";
const out=path.resolve("release/meet-recorder-"+process.platform+"-"+process.arch);
await fs.mkdir(out,{recursive:true});
for(const entry of ["agent.mjs","protocol.mjs","package.json","package-lock.json","dist","node_modules","install-windows.ps1","install-linux.sh","updater.mjs","unpack-linux.py","unpack-windows.ps1","install-updater-linux.py"]){
 await fs.cp(entry,path.join(out,entry),{recursive:true,verbatimSymlinks:true});
}
await fs.mkdir(path.join(out,"runtime"),{recursive:true});
await fs.copyFile(process.execPath,path.join(out,"runtime",process.platform==="win32"?"node.exe":"node"));
if(process.platform!=="win32")await fs.chmod(path.join(out,"runtime/node"),0o755);
console.log(out);

if(process.platform==="win32"){const file=path.join(out,"install-windows.ps1");await fs.writeFile(file,"\ufeff"+(await fs.readFile(file,"utf8")).replace(/^\ufeff/,""),"utf8");}

// Reject build-machine paths before an installer is published.
async function verifyLinks(dir){
 for(const item of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name);
  if(item.isSymbolicLink()){
   const target=await fs.readlink(file),resolved=path.resolve(path.dirname(file),target);
   if(path.isAbsolute(target)||!resolved.startsWith(out+path.sep))throw Error("Non-portable package link: "+path.relative(out,file));
   const real=await fs.realpath(file);if(!real.startsWith(out+path.sep))throw Error("Package link escapes payload");
  }else if(item.isDirectory())await verifyLinks(file);
 }
}
await verifyLinks(out);
