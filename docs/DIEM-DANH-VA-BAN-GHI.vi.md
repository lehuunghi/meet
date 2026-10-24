# Điểm danh và bản ghi theo lớp, môn, buổi học

v0.3.2 dùng thanh chọn gọn có tìm kiếm, sắp xếp tên và chỉ dựng tối đa 20 kết quả mỗi lần mở; không hiển thị toàn bộ lớp thành các ô lớn. Bảng được thu gọn, không còn cột chỉnh từng người và các thẻ tổng hợp lớn.

Hai trang **Báo cáo điểm danh** và **Bản ghi bài học** dùng cùng bố cục phân cấp:

1. Nhập tìm kiếm và chọn Lớp học.
2. Tìm và chọn Môn học thuộc lớp đó.
3. Chọn một buổi hoặc tất cả buổi trong môn.

Chưa chọn lớp/môn thì không tải và không hiển thị bảng chi tiết. Chuyển lớp tự bỏ môn/buổi đã chọn; chuyển môn bỏ buổi cũ. Nội dung và bộ lọc không gộp giữa các lớp hoặc các môn trùng tên. Đường dẫn chọn vai trò demo giữ nguyên trang điểm danh/bản ghi để so sánh quyền.

**Điểm danh:** giữ từng dòng học sinh/buổi và xuất Excel trong phạm vi đã chọn. Admin chọn một buổi để mở Khung giờ điểm danh chung, sửa Giờ vào chung / Giờ ra chung cho toàn bộ học sinh. Không còn chỉnh riêng từng cá nhân; API cũ trả 410. Thời gian kết nối gốc không bị thay đổi; báo cáo tính từ dữ liệu kết nối này, không dùng ghi đè cá nhân cũ. Lịch sử điều chỉnh cá nhân vẫn được giữ trong dữ liệu để tra cứu. Khi có quản trị khác sửa cùng buổi, lưu dữ liệu cũ bị từ chối để tránh ghi đè.

**Bản ghi bài học:** có thư viện thật trong menu, không chỉ ở phòng học. Bảng có buổi học, thời gian, dung lượng và hạn lưu; chỉ liệt kê bản ghi ready, chưa xóa, chưa hết hạn. Chọn **Xem bản ghi** để máy chủ kiểm tra quyền lại rồi cấp URL R2 có hạn và phát video trong trang. Đổi lớp/môn/buổi hoặc đóng video sẽ đóng trình phát; không lưu URL ký vào bộ nhớ lâu dài. Dữ liệu minh họa có phân cấp giống bản thật nhưng không giả vờ có video thật.

Phạm vi: admin có quyền tương ứng xem trong trường; giáo viên chính/trợ giảng chỉ môn được phân công; học sinh chỉ môn của lớp được ghi danh. Học sinh chỉ xem điểm danh của bản thân. Quyền admin Ghi hình không cho phép tạo/điều khiển buổi hoặc xem báo cáo điểm danh nếu chưa được cấp riêng.

API thư viện: GET /api/recordings?class_id=...&course_id=...&meeting_id=...&page=0. Bắt buộc lớp và môn hợp lệ, tùy chọn buổi, tối đa 50 dòng mỗi trang (51 dòng để phát hiện trang tiếp). Không trả object_key, bucket hoặc URL ký trong danh sách. Endpoint tải/xem vẫn kiểm tra quyền từng bản ghi và thời hạn trước khi ký URL.
