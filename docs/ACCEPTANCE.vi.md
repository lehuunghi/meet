# Nghiệm thu

## Tự động

- `go test ./...`: lease điểm danh, import validation, Origin và bắt buộc đăng nhập. Integration test tự skip khi thiếu TEST_MYSQL_DSN.
- Khi có MySQL/Redis dùng riêng: migration + seed, login, chặn teacher trường khác, chặn student bắt đầu lớp/tạo lớp, join/heartbeat/leave, báo cáo riêng, logout revocation, kết thúc chặn heartbeat và FK chéo tenant.
- `go vet ./...`, `go build ./...`.
- `npm test`: cookie request và phản hồi API lỗi; `npm run build`: TypeScript và bundle production.
- CI Linux chạy MySQL/Redis integration với race detector và build/start Compose, đợi readiness qua Nginx.

## Hai trường và ba vai trò

1. Seed môi trường riêng. Đăng nhập teacher ở `demo`, teacher ở `other` bằng hai browser profile; mỗi bên chỉ thấy lớp/môn của trường mình.
2. Admin import 2 student + 1 teacher. Thử một dòng sai email và một email trùng: không dòng nào được thêm. Import lại workbook đúng: lớp/enrollment xuất hiện đầy đủ.
3. Tạo course và meeting bằng teacher đúng; teacher khác không tạo/điều khiển được. Student không thấy lớp chưa enroll, không gọi API vượt quyền được.
4. Giáo viên bắt đầu, học sinh vào bằng profile khác. Cả hai thấy/nghe nhau; tắt mic/camera và thay camera bằng màn hình. Kiểm tra browser console không có app secret, R2 secret hoặc TURN API token.
5. Mở hai tab student cùng buổi trong một phút: seconds xấp xỉ một phút, không nhân đôi. Ngắt mạng hơn 45 giây rồi vào lại: khoảng ngắt không được cộng. User chưa vào có 0 giây. Student không xem báo cáo người khác.
6. Kết thúc buổi: heartbeat mới bị 409, không tạo SFU mới được. **Ghi nhận hạn chế hiện tại:** peer đã kết nối chưa bị backend cưỡng chế đóng; cần bổ sung lifecycle trước yêu cầu quản lý media chặt.

## Cloudflare thật (không được đánh dấu pass nếu chưa chạy)

1. SFU App staging riêng, hai máy trên hai mạng. Theo dõi peer connection `connected` và inbound/outbound bytes, xác nhận audio/video thực tế.
2. Mạng yêu cầu TURN hoặc bản test cấu hình `iceTransportPolicy:'relay'`; xem candidate pair relay, thử failover key. Khôi phục policy mặc định sau test. Thử cuộc gọi hơn một giờ và ghi nhận nhu cầu refresh ICE.
3. Bật recording cho buổi thử, thông báo học sinh. Record khoảng 30 giây, chọn audio, stop, kiểm tra R2 object đúng prefix school/meeting, metadata ready, playback có audio/video. Thử từ student chưa enroll/trường khác phải bị chặn.
4. Chờ URL GET hết hạn, xác minh bị từ chối; xin URL mới khi vẫn còn quyền. Tắt public access. Không dán signed URL vào issue.
5. Thử Chromium và Firefox/Safari trong ma trận OS thực dùng; WebM/screen/system audio có thể khác nhau. Không hứa audio toàn bộ máy.

## Tải và vận hành

Staging tăng tải theo số lớp/người/track mục tiêu, đo SQL pool/latency, Redis, CPU bcrypt, login limit, SFU egress và browser CPU. Với lớp 50 người bật hết camera, một client có thể nhận rất nhiều track; cần chính sách teacher-only/simulcast/active speaker và benchmark trước. Chưa có kết quả chịu tải cho 50 lớp đồng thời.

Thực hiện backup/restore thử, xoay secret staging, restart API/Redis/MySQL, thử provider timeout, upload lỗi và tab đóng. Các giới hạn chưa giải quyết được ghi ở ARCHITECTURE.vi.md; không coi unit test pass là đủ cho production.
