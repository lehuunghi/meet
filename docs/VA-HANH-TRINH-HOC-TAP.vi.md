# VA: khóa học, công việc học tập và bảng tin (v0.11.0)

## Biên tập nội dung thật

Đăng nhập tài khoản quản trị website tại `/hoc`, chọn **Quản lý nội dung**.

1. **Tạo & sửa khóa học**: chọn khóa đã có hoặc tạo mới; sửa tên, giới thiệu, giáo viên hiển thị và môn Live liên kết. Không nên lặp tên khóa trong phần giới thiệu.
2. **Website giới thiệu → Trang chi tiết khóa học**: chọn khóa, điền đối tượng, mục tiêu, chương trình và lịch học. Mỗi mục tiêu/phần chương trình nhập một dòng. Có thể chọn một bài giảng đã sẵn sàng làm bài xem thử sau đăng nhập.
3. **Liên hệ & chính sách**: nhập email, số điện thoại, địa chỉ và nội dung chính sách đã được đơn vị duyệt. Mục để trống không tạo trang chính sách công khai.
4. **Hồ sơ giáo viên**: nhập tên, môn phụ trách và kinh nghiệm thật. Nội dung giới thiệu không thay đổi tài khoản/phân công giáo viên.
5. **Bài viết & lịch khai giảng**: đường dẫn chỉ gồm chữ thường, số và dấu gạch ngang. Chỉ bài được đánh dấu xuất bản mới xuất hiện. Góc học tập được ẩn nếu không có bài công khai.
6. Bấm **Lưu website**. Trang quản trị cũ phải tải lại trước khi lưu. Nếu người khác đã sửa nội dung, hệ thống báo xung đột; tải lại bản đã lưu trước khi chỉnh tiếp.

Trang khóa học công khai có dạng `/khoa-hoc/ID-KHOA-HOC`. Khóa chưa xuất bản hoặc thuộc đơn vị khác trả 404. Mục tiêu, chương trình, bài viết và chính sách được hiển thị dưới dạng văn bản an toàn, không chạy HTML do người nhập cung cấp.

Nội dung hiện có được giữ nguyên khi nâng cấp; bộ cài không tự viết thêm học phí, giáo viên, kết quả học viên, thông tin liên hệ hoặc chính sách cho đơn vị.

## Hành trình đăng ký và học thử

Chọn khóa → xem trang chi tiết → đăng ký/đăng nhập → mở đúng khóa. Đăng ký chia hai bước, giữ thông tin đã nhập khi quay lại; vẫn yêu cầu hồ sơ và xác thực email như trước. Ảnh đại diện bổ sung ở hồ sơ sau đăng nhập theo cơ chế hiện có.

Bài xem thử chỉ dẫn tới bài giảng đã sẵn sàng trong khóa. Người dùng vẫn phải bấm xem và tuân theo hạn mức tài khoản; không có URL video công khai hoặc tự trừ lượt xem khi mở trang. Chọn gói chỉ đánh dấu gói cần xem, không tự tạo đơn/thanh toán.

## Công việc giáo viên và học sinh

- Học sinh: lịch trong 7 ngày tới, bài chưa nộp theo môn được giao và quyền VIP, các video đang xem dở của chính mình. Nút tiếp tục mở khóa và đánh dấu bài đã chọn; bấm Xem để phát video.
- Giáo viên: lịch sắp dạy, số bài chưa chấm và học sinh đang hoạt động/có quyền bài tập chưa nộp trong các lớp phụ trách. Không tổng hợp công việc của giáo viên khác.
- Mục Hôm nay làm mới mỗi phút và khi mở lại trang. Khi lỗi tải sẽ báo lỗi và có nút thử lại, không thay bằng số liệu minh họa.

## Bảng tin và thành viên

Trong môn học, giáo viên chính/trợ giảng được phân công có thể đăng thông báo. Học sinh chỉ đọc thông báo của môn được ghi danh. Tab Thành viên hiển thị giáo viên phụ trách; danh sách chi tiết học sinh chỉ dành cho người điều hành môn, không công khai email/số điện thoại cho học sinh.

Thông báo được lưu trong bảng `course_announcements`, migration 8 chỉ bổ sung bảng và mốc schema; không xóa dữ liệu cũ. Việc nâng cấp vẫn cần CI đạt, không có buổi live và bản sao lưu được xác minh.

## Kiểm tra triển khai

Kiểm thử gồm trang công khai/draft, tách đơn vị, escape nội dung, lựa chọn khóa qua đăng ký, dữ liệu xem dở cá nhân, quyền bài tập, bảng tin theo phân công, xung đột lưu CMS và mobile. Kiểm thử giả lập không thay cho nghiệm thu gửi email OTP, thanh toán hoặc phát/ghi video R2 thật.
