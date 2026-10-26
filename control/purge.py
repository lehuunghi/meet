"""Permanent removal worker. A trashed row survives until remote deletion is confirmed."""
import json,re,time,shutil
from pathlib import Path

def perform(c,job,payload):
 from relocation import connect
 client=connect(payload['ip'],payload['ssh'])
 try:
  source=Path(__file__).with_name('purge_remote.py').read_text();import shlex
  stdin,stdout,stderr=client.exec_command('python3 -c '+shlex.quote(source),timeout=1200)
  identity={k:payload[k] for k in ('school','domain','origin','slug')};stdin.write(json.dumps(identity));stdin.channel.shutdown_write();channel=stdout.channel;deadline=time.monotonic()+1200;pending=b'';result=None
  while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
   if channel.recv_ready():
    pending=(pending+channel.recv(65536))[-131072:];lines=pending.split(b'\n');pending=lines.pop()
    for line in lines:
     match=re.fullmatch(rb'MEET_PURGE:(purge_verified|purge_storage|purge_files|purge_complete)',line.strip())
     if match:
      with c.connect() as db:c.progress(db,job['id'],match[1].decode())
     elif line.startswith(b'{'):
      try:result=json.loads(line)
      except ValueError:pass
   if channel.recv_stderr_ready():channel.recv_stderr(65536)
   if time.monotonic()>deadline:raise ValueError('PURGE_TIMEOUT')
   time.sleep(.05)
  if channel.recv_exit_status()!=0 or not isinstance(result,dict) or not result.get('purged'):
   code=result.get('code','PURGE_FAILED') if isinstance(result,dict) else 'PURGE_FAILED'
   allowed={'PURGE_WRONG_VPS','PURGE_NOT_SUSPENDED','PURGE_LIVE_MEETINGS','PURGE_UNOWNED_CONTAINER','PURGE_UNOWNED_VOLUME','PURGE_UNSAFE_PATH','PURGE_WRONG_DATABASE','PURGE_CUSTOM_PROXY','PURGE_SERVICE_BUSY','PURGE_STORAGE_REMAINS','PURGE_FILES_REMAIN','PURGE_COMMAND_FAILED'}
   raise ValueError(code if code in allowed else 'PURGE_FAILED')
  return 'PURGED'
 finally:client.close()

def finalize(c,job):
 sid=job['school']
 with c.connect() as db:
  db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT desired_state FROM schools WHERE id=?',(sid,)).fetchone()
  if not row or row['desired_state']!='deleted':raise ValueError('PURGE_STATE_CHANGED')
  for group in ['portable-backups','portable-recovery']:
   path=c.ROOT/group/sid
   if path.is_symlink() or (c.ROOT/group).is_symlink() or not path.resolve().is_relative_to(c.ROOT.resolve()):raise ValueError('PURGE_CENTRAL_CLEANUP')
   if path.exists():shutil.rmtree(path)
  c.progress(db,job['id'],'done');events=c.job_progress(db,job['id'])
  db.execute("UPDATE purge_receipts SET state='success',code='PURGED',progress=?,updated=? WHERE id=?",(json.dumps(events),int(time.time()),job['id']))
  db.execute('DELETE FROM job_events WHERE job IN (SELECT id FROM jobs WHERE school=?)',(sid,))
  for table in ['school_keys','relocations','jobs']:db.execute('DELETE FROM '+table+' WHERE school=?',(sid,))
  db.execute('DELETE FROM schools WHERE id=?',(sid,));c.audit(db,'purge-worker','school.purged',sid)
