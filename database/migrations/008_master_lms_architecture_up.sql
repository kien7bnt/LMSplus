-- ============================================================================
-- MIGRATION 008 (UP): MASTER LMS ARCHITECTURE (3-TIER TRAINING, SUBJECT SNAPSHOT,
--                     STRICT VIDEO INTERVALS, 3 SYNCHRONIZED BANKS, WIKI,
--                     EXAMS, ASSIGNMENTS, LEAVE AUDIT LOGS & NOTIFICATIONS)
-- ============================================================================

BEGIN;

-- 1. Enhance Level 1 (Curriculum -> courses in PG) & Level 2 (Cohort -> course_classes in PG)
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS curriculum_version VARCHAR(32) NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS effective_date DATE NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE course_classes
    ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(32) NOT NULL DEFAULT 'HYBRID',
    ADD COLUMN IF NOT EXISTS location_note TEXT NULL,
    ADD COLUMN IF NOT EXISTS coordinator_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS max_students INTEGER NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';

-- 2. Subject Version SNAPSHOT (Immutable published snapshots)
CREATE TABLE IF NOT EXISTS subject_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL,
    version_label VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED', -- PUBLISHED, ARCHIVED
    snapshot_json JSONB NOT NULL,
    changelog_note TEXT,
    published_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subject_version_num UNIQUE (subject_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_subject_versions_subject
    ON subject_versions(subject_id, version_number DESC);

-- Link Level 3 subject_classes to Level 2 cohort & immutable Subject Snapshot
ALTER TABLE subject_classes
    ADD COLUMN IF NOT EXISTS cohort_id UUID NULL REFERENCES course_classes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS subject_version_id UUID NULL REFERENCES subject_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS class_version_upgrade_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    from_version_id UUID NULL REFERENCES subject_versions(id) ON DELETE SET NULL,
    to_version_id UUID NOT NULL REFERENCES subject_versions(id) ON DELETE RESTRICT,
    upgrade_reason TEXT NOT NULL,
    upgraded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    upgraded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Audit Logs for Level 1 Curriculum & Level 2 Program Cohorts
CREATE TABLE IF NOT EXISTS curriculum_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    action_type VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_curriculum_audit_curriculum
    ON curriculum_audit_logs(curriculum_id, created_at DESC);

CREATE TABLE IF NOT EXISTS program_cohort_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id UUID NOT NULL REFERENCES course_classes(id) ON DELETE CASCADE,
    action_type VARCHAR(64) NOT NULL,
    target_student_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cohort_audit_cohort
    ON program_cohort_audit_logs(cohort_id, created_at DESC);

-- 4. Synchronized 3 Banks (Questions, Assignments, Learning Resources -> strict Leaf Lesson anchor)
ALTER TABLE learning_resources
    ADD COLUMN IF NOT EXISTS topic_id UUID NULL REFERENCES topics(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS question_bank_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    question_type VARCHAR(32) NOT NULL, -- SINGLE_CHOICE, MULTI_SELECT, TRUE_FALSE, FILL_BLANK, MATCHING, ESSAY
    prompt TEXT NOT NULL,
    options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    points NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    difficulty VARCHAR(24) NOT NULL DEFAULT 'MEDIUM',
    explanation TEXT,
    correct_feedback TEXT,
    wrong_feedback TEXT,
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_qbank_leaf_lesson CHECK (lesson_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_qbank_subject_lesson
    ON question_bank_entries(subject_id, lesson_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS assignment_bank_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructions TEXT NOT NULL,
    submission_type VARCHAR(32) NOT NULL DEFAULT 'MIXED', -- TEXT, FILE, LINK, MIXED
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    allow_resubmit BOOLEAN NOT NULL DEFAULT TRUE,
    rubric_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_abank_leaf_lesson CHECK (lesson_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_abank_subject_lesson
    ON assignment_bank_items(subject_id, lesson_id) WHERE deleted_at IS NULL;

-- 5. Subject Wiki Pages & Revisions (structured navigation across Subject/Topic/Chapter/Lesson)
CREATE TABLE IF NOT EXISTS subject_wiki_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    topic_id UUID NULL REFERENCES topics(id) ON DELETE SET NULL,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    slug VARCHAR(200) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    content_markdown TEXT NOT NULL DEFAULT '',
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_page_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED',
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_subject_wiki_slug UNIQUE (subject_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_subject_wiki_lookup
    ON subject_wiki_pages(subject_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS subject_wiki_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES subject_wiki_pages(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    content_markdown TEXT NOT NULL,
    change_note TEXT,
    edited_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subject_wiki_rev UNIQUE (page_id, revision_number)
);

-- 6. STRICT Video Watch Interval Union & Tamper-Resistant Ledger
CREATE TABLE IF NOT EXISTS video_watch_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    block_id VARCHAR(128) NOT NULL,
    content_version_key VARCHAR(64) NOT NULL DEFAULT 'v1',
    watched_intervals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    unique_watched_sec INTEGER NOT NULL DEFAULT 0,
    max_contiguous_watched_sec INTEGER NOT NULL DEFAULT 0,
    max_watched_sec INTEGER NOT NULL DEFAULT 0,
    last_position_sec INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    watch_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_strict_video_progress UNIQUE (student_id, subject_class_id, lesson_id, block_id, content_version_key)
);
CREATE INDEX IF NOT EXISTS idx_strict_video_class_lesson
    ON video_watch_progress(subject_class_id, lesson_id);

CREATE TABLE IF NOT EXISTS video_watch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    block_id VARCHAR(128) NOT NULL,
    content_version_key VARCHAR(64) NOT NULL DEFAULT 'v1',
    event_type VARCHAR(32) NOT NULL, -- HEARTBEAT, SEGMENT, SEEK_BLOCKED, RECONNECT_SYNC, TAMPER_REJECTED
    segment_start_sec NUMERIC(10,2) NULL,
    segment_end_sec NUMERIC(10,2) NULL,
    playback_rate NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    device_session_id VARCHAR(128) NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_video_events_student_lesson
    ON video_watch_events(student_id, subject_class_id, lesson_id, recorded_at DESC);

-- 7. Dedicated Class Exams (Kiem tra) & Class Assignments (Bai tap) Workspaces
CREATE TABLE IF NOT EXISTS class_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    scope_type VARCHAR(24) NOT NULL DEFAULT 'CHAPTER', -- COURSE, TOPIC, CHAPTER, LESSON
    topic_id UUID NULL REFERENCES topics(id) ON DELETE SET NULL,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    time_limit_minutes INTEGER NOT NULL DEFAULT 30,
    max_attempts SMALLINT NOT NULL DEFAULT 1,
    shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
    scoring_policy VARCHAR(24) NOT NULL DEFAULT 'HIGHEST', -- HIGHEST, LATEST, AVERAGE
    pass_score_pct NUMERIC(5,2) NOT NULL DEFAULT 50.00,
    open_at TIMESTAMPTZ NULL,
    close_at TIMESTAMPTZ NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, CLOSED
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_exam_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,
    bank_question_id UUID NULL REFERENCES question_bank_entries(id) ON DELETE SET NULL,
    question_snapshot_json JSONB NOT NULL,
    points NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS class_exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_version_key VARCHAR(64) NOT NULL DEFAULT 'v1',
    attempt_number SMALLINT NOT NULL DEFAULT 1,
    question_order_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    auto_score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    manual_score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    total_score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    grading_status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, AUTO_GRADED, PENDING_MANUAL, GRADED
    teacher_feedback TEXT,
    graded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ NULL,
    graded_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_exam_student_attempt UNIQUE (exam_id, student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS class_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    assignment_bank_item_id UUID NULL REFERENCES assignment_bank_items(id) ON DELETE SET NULL,
    topic_id UUID NULL REFERENCES topics(id) ON DELETE SET NULL,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    instructions TEXT NOT NULL,
    submission_type VARCHAR(32) NOT NULL DEFAULT 'MIXED',
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    max_attempts SMALLINT NOT NULL DEFAULT 3,
    allow_resubmit BOOLEAN NOT NULL DEFAULT TRUE,
    due_at TIMESTAMPTZ NULL,
    attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED', -- DRAFT, PUBLISHED, CLOSED
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_assignment_id UUID NOT NULL REFERENCES class_assignments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_version_key VARCHAR(64) NOT NULL DEFAULT 'v1',
    attempt_number SMALLINT NOT NULL DEFAULT 1,
    submission_text TEXT,
    submission_link VARCHAR(1024),
    attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, GRADED, RETURNED
    score NUMERIC(6,2) NULL,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    teacher_feedback TEXT,
    graded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NULL,
    graded_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_class_assignment_student_attempt UNIQUE (class_assignment_id, student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS class_gradebook_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(32) NOT NULL, -- EXAM, ASSIGNMENT, MANUAL
    source_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    score NUMERIC(6,2) NOT NULL,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    weight NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    graded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_gradebook_source UNIQUE (subject_class_id, student_id, source_type, source_id)
);

-- 8. Leave Request Audit Logs & Notifications
CREATE TABLE IF NOT EXISTS leave_request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NOT NULL,
    action_note TEXT,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teaching_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(48) NOT NULL, -- FORUM_REPLY, LEAVE_REVIEWED, COHORT_SYNC, EXAM_PUBLISHED, ASSIGNMENT_GRADED
    title VARCHAR(255) NOT NULL,
    body TEXT,
    link_url VARCHAR(512),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teaching_notifications_user
    ON teaching_notifications(user_id, is_read, created_at DESC);

COMMIT;
