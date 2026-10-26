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

if os.environ.get('CONTROL_FEATURE_FIXTURES')=='1':
    with c.connect() as db:
        db.execute("UPDATE schools SET desired_state='suspended',applied_state='suspended',agent_hash=?,status=? WHERE id=?",(c.digest('fixture-only-agent'),json.dumps({'version':'0.13.0','live':0,'control_protocol':3}),sid))
        install=c.queue(db,sid,'provision',{},1);db.execute("UPDATE jobs SET state='running' WHERE id=?",(install,));c.progress(db,install,'ssh');c.progress(db,install,'images')
        listing=c.queue(db,sid,'backup-list',{},1);db.execute("UPDATE jobs SET state='success',result=? WHERE id=?",(json.dumps({'code':'OK','backups':[{'object_key':'backups/2026/qa.meet','bytes':4000,'modified':'2026-10-27T00:00:00Z'}]}),listing))

class Preview(c.Handler):
    def send_header(self,key,value):
        if key.lower()=='set-cookie':value=value.replace('; Secure','')
        super().send_header(key,value)

print('Disposable control preview ready: '+c.ORIGIN,flush=True)
ThreadingHTTPServer(('127.0.0.1',port),Preview).serve_forever()
