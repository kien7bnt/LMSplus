-- ============================================================================
-- MIGRATION 006 (DOWN): ROLLBACK INSTRUCTOR TEACHING WORKSPACE EXTENSIONS
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_api_idempotency_created_at;
DROP TABLE IF EXISTS api_idempotency_keys;

DROP INDEX IF EXISTS idx_learning_resources_course_active;
ALTER TABLE learning_resources
    DROP COLUMN IF EXISTS deleted_at;

DROP INDEX IF EXISTS idx_attendance_audit_record;
ALTER TABLE attendance_audit_logs
    DROP COLUMN IF EXISTS new_note,
    DROP COLUMN IF EXISTS previous_note;

DROP INDEX IF EXISTS idx_class_sessions_class_start;
ALTER TABLE class_sessions
    DROP COLUMN IF EXISTS attendance_locked_by,
    DROP COLUMN IF EXISTS attendance_locked_at,
    DROP COLUMN IF EXISTS attendance_saved_by,
    DROP COLUMN IF EXISTS attendance_saved_at,
    DROP COLUMN IF EXISTS cancel_reason,
    DROP COLUMN IF EXISTS session_status,
    DROP COLUMN IF EXISTS room_or_link;

DROP INDEX IF EXISTS idx_lessons_chapter_sort;
DROP INDEX IF EXISTS idx_chapters_course_sort;
ALTER TABLE lessons
    DROP COLUMN IF EXISTS completion_rule,
    DROP COLUMN IF EXISTS objectives;

ALTER TABLE chapters
    DROP COLUMN IF EXISTS status;

DROP INDEX IF EXISTS idx_subject_classes_course_status;
ALTER TABLE subject_classes
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS delivery_mode,
    DROP COLUMN IF EXISTS max_students,
    DROP COLUMN IF EXISTS end_date,
    DROP COLUMN IF EXISTS start_date,
    DROP COLUMN IF EXISTS schedule_text,
    DROP COLUMN IF EXISTS room,
    DROP COLUMN IF EXISTS description,
    DROP COLUMN IF EXISTS subject,
    DROP COLUMN IF EXISTS course_id;

ALTER TABLE courses
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS intro,
    DROP COLUMN IF EXISTS prerequisites,
    DROP COLUMN IF EXISTS target_audience,
    DROP COLUMN IF EXISTS objectives,
    DROP COLUMN IF EXISTS thumbnail_url,
    DROP COLUMN IF EXISTS subject;

COMMIT;
