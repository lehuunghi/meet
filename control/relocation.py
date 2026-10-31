"""Pinned-SSH, two-phase relocation. No DNS mutation and no source-data deletion."""
import base64, hashlib, io, json, os, re, secrets, shlex, shutil, socket, tarfile, time, ipaddress
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import paramiko
from provision import approved_revision

MAX=128*1024*1024;MAGIC=b'MEET-BACKUP-1\0'

def connect(ip,credentials):
    class Pinned(paramiko.MissingHostKeyPolicy):
        def missing_host_key(self,client,hostname,key):
            actual='SHA256:'+base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
            if actual!=credentials['fingerprint']:raise ValueError('SSH_HOST_KEY_MISMATCH')
    client=paramiko.SSHClient();client.set_missing_host_key_policy(Pinned());key=None
    if credentials.get('private_key'):
        for kind in (paramiko.Ed25519Key,paramiko.RSAKey,paramiko.ECDSAKey):
            try:key=kind.from_private_key(io.StringIO(credentials['private_key']));break
            except Exception:pass
        if key is None:raise ValueError('INVALID_SSH_KEY')
    client.connect(ip,port=credentials.get('port',22),username='root',password=credentials.get('password') or None,pkey=key,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=20,banner_timeout=20)
    return client

def run(client,command,timeout=1800,want_json=False):
    stdin,stdout,stderr=client.exec_command(command,timeout=timeout);stdin.channel.shutdown_write()
    channel=stdout.channel;deadline=time.monotonic()+timeout;out=bytearray()
    while True:
        if channel.recv_ready():
            chunk=channel.recv(65536)
            if want_json:
                out.extend(chunk)
                if len(out)>1048576:raise ValueError('REMOTE_RESULT_TOO_LARGE')
        if channel.recv_stderr_ready():channel.recv_stderr(65536)
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():break
        if time.monotonic()>deadline:raise ValueError('REMOTE_TIMEOUT')
        time.sleep(.05)
    if channel.recv_exit_status()!=0:raise ValueError('RELOCATION_REMOTE_FAILED')
    return json.loads(out.decode().strip().splitlines()[-1]) if want_json else None

def verify_archive(raw,key):
    if len(raw)>MAX or not raw.startswith(MAGIC):raise ValueError('SNAPSHOT_INVALID')
    pos=len(MAGIC);plain=AESGCM(bytes.fromhex(key.decode().strip())).decrypt(raw[pos:pos+12],raw[pos+12:],MAGIC)
    files={};total=0
    with tarfile.open(fileobj=io.BytesIO(plain),mode='r:gz') as archive:
        for item in archive:
            if not item.isfile() or item.name not in ('database.sql','source.tar','settings.json','account-key','manifest.json') or item.name in files:raise ValueError('SNAPSHOT_INVALID')
            total+=item.size
            if total>MAX:raise ValueError('SNAPSHOT_TOO_LARGE')
            files[item.name]=archive.extractfile(item).read()
    manifest=json.loads(files['manifest.json'])
    if manifest.get('kind')!='portable-v1' or manifest['counts'].get('schools')!=1:raise ValueError('SNAPSHOT_INVALID')
    for name in ('database.sql','source.tar','settings.json'):
        if hashlib.sha256(files[name]).hexdigest()!=manifest['hashes'][name]:raise ValueError('SNAPSHOT_INVALID')
    if 'account-key' in files and hashlib.sha256(files['account-key']).hexdigest()!=manifest['hashes'].get('account-key'):raise ValueError('SNAPSHOT_INVALID')
    return manifest

def locations(c,sid,identifier):
    directory=c.ROOT/'portable-backups'/sid;keys=c.ROOT/'portable-recovery'/sid
    directory.mkdir(parents=True,exist_ok=True,mode=0o700);keys.mkdir(parents=True,exist_ok=True,mode=0o700)
    return directory/(identifier+'.meet'),keys/(identifier+'.key')

def save_details(c,identifier,state,details):
    with c.connect() as db:db.execute('UPDATE relocations SET state=?,details=? WHERE id=?',(state,c.encrypt(details,identifier),identifier))

def perform(c,job,payload):
    identifier=payload['relocation_id'];sid=job['school'];phase=payload['phase']
    with c.connect() as db:
        record=db.execute('SELECT * FROM relocations WHERE id=? AND school=?',(identifier,sid)).fetchone();row=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
        details=c.decrypt(record['details'],identifier);cfg=c.decrypt(row['config'],sid)
    archive,keyfile=locations(c,sid,identifier)
    if phase=='backup':
        source=connect(row['ip'],payload['source'])
        try:
            meta=run(source,'python3 /opt/meet/deploy/relocate.py export --id '+identifier,want_json=True)
            if not isinstance(meta.get('bytes'),int) or not 0<meta['bytes']<=MAX:raise ValueError('SNAPSHOT_TOO_LARGE')
            if shutil.disk_usage(c.ROOT).free<2*meta['bytes']+128*1024*1024:raise ValueError('BACKUP_DISK_FULL')
            with source.open_sftp() as sftp:
                remote='/var/lib/meet-relocations/'+identifier+'.meet'
                if sftp.stat(remote).st_size!=meta['bytes']:raise ValueError('SNAPSHOT_INVALID')
                sftp.get(remote,str(archive));os.chmod(archive,0o600)
                with sftp.file('/etc/meet/recovery.key','rb') as handle:key=handle.read(256)
            raw=archive.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise ValueError('SNAPSHOT_INVALID')
            manifest=verify_archive(raw,key)
            expected_slug=cfg.get('school_slug') or 'school-'+sid[:8]
            if manifest['slug']!=expected_slug:raise ValueError('WRONG_SOURCE_SCHOOL')
            keyfile.write_bytes(key);os.chmod(keyfile,0o600)
            details.update(backup={'sha256':meta['sha256'],'bytes':meta['bytes'],'counts':manifest['counts'],'commit':manifest['commit']})
            save_details(c,identifier,'backup_ready',details)
            return 'BACKUP_VERIFIED'
        finally:source.close()
    if not archive.exists() or not keyfile.exists():raise ValueError('BACKUP_MISSING')
    if phase=='prepare':
        target_sha=approved_revision();host=details['staging_domain'];ip=details['target_ip']
        try:addresses={str(ipaddress.ip_address(x[4][0])) for x in socket.getaddrinfo(host,443)}
        except socket.gaierror:raise ValueError('DNS_NOT_READY') from None
        if addresses!={str(ipaddress.ip_address(ip))}:raise ValueError('DNS_NOT_READY')
        target=connect(ip,payload['target'])
        try:
            # Fresh-only installer refuses /opt/meet. Never retry by deleting the old checkout.
            script='set -eu; test ! -e /opt/meet; export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null; apt-get install -y git ca-certificates >/dev/null; stage=$(mktemp -d); trap \'rm -rf "$stage"\' EXIT; git clone --branch codex/multi-school-platform https://github.com/lehuunghi/meet.git "$stage/source" >/dev/null 2>&1; git -C "$stage/source" checkout --detach '+shlex.quote(target_sha)+' >/dev/null 2>&1; MEET_TARGET_SHA='+shlex.quote(target_sha)+' MEET_MANAGED=true MEET_CONTROL_ORIGIN='+shlex.quote(c.ORIGIN)+' MEET_CONTROL_ID='+shlex.quote(sid)+' MEET_DOMAIN='+shlex.quote(host)+' bash "$stage/source/deploy/install.sh" >/root/meet-relocation-install.log 2>&1'
            run(target,'bash -c '+shlex.quote(script),timeout=2400)
            run(target,'install -d -m 0700 /var/lib/meet-relocations /etc/meet')
            with target.open_sftp() as sftp:
                sftp.put(str(archive),'/var/lib/meet-relocations/'+identifier+'.meet');sftp.chmod('/var/lib/meet-relocations/'+identifier+'.meet',0o600)
                sftp.put(str(keyfile),'/etc/meet/recovery.key');sftp.chmod('/etc/meet/recovery.key',0o600)
            restored=run(target,'python3 /opt/meet/deploy/relocate.py restore --id '+identifier+' --archive /var/lib/meet-relocations/'+identifier+'.meet --key /etc/meet/recovery.key',want_json=True)
            if restored['counts']!=details['backup']['counts'] or restored['archive_sha256']!=details['backup']['sha256']:raise ValueError('RESTORE_VERIFY_FAILED')
            details['target_commit']=target_sha;save_details(c,identifier,'prepared',details)
            return 'TARGET_PREPARED_CHANGE_DNS'
        finally:target.close()
    if phase!='cutover':raise ValueError('INVALID_RELOCATION_PHASE')
    target=connect(details['target_ip'],payload['target'])
    try:
        restored=run(target,'cat /etc/meet/relocation-restored.json',want_json=True)
        if restored.get('id')!=identifier or restored.get('archive_sha256')!=details['backup']['sha256']:raise ValueError('WRONG_TARGET_VPS')
        run(target,'python3 /opt/meet/deploy/relocate.py domain --domain '+shlex.quote(row['domain'])+' --ip '+shlex.quote(details['target_ip']),timeout=300,want_json=True)
        token=secrets.token_urlsafe(48)
        with c.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
            revision=current['revision']+1
            db.execute("UPDATE schools SET ip=?,agent_hash=NULL,enroll_hash=?,enroll_expires=?,seen=0,status='{}',revision=?,desired_state='suspended',applied_state='suspended' WHERE id=?",(details['target_ip'],c.digest(token),int(time.time())+900,revision,sid))
            c.queue(db,sid,'configure',{'settings':cfg,'name':row['name'],'domain':row['domain']},revision)
        with target.open_sftp() as sftp:
            with sftp.file('/etc/meet/agent.json','w') as handle:handle.write(json.dumps({'url':c.ORIGIN,'ip':details['target_ip'],'enroll_token':token}))
            sftp.chmod('/etc/meet/agent.json',0o600)
        run(target,'bash /opt/meet/control/install-agent.sh && systemctl restart meet-control-agent.service',timeout=180)
        for _ in range(40):
            with c.connect() as db:updated=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
            if updated['agent_hash'] and updated['applied']>=revision and updated['seen']>int(time.time())-90:break
            time.sleep(2)
        else:raise ValueError('TARGET_AGENT_NOT_READY')
        save_details(c,identifier,'completed',details)
        return 'RELOCATION_COMPLETED_SUSPENDED'
    finally:target.close()
