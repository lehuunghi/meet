"""Full installation on an isolated GitHub Ubuntu runner, never production."""
import http.server,json,os,pty,select,signal,ssl,subprocess,sys,tempfile,threading,time
from pathlib import Path
if os.geteuid()!=0 or os.environ.get('MEET_DISPOSABLE_INSTALL_TEST')!='1':raise SystemExit('Disposable CI root only')
if Path('/opt/meet-recorder-agent').exists():raise SystemExit('Refuse an existing installation')
source=Path(sys.argv[1]).resolve();claims=[];enrollments=[]
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
class API(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/api/recorder-agent/enroll':
   assert data['Code']=='c'*64;enrollments.append(data);result={'id':'d'*32,'token':'e'*64};status=201
  elif self.path=='/api/recorder-agent/claim':
   assert self.headers['Authorization']=='Bearer '+'e'*64;claims.append(data);result={'job':None,'capacity':1};status=200
  else:result={'error':'TEST_ROUTE_NOT_FOUND'};status=404
  raw=json.dumps(result).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
with tempfile.TemporaryDirectory(prefix='meet-install-test-') as temporary:
 private=Path(temporary);private.chmod(0o700)
 cert=Path('/etc/meet-recorder-install-test-ca.crt');key=private/'key.pem'
 run('openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 cert.chmod(0o644)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),API);context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key);server.socket=context.wrap_socket(server.socket,server_side=True)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 origin='https://127.0.0.1:'+str(server.server_port)
 dropin=Path('/etc/systemd/system/meet-recorder-agent.service.d');dropin.mkdir(parents=True)
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
  print('FULL_LINUX_INSTALL_OK: AppArmor enabled, service account capture, enrollment, HTTPS heartbeat, hardened service capture and restart',flush=True)
 finally:
  subprocess.run(['systemctl','stop','meet-recorder-agent'],check=False)
  if previous is not None:run('sysctl','-w','kernel.apparmor_restrict_unprivileged_userns='+previous)
  server.shutdown();server.server_close()
