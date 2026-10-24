# Giao diện toàn hệ thống — v0.3.5

Bố cục dùng nền sáng trung tính, màu xanh cho thao tác chính, thanh điều hướng bên trái và nội dung co giãn theo màn hình. Lịch học, môn học, quản trị, tài khoản, điểm danh, bản ghi, đăng nhập và trang cấu hình dùng cùng kiểu chữ, nút, biểu mẫu và khoảng cách. Phòng học giữ nền tối để xem video.

Menu làm nổi bật trang hiện tại. Trên điện thoại, nút Menu mở các mục điều hướng rồi tự đóng khi chọn trang. Nút và ô nhập giữ kích thước thuận tiện cho thao tác chạm; bảng đối chiếu điểm danh/bản ghi cuộn ngang, giữ tiêu đề và cột đầu. Các biểu mẫu học vụ dài chuyển thành từng mục theo dòng trên điện thoại.

Đường dẫn `?demo=1&role=admin&page=overview` mở trực tiếp tổng quan. Thay vai trò bằng `teacher` hoặc `student`; các trang hỗ trợ gồm `overview`, `courses`, `meetings`, `settings`, `admin`, `attendance`, `recordings`. Quyền truy cập dữ liệu vẫn do máy chủ kiểm tra. Bản demo chỉ dùng dữ liệu mẫu.

Kiểm tra: build production, bộ kiểm thử web, trình duyệt ba vai trò trên desktop và màn hình 360/390 px; mở/đóng menu, không tràn trang, tiêu đề/cột bảng, đăng nhập và trang cấu hình. Cloudflare và môi trường VPS thật cần nghiệm thu riêng như hướng dẫn triển khai.
