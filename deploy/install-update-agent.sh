#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Chạy bằng sudo bash.' >&2; exit 1; }
[[ -f /opt/meet/deploy/update.py && -f /opt/meet/deploy/release.json ]] || { echo 'Thiếu mã nguồn dịch vụ cập nhật tại /opt/meet.' >&2; exit 1; }
apt-get update
apt-get install -y python3 python3-cryptography git
install -d -m 0700 /var/lib/meet-updates
cat > /etc/systemd/system/meet-update.service <<'UNIT'
[Unit]
Description=Meet verified GitHub updater
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/meet/deploy/update.py worker
UMask=0077
TimeoutStartSec=45min
Restart=on-failure
RestartSec=30s
UNIT
cat > /etc/systemd/system/meet-update.timer <<'UNIT'
[Unit]
Description=Process operator-approved Meet update requests
[Timer]
OnBootSec=30s
OnUnitInactiveSec=30s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now meet-update.timer
echo 'Đã bật dịch vụ nhận yêu cầu cập nhật. Mở /setup → Cập nhật phiên bản.'
