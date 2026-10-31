"""Pinned-SSH root uninstaller. CLI accepts identity only; all deletion paths are fixed."""
import fcntl,json,os,re,shutil,subprocess,sys
from pathlib import Path

def run(argv,check=True):
 p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=900,check=check)
 return p.stdout.decode(errors='replace').strip() if p.returncode==0 else ''

def services(names):
 run(['systemctl','disable','--now',*names],False)
 for name in names:
  if subprocess.run(['systemctl','is-active','--quiet',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise ValueError('PURGE_SERVICE_BUSY')

def purge(meta,base=Path('/'),project='meet',service_control=services,report=lambda _:None):
 if set(meta)!={'school','domain','origin','slug'} or not re.fullmatch('[a-f0-9]{32}',meta['school']) or not re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,63}',meta['domain']) or not re.fullmatch(r'https://[a-z0-9.-]+',meta['origin']) or not re.fullmatch(r'[a-z0-9-]{1,100}',meta['slug']):raise ValueError('PURGE_IDENTITY_INVALID')
 root=base/'opt/meet';folders=[base/x for x in ['etc/meet','var/lib/meet-updates','var/lib/meet-agent','var/lib/meet-relocations','var/lib/meet-recorder']]+[root]
 for p in folders:
  if p.resolve()!=p.absolute() or (p.exists() and not p.is_dir()):raise ValueError('PURGE_UNSAFE_PATH')
 proofdir=base/'var/lib/meet-purge'
 if proofdir.resolve()!=proofdir.absolute():raise ValueError('PURGE_UNSAFE_PATH')
 proof=proofdir/(meta['school']+'.json')
 if proof.is_symlink():raise ValueError('PURGE_UNSAFE_PATH')
 prior=json.loads(proof.read_text()) if proof.exists() else {}
 resume=prior.get('identity')==meta and prior.get('state') in ('deleting','done')
 if root.exists():
  binding=root/'runtime-config/managed.json'
  if binding.is_file():
   if binding.is_symlink():raise ValueError('PURGE_UNSAFE_PATH')
   cfg=json.loads(binding.read_text())
   if any(cfg.get(k)!=v for k,v in {'control_id':meta['school'],'control_origin':meta['origin'],'domain':meta['domain'],'school':meta['slug']}.items()):raise ValueError('PURGE_WRONG_VPS')
   if resume and prior.get('inode')!=[root.stat().st_dev,root.stat().st_ino]:resume=False
  elif not resume or prior.get('inode')!=[root.stat().st_dev,root.stat().st_ino]:raise ValueError('PURGE_WRONG_VPS')
 elif not resume:
  if any(p.exists() for p in folders) or run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project],False) or run(['docker','volume','ls','-q','--filter','label=com.docker.compose.project='+project],False):raise ValueError('PURGE_WRONG_VPS')
  report('purge_verified');return {'ok':True,'purged':True,'empty':True}
 compose=['docker','compose','--project-name',project,'--env-file',str(root/'.env'),'-f',str(root/'deploy/compose.yaml')]
 volumes=[project+'_mysql_data',project+'_redis_data',project+'-recorder_recorder_spool'];ids=[]
 for name in (project,project+'-recorder'):
  found=run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+name]).split()
  for identifier in found:
   if not re.fullmatch('[a-f0-9]{12,64}',identifier):raise ValueError('PURGE_UNOWNED_CONTAINER')
   data=json.loads(run(['docker','inspect',identifier]))[0];labels=data['Config'].get('Labels') or {}
   wd=Path(labels.get('com.docker.compose.project.working_dir','/'))
   if not wd.is_relative_to(root):raise ValueError('PURGE_UNOWNED_CONTAINER')
   for mount in data.get('Mounts',[]):
    if mount['Type']=='volume' and mount.get('Name') not in volumes:raise ValueError('PURGE_UNOWNED_VOLUME')
    if mount['Type']=='bind' and not (Path(mount['Source']).is_relative_to(root) or Path(mount['Source']).is_relative_to(base/'var/lib/meet-recorder')):raise ValueError('PURGE_UNOWNED_CONTAINER')
   ids.append(identifier)
 for name in volumes:
  raw=run(['docker','volume','inspect',name],False)
  if not raw:continue
  labels=json.loads(raw)[0].get('Labels') or {}
  owner=project+'-recorder' if name.endswith('_recorder_spool') else project
  if labels.get('com.docker.compose.project')!=owner:raise ValueError('PURGE_UNOWNED_VOLUME')
  for identifier in run(['docker','ps','-aq','--filter','volume='+name]).split():
   labels=json.loads(run(['docker','inspect',identifier]))[0]['Config'].get('Labels') or {}
   if labels.get('com.docker.compose.project')!=owner or identifier not in ids:raise ValueError('PURGE_UNOWNED_VOLUME')
 if resume and not set(ids).issubset(set(prior.get('containers',[]))):resume=False
 state=root/'runtime-config/school-state.json'
 if state.exists() and (state.is_symlink() or json.loads(state.read_text()).get('state')!='suspended'):raise ValueError('PURGE_NOT_SUSPENDED')
 if not resume:
  state=root/'runtime-config/school-state.json'
  if state.is_symlink() or not state.exists() or json.loads(state.read_text()).get('state')!='suspended':raise ValueError('PURGE_NOT_SUSPENDED')
  query="SELECT slug FROM schools ORDER BY slug; SELECT COUNT(*) FROM meetings WHERE status='live';"
  cmd='MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysql -u meet -N -D meet -e "'+query+'"'
  rows=run(compose+['exec','-T','mysql','sh','-c',cmd]).splitlines()
  if len(rows)!=2 or rows[0]!=meta['slug']:raise ValueError('PURGE_WRONG_DATABASE')
  if rows[1]!='0':raise ValueError('PURGE_LIVE_MEETINGS')
 site=base/'etc/caddy/meet-sites'/(meta['domain']+'.caddy')
 if site.is_symlink() or site.resolve()!=site.absolute():raise ValueError('PURGE_UNSAFE_PATH')
 if site.exists():
  lines=[x.strip() for x in site.read_text().splitlines() if x.strip()]
  allowed=[meta['domain']+' {','}', 'encode zstd gzip','reverse_proxy 127.0.0.1:8080','header Strict-Transport-Security "max-age=31536000"']
  if any(x not in allowed for x in lines) or 'reverse_proxy 127.0.0.1:8080' not in lines:raise ValueError('PURGE_CUSTOM_PROXY')
 report('purge_verified')
 for relative in ['usr/local/bin/meet','root/meet-client-install.log','root/meet-relocation-install.log','etc/systemd/system/meet-update.timer','etc/systemd/system/meet-backup.timer','etc/systemd/system/meet-control-agent.service','etc/systemd/system/meet-update.service','etc/systemd/system/meet-backup.service']:
  p=base/relative
  if p.parent.resolve()!=p.parent.absolute() or p.is_symlink():raise ValueError('PURGE_UNSAFE_PATH')
 record={'identity':meta,'state':'deleting','inode':[root.stat().st_dev,root.stat().st_ino] if root.exists() else prior.get('inode'),'containers':ids or prior.get('containers',[])}
 proofdir.mkdir(mode=0o700,parents=True,exist_ok=True)
 temp=proof.with_suffix('.next');temp.write_text(json.dumps(record));os.chmod(temp,0o600);os.replace(temp,proof)
 service_control(['meet-update.timer','meet-backup.timer','meet-control-agent.service','meet-update.service','meet-backup.service'])
 report('purge_storage')
 # Remove only individually inspected project containers and owned named volumes.
 if ids:run(['docker','rm','-f',*ids])
 for name in volumes:
  if run(['docker','volume','inspect',name],False):run(['docker','volume','rm',name])
  if run(['docker','volume','inspect',name],False):raise ValueError('PURGE_STORAGE_REMAINS')
 if project=='meet':
  for repo in ['meet-api','meet-web','meet-recorder']:
   refs=run(['docker','image','ls','--format','{{.Repository}}:{{.Tag}}','--filter','reference='+repo+':*'],False).splitlines()
   for ref in refs:
    if re.fullmatch(re.escape(repo)+r':[a-zA-Z0-9_.-]+',ref):run(['docker','image','rm',ref],False)
 report('purge_files')
 for p in folders:
  if p.resolve()!=p.absolute() or p.is_symlink():raise ValueError('PURGE_UNSAFE_PATH')
  if p.exists():shutil.rmtree(p)
 for relative in ['usr/local/bin/meet','root/meet-client-install.log','root/meet-relocation-install.log']:
  (base/relative).unlink(missing_ok=True)
 for name in ['meet-update.timer','meet-backup.timer','meet-control-agent.service','meet-update.service','meet-backup.service']:
  (base/'etc/systemd/system'/name).unlink(missing_ok=True)
 site.unlink(missing_ok=True)
 if base==Path('/'):
  run(['systemctl','daemon-reload']);run(['systemctl','reload','caddy'],False)
 if any(p.exists() or p.is_symlink() for p in folders):raise ValueError('PURGE_FILES_REMAIN')
 record['state']='done';temp.write_text(json.dumps(record));os.chmod(temp,0o600);os.replace(temp,proof)
 report('purge_complete');return {'ok':True,'purged':True}

def main():
 if os.geteuid()!=0:raise SystemExit('Root required')
 os.umask(0o077)
 try:
  meta=json.load(sys.stdin)
  with open('/run/meet-backup.lock','w') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   result=purge(meta,report=lambda stage:print('MEET_PURGE:'+stage,flush=True))
  print(json.dumps(result),flush=True)
 except ValueError as error:
  print(json.dumps({'ok':False,'code':str(error) if re.fullmatch('PURGE_[A-Z_]+',str(error)) else 'PURGE_FAILED'}),flush=True);raise SystemExit(2)
 except Exception:
  print(json.dumps({'ok':False,'code':'PURGE_COMMAND_FAILED'}),flush=True);raise SystemExit(2)
if __name__=='__main__':main()
