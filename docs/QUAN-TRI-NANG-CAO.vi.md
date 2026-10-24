# Quản trị học vụ, bảo mật, điểm danh và sao lưu

## Môn học và phân công

Trong **Quản trị → Môn học**, chọn lớp, thêm dòng hoặc mở **Dán nhiều dòng từ Excel hoặc CSV**. Mỗi dòng có một cột tên môn; tiêu đề tùy chọn là name hoặc **Tên môn**. Với tên chứa dấu phẩy, bao tên bằng dấu nháy kép. Kiểm tra bảng rồi lưu. **Xóa dòng môn** bỏ dòng chưa lưu ngay; môn đã lưu chỉ xóa khi chưa có buổi học để giữ lịch sử.

Mã hiển thị gồm tiền tố và bốn chữ số: LH0001, MH0001, GV0001, SV0001, QT0001. Mỗi tiền tố có tối đa 9.999 mã trên một hệ thống; không quay vòng hoặc tái sử dụng mã đã cấp. UUID và các liên kết không đổi. Migration cấp lại mã hiển thị cũ sáu số; cần tra lại mã trên bảng sau nâng cấp.

Trong **Phân công giảng dạy**, chọn giáo viên chính và bấm **+ Thêm trợ giảng**, tối đa 10 người/môn. Không chọn trùng hoặc trùng giáo viên chính. Trợ giảng truy cập môn, tham gia buổi và xem điểm danh; giáo viên chính hoặc admin điều khiển bắt đầu/kết thúc. Không đổi phân công khi môn có buổi đang học. Học sinh thấy **Đang chờ giáo viên** đến khi buổi chuyển sang đang diễn ra.

## Tài khoản

**Tài khoản** hiển thị thông tin chỉ đọc, đổi mật khẩu và 2FA tùy chọn. Thiết lập 2FA yêu cầu mật khẩu hiện tại, nhập khóa vào ứng dụng TOTP rồi xác nhận mã sáu số. Giữ khóa thiết lập ở nơi riêng. Mã thiết lập hết hạn sau 5 phút; mã đăng nhập đã dùng không dùng lại. Bật/tắt 2FA yêu cầu đăng nhập lại. Khóa trong database được mã hóa bằng khóa riêng tại runtime-config/account-key; phải sao lưu khóa này cùng dữ liệu. Phiên đăng nhập mới thay thế phiên cũ.

**Quản trị → Tài khoản và phân quyền** cho phép tạo thêm admin, chọn quyền Học vụ, Tài khoản, Điểm danh, Buổi học, Ghi hình, Nhật ký. Máy chủ kiểm tra quyền mọi yêu cầu; người cấp không cấp vượt quyền của mình. Admin gốc có trước nâng cấp/khởi tạo được bảo vệ, không chỉnh trạng thái/quyền từ bảng này. Không tự thay đổi quyền/trạng thái tài khoản đang dùng. Có thể tạm ngưng, vô hiệu hóa, kích hoạt lại học sinh, giáo viên hoặc admin được tạo thêm; phiên cũ mất quyền ngay. Tạm ngưng/vô hiệu hóa đều chặn truy cập và giữ dữ liệu.

## Điểm danh từng buổi

Chọn lớp → môn → một buổi hoặc **Tất cả buổi đã bắt đầu**. Mỗi dòng là một học sinh của một buổi, không gộp giữa các buổi. Học sinh chỉ thấy chính mình; giáo viên/trợ giảng chỉ thấy môn được phân công; admin có quyền điểm danh thấy trong trường mình.

Admin mở **Quy tắc điểm danh của trường**: cho phép vào muộn/ra sớm 0–240 phút và tỷ lệ kết nối tối thiểu 1–100%. Mặc định 10 phút, 10 phút, 75%. Chỉ kết luận sau khi buổi kết thúc. Khoảng buổi mặc định 60 phút từ lịch bắt đầu; chọn một buổi để chỉnh giờ đầu/cuối chính xác. Thay đổi quy tắc áp dụng cả báo cáo lịch sử khi xem lại.

Bấm **Chỉnh giờ vào / ra**, nhập thời gian theo múi giờ trình duyệt và lý do ít nhất ba ký tự. Mỗi điều chỉnh lưu thành lịch sử với người thực hiện; dữ liệu kết nối gốc không bị ghi đè. Khi chỉnh tay, thời lượng bằng khoảng giờ vào đến ra do admin xác nhận. **Xuất Excel** tải .xlsx đầy đủ tiếng Việt, Arial; dữ liệu ghi dạng chuỗi để không thực thi công thức. Thời gian Excel ghi rõ UTC. Tối đa 10.000 dòng/lần; chọn từng buổi nếu vượt giới hạn.

## Cấu hình SFU, TURN và R2

Từ Quản trị mở **Cấu hình SFU / R2 / sao lưu**. Đây là cấu hình dùng chung nhiều trường, cần mã người vận hành tại /opt/meet/runtime-config/setup-token. Không chia sẻ mã cho admin trường thông thường. Thêm/sửa/xóa SFU chưa được gán; SFU đã gán lớp/buổi phải giữ App ID và credential, tắt nhận lớp mới nếu cần rút khỏi pool. Cân bằng có trọng số theo lớp mới, giữ ổn định phòng hiện có.

Thời hạn ghi hình mặc định 30 ngày, có thể đặt 1–3650 ngày. Lưu cấu hình cập nhật lifecycle R2 và hạn metadata các bản ghi chưa xóa, tính từ ngày tạo. Giảm thời hạn có thể làm mất bản ghi cũ trong chu kỳ dọn tiếp theo; tăng không khôi phục object đã xóa. R2 xóa vật lý bất đồng bộ. Rule không liên quan được giữ lại; rule xóa sớm xung đột bị từ chối. Bucket đã có metadata ghi hình không tự đổi sang bucket khác.

## Sao lưu tự động và khôi phục cài mới

Bộ cài Ubuntu mới cài python3-cryptography và **meet-backup.timer**. Timer kiểm tra mỗi giờ; bật **Sao lưu tự động**, đặt chu kỳ 1–720 giờ trên trang cấu hình. Chu kỳ tính từ lần upload và xác minh thành công gần nhất. Bản sao gồm database MySQL nhất quán, mã nguồn đã commit, cấu hình Cloudflare và khóa 2FA; không chứa video hoặc mật khẩu MySQL/Redis của máy mới. Bản sao nằm trong **backups/**, tách khỏi lifecycle **recordings/**.

Bản sao mã hóa AES-256-GCM trước khi upload rồi tải lại so khớp. Khóa phục hồi tại **/etc/meet/recovery.key**, quyền 0600. Sao chép khóa và credential R2 ra nơi an toàn riêng. Có thể giữ settings.json riêng làm credential phục hồi; file chứa bí mật, không commit/chia sẻ. Mất khóa không giải mã được bản sao. Backups chưa tự xóa theo thời hạn video; người vận hành đặt lifecycle riêng cho backups/ nếu muốn. Giới hạn bản sao nén 512 MiB, cần đủ RAM để mã hóa/xác minh; trường lớn cần giải pháp streaming riêng.

Chạy thử và kiểm tra trên VPS:

```sh
sudo python3 /opt/meet/deploy/backup.py backup --force
sudo systemctl status meet-backup.timer
sudo journalctl -u meet-backup.service --since today
```

Trang cấu hình hiển thị object/thời gian bản sao đã xác minh sau tải lại trang. Lỗi xem journal; không báo thành công khi upload/xác minh thất bại. Giữ object key được in ra, khóa phục hồi và credential R2 ngoài VPS.

Khôi phục **chỉ trên máy cài mới đã có schema nhưng chưa có trường**. Cài bằng lệnh một lần hiện có, chưa khởi tạo ở /setup, chép credential và recovery.key vào /root quyền 0600 rồi chạy:

```sh
sudo python3 /opt/meet/deploy/backup.py restore --object backups/YYYY/MM/DD/OBJECT.meet --credentials /root/r2-settings.json --key /root/recovery.key
```

Lệnh xác minh giải mã/manifest/đường dẫn trước khi phục hồi, từ chối nếu đã có trường, dừng API/web, nạp DB, khôi phục cấu hình/mã nguồn, dựng image, migrate, cấu hình lại CORS/lifecycle theo domain hiện tại và chạy ứng dụng. Không mở lại phiên Redis cũ. Mật khẩu MySQL/Redis mới và domain mới được giữ nguyên. Kiểm tra health và đăng nhập tài khoản trong bản sao. Sau phục hồi mã nguồn, kiểm tra chênh lệch Git trước nâng cấp; không tự ghi đè checkout đang sửa.

Có thể truyền MEET_RESTORE_OBJECT, MEET_RESTORE_CREDENTIALS, MEET_RESTORE_KEY vào môi trường bộ cài một lệnh. Credential/key là **đường dẫn file riêng tư**, không phải giá trị khóa. Bộ cài phục hồi sau khởi tạo hạ tầng và kiểm tra HTTPS. Không đặt credential trong URL hay lệnh lưu vào lịch sử.

## Nghiệm thu cần hạ tầng thật

Kiểm thử dùng MySQL/Redis trong CI và giả lập provider cho lifecycle/media API. Cần credential Cloudflare và VPS/DNS thật để xác nhận âm thanh, video, TURN qua mạng di động, ghi hình, backup/restore thực, DNS/TLS. Phòng có bố cục tối, ô video và thanh điều khiển cố định trên điện thoại; không tuyên bố tương đương toàn bộ Google Meet.
