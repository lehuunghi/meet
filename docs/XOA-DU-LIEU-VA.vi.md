# Xóa điểm danh, video và giao diện VA — v0.17

## Quyền và phạm vi

Trong **Điểm danh & bản ghi**, quản trị mở **Quản lý dữ liệu điểm danh & video** để xem số lượng và xóa tất cả điểm danh hoặc tất cả video. Nhập đúng **XÓA** rồi xác nhận. Chỉ tài khoản có quyền tương ứng mới được thực hiện; giáo viên và học sinh không có nút xóa.

- **Xóa điểm danh buổi này**: chọn lớp → môn → buổi trong báo cáo. Xóa lịch sử ra/vào, kết quả và khung giờ đã điều chỉnh của toàn buổi; buổi đã xóa không xuất hiện lại thành các dòng “Vắng”. Giữ buổi học, lớp và video.
- **Xóa video buổi này / Xóa video**: xóa bản ghi gốc; bài giảng đã sao chép riêng vào khóa học vẫn tồn tại.
- **Xóa bài giảng**: Quản lý nội dung → chọn khóa → danh sách bài giảng. Xóa video bài giảng, ghi chú, lịch sử và tiến độ xem của bài; giữ bản ghi gốc và khóa học.
- **Xóa tất cả video**: gồm cả bản ghi lớp học và video bài giảng. Các khóa học trở thành khóa chưa có bài giảng; không xóa tài khoản, lớp, gói VIP, đơn hàng hoặc thời hạn đã mua.

Không xóa khi còn buổi live hoặc tác vụ sao chép bài giảng. Video vừa tạo phải đợi 20 phút để liên kết tải lên tạm thời hết hạn. Khi R2 không khớp cấu hình, yêu cầu bị từ chối trước khi thay đổi dữ liệu.

## Dọn file R2

Việc xóa dữ liệu và tạo hàng đợi dọn file nằm trong cùng giao dịch. Sau khi xóa, video không còn được cấp link mới. Tác vụ nền xóa từng object theo khóa chính xác, bucket và tài khoản lưu trữ, hủy multipart còn lại nếu có; không xóa bằng tiền tố toàn bucket. Mất mạng hoặc lỗi R2 được giữ trong hàng đợi để thử lại. Xem **file R2 chờ xóa** và bấm **Kiểm tra trạng thái**. Số chờ về 0 xác nhận dọn xong.

Bản sao lưu hệ thống đã tạo trước đó giữ theo chính sách backup riêng; thao tác này không xóa các bản sao lưu đó.

## Hồ sơ, menu và hình ảnh

Học sinh giữ trường đang học và điện thoại phụ huynh bắt buộc. Giáo viên và quản trị không hiện hoặc yêu cầu hai trường này khi lưu hồ sơ. Đăng ký học sinh vẫn yêu cầu đủ hồ sơ.

Menu quản trị: lớp Live → lớp & giáo viên → báo cáo → nội dung → khóa học → học viên → thanh toán → thu chi → website → tài khoản → cài đặt → thông báo → hồ sơ. Giáo viên có 5 mục; học sinh có 6 mục, không hiện chức năng quản trị.

Trang chủ, trang giới thiệu khóa và kho bài giảng sử dụng bộ minh họa SVG nhẹ cho Toán, Vật lí, Hóa học, Ngữ văn, Tiếng Anh và không gian học tập. Các ảnh nằm trong mã nguồn, không gọi dịch vụ ảnh bên ngoài; không sử dụng ảnh hoặc thông tin giáo viên giả. Ảnh khóa được chọn tự động theo tên môn.
