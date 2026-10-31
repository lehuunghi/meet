import importlib.util, io, json, hashlib, tempfile, unittest
from pathlib import Path
from unittest.mock import patch, Mock

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
r=load('portable_test','relocate.py');b=load('portable_crypto','backup.py')

class PortableTests(unittest.TestCase):
    def fixture(self):
        files={'database.sql':b'-- source school dump','source.tar':b'old source archive','settings.json':b'{"r2":{"enabled":false},"turn":[]}', 'account-key':b'a'*64}
        manifest={'kind':'portable-v1','commit':'a'*40,'schema':7,'slug':'school-qa','school_id':'qa-school','counts':{'schools':1,'users':4,'classes':1,'courses':2,'meetings':3},'hashes':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}
        files['manifest.json']=json.dumps(manifest).encode();return files,manifest
    def test_hashes_include_account_key(self):
        files,manifest=self.fixture();self.assertEqual(r.validate_snapshot(files),manifest)
        files['account-key']=b'changed'
        with self.assertRaises(ValueError):r.validate_snapshot(files)
    def test_restore_keeps_new_source_secrets_and_suspension(self):
        files,manifest=self.fixture();output=io.BytesIO()
        import tarfile
        with tarfile.open(fileobj=output,mode='w:gz') as tar:
            for name,raw in files.items():b.add_bytes(tar,name,raw)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'runtime-config').mkdir();(root/'deploy').mkdir();(root/'deploy/release.json').write_text('{"schema_version":7}')
            (root/'.env').write_text('APP_ORIGIN=https://stage.example.test\nMYSQL_PASSWORD=fresh-target-secret\n');(root/'approved-source.txt').write_text('new approved source')
            key=root/'key';key.write_text('01'*32);archive=root/'snapshot.meet';archive.write_bytes(b.seal(output.getvalue(),bytes.fromhex('01'*32)))
            b.ROOT=root
            with patch.object(r,'ROOT',root),patch.object(r,'RESTORED',root/'restored.json'),patch.object(r,'backup_module',return_value=b),patch.object(r,'sql',return_value='0') as sql,patch.object(r,'inventory',return_value=manifest['counts']),patch.object(r.os,'chown'),patch.object(b,'compose',return_value=b''),patch.object(r.urllib.request,'urlopen') as http:
                http.return_value.__enter__.return_value=io.BytesIO(b'{"status":"ok"}')
                result=r.restore_snapshot('a'*32,str(archive),str(key))
                self.assertEqual(result['counts'],manifest['counts']);sql.assert_any_call(None,data=files['database.sql'])
                self.assertEqual(json.loads((root/'runtime-config/school-state.json').read_text())['state'],'suspended')
                self.assertEqual((root/'runtime-config/account-key').read_bytes(),files['account-key'])
                self.assertIn('fresh-target-secret',(root/'.env').read_text());self.assertEqual((root/'approved-source.txt').read_text(),'new approved source')
            with patch.object(r,'ROOT',root),patch.object(r,'backup_module',return_value=b),patch.object(r,'sql',return_value='1'),patch.object(r,'write_private') as write:
                with self.assertRaisesRegex(ValueError,'never overwrite'):r.restore_snapshot('a'*32,str(archive),str(key))
                write.assert_not_called()
if __name__=='__main__':unittest.main()
