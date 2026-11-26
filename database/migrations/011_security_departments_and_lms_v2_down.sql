-- Migration 011 DOWN: Rollback Bảo mật Session/Refresh Token & Bảng Tổ chức Khoa/Bộ môn
BEGIN;

DROP INDEX IF EXISTS idx_refresh_tokens_user;
DROP TABLE IF EXISTS auth_refresh_tokens;

ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS token_version;

DROP INDEX IF EXISTS idx_departments_parent;
DROP TABLE IF EXISTS departments;

DELETE FROM schema_migrations WHERE id = '011_security_departments_and_lms_v2';

COMMIT;
