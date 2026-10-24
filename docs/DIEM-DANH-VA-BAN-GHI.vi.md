# Điểm danh và bản ghi theo lớp, môn, buổi học

Hai trang **Báo cáo điểm danh** và **Bản ghi bài học** dùng cùng bố cục phân cấp:

1. Chọn ô lớp học (hoặc danh sách Lớp học).
2. Chọn môn thuộc lớp đó.
3. Chọn một buổi hoặc tất cả buổi trong môn.

Chưa chọn lớp/môn thì không tải và không hiển thị bảng chi tiết. Chuyển lớp tự bỏ môn/buổi đã chọn; chuyển môn bỏ buổi cũ. Nội dung và bộ lọc không gộp giữa các lớp hoặc các môn trùng tên. Đường dẫn chọn vai trò demo giữ nguyên trang điểm danh/bản ghi để so sánh quyền.

**Điểm danh:** giữ từng dòng học sinh/buổi, chỉnh giờ có lịch sử, quy tắc chuyên cần và xuất Excel trong phạm vi lớp/môn/buổi đã chọn.

**Bản ghi bài học:** có thư viện thật trong menu, không chỉ ở phòng học. Bảng có buổi học, thời gian, dung lượng và hạn lưu; chỉ liệt kê bản ghi ready, chưa xóa, chưa hết hạn. Chọn **Xem bản ghi** để máy chủ kiểm tra quyền lại rồi cấp URL R2 có hạn và phát video trong trang. Đổi lớp/môn/buổi hoặc đóng video sẽ đóng trình phát; không lưu URL ký vào bộ nhớ lâu dài. Dữ liệu minh họa có phân cấp giống bản thật nhưng không giả vờ có video thật.

Phạm vi: admin có quyền tương ứng xem trong trường; giáo viên chính/trợ giảng chỉ môn được phân công; học sinh chỉ môn của lớp được ghi danh. Học sinh chỉ xem điểm danh của bản thân. Quyền admin Ghi hình không cho phép tạo/điều khiển buổi hoặc xem báo cáo điểm danh nếu chưa được cấp riêng.

API thư viện: GET /api/recordings?class_id=...&course_id=...&meeting_id=...&page=0. Bắt buộc lớp và môn hợp lệ, tùy chọn buổi, tối đa 50 dòng mỗi trang (51 dòng để phát hiện trang tiếp). Không trả object_key, bucket hoặc URL ký trong danh sách. Endpoint tải/xem vẫn kiểm tra quyền từng bản ghi và thời hạn trước khi ký URL.
