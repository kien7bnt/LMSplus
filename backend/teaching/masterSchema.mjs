/**
 * LMSPLUS Master LMS Architecture — Schema SQLite mở rộng & Dữ liệu khởi tạo chuẩn 3 cấp.
 *
 * Bảo đảm tương thích hoàn toàn với:
 *  - PostgreSQL Migration 008 (008_master_lms_architecture_up.sql)
 *  - Dữ liệu hiện hữu (courses, chapters, lessons, subject_classes, sc_toan5_5a1, sessions)
 *  - Ba quyết định nghiệp vụ: Hierarchy LINKED · Subject Version SNAPSHOT · Video Progress STRICT
 */

import crypto from 'node:crypto';
import { insertClassSession, vnDate, vnDateTime } from './schema.mjs';

export const MASTER_LMS_SEED_MARKER = 'master_lms_seed_v1';

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumn(db, table, column, definition) {
  const cols = columnNames(db, table);
  if (cols.length > 0 && !cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function recreateVideoWatchProgressIfNeeded(db) {
  const cols = columnNames(db, 'video_watch_progress');
  if (cols.length === 0) return;
  if (cols.includes('content_version_key') && cols.includes('watched_intervals_json')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE IF EXISTS video_watch_progress__new');
    db.exec(`
      CREATE TABLE video_watch_progress__new (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
        content_version_key TEXT NOT NULL DEFAULT 'v0',
        watched_intervals_json TEXT NOT NULL DEFAULT '[]',
        unique_watched_sec REAL NOT NULL DEFAULT 0,
        max_contiguous_watched_sec REAL NOT NULL DEFAULT 0,
        last_position_sec REAL NOT NULL DEFAULT 0,
        max_watched_sec REAL NOT NULL DEFAULT 0,
        watched_seconds REAL NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        watch_pct INTEGER NOT NULL DEFAULT 0,
        is_completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        CONSTRAINT uq_student_class_video_block_ver UNIQUE (student_id, subject_class_id, lesson_id, block_id, content_version_key)
      )
    `);
    db.exec(`
      INSERT INTO video_watch_progress__new (
        id, student_id, subject_class_id, lesson_id, block_id,
        content_version_key, watched_intervals_json, unique_watched_sec, max_contiguous_watched_sec,
        last_position_sec, max_watched_sec, watched_seconds, duration_sec, watch_pct, is_completed, updated_at
      )
      SELECT
        id, student_id, subject_class_id, lesson_id, block_id,
        'v0',
        CASE
          WHEN max_watched_sec > 0 THEN json_array(json_array(0, ROUND(max_watched_sec, 2)))
          ELSE '[]'
        END,
        MAX(COALESCE(watched_seconds, 0), COALESCE(max_watched_sec, 0)),
        COALESCE(max_watched_sec, 0),
        last_position_sec, max_watched_sec, watched_seconds, duration_sec, watch_pct, is_completed, updated_at
      FROM video_watch_progress
    `);
    db.exec('DROP TABLE video_watch_progress');
    db.exec('ALTER TABLE video_watch_progress__new RENAME TO video_watch_progress');
    db.exec('CREATE INDEX IF NOT EXISTS idx_video_watch_class_lesson ON video_watch_progress(subject_class_id, lesson_id)');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function recreateLessonProgressIfNeeded(db) {
  const cols = columnNames(db, 'lesson_progress');
  if (cols.length === 0 || cols.includes('content_version_key')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE IF EXISTS lesson_progress__new');
    db.exec(`
      CREATE TABLE lesson_progress__new (
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
      )
    `);
    db.exec(`
      INSERT INTO lesson_progress__new (
        id, student_id, subject_class_id, chapter_id, lesson_id, content_version_key, status, started_at, last_accessed_at, completed_at
      )
      SELECT id, student_id, subject_class_id, chapter_id, lesson_id, 'v0', status, started_at, last_accessed_at, completed_at
      FROM lesson_progress
    `);
    db.exec('DROP TABLE lesson_progress');
    db.exec('ALTER TABLE lesson_progress__new RENAME TO lesson_progress');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function ensureMasterLmsSchema(db) {
  // 1. Level 1 & Level 2: Khung chương trình & Lớp khóa học
  db.exec(`
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
    );

    CREATE TABLE IF NOT EXISTS curriculum_subjects (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
      semester_order INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10,
      planned_periods INTEGER NOT NULL DEFAULT 30,
      planned_hours REAL NOT NULL DEFAULT 22.5,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_curriculum_subject UNIQUE (curriculum_id, course_id)
    );
    CREATE INDEX IF NOT EXISTS idx_curriculum_subjects_curr ON curriculum_subjects(curriculum_id, sort_order);

    CREATE TABLE IF NOT EXISTS curriculum_audit_logs (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

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
    );
    CREATE INDEX IF NOT EXISTS idx_program_cohorts_curr ON program_cohorts(curriculum_id);

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
    CREATE INDEX IF NOT EXISTS idx_cohort_enrollments_lookup ON cohort_enrollments(cohort_id, status);

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

    -- 2. Phiên bản môn học bất biến (SNAPSHOT)
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
    CREATE INDEX IF NOT EXISTS idx_course_versions_course ON course_versions(course_id, version_number DESC);

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

    -- 3. Cây 4 tầng: Môn học -> Chủ đề -> Chương -> Bài học
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
    CREATE INDEX IF NOT EXISTS idx_course_topics_course ON course_topics(course_id, sort_order);

    -- 4. Wiki môn học
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
    CREATE INDEX IF NOT EXISTS idx_course_wiki_lookup ON course_wiki_pages(course_id, deleted_at);

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

    -- 5. Ngân hàng bài tập (đồng bộ cây 4 tầng, neo lá Bài học)
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
      max_score REAL NOT NULL DEFAULT 10,
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
    );
    CREATE INDEX IF NOT EXISTS idx_abank_course_lesson ON assignment_bank_items(course_id, lesson_id, deleted_at);

    -- 6. Nhật ký sự kiện xem video STRICT (idempotent + offline sync + tab visibility)
    CREATE TABLE IF NOT EXISTS video_watch_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      content_version_key TEXT NOT NULL DEFAULT 'v0',
      event_type TEXT NOT NULL,
      segment_start_sec REAL,
      segment_end_sec REAL,
      playback_rate REAL NOT NULL DEFAULT 1,
      is_visible INTEGER NOT NULL DEFAULT 1,
      device_session_id TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_events_student ON video_watch_events(student_id, subject_class_id, lesson_id, recorded_at);

    -- 7. Không gian Kiểm tra & Bài tập tách biệt theo Lớp môn học
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
      pass_score_pct REAL NOT NULL DEFAULT 50,
      open_at TEXT,
      close_at TEXT,
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_class_exams_class ON class_exams(subject_class_id, status);

    CREATE TABLE IF NOT EXISTS class_exam_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,
      bank_question_id TEXT NULL,
      question_snapshot_json TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10
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
      auto_score REAL NOT NULL DEFAULT 0,
      manual_score REAL NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 0,
      grading_status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (grading_status IN ('IN_PROGRESS','AUTO_GRADED','PENDING_MANUAL','GRADED')),
      teacher_feedback TEXT,
      graded_by TEXT,
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      graded_at TEXT,
      CONSTRAINT uq_class_exam_attempt UNIQUE (exam_id, student_id, attempt_number)
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
      max_score REAL NOT NULL DEFAULT 10,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      allow_resubmit INTEGER NOT NULL DEFAULT 1,
      due_at TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_class_assignments_class ON class_assignments(subject_class_id, status);

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
      score REAL,
      max_score REAL NOT NULL DEFAULT 10,
      teacher_feedback TEXT,
      graded_by TEXT,
      submitted_at TEXT,
      graded_at TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_assign_sub UNIQUE (class_assignment_id, student_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS class_gradebook_entries (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('EXAM','ASSIGNMENT','MANUAL')),
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      score REAL NOT NULL,
      max_score REAL NOT NULL DEFAULT 10,
      weight REAL NOT NULL DEFAULT 1,
      graded_by TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_class_gradebook_src UNIQUE (subject_class_id, student_id, source_type, source_id)
    );

    -- 8. Lịch sử đơn xin nghỉ & Diễn đàn & Thông báo
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
    CREATE INDEX IF NOT EXISTS idx_teaching_forums_scope ON teaching_forums(scope_type, course_id, subject_class_id);

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

    CREATE TABLE IF NOT EXISTS teaching_forum_helpful (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('THREAD','REPLY')),
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_forum_helpful_user UNIQUE (target_type, target_id, user_id)
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
    CREATE INDEX IF NOT EXISTS idx_teaching_notif_user ON teaching_notifications(user_id, is_read, created_at);
  `);

  // Mở rộng các bảng hiện hữu (idempotent)
  addColumn(db, 'subject_classes', 'cohort_id', 'TEXT NULL');
  addColumn(db, 'subject_classes', 'course_version_id', 'TEXT NULL');
  addColumn(db, 'subject_classes', 'course_version_number', 'INTEGER NULL');
  addColumn(db, 'chapters', 'topic_id', 'TEXT NULL');
  addColumn(db, 'question_bank_items', 'topic_id', 'TEXT NULL');
  addColumn(db, 'question_bank_items', 'chapter_id', 'TEXT NULL');
  addColumn(db, 'question_bank_items', 'lesson_id', 'TEXT NULL');
  addColumn(db, 'learning_resources', 'topic_id', 'TEXT NULL');
  addColumn(db, 'learning_resources', 'chapter_id', 'TEXT NULL');
  addColumn(db, 'learning_resources', 'lesson_id', 'TEXT NULL');
  addColumn(db, 'lesson_quiz_submissions', 'content_version_key', "TEXT NOT NULL DEFAULT 'v0'");

  addColumn(db, 'leave_requests', 'class_session_id', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'student_id', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'reason_category', "TEXT NOT NULL DEFAULT 'OTHER'");
  addColumn(db, 'leave_requests', 'evidence_url', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'evidence_name', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'reviewed_by', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'reviewed_by_name', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'reviewed_at', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'review_note', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'created_at', 'TEXT NULL');
  addColumn(db, 'leave_requests', 'updated_at', 'TEXT NULL');

  recreateLeaveRequestsIfNeeded(db);
  recreateVideoWatchProgressIfNeeded(db);
  recreateLessonProgressIfNeeded(db);
}

function recreateLeaveRequestsIfNeeded(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leave_requests'").get();
  if (!row || String(row.sql).includes("'CANCELLED'")) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE IF EXISTS leave_requests__new');
    db.exec(`
      CREATE TABLE leave_requests__new (
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
      )
    `);
    db.exec(`
      INSERT INTO leave_requests__new (
        id, subject_class_id, student_code, student_name, reason, makeup_class_requested, status,
        class_session_id, student_id, reason_category, evidence_url, evidence_name,
        reviewed_by, reviewed_by_name, reviewed_at, review_note, created_at, updated_at
      )
      SELECT
        id, subject_class_id, student_code, student_name, reason, makeup_class_requested, status,
        class_session_id, student_id, reason_category, evidence_url, evidence_name,
        reviewed_by, reviewed_by_name, reviewed_at, review_note, created_at, updated_at
      FROM leave_requests
    `);
    db.exec('DROP TABLE leave_requests');
    db.exec('ALTER TABLE leave_requests__new RENAME TO leave_requests');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function clearMasterLmsData(db) {
  db.exec(`
    DELETE FROM teaching_notifications;
    DELETE FROM teaching_forum_mod_logs;
    DELETE FROM teaching_forum_reports;
    DELETE FROM teaching_forum_helpful;
    DELETE FROM teaching_forum_replies;
    DELETE FROM teaching_forum_threads;
    DELETE FROM teaching_forums;
    DELETE FROM leave_request_logs;
    DELETE FROM class_gradebook_entries;
    DELETE FROM class_assignment_submissions;
    DELETE FROM class_assignments;
    DELETE FROM class_exam_attempts;
    DELETE FROM class_exam_questions;
    DELETE FROM class_exams;
    DELETE FROM video_watch_events;
    DELETE FROM assignment_bank_items;
    DELETE FROM course_wiki_revisions;
    DELETE FROM course_wiki_pages;
    DELETE FROM course_topics;
    DELETE FROM class_version_upgrade_logs;
    DELETE FROM course_versions;
    DELETE FROM cohort_audit_logs;
    DELETE FROM cohort_enrollments;
    DELETE FROM program_cohorts;
    DELETE FROM curriculum_audit_logs;
    DELETE FROM curriculum_subjects;
    DELETE FROM curricula;
    DELETE FROM app_meta WHERE key = '${MASTER_LMS_SEED_MARKER}';
  `);
}

/** Đảm bảo mỗi Môn học có ít nhất 1 Chủ đề và mọi Chương đều gắn topic_id hợp lệ. */
export function ensureCourseTopicsBackfill(db, courseId = null) {
  const targetCourses = courseId
    ? db.prepare('SELECT id FROM courses WHERE id = ?').all(courseId)
    : db.prepare('SELECT id FROM courses').all();
  const now = new Date().toISOString();

  for (const crs of targetCourses) {
    let defaultTopic = db
      .prepare("SELECT * FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, id LIMIT 1")
      .get(crs.id);
    if (!defaultTopic) {
      const chaptersNeedTopic = db
        .prepare('SELECT COUNT(*) n FROM chapters WHERE course_id = ? AND topic_id IS NULL')
        .get(crs.id).n;
      const allTopicsCount = db.prepare('SELECT COUNT(*) n FROM course_topics WHERE course_id = ?').get(crs.id).n;
      if (chaptersNeedTopic > 0 || allTopicsCount === 0) {
        const tid = `top_${crs.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}_${crypto.randomBytes(3).toString('hex')}`;
        db.prepare(
          `INSERT INTO course_topics (id, course_id, code, title, description, sort_order, status, created_at, updated_at)
           VALUES (?, ?, 'CĐ-01', 'Chủ đề 1: Nội dung trọng tâm', 'Chủ đề nền tảng tổ chức các chương học của môn học.', 10, 'PUBLISHED', ?, ?)`
        ).run(tid, crs.id, now, now);
        defaultTopic = db.prepare('SELECT * FROM course_topics WHERE id = ?').get(tid);
      }
    }
    if (defaultTopic) {
      db.prepare('UPDATE chapters SET topic_id = ? WHERE course_id = ? AND topic_id IS NULL').run(defaultTopic.id, crs.id);
    }
  }
}

export function getClassContentVersionKey(cls) {
  return cls && cls.course_version_id ? `cv:${cls.course_version_id}` : 'v0';
}

export function resolveLessonTreeIds(db, lessonId) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return null;
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(lesson.chapter_id);
  if (!chapter || !chapter.course_id) return null;
  ensureCourseTopicsBackfill(db, chapter.course_id);
  const freshChapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapter.id);
  const topic = freshChapter.topic_id ? db.prepare('SELECT * FROM course_topics WHERE id = ?').get(freshChapter.topic_id) : null;
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(freshChapter.course_id);
  return { lesson, chapter: freshChapter, topic, course };
}

export function buildCourseSnapshotPayload(db, courseId) {
  ensureCourseTopicsBackfill(db, courseId);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) return null;
  const topics = db
    .prepare("SELECT * FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, code")
    .all(courseId);
  const chapters = db
    .prepare("SELECT * FROM chapters WHERE course_id = ? AND status = 'PUBLISHED' ORDER BY sort_order, code")
    .all(courseId);
  const lessons = [];
  const blocksByLesson = {};
  const markersByLesson = {};
  const resourcesByLesson = {};

  for (const ch of chapters) {
    const ls = db
      .prepare("SELECT * FROM lessons WHERE chapter_id = ? AND publish_status = 'PUBLISHED' ORDER BY sort_order, code")
      .all(ch.id);
    for (const l of ls) {
      lessons.push({ ...l, chapter_title: ch.title, topic_id: ch.topic_id });
      const ver = db
        .prepare('SELECT * FROM lesson_versions WHERE lesson_id = ? ORDER BY version_number DESC LIMIT 1')
        .get(l.id);
      if (ver) {
        try {
          blocksByLesson[l.id] = JSON.parse(ver.blocks_snapshot_json || '[]');
        } catch {
          blocksByLesson[l.id] = [];
        }
        try {
          markersByLesson[l.id] = JSON.parse(ver.markers_snapshot_json || '[]');
        } catch {
          markersByLesson[l.id] = [];
        }
      } else {
        blocksByLesson[l.id] = db
          .prepare('SELECT id, block_type, sort_order, content_json FROM lesson_blocks WHERE lesson_id = ? ORDER BY sort_order')
          .all(l.id)
          .map((b) => ({ id: b.id, block_type: b.block_type, sort_order: b.sort_order, content: JSON.parse(b.content_json || '{}') }));
        markersByLesson[l.id] = db
          .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec, sort_order')
          .all(l.id);
      }
      resourcesByLesson[l.id] = db
        .prepare('SELECT id, title, resource_type, storage_key FROM learning_resources WHERE lesson_id = ? AND deleted_at IS NULL')
        .all(l.id);
    }
  }

  const wikiPages = db
    .prepare("SELECT id, title, slug, topic_id, chapter_id, lesson_id, summary FROM course_wiki_pages WHERE course_id = ? AND deleted_at IS NULL AND status = 'PUBLISHED'")
    .all(courseId);

  return {
    schema_version: '1.0',
    course: {
      id: course.id,
      code: course.code,
      title: course.title,
      subject: course.subject || '',
      description: course.description || '',
      objectives: course.objectives || '',
    },
    topics,
    chapters,
    lessons,
    blocks_by_lesson: blocksByLesson,
    markers_by_lesson: markersByLesson,
    resources_by_lesson: resourcesByLesson,
    wiki_pages: wikiPages,
    captured_at: new Date().toISOString(),
  };
}

export function seedMasterLmsStarterData(db) {
  ensureCourseTopicsBackfill(db);

  const marker = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(MASTER_LMS_SEED_MARKER);
  if (marker) return;

  const toanCourse = db.prepare("SELECT * FROM courses WHERE id = 'crs_toan5'").get()
    || db.prepare("SELECT * FROM courses WHERE department_id = 'khoi_5' ORDER BY id LIMIT 1").get();
  if (!toanCourse) return;

  const now = new Date().toISOString();
  const gv2 = db.prepare("SELECT * FROM users WHERE id = 'gv_5002'").get();
  const gv1 = db.prepare("SELECT * FROM users WHERE roles_json LIKE '%\"INSTRUCTOR\"%' AND id <> 'gv_5002' ORDER BY code LIMIT 1").get();
  const staff = db.prepare("SELECT * FROM users WHERE roles_json LIKE '%\"ACADEMIC_STAFF\"%' LIMIT 1").get();
  const admin = db.prepare("SELECT * FROM users WHERE roles_json LIKE '%\"ADMIN\"%' LIMIT 1").get();
  const hs1 = db.prepare("SELECT * FROM users WHERE code = 'HS50101'").get();
  const hs201 = db.prepare("SELECT * FROM users WHERE code = 'HS50201'").get();

  db.exec('BEGIN');
  try {
    // 1. Tạo môn học thứ 2 trong Khung Khối 5: Tiếng Việt 5 (giáo viên gv_5002 phụ trách → không ảnh hưởng dashboard của GV1)
    const tvInstructor = gv2 || gv1;
    db.prepare(
      `INSERT OR IGNORE INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
         chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status, is_assigned_to_student,
         updated_at, description, thumbnail_url, subject, objectives, target_audience, prerequisites, intro,
         status, created_by, created_at)
       VALUES ('crs_tv5', 'TV5-K5', 'Tiếng Việt lớp 5', ?, ?, 'khoi_5', 'Khối 5',
         1, 2, 0, 'ASSIGNED_ONLY', 'NOT_ENROLLED', 0, ?,
         'Rèn kỹ năng đọc hiểu văn bản nghệ thuật, luyện từ và câu, tập làm văn miêu tả và nghị luận ngắn.',
         NULL, 'Tiếng Việt', 'Đọc diễn cảm, nắm vững biện pháp tu từ và viết bài văn mạch lạc.',
         'Học sinh lớp 5', 'Hoàn thành Tiếng Việt lớp 4', 'Khóa học Tiếng Việt 5 thuộc Khung chương trình Tiểu học Khối 5.',
         'PUBLISHED', ?, ?)`
    ).run(tvInstructor ? tvInstructor.id : 'gv_5002', tvInstructor ? tvInstructor.full_name : 'Thầy Đỗ Văn Khoa', now, staff ? staff.id : 'admin', now);

    db.prepare(
      `INSERT OR IGNORE INTO course_topics (id, course_id, code, title, description, sort_order, status, created_at, updated_at)
       VALUES ('top_tv5_1', 'crs_tv5', 'CĐ-01', 'Chủ đề 1: Tiếng nói quê hương', 'Đọc hiểu văn bản và luyện viết cảm thụ.', 10, 'PUBLISHED', ?, ?)`
    ).run(now, now);

    db.prepare(
      `INSERT OR IGNORE INTO chapters (id, subject_class_id, code, title, progress_pct, course_id, topic_id, description, sort_order, status, updated_at)
       VALUES ('ch_tv5_1', '', 'Chương 1', 'Chương 1: Đọc hiểu & Luyện từ và câu', 0, 'crs_tv5', 'top_tv5_1', 'Phân tích từ đồng nghĩa, trái nghĩa và cấu trúc câu ghép.', 10, 'PUBLISHED', ?)`
    ).run(now);

    const tvLessons = [
      { id: 'les_tv5_1', code: '1.1', title: 'Bài 1: Thư gửi các học sinh & Từ đồng nghĩa', dur: 20, sort: 10,
        body: 'Từ đồng nghĩa là những từ có nghĩa giống nhau hoặc gần giống nhau. Ví dụ: siêng năng – chăm chỉ – cần cù.' },
      { id: 'les_tv5_2', code: '1.2', title: 'Bài 2: Mở rộng vốn từ: Tổ quốc & Câu ghép', dur: 25, sort: 20,
        body: 'Câu ghép gồm nhiều vế câu nối với nhau bằng quan hệ từ hoặc trực tiếp bằng dấu phẩy, dấu chấm phẩy.' },
    ];
    for (const l of tvLessons) {
      db.prepare(
        `INSERT OR IGNORE INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
           required_video_pct, require_quick_check, last_video_position_sec, total_video_seconds, quick_check_passed,
           working_draft_revision, published_version, description, objectives, sort_order, publish_status, published_at, updated_at,
           completion_rule, min_video_watch_pct, require_video_quizzes)
         VALUES (?, 'ch_tv5_1', ?, ?, ?, 'IN_PROGRESS', NULL, 85, 0, 0, ?, 0, 1, 1, ?, ?, ?, 'PUBLISHED', ?, ?, 'MANUAL', 0, 0)`
      ).run(l.id, l.code, l.title, l.dur, l.dur * 60, l.body, 'Nhận diện và vận dụng đúng kiến thức Tiếng Việt.', l.sort, now, now);

      const blkId = `blk_${l.id}_1`;
      const blkContent = { text: l.body, heading: l.title };
      const existingBlks = db.prepare('SELECT COUNT(*) n FROM lesson_blocks WHERE lesson_id = ?').get(l.id).n;
      if (existingBlks === 0) {
        db.prepare(
          `INSERT OR IGNORE INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
           VALUES (?, ?, '1.2', 'paragraph', 10, 'ACTIVE', ?)`
        ).run(blkId, l.id, JSON.stringify(blkContent));
        db.prepare(
          `INSERT OR IGNORE INTO lesson_versions (id, lesson_id, version_number, blocks_snapshot_json, markers_snapshot_json, change_note, published_by, published_at)
           VALUES (?, ?, 1, ?, '[]', 'Xuất bản bản chuẩn v1', ?, ?)`
        ).run(
          crypto.randomUUID(),
          l.id,
          JSON.stringify([{ id: blkId, block_type: 'paragraph', sort_order: 10, content: blkContent }]),
          tvInstructor ? tvInstructor.full_name : 'Giảng viên',
          now
        );
      }
    }

    // 2. Phát hành Snapshot v1 cho Tiếng Việt 5 (crs_tv5)
    const tvSnap = buildCourseSnapshotPayload(db, 'crs_tv5');
    db.prepare(
      `INSERT OR IGNORE INTO course_versions (id, course_id, version_number, version_label, status, snapshot_json, changelog_note, published_by, published_by_name, published_at)
       VALUES ('cv_tv5_v1', 'crs_tv5', 1, 'v1.0', 'PUBLISHED', ?, 'Phát hành phiên bản chuẩn năm học 2026-2027', ?, ?, ?)`
    ).run(
      JSON.stringify(tvSnap),
      tvInstructor ? tvInstructor.id : 'gv_5002',
      tvInstructor ? tvInstructor.full_name : 'Thầy Đỗ Văn Khoa',
      now
    );

    // 3. Cấp 1: Khung chương trình chuẩn Khối 5
    db.prepare(
      `INSERT OR IGNORE INTO curricula (id, code, title, description, version, effective_date, department_id, status, created_by, created_at, updated_at)
       VALUES ('curr_tieuhoc_k5', 'CT-TIEUHOC-K5', 'Khung chương trình Tiểu học Khối 5 (Chuẩn 2026–2027)',
         'Khung chương trình liên kết đầy đủ các môn trọng tâm Khối 5, phân bổ học kỳ và chuẩn đầu ra thống nhất.',
         '1.0', '2026-09-05', 'khoi_5', 'ACTIVE', ?, ?, ?)`
    ).run(admin ? admin.id : 'admin', now, now);

    db.prepare(
      `INSERT OR IGNORE INTO curriculum_subjects (id, curriculum_id, course_id, semester_order, sort_order, planned_periods, planned_hours, is_mandatory, note, created_at)
       VALUES ('cs_k5_toan', 'curr_tieuhoc_k5', ?, 1, 10, 70, 45, 1, 'Môn cốt lõi bắt buộc', ?)`
    ).run(toanCourse.id, now);
    db.prepare(
      `INSERT OR IGNORE INTO curriculum_subjects (id, curriculum_id, course_id, semester_order, sort_order, planned_periods, planned_hours, is_mandatory, note, created_at)
       VALUES ('cs_k5_tv', 'curr_tieuhoc_k5', 'crs_tv5', 1, 20, 60, 40, 1, 'Môn cốt lõi bắt buộc', ?)`
    ).run(now);

    db.prepare(
      `INSERT OR IGNORE INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at)
       VALUES ('curlog_init_k5', 'curr_tieuhoc_k5', 'CURRICULUM_INITIALIZED', '{"subjects_count":2}', ?, ?, ?)`
    ).run(admin ? admin.id : 'admin', admin ? admin.full_name : 'Quản trị hệ thống', now);

    // 4. Cấp 2: Lớp khóa học 5A1 (Niên khóa 2026-2027) -> đồng bộ 24 học viên 5A1
    db.prepare(
      `INSERT OR IGNORE INTO program_cohorts (id, curriculum_id, code, title, academic_year, semester, start_date, end_date,
         delivery_mode, location_note, coordinator_id, coordinator_name, max_students, department_id, status, created_by, created_at, updated_at)
       VALUES ('coh_k5_5a1', 'curr_tieuhoc_k5', 'KHOAHOC-5A1-2026', 'Lớp Khóa học 5A1 – Niên khóa 2026–2027',
         '2026–2027', 'Học kỳ 1 & 2', '2026-09-05', '2027-05-25', 'HYBRID', 'Cơ sở 1 – Phòng 5A1 & Zoom',
         ?, ?, 35, 'khoi_5', 'ACTIVE', ?, ?, ?)`
    ).run(
      staff ? staff.id : null,
      staff ? staff.full_name : 'Nguyễn Thu Trang (Giáo vụ)',
      staff ? staff.id : null,
      now,
      now
    );

    // Đưa đúng 24 học viên đang học ở sc_toan5_5a1 vào Lớp khóa học coh_k5_5a1
    const sc5a1Students = db
      .prepare("SELECT student_id, enrolled_at FROM class_enrollments WHERE subject_class_id = 'sc_toan5_5a1' AND status = 'ACTIVE'")
      .all();
    for (const s of sc5a1Students) {
      db.prepare(
        `INSERT OR IGNORE INTO cohort_enrollments (id, cohort_id, student_id, status, enrolled_at, note)
         VALUES (?, 'coh_k5_5a1', ?, 'ACTIVE', ?, 'Học viên chính khóa từ khi mở lớp khóa học')`
      ).run(crypto.randomUUID(), s.student_id, s.enrolled_at || now);
      db.prepare(
        `UPDATE class_enrollments SET enrollment_source = 'COHORT_SYNCED'
         WHERE subject_class_id = 'sc_toan5_5a1' AND student_id = ? AND enrollment_source = 'ACADEMIC_ASSIGNED'`
      ).run(s.student_id);
    }

    // Gắn sc_toan5_5a1 vào coh_k5_5a1 (giữ nguyên sc_toan5_5a1.course_version_id = NULL để tương thích studio live tests)
    db.prepare(`UPDATE subject_classes SET cohort_id = 'coh_k5_5a1' WHERE id = 'sc_toan5_5a1' AND cohort_id IS NULL`).run();

    // Tạo Lớp môn học thứ 2 trong Lớp khóa học 5A1: sc_tv5_5a1 (gắn gv_5002 & Snapshot v1)
    db.prepare(
      `INSERT OR IGNORE INTO subject_classes (id, course_id, cohort_id, course_version_id, course_version_number,
         code, title, subject, description, instructor_name, ta_names_json, schedule_text, room, student_count,
         start_date, end_date, max_students, delivery_mode, status, department_id, created_at, updated_at)
       VALUES ('sc_tv5_5a1', 'crs_tv5', 'coh_k5_5a1', 'cv_tv5_v1', 1, '5A1-TV', 'Tiếng Việt lớp 5 – 5A1', 'Tiếng Việt',
         'Lớp môn học Tiếng Việt thuộc Lớp khóa học 5A1 (dùng phiên bản môn học v1.0).', ?, '[]',
         'Thứ Ba, Thứ Sáu • Tiết 2 (08:30 – 09:05)', 'Phòng 5A1 – Dãy B', ?,
         '2026-09-05', '2027-05-25', 35, 'HYBRID', 'ACTIVE', 'khoi_5', ?, ?)`
    ).run(tvInstructor ? tvInstructor.full_name : 'Thầy Đỗ Văn Khoa', sc5a1Students.length + (hs201 ? 1 : 0), now, now);

    if (tvInstructor) {
      db.prepare(
        `INSERT OR IGNORE INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
         VALUES (?, 'sc_tv5_5a1', ?, 'PRIMARY_INSTRUCTOR', '{"can_manage_materials":true,"can_take_attendance":true}', 1, ?, ?, ?)`
      ).run(crypto.randomUUID(), tvInstructor.id, staff ? staff.id : null, now, now);
    }

    for (const s of sc5a1Students) {
      db.prepare(
        `INSERT OR IGNORE INTO class_enrollments (id, subject_class_id, student_id, enrollment_source, status, enrolled_at)
         VALUES (?, 'sc_tv5_5a1', ?, 'COHORT_SYNCED', 'ACTIVE', ?)`
      ).run(crypto.randomUUID(), s.student_id, now);
    }
    // Học viên HS50201 (từ lớp 5A2) học bù riêng môn Tiếng Việt ở 5A1 → không thuộc coh_k5_5a1!
    if (hs201) {
      db.prepare(
        `INSERT OR IGNORE INTO class_enrollments (id, subject_class_id, student_id, enrollment_source, status, enrolled_at)
         VALUES (?, 'sc_tv5_5a1', ?, 'MAKEUP', 'ACTIVE', ?)`
      ).run(crypto.randomUUID(), hs201.id, now);
    }

    // 1 buổi học tương lai cho sc_tv5_5a1
    const futDate = vnDate(new Date(Date.now() + 2 * 86400000));
    if (!db.prepare("SELECT 1 FROM sessions WHERE session_id = 'ses_tv5_5a1_fut'").get()) {
      insertClassSession(db, {
        session_id: 'ses_tv5_5a1_fut',
        subject_class_id: 'sc_tv5_5a1',
        subject_class_code: '5A1-TV',
        subject_title: 'Tiếng Việt lớp 5 – 5A1',
        session_title: 'Buổi 1: Thư gửi các học sinh & Từ đồng nghĩa',
        scheduled_start_at: vnDateTime(futDate, '08:30'),
        scheduled_end_at: vnDateTime(futDate, '09:05'),
        instructor_id: tvInstructor ? tvInstructor.id : 'gv_5002',
        instructor_name: tvInstructor ? tvInstructor.full_name : 'Thầy Đỗ Văn Khoa',
        room_or_link: 'Phòng 5A1 – Dãy B',
        delivery_mode: 'HYBRID',
        teaching_content: 'Phân biệt từ đồng nghĩa hoàn toàn và không hoàn toàn.',
      });
    }

    // 5. Gắn bài học lá cho Question Bank & Learning Resources hiện có của crs_toan5
    const firstToanLeaf = db
      .prepare(
        `SELECT l.id AS lesson_id, ch.id AS chapter_id, ch.topic_id
         FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
         WHERE ch.course_id = ? ORDER BY ch.sort_order, l.sort_order LIMIT 1`
      )
      .get(toanCourse.id);
    if (firstToanLeaf) {
      db.prepare(
        `UPDATE question_bank_items SET topic_id = ?, chapter_id = ?, lesson_id = ?
         WHERE course_id = ? AND lesson_id IS NULL`
      ).run(firstToanLeaf.topic_id, firstToanLeaf.chapter_id, firstToanLeaf.lesson_id, toanCourse.id);
      db.prepare(
        `UPDATE learning_resources SET topic_id = ?, chapter_id = ?, lesson_id = ?
         WHERE course_id = ? AND lesson_id IS NULL`
      ).run(firstToanLeaf.topic_id, firstToanLeaf.chapter_id, firstToanLeaf.lesson_id, toanCourse.id);

      // Seed 1 câu hỏi Tiếng Việt & 1 Bài tập mẫu trong Assignment Bank cho Toán 5
      db.prepare(
        `INSERT OR IGNORE INTO question_bank_items (
           id, course_id, topic_id, chapter_id, lesson_id, subject, question_type, prompt, options_json, answer_key_json,
           points, explanation, difficulty, tags_json, created_by, created_at, updated_at
         ) VALUES (
           'qb_seed_tv5_1', 'crs_tv5', 'top_tv5_1', 'ch_tv5_1', 'les_tv5_1', 'Tiếng Việt', 'SINGLE_CHOICE',
           'Cặp từ nào sau đây là cặp từ đồng nghĩa hoàn toàn?',
           '[{"id":"a","text":"quả - trái","is_correct":true,"feedback":"Chính xác!"},{"id":"b","text":"chạy - đi"},{"id":"c","text":"cao - thấp"},{"id":"d","text":"học - chơi"}]',
           '{"correct_option_ids":["a"]}', 1, 'Quả (miền Bắc) và trái (miền Nam) biểu thị cùng một sự vật.', 'EASY', '["từ đồng nghĩa"]',
           ?, ?, ?
         )`
      ).run(tvInstructor ? tvInstructor.id : 'gv_5002', now, now);

      db.prepare(
        `INSERT OR IGNORE INTO assignment_bank_items (
           id, course_id, topic_id, chapter_id, lesson_id, title, description, instructions,
           submission_type, max_score, max_attempts, allow_resubmit, tags_json, status, created_by, created_at, updated_at
         ) VALUES (
           'ab_seed_toan5_1', ?, ?, ?, ?,
           'Phiếu bài tập Thực hành Phân số thập phân',
           'Bài tập vận dụng chuyển đổi phân số thành số thập phân và giải toán có lời văn.',
           'Hoàn thành 5 bài tập tính nhanh trong phiếu hướng dẫn, chụp ảnh bài làm hoặc nhập lời giải chi tiết vào ô trả lời.',
           'MIXED', 10, 3, 1, '["phân số","thực hành"]', 'ACTIVE', ?, ?, ?
         )`
      ).run(
        toanCourse.id, firstToanLeaf.topic_id, firstToanLeaf.chapter_id, firstToanLeaf.lesson_id,
        gv1 ? gv1.id : 'admin', now, now
      );
    }

    // 6. Seed Wiki môn học (crs_toan5 & crs_tv5)
    db.prepare(
      `INSERT OR IGNORE INTO course_wiki_pages (
         id, course_id, topic_id, chapter_id, lesson_id, slug, title, summary, content_markdown, tags_json, related_page_ids_json,
         status, created_by, updated_by, created_at, updated_at
       ) VALUES (
         'wiki_toan5_khai_niem_ps', ?, ?, ?, ?, 'phan-so-thap-phan-co-ban',
         'Sổ tay Phân số thập phân & Quy đổi nhanh',
         'Tổng hợp quy tắc nhận biết phân số có mẫu là lũy thừa của 10 và cách viết thành số thập phân.',
         '### 1. Định nghĩa\nPhân số thập phân là phân số có mẫu số là 10, 100, 1000...\n\n### 2. Bảng quy đổi hay dùng\n- $\\frac{1}{2} = \\frac{5}{10} = 0{,}5$\n- $\\frac{1}{4} = \\frac{25}{100} = 0{,}25$\n- $\\frac{3}{4} = \\frac{75}{100} = 0{,}75$',
         '["công thức","phân số"]', '[]', 'PUBLISHED', ?, ?, ?, ?
       )`
    ).run(
      toanCourse.id,
      firstToanLeaf?.topic_id || null,
      firstToanLeaf?.chapter_id || null,
      firstToanLeaf?.lesson_id || null,
      gv1 ? gv1.id : null,
      gv1 ? gv1.id : null,
      now,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO course_wiki_revisions (id, page_id, revision_number, title, content_markdown, change_note, edited_by, edited_by_name, created_at)
       VALUES ('wrev_toan5_1', 'wiki_toan5_khai_niem_ps', 1, 'Sổ tay Phân số thập phân & Quy đổi nhanh',
         '### 1. Định nghĩa\nPhân số thập phân là phân số có mẫu số là 10, 100, 1000...', 'Khởi tạo trang Wiki chuẩn', ?, ?, ?)`
    ).run(gv1 ? gv1.id : null, gv1 ? gv1.full_name : 'Giảng viên', now);

    // 7. Seed Đề kiểm tra & Bài tập tách biệt cho lớp sc_toan5_5a1 (để học viên có trải nghiệm thực tế ngay)
    const toanQb = db.prepare('SELECT * FROM question_bank_items WHERE course_id = ? AND deleted_at IS NULL LIMIT 3').all(toanCourse.id);
    if (toanQb.length > 0 && !db.prepare("SELECT 1 FROM class_exams WHERE id = 'ex_seed_5a1_1'").get()) {
      db.prepare(
        `INSERT INTO class_exams (id, subject_class_id, course_id, scope_type, topic_id, chapter_id, lesson_id,
           title, description, time_limit_minutes, max_attempts, shuffle_questions, scoring_policy, pass_score_pct, status, created_by, created_at, updated_at)
         VALUES ('ex_seed_5a1_1', 'sc_toan5_5a1', ?, 'CHAPTER', ?, ?, ?,
           'Kiểm tra 15 phút: Ôn tập Phân số & Số thập phân',
           'Bài kiểm tra định kỳ từ Ngân hàng câu hỏi chuẩn của lớp 5A1.', 15, 2, 1, 'HIGHEST', 50, 'PUBLISHED', ?, ?, ?)`
      ).run(toanCourse.id, firstToanLeaf?.topic_id || null, firstToanLeaf?.chapter_id || null, firstToanLeaf?.lesson_id || null,
        gv1 ? gv1.id : null, now, now);

      toanQb.forEach((q, idx) => {
        db.prepare(
          `INSERT INTO class_exam_questions (id, exam_id, bank_question_id, question_snapshot_json, points, sort_order)
           VALUES (?, 'ex_seed_5a1_1', ?, ?, ?, ?)`
        ).run(
          `exq_seed_${idx + 1}`,
          q.id,
          JSON.stringify({
            id: q.id,
            question_type: q.question_type,
            prompt: q.prompt,
            options: JSON.parse(q.options_json || '[]'),
            answer_key: JSON.parse(q.answer_key_json || '{}'),
            points: Number(q.points || 1),
            explanation: q.explanation || '',
            correct_feedback: q.correct_feedback || '',
            wrong_feedback: q.wrong_feedback || '',
          }),
          Number(q.points || 1),
          (idx + 1) * 10
        );
      });
    }

    if (!db.prepare("SELECT 1 FROM class_assignments WHERE id = 'ca_seed_5a1_1'").get()) {
      db.prepare(
        `INSERT INTO class_assignments (id, subject_class_id, course_id, assignment_bank_item_id, topic_id, chapter_id, lesson_id,
           title, instructions, submission_type, max_score, max_attempts, allow_resubmit, due_at, status, created_by, created_at, updated_at)
         VALUES ('ca_seed_5a1_1', 'sc_toan5_5a1', ?, 'ab_seed_toan5_1', ?, ?, ?,
           'Bài tập tuần 1: Quy đổi phân số thập phân',
           'Hoàn thành bài tập vận dụng phân số thập phân và trình bày rõ từng bước giải.', 'MIXED', 10, 3, 1, ?, 'PUBLISHED', ?, ?, ?)`
      ).run(
        toanCourse.id, firstToanLeaf?.topic_id || null, firstToanLeaf?.chapter_id || null, firstToanLeaf?.lesson_id || null,
        vnDateTime(futDate, '23:59'), gv1 ? gv1.id : null, now, now
      );
    }

    // 8. Seed Diễn đàn (Cấp Môn học & Riêng Lớp 5A1) + Đơn xin nghỉ ở buổi tương lai
    db.prepare(
      `INSERT OR IGNORE INTO teaching_forums (id, scope_type, course_id, subject_class_id, title, description, status, created_at, updated_at)
       VALUES ('frm_crs_toan5', 'COURSE', ?, NULL, 'Diễn đàn chung Môn Toán lớp 5',
         'Trao đổi kiến thức, phương pháp giải toán và giải đáp thắc mắc chung cho toàn môn học.', 'ACTIVE', ?, ?)`
    ).run(toanCourse.id, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO teaching_forums (id, scope_type, course_id, subject_class_id, title, description, status, created_at, updated_at)
       VALUES ('frm_cls_5a1', 'CLASS', ?, 'sc_toan5_5a1', 'Diễn đàn nội bộ Lớp 5A1 – Toán 5',
         'Không gian trao đổi riêng của giảng viên và học viên lớp 5A1.', 'ACTIVE', ?, ?)`
    ).run(toanCourse.id, now, now);

    if (!db.prepare("SELECT 1 FROM teaching_forum_threads WHERE id = 'fth_seed_5a1'").get() && gv1) {
      db.prepare(
        `INSERT INTO teaching_forum_threads (id, forum_id, lesson_id, author_id, author_name, author_role, category, title, body,
           is_pinned, is_locked, is_hidden, helpful_count, reply_count, last_activity_at, created_at, updated_at)
         VALUES ('fth_seed_5a1', 'frm_cls_5a1', ?, ?, ?, 'INSTRUCTOR', 'ANNOUNCEMENT',
           'Hướng dẫn chuẩn bị bài và làm bài kiểm tra tuần 1',
           'Các em xem kỹ video bài giảng (đạt tối thiểu mức quy định), đọc sổ tay Wiki và nộp bài tập tuần 1 đúng hạn nhé!',
           1, 0, 0, 1, 0, ?, ?, ?)`
      ).run(firstToanLeaf?.lesson_id || null, gv1.id, gv1.full_name, now, now, now);
    }

    // Seed 1 đơn xin nghỉ mẫu cho buổi học tương lai của sc_tv5_5a1 (không ảnh hưởng todaySession của sc_toan5_5a1)
    if (hs1 && !db.prepare("SELECT 1 FROM leave_requests WHERE id = 'lv_seed_fut_1'").get()) {
      db.prepare(
        `INSERT INTO leave_requests (id, subject_class_id, class_session_id, student_id, student_code, student_name,
           reason_category, reason, makeup_class_requested, status, created_at, updated_at)
         VALUES ('lv_seed_fut_1', 'sc_tv5_5a1', 'ses_tv5_5a1_fut', ?, ?, ?, 'FAMILY',
           'Gia đình có việc bận cần di chuyển về quê vào sáng thứ Bảy.', 'Có thể tham gia học bù lớp 5A2 nếu có lịch.', 'PENDING', ?, ?)`
      ).run(hs1.id, hs1.code, hs1.full_name, now, now);
      db.prepare(
        `INSERT INTO leave_request_logs (id, leave_request_id, previous_status, new_status, action_note, actor_id, actor_name, created_at)
         VALUES ('lrl_seed_1', 'lv_seed_fut_1', NULL, 'PENDING', 'Học viên gửi đơn xin nghỉ phép mới.', ?, ?, ?)`
      ).run(hs1.id, hs1.full_name, now);
    }

    db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('${MASTER_LMS_SEED_MARKER}', '1')`).run();
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
