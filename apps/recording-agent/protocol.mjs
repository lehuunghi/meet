export function validateOrigin(value) {
 const u=new URL(value);
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.pathname!=="/")throw Error("Địa chỉ phải là HTTPS của website trường, không có đường dẫn hay mật khẩu.");
 return u.origin;
}
export const partSize=16*1024*1024;
export function allowedRPC(meeting,path){
 const base=`/meetings/${meeting}`;
 return new Map([[base+"/sfu","sfu"],[base+"/media/provider","provider"],[base+"/media/reset","reset"],[base+"/media/failover","failover"],[base+"/media/usage","usage"],[base+"/tracks","tracks"],[base+"/ice","ice"]]).get(path);
}
export function targetDrawing(drawing,list,hash){
 if(!drawing)return null;
 const ink=structuredClone(drawing);
 if(ink.mode==="screen"){
  const p=list.find(p=>hash(p.session_id+":"+p.track_name)===ink.target);
  if(p)ink.target_user=p.user_id;else ink.active=false;
 }
 return ink;
}
