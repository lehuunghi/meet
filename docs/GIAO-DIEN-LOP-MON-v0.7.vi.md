# Giao diện học theo lớp/môn — v0.7.0

## Phạm vi đã thay đổi

- Học sinh chỉ có Môn học, Điểm danh & video, Tài khoản. Môn có buổi đang học hoặc giáo viên đã chuẩn bị lên đầu. Chỉ buổi live có nút vào lớp; scheduled hiển thị đang chờ. Cập nhật trạng thái trong trang mỗi 10 giây, không gửi email/SMS/push bên ngoài.
- Giáo viên mở bảng lớp được phân công, chọn Xem môn học, rồi Chuẩn bị dạy. Không có form Tạo buổi học riêng. Nút chuẩn bị tạo một buổi scheduled hoặc tái sử dụng buổi scheduled/live của môn, có khóa giao dịch để bấm đồng thời không tạo trùng. Giáo viên chính và trợ giảng được phân công có quyền; học sinh/ngoài lớp/trường không được chuẩn bị.
- Admin có cùng bảng lớp → môn; tài khoản có quyền học vụ thấy cả lớp chưa có môn. Học vụ/import/phân công vẫn ở Quản trị. Báo cáo có chọn lớp và bảng môn, tổng số buổi; mỗi môn mở danh sách từng buổi, thống kê riêng và video trong cùng khu vực. Menu Bản ghi bài học được bỏ; bookmark cũ chuyển về khu vực báo cáo chung.
- Buổi học có nút xem video; chỉ phát các bản ghi đã hoàn tất, chưa hết hạn, còn quyền truy cập. Khi R2 đang tắt/chưa có video, không tạo file minh họa giả. Demo chỉ hiển thị dữ liệu mẫu và thông báo chưa có video thật.
- Mật khẩu giáo viên/học sinh: tối thiểu 6 ký tự Unicode, tối đa 72 byte theo giới hạn bcrypt. Áp dụng tạo/import/sửa, tự đổi và phục hồi. Admin vẫn tối thiểu 12 ký tự. Mật khẩu đang lưu không bị đổi hàng loạt.
- Liên kết phòng dạng `https://domain/beyney`: sáu chữ thường/số ngẫu nhiên bằng crypto/rand, UNIQUE tại database, thử lại nếu va chạm, ổn định cho mỗi buổi. Tránh mã trùng thư mục assets. Link không thay thế đăng nhập hay quyền lớp/trường; link cũ `?room=...` vẫn được hỗ trợ.

## Dữ liệu và vận hành

Schema 6 thêm `meeting_links`, không đổi ID nội bộ, tài khoản hoặc raw presence. Catalog trả tổng số buổi và môn đã chuẩn bị; danh sách buổi có phân trang 200 buổi/trang, nên không chỉ dựa vào 200 buổi chung của trường để suy ra môn nào đang học. Một buổi kết thúc vẫn giữ link và dữ liệu báo cáo.

Không tự kết thúc buổi thật để nâng cấp. Dùng quy trình backup và updater đúng SHA đã đạt CI. Nếu R2 chưa cấu hình, phần ghi hình/backup R2 và nghiệm thu nâng cấp có backup từ xa vẫn chưa hoàn tất. Bản vá web media có thể được triển khai riêng từ một SHA đã kiểm thử, giữ image trước để rollback; điều này không có nghĩa API/schema đã được nâng theo.

## Kiểm thử DTTX

Trên VPS thật đã xác minh ứng dụng/MySQL/Redis, đăng ký agent, đồng bộ revision 2/2, khởi tạo trường và admin, khóa setup cũ (404), HTTPS công khai hợp lệ. Domain bị hạn mức cấp lại chứng chỉ Let's Encrypt sau cài lại máy; operator cấu hình ZeroSSL ACME để hoàn tất HTTPS, không tắt kiểm tra chứng chỉ hay dùng TLS nội bộ.

Hai tài khoản kiểm thử riêng đã nhận audio bytes và video decoded frames qua SFU thật bằng camera/micro tổng hợp. Phát hiện STUN không phản hồi khiến lấy ICE bị treo; bản vá giữ TURN đã cấu hình và dùng kết nối trực tiếp khi chỉ có STUN, không tuyên bố thay thế TURN trên mọi mạng. Không chứng nhận thiết bị vật lý hay mạng của mọi học sinh. R2 đang tắt và TURN chưa thêm tại thời điểm kiểm tra, nên không tuyên bố đã nghiệm thu ghi video R2 hoặc relay TURN.

Các buổi kiểm thử có tên KIEM THU; chỉ kết thúc các buổi do bài kiểm tra tạo, không kết thúc buổi người dùng. Không đưa tài khoản/mật khẩu/token kiểm thử vào repository.
