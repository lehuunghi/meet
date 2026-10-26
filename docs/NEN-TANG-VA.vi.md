# Nền tảng VA — quản trị tập trung v0.9.2

## Hai địa chỉ, một bảng quản trị

- `https://admin.tn.edu.vn`: bảng quản trị duy nhất cho chủ nền tảng; tạo giáo viên/học viên, lớp Live, môn và phân công, khóa học/video, gói VIP, đơn hàng, thu chi, nội dung website và cấu hình vận hành.
- `https://va.tn.edu.vn`: website giới thiệu và cổng học viên/giáo viên tại `/hoc`.

Không khôi phục hoặc đổi tên DTTX thành VA. Bộ cài tạo một đơn vị mới ở chế độ `academy` với database mới trên VPS đã được chủ hệ thống xác nhận cài lại Ubuntu. Luồng `academies/save` từ chối dùng bản ghi trường nội bộ cũ. Khi lưu xong, mở workspace toàn trang tại `/#academy/<id>` thay vì quay về bảng trường chung.

Tài khoản admin đăng nhập cổng học tập được dẫn về liên kết quản trị trung tâm; không hiển thị một bảng admin thứ hai tại VA. Giáo viên và học viên tiếp tục đăng nhập cổng học tập bằng tài khoản của mình. Cookie và mật khẩu không được chuyển giữa hai domain.

## Khởi tạo đúng chế độ

Agent nhận `platform_mode=academy`, ID đơn vị và origin quản trị. CLI khởi tạo tạo tài khoản đầu tiên, binding domain, cấu hình và website có tên thương hiệu. Kiểm thử CI chạy đúng lệnh `managed-config` trên database trống, kiểm tra website, chế độ academy, đăng nhập không mã trường và API quản lý tập trung; lỗi khởi tạo không được coi là cài đặt hoàn tất.

Bản cài đầu chưa có credential Cloudflare, email hoặc ngân hàng thì giữ các tích hợp đó ở trạng thái chưa cấu hình. Không điền token giả để làm giao diện báo sẵn sàng. Nhập secret tại bảng trung tâm; giá trị đã lưu được che. Agent đồng bộ qua HTTPS khoảng 5 giây khi rảnh, xử lý tiếp nhanh khi đang có tác vụ; thao tác nhạy cảm chờ hết Live.

## Cấu hình sau khi đăng nhập trung tâm

1. **Thông tin nền tảng:** tên thương hiệu và thông tin ban đầu. Không cần mã trường trên màn hình đăng nhập.
2. **Email & thanh toán:** SMTP STARTTLS để gửi mã đăng ký, tài khoản ngân hàng/QR, payOS tùy chọn. Hạn mức miễn phí mặc định 4 bài khác nhau mỗi tháng.
3. **SFU:** thêm app và secret, đặt trọng số cân bằng theo lớp. Không dùng cấu hình TURN.
4. **R2 / Backup:** bucket riêng tư, khóa R2, thời hạn ghi hình phòng học mặc định 30 ngày. Kho bài giảng `academy/` tách khỏi quy tắc xóa bản ghi. Chỉ bật backup theo lịch khi R2 hợp lệ.
5. **Giáo viên**, **Lớp Live & phân công:** tạo giáo viên, lớp, thêm môn nhiều dòng và phân công giáo viên chính/trợ giảng.
6. **Khóa học & video:** tạo khóa học, liên kết môn Live, tải MP4/WebM trực tiếp từ trình duyệt lên R2, xác nhận file và xem thử. CORS R2 cho đúng origin VA và origin quản trị đã được agent gắn; không lấy origin tùy ý từ yêu cầu công khai.
7. **Gói VIP**, **Đơn hàng**, **Học viên**, **Thu chi:** đối soát thanh toán trước khi duyệt. Tài khoản học viên tạo thủ công hoàn thiện hồ sơ và xác thực email tại cổng học tập.
8. **Website giới thiệu:** chỉnh tiêu đề, giới thiệu và trạng thái xuất bản. Nội dung đánh giá/giáo viên/bài viết chỉ công bố khi có dữ liệu được phép dùng.

Tài khoản khởi tạo và hướng dẫn truy cập riêng được bàn giao ngoài Git. Không dùng mật khẩu root làm mật khẩu quản trị ứng dụng.

## Phạm vi nghiệm thu

Kiểm tra cài mới và đồng bộ trước; sau khi có credential thật mới nghiệm thu email OTP, cuộc gọi nhiều người, upload/phát video R2, lifecycle 30 ngày và thanh toán. Video hiện phát MP4/WebM bằng URL có hạn; pipeline HLS/trailer tự động và các mục thương mại nâng cao còn trong lộ trình ở `NEN-TANG-KHOA-HOC.vi.md`. Kiểm thử máy mới không được coi là đã kiểm chứng các tích hợp còn chưa cấu hình.
