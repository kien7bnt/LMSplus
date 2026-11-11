#!/usr/bin/env node
/**
 * LMSPLUS E-Learning — Full Integration, RBAC & Business Rules Test Suite
 * Tests real SQL operations (`database/lmsplus_elearning.sqlite`), HMAC-SHA256 JWT Auth,
 * RBAC enforcement, Hybrid Course Discovery, Multi-Criteria Lesson Progress,
 * Notion-style Block Editor Optimistic Concurrency Control, and 24h Teaching Log Confirmation.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Kiểm thử chạy trên CSDL tạm, KHÔNG ghi đè dữ liệu phát triển database/lmsplus_elearning.sqlite
const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `legacy-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-legacy-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';
const { initSchemaAndSeed, createJwtToken, verifyJwtToken, invokeApi, db } = await import('../backend/server_fallback.mjs');

const results = [];
let passed = 0;
let failed = 0;

async function runTest(category, name, fn) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    passed += 1;
    results.push({ status: 'PASS', category, name, durationMs });
    console.log(`  [PASS] [${category}] ${name} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    failed += 1;
    results.push({ status: 'FAIL', category, name, durationMs, error: err.message });
    console.error(`  [FAIL] [${category}] ${name}: ${err.message}`);
  }
}

console.log('======================================================================');
console.log(' LMSPLUS E-LEARNING — AUTOMATED SQL & RBAC INTEGRATION TEST SUITE');
console.log('======================================================================');

// 1. Reset temp SQL database to clean deterministic seed state
initSchemaAndSeed(true);

// Issue real JWT tokens for real seed users (one per role)
const userByRole = (role) => {
  const row = db.prepare('SELECT * FROM users WHERE roles_json LIKE ? ORDER BY code LIMIT 1').get(`%"${role}"%`);
  return { id: row.id, code: row.code, email: row.email, full_name: row.full_name, roles: JSON.parse(row.roles_json), department_id: row.department_id };
};
const SEED_USERS = Object.fromEntries(['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN'].map((r) => [r, userByRole(r)]));
const tokens = Object.fromEntries(Object.entries(SEED_USERS).map(([r, u]) => [r, createJwtToken(u)]));

// Khóa học mẫu cho 3 chính sách ghi danh (tự tạo, không phụ thuộc dữ liệu seed)
const mkCourse = (code, policy, assigned) =>
  invokeApi('POST', '/api/v1/elearning/crud/courses', { authorization: `Bearer ${tokens.ADMIN}` }, {
    code, title: `Khóa kiểm thử ${code}`, enrollment_policy: policy, is_assigned_to_student: assigned,
  }).body.data.id;
const C = {
  assigned: mkCourse('T-ASSIGNED', 'ASSIGNED_ONLY', true),
  request: mkCourse('T-REQUEST', 'REQUEST_APPROVAL', false),
  self: mkCourse('T-SELF', 'SELF_ENROLL', false),
  hidden: mkCourse('T-HIDDEN', 'ASSIGNED_ONLY', false),
};
const SESSION_ID = db.prepare("SELECT session_id FROM sessions WHERE confirmation_status = 'AWAITING_CONFIRMATION' AND scheduled_instructor_id = ? AND scheduled_end_at < ? ORDER BY scheduled_start_at DESC LIMIT 1")
  .get(SEED_USERS.INSTRUCTOR.id, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19) + '+07:00').session_id;
const LEAVE_ID = db.prepare("SELECT id FROM leave_requests WHERE status = 'PENDING' LIMIT 1").get()?.id;

function callApi(method, path, roleOrHeader = 'STUDENT', body = {}) {
  const headers =
    typeof roleOrHeader === 'string'
      ? { authorization: `Bearer ${tokens[roleOrHeader]}` }
      : roleOrHeader;
  return invokeApi(method, path, headers, body);
}

// ---------------------------------------------------------------------------
// GROUP 1: JWT AUTHENTICATION & RBAC SECURITY
// ---------------------------------------------------------------------------
await runTest('AUTH & JWT', 'Verify HMAC-SHA256 JWT token generation and verification', () => {
  const payload = verifyJwtToken(tokens.INSTRUCTOR);
  assert.ok(payload, 'Payload should be decoded');
  assert.deepEqual(payload.roles, ['INSTRUCTOR']);
  assert.equal(payload.sub, SEED_USERS.INSTRUCTOR.id);
});

await runTest('AUTH & JWT', 'Reject tampered or expired JWT token with HTTP 401 INVALID_OR_EXPIRED_JWT', () => {
  const res = invokeApi(
    'GET',
    '/api/v1/elearning/workspace/bootstrap',
    { authorization: 'Bearer invalid.jwt.token' },
    {}
  );
  assert.equal(res.status, 401);
  assert.equal(res.body.detail.code, 'INVALID_OR_EXPIRED_JWT');
});

await runTest('AUTH & JWT', 'Issue role JWT via POST /api/v1/elearning/auth/token', () => {
  const res = invokeApi('POST', '/api/v1/elearning/auth/token', {}, { role: 'ACADEMIC_STAFF' });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.user.roles.includes('ACADEMIC_STAFF'));
  assert.equal(res.body.data.access_token.split('.').length, 3);
});

// ---------------------------------------------------------------------------
// GROUP 2: STUDENT FLOW & HYBRID COURSE DISCOVERY (LP-02)
// ---------------------------------------------------------------------------
await runTest('HYBRID DISCOVERY', 'Student bootstrap hides ASSIGNED_ONLY course crs_04 when not assigned', () => {
  const res = callApi('GET', '/api/v1/elearning/workspace/bootstrap', 'STUDENT');
  assert.equal(res.status, 200);
  const courseIds = res.body.data.courses.map((c) => c.id);
  assert.ok(courseIds.includes(C.assigned), 'Assigned course must be visible');
  assert.ok(courseIds.includes(C.request), 'REQUEST_APPROVAL course must be visible');
  assert.ok(courseIds.includes(C.self), 'SELF_ENROLL course must be visible');
  assert.ok(!courseIds.includes(C.hidden), 'Unassigned ASSIGNED_ONLY course must be hidden from Student');
});

await runTest('HYBRID DISCOVERY', 'Direct GET /courses/crs_04 by unassigned Student returns 403 COURSE_ACCESS_DENIED_ASSIGNED_ONLY', () => {
  const res = callApi('GET', `/api/v1/elearning/courses/${C.hidden}`, 'STUDENT');
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'COURSE_ACCESS_DENIED_ASSIGNED_ONLY');
});

await runTest('HYBRID DISCOVERY', 'Student attempting to enroll in ASSIGNED_ONLY course crs_04 returns 403 ENROLLMENT_FORBIDDEN_ASSIGNED_ONLY', () => {
  const res = callApi('POST', `/api/v1/elearning/courses/${C.hidden}/enroll`, 'STUDENT');
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'ENROLLMENT_FORBIDDEN_ASSIGNED_ONLY');
});

await runTest('HYBRID DISCOVERY', 'Student enrolling in REQUEST_APPROVAL course crs_02 transitions to PENDING_APPROVAL', () => {
  const res = callApi('POST', `/api/v1/elearning/courses/${C.request}/enroll`, 'STUDENT', {
    request_note: 'Em xin đăng ký lớp Kỹ thuật Prompt cho học kỳ này.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.enrollment_status, 'PENDING_APPROVAL');
});

await runTest('HYBRID DISCOVERY', 'Student enrolling in SELF_ENROLL course crs_03 immediately enrolls (ENROLLED, progress_pct = 5)', () => {
  const res = callApi('POST', `/api/v1/elearning/courses/${C.self}/enroll`, 'STUDENT');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.enrollment_status, 'ENROLLED');
  assert.equal(res.body.data.progress_pct, 5);
});

// ---------------------------------------------------------------------------
// GROUP 3: ACADEMIC STAFF & ADMIN ENROLLMENT GOVERNANCE
// ---------------------------------------------------------------------------
await runTest('RBAC GOVERNANCE', 'Non-Admin (ACADEMIC_STAFF) attempting to enable SELF_ENROLL returns 403 SELF_ENROLL_REQUIRES_ADMIN', () => {
  const res = callApi(
    'PATCH',
    `/api/v1/elearning/courses/${C.request}/enrollment-policy`,
    'ACADEMIC_STAFF',
    { enrollment_policy: 'SELF_ENROLL' }
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'SELF_ENROLL_REQUIRES_ADMIN');
});

await runTest('RBAC GOVERNANCE', 'ADMIN can enable SELF_ENROLL and revert back to REQUEST_APPROVAL', () => {
  const res1 = callApi(
    'PATCH',
    `/api/v1/elearning/courses/${C.request}/enrollment-policy`,
    'ADMIN',
    { enrollment_policy: 'SELF_ENROLL' }
  );
  assert.equal(res1.status, 200);
  assert.equal(res1.body.data.enrollment_policy, 'SELF_ENROLL');

  const res2 = callApi(
    'PATCH',
    `/api/v1/elearning/courses/${C.request}/enrollment-policy`,
    'ADMIN',
    { enrollment_policy: 'REQUEST_APPROVAL' }
  );
  assert.equal(res2.status, 200);
});

await runTest('RBAC GOVERNANCE', 'Student attempting to approve enrollment request returns 403 APPROVAL_REQUIRES_STAFF', () => {
  const res = callApi('POST', `/api/v1/elearning/courses/${C.request}/approve-request`, 'STUDENT', {
    decision: 'APPROVED',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'APPROVAL_REQUIRES_STAFF');
});

await runTest('RBAC GOVERNANCE', 'ACADEMIC_STAFF approves Student request on crs_02 -> status becomes ENROLLED', () => {
  const res = callApi('POST', `/api/v1/elearning/courses/${C.request}/approve-request`, 'ACADEMIC_STAFF', {
    decision: 'APPROVED',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.enrollment_status, 'ENROLLED');
});

// ---------------------------------------------------------------------------
// GROUP 4: MULTI-CRITERIA LESSON PROGRESS & CONDITIONAL UNLOCK (LP-05)
// ---------------------------------------------------------------------------
await runTest('LESSON PROGRESS', 'Completing Lesson 3.2 before criteria met (<85% video & quiz unpassed) returns 422 COMPLETION_CRITERIA_NOT_MET', () => {
  const res = callApi('POST', '/api/v1/elearning/progress/lessons/les_302/complete', 'STUDENT');
  assert.equal(res.status, 422);
  assert.equal(res.body.detail.code, 'COMPLETION_CRITERIA_NOT_MET');
});

await runTest('LESSON PROGRESS', 'Heartbeat updates video >= 85% and quick_check_passed = true in SQL database', () => {
  const res = callApi('POST', '/api/v1/elearning/progress/heartbeat', 'STUDENT', {
    lesson_id: 'les_302',
    last_video_position_sec: 999,
    watched_delta_sec: 239,
    quick_check_passed: true,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.last_video_position_sec, 999);
});

await runTest('LESSON PROGRESS', 'Completing Lesson 3.2 after meeting criteria succeeds and unlocks Lesson 3.3 (IN_PROGRESS)', () => {
  const res = callApi('POST', '/api/v1/elearning/progress/lessons/les_302/complete', 'STUDENT');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.completed_lesson_id, 'les_302');
  assert.equal(res.body.data.unlocked_lesson_id, 'les_303');

  // Verify in SQL bootstrap that les_303 is now IN_PROGRESS
  const boot = callApi('GET', '/api/v1/elearning/workspace/bootstrap', 'STUDENT');
  const ch3 = boot.body.data.chapters.find((c) => c.id === 'ch_3' || c.code === 'Chương 3');
  assert.ok(ch3, 'Chapter 3 must exist in bootstrap');
  const les303 = ch3.lessons.find((l) => l.id === 'les_303');
  assert.equal(les303.status, 'IN_PROGRESS');
});

// ---------------------------------------------------------------------------
// GROUP 5: NOTION-STYLE BLOCK EDITOR & OPTIMISTIC CONCURRENCY (TW-05)
// ---------------------------------------------------------------------------
await runTest('BLOCK EDITOR', 'Saving draft blocks with stale base_revision_number returns 409 REVISION_CONFLICT', () => {
  const res = callApi('PATCH', '/api/v1/elearning/lessons/les_302/draft-blocks', 'TEACHING_ASSISTANT', {
    base_revision_number: 2, // actual is 4
    blocks: [],
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.detail.code, 'REVISION_CONFLICT');
});

await runTest('BLOCK EDITOR', 'TEACHING_ASSISTANT with can_manage_materials saves draft blocks (revision 4 -> 5)', () => {
  const boot = callApi('GET', '/api/v1/elearning/workspace/bootstrap', 'TEACHING_ASSISTANT');
  const updatedBlocks = [
    ...boot.body.data.blocks,
    {
      id: 'blk_06',
      block_type: 'CALLOUT',
      sort_order: 6000,
      status: 'ACTIVE',
      content: {
        variant: 'info',
        title: 'Ghi chú bổ sung từ Trợ giảng',
        text: 'Đã cập nhật thêm test case Split Vote cho bài thực hành.',
      },
    },
  ];
  const res = callApi('PATCH', '/api/v1/elearning/lessons/les_302/draft-blocks', 'TEACHING_ASSISTANT', {
    base_revision_number: 4,
    blocks: updatedBlocks,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.new_revision_number, 5);
  assert.equal(res.body.data.block_count, 6);
});

await runTest('BLOCK EDITOR', 'TEACHING_ASSISTANT attempting to publish lesson snapshot returns 403 PUBLISH_REQUIRES_INSTRUCTOR', () => {
  const res = callApi('POST', '/api/v1/elearning/lessons/les_302/publish', 'TEACHING_ASSISTANT', {
    change_summary: 'TA cố gắng publish',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'PUBLISH_REQUIRES_INSTRUCTOR');
});

await runTest('BLOCK EDITOR', 'INSTRUCTOR publishes immutable lesson version snapshot (v2 -> v3)', () => {
  const res = callApi('POST', '/api/v1/elearning/lessons/les_302/publish', 'INSTRUCTOR', {
    change_summary: 'Xuất bản v3 có thêm ghi chú Split Vote',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.published_version, 3);
});

// ---------------------------------------------------------------------------
// GROUP 6: 24-HOUR TEACHING LOG CONFIRMATION & ATTENDANCE (TW-12..15)
// ---------------------------------------------------------------------------
await runTest('TEACHING LOG 24H', 'Cron simulation transitions ses_101 to OVERDUE_UNCONFIRMED and writes audit history', () => {
  const res = callApi('POST', `/api/v1/elearning/sessions/${SESSION_ID}/simulate-overdue-24h`, 'ACADEMIC_STAFF');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.new_status, 'OVERDUE_UNCONFIRMED');
});

await runTest('TEACHING LOG 24H', 'Non-Instructor (ACADEMIC_STAFF) attempting to confirm teaching log returns 403 TEACHING_LOG_CONFIRM_FORBIDDEN', () => {
  const res = callApi('POST', `/api/v1/elearning/sessions/${SESSION_ID}/teaching-log/confirm`, 'ACADEMIC_STAFF', {
    late_confirmation_reason: 'Giáo vụ cố gắng ký thay',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'TEACHING_LOG_CONFIRM_FORBIDDEN');
});

await runTest('TEACHING LOG 24H', 'OVERDUE_UNCONFIRMED never locks Instructor: INSTRUCTOR confirms late -> CONFIRMED_LATE with audit log', () => {
  const res = callApi('POST', `/api/v1/elearning/sessions/${SESSION_ID}/teaching-log/confirm`, 'INSTRUCTOR', {
    late_confirmation_reason: 'Xác nhận muộn do bận hội đồng chấm khóa luận.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.confirmation_status, 'CONFIRMED_LATE');
  assert.equal(res.body.data.is_late_confirmation, true);
  assert.ok(res.body.data.confirmed_at);
});

await runTest('ATTENDANCE & LEAVE', 'INSTRUCTOR approves Student leave request lr_01 -> APPROVED', () => {
  const res = callApi('POST', `/api/v1/elearning/leave-requests/${LEAVE_ID}/decision`, 'INSTRUCTOR', {
    status: 'APPROVED',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'APPROVED');
});

// ---------------------------------------------------------------------------
// GROUP 7: SQL RELATIONAL INTEGRITY, AUDIT TRAIL & HEALTH CHECK
// ---------------------------------------------------------------------------
await runTest('SQL & AUDIT', 'Verify /health endpoint and relational audit trail in teaching_log_history', () => {
  const health = invokeApi('GET', '/health', {}, {});
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.ok(health.body.users_in_db >= 5);

  const boot = callApi('GET', '/api/v1/elearning/workspace/bootstrap', 'INSTRUCTOR');
  const history = boot.body.data.teaching_log_history;
  assert.ok(history.length >= 3, 'Audit log must include both initial seed and new state transitions');
  assert.equal(history[0].new_status, 'CONFIRMED_LATE');
  assert.equal(history[1].new_status, 'OVERDUE_UNCONFIRMED');
});

// ---------------------------------------------------------------------------
// GROUP 8: USER LOGIN, REGISTRATION & SENSITIVE KEY HIDING
// ---------------------------------------------------------------------------
await runTest('LOGIN & REGISTER', 'Login with student code HS50101 + password succeeds and hides password_hash', () => {
  const res = invokeApi('POST', '/api/v1/elearning/auth/login', {}, {
    identifier: 'HS50101',
    password: '123456',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.code, 'HS50101');
  assert.equal(res.body.data.user.password_hash, undefined, 'password_hash must never be exposed');

  const wrong = invokeApi('POST', '/api/v1/elearning/auth/login', {}, {
    identifier: 'HS50101',
    password: 'sai-mat-khau',
  });
  assert.equal(wrong.status, 401, 'Wrong password must be rejected');
});

await runTest('RBAC GOVERNANCE', 'Request without JWT (role header only) is rejected with 401', () => {
  const res = invokeApi('GET', '/api/v1/elearning/workspace/bootstrap', { 'x-lmsplus-role': 'ADMIN' }, {});
  assert.equal(res.status, 401);
});

await runTest('RBAC GOVERNANCE', 'Student cannot use CRUD endpoints (403) and does not receive users list', () => {
  const res = callApi('POST', '/api/v1/elearning/crud/courses', 'STUDENT', { title: 'X', code: 'X-1' });
  assert.equal(res.status, 403);
  assert.equal(res.body.detail.code, 'CRUD_FORBIDDEN');
  const boot = callApi('GET', '/api/v1/elearning/workspace/bootstrap', 'STUDENT');
  assert.equal(boot.body.data.users_list.length, 0);
});

await runTest('LOGIN & REGISTER', 'Register a new user account in SQL database and reject duplicate email (409)', () => {
  const regRes = invokeApi('POST', '/api/v1/elearning/auth/register', {}, {
    full_name: 'Lê Minh Khôi',
    email: 'khoi.lm@student.lmsplus.edu.vn',
    code: 'SV2026888',
    role: 'STUDENT',
    password: 'password123',
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.body.data.user.code, 'SV2026888');
  assert.equal(regRes.body.data.user.password_hash, undefined);

  const dupRes = invokeApi('POST', '/api/v1/elearning/auth/register', {}, {
    full_name: 'Lê Minh Khôi 2',
    email: 'khoi.lm@student.lmsplus.edu.vn',
    role: 'STUDENT',
    password: 'password123',
  });
  assert.equal(dupRes.status, 409);
  assert.equal(dupRes.body.detail.code, 'EMAIL_ALREADY_EXISTS');
});

// ---------------------------------------------------------------------------
// GROUP 9: FULL CRUD OPERATIONS (COURSES, CHAPTERS, LESSONS, WIKI, USERS)
// ---------------------------------------------------------------------------
await runTest('CRUD MANAGEMENT', 'Create, Update, and Delete a Course in SQL database', () => {
  const createRes = callApi('POST', '/api/v1/elearning/crud/courses', 'ADMIN', {
    code: 'SE-CLOUD-401',
    title: 'Kiến trúc Điện toán Đám mây & Kubernetes',
    instructor_name: 'TS. Lê Hoàng Nam',
    department_name: 'Khoa Công nghệ Phần mềm',
    chapters_count: 8,
    lessons_count: 28,
    enrollment_policy: 'SELF_ENROLL',
    is_assigned_to_student: true,
  });
  assert.equal(createRes.status, 201);
  const newCourseId = createRes.body.data.id;
  assert.equal(createRes.body.data.code, 'SE-CLOUD-401');

  const updateRes = callApi('PUT', `/api/v1/elearning/crud/courses/${newCourseId}`, 'ADMIN', {
    title: 'Kiến trúc Đám mây & Microservices Nâng cao',
    chapters_count: 10,
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.data.title, 'Kiến trúc Đám mây & Microservices Nâng cao');
  assert.equal(updateRes.body.data.chapters_count, 10);

  const deleteRes = callApi('DELETE', `/api/v1/elearning/crud/courses/${newCourseId}`, 'ADMIN');
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.data.deleted_id, newCourseId);
});

await runTest('CRUD MANAGEMENT', 'Create, Update, and Delete a Wiki Term and Lesson in SQL database', () => {
  const createWiki = callApi('POST', '/api/v1/elearning/crud/wiki-terms', 'INSTRUCTOR', {
    canonical_name: 'Định lý CAP',
    aliases: ['CAP Theorem', 'Brewer Theorem'],
    subject_context: 'Thiết kế Hệ thống Phân tán (SE302)',
    short_definition: 'Một hệ phân tán chỉ có thể thỏa mãn tối đa 2 trong 3 tính chất: Consistency, Availability, Partition Tolerance.',
    formula_or_example: 'CP hoặc AP khi xảy ra Network Partition',
  });
  assert.equal(createWiki.status, 201);
  const wikiId = createWiki.body.data.id;

  const updateWiki = callApi('PUT', `/api/v1/elearning/crud/wiki-terms/${wikiId}`, 'INSTRUCTOR', {
    canonical_name: 'Định lý CAP (Brewer)',
    aliases: ['CAP Theorem'],
    subject_context: 'Thiết kế Hệ thống Phân tán (SE302)',
    short_definition: 'Định lý nền tảng trong hệ phân tán.',
  });
  assert.equal(updateWiki.status, 200);
  assert.equal(updateWiki.body.data.canonical_name, 'Định lý CAP (Brewer)');

  const delWiki = callApi('DELETE', `/api/v1/elearning/crud/wiki-terms/${wikiId}`, 'INSTRUCTOR');
  assert.equal(delWiki.status, 200);
});

db.close();
fs.rmSync(process.env.LMSPLUS_DB_PATH, { force: true });
fs.rmSync(process.env.LMSPLUS_UPLOADS_DIR, { recursive: true, force: true });

console.log('======================================================================');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');

if (failed > 0) {
  process.exit(1);
}
