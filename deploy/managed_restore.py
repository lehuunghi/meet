#!/usr/bin/env python3
"""Root-only managed data restore, retaining current code, domain and infrastructure.
The existing upgrade journal/verified rollback provides crash recovery under the shared lock.
"""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import uuid
import urllib.parse
import xml.etree.ElementTree as ET
ROOT=Path('/opt/meet')
REMOTE=re.compile(r'backups/[a-zA-Z0-9/_-]+\.meet')
LOCAL=re.compile(r'local:([a-f0-9-]{36}\.meet)')
def updater():
    spec=importlib.util.spec_from_file_location('restore_update',ROOT/'deploy/update.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u);u.ROOT=ROOT;return u

def list_backups(u):
    b=u.backup_module();cfg=u.read_json(ROOT/'runtime-config/settings.json');out=[]
    directory=u.STATE/'snapshots'
    if directory.exists():
        for p in directory.glob('*.meet'):
            if p.is_symlink() or not LOCAL.fullmatch('local:'+p.name):continue
            stat=p.stat()
            if 0<stat.st_size<=b.MAX_BYTES:out.append({'object_key':'local:'+p.name,'bytes':stat.st_size,'modified':dt.datetime.fromtimestamp(stat.st_mtime,dt.timezone.utc).isoformat()})
    if cfg.get('r2',{}).get('enabled'):
        token=''
        for _ in range(10):
            params={'list-type':'2','prefix':'backups/','max-keys':'1000'}
            if token:params['continuation-token']=token
            query=urllib.parse.urlencode(sorted(params.items()),quote_via=urllib.parse.quote,safe='-_.~')
            root=ET.fromstring(b.transfer('GET',cfg['r2'],'',query=query))
            for item in root.findall('{*}Contents'):
                key=item.findtext('{*}Key','');size=int(item.findtext('{*}Size','0'))
                if REMOTE.fullmatch(key) and 0<size<=b.MAX_BYTES:out.append({'object_key':key,'bytes':size,'modified':item.findtext('{*}LastModified','')[:40]})
            if root.findtext('{*}IsTruncated')!='true':break
            token=root.findtext('{*}NextContinuationToken','')
            if not token:raise ValueError('BACKUP_LIST_INCOMPLETE')
        else:raise ValueError('BACKUP_LIST_INCOMPLETE')
    return sorted(out,key=lambda x:x['modified'],reverse=True)[:100]

def read_snapshot(u,key):
    b=u.backup_module();local=LOCAL.fullmatch(key)
    if local:
        p=u.STATE/'snapshots'/local[1]
        if not p.is_file() or p.is_symlink() or p.stat().st_size>b.MAX_BYTES:raise ValueError('BACKUP_MISSING')
        raw=p.read_bytes()
    elif REMOTE.fullmatch(key):raw=b.transfer('GET',u.read_json(ROOT/'runtime-config/settings.json')['r2'],key)
    else:raise ValueError('BACKUP_INVALID')
    files=b.read_archive(b.unseal(raw,b.crypt_key(b.KEY)))
    manifest=json.loads(files['manifest.json'])
    for name,path in [('database','database.sql'),('source','source.tar')]:
        if hashlib.sha256(files[path]).hexdigest()!=manifest[name+'_sha256']:raise ValueError('BACKUP_INVALID')
    # A database-only mysqldump is required; reject database-selection directives.
    if re.search(rb'(?im)^\s*(?:USE\s|(?:CREATE|DROP|ALTER)\s+DATABASE\b)',files['database.sql']):raise ValueError('BACKUP_INVALID')
    return files

def root_sql(u,database,query=None,data=None):
    if not re.fullmatch(r'meet(?:_restore_[a-f0-9]{32})?',database):raise ValueError('Invalid staging database')
    cmd='MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -uroot -N -D '+database
    return u.compose('exec','-T','mysql','sh','-c',cmd,data=data if data is not None else query.encode()).decode().strip()

def validate_database(u,files):
    stage='meet_restore_'+uuid.uuid4().hex
    expected=u.sql('SELECT id FROM schools ORDER BY id')
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,36}',expected):raise ValueError('RESTORE_SCHOOL_MISMATCH')
    current=int(u.sql('SELECT MAX(version) FROM schema_migrations'))
    try:
        root_sql(u,'meet','CREATE DATABASE '+stage+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;')
        root_sql(u,stage,data=files['database.sql'])
        actual=root_sql(u,stage,'SELECT id FROM schools ORDER BY id;')
        version=int(root_sql(u,stage,'SELECT MAX(version) FROM schema_migrations;'))
        if actual!=expected:raise ValueError('RESTORE_SCHOOL_MISMATCH')
        if version>current:raise ValueError('RESTORE_NEWER_SCHEMA')
    finally:root_sql(u,'meet','DROP DATABASE IF EXISTS '+stage+';')

def write_private(path,raw):
    if path.is_symlink():raise ValueError('BACKUP_INVALID')
    temp=path.with_suffix('.restore-next');temp.write_bytes(raw);os.chmod(temp,0o600);os.chown(temp,10001,10001);os.replace(temp,path)

def restore_backup(u,key,report=lambda stage:None):
    if (ROOT/'runtime-config/maintenance').exists() or u.read_json(u.STATE/'journal.json').get('active'):raise ValueError('RESTORE_BUSY')
    if u.read_json(ROOT/'runtime-config/school-state.json').get('state')!='suspended':raise ValueError('RESTORE_REQUIRES_SUSPENDED')
    if int(u.sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):raise ValueError('LIVE_MEETINGS')
    if shutil.disk_usage(ROOT).free<3*1024**3:raise ValueError('BACKUP_DISK_FULL')
    u.checkout_safe();report('snapshot_download');files=read_snapshot(u,key);report('snapshot_verify');validate_database(u,files)
    if 'runtime-config/account-key' not in files:raise ValueError('RESTORE_KEY_MISSING')
    saved=json.loads(files['runtime-config/settings.json']);current=u.read_json(ROOT/'runtime-config/settings.json')
    if 'commerce' in saved:current['commerce']=saved['commerce']
    defaults=u.sql("SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME,',',DEFAULT_COLLATION_NAME) FROM information_schema.schemata WHERE schema_name='meet'").split(',')
    if len(defaults)!=2 or not all(re.fullmatch('[a-zA-Z0-9_]+',v) for v in defaults):raise ValueError('BACKUP_INVALID')
    sha=u.git('rev-parse','HEAD');job={'id':str(uuid.uuid4()),'kind':'restore','active':True,'old_sha':sha,'target':sha,'old_images':u.images(),'db_dirty':False,'frozen':True,'database_defaults':defaults}
    b=u.backup_module();u.STATE.mkdir(parents=True,exist_ok=True);u.checkpoint(job)
    try:
        (ROOT/'runtime-config/maintenance').write_text(job['id']);u.compose('stop','api','web')
        if int(u.sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):raise ValueError('LIVE_MEETINGS')
        u.pause_recorders(job);report('rollback_backup');u.checkpoint(job,snapshot=u.snapshot(b,job))
        # No destructive database operation occurs before the rollback snapshot is verified.
        report('restore_data');u.checkpoint(job,db_dirty=True)
        u.sql('DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET '+defaults[0]+' COLLATE '+defaults[1]);u.sql(data=files['database.sql'])
        write_private(ROOT/'runtime-config/settings.json',json.dumps(current).encode());write_private(ROOT/'runtime-config/account-key',files['runtime-config/account-key'])
        u.compose('run','--rm','--no-deps','migrate')
        u.sql("UPDATE meetings SET status='ended' WHERE status='live'; UPDATE presence SET online=FALSE;")
        u.compose('exec','-T','redis','sh','-c','REDISCLI_AUTH="$(cat /run/secrets/redis_password)" redis-cli FLUSHDB')
        report('restore_check');u.compose('up','-d','--no-deps','--no-build','api','web');u.health(sha)
        u.checkpoint(job,active=False,committed=True,result='success');(ROOT/'runtime-config/maintenance').unlink(missing_ok=True)
        u.publish(state='success',phase='done',current_sha=sha,message='Đã phục hồi dữ liệu và cấu hình kinh doanh. VPS vẫn tạm ngưng; kiểm tra trước khi kích hoạt.')
    except Exception:
        try:u.recover(job,b)
        except Exception:
            u.publish(state='recovery_required',phase='stopped',message='Phục hồi gián đoạn. Giữ khóa ghi và kiểm tra bản sao lưu hoàn tác.');raise ValueError('RESTORE_RECOVERY_REQUIRED') from None
        raise
    finally:
        if not (ROOT/'runtime-config/maintenance').exists():u.resume_recorders(job)
    return {'state':'suspended'}
