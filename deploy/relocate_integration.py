"""Disposable CI only: real MySQL portable export/restore with approved target code retained."""
import importlib.util,json,os,subprocess,tempfile
from pathlib import Path
if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST')!='true':raise SystemExit('Explicit disposable-stack opt-in required')
root=Path(__file__).resolve().parent.parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,root/'deploy'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
r=load('portable_integration','relocate.py');b=load('portable_backup_integration','backup.py');r.ROOT=b.ROOT=root
(root/'.env').write_text('APP_ORIGIN='+os.environ['APP_ORIGIN']+'\n')
subprocess.run(['git','config','--global','--add','safe.directory',str(root)],check=True)
def empty_database():
    b.compose('stop','api','web')
    b.compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -h 127.0.0.1 -u root -e "DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET utf8mb4"')
    b.compose('run','--rm','migrate')
with tempfile.TemporaryDirectory() as tmp:
    b.KEY=Path(tmp)/'recovery.key';r.STATE=Path(tmp);r.RESTORED=Path(tmp)/'restored.json';r.backup_module=lambda:b
    assert r.sql('SELECT COUNT(*) FROM schools')=='0','Fresh disposable schema required'
    r.sql(None,data="INSERT INTO schools(id,slug,name) VALUES('portable-school','school-portable','Trường phục hồi'); INSERT INTO users(id,school_id,email,name,password_hash,role) VALUES('portable-admin','portable-school','qa@example.test','Quản trị thử','not-a-login-password','admin');".encode())
    cfg={'r2':{'enabled':False},'backup':{'enabled':False,'interval_hours':24},'retention_days':30,'sfu':[],'turn':[]}
    (root/'runtime-config/settings.json').write_text(json.dumps(cfg));os.chown(root/'runtime-config/settings.json',10001,10001)
    r.write_private(root/'runtime-config/school-state.json',b'{"state":"suspended"}',True)
    r.write_private(root/'runtime-config/account-key',b'a'*64,True)
    identifier='b'*32;meta=r.export_snapshot(identifier)
    empty_database()
    result=r.restore_snapshot(identifier,meta['path'],str(b.KEY))
    assert result['counts']['schools']==1 and result['counts']['users']==1
    assert r.sql("SELECT name FROM schools WHERE id='portable-school'")=='Trường phục hồi'
    try:r.restore_snapshot(identifier,meta['path'],str(b.KEY))
    except ValueError:pass
    else:raise AssertionError('Existing school was overwritten')
    assert json.loads((root/'runtime-config/school-state.json').read_text())['state']=='suspended'
    empty_database()
    for name in ['school-state.json','managed.json']:(root/'runtime-config'/name).unlink(missing_ok=True)
    b.compose('up','-d','api','web')
    print('Real MySQL portable encrypted backup, fresh restore, Vietnamese names, row counts and overwrite guard passed')
