-- ============================================================================
-- MIGRATION 001 (UP): CURRICULUM STRUCTURE & HYBRID ENROLLMENT POLICY
-- Covers: course_elearning_settings (ASSIGNED_ONLY / REQUEST_APPROVAL / SELF_ENROLL),
--         course_enrollment_requests, course_subjects, topics, chapters,
--         lessons, lesson_prerequisites, lesson_sessions
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS course_elearning_settings (
    course_id UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    enrollment_policy VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED_ONLY',
    default_target_course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE SET NULL,
    allow_preview_syllabus BOOLEAN NOT NULL DEFAULT TRUE,
    learning_outcomes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    self_enroll_enabled_by UUID NULL REFERENCES users(id),
    self_enroll_enabled_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID NULL REFERENCES users(id),
    CONSTRAINT chk_course_enrollment_policy CHECK (
        enrollment_policy IN ('ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL')
    )
);

CREATE TABLE IF NOT EXISTS course_enrollment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    preferred_course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE SET NULL,
    preferred_subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE SET NULL,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_note TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    reviewed_by UUID NULL REFERENCES users(id),
    reviewed_at TIMESTAMPTZ NULL,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_course_request UNIQUE (course_id, student_id),
    CONSTRAINT chk_enrollment_request_status CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
    )
);
CREATE INDEX IF NOT EXISTS idx_enrollment_requests_course_status
    ON course_enrollment_requests(course_id, status);

CREATE TABLE IF NOT EXISTS course_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    semester_order SMALLINT NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    credits NUMERIC(4,1) NOT NULL DEFAULT 3.0,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_course_subject UNIQUE (course_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_course_subjects_course
    ON course_subjects(course_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_topic_subject_code UNIQUE (subject_id, code)
);
CREATE INDEX IF NOT EXISTS idx_topics_subject_order
    ON topics(subject_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    estimated_minutes INTEGER NOT NULL DEFAULT 60,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_topic_order
    ON chapters(topic_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    lesson_type VARCHAR(32) NOT NULL DEFAULT 'MIXED', -- VIDEO, READING, INTERACTIVE, LAB, MIXED
    estimated_minutes INTEGER NOT NULL DEFAULT 30,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    published_version_id UUID NULL,
    working_draft_revision INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    is_free_preview BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_chapter_order
    ON lessons(chapter_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lesson_prerequisites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    required_lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    min_score_pct NUMERIC(5,2) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    CONSTRAINT uq_lesson_prereq UNIQUE (lesson_id, required_lesson_id),
    CONSTRAINT chk_no_self_prereq CHECK (lesson_id <> required_lesson_id)
);

CREATE TABLE IF NOT EXISTS lesson_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    planned_order SMALLINT NOT NULL DEFAULT 1,
    planned_coverage VARCHAR(32) NOT NULL DEFAULT 'FULL', -- FULL, PART_1, PART_2
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    CONSTRAINT uq_session_lesson UNIQUE (class_session_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_class
    ON lesson_sessions(subject_class_id, class_session_id);

COMMIT;
