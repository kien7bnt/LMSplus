-- Migration 012 UP: Rubric Chấm bài tập, Phúc khảo điểm (Grade Appeals) & Đồng bộ Storage Providers
BEGIN;

-- 1. Mở rộng Rubric trên Bài tập theo lớp & Bài tập đã nộp
ALTER TABLE class_assignments
  ADD COLUMN IF NOT EXISTS rubric_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE class_assignment_submissions
  ADD COLUMN IF NOT EXISTS rubric_scores_json TEXT NOT NULL DEFAULT '[]';

-- 2. Đồng bộ ràng buộc storage_provider cho S3 / R2 / VERCEL_BLOB
ALTER TABLE learning_resources
  DROP CONSTRAINT IF EXISTS learning_resources_storage_provider_check;

ALTER TABLE learning_resources
  ADD CONSTRAINT learning_resources_storage_provider_check
  CHECK (storage_provider IN ('EXTERNAL_URL', 'LOCAL_DISK', 'S3', 'R2', 'VERCEL_BLOB'));

-- 3. Bảng Phúc khảo điểm bài tập & bài kiểm tra
CREATE TABLE IF NOT EXISTS grade_appeals (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('ASSIGNMENT', 'EXAM')),
  target_id TEXT NOT NULL,
  submission_or_attempt_id TEXT NOT NULL,
  subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  current_score REAL,
  requested_score REAL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  reviewer_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name TEXT NULL,
  final_score REAL NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grade_appeals_class ON grade_appeals(subject_class_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_grade_appeals_student ON grade_appeals(student_id, created_at);

INSERT INTO schema_migrations (id, applied_at)
VALUES ('012_rubrics_appeals_storage', '2026-11-25T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

COMMIT;
