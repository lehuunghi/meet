# Mốc giảng dạy, ghi hình và công cụ trình bày — v0.24.0

## Khi nào lớp thực sự bắt đầu?

**Chuẩn bị dạy / mở phòng** chỉ thông báo và mở quyền vào phòng, chưa khởi động ghi hình hoặc cộng thời gian chờ vào điểm danh. Mốc giảng dạy được máy chủ chốt sau khi giáo viên chính hoặc trợ giảng được phân công đã hoàn tất bước vào phòng. Nếu trình duyệt không mở được thiết bị hoặc kết nối thất bại trước khi vào phòng, không chốt mốc giảng dạy. Giáo viên vẫn có thể vào bằng chế độ không mic/camera.

Học sinh hoặc quản trị viên vào xem không khởi động giảng dạy. Giáo viên tải lại trang, đổi thiết bị hoặc rời trình duyệt không đặt lại thời gian bắt đầu. Khi giáo viên bấm **Kết thúc cho tất cả** và xác nhận, máy chủ ghi mốc kết thúc và chặn các lần cộng điểm danh tiếp theo.

## Ghi hình tự động

- Bộ ghi hình chỉ nhận buổi có mốc giáo viên đã vào dạy, được cho phép ghi hình và có cấu hình SFU/R2 hợp lệ. Không cần bấm nút ghi hình trong phòng.
- Giáo viên hoặc học sinh đóng trình duyệt không kết thúc buổi. Khi phòng tạm không còn ai, bộ ghi tiếp tục chờ cho đến khi lớp được kết thúc; phần thời gian trống có thể xuất hiện trong video. Giới hạn an toàn hiện có là tối đa 8 giờ ghi cho một buổi.
- Khi kết thúc lớp, bộ ghi phát hiện trạng thái trong chu kỳ kiểm tra khoảng 3 giây, đóng đoạn video và hoàn tất lưu R2. Việc dựng video, kết nối SFU và tải R2 có độ trễ thực tế; không đảm bảo khung hình video trùng chính xác đến mili giây với mốc điểm danh.
- Ghi hình vẫn chịu các điều kiện vận hành: bật R2, cho phép ghi buổi học, worker hoạt động, khóa SFU hợp lệ và dung lượng còn đủ. Tắt cấu hình ghi hình/R2, giới hạn 8 giờ hoặc lỗi hạ tầng là các ngoại lệ dừng/thử lại.

## Điểm danh

Thời gian được cộng từ các quan sát liên tiếp của máy chủ, trong khung giáo viên bắt đầu/kết thúc. Thời gian chờ trước giờ giáo viên vào không được cộng. Khi kết thúc lớp, máy chủ chốt thêm khoảng thời gian cuối cho người còn trực tuyến có heartbeat hợp lệ (không quá 45 giây). Người đã rời lớp hoặc mất kết nối quá lâu không được cộng khoảng này.

Các quy tắc vào muộn, ra sớm và tỷ lệ chuyên cần dùng khung giảng dạy thực tế thay cho lịch dự kiến một giờ. Quản trị vẫn có thể chỉnh khung chung của từng buổi để sửa nghiệp vụ; chỉnh khung không sửa mốc giảng dạy thực tế hay video. Báo cáo và Excel dùng chung cách tính. Các buổi cũ chưa có mốc mới giữ cách tính cũ, không tự viết lại lịch sử.

## Trình bày và bảng trắng

Chọn **Chú thích** ngay trên màn hình đang trình bày để vẽ trực tiếp; cũng có thể mở từ **⋮ → Viết lên màn hình chia sẻ**. Giáo viên có thể chú thích màn hình của lớp; học sinh tự chú thích phần mình trình bày, và cùng vẽ trên bảng/màn hình chung khi giáo viên cho phép.

Thanh icon có con trỏ, bút, đánh dấu, **mực biến mất sau khoảng 5 giây**, ghi chú cố định, hình dán, đường thẳng, mũi tên, hình chữ nhật, elip, văn bản và tẩy. Chọn ghi chú/chữ, nhập nội dung rồi chạm vị trí trên màn hình hoặc thêm ở giữa. Hình dán có các dấu sao, đồng ý, hoàn thành, hỏi và trái tim. Mực biến mất được đồng bộ cho cả lớp; thời điểm biến mất có thể lệch nhẹ theo đồng hồ thiết bị.

**Hoàn tác** áp dụng nét của mình. **Xóa nét trên trang** có xác nhận. **Dừng chú thích** đóng lớp viết vẽ chung; không dừng chia sẻ màn hình. **Tải ảnh PNG** lưu nội dung đang thấy. Trên điện thoại kéo ngang hàng icon để xem các công cụ còn lại.

Khi chia sẻ màn hình của mình, vùng xem trước mặc định hiện trạng thái **Bạn đang trình bày** để hạn chế hiệu ứng lặp vô hạn. Có thể chọn **Vẫn hiển thị màn hình của tôi** hoặc bấm **Chú thích** để xem và viết vẽ. Nên chia sẻ một thẻ hoặc cửa sổ riêng. Nét vẽ hiển thị trong phòng web, không điều khiển hay sửa ứng dụng gốc bên ngoài trình duyệt.

## Cập nhật và kiểm thử

Cần cập nhật cùng API, web và recorder. Schema 17 thêm `meeting_teaching_windows`, không xóa dữ liệu cũ. Cập nhật khi không còn buổi đang diễn ra qua quy trình sao lưu/kiểm tra thông thường. Sau cập nhật, tải lại trang phòng học để nhận giao diện mới.

Kiểm thử tự động bao gồm học sinh vào sớm, quản trị vào xem, giáo viên xác nhận vào phòng, nối lại không đổi mốc, rời phòng không kết thúc, chốt giờ cuối, chặn heartbeat sau kết thúc, báo cáo lấy mốc thực tế, phân quyền chú thích, icon/mobile, hình dán/ghi chú và mực biến mất. Bộ dựng video được kiểm tra với nguồn SFU mô phỏng; nghiệm thu Cloudflare/R2 thật cần một buổi học thực tế riêng.
