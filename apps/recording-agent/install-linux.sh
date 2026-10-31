#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Chạy bộ cài bằng sudo.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -x "$source_dir/runtime/node" ]] || { echo 'Thiếu runtime; dùng gói Linux đầy đủ.' >&2; exit 1; }
[[ ! -f /var/lib/meet-recorder-agent/identity.json ]] || { echo 'Đã đăng ký. Dừng dịch vụ trước khi cập nhật; giữ thư mục dữ liệu.' >&2; exit 1; }
read -r -p 'Địa chỉ Meet Server hoặc website trực tiếp (https://...): ' meet_origin
id meet-recorder >/dev/null 2>&1 || useradd --system --home-dir /var/lib/meet-recorder-agent --shell /usr/sbin/nologin meet-recorder
install -d -m 755 /opt/meet-recorder-agent
cp -a "$source_dir/." /opt/meet-recorder-agent/
chown -R root:root /opt/meet-recorder-agent
chmod -R go-w /opt/meet-recorder-agent
install -d -m 700 -o meet-recorder -g meet-recorder /var/lib/meet-recorder-agent
# Chromium's distribution libraries are supplied by the OS, not by disabling its sandbox.
/opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/node_modules/playwright/cli.js install-deps chromium
# Ubuntu may require an executable-specific AppArmor permission for user namespaces.
if [[ $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0) == 1 ]]; then
  command -v apparmor_parser >/dev/null || { echo 'Cần AppArmor parser để cho phép sandbox Chromium.' >&2; exit 1; }
  cat >/etc/apparmor.d/meet-recorder-browser <<'EOF'
abi <abi/4.0>,
include <tunables/global>
profile meet-recorder-browser /opt/meet-recorder-agent/node_modules/playwright-core/.local-browsers/**/{chrome,chrome-headless-shell} flags=(unconfined) {
  userns,
}
EOF
  apparmor_parser -r /etc/apparmor.d/meet-recorder-browser
fi
runuser -u meet-recorder -- env HOME=/var/lib/meet-recorder-agent MEET_AGENT_DATA=/var/lib/meet-recorder-agent /opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/agent.mjs --self-test
read -r -s -p 'Mã đăng ký máy dùng một lần: ' meet_code; echo
printf '%s' "$meet_code" | MEET_ORIGIN="$meet_origin" MEET_AGENT_DATA=/var/lib/meet-recorder-agent /opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/agent.mjs --enroll
unset meet_code
chown -R meet-recorder:meet-recorder /var/lib/meet-recorder-agent
cat >/etc/systemd/system/meet-recorder-agent.service <<'EOF'
[Unit]
Description=Meet recording agent
After=network-online.target
Wants=network-online.target
[Service]
User=meet-recorder
Group=meet-recorder
WorkingDirectory=/opt/meet-recorder-agent
Environment=MEET_AGENT_DATA=/var/lib/meet-recorder-agent
Environment=HOME=/var/lib/meet-recorder-agent
ExecStart=/opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/agent.mjs
Restart=on-failure
RestartSec=10
TimeoutStopSec=90
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/meet-recorder-agent
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now meet-recorder-agent
echo 'Đã cài. Kiểm tra trực tuyến và thử ghi trước khi sử dụng chính thức.'
