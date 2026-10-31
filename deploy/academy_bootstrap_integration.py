"""Disposable CI: exercise the exact managed CLI used by a fresh academy install."""
import importlib.util,json,os,subprocess,urllib.request,http.cookiejar
from pathlib import Path
if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST')!='true':raise SystemExit('Disposable-stack opt-in required')
root=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('academy_bootstrap_backup',root/'deploy/backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b);b.ROOT=root
original=os.environ['APP_ORIGIN'];domain='qa.example.test';os.environ['APP_ORIGIN']='http://'+domain
(root/'.env').write_text('APP_ORIGIN=http://'+domain+'\n')
b.compose('up','-d','--no-deps','--no-build','--force-recreate','api')
payload={'domain':domain,'control_origin':'https://admin.example.test','control_id':'1'*32,'school':{'slug':'academy-ci','name':'VA thử nghiệm','email':'admin@example.test','password':'integration-new-admin-123'},'settings':{'platform_mode':'academy','commerce':{'free_videos':4},'sfu':[],'turn':[],'r2':{'enabled':False},'backup':{'enabled':False,'interval_hours':24},'retention_days':30}}
result=b.compose('exec','-T','api','/usr/local/bin/meet','managed-config',data=json.dumps(payload).encode());assert json.loads(result)['ok']
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def request(path,data=None):
    req=urllib.request.Request('http://127.0.0.1:8080'+path,data=None if data is None else json.dumps(data).encode(),headers={'Host':domain,'Origin':'http://'+domain,'Content-Type':'application/json'})
    with opener.open(req,timeout=30) as response:return response.read()
config=json.loads(request('/api/public-config'));assert config['platform_mode']=='academy';assert config['management_url']=='https://admin.example.test/#academy/'+'1'*32
landing=request('/').decode();assert 'VA thử nghiệm' in landing and 'Học thử miễn phí' in landing
assert json.loads(request('/api/login',{'email':'admin@example.test','password':'integration-new-admin-123'}))['role']=='admin'
people=json.loads(request('/api/academy/control/people'));assert len(people)==1 and people[0]['role']=='admin'
local=json.loads(request('/api/academy/settings'))
settings={**local['settings'],'free_videos':7,'bank_name':'Tên người nhận Việt Nam','smtp_password':'private-local-secret'}
saved=json.loads(request('/api/academy/settings',{'settings':settings,'revision':local['revision']}));assert saved['revision']==1
visible=json.loads(request('/api/academy/settings'));assert visible['settings']['free_videos']==7 and visible['settings']['smtp_password']=='' and visible['secrets']['smtp_password']
# An infrastructure configuration push cannot overwrite locally owned commerce.
payload['settings']['commerce']={'free_videos':99,'smtp_password':'central-must-not-replace'}
b.compose('exec','-T','api','/usr/local/bin/meet','managed-config',data=json.dumps(payload).encode())
visible=json.loads(request('/api/academy/settings'));assert visible['settings']['free_videos']==7 and visible['revision']==1
with open(root/'runtime-config/settings.json') as f:assert json.load(f)['commerce']['smtp_password']=='private-local-secret'
try:request('/api/academy/settings',{'settings':settings,'revision':0});raise AssertionError('stale local settings accepted')
except urllib.error.HTTPError as e:assert e.code==409
try:b.compose('exec','-T','api','/usr/local/bin/meet','managed-academy',data=b'{"Method":"GET","Path":"/api/academy/admin/students"}');raise AssertionError('central business bridge accepted')
except subprocess.CalledProcessError:pass
b.compose('stop','api','web');b.compose('exec','-T','mysql','sh','-c','MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -h 127.0.0.1 -u root -e "DROP DATABASE meet; CREATE DATABASE meet CHARACTER SET utf8mb4"');b.compose('run','--rm','migrate')
for name in ['settings.json','managed.json']:(root/'runtime-config'/name).unlink(missing_ok=True)
os.environ['APP_ORIGIN']=original;(root/'.env').write_text('APP_ORIGIN='+original+'\n');b.compose('up','-d','api','web')
print('Fresh managed academy CLI, brand landing, admin login without school code and central binding passed')
