# Meet — Hướng dẫn cài đặt, khởi tạo và sử dụng

**Dành cho:** người cài VPS, quản trị trường, giáo viên và học sinh.

**Ngày cập nhật:** 24/10/2026.

**Mã nguồn:** [lehuunghi/meet](https://github.com/lehuunghi/meet), nhánh `codex/multi-school-platform`, [PR #1](https://github.com/lehuunghi/meet/pull/1).

Tài liệu này mô tả đúng những chức năng đang có trong mã nguồn, từ một VPS mới đến buổi học đầu tiên. Các tên miền, email và tên trường bên dưới là ví dụ; hãy thay bằng thông tin của bạn. Không điền khóa thật vào tài liệu hoặc Git.

**Cách cài mới được khuyến nghị:** dùng [bộ cài một lệnh và trang cấu hình](CAI-DAT-MOT-LENH.vi.md). Phần bên dưới là quy trình thủ công/CLI thay thế, không cần làm lại nếu bộ cài đã hoàn tất. Cấu hình nhập trên web ở `runtime-config/settings.json` ưu tiên hơn secret file legacy; khi đã dùng wizard, quản lý SFU/TURN/R2 tại `/setup`. Bản ghi hiện tự hết hạn sau 30 ngày, có lifecycle và tác vụ dọn; xem tài liệu cài một lệnh để hiểu giới hạn và thời điểm xóa.

## Mục lục

**Cập nhật học vụ:** giao diện mới cho tạo môn chưa có giáo viên, bảng sửa trực tiếp theo ID ngắn, nhập học sinh bốn cột email/mã SV/tên/password, teacher import ba cột riêng và bảng phân công. Đọc [quy trình học vụ mới](HOC-VU-VA-MEET.vi.md) thay cho các bước nhập chung/gán teacher ngay khi tạo môn ở bản hướng dẫn thủ công cũ bên dưới.

1. [Hiểu hệ thống và thứ tự triển khai](#1-hiểu-hệ-thống-và-thứ-tự-triển-khai)
2. [Chuẩn bị thông tin](#2-chuẩn-bị-thông-tin)
3. [Cài Ubuntu, Docker và Caddy](#3-cài-ubuntu-docker-và-caddy)
4. [Tải mã nguồn và khởi động](#4-tải-mã-nguồn-và-khởi-động)
5. [Cấu hình tên miền và HTTPS](#5-cấu-hình-tên-miền-và-https)
6. [Khởi tạo trường và admin](#6-khởi-tạo-trường-và-admin)
7. [Tạo giáo viên, học sinh bằng Excel](#7-tạo-giáo-viên-học-sinh-bằng-excel)
8. [Tạo lớp, môn và phân công giảng dạy](#8-tạo-lớp-môn-và-phân-công-giảng-dạy)
9. [Cấu hình Cloudflare SFU và TURN](#9-cấu-hình-cloudflare-sfu-và-turn)
10. [Cấu hình R2 để lưu bản ghi](#10-cấu-hình-r2-để-lưu-bản-ghi)
11. [Tạo và thực hiện buổi học đầu tiên](#11-tạo-và-thực-hiện-buổi-học-đầu-tiên)
12. [Xem điểm danh theo lớp, môn và vai trò](#12-xem-điểm-danh-theo-lớp-môn-và-vai-trò)
13. [Sử dụng trên điện thoại](#13-sử-dụng-trên-điện-thoại)
14. [Tạo thêm trường và dùng dữ liệu demo](#14-tạo-thêm-trường-và-dùng-dữ-liệu-demo)
15. [Sao lưu, nâng cấp và vận hành](#15-sao-lưu-nâng-cấp-và-vận-hành)
16. [Xử lý lỗi thường gặp](#16-xử-lý-lỗi-thường-gặp)
17. [Biên bản kiểm tra và giới hạn hiện tại](#17-biên-bản-kiểm-tra-và-giới-hạn-hiện-tại)

## 1. Hiểu hệ thống và thứ tự triển khai

### Các thành phần làm gì?

| Thành phần | Nhiệm vụ | Bạn cần tự cài riêng? |
|---|---|---|
| Go API | Đăng nhập, phân quyền, dữ liệu trường, điểm danh, gọi API Cloudflare | Không; Docker build |
| React/Vite + Nginx | Giao diện web cho ba vai trò | Không; Docker build |
| MySQL | Lưu trường, người dùng, lớp, môn, buổi học và báo cáo | Không; Compose tạo container |
| Redis | Lưu phiên đăng nhập và khóa thao tác media | Không; Compose tạo container |
| Caddy | Cấp HTTPS và chuyển yêu cầu vào ứng dụng | Có; cài trên host theo hướng dẫn |
| Cloudflare SFU | Chuyển tiếp âm thanh/video giữa người tham gia | Tạo app trên Cloudflare |
| Cloudflare TURN | Hỗ trợ kết nối từ những mạng khó đi trực tiếp | Tạo TURN key trên Cloudflare |
| Cloudflare R2 | Kho riêng tư lưu bản ghi | Tạo bucket và khóa S3 nếu dùng ghi hình |

Video đi giữa trình duyệt và Cloudflare SFU. VPS chủ yếu xử lý tài khoản, lớp, phân quyền và điểm danh. Không cần cài Go, Node, MySQL hoặc Redis trực tiếp trên Ubuntu nếu dùng Compose.

### Thứ tự làm đúng

**VPS → Docker → mã nguồn → secret → MySQL/schema/API → HTTPS → trường/admin → tài khoản → lớp → môn/giáo viên → Cloudflare → buổi học → điểm danh.**

Bạn có thể cài phần quản lý trước khi có khóa Cloudflare. Khi đó đăng nhập, import và quản lý lớp vẫn dùng được; cuộc gọi và ghi hình chưa dùng được. Health trả `ok` chỉ xác nhận MySQL/Redis, không xác nhận Cloudflare.

## 2. Chuẩn bị thông tin

Điền bảng này vào bản lưu riêng của bạn. Không ghi giá trị secret vào bảng dùng chung.

| Thông tin | Ví dụ | Ghi chú |
|---|---|---|
| IP VPS | IP thật do nhà cung cấp cấp | Không phải IP máy cá nhân |
| Ubuntu | 24.04 LTS | Hướng dẫn dành cho VPS mới |
| SSH user / port | `ubuntu` / port thực tế | Giữ đường đăng nhập quản trị |
| Tên miền ứng dụng | `meet.example.edu` | Trỏ về VPS |
| Đường dẫn cài | `/opt/meet` | Dùng thống nhất trong tài liệu |
| Mã trường | `nguyen-trai` | 2–80 ký tự, chữ thường/số/dấu `-`, bắt đầu bằng chữ/số |
| Tên trường | `Trường Nguyễn Trãi` | Tên đầy đủ, tối đa 200 byte trong CLI |
| Email admin | `admin@example.edu` | Dùng email của đơn vị; viết thường |
| Danh sách lớp | `10A1`, `10A2` | Thống nhất cách viết trước khi import |
| Giáo viên và học sinh | Email, tên, vai trò, lớp | Chuẩn bị Excel |
| Cloudflare | SFU App ID/Secret, TURN key | Lưu trong secret files |
| R2 nếu cần | Account ID, bucket, Access Key ID/Secret | Khóa giới hạn vào bucket |

Mức VPS khởi điểm tham khảo cho môi trường nhỏ: 4 vCPU, 8 GB RAM, SSD 80 GB. Đây chưa phải kết quả kiểm thử cho nhiều lớp đồng thời; cần đo tải theo số người/track thực tế. Có khoản chi riêng cho VPS, tên miền và dịch vụ Cloudflare; kiểm tra tài khoản thanh toán trước khi nghiệm thu.

## 3. Cài Ubuntu, Docker và Caddy

### 3.1. Vào VPS

Trên máy Windows, mở Terminal/PowerShell và SSH vào VPS:

```bash
ssh ubuntu@YOUR_VPS_IP
```

Thay user/IP và thêm `-p PORT` nếu dùng port SSH khác. Sau khi SSH thành công:

```bash
sudo -i
```

**Các lệnh từ đây chạy trong Bash trên Ubuntu VPS, không chạy trực tiếp trong PowerShell Windows.** Tài liệu dùng phiên root để tránh nhầm quyền truy cập Docker và secret. Nếu quản trị theo chính sách khác, người vận hành cần điều chỉnh quyền tương ứng.

### 3.2. Cài công cụ cơ bản

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg git openssl nano dnsutils
timedatectl status
```

Kiểm tra máy đồng bộ giờ. Không cần đổi múi giờ máy chủ để lưu dữ liệu: ứng dụng lưu UTC, trình duyệt hiển thị theo giờ thiết bị. Đặt điện thoại/máy tính người dùng đúng múi giờ địa phương.

### 3.3. Cài Docker từ kho chính thức

Phần này dành cho máy mới chưa có Docker. Nếu VPS đã chạy ứng dụng Docker khác, kiểm tra cài đặt hiện có trước, không gỡ package hoặc xóa dữ liệu theo hướng dẫn máy mới.

```bash
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/meet-docker-key.asc
gpg --batch --yes --dearmor -o /usr/share/keyrings/meet-docker.gpg /tmp/meet-docker-key.asc
chmod 0644 /usr/share/keyrings/meet-docker.gpg
. /etc/os-release
printf 'deb [arch=%s signed-by=/usr/share/keyrings/meet-docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" \
  > /etc/apt/sources.list.d/meet-docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
docker run --rm hello-world
```

Kết quả cần có: Docker client/server hoạt động, Compose hiện phiên bản và `hello-world` chạy thành công. Cách cài dựa trên [tài liệu Docker Ubuntu chính thức](https://docs.docker.com/engine/install/ubuntu/).

### 3.4. Cài Caddy trên host

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/meet-caddy-key.asc
gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/meet-caddy-key.asc
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
caddy version
```

Gói này có systemd service. Nếu máy đã có web server sử dụng 80/443, xử lý xung đột trước; không dừng dịch vụ khác khi chưa xác định nó phục vụ gì. Tham chiếu [cách cài Caddy chính thức](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).

### 3.5. Mạng và firewall

Cho phép truy cập web vào TCP 80/443; giữ port SSH thực tế. Chỉ cổng web localhost 8080 được Compose bind ra host, không công khai MySQL/Redis. Nếu dùng firewall của nhà cung cấp VPS, cấu hình tương ứng ở đó. Docker có cơ chế publish port riêng; không mặc định tin rằng UFW sẽ chặn mọi port Docker. Không đổi binding `127.0.0.1:8080:80` thành cổng công khai để bỏ qua HTTPS.

## 4. Tải mã nguồn và khởi động

### 4.1. Tải đúng nhánh

```bash
cd /opt
git clone --branch codex/multi-school-platform https://github.com/lehuunghi/meet.git meet
cd /opt/meet
git status --short
git rev-parse --short HEAD
```

Repository mặc định `main` hiện chưa có toàn bộ tính năng của PR. Phải chọn đúng nhánh trên cho đến khi PR được merge. Nếu `/opt/meet` đã tồn tại, dùng checkout hiện có và kiểm tra thay đổi; không clone đè hoặc xóa thư mục.

### 4.2. Đặt origin

Thay tên miền ví dụ trong lệnh sau **trước khi chạy**:

```bash
MEET_DOMAIN=meet.example.edu
umask 077
printf 'APP_ORIGIN=https://%s\n' "$MEET_DOMAIN" > /opt/meet/.env
```

`APP_ORIGIN` là địa chỉ người dùng mở trong trình duyệt: đúng `https`, domain và port nếu có, không có dấu `/` cuối. `.env` ở bước này chỉ chứa cấu hình origin; secret được lưu riêng.

### 4.3. Khởi tạo secret tự động

```bash
cd /opt/meet
bash deploy/init-secrets.sh
```

Script sinh mật khẩu ngẫu nhiên cho MySQL, Redis, demo và tạo các file Cloudflare rỗng. Nó không ghi đè file có sẵn. Directory `secrets` có quyền 0700, file 0600, owner uid 10001 để Go đọc được. Đừng tự đổi quyền thành 777.

| File | Nội dung | Ai điền? |
|---|---|---|
| `mysql_password` | Password user MySQL `meet` | Script |
| `mysql_root_password` | Password quản trị MySQL | Script |
| `mysql_dsn` | Chuỗi kết nối MySQL của ứng dụng | Script |
| `redis_password`, `redis_url` | Password và kết nối Redis | Script |
| `demo_password` | Password cho seed thử nghiệm | Script |
| `cf_sfu_app_id`, `cf_sfu_secret` | SFU app | Người vận hành |
| `cf_turn_keys` | JSON TURN key/token | Người vận hành |
| `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket` | R2 | Người vận hành nếu dùng |

Không đưa thư mục này lên Git, không gửi trong ảnh chụp, không dán vào cửa sổ chat. Compose secrets ở VPS này là file mount, không phải dịch vụ tự mã hóa ổ đĩa; bạn vẫn cần bảo vệ bản backup.

### 4.4. Tạo lệnh rút gọn `meet`

Để các bước sau ít nhầm đường dẫn, tạo một shell function:

```bash
cat > /etc/profile.d/meet.sh <<'EOF'
meet() {
  docker compose --env-file /opt/meet/.env -f /opt/meet/deploy/compose.yaml "$@"
}
EOF
chmod 0644 /etc/profile.d/meet.sh
. /etc/profile.d/meet.sh
```

`meet ps` tương đương gọi Docker Compose với file cấu hình đúng. Nếu phiên SSH mới báo `meet: command not found`, chạy lại `. /etc/profile.d/meet.sh`. Function này dành cho đúng một cài đặt `/opt/meet`.

### 4.5. Build, tạo database và chạy ứng dụng

```bash
cd /opt/meet
meet config --quiet
meet up --build -d
meet ps -a
curl --fail http://127.0.0.1:8080/api/health
```

Lần đầu cần Internet để tải image và dependency. Compose chờ MySQL healthy, chạy `migrate` tạo schema, rồi khởi động API/Nginx. Kết quả mong đợi:

| Dịch vụ | Trạng thái bình thường |
|---|---|
| `mysql`, `redis` | Up, healthy |
| `migrate` | Exited (0) — đây là tác vụ chạy xong, không phải lỗi |
| `api`, `web` | Up |
| `seed` | Chưa chạy khi không bật demo profile |

Health trả `{"status":"ok"}`. Không cần tự tạo bảng thủ công hoặc import schema bằng công cụ khác. Nếu chưa `ok`, xử lý log trước khi tạo trường:

```bash
meet logs --tail=80 migrate api mysql redis web
```

## 5. Cấu hình tên miền và HTTPS

### 5.1. DNS

Trong DNS của tên miền, tạo bản ghi `A` cho hostname ứng dụng trỏ về IPv4 VPS. Chỉ tạo `AAAA` nếu VPS có IPv6 hoạt động. Khi khởi tạo chứng chỉ, có thể để DNS-only để kiểm tra trực tiếp origin trước khi bật proxy/CDN theo chính sách của đơn vị.

```bash
dig +short A meet.example.edu
dig +short AAAA meet.example.edu
```

Thay hostname bằng domain thật. Kết quả phải trỏ đúng VPS; DNS có thể cần thời gian cập nhật.

### 5.2. Caddyfile

Nếu đã thoát phiên shell, gán lại `MEET_DOMAIN` đúng tên miền. Với VPS mới, tạo cấu hình:

```bash
MEET_DOMAIN=meet.example.edu
cat > /etc/caddy/Caddyfile <<EOF
$MEET_DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
    header Strict-Transport-Security "max-age=31536000"
}
EOF
chmod 0644 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy
curl --fail "https://$MEET_DOMAIN/api/health"
```

Nếu Caddy đang phục vụ site khác, thêm site block thay vì ghi đè toàn bộ Caddyfile như ví dụ máy mới. Khi DNS và cổng phù hợp, Caddy tự xử lý HTTPS. Nếu lỗi, xem `journalctl -u caddy -n 80 --no-pager`.

Mở domain thật trên máy tính/điện thoại. Phải thấy màn hình đăng nhập và không có cảnh báo chứng chỉ. Đây mới là nơi dùng tài khoản thật. Địa chỉ `127.0.0.1:5173` ở bản xem trước của cuộc trò chuyện không phải địa chỉ VPS.

## 6. Khởi tạo trường và admin

### 6.1. Chuẩn bị password quản trị

```bash
cd /opt/meet
umask 077
if [ ! -e secrets/admin-nguyen-trai.password ]; then
  openssl rand -hex 24 > secrets/admin-nguyen-trai.password
else
  printf 'Giữ nguyên file password đã có.\n'
fi
chown 10001:10001 secrets/admin-nguyen-trai.password
chmod 0600 secrets/admin-nguyen-trai.password
```

Khối lệnh giữ nguyên file đã có khi bạn tiếp tục cài đặt, không tự sinh lại và ghi đè. Password này là password app admin, khác password root MySQL.

### 6.2. Tạo trường + tài khoản admin trong một lần

Thay slug, tên trường và email. Đường dẫn mount phải đúng file vừa tạo:

```bash
meet run --rm \
  -v /opt/meet/secrets/admin-nguyen-trai.password:/run/secrets/admin_password:ro \
  -e SCHOOL_SLUG=nguyen-trai \
  -e SCHOOL_NAME='Trường Nguyễn Trãi' \
  -e ADMIN_EMAIL=admin@example.edu \
  -e ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
  api bootstrap
```

Lệnh thành công thường kết thúc không in dữ liệu. Trường và admin được tạo cùng transaction; không có đăng ký công khai cho người tự tạo trường. Slug trùng sẽ báo lỗi, không cập nhật trường đã có. Ghi lại `SCHOOL_SLUG`: đây chính là **Mã trường** trên màn hình đăng nhập.

### 6.3. Đăng nhập lần đầu

Trong terminal quản trị riêng, đọc password để lưu vào password manager:

```bash
cat /opt/meet/secrets/admin-nguyen-trai.password
```

Không chạy bước hiển thị password khi chia sẻ màn hình/ghi hình terminal. Nhập ở trang web:

| Trường trên giao diện | Giá trị ví dụ |
|---|---|
| Mã trường | `nguyen-trai` |
| Email | `admin@example.edu` |
| Mật khẩu | Giá trị trong file riêng |

Vào **Tài khoản → Đổi mật khẩu**. Sau khi lưu, các phiên cũ hết hiệu lực và bạn đăng nhập lại bằng password mới. Lúc đó file bootstrap chứa password cũ, không phải password mới; cập nhật kho password quản trị của đơn vị. Ứng dụng hiện chưa có chức năng gửi email xác nhận, quên mật khẩu hoặc gửi lời mời tự động.

## 7. Tạo giáo viên, học sinh bằng Excel

### 7.1. Những thông tin phải có

Hiện tạo teacher/student qua import Excel. Để thêm một người, cũng có thể import file chỉ có một dòng dữ liệu. Không có nút thêm từng tài khoản riêng và không cho import role admin.

Tạo workbook `.xlsx` mới, chỉ giữ **một sheet**. Dòng 1 gồm đúng năm ô:

```text
email    name    role    password    class
```

Đây là năm cột riêng, không phải một ô chứa cả chuỗi. Không thêm cột STT hoặc tiêu đề lớn phía trên. Bảng dưới mô tả cách điền; cột password cần điền password riêng trước khi import:

| email | name | role | password | class |
|---|---|---|---|---|
| minh.teacher@example.edu | Nguyễn Minh | teacher | tự đặt riêng | để trống |
| lan.teacher@example.edu | Trần Lan | teacher | tự đặt riêng | để trống |
| an.student@example.edu | Nguyễn An | student | tự đặt riêng | 10A1 |
| binh.student@example.edu | Lê Bình | student | tự đặt riêng | 10A1 |
| chi.student@example.edu | Phạm Chi | student | tự đặt riêng | 10A2 |

**Không nhập chữ “tự đặt riêng” hoặc “để trống” vào file thật.** Chúng là chỉ dẫn; password mỗi người cần khác nhau. Teacher để ô class trống hoàn toàn.

### 7.2. Quy tắc được kiểm tra

- 1–100 người/lượt, tối đa 4 MiB, định dạng XLSX; CSV không import trực tiếp được.
- `email`: email hợp lệ, duy nhất trong trường; cùng email có thể thuộc trường khác.
- `name`: họ tên, không rỗng.
- `role`: đúng chữ thường `teacher` hoặc `student`.
- `password`: 12–72 **byte**; dùng ký tự ASCII giúp dễ kiểm soát giới hạn. Không dùng chung một password cho cả lớp.
- `class`: chỉ điền cho student. Lớp chưa có sẽ được tạo; lớp đã có sẽ thêm enrollment. Nếu để trống thì tài khoản tồn tại nhưng chưa có lớp.
- Không có sheet phụ, dòng tiêu đề phụ hoặc email trùng trong file.

Một dòng lỗi hoặc email đã tồn tại sẽ hủy **toàn bộ** lượt import. Không có chế độ cập nhật/ghi đè user cũ qua import. Muốn import 250 người, chia ba file 100/100/50 người.

### 7.3. Thao tác admin

1. Đăng nhập đúng mã trường.
2. Mở **Quản trị**; trên điện thoại mở **Menu → Quản trị**.
3. Tại **Import tài khoản từ Excel**, chọn file XLSX.
4. Chờ thông báo số tài khoản đã nhập; không gửi nhiều lượt đồng thời. Bcrypt có thể khiến lượt 100 người mất vài chục giây.
5. Kiểm tra danh sách tài khoản bên dưới; kiểm tra lớp ở phần chọn lớp.
6. Phân phối mã trường + email + password riêng qua kênh bảo mật.
7. Hướng dẫn người dùng đổi password lần đầu tại **Tài khoản**. Hiện việc này là quy trình bàn giao, chưa có cơ chế ép đổi tự động.

Ví dụ một student vừa import nhưng không thấy môn học: kiểm tra ô class/enrollment trước, rồi kiểm tra trường đã tạo course cho lớp đó chưa.

## 8. Tạo lớp, môn và phân công giảng dạy

### 8.1. Tạo lớp thủ công

Admin vào **Quản trị → Tạo lớp**, nhập `10A1`, bấm **Tạo lớp**. Nếu import đã tạo `10A1`, không tạo lại. Tên lớp là duy nhất trong trường; tránh khác nhau vì khoảng trắng hoặc cách viết không thống nhất.

### 8.2. Thêm student có sẵn vào lớp

Ở **Thêm học sinh vào lớp**:

1. Chọn lớp, ví dụ `10A1`.
2. Chọn đúng tên/email student đã import.
3. Bấm **Thêm vào lớp**.

Nếu báo trùng enrollment, student đã thuộc lớp đó. Một student có thể thuộc nhiều lớp trong mô hình hiện tại. Muốn chuyển lớp/xóa enrollment, giao diện hiện chưa hỗ trợ; không import lại cùng email để chuyển vì sẽ bị chặn trùng.

### 8.3. Tạo môn học cho một lớp

Ở **Tạo môn học**:

| Trường | Ví dụ |
|---|---|
| Tên môn | `Toán học` |
| Lớp | `10A1` |
| Giáo viên | Nguyễn Minh — tài khoản teacher đã tạo |

Bấm **Tạo môn**. Nếu teacher chưa xuất hiện trong danh sách, import teacher trước và tải lại trang Quản trị.

**Một course là một môn của một lớp, có một giáo viên phụ trách.** Vì vậy để dạy Toán cho hai lớp, tạo hai bản ghi:

| Course | Lớp | Giáo viên |
|---|---|---|
| Toán học | 10A1 | Nguyễn Minh |
| Toán học | 10A2 | Nguyễn Minh |
| Tiếng Anh | 10A1 | Trần Lan |

Giáo viên đăng nhập sẽ thấy các môn được gán cho mình. Student lớp 10A1 thấy các môn của 10A1, không tự thấy môn 10A2. Chưa có danh mục môn chung tự nhân bản cho nhiều lớp; tạo từng course theo bảng trên.

## 9. Cấu hình Cloudflare SFU và TURN

### 9.1. SFU: để cuộc gọi có âm thanh/video

Theo [tài liệu Cloudflare SFU](https://developers.cloudflare.com/realtime/sfu/get-started/), chọn account trong dashboard, mở **Realtime → Serverless SFU**, tạo app và lưu App ID/App Secret. Dùng app staging riêng với app production.

Trên VPS:

```bash
cd /opt/meet
nano secrets/cf_sfu_app_id
nano secrets/cf_sfu_secret
```

Mỗi file chỉ chứa giá trị của nó, không thêm `KEY=`, không thêm dấu nháy hoặc JSON. App Secret không phải token R2 và không đưa vào trình duyệt.

### 9.2. TURN: để hỗ trợ các mạng cần relay

Tạo TURN key bằng dashboard hoặc API chính thức; lấy TURN Key ID và API token dùng để cấp ICE credential. Cấu hình:

```bash
nano /opt/meet/secrets/cf_turn_keys
```

Nội dung JSON có dạng sau, thay toàn bộ placeholder bằng giá trị thật:

```json
[
  {"id": "YOUR_TURN_KEY_ID_1", "token": "YOUR_TURN_API_TOKEN_1"},
  {"id": "YOUR_TURN_KEY_ID_2", "token": "YOUR_TURN_API_TOKEN_2"}
]
```

Chỉ có một key thì dùng một phần tử. Không có key thì để file trống; ứng dụng chỉ trả STUN. Không dùng `[]` để thay file trống vì hiện mảng rỗng được xem là cấu hình TURN không hợp lệ.

Server giữ key dài hạn và cấp credential ngắn hạn cho browser. Mã nguồn đang cấp TTL 3600 giây, phân phối ổn định theo user và thử key kế tiếp nếu upstream lỗi. Nhiều key không tự tăng hạn mức gói hay bảo đảm cân tải theo quota. Xem [tài liệu TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

### 9.3. Sau khi chỉnh secret

Editor có thể tạo lại file với owner khác; chuẩn hóa quyền rồi recreate:

```bash
cd /opt/meet
chown -R 10001:10001 secrets
chmod 0700 secrets
chmod 0600 secrets/*
meet up -d --force-recreate api
curl --fail http://127.0.0.1:8080/api/health
```

Health `ok` chưa đủ chứng minh khóa đúng. Phải cho hai tài khoản đã phân lớp tham gia buổi live và kiểm tra nghe/nhìn nhau. Không chỉ kiểm tra hình camera của chính mình.

## 10. Cấu hình R2 để lưu bản ghi

Bỏ qua phần này nếu chưa dùng ghi hình; đừng bật tùy chọn ghi hình cho lớp khi chưa cấu hình R2.

### 10.1. Chuẩn bị bucket và khóa

Trong Cloudflare, tạo một bucket R2 **private**, ví dụ `meet-recordings`. Tạo credential S3 có quyền đọc/ghi object giới hạn vào bucket đó, lấy Account ID, Access Key ID và Secret Access Key. Không nhầm với Global API Key. Làm theo [hướng dẫn R2 S3](https://developers.cloudflare.com/r2/get-started/s3/).

Điền bốn file:

```bash
cd /opt/meet
nano secrets/r2_account_id
nano secrets/r2_access_key_id
nano secrets/r2_secret_access_key
nano secrets/r2_bucket
```

Trong `r2_bucket` chỉ ghi `meet-recordings` hoặc tên bucket thật. Trong `r2_account_id` chỉ ghi ID, không ghi URL endpoint. Các file khác cũng chỉ chứa giá trị, không có dấu nháy.

### 10.2. CORS cho browser upload

Trong cấu hình CORS của bucket, dùng origin thật:

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

Không để nguyên domain ví dụ. Không bật public bucket để xử lý lỗi CORS. Sau đó chuẩn hóa quyền và recreate API như mục 9.3.

### 10.3. Ghi hình hoạt động thế nào?

Giáo viên chủ động chọn tab/màn hình để ghi; đây không phải worker tự ghi toàn bộ SFU. Khi dừng, browser xin URL upload có hạn, gửi WebM vào R2, rồi API kiểm tra object để đánh dấu ready. Khi xem bản ghi, API kiểm tra quyền lại trước khi cấp URL tải có hạn. Tham chiếu [R2 presigned URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Thử đoạn 30 giây trước. Chọn chia sẻ audio nếu trình duyệt hỗ trợ và nghe lại để xác nhận. File nằm trong RAM browser trước khi upload; dùng đoạn ngắn, tối đa 1 GiB khi finalize. Chưa có resume/multipart hoặc khôi phục khi tab đóng; có thể mất bản ghi nếu mạng lỗi. Không coi hướng dẫn này là bảo đảm ghi đủ âm thanh trên mọi điện thoại/hệ điều hành.

## 11. Tạo và thực hiện buổi học đầu tiên

### 11.1. Giáo viên tạo lịch

1. Đăng nhập bằng tài khoản teacher, đúng mã trường.
2. Mở **Buổi học** hoặc **Tổng quan**.
3. Tại **Tạo buổi học**, chọn course, ví dụ `Toán học · 10A1`.
4. Nhập chủ đề `Hàm số và đồ thị`.
5. Chọn ngày/giờ bắt đầu theo giờ thiết bị đang sử dụng.
6. Chỉ bật **Cho phép ghi hình** khi trường đã có chính sách phù hợp và R2 đã nghiệm thu.
7. Bấm **Tạo buổi học**. Buổi mới có trạng thái `scheduled`.

Admin cũng có thể tạo. Student không có chức năng tạo buổi hoặc bắt đầu/kết thúc lớp. Lịch không tự chuyển live khi đến giờ.

### 11.2. Bắt đầu dạy

1. Giáo viên chọn **Vào lớp** ở buổi vừa tạo.
2. Bấm **Bắt đầu buổi học**; trạng thái chuyển `live`.
3. Bấm **Bật camera & tham gia**; cho phép mic/camera khi browser hỏi.
4. Student mở lịch của mình, vào buổi tương ứng và tham gia khi đã live.
5. Kiểm tra hai phía nghe/nhìn nhau. Nếu dùng hai thiết bị gần nhau, đeo tai nghe để giảm tiếng vọng.
6. Dùng nút bật/tắt mic, camera; giáo viên có thể chia sẻ màn hình trên browser hỗ trợ. Khi chưa có video track/camera ban đầu, thao tác thay camera bằng màn hình có thể không thực hiện được.

Lớp dùng cùng domain qua HTTPS. Không gửi session ID Cloudflare hoặc App Secret cho student; họ chỉ dùng tài khoản trường và danh sách buổi học.

### 11.3. Ghi và kết thúc

Nếu đã bật ghi hình: giáo viên chọn **Ghi màn hình vào R2**, chọn nguồn capture và audio phù hợp. Khi xong, **Dừng & lưu bản ghi**, chờ upload thành công rồi mới kết thúc buổi. Tránh đóng tab/chuyển app trong lúc upload.

Giáo viên/admin chọn **Kết thúc buổi học** để chuyển `ended`. Student chọn **Rời lớp**. Buổi đã kết thúc không mở lại bằng endpoint hiện tại; muốn dạy tiếp, tạo buổi khác. Lưu ý backend hiện chưa cưỡng chế ngắt ngay mọi kết nối SFU đã tồn tại; các bên nên rời phòng và đóng media. Đây là giới hạn phải xử lý thêm trước yêu cầu quản lý media chặt.

## 12. Xem điểm danh theo lớp, môn và vai trò

### 12.1. Bộ lọc

Mở **Báo cáo điểm danh**; student thấy **Điểm danh của tôi**. Chọn lần lượt:

1. **Lớp học** — chỉ các lớp có course trong phạm vi tài khoản.
2. **Môn học** — chỉ các course của lớp vừa chọn.
3. **Buổi học** — một buổi cụ thể hoặc **Tất cả buổi đã bắt đầu**.

Đổi lớp sẽ đặt lại môn/buổi; đổi môn sẽ đặt lại buổi. Các buổi `scheduled` không tính vào tổng. Bộ chọn buổi hiện hiển thị tối đa 200 buổi gần nhất của course; lựa chọn tất cả vẫn tổng hợp toàn bộ buổi live/ended.

| Vai trò | Được xem |
|---|---|
| Admin | Lớp và môn thuộc trường của mình |
| Teacher | Chỉ course mình phụ trách; cùng môn khác lớp cần được phân công riêng |
| Student | Course của lớp được enroll và chỉ dòng của chính mình |

API kiểm tra quyền, không chỉ ẩn nút trên giao diện. Không lấy dữ liệu trường khác bằng cách thay class/course ID trong URL.

### 12.2. Hiểu các số liệu

| Cột/chỉ số | Ý nghĩa |
|---|---|
| Buổi có kết nối `2/3` | Có ít nhất một join được ghi nhận ở 2 trên 3 buổi live/ended |
| Tổng thời gian | Tổng số giây được xác nhận, định dạng giờ/phút/giây |
| Vào lớp lần đầu | Lần join đầu trong phạm vi chọn |
| Ghi nhận gần nhất | Quan sát gần nhất, không khẳng định là giờ rời chính xác |
| 0 giây/chưa ghi nhận | Không có thời gian đã xác nhận trong phạm vi chọn |

Heartbeat khoảng 15 giây, thời gian do máy chủ xác định. Khoảng giữa hai quan sát quá 45 giây không được cộng; không tự cộng thời gian sau lần thấy cuối. Nhiều tab không nhân đôi thời gian. Báo cáo phản ánh kết nối ứng dụng, không chứng minh mức độ chú ý.

Admin/teacher xem 50 người mỗi trang; các thẻ thống kê ghi rõ cho trang đang xem. Student thấy tổng số buổi, số buổi có kết nối và tổng phút cá nhân. Học sinh đang enroll nhưng chưa tham gia vẫn có thể có dòng 0; báo cáo dùng enrollment hiện tại, chưa chụp danh sách lớp tại từng thời điểm lịch sử.

Ứng dụng chưa tự kết luận “đủ chuyên cần”, “đi muộn” hoặc “vắng có phép”. Trường cần xác định ngưỡng và bổ sung chính sách trước khi dùng số liệu để chấm chuyên cần chính thức.

## 13. Sử dụng trên điện thoại

- Mở cùng domain HTTPS trong browser; không cần cài app native.
- Dùng **Menu** để chọn chức năng; menu tự đóng sau khi chọn.
- Bộ lọc báo cáo xếp dọc; kết quả hiển thị thành thẻ, không cần kéo bảng ngang.
- Ô nhập/select dùng cỡ chữ 16 px trên mobile và nút thao tác hướng tới tối thiểu 44 px.
- Khi học, giữ tab đang hoạt động; tiết kiệm pin/chuyển app có thể làm browser hạn chế camera hoặc heartbeat.
- Chia sẻ màn hình và thu audio phụ thuộc browser/OS; không giả định mọi điện thoại đều hỗ trợ như desktop.

Đã kiểm tra bố cục và thao tác báo cáo ở viewport 360/390 px bằng Chromium. Đây chưa thay thế kiểm thử cuộc gọi thực tế trên iPhone/Android của trường.

## 14. Tạo thêm trường và dùng dữ liệu demo

### 14.1. Thêm trường thứ hai

Giữ nguyên stack, schema và domain; tạo file password riêng rồi chạy `api bootstrap` với slug khác, ví dụ `le-loi`, tên `Trường Lê Lợi`, email admin của trường đó. Lặp lại quy trình mục 6. Không thay school ID của user trong database để chuyển trường.

Mỗi trường tự import tài khoản và tạo course của mình. Cùng một email có thể có tài khoản ở hai trường; khi đăng nhập, mã trường quyết định tài khoản nào được dùng. Hiện chưa có dashboard superadmin để quản trị chéo toàn bộ trường.

### 14.2. Demo có database — chỉ ở môi trường thử riêng

Không chạy seed này trên database trường thật. Trong VPS/stack thử nghiệm đã chạy thành công:

```bash
meet --profile demo run --rm seed
```

Mã trường `demo` và `other`; mỗi trường có `admin@example.test`, `teacher@example.test`, `student@example.test`, lớp 10A1, một môn Toán và một buổi scheduled. Password nằm ở `secrets/demo_password`. Seed không đổi password của user đã có và không tự tạo dữ liệu báo cáo tham gia giả.

### 14.3. Xem trước giao diện — không có database

Thêm vào domain ứng dụng:

```text
/?demo=1&role=admin&page=attendance
/?demo=1&role=teacher&page=attendance
/?demo=1&role=student&page=attendance
```

Đây là dữ liệu minh họa trong giao diện, không phải đăng nhập thật. Biểu mẫu không lưu, phòng không bật camera, bản ghi không phát video thật, thời gian điểm danh là số mẫu. Dùng để xem thiết kế và huấn luyện thao tác; không dùng làm chứng cứ nghiệm thu media.

## 15. Sao lưu, nâng cấp và vận hành

### 15.1. Kiểm tra hằng ngày

```bash
. /etc/profile.d/meet.sh
meet ps -a
curl --fail http://127.0.0.1:8080/api/health
df -h
docker stats --no-stream
meet logs --tail=80 api web
```

Theo dõi dung lượng MySQL, Redis AOF, VPS và R2; lỗi 5xx, 429 và lỗi provider. Không bật log body chứa password, cookie, SDP hoặc signed URL. Đặt cảnh báo chi phí/giới hạn Cloudflare theo cấu hình của đơn vị.

### 15.2. Sao lưu MySQL

Thực hiện trong phiên root, tại `/opt/meet`:

```bash
cd /opt/meet
umask 077
mkdir -p /opt/meet/backups
MEET_BACKUP="/opt/meet/backups/meet-$(date -u +%Y%m%dT%H%M%SZ).sql"
meet exec -T mysql sh -c \
 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysqldump -u meet --single-transaction --no-tablespaces meet' \
 > "$MEET_BACKUP"
test -s "$MEET_BACKUP"
chmod 0600 "$MEET_BACKUP"
```

Nếu dump lỗi hoặc `test -s` không thành công, chưa có backup hợp lệ. Lưu bản mã hóa ngoài VPS, cùng secret và cấu hình cần khôi phục. MySQL chỉ giữ metadata bản ghi: video R2 phải có chính sách lưu/backup riêng. Redis AOF giúp giữ session qua restart nhưng mất Redis có thể buộc người dùng đăng nhập lại.

Thư mục backup không được commit. Đã cấu hình `.gitignore` cho `backups/`. Cần lập lịch và kiểm tra backup theo cơ chế vận hành của đơn vị; tài liệu không tự tạo cron.

### 15.3. Thử khôi phục

Tạo một VPS/stack staging riêng, có database trống, secret khớp và `meet` function trỏ đúng staging. Không thực hiện lệnh sau trên production đang dùng:

```bash
# Chỉ trên staging/đích khôi phục đã xác minh:
meet stop api
meet exec -T mysql sh -c \
 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysql -u meet meet' \
 < /path/to/verified-backup.sql
meet up -d api web
curl --fail http://127.0.0.1:8080/api/health
```

Xác nhận số trường/user/course/buổi học, đăng nhập và quyền báo cáo. Nếu cần thay database production, người vận hành phải có kế hoạch bảo trì, backup mới và kiểm tra đúng đích trước khi làm. Không có chức năng restore một nút trong UI.

### 15.4. Cập nhật mã nguồn

```bash
cd /opt/meet
git status --short
git rev-parse HEAD
```

Ghi commit hiện tại và tạo backup. Nếu có thay đổi cục bộ, review/lưu chúng trước khi cập nhật. Với working tree sạch:

```bash
git fetch origin
git pull --ff-only origin codex/multi-school-platform
meet build
meet run --rm migrate
meet up -d
curl --fail http://127.0.0.1:8080/api/health
```

Lệnh migrate cần thành công trước khi dùng bản mới. Schema hiện là v1, DDL tạo bảng idempotent; các thay đổi schema sau này cần migration có version. Rollback image không tự rollback schema. Restart `meet restart api` không đổi password database và không thay thế được quy trình migration.

### 15.5. Secret và các thao tác dễ nhầm

- Chỉnh file MySQL password sau lần khởi tạo đầu **không tự đổi** password bên trong MySQL. Phải thực hiện quy trình xoay password quản trị rồi cập nhật DSN tương ứng.
- Không xóa volume hoặc chạy `down -v` trên hệ thống có dữ liệu để xử lý lỗi đăng nhập/credential; tùy chọn đó xóa dữ liệu volume.
- Secret Cloudflare thay đổi nên chuẩn hóa quyền rồi recreate API.
- Nếu cần vô hiệu hóa tài khoản, chưa có nút admin UI; người vận hành phải có quy trình quản trị được review. Đổi password sẽ làm phiên cũ hết hiệu lực nhưng chưa bảo đảm ngắt ngay media SFU đã kết nối.

## 16. Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra | Cách xử lý |
|---|---|---|
| `Set APP_ORIGIN` | `.env`, function `meet` | Tạo đúng `/opt/meet/.env`; dùng `meet`, không gọi nhầm Compose từ thư mục khác |
| Secret không đọc được | Quyền file sau nano/editor | Chạy lại chown uid 10001/chmod như mục 9.3, recreate API |
| MySQL/Redis unhealthy | Log service, disk, password/DSN | Sửa đúng cấu hình; không xóa volume để thử |
| `migrate Exited (0)` | Exit code | Đây là trạng thái bình thường |
| HTTPS không lên | DNS A/AAAA, 80/443, Caddy log | Sửa DNS/port hoặc cấu hình xung đột |
| POST trả `Origin rejected` | Domain đang mở có đúng APP_ORIGIN? | Đồng nhất https/domain/port, recreate API sau sửa `.env` |
| Đăng nhập sai | Slug, email, password riêng | Kiểm tra đúng mã trường; email không phải tên hiển thị |
| Password file cũ không dùng được | Người dùng đã đổi password? | Dùng password mới; bootstrap/seed không reset user cũ |
| Không có teacher/student | Đang vào `?demo=1` hay login thật? | Đăng nhập thật đúng trường; import đúng file |
| Import thất bại | Sheet, header, byte password, email trùng | Sửa nguyên nhân và import lại; lượt lỗi không thêm một phần |
| Import teacher báo class sai | Teacher có ô class khác rỗng | Xóa giá trị ô class teacher |
| Student không thấy môn | Enrollment và course của lớp | Phân lớp và tạo course trước |
| Teacher không thấy môn | Course đã gán đúng teacher? | Chọn đúng tài khoản; cùng tên người có thể nhầm email |
| Không vào được lớp | Buổi còn scheduled/đã ended | Teacher bắt đầu trước; ended thì tạo buổi mới |
| SFU báo chưa cấu hình/502 | App ID, App Secret, kết nối ra Cloudflare | Điền đúng secret, kiểm tra quyền và nghiệm thu hai phía |
| TURN configuration invalid | File không phải JSON hoặc `[]` | Dùng mảng có key hợp lệ, hoặc file trống để chỉ STUN |
| Media negotiation busy | Có nhiều thao tác/tab đồng thời | Đợi thao tác trước xong; tránh gửi negotiation chồng |
| Session limit reached | Nhiều lần reload/tham gia cùng buổi | Hiện giới hạn 8 session/user/buổi; tạo buổi thử mới, chưa có cleanup tự động |
| Báo cáo trống | Đúng lớp/môn? Có buổi live/ended? | Buổi scheduled chưa tính; student cần enrollment |
| Thời gian thiếu khi khóa màn hình | Browser throttle, mạng gián đoạn | Giữ tab hoạt động; khoảng ngoài lease 45 giây không được cộng |
| Upload R2 lỗi | Bốn file R2, quyền bucket, CORS đúng origin | Sửa cấu hình, thử đoạn ngắn; không bật public để né lỗi |
| Bản ghi không có audio | Nguồn capture và lựa chọn audio | Thử browser/OS được trường hỗ trợ và nghe lại |
| Mobile không có chia sẻ màn hình | Browser/OS hỗ trợ khác nhau | Dùng desktop đã nghiệm thu cho tác vụ này |
| Login 429 | Nhiều lần login sau proxy | Chờ cửa sổ 5 phút; bổ sung rate limit proxy phù hợp trước mở rộng |

Khi nhờ hỗ trợ, cung cấp: commit, bước đang làm, thời gian lỗi, mã HTTP và log đã bỏ secret. Không gửi password, cookie, TURN credential hoặc URL R2 đã ký.

## 17. Biên bản kiểm tra và giới hạn hiện tại

### 17.1. Xác nhận sau khi cài

| Kiểm tra | Cần đạt |
|---|---|
| HTTPS | Domain thật mở không cảnh báo |
| Health | API trả `ok` |
| Tài khoản | Admin, teacher, student đăng nhập đúng mã trường |
| Dữ liệu | Import và phân lớp/course đúng |
| Phân quyền | Teacher không xem môn không phụ trách; student không xem người khác |
| Điểm danh | Lọc lớp → môn → buổi; buổi chưa bắt đầu không cộng |
| Cuộc gọi | Hai thiết bị/mạng nghe và nhìn nhau thật |
| TURN | Thử mạng cần relay hoặc test relay có kiểm soát |
| Ghi hình nếu dùng | Đoạn 30 giây upload, ready, xem lại có audio/video |
| Mobile | Thiết bị thực của trường thao tác được, không chỉ giả lập viewport |
| Backup | Dump hợp lệ và đã thử restore ở staging |

### 17.2. Những gì đã kiểm tra trong quá trình phát triển

CI Ubuntu đã chạy build/test Go và React, kiểm thử tích hợp MySQL/Redis với race detector, kiểm tra bảo mật dependency, build/start Compose và readiness qua Nginx. Báo cáo có test tổng hợp, phân quyền và filter. Giao diện mẫu đã được kiểm tra ba vai trò và viewport 360/390 px.

Cloudflare thật chưa được xác minh trong môi trường phát triển vì không có credential. Cài VPS, cấp HTTPS và gọi media bằng account của bạn vẫn cần nghiệm thu theo bảng trên; không suy ra chúng thành công chỉ vì CI xanh.

### 17.3. Phạm vi chưa hoàn chỉnh

Chưa có chứng nhận production-ready hoặc benchmark nhiều trường lớn. Các phần cần hoàn thiện theo nhu cầu triển khai gồm: server-side media close/revoke, reconnect và refresh TURN cho cuộc gọi dài, worker ghi hình dài có resume, quota/cleanup bản ghi, MFA/reset password/invite, chỉnh sửa/xóa dữ liệu qua UI, lịch sử enrollment và chính sách chuyên cần. Xem [kiến trúc](ARCHITECTURE.vi.md) và [nghiệm thu](ACCEPTANCE.vi.md) trước khi vận hành trường thật.

### Nguồn đối chiếu

- [Docker Engine trên Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Caddy packages](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
- [Cloudflare SFU](https://developers.cloudflare.com/realtime/sfu/get-started/)
- [Cloudflare TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [R2 S3](https://developers.cloudflare.com/r2/get-started/s3/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- Mã nguồn hiện có: `deploy/compose.yaml`, `deploy/init-secrets.sh`, Go bootstrap/import/report và React UI của repository này.
