# Rà soát và bản sửa v0.26.0

## Các vấn đề đã sửa

1. **Mất nét viết vẽ khi mạng lỗi tạm thời:** hàng chờ giữ nguyên ID và phiên bản nét, tự gửi lại có giãn nhịp khi gặp lỗi mạng/408/429/5xx. Máy chủ vẫn kiểm tra quyền, trang và phiên bản; lỗi cấm hoặc trang đã đổi không bị gửi lại vô hạn. Thời gian chờ một yêu cầu được giới hạn 15 giây.
2. **Thông báo lỗi không tự hết:** lỗi tải bảng và lỗi gửi nét được theo dõi riêng. Tải lại thành công xóa lỗi tải; nét gửi thành công xóa cảnh báo hàng chờ. Không xóa nhầm thông báo một thao tác điều khiển bị từ chối.
3. **Bắt đầu chia sẻ nhưng bảng không chuyển:** phòng thử lấy lại thông tin màn hình mới trong một khoảng ngắn khi mạng hoặc dữ liệu publication đến chậm. Nếu giáo viên chọn mở bảng sau đó, lựa chọn mới được ưu tiên, không bị yêu cầu cũ chuyển ngược lại.
4. **Yêu cầu tải bảng bị chồng khi máy chủ chậm:** chỉ một lượt polling định kỳ được chạy tại một thời điểm. Lỗi từ gateway trả HTML vẫn giữ mã HTTP để giao diện xử lý đúng, thay vì báo lỗi phân tích JSON khó hiểu.
5. **Nhãn icon cũ còn hiện sau khi bấm:** tooltip được đóng sau thao tác, tránh nhãn Bật/Tắt mic/camera bị giữ sai trạng thái. CSS ẩn ô trình bày ngay khi bảng đang mở, kể cả ô vừa xuất hiện.
6. **Nâng cấp bỏ sót bộ ghi hình:** bộ cập nhật mới dựng/kiểm tra và nâng cấp cả recorder đã cài cùng web/API. Giữ nguyên mức đồng thời và volume chứa video đang chờ. Nếu worker mới không chạy ổn định, quá trình dừng và phục hồi bản trước. Khi hoàn tác, worker cũ được tạo ở trạng thái chưa chạy, lưu ID mới vào nhật ký rồi chỉ chạy lại sau khi mở khóa bảo trì; phiên bản updater cũ vẫn đọc được bước phục hồi này.

Hàng chờ nét nằm trong bộ nhớ của trang hiện tại. Khi còn cảnh báo chưa gửi, không tải lại hoặc rời lớp; trình duyệt được yêu cầu cảnh báo khi đóng/tải lại trang có nét chờ. Đây không phải chế độ làm việc ngoại tuyến có lưu lâu dài. Lỗi quyền, buổi đã kết thúc hoặc trang đã đổi được báo và dừng gửi nét cũ để bảo vệ nội dung chung.

## Cập nhật an toàn

Chỉ thay ứng dụng/recorder khi không còn buổi đang diễn ra. Quy trình vẫn yêu cầu phiên bản GitHub đã qua CI, checkout sạch, sao lưu mã hóa đã xác minh, khóa ghi và kiểm tra sức khỏe. Recorder đã cài theo bộ chuẩn được cập nhật tự động; hệ thống không tự cài thêm recorder vào máy chưa dùng ghi hình.

Recorder tùy chỉnh, nhiều container trong cùng project, hoặc thay đổi volume/network/cấu hình runtime cần người vận hành kiểm tra; updater dừng trước khi thay dữ liệu. Worker mới tôn trọng khóa bảo trì, không tự tải video ghi dở hay bắt đầu ghi khi dữ liệu đang bị khóa.

Máy còn updater đời cũ cần được người vận hành nâng cấp driver một lần. Sau khi đã chạy bộ mới, các lượt nâng cấp tiếp theo từ quản trị dùng cùng quy trình. Không sửa mã nguồn trực tiếp trong checkout đang chạy để né kiểm tra an toàn.

## Phạm vi kiểm tra và giới hạn

Bộ kiểm thử bao phủ phân quyền và dữ liệu giữa các trường; tài khoản/VIP/thanh toán; nội dung website; điểm danh; chuyển bảng/trình bày; mạng chậm/gián đoạn; mobile; sao lưu/phục hồi và nâng cấp. Kiểm thử Docker bộ ghi dùng tiến trình thay thế để kiểm tra việc thay image, giữ volume, phát hiện worker lỗi và tương thích nhật ký hoàn tác; kiểm thử compositor dùng nguồn màn hình mô phỏng riêng.

Kiểm tra website đang triển khai và nhật ký chỉ đọc không chứng minh toàn bộ chất lượng cuộc gọi. Nghiệm thu cuối vẫn cần cuộc gọi SFU/R2 thật trên nhiều thiết bị/mạng, email qua SMTP thực tế, thanh toán/webhook thực tế và đo tải với số lớp dự kiến. Các thao tác đó không được suy diễn từ dữ liệu demo hoặc tự tạo giao dịch/gửi thư cho học viên khi rà soát.

Không thể khẳng định phần mềm hoàn toàn không còn lỗi. Các lỗi đã tái hiện cần có kiểm thử hồi quy; các giới hạn nghiệm thu còn lại phải được ghi rõ.
