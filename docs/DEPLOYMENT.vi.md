# Triển khai Ubuntu 24.04 / 26.04

## 1. Chuẩn bị

VPS khởi điểm 4 vCPU, 8 GB RAM, SSD 80 GB là **ước lượng cho control plane nhỏ**, chưa phải cam kết chịu tải. Video đi browser ↔ Cloudflare SFU, không đi qua VPS. MySQL, import bcrypt, số phiên, số track và băng thông R2 cần đo riêng. Có domain trỏ A/AAAA về VPS, mở TCP 80/443 và SSH theo mạng quản trị. Không mở MySQL, Redis, API ra Internet.

Cài Docker Engine và Compose plugin theo [hướng dẫn Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Cài Git, OpenSSL và Caddy từ nguồn chính thức. Kiểm tra `docker version`, `docker compose version`, `caddy version`. Đồng bộ giờ bằng NTP. Người trong nhóm docker có quyền tương đương root.

```bash
git clone https://github.com/lehuunghi/meet.git
cd meet
git checkout codex/multi-school-platform
sudo bash deploy/init-secrets.sh
export APP_ORIGIN=https://meet.example.edu
docker compose -f deploy/compose.yaml up --build -d
docker compose -f deploy/compose.yaml ps
curl -f http://127.0.0.1:8080/api/health
```

Lưu `APP_ORIGIN` vào file `.env` ở thư mục repository nếu muốn giữ qua SSH sessions; Compose chạy từ thư mục repository. Không thêm dấu `/` cuối origin. Secret `_FILE` ưu tiên hơn biến môi trường cùng tên. Script không ghi đè secret có sẵn. Sau khi MySQL đã có dữ liệu, đổi file password không tự đổi password trong MySQL: phải thay bằng SQL quản trị rồi đồng bộ DSN. Không xóa volume để sửa lỗi credential.

Secret nằm ngoài Git ở `secrets/`, quyền file 0600, owner uid 10001 để Go đọc được. Docker Compose local secrets là file mount, **không tự mã hóa ổ đĩa**. Bảo vệ và backup thư mục này bằng secret manager hoặc kho mã hóa của đơn vị. Không đưa nội dung secret vào log, screenshot, issue hay PR.

## 2. HTTPS

Mẫu `deploy/Caddyfile` dành cho Caddy chạy trên host. Thay `{$DOMAIN}` bằng hostname thật hoặc cấu hình biến môi trường DOMAIN trong service Caddy; copy vào `/etc/caddy/Caddyfile`, chạy validate và reload Caddy. Caddy chuyển tới Nginx bind `127.0.0.1:8080`. Cookie Secure tự bật khi APP_ORIGIN là HTTPS.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -f https://meet.example.edu/api/health
```

Trình duyệt phải mở đúng APP_ORIGIN. Sai domain/port gây 403 khi POST. Camera/mic/screen capture yêu cầu secure context, trừ localhost. Không mở cổng 8080 công khai để bỏ qua HTTPS.

## 3. Tạo trường thật

Không seed demo vào database production. Tạo mật khẩu quản trị riêng, lưu bằng file; không truyền mật khẩu trên command line.

```bash
sudo sh -c 'umask 077; openssl rand -hex 24 > secrets/admin_password'
sudo chown 10001:10001 secrets/admin_password
docker compose -f deploy/compose.yaml run --rm \
  -v "$PWD/secrets/admin_password:/run/secrets/admin_password:ro" \
  -e SCHOOL_SLUG=nguyen-trai \
  -e SCHOOL_NAME='Trường Nguyễn Trãi' \
  -e ADMIN_EMAIL=admin@example.edu \
  -e ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
  api bootstrap
```

Lặp lại với slug/email/name khác để tạo trường tiếp theo. CLI tạo school + admin trong cùng transaction, không ghi đè trường cũ. Mỗi trường chỉ xem tài nguyên tenant của mình. Hiện chưa có dashboard superadmin đa trường; onboarding dùng CLI có quyền vận hành.

## 4. Cloudflare SFU và TURN

Tạo SFU App riêng cho staging/production. Điền giá trị bằng editor bảo mật vào:

| File | Nội dung |
|---|---|
| `secrets/cf_sfu_app_id` | SFU App ID |
| `secrets/cf_sfu_secret` | SFU App Secret |
| `secrets/cf_turn_keys` | Mảng JSON các TURN key của đơn vị |

Cấu trúc JSON (placeholder không phải credential):

```json
[{"id":"YOUR_TURN_KEY_ID","token":"YOUR_TURN_API_TOKEN"}]
```

Có thể cấu hình nhiều key được phép sử dụng. API phân phối ổn định theo user và thử key tiếp theo nếu upstream lỗi; không dùng để vượt giới hạn dịch vụ. Khóa TURN ở backend, browser chỉ nhận ICE credential TTL 3600 giây. Không có key thì trả STUN công khai; mạng bắt buộc TURN có thể không kết nối được.

Sau khi đổi file, recreate API để chắc chắn file mount được cập nhật:

```bash
docker compose -f deploy/compose.yaml up -d --force-recreate api
```

Không đặt secret vào `VITE_*`: các biến này có thể nằm trong JavaScript công khai. Tài liệu tham chiếu: [SFU Connection API](https://developers.cloudflare.com/realtime/sfu/api/), [connection patterns](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/), [TURN credential](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## 5. R2 private

Tạo bucket private, R2 S3 key chỉ có quyền cần thiết trên bucket này. Điền các file `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket`. Bật CORS cho đúng origin (thay ví dụ bằng domain thật):

```json
[
  {
    "AllowedOrigins": ["https://meet.example.edu"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Giáo viên tạo buổi có `recording_allowed=true`; thông báo ghi hình hiện trên phòng. Khi ghi, chọn tab/màn hình và chọn chia sẻ audio nếu browser hỗ trợ. Dừng ghi trước khi kết thúc lớp. Browser xin PUT URL 15 phút sau khi capture xong; upload đúng `Content-Type: video/webm`, rồi gọi complete để API kiểm tra object. URL GET hết hạn sau 5 phút. Không bật public bucket. Xem [R2 presigned URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Bản ghi lưu trong RAM browser, nên dùng đoạn ngắn, tối đa 1 GiB, thử dưới 10 phút trước. Chưa có khôi phục khi tab đóng hoặc upload lỗi. HEAD giới hạn kích thước khi finalize, **không chặn chi phí của object quá lớn trước khi upload**. Đặt lifecycle xóa bản ghi theo chính sách trường, cảnh báo dung lượng và job dọn pending/orphan trước production. Không giả định screen capture ghi đủ mọi âm thanh trên mọi hệ điều hành.

## 6. Demo và import

Trong môi trường thử riêng:

```bash
docker compose -f deploy/compose.yaml --profile demo run --rm seed
```

Mã trường `demo` / `other`, ba email `admin@example.test`, `teacher@example.test`, `student@example.test`; mật khẩu lấy bằng quy trình quản trị từ `secrets/demo_password`. Seed idempotent, không reset mật khẩu người dùng đã có. Nếu đã đổi mật khẩu, dùng mật khẩu mới. Không bật profile demo thường trực.

Admin tạo lớp/môn trong giao diện. API `/api/classes` trả ID lớp; chọn đúng giáo viên trường mình. Import workbook `.xlsx`, đúng một sheet, dòng đầu:

| email | name | role | password | class |
|---|---|---|---|---|
| student01@example.edu | Nguyễn An | student | mật khẩu riêng ít nhất 12 byte | 10A1 |
| teacher01@example.edu | Trần Bình | teacher | mật khẩu riêng ít nhất 12 byte | |

Tối đa 100 người / lượt, file 4 MiB, dữ liệu giải nén 20 MiB. Cột class của student có thể trống; nếu có thì tạo lớp hoặc thêm vào lớp có sẵn. Môn học phải gán teacher đã tồn tại. Không cho import admin. Duplicate/invalid row hủy toàn bộ giao dịch; không ghi đè tài khoản. Workbook có mật khẩu nên chuyển qua kênh bảo mật và xóa sau khi bàn giao. Bcrypt có thể mất vài chục giây cho 100 người; chỉ gửi một lượt mỗi lần.

## 7. Backup, khôi phục, nâng cấp

Backup MySQL hàng ngày, Redis AOF cho phiên đăng nhập, secret mã hóa và cấu hình R2 lifecycle. Ví dụ tạo dump (file chứa dữ liệu cá nhân, cần mã hóa):

```bash
umask 077
mkdir -p backups
docker compose -f deploy/compose.yaml exec -T mysql sh -c \
 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysqldump -u meet --single-transaction --no-tablespaces meet' \
 > "backups/meet-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

Kiểm tra dump không rỗng và lưu ngoài VPS bằng cơ chế backup của đơn vị. Thử restore vào một stack/database staging riêng, kiểm tra số trường/người dùng/buổi học và quyền truy cập trước khi coi backup hợp lệ. Restore SQL bằng `docker compose exec -T mysql ... mysql -u meet meet < backup.sql` với cùng cách MYSQL_PWD trong container. Không restore trực tiếp đè dữ liệu thật khi chưa có kế hoạch bảo trì.

Nâng cấp: backup → checkout commit đã nghiệm thu → build → chạy migration → restart → kiểm tra health/login/call. Schema v1 dùng DDL idempotent và advisory lock; MySQL DDL không rollback nguyên tử, cần giữ backup. Các thay đổi schema tương lai phải thêm migration có version, không chỉ sửa `CREATE IF NOT EXISTS`. Rollback image không tự rollback schema.

## 8. Theo dõi và vận hành

`docker compose logs --tail=100 api web mysql redis`; không ghi request body, cookie hoặc URL ký số vào log. Theo dõi 5xx, login 429, heartbeat gián đoạn, pool MySQL, Redis memory/AOF, lỗi provider, SFU egress và R2 dung lượng. Endpoint `/api/health` kiểm tra cả MySQL và Redis. Hiện rate limit theo IP kết nối API, sau Nginx nhiều người có thể chung một bucket: bổ sung rate limit chuẩn tại proxy/WAF trước mở rộng, không tin X-Forwarded-For do client tự gửi.

Đổi password sẽ hủy mọi session của user (bằng session_version). Vô hiệu hóa user bằng active=false cũng chặn phiên hiện có ở lần gọi API tiếp theo. Media đã được SFU kết nối có thể tiếp tục đến khi browser đóng kết nối; hiện chưa có revoke server-side tức thì. Xem giới hạn ở tài liệu kiến trúc trước khi chọn chính sách kiểm soát lớp.
