"""Meet control plane. Run behind HTTPS; SQLite is local to one control-plane node."""
import struct, sys, base64, contextlib, hashlib, hmac, ipaddress, json, os, re, secrets, sqlite3, ssl, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT=Path(os.environ.get('MEET_CONTROL_DATA','/var/lib/meet-control'))
ORIGIN=os.environ.get('MEET_CONTROL_ORIGIN','https://admin.tn.edu.vn').rstrip('/')
HOST=re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}')
ACTIONS={'configure','check','update','backup','domain','accounts','provision','academy','lifecycle','relocate'}

class ClosingConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()

def connect():
    db=sqlite3.connect(ROOT/'control.db',timeout=30,factory=ClosingConnection);db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA journal_mode=WAL');return db

def init():
    ROOT.mkdir(parents=True,exist_ok=True);os.chmod(ROOT,0o700)
    key=ROOT/'vault.key'
    if not key.exists():
        fd=os.open(key,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as f:f.write(secrets.token_bytes(32))
    if len(key.read_bytes())!=32:raise ValueError('Invalid vault key')
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,admin TEXT NOT NULL REFERENCES admins(id),expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,n INTEGER NOT NULL,until INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS schools(id TEXT PRIMARY KEY,name TEXT NOT NULL,domain TEXT UNIQUE NOT NULL,ip TEXT NOT NULL,config TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,applied INTEGER NOT NULL DEFAULT 0,agent_hash TEXT UNIQUE,enroll_hash TEXT,enroll_expires INTEGER,seen INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,school TEXT NOT NULL REFERENCES schools(id),action TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'queued',lease TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,result TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS mfa_challenges(hash TEXT PRIMARY KEY,admin TEXT NOT NULL REFERENCES admins(id),expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS mfa_pending(admin TEXT PRIMARY KEY REFERENCES admins(id),secret TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS mfa_recovery(admin TEXT NOT NULL REFERENCES admins(id),hash TEXT NOT NULL,PRIMARY KEY(admin,hash));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS school_keys(id TEXT PRIMARY KEY,school TEXT NOT NULL REFERENCES schools(id),issuer TEXT NOT NULL REFERENCES admins(id),label TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS relocations(id TEXT PRIMARY KEY,school TEXT NOT NULL REFERENCES schools(id),state TEXT NOT NULL,details TEXT NOT NULL,created INTEGER NOT NULL);
        ''')
        school_columns={r['name'] for r in db.execute('PRAGMA table_info(schools)')}
        for name in ('desired_state','applied_state'):
            if name not in school_columns:db.execute("ALTER TABLE schools ADD COLUMN "+name+" TEXT NOT NULL DEFAULT 'active'")
        columns={r['name'] for r in db.execute('PRAGMA table_info(admins)')}
        if 'mfa' not in columns:db.execute('ALTER TABLE admins ADD COLUMN mfa TEXT')
        if 'last_step' not in columns:db.execute('ALTER TABLE admins ADD COLUMN last_step INTEGER NOT NULL DEFAULT 0')
        if not db.execute('SELECT 1 FROM admins').fetchone():
            password=Path(os.environ['MEET_CONTROL_PASSWORD_FILE']).read_text().strip()
            if not 12<=len(password.encode())<=72:raise ValueError('Initial password must have 12–72 bytes')
            db.execute('INSERT INTO admins(id,email,hash,role,active) VALUES(?,?,?,?,1)',(secrets.token_hex(16),os.environ['MEET_CONTROL_EMAIL'].lower(),password_hash(password),'owner'))
            Path(os.environ['MEET_CONTROL_PASSWORD_FILE']).unlink(missing_ok=True)

def password_hash(password,salt=None):
    salt=salt or secrets.token_hex(16)
    return salt+':'+hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()

def digest(value):return hashlib.sha256(value.encode()).hexdigest()

def sync_status(db,row):
    """Expose acknowledgement state, never credentials or raw command errors."""
    job=db.execute("SELECT id,state,result FROM jobs WHERE school=? AND action='configure' AND revision=? ORDER BY rowid DESC LIMIT 1",(row['id'],row['revision'])).fetchone()
    state='applied' if row['applied']==row['revision'] else 'pending'
    code=''
    if state!='applied' and job:
        state=job['state']
        candidate=json.loads(job['result']).get('code','')
        allowed={'LIVE_MEETINGS','APPLY_FAILED','CONFIG_R2_REJECTED','CONFIG_REJECTED','CONFIG_SCHOOL_MISMATCH','CONFIG_DATABASE_UNAVAILABLE','REMOTE_TIMEOUT','ACCOUNT_REJECTED','ACCOUNT_CONFLICT'}
        code=candidate if isinstance(candidate,str) and candidate in allowed else ''
    return {'linked':bool(row['agent_hash']),'online':bool(row['seen'] and int(time.time())-row['seen']<90),'state':state,'code':code,'job_id':job['id'] if job else None,'revision':row['revision'],'applied':row['applied']}
def encrypt(value,scope):
    nonce=secrets.token_bytes(12)
    return base64.b64encode(nonce+AESGCM((ROOT/'vault.key').read_bytes()).encrypt(nonce,json.dumps(value,ensure_ascii=False).encode(),scope.encode())).decode()
def decrypt(value,scope):
    raw=base64.b64decode(value);return json.loads(AESGCM((ROOT/'vault.key').read_bytes()).decrypt(raw[:12],raw[12:],scope.encode()))
def audit(db,actor,action,target):db.execute('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)',(int(time.time()),actor,action,target))
def limited(db,key,maximum,seconds):
    now=int(time.time());db.execute('DELETE FROM attempts WHERE until<?',(now,))
    db.execute('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1',(key,now+seconds))
    return db.execute('SELECT n FROM attempts WHERE key=?',(key,)).fetchone()[0]>maximum

def validate_config(value):
    if not isinstance(value,dict):raise ValueError('Cấu hình không hợp lệ')
    value['turn']=[] # Removed: old snapshots remain readable but no TURN keys are applied.
    if value.get('platform_mode','school') not in ('school','academy'):raise ValueError('Loại nền tảng không hợp lệ')
    if type(value.get('retention_days',30)) is not int or not 1<=value.get('retention_days',30)<=3650:raise ValueError('Thời hạn video phải từ 1 đến 3650 ngày')
    for name in ('sfu','turn'):
        if not isinstance(value.get(name,[]),list) or len(value.get(name,[]))>50:raise ValueError('Danh sách credential không hợp lệ')
        if any(not isinstance(x,dict) for x in value.get(name,[])):raise ValueError('Credential không hợp lệ')
    for item in value.get('sfu',[]):
        if not isinstance(item.get('weight',1),int) or not 1<=item.get('weight',1)<=100:raise ValueError('Trọng số SFU phải từ 1 đến 100')
    commerce=value.get('commerce',{})
    if not isinstance(commerce,dict):raise ValueError('Cấu hình kinh doanh không hợp lệ')
    if not isinstance(commerce.get('free_videos',4),int) or isinstance(commerce.get('free_videos'),bool) or not 1<=commerce.get('free_videos',4)<=100:raise ValueError('Hạn mức xem thử phải từ 1 đến 100 bài mỗi tháng')
    for key in ('bank_bin','bank_account','bank_name','client_id','api_key','checksum_key','smtp_address','smtp_from','smtp_user','smtp_password'):
        if not isinstance(commerce.get(key,''),str) or len(commerce.get(key,''))>1000:raise ValueError('Thông tin kinh doanh quá dài hoặc sai định dạng')
    for key in ('r2','backup','initial_admin'):
        if not isinstance(value.get(key,{}),dict):raise ValueError('Cấu hình '+key+' không hợp lệ')
    admin=value.get('initial_admin',{})
    if any(not isinstance(admin.get(k,''),str) for k in ('email','password')):raise ValueError('Quản trị khởi tạo không hợp lệ')
    if not isinstance(value.get('school_slug',''),str):raise ValueError('Mã nội bộ không hợp lệ')
    return value

def deployment_readiness(row,cfg):
    """Configuration-only preflight: never returns secrets or claims a live integration passed."""
    checks=[]
    def add(key,title,ok,detail,required=False):
        checks.append({'key':key,'title':title,'state':'ready' if ok else ('blocked' if required else 'optional'),'detail':detail})
    connected=bool(row['seen'] or row['agent_hash'])
    admin=cfg.get('initial_admin',{})
    email=admin.get('email','');password=admin.get('password','')
    add('admin','Quản trị đầu tiên',connected or (bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email)) and 12<=len(password.encode())<=72),'Tài khoản đã khởi tạo' if connected else 'Cần email và mật khẩu 12–72 byte; không hiện lại mật khẩu.',True)
    slug=cfg.get('school_slug','')
    add('slug','Mã nội bộ',not slug or bool(re.fullmatch('[a-z0-9-]{2,64}',slug)),'Để trống để hệ thống tự tạo; mã không xuất hiện ở đăng nhập.',True)
    add('host','Domain và VPS',bool(row['domain'] and row['ip']),'DNS sẽ được đối chiếu với IP trước khi cài qua SSH.',True)
    active=[v for v in cfg.get('sfu',[]) if v.get('enabled',True) and v.get('app_id') and v.get('secret') and int(v.get('weight',1))>0]
    add('sfu','Lớp Live / SFU',bool(active),str(len(active))+' SFU đã điền. Chưa kiểm tra cuộc gọi thật.' if active else 'Có thể cài trước; thêm SFU để mở lớp Live.')
    r2=cfg.get('r2',{});complete=all(r2.get(k) for k in ('account_id','bucket','access_key_id','secret_access_key'))
    add('r2','Video, ảnh và biên lai R2',bool(r2.get('enabled') and complete),'R2 đã điền; cần nghiệm thu tải lên/phát video.' if complete and r2.get('enabled') else 'Chưa bật hoặc thiếu cấu hình. Cần R2 để dùng kho video và ảnh.',bool(r2.get('enabled')))
    if cfg.get('platform_mode','school')=='academy':
        commerce=cfg.get('commerce',{})
        add('email','Đăng ký bằng mã email',bool(commerce.get('smtp_address') and commerce.get('smtp_from')),'Cấu hình SMTP STARTTLS; cần gửi thử email trước khi mở đăng ký.')
        add('bank','Chuyển khoản / QR',all(commerce.get(k) for k in ('bank_bin','bank_account','bank_name')),'Cần BIN ngân hàng, số tài khoản và tên người nhận để bán gói.')
        add('payos','Thanh toán tự động payOS',all(commerce.get(k) for k in ('client_id','api_key','checksum_key')),'Tùy chọn. Khi chưa có, quản trị đối soát và duyệt thủ công.')
    return {'platform_mode':cfg.get('platform_mode','school'),'can_install':row['desired_state']=='active' and not connected and not any(x['state']=='blocked' for x in checks),'connected':connected,'checks':checks,'notice':'Kiểm tra thông tin đã nhập; không thay thế nghiệm thu DNS/SSH/Cloudflare/thanh toán thật.'}

def redact(value):
    if isinstance(value,list):return [redact(v) for v in value]
    if isinstance(value,dict):return {k:('••••••••' if k in ('secret','secret_access_key','access_key_id','password','private_key','token','api_key','checksum_key','smtp_password') and v else redact(v)) for k,v in value.items()}
    return value

def merge_secrets(new,old):
    if new=='••••••••':return old
    if isinstance(new,dict):return {k:merge_secrets(v,old.get(k) if isinstance(old,dict) else None) for k,v in new.items()}
    if isinstance(new,list):
        prior={v.get('id'):v for v in old or [] if isinstance(v,dict)}
        return [merge_secrets(v,prior.get(v.get('id'),{})) if isinstance(v,dict) else v for v in new]
    return new

def queue(db,school,action,payload,revision):
    if action not in ACTIONS:raise ValueError('Thao tác không được hỗ trợ')
    key=secrets.token_hex(16)
    if action=='academy':payload={**payload,'request_id':key}
    db.execute('INSERT INTO jobs(id,school,action,payload,revision,created) VALUES(?,?,?,?,?,?)',(key,school,action,encrypt(payload,school),revision,int(time.time())))
    return key

def otp_step(secret,code):
    if not re.fullmatch('[0-9]{6}',code):return 0
    now=int(time.time())//30
    for step in (now-1,now,now+1):
        raw=hmac.new(base64.b32decode(secret),struct.pack('>Q',step),hashlib.sha1).digest();offset=raw[-1]&15
        expected=str((struct.unpack('>I',raw[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
        if hmac.compare_digest(expected,code):return step
    return 0

def verify_mfa(db,user,code):
    if not user['mfa']:return False
    step=otp_step(decrypt(user['mfa'],'admin:'+user['id']),code)
    if step and step>user['last_step']:
        db.execute('UPDATE admins SET last_step=? WHERE id=?',(step,user['id']));return True
    if re.fullmatch('[a-f0-9]{16}',code):return db.execute('DELETE FROM mfa_recovery WHERE admin=? AND hash=?',(user['id'],digest(code))).rowcount==1
    return False

class Handler(BaseHTTPRequestHandler):
    server_version='MeetControl'
    def log_message(self,*args):pass # Request bodies/cookies/tokens must never enter access logs.
    def reply(self,status,value):
        body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers();self.wfile.write(body)
    def do_GET(self):self.dispatch()
    def do_POST(self):self.dispatch()
    def do_PATCH(self):self.dispatch()
    def dispatch(self):
        try:
            if self.path=='/workspace.js' and self.command=='GET':
                body=Path(__file__).with_name('workspace.js').read_bytes();self.send_response(200);self.send_header('Content-Type','application/javascript; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body);return
            if self.path=='/' and self.command=='GET':
                body=Path(__file__).with_name('index.html').read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.r2.cloudflarestorage.com; connect-src 'self' https://*.r2.cloudflarestorage.com; media-src 'self' blob: https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'");self.end_headers();self.wfile.write(body);return
            if self.path=='/health' and self.command=='GET':self.reply(200,{'ok':True});return
            if self.command in ('POST','PATCH'):
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=262144:raise ValueError('Nội dung quá lớn hoặc rỗng')
                data=json.loads(self.rfile.read(n))
                if not isinstance(data,dict):raise ValueError('Yêu cầu không hợp lệ')
            else:data={}
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if self.path.startswith('/api/v1/'):
                    result=self.school_api(db,data)
                elif self.path.startswith('/agent/'):
                    result=self.agent(db,data)
                else:
                    if self.command=='PATCH':raise ValueError('PATCH chỉ dùng cho API tích hợp')
                    if self.command=='POST' and self.headers.get('Origin')!=ORIGIN:self.reply(403,{'error':'Origin rejected'});return
                    if self.path=='/api/login' and self.command=='POST':
                        key=digest(self.client_address[0]+str(data.get('email','')).lower())
                        if limited(db,key,20,300):db.commit();self.reply(429,{'error':'Thử lại sau 5 phút'});return
                        row=db.execute('SELECT * FROM admins WHERE email=? AND active=1',(str(data.get('email','')).lower(),)).fetchone()
                        supplied=password_hash(str(data.get('password','')),row['hash'].split(':')[0] if row else '00'*16)
                        if not row or not hmac.compare_digest(supplied,row['hash']):db.commit();self.reply(401,{'error':'Thông tin đăng nhập không đúng'});return
                        if row['mfa']:
                            token=secrets.token_urlsafe(48);now=int(time.time());db.execute('DELETE FROM mfa_challenges WHERE expires<?',(now,));db.execute('INSERT INTO mfa_challenges VALUES(?,?,?,0)',(digest(token),row['id'],now+180));db.commit();self.reply(202,{'requires_2fa':True,'challenge':token});return
                        self.start_session(db,row);return
                    if self.path=='/api/login/2fa' and self.command=='POST':
                        key=digest(str(data.get('challenge','')));challenge=db.execute('SELECT * FROM mfa_challenges WHERE hash=? AND expires>?',(key,int(time.time()))).fetchone()
                        if not challenge or challenge['attempts']>=5:self.reply(401,{'error':'Yêu cầu đã hết hạn. Đăng nhập lại.'});return
                        db.execute('UPDATE mfa_challenges SET attempts=attempts+1 WHERE hash=?',(key,))
                        user=db.execute('SELECT * FROM admins WHERE id=? AND active=1',(challenge['admin'],)).fetchone()
                        if not user or not verify_mfa(db,user,str(data.get('code',''))):db.commit();self.reply(401,{'error':'Mã xác thực không đúng hoặc đã dùng'});return
                        db.execute('DELETE FROM mfa_challenges WHERE hash=?',(key,));self.start_session(db,user);return
                    from http.cookies import SimpleCookie
                    cookies=SimpleCookie();cookies.load(self.headers.get('Cookie',''));token=cookies.get('control_session');token=token.value if token else ''
                    admin=db.execute('SELECT a.* FROM sessions s JOIN admins a ON a.id=s.admin WHERE s.hash=? AND s.expires>? AND a.active=1',(digest(token),int(time.time()))).fetchone()
                    if not admin:self.reply(401,{'error':'Đăng nhập quản trị trung tâm'});return
                    if self.command=='POST' and admin['role']=='viewer' and self.path not in ('/api/logout','/api/security'):self.reply(403,{'error':'Chỉ có quyền xem'});return
                    result=self.admin(db,admin,data)
                db.commit()
            self.reply(200,result)
        except PermissionError as e:self.reply(401,{'error':str(e)})
        except ValueError as e:self.reply(400,{'error':str(e)})
        except (sqlite3.IntegrityError,KeyError,TypeError):self.reply(409,{'error':'Dữ liệu bị trùng, thiếu hoặc không hợp lệ'})
        except Exception:self.reply(503,{'error':'Tác vụ chưa hoàn tất. Kiểm tra dịch vụ trung tâm.'})
    def start_session(self,db,row):
        token=secrets.token_urlsafe(48);db.execute('DELETE FROM sessions WHERE admin=?',(row['id'],));db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),row['id'],int(time.time())+3600));audit(db,row['id'],'login',row['id']);db.commit()
        self.send_response(200);self.send_header('Set-Cookie','control_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600');self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"ok":true}')
    def agent(self,db,data):
        if self.command!='POST':raise ValueError('POST required')
        now=int(time.time())
        if self.path=='/agent/enroll':
            row=db.execute('SELECT * FROM schools WHERE enroll_hash=? AND enroll_expires>?',(digest(str(data.get('token',''))),now)).fetchone()
            if not row:raise ValueError('Mã đăng ký hết hạn hoặc đã dùng')
            token=secrets.token_urlsafe(48);db.execute('UPDATE schools SET agent_hash=?,enroll_hash=NULL,enroll_expires=NULL WHERE id=?',(digest(token),row['id']));audit(db,'agent','enrolled',row['id']);return {'token':token,'school':row['id']}
        bearer=self.headers.get('Authorization','').removeprefix('Bearer ')
        row=db.execute('SELECT * FROM schools WHERE agent_hash=?',(digest(bearer),)).fetchone()
        if not row:raise PermissionError('Agent chưa đăng ký')
        sid=row['id'];status=data.get('status',{})
        # Only known, non-secret telemetry is retained.
        safe={k:status[k] for k in ('version','commit','live','disk_free','config_revision','backup','update','admins','platform_mode','features','school_state','control_protocol') if k in status}
        if self.path=='/agent/poll':db.execute('UPDATE schools SET seen=?,status=? WHERE id=?',(now,json.dumps(safe),sid))
        else:db.execute('UPDATE schools SET seen=? WHERE id=?',(now,sid))
        if self.path=='/agent/poll':
            if row['desired_state']=='deleted':return {'job':None}
            db.execute("UPDATE jobs SET state='failed',result=? WHERE school=? AND state='running' AND lease_until<? AND attempts>=5",(json.dumps({'error':'Agent không xác nhận sau 5 lượt'}),sid,now))
            job=db.execute("SELECT * FROM jobs WHERE school=? AND action NOT IN ('provision','relocate') AND ((state='queued' AND COALESCE(lease_until,0)<?) OR (state='running' AND lease_until<? AND attempts<5)) ORDER BY created,rowid LIMIT 1",(sid,now,now)).fetchone()
            if not job:return {'job':None}
            lease=secrets.token_urlsafe(32);db.execute("UPDATE jobs SET state='running',lease=?,lease_until=?,attempts=attempts+1 WHERE id=?",(digest(lease),now+1800,job['id']))
            return {'job':{'id':job['id'],'lease':lease,'action':job['action'],'revision':job['revision'],'payload':decrypt(job['payload'],sid)}}
        if self.path=='/agent/ack':
            job=db.execute("SELECT * FROM jobs WHERE id=? AND school=? AND state='running' AND lease=? AND lease_until>=?",(data.get('id'),sid,digest(str(data.get('lease',''))),now)).fetchone()
            if not job:raise ValueError('Tác vụ không còn hiệu lực')
            state=data.get('state')
            if state not in ('success','failed','waiting'):raise ValueError('Trạng thái không hợp lệ')
            # Error codes only: never accept raw stdout or credential-bearing payloads.
            result={'code':str(data.get('code',''))[:80]}
            if job['action']=='academy' and state=='success':
                if not isinstance(data.get('code'),dict) or len(json.dumps(data['code']))>524288:raise ValueError('Kết quả quá lớn')
                result={'code':'OK','payload':encrypt(data['code'],sid)}
            db.execute('UPDATE jobs SET state=?,result=?,lease=NULL,lease_until=? WHERE id=?',('queued' if state=='waiting' else state,json.dumps(result),now+60,job['id']))
            if state=='success' and job['action']=='configure':db.execute('UPDATE schools SET applied=MAX(applied,?) WHERE id=?',(job['revision'],sid))
            if state=='success' and job['action']=='lifecycle':db.execute('UPDATE schools SET applied_state=? WHERE id=?',(decrypt(job['payload'],sid)['state'],sid))
            if state=='success' and job['action']=='domain':
                payload=decrypt(job['payload'],sid);db.execute('UPDATE schools SET domain=?,revision=revision+1 WHERE id=?',(payload['domain'],sid))
                queue(db,sid,'configure',{'settings':decrypt(row['config'],sid),'name':row['name'],'domain':payload['domain']},row['revision']+1)
            audit(db,'agent',job['action']+'.'+state,sid);return {'ok':True}
        raise ValueError('Unknown endpoint')
    def school_api(self,db,data):
        match=re.fullmatch(r'/api/v1/schools/([a-f0-9]{32})',self.path)
        if not match or self.command not in ('GET','PATCH'):raise ValueError('API hỗ trợ GET/PATCH thông tin đơn vị')
        bearer=self.headers.get('Authorization','').removeprefix('Bearer ')
        key=db.execute("SELECT k.*,a.role,a.active FROM school_keys k JOIN admins a ON a.id=k.issuer WHERE k.hash=? AND k.school=? AND k.revoked=0 AND k.expires>?",(digest(bearer),match[1],int(time.time()))).fetchone()
        if not key or key['role']!='owner' or not key['active']:raise PermissionError('API key không hợp lệ hoặc hết hạn')
        if limited(db,'api:'+key['id'],120,60):raise ValueError('Quá nhiều yêu cầu API; thử lại sau một phút')
        row=db.execute('SELECT * FROM schools WHERE id=?',(key['school'],)).fetchone()
        if row['desired_state']=='deleted':raise PermissionError('Đơn vị đã xóa')
        if self.command=='GET':return {k:row[k] for k in ('id','name','domain','ip','revision','applied','desired_state','applied_state')}
        if 'name' in data and not isinstance(data['name'],str):raise ValueError('Tên đơn vị không hợp lệ')
        if set(data)-{'revision','name','retention_days','free_videos'} or 'revision' not in data:raise ValueError('Chỉ sửa name, retention_days, free_videos; cần revision hiện tại')
        cfg=decrypt(row['config'],row['id'])
        if 'retention_days' in data:cfg['retention_days']=data['retention_days']
        if 'free_videos' in data:cfg.setdefault('commerce',{})['free_videos']=data['free_videos']
        user=db.execute('SELECT * FROM admins WHERE id=?',(key['issuer'],)).fetchone()
        old_path,old_command=self.path,self.command
        self.path='/api/schools/save';self.command='POST'
        try:result=self.admin(db,user,{'id':row['id'],'revision':data['revision'],'name':data.get('name',row['name']),'domain':row['domain'],'ip':row['ip'],'config':cfg})
        finally:self.path,self.command=old_path,old_command
        audit(db,'api-key:'+key['id'],'school.api.patch',row['id'])
        return {**result,'state':'queued','message':'Đã cập nhật trung tâm. VPS nhận qua HTTPS, không dùng SSH.'}

    def relocation_request(self,db,user,row,data):
        sid=row['id'];now=int(time.time())
        records=db.execute('SELECT * FROM relocations WHERE school=? ORDER BY created DESC',(sid,)).fetchall()
        if self.command=='GET':return [{'id':x['id'],'state':x['state'],'created':x['created'],'details':decrypt(x['details'],x['id'])} for x in records]
        action=data.get('action')
        if action=='cancel':
            record=next((x for x in records if x['id']==data.get('id')),None)
            if not record or record['state'] not in ('backup_ready','prepared','failed'):raise ValueError('Chỉ hủy được giai đoạn chưa chuyển domain; tác vụ chạy cần hoàn tất trước')
            db.execute("UPDATE relocations SET state='canceled' WHERE id=?",(record['id'],))
            revision=row['revision']+1;db.execute('UPDATE schools SET revision=? WHERE id=?',(revision,sid))
            queue(db,sid,'configure',{'settings':decrypt(row['config'],sid),'name':row['name'],'domain':row['domain']},revision)
            audit(db,user['id'],'relocation.cancel',sid);return {'state':'canceled','message':'Đã hủy. Chờ đồng bộ lại cấu hình máy cũ trước khi kích hoạt.'}
        if row['desired_state']!='suspended' or row['applied_state']!='suspended':raise ValueError('Tạm ngưng thành công trước khi sao lưu/chuyển VPS')
        if 'relocation' not in json.loads(row['status']).get('features',[]) or json.loads(row['status']).get('control_protocol',0)<2:raise ValueError('Client cần nâng cấp 0.9.1 và agent mới trước khi chuyển VPS')
        if db.execute("SELECT 1 FROM jobs WHERE school=? AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Chờ các tác vụ đang chạy hoàn tất')
        if action not in ('backup','prepare','cutover'):raise ValueError('Giai đoạn chuyển VPS không hợp lệ')
        if action=='backup':
            if any(x['state'] not in ('completed','canceled','failed') for x in records):raise ValueError('Đã có quá trình chuyển VPS chưa kết thúc')
            identifier=secrets.token_hex(16);details={'source_ip':row['ip'],'domain':row['domain']}
        else:
            record=next((x for x in records if x['id']==data.get('id')),None)
            allowed=('backup_ready',) if action=='prepare' else ('prepared','cutover_failed')
            if not record or record['state'] not in allowed:raise ValueError('Giai đoạn hiện tại không cho phép thao tác này')
            identifier=record['id'];details=decrypt(record['details'],identifier)
        name='source' if action=='backup' else 'target';credential=data.get(name,{})
        if not isinstance(credential,dict) or not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}',str(credential.get('fingerprint',''))):raise ValueError('Cần fingerprint SSH đã đối chiếu')
        if not credential.get('password') and not credential.get('private_key'):raise ValueError('Cần mật khẩu root hoặc khóa SSH')
        port=int(credential.get('port',22))
        if not 1<=port<=65535:raise ValueError('Cổng SSH không hợp lệ')
        credential={k:str(credential.get(k,'')) for k in ('fingerprint','password','private_key')};credential['port']=port
        if action=='prepare':
            address=ipaddress.ip_address(str(data.get('target_ip','')));domain=str(data.get('staging_domain','')).lower().strip()
            if not address.is_global or str(address)==details['source_ip'] or not HOST.fullmatch(domain) or domain==row['domain']:raise ValueError('Cần VPS mới và domain tạm riêng trỏ về máy mới')
            if db.execute('SELECT 1 FROM schools WHERE ip=? AND id<>?',(str(address),sid)).fetchone():raise ValueError('IP đang gán cho một đơn vị khác')
            details.update(target_ip=str(address),staging_domain=domain,target_fingerprint=credential['fingerprint'])
        if action=='cutover' and credential['fingerprint']!=details['target_fingerprint']:raise ValueError('Fingerprint VPS mới đã thay đổi; kiểm tra trước khi tiếp tục')
        state='cutting_over' if action=='cutover' else 'preparing'
        if action=='backup':db.execute('INSERT INTO relocations VALUES(?,?,?,?,?)',(identifier,sid,state,encrypt(details,identifier),int(time.time())))
        else:db.execute('UPDATE relocations SET state=?,details=? WHERE id=?',(state,encrypt(details,identifier),identifier))
        job=queue(db,sid,'relocate',{'relocation_id':identifier,'phase':action,name:credential},row['revision']);audit(db,user['id'],'relocation.'+action,sid)
        return {'id':identifier,'job':job,'state':state}

    def manage_school(self,db,user,row,op,data):
        sid=row['id'];actor=user['id'];now=int(time.time())
        if user['role']!='owner':raise ValueError('Cần quyền chủ hệ thống')
        if op=='keys':
            if self.command=='GET':return [dict(x) for x in db.execute('SELECT id,label,expires,revoked,created FROM school_keys WHERE school=? ORDER BY created DESC',(sid,))]
            if row['desired_state']=='deleted':raise ValueError('Đơn vị đã xóa')
            if data.get('action')=='revoke':
                db.execute('UPDATE school_keys SET revoked=1 WHERE school=? AND id=?',(sid,str(data.get('id',''))));audit(db,actor,'school.key.revoke',sid);return {'ok':True}
            days=data.get('days',30);label=str(data.get('label','')).strip()
            if not isinstance(days,int) or not 1<=days<=90 or not 1<=len(label)<=100:raise ValueError('Tên khóa và hạn dùng 1–90 ngày là bắt buộc')
            token='meet_'+secrets.token_urlsafe(40);kid=secrets.token_hex(16)
            db.execute('INSERT INTO school_keys(id,school,issuer,label,hash,expires,created) VALUES(?,?,?,?,?,?,?)',(kid,sid,actor,label,digest(token),now+days*86400,now));audit(db,actor,'school.key.create',sid)
            return {'id':kid,'token':token,'expires':now+days*86400}
        if op=='relocations':return self.relocation_request(db,user,row,data)
        if db.execute("SELECT 1 FROM relocations WHERE school=? AND state IN ('backup_ready','preparing','prepared','cutting_over','cutover_failed')",(sid,)).fetchone():raise ValueError('Đang chuyển VPS; không đổi trạng thái lúc này')
        action=data.get('action');state=row['desired_state'];connected=bool(row['seen'] or row['agent_hash'])
        if action=='archive':
            if data.get('confirm')!=row['domain']:raise ValueError('Nhập đúng domain để xác nhận xóa')
            if state!='suspended' or row['applied_state']!='suspended':raise ValueError('Tạm ngưng thành công trước khi xóa')
            if db.execute("SELECT 1 FROM jobs WHERE school=? AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Chờ các tác vụ hoàn tất')
            db.execute("UPDATE schools SET desired_state='deleted' WHERE id=?",(sid,));db.execute('UPDATE school_keys SET revoked=1 WHERE school=?',(sid,));audit(db,actor,'school.archive',sid)
            return {'state':'deleted','message':'Đã đưa vào thùng rác; dữ liệu VPS và bản sao lưu được giữ nguyên.'}
        if action=='restore':
            if state!='deleted':raise ValueError('Đơn vị chưa bị xóa')
            db.execute("UPDATE schools SET desired_state='suspended' WHERE id=?",(sid,));audit(db,actor,'school.restore',sid);return {'state':'suspended'}
        if state=='deleted' or action not in ('suspend','resume'):raise ValueError('Thao tác trạng thái không hợp lệ')
        target='suspended' if action=='suspend' else 'active'
        if action=='resume' and connected and row['applied']!=row['revision']:raise ValueError('Chờ VPS áp dụng cấu hình trước khi kích hoạt lại')
        if connected and ('lifecycle' not in json.loads(row['status']).get('features',[]) or json.loads(row['status']).get('control_protocol',0)<2):raise ValueError('Nâng cấp client lên 0.9.1 trở lên trước khi điều khiển trạng thái')
        if db.execute("SELECT 1 FROM jobs WHERE school=? AND action='provision' AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Đang cài VPS; chờ hoàn tất')
        db.execute("UPDATE jobs SET state='superseded',payload=? WHERE school=? AND action='lifecycle' AND state='queued'",(encrypt({},sid),sid))
        db.execute('UPDATE schools SET desired_state=? WHERE id=?',(target,sid))
        if connected:job=queue(db,sid,'lifecycle',{'state':target},row['revision'])
        else:
            db.execute('UPDATE schools SET applied_state=? WHERE id=?',(target,sid));job=None
            if target=='suspended':db.execute("UPDATE jobs SET state='superseded',payload=? WHERE school=? AND state='queued'",(encrypt({},sid),sid))
        audit(db,actor,'school.'+action,sid)
        return {'state':target,'job':job,'applied':not connected,'message':'VPS đang học sẽ chờ hết buổi trước khi tạm ngưng.'}

    def admin(self,db,user,data):
        path=self.path;actor=user['id']
        readonly=path in ('/api/me','/api/audit','/api/schools') or bool(re.fullmatch(r'/api/schools/[a-f0-9]{32}/(config|jobs|readiness|keys|relocations)',path))
        if self.command=='GET' and not readonly and path!='/api/admins':raise ValueError('POST required')
        if path=='/api/logout':db.execute('DELETE FROM sessions WHERE admin=?',(actor,));return {'ok':True}
        if path=='/api/me':return {'email':user['email'],'role':user['role'],'mfa_enabled':bool(user['mfa'])}
        if path=='/api/security':
            if not hmac.compare_digest(password_hash(str(data.get('password','')),user['hash'].split(':')[0]),user['hash']):raise ValueError('Mật khẩu hiện tại không đúng')
            action=data.get('action')
            if action=='setup':
                if user['mfa']:raise ValueError('Tài khoản đã bật 2FA')
                secret=base64.b32encode(secrets.token_bytes(20)).decode()
                db.execute('INSERT INTO mfa_pending VALUES(?,?,?) ON CONFLICT(admin) DO UPDATE SET secret=excluded.secret,expires=excluded.expires',(actor,encrypt(secret,'admin:'+actor),int(time.time())+600));audit(db,actor,'mfa.setup',actor);return {'secret':secret}
            if action=='enable':
                row=db.execute('SELECT * FROM mfa_pending WHERE admin=? AND expires>?',(actor,int(time.time()))).fetchone()
                if not row or user['mfa']:raise ValueError('Khởi tạo lại 2FA')
                secret=decrypt(row['secret'],'admin:'+actor);step=otp_step(secret,str(data.get('code','')))
                if not step:raise ValueError('Mã xác thực không đúng')
                db.execute('UPDATE admins SET mfa=?,last_step=? WHERE id=?',(row['secret'],step,actor));db.execute('DELETE FROM mfa_pending WHERE admin=?',(actor,));db.execute('DELETE FROM mfa_recovery WHERE admin=?',(actor,))
                codes=[secrets.token_hex(8) for _ in range(8)]
                for code in codes:db.execute('INSERT INTO mfa_recovery VALUES(?,?)',(actor,digest(code)))
            elif action=='disable':
                if not verify_mfa(db,user,str(data.get('code',''))):raise ValueError('Mã xác thực không đúng')
                db.execute('UPDATE admins SET mfa=NULL,last_step=0 WHERE id=?',(actor,));db.execute('DELETE FROM mfa_recovery WHERE admin=?',(actor,));codes=[]
            else:raise ValueError('Thao tác không hợp lệ')
            db.execute('DELETE FROM sessions WHERE admin=?',(actor,));db.execute('DELETE FROM mfa_challenges WHERE admin=?',(actor,));audit(db,actor,'mfa.'+action,actor);return {'ok':True,'recovery_codes':codes}
        if path=='/api/audit':return [dict(x) for x in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 200')]
        if path=='/api/admins':
            if user['role']!='owner':raise ValueError('Cần quyền chủ hệ thống')
            if self.command=='GET':return [dict(x) for x in db.execute('SELECT id,email,role,active FROM admins')]
            email=str(data['email']).lower();role=data['role'];password=str(data.get('password',''))
            if role not in ('owner','operator','viewer') or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email):raise ValueError('Thông tin quản trị không hợp lệ')
            id=data.get('id') or secrets.token_hex(16);old=db.execute('SELECT * FROM admins WHERE id=?',(id,)).fetchone()
            if id==actor and (not data.get('active',True) or role!='owner'):raise ValueError('Không thể tự bỏ quyền chủ hệ thống')
            if password and not 12<=len(password.encode())<=72:raise ValueError('Mật khẩu 12–72 byte')
            if not old and not password:raise ValueError('Cần mật khẩu tài khoản mới')
            db.execute('INSERT INTO admins(id,email,hash,role,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,hash=excluded.hash,role=excluded.role,active=excluded.active',(id,email,password_hash(password) if password else old['hash'],role,int(data.get('active',True))))
            db.execute('DELETE FROM sessions WHERE admin=?',(id,));db.execute('DELETE FROM mfa_challenges WHERE admin=?',(id,));audit(db,actor,'admin.save',id);return {'ok':True}
        if path=='/api/schools' and self.command=='GET':return [{**{k:r[k] for k in ('id','name','domain','ip','revision','applied','seen','status','desired_state','applied_state')},'sync':sync_status(db,r),'platform_mode':decrypt(r['config'],r['id']).get('platform_mode','school')} for r in db.execute('SELECT * FROM schools ORDER BY name')]
        if path=='/api/academies/save':
            if user['role']!='owner' or data.get('config',{}).get('platform_mode')!='academy':raise ValueError('Luồng này chỉ tạo nền tảng khóa học/VIP mới bằng quyền owner')
            prior=db.execute('SELECT * FROM schools WHERE id=?',(str(data.get('id','')),)).fetchone()
            if prior and decrypt(prior['config'],prior['id']).get('platform_mode','school')!='academy':raise ValueError('Không dùng bản ghi trường cũ cho nền tảng mới')
            self.path='/api/schools/save'
            try:return self.admin(db,user,data)
            finally:self.path=path
        if path=='/api/schools/save':
            sid=data.get('id') or secrets.token_hex(16);domain=str(data['domain']).lower().strip();name=str(data['name']).strip();ip=str(data['ip'])
            if not HOST.fullmatch(domain) or not 1<=len(name.encode())<=200:raise ValueError('Tên đơn vị/domain không hợp lệ')
            address=ipaddress.ip_address(ip)
            if not address.is_global:raise ValueError('VPS phải có IP public')
            old=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
            if old and old['desired_state']=='deleted':raise ValueError('Khôi phục đơn vị trước khi sửa')
            if old and db.execute("SELECT 1 FROM relocations WHERE school=? AND state IN ('backup_ready','preparing','prepared','cutting_over','cutover_failed')",(sid,)).fetchone():raise ValueError('Đang chuyển VPS; giữ nguyên cấu hình tới khi hoàn tất')
            if old and db.execute("SELECT 1 FROM jobs WHERE school=? AND action='domain' AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Đang đổi domain, chờ hoàn tất trước khi lưu')
            if old and data.get('revision')!=old['revision']:raise ValueError('Cấu hình đã thay đổi. Tải lại trước khi lưu')
            if old and type(data.get('revision')) is not int:raise ValueError('Revision phải là số nguyên')
            cfg=validate_config(merge_secrets(data.get('config',{}),decrypt(old['config'],sid) if old else {}));revision=old['revision']+1 if old else 1
            if old and old['agent_hash']:
                prior_cfg=decrypt(old['config'],sid)
                if cfg.get('school_slug','')!=prior_cfg.get('school_slug',''):raise ValueError('Không đổi mã nội bộ sau khi liên kết VPS')
            installing=old and db.execute("SELECT 1 FROM jobs WHERE school=? AND action='provision' AND state IN ('queued','running')",(sid,)).fetchone()
            if installing:raise ValueError('Đang cài VPS; chờ cài đặt hoàn tất trước khi đổi cấu hình')
            if old and (old['seen'] or old['agent_hash']) and decrypt(old['config'],sid).get('platform_mode','school')!=cfg.get('platform_mode','school'):raise ValueError('Tạo nền tảng mới để đổi loại triển khai')
            if user['role']!='owner' and cfg.get('platform_mode','school')=='academy' and (not old or decrypt(old['config'],sid).get('platform_mode','school')!='academy'):raise ValueError('Tạo nền tảng thương mại cần quyền chủ hệ thống')
            if user['role']!='owner' and cfg.get('commerce',{})!=(decrypt(old['config'],sid).get('commerce',{}) if old else {}):raise ValueError('Cấu hình kinh doanh cần quyền chủ hệ thống')
            if old and (old['seen'] or old['agent_hash']) and old['domain']!=domain:raise ValueError('Dùng tác vụ Đổi domain để chuyển có kiểm tra')
            db.execute('INSERT INTO schools(id,name,domain,ip,config,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,domain=excluded.domain,ip=excluded.ip,config=excluded.config,revision=excluded.revision',(sid,name,domain,ip,encrypt(cfg,sid),revision))
            db.execute("UPDATE jobs SET state='superseded',payload=? WHERE school=? AND action='configure' AND state='queued'",(encrypt({},sid),sid))
            job=queue(db,sid,'configure',{'settings':cfg,'name':name,'domain':domain},revision);audit(db,actor,'school.save',sid);return {'id':sid,'revision':revision,'job_id':job}
        match=re.fullmatch(r'/api/schools/([a-f0-9]{32})/(config|enroll|jobs|action|readiness|lifecycle|keys|relocations)',path)
        if match:
            sid,op=match.groups();row=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
            if not row:raise ValueError('Không tìm thấy trường')
            if op in ('lifecycle','keys','relocations'):return self.manage_school(db,user,row,op,data)
            if row['desired_state']=='deleted' and op not in ('config','jobs','readiness'):raise ValueError('Đơn vị nằm trong thùng rác')
            if op=='config':return {'config':redact(decrypt(row['config'],sid)),'revision':row['revision']}
            if op=='readiness':
                report=deployment_readiness(row,decrypt(row['config'],sid))
                report['installing']=bool(db.execute("SELECT 1 FROM jobs WHERE school=? AND action='provision' AND state IN ('queued','running')",(sid,)).fetchone())
                report['can_install']=report['can_install'] and not report['installing']
                return report
            if op=='enroll':
                if user['role']!='owner':raise ValueError('Cần quyền chủ hệ thống')
                token=secrets.token_urlsafe(48);db.execute('UPDATE schools SET enroll_hash=?,enroll_expires=? WHERE id=?',(digest(token),int(time.time())+900,sid));audit(db,actor,'agent.enroll-issued',sid);return {'token':token,'expires_seconds':900}
            if op=='jobs':
                output=[]
                for x in db.execute('SELECT id,action,revision,state,created,result FROM jobs WHERE school=? ORDER BY created DESC LIMIT 100',(sid,)):
                    item=dict(x);result=json.loads(item['result'])
                    if 'payload' in result:
                        encrypted=result.pop('payload')
                        if user['role']=='owner' and int(time.time())-item['created']<900:result['data']=decrypt(encrypted,sid)
                        else:result['expired']=True
                        item['result']=json.dumps(result,ensure_ascii=False)
                    output.append(item)
                return output
            if op=='action':
                action=data['action'];payload=data.get('payload',{})
                if action in ('lifecycle','relocate'):raise ValueError('Dùng chức năng quản lý riêng')
                if db.execute("SELECT 1 FROM relocations WHERE school=? AND state IN ('backup_ready','preparing','prepared','cutting_over','cutover_failed')",(sid,)).fetchone():raise ValueError('Đang chuyển VPS; chờ hoàn tất')
                if not isinstance(payload,dict):raise ValueError('Nội dung tác vụ không hợp lệ')
                if action=='academy':
                    if user['role']!='owner':raise ValueError('Chỉ chủ hệ thống được quản trị kinh doanh')
                    if decrypt(row['config'],sid).get('platform_mode','school')!='academy':raise ValueError('Đơn vị này đang ở chế độ trường học')
                if action=='provision':
                    if row['desired_state']!='active':raise ValueError('Kích hoạt đơn vị trước khi cài mới')
                    if user['role']!='owner':raise ValueError('Cần quyền chủ hệ thống')
                    if not db.in_transaction:db.execute('BEGIN IMMEDIATE')
                    row=db.execute('SELECT * FROM schools WHERE id=?',(sid,)).fetchone()
                    if not deployment_readiness(row,decrypt(row['config'],sid))['can_install']:raise ValueError('Chưa đủ thông tin khởi tạo hoặc VPS đã kết nối; xem Tổng quan')
                    if db.execute("SELECT 1 FROM jobs WHERE school=? AND action='provision' AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Đã có tác vụ cài đặt đang chờ hoặc đang chạy')
                    if not payload.get('password') and not payload.get('private_key'):raise ValueError('Cần mật khẩu root hoặc khóa SSH')
                    payload['ip']=row['ip'];payload['domain']=row['domain']
                    if not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}',payload.get('fingerprint','')):raise ValueError('Cần fingerprint SSH SHA256 đã đối chiếu')
                    if not 1<=int(payload.get('port',22))<=65535:raise ValueError('Cổng SSH không hợp lệ')
                    payload['port']=int(payload.get('port',22))
                if action=='domain':payload['ip']=row['ip']
                if action=='configure':payload={'settings':decrypt(row['config'],sid),'name':row['name'],'domain':row['domain']}
                if action=='domain':
                    if db.execute("SELECT 1 FROM jobs WHERE school=? AND action IN ('configure','domain') AND state IN ('queued','running')",(sid,)).fetchone():raise ValueError('Chờ cấu hình hiện tại đồng bộ xong')
                    domain=payload.get('domain','')
                    if not HOST.fullmatch(domain):raise ValueError('Domain không hợp lệ')
                    if db.execute('SELECT 1 FROM schools WHERE domain=? AND id<>?',(domain,sid)).fetchone():raise ValueError('Domain đã được dùng')
                if action=='update' and not re.fullmatch('[a-f0-9]{40}',payload.get('target','')):raise ValueError('Cần commit SHA đã kiểm tra')
                job=queue(db,sid,action,payload,row['revision']);audit(db,actor,'job.'+action,sid);return {'id':job}
        raise ValueError('Không có chức năng này')

if __name__=='__main__':
    init();
    from provision import start_worker
    start_worker(sys.modules[__name__])
    ThreadingHTTPServer(('127.0.0.1',8090),Handler).serve_forever()
