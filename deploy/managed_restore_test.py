import importlib.util,json,tempfile,unittest,types
from pathlib import Path
from unittest.mock import Mock,patch
s=importlib.util.spec_from_file_location('managed_restore',Path(__file__).with_name('managed_restore.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class RestoreTests(unittest.TestCase):
 def test_list_is_bounded_and_ignores_other_prefixes(self):
  with tempfile.TemporaryDirectory() as tmp:
   cfg={'r2':{'enabled':True}};b=types.SimpleNamespace(MAX_BYTES=512*1024*1024,transfer=Mock(return_value=b'<ListBucketResult><Contents><Key>recordings/private.webm</Key><Size>12</Size></Contents><Contents><Key>backups/2026/one.meet</Key><Size>400</Size><LastModified>2026-10-27T00:00:00Z</LastModified></Contents><IsTruncated>false</IsTruncated></ListBucketResult>'))
   u=types.SimpleNamespace(STATE=Path(tmp),backup_module=lambda:b,read_json=lambda _:cfg)
   rows=m.list_backups(u);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['object_key'],'backups/2026/one.meet');self.assertIn('prefix=backups%2F',b.transfer.call_args.kwargs['query'])
 def test_arbitrary_paths_cannot_read_local_files(self):
  u=Mock()
  for key in ['local:../../etc/passwd','backups/../../secrets.meet','https://evil.test/key','recordings/file.meet']:
   with self.assertRaises(ValueError):m.read_snapshot(u,key)
 def test_live_or_active_journal_blocks_before_reading_backup(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'ROOT',Path(tmp)):
   u=Mock();u.STATE=Path(tmp);u.read_json.return_value={'active':True}
   with self.assertRaisesRegex(ValueError,'RESTORE_BUSY'):m.restore_backup(u,'backups/a.meet')
   u.backup_module.assert_not_called()
if __name__=='__main__':unittest.main()
