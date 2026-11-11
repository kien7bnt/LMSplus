# 06. THIẾT KẾ CƠ SỞ DỮ LIỆU CHI TIẾT (POSTGRESQL DATABASE DESIGN)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Hệ quản trị CSDL:** PostgreSQL 15+
> **Tài liệu liên quan:** [`01-current-system-audit.md`](./01-current-system-audit.md), [`07-erd.md`](./07-erd.md)

---

## 1. Quy ước Thiết kế & Tích hợp với LMSPLUS (Conventions & Bridge Rules)

1. **Không tạo trùng bảng lõi của LMSPLUS:**
   - Các bảng đã có trong LMSPLUS gồm: `users`, `roles`, `permissions`, `courses`, `subjects`, `classes` (hoặc `course_classes` / `subject_classes`), `class_sessions`, `question_bank`, `assessments`, `assignments`, `grades`, `notifications`.
   - Mọi bảng mới của phân hệ E-Learning đều tham chiếu khóa ngoại (`FK`) trực tiếp tới các bảng lõi này.
2. **Chuẩn Kiểu dữ liệu & Audit Columns:**
   - Khóa chính (`PK`): Sử dụng `UUID DEFAULT gen_random_uuid()` (hoặc `BIGINT` nếu bảng gốc của LMSPLUS dùng `BIGINT` — xem ghi chú tương thích trong migration).
   - Thời gian: Luôn dùng `TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
   - Cột Audit chuẩn trên mọi bảng nghiệp vụ:
     - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
     - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
     - `created_by UUID REFERENCES users(id)`
     - `updated_by UUID REFERENCES users(id)`
     - `deleted_at TIMESTAMPTZ NULL` (Hỗ trợ Soft Delete kèm Partial Index `WHERE deleted_at IS NULL`).

---

## 2. Thiết kế Bảng Chi tiết theo 9 Domain Nghiệp vụ

### DOMAIN 1: Cấu trúc Chương trình học & Ánh xạ Lớp học (`Curriculum & Class Mapping`)

> **Nguyên tắc:** Tách biệt hoàn toàn **Khung chương trình chuẩn (`Course → Subject → Topic → Chapter → Lesson`)** với **Không gian Lớp triển khai (`CourseClass`, `SubjectClass`, `ClassSession`)**.

#### 1.1. Bảng `course_elearning_settings` & `course_enrollment_requests` (Cấu hình Chính sách Khám phá & Đăng ký Khóa học)
> Đáp ứng mô hình kết hợp 3 chế độ tham gia riêng cho từng khóa học (`ASSIGNED_ONLY` mặc định, `REQUEST_APPROVAL`, và `SELF_ENROLL` chỉ do Admin bật) mà không làm xáo trộn cơ chế phân lớp gốc của LMSPLUS.
```sql
CREATE TABLE course_elearning_settings (
    course_id UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    enrollment_policy VARCHAR(32) NOT NULL DEFAULT 'ASSIGNED_ONLY',
    -- ASSIGNED_ONLY (Mặc định: chỉ học viên được Giáo vụ phân lớp),
    -- REQUEST_APPROVAL (Học viên gửi yêu cầu và chờ duyệt),
    -- SELF_ENROLL (Chỉ Admin mới được quyền bật cho phép tự đăng ký)
    default_target_course_class_id UUID NULL REFERENCES course_classes(id) ON DELETE SET NULL,
    allow_preview_syllabus BOOLEAN NOT NULL DEFAULT TRUE,
    self_enroll_enabled_by UUID NULL REFERENCES users(id), -- Audit: Admin nào đã bật SELF_ENROLL
    self_enroll_enabled_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id),
    CONSTRAINT chk_enrollment_policy CHECK (
        enrollment_policy IN ('ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL')
    )
);

CREATE TABLE course_enrollment_requests (
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
    CONSTRAINT uq_student_course_pending_req UNIQUE (course_id, student_id)
);
CREATE INDEX idx_enrollment_requests_status ON course_enrollment_requests(course_id, status);
```

#### 1.2. Bảng `course_subjects` (Liên kết Khóa học — Môn học)
*(Nếu LMSPLUS đã có bảng này thì tái sử dụng; nếu chưa có thì khởi tạo)*
```sql
CREATE TABLE IF NOT EXISTS course_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    semester_order SMALLINT NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    credits NUMERIC(4,1) NOT NULL DEFAULT 3.0,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_course_subject UNIQUE (course_id, subject_id)
);
CREATE INDEX idx_course_subjects_course ON course_subjects(course_id) WHERE deleted_at IS NULL;
```

#### 1.2. Bảng `topics` (Chủ đề thuộc Môn học)
```sql
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_topic_subject_code UNIQUE (subject_id, code)
);
CREATE INDEX idx_topics_subject_order ON topics(subject_id, sort_order) WHERE deleted_at IS NULL;
```

#### 1.3. Bảng `chapters` (Chương học thuộc Chủ đề / Môn học)
```sql
CREATE TABLE chapters (
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
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_chapters_topic_order ON chapters(topic_id, sort_order) WHERE deleted_at IS NULL;
```

#### 1.4. Bảng `lessons` (Bài học thuộc Chương)
```sql
CREATE TABLE lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    lesson_type VARCHAR(32) NOT NULL DEFAULT 'MIXED', -- VIDEO, READING, INTERACTIVE, LAB, MIXED
    estimated_minutes INTEGER NOT NULL DEFAULT 30,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    published_version_id UUID NULL, -- FK trỏ tới lesson_versions(id) đang active
    working_draft_revision INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    is_free_preview BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_lessons_chapter_order ON lessons(chapter_id, sort_order) WHERE deleted_at IS NULL;
```

#### 1.5. Bảng `lesson_prerequisites` (Điều kiện Bài học Tiên quyết)
```sql
CREATE TABLE lesson_prerequisites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    required_lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    min_score_pct NUMERIC(5,2) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT uq_lesson_prereq UNIQUE (lesson_id, required_lesson_id),
    CONSTRAINT chk_no_self_prereq CHECK (lesson_id <> required_lesson_id)
);
```

#### 1.6. Bảng `lesson_sessions` (Gắn Bài học vào Buổi học của Lớp môn học — Quan hệ N-N)
> Một buổi học (`class_sessions`) có thể dạy nhiều bài học (`lessons`), và một bài học dài có thể được dạy trải qua nhiều buổi học.
```sql
CREATE TABLE lesson_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    planned_order SMALLINT NOT NULL DEFAULT 1,
    planned_coverage VARCHAR(32) NOT NULL DEFAULT 'FULL', -- FULL, PART_1, PART_2
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT uq_session_lesson UNIQUE (class_session_id, lesson_id)
);
CREATE INDEX idx_lesson_sessions_class ON lesson_sessions(subject_class_id, class_session_id);
```

---

### DOMAIN 2: Quản lý Nội dung & Notion-Style Block Editor (`Content & Versioning`)

#### 2.1. Bảng `shared_blocks` (Khối Nội dung Dùng chung giữa nhiều Bài học)
```sql
CREATE TABLE shared_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    block_type VARCHAR(64) NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    content_json JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED
    version_number INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
```

#### 2.2. Bảng `lesson_blocks` (Các Khối Nội dung của Bài học — Bản nháp đang soạn)
```sql
CREATE TABLE lesson_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    parent_block_id UUID NULL REFERENCES lesson_blocks(id) ON DELETE CASCADE,
    shared_block_id UUID NULL REFERENCES shared_blocks(id) ON DELETE SET NULL,
    block_type VARCHAR(64) NOT NULL,
    -- heading, paragraph, list, quote, divider, accordion, tabs,
    -- callout, latex_math, table, step_by_step_solution,
    -- inline_mcq, true_false, form_poll, quick_check,
    -- image, video, audio, diagram_mermaid, attachment, code_block
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    content_json JSONB NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, HIDDEN, DRAFT_ONLY
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_lesson_blocks_lesson_order ON lesson_blocks(lesson_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_lesson_blocks_json_gin ON lesson_blocks USING GIN (content_json);
```

#### 2.3. Bảng `lesson_versions` (Lịch sử Phiên bản & Snapshot Xuất bản Bài học)
```sql
CREATE TABLE lesson_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED', -- DRAFT_SNAPSHOT, PUBLISHED, SUPERSEDED
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    blocks_snapshot_json JSONB NOT NULL, -- Toàn bộ mảng blocks bất biến tại thời điểm publish
    changelog_note TEXT,
    published_at TIMESTAMPTZ NULL,
    published_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT uq_lesson_version_num UNIQUE (lesson_id, version_number)
);
CREATE INDEX idx_lesson_versions_lookup ON lesson_versions(lesson_id, version_status);
```

#### 2.4. Bảng `learning_resources` & `lesson_attachments` (Kho Học liệu & Đính kèm)
```sql
CREATE TABLE learning_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    resource_type VARCHAR(32) NOT NULL, -- VIDEO, AUDIO, PDF, SLIDE, DATASET, ARCHIVE, EXTERNAL_LINK
    storage_provider VARCHAR(32) NOT NULL DEFAULT 'S3_COMPATIBLE', -- LOCAL, S3_COMPATIBLE, EXTERNAL
    storage_key VARCHAR(1024) NOT NULL,
    mime_type VARCHAR(128),
    file_size_bytes BIGINT,
    duration_seconds INTEGER NULL,
    checksum_sha256 VARCHAR(64),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'READY', -- PROCESSING, READY, FAILED, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE lesson_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES learning_resources(id) ON DELETE RESTRICT,
    display_title VARCHAR(255) NOT NULL,
    is_downloadable BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    CONSTRAINT uq_lesson_resource UNIQUE (lesson_id, resource_id)
);
```

---

### DOMAIN 3: Hệ thống Wiki Thuật ngữ (`Academic Wiki`)

> Hỗ trợ liên kết theo `term_id`, nhiều tên gọi đồng nghĩa (`WikiAliases`), nhiều nghĩa theo ngữ cảnh môn học (`subject_id`) và quy trình duyệt `DRAFT / PUBLISHED`.

```sql
CREATE TABLE wiki_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wiki_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL, -- NULL = Thuật ngữ chung toàn trường; Có giá trị = Nghĩa chuyên biệt theo môn học
    category_id UUID NULL REFERENCES wiki_categories(id) ON DELETE SET NULL,
    short_definition TEXT NOT NULL,
    detailed_content_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- Hỗ trợ định dạng Block/LaTeX
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PENDING_REVIEW, PUBLISHED, ARCHIVED
    current_revision_id UUID NULL,
    approved_by UUID NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_wiki_term_subject_slug UNIQUE NULLS NOT DISTINCT (subject_id, slug)
);
CREATE INDEX idx_wiki_terms_search ON wiki_terms(canonical_name, status) WHERE deleted_at IS NULL;

CREATE TABLE wiki_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    alias_name VARCHAR(255) NOT NULL,
    language_code VARCHAR(10) NOT NULL DEFAULT 'vi', -- vi, en, abbr
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_term_alias UNIQUE (term_id, alias_name)
);
CREATE INDEX idx_wiki_aliases_lookup ON wiki_aliases(LOWER(alias_name));

CREATE TABLE wiki_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    target_term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    relation_type VARCHAR(32) NOT NULL, -- SYNONYM, ANTONYM, PARENT_CONCEPT, RELATED_TO, PREREQUISITE_CONCEPT
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wiki_relation UNIQUE (source_term_id, target_term_id, relation_type)
);

CREATE TABLE wiki_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    short_definition TEXT NOT NULL,
    detailed_content_json JSONB NOT NULL,
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    CONSTRAINT uq_wiki_term_rev UNIQUE (term_id, revision_number)
);

CREATE TABLE lesson_term_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    block_id UUID NULL REFERENCES lesson_blocks(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lesson_block_term UNIQUE NULLS NOT DISTINCT (lesson_id, block_id, term_id)
);
```

---

### DOMAIN 4: Tiến độ Học tập & Điều kiện Mở khóa (`Progress & Unlock Engine`)

```sql
CREATE TABLE completion_rules (
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

CREATE TABLE lesson_unlock_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE, -- NULL = Mặc định cho mọi lớp; Có giá trị = Ghi đè riêng cho lớp
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    condition_type VARCHAR(32) NOT NULL, -- PREVIOUS_LESSON_COMPLETED, SPECIFIC_DATE, ASSESSMENT_PASSED, INSTRUCTOR_MANUAL_UNLOCK
    required_lesson_id UUID NULL REFERENCES lessons(id) ON DELETE CASCADE,
    required_assessment_id UUID NULL REFERENCES assessments(id) ON DELETE CASCADE,
    min_score_pct NUMERIC(5,2) NULL,
    unlock_at TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lesson_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED', -- NOT_STARTED, IN_PROGRESS, COMPLETED
    progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    watched_seconds INTEGER NOT NULL DEFAULT 0,
    last_video_position_sec INTEGER NOT NULL DEFAULT 0,
    watched_segments_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- VD: [[0, 120], [150, 340]] chống tua nhanh ăn gian
    last_read_block_id UUID NULL,
    opened_attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    quick_check_score_pct NUMERIC(5,2) NULL,
    started_at TIMESTAMPTZ NULL,
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_student_class_lesson_progress UNIQUE (student_id, subject_class_id, lesson_id)
);
CREATE INDEX idx_lesson_progress_resume ON lesson_progress(student_id, last_accessed_at DESC);
CREATE INDEX idx_lesson_progress_class ON lesson_progress(subject_class_id, student_id);

CREATE TABLE course_progress (
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

CREATE TABLE learning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL UNIQUE, -- Chống tính trùng sự kiện khi mạng chập chờn retry
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    -- VIDEO_HEARTBEAT, VIDEO_COMPLETED, BLOCK_READ, ATTACHMENT_OPENED,
    -- QUICK_CHECK_ANSWERED, ASSIGNMENT_SUBMITTED, ASSESSMENT_FINISHED, LESSON_COMPLETED
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_learning_events_student_time ON learning_events(student_id, occurred_at DESC);
```

---

### DOMAIN 5: Mở rộng Bài tập & Bài kiểm tra (`Assignment & Assessment Extension`)

> **Tái sử dụng bảng `assignments` và `assessments` của LMSPLUS**, chỉ bổ sung bảng cấu hình liên kết E-Learning và lịch sử nộp bài nhiều lần.

```sql
CREATE TABLE assignment_elearning_configs (
    assignment_id UUID PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    chapter_id UUID NULL REFERENCES chapters(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL, -- NULL = Bài tập ngoài chương trình; Có giá trị = Bài tập gắn bài học
    assignment_scope VARCHAR(32) NOT NULL DEFAULT 'IN_CURRICULUM', -- IN_CURRICULUM, STANDALONE_EXTRA
    max_attempts INTEGER NOT NULL DEFAULT 3,
    allow_late_submission BOOLEAN NOT NULL DEFAULT TRUE,
    late_penalty_pct_per_day NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    grading_strategy VARCHAR(32) NOT NULL DEFAULT 'LATEST_SUBMISSION', -- LATEST_SUBMISSION, HIGHEST_SCORE
    rubric_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number SMALLINT NOT NULL DEFAULT 1,
    submission_text TEXT,
    attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED',
    -- DRAFT, SUBMITTED, LATE_SUBMITTED, GRADED, RETURNED_FOR_REVISION
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
CREATE INDEX idx_submissions_grading_queue ON assignment_submissions(assignment_id, status);

CREATE TABLE assessment_elearning_links (
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
```

---

### DOMAIN 6: Diễn đàn Học thuật (`Academic Forums`)

```sql
CREATE TABLE forums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    -- Nếu subject_class_id IS NULL và forum_scope = 'SUBJECT_SHARED' -> Diễn đàn dùng chung cho nhiều lớp cùng môn
    forum_scope VARCHAR(32) NOT NULL DEFAULT 'CLASS_ONLY', -- CLASS_ONLY, SUBJECT_SHARED
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE forum_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    category_type VARCHAR(32) NOT NULL DEFAULT 'QA', -- QA, DISCUSSION, GRADED_DISCUSSION, ANNOUNCEMENT
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE forum_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES forum_categories(id) ON DELETE RESTRICT,
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL, -- Gắn với bài học cụ thể
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    topic_type VARCHAR(32) NOT NULL DEFAULT 'QA', -- QA, DISCUSSION, GRADED_DISCUSSION, ANNOUNCEMENT
    title VARCHAR(300) NOT NULL,
    body_json JSONB NOT NULL,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    is_graded BOOLEAN NOT NULL DEFAULT FALSE,
    max_score NUMERIC(6,2) NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED', -- PUBLISHED, HIDDEN_BY_MOD, DELETED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_forum_topics_feed ON forum_topics(forum_id, is_pinned DESC, last_activity_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE forum_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
    parent_reply_id UUID NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
    depth_level SMALLINT NOT NULL DEFAULT 1, -- Giới hạn tối đa 2 cấp (1 hoặc 2)
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body_json JSONB NOT NULL,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    is_instructor_endorsed BOOLEAN NOT NULL DEFAULT FALSE,
    awarded_score NUMERIC(6,2) NULL, -- Phục vụ thảo luận có chấm điểm
    graded_by UUID NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED', -- PUBLISHED, HIDDEN_BY_MOD, DELETED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_max_reply_depth CHECK (depth_level IN (1, 2))
);
CREATE INDEX idx_forum_replies_topic ON forum_replies(topic_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE forum_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_topic_sub UNIQUE (topic_id, user_id)
);

CREATE TABLE forum_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16) NOT NULL, -- TOPIC, REPLY
    target_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(24) NOT NULL DEFAULT ' HELPFUL', -- HELPFUL, UPVOTE, THANKS
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_forum_reaction UNIQUE (target_type, target_id, user_id, reaction_type)
);

CREATE TABLE forum_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16) NOT NULL, -- TOPIC, REPLY
    target_id UUID NOT NULL,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason_code VARCHAR(32) NOT NULL, -- SPAM, INAPPROPRIATE, PLAGIARISM, OFF_TOPIC
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, RESOLVED, DISMISSED
    resolved_by UUID NULL REFERENCES users(id),
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE forum_moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    target_type VARCHAR(16) NOT NULL,
    target_id UUID NOT NULL,
    moderator_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(32) NOT NULL, -- PIN, UNPIN, LOCK, UNLOCK, HIDE, RESTORE, ENDORSE
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### DOMAIN 7: Điểm danh, Đơn xin nghỉ & Học bù (`Attendance, Leave & Make-up`)

```sql
CREATE TABLE attendance_qr_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    secret_seed VARCHAR(128) NOT NULL, -- Dùng để sinh mã TOTP/HMAC xoay vòng mỗi 20 giây
    rotation_interval_sec SMALLINT NOT NULL DEFAULT 20,
    late_threshold_minutes SMALLINT NOT NULL DEFAULT 15,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_requests (
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

CREATE TABLE make_up_sessions (
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

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status VARCHAR(32) NOT NULL,
    -- PRESENT (Có mặt), LATE (Đi muộn), EARLY_LEAVE (Về sớm),
    -- EXCUSED_ABSENCE (Vắng có phép), UNEXCUSED_ABSENCE (Vắng không phép), MAKEUP (Học bù)
    check_in_method VARCHAR(32) NOT NULL DEFAULT 'MANUAL', -- MANUAL, DYNAMIC_QR, ZOOM_SYNC, MEET_SYNC, LEAVE_APPROVED
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
CREATE INDEX idx_attendance_class_student ON attendance_records(subject_class_id, student_id);

CREATE TABLE attendance_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_request_id UUID NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    attendance_record_id UUID NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
    file_storage_key VARCHAR(1024) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128),
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NOT NULL,
    change_reason TEXT NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### DOMAIN 8: Nhật ký Giảng dạy & Phân công Trợ giảng (`Teaching Logs & Staff Assignments`)

> **Tách biệt hoàn toàn** việc ghi nhận giờ giảng/tiến độ dạy của Giảng viên (`teaching_logs`) với trạng thái điểm danh của Học viên (`attendance_records`).

```sql
CREATE TABLE teaching_staff_assignments (
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
    assigned_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_class_staff_role UNIQUE (subject_class_id, user_id, staff_role)
);

CREATE TABLE teaching_session_status (
    class_session_id UUID PRIMARY KEY REFERENCES class_sessions(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    scheduled_end_at TIMESTAMPTZ NOT NULL, -- Sao lưu mốc kết thúc buổi học để tính hạn 24h
    confirmation_deadline_at TIMESTAMPTZ NOT NULL, -- Mặc định = scheduled_end_at + INTERVAL '24 hours'
    operational_status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    -- SCHEDULED, IN_PROGRESS, AWAITING_CONFIRMATION, CONFIRMED,
    -- OVERDUE_UNCONFIRMED (Sau 24h chưa xác nhận - vẫn cho phép giảng viên xác nhận muộn),
    -- CONFIRMED_LATE (Đã xác nhận sau mốc 24h), CANCELLED, MAKEUP_SESSION
    overdue_flagged_at TIMESTAMPTZ NULL,
    confirmed_at TIMESTAMPTZ NULL,
    confirmed_by UUID NULL REFERENCES users(id),
    is_late_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent_count SMALLINT NOT NULL DEFAULT 0,
    last_reminder_sent_at TIMESTAMPTZ NULL,
    last_reminder_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_teaching_session_overdue ON teaching_session_status(operational_status, confirmation_deadline_at)
    WHERE operational_status IN ('AWAITING_CONFIRMATION', 'OVERDUE_UNCONFIRMED');

CREATE TABLE teaching_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL UNIQUE REFERENCES class_sessions(id) ON DELETE CASCADE,
    subject_class_id UUID NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    scheduled_instructor_id UUID NOT NULL REFERENCES users(id),
    actual_instructor_id UUID NOT NULL REFERENCES users(id), -- Cho phép ghi nhận Giảng viên dạy thay
    is_substitute_teaching BOOLEAN NOT NULL DEFAULT FALSE,
    substituting_reason TEXT,
    assistant_user_ids UUID[] NOT NULL DEFAULT '{}', -- Danh sách Trợ giảng tham gia buổi dạy
    scheduled_end_at TIMESTAMPTZ NOT NULL, -- Thời điểm kết thúc buổi học theo lịch
    actual_start_at TIMESTAMPTZ NOT NULL,
    actual_end_at TIMESTAMPTZ NOT NULL,
    confirmation_deadline_at TIMESTAMPTZ NOT NULL, -- scheduled_end_at + INTERVAL '24 hours'
    session_category VARCHAR(32) NOT NULL DEFAULT 'REGULAR', -- REGULAR, MAKEUP, CANCELLED
    general_notes TEXT,
    handover_notes_for_next_session TEXT,
    confirmation_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    -- DRAFT, AWAITING_CONFIRMATION, OVERDUE_UNCONFIRMED, CONFIRMED, CONFIRMED_LATE
    is_late_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    late_confirmation_reason TEXT NULL,
    confirmed_at TIMESTAMPTZ NULL, -- Thời điểm xác nhận thực tế
    confirmed_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);
CREATE INDEX idx_teaching_logs_instructor ON teaching_logs(actual_instructor_id, actual_start_at DESC);

CREATE TABLE teaching_log_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teaching_log_id UUID NOT NULL REFERENCES teaching_logs(id) ON DELETE CASCADE,
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
    delivery_status VARCHAR(32) NOT NULL, -- COMPLETED (Đã dạy xong), PARTIAL (Dạy một phần), DEFERRED (Chưa kịp dạy)
    stopped_at_block_id UUID NULL,
    progress_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_teaching_log_lesson UNIQUE (teaching_log_id, lesson_id)
);

CREATE TABLE teaching_log_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teaching_log_id UUID NOT NULL REFERENCES teaching_logs(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL, -- CREATED, UPDATED, CONFIRMED, OVERDUE_FLAGGED, REOPENED
    snapshot_json JSONB NOT NULL,
    reason TEXT,
    actor_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### DOMAIN 9: Tích hợp Bên ngoài (`External Integrations — Zoom, Meet, Media, STT`)

> **Bảo mật bắt buộc:** Không bao giờ lưu API Key, Client Secret hay Refresh Token dưới dạng plaintext. Cột `encrypted_credentials_ciphertext` lưu dữ liệu đã mã hóa bằng **AES-256-GCM (Envelope Encryption)** với khóa Master Key nằm trong biến môi trường/Vault của server.

```sql
CREATE TABLE external_integration_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(32) NOT NULL, -- ZOOM, GOOGLE_MEET, S3_STORAGE, WHISPER_STT, SMTP_PUSH
    account_label VARCHAR(120) NOT NULL,
    public_config_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Chỉ chứa endpoint, bucket, region, client_id công khai
    encrypted_credentials_ciphertext BYTEA NOT NULL, -- Đã mã hóa AES-256-GCM
    encryption_key_id VARCHAR(64) NOT NULL, -- Phục vụ xoay vòng khóa (Key Rotation)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE online_meeting_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    integration_config_id UUID NOT NULL REFERENCES external_integration_configs(id),
    provider VARCHAR(32) NOT NULL, -- ZOOM, GOOGLE_MEET
    external_meeting_id VARCHAR(128) NOT NULL,
    join_url VARCHAR(1024) NOT NULL,
    host_start_url VARCHAR(1024),
    passcode_encrypted BYTEA NULL,
    sync_status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, SYNCED, FAILED
    last_synced_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE video_recordings (
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

CREATE TABLE media_transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_recording_id UUID NOT NULL REFERENCES video_recordings(id) ON DELETE CASCADE,
    language_code VARCHAR(10) NOT NULL DEFAULT 'vi',
    stt_provider VARCHAR(32) NOT NULL DEFAULT 'WHISPER_V3',
    vtt_storage_key VARCHAR(1024) NOT NULL,
    segments_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{start_sec, end_sec, text}] phục vụ tìm kiếm trong video
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Kế hoạch Migration An toàn & Phương án Rollback (`Migration Plan`)

Quá trình triển khai cơ sở dữ liệu được chia thành **5 file Migration độc lập theo thứ tự phụ thuộc**, đảm bảo có thể rollback từng bước mà không ảnh hưởng dữ liệu hiện tại của LMSPLUS:

| Thứ tự | Mã Migration | Các bảng khởi tạo / cập nhật | Chiến lược Rollback (`DOWN`) |
| :---: | :--- | :--- | :--- |
| **M01** | `20261110_01_curriculum_structure` | `course_subjects`, `topics`, `chapters`, `lessons`, `lesson_prerequisites`, `lesson_sessions` | `DROP TABLE IF EXISTS lesson_sessions, lesson_prerequisites, lessons, chapters, topics;` |
| **M02** | `20261110_02_blocks_and_wiki` | `shared_blocks`, `lesson_blocks`, `lesson_versions`, `learning_resources`, `lesson_attachments`, `wiki_*`, `lesson_term_links` | Gỡ FK `published_version_id` trên `lessons`, sau đó `DROP TABLE` theo thứ tự ngược lại. |
| **M03** | `20261110_03_progress_and_assessments` | `completion_rules`, `lesson_unlock_conditions`, `lesson_progress`, `course_progress`, `learning_events`, `assignment_elearning_configs`, `assignment_submissions`, `assessment_elearning_links` | `DROP TABLE` các bảng mở rộng; bảng `assignments`, `assessments`, `grades` gốc của LMSPLUS giữ nguyên 100%. |
| **M04** | `20261110_04_forums_and_moderation` | `forums`, `forum_categories`, `forum_topics`, `forum_replies`, `forum_subscriptions`, `forum_reactions`, `forum_reports`, `forum_moderation_logs` | `DROP TABLE` toàn bộ cụm bảng `forum_*`. |
| **M05** | `20261110_05_attendance_teaching_logs_integrations` | `attendance_*`, `leave_requests`, `make_up_sessions`, `teaching_*`, `external_integration_configs`, `online_meeting_sessions`, `video_recordings`, `media_transcriptions` | `DROP TABLE` các bảng mở rộng; bảng `class_sessions` gốc của LMSPLUS không bị thay đổi. |
