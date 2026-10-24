# Kiến trúc và quyết định thiết kế

## Luồng hệ thống

```text
Browser React/Vite ── HTTPS ── Caddy ── Nginx ── Go API
                                                ├─ MySQL: dữ liệu tenant, điểm danh, metadata
                                                ├─ Redis: session, login limit, negotiation lease
                                                ├─ Cloudflare SFU/TURN API: secret chỉ ở server
Browser ───────────── WebRTC ─────────────────── Cloudflare SFU
Browser ───────────── signed PUT/GET ─────────── R2 private
```

Một control plane đơn giản trên VPS; media tách khỏi backend. React/Vite xuất static assets; Go phục vụ API bằng net/http. Không cần Next.js/SSR cho dashboard nội bộ này. Khi nhiều trường tăng, có thể tách MySQL/Redis ra dịch vụ riêng. Chưa benchmark quy mô 50 lớp hay 1.500 người đồng thời.

Bộ cài `deploy/install.sh` hỏi domain, chuẩn bị Docker/Caddy/Compose và mở `/setup` với token vận hành riêng. UI setup dùng cookie operator 15 phút, Origin guard và rate limit; school-admin không có quyền sửa provider toàn hệ thống. Runtime secret ở volume `runtime-config`, atomic file write 0600, GET redacts values. Chưa có mã hóa tự động ổ đĩa hoặc secret manager.

## Mô hình dữ liệu

`schools → users/classes → enrollments/courses → meetings → presence/attendance_events/media_sessions/publications/recordings`.

Mọi query nghiệp vụ có school_id lấy từ session server, không nhận tenant tùy ý từ client. Khóa ngoại composite `(school_id,id)` kiểm tra tenant ở các quan hệ quan trọng. Email duy nhất trong một trường, không duy nhất toàn hệ thống. Course = môn học trong một lớp với một giáo viên. Một học sinh có thể được enroll nhiều lớp. Admin được thao tác trong trường mình; teacher chỉ các môn phụ trách; student chỉ lớp được enroll.

`audit_log` giữ actor/action/target/time, không chứa mật khẩu hay secret. Audit hiện ghi sau mutation, có log lỗi khi ghi thất bại; chưa có outbox giao dịch bảo đảm audit không thất lạc. Cần retention/PII policy, audit export và backup phù hợp khi triển khai thật.

## Authentication

Migration v3 giữ khóa cũ và thêm ID ngắn bất biến, mã SV duy nhất theo trường và revision cho các bảng chỉnh sửa. Đăng nhập nhận email hoặc mã SV; giới hạn thử theo IP kết nối + mã trường + identifier để nhiều học sinh sau proxy không dùng chung một bucket 30 lần. Cần WAF/giới hạn ở edge cho tấn công nhiều identifier. Môn có thể chưa phân công; LEFT JOIN giữ môn trong catalog admin/student. Các batch và assignment kiểm tra tenant, revision và lưu nguyên tử; assignment bị chặn khi có buổi live. [Quy trình mới](HOC-VU-VA-MEET.vi.md).

Cookie opaque ngẫu nhiên 256 bit, lưu digest SHA-256 trong Redis; TTL 12 giờ cố định, không sliding refresh. SameSite Strict, HttpOnly, Secure theo HTTPS. POST kiểm tra Origin chính xác. Password bcrypt cost 12, tối đa 72 byte, tối thiểu 12 byte. Database active/role/session_version được kiểm tra mỗi request; thay mật khẩu tăng version và vô hiệu hóa tất cả session. Hiện chưa có MFA, reset password tự phục vụ, email invite hoặc bắt buộc đổi mật khẩu lần đầu. Admin import phải phân phối mật khẩu riêng và yêu cầu đổi khi bàn giao.

## Meeting và media

Meeting chỉ đi scheduled → live → ended. API kiểm tra quyền quản lý theo course teacher hoặc admin. Browser dùng một publishing peer và một receiving peer. Nhận track theo batch tối đa 50 track/operation và discovery polling 15 giây. Nhiều audio/video track cùng phòng được phép, không phải chế độ teacher-only broadcast.

Backend chỉ cung cấp các thao tác new/tracks/renegotiate; kiểm tra SFU session thuộc user + meeting + school. Remote tracks phải tồn tại trong publication registry của cùng phòng, publisher có heartbeat còn hạn. Redis khóa thao tác theo user/phòng trong 30 giây để tránh mutation chồng nhau. Cloudflare request timeout 20 giây. SFU session ID không được coi là quyền truy cập.

Nhiều SFU App được cân bằng theo số lớp đã gán / trọng số. Binding lớp và buổi lưu MySQL, cấp phát dưới advisory lock; các session cùng buổi dùng đúng một app. App đã gán không được xóa/đổi ID; disabled chỉ ngừng nhận lớp mới. Không cân bằng theo bitrate thực và không failover app giữa buổi. Xem `allocation.go` và tài liệu cài một lệnh.

Hiện giới hạn 8 SFU session từng user/buổi để tránh cấp vô hạn; publish + receive thường dùng 2. Sau nhiều lần reload có thể đạt giới hạn; chưa có API cleanup/reconnect tự động. TURN key lựa chọn ổn định theo user, failover key tiếp theo; chưa có weighted quota/circuit breaker/refresh ICE tự động. Credential TURN hết hạn sau một giờ; cần thử và xây ICE refresh/restart cho lớp kéo dài trước khi dùng rộng.

Track cũ bị ẩn khi hết lease hoặc rời lớp, nhưng chưa chủ động gọi SFU tracks/close, chưa loại receiving tracks khỏi peer/UI, chưa có SFU server-side revocation tức thời. Kết thúc buổi chặn API mới và xóa registry; **kết nối WebRTC đang tồn tại có thể tiếp tục**. Không dùng bản này cho yêu cầu cưỡng chế ngắt media tức thì. Cần quản lý session lifecycle/close và reconnection trước production lớn.

## Điểm danh

Presence key `(school,meeting,user)`; lock meeting rồi presence trong transaction. Event append có loại join/heartbeat/leave và thời gian DB. Chỉ cộng delta giữa hai quan sát nếu user đang online và delta ≤45 giây. Tab trùng không cộng trùng, vì dùng một row với lock. Không ước lượng thêm 45 giây sau lần thấy cuối nên thời gian mang tính bảo thủ. Cộng theo giây nguyên có thể thiếu phần lẻ khi gửi liên tục. Đóng lớp không cộng tail chưa xác minh.

Endpoint báo cáo LEFT JOIN enrollment nên cả học sinh chưa vào vẫn có mặt trong danh sách với 0 giây. Student chỉ thấy chính mình. Chưa có ngưỡng present/late/absent theo chính sách, xuất XLSX, sửa công có lý do, hoặc thống kê học kỳ. Heartbeat là chứng cứ kết nối ứng dụng, không chứng minh người dùng xem video hoặc chú ý; browser tab nền có thể bị hạn chế timer.

## Recording

Screen capture do giáo viên chọn, sau đó single PUT vào R2; không phải tự động ghi mọi SFU track. Object key mới có prefix recordings/school/meeting/random id. Metadata pending → ready sau HEAD. Hạn lưu 30 ngày: migration v2 backfill expiry, API ẩn/chặn file hết hạn và ký URL tối đa phần thời gian còn lại (không quá 5 phút); janitor startup/hourly xóa object đã hết hạn và giữ dấu deleted_at. Setup merge lifecycle 30 ngày vào R2 cùng CORS và đọc lại xác nhận; rule khác được giữ. Physical delete có thể trễ, API chặn quyền đúng expiry. Metadata cũ ngoài prefix được janitor dọn; orphan không có metadata chưa được janitor bao phủ. Trường phải ban hành chính sách đồng ý ghi hình. Không có worker thu server-side, upload resumable, chống malware, hạn mức tenant hoặc kiểm chứng nội dung WebM ngoài MIME và size. Không triển khai ghi hình dài trước khi bổ sung các phần này.

## Lộ trình trước rollout lớn

1. Nghiệm thu real SFU/TURN/R2, browser/OS/audio capture; load test số người/track mục tiêu.
2. Đóng/revoke SFU và reconnect, refresh TURN; xử lý rời lớp/đóng tab/mất mạng đầy đủ.
3. Quota tenant, giới hạn media/recording API, proxy rate limit theo IP tin cậy, metrics/tracing/cảnh báo.
4. Worker recorder + multipart/resume nếu cần ghi hình dài, retention/orphan cleanup.
5. Job import nền cho hàng nghìn tài khoản, mandatory password rotation/MFA/reset, pagination toàn bộ danh sách.
6. Versioned migration tiếp theo, restore drill, outbox audit và kiểm thử xâm nhập đa tenant.

Hội thoại tham chiếu chỉ trả về yêu cầu người dùng và mã tham chiếu của câu trả lời; không đọc được bản thiết kế đầy đủ. Tài liệu này ghi rõ những lựa chọn thực tế của mã nguồn để người review đối chiếu.
