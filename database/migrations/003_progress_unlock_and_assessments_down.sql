-- ============================================================================
-- MIGRATION 003 (DOWN): ROLLBACK PROGRESS, UNLOCK & ASSIGNMENTS BRIDGE
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS assessment_elearning_links;
DROP TABLE IF EXISTS assignment_submissions;
DROP TABLE IF EXISTS assignment_elearning_configs;
DROP TABLE IF EXISTS learning_events;
DROP TABLE IF EXISTS course_progress;
DROP TABLE IF EXISTS lesson_progress;
DROP TABLE IF EXISTS lesson_unlock_conditions;
DROP TABLE IF EXISTS completion_rules;

COMMIT;
