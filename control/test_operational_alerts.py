import unittest,json
from server import operational_alerts

class OperationalAlerts(unittest.TestCase):
    def row(self,**status):return {'desired_state':'active','seen':990,'status':json.dumps(status)}
    def test_current_verified_backup_is_healthy(self):
        self.assertEqual(operational_alerts(self.row(backup={'verified':True,'timestamp':990},disk_free=10*1024**3),{'backup':{'enabled':True,'interval_hours':24}},1000),[])
    def test_missing_backup_and_offline_host_are_visible(self):
        row=self.row(backup={},disk_free=1024);row['seen']=1
        self.assertEqual({x['code'] for x in operational_alerts(row,{'backup':{'enabled':True}},1000)},{'AGENT_OFFLINE','BACKUP_OVERDUE','DISK_LOW'})
    def test_old_backup_does_not_hide_behind_a_recent_agent_poll(self):
        self.assertIn('BACKUP_OVERDUE',[x['code'] for x in operational_alerts(self.row(backup={'verified':True,'timestamp':1}),{'backup':{'enabled':True,'interval_hours':1}},20000)])
    def test_unexpected_nested_telemetry_does_not_break_school_list(self):
        self.assertTrue(operational_alerts(self.row(backup='bad',update='bad'),{'backup':{'enabled':True}},1000))
    def test_trashed_tenant_does_not_raise_operational_alerts(self):
        row=self.row();row['desired_state']='deleted';self.assertEqual(operational_alerts(row,{'backup':{'enabled':True}},1000),[])

if __name__=='__main__':unittest.main()
