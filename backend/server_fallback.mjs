#!/usr/bin/env node
/**
 * LMSPLUS E-Learning — SQL-Backed Backend Server (`node:sqlite` on `database/lmsplus_elearning.sqlite`)
 * Supports:
 * - Real Authentication (Login with Email/Code + Password, Registration, JWT Bearer HS256)
 * - Full CRUD Operations (Courses, Chapters, Lessons, Wiki Terms, Users)
 * - Role-based Access Control (RBAC + Data Scope)
 * - Hybrid Course Discovery Policy (`ASSIGNED_ONLY`, `REQUEST_APPROVAL`, `SELF_ENROLL`)
 * - Notion-style Block Editor JSON Schema v1.0 & Optimistic Concurrency (`409 CONFLICT`)
 * - Multi-criteria Progress Completion (`422` if video < 85% or Quick Check not passed)
 * - 24-Hour Teaching Log Confirmation & Background Overdue Scheduler (`OVERDUE_UNCONFIRMED` -> `CONFIRMED_LATE`)
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  ensureTeachingSchema,
  clearTeachingData,
  seedTeachingData,
} from './teaching/schema.mjs';
import { createTeachingRouter, TEACHING_PREFIX } from './teaching/routes.mjs';
import { verifyMediaStreamToken } from './teaching/studio.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(currentFilePath);
const ROOT_DIR = path.resolve(__dirname, '..');
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const DB_DIR = path.join(ROOT_DIR, 'database');

const LOG_FILE = process.env.LMSPLUS_LOG_FILE
  ? path.resolve(process.env.LMSPLUS_LOG_FILE)
  : IS_SERVERLESS || process.env.LMSPLUS_DB_PATH
    ? null
    : path.join(LOG_DIR, 'backend.log');
const DB_PATH = process.env.LMSPLUS_DB_PATH
  ? path.resolve(process.env.LMSPLUS_DB_PATH)
  : IS_SERVERLESS
    ? path.join(os.tmpdir(), 'lmsplus_elearning.sqlite')
    : path.join(DB_DIR, 'lmsplus_elearning.sqlite');
const SEED_PATH = path.join(DB_DIR, 'lmsplus_elearning_seed.json');
if (LOG_FILE && !fs.existsSync(path.dirname(LOG_FILE))) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}
if (DB_PATH !== ':memory:' && !fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const PORT = Number(process.env.BACKEND_PORT || 8000);
const JWT_SECRET = process.env.LMSPLUS_JWT_SECRET || 'lmsplus-production-grade-hmac-secret-2026';

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
// Backend (:8000) và Vite dev server có thể cùng mở CSDL → chờ khóa thay vì lỗi SQLITE_BUSY ngay.
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');

function hashPassword(plainPassword) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(String(plainPassword))
    .digest('hex');
}

function writeLog(level, message) {
  const line = `[${level}] ${new Date().toISOString()} | ${message}\n`;
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch {
      // ignore transient file lock
    }
  }
  process.stdout.write(line);
}

export function createJwtToken(user, expiresInSec = 86400) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id || user.sub,
      code: user.code || 'USR001',
      email: user.email || 'user@lmsplus.edu.vn',
      full_name: user.full_name,
      roles: user.roles || (user.role ? [user.role] : ['STUDENT']),
      department_id: user.department_id || null,
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyJwtToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (parts[2] !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sanitizeUserRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    full_name: row.full_name,
    roles: JSON.parse(row.roles_json || '["STUDENT"]'),
    department_id: row.department_id,
  };
}

const DEFAULT_WIKI_TERMS = [
  {
    id: 'wt_raft',
    canonical_name: 'Thuật toán Đồng thuận Raft',
    aliases: ['Raft Consensus', 'Replicated State Machine'],
    subject_context: 'Thiết kế Hệ thống Phân tán (SE302)',
    short_definition:
      'Thuật toán đồng thuận phân tán chia bài toán thành 3 phần: Bầu chọn Leader (Leader Election), Sao chép Nhật ký (Log Replication) và Đảm bảo An toàn (Safety).',
    formula_or_example: 'Quorum Q = floor(N / 2) + 1',
  },
  {
    id: 'wt_quorum',
    canonical_name: 'Quorum (Đa số tối thiểu)',
    aliases: ['Majority Quorum', 'Quá bán tối thiểu'],
    subject_context: 'Thiết kế Hệ thống Phân tán (SE302)',
    short_definition:
      'Số lượng nút tối thiểu trong cụm phân tán phải đồng ý để một quyết định ghi dữ liệu hoặc bầu chọn Leader được công nhận hợp lệ.',
    formula_or_example: 'Với N = 5 nút, cần ít nhất Q = 3 nút đồng thuận.',
  },
  {
    id: 'wt_split_brain',
    canonical_name: 'Hiện tượng Split-Brain (Phân mảnh não bộ)',
    aliases: ['Network Partition Conflict', 'Dual Leader'],
    subject_context: 'Thiết kế Hệ thống Phân tán (SE302)',
    short_definition:
      'Tình trạng mạng bị chia cắt khiến hai phân vùng độc lập cùng tưởng mình là cụm chính, dẫn tới nguy cơ ghi dữ liệu xung đột nếu không có cơ chế Quorum.',
    formula_or_example: 'Ngăn chặn bằng cách yêu cầu Leader phải duy trì kết nối tới >= floor(N/2) + 1 nút.',
  },
];

export function initSchemaAndSeed(forceReset = false) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      roles_json TEXT NOT NULL,
      department_id TEXT,
      assigned_course_ids_json TEXT NOT NULL DEFAULT '[]',
      enrolled_subject_class_ids_json TEXT NOT NULL DEFAULT '[]'
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

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      progress_pct INTEGER NOT NULL DEFAULT 0
    );

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

    CREATE TABLE IF NOT EXISTS lesson_versions (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      blocks_snapshot_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE(lesson_id, version_number)
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

    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      subject_class_id TEXT NOT NULL,
      student_code TEXT NOT NULL,
      student_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      makeup_class_requested TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
    );

    CREATE TABLE IF NOT EXISTS learning_events (
      idempotency_key TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);

  // Ensure password_hash column exists if migrating an older SQLite file
  try {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';");
  } catch {
    // Column already exists
  }

  // Module giảng dạy: chỉ bổ sung bảng/cột (không xóa dữ liệu hiện có)
  ensureTeachingSchema(db);

  const userCount = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const wikiCount = db.prepare('SELECT COUNT(*) AS cnt FROM wiki_terms').get().cnt;

  if (!forceReset && userCount > 0 && wikiCount > 0) {
    seedTeachingData(db, { seed: JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')), hashPassword });
    return;
  }

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  clearTeachingData(db);
  db.exec(`
    DELETE FROM learning_events;
    DELETE FROM leave_requests;
    DELETE FROM teaching_log_history;
    DELETE FROM sessions;
    DELETE FROM wiki_terms;
    DELETE FROM lesson_versions;
    DELETE FROM lesson_blocks;
    DELETE FROM lessons;
    DELETE FROM chapters;
    DELETE FROM enrollment_requests;
    DELETE FROM courses;
    DELETE FROM users;
  `);

  const defaultPassHash = hashPassword('123456');
  const insUser = db.prepare(
    `INSERT INTO users (id, code, email, full_name, password_hash, roles_json, department_id, assigned_course_ids_json, enrolled_subject_class_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const u of seed.users) {
    insUser.run(
      u.id,
      u.code,
      u.email,
      u.full_name,
      defaultPassHash,
      JSON.stringify(u.roles),
      u.department_id || null,
      JSON.stringify(u.assigned_course_ids || []),
      JSON.stringify(u.enrolled_subject_class_ids || [])
    );
  }

  const nowIso = new Date().toISOString();
  const insCourse = db.prepare(
    `INSERT INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
                          chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status,
                          is_assigned_to_student, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of seed.courses) {
    insCourse.run(
      c.id,
      c.code,
      c.title,
      c.instructor_id,
      c.instructor_name,
      c.department_id,
      c.department_name,
      c.chapters_count,
      c.lessons_count,
      c.progress_pct,
      c.enrollment_policy,
      c.enrollment_status,
      c.is_assigned_to_student ? 1 : 0,
      nowIso
    );
  }

  const insChapter = db.prepare(
    `INSERT INTO chapters (id, subject_class_id, code, title, progress_pct) VALUES (?, ?, ?, ?, ?)`
  );
  const insLesson = db.prepare(
    `INSERT INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
                          required_video_pct, require_quick_check, last_video_position_sec,
                          total_video_seconds, quick_check_passed, working_draft_revision, published_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 2)`
  );
  for (const ch of seed.chapters) {
    insChapter.run(ch.id, ch.subject_class_id, ch.code, ch.title, ch.progress_pct);
    for (const l of ch.lessons) {
      insLesson.run(
        l.id,
        ch.id,
        l.code,
        l.title,
        l.duration_minutes,
        l.status,
        l.unlock_condition_text || null,
        l.required_video_pct ?? 85,
        l.require_quick_check ? 1 : 0,
        l.last_video_position_sec,
        l.total_video_seconds,
        l.quick_check_passed ? 1 : 0
      );
    }
  }

  const insBlock = db.prepare(
    `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [lessonId, draft] of Object.entries(seed.lesson_drafts || {})) {
    for (const b of draft.blocks) {
      insBlock.run(
        b.id,
        lessonId,
        b.schema_version,
        b.block_type,
        b.sort_order,
        b.status,
        JSON.stringify(b.content)
      );
    }
    db.prepare(
      `INSERT INTO lesson_versions (id, lesson_id, version_number, blocks_snapshot_json, published_by, published_at)
       VALUES (?, ?, 2, ?, 'TS. Lê Hoàng Nam', ?)`
    ).run(crypto.randomUUID(), lessonId, JSON.stringify(draft.blocks), nowIso);
  }

  const insWiki = db.prepare(
    `INSERT INTO wiki_terms (id, canonical_name, aliases_json, subject_context, short_definition, formula_or_example, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const wt of DEFAULT_WIKI_TERMS) {
    insWiki.run(
      wt.id,
      wt.canonical_name,
      JSON.stringify(wt.aliases),
      wt.subject_context,
      wt.short_definition,
      wt.formula_or_example || null,
      nowIso
    );
  }

  const insSession = db.prepare(
    `INSERT INTO sessions (session_id, subject_class_id, subject_class_code, subject_title, session_title,
                           scheduled_start_at, scheduled_end_at, confirmation_deadline_at, actual_start_at,
                           actual_end_at, scheduled_instructor_id, scheduled_instructor_name, actual_instructor_name,
                           is_substitute_teaching, ta_names_json, confirmation_status, confirmed_at,
                           is_late_confirmation, reminder_sent_count, lessons_delivery_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const s of seed.sessions) {
    insSession.run(
      s.session_id,
      s.subject_class_id,
      s.subject_class_code,
      s.subject_title,
      s.session_title,
      s.scheduled_start_at,
      s.scheduled_end_at,
      s.confirmation_deadline_at,
      s.actual_start_at,
      s.actual_end_at,
      s.scheduled_instructor_id,
      s.scheduled_instructor_name,
      s.actual_instructor_name,
      s.is_substitute_teaching ? 1 : 0,
      JSON.stringify(s.ta_names),
      s.confirmation_status,
      s.confirmed_at,
      s.is_late_confirmation ? 1 : 0,
      s.reminder_sent_count,
      JSON.stringify(s.lessons_delivery)
    );
  }

  const insHist = db.prepare(
    `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const h of seed.teaching_log_history) {
    insHist.run(
      h.id,
      h.session_id,
      h.session_code,
      h.previous_status,
      h.new_status,
      h.changed_by,
      h.changed_at,
      h.note
    );
  }

  const insLeave = db.prepare(
    `INSERT INTO leave_requests (id, subject_class_id, student_code, student_name, reason, makeup_class_requested, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const lv of seed.leave_requests) {
    insLeave.run(
      lv.id,
      lv.subject_class_id,
      lv.student_code,
      lv.student_name,
      lv.reason,
      lv.makeup_class_requested,
      lv.status
    );
  }

  seedTeachingData(db, { seed, hashPassword });
}

initSchemaAndSeed(false);

const UPLOADS_DIR = process.env.LMSPLUS_UPLOADS_DIR
  ? path.resolve(process.env.LMSPLUS_UPLOADS_DIR)
  : IS_SERVERLESS
    ? path.join(os.tmpdir(), 'lmsplus_uploads', 'resources')
    : path.join(ROOT_DIR, 'backend', 'uploads', 'resources');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
export const MAX_BODY_BYTES = 24 * 1024 * 1024;
const handleTeaching = createTeachingRouter({ db, uploadsDir: UPLOADS_DIR, jwtSecret: JWT_SECRET, log: writeLog });

function resolveUser(req, url = null, pathname = '', method = 'GET') {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    const claims = verifyJwtToken(auth.slice(7).trim());
    if (!claims) return null;
    return {
      id: claims.sub,
      code: claims.code || 'USR001',
      email: claims.email,
      full_name: claims.full_name,
      roles: claims.roles || [],
      department_id: claims.department_id,
    };
  }
  // Cho phép thẻ <video> / <object> PDF phát trực tiếp qua token HMAC giới hạn theo đúng resourceId (?st=...)
  if ((method === 'GET' || method === 'HEAD') && url) {
    const streamMatch = pathname.match(/^\/api\/v1\/teaching\/media\/([^/]+)\/stream$/);
    const st = url.searchParams.get('st');
    if (streamMatch && st) {
      const resourceId = decodeURIComponent(streamMatch[1]);
      const verified = verifyMediaStreamToken(JWT_SECRET, st, resourceId);
      if (verified && verified.uid) {
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(verified.uid);
        return sanitizeUserRecord(row);
      }
    }
  }
  // Không còn chấp nhận header vai trò giả lập: mọi request khác phải có JWT hợp lệ.
  return null;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, Idempotency-Key, X-LMSPLUS-Role',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
  });
  res.end(body);
}

export function handleApiRequest(req, res, bodyData) {
  try {
    return handleApiRequestInner(req, res, bodyData);
  } catch (err) {
    const msg = String((err && err.message) || err || '');
    if (msg.includes('UNIQUE constraint failed')) {
      sendJson(res, 409, { detail: { code: 'DUPLICATE_RECORD', message: 'Mã định danh hoặc Email đã tồn tại trong hệ thống.' } });
      return;
    }
    if (msg.includes('FOREIGN KEY constraint failed')) {
      sendJson(res, 409, {
        detail: {
          code: 'REFERENTIAL_INTEGRITY_CONFLICT',
          message: 'Không thể xóa hoặc thay đổi bản ghi đang có dữ liệu học tập/điểm danh liên kết.',
        },
      });
      return;
    }
    if (msg.includes('CHECK constraint failed')) {
      sendJson(res, 422, { detail: { code: 'VALIDATION_ERROR', message: 'Giá trị dữ liệu không nằm trong danh mục hợp lệ.' } });
      return;
    }
    writeLog('ERROR', `${req.method} ${req.url}: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) {
      sendJson(res, 500, { detail: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' } });
    }
  }
}

function handleApiRequestInner(req, res, bodyData) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, Idempotency-Key, X-LMSPLUS-Role',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
    });
    res.end();
    return;
  }

  let body = {};
  let bodyError = false;
  req.__rawBody = bodyData || '';
  if (bodyData) {
    try {
      body = JSON.parse(bodyData);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        body = {};
        bodyError = true;
      }
    } catch {
      body = {};
      bodyError = true;
    }
  }

  if (pathname === '/health') {
    const userCnt = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
    sendJson(res, 200, {
      status: 'ok',
      service: 'lmsplus-elearning-sql-backend',
      database: 'sqlite3 (database/lmsplus_elearning.sqlite)',
      users_in_db: userCnt,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (pathname === '/api/v1/elearning/testing/reset-seed' && method === 'POST') {
    initSchemaAndSeed(true);
    sendJson(res, 200, { success: true, data: { reset: true } });
    return;
  }

  // AUTH 1: Role Switcher Token Issue
  // Chỉ dùng cho kiểm thử tự động; tắt hoàn toàn khi NODE_ENV=production.
  if (
    pathname === '/api/v1/elearning/auth/token' &&
    method === 'POST' &&
    process.env.NODE_ENV === 'production'
  ) {
    sendJson(res, 404, { detail: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn.' } });
    return;
  }
  if (pathname === '/api/v1/elearning/auth/token' && method === 'POST') {
    const requestedRole = String(body.role || 'STUDENT').toUpperCase();
    const rows = db.prepare('SELECT * FROM users').all();
    const match = rows.find((r) => JSON.parse(r.roles_json).includes(requestedRole));
    if (!match) {
      sendJson(res, 404, { detail: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy tài khoản.' } });
      return;
    }
    const userObj = sanitizeUserRecord(match);
    const token = createJwtToken(userObj);
    sendJson(res, 200, {
      success: true,
      data: { access_token: token, token_type: 'Bearer', user: userObj },
    });
    return;
  }

  // AUTH 2: Login with Email / User Code + Password
  if (pathname === '/api/v1/elearning/auth/login' && method === 'POST') {
    const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) {
      sendJson(res, 422, {
        detail: {
          code: 'MISSING_CREDENTIALS',
          message: 'Vui lòng nhập đầy đủ Email/Mã số và Mật khẩu.',
        },
      });
      return;
    }
    const row = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(code) = ?')
      .get(identifier, identifier);
    if (!row) {
      sendJson(res, 401, {
        detail: {
          code: 'INVALID_CREDENTIALS',
          message: 'Tài khoản hoặc mật khẩu không chính xác.',
        },
      });
      return;
    }
    const expectedHash = hashPassword(password);
    if (!row.password_hash || row.password_hash !== expectedHash) {
      sendJson(res, 401, {
        detail: {
          code: 'INVALID_CREDENTIALS',
          message: 'Tài khoản hoặc mật khẩu không chính xác.',
        },
      });
      return;
    }
    const userObj = sanitizeUserRecord(row);
    const token = createJwtToken(userObj);
    sendJson(res, 200, {
      success: true,
      data: { access_token: token, token_type: 'Bearer', user: userObj },
    });
    return;
  }

  // AUTH 3: Register New User Account
  if (pathname === '/api/v1/elearning/auth/register' && method === 'POST') {
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = String(body.role || 'STUDENT').toUpperCase();
    const validRoles = ['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN'];
    // Tự đăng ký công khai chỉ tạo tài khoản Học viên; vai trò khác phải do Quản trị viên tạo.
    const requester = resolveUser(req);
    const requesterIsAdmin = Boolean(requester && requester.roles.includes('ADMIN'));
    if (role !== 'STUDENT' && !requesterIsAdmin) {
      sendJson(res, 403, {
        detail: {
          code: 'REGISTER_ROLE_FORBIDDEN',
          message: 'Tài khoản tự đăng ký chỉ dành cho Học viên. Vui lòng liên hệ Quản trị viên.',
        },
      });
      return;
    }
    const assignedRole = validRoles.includes(role) ? role : 'STUDENT';

    if (!fullName || !email || password.length < 6) {
      sendJson(res, 422, {
        detail: {
          code: 'INVALID_REGISTRATION_DATA',
          message: 'Vui lòng nhập Họ tên, Email hợp lệ và Mật khẩu tối thiểu 6 ký tự.',
        },
      });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existing) {
      sendJson(res, 409, {
        detail: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Địa chỉ Email này đã được đăng ký trong hệ thống.',
        },
      });
      return;
    }

    const prefix = assignedRole === 'INSTRUCTOR' ? 'GV' : assignedRole === 'STUDENT' ? 'HS' : 'CB';
    const userCode =
      String(body.code || '').trim().toUpperCase() ||
      `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
    const existingCode = db.prepare('SELECT id FROM users WHERE UPPER(code) = ?').get(userCode);
    if (existingCode) {
      sendJson(res, 409, {
        detail: {
          code: 'CODE_ALREADY_EXISTS',
          message: `Mã định danh "${userCode}" đã tồn tại trong hệ thống.`,
        },
      });
      return;
    }
    const defaultDeptRow = db
      .prepare("SELECT department_id FROM courses WHERE department_id IS NOT NULL AND department_id <> '' ORDER BY CASE WHEN department_id = 'khoi_5' THEN 0 ELSE 1 END LIMIT 1")
      .get();
    const resolvedDept = String(body.department_id || '').trim() || defaultDeptRow?.department_id || 'khoi_5';
    const newId = `usr_${crypto.randomBytes(4).toString('hex')}`;

    db.prepare(
      `INSERT INTO users (id, code, email, full_name, password_hash, roles_json, department_id, assigned_course_ids_json, enrolled_subject_class_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]')`
    ).run(
      newId,
      userCode,
      email,
      fullName,
      hashPassword(password),
      JSON.stringify([assignedRole]),
      resolvedDept
    );

    const createdRow = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    const userObj = sanitizeUserRecord(createdRow);
    const token = createJwtToken(userObj);
    sendJson(res, 201, {
      success: true,
      data: { access_token: token, token_type: 'Bearer', user: userObj },
    });
    return;
  }

  // Webhook từ nhà cung cấp phòng học trực tuyến (Zoom / Google Meet) xác thực bằng chữ ký HMAC-SHA256 riêng
  if (pathname.startsWith(`${TEACHING_PREFIX}/webhooks/`)) {
    const webhookUser = resolveUser(req, url, pathname, method) || {
      id: 'webhook_system',
      code: 'WEBHOOK',
      email: 'webhook@lmsplus.edu.vn',
      full_name: 'Provider Webhook Verifier',
      roles: ['SYSTEM_WEBHOOK'],
      department_id: null,
    };
    return handleTeaching({ req, method, pathname, url, body, bodyError, user: webhookUser, res, sendJson });
  }

  const user = resolveUser(req, url, pathname, method);
  if (!user) {
    sendJson(res, 401, {
      detail: { code: 'INVALID_OR_EXPIRED_JWT', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' },
    });
    return;
  }

  // Module giảng dạy: khóa học, lớp học, bài giảng, điểm danh (/api/v1/teaching/*)
  if (pathname.startsWith(`${TEACHING_PREFIX}/`)) {
    return handleTeaching({ req, method, pathname, url, body, bodyError, user, res, sendJson });
  }

  // 1. Workspace Bootstrap (SQL-backed)
  if (pathname === '/api/v1/elearning/workspace/bootstrap' && method === 'GET') {
    const allCoursesRaw = db.prepare('SELECT * FROM courses ORDER BY id').all();
    const mapCourse = (c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      instructor_name: c.instructor_name,
      department_name: c.department_name,
      chapters_count: c.chapters_count,
      lessons_count: c.lessons_count,
      progress_pct: c.progress_pct,
      enrollment_policy: c.enrollment_policy,
      enrollment_status: c.enrollment_status,
      is_assigned_to_student: Boolean(c.is_assigned_to_student),
    });

    const courses = allCoursesRaw
      .filter((c) => {
        if (user.roles.includes('STUDENT') && c.enrollment_policy === 'ASSIGNED_ONLY' && !c.is_assigned_to_student) {
          return false;
        }
        return true;
      })
      .map(mapCourse);

    const all_courses = allCoursesRaw.map(mapCourse);

    // Màn hình học bài cũ chỉ hiển thị chương gắn với lớp; chương của khóa học mới nằm trong module giảng dạy.
    const chapters = db.prepare("SELECT * FROM chapters WHERE subject_class_id <> '' ORDER BY id").all().map((ch) => ({
      id: ch.id,
      code: ch.code,
      title: ch.title,
      progress_pct: ch.progress_pct,
      lessons: db
        .prepare('SELECT * FROM lessons WHERE chapter_id = ? ORDER BY code')
        .all(ch.id)
        .map((l) => ({
          id: l.id,
          code: l.code,
          title: l.title,
          duration_minutes: l.duration_minutes,
          status: l.status,
          unlock_condition_text: l.unlock_condition_text,
          last_video_position_sec: l.last_video_position_sec,
          total_video_seconds: l.total_video_seconds,
          quick_check_passed: Boolean(l.quick_check_passed),
          working_draft_revision: l.working_draft_revision,
          published_version: l.published_version,
        })),
    }));

    const blocks = db
      .prepare("SELECT * FROM lesson_blocks WHERE lesson_id = 'les_302' ORDER BY sort_order")
      .all()
      .map((b) => ({
        id: b.id,
        lesson_id: b.lesson_id,
        schema_version: b.schema_version,
        block_type: b.block_type,
        sort_order: b.sort_order,
        status: b.status,
        content: JSON.parse(b.content_json),
      }));

    const wiki_terms = db.prepare('SELECT * FROM wiki_terms ORDER BY id').all().map((wt) => ({
      id: wt.id,
      canonical_name: wt.canonical_name,
      aliases: JSON.parse(wt.aliases_json || '[]'),
      subject_context: wt.subject_context,
      short_definition: wt.short_definition,
      formula_or_example: wt.formula_or_example || undefined,
    }));

    const users_list = user.roles.includes('ADMIN')
      ? db.prepare('SELECT * FROM users ORDER BY id').all().map(sanitizeUserRecord)
      : [];

    const sessions = db.prepare('SELECT * FROM sessions ORDER BY session_id DESC').all().map((s) => ({
      session_id: s.session_id,
      subject_class_code: s.subject_class_code,
      subject_title: s.subject_title,
      session_title: s.session_title,
      scheduled_start_at: s.scheduled_start_at,
      scheduled_end_at: s.scheduled_end_at,
      confirmation_deadline_at: s.confirmation_deadline_at,
      actual_start_at: s.actual_start_at,
      actual_end_at: s.actual_end_at,
      scheduled_instructor_name: s.scheduled_instructor_name,
      actual_instructor_name: s.actual_instructor_name,
      is_substitute_teaching: Boolean(s.is_substitute_teaching),
      ta_names: JSON.parse(s.ta_names_json),
      confirmation_status: s.confirmation_status,
      confirmed_at: s.confirmed_at,
      is_late_confirmation: Boolean(s.is_late_confirmation),
      late_confirmation_reason: s.late_confirmation_reason,
      reminder_sent_count: s.reminder_sent_count,
      lessons_delivery: JSON.parse(s.lessons_delivery_json),
    }));

    const teaching_log_history = db
      .prepare('SELECT * FROM teaching_log_history ORDER BY rowid DESC')
      .all();
    const leave_requests = db.prepare('SELECT * FROM leave_requests ORDER BY id').all();

    sendJson(res, 200, {
      success: true,
      data: {
        viewer: user,
        courses,
        all_courses,
        chapters,
        blocks,
        wiki_terms,
        users_list,
        sessions,
        teaching_log_history,
        leave_requests,
      },
    });
    return;
  }

  // =========================================================================
  // CRUD MANAGEMENT ENDPOINTS (Courses, Chapters, Lessons, Wiki Terms, Users)
  // =========================================================================

  if (pathname.startsWith('/api/v1/elearning/crud/')) {
    const isUserCrud = pathname.startsWith('/api/v1/elearning/crud/users');
    const allowed = isUserCrud
      ? user.roles.includes('ADMIN')
      : ['INSTRUCTOR', 'ACADEMIC_STAFF', 'ADMIN'].some((r) => user.roles.includes(r));
    if (!allowed) {
      sendJson(res, 403, {
        detail: {
          code: 'CRUD_FORBIDDEN',
          message: isUserCrud
            ? 'Chỉ Quản trị viên mới được quản lý tài khoản.'
            : 'Bạn không có quyền quản lý dữ liệu học vụ.',
        },
      });
      return;
    }
  }

  // CRUD 1: Create Course
  if (pathname === '/api/v1/elearning/crud/courses' && method === 'POST') {
    const newId = `crs_${crypto.randomBytes(3).toString('hex')}`;
    const code = String(body.code || `CRS-${Math.floor(100 + Math.random() * 900)}`).trim().toUpperCase();
    const title = String(body.title || 'Khóa học mới').trim();
    const instructorName = String(body.instructor_name || user.full_name).trim();
    const departmentName = String(body.department_name || 'Khoa Công nghệ Phần mềm').trim();
    const chaptersCount = Number(body.chapters_count || 6);
    const lessonsCount = Number(body.lessons_count || 24);
    const policy = ['ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL'].includes(body.enrollment_policy)
      ? body.enrollment_policy
      : 'ASSIGNED_ONLY';
    const isAssigned = body.is_assigned_to_student ? 1 : 0;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
                            chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status,
                            is_assigned_to_student, updated_at)
       VALUES (?, ?, ?, ?, ?, 'dept_se', ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      newId,
      code,
      title,
      user.id,
      instructorName,
      departmentName,
      chaptersCount,
      lessonsCount,
      policy,
      isAssigned ? 'ENROLLED' : 'NOT_ENROLLED',
      isAssigned,
      nowIso
    );

    const created = db.prepare('SELECT * FROM courses WHERE id = ?').get(newId);
    sendJson(res, 201, {
      success: true,
      data: {
        ...created,
        is_assigned_to_student: Boolean(created.is_assigned_to_student),
      },
    });
    return;
  }

  // CRUD 2: Update or Delete Course
  const crudCourseMatch = pathname.match(/^\/api\/v1\/elearning\/crud\/courses\/([^/]+)$/);
  if (crudCourseMatch && method === 'PUT') {
    const courseId = crudCourseMatch[1];
    const existing = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!existing) {
      sendJson(res, 404, { detail: { code: 'COURSE_NOT_FOUND', message: 'Không tìm thấy khóa học.' } });
      return;
    }
    const code = String(body.code || existing.code).trim().toUpperCase();
    const title = String(body.title || existing.title).trim();
    const instructorName = String(body.instructor_name || existing.instructor_name).trim();
    const departmentName = String(body.department_name || existing.department_name).trim();
    const chaptersCount = Number(body.chapters_count ?? existing.chapters_count);
    const lessonsCount = Number(body.lessons_count ?? existing.lessons_count);
    const policy = ['ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL'].includes(body.enrollment_policy)
      ? body.enrollment_policy
      : existing.enrollment_policy;
    const isAssigned =
      typeof body.is_assigned_to_student === 'boolean'
        ? body.is_assigned_to_student
          ? 1
          : 0
        : existing.is_assigned_to_student;

    db.prepare(
      `UPDATE courses
       SET code = ?, title = ?, instructor_name = ?, department_name = ?,
           chapters_count = ?, lessons_count = ?, enrollment_policy = ?,
           is_assigned_to_student = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      code,
      title,
      instructorName,
      departmentName,
      chaptersCount,
      lessonsCount,
      policy,
      isAssigned,
      new Date().toISOString(),
      courseId
    );
    const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    sendJson(res, 200, {
      success: true,
      data: {
        ...updated,
        is_assigned_to_student: Boolean(updated.is_assigned_to_student),
      },
    });
    return;
  }

  if (crudCourseMatch && method === 'DELETE') {
    const inUse = db
      .prepare("SELECT COUNT(*) AS n FROM subject_classes WHERE course_id = ?")
      .get(crudCourseMatch[1]).n;
    if (inUse > 0) {
      sendJson(res, 409, {
        detail: {
          code: 'COURSE_IN_USE',
          message: `Khóa học đang được ${inUse} lớp sử dụng. Hãy lưu trữ khóa học thay vì xóa.`,
        },
      });
      return;
    }
    db.prepare('DELETE FROM courses WHERE id = ?').run(crudCourseMatch[1]);
    sendJson(res, 200, { success: true, data: { deleted_id: crudCourseMatch[1] } });
    return;
  }

  // CRUD 3: Create / Update / Delete Chapter
  if (pathname === '/api/v1/elearning/crud/chapters' && method === 'POST') {
    const newId = `ch_${crypto.randomBytes(3).toString('hex')}`;
    const code = String(body.code || 'Chương mới').trim();
    const title = String(body.title || 'Nội dung chương học mới').trim();
    db.prepare(
      `INSERT INTO chapters (id, subject_class_id, code, title, progress_pct)
       VALUES (?, 'sc_se302_01', ?, ?, 0)`
    ).run(newId, code, title);
    sendJson(res, 201, {
      success: true,
      data: { id: newId, code, title, progress_pct: 0, lessons: [] },
    });
    return;
  }

  const crudChapterMatch = pathname.match(/^\/api\/v1\/elearning\/crud\/chapters\/([^/]+)$/);
  if (crudChapterMatch && method === 'PUT') {
    const chId = crudChapterMatch[1];
    db.prepare('UPDATE chapters SET code = ?, title = ? WHERE id = ?').run(
      String(body.code || '').trim(),
      String(body.title || '').trim(),
      chId
    );
    sendJson(res, 200, { success: true, data: { id: chId, code: body.code, title: body.title } });
    return;
  }

  if (crudChapterMatch && method === 'DELETE') {
    db.prepare('DELETE FROM chapters WHERE id = ?').run(crudChapterMatch[1]);
    sendJson(res, 200, { success: true, data: { deleted_id: crudChapterMatch[1] } });
    return;
  }

  // CRUD 4: Create / Update / Delete Lesson
  if (pathname === '/api/v1/elearning/crud/lessons' && method === 'POST') {
    const newId = `les_${crypto.randomBytes(3).toString('hex')}`;
    const chapterId = String(body.chapter_id || 'ch_3');
    const code = String(body.code || '3.4').trim();
    const title = String(body.title || 'Bài giảng mới').trim();
    const durationMinutes = Number(body.duration_minutes || 20);
    const status = ['COMPLETED', 'IN_PROGRESS', 'LOCKED'].includes(body.status)
      ? body.status
      : 'IN_PROGRESS';
    const unlockCondition = body.unlock_condition_text || null;

    db.prepare(
      `INSERT INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
                            required_video_pct, require_quick_check, last_video_position_sec,
                            total_video_seconds, quick_check_passed, working_draft_revision, published_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 85, 1, 0, ?, 0, 1, 1)`
    ).run(newId, chapterId, code, title, durationMinutes, status, unlockCondition, durationMinutes * 60);

    sendJson(res, 201, {
      success: true,
      data: {
        id: newId,
        chapter_id: chapterId,
        code,
        title,
        duration_minutes: durationMinutes,
        status,
        unlock_condition_text: unlockCondition,
        last_video_position_sec: 0,
        total_video_seconds: durationMinutes * 60,
      },
    });
    return;
  }

  const crudLessonMatch = pathname.match(/^\/api\/v1\/elearning\/crud\/lessons\/([^/]+)$/);
  if (crudLessonMatch && method === 'PUT') {
    const lesId = crudLessonMatch[1];
    const existing = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lesId);
    if (!existing) {
      sendJson(res, 404, { detail: { code: 'LESSON_NOT_FOUND', message: 'Không tìm thấy bài giảng.' } });
      return;
    }
    const code = String(body.code ?? existing.code).trim();
    const title = String(body.title ?? existing.title).trim();
    const durationMinutes = Number(body.duration_minutes ?? existing.duration_minutes);
    const status = ['COMPLETED', 'IN_PROGRESS', 'LOCKED'].includes(body.status)
      ? body.status
      : existing.status;
    const unlockText =
      body.unlock_condition_text !== undefined ? body.unlock_condition_text : existing.unlock_condition_text;

    db.prepare(
      `UPDATE lessons
       SET code = ?, title = ?, duration_minutes = ?, status = ?, unlock_condition_text = ?, total_video_seconds = ?
       WHERE id = ?`
    ).run(code, title, durationMinutes, status, unlockText, durationMinutes * 60, lesId);

    sendJson(res, 200, {
      success: true,
      data: {
        id: lesId,
        code,
        title,
        duration_minutes: durationMinutes,
        status,
        unlock_condition_text: unlockText,
      },
    });
    return;
  }

  if (crudLessonMatch && method === 'DELETE') {
    db.prepare('DELETE FROM lessons WHERE id = ?').run(crudLessonMatch[1]);
    sendJson(res, 200, { success: true, data: { deleted_id: crudLessonMatch[1] } });
    return;
  }

  // CRUD 5: Create / Update / Delete Wiki Term
  if (pathname === '/api/v1/elearning/crud/wiki-terms' && method === 'POST') {
    const newId = `wt_${crypto.randomBytes(3).toString('hex')}`;
    const canonicalName = String(body.canonical_name || 'Thuật ngữ mới').trim();
    const aliases = Array.isArray(body.aliases)
      ? body.aliases
      : String(body.aliases || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    const subjectContext = String(body.subject_context || 'Thiết kế Hệ thống Phân tán (SE302)').trim();
    const shortDefinition = String(body.short_definition || '').trim();
    const formulaOrExample = body.formula_or_example ? String(body.formula_or_example).trim() : null;

    db.prepare(
      `INSERT INTO wiki_terms (id, canonical_name, aliases_json, subject_context, short_definition, formula_or_example, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId,
      canonicalName,
      JSON.stringify(aliases),
      subjectContext,
      shortDefinition,
      formulaOrExample,
      new Date().toISOString()
    );

    sendJson(res, 201, {
      success: true,
      data: {
        id: newId,
        canonical_name: canonicalName,
        aliases,
        subject_context: subjectContext,
        short_definition: shortDefinition,
        formula_or_example: formulaOrExample || undefined,
      },
    });
    return;
  }

  const crudWikiMatch = pathname.match(/^\/api\/v1\/elearning\/crud\/wiki-terms\/([^/]+)$/);
  if (crudWikiMatch && method === 'PUT') {
    const wtId = crudWikiMatch[1];
    const aliases = Array.isArray(body.aliases)
      ? body.aliases
      : String(body.aliases || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    db.prepare(
      `UPDATE wiki_terms
       SET canonical_name = ?, aliases_json = ?, subject_context = ?, short_definition = ?, formula_or_example = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(body.canonical_name || '').trim(),
      JSON.stringify(aliases),
      String(body.subject_context || '').trim(),
      String(body.short_definition || '').trim(),
      body.formula_or_example ? String(body.formula_or_example).trim() : null,
      new Date().toISOString(),
      wtId
    );
    sendJson(res, 200, {
      success: true,
      data: {
        id: wtId,
        canonical_name: body.canonical_name,
        aliases,
        subject_context: body.subject_context,
        short_definition: body.short_definition,
        formula_or_example: body.formula_or_example,
      },
    });
    return;
  }

  if (crudWikiMatch && method === 'DELETE') {
    db.prepare('DELETE FROM wiki_terms WHERE id = ?').run(crudWikiMatch[1]);
    sendJson(res, 200, { success: true, data: { deleted_id: crudWikiMatch[1] } });
    return;
  }

  // CRUD 6: Update / Delete User Account
  const crudUserMatch = pathname.match(/^\/api\/v1\/elearning\/crud\/users\/([^/]+)$/);
  if (crudUserMatch && method === 'PUT') {
    const usrId = crudUserMatch[1];
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(usrId);
    if (!existing) {
      sendJson(res, 404, { detail: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng.' } });
      return;
    }
    const fullName = String(body.full_name || existing.full_name).trim();
    const email = String(body.email || existing.email).trim().toLowerCase();
    const code = String(body.code || existing.code).trim().toUpperCase();
    const validRoles = ['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN'];
    const requestedRole = String(body.role || JSON.parse(existing.roles_json)[0] || 'STUDENT').toUpperCase();
    const role = validRoles.includes(requestedRole) ? requestedRole : 'STUDENT';
    const departmentId = body.department_id !== undefined ? String(body.department_id || '').trim() || existing.department_id : existing.department_id;

    if (!fullName || !email || !code) {
      sendJson(res, 422, { detail: { code: 'VALIDATION_ERROR', message: 'Họ tên, Mã định danh và Email không được để trống.' } });
      return;
    }
    const dupEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?').get(email, usrId);
    if (dupEmail) {
      sendJson(res, 409, { detail: { code: 'EMAIL_ALREADY_EXISTS', message: 'Địa chỉ Email này đã được dùng bởi tài khoản khác.' } });
      return;
    }
    const dupCode = db.prepare('SELECT id FROM users WHERE UPPER(code) = ? AND id <> ?').get(code, usrId);
    if (dupCode) {
      sendJson(res, 409, { detail: { code: 'CODE_ALREADY_EXISTS', message: `Mã định danh "${code}" đã được dùng bởi tài khoản khác.` } });
      return;
    }

    db.prepare(
      `UPDATE users SET full_name = ?, email = ?, code = ?, roles_json = ?, department_id = ? WHERE id = ?`
    ).run(fullName, email, code, JSON.stringify([role]), departmentId, usrId);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(usrId);
    sendJson(res, 200, { success: true, data: sanitizeUserRecord(updated) });
    return;
  }

  if (crudUserMatch && method === 'DELETE') {
    const usrId = crudUserMatch[1];
    if (usrId === user.id) {
      sendJson(res, 409, { detail: { code: 'CANNOT_DELETE_SELF', message: 'Bạn không thể tự xóa tài khoản đang đăng nhập.' } });
      return;
    }
    try {
      db.prepare('DELETE FROM users WHERE id = ?').run(usrId);
    } catch (err) {
      if (String(err && err.message).includes('FOREIGN KEY constraint failed')) {
        sendJson(res, 409, {
          detail: {
            code: 'USER_HAS_ACTIVE_DATA',
            message: 'Tài khoản này đã phát sinh dữ liệu khóa học, lớp học hoặc điểm danh nên không thể xóa vĩnh viễn.',
          },
        });
        return;
      }
      throw err;
    }
    sendJson(res, 200, { success: true, data: { deleted_id: usrId } });
    return;
  }

  // =========================================================================
  // CORE DOMAIN ENDPOINTS
  // =========================================================================

  // 2. Get Course Detail (with ASSIGNED_ONLY RBAC check)
  const courseMatch = pathname.match(/^\/api\/v1\/elearning\/courses\/([^/]+)$/);
  if (courseMatch && method === 'GET') {
    const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseMatch[1]);
    if (!c) {
      sendJson(res, 404, { detail: { code: 'COURSE_NOT_FOUND', message: 'Course not found' } });
      return;
    }
    if (user.roles.includes('STUDENT') && c.enrollment_policy === 'ASSIGNED_ONLY' && !c.is_assigned_to_student) {
      sendJson(res, 403, {
        detail: {
          code: 'COURSE_ACCESS_DENIED_ASSIGNED_ONLY',
          message: 'Học viên không thuộc danh sách phân lớp của khóa học chính khóa này.',
        },
      });
      return;
    }
    sendJson(res, 200, { success: true, data: c });
    return;
  }

  // 3. Update Course Enrollment Policy (SELF_ENROLL restricted to ADMIN)
  const policyMatch = pathname.match(/^\/api\/v1\/elearning\/courses\/([^/]+)\/enrollment-policy$/);
  if (policyMatch && method === 'PATCH') {
    const newPolicy = body.enrollment_policy;
    if (!['ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL'].includes(newPolicy)) {
      sendJson(res, 422, { detail: { code: 'INVALID_POLICY', message: 'Invalid policy' } });
      return;
    }
    if (newPolicy === 'SELF_ENROLL' && !user.roles.includes('ADMIN')) {
      sendJson(res, 403, {
        detail: {
          code: 'SELF_ENROLL_REQUIRES_ADMIN',
          message: 'Chỉ Quản trị viên hệ thống mới có quyền bật chế độ Tự ghi danh.',
        },
      });
      return;
    }
    if (!user.roles.includes('ADMIN') && !user.roles.includes('ACADEMIC_STAFF')) {
      sendJson(res, 403, {
        detail: { code: 'INSUFFICIENT_ROLE', message: 'Không đủ quyền thay đổi chính sách khóa học.' },
      });
      return;
    }
    db.prepare('UPDATE courses SET enrollment_policy = ?, updated_at = ? WHERE id = ?').run(
      newPolicy,
      new Date().toISOString(),
      policyMatch[1]
    );
    sendJson(res, 200, {
      success: true,
      data: { course_id: policyMatch[1], enrollment_policy: newPolicy },
    });
    return;
  }

  // 4. Enroll or Request Enrollment
  const enrollMatch = pathname.match(/^\/api\/v1\/elearning\/courses\/([^/]+)\/enroll$/);
  if (enrollMatch && method === 'POST') {
    const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(enrollMatch[1]);
    if (!c) {
      sendJson(res, 404, { detail: { code: 'COURSE_NOT_FOUND', message: 'Course not found' } });
      return;
    }
    if (c.enrollment_policy === 'ASSIGNED_ONLY') {
      sendJson(res, 403, {
        detail: {
          code: 'ENROLLMENT_FORBIDDEN_ASSIGNED_ONLY',
          message: 'Khóa học theo phân lớp chính khóa không cho phép tự đăng ký hoặc gửi yêu cầu.',
        },
      });
      return;
    }
    const nowIso = new Date().toISOString();
    if (c.enrollment_policy === 'REQUEST_APPROVAL') {
      db.prepare("UPDATE courses SET enrollment_status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?").run(
        nowIso,
        c.id
      );
      sendJson(res, 200, {
        success: true,
        data: { course_id: c.id, enrollment_status: 'PENDING_APPROVAL' },
      });
      return;
    }
    db.prepare("UPDATE courses SET enrollment_status = 'ENROLLED', progress_pct = 5, updated_at = ? WHERE id = ?").run(
      nowIso,
      c.id
    );
    sendJson(res, 200, {
      success: true,
      data: { course_id: c.id, enrollment_status: 'ENROLLED', progress_pct: 5 },
    });
    return;
  }

  // 5. Academic Staff / Admin Approve Enrollment Request
  const approveMatch = pathname.match(/^\/api\/v1\/elearning\/courses\/([^/]+)\/approve-request$/);
  if (approveMatch && method === 'POST') {
    if (!user.roles.includes('ACADEMIC_STAFF') && !user.roles.includes('ADMIN')) {
      sendJson(res, 403, {
        detail: { code: 'APPROVAL_REQUIRES_STAFF', message: 'Chỉ Giáo vụ hoặc Quản trị viên mới được duyệt yêu cầu.' },
      });
      return;
    }
    const newStatus = body.decision === 'APPROVED' ? 'ENROLLED' : 'NOT_ENROLLED';
    db.prepare(
      'UPDATE courses SET enrollment_status = ?, progress_pct = ?, updated_at = ? WHERE id = ?'
    ).run(newStatus, newStatus === 'ENROLLED' ? 5 : 0, new Date().toISOString(), approveMatch[1]);
    sendJson(res, 200, {
      success: true,
      data: { course_id: approveMatch[1], enrollment_status: newStatus },
    });
    return;
  }

  // 6. Block Editor Autosave with Optimistic Concurrency (`409 CONFLICT`)
  const draftMatch = pathname.match(/^\/api\/v1\/elearning\/lessons\/([^/]+)\/draft-blocks$/);
  if (draftMatch && method === 'PATCH') {
    if (
      !user.roles.includes('INSTRUCTOR') &&
      !user.roles.includes('TEACHING_ASSISTANT') &&
      !user.roles.includes('ADMIN')
    ) {
      sendJson(res, 403, {
        detail: { code: 'BLOCK_EDIT_FORBIDDEN', message: 'Không có quyền chỉnh sửa bài giảng.' },
      });
      return;
    }
    const les = db.prepare('SELECT * FROM lessons WHERE id = ?').get(draftMatch[1]);
    if (!les) {
      sendJson(res, 404, { detail: { code: 'LESSON_NOT_FOUND', message: 'Lesson not found' } });
      return;
    }
    if (Number(body.base_revision_number) !== Number(les.working_draft_revision)) {
      sendJson(res, 409, {
        detail: {
          code: 'REVISION_CONFLICT',
          message: 'Phát hiện phiên bản mới hơn từ người dùng khác. Vui lòng đồng bộ trước khi lưu.',
          server_revision: les.working_draft_revision,
          client_base_revision: body.base_revision_number,
        },
      });
      return;
    }
    const nextRev = les.working_draft_revision + 1;
    db.prepare('DELETE FROM lesson_blocks WHERE lesson_id = ?').run(draftMatch[1]);
    const insBlk = db.prepare(
      `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
       VALUES (?, ?, '1.0', ?, ?, ?, ?)`
    );
    const incomingBlocks = Array.isArray(body.blocks) ? body.blocks : [];
    incomingBlocks.forEach((b, idx) => {
      insBlk.run(
        b.id || `blk_${idx + 1}`,
        draftMatch[1],
        b.block_type || 'paragraph',
        b.sort_order || (idx + 1) * 1000,
        b.status || 'ACTIVE',
        JSON.stringify(b.content || {})
      );
    });
    db.prepare('UPDATE lessons SET working_draft_revision = ? WHERE id = ?').run(
      nextRev,
      draftMatch[1]
    );
    sendJson(res, 200, {
      success: true,
      data: {
        lesson_id: draftMatch[1],
        new_revision_number: nextRev,
        block_count: incomingBlocks.length,
      },
    });
    return;
  }

  // 7. Publish Lesson Version (INSTRUCTOR / ADMIN only; TA forbidden -> 403)
  const publishMatch = pathname.match(/^\/api\/v1\/elearning\/lessons\/([^/]+)\/publish$/);
  if (publishMatch && method === 'POST') {
    if (!user.roles.includes('INSTRUCTOR') && !user.roles.includes('ADMIN')) {
      sendJson(res, 403, {
        detail: {
          code: 'PUBLISH_REQUIRES_INSTRUCTOR',
          message: 'Trợ giảng chỉ được lưu bản nháp. Chỉ Giảng viên hoặc Quản trị viên mới được Xuất bản.',
        },
      });
      return;
    }
    const les = db.prepare('SELECT * FROM lessons WHERE id = ?').get(publishMatch[1]);
    if (!les) {
      sendJson(res, 404, { detail: { code: 'LESSON_NOT_FOUND', message: 'Lesson not found' } });
      return;
    }
    const nextVer = les.published_version + 1;
    const blks = db
      .prepare('SELECT * FROM lesson_blocks WHERE lesson_id = ? ORDER BY sort_order')
      .all(publishMatch[1]);
    db.prepare(
      `INSERT INTO lesson_versions (id, lesson_id, version_number, blocks_snapshot_json, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      publishMatch[1],
      nextVer,
      JSON.stringify(blks),
      user.full_name,
      new Date().toISOString()
    );
    db.prepare('UPDATE lessons SET published_version = ? WHERE id = ?').run(nextVer, publishMatch[1]);
    sendJson(res, 200, {
      success: true,
      data: { lesson_id: publishMatch[1], published_version: nextVer },
    });
    return;
  }

  // 8. Progress Heartbeat
  if (pathname === '/api/v1/elearning/progress/heartbeat' && method === 'POST') {
    const key = body.idempotency_key || `hb_${crypto.randomUUID()}`;
    const lessonId = body.lesson_id || 'les_302';
    const pos = Number(body.last_video_position_sec || 0);
    db.prepare(
      `INSERT OR IGNORE INTO learning_events (idempotency_key, student_id, lesson_id, event_type, occurred_at)
       VALUES (?, ?, ?, 'HEARTBEAT', ?)`
    ).run(key, user.id, lessonId, new Date().toISOString());

    if (typeof body.quick_check_passed === 'boolean') {
      db.prepare(
        'UPDATE lessons SET last_video_position_sec = MAX(last_video_position_sec, ?), quick_check_passed = ? WHERE id = ?'
      ).run(pos, body.quick_check_passed ? 1 : 0, lessonId);
    } else {
      db.prepare(
        'UPDATE lessons SET last_video_position_sec = MAX(last_video_position_sec, ?) WHERE id = ?'
      ).run(pos, lessonId);
    }
    sendJson(res, 200, {
      success: true,
      data: { idempotency_key: key, lesson_id: lessonId, last_video_position_sec: pos },
    });
    return;
  }

  // 9. Complete Lesson & Unlock Next (`422` if criteria not met)
  const completeMatch = pathname.match(/^\/api\/v1\/elearning\/progress\/lessons\/([^/]+)\/complete$/);
  if (completeMatch && method === 'POST') {
    const les = db.prepare('SELECT * FROM lessons WHERE id = ?').get(completeMatch[1]);
    if (!les) {
      sendJson(res, 404, { detail: { code: 'LESSON_NOT_FOUND', message: 'Lesson not found' } });
      return;
    }
    const videoPct = Math.round(
      (les.last_video_position_sec / Math.max(1, les.total_video_seconds)) * 100
    );
    if (videoPct < les.required_video_pct || (les.require_quick_check && !les.quick_check_passed)) {
      sendJson(res, 422, {
        detail: {
          code: 'COMPLETION_CRITERIA_NOT_MET',
          message: `Chưa đủ điều kiện hoàn thành: Cần xem tối thiểu ${les.required_video_pct}% video (hiện tại ${videoPct}%) và trả lời đúng câu hỏi kiểm tra nhanh.`,
          current_video_pct: videoPct,
          quick_check_passed: Boolean(les.quick_check_passed),
        },
      });
      return;
    }
    db.prepare("UPDATE lessons SET status = 'COMPLETED' WHERE id = ?").run(les.id);
    db.prepare("UPDATE lessons SET status = 'IN_PROGRESS' WHERE id = 'les_303'").run();
    db.prepare('UPDATE chapters SET progress_pct = 100 WHERE id = ?').run(les.chapter_id);
    sendJson(res, 200, {
      success: true,
      data: {
        completed_lesson_id: les.id,
        unlocked_lesson_id: 'les_303',
        chapter_progress_pct: 100,
      },
    });
    return;
  }

  // 10. Simulate / Run 24h Overdue Scheduler Job
  const overdueMatch = pathname.match(
    /^\/api\/v1\/elearning\/sessions\/([^/]+)\/simulate-overdue-24h$/
  );
  if (overdueMatch && method === 'POST') {
    const s = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(overdueMatch[1]);
    if (!s) {
      sendJson(res, 404, { detail: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
      return;
    }
    const nowStr = new Date().toISOString();
    db.prepare("UPDATE sessions SET confirmation_status = 'OVERDUE_UNCONFIRMED' WHERE session_id = ?").run(
      s.session_id
    );
    db.prepare(
      `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
       VALUES (?, ?, ?, ?, 'OVERDUE_UNCONFIRMED', 'Hệ thống tự động (Sau 24 giờ)', ?, 'Quá 24 giờ kể từ khi kết thúc buổi học chưa xác nhận -> Chuyển sang trạng thái Quá hạn chưa xác nhận (Vẫn cho phép Giảng viên ký xác nhận bổ sung).')`
    ).run(
      `hist_${crypto.randomBytes(4).toString('hex')}`,
      s.session_id,
      `${s.session_title.slice(0, 8)} (${s.subject_class_code})`,
      s.confirmation_status,
      nowStr
    );
    sendJson(res, 200, {
      success: true,
      data: { session_id: s.session_id, new_status: 'OVERDUE_UNCONFIRMED' },
    });
    return;
  }

  // 11. Confirm Teaching Log (24h Rule: INSTRUCTOR / ADMIN only; Overdue allowed -> CONFIRMED_LATE)
  const confirmMatch = pathname.match(
    /^\/api\/v1\/elearning\/sessions\/([^/]+)\/teaching-log\/confirm$/
  );
  if (confirmMatch && method === 'POST') {
    if (!user.roles.includes('INSTRUCTOR') && !user.roles.includes('ADMIN')) {
      sendJson(res, 403, {
        detail: {
          code: 'TEACHING_LOG_CONFIRM_FORBIDDEN',
          message: 'Chỉ Giảng viên phụ trách hoặc Quản trị viên mới có quyền ký xác nhận sổ đầu bài.',
        },
      });
      return;
    }
    const s = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(confirmMatch[1]);
    if (!s) {
      sendJson(res, 404, { detail: { code: 'SESSION_NOT_FOUND', message: 'Session not found' } });
      return;
    }
    // Phạm vi dữ liệu: giảng viên chỉ ký nhật ký của buổi mình dạy hoặc lớp mình được phân công.
    const isAssigned =
      s.scheduled_instructor_id === user.id ||
      Boolean(
        db.prepare(
          `SELECT 1 FROM teaching_staff_assignments WHERE subject_class_id = ? AND user_id = ? AND is_active = 1
             AND staff_role IN ('PRIMARY_INSTRUCTOR','CO_INSTRUCTOR')`
        ).get(s.subject_class_id, user.id)
      );
    if (!user.roles.includes('ADMIN') && !isAssigned) {
      sendJson(res, 403, {
        detail: {
          code: 'TEACHING_LOG_CONFIRM_FORBIDDEN',
          message: 'Bạn không phải giảng viên phụ trách buổi học này.',
        },
      });
      return;
    }
    const isOverdue = s.confirmation_status === 'OVERDUE_UNCONFIRMED';
    const nextStatus = isOverdue ? 'CONFIRMED_LATE' : 'CONFIRMED';
    const nowStr = new Date().toISOString();
    const reason = isOverdue
      ? body.late_confirmation_reason || 'Giảng viên xác nhận bổ sung sau hạn 24 giờ.'
      : 'Giảng viên ký xác nhận đúng hạn 24 giờ.';

    db.prepare(
      `UPDATE sessions
       SET confirmation_status = ?, confirmed_at = ?, is_late_confirmation = ?, late_confirmation_reason = ?
       WHERE session_id = ?`
    ).run(nextStatus, nowStr, isOverdue ? 1 : 0, isOverdue ? reason : null, s.session_id);

    db.prepare(
      `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `hist_${crypto.randomBytes(4).toString('hex')}`,
      s.session_id,
      `${s.session_title.slice(0, 8)} (${s.subject_class_code})`,
      s.confirmation_status,
      nextStatus,
      user.full_name,
      nowStr,
      `Kết thúc buổi học: ${s.scheduled_end_at} | Xác nhận thực tế: ${nowStr} | Ghi chú: ${reason}`
    );

    sendJson(res, 200, {
      success: true,
      data: {
        session_id: s.session_id,
        confirmation_status: nextStatus,
        confirmed_at: nowStr,
        is_late_confirmation: isOverdue,
      },
    });
    return;
  }

  // 12. Leave Request Approval
  const leaveMatch = pathname.match(/^\/api\/v1\/elearning\/leave-requests\/([^/]+)\/decision$/);
  if (leaveMatch && method === 'POST') {
    if (user.roles.includes('STUDENT')) {
      sendJson(res, 403, {
        detail: { code: 'LEAVE_APPROVAL_FORBIDDEN', message: 'Học viên không có quyền tự duyệt đơn xin nghỉ.' },
      });
      return;
    }
    db.prepare('UPDATE leave_requests SET status = ? WHERE id = ?').run(body.status, leaveMatch[1]);
    sendJson(res, 200, { success: true, data: { id: leaveMatch[1], status: body.status } });
    return;
  }

  sendJson(res, 404, { detail: { code: 'NOT_FOUND', message: `Không tìm thấy đường dẫn ${method} ${pathname}` } });
}

function createMockExchange(method, urlPath, headers) {
  const captured = { status: 200, headers: {}, body: '' };
  const mockReq = {
    method,
    url: urlPath,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const mockRes = {
    writeHead(status, h = {}) {
      captured.status = status;
      captured.headers = h;
    },
    end(payload = '') {
      captured.body = payload;
    },
  };
  const result = () => {
    const rawBuffer = Buffer.isBuffer(captured.body)
      ? captured.body
      : Buffer.from(String(captured.body || ''), 'utf8');
    const raw = Buffer.isBuffer(captured.body) ? captured.body.toString('utf8') : String(captured.body || '');
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    return { status: captured.status, headers: captured.headers, body: parsed, rawBuffer };
  };
  return { mockReq, mockRes, result };
}

/** Gọi API trong cùng tiến trình (dùng cho kiểm thử tích hợp). */
export function invokeApi(method, urlPath, headers = {}, bodyObj = {}) {
  const { mockReq, mockRes, result } = createMockExchange(method, urlPath, headers);
  handleApiRequest(mockReq, mockRes, bodyObj ? JSON.stringify(bodyObj) : '');
  return result();
}

/** Như invokeApi nhưng chờ các handler bất đồng bộ (ví dụ kiểm tra YouTube). */
export async function invokeApiAsync(method, urlPath, headers = {}, bodyObj = {}, rawBody = null) {
  const { mockReq, mockRes, result } = createMockExchange(method, urlPath, headers);
  await handleApiRequest(mockReq, mockRes, rawBody !== null ? rawBody : bodyObj ? JSON.stringify(bodyObj) : '');
  return result();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES && !aborted) {
        aborted = true;
        sendJson(res, 413, { detail: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên vượt quá giới hạn 24 MB.' } });
        req.destroy();
        return;
      }
      if (!aborted) chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      writeLog('INFO ', `${req.method} ${req.url}`);
      Promise.resolve(handleApiRequest(req, res, Buffer.concat(chunks).toString('utf8'))).catch((err) => {
        writeLog('ERROR', `${req.method} ${req.url}: ${err && err.stack ? err.stack : err}`);
        if (!res.headersSent) sendJson(res, 500, { detail: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống.' } });
      });
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    writeLog(
      'PASS ',
      `LMSPLUS E-Learning SQL Backend API listening on http://localhost:${PORT} (SQLite: ${DB_PATH})`
    );
  });
}
