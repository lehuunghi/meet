import {test} from "node:test";
import assert from "node:assert/strict";
import {validateOrigin,allowedRPC,targetDrawing,partSize} from "./protocol.mjs";
import {createHash} from "node:crypto";
test("only HTTPS school origins without credentials or paths",()=>{
 assert.equal(validateOrigin("https://school.example"),"https://school.example");
 for(const s of ["http://school.example","https://user:pass@school.example","https://school.example/api","https://school.example/?token=a"]){assert.throws(()=>validateOrigin(s));}
});
test("recorder RPC cannot publish controls or enter another meeting",()=>{
 assert.equal(allowedRPC("lesson","/meetings/lesson/sfu"),"sfu");
 for(const p of ["/meetings/other/sfu","/meetings/lesson/controls","/accounts","https://evil.invalid"]){assert.equal(allowedRPC("lesson",p),undefined);}
 assert.equal(partSize,16*1024*1024);
});
test("drawing follows its publisher; stale screen ink is hidden",()=>{
 const hash=s=>createHash("sha256").update(s).digest("hex"),ink={active:true,mode:"screen",target:hash("s:screen-video")};
 assert.equal(targetDrawing(ink,[{session_id:"s",track_name:"screen-video",user_id:"teacher"}],hash).target_user,"teacher");
 assert.equal(targetDrawing(ink,[],hash).active,false);assert.equal(ink.active,true);
});

import {retrySchedule} from './protocol.mjs';
test('upload recovery backs off and stops automatically without deleting video',()=>{
 assert.equal(retrySchedule(1,0),60000);assert.ok(retrySchedule(7,0)<=3600000);assert.equal(retrySchedule(8,0),null);assert.equal(retrySchedule(-1,0),null);
});
