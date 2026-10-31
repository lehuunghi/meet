import {useEffect,useRef,useState} from "react";
import {api} from "./api";
import {markFormClean} from "./form-guard-core";

export function WebsiteLogo({demo=false}:{demo?:boolean}){
 const [current,setCurrent]=useState({url:"",revision:""}),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(demo),[error,setError]=useState(""),[message,setMessage]=useState("");const form=useRef<HTMLFormElement>(null);
 async function load(){setError("");try{if(!demo)setCurrent(await api("/academy/site/logo"));setLoaded(true)}catch(e){setError((e as Error).message)}}
 useEffect(()=>{void load()},[demo]);
 async function save(remove=false){if(busy||!loaded)return;setBusy(true);setError("");setMessage("");try{if(demo)setCurrent({url:remove?"":selected,revision:"preview"});else setCurrent(await api("/academy/site/logo",{revision:current.revision,...(remove?{delete:true}:{image_data:selected.split(",")[1]})}));setSelected("");form.current?.reset();markFormClean(form.current);setMessage(remove?"Đã xóa logo. Website sử dụng biểu tượng mặc định.":"Đã cập nhật logo cho website.")}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="website-logo-editor" aria-label="Logo website"><h3>Logo website</h3><p>PNG/JPG tối đa 512 KB, kích thước tối đa 2048 × 2048. Logo riêng được hiển thị ở đầu và cuối các trang công khai.</p><form ref={form} onSubmit={e=>{e.preventDefault();void save()}}>
 {(selected||current.url)&&<div className="website-logo-preview"><img src={selected||current.url} alt="Logo website"/></div>}
 <label>Chọn tệp logo<input aria-label="Chọn tệp logo" type="file" accept="image/png,image/jpeg" disabled={busy||!loaded} onChange={e=>{setError("");const file=e.target.files?.[0];if(!file)return;if(file.size>512*1024||!["image/png","image/jpeg"].includes(file.type)){setError("Chọn ảnh PNG/JPG tối đa 512 KB");return}const reader=new FileReader();reader.onload=()=>setSelected(String(reader.result));reader.onerror=()=>setError("Không đọc được ảnh");reader.readAsDataURL(file)}}/></label>
 <div className="academy-actions"><button disabled={busy||!loaded||!selected} className="academy-primary">{busy?"Đang lưu…":"Lưu logo"}</button><button type="button" className="secondary" disabled={busy||!loaded||!current.url} onClick={()=>void save(true)}>Xóa logo</button><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Tải lại logo</button></div>
 </form>{error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}</section>
}
