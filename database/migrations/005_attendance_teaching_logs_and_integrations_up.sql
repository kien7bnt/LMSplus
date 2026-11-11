-- ============================================================================
-- MIGRATION 005 (UP): ATTENDANCE, 24H TEACHING LOG CONFIRMATION & INTEGRATIONS
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_qr_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    secret_seed VARCHAR(128) NOT NULL,
    rotation_interval_sec SMALLINT NOT NULL DEFAULT 20,
    late_threshold_minutes SMALLINT NOT NULL DEFAULT 15,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason_category VARCHAR(32) NOT NULL, -- MEDICAL, FAMILY, WORK_CONFLICT, OTHER
    reason_detail TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    reviewed_by UUID NULL REFERENCES users(id),
    reviewed_at TIMESTAMPTZ NULL,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_session_leave UNIQUE (class_session_id, student_id)
);

CREATE TABLE IF NOT EXISTS make_up_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    target_makeup_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_request_id UUID NULL REFERENCES leave_requests(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED', -- ASSIGNED, ATTENDED, MISSED
    approved_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status VARCHAR(32) NOT NULL,
    -- PRESENT, LATE, EARLY_LEAVE, EXCUSED_ABSENCE, UNEXCUSED_ABSENCE, MAKEUP
    check_in_method VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    check_in_at TIMESTAMPTZ NULL,
    check_out_at TIMESTAMPTZ NULL,
    online_duration_minutes INTEGER NULL,
    leave_request_id UUID NULL REFERENCES leave_requests(id) ON DELETE SET NULL,
    make_up_session_id UUID NULL REFERENCES make_up_sessions(id) ON DELETE SET NULL,
    note TEXT,
    recorded_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_session_student_attendance UNIQUE (class_session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_class_student
    ON attendance_records(subject_class_id, student_id);

CREATE TABLE IF NOT EXISTS attendance_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_request_id UUID NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    attendance_record_id UUID NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
    file_storage_key VARCHAR(1024) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128),
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NOT NULL,
    change_reason TEXT NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teaching_staff_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staff_role VARCHAR(32) NOT NULL, -- PRIMARY_INSTRUCTOR, CO_INSTRUCTOR, TEACHING_ASSISTANT, ACADEMIC_COORDINATOR
    permissions_json JSONB NOT NULL DEFAULT '{
      "can_manage_materials": true,
      "can_manage_assignments": false,
      "can_grade": false,
      "can_moderate_forum": true,
      "can_take_attendance": true
    }'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_class_staff_role UNIQUE (subject_class_id, user_id, staff_role)
);

-- Trạng thái vận hành & Quy tắc 24 giờ xác nhận Nhật ký giảng dạy
CREATE TABLE IF NOT EXISTS teaching_session_status (
    class_session_id UUID PRIMARY KEY REFERENCES class_sessions(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    confirmation_deadline_at TIMESTAMPTZ NOT NULL, -- scheduled_end_at + INTERVAL '24 hours'
    operational_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    -- SCHEDULED, IN_PROGRESS, AWAITING_CONFIRMATION, CONFIRMED,
    -- OVERDUE_UNCONFIRMED (Sau 24h chưa xác nhận - không khóa quyền xác nhận muộn),
    -- CONFIRMED_LATE, CANCELLED, MAKEUP_SESSION
    overdue_flagged_at TIMESTAMPTZ NULL,
    confirmed_at TIMESTAMPTZ NULL,
    confirmed_by UUID NULL REFERENCES users(id),
    is_late_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent_count SMALLINT NOT NULL DEFAULT 0,
    last_reminder_sent_at TIMESTAMPTZ NULL,
    last_reminder_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teaching_session_overdue
    ON teaching_session_status(operational_status, confirmation_deadline_at)
    WHERE operational_status IN ('AWAITING_CONFIRMATION', 'OVERDUE_UNCONFIRMED');

CREATE TABLE IF NOT EXISTS teaching_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL UNIQUE REFERENCES class_sessions(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    scheduled_instructor_id UUID NOT NULL REFERENCES users(id),
    actual_instructor_id UUID NOT NULL REFERENCES users(id),
    is_substitute_teaching BOOLEAN NOT NULL DEFAULT FALSE,
    substituting_reason TEXT,
    assistant_user_ids UUID[] NOT NULL DEFAULT '{}',
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    actual_start_at TIMESTAMPTZ NOT NULL,
    actual_end_at TIMESTAMPTZ NOT NULL,
    confirmation_deadline_at TIMESTAMPTZ NOT NULL,
    session_category VARCHAR(32) NOT NULL DEFAULT 'REGULAR',
    general_notes TEXT,
    handover_notes_for_next_session TEXT,
    confirmation_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    -- DRAFT, AWAITING_CONFIRMATION, OVERDUE_UNCONFIRMED, CONFIRMED, CONFIRMED_LATE
    is_late_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    late_confirmation_reason TEXT NULL,
    confirmed_at TIMESTAMPTZ NULL,
    confirmed_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_teaching_logs_instructor
    ON teaching_logs(actual_instructor_id, actual_start_at DESC);

CREATE TABLE IF NOT EXISTS teaching_log_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teaching_log_id UUID NOT NULL REFERENCES teaching_logs(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    delivery_status VARCHAR(32) NOT NULL, -- COMPLETED, PARTIAL, DEFERRED
    stopped_at_block_id UUID NULL,
    progress_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_teaching_log_lesson UNIQUE (teaching_log_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS teaching_log_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teaching_log_id UUID NOT NULL REFERENCES teaching_logs(id) ON DELETE CASCADE,
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL, -- CREATED, UPDATED, OVERDUE_FLAGGED, REMINDER_SENT, CONFIRMED, CONFIRMED_LATE
    snapshot_json JSONB NOT NULL,
    reason TEXT,
    actor_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_integration_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(32) NOT NULL, -- ZOOM, GOOGLE_MEET, S3_STORAGE, WHISPER_STT, SMTP_PUSH
    account_label VARCHAR(120) NOT NULL,
    public_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    encrypted_credentials_ciphertext BYTEA NOT NULL,
    encryption_key_id VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS online_meeting_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    integration_config_id UUID NOT NULL REFERENCES external_integration_configs(id),
    provider VARCHAR(32) NOT NULL,
    external_meeting_id VARCHAR(128) NOT NULL,
    join_url VARCHAR(1024) NOT NULL,
    host_start_url VARCHAR(1024),
    passcode_encrypted BYTEA NULL,
    sync_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    last_synced_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NULL REFERENCES class_sessions(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    resource_id UUID NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
    hls_manifest_key VARCHAR(1024) NOT NULL,
    thumbnail_key VARCHAR(1024),
    duration_seconds INTEGER NOT NULL,
    resolutions_json JSONB NOT NULL DEFAULT '["360p", "720p", "1080p"]'::jsonb,
    processing_status VARCHAR(32) NOT NULL DEFAULT 'READY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_recording_id UUID NOT NULL REFERENCES video_recordings(id) ON DELETE CASCADE,
    language_code VARCHAR(10) NOT NULL DEFAULT 'vi',
    stt_provider VARCHAR(32) NOT NULL DEFAULT 'WHISPER_V3',
    vtt_storage_key VARCHAR(1024) NOT NULL,
    segments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
