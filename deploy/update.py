#!/usr/bin/env python3
"""Fixed-repository updater. Invoked by root systemd, never by the web process."""
import argparse
import datetime as dt
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path('/opt/meet')
STATE = Path('/var/lib/meet-updates')
REPO = 'https://github.com/lehuunghi/meet.git'
BRANCH = 'codex/multi-school-platform'
BOOTSTRAP = False
API = 'https://api.github.com/repos/lehuunghi/meet'
SHA = re.compile(r'^[a-f0-9]{40}$')
TERMINAL = {'idle', 'checked', 'success', 'rolled_back', 'failed', 'recovery_required'}

def run(*args, data=None, timeout=120):
    return subprocess.run(list(args), input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=timeout).stdout

def git(*args):
    return run('git', '-C', str(ROOT), *args).decode().strip()

def atomic(path, value, public=False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.update-')
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, 0o600)
        if public and os.geteuid() == 0:
            os.chown(name, 10001, 10001)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def read_json(path, default=None):
    if not path.exists():
        return {} if default is None else default
    return json.loads(path.read_text())

def publish(**fields):
    status = read_json(STATE / 'status.json')
    status.update(fields)
    status['agent_seen'] = int(time.time())
    atomic(STATE / 'status.json', status)
    atomic(ROOT / 'runtime-config/update-status.json', status, public=True)
    return status

def checkpoint(job, **fields):
    job.update(fields)
    atomic(STATE / 'journal.json', job)

def github(path):
    request = urllib.request.Request(API + path, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'Meet-Safe-Updater/1'})
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('GitHub response too large')
    return json.loads(raw)

def ci_passed(target):
    params = urllib.parse.urlencode({'head_sha': target, 'event': 'push', 'branch': BRANCH, 'per_page': 20})
    runs = github('/actions/runs?' + params)['workflow_runs']
    matching = [r for r in runs if r['head_sha'] == target and r['head_branch'] == BRANCH and r['path'] == '.github/workflows/ci.yml']
    if not matching:
        return False
    latest = max(matching, key=lambda r: r['id'])
    if latest['status'] != 'completed' or latest['conclusion'] != 'success':
        return False
    jobs = github('/actions/runs/' + str(latest['id']) + '/jobs?per_page=100')['jobs']
    return all(any(j['name'] == name and j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs) for name in ['api', 'web', 'containers', 'control'])

def manifest(ref):
    try:
        value = json.loads(git('show', ref + ':deploy/release.json'))
    except subprocess.CalledProcessError:
        if not BOOTSTRAP:raise ValueError('Install the update protocol once using enable-updates.sh')
        if int(sql('SELECT MAX(version) FROM schema_migrations'))!=4:raise ValueError('Unsupported legacy schema')
        return {'version':'0.0.0','schema_version':4,'updater_protocol':0,'infrastructure_version':1}
    if not re.fullmatch(r'\d+\.\d+\.\d+', value.get('version', '')) or value.get('updater_protocol') != 1 or value.get('infrastructure_version') != 1 or not isinstance(value.get('schema_version'), int):
        raise ValueError('Unsupported release manifest')
    return value

def checkout_safe():
    if git('remote', 'get-url', 'origin').removesuffix('.git') != REPO.removesuffix('.git'):
        raise ValueError('Repository origin is not approved')
    if git('branch', '--show-current') != BRANCH:
        raise ValueError('Checkout is on another branch')
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Local changes detected; review them before updating')

def candidate():
    checkout_safe()
    current = git('rev-parse', 'HEAD')
    target = github('/commits/' + urllib.parse.quote(BRANCH, safe=''))['sha']
    if not SHA.fullmatch(target):
        raise ValueError('Invalid GitHub revision')
    git('fetch', '--no-tags', 'origin', BRANCH)
    if git('rev-parse', 'FETCH_HEAD') != target:
        raise ValueError('Branch changed while checking; check again')
    git('merge-base', '--is-ancestor', current, target)
    release = manifest(target)
    old = manifest(current)
    if release['schema_version'] < old['schema_version']:
        raise ValueError('Schema downgrade is not allowed')
    newer=tuple(map(int,release['version'].split('.'))) > tuple(map(int,old['version'].split('.')))
    ready = ((current != target and newer) or BOOTSTRAP) and ci_passed(target)
    return {'current_sha': current, 'current_version': old['version'], 'available_sha': target, 'available_version': release['version'], 'can_update': ready,
            'repository': 'https://github.com/lehuunghi/meet', 'branch': BRANCH,
            'message': 'Đã ở bản mới nhất.' if current == target else 'Có bản cập nhật đã qua CI.' if ready else 'Bản mới cần số phiên bản cao hơn và đủ kiểm thử GitHub; chưa được cập nhật.'}

def backup_module():
    spec = importlib.util.spec_from_file_location('meet_backup', ROOT / 'deploy/backup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = ROOT
    return module

def compose(*args, override=None, data=None):
    command = ['docker', 'compose', '--project-name', 'meet', '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'deploy/compose.yaml')]
    if override:
        command += ['-f', str(override)]
    return run(*command, *args, data=data, timeout=900)

def sql(query=None, data=None):
    command = 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysql -h 127.0.0.1 -u meet -N -D meet'
    if query is not None:
        # Queries are fixed literals from this module, never user input.
        return compose('exec', '-T', 'mysql', 'sh', '-c', command + ' -e "' + query + '"').decode().strip()
    return compose('exec', '-T', 'mysql', 'sh', '-c', command, data=data)

def images():
    result = {}
    for service in ['api', 'web']:
        container = compose('ps', '-q', service).decode().strip()
        if not container:
            raise ValueError('Current application must be running before updating')
        result[service] = run('docker', 'inspect', '--format', '{{.Image}}', container).decode().strip()
    return result

def override(path, api, web):
    atomic(path, {'services': {'api': {'image': api}, 'migrate': {'image': api}, 'web': {'image': web}}})
    return path

def snapshot(b, job):
    dump = compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysqldump -h 127.0.0.1 -u meet --single-transaction --no-tablespaces --set-gtid-purged=OFF meet')
    if len(dump) > b.MAX_BYTES - 1024 * 1024:
        raise ValueError('Update snapshot exceeds size limit')
    source=run('git','-C',str(ROOT),'archive','--format=tar',job['old_sha'])
    if len(dump)+len(source)>b.MAX_BYTES-1024*1024:raise ValueError('Update snapshot exceeds size limit')
    release_manifest={'version':1,'kind':'upgrade','commit':job['old_sha'],'database_sha256':hashlib.sha256(dump).hexdigest(),'source_sha256':hashlib.sha256(source).hexdigest()}
    contents = {'database.sql': dump,'source.tar':source,'manifest.json':json.dumps(release_manifest).encode()}
    for name in ['.env', 'secrets', 'runtime-config']:
        base = ROOT / name
        paths = [base] if base.is_file() else list(base.iterdir())
        for path in paths:
            if path.name.startswith(('update-', '.update-')) or path.name == 'maintenance':
                continue
            if path.is_symlink() or not path.is_file():
                raise ValueError('Unsafe configuration file')
            contents[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    output = io.BytesIO()
    import tarfile
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, raw in contents.items():
            b.add_bytes(archive, name, raw)
    if sum(map(len, contents.values())) > b.MAX_BYTES or len(output.getvalue()) > b.MAX_BYTES - 1024:
        raise ValueError('Update snapshot exceeds size limit')
    key = b.crypt_key(b.KEY, create=True)
    encrypted = b.seal(output.getvalue(), key)
    path = STATE / 'snapshots' / (job['id'] + '.meet')
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with path.open('xb') as file:
        file.write(encrypted)
        file.flush()
        os.fsync(file.fileno())
    os.chmod(path, 0o600)
    if b.unseal(path.read_bytes(), key) != output.getvalue():
        raise ValueError('Local snapshot verification failed')
    config = read_json(ROOT / 'runtime-config/settings.json')
    if config.get('r2', {}).get('enabled'):
        object_key = 'backups/updates/' + job['id'] + '.meet'
        b.transfer('PUT', config['r2'], object_key, encrypted)
        if b.transfer('GET', config['r2'], object_key) != encrypted:
            raise ValueError('Remote snapshot verification failed')
    return str(path)

def health(expected=None):
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3) as response:
                data = json.load(response)
            if data.get('status') == 'ok' and (expected is None or data.get('commit') == expected):
                return
        except Exception:
            pass
        time.sleep(2)
    raise ValueError('Application health/version check failed')

def internal_health():
    for _ in range(60):
        try:
            raw=compose('exec','-T','api','wget','-qO-','http://127.0.0.1:8080/api/health')
            if json.loads(raw).get('status')=='ok':return
        except Exception:pass
        time.sleep(2)
    raise ValueError('Internal application health check failed')

def recover(job, b):
    publish(state='updating', phase='rollback', message='Đang phục hồi bản trước; dữ liệu vẫn khóa ghi.')
    compose('stop', 'api', 'web')
    head=git('rev-parse','HEAD')
    if head not in {job['old_sha'],job['target']} or git('status','--porcelain','--untracked-files=normal'):
        raise ValueError('Checkout changed outside this update; preserve edits and require manual recovery')
    if job.get('snapshot'):
        files = b.read_archive(b.unseal(Path(job['snapshot']).read_bytes(), b.crypt_key(b.KEY)))
        if job.get('db_dirty'):
            defaults=job.get('database_defaults',['utf8mb4','utf8mb4_0900_ai_ci'])
            if len(defaults)!=2 or not all(re.fullmatch(r'[a-zA-Z0-9_]+',value) for value in defaults):raise ValueError('Unsafe database defaults in recovery journal')
            sql('DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET '+defaults[0]+' COLLATE '+defaults[1])
            sql(data=files['database.sql'])
        for name, raw in files.items():
            if name in ['database.sql','source.tar','manifest.json']:
                continue
            if name != '.env' and not name.startswith(('secrets/', 'runtime-config/')):
                raise ValueError('Unexpected recovery file')
            path = ROOT / name
            if path.is_symlink():
                raise ValueError('Unsafe recovery path')
            path.write_bytes(raw)
            os.chmod(path, 0o600)
            if name != '.env':
                os.chown(path, 10001, 10001)
    if git('rev-parse', 'HEAD') != job['old_sha']:
        # Only undo this updater's fast-forward, under maintenance and its exclusive lock.
        git('reset', '--hard', job['old_sha'])
    old = override(STATE / 'rollback.images.json', job['old_images']['api'], job['old_images']['web'])
    compose('up', '-d', '--no-deps', '--no-build', 'api', override=old)
    internal_health()
    checkpoint(job, active=False, committed=True, result='rolled_back')
    compose('up', '-d', '--no-deps', '--no-build', 'web', override=old)
    health()
    publish(state='rolled_back', phase='done', can_update=False, message='Nâng cấp không thành công; đã phục hồi dữ liệu và ứng dụng cũ.', current_sha=job['old_sha'])
    (ROOT / 'runtime-config/maintenance').unlink(missing_ok=True)

def apply(target, request_id):
    checked = candidate()
    if target != checked['available_sha'] or not checked['can_update']:
        raise ValueError('Requested revision is stale or has not passed CI')
    if int(sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):
        raise ValueError('Có lớp đang học; kết thúc các buổi trước khi cập nhật')
    if not BOOTSTRAP:
        with urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=5) as response:running=json.load(response)
        if running.get('status')!='ok' or running.get('commit')!=checked['current_sha']:
            raise ValueError('Running image does not match checkout; use the one-time bridge or repair before updating')
    release = manifest(target)
    if int(sql('SELECT MAX(version) FROM schema_migrations')) != manifest(checked['current_sha'])['schema_version']:
        raise ValueError('Installed schema does not match the current release; repair it first')
    if not BOOTSTRAP and git('show',checked['current_sha']+':deploy/compose.yaml') != git('show',target+':deploy/compose.yaml'):
        raise ValueError('Infrastructure configuration changed; this release needs a reviewed manual upgrade')
    if shutil.disk_usage(ROOT).free < 3*1024**3:
        raise ValueError('At least 3 GiB free disk is required before updating')
    defaults=sql("SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME,',',DEFAULT_COLLATION_NAME) FROM information_schema.schemata WHERE schema_name='meet'").split(',')
    if len(defaults)!=2 or not all(re.fullmatch(r'[a-zA-Z0-9_]+',value) for value in defaults):raise ValueError('Unknown database defaults')
    custom=int(sql("SELECT (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='meet')+(SELECT COUNT(*) FROM information_schema.events WHERE event_schema='meet')+(SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='meet')"))
    if custom:raise ValueError('Custom database routines/events/triggers need a reviewed manual upgrade')
    old_images = images()
    job = {'id': request_id, 'active': True, 'old_sha': checked['current_sha'], 'target': target, 'old_images': old_images, 'db_dirty': False, 'frozen': False, 'database_defaults':defaults}
    checkpoint(job)
    stage = STATE / ('stage-' + target)
    b = backup_module()
    try:
        publish(state='updating', phase='build', message='Đang dựng bản mới; ứng dụng hiện tại vẫn hoạt động.', can_update=False, id=request_id)
        if stage.exists():
            raise ValueError('Previous staging checkout exists; inspect it before retrying')
        git('worktree', 'add', '--detach', str(stage), target)
        if BOOTSTRAP:
            old_config=json.loads(compose('config','--format','json'))
            target_raw=run('docker','compose','--project-name','meet','--env-file',str(ROOT/'.env'),'-f',str(stage/'deploy/compose.yaml'),'config','--format','json')
            new_config=json.loads(target_raw.decode().replace(str(stage),str(ROOT)))
            for name in ['mysql','redis']:
                if old_config['services'][name]!=new_config['services'][name]:raise ValueError('Legacy infrastructure differs; manual migration required')
            for name in ['networks','volumes','secrets']:
                if old_config.get(name)!=new_config.get(name):raise ValueError('Legacy volumes/network/secrets differ; manual migration required')
        api_image, web_image = 'meet-api:' + target, 'meet-web:' + target
        run('docker', 'build', '--build-arg', 'MEET_COMMIT=' + target, '--build-arg', 'MEET_VERSION=' + release['version'], '-t', api_image, str(stage / 'apps/api'), timeout=900)
        run('docker', 'build', '-t', web_image, str(stage / 'apps/web'), timeout=900)
        checkout_safe()
        if git('rev-parse', 'HEAD') != job['old_sha'] or int(sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):
            raise ValueError('Checkout changed or a lesson started; retry later')
        checkpoint(job, frozen=True)
        (ROOT / 'runtime-config/maintenance').write_text(request_id)
        publish(state='updating', phase='backup', message='Đã khóa ghi; đang sao lưu và xác minh bản phục hồi.')
        compose('stop', 'api', 'web')
        if int(sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):
            raise ValueError('A lesson started before the maintenance freeze')
        checkpoint(job, snapshot=snapshot(b, job))
        checkout_safe()
        if git('rev-parse','HEAD')!=job['old_sha']:raise ValueError('Checkout changed during snapshot; do not overwrite it')
        git('merge', '--ff-only', target)
        env_path=ROOT / '.env'
        lines=[line for line in env_path.read_text().splitlines() if not line.startswith(('MEET_IMAGE_TAG=','MEET_COMMIT=','MEET_VERSION='))]
        lines += ['MEET_IMAGE_TAG='+target,'MEET_COMMIT='+target,'MEET_VERSION='+release['version']]
        env_path.write_text('\n'.join(lines)+'\n')
        new = override(STATE / 'current.images.json', api_image, web_image)
        checkpoint(job, db_dirty=True)
        publish(state='updating', phase='migrate', message='Đang nâng cấp dữ liệu; không đóng VPS.')
        compose('run', '--rm', '--no-deps', 'migrate', override=new)
        if int(sql('SELECT MAX(version) FROM schema_migrations')) != release['schema_version']:
            raise ValueError('Migrated schema does not match release manifest')
        publish(state='updating', phase='verify', message='Đang kiểm tra ứng dụng mới trước khi mở lại ghi dữ liệu.')
        compose('up', '-d', '--no-deps', '--no-build', 'api', 'web', override=new)
        health(target)
        checkpoint(job, active=False, committed=True, result='success')
        publish(state='success', phase='done', current_sha=target, current_version=release['version'], can_update=False, message='Cập nhật thành công. Cấu hình và dữ liệu được giữ nguyên.')
        (ROOT / 'runtime-config/maintenance').unlink(missing_ok=True)
    except Exception:
        if job.get('frozen'):
            try:
                if not job.get('committed'):recover(job,b)
                else:raise ValueError('Recovery committed; restart web without restoring data again')
            except Exception:
                publish(state='recovery_required', phase='stopped', message='Phục hồi tự động chưa hoàn tất. Giữ khóa ghi; cần người vận hành xử lý theo hướng dẫn.')
                raise
        else:
            checkpoint(job, active=False)
            publish(state='failed', phase='done', message='Dừng trước khi thay đổi dữ liệu. Xem nhật ký dịch vụ cập nhật.')
        raise
    finally:
        if stage.exists():
            try:
                git('worktree', 'remove', str(stage))
            except Exception:
                pass

def worker():
    job = read_json(STATE / 'journal.json')
    if job.get('committed') and (ROOT / 'runtime-config/maintenance').exists():
        if job['result']=='rolled_back':
            old=override(STATE/'rollback.images.json',job['old_images']['api'],job['old_images']['web'])
            compose('up','-d','--no-deps','--no-build','api','web',override=old)
        health(job['target'] if job['result']=='success' else None)
        publish(state=job['result'],phase='done',can_update=False,message='Đã hoàn tất kiểm tra và mở lại hệ thống.')
        (ROOT / 'runtime-config/maintenance').unlink(missing_ok=True)
    if job.get('active'):
        if job.get('frozen'):
            try:
                recover(job, backup_module())
            except Exception:
                publish(state='recovery_required',phase='stopped',can_update=False,message='Phục hồi bị gián đoạn. Giữ khóa ghi; xem nhật ký dịch vụ trước khi xử lý.')
                raise
        else:
            checkpoint(job, active=False)
            publish(state='failed', phase='done', message='Lần cập nhật trước bị ngắt trước khi thay đổi dữ liệu; kiểm tra staging trước khi thử lại.')
        return
    path = ROOT / 'runtime-config/update-request.json'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        publish()
        return
    try:
        with os.fdopen(fd) as file:
            raw = file.read(4097)
        path.unlink()
        if len(raw) > 4096:
            raise ValueError('Request too large')
        request = json.loads(raw)
        request_id = request['id']
        if str(uuid.UUID(request_id)) != request_id or abs(time.time() - request['created_at']) > 600:
            raise ValueError('Invalid or expired request')
        if request['action'] == 'check':
            publish(state='checking', phase='check', id=request_id, can_update=False, message='Đang kiểm tra GitHub và kết quả CI.')
            publish(state='checked', phase='done', **candidate())
        elif request['action'] == 'apply' and SHA.fullmatch(request.get('target', '')):
            publish(state='checking',phase='preflight',id=request_id,can_update=False,message='Đang xác minh lại bản cập nhật và điều kiện an toàn.')
            apply(request['target'], request_id)
        else:
            raise ValueError('Unsupported request')
    except Exception:
        status = read_json(STATE / 'status.json')
        if status.get('state') not in {'rolled_back', 'recovery_required'}:
            publish(state='failed', phase='done', can_update=False, message='Không cập nhật. Kiểm tra journalctl -u meet-update.service; ứng dụng/dữ liệu hiện có được giữ nếu chưa bước vào nâng cấp.')
        raise

def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['worker', 'check','bootstrap'])
    args = parser.parse_args()
    import fcntl
    with open('/run/meet-backup.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'bootstrap':
            global BOOTSTRAP
            BOOTSTRAP=True
            checked=candidate()
            apply(checked['available_sha'],str(uuid.uuid4()))
            run('bash',str(ROOT/'deploy/install-update-agent.sh'),timeout=300)
        elif args.action == 'check':
            publish(state='checked', phase='done', **candidate())
        else:
            worker()

if __name__ == '__main__':
    main()
