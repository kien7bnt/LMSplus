-- Migration 013 DOWN: Gỡ bỏ các Composite Indexes hiệu năng của Migration 013
BEGIN;

DROP INDEX IF EXISTS idx_class_assign_subs_student;
DROP INDEX IF EXISTS idx_class_exam_attempts_student;
DROP INDEX IF EXISTS idx_lesson_progress_class_student;
DROP INDEX IF EXISTS idx_attendance_records_session_status;
DROP INDEX IF EXISTS idx_class_enrollments_student_status;
DROP INDEX IF EXISTS idx_sessions_class_sched_status;
DROP INDEX IF EXISTS idx_lessons_chapter_sort;

DELETE FROM schema_migrations WHERE id = '013_performance_indexes';

COMMIT;
