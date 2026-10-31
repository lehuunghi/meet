# Quản trị trung tâm: tiến độ cài đặt, phục hồi và tài khoản

Mở https://admin.tn.edu.vn, chọn đơn vị cần vận hành. Tài khoản ở đây độc lập với tài khoản quản trị trên VA.

## Theo dõi cài đặt

Trong **Cài đặt / Nâng cấp**, nhập thông tin SSH và fingerprint đã đối chiếu rồi bấm cài đặt. Màn hình theo dõi tự mở; có thể đóng và mở lại tại **Lịch sử → Mở màn hình cài đặt**. Thanh tiến độ phản ánh giai đoạn đã đạt (DNS, SSH, Docker, dựng ứng dụng, dữ liệu, HTTPS, liên kết và áp dụng cấu hình), không biểu thị phần trăm thời gian còn lại. Giai đoạn áp dụng cấu hình chỉ hoàn tất khi agent xác nhận. Nhật ký chỉ chứa thông báo cố định đã lọc; không hiển thị terminal thô, mật khẩu, token hoặc link setup.

## Chọn bản sao lưu để phục hồi

1. Client cần v0.13.0 / giao thức quản trị 3. Nâng cấp an toàn trước nếu bảng quản trị yêu cầu.
2. Vào **Phục hồi sao lưu → Đọc danh sách từ VPS**. Danh sách gồm tối đa 100 bản gần nhất trên R2 và bản hoàn tác cục bộ từ những lần nâng cấp. **Backup ngay** tạo một bản mới; xem kết quả ở Lịch sử rồi đọc lại danh sách.
3. Tại **Hoạt động / Xóa**, tạm ngưng đơn vị và chờ VPS xác nhận. Không thực hiện khi còn lớp đang học.
4. Chọn bản, nhập lại domain, mật khẩu quản trị trung tâm và mã 2FA nếu tài khoản đã bật; xác nhận việc thay thế dữ liệu.
5. Hệ thống giải mã và kiểm tra toàn vẹn, thử nhập vào cơ sở dữ liệu tạm và kiểm tra đúng đơn vị / phiên bản dữ liệu. Chỉ sau khi bản hoàn tác hiện tại được tạo và xác minh mới thay dữ liệu thật. Lỗi sau khi ghi dữ liệu sẽ dùng bản hoàn tác; lỗi phục hồi hoàn tác giữ khóa ghi để vận hành xử lý.
6. Sau thành công, VPS **vẫn tạm ngưng**. Kiểm tra dữ liệu rồi kích hoạt lại. Phiên đăng nhập cũ của website bị hủy.

Phục hồi này thay cơ sở dữ liệu, cấu hình kinh doanh và khóa mã hóa 2FA của tài khoản website. Giữ nguyên phiên bản mã nguồn hiện tại, domain, thông tin liên kết quản trị, SFU, R2 và chính sách hạ tầng đang dùng. Kho video R2 không bị hoàn tác/xóa; video đã bị xóa khỏi R2 không được tái tạo từ bản sao cơ sở dữ liệu. Giới hạn hiện tại: 512 MiB mỗi snapshot theo bộ sao lưu gốc. Khóa giải mã `/etc/meet/recovery.key` phải còn đúng; không gửi khóa trong chat và không nhập vào giao diện. Chuyển sang VPS mới dùng mục **Backup / Chuyển VPS** và bộ sao lưu di chuyển riêng.

## Email, mật khẩu và 2FA của quản trị trung tâm

- Vào **Bảo mật tài khoản → Email & mật khẩu đăng nhập trung tâm**. Nhập email mới hoặc giữ nguyên, nhập mật khẩu hiện tại và mật khẩu mới nếu cần. Nếu đã bật 2FA, cần thêm mã ứng dụng hoặc mã khôi phục chưa dùng. Mật khẩu mới từ 12–72 byte. Lưu xong phải đăng nhập lại; mọi phiên cũ bị thu hồi.
- Trong cùng màn hình, chọn **Thiết lập 2FA**, nhập mật khẩu, thêm khóa vào ứng dụng TOTP rồi điền mã để bật. Chỉ sau khi mã hợp lệ, 2FA mới có hiệu lực. Lưu các mã khôi phục ở nơi riêng; mỗi mã dùng một lần. Bước 2FA xuất hiện sau khi email/mật khẩu đúng.
- Chủ hệ thống dùng **Quản trị trung tâm → Chỉnh sửa** để thay email, đặt mật khẩu hoặc phân quyền tài khoản trung tâm khác. Không làm thay đổi tài khoản học sinh/giáo viên của VA.

Không tự đổi email/mật khẩu hoặc bật 2FA cho chủ hệ thống khi triển khai mã nguồn. Người dùng thực hiện trong trang riêng để giữ bí mật và lưu mã khôi phục.
