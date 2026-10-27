# Ngôn ngữ, gói VIP, tài khoản và đăng ký thành viên

Phiên bản 0.15.1, schema 11. Các mục này quản lý trên website VA, không nằm trong trung tâm hạ tầng.

## Ngôn ngữ & câu chữ

Mở **Quản trị website → Ngôn ngữ & câu chữ** (`/quan-tri/website?muc=ngon-ngu`). Tìm chữ mặc định hoặc nội dung thay thế, sửa cột bên phải rồi bấm **Lưu ngôn ngữ**. Các trang khác nhận câu chữ khi tải lại; trang giới thiệu có thể được lưu tạm tối đa 60 giây.

Danh mục bao gồm chữ giao diện trang công khai, đăng nhập/đăng ký, học sinh, giáo viên, quản trị, phòng học và thông báo hệ thống. Nội dung riêng như tên khóa học, tên bài, bài viết, hồ sơ giáo viên và chính sách vẫn sửa tại chuyên mục nội dung tương ứng. Các ô nhập, đường dẫn, quyền truy cập và dữ liệu thanh toán không đổi theo nhãn hiển thị. Mục chỉnh ngôn ngữ giữ chữ mặc định để có thể khôi phục khi tùy chỉnh nhầm.

- Để trống bản thay thế hoặc bấm **Mặc định** để trả lại một mục.
- **Khôi phục mặc định** rồi **Lưu ngôn ngữ** để trả lại toàn bộ chữ giao diện.
- Giữ `%d`, `%s` trong thông báo có tham số; ví dụ `Dòng %d bị lỗi` có thể đổi thành `Dòng số %d cần kiểm tra`.
- Mỗi trang có 40 mục; tìm kiếm lọc toàn danh mục, không chỉ trang đang mở.
- Chỉ quản trị có quyền Nội dung được lưu. Nếu người khác đã lưu trước, hệ thống yêu cầu tải lại để tránh ghi đè. Cấu hình được lưu trong cơ sở dữ liệu và đi cùng bản backup.

## Gói VIP

Mở **Thanh toán → Quản lý gói VIP**, hoặc **Quản lý nội dung** nếu có cả quyền Nội dung và Tài chính.

Có thể thêm, sửa tên/giá/thời hạn/quyền Live; **Ngưng bán**, **Mở bán lại** hoặc **Xóa gói**. Xóa yêu cầu nhập đúng tên gói. Gói bị xóa biến mất khỏi danh mục quản trị và danh mục bán, không được mở lại bằng nút sửa. Hệ thống giữ bản tham chiếu của gói để đối chiếu các đơn cũ.

Đổi giá hoặc xóa gói không đổi giá, số ngày, quyền lợi đã chốt trong đơn cũ và không thu hồi VIP đã cấp. Ngưng bán chặn mua mới; các đơn đã tạo trước đó vẫn được xử lý theo thông tin đã chốt.

## Xóa tài khoản

Mở **Tài khoản và phân quyền → Xóa tài khoản**, nhập đúng email để xác nhận. Quản trị gốc và tài khoản đang đăng nhập được bảo vệ. Quản trị giới hạn quyền không được xóa quản trị có quyền vượt quá mình.

Xóa sẽ thu hồi phiên đăng nhập, mật khẩu, 2FA, hồ sơ cá nhân, phân lớp và phân công giảng dạy; tài khoản biến mất khỏi danh sách. Tham chiếu trong lịch sử học và thanh toán được giữ bằng tên ẩn danh để không làm hỏng báo cáo. Ảnh đại diện khi đăng ký được xóa khỏi cơ sở dữ liệu; ảnh riêng trên R2 được đưa vào hàng đợi dọn dẹp, chỉ xóa trong đúng tài khoản/bucket đã ghi nhận. Video thuộc lớp học/khóa học vẫn thuộc tài nguyên của đơn vị.

## Đăng ký đầy đủ và xác thực bằng liên kết

Form đăng ký hiển thị đầy đủ email, mật khẩu tối thiểu 6 ký tự, họ tên, ngày sinh dd/mm/yyyy, địa chỉ, trường học, số điện thoại cá nhân, số điện thoại phụ huynh và ảnh đại diện. Thiếu thông tin bắt buộc hoặc dữ liệu không hợp lệ sẽ không tạo tài khoản. Đồng ý nhận marketing là lựa chọn riêng, không bắt buộc.

Ảnh PNG/JPEG tối đa 2 MB được thu nhỏ trước khi gửi; máy chủ kiểm tra lại nội dung và lưu ảnh nhỏ riêng cho tài khoản, không yêu cầu R2 để hoàn tất đăng ký.

Sau khi tạo, tài khoản có thể đăng nhập ngay, email ở trạng thái chờ xác thực. Hệ thống xếp hàng gửi thư có liên kết hiệu lực 24 giờ. Người dùng bấm một lần, trang xác thực tự xử lý; không có ô nhập mã và không tự đăng nhập bằng liên kết đó. Mở lại liên kết đã xác thực trong thời hạn chỉ báo thành công, không cấp thêm quyền. Mua gói vẫn yêu cầu email đã xác thực.

Liên kết dùng token ngẫu nhiên, chỉ lưu bản băm để kiểm tra; bản dùng cho hàng đợi được mã hóa và xóa sau khi gửi. Token nằm sau `#`, không đi vào URL yêu cầu máy chủ hoặc referrer; trang loại token khỏi thanh địa chỉ trước khi xác thực. Bản backup cần giữ `runtime-config/account-key`, như cơ chế backup hiện có.

## Cấu hình email và theo dõi thư

Trong **Cài đặt → Email & thanh toán**, nhập SMTP dùng STARTTLS (thường cổng 587), email gửi, tài khoản và mật khẩu/khóa ứng dụng do nhà cung cấp cấp. Nhập bí mật trên trang riêng, không đưa vào mã nguồn hoặc chat.

Mục **Email xác thực thành viên** cho biết đã có cấu hình SMTP hay chưa, số thư đang chờ và cần thử lại. Khi SMTP tạm lỗi, tài khoản và hồ sơ đã tạo không mất; hệ thống tự thử lại sau 5 phút. Sau khi sửa cấu hình có thể bấm **Thử gửi lại email đang chờ**. Khi liên kết hết hạn hoặc chưa nhận thư, người dùng nhập email trên trang đăng nhập và bấm **Gửi lại liên kết xác thực email**; phản hồi không tiết lộ tài khoản có tồn tại hay không.

Phần **Tài khoản của bạn / Hồ sơ học viên** chỉ hiển thị trạng thái email, không còn nút gửi mã và form nhập mã. 2FA đăng nhập vẫn là cơ chế riêng, chỉ hỏi sau khi mật khẩu đúng.

Giới hạn chống gửi lặp được tính theo email và đơn vị, không gộp tất cả học sinh vào địa chỉ của reverse proxy. Mỗi email tối đa 8 yêu cầu/15 phút; mỗi đơn vị tối đa 1.000 yêu cầu/15 phút.
