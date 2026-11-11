-- ============================================================================
-- MIGRATION 000: LMSPLUS CORE BASELINE BRIDGE (SAFE IF NOT EXISTS)
-- Purpose: Ensures core LMSPLUS tables exist when running in a fresh/staging
--          environment, while doing NOTHING (zero-breakage) if tables already
--          exist in the production LMSPLUS database.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(1024),
    department_id UUID NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE, -- STUDENT, TEACHING_ASSISTANT, INSTRUCTOR, ACADEMIC_STAFF, ADMIN
    name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    thumbnail_url VARCHAR(1024),
    department_id UUID NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    credits NUMERIC(4,1) NOT NULL DEFAULT 3.0,
    department_id UUID NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lớp khóa học (Cohort / Không gian tổng hợp của khóa học)
CREATE TABLE IF NOT EXISTS course_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lớp môn học (Section / Không gian giảng dạy riêng của từng môn học)
CREATE TABLE IF NOT EXISTS subject_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE SET NULL,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    semester VARCHAR(32),
    primary_instructor_id UUID NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_source VARCHAR(32) NOT NULL DEFAULT 'ACADEMIC_ASSIGNED', -- ACADEMIC_ASSIGNED, APPROVED_REQUEST, SELF_ENROLLED
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subject_class_student UNIQUE (subject_class_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    room_or_link VARCHAR(512),
    scheduled_start_at TIMESTAMPTZ NOT NULL,
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_at TIMESTAMPTZ NULL,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    assessment_type VARCHAR(32) NOT NULL DEFAULT 'QUIZ',
    total_points NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(32) NOT NULL, -- ASSIGNMENT, ASSESSMENT, FORUM_GRADED
    source_id UUID NOT NULL,
    score NUMERIC(6,2) NOT NULL,
    max_score NUMERIC(6,2) NOT NULL DEFAULT 100.00,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_grade_source_student UNIQUE (subject_class_id, student_id, source_type, source_id)
);

COMMIT;
