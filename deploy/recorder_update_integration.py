"""Disposable Docker orchestration test: replace/rollback a worker without losing its spool.

The stand-in process deliberately does not contact SFU, R2, SMTP or the application DB.
"""
import importlib.util,json,os,shutil,tempfile,uuid
from pathlib import Path

if os.environ.get('MEET_DISPOSABLE_BACKUP_TEST')!='true':raise SystemExit('Disposable stack opt-in required')
source=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('update',source/'deploy/update.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
if u.run('docker','ps','--all','--quiet','--filter','label=com.docker.compose.project=meet-recorder').strip():raise SystemExit('Recorder already installed: refusing to touch it')

with tempfile.TemporaryDirectory(prefix='meet-recorder-upgrade-') as tmp:
    root=Path(tmp);u.ROOT=root/'app';u.STATE=root/'state';u.STATE.mkdir();(u.ROOT/'deploy').mkdir(parents=True)
    shutil.copy2(source/'deploy/recorder.compose.yaml',u.ROOT/'deploy/recorder.compose.yaml')
    shutil.copy2(source/'.env',u.ROOT/'.env');shutil.copytree(source/'secrets',u.ROOT/'secrets');(u.ROOT/'runtime-config').mkdir()
    def build(tag,token,broken=False):
        folder=root/token;folder.mkdir()
        (folder/'Dockerfile').write_text('FROM meet-web:local\nUSER root\nRUN mkdir -p /var/lib/meet-recorder && chown 10001:10001 /var/lib/meet-recorder && echo '+token+' >/recorder-test-token\nUSER 10001:10001\nENTRYPOINT ["/bin/sh","-c"]\nCMD ["'+('exit 1' if broken else 'while :; do sleep 5; done')+'"]\n')
        u.run('docker','build','-t',tag,str(folder),timeout=120)
        return u.run('docker','image','inspect','--format','{{.Id}}',tag).decode().strip()
    target='a'*40;bad_target='b'*40
    old=build('meet-recorder:orchestration-old','old')
    new=build('meet-recorder:'+target,'new')
    build('meet-recorder:'+bad_target,'broken',True)
    plan={'old_image':old,'target_image':'meet-recorder:'+target,'concurrency':'2'}
    job={'id':str(uuid.uuid4()),'recorder_upgrade':plan}
    command=['docker','compose','--project-name','meet-recorder','--env-file',str(u.ROOT/'.env'),'-f',str(u.ROOT/'deploy/recorder.compose.yaml'),'-f',str(u.STATE/'recorder.images.json')]
    try:
        u.activate_recorder(job,old)
        found=u.recorder_plan(target);assert found['old_image']==old and found['concurrency']=='2',found
        identity=found['container']
        u.run('docker','exec',identity,'sh','-c','echo durable-spool >/var/lib/meet-recorder/probe')
        mounts=json.loads(u.run('docker','inspect',identity))[0]['Mounts'];spool=next(m['Name'] for m in mounts if m['Destination']=='/var/lib/meet-recorder')
        u.pause_recorders(job);u.activate_recorder(job,plan['target_image'])
        active=u.recorder_plan(target)['container']
        assert u.run('docker','exec',active,'cat','/recorder-test-token').strip()==b'new'
        assert u.run('docker','exec',active,'cat','/var/lib/meet-recorder/probe').strip()==b'durable-spool'
        assert next(m['Name'] for m in json.loads(u.run('docker','inspect',active))[0]['Mounts'] if m['Destination']=='/var/lib/meet-recorder')==spool
        print('Recorder image changed; concurrency and existing spool were preserved')
        job['recorder_upgrade']['target_image']='meet-recorder:'+bad_target
        try:
            u.activate_recorder(job,job['recorder_upgrade']['target_image'])
            raise AssertionError('Broken worker passed readiness')
        except ValueError as error:assert 'runtime health' in str(error),error
        u.activate_recorder(job,old,start=False)
        restored=job['recorders'][0]
        assert not json.loads(u.run('docker','inspect',restored))[0]['State']['Running']
        # This is exactly the legacy updater's recovery operation after source rollback.
        u.run('docker','start',*job['recorders'])
        assert u.run('docker','exec',restored,'cat','/recorder-test-token').strip()==b'old'
        assert u.run('docker','exec',restored,'cat','/var/lib/meet-recorder/probe').strip()==b'durable-spool'
        print('Crashed replacement rejected; legacy-compatible rollback restored the old worker and spool')
    finally:
        u.run(*command,'down','--volumes',timeout=150)
