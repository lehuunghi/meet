import importlib.util, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('meet_agent',Path(__file__).with_name('agent.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class AgentTests(unittest.TestCase):
    def test_suspension_waits_for_live_and_can_resume(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(a,'ROOT',Path(tmp)),patch.object(a.os,'chown'),patch.object(a,'cli',return_value={'live':1}):
            job={'action':'lifecycle','payload':{'state':'suspended'}}
            self.assertEqual(a.execute(job,{'live':1}),('waiting','LIVE_MEETINGS'))
            self.assertEqual(a.execute(job,{'live':0}),('waiting','LIVE_MEETINGS'))
            self.assertFalse((a.ROOT/'runtime-config/school-state.json').exists())
            with patch.object(a,'cli',return_value={'live':0}):self.assertEqual(a.execute(job,{'live':0}),('success','OK'))
            self.assertEqual(json.loads((a.ROOT/'runtime-config/school-state.json').read_text())['state'],'suspended')
            self.assertEqual(a.execute({'action':'lifecycle','payload':{'state':'active'}},{'live':0}),('success','OK'))
            self.assertEqual(json.loads((a.ROOT/'runtime-config/school-state.json').read_text())['state'],'active')
    def test_live_blocks_sensitive_changes(self):
        with patch.object(a,'configure') as cfg,patch.object(a,'run') as run:
            for action in ('configure','update','domain'):
                self.assertEqual(a.execute({'action':action,'payload':{}},{'live':1}),('waiting','LIVE_MEETINGS'))
            cfg.assert_not_called();run.assert_not_called()
    def test_unknown_action_cannot_execute_shell(self):
        with patch.object(a,'run') as run:
            with self.assertRaises(ValueError):a.execute({'action':'shell','payload':{'command':'whoami'}},{'live':0})
            run.assert_not_called()
    def test_applied_revision_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(a,'ROOT',Path(tmp)),patch.object(a,'configure') as cfg:
            (a.ROOT/'runtime-config').mkdir();(a.ROOT/'runtime-config/control-revision.json').write_text('{"revision":3}')
            self.assertEqual(a.execute({'action':'configure','revision':2,'payload':{}},{'live':0}),('success','OK'));cfg.assert_not_called()
    def test_agent_uses_tls_and_fixed_binary(self):
        with self.assertRaises(ValueError):a.request({'url':'http://attacker.test'},'/agent/poll',{})
        with patch.object(a,'compose',return_value=b'{"ok":true}') as call:
            self.assertEqual(a.cli('managed-status'),{'ok':True});self.assertEqual(call.call_args.args[:4],('exec','-T','api','/usr/local/bin/meet'))
    def test_interrupted_domain_recovers_before_writes_reopen(self):
        import base64
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'runtime-config').mkdir();(root/'sites').mkdir()
            (root/'runtime-config/maintenance').write_text('domain-change')
            journal=root/'domain.json';journal.write_text(json.dumps({'domain':'new.example.test','env':base64.b64encode(b'APP_ORIGIN=https://old.example.test').decode(),'binding':base64.b64encode(b'{"domain":"old.example.test"}').decode(),'site':None}))
            original_path=Path
            def mapped(value):
                if str(value)=='/etc/caddy/meet-sites':return root/'sites'
                return original_path(value)
            with patch.object(a,'ROOT',root),patch.object(a,'DOMAIN_JOURNAL',journal),patch.object(a,'Path',side_effect=mapped),patch.object(a.os,'chown'),patch.object(a,'run'),patch.object(a,'compose'),patch.object(a,'updater',return_value=Mock()):
                a.recover_domain()
            self.assertEqual((root/'.env').read_text(),'APP_ORIGIN=https://old.example.test')
            self.assertFalse(journal.exists());self.assertFalse((root/'runtime-config/maintenance').exists())
    def test_provision_requires_exact_successful_ci_revision(self):
        import io
        spec=importlib.util.spec_from_file_location('provision',Path(__file__).with_name('provision.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
        target='a'*40
        run={'id':1,'run_number':1,'run_attempt':1,'head_sha':target,'path':'.github/workflows/ci.yml','status':'completed','conclusion':'success'}
        jobs=[{'name':n,'status':'completed','conclusion':'success'} for n in ('api','web','containers','control','recorder')]
        def responses(values):return [io.BytesIO(json.dumps(v).encode()) for v in values]
        with patch.object(p.urllib.request,'urlopen',side_effect=responses([{'sha':target},{'workflow_runs':[run]},{'jobs':jobs}])):
            self.assertEqual(p.approved_revision(),target)
        with patch.object(p.urllib.request,'urlopen',side_effect=responses([{'sha':target},{'workflow_runs':[{**run,'conclusion':'failure'}]}])):
            with self.assertRaises(ValueError):p.approved_revision()
        with patch.object(p.urllib.request,'urlopen',side_effect=responses([{'sha':target},{'workflow_runs':[run]},{'jobs':jobs[:-1]}])):
            with self.assertRaises(ValueError):p.approved_revision()
    def test_provision_errors_never_expose_credentials(self):
        spec=importlib.util.spec_from_file_location('provision',Path(__file__).with_name('provision.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
        self.assertEqual(p.failure_code(p.paramiko.AuthenticationException('password-private')), 'SSH_AUTH_FAILED')
        self.assertEqual(p.failure_code(ValueError('SSH_HOST_KEY_MISMATCH')), 'SSH_HOST_KEY_MISMATCH')
        self.assertEqual(p.failure_code(ValueError('EXISTING_INSTALLATION')), 'EXISTING_INSTALLATION')
        self.assertEqual(p.failure_code(RuntimeError('token-private')), 'PROVISION_FAILED_REVIEW_VPS')
    def test_wrong_dns_stops_before_ssh(self):
        spec=importlib.util.spec_from_file_location('provision',Path(__file__).with_name('provision.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
        with patch.object(p,'approved_revision',return_value='a'*40),patch.object(p.socket,'getaddrinfo',return_value=[(None,None,None,None,('8.8.4.4',443))]),patch.object(p.paramiko,'SSHClient') as ssh:
            with self.assertRaisesRegex(ValueError,'DNS_NOT_READY'):p.provision(None,{}, {'domain':'academy.example.test','ip':'8.8.8.8'})
            ssh.assert_not_called()
if __name__=='__main__':unittest.main()
