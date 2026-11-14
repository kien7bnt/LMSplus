-- ============================================================================
-- MIGRATION 008 (DOWN): ROLLBACK MASTER LMS ARCHITECTURE
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_teaching_notifications_user;
DROP TABLE IF EXISTS teaching_notifications CASCADE;
DROP TABLE IF EXISTS leave_request_logs CASCADE;
DROP TABLE IF EXISTS class_gradebook_entries CASCADE;
DROP TABLE IF EXISTS class_assignment_submissions CASCADE;
DROP TABLE IF EXISTS class_assignments CASCADE;
DROP TABLE IF EXISTS class_exam_attempts CASCADE;
DROP TABLE IF EXISTS class_exam_questions CASCADE;
DROP TABLE IF EXISTS class_exams CASCADE;
DROP INDEX IF EXISTS idx_video_events_student_lesson;
DROP TABLE IF EXISTS video_watch_events CASCADE;
DROP INDEX IF EXISTS idx_strict_video_class_lesson;
DROP TABLE IF EXISTS video_watch_progress CASCADE;
DROP TABLE IF EXISTS subject_wiki_revisions CASCADE;
DROP INDEX IF EXISTS idx_subject_wiki_lookup;
DROP TABLE IF EXISTS subject_wiki_pages CASCADE;
DROP INDEX IF EXISTS idx_abank_subject_lesson;
DROP TABLE IF EXISTS assignment_bank_items CASCADE;
DROP INDEX IF EXISTS idx_qbank_subject_lesson;
DROP TABLE IF EXISTS question_bank_entries CASCADE;

ALTER TABLE learning_resources
    DROP COLUMN IF EXISTS lesson_id,
    DROP COLUMN IF EXISTS chapter_id,
    DROP COLUMN IF EXISTS topic_id;

DROP INDEX IF EXISTS idx_cohort_audit_cohort;
DROP TABLE IF EXISTS program_cohort_audit_logs CASCADE;
DROP INDEX IF EXISTS idx_curriculum_audit_curriculum;
DROP TABLE IF EXISTS curriculum_audit_logs CASCADE;
DROP TABLE IF EXISTS class_version_upgrade_logs CASCADE;

ALTER TABLE subject_classes
    DROP COLUMN IF EXISTS subject_version_id,
    DROP COLUMN IF EXISTS cohort_id;

DROP INDEX IF EXISTS idx_subject_versions_subject;
DROP TABLE IF EXISTS subject_versions CASCADE;

ALTER TABLE course_classes
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS max_students,
    DROP COLUMN IF EXISTS coordinator_id,
    DROP COLUMN IF EXISTS location_note,
    DROP COLUMN IF EXISTS delivery_mode,
    DROP COLUMN IF EXISTS academic_year;

ALTER TABLE courses
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS effective_date,
    DROP COLUMN IF EXISTS curriculum_version;

COMMIT;
