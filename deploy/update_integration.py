"""Disposable stack: inject a failed migration and prove database/config/image recovery."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import uuid
import urllib.request
import urllib.error

if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST') != 'true':
    raise SystemExit('Explicit disposable-stack opt-in required')
spec=importlib.util.spec_from_file_location('update',Path(__file__).with_name('update.py'))
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
u.ROOT=Path(__file__).resolve().parent.parent
current=u.git('rev-parse','HEAD')
# CI checks a detached merge revision. GitHub authorization/dirty checks have separate unit tests.
u.candidate=lambda:{'current_sha':current,'available_sha':current,'can_update':True}
u.checkout_safe=lambda:None
original_compose=u.compose
original_backup=u.backup_module
objects={}

def transfer(method, config, key, body=b''):
    if method=='PUT':objects[key]=body;return b''
    return objects[key]

def compose(*args,override=None,data=None):
    if args==('run','--rm','--no-deps','migrate'):
        # Simulate DDL committed followed by a partially applied data migration.
        u.sql("CREATE TABLE failed_upgrade_probe(id INT); UPDATE users SET name='BROKEN UPDATE'")
        (u.ROOT/'runtime-config/settings.json').write_text('{"broken":true}')
        raise RuntimeError('Injected migration failure')
    return original_compose(*args,override=override,data=data)

with tempfile.TemporaryDirectory() as tmp:
    u.STATE=Path(tmp)/'state';u.STATE.mkdir()
    b=original_backup();b.KEY=Path(tmp)/'recovery.key';b.transfer=transfer
    u.backup_module=lambda:b
    original_settings=(u.ROOT/'runtime-config/settings.json').read_bytes()
    old_name=u.sql("SELECT name FROM users WHERE id='demo-admin'")
    old_images=u.images()
    u.compose=compose
    try:
        u.apply(current,str(uuid.uuid4()))
        raise AssertionError('Injected failure unexpectedly succeeded')
    except RuntimeError as error:
        if str(error)!='Injected migration failure':raise
    status=json.loads((u.STATE/'status.json').read_text())
    assert status['state']=='rolled_back',status
    assert u.sql("SELECT name FROM users WHERE id='demo-admin'")==old_name
    assert u.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='meet' AND table_name='failed_upgrade_probe'")=='0'
    assert (u.ROOT/'runtime-config/settings.json').read_bytes()==original_settings
    assert not (u.ROOT/'runtime-config/maintenance').exists()
    assert u.images()==old_images
    u.health()
    print('Failed migration restored original schema, student/admin data, configuration and application images')

    # Also exercise a successful upgrade and verify maintenance blocks requests until committed.
    u.compose=original_compose
    original_health=u.health
    def guarded_health(expected=None):
        original_health(expected)
        if expected:
            request=urllib.request.Request('http://127.0.0.1:8080/api/login',data=b'{}',headers={'Origin':os.environ['APP_ORIGIN'],'Content-Type':'application/json'})
            try:urllib.request.urlopen(request,timeout=5);raise AssertionError('Maintenance allowed login')
            except urllib.error.HTTPError as error:assert error.code==503,error.code
    u.health=guarded_health
    u.apply(current,str(uuid.uuid4()))
    assert json.loads((u.STATE/'status.json').read_text())['state']=='success'
    assert not (u.ROOT/'runtime-config/maintenance').exists()
    original_health(current)
    assert u.sql("SELECT name FROM users WHERE id='demo-admin'")==old_name
    print('Successful upgrade verified commit health and blocked writes until completion')
    # Simulate process interruption after schema/data mutation: the next worker must recover first.
    job={'id':str(uuid.uuid4()),'active':True,'frozen':True,'db_dirty':True,'old_sha':current,'target':current,'old_images':u.images()}
    (u.ROOT/'runtime-config/maintenance').write_text(job['id'])
    u.compose('stop','api','web')
    job['snapshot']=u.snapshot(b,job)
    u.checkpoint(job)
    u.sql("CREATE TABLE interrupted_upgrade_probe(id INT); UPDATE users SET name='INTERRUPTED'")
    u.worker()
    assert u.sql("SELECT name FROM users WHERE id='demo-admin'")==old_name
    assert u.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='meet' AND table_name='interrupted_upgrade_probe'")=='0'
    assert json.loads((u.STATE/'status.json').read_text())['state']=='rolled_back'
    assert not (u.ROOT/'runtime-config/maintenance').exists()
    print('Interrupted update journal automatically recovered original database and application')
