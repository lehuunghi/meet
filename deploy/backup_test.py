import importlib.util,io,tarfile,unittest,tempfile,json,subprocess,types
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('backup',Path(__file__).with_name('backup.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BackupTests(unittest.TestCase):
 def test_authenticated_encryption(self):
  key=bytes(range(32));raw=b.seal(b'private config and database',key);self.assertEqual(b.unseal(raw,key),b'private config and database')
  with self.assertRaises(Exception):b.unseal(raw[:-1]+bytes([raw[-1]^1]),key)
  with self.assertRaises(Exception):b.unseal(raw,bytes(32))
 def test_unsafe_archives(self):
  for name in ['../escape','/etc/passwd','safe/../../escape']:
   out=io.BytesIO()
   with tarfile.open(fileobj=out,mode='w') as a:b.add_bytes(a,name,b'x')
   with self.assertRaises(ValueError):b.read_archive(out.getvalue())
 def test_git_style_directories(self):
  out=io.BytesIO()
  with tarfile.open(fileobj=out,mode='w') as a:
   info=tarfile.TarInfo('apps');info.type=tarfile.DIRTYPE;a.addfile(info);b.add_bytes(a,'apps/main.go',b'package main')
  self.assertEqual(b.read_archive(out.getvalue()),{'apps/main.go':b'package main'})
class RoundTripTests(unittest.TestCase):
 def test_database_code_config_snapshot_restore(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);original=base/'original';original.mkdir();(original/'runtime-config').mkdir()
   cfg={'r2':{'enabled':True,'account_id':'a'*32,'bucket':'test-bucket','access_key_id':'test','secret_access_key':'test'},'backup':{'enabled':True,'interval_hours':24}}
   (original/'runtime-config/settings.json').write_text(json.dumps(cfg));(original/'runtime-config/account-key').write_text('a'*64)
   (original/'main.go').write_text('package main');(original/'.env').write_text('APP_ORIGIN=https://original.example')
   subprocess.run(['git','init',str(original)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   subprocess.run(['git','-C',str(original),'add','main.go'],check=True)
   subprocess.run(['git','-C',str(original),'-c','user.name=Test','-c','user.email=test@example.test','commit','-m','source'],check=True,stdout=subprocess.PIPE)
   objects={};calls=[]
   def transfer(method,cfg,key,body=b''):
    if method=='PUT':objects[key]=body;return b''
    return objects[key]
   def compose(*args,data=None):
    calls.append((args,data))
    if 'mysqldump' in ' '.join(args):return b'CREATE TABLE test_snapshot(id INT);'
    if 'SELECT COUNT(*) FROM schools' in ' '.join(args):return b'0\n'
    return b''
   key=base/'recovery.key'
   with patch.object(b,'ROOT',original),patch.object(b,'KEY',key),patch.object(b,'compose',compose),patch.object(b,'transfer',transfer),patch.object(b.os,'chown',lambda *args:None,create=True):b.backup(True)
   object_key=next(iter(objects));self.assertNotIn(b'CREATE TABLE',objects[object_key]);self.assertNotIn(key.read_bytes(),objects[object_key])
   fresh=base/'fresh';fresh.mkdir();(fresh/'runtime-config').mkdir();(fresh/'.env').write_text('APP_ORIGIN=https://new.example')
   credentials=base/'credentials.json';credentials.write_text(json.dumps(cfg))
   with patch.object(b,'ROOT',fresh),patch.object(b,'compose',compose),patch.object(b,'transfer',transfer),patch.object(b.os,'chown',lambda *args:None,create=True):b.restore(types.SimpleNamespace(credentials=str(credentials),object=object_key,key=str(key)))
   self.assertEqual((fresh/'main.go').read_text(),'package main');self.assertEqual((fresh/'runtime-config/account-key').read_text(),'a'*64)
   self.assertIn('new.example',(fresh/'.env').read_text());self.assertTrue(any(data==b'CREATE TABLE test_snapshot(id INT);' for _,data in calls));self.assertTrue(any(args==('up','-d','api','web') for args,_ in calls))
if __name__=='__main__':unittest.main()
