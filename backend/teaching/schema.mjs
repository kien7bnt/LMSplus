/**
 * LMSPLUS Teaching Module — SQLite schema (additive) + development seed.
 *
 * Tên bảng/cột được giữ thống nhất với PostgreSQL migrations 000–005
 * (subject_classes, class_enrollments, attendance_records, attendance_audit_logs,
 *  attendance_qr_sessions, teaching_staff_assignments, learning_resources, lesson_progress).
 *
 * Nguyên tắc:
 *  - Chỉ CREATE TABLE IF NOT EXISTS / ADD COLUMN; không DROP dữ liệu.
 *  - Ngoại lệ duy nhất: `subject_classes` cũ có `course_id NOT NULL` và thiếu cột trạng thái → được
 *    tái tạo bằng quy trình chuẩn của SQLite (tạo bảng mới, sao chép toàn bộ dữ liệu, đổi tên) trong transaction.
 *  - Bảng `sessions` hiện hữu đóng vai trò `class_sessions` + `teaching_session_status` của PostgreSQL.
 */

import crypto from 'node:crypto';
import { encryptSecret, encryptJsonCredentials } from './virtualProviders.mjs';

export const TEACHING_SEED_MARKER = 'teaching_seed_v1';
export const STUDIO_SEED_MARKER = 'studio_seed_v1';
export const VIRTUAL_SEED_MARKER = 'virtual_classroom_seed_v1';

export const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE'];
export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'INACTIVE'];
export const CLASS_STATUSES = ['DRAFT', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
export const DELIVERY_MODES = ['OFFLINE', 'ONLINE', 'HYBRID'];

/** Chuỗi thời gian theo giờ Việt Nam (+07:00), thống nhất với dữ liệu `sessions` hiện có. */
export function vnIso(date) {
  const shifted = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

export function vnDate(date = new Date()) {
  return vnIso(date).slice(0, 10);
}

export function vnDateTime(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00+07:00`;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function addColumn(db, table, column, definition) {
  const cols = columnNames(db, table).map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const SUBJECT_CLASSES_DDL = (name) => `
  CREATE TABLE ${name} (
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
  )`;

function ensureSubjectClasses(db) {
  const info = columnNames(db, 'subject_classes');
  if (info.length === 0) {
    db.exec(SUBJECT_CLASSES_DDL('subject_classes'));
    return;
  }
  const courseCol = info.find((c) => c.name === 'course_id');
  const hasStatus = info.some((c) => c.name === 'status');
  if (courseCol && courseCol.notnull === 0 && hasStatus) return;

  // Tái tạo bảng an toàn: giữ nguyên toàn bộ dữ liệu cũ.
  const oldCols = info.map((c) => c.name);
  const keep = [
    'id', 'course_id', 'code', 'title', 'instructor_name', 'ta_names_json',
    'schedule_text', 'room', 'student_count',
  ].filter((c) => oldCols.includes(c));
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE IF EXISTS subject_classes__new');
    db.exec(SUBJECT_CLASSES_DDL('subject_classes__new'));
    db.exec(
      `INSERT INTO subject_classes__new (${keep.join(', ')}, status, created_at, updated_at)
       SELECT ${keep.join(', ')}, 'ACTIVE', datetime('now'), datetime('now') FROM subject_classes`
    );
    db.exec('DROP TABLE subject_classes');
    db.exec('ALTER TABLE subject_classes__new RENAME TO subject_classes');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function ensureTeachingSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // ---- Khóa học (mở rộng bảng courses hiện có) ----
  addColumn(db, 'courses', 'description', 'TEXT');
  addColumn(db, 'courses', 'thumbnail_url', 'TEXT');
  addColumn(db, 'courses', 'subject', 'TEXT');
  addColumn(db, 'courses', 'objectives', 'TEXT');
  addColumn(db, 'courses', 'target_audience', 'TEXT');
  addColumn(db, 'courses', 'prerequisites', 'TEXT');
  addColumn(db, 'courses', 'intro', 'TEXT');
  addColumn(db, 'courses', 'status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");
  addColumn(db, 'courses', 'created_by', 'TEXT');
  addColumn(db, 'courses', 'created_at', 'TEXT');
  addColumn(db, 'courses', 'archived_at', 'TEXT');

  // ---- Chương / bài học (mở rộng bảng hiện có) ----
  addColumn(db, 'chapters', 'course_id', 'TEXT');
  addColumn(db, 'chapters', 'description', 'TEXT');
  addColumn(db, 'chapters', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'chapters', 'status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");
  addColumn(db, 'chapters', 'updated_at', 'TEXT');

  addColumn(db, 'lessons', 'description', 'TEXT');
  addColumn(db, 'lessons', 'objectives', 'TEXT');
  addColumn(db, 'lessons', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'lessons', 'publish_status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");
  addColumn(db, 'lessons', 'published_at', 'TEXT');
  addColumn(db, 'lessons', 'updated_at', 'TEXT');
  addColumn(db, 'lessons', 'completion_rule', "TEXT NOT NULL DEFAULT 'MANUAL'");
  addColumn(db, 'lessons', 'min_video_watch_pct', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'lessons', 'require_video_quizzes', 'INTEGER NOT NULL DEFAULT 1');

  if (columnNames(db, 'lesson_versions').length > 0) {
    addColumn(db, 'lesson_versions', 'markers_snapshot_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, 'lesson_versions', 'change_note', 'TEXT');
  }

  // ---- Lớp học ----
  ensureSubjectClasses(db);
  addColumn(db, 'subject_classes', 'default_virtual_room_id', 'TEXT');
  addColumn(db, 'subject_classes', 'attendance_rules_json', 'TEXT');
  // Bổ sung đơn vị / môn học cho lớp cũ còn thiếu (lấy từ khóa học) — idempotent.
  db.exec(`
    UPDATE subject_classes SET
      department_id = COALESCE(department_id, (SELECT c.department_id FROM courses c WHERE c.id = subject_classes.course_id)),
      subject = COALESCE(subject, (SELECT c.subject FROM courses c WHERE c.id = subject_classes.course_id))
    WHERE course_id IS NOT NULL AND (department_id IS NULL OR subject IS NULL)
  `);

  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON class_enrollments(student_id, status);

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
    CREATE INDEX IF NOT EXISTS idx_staff_user ON teaching_staff_assignments(user_id, is_active);
  `);

  // ---- Buổi học: bảng sessions hiện có ≙ class_sessions + teaching_session_status ----
  addColumn(db, 'sessions', 'room_or_link', 'TEXT');
  addColumn(db, 'sessions', 'session_status', "TEXT NOT NULL DEFAULT 'SCHEDULED'");
  addColumn(db, 'sessions', 'cancel_reason', 'TEXT');
  addColumn(db, 'sessions', 'attendance_saved_at', 'TEXT');
  addColumn(db, 'sessions', 'attendance_saved_by', 'TEXT');
  addColumn(db, 'sessions', 'attendance_locked_at', 'TEXT');
  addColumn(db, 'sessions', 'attendance_locked_by', 'TEXT');
  addColumn(db, 'sessions', 'created_by', 'TEXT');
  addColumn(db, 'sessions', 'created_at', 'TEXT');
  addColumn(db, 'sessions', 'delivery_mode', "TEXT NOT NULL DEFAULT 'OFFLINE'");
  addColumn(db, 'sessions', 'teaching_content', 'TEXT');
  addColumn(db, 'sessions', 'virtual_room_id', 'TEXT');
  addColumn(db, 'sessions', 'live_status', "TEXT NOT NULL DEFAULT 'NOT_STARTED'");
  addColumn(db, 'sessions', 'live_started_at', 'TEXT');
  addColumn(db, 'sessions', 'live_ended_at', 'TEXT');
  addColumn(db, 'sessions', 'attendance_sync_status', "TEXT NOT NULL DEFAULT 'IDLE'");
  addColumn(db, 'sessions', 'attendance_rules_json', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_class_start ON sessions(subject_class_id, scheduled_start_at)');

  // ---- Điểm danh ----
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_attendance_class_student ON attendance_records(subject_class_id, student_id);

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
    CREATE INDEX IF NOT EXISTS idx_attendance_audit_record ON attendance_audit_logs(attendance_record_id);

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

    CREATE TABLE IF NOT EXISTS api_idempotency_keys (
      idempotency_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // ---- Tài nguyên học tập, Lesson Studio, Ngân hàng câu hỏi & Video Quiz tương tác ----
  const LEARNING_RESOURCES_DDL = (name) => `
    CREATE TABLE ${name} (
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
      file_size_bytes INTEGER,
      checksum_sha256 TEXT,
      duration_seconds REAL,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'READY',
      processing_status TEXT NOT NULL DEFAULT 'READY',
      error_message TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`;

  const lrMaster = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'learning_resources'").get();
  if (!lrMaster) {
    db.exec(LEARNING_RESOURCES_DDL('learning_resources'));
  } else if (!String(lrMaster.sql).includes("'VIDEO'")) {
    const oldCols = columnNames(db, 'learning_resources').map((c) => c.name);
    const keep = [
      'id', 'course_id', 'title', 'resource_type', 'storage_provider', 'storage_key',
      'file_name', 'mime_type', 'file_size_bytes', 'checksum_sha256', 'status',
      'created_by', 'created_at', 'updated_at', 'deleted_at',
    ].filter((c) => oldCols.includes(c));
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec('DROP TABLE IF EXISTS learning_resources__new');
      db.exec(LEARNING_RESOURCES_DDL('learning_resources__new'));
      db.exec(
        `INSERT INTO learning_resources__new (${keep.join(', ')})
         SELECT ${keep.join(', ')} FROM learning_resources`
      );
      db.exec('DROP TABLE learning_resources');
      db.exec('ALTER TABLE learning_resources__new RENAME TO learning_resources');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  } else {
    addColumn(db, 'learning_resources', 'class_id', 'TEXT');
    addColumn(db, 'learning_resources', 'description', 'TEXT');
    addColumn(db, 'learning_resources', 'visibility', "TEXT NOT NULL DEFAULT 'ENROLLED'");
    addColumn(db, 'learning_resources', 'duration_seconds', 'REAL');
    addColumn(db, 'learning_resources', 'thumbnail_url', 'TEXT');
    addColumn(db, 'learning_resources', 'processing_status', "TEXT NOT NULL DEFAULT 'READY'");
    addColumn(db, 'learning_resources', 'error_message', 'TEXT');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_resources_course ON learning_resources(course_id, deleted_at);

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
      started_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      completed_at TEXT,
      CONSTRAINT uq_lesson_progress UNIQUE (student_id, subject_class_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS video_upload_sessions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      class_id TEXT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      total_size_bytes INTEGER NOT NULL CHECK (total_size_bytes > 0),
      received_bytes INTEGER NOT NULL DEFAULT 0,
      chunks_received INTEGER NOT NULL DEFAULT 0,
      temp_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','COMPLETED','CANCELLED','FAILED')),
      error_message TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_uploads_course ON video_upload_sessions(course_id, status);

    CREATE TABLE IF NOT EXISTS question_bank_items (
      id TEXT PRIMARY KEY,
      course_id TEXT NULL REFERENCES courses(id) ON DELETE CASCADE,
      subject TEXT,
      question_type TEXT NOT NULL
        CHECK (question_type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','TRUE_FALSE','FILL_BLANK','SHORT_ANSWER')),
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer_key_json TEXT NOT NULL DEFAULT '{}',
      points REAL NOT NULL DEFAULT 1,
      explanation TEXT,
      correct_feedback TEXT,
      wrong_feedback TEXT,
      difficulty TEXT NOT NULL DEFAULT 'MEDIUM',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_question_bank_course ON question_bank_items(course_id, deleted_at);

    CREATE TABLE IF NOT EXISTS video_quiz_markers (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      class_id TEXT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      timestamp_sec REAL NOT NULL CHECK (timestamp_sec >= 0),
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
    CREATE INDEX IF NOT EXISTS idx_video_quiz_markers_lookup
      ON video_quiz_markers(lesson_id, block_id, timestamp_sec, sort_order);

    CREATE TABLE IF NOT EXISTS class_lesson_customs (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      instructor_note TEXT,
      custom_objectives TEXT,
      publish_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (publish_status IN ('DRAFT','PUBLISHED')),
      working_revision INTEGER NOT NULL DEFAULT 1,
      published_snapshot_json TEXT,
      published_at TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_lesson_custom UNIQUE (subject_class_id, lesson_id)
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
    CREATE INDEX IF NOT EXISTS idx_class_lesson_blocks_lookup
      ON class_lesson_blocks(subject_class_id, lesson_id, sort_order);

    CREATE TABLE IF NOT EXISTS video_watch_progress (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      last_position_sec REAL NOT NULL DEFAULT 0,
      max_watched_sec REAL NOT NULL DEFAULT 0,
      watched_seconds REAL NOT NULL DEFAULT 0,
      duration_sec REAL NOT NULL DEFAULT 0,
      watch_pct INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_student_class_video_block UNIQUE (student_id, subject_class_id, lesson_id, block_id)
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
      earned_points REAL NOT NULL DEFAULT 0,
      max_points REAL NOT NULL DEFAULT 1,
      feedback_json TEXT NOT NULL DEFAULT '{}',
      submitted_at TEXT NOT NULL,
      CONSTRAINT uq_student_quiz_attempt UNIQUE (student_id, subject_class_id, target_type, target_id, attempt_number)
    );
    CREATE INDEX IF NOT EXISTS idx_lesson_quiz_submissions_lookup
      ON lesson_quiz_submissions(student_id, subject_class_id, lesson_id);
  `);

  // Nếu bảng virtual_* từ lần thử nghiệm trước thiếu cột chuẩn mới, tái tạo sạch sẽ
  const vpsCols = columnNames(db, 'virtual_participant_sessions').map((c) => c.name);
  if (vpsCols.length > 0 && !vpsCols.includes('is_currently_in_room')) {
    db.exec(`
      DROP TABLE IF EXISTS virtual_sync_jobs;
      DROP TABLE IF EXISTS virtual_attendance_adjustments;
      DROP TABLE IF EXISTS virtual_attendance_calculations;
      DROP TABLE IF EXISTS virtual_identity_mappings;
      DROP TABLE IF EXISTS virtual_participant_sessions;
      DROP TABLE IF EXISTS virtual_webhook_events;
      DROP TABLE IF EXISTS virtual_meeting_rooms;
      DROP TABLE IF EXISTS virtual_provider_configs;
      DELETE FROM app_meta WHERE key = '${VIRTUAL_SEED_MARKER}';
    `);
  }

  db.exec(`
    -- ---- Phòng học trực tuyến & Điểm danh tự động (Virtual Classroom & Auto-Attendance) ----
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
    CREATE INDEX IF NOT EXISTS idx_virtual_rooms_class ON virtual_meeting_rooms(subject_class_id);
    CREATE INDEX IF NOT EXISTS idx_virtual_rooms_session ON virtual_meeting_rooms(session_id);
    CREATE INDEX IF NOT EXISTS idx_virtual_rooms_external ON virtual_meeting_rooms(provider, external_meeting_id);

    CREATE TABLE IF NOT EXISTS virtual_webhook_events (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      external_meeting_id TEXT,
      session_id TEXT NULL,
      event_timestamp_ms INTEGER NOT NULL DEFAULT 0,
      signature_verified INTEGER NOT NULL DEFAULT 0,
      processing_status TEXT NOT NULL DEFAULT 'PROCESSED',
      raw_payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_virtual_webhooks_session ON virtual_webhook_events(session_id, received_at);

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
    CREATE INDEX IF NOT EXISTS idx_virtual_part_session ON virtual_participant_sessions(session_id, virtual_room_id);
    CREATE INDEX IF NOT EXISTS idx_virtual_part_student ON virtual_participant_sessions(session_id, matched_student_id);

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
    CREATE INDEX IF NOT EXISTS idx_virtual_identity_class ON virtual_identity_mappings(subject_class_id, provider);

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
      attendance_ratio_pct REAL NOT NULL DEFAULT 0,
      late_minutes REAL NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_virtual_att_calc_session ON virtual_attendance_calculations(session_id);

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
    CREATE INDEX IF NOT EXISTS idx_virtual_att_adj_session ON virtual_attendance_adjustments(session_id, created_at);

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
  `);
  addColumn(db, 'class_lesson_customs', 'published_snapshot_json', 'TEXT');
}

/** Xóa dữ liệu module giảng dạy (chỉ dùng khi reset seed cho môi trường phát triển/kiểm thử). */
export function clearTeachingData(db) {
  db.exec(`
    DELETE FROM virtual_sync_jobs;
    DELETE FROM virtual_attendance_adjustments;
    DELETE FROM virtual_attendance_calculations;
    DELETE FROM virtual_identity_mappings;
    DELETE FROM virtual_participant_sessions;
    DELETE FROM virtual_webhook_events;
    DELETE FROM virtual_meeting_rooms;
    DELETE FROM virtual_provider_configs;
    DELETE FROM lesson_quiz_submissions;
    DELETE FROM video_watch_progress;
    DELETE FROM class_lesson_blocks;
    DELETE FROM class_lesson_customs;
    DELETE FROM video_quiz_markers;
    DELETE FROM question_bank_items;
    DELETE FROM video_upload_sessions;
    DELETE FROM attendance_audit_logs;
    DELETE FROM attendance_records;
    DELETE FROM attendance_qr_sessions;
    DELETE FROM api_idempotency_keys;
    DELETE FROM lesson_progress;
    DELETE FROM learning_resources;
    DELETE FROM teaching_staff_assignments;
    DELETE FROM class_enrollments;
    DELETE FROM subject_classes;
    DELETE FROM app_meta WHERE key IN ('${TEACHING_SEED_MARKER}', '${STUDIO_SEED_MARKER}', '${VIRTUAL_SEED_MARKER}');
  `);
}

const EXTRA_STUDENT_NAMES = [
  'Phạm Anh Khoa', 'Vũ Bảo Ngọc', 'Đặng Minh Khang', 'Bùi Thảo Vy', 'Hoàng Gia Huy',
  'Ngô Khánh Linh', 'Đỗ Đức Anh', 'Trịnh Mai Phương', 'Lý Quốc Bảo', 'Phan Hà My',
  'Võ Tuấn Kiệt', 'Dương Thùy Dung', 'Tạ Nhật Minh', 'Hồ Ngọc Diệp', 'Mai Đăng Khôi',
  'Lâm Tường Vi', 'Châu Hải Đăng', 'Kiều Bảo Anh', 'Quách Thành Đạt', 'Tô Minh Thư',
  'Lưu Hoàng Nam',
];

const CLASS_5A2_STUDENTS = ['Nguyễn Hoài An', 'Trần Bảo Châu', 'Lê Đức Thịnh'];

function slugEmail(name, suffix) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .split(/\s+/);
  return `${base.slice(-1)[0]}.${base.slice(0, -1).map((p) => p[0]).join('')}${suffix}@lmsplus.edu.vn`;
}

/** Tạo một buổi học trong bảng `sessions` (dùng chung cho seed và API). */
export function insertClassSession(db, s) {
  const deadline = vnIso(new Date(Date.parse(s.scheduled_end_at) + 24 * 3600 * 1000));
  db.prepare(
    `INSERT INTO sessions (session_id, subject_class_id, subject_class_code, subject_title, session_title,
       scheduled_start_at, scheduled_end_at, confirmation_deadline_at, actual_start_at, actual_end_at,
       scheduled_instructor_id, scheduled_instructor_name, actual_instructor_name, is_substitute_teaching,
       ta_names_json, confirmation_status, confirmed_at, is_late_confirmation, reminder_sent_count,
       lessons_delivery_json, room_or_link, session_status, delivery_mode, teaching_content, virtual_room_id,
       live_status, attendance_sync_status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.session_id,
    s.subject_class_id,
    s.subject_class_code,
    s.subject_title,
    s.session_title,
    s.scheduled_start_at,
    s.scheduled_end_at,
    deadline,
    s.scheduled_start_at,
    s.scheduled_end_at,
    s.instructor_id || '',
    s.instructor_name || '',
    s.instructor_name || '',
    JSON.stringify(s.ta_names || []),
    s.confirmation_status || 'AWAITING_CONFIRMATION',
    s.confirmed_at || null,
    s.room_or_link || null,
    s.session_status || 'SCHEDULED',
    s.delivery_mode || 'OFFLINE',
    s.teaching_content || null,
    s.virtual_room_id || null,
    s.live_status || 'NOT_STARTED',
    s.attendance_sync_status || 'IDLE',
    s.created_by || null,
    new Date().toISOString()
  );
}

/**
 * Dữ liệu phát triển cho module giảng dạy (idempotent nhờ app_meta marker).
 * Ghi vào cơ sở dữ liệu thật — Frontend luôn đọc qua API, không dùng dữ liệu giả trong giao diện.
 */
export function seedTeachingData(db, { seed, hashPassword }) {
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(TEACHING_SEED_MARKER);
  if (marker) {
    seedStudioStarterData(db);
    seedVirtualClassroomStarterData(db);
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const passHash = hashPassword('123456');

  db.exec('BEGIN');
  try {
    // 1. Lớp học từ seed gốc (nếu chưa tồn tại).
    const insClass = db.prepare(
      `INSERT OR IGNORE INTO subject_classes (id, course_id, code, title, subject, description, instructor_name,
         ta_names_json, schedule_text, room, student_count, start_date, end_date, max_students, delivery_mode,
         status, department_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
    );
    for (const sc of seed.subject_classes || []) {
      insClass.run(
        sc.id, sc.course_id, sc.code, sc.title, 'Toán', 'Lớp chính khóa năm học 2026–2027.',
        sc.instructor_name, JSON.stringify(sc.ta_names || []), sc.schedule_text || null, sc.room || null,
        sc.student_count || 0, '2026-09-05', '2027-05-25', 40, 'OFFLINE', 'khoi_5', nowIso, nowIso
      );
    }

    // 2. Bổ sung khóa học: trạng thái, mô tả.
    db.prepare(
      `UPDATE courses SET
         status = COALESCE(status, 'PUBLISHED'),
         subject = COALESCE(subject, 'Toán'),
         description = COALESCE(description, 'Chương trình Toán lớp 5: phân số, số thập phân, tỉ số phần trăm và hình học.'),
         objectives = COALESCE(objectives, 'Thành thạo phép tính với phân số, số thập phân; giải toán tỉ số phần trăm; tính diện tích các hình cơ bản.'),
         target_audience = COALESCE(target_audience, 'Học sinh lớp 5'),
         created_at = COALESCE(created_at, ?),
         created_by = COALESCE(created_by, instructor_id)`
    ).run(nowIso);

    // 3. Chương: liên kết course_id theo lớp, thứ tự theo mã.
    db.exec(`
      UPDATE chapters SET course_id = (
        SELECT sc.course_id FROM subject_classes sc WHERE sc.id = chapters.subject_class_id
      ) WHERE course_id IS NULL
    `);
    const chapters = db.prepare('SELECT id FROM chapters ORDER BY code').all();
    chapters.forEach((ch, i) => db.prepare('UPDATE chapters SET sort_order = ? WHERE id = ?').run((i + 1) * 10, ch.id));
    const lessons = db.prepare('SELECT id, chapter_id FROM lessons ORDER BY chapter_id, code').all();
    const perChapter = {};
    for (const l of lessons) {
      perChapter[l.chapter_id] = (perChapter[l.chapter_id] || 0) + 10;
      db.prepare(
        "UPDATE lessons SET sort_order = ?, published_at = COALESCE(published_at, ?) WHERE id = ?"
      ).run(perChapter[l.chapter_id], nowIso, l.id);
    }

    // 4. Học sinh bổ sung cho lớp 5A1 + giáo viên và lớp 5A2 (cùng khóa học → minh họa 1 khóa nhiều lớp).
    const insUser = db.prepare(
      `INSERT OR IGNORE INTO users (id, code, email, full_name, password_hash, roles_json, department_id,
         assigned_course_ids_json, enrolled_subject_class_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, 'khoi_5', '[]', '[]')`
    );
    EXTRA_STUDENT_NAMES.forEach((name, i) => {
      const n = 104 + i;
      insUser.run(`stu_5a1_${n}`, `HS50${n}`, slugEmail(name, n), name, passHash, '["STUDENT"]');
    });
    insUser.run('gv_5002', 'GV5002', 'vankhoa.gv@lmsplus.edu.vn', 'Thầy Đỗ Văn Khoa', passHash, '["INSTRUCTOR"]');
    CLASS_5A2_STUDENTS.forEach((name, i) => {
      const n = 201 + i;
      insUser.run(`stu_5a2_${n}`, `HS50${n}`, slugEmail(name, n), name, passHash, '["STUDENT"]');
    });

    const course = db.prepare('SELECT id FROM courses ORDER BY id LIMIT 1').get();
    if (course) {
      insClass.run(
        'sc_toan5_5a2', course.id, '5A2', 'Toán lớp 5', 'Toán', 'Lớp chính khóa năm học 2026–2027.',
        'Thầy Đỗ Văn Khoa', '[]', 'Thứ Ba, Thứ Năm • Tiết 3 (08:15 – 08:50)', 'Phòng 5A2 – Dãy B',
        3, '2026-09-05', '2027-05-25', 40, 'OFFLINE', 'khoi_5', nowIso, nowIso
      );
    }

    // 5. Phân công giảng dạy.
    const insStaff = db.prepare(
      `INSERT OR IGNORE INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json,
         is_active, assigned_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    );
    const instructor = db.prepare(`SELECT id FROM users WHERE roles_json LIKE '%"INSTRUCTOR"%' AND id <> 'gv_5002' ORDER BY code LIMIT 1`).get();
    const ta = db.prepare(`SELECT id FROM users WHERE roles_json LIKE '%"TEACHING_ASSISTANT"%' ORDER BY code LIMIT 1`).get();
    const staffUser = db.prepare(`SELECT id FROM users WHERE roles_json LIKE '%"ACADEMIC_STAFF"%' LIMIT 1`).get();
    const assignedBy = staffUser ? staffUser.id : null;
    if (instructor) {
      insStaff.run(crypto.randomUUID(), 'sc_toan5_5a1', instructor.id, 'PRIMARY_INSTRUCTOR',
        '{"can_manage_materials":true,"can_take_attendance":true}', assignedBy, nowIso, nowIso);
    }
    if (ta) {
      insStaff.run(crypto.randomUUID(), 'sc_toan5_5a1', ta.id, 'TEACHING_ASSISTANT',
        '{"can_manage_materials":false,"can_take_attendance":true}', assignedBy, nowIso, nowIso);
    }
    insStaff.run(crypto.randomUUID(), 'sc_toan5_5a2', 'gv_5002', 'PRIMARY_INSTRUCTOR',
      '{"can_manage_materials":true,"can_take_attendance":true}', assignedBy, nowIso, nowIso);

    // 6. Ghi danh.
    const insEnroll = db.prepare(
      `INSERT OR IGNORE INTO class_enrollments (id, subject_class_id, student_id, enrollment_source, status, enrolled_at)
       VALUES (?, ?, ?, 'ACADEMIC_ASSIGNED', 'ACTIVE', ?)`
    );
    const enrolledAt = '2026-09-05T00:00:00+07:00';
    const students5a1 = db
      .prepare(`SELECT id FROM users WHERE roles_json LIKE '%"STUDENT"%' AND id NOT LIKE 'stu_5a2_%' ORDER BY code`)
      .all();
    for (const s of students5a1) insEnroll.run(crypto.randomUUID(), 'sc_toan5_5a1', s.id, enrolledAt);
    for (const s of db.prepare(`SELECT id FROM users WHERE id LIKE 'stu_5a2_%'`).all()) {
      insEnroll.run(crypto.randomUUID(), 'sc_toan5_5a2', s.id, enrolledAt);
    }

    // 7. Lịch học 5A1 (T2/T4/T6 07:30–08:05) từ 3 tuần trước đến 2 tuần sau; 5A2 (T3/T5 08:15–08:50).
    const existingDates = new Set(
      db.prepare('SELECT subject_class_id, substr(scheduled_start_at,1,10) d FROM sessions').all()
        .map((r) => `${r.subject_class_id}|${r.d}`)
    );
    db.prepare(
      `UPDATE sessions SET room_or_link = COALESCE(room_or_link, 'Phòng 5A1 – Dãy B'),
         session_status = CASE WHEN scheduled_end_at < ? THEN 'COMPLETED' ELSE session_status END
       WHERE subject_class_id = 'sc_toan5_5a1'`
    ).run(vnIso(now));

    const plan = [
      { classId: 'sc_toan5_5a1', code: '5A1', days: [1, 3, 5], start: '07:30', end: '08:05', room: 'Phòng 5A1 – Dãy B', instructor },
      { classId: 'sc_toan5_5a2', code: '5A2', days: [2, 4], start: '08:15', end: '08:50', room: 'Phòng 5A2 – Dãy B', instructor: { id: 'gv_5002' } },
    ];
    const today = vnDate(now);
    const startDay = new Date(Date.parse(`${today}T00:00:00+07:00`) - 21 * 86400000);
    const lessonTitles = db.prepare('SELECT title FROM lessons ORDER BY chapter_id, code').all().map((r) => r.title);
    for (const p of plan) {
      const instrUser = p.instructor ? db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(p.instructor.id) : null;
      let idx = 0;
      for (let d = 0; d <= 35; d++) {
        const day = new Date(startDay.getTime() + d * 86400000);
        const dateStr = vnDate(new Date(day.getTime() + 12 * 3600000));
        const weekday = new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
        const isToday5a1 = p.classId === 'sc_toan5_5a1' && dateStr === today;
        if (!p.days.includes(weekday) && !isToday5a1) continue;
        if (existingDates.has(`${p.classId}|${dateStr}`)) continue;
        idx++;
        let startAt = vnDateTime(dateStr, p.start);
        let endAt = vnDateTime(dateStr, p.end);
        // Nếu buổi hôm nay của 5A1 chưa bắt đầu (chạy test vào sáng sớm), lùi 90 phút trước giờ hiện tại để luôn có buổi trong vòng 24h
        if (isToday5a1 && Date.parse(endAt) >= now.getTime()) {
          startAt = vnIso(new Date(now.getTime() - 90 * 60000));
          endAt = vnIso(new Date(now.getTime() - 55 * 60000));
        }
        const isPast = Date.parse(endAt) < now.getTime();
        const isOld = Date.parse(endAt) + 24 * 3600000 < now.getTime();
        insertClassSession(db, {
          session_id: `ses_${p.code.toLowerCase()}_${dateStr.replace(/-/g, '')}`,
          subject_class_id: p.classId,
          subject_class_code: p.code,
          subject_title: 'Toán lớp 5',
          session_title: `Tiết Toán — ${lessonTitles[idx % lessonTitles.length] || 'Luyện tập'}`,
          scheduled_start_at: startAt,
          scheduled_end_at: endAt,
          instructor_id: instrUser ? instrUser.id : '',
          instructor_name: instrUser ? instrUser.full_name : '',
          room_or_link: p.room,
          session_status: isPast ? 'COMPLETED' : 'SCHEDULED',
          confirmation_status: isOld ? 'CONFIRMED' : 'AWAITING_CONFIRMATION',
          confirmed_at: isOld ? endAt : null,
        });
      }
    }

    // Một buổi bị hủy trong quá khứ (không được tính vào chuyên cần).
    const cancelTarget = db
      .prepare(`SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND session_id LIKE 'ses_5a1_%'
                AND scheduled_end_at < ? ORDER BY scheduled_start_at LIMIT 1 OFFSET 2`)
      .get(vnIso(now));
    if (cancelTarget) {
      db.prepare("UPDATE sessions SET session_status = 'CANCELLED', cancel_reason = 'Nghỉ do trường tổ chức hội thao' WHERE session_id = ?")
        .run(cancelTarget.session_id);
    }

    // 8. Điểm danh cho các buổi đã diễn ra (trừ buổi hủy và buổi gần nhất → để giáo viên thực hiện).
    const pastSessions = db
      .prepare(`SELECT session_id, subject_class_id, scheduled_start_at, scheduled_end_at FROM sessions
                WHERE session_status = 'COMPLETED' AND scheduled_end_at < ? ORDER BY scheduled_start_at`)
      .all(vnIso(now));
    const latestPerClass = {};
    for (const s of pastSessions) latestPerClass[s.subject_class_id] = s.session_id;
    const insRec = db.prepare(
      `INSERT OR IGNORE INTO attendance_records (id, subject_class_id, class_session_id, student_id, attendance_status,
         check_in_method, check_in_at, note, recorded_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?)`
    );
    const insAudit = db.prepare(
      `INSERT INTO attendance_audit_logs (id, attendance_record_id, previous_status, new_status, change_reason, changed_by, changed_at)
       VALUES (?, ?, NULL, ?, 'Điểm danh lần đầu', ?, ?)`
    );
    pastSessions.forEach((s, sIdx) => {
      if (latestPerClass[s.subject_class_id] === s.session_id) return;
      const roster = db
        .prepare(`SELECT student_id FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE' ORDER BY student_id`)
        .all(s.subject_class_id);
      const staff = db
        .prepare(`SELECT user_id FROM teaching_staff_assignments WHERE subject_class_id = ? AND staff_role = 'PRIMARY_INSTRUCTOR'`)
        .get(s.subject_class_id);
      const actor = staff ? staff.user_id : 'system';
      roster.forEach((r, rIdx) => {
        const v = (rIdx * 7 + sIdx * 3) % 23;
        const status = v === 0 ? 'UNEXCUSED_ABSENCE' : v === 1 ? 'EXCUSED_ABSENCE' : v === 2 || v === 3 ? 'LATE' : 'PRESENT';
        const recId = crypto.randomUUID();
        const checkIn = status === 'PRESENT' || status === 'LATE' ? s.scheduled_start_at : null;
        insRec.run(recId, s.subject_class_id, s.session_id, r.student_id, status, checkIn,
          status === 'EXCUSED_ABSENCE' ? 'Phụ huynh xin phép' : null, actor, actor, s.scheduled_end_at, s.scheduled_end_at);
        insAudit.run(crypto.randomUUID(), recId, status, actor, s.scheduled_end_at);
      });
      db.prepare('UPDATE sessions SET attendance_saved_at = ?, attendance_saved_by = ? WHERE session_id = ?')
        .run(s.scheduled_end_at, actor, s.session_id);
    });

    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(TEACHING_SEED_MARKER, nowIso);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  seedStudioStarterData(db);
  seedVirtualClassroomStarterData(db);
}

/**
 * Khởi tạo dữ liệu mẫu thực tế cho Lesson Studio (Ngân hàng câu hỏi Toán 5 + Video bài giảng có mốc Quiz tương tác ở Bài 1.1).
 * Tách marker riêng để CSDL phát triển hiện có vẫn nhận được dữ liệu mẫu mà không cần xóa dữ liệu cũ.
 */
export function seedStudioStarterData(db) {
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(STUDIO_SEED_MARKER);
  if (marker) return;

  const course = db.prepare("SELECT id, subject, instructor_id FROM courses WHERE id = 'crs_toan5' OR code = 'TOAN5-2026' LIMIT 1").get();
  if (!course) return;

  const nowIso = new Date().toISOString();
  const actor = course.instructor_id || 'usr_gv01';

  db.exec('BEGIN');
  try {
    const insQb = db.prepare(
      `INSERT OR IGNORE INTO question_bank_items (
         id, course_id, subject, question_type, prompt, options_json, answer_key_json,
         points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const qb1Options = [
      { id: 'opt_a', text: '3/4', is_correct: true, feedback: 'Chính xác! Chia cả tử và mẫu của 6/8 cho 2 ta được 3/4.' },
      { id: 'opt_b', text: '2/4', is_correct: false, feedback: 'Chưa đúng, 6 : 2 = 3 chứ không phải 2.' },
      { id: 'opt_c', text: '3/8', is_correct: false, feedback: 'Bạn mới chia tử số cho 2, cần chia cả mẫu số cho 2.' },
      { id: 'opt_d', text: '6/4', is_correct: false, feedback: 'Bạn mới chia mẫu số cho 2, cần chia cả tử số cho 2.' },
    ];
    insQb.run(
      'qb_toan5_01', course.id, course.subject || 'Toán', 'SINGLE_CHOICE',
      'Rút gọn phân số 6/8 về phân số tối giản ta được kết quả nào?',
      JSON.stringify(qb1Options),
      JSON.stringify({ correct_option_ids: ['opt_a'] }),
      2,
      'Theo tính chất cơ bản của phân số: 6/8 = (6 : 2) / (8 : 2) = 3/4.',
      'Tuyệt vời! Bạn đã nắm vững cách rút gọn phân số.',
      'Hãy chia cả tử số và mẫu số của 6/8 cho ước chung lớn nhất là 2 nhé.',
      'EASY', JSON.stringify(['phân số', 'rút gọn']), actor, nowIso, nowIso
    );

    const qb2Options = [
      { id: 'true', text: 'Đúng', is_correct: true, feedback: 'Đúng! Nhân cả tử và mẫu với cùng một số tự nhiên khác 0 thì giá trị phân số không đổi.' },
      { id: 'false', text: 'Sai', is_correct: false, feedback: 'Hãy nhớ lại tính chất cơ bản của phân số vừa xem trong video.' },
    ];
    insQb.run(
      'qb_toan5_02', course.id, course.subject || 'Toán', 'TRUE_FALSE',
      'Phát biểu sau đúng hay sai: "Nếu nhân cả tử số và mẫu số của một phân số với cùng một số tự nhiên khác 0 thì ta được một phân số bằng phân số đã cho."',
      JSON.stringify(qb2Options),
      JSON.stringify({ correct_option_ids: ['true'], boolean_answer: true }),
      1,
      'Đây là tính chất cơ bản thứ nhất của phân số, dùng để quy đồng mẫu số.',
      'Chính xác! Bạn nhớ tính chất cơ bản của phân số rất tốt.',
      'Phát biểu trên là Đúng theo tính chất cơ bản của phân số.',
      'EASY', JSON.stringify(['tính chất phân số']), actor, nowIso, nowIso
    );

    const qb3Options = [
      { id: 'm1', text: '2/3', is_correct: true, feedback: '' },
      { id: 'm2', text: '8/12', is_correct: true, feedback: '' },
      { id: 'm3', text: '4/9', is_correct: false, feedback: '' },
      { id: 'm4', text: '10/15', is_correct: true, feedback: '' },
    ];
    insQb.run(
      'qb_toan5_03', course.id, course.subject || 'Toán', 'MULTIPLE_CHOICE',
      'Chọn TẤT CẢ các phân số bằng với phân số 4/6:',
      JSON.stringify(qb3Options),
      JSON.stringify({ correct_option_ids: ['m1', 'm2', 'm4'] }),
      2,
      'Rút gọn 4/6 được 2/3. Nhân cả tử và mẫu của 2/3 với 4 được 8/12, với 5 được 10/15.',
      'Xuất sắc! Bạn đã tìm đúng tất cả các phân số bằng 4/6.',
      'Gợi ý: Hãy rút gọn 4/6 về 2/3 rồi kiểm tra từng đáp án.',
      'MEDIUM', JSON.stringify(['phân số bằng nhau']), actor, nowIso, nowIso
    );

    insQb.run(
      'qb_toan5_04', course.id, course.subject || 'Toán', 'FILL_BLANK',
      'Điền số thích hợp vào chỗ trống: 3/5 = ___ / 20',
      '[]',
      JSON.stringify({ accepted_texts: ['12'], case_sensitive: false }),
      2,
      'Vì 20 : 5 = 4 nên ta nhân tử số 3 với 4: 3 × 4 = 12.',
      'Chính xác! 3/5 = 12/20.',
      'Mẫu số nhân với 4 (5 × 4 = 20), vậy tử số 3 cũng phải nhân với 4.',
      'MEDIUM', JSON.stringify(['quy đồng', 'điền khuyết']), actor, nowIso, nowIso
    );

    // Gắn khối video tương tác & 3 mốc quiz vào bài les_101 (nếu tồn tại và chưa có khối video mẫu)
    const les101 = db.prepare("SELECT * FROM lessons WHERE id = 'les_101'").get();
    if (les101) {
      const videoBlockId = 'blk_101_vid1';
      const hasVid = db.prepare('SELECT 1 FROM lesson_blocks WHERE id = ?').get(videoBlockId);
      if (!hasVid) {
        const videoContent = {
          source_type: 'YOUTUBE',
          video_id: 'M7lc1UVf-VE',
          title: 'Bài giảng Video tương tác: Ôn tập khái niệm và tính chất phân số',
          description: 'Xem video bài giảng và trả lời các câu hỏi tương tác xuất hiện tại các mốc thời gian trên thanh phát.',
          duration_seconds: 360,
          start_seconds: 0,
          allow_seeking_ahead: true,
        };
        db.prepare(
          `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
           VALUES (?, ?, '1.2', 'video', 1500, 'ACTIVE', ?)`
        ).run(videoBlockId, les101.id, JSON.stringify(videoContent));

        const insMarker = db.prepare(
          `INSERT OR IGNORE INTO video_quiz_markers (
             id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
             question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
             show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?)`
        );

        insMarker.run(
          'vqm_101_01', les101.id, videoBlockId, 30, 10, 'PAUSE_AND_ASK',
          'Kiểm tra nhanh 1: Tính chất phân số', null, 'qb_toan5_02',
          JSON.stringify({
            question_type: 'TRUE_FALSE',
            prompt: 'Phát biểu sau đúng hay sai: "Nếu nhân cả tử số và mẫu số của một phân số với cùng một số tự nhiên khác 0 thì ta được một phân số bằng phân số đã cho."',
            options: qb2Options,
            answer_key: { correct_option_ids: ['true'], boolean_answer: true },
            points: 1,
            explanation: 'Đây là tính chất cơ bản thứ nhất của phân số.',
            correct_feedback: 'Chính xác! Bạn nắm bài rất chắc.',
            wrong_feedback: 'Phát biểu trên là Đúng theo tính chất cơ bản của phân số.',
          }),
          1, 0, 2, actor, nowIso, nowIso
        );

        insMarker.run(
          'vqm_101_02', les101.id, videoBlockId, 135, 20, 'PAUSE_AND_ASK',
          'Kiểm tra nhanh 2: Rút gọn phân số', null, 'qb_toan5_01',
          JSON.stringify({
            question_type: 'SINGLE_CHOICE',
            prompt: 'Rút gọn phân số 6/8 về phân số tối giản ta được kết quả nào?',
            options: qb1Options,
            answer_key: { correct_option_ids: ['opt_a'] },
            points: 2,
            explanation: 'Chia cả tử và mẫu của 6/8 cho 2 ta được 3/4.',
            correct_feedback: 'Tuyệt vời! 6/8 = 3/4.',
            wrong_feedback: 'Hãy chia cả tử và mẫu của 6/8 cho 2 nhé.',
          }),
          1, 0, 3, actor, nowIso, nowIso
        );

        insMarker.run(
          'vqm_101_03', les101.id, videoBlockId, 280, 30, 'PAUSE_OPTIONAL',
          'Thử thách nâng cao: Điền số thích hợp', null, 'qb_toan5_04',
          JSON.stringify({
            question_type: 'FILL_BLANK',
            prompt: 'Điền số thích hợp vào chỗ trống: 3/5 = ___ / 20',
            options: [],
            answer_key: { accepted_texts: ['12'], case_sensitive: false },
            points: 2,
            explanation: 'Vì 20 : 5 = 4 nên 3 × 4 = 12.',
            correct_feedback: 'Xuất sắc! 3/5 = 12/20.',
            wrong_feedback: 'Gợi ý: Mẫu số nhân với 4 thì tử số cũng nhân với 4.',
          }),
          0, 1, 2, actor, nowIso, nowIso
        );

        // Đồng bộ snapshot phiên bản xuất bản mới nhất của les_101 để học viên thấy ngay video + mốc quiz
        const allBlocks = db
          .prepare('SELECT id, block_type, sort_order, status, content_json FROM lesson_blocks WHERE lesson_id = ? ORDER BY sort_order')
          .all(les101.id)
          .map((b) => ({ id: b.id, block_type: b.block_type, sort_order: b.sort_order, status: b.status, content: JSON.parse(b.content_json) }));
        const allMarkers = db
          .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec, sort_order')
          .all(les101.id);
        const latestVer = db
          .prepare('SELECT id FROM lesson_versions WHERE lesson_id = ? ORDER BY version_number DESC LIMIT 1')
          .get(les101.id);
        if (latestVer) {
          db.prepare('UPDATE lesson_versions SET blocks_snapshot_json = ?, markers_snapshot_json = ? WHERE id = ?')
            .run(JSON.stringify(allBlocks), JSON.stringify(allMarkers), latestVer.id);
        }
      }
    }

    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(STUDIO_SEED_MARKER, nowIso);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Khởi tạo dữ liệu mẫu cho Hệ thống Phòng học trực tuyến & Tự động điểm danh (Zoom, Google Meet, External Link).
 * Giữ nguyên trạng thái `attendance_saved_at IS NULL` trên buổi học gần nhất của 5A1 để tương thích 100% với bộ test hiện hữu,
 * đồng thời cung cấp sẵn phiên tham gia Zoom thực tế + 1 người tham gia UNKNOWN chờ giảng viên đối soát.
 */
export function seedVirtualClassroomStarterData(db) {
  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(VIRTUAL_SEED_MARKER);
  if (marker) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const nowVnStr = vnIso(now);

  db.exec('BEGIN');
  try {
    // 1. Cấu hình nhà cung cấp mặc định (Zoom, Google Meet, Link bên ngoài)
    const insProv = db.prepare(
      `INSERT OR IGNORE INTO virtual_provider_configs (
         provider, display_name, auth_mode, account_id, client_id,
         encrypted_credentials_json, scopes_json, capabilities_json,
         connection_status, last_verified_at, status_message, updated_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?)`
    );

    insProv.run(
      'ZOOM',
      'Zoom Meetings (REST API v2 & Webhooks)',
      'SERVER_TO_SERVER_OAUTH',
      'lmsplus_zoom_acct_2026',
      'zoom_s2s_client_lmsplus',
      encryptJsonCredentials({
        client_secret: 'zoom_s2s_secret_lmsplus_prod_key',
        webhook_secret_token: 'lmsplus-zoom-webhook-secret-2026',
        default_host_email: 'lethuha.gv@lmsplus.edu.vn',
      }),
      JSON.stringify([
        'meeting:write:meeting:admin',
        'meeting:read:meeting:admin',
        'meeting:read:list_past_participants:admin',
        'report:read:meeting:admin',
      ]),
      JSON.stringify({
        create_meeting: true,
        update_meeting: true,
        delete_meeting: true,
        live_webhooks: true,
        past_meeting_report: true,
        auto_attendance: true,
      }),
      'SANDBOX_READY',
      nowIso,
      'Đã cấu hình Server-to-Server OAuth & Webhook HMAC-SHA256.',
      nowIso
    );

    insProv.run(
      'GOOGLE_MEET',
      'Google Meet (Google Workspace Meet REST API v2)',
      'GOOGLE_WORKSPACE_OAUTH2',
      'lmsplus.edu.vn',
      'lmsplus-gmeet.apps.googleusercontent.com',
      encryptJsonCredentials({
        client_secret: 'gmeet_workspace_secret_2026',
        webhook_secret_token: 'lmsplus_gmeet_pubsub_token_2026',
        workspace_domain: 'lmsplus.edu.vn',
      }),
      JSON.stringify([
        'https://www.googleapis.com/auth/meetings.space.created',
        'https://www.googleapis.com/auth/meetings.space.readonly',
        'https://www.googleapis.com/auth/meetings.conference.media.readonly',
      ]),
      JSON.stringify({
        create_meeting: true,
        conference_records: true,
        participant_sessions: true,
        auto_attendance: true,
      }),
      'SANDBOX_READY',
      nowIso,
      'Hỗ trợ Spaces, ConferenceRecords, Participants & ParticipantSessions cho tài khoản Google Workspace.',
      nowIso
    );

    insProv.run(
      'EXTERNAL',
      'Link phòng học bên ngoài (Thủ công)',
      'MANUAL_LINK',
      '',
      '',
      encryptJsonCredentials({}),
      '[]',
      JSON.stringify({
        create_meeting: false,
        live_webhooks: false,
        auto_attendance: false,
      }),
      'MANUAL_ONLY',
      nowIso,
      'Chưa hỗ trợ đồng bộ điểm danh tự động với nền tảng này',
      nowIso
    );

    // 2. Gắn phòng học Zoom & dữ liệu tham gia vào buổi học gần nhất chưa chốt điểm danh của lớp 5A1
    const reviewSession = db
      .prepare(
        `SELECT * FROM sessions
         WHERE subject_class_id = 'sc_toan5_5a1'
           AND session_status <> 'CANCELLED'
           AND attendance_saved_at IS NULL
           AND scheduled_start_at <= ?
         ORDER BY scheduled_start_at DESC LIMIT 1`
      )
      .get(nowVnStr);

    if (reviewSession) {
      const roomId = 'vmr_5a1_review';
      const meetingId = '89241057712';
      const joinUrl = `https://zoom.us/j/${meetingId}?pwd=lmsplus5a1`;
      const hostStartUrl = `https://zoom.us/s/${meetingId}?zak=host_zak_token_5a1_review`;

      db.prepare(
        `INSERT OR IGNORE INTO virtual_meeting_rooms (
           id, subject_class_id, session_id, provider, external_platform_name, creation_mode,
           is_recurring_room, room_title, external_meeting_id, external_meeting_uuid, join_url,
           encrypted_host_start_url, encrypted_passcode, scheduled_start_at, scheduled_end_at,
           room_status, supports_auto_sync, provider_metadata_json, created_by, created_at, updated_at
         ) VALUES (?, 'sc_toan5_5a1', ?, 'ZOOM', 'Zoom Meeting', 'AUTO_API', 0, ?, ?, ?, ?, ?, ?, ?, ?, 'ENDED', 1, ?, 'usr_gv01', ?, ?)`
      ).run(
        roomId,
        reviewSession.session_id,
        `${reviewSession.session_title} (Zoom Trực tuyến)`,
        meetingId,
        'zm_uuid_5a1_review_2026',
        joinUrl,
        encryptSecret(hostStartUrl),
        encryptSecret('5012026'),
        reviewSession.scheduled_start_at,
        reviewSession.scheduled_end_at,
        JSON.stringify({ formatted_meeting_id: '892 4105 7712', waiting_room: false, auto_recording: 'cloud' }),
        nowIso,
        nowIso
      );

      db.prepare(
        `UPDATE sessions SET
           delivery_mode = 'ONLINE',
           teaching_content = COALESCE(teaching_content, 'Ôn tập phân số, quy đồng mẫu số và giải bài toán tỉ số phần trăm trực tuyến qua Zoom.'),
           virtual_room_id = ?,
           room_or_link = ?,
           live_status = 'ENDED',
           live_started_at = ?,
           live_ended_at = ?,
           attendance_sync_status = 'NEEDS_REVIEW'
         WHERE session_id = ?`
      ).run(
        roomId,
        'Zoom · ID: 892 4105 7712',
        reviewSession.scheduled_start_at,
        reviewSession.scheduled_end_at,
        reviewSession.session_id
      );

      // Tạo log phiên tham gia thực tế cho học sinh lớp 5A1
      const roster = db
        .prepare(
          `SELECT u.id, u.code, u.full_name, u.email
           FROM class_enrollments e JOIN users u ON u.id = e.student_id
           WHERE e.subject_class_id = 'sc_toan5_5a1' AND e.status = 'ACTIVE'
           ORDER BY u.code`
        )
        .all();

      const startMs = Date.parse(reviewSession.scheduled_start_at);
      const endMs = Date.parse(reviewSession.scheduled_end_at);
      const windowSec = Math.max(60, Math.round((endMs - startMs) / 1000)); // 35 phút = 2100s

      const insPart = db.prepare(
        `INSERT OR IGNORE INTO virtual_participant_sessions (
           id, session_key, session_id, virtual_room_id, provider,
           external_participant_id, registrant_id, lms_join_token, participant_email, display_name,
           matched_student_id, identity_match_method, join_at, leave_at, duration_sec,
           is_currently_in_room, device_info, source, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'ZOOM', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'WEBHOOK', ?, ?)`
      );

      const insCalc = db.prepare(
        `INSERT OR IGNORE INTO virtual_attendance_calculations (
           id, session_id, subject_class_id, student_id,
           first_join_at, last_leave_at, raw_sessions_count, merged_intervals_json,
           total_merged_duration_sec, valid_window_duration_sec, required_window_duration_sec,
           attendance_ratio_pct, late_minutes, calculated_status, final_status,
           identity_match_method, is_manually_adjusted, calculated_at
         ) VALUES (?, ?, 'sc_toan5_5a1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      );

      roster.forEach((stu, idx) => {
        if (idx === 0) {
          // Học sinh đầu tiên: vào 3 lần (mất mạng vào lại) -> 3 khoảng rời nhau
          const s1Start = vnIso(new Date(startMs));
          const s1End = vnIso(new Date(startMs + 12 * 60000));
          const s2Start = vnIso(new Date(startMs + 14 * 60000));
          const s2End = vnIso(new Date(startMs + 24 * 60000));
          const s3Start = vnIso(new Date(startMs + 25 * 60000));
          const s3End = vnIso(new Date(endMs));
          insPart.run(`vps_${reviewSession.session_id}_${idx}_1`, `sk_${reviewSession.session_id}_${idx}_1`, reviewSession.session_id, roomId, `zp_${stu.code}_1`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', s1Start, s1End, 720, 'Zoom Desktop (Windows)', nowIso, nowIso);
          insPart.run(`vps_${reviewSession.session_id}_${idx}_2`, `sk_${reviewSession.session_id}_${idx}_2`, reviewSession.session_id, roomId, `zp_${stu.code}_2`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', s2Start, s2End, 600, 'Zoom Desktop (Windows)', nowIso, nowIso);
          insPart.run(`vps_${reviewSession.session_id}_${idx}_3`, `sk_${reviewSession.session_id}_${idx}_3`, reviewSession.session_id, roomId, `zp_${stu.code}_3`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', s3Start, s3End, 600, 'Zoom Mobile (iOS)', nowIso, nowIso);
          const validSec = 720 + 600 + 600; // 1920s / 2100s = 91.4%
          const pct = Math.round((validSec / windowSec) * 1000) / 10;
          insCalc.run(
            `vac_${reviewSession.session_id}_${stu.id}`,
            reviewSession.session_id,
            stu.id,
            s1Start,
            s3End,
            3,
            JSON.stringify([
              { start_at: s1Start, end_at: s1End, durationSec: 720 },
              { start_at: s2Start, end_at: s2End, durationSec: 600 },
              { start_at: s3Start, end_at: s3End, durationSec: 600 },
            ]),
            validSec,
            validSec,
            windowSec,
            pct,
            0,
            'PRESENT',
            'PRESENT',
            'VERIFIED_EMAIL',
            nowIso
          );
        } else if (idx === 1) {
          // Học sinh thứ 2: vào muộn 12 phút nhưng học đến hết giờ -> LATE
          const jAt = vnIso(new Date(startMs + 12 * 60000));
          const lAt = vnIso(new Date(endMs));
          const dur = Math.max(60, Math.round((endMs - (startMs + 12 * 60000)) / 1000));
          const pct = Math.round((dur / windowSec) * 1000) / 10;
          insPart.run(`vps_${reviewSession.session_id}_${idx}_1`, `sk_${reviewSession.session_id}_${idx}_1`, reviewSession.session_id, roomId, `zp_${stu.code}_1`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', jAt, lAt, dur, 'Zoom Web Client', nowIso, nowIso);
          insCalc.run(
            `vac_${reviewSession.session_id}_${stu.id}`,
            reviewSession.session_id,
            stu.id,
            jAt,
            lAt,
            1,
            JSON.stringify([{ start_at: jAt, end_at: lAt, durationSec: dur }]),
            dur,
            dur,
            windowSec,
            pct,
            12,
            'LATE',
            'LATE',
            'VERIFIED_EMAIL',
            nowIso
          );
        } else if (idx === 2) {
          // Học sinh thứ 3: chỉ tham gia 10 phút rồi thoát -> PARTIAL
          const jAt = vnIso(new Date(startMs + 2 * 60000));
          const lAt = vnIso(new Date(startMs + 12 * 60000));
          const dur = 600;
          const pct = Math.round((dur / windowSec) * 1000) / 10;
          insPart.run(`vps_${reviewSession.session_id}_${idx}_1`, `sk_${reviewSession.session_id}_${idx}_1`, reviewSession.session_id, roomId, `zp_${stu.code}_1`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', jAt, lAt, dur, 'Zoom Desktop', nowIso, nowIso);
          insCalc.run(
            `vac_${reviewSession.session_id}_${stu.id}`,
            reviewSession.session_id,
            stu.id,
            jAt,
            lAt,
            1,
            JSON.stringify([{ start_at: jAt, end_at: lAt, durationSec: dur }]),
            dur,
            dur,
            windowSec,
            pct,
            2,
            'PARTIAL',
            'PARTIAL',
            'VERIFIED_EMAIL',
            nowIso
          );
        } else if (idx === roster.length - 1) {
          // Học sinh cuối danh sách: chưa đối chiếu vì vào bằng thiết bị ngoài không có email -> MANUAL_REVIEW
          insCalc.run(
            `vac_${reviewSession.session_id}_${stu.id}`,
            reviewSession.session_id,
            stu.id,
            null,
            null,
            0,
            '[]',
            0,
            0,
            windowSec,
            0,
            0,
            'MANUAL_REVIEW',
            'MANUAL_REVIEW',
            'NONE',
            nowIso
          );
        } else {
          // Các học sinh còn lại tham gia đầy đủ -> PRESENT
          const jAt = vnIso(new Date(startMs + (idx % 4) * 60000));
          const lAt = vnIso(new Date(endMs));
          const dur = Math.max(60, Math.round((endMs - (startMs + (idx % 4) * 60000)) / 1000));
          const pct = Math.round((dur / windowSec) * 1000) / 10;
          insPart.run(`vps_${reviewSession.session_id}_${idx}_1`, `sk_${reviewSession.session_id}_${idx}_1`, reviewSession.session_id, roomId, `zp_${stu.code}_1`, `reg_${stu.code}`, stu.email, stu.full_name, stu.id, 'VERIFIED_EMAIL', jAt, lAt, dur, 'Zoom Desktop', nowIso, nowIso);
          insCalc.run(
            `vac_${reviewSession.session_id}_${stu.id}`,
            reviewSession.session_id,
            stu.id,
            jAt,
            lAt,
            1,
            JSON.stringify([{ start_at: jAt, end_at: lAt, durationSec: dur }]),
            dur,
            dur,
            windowSec,
            pct,
            idx % 4,
            'PRESENT',
            'PRESENT',
            'VERIFIED_EMAIL',
            nowIso
          );
        }
      });

      // Thêm 1 người tham gia UNKNOWN (chỉ có display_name "iPad Phụ huynh (Chưa đăng nhập email)", không có email)
      const unkJoin = vnIso(new Date(startMs + 3 * 60000));
      const unkLeave = vnIso(new Date(endMs - 2 * 60000));
      const unkDur = Math.max(60, Math.round((Date.parse(unkLeave) - Date.parse(unkJoin)) / 1000));
      insPart.run(
        `vps_${reviewSession.session_id}_unknown_1`,
        `sk_${reviewSession.session_id}_unknown_1`,
        reviewSession.session_id,
        roomId,
        'zp_guest_ipad_99',
        null,
        null,
        'iPad Phụ huynh (Chưa đăng nhập email)',
        null,
        'UNKNOWN',
        unkJoin,
        unkLeave,
        unkDur,
        'iPadOS Zoom Client',
        nowIso,
        nowIso
      );

      db.prepare(
        `INSERT OR IGNORE INTO virtual_sync_jobs (
           id, session_id, virtual_room_id, provider, trigger_source, status, attempt_count,
           participants_fetched, matched_students, unknown_participants, started_at, completed_at
         ) VALUES (?, ?, ?, 'ZOOM', 'WEBHOOK_MEETING_ENDED', 'COMPLETED', 1, ?, ?, 1, ?, ?)`
      ).run(
        `vsj_${reviewSession.session_id}_1`,
        reviewSession.session_id,
        roomId,
        roster.length,
        roster.length - 1,
        reviewSession.scheduled_end_at,
        reviewSession.scheduled_end_at
      );
    }

    // 3. Gắn phòng Zoom cho buổi học sắp tới của lớp 5A1 để Giảng viên & Học viên có thể bấm "Tham gia lớp học trực tuyến" ngay
    const upcoming5a1 = db
      .prepare(
        `SELECT * FROM sessions
         WHERE subject_class_id = 'sc_toan5_5a1'
           AND session_status <> 'CANCELLED'
           AND scheduled_end_at >= ?
         ORDER BY scheduled_start_at ASC LIMIT 1`
      )
      .get(nowVnStr);

    if (upcoming5a1) {
      const roomId = 'vmr_5a1_upcoming';
      const meetingId = '89512039944';
      const joinUrl = `https://zoom.us/j/${meetingId}?pwd=lmsplus5a1live`;
      const hostStartUrl = `https://zoom.us/s/${meetingId}?zak=host_zak_token_5a1_upcoming`;
      db.prepare(
        `INSERT OR IGNORE INTO virtual_meeting_rooms (
           id, subject_class_id, session_id, provider, external_platform_name, creation_mode,
           is_recurring_room, room_title, external_meeting_id, external_meeting_uuid, join_url,
           encrypted_host_start_url, encrypted_passcode, scheduled_start_at, scheduled_end_at,
           room_status, supports_auto_sync, provider_metadata_json, created_by, created_at, updated_at
         ) VALUES (?, 'sc_toan5_5a1', ?, 'ZOOM', 'Zoom Meeting', 'AUTO_API', 1, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 1, ?, 'usr_gv01', ?, ?)`
      ).run(
        roomId,
        upcoming5a1.session_id,
        `${upcoming5a1.session_title} (Zoom Trực tuyến)`,
        meetingId,
        'zm_uuid_5a1_upcoming_2026',
        joinUrl,
        encryptSecret(hostStartUrl),
        encryptSecret('501888'),
        upcoming5a1.scheduled_start_at,
        upcoming5a1.scheduled_end_at,
        JSON.stringify({ formatted_meeting_id: '895 1203 9944', waiting_room: false, auto_recording: 'cloud' }),
        nowIso,
        nowIso
      );

      db.prepare(
        `UPDATE sessions SET
           delivery_mode = 'ONLINE',
           teaching_content = COALESCE(teaching_content, 'Bài giảng trực tuyến qua Zoom: Giải toán tỉ số phần trăm & luyện tập tương tác.'),
           virtual_room_id = ?,
           room_or_link = ?,
           live_status = 'NOT_STARTED',
           attendance_sync_status = 'IDLE'
         WHERE session_id = ?`
      ).run(roomId, 'Zoom · ID: 895 1203 9944', upcoming5a1.session_id);

      db.prepare(`UPDATE subject_classes SET default_virtual_room_id = ? WHERE id = 'sc_toan5_5a1'`).run(roomId);
    }

    // 4. Gắn phòng Google Meet cho buổi học sắp tới của lớp 5A2
    const upcoming5a2 = db
      .prepare(
        `SELECT * FROM sessions
         WHERE subject_class_id = 'sc_toan5_5a2'
           AND session_status <> 'CANCELLED'
           AND scheduled_end_at >= ?
         ORDER BY scheduled_start_at ASC LIMIT 1`
      )
      .get(nowVnStr);

    if (upcoming5a2) {
      const roomId = 'vmr_5a2_upcoming';
      const meetCode = 'kxm-pqrs-tuv';
      const joinUrl = `https://meet.google.com/${meetCode}`;
      db.prepare(
        `INSERT OR IGNORE INTO virtual_meeting_rooms (
           id, subject_class_id, session_id, provider, external_platform_name, creation_mode,
           is_recurring_room, room_title, external_meeting_id, external_meeting_uuid, join_url,
           encrypted_host_start_url, encrypted_passcode, scheduled_start_at, scheduled_end_at,
           room_status, supports_auto_sync, provider_metadata_json, created_by, created_at, updated_at
         ) VALUES (?, 'sc_toan5_5a2', ?, 'GOOGLE_MEET', 'Google Meet', 'AUTO_API', 0, ?, ?, ?, ?, ?, NULL, ?, ?, 'SCHEDULED', 1, ?, 'gv_5002', ?, ?)`
      ).run(
        roomId,
        upcoming5a2.session_id,
        `${upcoming5a2.session_title} (Google Meet)`,
        meetCode,
        'spaces/kxm-pqrs-tuv',
        joinUrl,
        encryptSecret(`${joinUrl}?hs=122&authuser=vankhoa.gv@lmsplus.edu.vn`),
        upcoming5a2.scheduled_start_at,
        upcoming5a2.scheduled_end_at,
        JSON.stringify({ space_name: 'spaces/kxm-pqrs-tuv', access_type: 'TRUSTED' }),
        nowIso,
        nowIso
      );

      db.prepare(
        `UPDATE sessions SET
           delivery_mode = 'HYBRID',
           teaching_content = COALESCE(teaching_content, 'Học kết hợp tại Phòng 5A2 và trực tuyến qua Google Meet.'),
           virtual_room_id = ?,
           room_or_link = ?,
           live_status = 'NOT_STARTED',
           attendance_sync_status = 'IDLE'
         WHERE session_id = ?`
      ).run(roomId, `Google Meet · ${meetCode}`, upcoming5a2.session_id);
    }

    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(VIRTUAL_SEED_MARKER, nowIso);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
