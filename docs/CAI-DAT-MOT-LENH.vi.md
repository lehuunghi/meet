# Cài Meet bằng một lệnh và cấu hình qua trình duyệt

## 1. Chuẩn bị trước

Dùng VPS Ubuntu 24.04 hoặc 26.04 riêng cho Meet, quyền sudo/root, Internet và domain quản lý đã trỏ DNS về VPS. Mở TCP 80/443 và giữ port SSH của bạn. Bộ cài không tự đổi DNS, firewall hoặc tạo account/bucket Cloudflare.

Ví dụ domain: `meet.truong.edu.vn`. Chỉ nhập hostname, không có `https://` hoặc `/`. Không dùng địa chỉ `127.0.0.1:5173` của bản xem trước làm domain triển khai.

## 2. Một lệnh cài

SSH vào VPS Ubuntu, chạy nguyên dòng sau:

```bash
curl -fsSL https://raw.githubusercontent.com/lehuunghi/meet/codex/multi-school-platform/deploy/install.sh -o /tmp/meet-install.sh && sudo bash /tmp/meet-install.sh
```

Bạn có thể đọc script tải về trước khi chạy sudo. Bộ cài hỏi domain rồi tự cài Docker/Compose và Caddy nếu thiếu, clone đúng nhánh vào `/opt/meet`, sinh secret riêng, tạo database và migration, build/chạy stack, thêm site Caddy và kiểm tra HTTPS.

Kết thúc thành công sẽ hiện liên kết riêng dạng:

```text
https://DOMAIN_CUA_BAN/setup#token=MA_CAI_DAT_RIENG
```

Đây là thông tin đăng nhập cấu hình cấp hệ thống, không gửi cho giáo viên/học sinh. Phần fragment `#token=...` không gửi trong HTTP URL; trang dùng nó để mở phiên quản trị rồi xóa khỏi thanh địa chỉ. Phiên cấu hình có hiệu lực 15 phút.

Nếu thiếu DNS/HTTPS, bộ cài dừng với hướng dẫn, không tuyên bố cài thành công. Sau khi sửa, có thể chạy lại cùng domain. Bộ cài không xóa volume, không ghi đè secret cũ, không chuyển nhánh hoặc ghi đè checkout có thay đổi cục bộ. Caddyfile cũ được giữ; bộ cài thêm `import` và site riêng. Máy đang có web server khác giữ 80/443 cần xử lý xung đột trước.

## 3. Trang cài đặt chi tiết

### Trường và admin đầu tiên

Điền mã trường, tên trường, email admin viết thường và mật khẩu riêng 12–72 byte. Ví dụ mã `nguyen-trai`. Email không tự được gửi thư mời; lưu password trong kho bảo mật của đơn vị.

Khi hệ thống đã có trường, phần này hiển thị đã khởi tạo và không tạo trùng. Các trường tiếp theo dùng CLI bootstrap trong [hướng dẫn đầy đủ](HUONG-DAN-DAY-DU.vi.md).

### Nhiều SFU App để cân bằng các lớp

Chọn **Thêm SFU App**, nhập mỗi app gồm tên, App ID, App Secret, trọng số và trạng thái nhận lớp mới. Mỗi App ID chỉ xuất hiện một lần; nhiều token trỏ cùng App ID không được xem là nhiều năng lực độc lập.

Ví dụ:

| App | Trọng số | Phân phối lớp mới khi tải ổn định |
|---|---|---|
| SFU A | 2 | Khoảng 2 phần |
| SFU B | 1 | Khoảng 1 phần |

Khi lớp lần đầu tạo SFU session, server chọn app có số lớp đã gán chia cho trọng số thấp nhất, dưới khóa MySQL. Phân bổ lưu trong `class_sfu_bindings`, buổi học chụp lại trong `meeting_sfu_bindings`. Các môn của cùng lớp dùng app đã gán; mọi người cùng buổi phải ở cùng app. Đây là cân bằng số lớp, không phải cân bằng băng thông/concurrency đo thời gian thực.

Đổi trọng số chỉ tác động lớp chưa được gán. Tắt **Nhận lớp mới** không ngắt lớp đang dùng app đó. App đã có binding không thể bị xóa/đổi App ID; vẫn có thể cập nhật Secret đúng cho app đó. Chưa có chuyển lớp tự động hoặc failover giữa SFU app khi đang gọi. Cloudflare chỉ cho session/track dùng trong cùng application, nên không xoay token ngẫu nhiên theo từng học sinh. Tham chiếu [SFU applications](https://developers.cloudflare.com/realtime/sfu/concepts/sessions-tracks/).

Nút **Kiểm tra credential** tạo một session kiểm tra trên Cloudflare. Kết quả này không thay thế thử audio/video giữa hai thiết bị thật. Các app/token cần được phép sử dụng theo account của đơn vị; nhiều app không tự thay đổi hạn mức hay giá dịch vụ.

### TURN riêng

Thêm từng TURN Key ID + API token. Backend phân phối ổn định theo user và thử key tiếp theo khi cấp credential lỗi; TTL hiện 3600 giây. Không dùng TURN token thay cho SFU Secret. Nếu chưa có TURN, để danh sách rỗng; ứng dụng chỉ cấp STUN. Cuộc gọi dài hơn một giờ cần nghiệm thu và bổ sung refresh ICE theo nhu cầu.

### R2 và lưu một tháng

Bật **Lưu bản ghi vào R2 private**, điền Account ID, bucket đã tạo, R2 Access Key ID và Secret Access Key. Bucket nên dành riêng cho Meet và luôn private.

Khi lưu, server:

1. Đọc các lifecycle hiện có.
2. Giữ các rule khác, thêm/cập nhật rule `meet-recordings-30d` cho prefix `recordings/`, expire sau **30 ngày**.
3. Giữ các CORS rule khác và thêm/cập nhật rule `meet-origin` cho domain ứng dụng.
4. Đọc lại lifecycle để xác nhận rồi mới báo cấu hình đã áp dụng.

Credential phải có quyền cấu hình bucket lifecycle/CORS, ngoài quyền đọc/ghi/xóa object. Nếu quyền không đủ, UI báo lỗi và cấu hình cục bộ chưa lưu; một phần thay đổi từ xa có thể đã hoàn tất nên cần kiểm tra bucket. Không khắc phục bằng public bucket. Có thể lưu phần quản lý/SFU trước với R2 tắt, rồi bổ sung sau khi chuẩn bị quyền.

“Một tháng” ở đây là **30 ngày**, không phải đến cùng ngày của tháng sau. Bản ghi mới có key `recordings/SCHOOL/MEETING/ID.webm` và `expires_at` ở MySQL. Khi hết hạn, API ngừng hiển thị/tải và URL tải không có thời hạn vượt mốc hết hạn. Tác vụ chạy lúc API khởi động rồi mỗi giờ, xóa tối đa 100 object hết hạn/lượt và đánh dấu `deleted_at` sau khi R2 chấp nhận; lỗi được thử ở chu kỳ sau.

R2 lifecycle tiếp tục xử lý ngay cả khi VPS dừng. Việc xóa vật lý có thể trễ, thường trong khoảng 24 giờ sau mốc expiration theo [tài liệu R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/). Không hứa xóa vật lý chính xác từng giây. File cũ trước prefix mới được migration đặt hạn `created_at + 30 ngày` và tác vụ ứng dụng dọn theo metadata; rule prefix mới không tự bao phủ file cũ ngoài prefix.

Giữ account/bucket cũ khi đã có metadata bản ghi để tránh dọn nhầm kho. Thay toàn bộ kho cần quy trình di chuyển dữ liệu riêng; UI hiện chặn thao tác đổi kho này. Khóa S3 có thể được xoay trong cùng account/bucket.

## 4. Lưu và sử dụng

Bấm **Lưu cấu hình & khởi tạo**. Password admin chỉ được bcrypt vào MySQL, không lưu trong file cấu hình. SFU/TURN/R2 secret lưu trong `/opt/meet/runtime-config/settings.json`, mode 0600, volume riêng cho API; không commit Git và API đọc cấu hình chỉ trả cờ đã lưu, không trả lại giá trị.

Để trống ô secret đã lưu sẽ giữ nguyên giá trị. Sau khi lưu, trang xóa các giá trị secret vừa nhập khỏi state hiển thị. Chọn **Khóa cấu hình** khi xong, sau đó đăng nhập trường bằng mã trường/email/password vừa tạo.

Tiếp theo: import teacher/student → tạo lớp → tạo course và gán teacher → tạo buổi học → bắt đầu live → thử hai người → kiểm tra điểm danh → thử bản ghi 30 giây nếu dùng R2.

## 5. Mở lại trang cấu hình

Trên VPS:

```bash
sudo cat /opt/meet/runtime-config/setup-token
```

Chỉ đọc trong terminal riêng, không chia sẻ màn hình. Mở `https://DOMAIN/setup` và nhập mã. Tài khoản admin của một trường không tự có quyền cấu hình chung của toàn hệ thống. Token cài đặt là quyền vận hành riêng; giữ trong password manager và bảo vệ bản backup.

Khởi động/tình trạng/log:

```bash
sudo meet ps -a
sudo meet logs --tail=100 api web
```

Không gửi secret hoặc link cài đặt cho người hỗ trợ. Không dùng `down -v` để xử lý lỗi; lệnh đó xóa dữ liệu volume.

## 6. Lưu ý kiểm chứng

Unit/integration tests kiểm tra phân phối lớp, pin app, quyền operator, redaction, lifecycle merge và xóa object bằng upstream giả lập. CI chạy MySQL/Redis và Compose thật. Cài đặt cấp OS, DNS/chứng chỉ và Cloudflare thật vẫn phải nghiệm thu trên VPS/account của bạn; dự án không có credential của bạn để tự xác nhận thay.

Ghi hình vẫn là browser capture do giáo viên chủ động; chưa có server-side recorder đầy đủ. Các giới hạn media/reconnect khác giữ nguyên trong [kiến trúc](ARCHITECTURE.vi.md).
