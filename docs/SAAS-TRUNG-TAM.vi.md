# Quản trị trung tâm nhiều VPS — v0.6.0 (release candidate)

## Phạm vi

`control/` là dịch vụ quản trị độc lập cho `admin.tn.edu.vn`, chạy trên VPS Ubuntu riêng. Mỗi trường dùng một VPS/bộ MySQL/Redis riêng; dữ liệu học vụ tiếp tục ở VPS của trường. Trung tâm dùng SQLite WAL cho metadata và hàng đợi, chỉ hỗ trợ một instance trung tâm; không chia sẻ file SQLite qua NFS. Secret cấu hình được mã hóa AES-256-GCM theo ID trường; mật khẩu quản trị dùng scrypt. Đây là bản cần nghiệm thu SSH/DNS/Cloudflare trên môi trường staging trước khi mở vận hành nhiều trường.

Đã có: đăng nhập quản trị trung tâm, owner/operator/viewer, một phiên đăng nhập, bảng trường/VPS, chỉnh SFU/TURN/R2/retention/backup, cài máy mới qua SSH pin fingerprint, agent outbound HTTPS đăng ký một lần, lease/ack tác vụ, chống phát lại revision cấu hình, nâng cấp bằng updater hiện có, backup ngay, đổi domain có kiểm tra DNS/TLS và rollback origin, tạo/sửa/trạng thái/quyền quản trị trường. Nhật ký không chứa body, token hoặc stdout từ VPS.

Đăng nhập trường không có ô mã trường và mã OTP ban đầu. Mật khẩu đúng với tài khoản 2FA trả challenge 3 phút, tối đa 5 lượt; chưa cấp session. OTP hợp lệ mới thay phiên cũ. VPS managed xác định trường bằng binding/domain, không tin mã trường client gửi. API setup cũ trả 404 sau khi cấu hình managed áp dụng thành công; link setup trong admin bị ẩn, truy cập `/setup` chuyển về trang chính.

## Cài trung tâm

1. Dùng VPS Ubuntu 24.04/26.04 riêng, DNS `admin.tn.edu.vn` trỏ về IP của nó; mở TCP 80/443. Không tự dùng VPS trường đang có buổi live làm trung tâm.
2. Lấy checkout đã review và đủ CI, rồi chạy:

```bash
git clone --branch codex/multi-school-platform https://github.com/lehuunghi/meet.git
cd meet
sudo bash control/install.sh
```

3. Nhập domain, email và mật khẩu đầu tiên. Bộ cài tạo `meet-control.service`, proxy Caddy, thư mục dữ liệu `/var/lib/meet-control`; bind ứng dụng ở loopback 8090.
4. Mở domain và đăng nhập. Mật khẩu khởi tạo chỉ dùng lần đầu; file bootstrap bị xóa sau khi tạo tài khoản. Không chạy lại bộ cài trên trung tâm đang có dữ liệu.
5. Sao lưu `/var/lib/meet-control/control.db` bằng SQLite backup API (không copy riêng DB đang ghi mà bỏ WAL), và quản lý bản sao `vault.key` riêng, mã hóa ngoại tuyến. Mất khóa không giải mã được secret. Cấu hình service ở `/etc/meet-control.env`; nguồn read-only ở `/opt/meet-control`.

## Thêm trường và cài VPS

- **Thêm trường → Thông tin**: tên, domain, IP public, mã nội bộ tùy chọn, email/mật khẩu quản trị đầu tiên. Mã nội bộ không hiện tại login. Khi bỏ trống agent tạo `school-<8 ký tự ID trung tâm>`.
- **SFU / TURN**: mỗi SFU App một dòng, ID cấu hình ổn định, tên, App ID, Secret, trọng số 1–100, nhận lớp mới. TURN nhập Key ID/token. Mỗi trường có bộ credential riêng; chưa có thư viện credential dùng chung theo template.
- **R2 / Backup**: dùng bucket riêng của trường. Video mặc định 30 ngày, backup tự động theo chu kỳ giờ đã chọn. Backup vẫn dùng công cụ AES-GCM và recovery key hiện có trên VPS. Chưa có thời hạn tự xóa riêng cho backup từ giao diện này; không nhầm retention video với backup.
- **Lưu & đồng bộ** tạo revision và tác vụ. Chưa có agent thì tác vụ chờ.
- **Cài đặt / Nâng cấp → Cài mới Ubuntu**: nhập cổng SSH, fingerprint SHA256 đã đối chiếu qua console nhà cung cấp, mật khẩu root hoặc private key. Trung tâm xác minh commit hiện hành đã đạt đủ bốn nhóm CI, cài đúng SHA đó; chỉ kết nối IP public đã lưu, không tự tin host key vừa gặp. Credential SSH được mã hóa trong tác vụ và xóa payload khi lần cài kết thúc; không lưu stdout remote.
- VPS phải trống: có `/opt/meet` thì bộ cài dừng, không tự xóa/ghi đè. Lỗi cài giữa chừng cần người vận hành review máy, không bấm cài mới để cưỡng chế ghi đè. Chưa có trình tiếp tục mọi bước cài dở qua UI.
- Sau cài, agent kết nối HTTPS trung tâm, đổi enrollment token một lần lấy token riêng; nhận cấu hình, khởi tạo trường/admin, tắt setup cũ và báo revision áp dụng. Chỉ lúc đó bảng mới hiện đồng bộ thành công.

## Kết nối VPS Meet đã có

Không chạy bộ cài mới. Nâng cấp mã nguồn bằng updater an toàn, chờ hết buổi live; kiểm tra một trường duy nhất và điền `school_slug` đúng trường đã có để tránh khởi tạo nhầm. Owner cấp mã đăng ký qua `POST /api/schools/{id}/enroll` (15 phút). Trên VPS tạo file root-only `/etc/meet/agent.json` qua kênh bảo mật:

```json
{"url":"https://admin.tn.edu.vn","enroll_token":"<mã đăng ký một lần>","ip":"<IP VPS>"}
```

```bash
sudo chmod 600 /etc/meet/agent.json
sudo bash /opt/meet/control/install-agent.sh
```

Mã đăng ký không đưa vào URL/history hoặc chat. Chỉ tắt setup cũ sau khi cấu hình trung tâm áp dụng thành công. Chưa có nút adoption SSH cho bản đã có; thao tác này dành cho operator.

## Đồng bộ và nâng cấp

- Agent poll mỗi 20 giây. Trung tâm không khả dụng thì ứng dụng giữ cấu hình cuối và vẫn học bình thường.
- Job có ID, revision, lease và thời hạn; ack phải đúng agent/trường/lease. Agent lưu journal success để không lặp lại thao tác khi mất phản hồi. Configure cũ không ghi đè revision mới. Lease hết hạn tối đa 5 lượt; thao tác dài quá 30 phút cần review vì không có heartbeat gia hạn lease trong bản này.
- Đang có buổi live: cấu hình, domain và update chờ. Không kết thúc buổi tự động. Update sử dụng snapshot, khóa ghi, kiểm SHA/CI, rollback và journal hiện có; không cho downgrade hay bỏ qua CI. CI bản này gồm api/web/containers/control.
- **Kiểm tra bản mới**, chờ status agent cập nhật, tải lại danh sách; sau đó **Nâng cấp đã kiểm tra**. Phiên bản chỉ xác nhận qua health trả commit.
- **Backup ngay** dùng `--force`; lịch tự động vẫn do `meet-backup.timer` và cấu hình interval trên VPS. Chuẩn bị recovery key ngoại tuyến; file `/etc/meet/agent.json` không nằm trong backup ứng dụng, VPS thay thế phải đăng ký agent mới.
- Agent được cài riêng dưới `/etc/meet/agent.py`, không tự nâng binary agent khi đổi mã ứng dụng. Khi có thay đổi giao thức agent, cần review và chạy lại `install-agent.sh` qua operator; không giả định app update đã nâng agent.

## Đổi domain

DNS A/AAAA phải trỏ tới VPS; tác vụ kiểm tra IP, cấp/chứng thực HTTPS, khóa ghi, kiểm tra lại buổi live, đổi APP_ORIGIN/binding, recreate API và cập nhật R2 CORS. Lỗi thì khôi phục origin/binding/proxy; nếu health không trở lại, giữ maintenance để xử lý. Domain trung tâm chỉ cập nhật sau ACK success; sau đó xếp cấu hình mới. Chưa tự sửa DNS ở nhà cung cấp, có journal root-only để phục hồi origin/binding/proxy khi agent khởi động lại sau gián đoạn. Domain cũ không tự chuyển hướng trong bản này.

## Quản trị tài khoản

Tab Quản trị trường hiển thị ID/revision từ VPS. Tạo tài khoản mới hoặc nhập đúng ID/revision để sửa tên, email, mật khẩu, trạng thái và quyền. Chỉnh mật khẩu không bỏ qua hay xóa TOTP đang bật. Quản trị trung tâm không có phiên đăng nhập giả danh người học.

Quản trị SaaS có owner/operator/viewer. Có TOTP tùy chọn cho quản trị trung tâm trong Bảo mật tài khoản, xác minh mật khẩu khi thiết lập/tắt; tám mã khôi phục hiển thị một lần, lưu dạng hash và dùng một lần. Đăng nhập 2FA có challenge riêng, hết hạn và chống dùng lại. Chưa có liên kết quên mật khẩu trung tâm. Không dùng trang này thay cho cổng công khai tự đăng ký/thanh toán; chưa có billing/quota/subscription.

## Phục hồi và nghiệm thu

UI này chưa có phục hồi R2 tự động lên VPS mới. Dùng quy trình restore đã có, chỉ trên database chưa có trường, kiểm tra nguồn/schema và recovery key; sau đó đăng ký agent mới. Không phục hồi đè trường đang vận hành. Không nhận lệnh shell tùy ý từ trung tâm.

Các kiểm tra tự động: vault AAD/che secret/giữ secret theo ID, single session, role/CSRF, enroll một lần, auth agent, lease ack, đồng bộ revision, IP private bị chặn; agent giữ live và từ chối action lạ; Go/Redis/MySQL kiểm OTP hai bước; Playwright form đăng nhập không hiện mã trường/OTP ban đầu.

Cần nghiệm thu thực tế: SSH pin/máy trắng, DNS/HTTPS, Cloudflare R2 lifecycle/CORS, quay video nhiều browser, cài dở, mất mạng/reboot khi đổi domain, phục hồi VPS mới, backup trung tâm và tải nhiều agent. Không coi CI với transport giả lập là nghiệm thu các thao tác này.
