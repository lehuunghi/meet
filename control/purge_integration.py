"""Real MySQL/Redis deletion acceptance, exclusively in an isolated CI project."""
import json,os,shutil,subprocess,tempfile
from pathlib import Path
import purge_remote as p
if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST')!='true' or os.geteuid()!=0:raise SystemExit('Disposable root CI only')
project='meet-purge-ci'
def command(args):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
with tempfile.TemporaryDirectory(prefix='meet-purge-ci-') as folder:
 base=Path(folder).resolve();root=base/'opt/meet';root.mkdir(parents=True)
 shutil.copytree(Path(__file__).resolve().parents[1]/'deploy',root/'deploy')
 command(['bash',str(root/'deploy/init-secrets.sh')]);(root/'.env').write_text('APP_ORIGIN=http://localhost:18089\n')
 compose=['docker','compose','--project-name',project,'--env-file',str(root/'.env'),'-f',str(root/'deploy/compose.yaml')]
 meta={'school':'c'*32,'domain':'purge.example.test','origin':'https://admin.example.test','slug':'purge-ci'}
 sentinel=base/'other-app/data';sentinel.parent.mkdir();sentinel.write_text('retained')
 try:
  command(compose+['up','-d','--wait','mysql','redis'])
  sql="CREATE TABLE schools(slug VARCHAR(100)); INSERT INTO schools VALUES ('purge-ci'); CREATE TABLE meetings(status VARCHAR(20));"
  command(compose+['exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql_password)" exec mysql -u meet -D meet -e "'+sql+'"'])
  binding=root/'runtime-config/managed.json'
  cfg={'control_id':meta['school'],'control_origin':meta['origin'],'domain':meta['domain'],'school':meta['slug']}
  binding.write_text(json.dumps({**cfg,'control_id':'d'*32}));(root/'runtime-config/school-state.json').write_text('{"state":"suspended"}')
  try:p.purge(meta,base,project,service_control=lambda _:None)
  except ValueError as e:assert str(e)=='PURGE_WRONG_VPS'
  else:raise AssertionError('Wrong VPS accepted')
  assert command(['docker','volume','inspect',project+'_mysql_data'])
  binding.write_text(json.dumps(cfg));assert p.purge(meta,base,project,service_control=lambda _:None)['purged']
  assert not root.exists() and sentinel.read_text()=='retained'
  assert not command(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project])
  assert not command(['docker','volume','ls','-q','--filter','label=com.docker.compose.project='+project])
  print('Isolated real MySQL/Redis purge passed; wrong binding retained all data; unrelated sentinel retained')
 finally:
  # Fixed disposable project only; never touch the normal meet project.
  ids=command(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project]).split()
  if ids:command(['docker','rm','-f',*ids])
  volumes=command(['docker','volume','ls','-q','--filter','label=com.docker.compose.project='+project]).split()
  if volumes:command(['docker','volume','rm',*volumes])
  networks=command(['docker','network','ls','-q','--filter','label=com.docker.compose.project='+project]).split()
  if networks:command(['docker','network','rm',*networks])
