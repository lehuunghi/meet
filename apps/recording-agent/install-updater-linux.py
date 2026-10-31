"""Install a fixed root updater, pinning the administrator-supplied control origin."""
import json,os,re,shutil,sys
from pathlib import Path
from urllib.parse import urlsplit
app=Path('/opt/meet-recorder-agent');home=Path('/opt/meet-recorder-updater');data=Path('/var/lib/meet-recorder-agent')
if os.geteuid()!=0:raise SystemExit('Root required')
identity=json.loads((data/'identity.json').read_text());origin=os.environ.get('MEET_ORIGIN','');parsed=urlsplit(origin)
if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:raise SystemExit('Explicit HTTPS control origin required')
if identity.get('origin','').rstrip('/')!=origin.rstrip('/') or not re.fullmatch('[a-f0-9]{32}',identity.get('id','')) or not re.fullmatch('[a-f0-9]{64}',identity.get('token','')):raise SystemExit('Enrollment does not match the administrator control origin')
if not home.exists():
 home.mkdir(mode=0o700)
 for name in ('updater.mjs','unpack-linux.py'):shutil.copy2(app/name,home/name)
 (home/'runtime').mkdir(mode=0o700);shutil.copy2(app/'runtime/node',home/'runtime/node')
 (home/'trusted.json').write_text(json.dumps(identity));os.chmod(home/'trusted.json',0o600)
 (home/'runtime/node').chmod(0o700)
(app/'updater-supported.json').write_text('{"protocol":1}');(app/'updater-supported.json').chmod(0o644)
Path('/etc/systemd/system/meet-recorder-updater.service').write_text('[Unit]\nDescription=Meet recorder verified software updater\nAfter=network-online.target\n[Service]\nType=oneshot\nUser=root\nUMask=0077\nExecStart=/opt/meet-recorder-updater/runtime/node /opt/meet-recorder-updater/updater.mjs\nTimeoutStartSec=1200\n')
Path('/etc/systemd/system/meet-recorder-updater.timer').write_text('[Unit]\nDescription=Check pending Meet recorder updates\n[Timer]\nOnBootSec=60\nOnUnitActiveSec=30\nUnit=meet-recorder-updater.service\n[Install]\nWantedBy=timers.target\n')
