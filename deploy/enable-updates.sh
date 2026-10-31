#!/usr/bin/env bash
# One-time bridge for existing /opt/meet installs. Never reclones or removes volumes.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Chạy bằng sudo bash.' >&2; exit 1; }
[[ -f /opt/meet/.env && -f /opt/meet/deploy/backup.py ]] || { echo 'Cần bản cài /opt/meet đã có sao lưu và schema v4.' >&2; exit 1; }
apt-get update
apt-get install -y ca-certificates curl git python3 python3-cryptography
MEET_UPDATE_SHA=$(python3 - <<'PY'
import json,urllib.request,urllib.parse
base='https://api.github.com/repos/lehuunghi/meet'
branch='codex/multi-school-platform'
def get(path):
    req=urllib.request.Request(base+path,headers={'User-Agent':'Meet-Updater-Bootstrap','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
sha=get('/commits/'+urllib.parse.quote(branch,safe=''))['sha']
query=urllib.parse.urlencode({'head_sha':sha,'event':'push','branch':branch,'per_page':20})
runs=[r for r in get('/actions/runs?'+query)['workflow_runs'] if r['head_sha']==sha and r['head_branch']==branch and r['path']=='.github/workflows/ci.yml']
if not runs:raise SystemExit('Chưa có CI cho bản mới; thử lại sau.')
run=max(runs,key=lambda r:r['id'])
if run['status']!='completed' or run['conclusion']!='success':raise SystemExit('CI bản mới chưa thành công; giữ nguyên ứng dụng.')
jobs=get('/actions/runs/'+str(run['id'])+'/jobs?per_page=100')['jobs']
if not all(any(j['name']==name and j['status']=='completed' and j['conclusion']=='success' for j in jobs) for name in ['api','web','containers']):raise SystemExit('Thiếu kiểm thử bắt buộc; không cập nhật.')
print(sha)
PY
)
[[ "$MEET_UPDATE_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
MEET_UPDATE_FILE=$(mktemp /tmp/meet-enable-update.XXXXXX.py)
trap 'rm -f -- "$MEET_UPDATE_FILE"' EXIT
curl -fsSL "https://raw.githubusercontent.com/lehuunghi/meet/$MEET_UPDATE_SHA/deploy/update.py" -o "$MEET_UPDATE_FILE"
python3 "$MEET_UPDATE_FILE" bootstrap
echo 'Đã bật cập nhật an toàn. Từ lần sau mở /setup → Cập nhật phiên bản từ GitHub.'
