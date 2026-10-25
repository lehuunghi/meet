import importlib.util, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('meet_agent',Path(__file__).with_name('agent.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class AgentTests(unittest.TestCase):
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
if __name__=='__main__':unittest.main()
