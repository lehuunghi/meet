#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
meet_step='khởi tạo'
trap 'status=$?; echo "Cài máy ghi thất bại ở bước: $meet_step (mã $status). Nhật ký: /var/log/meet-recorder-install.log" >&2; exit "$status"' ERR
check_only=false
if [[ ${1:-} == --check-only ]]; then check_only=true; shift; fi
[[ $# == 0 ]] || { echo 'Tham số không hợp lệ' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'Cần Ubuntu chạy systemd; không chạy trực tiếp trong container không có systemd.' >&2; exit 1; }

[[ $EUID -eq 0 ]] || { echo 'Chạy bộ cài bằng sudo.' >&2; exit 1; }
exec > >(tee -a /var/log/meet-recorder-install.log) 2>&1
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -x "$source_dir/runtime/node" ]] || { echo 'Thiếu runtime; dùng gói Linux đầy đủ.' >&2; exit 1; }
systemctl is-active --quiet meet-recorder-agent && { echo 'Máy ghi đang chạy. Ngừng nhận lớp và đợi ghi xong trước khi cập nhật.' >&2; exit 1; }
if [[ ! -f /var/lib/meet-recorder-agent/identity.json && $check_only == false ]]; then (: </dev/tty) || { echo 'Cần mở Terminal SSH tương tác để nhập mã đăng ký.' >&2; exit 1; }; fi
meet_origin=${MEET_ORIGIN:-}
if [[ -z "$meet_origin" ]]; then read -r -p 'Địa chỉ Meet Server hoặc website trực tiếp (https://...): ' meet_origin </dev/tty; fi
meet_step='chuẩn bị thư mục và tài khoản dịch vụ'
id meet-recorder >/dev/null 2>&1 || useradd --system --home-dir /var/lib/meet-recorder-agent --shell /usr/sbin/nologin meet-recorder
install -d -m 755 /opt/meet-recorder-agent
cp -a "$source_dir/." /opt/meet-recorder-agent/
chown -R root:root /opt/meet-recorder-agent
chmod -R go-w /opt/meet-recorder-agent
install -d -m 700 -o meet-recorder -g meet-recorder /var/lib/meet-recorder-agent
cd /opt/meet-recorder-agent
meet_step='cài thư viện trình duyệt'
# Chromium's distribution libraries are supplied by the OS, not by disabling its sandbox.
/opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/node_modules/playwright/cli.js install-deps chromium
# Ubuntu may require an executable-specific AppArmor permission for user namespaces.
if [[ $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0) == 1 ]]; then
  meet_step='cấu hình AppArmor cho trình duyệt máy ghi'
  if ! command -v apparmor_parser >/dev/null; then apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y apparmor; fi
  profile_file=/etc/apparmor.d/meet-recorder-browser
  [[ ! -f "$profile_file" ]] || apparmor_parser -R "$profile_file"
  profile_next=$(mktemp)
  printf 'abi <abi/4.0>,\ninclude <tunables/global>\n' >"$profile_next"
  browser_count=0
  while IFS= read -r -d '' executable; do
    [[ "$executable" != *'"'* && "$executable" != *'\\'* ]] || exit 1
    browser_count=$((browser_count+1))
    printf 'profile meet-recorder-browser-%s "%s" flags=(unconfined) {\n userns,\n}\n' "$browser_count" "$executable" >>"$profile_next"
  done < <(find /opt/meet-recorder-agent/node_modules/playwright-core/.local-browsers -type f \( -name chrome -o -name chrome-headless-shell -o -name headless_shell \) -print0 | sort -z)
  [[ $browser_count -gt 0 ]] || { echo 'Không tìm thấy trình duyệt trong bộ cài.' >&2; exit 1; }
  apparmor_parser -Q "$profile_next"
  install -m 644 "$profile_next" "$profile_file"
  rm -f -- "$profile_next"
  apparmor_parser -r "$profile_file"
fi
meet_step='kiểm tra ghi video bằng tài khoản nền'
runuser -u meet-recorder -- env HOME=/var/lib/meet-recorder-agent MEET_AGENT_DATA=/var/lib/meet-recorder-agent /opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/agent.mjs --self-test
if $check_only; then echo 'CHECK_ONLY_OK: trình duyệt và FFmpeg đã ghi được video; chưa đăng ký máy, chưa bật dịch vụ.'; exit 0; fi
meet_step='đăng ký máy với trung tâm'
if [[ ! -f /var/lib/meet-recorder-agent/identity.json ]]; then
read -r -s -p 'Mã đăng ký máy dùng một lần: ' meet_code </dev/tty; echo
printf '%s' "$meet_code" | MEET_ORIGIN="$meet_origin" MEET_AGENT_DATA=/var/lib/meet-recorder-agent /opt/meet-recorder-agent/runtime/node /opt/meet-recorder-agent/agent.mjs --enroll
unset meet_code
else echo 'Giữ danh tính đã đăng ký; phục hồi dịch vụ bị gián đoạn.'; fi
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
meet_step='khởi động dịch vụ máy ghi'
systemctl daemon-reload
systemctl enable --now meet-recorder-agent
sleep 2
systemctl is-active --quiet meet-recorder-agent
echo 'Kiểm tra trạng thái: systemctl status meet-recorder-agent --no-pager'
echo 'Xem nhật ký: journalctl -u meet-recorder-agent -n 50 --no-pager'
echo 'Đã cài. Kiểm tra trực tuyến và thử ghi trước khi sử dụng chính thức.'
