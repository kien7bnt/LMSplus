#!/usr/bin/env node
/**
 * LMSPLUS — MASTER LMS ARCHITECTURE INTEGRATION TEST SUITE
 * Kiểm thử toàn diện:
 * 1. Mô hình 3 cấp LINKED (Khung CT -> Lớp khóa học -> Lớp môn học), DISTINCT thống kê & đồng bộ giữ MAKEUP/RETAKE
 * 2. Quản lý phiên bản SNAPSHOT bất biến & nâng cấp có kiểm soát cô lập tiến độ
 * 3. Cây nội dung 4 cấp & 3 Ngân hàng học liệu ràng buộc nút lá LESSON + Import/Export JSON
 * 4. Video Player STRICT (Interval Union, tua lùi giữ nguyên %, chặn tua/tốc độ > 2.0x 422, tab ẩn, offline queue idempotent)
 * 5. Kiểm tra (tự động + chấm tay), Bài tập thực hành, Bảng điểm thống nhất & Tổng quan học viên 10 hạng mục
 * 6. Đơn xin nghỉ phép đồng bộ EXCUSED_ABSENCE & không ghi đè PRESENT/LATE
 * 7. Diễn đàn môn học & Diễn đàn lớp riêng tư (cấm rò rỉ 403), kiểm duyệt & Thông báo
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `master-lms-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-master-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { initSchemaAndSeed, invokeApi, invokeApiAsync, db } = await import('../backend/server_fallback.mjs');
initSchemaAndSeed(true);

let passed = 0;
let failed = 0;

async function t(group, name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] [${group}] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] [${group}] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  }
}

const login = (identifier) => {
  const r = invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier, password: '123456' });
  assert.equal(r.status, 200, `login ${identifier} failed: ${JSON.stringify(r.body)}`);
  return { authorization: `Bearer ${r.body.data.access_token}` };
};

const T = '/api/v1/teaching';
const api = (method, url, headers, body) => invokeApiAsync(method, `${T}${url}`, headers, body);
const expectStatus = (r, status, code) => {
  assert.equal(
    r.status,
    status,
    `expected HTTP ${status}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`
  );
  if (code) {
    const actualCode = r.body?.detail?.code || r.body?.code || r.body?.error?.code;
    assert.equal(actualCode, code, `expected error code ${code}, got ${actualCode} (${JSON.stringify(r.body)})`);
  }
  return r.body?.data;
};

// Lấy tài khoản có sẵn từ DB seed
const staffUser = db.prepare("SELECT * FROM users WHERE roles_json LIKE '%\"ACADEMIC_STAFF\"%' LIMIT 1").get();
const STAFF = login(staffUser ? staffUser.email : 'admin@lmsplus.edu.vn');
const ADMIN = login('admin@lmsplus.edu.vn');
const GV = login('thuha.gv@lmsplus.edu.vn');
const GV2 = login('vankhoa.gv@lmsplus.edu.vn');
const HS1 = login('HS50101');
const HS2 = login('HS50102');
const HS_OTHER = login('HS50201');
const hs1Row = db.prepare("SELECT * FROM users WHERE code = 'HS50101'").get();
const hs2Row = db.prepare("SELECT * FROM users WHERE code = 'HS50102'").get();
const hsOtherRow = db.prepare("SELECT * FROM users WHERE code = 'HS50201'").get();

console.log('======================================================================');
console.log(' LMSPLUS — MASTER LMS ARCHITECTURE INTEGRATION SUITE');
console.log('======================================================================');

// ----------------------------------------------------------------------
// 1. MÔ HÌNH 3 CẤP LINKED & COHORT SYNC
// ----------------------------------------------------------------------
await t('3TIER-LINKED', 'Thống kê DISTINCT học viên lớp khóa học coh_k5_5a1 không bị nhân đôi & HS50201 MAKEUP tách biệt', async () => {
  const detail = expectStatus(await api('GET', '/cohorts/coh_k5_5a1', STAFF), 200);
  // Lớp khóa học coh_k5_5a1 có 24 học viên gốc dù gắn 2 lớp môn học (Toán & Tiếng Việt)
  assert.equal(detail.active_students_count, 24, `expected 24 active cohort students, got ${detail.active_students_count}`);
  assert.equal(detail.statistics?.distinct_active_students, 24, `expected 24 distinct cohort students, got ${detail.statistics?.distinct_active_students}`);
  assert.ok(detail.subject_classes.length >= 2, 'cohort must link >= 2 subject classes');
  // HS50201 học bù riêng ở sc_tv5_5a1 không nằm trong roster của cohort coh_k5_5a1
  const inCohort = detail.students.some((s) => s.student_id === hsOtherRow.id);
  assert.equal(inCohort, false, 'MAKEUP student in subject class must not pollute parent cohort');
});

await t('3TIER-LINKED', 'Tạo Khung CT -> Lớp khóa học -> Sinh lớp môn -> Đồng bộ roster bảo toàn MAKEUP -> Rút & Chuyển lớp khóa', async () => {
  const curr = expectStatus(
    await api('POST', '/curricula', STAFF, {
      code: `KCT_TEST_${Date.now()}`,
      title: 'Khung chương trình Năng lực Số 2027',
      academic_level: 'Tiểu học',
      total_credits_or_hours: 120,
      status: 'ACTIVE',
    }),
    201
  );
  expectStatus(
    await api('POST', `/curricula/${curr.id}/subjects`, STAFF, {
      course_id: 'crs_toan5',
      semester_order: 1,
      is_mandatory: true,
    }),
    201
  );
  expectStatus(
    await api('POST', `/curricula/${curr.id}/subjects`, STAFF, {
      course_id: 'crs_tv5',
      semester_order: 2,
      is_mandatory: true,
    }),
    201
  );

  const cohA = expectStatus(
    await api('POST', '/cohorts', STAFF, {
      curriculum_id: curr.id,
      code: `COH_A_${Date.now()}`,
      title: 'Khóa A - Kiểm thử Liên kết',
      academic_year: '2026-2027',
      intake_term: 'Học kỳ 1',
      status: 'ACTIVE',
    }),
    201
  );
  const cohB = expectStatus(
    await api('POST', '/cohorts', STAFF, {
      curriculum_id: curr.id,
      code: `COH_B_${Date.now()}`,
      title: 'Khóa B - Đích chuyển lớp',
      academic_year: '2026-2027',
      intake_term: 'Học kỳ 2',
      status: 'ACTIVE',
    }),
    201
  );

  const gen = expectStatus(await api('POST', `/cohorts/${cohA.id}/generate-classes`, STAFF, {}), 201);
  assert.equal(gen.created.length, 2, 'must generate 2 subject classes for 2 curriculum subjects');
  const generatedClassId = gen.created[0].id;

  // Thêm HS1 vào Khóa A với sync_to_classes=true
  expectStatus(
    await api('POST', `/cohorts/${cohA.id}/students`, STAFF, {
      students: [hs1Row.id, hs2Row.id],
      sync_to_classes: true,
    }),
    200
  );

  // Thêm HS_OTHER trực tiếp vào lớp môn dưới dạng MAKEUP
  expectStatus(
    await api('POST', `/classes/${generatedClassId}/students`, STAFF, {
      students: [hsOtherRow.id],
      enrollment_source: 'MAKEUP',
    }),
    200
  );

  // Chạy sync-roster lần nữa -> bảo toàn MAKEUP, giữ COHORT_SYNCED
  const syncRes = expectStatus(await api('POST', `/cohorts/${cohA.id}/sync-roster`, STAFF, {}), 200);
  assert.ok(syncRes.classes_synced >= 2);
  const roster = expectStatus(await api('GET', `/classes/${generatedClassId}/students?status=ACTIVE`, STAFF), 200);
  const makeupEntry = roster.items.find((s) => s.id === hsOtherRow.id);
  assert.ok(makeupEntry, 'MAKEUP student must still be ACTIVE after cohort sync-roster');
  assert.equal(makeupEntry.enrollment_source, 'MAKEUP');

  // Rút HS2 khỏi Khóa A -> lớp môn cập nhật DROPPED cho HS2, giữ MAKEUP
  expectStatus(
    await api('POST', `/cohorts/${cohA.id}/students/${hs2Row.id}/withdraw`, STAFF, { reason: 'Bảo lưu kiểm thử' }),
    200
  );
  const rosterAfterWithdraw = expectStatus(await api('GET', `/classes/${generatedClassId}/students?status=ACTIVE`, STAFF), 200);
  assert.equal(rosterAfterWithdraw.items.some((s) => s.id === hs2Row.id), false, 'withdrawn cohort student dropped from synced class');
  assert.equal(rosterAfterWithdraw.items.some((s) => s.id === hsOtherRow.id), true, 'MAKEUP student preserved on withdraw');

  // Chuyển HS1 từ Khóa A sang Khóa B
  expectStatus(
    await api('POST', `/cohorts/${cohA.id}/students/${hs1Row.id}/transfer`, STAFF, {
      target_cohort_id: cohB.id,
      reason: 'Điều chuyển lịch học',
    }),
    200
  );
  const cohADetail = expectStatus(await api('GET', `/cohorts/${cohA.id}`, STAFF), 200);
  const cohBDetail = expectStatus(await api('GET', `/cohorts/${cohB.id}`, STAFF), 200);
  assert.equal(cohADetail.students.find((s) => s.student_id === hs1Row.id)?.status, 'TRANSFERRED');
  assert.equal(cohBDetail.students.find((s) => s.student_id === hs1Row.id)?.status, 'ACTIVE');
});

// ----------------------------------------------------------------------
// 2. SNAPSHOT BẤT BIẾN & NÂNG CẤP CÓ KIỂM SOÁT
// ----------------------------------------------------------------------
await t('SNAPSHOT', 'Lớp ghim Snapshot v1 không bị ảnh hưởng khi môn sửa bản nháp & phát hành v2; nâng cấp cô lập tiến độ', async () => {
  const crs = expectStatus(
    await api('POST', '/courses', ADMIN, {
      code: `SNAP_CRS_${Date.now()}`,
      title: 'Môn Kiểm thử Snapshot',
      subject: 'Tin học',
      instructor_id: db.prepare("SELECT id FROM users WHERE email = 'thuha.gv@lmsplus.edu.vn'").get().id,
    }),
    201
  );
  expectStatus(await api('POST', `/courses/${crs.id}/status`, ADMIN, { status: 'PUBLISHED' }), 200);
  const ch = expectStatus(await api('POST', `/courses/${crs.id}/chapters`, ADMIN, { title: 'Chương 1' }), 201);
  const lesson = expectStatus(await api('POST', `/chapters/${ch.id}/lessons`, ADMIN, { title: 'Bài học Phiên bản V1' }), 201);
  const revV1 = db.prepare('SELECT working_draft_revision FROM lessons WHERE id = ?').get(lesson.id).working_draft_revision;
  expectStatus(
    await api('PUT', `/lessons/${lesson.id}/content`, ADMIN, {
      base_revision: revV1,
      blocks: [{ id: 'blk_v1_txt', block_type: 'paragraph', sort_order: 1, content: { text: 'Nội dung gốc V1' } }],
    }),
    200
  );
  expectStatus(await api('POST', `/lessons/${lesson.id}/publish`, ADMIN, {}), 200);

  const v1 = expectStatus(
    await api('POST', `/courses/${crs.id}/versions`, ADMIN, { version_label: 'v1.0-base', changelog_note: 'Bản đầu' }),
    201
  );

  // Mở lớp ghim vào v1
  const clsV1 = expectStatus(
    await api('POST', '/classes', ADMIN, {
      code: `CLS_V1_${Date.now()}`,
      title: 'Lớp chạy Snapshot v1',
      course_id: crs.id,
      course_version_id: v1.id,
      instructor_id: db.prepare("SELECT id FROM users WHERE email = 'thuha.gv@lmsplus.edu.vn'").get().id,
    }),
    201
  );
  expectStatus(await api('POST', `/classes/${clsV1.id}/students`, ADMIN, { students: [hs1Row.id] }), 200);

  // Chỉnh sửa tiêu đề bài học & phát hành v2
  expectStatus(await api('PATCH', `/lessons/${lesson.id}`, ADMIN, { title: 'Bài học Phiên bản V2 Cập nhật' }), 200);
  const currentRev = db.prepare('SELECT working_draft_revision FROM lessons WHERE id = ?').get(lesson.id).working_draft_revision;
  expectStatus(
    await api('PUT', `/lessons/${lesson.id}/content`, ADMIN, {
      base_revision: currentRev,
      blocks: [{ id: 'blk_v1_txt', block_type: 'paragraph', sort_order: 1, content: { text: 'Nội dung mới V2' } }],
    }),
    200
  );
  expectStatus(await api('POST', `/lessons/${lesson.id}/publish`, ADMIN, {}), 200);
  const v2 = expectStatus(
    await api('POST', `/courses/${crs.id}/versions`, ADMIN, { version_label: 'v2.0-updated', changelog_note: 'Cập nhật nội dung' }),
    201
  );

  // Học viên ở lớp v1 vẫn thấy tên & nội dung V1!
  const learnV1Class = expectStatus(await api('GET', `/learn/classes/${clsV1.id}`, HS1), 200);
  assert.equal(learnV1Class.class.course_version?.version_number, 1);
  assert.equal(learnV1Class.chapters[0].lessons[0].title, 'Bài học Phiên bản V1');
  const learnV1Lesson = expectStatus(await api('GET', `/learn/classes/${clsV1.id}/lessons/${lesson.id}`, HS1), 200);
  assert.equal(learnV1Lesson.blocks[0].content.text, 'Nội dung gốc V1');

  // Nâng cấp thiếu confirmed=true bị từ chối 422
  expectStatus(
    await api('POST', `/classes/${clsV1.id}/upgrade-version`, ADMIN, {
      target_version_id: v2.id,
      upgrade_reason: 'Kiểm thử xác nhận',
      confirmed: false,
    }),
    422,
    'CONFIRMATION_REQUIRED'
  );

  // Nâng cấp chính thức sang v2
  const upg = expectStatus(
    await api('POST', `/classes/${clsV1.id}/upgrade-version`, ADMIN, {
      target_version_id: v2.id,
      upgrade_reason: 'Cập nhật giáo án mới đã duyệt',
      confirmed: true,
    }),
    200
  );
  assert.equal(upg.course_version_number, 2);

  // Sau nâng cấp, học viên thấy nội dung V2
  const learnV2Lesson = expectStatus(await api('GET', `/learn/classes/${clsV1.id}/lessons/${lesson.id}`, HS1), 200);
  assert.equal(learnV2Lesson.title, 'Bài học Phiên bản V2 Cập nhật');
  assert.equal(learnV2Lesson.blocks[0].content.text, 'Nội dung mới V2');
});

// ----------------------------------------------------------------------
// 3. CÂY 4 CẤP & 3 NGÂN HÀNG HỌC LIỆU RÀNG BUỘC NÚT LÁ
// ----------------------------------------------------------------------
await t('TREE-BANKS', 'Tạo Chủ đề 4 cấp, từ chối câu hỏi/bài tập/tài nguyên không gắn nút lá (400) & Import/Export JSON', async () => {
  const topic = expectStatus(
    await api('POST', '/courses/crs_toan5/topics', GV, {
      code: `TP_${Date.now()}`,
      title: 'Chủ đề Ứng dụng Tỉ số',
    }),
    201
  );
  const tree = expectStatus(await api('GET', '/courses/crs_toan5/tree', GV), 200);
  assert.ok(tree.topics.some((tp) => tp.id === topic.id));

  // Không truyền lesson_id -> 400 LEAF_LESSON_REQUIRED
  expectStatus(
    await api('POST', '/banks/questions', GV, {
      course_id: 'crs_toan5',
      node_level: 'CHAPTER',
      question_type: 'SINGLE_CHOICE',
      prompt: 'Câu hỏi sai cấp độ?',
      options: [{ id: 'a', text: 'A', is_correct: true }, { id: 'b', text: 'B', is_correct: false }],
    }),
    400,
    'LEAF_LESSON_REQUIRED'
  );
  expectStatus(
    await api('POST', '/banks/assignments', GV, {
      course_id: 'crs_toan5',
      title: 'Bài tập thiếu bài học lá',
    }),
    400,
    'LEAF_LESSON_REQUIRED'
  );
  expectStatus(
    await api('POST', '/banks/resources', GV, {
      course_id: 'crs_toan5',
      title: 'Tài nguyên thiếu bài học lá',
      url: 'https://example.com/doc.pdf',
    }),
    400,
    'LEAF_LESSON_REQUIRED'
  );

  // Lấy 1 bài học lá hợp lệ của crs_toan5
  const crsToan = expectStatus(await api('GET', '/courses/crs_toan5', GV), 200);
  const leafLessonId = crsToan.outline.flatMap((c) => c.lessons)[0].id;

  const qCreated = expectStatus(
    await api('POST', '/banks/questions', GV, {
      lesson_id: leafLessonId,
      node_level: 'LESSON',
      question_type: 'SINGLE_CHOICE',
      difficulty: 'MEDIUM',
      prompt: 'Tỉ số phần trăm của 1 và 4 là bao nhiêu?',
      points: 2,
      options: [
        { id: 'opt1', text: '25%', is_correct: true },
        { id: 'opt2', text: '40%', is_correct: false },
      ],
    }),
    201
  );
  assert.equal(qCreated.lesson_id, leafLessonId);

  const asgBank = expectStatus(
    await api('POST', '/banks/assignments', GV, {
      lesson_id: leafLessonId,
      node_level: 'LESSON',
      title: 'Bài tập tự luận ứng dụng tỉ số',
      instructions: 'Giải chi tiết 2 bài toán thực tế.',
      submission_type: 'MIXED',
      max_score: 10,
    }),
    201
  );
  assert.equal(asgBank.lesson_id, leafLessonId);

  const resBank = expectStatus(
    await api('POST', '/banks/resources', GV, {
      lesson_id: leafLessonId,
      node_level: 'LESSON',
      title: 'Phiếu học tập số 1',
      resource_type: 'LINK',
      url: 'https://lmsplus.edu.vn/docs/phieu-1',
    }),
    201
  );
  assert.equal(resBank.lesson_id, leafLessonId);

  const imp = expectStatus(
    await api('POST', '/banks/questions/import', GV, {
      lesson_id: leafLessonId,
      node_level: 'LESSON',
      items: [
        {
          question_type: 'TRUE_FALSE',
          prompt: '50% bằng 1/2 là đúng hay sai?',
          options: [{ id: 't', text: 'Đúng', is_correct: true }, { id: 'f', text: 'Sai', is_correct: false }],
        },
      ],
    }),
    201
  );
  assert.equal(imp.imported_count, 1);

  const exp = expectStatus(await api('GET', `/banks/questions/export?lesson_id=${leafLessonId}`, GV), 200);
  assert.ok(exp.total >= 2, 'export must return newly added & imported questions');
});

// ----------------------------------------------------------------------
// 4. VIDEO PROGRESS STRICT (INTERVAL UNION, ANTI-SKIP, TAMPER 422, OFFLINE IDEMPOTENCY)
// ----------------------------------------------------------------------
await t('STRICT-VIDEO', 'Interval Union [0,30]+[20,50]=50, tua lùi giữ nguyên, chặn tamper 422, ẩn tab & replay idempotent', async () => {
  // Tạo khóa/lớp/bài video sạch 200s để không nhiễu seed video cũ
  const crs = expectStatus(
    await api('POST', '/courses', ADMIN, {
      code: `VID_CRS_${Date.now()}`,
      title: 'Môn Kiểm thử Video STRICT',
      instructor_id: db.prepare("SELECT id FROM users WHERE email = 'thuha.gv@lmsplus.edu.vn'").get().id,
    }),
    201
  );
  expectStatus(await api('POST', `/courses/${crs.id}/status`, ADMIN, { status: 'PUBLISHED' }), 200);
  const ch = expectStatus(await api('POST', `/courses/${crs.id}/chapters`, ADMIN, { title: 'Ch1' }), 201);
  const les = expectStatus(
    await api('POST', `/chapters/${ch.id}/lessons`, ADMIN, { title: 'Bài Video STRICT', completion_rule: 'VIDEO_AND_QUIZ' }),
    201
  );
  const revStrict = db.prepare('SELECT working_draft_revision FROM lessons WHERE id = ?').get(les.id).working_draft_revision;
  expectStatus(
    await api('PUT', `/lessons/${les.id}/content`, ADMIN, {
      base_revision: revStrict,
      blocks: [
        {
          id: 'blk_strict_vid',
          block_type: 'video',
          sort_order: 1,
          content: {
            source_type: 'YOUTUBE',
            video_id: 'dQw4w9WgXcQ',
            title: 'Video 200s',
            duration_seconds: 200,
            allow_seeking_ahead: false,
          },
        },
      ],
    }),
    200
  );
  expectStatus(await api('POST', `/lessons/${les.id}/publish`, ADMIN, {}), 200);
  const cls = expectStatus(
    await api('POST', '/classes', ADMIN, {
      code: `CLS_VID_${Date.now()}`,
      title: 'Lớp kiểm thử STRICT Video',
      course_id: crs.id,
      instructor_id: db.prepare("SELECT id FROM users WHERE email = 'thuha.gv@lmsplus.edu.vn'").get().id,
    }),
    201
  );
  expectStatus(await api('POST', `/classes/${cls.id}/students`, ADMIN, { students: [hs1Row.id] }), 200);

  // Gửi [0, 30] -> 30s
  const p1 = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 30,
      duration_sec: 200,
      playback_rate: 1,
      is_visible: true,
      segments: [{ start_sec: 0, end_sec: 30, is_visible: true }],
    }),
    200
  );
  assert.equal(Math.round(p1.unique_watched_sec), 30);

  // Gửi [20, 50] chồng lấn 10s -> hợp khoảng [0, 50] = 50s (không phải 60s!)
  const p2 = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 50,
      duration_sec: 200,
      playback_rate: 1,
      is_visible: true,
      segments: [{ start_sec: 20, end_sec: 50, is_visible: true }],
    }),
    200
  );
  assert.equal(Math.round(p2.unique_watched_sec), 50);

  // Tua lùi về 10s và xem lại [10, 20] -> không bao giờ tụt % hay giảm từ 50s
  const pBack = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 20,
      duration_sec: 200,
      playback_rate: 1,
      is_visible: true,
      segments: [{ start_sec: 10, end_sec: 20, is_visible: true }],
    }),
    200
  );
  assert.equal(Math.round(pBack.unique_watched_sec), 50);

  // Tua nhảy cóc qua frontier [120, 160] -> 422 STRICT_VIDEO_TAMPER_REJECTED
  expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 160,
      duration_sec: 200,
      playback_rate: 1,
      is_visible: true,
      segments: [{ start_sec: 120, end_sec: 160, is_visible: true }],
    }),
    422,
    'STRICT_VIDEO_TAMPER_REJECTED'
  );

  // Tốc độ 3.0x (> 2.0x) -> 422 STRICT_VIDEO_TAMPER_REJECTED
  expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 55,
      duration_sec: 200,
      playback_rate: 3.0,
      is_visible: true,
      segments: [{ start_sec: 50, end_sec: 55, is_visible: true }],
    }),
    422,
    'STRICT_VIDEO_TAMPER_REJECTED'
  );

  // Tab ẩn (is_visible: false) không cộng thời lượng mới
  const pHidden = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, {
      block_id: 'blk_strict_vid',
      last_position_sec: 50,
      duration_sec: 200,
      playback_rate: 1,
      is_visible: false,
      events: [{ idempotency_key: 'hid_1', start_sec: 50, end_sec: 70, playback_rate: 1, is_visible: false }],
    }),
    200
  );
  assert.equal(Math.round(pHidden.unique_watched_sec), 50, 'hidden tab must not increase watched duration');

  // Offline queue gửi lại cùng idempotency_key 2 lần -> idempotent = 65s
  const offlineBatch = {
    block_id: 'blk_strict_vid',
    last_position_sec: 65,
    duration_sec: 200,
    playback_rate: 1,
    is_visible: true,
    events: [{ idempotency_key: 'offline_sync_key_1', start_sec: 50, end_sec: 65, playback_rate: 1, is_visible: true }],
  };
  const pSync1 = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, offlineBatch),
    200
  );
  const pSync2 = expectStatus(
    await api('PUT', `/learn/classes/${cls.id}/lessons/${les.id}/video-progress`, HS1, offlineBatch),
    200
  );
  assert.equal(Math.round(pSync1.unique_watched_sec), 65);
  assert.equal(Math.round(pSync2.unique_watched_sec), 65);

  // Analytics giảng viên hiển thị đúng & đếm tamper
  const analytics = expectStatus(await api('GET', `/classes/${cls.id}/video-analytics`, GV), 200);
  assert.ok(analytics.summary.total_tamper_rejected >= 2, 'tamper attempts logged in analytics');
  assert.equal(Math.round(analytics.items[0].unique_watched_sec), 65);
});

// ----------------------------------------------------------------------
// 5. KIỂM TRA (TỰ ĐỘNG + CHẤM TAY), BÀI TẬP, BẢNG ĐIỂM & OVERVIEW 10 MỤC
// ----------------------------------------------------------------------
await t('ASSESSMENT', 'Tạo bài kiểm tra hỗn hợp (trắc nghiệm + tự luận), chấm tự động+tay, bài tập, bảng điểm & overview 10 mục', async () => {
  const bankList = expectStatus(await api('GET', '/banks/questions?course_id=crs_toan5&page_size=5', GV), 200);
  const pickedBankQ = bankList.items.find((q) => q.question_type === 'SINGLE_CHOICE');
  assert.ok(pickedBankQ, 'need at least one SINGLE_CHOICE question in crs_toan5 bank');

  const exam = expectStatus(
    await api('POST', '/classes/sc_toan5_5a1/exams', GV, {
      title: `Kiểm tra Kiểm thử ${Date.now()}`,
      time_limit_minutes: 30,
      max_attempts: 2,
      pass_score_pct: 50,
      status: 'PUBLISHED',
      question_bank_ids: [pickedBankQ.id],
      questions: [{ question_type: 'SHORT_ANSWER', prompt: 'Trình bày cách giải bài toán tỉ số', points: 4 }],
    }),
    201
  );

  // Học viên bắt đầu làm bài
  const started = expectStatus(await api('POST', `/learn/exams/${exam.id}/start`, HS1, {}), 201);
  const qMcq = started.attempt.questions.find((q) => q.question_type === 'SINGLE_CHOICE');
  const qEssay = started.attempt.questions.find((q) => q.question_type === 'SHORT_ANSWER');

  // Lấy đáp án đúng từ ngân hàng
  const bankOpts = JSON.parse(db.prepare('SELECT options_json FROM question_bank_items WHERE id = ?').get(pickedBankQ.id).options_json || '[]');
  const rightOpt = bankOpts.find((o) => o.is_correct) || bankOpts[0];

  const answers = {
    [qMcq.id]: { option_id: rightOpt.id },
    [qEssay.id]: { text: 'Bước 1 tính tổng phần bằng nhau...' },
  };
  expectStatus(await api('PUT', `/learn/exam-attempts/${started.attempt.id}/save`, HS1, { answers }), 200);
  const sub = expectStatus(await api('POST', `/learn/exam-attempts/${started.attempt.id}/submit`, HS1, { answers }), 200);
  assert.equal(sub.attempt.grading_status, 'PENDING_MANUAL', 'mixed exam must wait manual grading of short-answer');
  assert.ok(sub.attempt.auto_score > 0, 'MCQ auto score must be > 0');

  // Giảng viên chấm câu tự luận
  expectStatus(
    await api('POST', `/exam-attempts/${started.attempt.id}/grade`, GV, {
      item_scores: { [qEssay.id]: 3.5 },
      teacher_feedback: 'Lập luận chặt chẽ.',
    }),
    200
  );

  // Giao bài tập thực hành & nộp bài & chấm
  const asg = expectStatus(
    await api('POST', '/classes/sc_toan5_5a1/assignments', GV, {
      title: `Bài tập thực hành ${Date.now()}`,
      instructions: 'Nộp link hoặc bài làm văn bản.',
      submission_type: 'MIXED',
      max_score: 10,
      status: 'PUBLISHED',
    }),
    201
  );
  expectStatus(
    await api('PUT', `/learn/assignments/${asg.id}/draft`, HS1, { submission_text: 'Bản nháp bài tập' }),
    200
  );
  const submittedAsg = expectStatus(
    await api('POST', `/learn/assignments/${asg.id}/submit`, HS1, { submission_text: 'Bài hoàn chỉnh của em' }),
    200
  );
  expectStatus(
    await api('POST', `/assignment-submissions/${submittedAsg.id}/grade`, GV, {
      status: 'GRADED',
      score: 9,
      teacher_feedback: 'Hoàn thành tốt',
    }),
    200
  );

  // Bảng điểm tổng hợp & điểm học viên
  const gb = expectStatus(await api('GET', '/classes/sc_toan5_5a1/gradebook', GV), 200);
  const hs1RowGb = gb.rows.find((r) => r.student_id === hs1Row.id);
  assert.ok(hs1RowGb && hs1RowGb.graded_count >= 2 && hs1RowGb.average_scale_10 !== null, 'gradebook must reflect exam + assignment');

  const myGrades = expectStatus(await api('GET', '/learn/classes/sc_toan5_5a1/grades', HS1), 200);
  assert.ok(myGrades.gradebook_entries.length >= 2 && myGrades.average_scale_10 !== null);

  // Student Overview 10 hạng mục
  const ov = expectStatus(await api('GET', '/learn/overview', HS1), 200);
  for (const key of [
    'total_classes',
    'total_lessons',
    'completed_lessons',
    'overall_progress_pct',
    'upcoming_sessions',
    'pending_assignments',
    'pending_exams',
    'attendance_summary',
    'pending_leave_requests',
    'recent_grades',
    'recent_forum_activity',
    'notifications',
  ]) {
    assert.ok(ov[key] !== undefined, `overview must contain ${key}`);
  }
});

// ----------------------------------------------------------------------
// 6. ĐƠN XIN NGHỈ PHÉP & GUARD KHÔNG GHI ĐÈ PRESENT/LATE
// ----------------------------------------------------------------------
await t('LEAVE-ATT', 'Duyệt đơn nghỉ sync EXCUSED_ABSENCE nhưng tuyệt đối không ghi đè PRESENT/LATE + hủy đơn', async () => {
  const yestDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const s1 = expectStatus(
    await api('POST', '/classes/sc_toan5_5a1/sessions', GV, {
      title: 'Buổi nghỉ test 1 (chưa điểm danh)',
      delivery_mode: 'OFFLINE',
      date: '2026-12-01',
      start_time: '08:00',
      end_time: '09:30',
    }),
    201
  );
  const s2 = expectStatus(
    await api('POST', '/classes/sc_toan5_5a1/sessions', GV, {
      title: 'Buổi nghỉ test 2 (đã PRESENT)',
      delivery_mode: 'OFFLINE',
      date: yestDate,
      start_time: '08:00',
      end_time: '09:30',
    }),
    201
  );
  const s3 = expectStatus(
    await api('POST', '/classes/sc_toan5_5a1/sessions', GV, {
      title: 'Buổi nghỉ test 3 (hủy đơn)',
      delivery_mode: 'OFFLINE',
      date: '2026-12-03',
      start_time: '08:00',
      end_time: '09:30',
    }),
    201
  );
  const sessList = expectStatus(await api('GET', `/classes/sc_toan5_5a1/sessions?from=${yestDate}&to=2026-12-05`, GV), 200).items;
  const sess1 = sessList.find((x) => x.title.includes('test 1'));
  const sess2 = sessList.find((x) => x.title.includes('test 2'));
  const sess3 = sessList.find((x) => x.title.includes('test 3'));
  assert.ok(sess1 && sess2 && sess3 && s1 && s2 && s3);

  // Đánh dấu PRESENT cho HS1 ở sess2 trước
  expectStatus(
    await api('PUT', `/sessions/${sess2.id}/attendance`, GV, {
      idempotency_key: `att_present_${Date.now()}`,
      records: [{ student_id: hs1Row.id, status: 'PRESENT', note: 'Có mặt thực tế tại lớp' }],
    }),
    200
  );

  // HS1 tạo đơn xin nghỉ cho cả 3 buổi
  const lr1 = expectStatus(
    await api('POST', '/learn/leave-requests', HS1, {
      class_id: 'sc_toan5_5a1',
      session_id: sess1.id,
      reason_category: 'SICK',
      reason: 'Sốt xuất huyết có giấy khám',
    }),
    201
  );
  const lr2 = expectStatus(
    await api('POST', '/learn/leave-requests', HS1, {
      class_id: 'sc_toan5_5a1',
      session_id: sess2.id,
      reason_category: 'FAMILY',
      reason: 'Xin nghỉ dự phòng nhưng đã kịp đi học',
    }),
    201
  );
  const lr3 = expectStatus(
    await api('POST', '/learn/leave-requests', HS1, {
      class_id: 'sc_toan5_5a1',
      session_id: sess3.id,
      reason_category: 'OTHER',
      reason: 'Đơn sẽ hủy',
    }),
    201
  );

  // Duyệt lr1 -> tạo EXCUSED_ABSENCE
  const rev1 = expectStatus(
    await api('POST', `/leave-requests/${lr1.id}/review`, GV, { decision: 'APPROVED', review_note: 'Đồng ý nghỉ phép' }),
    200
  );
  assert.equal(rev1.attendance_sync_result, 'CREATED_EXCUSED');
  const att1 = db.prepare('SELECT attendance_status FROM attendance_records WHERE class_session_id = ? AND student_id = ?').get(sess1.id, hs1Row.id);
  assert.equal(att1.attendance_status, 'EXCUSED_ABSENCE');

  // Duyệt lr2 -> KHÔNG được ghi đè PRESENT!
  expectStatus(
    await api('POST', `/leave-requests/${lr2.id}/review`, GV, { decision: 'APPROVED', review_note: 'Duyệt lưu vết' }),
    200
  );
  const att2 = db.prepare('SELECT attendance_status FROM attendance_records WHERE class_session_id = ? AND student_id = ?').get(sess2.id, hs1Row.id);
  assert.equal(att2.attendance_status, 'PRESENT', 'APPROVED leave must NEVER overwrite PRESENT attendance');

  // Học viên tự hủy đơn lr3
  const canceled = expectStatus(await api('POST', `/learn/leave-requests/${lr3.id}/cancel`, HS1, {}), 200);
  assert.equal(canceled.status, 'CANCELLED');
});

// ----------------------------------------------------------------------
// 7. DIỄN ĐÀN MÔN HỌC & LỚP RIÊNG TƯ (CẤM RÒ RỈ 403), KIỂM DUYỆT & THÔNG BÁO
// ----------------------------------------------------------------------
await t('FORUM-NOTIF', 'Diễn đàn lớp cô lập chéo lớp (403), thảo luận, hữu ích, báo cáo, kiểm duyệt & thông báo', async () => {
  // HS50201 (lớp 5A2) không thể truy cập diễn đàn lớp sc_toan5_5a1 -> 403
  expectStatus(await api('GET', '/learn/classes/sc_toan5_5a1/forums', HS_OTHER), 403);

  const forums = expectStatus(await api('GET', '/learn/classes/sc_toan5_5a1/forums', HS1), 200);
  const classForumId = forums.class_forum.forum.id;
  assert.ok(classForumId, 'class forum must exist');

  // HS1 tạo chủ đề hỏi đáp
  const thread = expectStatus(
    await api('POST', `/forums/${classForumId}/threads`, HS1, {
      category: 'QA',
      title: 'Cách tính nhẩm 25% nhanh nhất?',
      body: 'Nhờ thầy cô và các bạn hướng dẫn cách chia cho 4.',
    }),
    201
  );

  // HS2 cùng lớp trả lời & đánh dấu hữu ích
  const reply = expectStatus(
    await api('POST', `/forum-threads/${thread.id}/replies`, HS2, {
      body: 'Bạn lấy số đó chia cho 4 sẽ ra đúng 25% nhé!',
    }),
    201
  );
  const helpful = expectStatus(
    await api('POST', '/forum-helpful', HS1, { target_type: 'REPLY', target_id: reply.id }),
    200
  );
  assert.equal(helpful.helpful_count, 1);

  // Báo cáo & kiểm duyệt bởi giảng viên
  expectStatus(
    await api('POST', '/forum-reports', HS2, { target_type: 'THREAD', target_id: thread.id, reason: 'Kiểm tra báo cáo' }),
    201
  );
  const reports = expectStatus(await api('GET', `/forums/${classForumId}/reports`, GV), 200);
  const pendingReport = reports.items.find((r) => r.target_id === thread.id && r.status === 'PENDING');
  assert.ok(pendingReport, 'report must appear in forum reports list');

  expectStatus(
    await api('POST', `/forum-reports/${pendingReport.id}/resolve`, GV, { status: 'DISMISSED', hide_target: false, resolution_note: 'Nội dung hợp lệ' }),
    200
  );
  const modThread = expectStatus(
    await api('POST', `/forum-threads/${thread.id}/moderate`, GV, { action: 'PIN', reason: 'Ghim chủ đề tiêu biểu' }),
    200
  );
  assert.equal(Boolean(modThread.is_pinned), true);
  const modReply = expectStatus(
    await api('POST', `/forum-replies/${reply.id}/moderate`, GV, { action: 'ENDORSE', reason: 'Câu trả lời chính xác' }),
    200
  );
  assert.equal(Boolean(modReply.is_endorsed), true);

  // HS1 nhận được thông báo & đánh dấu đã đọc
  const notifs = expectStatus(await api('GET', '/notifications', HS1), 200);
  assert.ok(notifs.items.length > 0, 'HS1 must receive notifications from leave review / grading / reply');
  const firstUnread = notifs.items.find((n) => !n.is_read) || notifs.items[0];
  expectStatus(await api('POST', `/notifications/${firstUnread.id}/read`, HS1, {}), 200);
  expectStatus(await api('POST', '/notifications/read-all', HS1, {}), 200);
  const notifsAfter = expectStatus(await api('GET', '/notifications', HS1), 200);
  assert.equal(notifsAfter.unread_count, 0);
});

console.log('----------------------------------------------------------------------');
console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exit(1);
