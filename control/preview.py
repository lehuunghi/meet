"""Disposable loopback fixture for browser acceptance; never starts an SSH worker."""
import importlib.util, json, os, tempfile, time
from pathlib import Path
from http.server import ThreadingHTTPServer

spec=importlib.util.spec_from_file_location('preview_control',Path(__file__).with_name('server.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
workspace=tempfile.TemporaryDirectory(prefix='meet-control-qa-')
c.ROOT=Path(workspace.name)
port=int(os.environ.get('CONTROL_TEST_PORT','8092'))
c.ORIGIN='http://127.0.0.1:'+str(port)
password=c.ROOT/'bootstrap';password.write_text('demo-control-12345')
os.environ['MEET_CONTROL_EMAIL']='owner@demo.test';os.environ['MEET_CONTROL_PASSWORD_FILE']=str(password)
c.init()
with c.connect() as db:
    sid='1'*32
    cfg={'retention_days':30,'sfu':[],'turn':[],'r2':{'enabled':False},'backup':{'enabled':False,'interval_hours':24}}
    db.execute('INSERT INTO schools(id,name,domain,ip,config,status,seen,applied) VALUES(?,?,?,?,?,?,?,1)',(sid,'Trường nội bộ QA','school.example.test','8.8.8.8',c.encrypt(cfg,sid),json.dumps({'version':'0.8.1','live':0}),int(time.time())))

if os.environ.get('CONTROL_SFU_FIXTURES')=='1':
    cfg['sfu']=[{'id':'p1','name':'SFU 1','app_id':'app1','secret':'fixture-secret-1','weight':1,'enabled':True},{'id':'p2','name':'SFU 2','app_id':'app2','secret':'fixture-secret-2','weight':1,'enabled':False}]
    status={'version':'0.32.0','features':['sfu_round_robin','sfu_usage'],'sfu_usage':[{'id':'p1','app_id':'app1','ingress_bytes':400000000,'egress_bytes':600000000,'month_ingress_bytes':100000000,'month_egress_bytes':200000000,'samples':12,'updated_at':'2026-10-29T05:00:00Z','meetings':4}]}
    with c.connect() as db:db.execute('UPDATE schools SET config=?,status=? WHERE id=?',(c.encrypt(cfg,sid),json.dumps(status),sid))

if os.environ.get('CONTROL_FEATURE_FIXTURES')=='1':
    with c.connect() as db:
        db.execute("UPDATE schools SET desired_state='suspended',applied_state='suspended',agent_hash=?,status=? WHERE id=?",(c.digest('fixture-only-agent'),json.dumps({'version':'0.13.0','live':0,'control_protocol':3}),sid))
        install=c.queue(db,sid,'provision',{},1);db.execute("UPDATE jobs SET state='running' WHERE id=?",(install,));c.progress(db,install,'ssh');c.progress(db,install,'images')
        listing=c.queue(db,sid,'backup-list',{},1);db.execute("UPDATE jobs SET state='success',result=? WHERE id=?",(json.dumps({'code':'OK','backups':[{'object_key':'backups/2026/qa.meet','bytes':4000,'modified':'2026-10-27T00:00:00Z'}]}),listing))
        trash='2'*32
        db.execute("INSERT INTO schools(id,name,domain,ip,config,desired_state,applied_state) VALUES(?,?,?,?,?,'deleted','suspended')",(trash,'Trash QA','trash.example.test','8.8.4.4',c.encrypt(cfg,trash)))

class Preview(c.Handler):
    def send_header(self,key,value):
        if key.lower()=='set-cookie':value=value.replace('; Secure','')
        super().send_header(key,value)

print('Disposable control preview ready: '+c.ORIGIN,flush=True)
ThreadingHTTPServer(('127.0.0.1',port),Preview).serve_forever()
