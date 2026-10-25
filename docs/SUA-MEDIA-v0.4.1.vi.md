# Sửa phòng học không có camera/video — v0.4.1

Đã xác nhận trực tiếp từ VPS rằng SFU chấp nhận tạo session với POST không có body (HTTP 201). Gửi `{}` như v0.4.0 bị từ chối với `decoding_error: Body JSON validation error: sessionDescription`. Sửa cả luồng tạo phiên phòng học và nút kiểm tra credential sang body vắng mặt thực sự, không gửi JSON null.

Trước khi vào lớp có khung nhận diện rõ ràng, nút xem trước và nút vào không dùng camera/micro. Nếu thiếu camera, thử micro riêng; thiếu cả hai hoặc quyền bị chặn có thông báo tiếng Việt và lựa chọn vào chỉ nghe. Không ghi presence join khi chưa lấy được thiết bị; giữ nguyên lỗi gốc khi dọn kết nối thất bại.

Kiểm thử: request HTTP không có body; regression ở API thật với MySQL/Redis giả lập transport SFU; thiết bị thiếu/quyền bị chặn/chỉ nghe; Playwright vào phòng khi camera bị chặn. Cần thử camera/micro thật trên thiết bị người dùng để nghiệm thu media hai phía. Không nhúng iframe Google Meet; phòng React/WebRTC dùng Cloudflare SFU.

Nâng qua quy trình cập nhật an toàn sau khi CI đạt và không còn buổi live. Không cài lại hoặc xóa dữ liệu lớp/tài khoản.

Tham chiếu: [Cloudflare connection patterns](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/).
