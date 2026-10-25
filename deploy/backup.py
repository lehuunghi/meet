#!/usr/bin/env python3
"""Root-only encrypted snapshots. No Docker socket or recovery key enters the web API."""
import argparse
import datetime as dt
import hashlib
import hmac
import io
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import subprocess
import tarfile
import urllib.request
import urllib.parse
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path('/opt/meet')
KEY = Path('/etc/meet/recovery.key')
MAGIC = b'MEET-BACKUP-1\0'
MAX_BYTES = 512 * 1024 * 1024

def compose(*args, data=None):
    return subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'deploy/compose.yaml'), *args], input=data, stdout=subprocess.PIPE, check=True).stdout

def crypt_key(path, create=False):
    if create and not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('x') as f:
            os.chmod(path, 0o600)
            f.write(secrets.token_hex(32))
    key = bytes.fromhex(path.read_text().strip())
    if len(key) != 32:
        raise ValueError('Recovery key must be 32 bytes')
    return key

def seal(raw, key):
    nonce = secrets.token_bytes(12)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, raw, MAGIC)

def unseal(raw, key):
    if not raw.startswith(MAGIC):
        raise ValueError('Unsupported snapshot')
    pos = len(MAGIC)
    return AESGCM(key).decrypt(raw[pos:pos+12], raw[pos+12:], MAGIC)

def transfer(method, config, object_key, body=b''):
    # AWS Signature V4. Credentials are read from a private file, never command arguments.
    account = config['account_id']
    if len(account) != 32 or any(c not in '0123456789abcdefABCDEF' for c in account):
        raise ValueError('Invalid R2 account')
    host = account + '.r2.cloudflarestorage.com'
    path = '/' + urllib.parse.quote(config['bucket'], safe='') + '/' + urllib.parse.quote(object_key, safe='/')
    now = dt.datetime.now(dt.timezone.utc)
    stamp, day = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    payload = hashlib.sha256(body).hexdigest()
    names = 'host;x-amz-content-sha256;x-amz-date'
    headers = 'host:' + host + '\nx-amz-content-sha256:' + payload + '\nx-amz-date:' + stamp + '\n'
    canonical = '\n'.join([method, path, '', headers, names, payload])
    scope = day + '/auto/s3/aws4_request'
    to_sign = '\n'.join(['AWS4-HMAC-SHA256', stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing = ('AWS4' + config['secret_access_key']).encode()
    for value in [day, 'auto', 's3', 'aws4_request']:
        signing = hmac.new(signing, value.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = 'AWS4-HMAC-SHA256 Credential=' + config['access_key_id'] + '/' + scope + ', SignedHeaders=' + names + ', Signature=' + signature
    req = urllib.request.Request('https://' + host + path, data=body if method == 'PUT' else None, method=method, headers={'Authorization': auth, 'x-amz-date': stamp, 'x-amz-content-sha256': payload})
    with urllib.request.urlopen(req, timeout=300) as response:
        result = response.read(MAX_BYTES + 1)
    if len(result) > MAX_BYTES:
        raise ValueError('Snapshot exceeds 512 MiB; use a streaming backup service for this deployment')
    return result

def add_bytes(archive, name, raw):
    info = tarfile.TarInfo(name)
    info.size, info.mode = len(raw), 0o600
    archive.addfile(info, io.BytesIO(raw))

def backup(force=False):
    settings_path = ROOT / 'runtime-config/settings.json'
    if not settings_path.exists() and not force:
        return
    cfg = json.loads(settings_path.read_text())
    policy = cfg.get('backup', {})
    if not force and not policy.get('enabled'):
        return
    hours = policy.get('interval_hours', 24)
    if not isinstance(hours, int) or not 1 <= hours <= 720:
        raise ValueError('Backup interval must be 1..720 hours')
    state = ROOT / 'runtime-config/backup-status.json'
    if not force and state.exists():
        last = json.loads(state.read_text())
        if dt.datetime.now(dt.timezone.utc).timestamp() - last.get('timestamp', 0) < hours * 3600:
            return
    if not cfg['r2']['enabled']:
        raise ValueError('Configure R2 first')
    dump = compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysqldump -h 127.0.0.1 -u meet --single-transaction --no-tablespaces --set-gtid-purged=OFF meet')
    if len(dump) > MAX_BYTES:
        raise ValueError('Database dump exceeds 512 MiB uncompressed')
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        add_bytes(archive, 'database.sql', dump)
        for relative in ['runtime-config/settings.json', 'runtime-config/account-key', '.env']:
            p = ROOT / relative
            if p.is_file():
                add_bytes(archive, relative, p.read_bytes())
        # Source is a complete Git snapshot, including committed docs, Docker and installer files.
        tracked = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z'], check=True, stdout=subprocess.PIPE).stdout.decode().split('\0')
        restored = ROOT / 'runtime-config/restored-source.json'
        extra = json.loads(restored.read_text()).get('files', []) if restored.exists() else []
        packed = io.BytesIO()
        with tarfile.open(fileobj=packed, mode='w') as code:
            for relative in sorted(set(tracked + extra)):
                if not relative or relative == '.env' or relative.startswith(('.git/', 'secrets/', 'runtime-config/')):
                    continue
                path = ROOT / relative
                if PurePosixPath(relative).is_absolute() or '..' in PurePosixPath(relative).parts or path.is_symlink():
                    raise ValueError('Unsafe source path')
                if path.is_file():
                    add_bytes(code, relative, path.read_bytes())
        source = packed.getvalue()
        if len(dump) + len(source) + 1024 * 1024 > MAX_BYTES:
            raise ValueError('Snapshot contents exceed 512 MiB uncompressed')
        add_bytes(archive, 'source.tar', source)
        commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True, stdout=subprocess.PIPE).stdout.decode().strip()
        add_bytes(archive, 'manifest.json', json.dumps({'version': 1, 'commit': commit, 'database_sha256': hashlib.sha256(dump).hexdigest(), 'source_sha256': hashlib.sha256(source).hexdigest()}, ensure_ascii=False).encode())
    raw = output.getvalue()
    if len(raw) > MAX_BYTES - 1024:
        raise ValueError('Compressed snapshot exceeds limit')
    encrypted = seal(raw, crypt_key(KEY, create=True))
    object_key = 'backups/' + dt.datetime.now(dt.timezone.utc).strftime('%Y/%m/%d/%H%M%S') + '-' + secrets.token_hex(4) + '.meet'
    transfer('PUT', cfg['r2'], object_key, encrypted)
    # Verify the bytes from R2 before reporting success.
    if not hmac.compare_digest(hashlib.sha256(transfer('GET', cfg['r2'], object_key)).digest(), hashlib.sha256(encrypted).digest()):
        raise ValueError('Remote backup verification failed')
    status = {'object_key': object_key, 'timestamp': dt.datetime.now(dt.timezone.utc).timestamp(), 'commit': commit, 'verified': True}
    temporary = state.with_suffix('.tmp')
    temporary.write_text(json.dumps(status))
    os.chmod(temporary, 0o600)
    if hasattr(os, "chown"):
        os.chown(temporary, 10001, 10001)
    os.replace(temporary, state)
    print('Verified encrypted snapshot: ' + object_key)

def read_archive(raw):
    result = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as archive:
        for item in archive:
            if item.isdir():
                continue
            name = PurePosixPath(item.name)
            if name.is_absolute() or '\\' in item.name or ':' in item.name or '..' in name.parts or not item.isfile() or item.size > MAX_BYTES:
                raise ValueError('Unsafe archive member')
            total += item.size
            if total > MAX_BYTES or item.name in result:
                raise ValueError('Oversized or duplicate archive member')
            result[item.name] = archive.extractfile(item).read()
    return result

def restore(args):
    credentials = json.loads(Path(args.credentials).read_text())
    credentials = credentials.get('r2', credentials)
    raw = transfer('GET', credentials, args.object)
    files = read_archive(unseal(raw, crypt_key(Path(args.key))))
    manifest = json.loads(files['manifest.json'])
    for name in ['database', 'source']:
        path = 'database.sql' if name == 'database' else 'source.tar'
        if hashlib.sha256(files[path]).hexdigest() != manifest[name + '_sha256']:
            raise ValueError('Snapshot integrity check failed')
    source = read_archive(files['source.tar'])
    for name in source:
        if name.startswith(('.git/', 'secrets/', 'runtime-config/')) or name == '.env':
            raise ValueError('Source snapshot contains private paths')
        target = ROOT / name
        if target.is_symlink() or any(parent.is_symlink() for parent in target.parents):
            raise ValueError('Restore target contains a symlink')
    # Restore is only for a fresh empty installation. Never replace an existing school.
    compose('up', '-d', 'mysql', 'redis')
    compose('stop', 'api', 'web')
    count = compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysql -h 127.0.0.1 -u meet -N -D meet -e "SELECT COUNT(*) FROM schools"').decode().strip()
    if count != '0':
        compose('up', '-d', 'api', 'web')
        raise ValueError('Restore requires an initialized schema with zero schools')
    compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysql -h 127.0.0.1 -u meet -D meet', data=files['database.sql'])
    # Preserve current domain and fresh database/Redis passwords; restore application configuration and TOTP key.
    for name in ['runtime-config/settings.json', 'runtime-config/account-key']:
        if name in files:
            p = ROOT / name
            p.write_bytes(files[name])
            os.chmod(p, 0o600)
            os.chown(p, 10001, 10001)
    for name, content in source.items():
        if name.startswith(('.git/', 'secrets/', 'runtime-config/')) or name == '.env':
            raise ValueError('Source snapshot contains private paths')
        p = ROOT / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)
    (ROOT / 'runtime-config/restored-source.json').write_text(json.dumps({'commit': manifest['commit'], 'files': list(source)}))
    compose('build')
    compose('run', '--rm', 'migrate')
    compose('run', '--rm', 'api', 'configure-storage')
    compose('up', '-d', 'api', 'web')
    print('Restored database, configuration, TOTP key and source commit ' + manifest['commit'])

def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='action', required=True)
    b = sub.add_parser('backup')
    b.add_argument('--force', action='store_true')
    r = sub.add_parser('restore')
    for name in ['object', 'credentials', 'key']:
        r.add_argument('--' + name, required=True)
    args = parser.parse_args()
    import fcntl
    with open('/run/meet-backup.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'backup':
            backup(args.force)
        else:
            restore(args)

if __name__ == '__main__':
    main()

