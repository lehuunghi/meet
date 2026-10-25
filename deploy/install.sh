#!/usr/bin/env bash
# Install only on a dedicated Ubuntu host. No credentials are downloaded or sent anywhere.
set -Eeuo pipefail
trap 'printf "\nCài đặt dừng ở dòng %s. Không xóa dữ liệu. Xem lỗi ở trên rồi chạy lại.\n" "$LINENO" >&2' ERR
MEET_DIR=/opt/meet
MEET_BRANCH=codex/multi-school-platform
MEET_REPO=https://github.com/lehuunghi/meet.git
export DEBIAN_FRONTEND=noninteractive
fail(){ printf '%s\n' "$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || fail 'Chạy bằng sudo bash.'
[[ -r /etc/os-release ]] || fail 'Không xác định được hệ điều hành.'
. /etc/os-release
[[ "$ID" == ubuntu && ( "$VERSION_ID" == 24.04 || "$VERSION_ID" == 26.04 ) ]] || fail 'Hỗ trợ Ubuntu 24.04/26.04.'
[[ -n "${MEET_DOMAIN:-}" || -r /dev/tty ]] || fail 'Cần terminal tương tác để nhập domain.'
printf '\nMEET · CÀI ĐẶT VÀ KHỞI TẠO\nDomain cần có DNS trỏ về VPS và TCP 80/443 được mở.\n'
if [[ -z "${MEET_DOMAIN:-}" ]]; then read -r -p 'Domain quản lý (ví dụ meet.truong.edu.vn): ' MEET_DOMAIN </dev/tty; fi
MEET_DOMAIN=${MEET_DOMAIN,,}
[[ ${#MEET_DOMAIN} -le 253 && "$MEET_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail 'Chỉ nhập hostname hợp lệ, không có https:// hoặc đường dẫn.'
apt-get update
apt-get install -y ca-certificates curl gnupg git openssl python3 python3-cryptography
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/meet-docker.asc
  chmod 0644 /etc/apt/keyrings/meet-docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/meet-docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" > /etc/apt/sources.list.d/meet-docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/meet-caddy-key.asc
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/meet-caddy-key.asc
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
if [[ -d "$MEET_DIR/.git" ]]; then
  [[ "$(git -C "$MEET_DIR" remote get-url origin)" == "$MEET_REPO" ]] || fail '/opt/meet thuộc repository khác; giữ nguyên và dừng.'
  [[ -z "$(git -C "$MEET_DIR" status --porcelain --untracked-files=normal)" ]] || fail '/opt/meet có thay đổi cục bộ; review trước khi chạy lại.'
  [[ "$(git -C "$MEET_DIR" branch --show-current)" == "$MEET_BRANCH" ]] || fail 'Checkout đang ở nhánh khác; không tự chuyển nhánh.'
  fail "Đã có bản cài. Không chạy lại bộ cài để nâng cấp. Dùng /setup hoặc deploy/enable-updates.sh theo hướng dẫn cập nhật an toàn."
else
  [[ ! -e "$MEET_DIR" ]] || fail '/opt/meet đã tồn tại, không ghi đè.'
  git clone --branch "$MEET_BRANCH" "$MEET_REPO" "$MEET_DIR"
fi
cd "$MEET_DIR"
umask 077
if [[ -f .env ]]; then
  MEET_OLD_ORIGIN=$(sed -n 's/^APP_ORIGIN=//p' .env)
  [[ "$MEET_OLD_ORIGIN" == "https://$MEET_DOMAIN" ]] || fail 'Domain khác cấu hình hiện có; đổi domain bằng quy trình bảo trì.'
else
  printf 'APP_ORIGIN=https://%s\n' "$MEET_DOMAIN" > .env
fi
bash deploy/init-secrets.sh
cat > /usr/local/bin/meet <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec docker compose --env-file /opt/meet/.env -f /opt/meet/deploy/compose.yaml "$@"
EOF
chmod 0755 /usr/local/bin/meet
if ! grep -q '^MEET_COMMIT=' .env; then printf '\nMEET_COMMIT=%s\nMEET_VERSION=%s\n' "$(git rev-parse HEAD)" "$(python3 -c 'import json;print(json.load(open("deploy/release.json"))["version"])')" >> .env; fi
meet config --quiet
meet build
# Run migration explicitly even when a previous migration container already exited successfully.
meet up -d mysql redis
meet run --rm migrate
meet up -d api web
install -d -m 0700 /etc/meet
if [[ ! -f /etc/meet/recovery.key ]]; then openssl rand -hex 32 > /etc/meet/recovery.key; fi
chmod 0600 /etc/meet/recovery.key
cat > /etc/systemd/system/meet-backup.service <<'BACKUP_SERVICE'
[Unit]
Description=Meet encrypted R2 backup
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/meet/deploy/backup.py backup
UMask=0077
BACKUP_SERVICE
cat > /etc/systemd/system/meet-backup.timer <<'BACKUP_TIMER'
[Unit]
Description=Check Meet configured backup interval
[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
Persistent=true
[Install]
WantedBy=timers.target
BACKUP_TIMER
systemctl daemon-reload
systemctl enable --now meet-backup.timer
bash deploy/install-update-agent.sh
MEET_READY=false
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then MEET_READY=true; break; fi
  sleep 2
done
[[ "$MEET_READY" == true ]] || fail 'Ứng dụng chưa healthy. Chạy: meet logs --tail=100'
install -d -m 0755 /etc/caddy/meet-sites
MEET_SITE_FILE="/etc/caddy/meet-sites/$MEET_DOMAIN.caddy"
if [[ ! -e "$MEET_SITE_FILE" ]]; then
  printf '%s {\n encode zstd gzip\n reverse_proxy 127.0.0.1:8080\n header Strict-Transport-Security "max-age=31536000"\n}\n' "$MEET_DOMAIN" > "$MEET_SITE_FILE"
fi
chmod 0644 "$MEET_SITE_FILE"
if [[ ! -f /etc/caddy/Caddyfile ]]; then : > /etc/caddy/Caddyfile; fi
if ! grep -Fq 'import /etc/caddy/meet-sites/*.caddy' /etc/caddy/Caddyfile; then
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-meet-$(date +%Y%m%d%H%M%S)"
  printf '\nimport /etc/caddy/meet-sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
chmod 0644 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy
MEET_HTTPS=false
for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 5 --max-time 10 "https://$MEET_DOMAIN/api/health" >/dev/null; then MEET_HTTPS=true; break; fi
  sleep 2
done
[[ "$MEET_HTTPS" == true ]] || fail "HTTPS chưa xác minh được. Kiểm tra DNS, 80/443 và journalctl -u caddy. Sau khi sửa, mở https://$MEET_DOMAIN/setup và đọc mã tại $MEET_DIR/runtime-config/setup-token"
if [[ -n "${MEET_RESTORE_OBJECT:-}" ]]; then
  [[ -n "${MEET_RESTORE_CREDENTIALS:-}" && -n "${MEET_RESTORE_KEY:-}" ]] || fail 'Restore cần đường dẫn credential và khóa phục hồi.'
  python3 deploy/backup.py restore --object "$MEET_RESTORE_OBJECT" --credentials "$MEET_RESTORE_CREDENTIALS" --key "$MEET_RESTORE_KEY"
  curl -fsS --retry 30 --retry-connrefused --retry-delay 2 "https://$MEET_DOMAIN/api/health" >/dev/null
fi
if [[ "${MEET_MANAGED:-}" == true ]]; then exit 0; fi
printf '\nCÀI ĐẶT THÀNH CÔNG · HTTPS VÀ DATABASE ĐÃ PHẢN HỒI\n'
printf 'Mở trang cấu hình riêng tư dưới đây (không gửi link cho người khác):\nhttps://%s/setup#token=%s\n' "$MEET_DOMAIN" "$(cat runtime-config/setup-token)"
printf '\nTại trang này: tạo trường/admin → nhập SFU Apps/TURN → cấu hình R2 lưu 30 ngày.\n'
printf 'Mã quản trị cấu hình lưu tại: /opt/meet/runtime-config/setup-token\nLệnh vận hành: sudo meet ps | sudo meet logs --tail=100\n'
