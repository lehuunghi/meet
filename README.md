# Meet — trường học trực tuyến đa trường

Monorepo **Go + React/Vite + MySQL + Redis**, tích hợp **Cloudflare Realtime SFU/TURN và R2**. Triển khai một VPS Ubuntu bằng Docker Compose, HTTPS qua Caddy.

## Có trong phiên bản này

- Tenant theo trường, admin / giáo viên / học sinh; khóa ngoại MySQL chặn liên kết chéo trường.
- Đăng nhập cookie HttpOnly, Redis lưu phiên 12 giờ; bcrypt; đổi mật khẩu vô hiệu hóa các phiên cũ; kiểm tra Origin; giới hạn đăng nhập.
- CLI tạo trường và admin, quản lý lớp/môn/giáo viên, phân lớp; import Excel nguyên tử tối đa 100 tài khoản mỗi lượt.
- Buổi học scheduled → live → ended; chỉ giáo viên phụ trách hoặc admin điều khiển.
- Camera/mic, thay camera bằng chia sẻ màn hình; SFU publish/subscribe và khám phá track có kiểm tra quyền phòng.
- Điểm danh theo heartbeat 15 giây, thời gian từ máy chủ, lease 45 giây, không cộng trùng nhiều tab; học sinh chỉ xem báo cáo của mình.
- Ghi màn hình từ trình duyệt giáo viên, upload WebM vào R2 private, xác nhận bằng HEAD và tải qua URL có hạn.
- Hai trường demo độc lập, test unit + integration, CI kiểm tra Go/Web/Compose.

## Chạy trên Ubuntu

Đọc **[hướng dẫn triển khai từng bước](docs/DEPLOYMENT.vi.md)** trước khi dùng dữ liệu thật.

```bash
git clone https://github.com/lehuunghi/meet.git
cd meet
git checkout codex/multi-school-platform
sudo bash deploy/init-secrets.sh
export APP_ORIGIN=http://localhost:8080
docker compose -f deploy/compose.yaml up --build -d
curl -f http://localhost:8080/api/health
# Chỉ môi trường demo:
docker compose -f deploy/compose.yaml --profile demo run --rm seed
```

Mở `http://localhost:8080`. Mã trường `demo` hoặc `other`. Email: `admin@example.test`, `teacher@example.test`, `student@example.test`. Mật khẩu được sinh ngẫu nhiên trong `secrets/demo_password`; không có mật khẩu mặc định công khai. Camera trên thiết bị khác cần HTTPS.

**Xem trước giao diện:** thêm `?demo=1` vào URL. Chế độ này chỉ hiển thị dữ liệu mẫu; không gọi API, không mô phỏng cuộc gọi thành công.

Có thể chuyển vai trò ngay trong giao diện hoặc mở `?demo=1&role=admin`, `?demo=1&role=teacher`, `?demo=1&role=student`. Bản xem trước bao gồm quản trị, lớp/môn, lịch học, phòng học minh họa, báo cáo điểm danh và thư viện bản ghi. Các biểu mẫu không lưu dữ liệu; phòng mẫu không bật thiết bị hay phát video thật. Những màn hình minh họa này không thay thế nghiệm thu các tính năng thật.

## Cấu trúc

```text
apps/api/       Go HTTP API, schema, CLI, tests
apps/web/       React + TypeScript + Vite, WebRTC, Nginx
deploy/         Compose, secrets initializer, Caddy mẫu
docs/           triển khai, kiến trúc, API, nghiệm thu
.github/        CI với MySQL 8.4, Redis và Docker Compose
```

## Phạm vi và trạng thái

Đây là bản triển khai đầu tiên để review và nghiệm thu, **chưa phải chứng nhận production-ready**. Cần chạy nghiệm thu SFU/TURN/R2 bằng credential của bạn, test nhiều trình duyệt và tải thực tế trước khi dùng cho trường thật. Không có credential nào được commit. Máy xây dựng không có Docker, vì vậy CI là nơi kiểm chứng Compose và tích hợp MySQL/Redis.

Ghi hình hiện là capture có chủ động của giáo viên, phụ thuộc tab và lựa chọn âm thanh của trình duyệt; chưa có worker ghi hình phía máy chủ, multipart/resume hoặc mixing âm thanh tự động. Xem [kiến trúc và giới hạn](docs/ARCHITECTURE.vi.md), [API](docs/API.md), [kịch bản nghiệm thu](docs/ACCEPTANCE.vi.md).

## Phát triển

Go 1.26.10 trở lên, Node 24. Dùng MySQL/Redis riêng cho phát triển. Excelize đang pin commit upstream đã vá các lỗi nhập workbook, chờ bản phát hành kế tiếp thay vì dùng bản 2.11.0 còn bị ảnh hưởng.

```bash
cd apps/api
go mod download
go test ./...
go vet ./...
# cấu hình MYSQL_DSN, REDIS_URL, APP_ORIGIN trước khi chạy
go run . migrate
go run .
```

```bash
cd apps/web
npm ci
npm test
npm run build
npm run dev
```

Đặt `APP_ORIGIN=http://localhost:5173` khi chạy Vite; mở đúng hostname localhost. Vite proxy `/api` tới Go ở cổng 8080. Tích hợp: đặt `TEST_MYSQL_DSN` (database dùng một lần, có `parseTime=true&loc=UTC`) và `TEST_REDIS_URL`, rồi `go test -count=1 -v ./...`. Test seed dữ liệu, không trỏ vào production.
