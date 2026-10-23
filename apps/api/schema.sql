CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY);
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
