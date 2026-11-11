-- ============================================================================
-- MIGRATION 007 (DOWN): ROLLBACK LESSON STUDIO & INTERACTIVE VIDEO QUIZZES
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS lesson_quiz_submissions;
DROP TABLE IF EXISTS video_watch_progress;
DROP TABLE IF EXISTS class_lesson_blocks;
DROP TABLE IF EXISTS class_lesson_customs;
DROP TABLE IF EXISTS video_quiz_markers;
DROP TABLE IF EXISTS question_bank_items;
DROP TABLE IF EXISTS video_upload_sessions;

COMMIT;
