# Học vụ và lịch sử — v0.33.1 / schema 20

Trong **Lớp & giáo viên → Năm học & lịch dạy** (trường nội bộ: **Quản trị → Năm học & lịch dạy**):

1. Tạo năm học/học kỳ, nhập ngày dd/mm/yyyy; gán cho lớp. Khóa kỳ sau khi kết thúc các buổi live. Lớp thuộc kỳ đã khóa không chuẩn bị/mở thêm buổi. Mỗi buổi lưu kỳ tại thời điểm mở, không đổi theo việc gán lại lớp về sau.
2. Chuyển lớp bằng ID/mã SV, lớp nguồn, lớp đích và lý do. Hai lớp phải hoạt động, không có buổi live. Giao dịch chuyển cùng lúc ghi lịch sử, thêm lớp mới và gỡ lớp cũ; không gỡ các lớp khác của học sinh.
3. Danh sách học sinh/giáo viên được chốt khi mở buổi. Học sinh mới vào lớp không nhận vắng ở buổi đã chốt trước đó; học sinh chuyển lớp vẫn xem được báo cáo/video buổi cũ theo quyền nền tảng. Giáo viên cũ có quyền đọc những buổi đã kết thúc mà mình được lưu phân công. Quyền điều hành buổi mới vẫn theo phân công hiện tại.
4. Dữ liệu có trước bản nâng cấp không chứa toàn bộ lịch sử chuyển lớp/phân công. Migration chỉ tái dựng từ dữ liệu đang có, đánh dấu **lịch sử kế thừa**; không khẳng định đã khôi phục được danh sách thật của mọi buổi cũ. Excel có cột nhận diện để đối chiếu.
5. Lập lịch theo múi giờ Việt Nam (UTC+7), không phụ thuộc múi giờ thiết bị, có giờ bắt đầu/kết thúc (tối đa 8 giờ). Chặn trùng lớp, giáo viên chính hoặc trợ giảng. Buổi chưa bắt đầu có nút hủy. Khi mở buổi thực tế cũng chặn lớp/giáo viên chính đang dạy buổi khác; phòng nhóm tách khỏi phép kiểm tra này. Giáo viên/trợ giảng dùng chung giữa các môn cũng được kiểm tra trùng lịch.
6. Buổi đang học mất kết nối giáo viên được gắn cảnh báo; quản trị kiểm tra rồi xác nhận kết thúc. Không tự kết thúc vì gián đoạn mạng. Buổi chuẩn bị quá xa/đã cũ không tự được tái sử dụng khi giáo viên bấm chuẩn bị buổi mới.
7. Tra cứu tài khoản theo tên, email, mã SV hoặc ID, 50 dòng/trang. Các danh sách cũ dùng phân trang máy chủ và tự lấy trang tiếp, không âm thầm bỏ dữ liệu sau 1.000 dòng. ID giữ tối thiểu bốn số; sau 9999 tăng số chữ số, không tái sử dụng mã đã cấp.
8. Video Meet dùng bucket đã lưu cùng bản ghi. Khóa R2 hiện tại phải còn quyền đọc bucket cũ trong cùng tài khoản Cloudflare. Chuyển sang tài khoản lưu trữ khác cần di chuyển dữ liệu/credential riêng, không chỉ đổi Account ID.

Điểm danh đo thời gian kết nối được máy chủ ghi nhận, không chứng minh học sinh đang nhìn màn hình. Giữ mốc giáo viên thực sự bắt đầu/kết thúc, ngưỡng vào muộn/ra sớm và phần trăm theo chính sách của trường. Ghi hình phía máy chủ vẫn có giới hạn an toàn 8 giờ và cần bộ ghi/R2 hoạt động; quyền VIP chỉ áp dụng chế độ academy.

## Cảnh báo trung tâm

Danh sách đơn vị hiển thị cảnh báo khi agent mất liên lạc trên 3 phút; dung lượng trống dưới 3 GB; chưa có sao lưu được xác minh trong chu kỳ cộng 2 giờ; hoặc nâng cấp lỗi/cần phục hồi. Cảnh báo trên bảng quản trị không đồng nghĩa đã gửi email/SMS khi quản trị đang ngoại tuyến.

Diễn tập phục hồi dùng luồng **Backup / Chuyển VPS → chuẩn bị VPS đích**, kiểm tra dữ liệu trên đích rồi mới chuyển domain. Không chạy thử ghi đè cơ sở dữ liệu sản xuất. Lần phục hồi VA sang VPS mới đã kiểm tra giải mã, hash, số dòng, cấu hình, video R2 và tạo bản sao lưu mới; vẫn cần diễn tập định kỳ trên VPS riêng.

## Nâng cấp và kiểm thử

Schema 20 chỉ thêm bảng; không sửa dữ liệu điểm danh đã ghi. Chạy bằng bộ nâng cấp có snapshot và yêu cầu không có buổi live. Giữ bản sao lưu/key ở nơi riêng, không đưa credential vào Git.

Kiểm thử tích hợp kiểm tra học sinh thêm sau buổi, chuyển lớp, quyền xem của giáo viên cũ, khóa kỳ, lịch trùng và ký URL bucket cũ. Kiểm thử giao diện không tạo dữ liệu kinh doanh thật. Năng lực nhiều lớp/ghi đồng thời phải đo riêng; VPS 1 GB RAM không phải năng lực đã được chứng minh.
