"""Root-owned outbound Meet agent. Fixed operations only; no remote shell endpoint."""
import base64, fcntl, importlib.util, json, os, re, shutil, socket, subprocess, sys, time, urllib.request, uuid
from pathlib import Path
from urllib.parse import urlparse
STATE=Path('/etc/meet/agent.json');ROOT=Path('/opt/meet');JOURNAL=Path('/var/lib/meet-agent/jobs.json')
HOST=re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}')

def atomic(path,value,owner=None):
    path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.next')
    with open(temp,'w',encoding='utf-8') as f:os.chmod(temp,0o600);f.write(json.dumps(value,ensure_ascii=False));f.flush();os.fsync(f.fileno())
    if owner:os.chown(temp,*owner)
    os.replace(temp,path)

def run(*args,data=None,timeout=1200):return subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=timeout).stdout

def compose(*args,data=None):return run('docker','compose','--project-name','meet','--env-file',str(ROOT/'.env'),'-f',str(ROOT/'deploy/compose.yaml'),*args,data=data)
def cli(command,value=None):return json.loads(compose('exec','-T','api','/usr/local/bin/meet',command,data=json.dumps(value or {},ensure_ascii=False).encode()))

def failure_code(error):
    # Only fixed codes cross the management link. stderr may contain secrets.
    if isinstance(error,subprocess.TimeoutExpired):return 'REMOTE_TIMEOUT'
    if isinstance(error,subprocess.CalledProcessError):
        message=(error.stderr or b'')
        if isinstance(message,bytes):message=message.decode(errors='replace')
        if 'deployment school mismatch' in message:return 'CONFIG_SCHOOL_MISMATCH'
        if 'Database unavailable' in message or 'database unavailable' in message:return 'CONFIG_DATABASE_UNAVAILABLE'
        if 'managed config rejected' in message:
            if 'R2' in message:return 'CONFIG_R2_REJECTED'
            return 'CONFIG_REJECTED'
        if 'account rejected (409)' in message:return 'ACCOUNT_CONFLICT'
        if 'account rejected (' in message:return 'ACCOUNT_REJECTED'
    return 'APPLY_FAILED'
def request(config,path,data):
    if not config['url'].startswith('https://') or urlparse(config['url']).path not in ('','/'):raise ValueError('HTTPS control origin required')
    req=urllib.request.Request(config['url'].rstrip('/')+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+config.get('token','')})
    # Redirects must not forward agent credentials to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    with urllib.request.build_opener(NoRedirect).open(req,timeout=40) as response:return json.load(response)

def updater():
    spec=importlib.util.spec_from_file_location('meet_update',ROOT/'deploy/update.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.ROOT=ROOT;return module

def configure(job):
    payload=job['payload'];cfg=payload['settings'];domain=payload['domain'];school=(cfg.get('school_slug') or 'school-'+config['school'][:8]);admin=cfg.get('initial_admin',{})
    if not HOST.fullmatch(domain):raise ValueError('invalid domain')
    settings={k:cfg[k] for k in ('sfu','turn','r2','retention_days','backup','platform_mode') if k in cfg}
    cli('managed-config',{'settings':settings,'school':{'slug':school,'name':payload['name'],'email':admin.get('email',''),'password':admin.get('password','')},'domain':domain,'control_origin':config['url'],'control_id':config['school']})
    atomic(ROOT/'runtime-config/control-revision.json',{'revision':job['revision']},(10001,10001))

def _domain_change(payload):
    domain=payload.get('domain','');ip=payload.get('ip',config.get('ip',''))
    if not HOST.fullmatch(domain) or ip not in {x[4][0] for x in socket.getaddrinfo(domain,443)}:raise ValueError('DNS_NOT_READY')
    site=Path('/etc/caddy/meet-sites')/(domain+'.caddy');old=site.read_bytes() if site.exists() else None
    envpath=ROOT/'.env';original=envpath.read_bytes();binding=ROOT/'runtime-config/managed.json';oldbinding=binding.read_bytes()
    try:
        site.write_text(domain+' {\n encode zstd gzip\n reverse_proxy 127.0.0.1:8080\n}\n');os.chmod(site,0o644)
        run('caddy','validate','--config','/etc/caddy/Caddyfile');run('systemctl','reload','caddy')
        for i in range(30):
            try:
                with urllib.request.urlopen('https://'+domain+'/api/health',timeout=5) as response:
                    if json.load(response).get('status')=='ok':break
            except Exception:
                if i==29:raise ValueError('TLS_NOT_READY')
                time.sleep(2)
        lines=original.decode().splitlines();envpath.write_text('\n'.join('APP_ORIGIN=https://'+domain if line.startswith('APP_ORIGIN=') else line for line in lines)+'\n');os.chmod(envpath,0o600)
        value=json.loads(oldbinding);value['domain']=domain;atomic(binding,value,(10001,10001))
        compose('up','-d','--no-deps','--no-build','--force-recreate','api');updater().health()
        # R2 CORS must follow the new application origin. Keep original origin if this fails.
        compose('exec','-T','api','/usr/local/bin/meet','configure-storage')
    except Exception:
        envpath.write_bytes(original);binding.write_bytes(oldbinding);os.chown(binding,10001,10001)
        if old is None:site.unlink(missing_ok=True)
        else:site.write_bytes(old)
        run('caddy','validate','--config','/etc/caddy/Caddyfile');run('systemctl','reload','caddy');compose('up','-d','--no-deps','--no-build','--force-recreate','api');raise

DOMAIN_JOURNAL=Path('/var/lib/meet-agent/domain.json')

def recover_domain():
    if not DOMAIN_JOURNAL.exists():return
    data=json.loads(DOMAIN_JOURNAL.read_text());domain=data['domain']
    if not HOST.fullmatch(domain):raise ValueError('INVALID_DOMAIN_JOURNAL')
    site=Path('/etc/caddy/meet-sites')/(domain+'.caddy')
    (ROOT/'.env').write_bytes(base64.b64decode(data['env']));os.chmod(ROOT/'.env',0o600)
    binding=ROOT/'runtime-config/managed.json';binding.write_bytes(base64.b64decode(data['binding']));os.chmod(binding,0o600);os.chown(binding,10001,10001)
    if data['site'] is None:site.unlink(missing_ok=True)
    else:site.write_bytes(base64.b64decode(data['site']));os.chmod(site,0o644)
    run('caddy','validate','--config','/etc/caddy/Caddyfile');run('systemctl','reload','caddy')
    compose('up','-d','--no-deps','--no-build','--force-recreate','api');updater().health()
    compose('exec','-T','api','/usr/local/bin/meet','configure-storage')
    DOMAIN_JOURNAL.unlink();(ROOT/'runtime-config/maintenance').unlink(missing_ok=True)

def domain_change(payload):
    maintenance=ROOT/'runtime-config/maintenance';domain=payload.get('domain','')
    if not HOST.fullmatch(domain):raise ValueError('INVALID_DOMAIN')
    if maintenance.exists():raise ValueError('MAINTENANCE_ALREADY_ACTIVE')
    with open('/run/meet-backup.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        site=Path('/etc/caddy/meet-sites')/(domain+'.caddy')
        atomic(DOMAIN_JOURNAL,{'domain':domain,'env':base64.b64encode((ROOT/'.env').read_bytes()).decode(),'binding':base64.b64encode((ROOT/'runtime-config/managed.json').read_bytes()).decode(),'site':base64.b64encode(site.read_bytes()).decode() if site.exists() else None})
        with open(maintenance,'x') as f:f.write('domain-change')
        try:
            if cli('managed-status')['live']>0:raise ValueError('LIVE_MEETINGS')
            _domain_change(payload)
        except Exception:
            recover_domain() # Keep journal/maintenance if recovery itself fails.
            raise
        DOMAIN_JOURNAL.unlink();maintenance.unlink(missing_ok=True)

def execute(job,status):
    action=job['action'];payload=job['payload']
    if action in ('configure','update','domain') and status['live']>0:return 'waiting','LIVE_MEETINGS'
    if action=='lifecycle':
        state=payload.get('state')
        if state not in ('active','suspended'):raise ValueError('invalid lifecycle state')
        if state=='suspended' and status['live']>0:return 'waiting','LIVE_MEETINGS'
        path=ROOT/'runtime-config/school-state.json'
        old=path.read_bytes() if path.exists() else None
        atomic(path,{'state':state},(10001,10001))
        if state=='suspended' and cli('managed-status')['live']>0:
            if old is None:path.unlink(missing_ok=True)
            else:path.write_bytes(old)
            return 'waiting','LIVE_MEETINGS'
        return 'success','OK'
    if action=='configure':
        revision=ROOT/'runtime-config/control-revision.json'
        if not revision.exists() or json.loads(revision.read_text()).get('revision',0)<job['revision']:configure(job)
    elif action=='accounts':cli('managed-account',payload)
    elif action=='academy':return 'failed','BUSINESS_MANAGEMENT_LOCAL'
    elif action=='check':run('python3',str(ROOT/'deploy/update.py'),'check')
    elif action=='update':
        target=payload.get('target','')
        if not re.fullmatch('[a-f0-9]{40}',target):raise ValueError('invalid target')
        u=updater();checked=u.candidate()
        if checked['available_sha']!=target or not checked['can_update']:raise ValueError('UPDATE_NOT_READY')
        with open('/run/meet-backup.lock','w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);u.apply(target,str(uuid.uuid4()))
    elif action=='backup':run('python3',str(ROOT/'deploy/backup.py'),'backup','--force')
    elif action=='domain':domain_change(payload)
    else:raise ValueError('unsupported action')
    return 'success','OK'

def tick():
    status=cli('managed-status')
    status['control_protocol']=2
    status['disk_free']=shutil.disk_usage(ROOT).free
    for name,path in [('update','update-status.json'),('backup','backup-status.json'),('config_revision','control-revision.json')]:
        p=ROOT/'runtime-config'/path
        if p.exists():
            data=json.loads(p.read_text());status[name]={k:data[k] for k in ('state','current_version','available_version','available_sha','can_update','revision') if k in data}
    response=request(config,'/agent/poll',{'status':status});job=response.get('job')
    if not job:return
    prior=json.loads(JOURNAL.read_text()) if JOURNAL.exists() else {}
    if job['id'] in prior:state,code=prior[job['id']]
    else:
        try:state,code=execute(job,status)
        except Exception as error:state,code='failed',failure_code(error)
        if state=='success':
            prior[job['id']]=[state,code];atomic(JOURNAL,dict(list(prior.items())[-500:]))
    request(config,'/agent/ack',{'status':{},'id':job['id'],'lease':job['lease'],'state':state,'code':code})
    return True

if __name__=='__main__':
    os.umask(0o077)
    if os.geteuid()!=0:raise SystemExit('Root required')
    config=json.loads(STATE.read_text())
    if config.get('enroll_token'):
        enrolled=request(config,'/agent/enroll',{'token':config.pop('enroll_token')});config.update(enrolled);atomic(STATE,config)
    Path('/var/lib/meet-agent').mkdir(parents=True,exist_ok=True)
    with open('/run/meet-agent.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            try:
                if DOMAIN_JOURNAL.exists():
                    with open('/run/meet-backup.lock','w') as recovery_lock:
                        fcntl.flock(recovery_lock,fcntl.LOCK_EX|fcntl.LOCK_NB);recover_domain()
                worked=tick()
                time.sleep(1 if worked else 5)
            except Exception:time.sleep(20)
