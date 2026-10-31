import type { ReactNode } from 'react';

const paths:Record<string,ReactNode>={
 courses:<><path d="M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></>,
 live:<><rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-4v12l-6-4"/></>,
 reports:<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>,
 vip:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></>,
 profile:<><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></>,
 manage:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h4"/></>,
 academic:<><path d="m2 8 10-5 10 5-10 5Zm4 2v7c4 3 8 3 12 0v-7m4-2v9"/></>,
 accounts:<><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Zm-4 9 3 3 5-6"/></>,
 orders:<><rect x="5" y="5" width="14" height="17" rx="2"/><path d="M9 5V2h6v3m-6 6 2 2 4-4m-6 9h6"/></>,
 students:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/></>,
 finance:<><path d="M4 3v17h17m-13-3V9m5 8V5m5 12v-6"/></>,
 settings:<><path d="m9 3 1-2h4l1 2 3 2h3v4l-2 3 2 3v4h-3l-3 2-1 2h-4l-1-2-3-2H3v-4l2-3-2-3V5h3Z"/><circle cx="12" cy="12" r="3"/></>,
 logout:<><path d="M9 3H4v18h5m5-14 5 5-5 5m-6-5h13"/></>,
 menu:<path d="M4 6h16M4 12h16M4 18h16"/>,
};
export function AcademyIcon({name}:{name:string}){return <svg className="academy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.courses}</svg>;}
export function AcademyAuthFrame({brand,children}:{brand:string,children:ReactNode}){return <div className="academy-auth-layout"><aside className="academy-auth-story"><a href="/" className="academy-auth-brand"><span className="academy-logo-mark"><AcademyIcon name="courses"/></span>{brand}</a><div><span className="academy-eyebrow">KHÔNG GIAN HỌC TẬP CỦA BẠN</span><h2>Học chủ động.<br/><em>Kết nối mỗi ngày.</em></h2><p>Một nơi để học cùng giáo viên, khám phá bài giảng và theo dõi từng bước tiến của bạn.</p><ul><li><AcademyIcon name="live"/>Kết nối trong lớp học Live</li><li><AcademyIcon name="courses"/>Ôn tập theo nhịp học của bạn</li><li><AcademyIcon name="reports"/>Theo dõi hành trình học tập</li></ul></div><small>Học tập chủ động · Tiến bộ bền vững</small></aside>{children}</div>;}
