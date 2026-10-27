export function subjectArt(title:string) {
 const t=title.toLowerCase();let name="learning";
 if(t.includes("toán"))name="math";else if(t.includes("vật l")||t.includes("lý"))name="physics";else if(t.includes("hóa")||t.includes("hoá"))name="chemistry";else if(t.includes("văn"))name="literature";else if(t.includes("anh"))name="english";
 return "/images/"+name+".svg";
}
