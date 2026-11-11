-- ============================================================================
-- MIGRATION 001 (DOWN): ROLLBACK CURRICULUM STRUCTURE & ENROLLMENT POLICY
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS lesson_sessions;
DROP TABLE IF EXISTS lesson_prerequisites;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS chapters;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS course_subjects;
DROP TABLE IF EXISTS course_enrollment_requests;
DROP TABLE IF EXISTS course_elearning_settings;

COMMIT;
