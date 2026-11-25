-- ============================================================================
-- MIGRATION 010: POSTGRESQL 18 RUNTIME SCHEMA (80 TABLES PRESERVING EXACT STRUCTURE)
-- Target: PostgreSQL 18 (preserving all tables, columns, IDs & FK constraints)
-- Generated from live LMSPLUS database schema for zero-breakage PG 18 migration.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS campuses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      open_time TEXT NOT NULL DEFAULT '07:00',
      close_time TEXT NOT NULL DEFAULT '21:30',
      travel_buffers_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS academic_holidays (
      id TEXT PRIMARY KEY,
      campus_id TEXT NULL REFERENCES campuses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_recurring_yearly INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
      idempotency_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      instructor_id TEXT NOT NULL,
      instructor_name TEXT NOT NULL,
      department_id TEXT NOT NULL,
      department_name TEXT NOT NULL,
      chapters_count INTEGER NOT NULL DEFAULT 1,
      lessons_count INTEGER NOT NULL DEFAULT 1,
      progress_pct INTEGER NOT NULL DEFAULT 0,
      enrollment_policy TEXT NOT NULL CHECK (enrollment_policy IN ('ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL')),
      enrollment_status TEXT NOT NULL DEFAULT 'NOT_ENROLLED',
      is_assigned_to_student INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    , description TEXT, thumbnail_url TEXT, subject TEXT, objectives TEXT, target_audience TEXT, prerequisites TEXT, intro TEXT, status TEXT NOT NULL DEFAULT 'PUBLISHED', created_by TEXT, created_at TEXT, archived_at TEXT, outcomes_json TEXT NOT NULL DEFAULT '[]', reference_tuition_fee DOUBLE PRECISION NOT NULL DEFAULT 0, theory_periods INTEGER NOT NULL DEFAULT 15, practice_periods INTEGER NOT NULL DEFAULT 15, self_study_periods INTEGER NOT NULL DEFAULT 15, minutes_per_period INTEGER NOT NULL DEFAULT 45, required_room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM', grading_scale DOUBLE PRECISION NOT NULL DEFAULT 10, pass_score DOUBLE PRECISION NOT NULL DEFAULT 5, exam_conditions_json TEXT NOT NULL DEFAULT '{"min_attendance_pct":70,"require_all_mandatory_assignments":true}', lifecycle_status TEXT NOT NULL DEFAULT 'PUBLISHED', version_code TEXT NOT NULL DEFAULT 'v2026.1');

CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      progress_pct INTEGER NOT NULL DEFAULT 0
    , course_id TEXT, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PUBLISHED', updated_at TEXT, topic_id TEXT NULL);

CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'IN_PROGRESS', 'LOCKED')),
      unlock_condition_text TEXT,
      required_video_pct INTEGER NOT NULL DEFAULT 85,
      require_quick_check INTEGER NOT NULL DEFAULT 1,
      last_video_position_sec INTEGER NOT NULL DEFAULT 0,
      total_video_seconds INTEGER NOT NULL DEFAULT 900,
      quick_check_passed INTEGER NOT NULL DEFAULT 0,
      working_draft_revision INTEGER NOT NULL DEFAULT 4,
      published_version INTEGER NOT NULL DEFAULT 2
    , description TEXT, objectives TEXT, sort_order INTEGER NOT NULL DEFAULT 0, publish_status TEXT NOT NULL DEFAULT 'PUBLISHED', published_at TEXT, updated_at TEXT, completion_rule TEXT NOT NULL DEFAULT 'MANUAL', min_video_watch_pct INTEGER NOT NULL DEFAULT 0, require_video_quizzes INTEGER NOT NULL DEFAULT 1, theory_periods DOUBLE PRECISION NOT NULL DEFAULT 1, practice_periods DOUBLE PRECISION NOT NULL DEFAULT 0, self_study_periods DOUBLE PRECISION NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS assignment_bank_items (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      topic_id TEXT NULL,
      chapter_id TEXT NULL,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL,
      submission_type TEXT NOT NULL DEFAULT 'MIXED' CHECK (submission_type IN ('TEXT','FILE','LINK','MIXED')),
      max_score DOUBLE PRECISION NOT NULL DEFAULT 10,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      allow_resubmit INTEGER NOT NULL DEFAULT 1,
      rubric_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    , relative_due_days INTEGER NULL, is_mandatory INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS subject_classes (
    id TEXT PRIMARY KEY,
    course_id TEXT NULL REFERENCES courses(id) ON DELETE SET NULL,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subject TEXT,
    description TEXT,
    instructor_name TEXT NOT NULL DEFAULT '',
    ta_names_json TEXT NOT NULL DEFAULT '[]',
    schedule_text TEXT,
    room TEXT,
    student_count INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    max_students INTEGER,
    delivery_mode TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (delivery_mode IN ('OFFLINE','ONLINE','HYBRID')),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('DRAFT','UPCOMING','ACTIVE','COMPLETED','CANCELLED','ARCHIVED')),
    department_id TEXT,
    created_by TEXT,
    created_at TEXT,
    updated_at TEXT
  , default_virtual_room_id TEXT, attendance_rules_json TEXT, cohort_id TEXT NULL, course_version_id TEXT NULL, course_version_number INTEGER NULL, required_room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM', assessment_components_json TEXT NOT NULL DEFAULT '[]', planned_periods DOUBLE PRECISION NOT NULL DEFAULT 30);

CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL,
      subject_class_code TEXT NOT NULL,
      subject_title TEXT NOT NULL,
      session_title TEXT NOT NULL,
      scheduled_start_at TEXT NOT NULL,
      scheduled_end_at TEXT NOT NULL,
      confirmation_deadline_at TEXT NOT NULL,
      actual_start_at TEXT NOT NULL,
      actual_end_at TEXT NOT NULL,
      scheduled_instructor_id TEXT NOT NULL,
      scheduled_instructor_name TEXT NOT NULL,
      actual_instructor_name TEXT NOT NULL,
      is_substitute_teaching INTEGER NOT NULL DEFAULT 0,
      ta_names_json TEXT NOT NULL DEFAULT '[]',
      confirmation_status TEXT NOT NULL,
      confirmed_at TEXT,
      is_late_confirmation INTEGER NOT NULL DEFAULT 0,
      late_confirmation_reason TEXT,
      reminder_sent_count INTEGER NOT NULL DEFAULT 0,
      lessons_delivery_json TEXT NOT NULL DEFAULT '[]'
    , room_or_link TEXT, session_status TEXT NOT NULL DEFAULT 'SCHEDULED', cancel_reason TEXT, attendance_saved_at TEXT, attendance_saved_by TEXT, attendance_locked_at TEXT, attendance_locked_by TEXT, created_by TEXT, created_at TEXT, delivery_mode TEXT NOT NULL DEFAULT 'OFFLINE', teaching_content TEXT, virtual_room_id TEXT, live_status TEXT NOT NULL DEFAULT 'NOT_STARTED', live_started_at TEXT, live_ended_at TEXT, attendance_sync_status TEXT NOT NULL DEFAULT 'IDLE', attendance_rules_json TEXT, campus_id TEXT NULL, classroom_id TEXT NULL, shift_code TEXT NULL, schedule_state TEXT NOT NULL DEFAULT 'PUBLISHED', planned_periods DOUBLE PRECISION NOT NULL DEFAULT 2, actual_periods DOUBLE PRECISION NULL, hour_category TEXT NOT NULL DEFAULT 'THEORY', merged_group_code TEXT NULL, session_kind TEXT NOT NULL DEFAULT 'REGULAR', rescheduled_from_session_id TEXT NULL, actual_instructor_id TEXT NULL, substitute_reason TEXT NULL, timesheet_locked_id TEXT NULL);

CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      department_id TEXT,
      assigned_course_ids_json TEXT NOT NULL DEFAULT '[]',
      enrolled_subject_class_ids_json TEXT NOT NULL DEFAULT '[]'
    , password_hash TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE RESTRICT,
      class_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      attendance_status TEXT NOT NULL
        CHECK (attendance_status IN ('PRESENT','LATE','EXCUSED_ABSENCE','UNEXCUSED_ABSENCE')),
      check_in_method TEXT NOT NULL DEFAULT 'MANUAL' CHECK (check_in_method IN ('MANUAL','QR_CODE')),
      check_in_at TEXT,
      note TEXT,
      recorded_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_session_student_attendance UNIQUE (class_session_id, student_id)
    );

CREATE TABLE IF NOT EXISTS attendance_audit_logs (
      id TEXT PRIMARY KEY,
      attendance_record_id TEXT NOT NULL REFERENCES attendance_records(id) ON DELETE RESTRICT,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      previous_note TEXT,
      new_note TEXT,
      change_reason TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS attendance_qr_sessions (
      id TEXT PRIMARY KEY,
      class_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      secret_seed TEXT NOT NULL,
      rotation_interval_sec INTEGER NOT NULL DEFAULT 30,
      late_threshold_minutes INTEGER NOT NULL DEFAULT 15,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS certificate_templates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      issuer_name TEXT NOT NULL DEFAULT 'Trung tâm Đào tạo LMSPLUS',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

CREATE TABLE IF NOT EXISTS class_assignments (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      assignment_bank_item_id TEXT NULL,
      topic_id TEXT NULL,
      chapter_id TEXT NULL,
      lesson_id TEXT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      submission_type TEXT NOT NULL DEFAULT 'MIXED' CHECK (submission_type IN ('TEXT','FILE','LINK','MIXED')),
      max_score DOUBLE PRECISION NOT NULL DEFAULT 10,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      allow_resubmit INTEGER NOT NULL DEFAULT 1,
      due_at TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , relative_due_days INTEGER NULL, anchor_lesson_id TEXT NULL, is_mandatory INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS class_assignment_submissions (
      id TEXT PRIMARY KEY,
      class_assignment_id TEXT NOT NULL REFERENCES class_assignments(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_version_key TEXT NOT NULL DEFAULT 'v0',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      submission_text TEXT,
      submission_link TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','GRADED','RETURNED')),
      score DOUBLE PRECISION,
      max_score DOUBLE PRECISION NOT NULL DEFAULT 10,
      teacher_feedback TEXT,
      graded_by TEXT,
      submitted_at TEXT,
      graded_at TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_assign_sub UNIQUE (class_assignment_id, student_id, attempt_number)
    );

CREATE TABLE IF NOT EXISTS class_enrollments (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enrollment_source TEXT NOT NULL DEFAULT 'ACADEMIC_ASSIGNED',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DROPPED')),
      enrolled_at TEXT NOT NULL,
      dropped_at TEXT,
      updated_by TEXT,
      CONSTRAINT uq_subject_class_student UNIQUE (subject_class_id, student_id)
    );

CREATE TABLE IF NOT EXISTS class_exams (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL DEFAULT 'CHAPTER' CHECK (scope_type IN ('COURSE','TOPIC','CHAPTER','LESSON')),
      topic_id TEXT NULL,
      chapter_id TEXT NULL,
      lesson_id TEXT NULL,
      title TEXT NOT NULL,
      description TEXT,
      time_limit_minutes INTEGER NOT NULL DEFAULT 20,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      scoring_policy TEXT NOT NULL DEFAULT 'HIGHEST' CHECK (scoring_policy IN ('HIGHEST','LATEST','AVERAGE')),
      pass_score_pct DOUBLE PRECISION NOT NULL DEFAULT 50,
      open_at TEXT,
      close_at TEXT,
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS class_exam_attempts (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_version_key TEXT NOT NULL DEFAULT 'v0',
      attempt_number INTEGER NOT NULL DEFAULT 1,
      question_order_json TEXT NOT NULL DEFAULT '[]',
      answers_json TEXT NOT NULL DEFAULT '{}',
      item_grades_json TEXT NOT NULL DEFAULT '{}',
      auto_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      manual_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      max_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      grading_status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (grading_status IN ('IN_PROGRESS','AUTO_GRADED','PENDING_MANUAL','GRADED')),
      teacher_feedback TEXT,
      graded_by TEXT,
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      graded_at TEXT,
      CONSTRAINT uq_class_exam_attempt UNIQUE (exam_id, student_id, attempt_number)
    );

CREATE TABLE IF NOT EXISTS class_exam_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,
      bank_question_id TEXT NULL,
      question_snapshot_json TEXT NOT NULL,
      points DOUBLE PRECISION NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10
    );

CREATE TABLE IF NOT EXISTS class_gradebook_entries (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('EXAM','ASSIGNMENT','MANUAL')),
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      max_score DOUBLE PRECISION NOT NULL DEFAULT 10,
      weight DOUBLE PRECISION NOT NULL DEFAULT 1,
      graded_by TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_gradebook_src UNIQUE (subject_class_id, student_id, source_type, source_id)
    );

CREATE TABLE IF NOT EXISTS class_lesson_blocks (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      anchor_block_id TEXT NULL,
      block_type TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '1.2',
      sort_order INTEGER NOT NULL DEFAULT 1000,
      is_published INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS class_lesson_customs (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      instructor_note TEXT,
      custom_objectives TEXT,
      publish_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (publish_status IN ('DRAFT','PUBLISHED')),
      working_revision INTEGER NOT NULL DEFAULT 1,
      published_at TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL, published_snapshot_json TEXT,
      CONSTRAINT uq_class_lesson_custom UNIQUE (subject_class_id, lesson_id)
    );

CREATE TABLE IF NOT EXISTS course_versions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      version_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','ARCHIVED')),
      snapshot_json TEXT NOT NULL,
      changelog_note TEXT,
      published_by TEXT,
      published_by_name TEXT,
      published_at TEXT NOT NULL,
      CONSTRAINT uq_course_version_num UNIQUE (course_id, version_number)
    );

CREATE TABLE IF NOT EXISTS class_version_upgrade_logs (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      from_version_id TEXT,
      to_version_id TEXT NOT NULL REFERENCES course_versions(id) ON DELETE RESTRICT,
      upgrade_reason TEXT NOT NULL,
      upgraded_by TEXT,
      upgraded_by_name TEXT,
      upgraded_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM' CHECK (room_type IN ('THEORY_ROOM','COMPUTER_LAB','ONLINE')),
      capacity INTEGER NOT NULL DEFAULT 40,
      equipment_note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS curricula (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      version TEXT NOT NULL DEFAULT '1.0',
      effective_date TEXT,
      department_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , program_type TEXT NOT NULL DEFAULT 'INSTRUCTOR_LED', delivery_mode TEXT NOT NULL DEFAULT 'HYBRID', standard_duration_months DOUBLE PRECISION NOT NULL DEFAULT 6, standard_duration_text TEXT NOT NULL DEFAULT '6 tháng', target_audience TEXT NOT NULL DEFAULT '', entry_requirements TEXT NOT NULL DEFAULT '', auto_tuition_fee DOUBLE PRECISION NOT NULL DEFAULT 0, final_tuition_fee DOUBLE PRECISION NOT NULL DEFAULT 0, is_tuition_overridden INTEGER NOT NULL DEFAULT 0, graduation_criteria_json TEXT NOT NULL DEFAULT '{"pass_all_mandatory":true,"min_electives_passed":0,"min_avg_score":5,"min_attendance_pct":80,"extra_requirements":[],"certificate_template_code":"CERT-STD-2026"}', lifecycle_status TEXT NOT NULL DEFAULT 'PUBLISHED');

CREATE TABLE IF NOT EXISTS program_cohorts (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE RESTRICT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      academic_year TEXT,
      semester TEXT,
      start_date TEXT,
      end_date TEXT,
      delivery_mode TEXT NOT NULL DEFAULT 'HYBRID' CHECK (delivery_mode IN ('OFFLINE','ONLINE','HYBRID')),
      location_note TEXT,
      coordinator_id TEXT,
      coordinator_name TEXT,
      max_students INTEGER,
      department_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','ARCHIVED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , curriculum_version_id TEXT NULL, tuition_fee_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS cohort_audit_logs (
      id TEXT PRIMARY KEY,
      cohort_id TEXT NOT NULL REFERENCES program_cohorts(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      target_student_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS cohort_enrollments (
      id TEXT PRIMARY KEY,
      cohort_id TEXT NOT NULL REFERENCES program_cohorts(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRANSFERRED','WITHDRAWN')),
      enrolled_at TEXT NOT NULL,
      ended_at TEXT,
      transfer_to_cohort_id TEXT,
      note TEXT,
      updated_by TEXT,
      CONSTRAINT uq_cohort_student UNIQUE (cohort_id, student_id)
    );

CREATE TABLE IF NOT EXISTS course_assessment_components (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      weight_pct DOUBLE PRECISION NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('ATTENDANCE','ASSIGNMENT','EXAM','EXAM_MATRIX','MANUAL')),
      source_config_json TEXT NOT NULL DEFAULT '{}',
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS course_prerequisites (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      prerequisite_course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      note TEXT,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_course_prereq UNIQUE (course_id, prerequisite_course_id)
    );

CREATE TABLE IF NOT EXISTS course_topics (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      code TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS course_wiki_pages (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      topic_id TEXT NULL,
      chapter_id TEXT NULL,
      lesson_id TEXT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content_markdown TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      related_page_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      CONSTRAINT uq_course_wiki_slug UNIQUE (course_id, slug)
    );

CREATE TABLE IF NOT EXISTS course_wiki_revisions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES course_wiki_pages(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      change_note TEXT,
      edited_by TEXT,
      edited_by_name TEXT,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_course_wiki_rev UNIQUE (page_id, revision_number)
    );

CREATE TABLE IF NOT EXISTS curriculum_audit_logs (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS curriculum_service_fees (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS curriculum_stages (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      stage_type TEXT NOT NULL DEFAULT 'SEMESTER' CHECK (stage_type IN ('SEMESTER','PHASE','CUSTOM')),
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS curriculum_subjects (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      semester_order INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10,
      planned_periods INTEGER NOT NULL DEFAULT 30,
      planned_hours DOUBLE PRECISION NOT NULL DEFAULT 22.5,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL, stage_id TEXT NULL, prerequisite_course_ids_json TEXT NOT NULL DEFAULT '[]',
      CONSTRAINT uq_curriculum_subject UNIQUE (curriculum_id, course_id)
    );

CREATE TABLE IF NOT EXISTS curriculum_versions (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      version_label TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      changelog_note TEXT,
      published_by TEXT,
      published_by_name TEXT,
      published_at TEXT NOT NULL,
      CONSTRAINT uq_curr_ver_num UNIQUE (curriculum_id, version_number)
    );

CREATE TABLE IF NOT EXISTS enrollment_requests (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      requested_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      UNIQUE(course_id, student_id)
    );

CREATE TABLE IF NOT EXISTS instructor_availabilities (
      id TEXT PRIMARY KEY,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rule_type TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (rule_type IN ('WEEKLY','DATE')),
      weekday INTEGER NULL,
      specific_date TEXT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'BUSY' CHECK (status IN ('AVAILABLE','BUSY')),
      note TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS instructor_quotas (
      id TEXT PRIMARY KEY,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      standard_periods DOUBLE PRECISION NOT NULL DEFAULT 40,
      standard_hours DOUBLE PRECISION NOT NULL DEFAULT 30,
      note TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_instr_quota_period UNIQUE (instructor_id, period_key)
    );

CREATE TABLE IF NOT EXISTS learning_events (
      idempotency_key TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS learning_resources (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      class_id TEXT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'ENROLLED',
      resource_type TEXT NOT NULL CHECK (resource_type IN ('LINK','FILE','VIDEO','PDF')),
      storage_provider TEXT NOT NULL CHECK (storage_provider IN ('EXTERNAL_URL','LOCAL_DISK')),
      storage_key TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      file_size_bytes BIGINT,
      checksum_sha256 TEXT,
      duration_seconds DOUBLE PRECISION,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'READY',
      processing_status TEXT NOT NULL DEFAULT 'READY',
      error_message TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    , topic_id TEXT NULL, chapter_id TEXT NULL, lesson_id TEXT NULL, usage_type TEXT NOT NULL DEFAULT 'MANDATORY', tags_json TEXT NOT NULL DEFAULT '[]');

CREATE TABLE IF NOT EXISTS leave_request_logs (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      action_note TEXT,
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS leave_requests (
        id TEXT PRIMARY KEY,
        subject_class_id TEXT NOT NULL,
        student_code TEXT NOT NULL,
        student_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        makeup_class_requested TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
        class_session_id TEXT NULL,
        student_id TEXT NULL,
        reason_category TEXT NOT NULL DEFAULT 'OTHER',
        evidence_url TEXT NULL,
        evidence_name TEXT NULL,
        reviewed_by TEXT NULL,
        reviewed_by_name TEXT NULL,
        reviewed_at TEXT NULL,
        review_note TEXT NULL,
        created_at TEXT NULL,
        updated_at TEXT NULL
      );

CREATE TABLE IF NOT EXISTS lesson_blocks (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      schema_version TEXT NOT NULL DEFAULT '1.0',
      block_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      content_json TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS lesson_progress (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        content_version_key TEXT NOT NULL DEFAULT 'v0',
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
        started_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        completed_at TEXT,
        CONSTRAINT uq_lesson_progress_ver UNIQUE (student_id, subject_class_id, lesson_id, content_version_key)
      );

CREATE TABLE IF NOT EXISTS lesson_quiz_submissions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('VIDEO_MARKER','QUIZ_BLOCK')),
      target_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      response_json TEXT NOT NULL,
      grading_status TEXT NOT NULL DEFAULT 'GRADED' CHECK (grading_status IN ('GRADED','PENDING_REVIEW')),
      is_correct INTEGER NOT NULL DEFAULT 0,
      earned_points DOUBLE PRECISION NOT NULL DEFAULT 0,
      max_points DOUBLE PRECISION NOT NULL DEFAULT 1,
      feedback_json TEXT NOT NULL DEFAULT '{}',
      submitted_at TEXT NOT NULL, content_version_key TEXT NOT NULL DEFAULT 'v0',
      CONSTRAINT uq_student_quiz_attempt UNIQUE (student_id, subject_class_id, target_type, target_id, attempt_number)
    );

CREATE TABLE IF NOT EXISTS lesson_versions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      blocks_snapshot_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL, markers_snapshot_json TEXT NOT NULL DEFAULT '[]', change_note TEXT,
      UNIQUE(lesson_id, version_number)
    );

CREATE TABLE IF NOT EXISTS question_bank_items (
      id TEXT PRIMARY KEY,
      course_id TEXT NULL REFERENCES courses(id) ON DELETE CASCADE,
      subject TEXT,
      question_type TEXT NOT NULL
        CHECK (question_type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','TRUE_FALSE','FILL_BLANK','SHORT_ANSWER')),
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer_key_json TEXT NOT NULL DEFAULT '{}',
      points DOUBLE PRECISION NOT NULL DEFAULT 1,
      explanation TEXT,
      correct_feedback TEXT,
      wrong_feedback TEXT,
      difficulty TEXT NOT NULL DEFAULT 'MEDIUM',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    , topic_id TEXT NULL, chapter_id TEXT NULL, lesson_id TEXT NULL);

CREATE TABLE IF NOT EXISTS session_lessons (
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 10,
      PRIMARY KEY (session_id, lesson_id)
    );

CREATE TABLE IF NOT EXISTS session_plan_items (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'COURSE' CHECK (scope_type IN ('COURSE','CURRICULUM_SUBJECT')),
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      curriculum_id TEXT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      curriculum_subject_id TEXT NULL,
      session_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 90,
      periods_count DOUBLE PRECISION NOT NULL DEFAULT 2,
      delivery_mode TEXT NOT NULL DEFAULT 'OFFLINE',
      required_room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM',
      lesson_ids_json TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS shift_presets (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      periods_count DOUBLE PRECISION NOT NULL DEFAULT 2,
      sort_order INTEGER NOT NULL DEFAULT 10
    );

CREATE TABLE IF NOT EXISTS teaching_forum_helpful (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('THREAD','REPLY')),
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_forum_helpful_user UNIQUE (target_type, target_id, user_id)
    );

CREATE TABLE IF NOT EXISTS teaching_forum_mod_logs (
      id TEXT PRIMARY KEY,
      forum_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_forums (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('COURSE','CLASS')),
      course_id TEXT NULL,
      subject_class_id TEXT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_forum_threads (
      id TEXT PRIMARY KEY,
      forum_id TEXT NOT NULL REFERENCES teaching_forums(id) ON DELETE CASCADE,
      lesson_id TEXT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT,
      category TEXT NOT NULL DEFAULT 'QA',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_forum_replies (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES teaching_forum_threads(id) ON DELETE CASCADE,
      parent_reply_id TEXT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT,
      body TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_endorsed INTEGER NOT NULL DEFAULT 0,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_forum_reports (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('THREAD','REPLY')),
      target_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reporter_name TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED','DISMISSED')),
      resolved_by TEXT,
      resolution_note TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_log_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      session_code TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      note TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link_url TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS teaching_staff_assignments (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      staff_role TEXT NOT NULL CHECK (staff_role IN ('PRIMARY_INSTRUCTOR','CO_INSTRUCTOR','TEACHING_ASSISTANT')),
      permissions_json TEXT NOT NULL DEFAULT '{"can_manage_materials":false,"can_take_attendance":true}',
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_staff_role UNIQUE (subject_class_id, user_id, staff_role)
    );

CREATE TABLE IF NOT EXISTS teaching_timesheets (
      id TEXT PRIMARY KEY,
      period_month TEXT NOT NULL,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instructor_name TEXT NOT NULL DEFAULT '',
      department_id TEXT,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      regular_sessions INTEGER NOT NULL DEFAULT 0,
      substitute_sessions INTEGER NOT NULL DEFAULT 0,
      makeup_sessions INTEGER NOT NULL DEFAULT 0,
      cancelled_sessions INTEGER NOT NULL DEFAULT 0,
      theory_periods DOUBLE PRECISION NOT NULL DEFAULT 0,
      practice_periods DOUBLE PRECISION NOT NULL DEFAULT 0,
      online_periods DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_periods DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
      quota_hours DOUBLE PRECISION NOT NULL DEFAULT 30,
      overtime_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING_TEACHER'
        CHECK (status IN ('DRAFT','PENDING_TEACHER','DISPUTED','TEACHER_CONFIRMED','APPROVED','LOCKED')),
      teacher_note TEXT,
      review_note TEXT,
      teacher_confirmed_at TEXT,
      approved_by TEXT,
      approved_by_name TEXT,
      approved_at TEXT,
      locked_by TEXT,
      locked_by_name TEXT,
      locked_at TEXT,
      finance_batch_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_timesheet_period_instr UNIQUE (period_month, instructor_id)
    );

CREATE TABLE IF NOT EXISTS teaching_timesheet_items (
      id TEXT PRIMARY KEY,
      timesheet_id TEXT NOT NULL REFERENCES teaching_timesheets(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      subject_class_id TEXT NOT NULL,
      class_code TEXT NOT NULL,
      course_code TEXT,
      course_title TEXT,
      session_title TEXT NOT NULL,
      session_date TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      hour_category TEXT NOT NULL DEFAULT 'THEORY',
      role_kind TEXT NOT NULL DEFAULT 'PRIMARY',
      periods DOUBLE PRECISION NOT NULL DEFAULT 0,
      hours DOUBLE PRECISION NOT NULL DEFAULT 0
    );

CREATE TABLE IF NOT EXISTS video_quiz_markers (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      class_id TEXT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      timestamp_sec DOUBLE PRECISION NOT NULL CHECK (timestamp_sec >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      behavior TEXT NOT NULL DEFAULT 'PAUSE_AND_ASK'
        CHECK (behavior IN ('PAUSE_AND_ASK','PAUSE_OPTIONAL','INFO_ONLY')),
      title TEXT,
      info_body TEXT,
      question_id TEXT NULL REFERENCES question_bank_items(id) ON DELETE SET NULL,
      question_snapshot_json TEXT NOT NULL DEFAULT '{}',
      is_required INTEGER NOT NULL DEFAULT 1,
      allow_skip INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      show_answer_after_submit INTEGER NOT NULL DEFAULT 1,
      show_explanation INTEGER NOT NULL DEFAULT 1,
      allow_review INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS video_upload_sessions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      class_id TEXT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      total_size_bytes BIGINT NOT NULL CHECK (total_size_bytes > 0),
      received_bytes BIGINT NOT NULL DEFAULT 0,
      chunks_received INTEGER NOT NULL DEFAULT 0,
      temp_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','COMPLETED','CANCELLED','FAILED')),
      error_message TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS video_watch_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      content_version_key TEXT NOT NULL DEFAULT 'v0',
      event_type TEXT NOT NULL,
      segment_start_sec DOUBLE PRECISION,
      segment_end_sec DOUBLE PRECISION,
      playback_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
      is_visible INTEGER NOT NULL DEFAULT 1,
      device_session_id TEXT,
      recorded_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS video_watch_progress (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
        content_version_key TEXT NOT NULL DEFAULT 'v0',
        watched_intervals_json TEXT NOT NULL DEFAULT '[]',
        unique_watched_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
        max_contiguous_watched_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
        last_position_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
        max_watched_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
        watched_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
        duration_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
        watch_pct INTEGER NOT NULL DEFAULT 0,
        is_completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        CONSTRAINT uq_student_class_video_block_ver UNIQUE (student_id, subject_class_id, lesson_id, block_id, content_version_key)
      );

CREATE TABLE IF NOT EXISTS virtual_attendance_adjustments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      student_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL DEFAULT 'STATUS_OVERRIDE',
      previous_status TEXT,
      new_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS virtual_attendance_calculations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_join_at TEXT,
      last_leave_at TEXT,
      raw_sessions_count INTEGER NOT NULL DEFAULT 0,
      merged_intervals_json TEXT NOT NULL DEFAULT '[]',
      total_merged_duration_sec INTEGER NOT NULL DEFAULT 0,
      valid_window_duration_sec INTEGER NOT NULL DEFAULT 0,
      required_window_duration_sec INTEGER NOT NULL DEFAULT 0,
      attendance_ratio_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      late_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
      calculated_status TEXT NOT NULL,
      final_status TEXT NOT NULL,
      identity_match_method TEXT,
      is_manually_adjusted INTEGER NOT NULL DEFAULT 0,
      adjustment_reason TEXT,
      adjusted_by TEXT,
      adjusted_at TEXT,
      calculated_at TEXT NOT NULL,
      CONSTRAINT uq_virtual_att_calc UNIQUE (session_id, student_id)
    );

CREATE TABLE IF NOT EXISTS virtual_identity_mappings (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_email TEXT,
      provider_user_id TEXT,
      registrant_id TEXT,
      lms_join_token TEXT,
      mapped_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS virtual_meeting_rooms (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      session_id TEXT NULL REFERENCES sessions(session_id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK (provider IN ('ZOOM','GOOGLE_MEET','EXTERNAL')),
      external_platform_name TEXT,
      creation_mode TEXT NOT NULL DEFAULT 'AUTO_API',
      is_recurring_room INTEGER NOT NULL DEFAULT 0,
      room_title TEXT NOT NULL,
      external_meeting_id TEXT,
      external_meeting_uuid TEXT,
      join_url TEXT NOT NULL,
      encrypted_host_start_url TEXT,
      encrypted_passcode TEXT,
      scheduled_start_at TEXT,
      scheduled_end_at TEXT,
      room_status TEXT NOT NULL DEFAULT 'SCHEDULED',
      supports_auto_sync INTEGER NOT NULL DEFAULT 1,
      provider_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS virtual_participant_sessions (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      virtual_room_id TEXT NOT NULL REFERENCES virtual_meeting_rooms(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_participant_id TEXT,
      registrant_id TEXT,
      lms_join_token TEXT,
      participant_email TEXT,
      display_name TEXT NOT NULL,
      matched_student_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      identity_match_method TEXT NOT NULL DEFAULT 'UNKNOWN',
      join_at TEXT NOT NULL,
      leave_at TEXT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      is_currently_in_room INTEGER NOT NULL DEFAULT 0,
      device_info TEXT,
      source TEXT NOT NULL DEFAULT 'WEBHOOK',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS virtual_provider_configs (
      provider TEXT PRIMARY KEY CHECK (provider IN ('ZOOM','GOOGLE_MEET','EXTERNAL')),
      display_name TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'SERVER_TO_SERVER_OAUTH',
      account_id TEXT,
      client_id TEXT,
      encrypted_credentials_json TEXT,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      connection_status TEXT NOT NULL DEFAULT 'SANDBOX_READY',
      last_verified_at TEXT,
      status_message TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS virtual_sync_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      virtual_room_id TEXT,
      provider TEXT NOT NULL,
      trigger_source TEXT NOT NULL DEFAULT 'MANUAL_RESYNC',
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      participants_fetched INTEGER NOT NULL DEFAULT 0,
      matched_students INTEGER NOT NULL DEFAULT 0,
      unknown_participants INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

CREATE TABLE IF NOT EXISTS virtual_webhook_events (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      external_meeting_id TEXT,
      session_id TEXT NULL,
      event_timestamp_ms BIGINT NOT NULL DEFAULT 0,
      signature_verified INTEGER NOT NULL DEFAULT 0,
      processing_status TEXT NOT NULL DEFAULT 'PROCESSED',
      raw_payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS wiki_terms (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      subject_context TEXT NOT NULL,
      short_definition TEXT NOT NULL,
      formula_or_example TEXT,
      updated_at TEXT NOT NULL
    );

-- ---- Indexes ----
CREATE INDEX IF NOT EXISTS idx_abank_course_lesson ON assignment_bank_items(course_id, lesson_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_record ON attendance_audit_logs(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class_student ON attendance_records(subject_class_id, student_id);
CREATE INDEX IF NOT EXISTS idx_class_assignments_class ON class_assignments(subject_class_id, status);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON class_enrollments(student_id, status);
CREATE INDEX IF NOT EXISTS idx_class_exams_class ON class_exams(subject_class_id, status);
CREATE INDEX IF NOT EXISTS idx_class_lesson_blocks_lookup
      ON class_lesson_blocks(subject_class_id, lesson_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_classrooms_campus ON classrooms(campus_id, room_type);
CREATE INDEX IF NOT EXISTS idx_cohort_enrollments_lookup ON cohort_enrollments(cohort_id, status);
CREATE INDEX IF NOT EXISTS idx_course_assess_crs ON course_assessment_components(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_prereq_crs ON course_prerequisites(course_id);
CREATE INDEX IF NOT EXISTS idx_course_topics_course ON course_topics(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_versions_course ON course_versions(course_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_course_wiki_lookup ON course_wiki_pages(course_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_curr_fees_curr ON curriculum_service_fees(curriculum_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_curr_stages_curr ON curriculum_stages(curriculum_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_curr_versions_curr ON curriculum_versions(curriculum_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_curriculum_subjects_curr ON curriculum_subjects(curriculum_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_holidays_dates ON academic_holidays(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_instr_avail_user ON instructor_availabilities(instructor_id, rule_type);
CREATE INDEX IF NOT EXISTS idx_lesson_quiz_submissions_lookup
      ON lesson_quiz_submissions(student_id, subject_class_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_program_cohorts_curr ON program_cohorts(curriculum_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_course ON question_bank_items(course_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_resources_course ON learning_resources(course_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_session_plan_lookup ON session_plan_items(scope_type, course_id, curriculum_id, session_order);
CREATE INDEX IF NOT EXISTS idx_sessions_class_start ON sessions(subject_class_id, scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_staff_user ON teaching_staff_assignments(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_teaching_forums_scope ON teaching_forums(scope_type, course_id, subject_class_id);
CREATE INDEX IF NOT EXISTS idx_teaching_notif_user ON teaching_notifications(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_timesheets_period ON teaching_timesheets(period_month, status);
CREATE INDEX IF NOT EXISTS idx_video_events_student ON video_watch_events(student_id, subject_class_id, lesson_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_video_quiz_markers_lookup
      ON video_quiz_markers(lesson_id, block_id, timestamp_sec, sort_order);
CREATE INDEX IF NOT EXISTS idx_video_uploads_course ON video_upload_sessions(course_id, status);
CREATE INDEX IF NOT EXISTS idx_video_watch_class_lesson ON video_watch_progress(subject_class_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_virtual_att_adj_session ON virtual_attendance_adjustments(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_virtual_att_calc_session ON virtual_attendance_calculations(session_id);
CREATE INDEX IF NOT EXISTS idx_virtual_identity_class ON virtual_identity_mappings(subject_class_id, provider);
CREATE INDEX IF NOT EXISTS idx_virtual_part_session ON virtual_participant_sessions(session_id, virtual_room_id);
CREATE INDEX IF NOT EXISTS idx_virtual_part_student ON virtual_participant_sessions(session_id, matched_student_id);
CREATE INDEX IF NOT EXISTS idx_virtual_rooms_class ON virtual_meeting_rooms(subject_class_id);
CREATE INDEX IF NOT EXISTS idx_virtual_rooms_external ON virtual_meeting_rooms(provider, external_meeting_id);
CREATE INDEX IF NOT EXISTS idx_virtual_rooms_session ON virtual_meeting_rooms(session_id);
CREATE INDEX IF NOT EXISTS idx_virtual_webhooks_session ON virtual_webhook_events(session_id, received_at);

ALTER TABLE learning_resources ALTER COLUMN file_size_bytes TYPE BIGINT;
ALTER TABLE video_upload_sessions ALTER COLUMN total_size_bytes TYPE BIGINT, ALTER COLUMN received_bytes TYPE BIGINT;
ALTER TABLE virtual_webhook_events ALTER COLUMN event_timestamp_ms TYPE BIGINT;

COMMIT;
