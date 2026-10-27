CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS entity_codes(id BIGINT AUTO_INCREMENT PRIMARY KEY,kind VARCHAR(2) NOT NULL,entity_id CHAR(36) NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS schools (
 id CHAR(36) PRIMARY KEY, slug VARCHAR(80) NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS users (
 id CHAR(36) PRIMARY KEY, school_id CHAR(36) NOT NULL, email VARCHAR(190) NOT NULL,
 name VARCHAR(200) NOT NULL, password_hash VARCHAR(100) NOT NULL,
 role ENUM('admin','teacher','student') NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 session_version INT NOT NULL DEFAULT 1,
 UNIQUE KEY tenant_email(school_id,email), UNIQUE KEY tenant_user(school_id,id),
 FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS classes (
 id CHAR(36) PRIMARY KEY, school_id CHAR(36) NOT NULL, name VARCHAR(100) NOT NULL,
 UNIQUE KEY tenant_class(school_id,id), UNIQUE KEY class_name(school_id,name),
 FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS enrollments (
 school_id CHAR(36) NOT NULL, class_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
 PRIMARY KEY(school_id,class_id,user_id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS courses (
 id CHAR(36) PRIMARY KEY, school_id CHAR(36) NOT NULL, class_id CHAR(36) NOT NULL,
 teacher_id CHAR(36) NOT NULL, name VARCHAR(200) NOT NULL,
 UNIQUE KEY tenant_course(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),
 FOREIGN KEY(school_id,teacher_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS meetings (
 id CHAR(36) PRIMARY KEY, school_id CHAR(36) NOT NULL, course_id CHAR(36) NOT NULL,
 title VARCHAR(200) NOT NULL, starts_at DATETIME(6) NOT NULL,
 status ENUM('scheduled','live','ended') NOT NULL DEFAULT 'scheduled',
 recording_allowed BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY tenant_meeting(school_id,id), KEY schedule(school_id,starts_at),
 FOREIGN KEY(school_id,course_id) REFERENCES courses(school_id,id)
);
CREATE TABLE IF NOT EXISTS presence (
 school_id CHAR(36) NOT NULL, meeting_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
 joined_at DATETIME(6) NOT NULL, last_seen DATETIME(6) NOT NULL,
 seconds BIGINT NOT NULL DEFAULT 0, online BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(school_id,meeting_id,user_id),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS attendance_events (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, school_id CHAR(36) NOT NULL,
 meeting_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL,
 kind ENUM('join','heartbeat','leave') NOT NULL, at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY history(school_id,meeting_id,user_id,at),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS media_sessions (
 id VARCHAR(100) PRIMARY KEY, school_id CHAR(36) NOT NULL, meeting_id CHAR(36) NOT NULL,
 user_id CHAR(36) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS publications (
 school_id CHAR(36) NOT NULL, meeting_id CHAR(36) NOT NULL, session_id VARCHAR(100) NOT NULL,
 track_name VARCHAR(100) NOT NULL, user_id CHAR(36) NOT NULL,
 PRIMARY KEY(session_id,track_name),
 FOREIGN KEY(session_id) REFERENCES media_sessions(id),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS recordings (
 id CHAR(36) PRIMARY KEY, school_id CHAR(36) NOT NULL, meeting_id CHAR(36) NOT NULL,
 owner_id CHAR(36) NOT NULL, object_key VARCHAR(500) NOT NULL UNIQUE,
 status ENUM('pending','ready') NOT NULL DEFAULT 'pending', size_bytes BIGINT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),
 FOREIGN KEY(school_id,owner_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, school_id CHAR(36) NOT NULL, actor_id CHAR(36) NOT NULL,
 action VARCHAR(100) NOT NULL, target VARCHAR(200) NOT NULL,
 at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), KEY tenant_audit(school_id,at)
);
CREATE TABLE IF NOT EXISTS class_sfu_bindings (
 school_id CHAR(36) NOT NULL, class_id CHAR(36) NOT NULL,
 provider_id VARCHAR(80) NOT NULL, app_id VARCHAR(100) NOT NULL,
 PRIMARY KEY(school_id,class_id), KEY provider_classes(provider_id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);
CREATE TABLE IF NOT EXISTS meeting_sfu_bindings (
 school_id CHAR(36) NOT NULL, meeting_id CHAR(36) NOT NULL,
 provider_id VARCHAR(80) NOT NULL, app_id VARCHAR(100) NOT NULL,
 PRIMARY KEY(school_id,meeting_id),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS meeting_messages (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,
 content VARCHAR(2000) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY room_messages(school_id,meeting_id,id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS meeting_hands (
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,raised BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(school_id,meeting_id,user_id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

CREATE TABLE IF NOT EXISTS course_assistants(school_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,PRIMARY KEY(school_id,course_id,user_id),FOREIGN KEY(school_id,course_id) REFERENCES courses(school_id,id) ON DELETE CASCADE,FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id));

CREATE TABLE IF NOT EXISTS account_security(user_id CHAR(36) PRIMARY KEY,secret TEXT NOT NULL,last_step BIGINT NOT NULL DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id));

CREATE TABLE IF NOT EXISTS user_controls(user_id CHAR(36) PRIMARY KEY,state ENUM('active','suspended','disabled') NOT NULL DEFAULT 'active',permissions JSON NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));

CREATE TABLE IF NOT EXISTS attendance_policies(school_id CHAR(36) PRIMARY KEY,late_minutes INT NOT NULL DEFAULT 10,early_minutes INT NOT NULL DEFAULT 10,min_percent INT NOT NULL DEFAULT 75,FOREIGN KEY(school_id) REFERENCES schools(id));
CREATE TABLE IF NOT EXISTS meeting_timings(school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,starts_at DATETIME(6) NOT NULL,ends_at DATETIME(6) NOT NULL,PRIMARY KEY(school_id,meeting_id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id));
CREATE TABLE IF NOT EXISTS attendance_adjustments(id BIGINT AUTO_INCREMENT PRIMARY KEY,school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,joined_at DATETIME(6) NOT NULL,left_at DATETIME(6) NOT NULL,reason VARCHAR(500) NOT NULL,actor_id CHAR(36) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),KEY latest(school_id,meeting_id,user_id,id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id));

CREATE TABLE IF NOT EXISTS code_counters(kind VARCHAR(2) PRIMARY KEY,value INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS entity_short_codes(kind VARCHAR(2) NOT NULL,number INT NOT NULL,entity_id CHAR(36) NOT NULL UNIQUE,PRIMARY KEY(kind,number));

CREATE TABLE IF NOT EXISTS room_settings (
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,lobby BOOLEAN NOT NULL DEFAULT FALSE,
 chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,present_enabled BOOLEAN NOT NULL DEFAULT TRUE,revision INT NOT NULL DEFAULT 0,
 PRIMARY KEY(school_id,meeting_id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS room_members (
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,
 state ENUM('waiting','admitted','denied','removed') NOT NULL DEFAULT 'waiting',mute_request BIGINT NOT NULL DEFAULT 0,
 requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(school_id,meeting_id,user_id),KEY room_waiting(school_id,meeting_id,state,requested_at),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS room_polls (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,question VARCHAR(200) NOT NULL,
 choices JSON NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY room_poll_tenant(school_id,meeting_id,id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS room_votes (
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,poll_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,choice INT NOT NULL,
 PRIMARY KEY(school_id,poll_id,user_id),KEY room_vote_counts(school_id,meeting_id,poll_id,choice),KEY room_my_votes(school_id,meeting_id,user_id),FOREIGN KEY(school_id,meeting_id,poll_id) REFERENCES room_polls(school_id,meeting_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),CHECK(choice>=0 AND choice<6)
);
CREATE TABLE IF NOT EXISTS meeting_links (
 code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,
 UNIQUE KEY one_link(school_id,meeting_id),
 FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_site (
 school_id CHAR(36) PRIMARY KEY,content JSON NOT NULL,FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_profiles (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,dob DATE NOT NULL,address VARCHAR(500) NOT NULL,
 school_name VARCHAR(200) NOT NULL,phone VARCHAR(30) NOT NULL,parent_phone VARCHAR(30) NOT NULL,
 avatar_key VARCHAR(500) NOT NULL DEFAULT '',marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,email_verified BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_courses (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,title VARCHAR(200) NOT NULL,description TEXT NOT NULL,
 teacher_name VARCHAR(200) NOT NULL DEFAULT '',academic_course_id CHAR(36) NULL,published BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),UNIQUE KEY ac_tenant(school_id,id),
 FOREIGN KEY(school_id) REFERENCES schools(id),FOREIGN KEY(school_id,academic_course_id) REFERENCES courses(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_plans (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,name VARCHAR(160) NOT NULL,price_vnd BIGINT NOT NULL,
 days INT NOT NULL,live_enabled BOOLEAN NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE KEY ap_tenant(school_id,id),FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_orders (
 id CHAR(36) PRIMARY KEY,code BIGINT AUTO_INCREMENT UNIQUE,school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,plan_id CHAR(36) NOT NULL,
 price_vnd BIGINT NOT NULL,days INT NOT NULL,live_enabled BOOLEAN NOT NULL,status ENUM('pending','paid','rejected','refunded') NOT NULL DEFAULT 'pending',
 receipt_key VARCHAR(500) NOT NULL DEFAULT '',provider_ref VARCHAR(150) NULL UNIQUE,reviewer CHAR(36) NULL,review_note VARCHAR(500) NOT NULL DEFAULT '',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),paid_at DATETIME(6) NULL,UNIQUE KEY ao_tenant(school_id,id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,plan_id) REFERENCES academy_plans(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_memberships (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,expires_at DATETIME(6) NOT NULL,live_enabled BOOLEAN NOT NULL,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_lessons (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,title VARCHAR(200) NOT NULL,
 object_key VARCHAR(500) NOT NULL,bucket VARCHAR(100) NOT NULL,status ENUM('draft','ready') NOT NULL DEFAULT 'draft',size_bytes BIGINT NOT NULL DEFAULT 0,
 duration_seconds INT NOT NULL DEFAULT 0,position INT NOT NULL DEFAULT 0,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY al_tenant(school_id,id),FOREIGN KEY(school_id,course_id) REFERENCES academy_courses(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_monthly_usage (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,period CHAR(7) NOT NULL,used INT NOT NULL DEFAULT 0,
 PRIMARY KEY(school_id,user_id,period),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_lesson_details (
 school_id CHAR(36) NOT NULL,lesson_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,
 chapter VARCHAR(200) NOT NULL DEFAULT '',notes TEXT NOT NULL,source_recording_id CHAR(36) NULL,
 import_state ENUM('none','queued','copying','ready','failed') NOT NULL DEFAULT 'none',
 desired_published BOOLEAN NOT NULL DEFAULT TRUE,storage_account VARCHAR(64) NOT NULL DEFAULT '',lease VARCHAR(64) NULL,lease_until DATETIME(6) NULL,
 attempts INT NOT NULL DEFAULT 0,error_code VARCHAR(50) NOT NULL DEFAULT '',revision INT NOT NULL DEFAULT 1,
 PRIMARY KEY(school_id,lesson_id),UNIQUE KEY ald_source(school_id,course_id,source_recording_id),
 FOREIGN KEY(school_id,lesson_id) REFERENCES academy_lessons(school_id,id),
 FOREIGN KEY(school_id,course_id) REFERENCES academy_courses(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_views (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,period CHAR(7) NOT NULL,lesson_id CHAR(36) NOT NULL,
 PRIMARY KEY(school_id,user_id,period,lesson_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,lesson_id) REFERENCES academy_lessons(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_progress (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,lesson_id CHAR(36) NOT NULL,seconds INT NOT NULL DEFAULT 0,completed BOOLEAN NOT NULL DEFAULT FALSE,updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(school_id,user_id,lesson_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,lesson_id) REFERENCES academy_lessons(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_assignments (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,teacher_id CHAR(36) NOT NULL,title VARCHAR(200) NOT NULL,
 questions JSON NOT NULL,due_at DATETIME(6) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),UNIQUE KEY aa_tenant(school_id,id),
 FOREIGN KEY(school_id,course_id) REFERENCES academy_courses(school_id,id),FOREIGN KEY(school_id,teacher_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_submissions (
 school_id CHAR(36) NOT NULL,assignment_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,answers JSON NOT NULL,score DECIMAL(5,2) NULL,feedback TEXT NULL,
 submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),graded_by CHAR(36) NULL,
 PRIMARY KEY(school_id,assignment_id,user_id),FOREIGN KEY(school_id,assignment_id) REFERENCES academy_assignments(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_expenses (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,title VARCHAR(200) NOT NULL,amount_vnd BIGINT NOT NULL,paid_on DATE NOT NULL,actor_id CHAR(36) NOT NULL,
 FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS course_announcements (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,author_id CHAR(36) NOT NULL,
 title VARCHAR(200) NOT NULL,body TEXT NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ca_feed(school_id,course_id,created_at),FOREIGN KEY(school_id,course_id) REFERENCES courses(school_id,id),FOREIGN KEY(school_id,author_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_order_links (
 school_id CHAR(36) NOT NULL,order_id CHAR(36) NOT NULL,checkout_url VARCHAR(2000) NOT NULL,
 PRIMARY KEY(school_id,order_id),FOREIGN KEY(school_id,order_id) REFERENCES academy_orders(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_notification_reads (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,notification_id CHAR(64) NOT NULL,read_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(school_id,user_id,notification_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

CREATE TABLE IF NOT EXISTS account_deletions (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,deleted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 avatar_key VARCHAR(500) NOT NULL DEFAULT '',storage_account VARCHAR(64) NOT NULL DEFAULT '',bucket VARCHAR(100) NOT NULL DEFAULT '',avatar_deleted BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_plan_controls (
 school_id CHAR(36) NOT NULL,plan_id CHAR(36) NOT NULL,revision INT NOT NULL DEFAULT 1,deleted_at DATETIME(6) NULL,
 PRIMARY KEY(school_id,plan_id),FOREIGN KEY(school_id,plan_id) REFERENCES academy_plans(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_ui_texts (
 school_id CHAR(36) PRIMARY KEY,revision INT NOT NULL DEFAULT 1,content JSON NOT NULL,FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_email_links (
 token_hash CHAR(64) PRIMARY KEY,school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,email VARCHAR(190) NOT NULL,
 token_encrypted TEXT NOT NULL,expires_at DATETIME(6) NOT NULL,verified_at DATETIME(6) NULL,sent_at DATETIME(6) NULL,
 next_attempt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),attempts INT NOT NULL DEFAULT 0,error_code VARCHAR(40) NOT NULL DEFAULT '',
 KEY mail_due(sent_at,next_attempt),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

CREATE TABLE IF NOT EXISTS academy_registration_avatars (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,media_type VARCHAR(30) NOT NULL,image_data MEDIUMBLOB NOT NULL,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

CREATE TABLE IF NOT EXISTS class_controls (
 school_id CHAR(36) NOT NULL,class_id CHAR(36) NOT NULL,state ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',revision INT NOT NULL DEFAULT 1,
 PRIMARY KEY(school_id,class_id),FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);

CREATE TABLE IF NOT EXISTS academy_live_memberships (
 school_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,expires_at DATETIME(6) NOT NULL,
 PRIMARY KEY(school_id,user_id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

CREATE TABLE IF NOT EXISTS attendance_report_deletions (
 school_id CHAR(36) NOT NULL,meeting_id CHAR(36) NOT NULL,deleted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(school_id,meeting_id),FOREIGN KEY(school_id,meeting_id) REFERENCES meetings(school_id,id)
);
CREATE TABLE IF NOT EXISTS media_delete_queue (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,storage_account VARCHAR(64) NOT NULL,bucket VARCHAR(100) NOT NULL,object_key VARCHAR(500) NOT NULL,recording_id CHAR(36) NOT NULL DEFAULT '',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),completed_at DATETIME(6) NULL,KEY media_pending(completed_at,created_at)
);

CREATE TABLE IF NOT EXISTS academy_logos (school_id CHAR(36) PRIMARY KEY,media_type VARCHAR(32) NOT NULL,image_data MEDIUMBLOB NOT NULL,revision CHAR(64) NOT NULL,FOREIGN KEY(school_id) REFERENCES schools(id));
CREATE TABLE IF NOT EXISTS academy_images (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,media_type VARCHAR(32) NOT NULL,image_data MEDIUMBLOB NOT NULL,filename VARCHAR(200) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ai_school(school_id,created_at),FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_broadcasts (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,title VARCHAR(200) NOT NULL,body TEXT NOT NULL,created_by CHAR(36) NOT NULL,email_requested BOOLEAN NOT NULL DEFAULT FALSE,request_id CHAR(36) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),deleted_at DATETIME(6) NULL,
 UNIQUE KEY ab_request(school_id,request_id),UNIQUE KEY ab_tenant(school_id,id),KEY ab_feed(school_id,deleted_at,created_at),FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_mail_templates (
 school_id CHAR(36) NOT NULL,kind VARCHAR(32) NOT NULL,subject VARCHAR(200) NOT NULL,body TEXT NOT NULL,revision INT NOT NULL DEFAULT 1,PRIMARY KEY(school_id,kind),FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_mail_campaigns (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,request_id CHAR(36) NOT NULL,broadcast_id CHAR(36) NULL,title VARCHAR(200) NOT NULL,created_by CHAR(36) NOT NULL,payload_hash CHAR(64) NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY amc_request(school_id,request_id),UNIQUE KEY amc_tenant(school_id,id),FOREIGN KEY(school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS academy_mail_jobs (
 id CHAR(36) PRIMARY KEY,school_id CHAR(36) NOT NULL,campaign_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,email VARCHAR(254) NOT NULL,subject VARCHAR(200) NOT NULL,body TEXT NOT NULL,
 status ENUM('queued','sending','sent','failed','cancelled') NOT NULL DEFAULT 'queued',attempts INT NOT NULL DEFAULT 0,next_attempt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),lease CHAR(36) NULL,lease_until DATETIME(6) NULL,error_code VARCHAR(50) NOT NULL DEFAULT '',sent_at DATETIME(6) NULL,
 UNIQUE KEY amj_recipient(school_id,campaign_id,user_id),KEY amj_queue(status,next_attempt),FOREIGN KEY(school_id,campaign_id) REFERENCES academy_mail_campaigns(school_id,id)
);
CREATE TABLE IF NOT EXISTS academy_invoices (
 school_id CHAR(36) NOT NULL,order_id CHAR(36) NOT NULL,number VARCHAR(32) NOT NULL,buyer_name VARCHAR(200) NOT NULL,buyer_email VARCHAR(254) NOT NULL,plan_name VARCHAR(200) NOT NULL,amount_vnd BIGINT NOT NULL,days INT NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(school_id,order_id),UNIQUE KEY ain_number(school_id,number),FOREIGN KEY(school_id,order_id) REFERENCES academy_orders(school_id,id)
);
