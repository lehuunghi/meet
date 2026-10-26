import http.client, importlib.util, json, os, tempfile, threading, unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
spec=importlib.util.spec_from_file_location('control_server',Path(__file__).with_name('server.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class ControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();c.ROOT=Path(cls.tmp.name);c.ORIGIN='https://admin.example.test'
        p=c.ROOT/'password';p.write_text('integration-password-123')
        os.environ['MEET_CONTROL_PASSWORD_FILE']=str(p);os.environ['MEET_CONTROL_EMAIL']='owner@example.test';c.init()
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),c.Handler);threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.port=cls.server.server_port
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.tmp.cleanup()
    def request(self,path,data=None,cookie='',agent='',origin=None,method=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5);headers={'Origin':origin or c.ORIGIN,'Cookie':cookie,'Authorization':'Bearer '+agent,'Content-Type':'application/json'}
        conn.request(method or ('GET' if data is None else 'POST'),path,None if data is None else json.dumps(data),headers)
        response=conn.getresponse();raw=response.read();cookies=response.getheader('Set-Cookie','').split(';')[0];status=response.status;conn.close();return status,json.loads(raw),cookies
    def login(self):
        status,_,cookie=self.request('/api/login',{'email':'owner@example.test','password':'integration-password-123'});self.assertEqual(status,200);return cookie
    def test_permanent_delete_requires_trash_reauthentication_and_exclusive_job(self):
        owner=self.login();domain='purge-qa.example.test'
        _,unit,_=self.request('/api/schools/save',{'name':'Purge QA','domain':domain,'ip':'8.8.8.8','config':{'school_slug':'purge-qa'}},owner);sid=unit['id'];base='/api/schools/'+sid
        payload={'action':'purge','confirm':domain,'phrase':'XOA VINH VIEN','erase_vps':True,'admin_password':'integration-password-123','ssh':{'fingerprint':'SHA256:'+'a'*43,'password':'root-private-test'}}
        self.assertEqual(self.request(base+'/lifecycle',payload,owner)[0],400)
        with c.connect() as db:
            db.execute("UPDATE schools SET desired_state='deleted',applied_state='suspended' WHERE id=?",(sid,));db.execute("UPDATE jobs SET state='superseded' WHERE school=?",(sid,))
        for key,value in [('admin_password','wrong'),('phrase',''),('confirm','other.example.test'),('erase_vps',False),('ssh',{'password':'secret','fingerprint':'bad'})]:
            self.assertEqual(self.request(base+'/lifecycle',{**payload,key:value},owner)[0],400)
        self.assertEqual(self.request(base+'/action',{'action':'purge','payload':payload},owner)[0],400)
        status,out,_=self.request(base+'/lifecycle',payload,owner);self.assertEqual(status,200);jid=out['id']
        self.assertEqual(self.request(base+'/lifecycle',{'action':'restore'},owner)[0],400)
        self.assertEqual(self.request('/api/purges/'+jid,cookie=owner)[1]['state'],'queued')
        with c.connect() as db:
            row=db.execute('SELECT payload FROM jobs WHERE id=?',(jid,)).fetchone();self.assertNotIn('root-private-test',row['payload'])
            saved=c.decrypt(row['payload'],sid);self.assertEqual(saved['ssh']['password'],'root-private-test');self.assertNotIn('admin_password',saved);self.assertNotIn('code',saved)
            db.execute('UPDATE schools SET agent_hash=? WHERE id=?',(c.digest('purge-agent-test'),sid))
        self.assertIsNone(self.request('/agent/poll',{'status':{}},agent='purge-agent-test')[1]['job'])
        from purge import finalize
        with c.connect() as db:job=dict(db.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone());before=db.execute('SELECT COUNT(*) FROM schools').fetchone()[0]
        for group in ('portable-backups','portable-recovery'):
            path=c.ROOT/group/sid;path.mkdir(parents=True);(path/'encrypted').write_text('test-only')
        finalize(c,job)
        with c.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM schools').fetchone()[0],before-1)
            self.assertIsNone(db.execute('SELECT id FROM jobs WHERE id=?',(jid,)).fetchone())
        receipt=self.request('/api/purges/'+jid,cookie=owner)[1];self.assertEqual(receipt['state'],'success');self.assertEqual(receipt['progress'][-1]['percent'],100)
        self.assertFalse((c.ROOT/'portable-backups'/sid).exists())
    def test_auto_link_save_ack_and_failure_status(self):
        cookie=self.login();data={'name':'Sync QA','domain':'sync-qa.example.test','ip':'8.8.4.4','config':{'platform_mode':'academy','school_slug':'sync-qa','retention_days':30}}
        status,result,_=self.request('/api/academies/save',data,cookie);self.assertEqual(status,200);sid=result['id'];self.assertTrue(result['job_id'])
        def unit():return next(s for s in self.request('/api/schools',cookie=cookie)[1] if s['id']==sid)
        self.assertFalse(unit()['sync']['linked'])
        _,issued,_=self.request('/api/schools/'+sid+'/enroll',{},cookie)
        _,issued,_=self.request('/agent/enroll',{'token':issued['token']});agent=issued['token']
        _,polled,_=self.request('/agent/poll',{'status':{}},agent=agent);job=polled['job']
        self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'failed','code':'CONFIG_R2_REJECTED'},agent=agent)
        sync=unit()['sync'];self.assertTrue(sync['linked']);self.assertTrue(sync['online']);self.assertEqual(sync['state'],'failed');self.assertEqual(sync['applied'],0);self.assertEqual(sync['code'],'CONFIG_R2_REJECTED')
        self.assertEqual(self.request('/api/academies/save',{**data,'id':sid,'revision':1,'config':{**data['config'],'school_slug':'wrong-slug'}},cookie)[0],400)
        self.request('/api/schools/'+sid+'/action',{'action':'configure','payload':{}},cookie)
        _,polled,_=self.request('/agent/poll',{'status':{}},agent=agent);job=polled['job']
        self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'success','code':'OK'},agent=agent)
        self.assertEqual(unit()['sync']['state'],'applied');self.assertEqual(unit()['sync']['applied'],1)
    def test_control_lifecycle(self):
        cookie=self.login()
        self.assertEqual(self.request('/api/schools')[0],401)
        self.assertEqual(self.request('/api/schools/save',{},cookie,origin='https://evil.test')[0],403)
        cfg={'retention_days':30,'sfu':[{'id':'app1','secret':'secret-never-plain','app_id':'test','enabled':True,'weight':1}],'turn':[{'id':'turn1','token':'turn-secret'}]}
        status,result,_=self.request('/api/schools/save',{'name':'Trường thử nghiệm','domain':'school.example.test','ip':'8.8.8.8','config':cfg},cookie);self.assertEqual(status,200);sid=result['id']
        with c.connect() as db:
            row=db.execute('SELECT config FROM schools WHERE id=?',(sid,)).fetchone();self.assertNotIn('secret-never-plain',row['config'])
        status,result,_=self.request('/api/schools/'+sid+'/config',cookie=cookie);self.assertEqual(status,200);self.assertEqual(result['config']['sfu'][0]['secret'],'••••••••');self.assertEqual(result['config']['turn'],[])
        status,_,_=self.request('/api/schools/'+sid+'/enroll',cookie=cookie);self.assertEqual(status,400) # GET must not issue enrollment credentials.
        status,result,_=self.request('/api/schools/'+sid+'/enroll',{},cookie);self.assertEqual(status,200);enroll=result['token']
        status,result,_=self.request('/agent/enroll',{'token':enroll});self.assertEqual(status,200);agent=result['token']
        self.assertEqual(self.request('/agent/enroll',{'token':enroll})[0],400)
        self.assertEqual(self.request('/agent/poll',{'status':{}},agent='bad')[0],401)
        status,result,_=self.request('/agent/poll',{'status':{'version':'0.6.0','secret':'must-not-save'}},agent=agent);self.assertEqual(status,200);job=result['job'];self.assertEqual(job['payload']['settings']['sfu'][0]['secret'],'secret-never-plain')
        status,_,_=self.request('/agent/ack',{'id':job['id'],'lease':'wrong','state':'success'},agent=agent);self.assertEqual(status,400)
        status,_,_=self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'success','code':'OK'},agent=agent);self.assertEqual(status,200)
        status,schools,_=self.request('/api/schools',cookie=cookie);school=next(s for s in schools if s['id']==sid);self.assertEqual(school['applied'],1)
        status,result,_=self.request('/agent/poll',{'status':{}},agent=agent);self.assertIsNone(result['job'])
        self.assertEqual(self.request('/api/schools/save',{'id':sid,'name':'Name','domain':'school.example.test','ip':'8.8.8.8','revision':0,'config':cfg},cookie)[0],400)
        self.assertEqual(self.request('/api/schools/save',{'name':'Private','domain':'private.example.test','ip':'127.0.0.1','config':cfg},cookie)[0],400)
    def test_twofactor_challenge_recovery_and_session_replacement(self):
        import base64,hashlib,hmac,struct,time
        owner=self.login();password='mfa-password-12345';email='mfa@example.test'
        self.assertEqual(self.request('/api/admins',{'email':email,'password':password,'role':'operator','active':True},owner)[0],200)
        _,_,cookie=self.request('/api/login',{'email':email,'password':password})
        status,result,_=self.request('/api/security',{'action':'setup','password':password},cookie);self.assertEqual(status,200);secret=result['secret']
        def code(step):
            raw=hmac.new(base64.b32decode(secret),struct.pack('>Q',step),hashlib.sha1).digest();off=raw[-1]&15;return str((struct.unpack('>I',raw[off:off+4])[0]&0x7fffffff)%1000000).zfill(6)
        step=int(time.time())//30
        status,result,_=self.request('/api/security',{'action':'enable','password':password,'code':code(step)},cookie);self.assertEqual(status,200);codes=result['recovery_codes'];self.assertEqual(len(codes),8)
        self.assertEqual(self.request('/api/me',cookie=cookie)[0],401)
        def challenge():
            status,result,issued=self.request('/api/login',{'email':email,'password':password});self.assertEqual(status,202);self.assertEqual(issued,'');return result['challenge']
        token=challenge();self.assertEqual(self.request('/api/login/2fa',{'challenge':token,'code':code(step)})[0],401)
        status,_,first=self.request('/api/login/2fa',{'challenge':token,'code':codes[0]});self.assertEqual(status,200)
        token=challenge();self.assertEqual(self.request('/api/me',cookie=first)[0],200)
        status,_,second=self.request('/api/login/2fa',{'challenge':token,'code':code(step+1)});self.assertEqual(status,200)
        self.assertEqual(self.request('/api/me',cookie=first)[0],401)
        self.assertEqual(self.request('/api/login/2fa',{'challenge':token,'code':codes[1]})[0],401)
        token=challenge();self.assertEqual(self.request('/api/login/2fa',{'challenge':token,'code':codes[0]})[0],401)
        self.assertEqual(self.request('/api/security',{'action':'disable','password':password,'code':codes[2]},second)[0],200)
        self.assertEqual(self.request('/api/login',{'email':email,'password':password})[0],200)
    def test_own_credentials_change_requires_password_and_invalidates_session(self):
        owner=self.login();email='profile-change@example.test';password='old-password-12345'
        self.assertEqual(self.request('/api/admins',{'email':email,'password':password,'role':'viewer','active':True},owner)[0],200)
        _,_,cookie=self.request('/api/login',{'email':email,'password':password})
        self.assertEqual(self.request('/api/profile',{'current_password':'wrong','email':'new-profile@example.test'},cookie)[0],400)
        self.assertEqual(self.request('/api/profile',{'current_password':password,'new_password':'short'},cookie)[0],400)
        self.assertEqual(self.request('/api/profile',{'current_password':password,'email':'new-profile@example.test','new_password':'new-password-12345'},cookie)[0],200)
        self.assertEqual(self.request('/api/me',cookie=cookie)[0],401)
        self.assertEqual(self.request('/api/login',{'email':email,'password':password})[0],401)
        status,_,new=self.request('/api/login',{'email':'new-profile@example.test','password':'new-password-12345'});self.assertEqual(status,200)
        self.assertEqual(self.request('/api/me',cookie=new)[1]['role'],'viewer')
    def test_progress_and_guarded_restore_queue_do_not_retain_credentials(self):
        owner=self.login();_,unit,_=self.request('/api/schools/save',{'name':'Restore QA','domain':'restore-qa.example.test','ip':'8.8.8.8','config':{}},owner);sid=unit['id']
        _,issued,_=self.request('/api/schools/'+sid+'/enroll',{},owner);_,issued,_=self.request('/agent/enroll',{'token':issued['token']});agent=issued['token']
        _,out,_=self.request('/agent/poll',{'status':{'control_protocol':3,'live':0}},agent=agent);job=out['job']
        self.assertEqual(self.request('/agent/progress',{'id':job['id'],'lease':'bad','stage':'ssh'},agent=agent)[0],400)
        for stage in ('ssh','database','source'):
            self.assertEqual(self.request('/agent/progress',{'id':job['id'],'lease':job['lease'],'stage':stage},agent=agent)[0],200)
        self.assertEqual(self.request('/agent/progress',{'id':job['id'],'lease':job['lease'],'stage':'password=PRIVATE'},agent=agent)[0],400)
        rows=self.request('/api/schools/'+sid+'/jobs',cookie=owner)[1];self.assertEqual(rows[0]['progress'][-1]['percent'],72)
        with c.connect() as db:
            installed=c.queue(db,sid,'provision',{},1);db.execute("UPDATE jobs SET state='success',result=? WHERE id=?",(json.dumps({'code':'WAITING_AGENT'}),installed));c.progress(db,installed,'configure')
        self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'success','code':'OK'},agent=agent)
        with c.connect() as db:
            self.assertEqual(json.loads(db.execute('SELECT result FROM jobs WHERE id=?',(installed,)).fetchone()['result'])['code'],'OK');self.assertEqual(c.job_progress(db,installed)[-1]['percent'],100)
        _,out,_=self.request('/api/schools/'+sid+'/action',{'action':'backup-list'},owner)
        _,out,_=self.request('/agent/poll',{'status':{'control_protocol':3,'live':0}},agent=agent);job=out['job'];key='backups/updates/'+'a'*36+'.meet'
        self.assertEqual(self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'success','code':'OK','backups':[{'object_key':key,'bytes':400,'modified':'2026-10-27T00:00:00Z'}]},agent=agent)[0],200)
        action='/api/schools/'+sid+'/action';payload={'object_key':key,'confirm':'restore-qa.example.test','password':'integration-password-123'}
        self.assertEqual(self.request(action,{'action':'restore','payload':payload},owner)[0],400)
        with c.connect() as db:db.execute("UPDATE schools SET desired_state='suspended',applied_state='suspended' WHERE id=?",(sid,))
        self.assertEqual(self.request(action,{'action':'restore','payload':{**payload,'object_key':'backups/foreign.meet'}},owner)[0],400)
        status,out,_=self.request(action,{'action':'restore','payload':payload},owner);self.assertEqual(status,200)
        with c.connect() as db:
            saved=db.execute('SELECT payload FROM jobs WHERE id=?',(out['id'],)).fetchone();self.assertEqual(c.decrypt(saved['payload'],sid),{'object_key':key})
    def test_vault_scope_and_mask_merge(self):
        value=c.encrypt({'token':'private'},'school-a');self.assertEqual(c.decrypt(value,'school-a')['token'],'private')
        with self.assertRaises(Exception):c.decrypt(value,'school-b')
        self.assertEqual(c.merge_secrets({'sfu':[{'id':'b','secret':'••••••••'},{'id':'a','secret':'••••••••'}]},{'sfu':[{'id':'a','secret':'a-secret'},{'id':'b','secret':'b-secret'}]})['sfu'][0]['secret'],'b-secret')
    def test_academy_install_readiness_and_guards(self):
        cookie=self.login()
        cfg={'platform_mode':'academy','retention_days':30,'initial_admin':{}}
        data={'name':'Academy QA','domain':'academy-install.example.test','ip':'8.8.8.8','config':cfg}
        status,result,_=self.request('/api/schools/save',data,cookie);self.assertEqual(status,200);sid=result['id'];base='/api/schools/'+sid
        status,report,_=self.request(base+'/readiness',cookie=cookie);self.assertEqual(status,200);self.assertFalse(report['can_install']);self.assertNotIn('private-payos-key',json.dumps(report))
        action={'action':'provision','payload':{'port':22,'fingerprint':'SHA256:'+'a'*43,'password':'private-ssh-password'}}
        self.assertEqual(self.request(base+'/action',action,cookie)[0],400)
        cfg['initial_admin']={'email':'owner@example.test','password':'private-bootstrap-password'}
        status,result,_=self.request('/api/schools/save',{**data,'id':sid,'revision':1},cookie);self.assertEqual(status,200)
        status,report,_=self.request(base+'/readiness',cookie=cookie);self.assertTrue(report['can_install']);self.assertNotIn('private-bootstrap-password',json.dumps(report))
        self.assertEqual(self.request(base+'/action',action,cookie)[0],200)
        self.assertEqual(self.request(base+'/action',action,cookie)[0],400)
        self.assertEqual(self.request('/api/schools/save',{**data,'id':sid,'revision':2},cookie)[0],400)
        with c.connect() as db:
            payload=db.execute("SELECT payload FROM jobs WHERE school=? AND action='provision'",(sid,)).fetchone()['payload'];self.assertNotIn('private-ssh-password',payload)
            db.execute("UPDATE jobs SET state='failed' WHERE school=? AND action='provision'",(sid,));db.execute('UPDATE schools SET seen=1 WHERE id=?',(sid,))
        self.assertFalse(self.request(base+'/readiness',cookie=cookie)[1]['can_install'])
        self.assertEqual(self.request(base+'/action',action,cookie)[0],400)
        cfg['platform_mode']='school'
        self.assertEqual(self.request('/api/schools/save',{**data,'id':sid,'revision':2},cookie)[0],400)
        with self.assertRaises(ValueError):c.validate_config({'commerce':{'free_videos':0}})
    def test_offline_domain_correction_supersedes_stale_config(self):
        cookie=self.login();data={'name':'Before install','domain':'before.example.test','ip':'8.8.8.8','config':{'platform_mode':'academy'}}
        _,out,_=self.request('/api/schools/save',data,cookie);sid=out['id']
        status,_,_=self.request('/api/schools/save',{**data,'id':sid,'revision':1,'domain':'corrected.example.test'},cookie);self.assertEqual(status,200)
        with c.connect() as db:
            self.assertEqual(db.execute('SELECT domain FROM schools WHERE id=?',(sid,)).fetchone()['domain'],'corrected.example.test')
            self.assertEqual(db.execute("SELECT count(*) FROM jobs WHERE school=? AND action='configure' AND state='queued'",(sid,)).fetchone()[0],1)
            self.assertEqual(db.execute("SELECT count(*) FROM jobs WHERE school=? AND state='superseded'",(sid,)).fetchone()[0],1)
    def test_business_management_is_not_a_central_capability(self):
        cookie=self.login();cfg={'platform_mode':'academy'}
        _,out,_=self.request('/api/academies/save',{'name':'Business QA','domain':'business.example.test','ip':'8.8.4.4','config':cfg},cookie);sid=out['id'];base='/api/schools/'+sid
        self.assertEqual(self.request(base+'/action',{'action':'academy','payload':{'method':'GET','path':'/api/academy/admin/students'}},cookie)[0],400)
        self.assertEqual(self.request('/api/academies/save',{'id':sid,'revision':1,'name':'Business QA','domain':'business.example.test','ip':'8.8.4.4','config':{**cfg,'commerce':{'free_videos':8}}},cookie)[0],400)
        self.assertNotIn('commerce',self.request(base+'/config',cookie=cookie)[1]['config'])
        _,key,_=self.request(base+'/keys',{'label':'QA','days':1},cookie)
        self.assertEqual(self.request('/api/v1/schools/'+sid,{'revision':1,'free_videos':8},agent=key['token'],method='PATCH')[0],400)
        # Legacy encrypted business results must not be readable centrally anymore.
        with c.connect() as db:
            jid='f'*32;result={'code':'OK','payload':c.encrypt({'private':'student-profile'},sid)}
            db.execute("INSERT INTO jobs(id,school,action,payload,revision,state,created,result) VALUES(?,?,?,?,?,'success',?,?)",(jid,sid,'academy',c.encrypt({},sid),1,1790000000,json.dumps(result)))
        rows=self.request(base+'/jobs',cookie=cookie)[1];self.assertNotIn('student-profile',json.dumps(rows));self.assertTrue(json.loads(rows[0]['result']).get('expired') or any(json.loads(x['result']).get('expired') for x in rows))
    def test_viewer_and_single_session(self):
        cookie=self.login();second=self.login();self.assertEqual(self.request('/api/me',cookie=cookie)[0],401)
        self.assertEqual(self.request('/api/admins',{'email':'view@example.test','password':'viewer-password-123','role':'viewer','active':True},second)[0],200)
        status,_,viewer=self.request('/api/login',{'email':'view@example.test','password':'viewer-password-123'});self.assertEqual(status,200)
        self.assertEqual(self.request('/api/schools/save',{},viewer)[0],403)
        self.assertEqual(self.request('/api/admins',cookie=viewer)[0],400)
        self.assertEqual(self.request('/api/schools',cookie=viewer)[0],200)
    def test_scoped_api_key_and_recoverable_deletion(self):
        owner=self.login();_,out,_=self.request('/api/schools/save',{'name':'API school','domain':'api-school.example.test','ip':'8.8.8.8','config':{}},owner);sid=out['id'];base='/api/schools/'+sid
        status,key,_=self.request(base+'/keys',{'label':'Integration','days':30},owner);self.assertEqual(status,200);token=key['token']
        endpoint='/api/v1/schools/'+sid
        self.assertEqual(self.request(endpoint,agent='wrong')[0],401)
        self.assertEqual(self.request(endpoint,agent=token)[1]['revision'],1)
        self.assertEqual(self.request(endpoint,{'revision':1,'name':'Tên qua API','retention_days':45},agent=token,method='PATCH')[0],200)
        self.assertEqual(self.request(endpoint,{'revision':1,'name':'stale'},agent=token,method='PATCH')[0],400)
        self.assertEqual(self.request(endpoint,{'revision':2,'ip':'1.1.1.1'},agent=token,method='PATCH')[0],400)
        with c.connect() as db:
            self.assertNotIn(token,db.execute('SELECT hash FROM school_keys WHERE id=?',(key['id'],)).fetchone()['hash'])
            self.assertEqual(db.execute('SELECT name FROM schools WHERE id=?',(sid,)).fetchone()['name'],'Tên qua API')
        self.assertEqual(self.request(base+'/lifecycle',{'action':'archive','confirm':'api-school.example.test'},owner)[0],400)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'suspend'},owner)[0],200)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'archive','confirm':'wrong'},owner)[0],400)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'archive','confirm':'api-school.example.test'},owner)[0],200)
        self.assertEqual(self.request(endpoint,agent=token)[0],401)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'restore'},owner)[0],200)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'resume'},owner)[0],200)
        self.assertEqual(self.request(base+'/keys',cookie=owner)[1][0]['revoked'],1)
    def test_pending_suspension_requires_ack_and_relocation_is_server_only(self):
        owner=self.login();_,out,_=self.request('/api/schools/save',{'name':'Migration QA','domain':'move.example.test','ip':'8.8.8.8','config':{}},owner);sid=out['id'];base='/api/schools/'+sid;agent='lifecycle-agent-token'
        self.assertEqual(self.request(base+'/relocations',{'action':'backup'},owner)[0],400)
        with c.connect() as db:
            db.execute("UPDATE schools SET seen=1,applied=1,agent_hash=?,status=? WHERE id=?",(c.digest(agent),json.dumps({'control_protocol':2,'features':['lifecycle','relocation'],'live':0}),sid));db.execute("UPDATE jobs SET state='success' WHERE school=?",(sid,))
        self.assertEqual(self.request(base+'/lifecycle',{'action':'suspend'},owner)[0],200)
        with c.connect() as db:self.assertEqual(db.execute('SELECT applied_state FROM schools WHERE id=?',(sid,)).fetchone()['applied_state'],'active')
        _,out,_=self.request('/agent/poll',{'status':{}},agent=agent);job=out['job'];self.assertEqual(job['action'],'lifecycle')
        self.assertEqual(self.request('/agent/ack',{'id':job['id'],'lease':job['lease'],'state':'success','code':'OK'},agent=agent)[0],200)
        with c.connect() as db:db.execute('UPDATE schools SET status=? WHERE id=?',(json.dumps({'control_protocol':2,'features':['lifecycle','relocation'],'live':0}),sid))
        credentials={'fingerprint':'SHA256:'+'b'*43,'password':'private-move-root'}
        status,out,_=self.request(base+'/relocations',{'action':'backup','source':credentials},owner);self.assertEqual(status,200);rid=out['id']
        self.assertEqual(self.request('/agent/poll',{'status':{}},agent=agent)[1]['job'],None)
        self.assertEqual(self.request(base+'/lifecycle',{'action':'resume'},owner)[0],400)
        self.assertEqual(self.request(base+'/relocations',{'action':'cancel','id':rid},owner)[0],400)
        with c.connect() as db:self.assertNotIn('private-move-root',db.execute("SELECT payload FROM jobs WHERE id=?",(out['job'],)).fetchone()['payload'])

if __name__=='__main__':unittest.main()
