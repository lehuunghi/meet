"""Disposable CI Compose stack only. Real MySQL dump/restore; in-memory R2 transport."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types

if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST') != 'true':
    raise SystemExit('Explicit disposable-stack opt-in required')
spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
b.ROOT = Path(__file__).resolve().parent.parent
(b.ROOT / '.env').write_text('APP_ORIGIN=' + os.environ['APP_ORIGIN'] + '\n')
subprocess.run(['git', 'config', '--global', '--add', 'safe.directory', str(b.ROOT)], check=True)
objects = {}
original_compose = b.compose

def compose(*args, data=None):
    if args == ('run', '--rm', 'api', 'configure-storage'):
        return b''  # R2 provider integration is separately mocked by Go tests.
    return original_compose(*args, data=data)

def transfer(method, config, key, body=b''):
    if method == 'PUT':
        objects[key] = body
        return b''
    return objects[key]

b.compose, b.transfer = compose, transfer
with tempfile.TemporaryDirectory() as temporary:
    b.KEY = Path(temporary) / 'recovery.key'
    cfg = {'r2': {'enabled': True, 'account_id': 'a' * 32, 'bucket': 'ci-backup', 'access_key_id': 'ci-access', 'secret_access_key': 'ci-secret'}, 'backup': {'enabled': True, 'interval_hours': 24}, 'retention_days': 30, 'sfu': [], 'turn': []}
    (b.ROOT / 'runtime-config/settings.json').write_text(json.dumps(cfg))
    os.chown(b.ROOT / 'runtime-config/settings.json', 10001, 10001)
    compose('--profile', 'demo', 'run', '--rm', 'seed')
    b.backup(True)
    key = next(iter(objects))
    compose('stop', 'api', 'web')
    compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -h 127.0.0.1 -u root -e "DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET utf8mb4"')
    compose('run', '--rm', 'migrate')
    credential = Path(temporary) / 'r2.json'
    credential.write_text(json.dumps(cfg))
    b.restore(types.SimpleNamespace(credentials=str(credential), object=key, key=str(b.KEY)))
    count = compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysql -h 127.0.0.1 -u meet -N -D meet -e "SELECT COUNT(*) FROM schools"').decode().strip()
    if count != '2':
        raise AssertionError('Restored school data missing: ' + count)
    print('Real MySQL dump, encrypted snapshot, fresh schema restore and application rebuild passed')
