# Cập nhật trực tiếp từ GitHub, không cài lại dữ liệu

## Sử dụng trong giao diện

Mở **Quản trị → Cấu hình SFU / R2 / sao lưu → Cập nhật phiên bản từ GitHub** tại /setup. Cần mã người vận hành VPS, không dùng quyền admin trường thông thường vì việc cập nhật ảnh hưởng mọi trường.

1. Bấm **Kiểm tra phiên bản**. Dịch vụ VPS nhận yêu cầu trong khoảng một phút.
2. Xem phiên bản và commit hiện tại, phiên bản/commit mới, trạng thái kiểm thử.
3. Kết thúc tất cả buổi học. Đánh dấu đồng ý khung bảo trì cho đúng commit hiển thị.
4. Bấm **Sao lưu và cập nhật an toàn**. Theo dõi bước dựng bản mới → khóa ghi → sao lưu/xác minh → migrate → kiểm tra → mở lại.
5. Khi hoàn tất, tải lại trang và kiểm tra đăng nhập, lớp học, điểm danh. Trong lúc API/web khởi động lại có thể mất kết nối tạm thời; không cài lại hoặc gửi thêm yêu cầu.

Không tự động cài ngay khi có commit mới. Người vận hành chủ động bấm cập nhật. Dịch vụ chỉ nhận action cố định và SHA 40 ký tự; không nhận URL repository, tên branch tùy ý, câu lệnh hay đường dẫn từ trình duyệt. API không có Docker socket hoặc quyền root. Không cần nhập GitHub token cho repository public này.

## Nguồn và điều kiện cho một bản cập nhật

Hiện kênh được cố định là repository **lehuunghi/meet**, branch **codex/multi-school-platform**. Khi chuyển sang kênh phát hành chính thức cần thay đổi có review, không sửa qua ô nhập tùy ý. Đây vẫn là branch của PR đang phát triển, chưa phải tuyên bố đã có bản phát hành production ổn định.

Một bản chỉ được nâng cấp khi:

- Có deploy/release.json hợp lệ, version dạng x.y.z tăng so với bản đang cài; SHA từ GitHub khớp SHA đã fetch.
- Lần chạy CI push mới nhất cho chính commit đó thành công, có đủ api/web/containers thành công; không chấp nhận skipped hoặc chỉ có workflow PR thành công.
- Origin Git đúng repository, checkout đúng branch, không sửa file hoặc có file chưa theo dõi, và chỉ tiến lên bằng fast-forward.
- Không có buổi học live; database hiện tại khớp schema_version của bản đang cài; không hạ schema.
- Còn ít nhất 3 GiB dung lượng trống và đủ RAM để dựng Docker image/snapshot.
- Giao thức updater và infrastructure_version tương thích. Thay đổi compose sau bản cài có updater yêu cầu nâng cấp hạ tầng thủ công có review, không tự đổi MySQL/Redis/volumes/network.

Không tăng version trong release.json thì commit mới không được xem là bản nâng cấp thông thường. Quy trình phát hành: cập nhật version/schema metadata đúng thay đổi, push, đợi đầy đủ CI, rồi người vận hành kiểm tra và duyệt đúng SHA. Nếu GitHub lỗi hoặc giới hạn API, hệ thống dừng trước nâng cấp; ứng dụng đang dùng được giữ nguyên.

## Cơ chế an toàn

Dịch vụ root riêng **meet-update.timer / meet-update.service** kiểm tra hàng đợi mỗi khoảng 30 giây, dùng cùng khóa với sao lưu để không chạy đồng thời. Image mới được dựng ở Git worktree riêng trước khi dừng ứng dụng.

Trước migration, hệ thống khóa truy cập ứng dụng, dừng API/web để kết thúc yêu cầu đang xử lý và kiểm tra lại không có buổi live. Snapshot gồm MySQL nhất quán, .env, secrets và runtime-config; được mã hóa AES-GCM bằng khóa riêng /etc/meet/recovery.key, lưu tại /var/lib/meet-updates/snapshots/ và giải mã kiểm tra lại. Nếu R2 đã bật, bắt buộc upload và tải lại so khớp trước khi tiếp tục. Nếu R2 lỗi thì không bỏ qua để nâng cấp. Giữ khóa phục hồi ngoài VPS, không đưa lên cùng bucket.

Snapshot cập nhật có thể chứa mật khẩu hạ tầng nhưng chỉ nằm trong bản mã hóa. Không commit secrets, .env, runtime-config hoặc bản sao. Giới hạn snapshot và nội dung giải nén khoảng 512 MiB; hệ thống lớn cần quy trình backup/restore phù hợp riêng. Không tự xóa snapshot hoặc image cũ trong đợt cập nhật này; người vận hành quản lý dung lượng sau nghiệm thu.

Migration chạy trước khi khởi động bản mới. Health phải xác nhận database/Redis và đúng commit mới, không chỉ HTTP 200. Trong thời gian kiểm tra, API vẫn khóa yêu cầu nghiệp vụ và worker dọn ghi hình cũng tạm ngưng. Chỉ mở ghi dữ liệu sau khi xác minh thành công.

Nếu migration/health lỗi trước khi mở lại, dịch vụ khôi phục toàn bộ database (kể cả loại bỏ bảng do migration lỗi vừa tạo), cấu hình, commit và image cũ. Không rollback database sau khi đã hoàn tất mở lại cho người dùng. Không có nút tùy ý hạ phiên bản sau nhiều ngày vì thao tác đó có thể làm mất dữ liệu mới.

Journal riêng tại /var/lib/meet-updates/journal.json được ghi trước các bước có thay đổi. Nếu mất điện/tiến trình bị ngắt, lần chạy tiếp theo phục hồi tác vụ dở trước khi nhận yêu cầu mới. Nếu đã qua điểm hoàn tất nhưng chưa mở khóa, chỉ kiểm tra/khởi động lại dịch vụ rồi mở khóa, không nạp lại database lần nữa.

## Bản cài cũ: bật cập nhật một lần

Bộ cài mới đã cài agent. Với bản /opt/meet đã có schema v4 và deploy/backup.py (bản học vụ/2FA/sao lưu trước tính năng cập nhật), dùng lệnh sau trong khung bảo trì. Lệnh không clone lại, không xóa volume hay khởi tạo lại trường:

```sh
sudo bash -c 'set -e; MEET_ENABLE_FILE=$(mktemp); trap '\''rm -f -- "$MEET_ENABLE_FILE"'\'' EXIT; curl -fsSL https://raw.githubusercontent.com/lehuunghi/meet/codex/multi-school-platform/deploy/enable-updates.sh -o "$MEET_ENABLE_FILE"; bash "$MEET_ENABLE_FILE"'
```

Cầu nối kiểm tra CI, tải helper theo SHA cố định, kiểm tra hạ tầng MySQL/Redis/volumes/network tương thích, dựng bản mới và áp dụng cùng quy trình snapshot/rollback. Lần bật đầu có thể nâng từ bản chưa có version metadata; các lần sau bắt buộc version tăng. Nếu chưa đủ CI, có lớp live, checkout sửa riêng, schema khác v4 hoặc hạ tầng tùy biến, lệnh từ chối thay vì ghi đè.

Không dùng lại install.sh để nâng cấp một bản đã có. Bộ cài sẽ từ chối checkout có sẵn nhằm tránh bỏ qua snapshot và khóa bảo trì. Sau bật agent, mọi lần cập nhật thực hiện trên /setup.

## Vận hành và phục hồi khi cần người quản trị

```sh
sudo systemctl status meet-update.timer
sudo journalctl -u meet-update.service --since today
sudo python3 /opt/meet/deploy/update.py check
```

Trang giao diện chỉ hiển thị thông tin tổng quát, không trả nội dung dump hoặc credential. Chi tiết lỗi xem journal trên VPS. Nếu trạng thái **recovery_required**, không xóa file maintenance, không mở ghi dữ liệu và không chạy cài lại. Giữ nguyên snapshot, recovery.key, journal và image cũ. Sau xử lý lỗi dung lượng/Docker/MySQL, khởi động lại meet-update.service để tiếp tục phục hồi đúng journal. Nếu journal hoặc khóa bị mất, cần người vận hành dùng bản sao được xác minh; không tự suy đoán rollback.

Nếu bước dựng bị ngắt trước bảo trì, staging cũ có thể được giữ tại /var/lib/meet-updates/stage-SHA. Kiểm tra journal và git worktree list, chỉ gỡ đúng staging của tác vụ đã dừng bằng git worktree remove sau khi xác minh không có thay đổi cần giữ. Không xóa /opt/meet hay volume database.

## Kiểm thử

CI có các bài kiểm tra: thiếu/failed/skipped CI bị từ chối, origin/checkout sai bị chặn, lớp live không bắt đầu nâng cấp, quyền operator và hàng đợi SHA, khóa nghiệp vụ khi bảo trì, journal hoàn tất không nạp lại dữ liệu. Stack Docker dùng một lần kiểm tra MySQL thật với migration lỗi sau DDL/UPDATE, phục hồi schema/dữ liệu/cấu hình/image; cập nhật thành công đúng commit; mô phỏng journal bị ngắt rồi tự phục hồi. R2 transport trong bài kiểm tra này được giả lập; cần VPS/R2 thật để nghiệm thu hoạt động hệ điều hành và đường truyền thực.

Tham khảo cơ chế nền tảng: [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs), [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/), [systemd timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).
