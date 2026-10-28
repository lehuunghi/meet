import importlib.util
import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update', Path(__file__).with_name('update.py'))
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)

class UpdaterTests(unittest.TestCase):
    def test_requires_latest_complete_ci_and_all_required_jobs(self):
        run = {'id': 10, 'head_sha': 'a' * 40, 'head_branch': u.BRANCH, 'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'success'}
        jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in ['api', 'web', 'containers', 'control', 'recorder']]
        with patch.object(u, 'github', side_effect=[{'workflow_runs': [run]}, {'jobs': jobs}]):
            self.assertTrue(u.ci_passed('a' * 40))
        for bad in ['failure', 'skipped', None]:
            jobs[0]['conclusion'] = bad
            with patch.object(u, 'github', side_effect=[{'workflow_runs': [run]}, {'jobs': jobs}]):
                self.assertFalse(u.ci_passed('a' * 40))
        failed = {**run, 'id': 11, 'conclusion': 'failure'}
        with patch.object(u, 'github', return_value={'workflow_runs': [run, failed]}):
            self.assertFalse(u.ci_passed('a' * 40))

    def test_rejects_dirty_checkout_and_foreign_origin(self):
        with patch.object(u, 'git', side_effect=['https://example.test/attacker.git']):
            with self.assertRaises(ValueError): u.checkout_safe()
        with patch.object(u, 'git', side_effect=[u.REPO, u.BRANCH, ' M apps/api/main.go']):
            with self.assertRaises(ValueError): u.checkout_safe()

    def test_live_lesson_blocks_update_before_any_snapshot_or_stop(self):
        with patch.object(u, 'candidate', return_value={'available_sha': 'a'*40, 'can_update': True}), patch.object(u, 'sql', return_value='1'), patch.object(u, 'compose') as compose, patch.object(u, 'snapshot') as snapshot:
            with self.assertRaisesRegex(ValueError, 'lớp đang học'): u.apply('a'*40, 'test')
            compose.assert_not_called(); snapshot.assert_not_called()

    def test_unapproved_target_never_stops_application(self):
        with patch.object(u, 'candidate', return_value={'available_sha': 'a'*40, 'can_update': False}), patch.object(u, 'compose') as compose:
            with self.assertRaises(ValueError): u.apply('a'*40, 'test')
            compose.assert_not_called()

    def test_mismatched_running_image_blocks_update_before_stop(self):
        checked={'available_sha':'a'*40,'current_sha':'b'*40,'can_update':True}
        response=io.BytesIO(json.dumps({'status':'ok','commit':'c'*40}).encode())
        with patch.object(u,'candidate',return_value=checked),patch.object(u,'sql',return_value='0'),patch.object(u.urllib.request,'urlopen',return_value=response),patch.object(u,'compose') as compose:
            with self.assertRaisesRegex(ValueError,'Running image'):u.apply('a'*40,'test')
            compose.assert_not_called()

    def test_recovery_preserves_unrelated_checkout_changes(self):
        job={'old_sha':'a'*40,'target':'b'*40,'db_dirty':True,'snapshot':'unused'}
        with patch.object(u,'publish'),patch.object(u,'compose'),patch.object(u,'git',return_value='c'*40) as git,patch.object(u,'sql') as sql:
            with self.assertRaisesRegex(ValueError,'Checkout changed'):u.recover(job,None)
            sql.assert_not_called();self.assertEqual(git.call_count,1)

    def test_committed_crash_only_finishes_unlock_without_restoring_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'runtime-config').mkdir(); (root/'runtime-config/maintenance').write_text('pending')
            journal={'active': False, 'committed': True, 'result': 'success', 'target': 'a'*40}
            state=root/'state';state.mkdir();(state/'journal.json').write_text(json.dumps(journal))
            with patch.object(u,'ROOT',root),patch.object(u,'STATE',state),patch.object(u,'health') as health,patch.object(u,'recover') as recover,patch.object(u,'publish'),patch.object(u.os,'O_NOFOLLOW',0,create=True):
                u.worker();health.assert_called_once_with('a'*40);recover.assert_not_called()
            self.assertFalse((root/'runtime-config/maintenance').exists())

    def test_recorder_is_journaled_before_stop_and_only_saved_ids_are_resumed(self):
        job={}; container='a'*64
        def save(value, **fields): value.update(fields)
        with patch.object(u,'checkpoint',side_effect=save),patch.object(u,'run',side_effect=[(container+'\n').encode(),b'',b'']) as run:
            u.pause_recorders(job)
            self.assertEqual(job['recorders'],[container])
            self.assertEqual(run.call_args_list[1].args,('docker','stop','--time','120',container))
            u.resume_recorders(job)
            self.assertEqual(job['recorders'],[])
        with patch.object(u,'run') as run:
            with self.assertRaisesRegex(ValueError,'identity'):u.resume_recorders({'recorders':['--all']})
            run.assert_not_called()

    def test_committed_crash_after_unlock_still_resumes_recorders(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'runtime-config').mkdir();state=root/'state';state.mkdir()
            journal={'active':False,'committed':True,'result':'success','recorders':['a'*64]}
            (state/'journal.json').write_text(json.dumps(journal))
            with patch.object(u,'ROOT',root),patch.object(u,'STATE',state),patch.object(u,'resume_recorders') as resume,patch.object(u,'publish'),patch.object(u.os,'O_NOFOLLOW',0,create=True):
                u.worker();resume.assert_called_once()

    def test_recorder_plan_accepts_only_standard_managed_configuration(self):
        identity='a'*64
        meta={'Image':'sha256:'+'b'*64,'Config':{'Env':['RECORDER_CONCURRENCY=2'],'Labels':{'com.docker.compose.project.working_dir':str(u.ROOT/'deploy'),'com.docker.compose.project.config_files':str(u.ROOT/'deploy/recorder.compose.yaml')+','+str(u.STATE/'recorder.images.json')}}}
        with patch.object(u,'run',side_effect=[identity.encode(),json.dumps([meta]).encode()]):
            plan=u.recorder_plan('c'*40)
            self.assertEqual(plan['concurrency'],'2');self.assertEqual(plan['old_image'],meta['Image'])
        meta['Config']['Labels']['com.docker.compose.project.config_files']='/custom/recorder.yaml'
        with patch.object(u,'run',side_effect=[identity.encode(),json.dumps([meta]).encode()]):
            with self.assertRaisesRegex(ValueError,'Custom recorder'):u.recorder_plan('c'*40)

    def test_recorder_config_drift_is_rejected_before_replacement(self):
        old={'services':{'recorder':{'image':'old','volumes':['spool:/recordings']}}}
        new={'services':{'recorder':{'image':'new','volumes':['empty:/recordings']}}}
        with patch.object(u,'run',side_effect=[json.dumps(old).encode(),json.dumps(new).encode()]):
            with self.assertRaisesRegex(ValueError,'volumes/network'):u.check_recorder_config(Path('/stage'))

    def test_rollback_recorder_is_created_stopped_and_journaled_for_legacy_recovery(self):
        plan={'old_image':'sha256:'+'b'*64,'target_image':'meet-recorder:'+'c'*40,'concurrency':'2'}
        job={'recorder_upgrade':plan,'recorders':['a'*64]};identity='d'*64
        def save(value,**fields):value.update(fields)
        with tempfile.TemporaryDirectory() as tmp,patch.object(u,'STATE',Path(tmp)),patch.object(u,'checkpoint',side_effect=save),patch.object(u,'run',side_effect=[b'',identity.encode()]) as run:
            u.activate_recorder(job,plan['old_image'],start=False)
            self.assertIn('--no-start',run.call_args_list[0].args)
            self.assertEqual(job['recorders'],[identity]);self.assertFalse(job['recorder_changed'])

    def test_recorder_crash_prevents_commit_and_keeps_recovery_intent(self):
        plan={'old_image':'sha256:'+'b'*64,'target_image':'meet-recorder:'+'c'*40,'concurrency':'1'}
        job={'recorder_upgrade':plan}
        def save(value,**fields):value.update(fields)
        with tempfile.TemporaryDirectory() as tmp,patch.object(u,'STATE',Path(tmp)),patch.object(u,'checkpoint',side_effect=save),patch.object(u,'run',side_effect=[b'',('d'*64).encode(),json.dumps([{'State':{'Running':False},'RestartCount':1}]).encode()]):
            with self.assertRaisesRegex(ValueError,'runtime health'):u.activate_recorder(job,plan['target_image'])
            self.assertTrue(job['recorder_changed'])

    def test_interrupted_recorder_resume_uses_result_to_pick_the_correct_image(self):
        plan={'old_image':'sha256:'+'b'*64,'target_image':'meet-recorder:'+'c'*40,'concurrency':'1'}
        for result,want in [('success',plan['target_image']),('rolled_back',plan['old_image'])]:
            job={'committed':True,'result':result,'recorders':['a'*64],'recorder_upgrade':plan}
            with patch.object(u,'activate_recorder') as activate:
                u.resume_recorders(job);activate.assert_called_once_with(job,want)

if __name__ == '__main__': unittest.main()
