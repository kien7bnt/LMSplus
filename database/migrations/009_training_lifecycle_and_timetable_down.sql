-- ============================================================================
-- MIGRATION 009 (DOWN): ROLLBACK TRAINING LIFECYCLE & TIMETABLE EXTENSIONS
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS teaching_timesheet_items;
DROP TABLE IF EXISTS teaching_timesheets;
DROP TABLE IF EXISTS instructor_quotas;
DROP TABLE IF EXISTS session_lessons;
DROP TABLE IF EXISTS instructor_availabilities;
DROP TABLE IF EXISTS academic_holidays;
DROP TABLE IF EXISTS shift_presets;
DROP TABLE IF EXISTS classrooms;
DROP TABLE IF EXISTS campuses;
DROP TABLE IF EXISTS certificate_templates;
DROP TABLE IF EXISTS curriculum_versions;
DROP TABLE IF EXISTS session_plan_items;
DROP TABLE IF EXISTS curriculum_service_fees;
DROP TABLE IF EXISTS curriculum_stages;
DROP TABLE IF EXISTS subject_assessment_components;
DROP TABLE IF EXISTS subject_prerequisites;

COMMIT;
