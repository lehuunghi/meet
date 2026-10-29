# SFU theo buổi học, dự phòng và lưu lượng — v0.32.0

## Quản lý tại trung tâm

Trong đơn vị → **SFU**, thêm App ID/App Secret và tích **Kích hoạt SFU**. Danh sách được dùng theo thứ tự dòng: 1 → 2 → 3 → 1. Không dùng trọng số nữa. Lưu & đồng bộ, chờ VPS xác nhận đúng revision. Khóa vẫn được mã hóa tại trung tâm và không đưa xuống trình duyệt học viên.

Mỗi buổi nhận SFU khi có kết nối media đầu tiên. Buổi tiếp theo, kể cả cùng lớp/môn, lấy SFU tiếp theo; người vào sau và kết nối lại giữ SFU của buổi. Con trỏ lưu trong MySQL, có khóa và giao dịch để nhiều người vào cùng lúc không tạo phân bổ khác nhau. Phòng nhóm kế thừa SFU của buổi chính và không tiêu thụ thêm lượt quay vòng.

Bỏ tích loại SFU khỏi các buổi mới; giữ buổi đang chạy để tránh tự ngắt. Khi tất cả SFU đều tắt, không tạo được kết nối SFU mới. Giữ credential đã gán cho các phiên cũ để dọn kết nối đúng app; không xóa/đổi App ID còn được tham chiếu.

## Tự chuyển dự phòng

Lỗi từ API SFU trên máy chủ (xác thực, hạn mức, lỗi máy chủ hoặc kết nối) có thể kích hoạt chọn dự phòng. Báo mất kết nối từ trình duyệt được xác minh lại ở máy chủ: mất mạng riêng một người không tự chuyển cả lớp. SFU đích phải đang kích hoạt và trả lời kiểm tra trước khi đổi.

Chuyển đổi ghi vào MySQL theo cả phòng chính và các nhóm đang dùng cùng app. Máy chủ tăng thế hệ kết nối, thu hồi phiên và track cũ, lưu app gốc của mỗi phiên để dọn đúng nơi, rồi các thiết bị dựng lại transport. Mic/camera đang tắt vẫn tắt; capture màn hình còn sống được phát lại. Bộ ghi tiếp tục cùng buổi/đoạn lưu qua gián đoạn, không coi chuyển SFU là kết thúc lớp.

Có khóa, cooldown và số lần thử giới hạn để tránh đổi qua lại liên tục. Nếu không có SFU khác hoạt động, hệ thống giữ phòng, báo thử lại và tiếp tục phục hồi. Không cam kết chuyển trong 1–2 giây: thời gian phụ thuộc kiểm tra API, SDP/ICE, mạng và trình duyệt. SFU cùng nhà cung cấp có thể cùng gặp sự cố. Không tự chuyển lại SFU cũ khi nó phục hồi; buổi giữ app dự phòng để tránh ngắt thêm.

## Lưu lượng

Bảng SFU hiển thị số buổi đã gán, gửi lên, nhận xuống, tổng đã đo, tổng tháng hiện tại (UTC) và mẫu cuối. Có **Làm mới lưu lượng**, không làm mất nội dung cấu hình đang sửa. Số liệu gửi lên qua agent của VPS, cần client/recorder/trung tâm cùng hỗ trợ v0.32.0.

Đây là **ước tính WebRTC**, không phải hóa đơn Cloudflare. Đo tổng byte transport của trình duyệt và bộ ghi khoảng mỗi 15 giây, không cộng thêm byte RTP để tránh đếm hai lần. Bộ đếm cộng dồn có sổ phiên, khóa hàng và high-water mark: gửi lặp hoặc đến sai thứ tự không cộng trùng. Mẫu cuối của phiên đã chuyển vẫn thuộc SFU gốc.

Không có dữ liệu lịch sử trước khi bật bản đo này. Thiết bị đóng đột ngột, mất mạng hoặc không cung cấp getStats có thể làm thiếu mẫu; dữ liệu trình duyệt là dữ liệu thiết bị báo, không dùng tính tiền. Gửi lên/nhận xuống gồm overhead giao thức và khác số liệu thanh toán của Cloudflare. Trước khi có mẫu hiển thị **Chưa có mẫu**, không giả số 0. GB dùng hệ thập phân.

Cloudflare tính phí dựa trên lưu lượng đi từ Cloudflare ra ứng dụng; SFU App Secret phục vụ API phiên media, không tự cấp số liệu hóa đơn theo tài khoản. Đối chiếu chi phí tại Cloudflare: https://developers.cloudflare.com/realtime/sfu/platform/pricing/ .

## Kiểm thử và triển khai

Schema 19 thêm con trỏ phân bổ, sổ/tổng lưu lượng, thế hệ phòng, tuyến phiên gốc và nhật ký chuyển dự phòng. Dùng bộ nâng cấp an toàn với snapshot; không nâng cấp giữa buổi live. Sao lưu/khôi phục MySQL chứa cả con trỏ và sổ số liệu.

Kiểm thử MySQL/Redis và SFU mô phỏng kiểm tra vòng lặp, cùng lớp khác buổi, phòng nhóm, truy cập trái phép, idempotency, chuyển toàn phòng và đóng phiên app cũ. Kiểm thử trình duyệt kiểm tra phục hồi transport, giữ capture và bảng quản trị. Gọi nhiều thiết bị/ghi R2 thật và sự cố Cloudflare thực cần nghiệm thu riêng; không phá credential sản xuất để thử lỗi.
