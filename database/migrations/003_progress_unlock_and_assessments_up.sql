-- ============================================================================
-- MIGRATION 003 (UP): LEARNING PROGRESS, UNLOCK CONDITIONS & ASSIGNMENTS BRIDGE
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS completion_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(32) NOT NULL, -- LESSON, CHAPTER, SUBJECT_CLASS, COURSE_CLASS
    target_id UUID NOT NULL,
    min_video_watch_pct NUMERIC(5,2) NOT NULL DEFAULT 85.00,
    require_all_quick_checks BOOLEAN NOT NULL DEFAULT TRUE,
    require_attachments_opened BOOLEAN NOT NULL DEFAULT FALSE,
    require_assignment_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    min_assessment_score_pct NUMERIC(5,2) NULL,
    rule_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_completion_rule_target UNIQUE (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS lesson_unlock_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    condition_type VARCHAR(32) NOT NULL, -- PREVIOUS_LESSON_COMPLETED, SPECIFIC_DATE, ASSESSMENT_PASSED, INSTRUCTOR_MANUAL_UNLOCK
    required_lesson_id UUID NULL REFERENCES lessons(id) ON DELETE CASCADE,
    required_assessment_id UUID NULL REFERENCES assessments(id) ON DELETE CASCADE,
    min_score_pct NUMERIC(5,2) NULL,
    unlock_at TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED', -- NOT_STARTED, IN_PROGRESS, COMPLETED
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    last_video_position_sec INTEGER NOT NULL DEFAULT 0,
    watched_segments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_read_block_id UUID NULL,
    opened_attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    quick_check_score_pct NUMERIC(5,2) NULL,
    started_at TIMESTAMPTZ NULL,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_class_lesson_progress UNIQUE (student_id, subject_class_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_resume
    ON lesson_progress(student_id, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_class
    ON lesson_progress(subject_class_id, student_id);

CREATE TABLE IF NOT EXISTS course_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    completed_lessons_count INTEGER NOT NULL DEFAULT 0,
    total_lessons_count INTEGER NOT NULL DEFAULT 0,
    completed_chapters_count INTEGER NOT NULL DEFAULT 0,
    total_chapters_count INTEGER NOT NULL DEFAULT 0,
    overall_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    total_study_seconds BIGINT NOT NULL DEFAULT 0,
    last_lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, COMPLETED, AT_RISK
    completed_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_subject_class_progress UNIQUE (student_id, subject_class_id)
);

CREATE TABLE IF NOT EXISTS learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_events_student_time
    ON learning_events(student_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS assignment_elearning_configs (
    assignment_id UUID PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    assignment_scope VARCHAR(32) NOT NULL DEFAULT 'IN_CURRICULUM', -- IN_CURRICULUM, STANDALONE_EXTRA
    max_attempts INTEGER NOT NULL DEFAULT 3,
    allow_late_submission BOOLEAN NOT NULL DEFAULT TRUE,
    late_penalty_pct_per_day NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    grading_strategy VARCHAR(32) NOT NULL DEFAULT 'LATEST_SUBMISSION',
    rubric_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number SMALLINT NOT NULL DEFAULT 1,
    submission_text TEXT,
    attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED', -- DRAFT, SUBMITTED, LATE_SUBMITTED, GRADED, RETURNED_FOR_REVISION
    score NUMERIC(6,2) NULL,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    feedback_text TEXT,
    feedback_attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    graded_by UUID NULL REFERENCES users(id),
    graded_at TIMESTAMPTZ NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assignment_student_attempt UNIQUE (assignment_id, student_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_submissions_grading_queue
    ON assignment_submissions(assignment_id, status);

CREATE TABLE IF NOT EXISTS assessment_elearning_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    time_limit_minutes INTEGER NOT NULL DEFAULT 45,
    max_attempts SMALLINT NOT NULL DEFAULT 1,
    scoring_policy VARCHAR(32) NOT NULL DEFAULT 'HIGHEST', -- HIGHEST, LATEST, AVERAGE
    pass_score_pct NUMERIC(5,2) NOT NULL DEFAULT 50.00,
    open_at TIMESTAMPTZ NULL,
    close_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
