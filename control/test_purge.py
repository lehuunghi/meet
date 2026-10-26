"""Destructive operations are mocked; every filesystem lives in a temporary directory."""
import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
if sys.platform=='win32':
 import types
 sys.modules.setdefault('fcntl',types.SimpleNamespace())
import purge_remote as p

class PurgeTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name).resolve();self.root=self.base/'opt/meet'
  (self.root/'runtime-config').mkdir(parents=True)
  self.meta={'school':'a'*32,'domain':'school.example.test','origin':'https://admin.example.test','slug':'school-qa'}
  self.bind={'control_id':self.meta['school'],'control_origin':self.meta['origin'],'domain':self.meta['domain'],'school':self.meta['slug']}
  self.binding=self.root/'runtime-config/managed.json';self.binding.write_text(json.dumps(self.bind))
  (self.root/'runtime-config/school-state.json').write_text('{"state":"suspended"}')
  self.outside=self.base/'other-platform/data';self.outside.parent.mkdir();self.outside.write_text('keep')
  self.commands=[];self.volumes={'meet_mysql_data','meet_redis_data','meet-recorder_recorder_spool'}
 def tearDown(self):self.tmp.cleanup()
 def fake_run(self,args,check=True):
  self.commands.append(args)
  if args[:3]==['docker','volume','inspect']:
   name=args[3]
   return json.dumps([{'Labels':{'com.docker.compose.project':'meet-recorder' if 'spool' in name else 'meet'}}]) if name in self.volumes else ''
  if args[:3]==['docker','volume','rm']:self.volumes.remove(args[3]);return args[3]
  if 'mysql' in args and 'exec' in args:return 'school-qa\n0'
  return ''
 def execute(self):
  with patch.object(p,'run',self.fake_run):return p.purge(self.meta,self.base,service_control=lambda _:None)
 def test_wrong_reused_vps_never_mutates(self):
  self.binding.write_text(json.dumps({**self.bind,'control_id':'b'*32}))
  with self.assertRaisesRegex(ValueError,'PURGE_WRONG_VPS'):self.execute()
  self.assertEqual(self.commands,[]);self.assertFalse((self.base/'var/lib/meet-purge').exists());self.assertTrue(self.root.exists())
 def test_active_or_live_never_deletes(self):
  (self.root/'runtime-config/school-state.json').write_text('{"state":"active"}')
  with self.assertRaisesRegex(ValueError,'PURGE_NOT_SUSPENDED'):self.execute()
  (self.root/'runtime-config/school-state.json').write_text('{"state":"suspended"}')
  original=self.fake_run
  def live(args,check=True):return 'school-qa\n1' if 'mysql' in args and 'exec' in args else original(args,check)
  with patch.object(p,'run',live),self.assertRaisesRegex(ValueError,'PURGE_LIVE_MEETINGS'):p.purge(self.meta,self.base,service_control=lambda _:None)
  self.assertTrue(self.root.exists());self.assertFalse(any(x[:3]==['docker','volume','rm'] for x in self.commands))
 def test_only_owned_files_and_all_three_volumes_removed(self):
  (self.root/'secrets').mkdir();(self.root/'secrets/password').write_text('private')
  self.assertTrue(self.execute()['purged']);self.assertFalse(self.root.exists());self.assertFalse(self.volumes)
  self.assertEqual(self.outside.read_text(),'keep');self.assertTrue(self.execute()['purged'])
  self.root.mkdir();(self.root/'runtime-config').mkdir();self.binding.write_text(json.dumps({**self.bind,'domain':'new.example.test'}))
  with self.assertRaisesRegex(ValueError,'PURGE_WRONG_VPS'):self.execute()
 def test_foreign_volume_blocks_deletion(self):
  original=self.fake_run
  def foreign(args,check=True):
   if args[:3]==['docker','volume','inspect']:return '[{"Labels":{"com.docker.compose.project":"other"}}]'
   return original(args,check)
  with patch.object(p,'run',foreign),self.assertRaisesRegex(ValueError,'PURGE_UNOWNED_VOLUME'):p.purge(self.meta,self.base,service_control=lambda _:None)
  self.assertTrue(self.root.exists())
 def test_symlink_parent_rejected(self):
  target=self.base/'elsewhere';target.mkdir();(self.base/'etc').symlink_to(target,target_is_directory=True)
  with self.assertRaisesRegex(ValueError,'PURGE_UNSAFE_PATH'):self.execute()
  self.assertTrue(self.root.exists())

if __name__=='__main__':unittest.main()


