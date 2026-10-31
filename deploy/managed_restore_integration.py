"""Disposable Compose acceptance: real staging import, restore and automatic rollback."""
import importlib.util,json,os,tempfile,hashlib,io,tarfile
from pathlib import Path
if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST')!='true':raise SystemExit('Disposable-stack opt-in required')
root=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('restore_acceptance',root/'deploy/managed_restore.py');m.ROOT=root
u=m.updater();u.ROOT=root;u.checkout_safe=lambda:None
u.run('git','config','--global','--add','safe.directory',str(root))
sha=u.git('rev-parse','HEAD');(root/'.env').write_text('APP_ORIGIN='+os.environ['APP_ORIGIN']+'\n')
u.run('docker','build','--build-arg','MEET_COMMIT='+sha,'--build-arg','MEET_VERSION='+u.manifest(sha)['version'],'-t','meet-api:local',str(root/'apps/api'),timeout=900)
u.compose('up','-d','--no-deps','--no-build','--force-recreate','api');u.health(sha)
assert u.sql('SELECT COUNT(*) FROM schools')=='0'
u.sql(data="INSERT INTO schools(id,slug,name) VALUES('restore-school','restore-qa','Phục hồi thử'); INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES('restore-user','restore-school','restore@example.test','Trước phục hồi','not-a-login','admin');".encode())
objects={}
def transfer(method,cfg,key,body=b'',query=''):
 if method=='PUT':objects[key]=body;return b''
 return objects[key]
with tempfile.TemporaryDirectory() as tmp:
 u.STATE=Path(tmp)/'state';u.STATE.mkdir();b=u.backup_module();b.KEY=Path(tmp)/'key';b.transfer=transfer;u.backup_module=lambda:b
 cfg={'r2':{'enabled':True,'account_id':'a'*32,'bucket':'test-bucket','access_key_id':'test','secret_access_key':'test'},'backup':{'enabled':False,'interval_hours':24},'retention_days':30,'sfu':[],'turn':[],'commerce':{'free_videos':3}}
 (root/'runtime-config/settings.json').write_text(json.dumps(cfg));os.chown(root/'runtime-config/settings.json',10001,10001)
 m.write_private(root/'runtime-config/account-key',b'a'*64);m.write_private(root/'runtime-config/school-state.json',b'{"state":"suspended"}')
 b.backup(True);key=next(iter(objects))
 u.sql("UPDATE users SET name='Sau backup'")
 # A correctly encrypted snapshot for another tenant is still rejected before maintenance.
 files=b.read_archive(b.unseal(objects[key],b.crypt_key(b.KEY)));foreign=dict(files);foreign['database.sql']=files['database.sql'].replace(b'restore-school',b'foreign-school');manifest=json.loads(files['manifest.json']);manifest['database_sha256']=hashlib.sha256(foreign['database.sql']).hexdigest();foreign['manifest.json']=json.dumps(manifest).encode();out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as archive:
  for name,raw in foreign.items():b.add_bytes(archive,name,raw)
 bad='backups/foreign.meet';objects[bad]=b.seal(out.getvalue(),b.crypt_key(b.KEY))
 try:m.restore_backup(u,bad);raise AssertionError('Foreign tenant accepted')
 except ValueError as e:assert str(e)=='RESTORE_SCHOOL_MISMATCH'
 assert not (root/'runtime-config/maintenance').exists();assert u.sql('SELECT name FROM users')=='Sau backup'
 cfg['retention_days']=99;cfg['commerce']['free_videos']=7;(root/'runtime-config/settings.json').write_text(json.dumps(cfg))
 m.restore_backup(u,key)
 assert u.sql('SELECT name FROM users')=='Trước phục hồi';saved=json.loads((root/'runtime-config/settings.json').read_text());assert saved['retention_days']==99 and saved['commerce']['free_videos']==3
 assert json.loads((root/'runtime-config/school-state.json').read_text())['state']=='suspended';assert u.git('rev-parse','HEAD')==sha
 # Inject a post-import migration failure and prove recovery of the pre-restore state.
 u.sql("UPDATE users SET name='Trạng thái cần giữ'");original=u.compose
 def failing(*args,**kwargs):
  if args==('run','--rm','--no-deps','migrate'):
   u.sql("UPDATE users SET name='BROKEN'");raise RuntimeError('Injected restore migration failure')
  return original(*args,**kwargs)
 u.compose=failing
 try:m.restore_backup(u,key);raise AssertionError('Failure not injected')
 except RuntimeError as e:assert str(e)=='Injected restore migration failure'
 u.compose=original
 assert u.sql('SELECT name FROM users')=='Trạng thái cần giữ';assert not (root/'runtime-config/maintenance').exists();u.health(sha)
 assert json.loads((u.STATE/'journal.json').read_text())['result']=='rolled_back'
 u.compose('stop','api','web');m.root_sql(u,'meet','DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET utf8mb4;');u.compose('run','--rm','migrate')
 for name in ['school-state.json','managed.json','maintenance']:(root/'runtime-config'/name).unlink(missing_ok=True)
 cfg['r2']['enabled']=False;(root/'runtime-config/settings.json').write_text(json.dumps(cfg));u.compose('up','-d','api','web')
 print('Managed restore: real staging SQL, foreign-tenant rejection, retained infrastructure, restore and rollback passed')
