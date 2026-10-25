#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 && -s /etc/meet/agent.json ]] || { echo 'Root and agent enrollment file required'; exit 1; }
apt-get install -y python3 python3-cryptography
install -d -m 0700 /var/lib/meet-agent
install -m 0600 /opt/meet/control/agent.py /etc/meet/agent.py
cat > /etc/systemd/system/meet-control-agent.service <<'UNIT'
[Unit]
Description=Meet central management agent
After=network-online.target docker.service
Wants=network-online.target
[Service]
ExecStart=/usr/bin/python3 /etc/meet/agent.py
Restart=always
RestartSec=20
UMask=0077
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now meet-control-agent.service
