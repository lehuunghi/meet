import importlib.util,io,tarfile,unittest
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
if __name__=='__main__':unittest.main()
