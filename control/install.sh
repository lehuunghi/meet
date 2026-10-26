#!/usr/bin/env bash
# Run from a reviewed checkout on the dedicated control-plane Ubuntu host.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Chạy bằng sudo bash'; exit 1; }
. /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 24.04 || $VERSION_ID == 26.04 ) ]] || { echo 'Cần Ubuntu 24.04/26.04'; exit 1; }
[[ ! -e /etc/systemd/system/meet-control.service ]] || { echo 'Đã cài trung tâm; không ghi đè cấu hình hiện có'; exit 1; }
read -r -p 'Domain trung tâm [admin.tn.edu.vn]: ' domain
domain=${domain:-admin.tn.edu.vn}
[[ $domain =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]] || exit 1
read -r -p 'Email chủ hệ thống: ' email
[[ $email =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || exit 1
read -r -s -p 'Mật khẩu đầu tiên (12–72 byte): ' password
printf '\n'
[[ ${#password} -ge 12 && ${#password} -le 72 ]] || exit 1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-cryptography python3-paramiko caddy
id meet-control >/dev/null 2>&1 || useradd --system --home /var/lib/meet-control --shell /usr/sbin/nologin meet-control
install -d -m 0755 /opt/meet-control
install -d -m 0700 -o meet-control -g meet-control /var/lib/meet-control
install -m 0644 "$(dirname "$0")"/{server.py,provision.py,relocation.py,index.html} /opt/meet-control/
umask 077
printf '%s' "$password" > /var/lib/meet-control/bootstrap-password
unset password
chown meet-control:meet-control /var/lib/meet-control/bootstrap-password
cat > /etc/meet-control.env <<EOF
MEET_CONTROL_DATA=/var/lib/meet-control
MEET_CONTROL_ORIGIN=https://$domain
MEET_CONTROL_EMAIL=$email
MEET_CONTROL_PASSWORD_FILE=/var/lib/meet-control/bootstrap-password
EOF
chmod 0600 /etc/meet-control.env
cat > /etc/systemd/system/meet-control.service <<'UNIT'
[Unit]
Description=Meet SaaS control plane
After=network-online.target
Wants=network-online.target
[Service]
User=meet-control
Group=meet-control
EnvironmentFile=/etc/meet-control.env
ExecStart=/usr/bin/python3 /opt/meet-control/server.py
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/meet-control
[Install]
WantedBy=multi-user.target
UNIT
install -d -m 0755 /etc/caddy/meet-sites
printf '%s {\n reverse_proxy 127.0.0.1:8090\n header Strict-Transport-Security "max-age=31536000"\n}\n' "$domain" > "/etc/caddy/meet-sites/$domain.caddy"
chmod 0644 "/etc/caddy/meet-sites/$domain.caddy"
grep -Fq 'import /etc/caddy/meet-sites/*.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/meet-sites/*.caddy\n' >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now meet-control.service caddy
systemctl reload caddy
printf 'Mở https://%s sau khi DNS trỏ đúng và HTTPS cấp thành công.\n' "$domain"
