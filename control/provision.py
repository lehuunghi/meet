"""Provision a fresh Ubuntu VPS via pinned SSH host key. Never retain raw remote output."""
import base64, hashlib, io, json, shlex, threading, time, secrets, urllib.request, re, socket, ipaddress
from pathlib import Path
import paramiko

def approved_revision():
    base='https://api.github.com/repos/lehuunghi/meet'
    def get(path):
        request=urllib.request.Request(base+path,headers={'User-Agent':'Meet-Control','Accept':'application/vnd.github+json'})
        with urllib.request.urlopen(request,timeout=20) as response:return json.load(response)
    target=get('/commits/codex%2Fmulti-school-platform')['sha']
    if not re.fullmatch('[a-f0-9]{40}',target):raise ValueError('INVALID_RELEASE')
    runs=get('/actions/runs?head_sha='+target+'&event=push&per_page=20')['workflow_runs']
    runs=[r for r in runs if r.get('path')=='.github/workflows/ci.yml' and r.get('head_sha')==target]
    if not runs:raise ValueError('CI_NOT_READY')
    latest=max(runs,key=lambda r:(r.get('run_number',0),r.get('run_attempt',0),r['id']))
    if latest['status']!='completed' or latest['conclusion']!='success':raise ValueError('CI_NOT_READY')
    jobs=get('/actions/runs/'+str(latest['id'])+'/jobs?per_page=100')['jobs']
    if not all(any(j['name']==name and j['status']=='completed' and j['conclusion']=='success' for j in jobs) for name in ('api','web','containers','control','recorder')):raise ValueError('CI_NOT_READY')
    return target

def failure_code(error):
    if isinstance(error,paramiko.AuthenticationException):return 'SSH_AUTH_FAILED'
    if isinstance(error,TimeoutError):return 'SSH_TIMEOUT'
    known={'SSH_HOST_KEY_MISMATCH','INVALID_SSH_KEY','CI_NOT_READY','INVALID_RELEASE','EXISTING_INSTALLATION','AGENT_INSTALL_FAILED','PROVISION_TIMEOUT','PROVISION_FAILED','DNS_NOT_READY','SNAPSHOT_INVALID','SNAPSHOT_TOO_LARGE','BACKUP_DISK_FULL','WRONG_SOURCE_SCHOOL','BACKUP_MISSING','RESTORE_VERIFY_FAILED','WRONG_TARGET_VPS','TARGET_AGENT_NOT_READY','RELOCATION_REMOTE_FAILED','REMOTE_TIMEOUT'}
    if isinstance(error,ValueError) and str(error) in known:return str(error)
    if isinstance(error,paramiko.SSHException):return 'SSH_CONNECTION_FAILED'
    if isinstance(error,urllib.error.URLError):return 'RELEASE_CHECK_UNAVAILABLE'
    return 'PROVISION_FAILED_REVIEW_VPS'

def provision(c,job,payload):
    target=approved_revision()
    try:addresses={str(ipaddress.ip_address(x[4][0])) for x in socket.getaddrinfo(payload['domain'],443)}
    except socket.gaierror:raise ValueError('DNS_NOT_READY') from None
    if str(ipaddress.ip_address(payload['ip'])) not in addresses:raise ValueError('DNS_NOT_READY')
    class Pinned(paramiko.MissingHostKeyPolicy):
        def missing_host_key(self,client,hostname,key):
            actual='SHA256:'+base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
            if actual!=payload['fingerprint']:raise ValueError('SSH_HOST_KEY_MISMATCH')
    client=paramiko.SSHClient();client.set_missing_host_key_policy(Pinned())
    key=None
    if payload.get('private_key'):
        for kind in (paramiko.Ed25519Key,paramiko.RSAKey,paramiko.ECDSAKey):
            try:key=kind.from_private_key(io.StringIO(payload['private_key']));break
            except Exception:pass
        if key is None:raise ValueError('INVALID_SSH_KEY')
    client.connect(payload['ip'],port=payload.get('port',22),username='root',password=payload.get('password') or None,pkey=key,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=20,banner_timeout=20)
    try:
        token=secrets.token_urlsafe(48)
        with c.connect() as db:db.execute('UPDATE schools SET enroll_hash=?,enroll_expires=? WHERE id=?',(c.digest(token),int(time.time())+3600,job['school']))
        agent_config={'url':c.ORIGIN,'enroll_token':token,'ip':payload['ip']}
        # Script has no passwords. Agent enrollment is transferred separately over authenticated SFTP.
        script='''set -eu
export DEBIAN_FRONTEND=noninteractive
if [ -e /opt/meet ]; then echo EXISTING_INSTALLATION; exit 20; fi
apt-get update >/dev/null
apt-get install -y git ca-certificates >/dev/null
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git clone --branch codex/multi-school-platform https://github.com/lehuunghi/meet.git "$stage/source" >/dev/null 2>&1
git -C "$stage/source" checkout --detach '''+shlex.quote(target)+''' >/dev/null 2>&1
MEET_TARGET_SHA='''+shlex.quote(target)+''' MEET_DOMAIN='''+shlex.quote(payload['domain'])+''' MEET_MANAGED=true bash "$stage/source/deploy/install.sh" >/root/meet-client-install.log 2>&1
install -d -m 0700 /etc/meet
'''
        # No host-supplied command strings; only a validated hostname is shell-quoted above.
        stdin,stdout,stderr=client.exec_command('bash -s',timeout=1800);stdin.write(script);stdin.channel.shutdown_write()
        # Drain both streams to prevent remote command deadlock, without retaining sensitive output.
        channel=stdout.channel;deadline=time.monotonic()+1800
        while not channel.exit_status_ready():
            if channel.recv_ready():channel.recv(65536)
            if channel.recv_stderr_ready():channel.recv_stderr(65536)
            if time.monotonic()>deadline:raise TimeoutError('PROVISION_TIMEOUT')
            time.sleep(.1)
        exit_code=channel.recv_exit_status()
        if exit_code==20:raise ValueError('EXISTING_INSTALLATION')
        if exit_code!=0:raise ValueError('PROVISION_FAILED')
        with client.open_sftp() as sftp:
            with sftp.file('/etc/meet/agent.json','w') as f:f.write(json.dumps(agent_config))
            sftp.chmod('/etc/meet/agent.json',0o600)
        _,out,_=client.exec_command('bash /opt/meet/control/install-agent.sh',timeout=60)
        if out.channel.recv_exit_status()!=0:raise ValueError('AGENT_INSTALL_FAILED')
    finally:client.close()

def start_worker(c):
    # A single control service owns these SSH jobs. A restart cannot safely
    # replay an interrupted install/restore; retain data and require review.
    with c.connect() as db:
        for interrupted in db.execute("SELECT * FROM jobs WHERE action IN ('provision','relocate') AND state='running'").fetchall():
            if interrupted['action']=='relocate':
                payload=c.decrypt(interrupted['payload'],interrupted['school'])
                phase=payload['phase'];fallback='cutover_failed' if phase=='cutover' else 'backup_ready' if phase=='prepare' else 'failed'
                db.execute('UPDATE relocations SET state=? WHERE id=?',(fallback,payload['relocation_id']))
            db.execute("UPDATE jobs SET state='failed',result=?,payload=? WHERE id=?",(json.dumps({'code':'PROVISION_INTERRUPTED_REVIEW_VPS'}),c.encrypt({},interrupted['school']),interrupted['id']))
    def loop():
        while True:
            job=None
            try:
                with c.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    job=db.execute("SELECT * FROM jobs WHERE action IN ('provision','relocate') AND state='queued' ORDER BY created LIMIT 1").fetchone()
                    if job:db.execute("UPDATE jobs SET state='running',lease_until=? WHERE id=?",(int(time.time())+7200,job['id']))
                    db.execute("UPDATE jobs SET state='failed',result=? WHERE action='provision' AND state='running' AND lease_until<?",(json.dumps({'code':'PROVISION_INTERRUPTED_REVIEW_VPS'}),int(time.time())))
                if job:
                    payload=c.decrypt(job['payload'],job['school'])
                    try:
                        if job['action']=='relocate':
                            from relocation import perform
                            code=perform(c,job,payload)
                        else:provision(c,job,payload);code='WAITING_AGENT'
                        state='success'
                    except Exception as error:
                        state,code='failed',failure_code(error)
                        if job['action']=='relocate':
                            phase=payload['phase'];fallback='cutover_failed' if phase=='cutover' else 'backup_ready' if phase=='prepare' else 'failed'
                            with c.connect() as db:db.execute('UPDATE relocations SET state=? WHERE id=?',(fallback,payload['relocation_id']))
                    with c.connect() as db:
                        db.execute('UPDATE jobs SET state=?,result=?,payload=? WHERE id=?',(state,json.dumps({'code':code}),c.encrypt({},job['school']),job['id']))
                        c.audit(db,'provisioner',state,job['school'])
            except Exception:pass
            time.sleep(5)
    threading.Thread(target=loop,daemon=True).start()
