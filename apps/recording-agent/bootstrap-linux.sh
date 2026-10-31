#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Chạy lệnh bằng root (sudo -i).' >&2; exit 1; }
meet_server=''
while [[ $# -gt 0 ]]; do case "$1" in --server) meet_server=${2:?Thiếu domain}; shift 2;; *) echo 'Tham số không hợp lệ' >&2; exit 1;; esac; done
[[ -z "$meet_server" || "$meet_server" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]] || { echo 'Domain phải là HTTPS, không có đường dẫn.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Gói hiện tại dành cho Ubuntu x64.' >&2; exit 1; }
[[ ! -e /var/lib/meet-recorder-agent/identity.json ]] || { echo 'Máy đã đăng ký; giữ data và cập nhật có kiểm soát, không cài đè.' >&2; exit 1; }
apt-get update
apt-get install -y curl ca-certificates python3 tar
stage=$(mktemp -d /tmp/meet-recorder-install.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT
cd "$stage"
base='https://github.com/lehuunghi/meet/releases/download/recorder-agent-v0.3.0'
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 "$base/meet-recorder-linux-x64.tar.gz" -o meet-recorder-linux-x64.tar.gz
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 "$base/meet-recorder-linux-x64.tar.gz.sha256" -o meet-recorder-linux-x64.tar.gz.sha256
sha256sum --check meet-recorder-linux-x64.tar.gz.sha256
python3 - <<'PY'
import tarfile,posixpath
with tarfile.open('meet-recorder-linux-x64.tar.gz') as archive:
 for item in archive:
  name=item.name
  if name.startswith('/') or '..' in name.split('/') or name.split('/')[0]!='meet-recorder-linux-x64':raise SystemExit('Đường dẫn trong gói không hợp lệ')
  if not (item.isfile() or item.isdir() or item.issym() or item.islnk()):raise SystemExit('Loại file trong gói không hợp lệ')
  if item.issym() or item.islnk():
   target=posixpath.normpath(posixpath.join(posixpath.dirname(name) if item.issym() else '',item.linkname))
   if target.startswith('/') or not target.startswith('meet-recorder-linux-x64/'):raise SystemExit('Liên kết trong gói không hợp lệ')
PY
tar --extract --gzip --file meet-recorder-linux-x64.tar.gz --no-same-owner --no-same-permissions
MEET_ORIGIN="$meet_server" bash "$stage/meet-recorder-linux-x64/install-linux.sh"
