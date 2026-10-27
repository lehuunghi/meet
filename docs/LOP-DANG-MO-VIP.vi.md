# Lớp đang mở và quyền Live — v0.19

Học sinh vào **Lớp học** sẽ thấy danh sách toàn bộ buổi đang chuẩn bị hoặc đang học của cùng nền tảng, kể cả lớp chưa tham gia. Lớp ngưng/xóa và buổi đã kết thúc không xuất hiện trong danh sách này. Có bộ lọc trạng thái, tìm lớp/môn/giáo viên và phân trang 50 buổi. Danh sách tự cập nhật sau tối đa khoảng 15 giây khi đang mở trang.

- **Chưa có VIP hoặc VIP hết hạn:** chỉ xem thông tin công khai của buổi. Nút Xem gói VIP mở trang gói học; không ghi danh, không mở camera/micro, không cấp kết nối SFU, chat, danh sách học sinh hoặc dữ liệu điểm danh.
- **VIP còn hạn:** mọi gói VIP đều có quyền Live, kể cả gói cũ có trường lịch sử `live_enabled=false`. Có thể vào buổi đang học. Khi bấm Vào học Live, hệ thống kiểm tra lại VIP, trạng thái buổi và trạng thái lớp, rồi tự ghi danh một lần và mở phòng. Các quy tắc duyệt vào phòng của giáo viên vẫn áp dụng.
- **Buổi chuẩn bị:** hiển thị trạng thái; nút vào học của VIP chỉ mở khi giáo viên bắt đầu.
- **Đã tham gia lớp:** lớp tiếp tục nằm trong Lớp học của tôi để xem nội dung và lịch sử theo quyền vốn có. Danh sách mở không mở rộng quyền đọc lịch sử/roster của lớp chưa tham gia.

Giá, thời hạn gói và dữ liệu giao dịch cũ không bị sửa. Bảng lưu quyền Live theo chính sách cũ vẫn giữ để đối soát lịch sử, nhưng quyền truy cập hiện tại tính theo ngày hết hạn VIP chung. Hạn mức bài giảng miễn phí giữ nguyên.

API đăng nhập:

- `GET /api/academy/live-classes?q=&status=live&page=0`: dữ liệu tối thiểu, phân trang và cờ quyền Live hiện tại. `status=scheduled` lọc buổi chuẩn bị.
- `POST /api/academy/live-classes/{meeting}/enter`: học sinh VIP vào lớp đang học. Kiểm tra quyền tại máy chủ, không chỉ dựa vào việc ẩn nút trên giao diện. Gửi lặp không tạo trùng ghi danh. Không đổi quyền học của tài khoản khác hoặc trường khác.

Các nội dung FAQ/giới thiệu trên VA được điều chỉnh theo chính sách mới bằng lưu có kiểm tra phiên bản. Không tạo buổi học, video, điểm danh hoặc cấp VIP thật chỉ để kiểm thử.
