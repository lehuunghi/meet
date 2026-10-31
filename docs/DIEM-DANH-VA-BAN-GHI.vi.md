## Bảng đối chiếu gọn — v0.3.4

Điểm danh và bản ghi dùng bảng cho cả máy tính và điện thoại. Tiêu đề cột và cột đầu được giữ cố định khi cuộn; điện thoại vuốt ngang để xem đủ thông tin. Các dòng có nền xen kẽ, ngày giờ và số liệu thẳng cột để đối chiếu nhanh.

- Điểm danh tách riêng buổi học, ngày học, lớp, môn, giờ vào, giờ ra, thời gian và kết quả. Khi đã lọc một môn hoặc buổi, các cột ngữ cảnh lặp lại được bỏ gọn. Giáo viên/admin có thêm cột học sinh; bảng cá nhân không lặp tên học sinh.
- Bản ghi tách buổi học, ngày học, lớp, môn, dung lượng, hạn lưu và nút xem. Lớp/môn chỉ hiển thị khi xem nhiều môn.
- Giữ cách mở trang theo vai trò của v0.3.3: học sinh thấy ngay dữ liệu bản thân, giáo viên có phạm vi được phân công, admin chọn lớp/môn. Khung giờ chung theo buổi và xuất Excel không thay đổi.

## Góc nhìn theo vai trò — v0.3.3

- Học sinh: mở trang là thấy toàn bộ lịch sử điểm danh của chính mình và bản ghi còn hạn của các lớp/môn được ghi danh, mới nhất trước, phân trang 50 dòng. Không phải chọn lớp/môn; bộ lọc thu gọn và chỉ mở khi cần. Bảng cá nhân bỏ tên/email lặp lại, mỗi buổi có nhãn môn/lớp. Xuất Excel cá nhân hỗ trợ toàn bộ môn hoặc bộ lọc.
- Giáo viên: điểm danh mở sẵn môn của buổi gần nhất (hoặc môn đầu tiên được phân công); xem danh sách học sinh, kết quả, xuất Excel và đổi lớp/môn khi cần. Thư viện bản ghi mở toàn bộ môn được phân công, mới nhất trước. Chỉ admin chỉnh khung giờ chung.
- Admin: chọn rõ lớp/môn bằng ô tìm kiếm, xem từng buổi và chỉnh khung giờ chung theo buổi. Không còn chỉnh giờ cá nhân.

Bộ lọc không thay đổi phạm vi tài khoản. API lấy học sinh từ phiên đăng nhập; tham số user_id không cho chọn học sinh khác. Giáo viên chỉ được xem môn chính/trợ giảng được phân công.

# Điểm danh và bản ghi theo lớp, môn, buổi học

v0.3.2 dùng thanh chọn gọn có tìm kiếm, sắp xếp tên và chỉ dựng tối đa 20 kết quả mỗi lần mở; không hiển thị toàn bộ lớp thành các ô lớn. Bảng được thu gọn, không còn cột chỉnh từng người và các thẻ tổng hợp lớn.

Với admin, hai trang **Báo cáo điểm danh** và **Bản ghi bài học** dùng cùng bố cục phân cấp:

1. Nhập tìm kiếm và chọn Lớp học.
2. Tìm và chọn Môn học thuộc lớp đó.
3. Chọn một buổi hoặc tất cả buổi trong môn.

Chưa chọn lớp/môn thì không tải và không hiển thị bảng chi tiết. Chuyển lớp tự bỏ môn/buổi đã chọn; chuyển môn bỏ buổi cũ. Nội dung và bộ lọc không gộp giữa các lớp hoặc các môn trùng tên. Đường dẫn chọn vai trò demo giữ nguyên trang điểm danh/bản ghi để so sánh quyền.

**Điểm danh:** giữ từng dòng học sinh/buổi và xuất Excel trong phạm vi đã chọn. Admin chọn một buổi để mở Khung giờ điểm danh chung, sửa Giờ vào chung / Giờ ra chung cho toàn bộ học sinh. Không còn chỉnh riêng từng cá nhân; API cũ trả 410. Thời gian kết nối gốc không bị thay đổi; báo cáo tính từ dữ liệu kết nối này, không dùng ghi đè cá nhân cũ. Lịch sử điều chỉnh cá nhân vẫn được giữ trong dữ liệu để tra cứu. Khi có quản trị khác sửa cùng buổi, lưu dữ liệu cũ bị từ chối để tránh ghi đè.

**Bản ghi bài học:** có thư viện thật trong menu, không chỉ ở phòng học. Bảng có buổi học, thời gian, dung lượng và hạn lưu; chỉ liệt kê bản ghi ready, chưa xóa, chưa hết hạn. Chọn **Xem bản ghi** để máy chủ kiểm tra quyền lại rồi cấp URL R2 có hạn và phát video trong trang. Đổi lớp/môn/buổi hoặc đóng video sẽ đóng trình phát; không lưu URL ký vào bộ nhớ lâu dài. Dữ liệu minh họa có phân cấp giống bản thật nhưng không giả vờ có video thật.

Phạm vi: admin có quyền tương ứng xem trong trường; giáo viên chính/trợ giảng chỉ môn được phân công; học sinh chỉ môn của lớp được ghi danh. Học sinh chỉ xem điểm danh của bản thân. Quyền admin Ghi hình không cho phép tạo/điều khiển buổi hoặc xem báo cáo điểm danh nếu chưa được cấp riêng.

API thư viện: GET /api/recordings?class_id=...&course_id=...&meeting_id=...&page=0. Admin bắt buộc lớp và môn hợp lệ; học sinh/giáo viên có thể bỏ bộ lọc để xem toàn bộ phạm vi được cấp. Tùy chọn buổi, tối đa 50 dòng mỗi trang (51 dòng để phát hiện trang tiếp). Không trả object_key, bucket hoặc URL ký trong danh sách. Endpoint tải/xem vẫn kiểm tra quyền từng bản ghi và thời hạn trước khi ký URL.
