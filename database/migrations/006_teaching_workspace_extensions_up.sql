-- ============================================================================
-- MIGRATION 006 (UP): INSTRUCTOR TEACHING WORKSPACE, YOUTUBE LESSONS & FAST ATTENDANCE EXTENSIONS
-- Additive-only migration: preserves all existing LMSPLUS data & foreign keys.
-- ============================================================================

BEGIN;

-- 1. Course pedagogical metadata & lifecycle status
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS subject VARCHAR(100),
    ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(1024),
    ADD COLUMN IF NOT EXISTS objectives TEXT,
    ADD COLUMN IF NOT EXISTS target_audience TEXT,
    ADD COLUMN IF NOT EXISTS prerequisites TEXT,
    ADD COLUMN IF NOT EXISTS intro TEXT,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- 2. Reusable 1 Course -> N Classes linkage & operational class metadata
ALTER TABLE subject_classes
    ADD COLUMN IF NOT EXISTS course_id UUID NULL REFERENCES courses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS subject VARCHAR(100),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS room VARCHAR(200),
    ADD COLUMN IF NOT EXISTS schedule_text VARCHAR(300),
    ADD COLUMN IF NOT EXISTS start_date DATE NULL,
    ADD COLUMN IF NOT EXISTS end_date DATE NULL,
    ADD COLUMN IF NOT EXISTS max_students INTEGER NULL CHECK (max_students IS NULL OR max_students > 0),
    ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(16) NOT NULL DEFAULT 'OFFLINE'
        CHECK (delivery_mode IN ('OFFLINE', 'ONLINE', 'HYBRID')),
    ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('DRAFT', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED')),
    ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_subject_classes_course_status
    ON subject_classes(course_id, status);

-- 3. Lesson completion rule & chapter/lesson ordering indexes
ALTER TABLE chapters
    ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS objectives TEXT,
    ADD COLUMN IF NOT EXISTS completion_rule VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
        CHECK (completion_rule IN ('MANUAL', 'REVIEW_CORRECT'));

CREATE INDEX IF NOT EXISTS idx_chapters_course_sort
    ON chapters(course_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_lessons_chapter_sort
    ON lessons(chapter_id, sort_order);

-- 4. Class session attendance save/lock & cancellation tracking
ALTER TABLE class_sessions
    ADD COLUMN IF NOT EXISTS room_or_link VARCHAR(300),
    ADD COLUMN IF NOT EXISTS session_status VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED'
        CHECK (session_status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
    ADD COLUMN IF NOT EXISTS attendance_saved_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS attendance_saved_by UUID NULL REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS attendance_locked_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS attendance_locked_by UUID NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_class_sessions_class_start
    ON class_sessions(subject_class_id, scheduled_start_at);

-- 5. Note-level audit trail on attendance_audit_logs
ALTER TABLE attendance_audit_logs
    ADD COLUMN IF NOT EXISTS previous_note TEXT NULL,
    ADD COLUMN IF NOT EXISTS new_note TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_audit_record
    ON attendance_audit_logs(attendance_record_id, changed_at DESC);

-- 6. Soft-delete support on course learning_resources
ALTER TABLE learning_resources
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_learning_resources_course_active
    ON learning_resources(course_id)
    WHERE deleted_at IS NULL;

-- 7. Idempotency store for batch attendance saves & critical mutations
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_created_at
    ON api_idempotency_keys(created_at);

COMMIT;
