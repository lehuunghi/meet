# Ảnh, hóa đơn, email và thông báo VA

## Tải ảnh website

Trong **Quản trị website**, chọn ảnh trực tiếp ở Trang chủ & giới thiệu, Giáo viên, Cảm nhận hoặc Bài viết. Có thể xem trước, gỡ ảnh hoặc chọn lại ảnh đã tải. PNG/JPG tối đa 5 MB, tối đa 4096 × 4096; hệ thống kiểm tra dữ liệu ảnh và loại metadata khi lưu. Bấm **Lưu website** để áp dụng. Trong lúc ảnh đang tải, các thao tác sửa/lưu nội dung bị khóa để tránh gắn nhầm ảnh. Các đường dẫn ảnh cũ được giữ; không cần tải lại ngay.

Ảnh website lưu theo từng đơn vị trong cơ sở dữ liệu, không yêu cầu R2, được đưa vào sao lưu/phục hồi. Thư viện tối đa 300 MB; Gỡ ảnh chỉ gỡ khỏi mục đang sửa, không xóa ảnh được mục khác sử dụng. Logo vẫn có mục tải riêng.

## Chuyển khoản và hóa đơn

1. Học sinh chọn gói để tạo yêu cầu thanh toán và mã QR.
2. Tải biên lai PNG/JPG tối đa 2 MB lên vùng R2 riêng tư.
3. Bấm **Đã chuyển khoản — Tạo hóa đơn**. Mỗi đơn chỉ tạo một hóa đơn, kể cả khi bấm lại hoặc tải lại trang.
4. Học sinh và quản trị Tài chính xem, in hoặc lưu PDF hóa đơn. Trạng thái ban đầu là **Chờ đối soát**, chưa kích hoạt VIP.
5. Quản trị đối soát/duyệt hoặc webhook thanh toán hợp lệ xác nhận đã nhận tiền; VIP mới được cấp. Giá tiền và số ngày lấy từ đơn đã mua, không thay theo lần sửa gói sau đó.

Hóa đơn là chứng từ thanh toán nội bộ, không phải hóa đơn thuế. Biên lai và hóa đơn chỉ mở cho chủ đơn hoặc quản trị có quyền Tài chính. Hóa đơn được tạo cho giao dịch mới; không tự tạo lại toàn bộ giao dịch cũ.

## Nội dung và gửi email

Vào **Nội dung & gửi email** (`/quan-tri/email`). Quyền **Thông báo & email** được cấp riêng trong Tài khoản & phân quyền; quản trị toàn quyền có sẵn. Cấu hình SMTP vẫn nằm tại **Email & thanh toán**, thuộc quyền Tài chính.

- Sửa mẫu Xác thực tài khoản hoặc Thông báo chung. Mẫu xác thực bắt buộc giữ `{{verification_link}}`.
- Biến chung: `{{name}}`, `{{email}}`, `{{site_url}}`. Thông báo có thêm `{{title}}`, `{{content}}`, `{{notification_link}}`.
- Soạn thư riêng rồi chọn gửi thử cho chính mình, tất cả tài khoản đang hoạt động, hoặc một nhóm vai trò.
- Theo dõi số người nhận, đã gửi, đang chờ, lỗi và đã hủy. Nút Thử gửi lại chỉ xử lý thư lỗi, không gửi lại thư đã thành công.

Thư dùng văn bản UTF-8, có hàng đợi bền vững, chống tạo trùng đợt gửi khi bấm lại và tự thử tối đa 5 lần khi SMTP lỗi. Ba worker xử lý riêng; sự cố không làm mất yêu cầu. SMTP có thể đã nhận thư trước khi kết nối bị ngắt; trường hợp không xác định này có khả năng gửi trùng khi thử lại, vì SMTP không có giao dịch chung với cơ sở dữ liệu.

## Thông báo toàn nền tảng

Trong **Thông báo**, quản trị có quyền Thông báo & email nhập tiêu đề/nội dung rồi gửi. Tất cả quản trị, giáo viên và học sinh của đơn vị đều xem được thông báo; không lẫn sang đơn vị khác. Có tùy chọn **Đồng thời gửi thông báo đến email**; nếu chọn, cần cấu hình SMTP trước khi gửi.

Thông báo cập nhật khi mở trang, quay lại cửa sổ và tự kiểm tra mỗi 15 giây. Xóa thông báo sẽ gỡ khỏi hộp thông báo của mọi tài khoản và hủy các thư chưa bắt đầu gửi. Email đã gửi hoặc đang chuyển đi không thể thu hồi. Các thông báo lớp học/bài tập tự động vẫn theo quyền lớp riêng như trước.
