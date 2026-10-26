# Xóa vĩnh viễn nền tảng và dữ liệu VPS

Phiên bản trung tâm 0.13.1. Chỉ chủ hệ thống có quyền thực hiện.

1. Chọn đúng đơn vị trong admin.tn.edu.vn → **Hoạt động / Xóa**.
2. Tạm ngưng, chờ VPS xác nhận đã tạm ngưng và không còn buổi học trực tiếp.
3. Đưa đơn vị vào thùng rác. Bước này vẫn giữ dữ liệu và có thể khôi phục.
4. Trong thùng rác, mở lại **Hoạt động / Xóa**. Nhập đúng domain, `XOA VINH VIEN`, mật khẩu quản trị trung tâm và mã 2FA nếu đã bật.
5. Nhập thông tin SSH root của VPS và fingerprint đã đối chiếu từ Console/VNC. Đánh dấu xác nhận xóa dữ liệu, bấm **Xóa vĩnh viễn cả VPS và trung tâm**.
6. Theo dõi màn hình tiến độ. Chỉ khi VPS gỡ thành công, đơn vị mới biến mất khỏi trung tâm.

## Phạm vi xóa

- Trên VPS: các container riêng của Meet/recorder, volume MySQL, Redis và ghi hình tạm; thư mục ứng dụng `/opt/meet`; cấu hình, khóa, bản sao lưu cục bộ và trạng thái cập nhật/agent; dịch vụ định kỳ và cấu hình domain riêng của Meet.
- Tại trung tâm: đơn vị, cấu hình mã hóa, token, tác vụ, thông tin chuyển VPS và bản sao di chuyển cục bộ của đơn vị đó.
- Giữ Ubuntu, Docker, Caddy, các ứng dụng khác và dữ liệu trên R2. R2 có thể dùng chung; chức năng này không xóa video hoặc bản sao lưu trên R2. Giữ biên nhận xóa tối thiểu và nhật ký kiểm toán, không chứa mật khẩu/token.

## Chặn xóa nhầm và xử lý lỗi

Không dựa riêng vào IP: kiểm tra fingerprint SSH, mã đơn vị, trung tâm quản lý, domain, mã trường và dữ liệu thực tế trên VPS. VPS đã cài lại cho đơn vị khác sẽ bị từ chối. Không có tùy chọn bỏ qua kiểm tra này.

Từ chối nếu còn buổi live, chưa tạm ngưng, có tác vụ khác, dữ liệu Docker dùng chung hoặc đường dẫn bất thường. Thông tin SSH chỉ lưu mã hóa trong lúc tác vụ chạy và được loại khỏi tác vụ sau khi hoàn tất/thất bại. Mật khẩu quản trị và mã 2FA không lưu trong tác vụ.

Nếu mất kết nối giữa chừng, đơn vị vẫn trong thùng rác. Kiểm tra nguyên nhân rồi nhập lại thông tin xác nhận/SSH để thử tiếp. Biên nhận trên VPS hỗ trợ tiếp tục phần còn lại nhưng không cho phép xóa một nền tảng mới đã thay thế nền tảng cũ. Xóa vĩnh viễn thành công không thể hoàn tác bằng nút khôi phục thùng rác.
