#!/usr/bin/env python3
"""Root-only portable snapshots. Restore only into an empty managed installation."""
import argparse, fcntl, hashlib, importlib.util, io, json, os, re, subprocess, tarfile, urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path('/opt/meet');STATE=Path('/var/lib/meet-relocations');MAX=128*1024*1024
RESTORED=Path('/etc/meet/relocation-restored.json')

def backup_module():
    spec=importlib.util.spec_from_file_location('portable_backup',ROOT/'deploy/backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b);b.ROOT=ROOT;b.MAX_BYTES=MAX;return b

def sql(query,data=None):
    b=backup_module()
    return b.compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysql -h 127.0.0.1 -u meet -N -D meet'+(' -e "$1"' if query else ''),'sh',query or '',data=data).decode().strip()

def inventory():
    return {name:int(sql('SELECT COUNT(*) FROM '+name)) for name in ('schools','users','classes','courses','meetings')}

def write_private(path,raw,container=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.next');temp.write_bytes(raw);os.chmod(temp,0o600)
    if container:os.chown(temp,10001,10001)
    os.replace(temp,path)

def validate_snapshot(files):
    manifest=json.loads(files['manifest.json'])
    if manifest.get('kind')!='portable-v1' or not re.fullmatch('[a-f0-9]{40}',manifest.get('commit','')):raise ValueError('Unsupported portable snapshot')
    for name in ('database.sql','source.tar','settings.json')+ (('account-key',) if 'account-key' in files else ()):
        if hashlib.sha256(files[name]).hexdigest()!=manifest['hashes'][name]:raise ValueError('Snapshot integrity mismatch')
    if manifest['counts'].get('schools')!=1:raise ValueError('Single school snapshot required')
    return manifest

def export_snapshot(identifier):
    state=json.loads((ROOT/'runtime-config/school-state.json').read_text())
    if state.get('state')!='suspended' or int(sql("SELECT COUNT(*) FROM meetings WHERE status='live'")):raise ValueError('Suspend the school and finish live lessons first')
    if inventory()['schools']!=1:raise ValueError('Single school required')
    b=backup_module()
    commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()
    if subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain','--untracked-files=normal']).strip():raise ValueError('Unreviewed source changes')
    dump=b.compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysqldump -h 127.0.0.1 -u meet --single-transaction --no-tablespaces --set-gtid-purged=OFF meet')
    source=subprocess.check_output(['git','-C',str(ROOT),'archive','--format=tar',commit])
    cfg=json.loads((ROOT/'runtime-config/settings.json').read_text());cfg['turn']=[]
    files={'database.sql':dump,'source.tar':source,'settings.json':json.dumps(cfg).encode()}
    if sum(map(len,files.values()))>MAX:raise ValueError('Portable snapshot exceeds 128 MiB')
    keyfile=ROOT/'runtime-config/account-key'
    if keyfile.exists():files['account-key']=keyfile.read_bytes()
    manifest={'kind':'portable-v1','commit':commit,'schema':int(sql('SELECT MAX(version) FROM schema_migrations')),'slug':sql('SELECT slug FROM schools LIMIT 1'),'school_id':sql('SELECT id FROM schools LIMIT 1'),'counts':inventory(),'hashes':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}
    files['manifest.json']=json.dumps(manifest).encode()
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as tar:
        for name,raw in files.items():b.add_bytes(tar,name,raw)
    encrypted=b.seal(output.getvalue(),b.crypt_key(b.KEY,create=True))
    if len(encrypted)>MAX:raise ValueError('Portable snapshot exceeds 128 MiB')
    validate_snapshot(b.read_archive(b.unseal(encrypted,b.crypt_key(b.KEY))))
    path=STATE/(identifier+'.meet');write_private(path,encrypted)
    return {'path':str(path),'sha256':hashlib.sha256(encrypted).hexdigest(),'bytes':len(encrypted),'counts':manifest['counts'],'commit':commit}

def restore_snapshot(identifier,archive,key):
    b=backup_module();path=Path(archive)
    if path.stat().st_size>MAX:raise ValueError('Portable snapshot exceeds 128 MiB')
    files=b.read_archive(b.unseal(path.read_bytes(),b.crypt_key(Path(key))));manifest=validate_snapshot(files)
    release=json.loads((ROOT/'deploy/release.json').read_text())
    if manifest['schema']>release['schema_version']:raise ValueError('Install a newer release before restoring')
    if int(sql('SELECT COUNT(*) FROM schools'))!=0:raise ValueError('Target contains a school; never overwrite it')
    write_private(ROOT/'runtime-config/school-state.json',b'{"state":"suspended"}',True)
    b.compose('stop','api','web')
    sql(None,data=files['database.sql'])
    write_private(ROOT/'runtime-config/settings.json',files['settings.json'],True)
    if 'account-key' in files:write_private(ROOT/'runtime-config/account-key',files['account-key'],True)
    domain=urlparse(next(x.split('=',1)[1] for x in (ROOT/'.env').read_text().splitlines() if x.startswith('APP_ORIGIN='))).hostname
    write_private(ROOT/'runtime-config/managed.json',json.dumps({'school':manifest['slug'],'domain':domain}).encode(),True)
    (ROOT/'runtime-config/setup-token').unlink(missing_ok=True)
    b.compose('run','--rm','migrate');b.compose('run','--rm','api','configure-storage');b.compose('up','-d','api','web')
    actual=inventory()
    if actual!=manifest['counts']:raise ValueError('Restore row counts mismatch; target remains suspended')
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=3) as r:
                if json.load(r).get('status')=='ok':break
        except Exception:
            import time;time.sleep(1)
    else:raise ValueError('Target health check failed')
    result={'id':identifier,'counts':actual,'source_commit':manifest['commit'],'archive_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'state':'suspended'}
    write_private(RESTORED,json.dumps(result).encode())
    return result

def switch_domain(domain,ip):
    import socket,ipaddress,time
    if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}',domain):raise ValueError('Invalid domain')
    if {str(ipaddress.ip_address(x[4][0])) for x in socket.getaddrinfo(domain,443)}!={str(ipaddress.ip_address(ip))}:raise ValueError('DNS_NOT_READY')
    write_private(ROOT/'runtime-config/school-state.json',b'{"state":"suspended"}',True)
    site=Path('/etc/caddy/meet-sites')/(domain+'.caddy');site.write_text(domain+' {\n encode zstd gzip\n reverse_proxy 127.0.0.1:8080\n}\n');os.chmod(site,0o644)
    subprocess.run(['caddy','validate','--config','/etc/caddy/Caddyfile'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);subprocess.run(['systemctl','reload','caddy'],check=True)
    for _ in range(30):
        try:
            with urllib.request.urlopen('https://'+domain+'/api/health',timeout=5) as response:
                if json.load(response).get('status')=='ok':break
        except Exception:time.sleep(2)
    else:raise ValueError('TLS_NOT_READY')
    lines=(ROOT/'.env').read_text().splitlines();write_private(ROOT/'.env',('\n'.join('APP_ORIGIN=https://'+domain if line.startswith('APP_ORIGIN=') else line for line in lines)+'\n').encode())
    binding=json.loads((ROOT/'runtime-config/managed.json').read_text());binding['domain']=domain;write_private(ROOT/'runtime-config/managed.json',json.dumps(binding).encode(),True)
    b=backup_module();b.compose('up','-d','--no-deps','--no-build','--force-recreate','api');b.compose('run','--rm','api','configure-storage')
    return {'domain':domain,'state':'suspended'}

def main():
    if os.geteuid()!=0:raise SystemExit('Run as root')
    os.umask(0o077);parser=argparse.ArgumentParser();parser.add_argument('action',choices=['export','restore','domain']);parser.add_argument('--id',default='');parser.add_argument('--archive');parser.add_argument('--key');parser.add_argument('--domain');parser.add_argument('--ip');args=parser.parse_args()
    if args.action!='domain' and not re.fullmatch('[a-f0-9]{32}',args.id):raise ValueError('Invalid snapshot ID')
    with open('/run/meet-backup.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result=export_snapshot(args.id) if args.action=='export' else restore_snapshot(args.id,args.archive,args.key) if args.action=='restore' else switch_domain(args.domain,args.ip)
    print(json.dumps(result))
if __name__=='__main__':main()
