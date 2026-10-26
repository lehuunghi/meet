# Bộ điều khiển phòng học — v0.10.0

Áp dụng cùng một phòng gọi cho trường học và nền tảng khóa học/VIP. Chưa bật phụ đề, dịch, ghi chú hoặc chức năng AI.

## Vào và sử dụng phòng

- Trước khi vào: chọn biểu tượng mic/camera; có thể tắt cả hai để chỉ nghe. Thiết bị mặc định lấy từ trình duyệt, không bắt buộc chọn thiết bị.
- Trong phòng: mic, camera, chia sẻ màn hình, giơ tay, biểu cảm, người tham gia, trò chuyện và khảo sát. Điện thoại giữ các nút chính ở dưới, các chức năng còn lại trong nút ba chấm.
- Chia sẻ màn hình dùng hộp chọn an toàn của trình duyệt. Học sinh chỉ được trình bày khi giáo viên cho phép. Khả năng chia sẻ trên điện thoại phụ thuộc trình duyệt/hệ điều hành; nếu không hỗ trợ sẽ báo rõ.
- Chọn Ghim tại ô hình để tập trung vào một người; màn hình trình bày được ưu tiên tự động. Phản chiếu chỉ thay đổi hình tự xem, không lật hình gửi cho người khác.
- Ba chấm → Cài đặt thiết bị để đổi mic, camera, loa. Đổi loa chỉ khả dụng khi trình duyệt hỗ trợ. Không tự bật mic/camera đang tắt.
- Ctrl/⌘ D bật/tắt mic, Ctrl/⌘ E bật/tắt camera trong cuộc gọi; không chiếm phím khi đang nhập tin nhắn.
- Nếu trình duyệt chặn âm thanh tự phát, chọn Bật âm thanh trên ô hình. Khi mất mạng hệ thống thử kết nối lại; làm mới trang vẫn khôi phục phòng còn hoạt động bằng phiên đăng nhập hợp lệ.

## Quyền giáo viên

Điều hành phòng bao gồm duyệt người chờ, mời ra, yêu cầu tắt mic, hạ tay và bật/tắt quyền chat, trình bày. Không thể bật mic hoặc camera của người khác từ xa. Yêu cầu tắt mic không phải khóa mic vĩnh viễn.

Nút Rời lớp cho giáo viên hai lựa chọn: chỉ mình rời đi hoặc kết thúc cho tất cả. Kết thúc cần xác nhận lần nữa; chọn Ở lại hoặc Escape hủy thao tác. Học sinh chỉ được rời riêng mình.

Phòng và bộ ghi máy chủ đã bật tiếp tục khi giáo viên đóng trình duyệt. Camera/mic của thiết bị đã đóng trình duyệt dừng; không thể tiếp tục truyền từ thiết bị đó. Khi kết thúc cho tất cả, bộ ghi dừng và hoàn tất lưu theo cấu hình R2. Phòng chỉ hiện chỉ báo ghi hình để người tham gia biết, không hiện bảng điểm danh hoặc danh sách bản ghi.

## Kiểm chứng

Kiểm thử trình duyệt bao gồm tách quyền giáo viên/học sinh, phòng chờ không mở thiết bị, tắt quyền trình bày, ghim hình, phản ứng, khảo sát, xác nhận kết thúc, menu di động và khôi phục khi làm mới. Các kiểm thử giả lập API chỉ xác minh hành vi giao diện; nghiệm thu truyền âm thanh/video và ghi R2 thực cần hai trình duyệt với Cloudflare/R2 được cấu hình đúng.

Đây là bộ gọi học với các thao tác tương tự Google Meet, không phải sản phẩm Google và không tuyên bố có toàn bộ tính năng của Google Meet.
