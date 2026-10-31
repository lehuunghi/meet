import sys,tarfile,posixpath
from pathlib import Path
archive,destination=sys.argv[1:]
with tarfile.open(archive) as package:
 total=0
 for item in package:
  name=item.name;total+=item.size
  if total>4*1024**3 or name.startswith('/') or '..' in name.split('/') or name.split('/')[0]!='meet-recorder-linux-x64' or not (item.isfile() or item.isdir() or item.issym() or item.islnk()):raise SystemExit('Invalid payload')
  if item.issym() or item.islnk():
   target=posixpath.normpath(posixpath.join(posixpath.dirname(name) if item.issym() else '',item.linkname))
   if target.startswith('/') or not target.startswith('meet-recorder-linux-x64/'):raise SystemExit('Invalid link')
 package.extractall(destination,filter='data')
