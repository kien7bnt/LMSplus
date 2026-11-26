-- Migration 012 DOWN: Hoàn tác Phúc khảo điểm, Rubric bài tập và ràng buộc storage_provider
BEGIN;

DROP INDEX IF EXISTS idx_grade_appeals_student;
DROP INDEX IF EXISTS idx_grade_appeals_class;
DROP TABLE IF EXISTS grade_appeals;

ALTER TABLE class_assignment_submissions DROP COLUMN IF EXISTS rubric_scores_json;
ALTER TABLE class_assignments DROP COLUMN IF EXISTS rubric_json;

ALTER TABLE learning_resources DROP CONSTRAINT IF EXISTS learning_resources_storage_provider_check;
ALTER TABLE learning_resources
  ADD CONSTRAINT learning_resources_storage_provider_check
  CHECK (storage_provider IN ('EXTERNAL_URL', 'LOCAL_DISK'));

DELETE FROM schema_migrations WHERE id = '012_rubrics_appeals_storage';

COMMIT;
