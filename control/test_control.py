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
    def request(self,path,data=None,cookie='',agent='',origin=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5);headers={'Origin':origin or c.ORIGIN,'Cookie':cookie,'Authorization':'Bearer '+agent,'Content-Type':'application/json'}
        conn.request('GET' if data is None else 'POST',path,None if data is None else json.dumps(data),headers)
        response=conn.getresponse();raw=response.read();cookies=response.getheader('Set-Cookie','').split(';')[0];status=response.status;conn.close();return status,json.loads(raw),cookies
    def login(self):
        status,_,cookie=self.request('/api/login',{'email':'owner@example.test','password':'integration-password-123'});self.assertEqual(status,200);return cookie
    def test_control_lifecycle(self):
        cookie=self.login()
        self.assertEqual(self.request('/api/schools')[0],401)
        self.assertEqual(self.request('/api/schools/save',{},cookie,origin='https://evil.test')[0],403)
        cfg={'retention_days':30,'sfu':[{'id':'app1','secret':'secret-never-plain','app_id':'test','enabled':True,'weight':1}],'turn':[{'id':'turn1','token':'turn-secret'}]}
        status,result,_=self.request('/api/schools/save',{'name':'Trường thử nghiệm','domain':'school.example.test','ip':'8.8.8.8','config':cfg},cookie);self.assertEqual(status,200);sid=result['id']
        with c.connect() as db:
            row=db.execute('SELECT config FROM schools WHERE id=?',(sid,)).fetchone();self.assertNotIn('secret-never-plain',row['config'])
        status,result,_=self.request('/api/schools/'+sid+'/config',cookie=cookie);self.assertEqual(status,200);self.assertEqual(result['config']['sfu'][0]['secret'],'••••••••');self.assertEqual(result['config']['turn'][0]['token'],'••••••••')
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
    def test_vault_scope_and_mask_merge(self):
        value=c.encrypt({'token':'private'},'school-a');self.assertEqual(c.decrypt(value,'school-a')['token'],'private')
        with self.assertRaises(Exception):c.decrypt(value,'school-b')
        self.assertEqual(c.merge_secrets({'sfu':[{'id':'b','secret':'••••••••'},{'id':'a','secret':'••••••••'}]},{'sfu':[{'id':'a','secret':'a-secret'},{'id':'b','secret':'b-secret'}]})['sfu'][0]['secret'],'b-secret')
    def test_viewer_and_single_session(self):
        cookie=self.login();second=self.login();self.assertEqual(self.request('/api/me',cookie=cookie)[0],401)
        self.assertEqual(self.request('/api/admins',{'email':'view@example.test','password':'viewer-password-123','role':'viewer','active':True},second)[0],200)
        status,_,viewer=self.request('/api/login',{'email':'view@example.test','password':'viewer-password-123'});self.assertEqual(status,200)
        self.assertEqual(self.request('/api/schools/save',{},viewer)[0],403)
        self.assertEqual(self.request('/api/admins',cookie=viewer)[0],400)
        self.assertEqual(self.request('/api/schools',cookie=viewer)[0],200)

if __name__=='__main__':unittest.main()
