# Trạng thái trường, chuyển VPS và API — v0.9.1

## TURN

Không còn cấu hình TURN trong quản trị trung tâm và trang setup. Client v0.9.1 chỉ cấp STUN và kết nối SFU, không gọi API tạo credential TURN. Trường `turn` cũ được đọc để tương thích snapshot nhưng bị bỏ khi lưu/áp dụng. Máy đang chạy phiên bản cũ cần nâng cấp mới nhận thay đổi runtime; việc cập nhật trung tâm không tự thay mã trên tất cả VPS.

## Tạm ngưng, xóa và khôi phục

Mở chi tiết đơn vị → **Hoạt động / Xóa** (quyền owner).

- **Tạm ngưng:** VPS chặn truy cập học và đăng nhập, giữ nguyên MySQL, R2 và nguồn. Có buổi Live thì chờ kết thúc; không ép kết thúc lớp. Phân biệt trạng thái yêu cầu tại trung tâm với trạng thái VPS đã xác nhận. Máy mất kết nối chưa thể được coi là đã dừng.
- **Kích hoạt lại:** chỉ khi cấu hình đã đồng bộ. VPS mở lại truy cập sau khi agent xác nhận.
- **Xóa vào thùng rác:** phải tạm ngưng thành công, hết tác vụ đang chờ và nhập đúng domain. Thu hồi toàn bộ API key. Không xóa database, bucket hay phá hủy VPS.
- **Khôi phục:** lọc **Thùng rác**, mở đơn vị và khôi phục. Đơn vị vẫn tạm ngưng đến khi chủ hệ thống kích hoạt. API key đã thu hồi không tự hoạt động lại.

Client cần v0.9.1 và agent báo `control_protocol: 2`. Bộ nhận cập nhật kiểm tra và làm mới agent sau nâng cấp; có thể mất khoảng một phút. Không bật nút điều khiển dựa trên số phiên bản API khi agent cũ chưa hỗ trợ. Nếu cần xử lý riêng, chạy `sudo bash /opt/meet/control/install-agent.sh` rồi `sudo systemctl restart meet-control-agent` trên VPS đã nâng cấp; không chạy bộ cài mới để ghi đè dữ liệu.

## Backup và chuyển sang VPS mới

Đây là luồng có kế hoạch ngừng ghi, không phải di chuyển không gián đoạn. Chuẩn bị VPS Ubuntu mới, IP public, một domain tạm trỏ riêng về máy mới và fingerprint hai máy lấy từ Console/VNC. Giữ bucket R2 hiện tại; các video không nằm trong file backup và không được tự sao chép sang bucket khác.

1. Tạm ngưng đơn vị và chờ VPS xác nhận. Chờ tác vụ, ghi hình và tải lên hiện tại kết thúc. Vào **Backup / Chuyển VPS**.
2. Nhập SSH máy cũ → **Sao lưu mã hóa để chuyển VPS**. Máy nguồn tạo dump MySQL nhất quán, cấu hình, khóa 2FA và archive nguồn. Trung tâm nhận qua SFTP có pin fingerprint, kiểm tra SHA-256, giải mã thử và đối chiếu manifest. File mã hóa ở `/var/lib/meet-control/portable-backups/<school-id>/`; khóa nằm riêng trong `portable-recovery/<school-id>/`, quyền riêng của dịch vụ.
3. Nhập IP mới, domain tạm và SSH máy mới → **Cài và phục hồi VPS mới**. Bộ cài chỉ lấy commit qua đủ CI, từ chối `/opt/meet` có sẵn và phục hồi chỉ khi database có **0 trường**. Giữ mật khẩu database/Redis mới; khôi phục dữ liệu và cấu hình ứng dụng. Nguồn đang chạy là bản đã kiểm thử mới, còn nguồn cũ được giữ trong snapshot. Kiểm tra lại số trường, tài khoản, lớp, môn và buổi học. Máy mới vẫn tạm ngưng.
4. Khi trạng thái **Máy mới sẵn sàng**, đổi bản ghi A domain chính sang IP mới. Xóa AAAA còn trỏ máy cũ; tắt proxy trong lúc đối chiếu IP. Không kích hoạt cả hai máy.
5. Nhập lại SSH máy mới → **Kiểm tra và hoàn tất chuyển VPS**. Kiểm tra DNS/HTTPS, chuyển origin và binding, vô hiệu token agent máy cũ, đăng ký agent mới, tăng revision và chờ cấu hình áp dụng. Máy cũ giữ dữ liệu và trạng thái tạm ngưng; không bị xóa.
6. Kiểm tra domain mới, tài khoản, lớp, video R2; rồi **Kích hoạt lại**. Lưu bản sao snapshot và khóa ở hai nơi riêng theo chính sách của đơn vị. Không mở quyền public cho bucket để thử video.

Giới hạn tự động hiện tại: **128 MiB dữ liệu giải nén** cho MySQL + mã nguồn + cấu hình. Video vẫn trên R2 nên không tính trong dung lượng này. Đơn vị lớn hơn cần backup dạng streaming riêng; hệ thống dừng an toàn khi vượt giới hạn. Chuyển bucket, DNS của nhà cung cấp và xóa VPS cũ không được tự thực hiện.

Thông tin SSH được mã hóa trong tác vụ và xóa khi kết thúc hoặc khi phát hiện dịch vụ bị gián đoạn. Cài/restore bị gián đoạn cần kiểm tra máy đích, không tự xóa checkout để thử lại. Có thể hủy khi chưa chuyển domain; máy cũ được đồng bộ lại cấu hình/CORS và vẫn tạm ngưng. Sau khi đã bắt đầu chuyển domain mà lỗi, giữ tạm ngưng và hoàn tất lại bước chuyển; không tự mở máy cũ để tránh ghi hai nơi.

Backup R2 theo lịch và **Backup ngay** vẫn dùng cấu hình R2 sẵn có. Backup chuyển máy có thể dùng khi R2 chưa bật, nhưng video đã có trên R2 vẫn cần credential/bucket gốc để xem sau phục hồi.

## API cập nhật nhanh

Vào **API tích hợp**, tạo khóa riêng cho đơn vị, đặt tên và hạn dùng 1–90 ngày. Khóa chỉ hiện một lần; lưu trong hệ thống secret. Có thể thu hồi bất cứ lúc nào. Chỉ hash khóa được lưu trong database. API key không thay phiên đăng nhập của người quản trị.

```http
GET /api/v1/schools/<school-id>
Authorization: Bearer <api-key>
```

Đọc `revision` rồi gửi:

```http
PATCH /api/v1/schools/<school-id>
Authorization: Bearer <api-key>
Content-Type: application/json

{"revision":3,"name":"Tên trường mới","retention_days":30,"free_videos":4}
```

Chỉ gửi các trường cần thay. Cho phép `name`, `retention_days` (1–3650), `free_videos` (1–100) và bắt buộc `revision`. Revision cũ bị từ chối. Thông tin trung tâm cập nhật ngay; VPS nhận cấu hình qua HTTPS theo chu kỳ khoảng 20 giây, chờ hết Live khi cần. API không mở SSH hoặc chạy shell. Nhật ký ghi ID khóa và thao tác, không ghi token.

Khóa chỉ dùng đúng một đơn vị; không đổi domain/IP, không đọc secret, không cấp VIP, không điều khiển trạng thái hoặc xóa. Những việc đó dùng luồng owner có kiểm tra riêng. Đơn vị đang chuyển máy bị khóa sửa cấu hình. Khi owner cấp khóa bị vô hiệu hoặc mất quyền owner, khóa không được xác thực.

## Nghiệm thu

Các kiểm thử gồm khóa sai/hết quyền, revision cũ, chéo trường, thu hồi khi xóa, tạm ngưng chờ Live và khôi phục truy cập; crypto/manifest snapshot; phục hồi MySQL trên stack dùng một lần, giữ tên tiếng Việt và chặn đè trường có sẵn. Hai VPS thật, SSH, DNS, TLS và R2 cần nghiệm thu với máy đích được cung cấp; không coi kiểm thử mô phỏng là đã chuyển trường thật.
