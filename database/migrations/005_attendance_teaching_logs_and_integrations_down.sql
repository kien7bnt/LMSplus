-- ============================================================================
-- MIGRATION 005 (DOWN): ROLLBACK ATTENDANCE, TEACHING LOGS & INTEGRATIONS
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS media_transcriptions;
DROP TABLE IF EXISTS video_recordings;
DROP TABLE IF EXISTS online_meeting_sessions;
DROP TABLE IF EXISTS external_integration_configs;
DROP TABLE IF EXISTS teaching_log_history;
DROP TABLE IF EXISTS teaching_log_lessons;
DROP TABLE IF EXISTS teaching_logs;
DROP TABLE IF EXISTS teaching_session_status;
DROP TABLE IF EXISTS teaching_staff_assignments;
DROP TABLE IF EXISTS attendance_audit_logs;
DROP TABLE IF EXISTS attendance_evidence;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS make_up_sessions;
DROP TABLE IF EXISTS leave_requests;
DROP TABLE IF EXISTS attendance_qr_sessions;

COMMIT;
