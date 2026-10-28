# Quản lý thông báo và email tại VA — v0.28.0

Vào **Quản trị VA → Thông báo & email** (`/quan-tri/email`). Tài khoản quản trị cần quyền **Thông báo & email**. Hộp **Thông báo của tôi** dùng để đọc thông báo cá nhân, tách khỏi trang gửi/quản lý.

## Bốn mục sử dụng

- **Thông báo chung** (`?muc=thong-bao`): nhập tiêu đề, nội dung; đánh dấu gửi kèm email nếu cần. Bấm Gửi thông báo để đăng cho các tài khoản. Bảng có tìm kiếm không phân biệt dấu, nút xem nội dung đầy đủ và xóa. Xóa thông báo sẽ gỡ khỏi các tài khoản và hủy email chưa gửi; email đã gửi không thể thu hồi. Danh sách hiện tối đa 100 thông báo gần nhất.
- **Soạn email** (`?muc=soan-email`): chọn người nhận, nhập nội dung, xác nhận gửi. Mặc định chỉ gửi thử đến chính tài khoản quản trị. Có nhóm tất cả tài khoản, học sinh, giáo viên và quản trị. Cấu hình máy chủ gửi tại Cài đặt kinh doanh; tài khoản cài đặt cần quyền tương ứng. Không nhập mật khẩu SMTP vào chat hoặc commit vào mã nguồn.
- **Mẫu email** (`?muc=mau-email`): sửa mẫu xác thực và thông báo tự động. Mẫu xác thực phải giữ `{{verification_link}}`. Có thể dùng biến được hướng dẫn cạnh biểu mẫu. Đổi mẫu hoặc đổi mục vẫn giữ bản nháp trong trang; cần lưu từng mẫu. Nếu còn mẫu chưa lưu, hệ thống vẫn cảnh báo khi rời trang dù đã lưu một mẫu khác.
- **Lịch sử gửi** (`?muc=lich-su`): xem số đã gửi, đang chờ, lỗi, hủy; tải lại hoặc thử gửi lại các email lỗi. “Đã xếp hàng” không có nghĩa thư đã vào hộp thư người nhận; cần kiểm tra trạng thái gửi và cấu hình SMTP thực tế.

## Cách dùng và xử lý lỗi

Trong lúc lưu/gửi, biểu mẫu được khóa để tránh sửa nội dung rồi bị thao tác đang chạy xóa nhầm. Sau khi gửi thành công, lỗi tải lịch sử không được báo thành lỗi gửi; chỉ tải lại lịch sử, không gửi lặp lại. Lượt tải định kỳ không chồng lên lượt đang chạy; yêu cầu đọc có giới hạn chờ. Bản nháp trong các mục được giữ khi đổi mục trong trang, chưa phải lưu ngoại tuyến qua việc đóng trình duyệt.

Nên gửi thử đến chính mình để kiểm tra SMTP, thư rác và tên người gửi trước khi gửi hàng loạt. Việc kiểm thử tự động dùng mô phỏng; không tự gửi thư hay tạo thông báo thật cho học viên khi nghiệm thu giao diện.

## Nút Meet

Nút có viền rõ trên nền tối, icon sáng; tắt mic/camera có nền nhạt và icon đỏ, chức năng đang dùng có nền xanh nhạt, rời lớp màu đỏ đậm. Giữ nhãn trợ năng, tooltip và viền khi dùng bàn phím. Công cụ vẽ mở bằng icon bút, vẫn vẽ trên màn hình chia sẻ; bảng trắng dùng chung menu gọn. Không đổi quyền lớp, mốc điểm danh hoặc ghi hình.
