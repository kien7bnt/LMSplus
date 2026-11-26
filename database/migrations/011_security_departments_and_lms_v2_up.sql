-- Migration 011 UP: Bảo mật Session/Refresh Token + Tổ chức Khoa/Bộ môn & Trưởng bộ môn
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id TEXT NULL REFERENCES departments(id) ON DELETE SET NULL,
  org_type TEXT NOT NULL DEFAULT 'DEPARTMENT'
    CHECK (org_type IN ('ORGANIZATION', 'FACULTY', 'DEPARTMENT', 'CENTER')),
  head_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id, is_active);

-- Bổ sung trường thu hồi phiên & khóa đăng nhập cho bảng users (tương thích ngược dữ liệu cũ)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT NULL;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON auth_refresh_tokens(user_id, revoked_at);

-- Khởi tạo danh mục tổ chức/bộ môn từ dữ liệu hiện có (idempotent)
INSERT INTO departments (id, code, name, parent_id, org_type, description, is_active, created_at, updated_at)
VALUES
  ('org_root', 'LMSPLUS', 'Hệ thống Đào tạo LMSPLUS', NULL, 'ORGANIZATION', 'Đơn vị chủ quản toàn hệ thống', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('khoi_5', 'KHOI5', 'Tổ Toán – Khối 5', 'org_root', 'DEPARTMENT', 'Tổ chuyên môn khối 5', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('dept_se', 'DEPT-SE', 'Khoa Công nghệ Phần mềm', 'org_root', 'FACULTY', 'Khoa Kỹ thuật & Công nghệ Phần mềm', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (id, applied_at)
VALUES ('011_security_departments_and_lms_v2', '2026-11-25T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

COMMIT;
