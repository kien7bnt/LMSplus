-- ============================================================================
-- MIGRATION 007 (UP): LESSON STUDIO, VIDEO UPLOAD STREAMING, QUESTION BANK,
--                     CLASS CONTENT CUSTOMIZATION & INTERACTIVE VIDEO QUIZZES
-- ============================================================================
-- Nguyên tắc:
--  1. Chỉ mở rộng không phá hủy (Additive-only) trên các bảng hiện hữu:
--     lessons, lesson_versions, learning_resources.
--  2. Tách bạch rõ ràng:
--     - Chế độ A (Giáo án gốc của Khóa học): chapters, lessons, lesson_blocks, lesson_versions.
--     - Chế độ B (Nội dung tùy biến riêng cho Lớp học): class_lesson_customs, class_lesson_blocks.
--     - Ngân hàng câu hỏi dùng chung theo Khóa học/Môn học: question_bank_items.
--     - Quiz tương tác gắn mốc thời gian trong Video: video_quiz_markers.
--     - Tiến độ xem video & Lịch sử nộp bài chống ghi trùng: video_watch_progress, lesson_quiz_submissions.
-- ============================================================================

BEGIN;

-- 1. Mở rộng bảng lessons & lesson_versions cho quy tắc hoàn thành video + quiz và snapshot marker
ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS min_video_watch_pct INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS require_video_quizzes BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'lessons'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%completion_rule%'
    LOOP
        EXECUTE format('ALTER TABLE lessons DROP CONSTRAINT %I', c.conname);
    END LOOP;
    ALTER TABLE lessons
        ADD CONSTRAINT lessons_completion_rule_check
        CHECK (completion_rule IN ('MANUAL', 'REVIEW_CORRECT', 'VIDEO_AND_QUIZ'));
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lesson_versions') THEN
        ALTER TABLE lesson_versions
            ADD COLUMN IF NOT EXISTS markers_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS change_note TEXT;
    END IF;
END $$;

-- 2. Mở rộng learning_resources hỗ trợ VIDEO, PDF, thời lượng, thumbnail và trạng thái xử lý
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_resources') THEN
        ALTER TABLE learning_resources
            ADD COLUMN IF NOT EXISTS class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'ENROLLED',
            ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(10,2) NULL,
            ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(1024) NULL,
            ADD COLUMN IF NOT EXISTS processing_status VARCHAR(32) NOT NULL DEFAULT 'READY',
            ADD COLUMN IF NOT EXISTS error_message TEXT NULL;
    END IF;
END $$;

-- 3. Phiên tải lên video theo từng phần (Chunked Video Upload Sessions) — không lưu nhị phân vào DB
CREATE TABLE IF NOT EXISTS video_upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    total_size_bytes BIGINT NOT NULL CHECK (total_size_bytes > 0),
    received_bytes BIGINT NOT NULL DEFAULT 0,
    chunks_received INTEGER NOT NULL DEFAULT 0,
    temp_path VARCHAR(1024) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'UPLOADING'
        CHECK (status IN ('UPLOADING', 'COMPLETED', 'CANCELLED', 'FAILED')),
    error_message TEXT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_video_uploads_course_status
    ON video_upload_sessions(course_id, status);

-- 4. Ngân hàng câu hỏi dùng chung cho cả Video Timestamp Quiz và Block Quiz độc lập
CREATE TABLE IF NOT EXISTS question_bank_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NULL REFERENCES courses(id) ON DELETE CASCADE,
    subject VARCHAR(128) NULL,
    question_type VARCHAR(32) NOT NULL
        CHECK (question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER')),
    prompt TEXT NOT NULL,
    options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    points NUMERIC(6,2) NOT NULL DEFAULT 1.00,
    explanation TEXT NULL,
    correct_feedback TEXT NULL,
    wrong_feedback TEXT NULL,
    difficulty VARCHAR(32) NOT NULL DEFAULT 'MEDIUM',
    tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_question_bank_course
    ON question_bank_items(course_id, deleted_at);

-- 5. Các mốc câu hỏi tương tác theo thời điểm trên Video (Interactive Video Quiz Markers)
CREATE TABLE IF NOT EXISTS video_quiz_markers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    block_id VARCHAR(64) NOT NULL,
    timestamp_sec NUMERIC(10,2) NOT NULL CHECK (timestamp_sec >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    behavior VARCHAR(32) NOT NULL DEFAULT 'PAUSE_AND_ASK'
        CHECK (behavior IN ('PAUSE_AND_ASK', 'PAUSE_OPTIONAL', 'INFO_ONLY')),
    title VARCHAR(255) NULL,
    info_body TEXT NULL,
    question_id UUID NULL REFERENCES question_bank_items(id) ON DELETE SET NULL,
    question_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    allow_skip BOOLEAN NOT NULL DEFAULT FALSE,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    show_answer_after_submit BOOLEAN NOT NULL DEFAULT TRUE,
    show_explanation BOOLEAN NOT NULL DEFAULT TRUE,
    allow_review BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_video_quiz_markers_lesson_block
    ON video_quiz_markers(lesson_id, block_id, timestamp_sec, sort_order);

-- 6. Chế độ B — Nội dung tùy biến riêng cho Lớp học (không sửa khóa học gốc)
CREATE TABLE IF NOT EXISTS class_lesson_customs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    instructor_note TEXT NULL,
    custom_objectives TEXT NULL,
    publish_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (publish_status IN ('DRAFT', 'PUBLISHED')),
    working_revision INTEGER NOT NULL DEFAULT 1,
    published_snapshot_json JSONB NULL,
    published_at TIMESTAMPTZ NULL,
    updated_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_class_lesson_custom UNIQUE (subject_class_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS class_lesson_blocks (
    id VARCHAR(64) PRIMARY KEY,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    anchor_block_id VARCHAR(64) NULL,
    block_type VARCHAR(64) NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.2',
    sort_order INTEGER NOT NULL DEFAULT 1000,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    content_json JSONB NOT NULL,
    created_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_class_lesson_blocks_lookup
    ON class_lesson_blocks(subject_class_id, lesson_id, sort_order);

-- 7. Tiến độ xem từng Video của Học viên (hỗ trợ Resume Playback chính xác)
CREATE TABLE IF NOT EXISTS video_watch_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    block_id VARCHAR(64) NOT NULL,
    last_position_sec NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_watched_sec NUMERIC(10,2) NOT NULL DEFAULT 0,
    watched_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
    duration_sec NUMERIC(10,2) NOT NULL DEFAULT 0,
    watch_pct INTEGER NOT NULL DEFAULT 0,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_class_video_block UNIQUE (student_id, subject_class_id, lesson_id, block_id)
);

-- 8. Lịch sử nộp câu trả lời Quiz (Video Marker & Quiz Block) có khóa chống gửi trùng idempotency_key
CREATE TABLE IF NOT EXISTS lesson_quiz_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    target_type VARCHAR(32) NOT NULL CHECK (target_type IN ('VIDEO_MARKER', 'QUIZ_BLOCK')),
    target_id VARCHAR(64) NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    response_json JSONB NOT NULL,
    grading_status VARCHAR(32) NOT NULL DEFAULT 'GRADED'
        CHECK (grading_status IN ('GRADED', 'PENDING_REVIEW')),
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    earned_points NUMERIC(6,2) NOT NULL DEFAULT 0,
    max_points NUMERIC(6,2) NOT NULL DEFAULT 1,
    feedback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_quiz_attempt UNIQUE (student_id, subject_class_id, target_type, target_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_lesson_quiz_submissions_lookup
    ON lesson_quiz_submissions(student_id, subject_class_id, lesson_id);

COMMIT;
