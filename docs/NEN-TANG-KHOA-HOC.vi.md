# Nền tảng khóa học / VIP — bản đang phát triển v0.9

## Tách riêng khỏi trường nội bộ

Tạo một đơn vị mới trên quản trị trung tâm, dùng domain và VPS mới. Chọn chế độ `academy` trong mục **Nền tảng / VIP**. Không đổi chế độ DTTX: quyền Live của học viên VIP khác quyền học sinh trường nội bộ. Hệ thống chặn đổi chế độ khi VPS đã kết nối; cần tạo đơn vị mới để tránh thay đổi quyền truy cập của người đang học.

Chưa triển khai thương mại trên VPS thật. Domain và VPS mới đang chờ chủ hệ thống cung cấp. Không đưa bản đang phát triển vào danh sách nâng cấp tự động của trường đang vận hành.

## Xem giao diện trên máy phát triển

Chạy frontend theo README rồi mở:

- Học viên: `http://127.0.0.1:5173/hoc?academy_demo=1&role=student`
- Giáo viên: `http://127.0.0.1:5173/hoc?academy_demo=1&role=teacher`
- Quản trị: `http://127.0.0.1:5173/hoc?academy_demo=1&role=admin`

Demo dùng dữ liệu minh họa, không tạo giao dịch, không kích hoạt VIP thật và chưa có video mẫu. Website giới thiệu được máy chủ Go dựng thành HTML; demo frontend không thay thế kiểm thử website có cơ sở dữ liệu.

## Luồng cấu hình trên môi trường mới

1. Chuẩn bị DNS, VPS Ubuntu, đối chiếu fingerprint SSH từ console của nhà cung cấp; cài qua quản trị trung tâm với bản nguồn đã qua kiểm thử. Không gửi khóa hay mật khẩu trong chat hoặc GitHub.
2. Chọn `academy`, cấu hình ngân hàng nhận tiền, số bài học miễn phí mỗi tháng (mặc định 4), SMTP có STARTTLS. Chỉ cấu hình payOS bằng khóa nhập trong trang quản trị riêng; nếu chưa có, dùng duyệt chuyển khoản thủ công.
3. Cấu hình SFU/TURN và R2. Bucket phải riêng tư; CORS chỉ cho domain học tập cần thiết với GET/PUT/HEAD và Content-Type. Kiểm tra upload ảnh, video và biên lai từ trình duyệt thật.
4. Tạo giáo viên, lớp, môn và phân công. Tạo khóa học liên kết môn học nếu cần học Live. Tạo gói có giá, số ngày và quyền Live.
5. Nhập nội dung giới thiệu, xuất bản khóa học, tải video MP4/WebM rồi xác nhận tải xong. Khi chưa xuất bản website, trang chủ hiển thị thông báo đang chuẩn bị.
6. Học viên đăng ký bằng mã email, điền hồ sơ và thêm ảnh sau khi đăng nhập. Mã email chỉ xác minh email; số điện thoại cá nhân/phụ huynh chưa được xác minh bằng OTP Zalo.
7. Đối soát ngân hàng trước khi duyệt VIP. Ảnh biên lai không tự động kích hoạt gói. Webhook tự động phải có chữ ký hợp lệ, khớp số tiền, đơn và tài khoản nhận. Duyệt lại cùng đơn không cộng thêm ngày lần nữa.

## Quy tắc quyền xem và lưu trữ

Hạn mức miễn phí tính theo **bài học khác nhau trong tháng**, múi giờ Việt Nam. Xem lại bài đã mở trong tháng không trừ lượt mới. Việc kiểm tra và cộng lượt nằm trong cùng giao dịch để không vượt hạn mức khi mở nhiều tab. Link video có thời hạn ngắn; quyền VIP được kiểm tra ở máy chủ.

Kho bài giảng nằm dưới tiền tố `academy/`, tách khỏi ghi hình phòng học. Không áp dụng quy tắc xóa toàn bucket sau 30 ngày: có thể xóa nhầm khóa học đang bán. Thời hạn ghi hình lớp vẫn cấu hình riêng. Chủ hệ thống cần kiểm tra lifecycle R2 trước khi nghiệm thu.

## Phần đã có và phần cần hoàn thiện trước thương mại

Đã có mã nguồn: website giới thiệu HTML, cổng ba vai trò, hồ sơ/email OTP, khóa học/gói, hạn mức xem, tiến độ, đơn/QR/biên lai, duyệt VIP, webhook payOS, bài tập/chấm điểm, thu chi và xuất Excel; cầu nối quản trị kinh doanh qua agent của VPS. Kết quả tác vụ quản trị được mã hóa tại trung tâm và chỉ owner đọc trong thời gian giới hạn.

Chưa nghiệm thu thực tế SMTP, payOS, R2 và hệ thống mới. Các phần chưa hoàn thiện gồm chuyển mã video nhiều độ phân giải/HLS, trailer tự động, OTP điện thoại, ngân hàng câu hỏi dùng lại, nhắc lịch tự động, hoàn tiền, bảng lương và quản lý dung lượng/xóa hàng loạt. Không coi bản này là toàn bộ sản phẩm đã sẵn sàng kinh doanh.

## Kiểm thử bắt buộc trước đưa vào sử dụng

- Chế độ trường vẫn giữ nguyên quyền cũ; chế độ academy chặn Live khi gói không hợp lệ.
- Học viên không truy cập hồ sơ, đơn, video của đơn vị khác; quản trị thiếu quyền tài chính không được duyệt đơn.
- Nhiều tab mở đồng thời vẫn đúng hạn mức; xem lại không trừ thêm lượt.
- Webhook sai chữ ký/sai tiền bị từ chối; webhook lặp lại và duyệt lại không gia hạn hai lần.
- Kiểm tra điện thoại, tải lên R2, phát video thật, email OTP, thanh toán thử và hoàn nguyên từ bản sao lưu.
- Chỉ triển khai commit đã qua CI; giữ PR ở trạng thái nháp khi còn chức năng hoặc nghiệm thu chưa xong.
