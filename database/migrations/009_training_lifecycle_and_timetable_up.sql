-- ============================================================================
-- MIGRATION 009 (UP): COMPLETE TRAINING LIFECYCLE, CURRICULUM VERSIONING,
--                     SMART TIMETABLING (6 HARD CONSTRAINTS) & TEACHING HOURS
-- ============================================================================

BEGIN;

-- 1.1 Môn học mở rộng (Subjects / Courses)
ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS outcomes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS reference_tuition_fee NUMERIC(12,0) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS theory_periods INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS practice_periods INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS self_study_periods INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS minutes_per_period SMALLINT NOT NULL DEFAULT 45,
    ADD COLUMN IF NOT EXISTS required_room_type VARCHAR(32) NOT NULL DEFAULT 'THEORY_ROOM',
    ADD COLUMN IF NOT EXISTS grading_scale NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    ADD COLUMN IF NOT EXISTS pass_score NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    ADD COLUMN IF NOT EXISTS exam_conditions_json JSONB NOT NULL DEFAULT '{"min_attendance_pct":70,"require_all_mandatory_assignments":true}'::jsonb,
    ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN IF NOT EXISTS version_code VARCHAR(32) NOT NULL DEFAULT 'v2026.1';

CREATE TABLE IF NOT EXISTS subject_prerequisites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    prerequisite_subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subject_prerequisite UNIQUE (subject_id, prerequisite_subject_id),
    CONSTRAINT chk_no_self_prerequisite CHECK (subject_id <> prerequisite_subject_id)
);

CREATE TABLE IF NOT EXISTS subject_assessment_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    weight_pct NUMERIC(5,2) NOT NULL,
    source_type VARCHAR(32) NOT NULL, -- ATTENDANCE, ASSIGNMENT, EXAM, EXAM_MATRIX, MANUAL
    source_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE learning_resources
    ADD COLUMN IF NOT EXISTS usage_type VARCHAR(24) NOT NULL DEFAULT 'MANDATORY',
    ADD COLUMN IF NOT EXISTS tags_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE assignment_bank_items
    ADD COLUMN IF NOT EXISTS relative_due_days INTEGER NULL,
    ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN NOT NULL DEFAULT TRUE;

-- 1.2 Khung chương trình (Curricula)
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS program_type VARCHAR(32) NOT NULL DEFAULT 'INSTRUCTOR_LED',
    ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(32) NOT NULL DEFAULT 'HYBRID',
    ADD COLUMN IF NOT EXISTS standard_duration_months NUMERIC(5,1) NOT NULL DEFAULT 6.0,
    ADD COLUMN IF NOT EXISTS standard_duration_text VARCHAR(100) DEFAULT '6 tháng',
    ADD COLUMN IF NOT EXISTS entry_requirements TEXT,
    ADD COLUMN IF NOT EXISTS auto_tuition_fee NUMERIC(12,0) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_tuition_fee NUMERIC(12,0) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_tuition_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS graduation_criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED';

CREATE TABLE IF NOT EXISTS curriculum_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    stage_type VARCHAR(32) NOT NULL DEFAULT 'SEMESTER',
    sort_order INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curriculum_service_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    amount NUMERIC(12,0) NOT NULL DEFAULT 0,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    sort_order INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(32) NOT NULL DEFAULT 'COURSE',
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    curriculum_id UUID NULL REFERENCES courses(id) ON DELETE CASCADE,
    session_order INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 90,
    periods_count NUMERIC(5,2) NOT NULL DEFAULT 2.0,
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
    required_room_type VARCHAR(32) NOT NULL DEFAULT 'THEORY_ROOM',
    lesson_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curriculum_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curriculum_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_label VARCHAR(64) NOT NULL,
    snapshot_json JSONB NOT NULL,
    changelog_note TEXT,
    published_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_curriculum_version_num UNIQUE (curriculum_id, version_number)
);

CREATE TABLE IF NOT EXISTS certificate_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    issuer_name VARCHAR(255) NOT NULL DEFAULT 'Trung tâm Đào tạo LMSPLUS',
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
);

-- 2.1 Hạ tầng Thời khóa biểu & Cơ sở vật chất
CREATE TABLE IF NOT EXISTS campuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    address TEXT,
    open_time VARCHAR(8) NOT NULL DEFAULT '07:00',
    close_time VARCHAR(8) NOT NULL DEFAULT '21:30',
    travel_buffers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    room_type VARCHAR(32) NOT NULL DEFAULT 'THEORY_ROOM',
    capacity INTEGER NOT NULL DEFAULT 40,
    equipment_note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shift_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    start_time VARCHAR(8) NOT NULL,
    end_time VARCHAR(8) NOT NULL,
    periods_count NUMERIC(4,1) NOT NULL DEFAULT 2.0,
    sort_order INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS academic_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id UUID NULL REFERENCES campuses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_recurring_yearly BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instructor_availabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rule_type VARCHAR(24) NOT NULL DEFAULT 'WEEKLY', -- WEEKLY, DATE
    weekday SMALLINT NULL,
    specific_date DATE NULL,
    start_time VARCHAR(8) NOT NULL,
    end_time VARCHAR(8) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'BUSY', -- AVAILABLE, BUSY
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE class_sessions
    ADD COLUMN IF NOT EXISTS campus_id UUID NULL REFERENCES campuses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS classroom_id UUID NULL REFERENCES classrooms(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shift_code VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS schedule_state VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN IF NOT EXISTS planned_periods NUMERIC(5,2) NOT NULL DEFAULT 2.0,
    ADD COLUMN IF NOT EXISTS actual_periods NUMERIC(5,2) NULL,
    ADD COLUMN IF NOT EXISTS hour_category VARCHAR(24) NOT NULL DEFAULT 'THEORY',
    ADD COLUMN IF NOT EXISTS merged_group_code VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS session_kind VARCHAR(24) NOT NULL DEFAULT 'REGULAR',
    ADD COLUMN IF NOT EXISTS rescheduled_from_session_id UUID NULL,
    ADD COLUMN IF NOT EXISTS actual_instructor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS substitute_reason TEXT NULL,
    ADD COLUMN IF NOT EXISTS timesheet_locked_id UUID NULL;

CREATE TABLE IF NOT EXISTS session_lessons (
    session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 10,
    PRIMARY KEY (session_id, lesson_id)
);

-- 2.2 Định mức & Chốt giờ giảng
CREATE TABLE IF NOT EXISTS instructor_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_key VARCHAR(32) NOT NULL, -- YYYY-MM hoặc học kỳ
    standard_periods NUMERIC(6,2) NOT NULL DEFAULT 40.00,
    standard_hours NUMERIC(6,2) NOT NULL DEFAULT 30.00,
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_instructor_quota_period UNIQUE (instructor_id, period_key)
);

CREATE TABLE IF NOT EXISTS teaching_timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_month VARCHAR(16) NOT NULL,
    instructor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    department_id UUID NULL,
    total_sessions INTEGER NOT NULL DEFAULT 0,
    regular_sessions INTEGER NOT NULL DEFAULT 0,
    substitute_sessions INTEGER NOT NULL DEFAULT 0,
    makeup_sessions INTEGER NOT NULL DEFAULT 0,
    cancelled_sessions INTEGER NOT NULL DEFAULT 0,
    theory_periods NUMERIC(6,2) NOT NULL DEFAULT 0,
    practice_periods NUMERIC(6,2) NOT NULL DEFAULT 0,
    online_periods NUMERIC(6,2) NOT NULL DEFAULT 0,
    total_periods NUMERIC(6,2) NOT NULL DEFAULT 0,
    total_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
    quota_hours NUMERIC(6,2) NOT NULL DEFAULT 30,
    overtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_TEACHER',
    teacher_note TEXT,
    review_note TEXT,
    teacher_confirmed_at TIMESTAMPTZ NULL,
    approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NULL,
    locked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ NULL,
    finance_batch_code VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_timesheet_month_instructor UNIQUE (period_month, instructor_id)
);

CREATE TABLE IF NOT EXISTS teaching_timesheet_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timesheet_id UUID NOT NULL REFERENCES teaching_timesheets(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    subject_class_id UUID NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    course_code VARCHAR(64),
    course_title VARCHAR(255),
    session_title VARCHAR(255) NOT NULL,
    session_date DATE NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    hour_category VARCHAR(24) NOT NULL DEFAULT 'THEORY',
    role_kind VARCHAR(24) NOT NULL DEFAULT 'PRIMARY',
    periods NUMERIC(5,2) NOT NULL DEFAULT 0,
    hours NUMERIC(5,2) NOT NULL DEFAULT 0
);

COMMIT;
