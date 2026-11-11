# 07. SƠ ĐỒ QUAN HỆ THỰC THỂ (ENTITY-RELATIONSHIP DIAGRAMS — ERD)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`06-database-design.md`](./06-database-design.md)

---

## 1. Sơ đồ ERD Tổng thể Liên Phân hệ (Master Overview ERD)

Sơ đồ dưới đây thể hiện mối quan hệ giữa các bảng lõi hiện có của **LMSPLUS** (`users`, `courses`, `subjects`, `course_classes`, `subject_classes`, `class_sessions`, `assignments`, `assessments`) và hệ sinh thái bảng mở rộng của **E-Learning**:

```mermaid
erDiagram
    COURSES ||--o{ COURSE_SUBJECTS : "chứa (1-N)"
    SUBJECTS ||--o{ COURSE_SUBJECTS : "thuộc (1-N)"
    COURSES ||--o{ COURSE_CLASSES : "mở lớp khóa học"
    SUBJECTS ||--o{ SUBJECT_CLASSES : "mở lớp môn học"
    COURSE_CLASSES ||--o{ SUBJECT_CLASSES : "bao gồm"

    SUBJECTS ||--o{ TOPICS : "chia thành"
    TOPICS ||--o{ CHAPTERS : "chia thành"
    CHAPTERS ||--o{ LESSONS : "chứa"
    LESSONS ||--o{ LESSON_VERSIONS : "lưu phiên bản"
    LESSONS ||--o{ LESSON_BLOCKS : "chứa khối nội dung"

    SUBJECT_CLASSES ||--o{ CLASS_SESSIONS : "có lịch học"
    CLASS_SESSIONS ||--o{ LESSON_SESSIONS : "dạy bài học (N-N)"
    LESSONS ||--o{ LESSON_SESSIONS : "được dạy trong"

    USERS ||--o{ LESSON_PROGRESS : "học tập"
    SUBJECT_CLASSES ||--o{ LESSON_PROGRESS : "ghi nhận tại"
    LESSONS ||--o{ LESSON_PROGRESS : "theo dõi"

    CLASS_SESSIONS ||--o{ ATTENDANCE_RECORDS : "điểm danh học viên"
    CLASS_SESSIONS ||--|| TEACHING_LOGS : "nhật ký giảng dạy (1-1)"
    TEACHING_LOGS ||--o{ TEACHING_LOG_LESSONS : "ghi nhận tiến độ bài dạy"
```

---

## 2. ERD Chi tiết từng Domain Nghiệp vụ

### 2.1. Domain 1 & 2: Cấu trúc Chương trình, Block Editor & Wiki Thuật ngữ

```mermaid
erDiagram
    SUBJECTS {
        uuid id PK
        varchar code
        varchar name
    }
    TOPICS {
        uuid id PK
        uuid subject_id FK
        varchar code
        varchar title
        int sort_order
        varchar status
    }
    CHAPTERS {
        uuid id PK
        uuid subject_id FK
        uuid topic_id FK
        varchar title
        int sort_order
    }
    LESSONS {
        uuid id PK
        uuid chapter_id FK
        uuid published_version_id FK
        varchar title
        varchar lesson_type
        varchar status
    }
    LESSON_PREREQUISITES {
        uuid id PK
        uuid lesson_id FK
        uuid required_lesson_id FK
        numeric min_score_pct
    }
    LESSON_VERSIONS {
        uuid id PK
        uuid lesson_id FK
        int version_number
        jsonb blocks_snapshot_json
        varchar version_status
    }
    LESSON_BLOCKS {
        uuid id PK
        uuid lesson_id FK
        uuid parent_block_id FK
        uuid shared_block_id FK
        varchar block_type
        varchar schema_version
        jsonb content_json
        int sort_order
    }
    SHARED_BLOCKS {
        uuid id PK
        uuid subject_id FK
        varchar block_type
        jsonb content_json
    }
    WIKI_TERMS {
        uuid id PK
        uuid subject_id FK
        uuid category_id FK
        varchar canonical_name
        varchar status
    }
    WIKI_ALIASES {
        uuid id PK
        uuid term_id FK
        varchar alias_name
    }
    WIKI_REVISIONS {
        uuid id PK
        uuid term_id FK
        int revision_number
        jsonb detailed_content_json
    }
    LESSON_TERM_LINKS {
        uuid id PK
        uuid lesson_id FK
        uuid block_id FK
        uuid term_id FK
    }

    SUBJECTS ||--o{ TOPICS : "1-N"
    TOPICS ||--o{ CHAPTERS : "1-N"
    CHAPTERS ||--o{ LESSONS : "1-N"
    LESSONS ||--o{ LESSON_PREREQUISITES : "yêu cầu"
    LESSONS ||--o{ LESSON_VERSIONS : "1-N"
    LESSONS ||--o{ LESSON_BLOCKS : "1-N"
    SHARED_BLOCKS ||--o{ LESSON_BLOCKS : "nhúng vào"
    LESSONS ||--o{ LESSON_TERM_LINKS : "chứa thuật ngữ"
    WIKI_TERMS ||--o{ LESSON_TERM_LINKS : "được tham chiếu"
    WIKI_TERMS ||--o{ WIKI_ALIASES : "có tên gọi khác"
    WIKI_TERMS ||--o{ WIKI_REVISIONS : "lịch sử sửa"
```

---

### 2.2. Domain 4 & 5: Tiến độ Học tập, Điều kiện Mở khóa, Bài tập & Kiểm tra

```mermaid
erDiagram
    USERS {
        uuid id PK
        varchar email
        varchar full_name
    }
    SUBJECT_CLASSES {
        uuid id PK
        uuid course_class_id FK
        uuid subject_id FK
        varchar class_code
    }
    LESSONS {
        uuid id PK
        varchar title
    }
    COMPLETION_RULES {
        uuid id PK
        varchar target_type
        uuid target_id
        numeric min_video_watch_pct
        boolean require_all_quick_checks
    }
    LESSON_UNLOCK_CONDITIONS {
        uuid id PK
        uuid subject_class_id FK
        uuid lesson_id FK
        varchar condition_type
        uuid required_lesson_id FK
        uuid required_assessment_id FK
    }
    LESSON_PROGRESS {
        uuid id PK
        uuid student_id FK
        uuid subject_class_id FK
        uuid lesson_id FK
        varchar status
        numeric progress_pct
        int last_video_position_sec
        uuid last_read_block_id
    }
    COURSE_PROGRESS {
        uuid id PK
        uuid student_id FK
        uuid subject_class_id FK
        numeric overall_progress_pct
        uuid last_lesson_id FK
    }
    LEARNING_EVENTS {
        uuid id PK
        varchar idempotency_key UK
        uuid student_id FK
        uuid lesson_id FK
        varchar event_type
        jsonb payload_json
    }
    ASSIGNMENTS {
        uuid id PK
        varchar title
    }
    ASSIGNMENT_ELEARNING_CONFIGS {
        uuid assignment_id PK, FK
        uuid subject_class_id FK
        uuid lesson_id FK
        varchar assignment_scope
        int max_attempts
    }
    ASSIGNMENT_SUBMISSIONS {
        uuid id PK
        uuid assignment_id FK
        uuid student_id FK
        smallint attempt_number
        varchar status
        numeric score
    }

    USERS ||--o{ LESSON_PROGRESS : "1-N"
    SUBJECT_CLASSES ||--o{ LESSON_PROGRESS : "1-N"
    LESSONS ||--o{ LESSON_PROGRESS : "1-N"
    USERS ||--o{ COURSE_PROGRESS : "1-N"
    USERS ||--o{ LEARNING_EVENTS : "sinh sự kiện"
    LESSONS ||--o{ LESSON_UNLOCK_CONDITIONS : "bị ràng buộc bởi"
    ASSIGNMENTS ||--|| ASSIGNMENT_ELEARNING_CONFIGS : "1-1 mở rộng"
    ASSIGNMENTS ||--o{ ASSIGNMENT_SUBMISSIONS : "có nhiều lần nộp"
```

---

### 2.3. Domain 6: Diễn đàn Học thuật (`Academic Forums`)

```mermaid
erDiagram
    FORUMS {
        uuid id PK
        uuid subject_id FK
        uuid subject_class_id FK
        varchar forum_scope
    }
    FORUM_CATEGORIES {
        uuid id PK
        uuid forum_id FK
        varchar name
        varchar category_type
    }
    FORUM_TOPICS {
        uuid id PK
        uuid forum_id FK
        uuid category_id FK
        uuid lesson_id FK
        uuid author_id FK
        varchar topic_type
        boolean is_pinned
        boolean is_locked
        boolean is_graded
    }
    FORUM_REPLIES {
        uuid id PK
        uuid topic_id FK
        uuid parent_reply_id FK
        smallint depth_level
        uuid author_id FK
        boolean is_instructor_endorsed
        numeric awarded_score
    }
    FORUM_REPORTS {
        uuid id PK
        varchar target_type
        uuid target_id
        uuid reporter_id FK
        varchar status
    }
    FORUM_MODERATION_LOGS {
        uuid id PK
        uuid forum_id FK
        uuid moderator_id FK
        varchar action
        text reason
    }

    FORUMS ||--o{ FORUM_CATEGORIES : "1-N"
    FORUMS ||--o{ FORUM_TOPICS : "1-N"
    FORUM_CATEGORIES ||--o{ FORUM_TOPICS : "phân loại"
    FORUM_TOPICS ||--o{ FORUM_REPLIES : "1-N"
    FORUM_REPLIES ||--o{ FORUM_REPLIES : "trả lời lồng (tối đa cấp 2)"
    FORUMS ||--o{ FORUM_MODERATION_LOGS : "ghi log kiểm duyệt"
```

---

### 2.4. Domain 7 & 8: Điểm danh, Đơn xin nghỉ, Học bù & Nhật ký Giảng dạy

```mermaid
erDiagram
    CLASS_SESSIONS {
        uuid id PK
        uuid subject_class_id FK
        timestamptz scheduled_start_at
        timestamptz scheduled_end_at
    }
    LESSON_SESSIONS {
        uuid id PK
        uuid class_session_id FK
        uuid lesson_id FK
        varchar planned_coverage
    }
    ATTENDANCE_QR_SESSIONS {
        uuid id PK
        uuid class_session_id FK
        varchar secret_seed
        smallint rotation_interval_sec
    }
    ATTENDANCE_RECORDS {
        uuid id PK
        uuid class_session_id FK
        uuid student_id FK
        varchar attendance_status
        varchar check_in_method
        uuid leave_request_id FK
        uuid make_up_session_id FK
    }
    LEAVE_REQUESTS {
        uuid id PK
        uuid class_session_id FK
        uuid student_id FK
        varchar status
        uuid reviewed_by FK
    }
    MAKE_UP_SESSIONS {
        uuid id PK
        uuid original_session_id FK
        uuid target_makeup_session_id FK
        uuid student_id FK
        varchar status
    }
    TEACHING_LOGS {
        uuid id PK
        uuid class_session_id FK
        uuid scheduled_instructor_id FK
        uuid actual_instructor_id FK
        boolean is_substitute_teaching
        timestamptz actual_start_at
        timestamptz actual_end_at
        varchar confirmation_status
    }
    TEACHING_LOG_LESSONS {
        uuid id PK
        uuid teaching_log_id FK
        uuid lesson_id FK
        varchar delivery_status
    }
    TEACHING_LOG_HISTORY {
        uuid id PK
        uuid teaching_log_id FK
        varchar action
        jsonb snapshot_json
        uuid actor_id FK
    }

    CLASS_SESSIONS ||--o{ LESSON_SESSIONS : "1-N"
    CLASS_SESSIONS ||--o{ ATTENDANCE_QR_SESSIONS : "1-N"
    CLASS_SESSIONS ||--o{ ATTENDANCE_RECORDS : "1-N"
    CLASS_SESSIONS ||--o{ LEAVE_REQUESTS : "1-N"
    LEAVE_REQUESTS ||--o{ ATTENDANCE_RECORDS : "cập nhật phép"
    MAKE_UP_SESSIONS ||--o{ ATTENDANCE_RECORDS : "xác nhận học bù"
    CLASS_SESSIONS ||--|| TEACHING_LOGS : "1-1"
    TEACHING_LOGS ||--o{ TEACHING_LOG_LESSONS : "1-N"
    TEACHING_LOGS ||--o{ TEACHING_LOG_HISTORY : "1-N audit"
```
