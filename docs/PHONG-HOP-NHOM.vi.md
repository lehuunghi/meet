# Phòng họp nhóm — v0.31.0

Trong cuộc gọi, mở **ba chấm → Phòng họp nhóm**. Dùng chung cho nền tảng trường học và khóa học/VIP.

## Dành cho giáo viên/quản trị

1. Vào phòng chính, chọn số nhóm từ **2–20**, bấm **Tạo phòng nhóm**.
2. Thêm nhóm, lưu tên mới hoặc xóa nhóm chưa bắt đầu. Thành viên của nhóm bị xóa trở về danh sách chưa phân công.
3. Tìm và chọn một hoặc nhiều người, bấm **Phân … vào nhóm**. Máy tính có thể kéo thả các thành viên đã chọn vào nhóm. **Chia đều ngẫu nhiên** chia học sinh đang kết nối; giáo viên mặc định ở phòng chính.
4. Bấm **Bắt đầu thảo luận nhóm**. Học sinh được phân công nhận lời mời trong cuộc gọi; bấm **Vào nhóm** để chuyển. Người chưa được phân công ở lại phòng chính.
5. Người điều hành có thể ghé bất kỳ nhóm nào bằng **Vào nhóm**, rồi **Về phòng chính**. Đóng tất cả nhóm để mọi người tự quay lại phòng chính. Để đổi phân công, đóng lượt đang chạy rồi tạo lượt mới.

Xóa nhóm và thay đổi phân công chỉ thực hiện trước khi bắt đầu. Lượt đã đóng được giữ để không làm mất lịch sử chat/bảng vẽ; lượt mới có các phòng riêng mới. Kết thúc buổi học chính đóng tất cả nhóm; đóng nhóm không kết thúc buổi học.

## Dành cho học sinh

Chỉ được vào nhóm mình được phân công. Link nhóm và ID luồng của nhóm khác không cấp quyền truy cập. Sau khi vào nhóm, tải lại trang sẽ tiếp tục trong nhóm nếu phiên và quyền còn hợp lệ. Có thể quay về phòng chính bằng nút trong thông báo trên cuộc gọi.

Mỗi nhóm có luồng gọi, trình bày, chat, khảo sát và bảng vẽ riêng. Giáo viên phải chuyển sang nhóm đó để tham gia; không nghe nhiều nhóm đồng thời.

## Điểm danh và ghi hình

- Điểm danh tiếp tục ghi nhận trên **buổi học chính** bằng heartbeat của thiết bị; phòng nhóm không xuất hiện như các buổi học/môn học mới trong lịch và báo cáo.
- **Bộ ghi hiện tại chỉ ghi phòng chính.** Không trộn âm thanh/hình ảnh các nhóm vào video chung; chưa triển khai ghi riêng từng nhóm.
- Khi chuyển phòng, kết nối phòng cũ phải được đóng trước. Nếu SFU không xác nhận đóng được, hệ thống báo lỗi và chưa đổi phòng; thử lại sau. Các phiên đã thu hồi tiếp tục được bộ dọn media xử lý.
- Mic/camera giữ lựa chọn trước đó khi tự vào phòng mới. Chia sẻ màn hình dừng khi chuyển phòng; muốn trình bày ở nhóm mới phải chia sẻ lại để tránh phát nhầm nội dung.

## Triển khai và kiểm thử

Schema **18**, thêm ba bảng `meeting_breakout_rounds`, `meeting_breakout_rooms`, `meeting_breakout_members`. Phòng con dùng cơ chế media, chat và bảng vẽ hiện có, với kiểm tra quyền theo lượt nhóm và phòng hiện tại tại máy chủ. Các truy vấn lịch, lớp đang mở và báo cáo bỏ qua phòng con. Khi loại học sinh khỏi phòng chính, các phiên media của học sinh trong nhóm cũng bị thu hồi.

Kiểm thử tích hợp dùng MySQL/Redis và SFU mô phỏng để kiểm tra phân quyền, đóng transport lỗi, chống lấy track nhóm khác, trạng thái lượt nhóm và điểm danh gốc. Kiểm thử trình duyệt dùng dữ liệu mô phỏng cho tạo/phân nhóm, tải lại trong nhóm và quay về sau khi đóng. Nghiệm thu gọi/âm thanh thật cần giáo viên và ít nhất hai học sinh ở các thiết bị khác nhau; chưa dùng kiểm thử mô phỏng để công bố năng lực tải nhiều nhóm.
