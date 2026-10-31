"""Full installation on an isolated GitHub Ubuntu runner, never production."""
import http.server,json,os,pty,select,signal,ssl,subprocess,sys,tempfile,threading,time,hashlib,tarfile,io,shutil
from pathlib import Path
if os.geteuid()!=0 or os.environ.get('MEET_DISPOSABLE_INSTALL_TEST')!='1':raise SystemExit('Disposable CI root only')
if Path('/opt/meet-recorder-agent').exists():raise SystemExit('Refuse an existing installation')
source=Path(sys.argv[1]).resolve();claims=[];enrollments=[];update_plan=None;update_results=[];update_archive=None
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
class API(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path!='/payload' or update_archive is None:self.send_error(404);return
  assert self.headers.get('Authorization') is None
  self.send_response(200);self.send_header('Content-Length',str(update_archive.stat().st_size));self.end_headers()
  with open(update_archive,'rb') as incoming:shutil.copyfileobj(incoming,self.wfile,1024*1024)
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/api/recorder-agent/enroll':
   assert data['Code']=='c'*64;enrollments.append(data);result={'id':'d'*32,'token':'e'*64};status=201
  elif self.path=='/api/recorder-agent/update-plan':
   assert self.headers['Authorization']=='Bearer '+'e'*64;result={'plan':update_plan};status=200
  elif self.path=='/api/recorder-agent/update-result':
   assert self.headers['Authorization']=='Bearer '+'e'*64;update_results.append(data);result={'ok':True};status=200
  elif self.path=='/api/recorder-agent/claim':
   assert self.headers['Authorization']=='Bearer '+'e'*64;claims.append(data);result={'job':None,'capacity':1};status=200
  else:result={'error':'TEST_ROUTE_NOT_FOUND'};status=404
  raw=json.dumps(result).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
with tempfile.TemporaryDirectory(prefix='meet-install-test-') as temporary:
 private=Path(temporary);private.chmod(0o700)
 cert=Path('/etc/meet-recorder-install-test-ca.crt');key=private/'key.pem'
 run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:release-assets.githubusercontent.com',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 cert.chmod(0o644)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),API);context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key);server.socket=context.wrap_socket(server.socket,server_side=True)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 origin='https://127.0.0.1:'+str(server.server_port)
 dropin=Path('/etc/systemd/system/meet-recorder-agent.service.d');dropin.mkdir(parents=True)
 updater_dropin=Path('/etc/systemd/system/meet-recorder-updater.service.d');updater_dropin.mkdir(parents=True)
 (updater_dropin/'test-ca.conf').write_text('[Service]\nEnvironment=NODE_EXTRA_CA_CERTS='+str(cert)+'\n')
 (dropin/'test-ca.conf').write_text('[Service]\nEnvironment=NODE_EXTRA_CA_CERTS='+str(cert)+'\n')
 # The packaged install must work with Ubuntu's user namespace restriction enabled.
 restriction=Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns');previous=restriction.read_text().strip() if restriction.exists() else None
 try:
  if previous is not None:run('sysctl','-w','kernel.apparmor_restrict_unprivileged_userns=1')
  pid,fd=pty.fork()
  if pid==0:
   os.chdir(private);os.umask(0o077)
   os.execvpe('bash',['bash',str(source/'install-linux.sh')],{**os.environ,'MEET_ORIGIN':origin,'NODE_EXTRA_CA_CERTS':str(cert),'DEBIAN_FRONTEND':'noninteractive'})
  output=b'';sent=False;deadline=time.monotonic()+420;status=None
  try:
   while time.monotonic()<deadline:
    ready,_,_=select.select([fd],[],[],0.25)
    if ready:
     try:chunk=os.read(fd,65536)
     except OSError:chunk=b''
     if chunk:
      sys.stdout.buffer.write(chunk);sys.stdout.buffer.flush();output=(output+chunk)[-65536:]
      if not sent and 'Mã đăng ký máy dùng một lần:'.encode() in output:os.write(fd,b'c'*64+b'\n');sent=True
    result=os.waitpid(pid,os.WNOHANG)
    if result[0]:status=os.waitstatus_to_exitcode(result[1]);break
   if status is None:os.kill(pid,signal.SIGTERM);os.waitpid(pid,0);raise TimeoutError('Installer did not finish')
   assert status==0,('Installer failed',status)
  finally:os.close(fd)
  assert sent and len(enrollments)==1
  deadline=time.monotonic()+30
  while not claims and time.monotonic()<deadline:time.sleep(0.25)
  assert claims,'Installed service did not authenticate to fixture HTTPS'
  run('systemctl','is-active','--quiet','meet-recorder-agent')
  # Verify video capture under the actual service filesystem and privilege restrictions.
  run('systemd-run','--unit=meet-recorder-install-probe','--wait','--pipe','--collect','-p','User=meet-recorder','-p','Group=meet-recorder','-p','NoNewPrivileges=true','-p','PrivateTmp=true','-p','ProtectHome=true','-p','ProtectSystem=strict','-p','ReadWritePaths=/var/lib/meet-recorder-agent','-p','WorkingDirectory=/opt/meet-recorder-agent','-p','Environment=HOME=/var/lib/meet-recorder-agent','-p','Environment=MEET_AGENT_DATA=/var/lib/meet-recorder-agent','/opt/meet-recorder-agent/runtime/node','/opt/meet-recorder-agent/agent.mjs','--self-test')
  identity=Path('/var/lib/meet-recorder-agent/identity.json');assert identity.stat().st_mode&0o077==0
  run('systemctl','restart','meet-recorder-agent');time.sleep(2);run('systemctl','is-active','--quiet','meet-recorder-agent')
  assert json.loads(identity.read_text())['token']=='e'*64
  run('systemctl','stop','meet-recorder-updater.timer')
  update_archive=private/'update.tar.gz'
  with tarfile.open(update_archive,'w:gz',compresslevel=1) as archive:
   for child in source.iterdir():
    if child.name=='package.json':
     package=json.loads(child.read_text());package['version']='0.5.1';raw=json.dumps(package).encode();entry=tarfile.TarInfo('meet-recorder-linux-x64/package.json');entry.size=len(raw);entry.mode=0o644;archive.addfile(entry,io.BytesIO(raw))
    else:archive.add(child,arcname='meet-recorder-linux-x64/'+child.name)
  digest=hashlib.sha256()
  with open(update_archive,'rb') as stream:
   for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
  hosts=Path('/etc/hosts');original_hosts=hosts.read_text()
  sentinel=Path('/var/lib/meet-recorder-agent/update-preserved.txt');sentinel.write_text('keep recording data')
  try:
   hosts.write_text(original_hosts+'\n127.0.0.1 release-assets.githubusercontent.com\n')
   update_plan={'id':'f'*32,'version':'0.5.1','protocol':1,'asset':'meet-recorder-linux-x64.tar.gz','url':'https://release-assets.githubusercontent.com:'+str(server.server_port)+'/payload','sha256':digest.hexdigest()}
   run('systemctl','start','meet-recorder-updater.service')
   assert update_results and update_results[-1]['ok'] is True
   assert json.loads(Path('/opt/meet-recorder-agent/package.json').read_text())['version']=='0.5.1'
   assert sentinel.read_text()=='keep recording data'
   assert Path('/opt/meet-recorder-updater/trusted.json').stat().st_mode&0o077==0
   run('systemctl','is-active','--quiet','meet-recorder-agent')
  finally:hosts.write_text(original_hosts)
  print('FULL_LINUX_INSTALL_OK: AppArmor enabled, service account capture, enrollment, HTTPS heartbeat, hardened service capture, restart and verified idle software update preserving identity/data',flush=True)
 finally:
  subprocess.run(['systemctl','stop','meet-recorder-agent','meet-recorder-updater.timer','meet-recorder-updater.service'],check=False)
  if previous is not None:run('sysctl','-w','kernel.apparmor_restrict_unprivileged_userns='+previous)
  server.shutdown();server.server_close()
