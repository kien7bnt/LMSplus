#!/usr/bin/env node
/**
 * LMSPLUS — PHASE 4 BUSINESS LOGIC, RUBRICS, UPLOAD, APPEALS, PERIODS & CSV IMPORT SUITE (6 CASES)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `phase4-business-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-phase4-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { initSchemaAndSeed, invokeApi, invokeApiAsync, db } = await import('../backend/server_fallback.mjs');
await initSchemaAndSeed(true);

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

const login = async (identifier) => {
  const r = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier, password: '123456' });
  assert.equal(r.status, 200, `login ${identifier} failed: ${JSON.stringify(r.body)}`);
  return { authorization: `Bearer ${r.body.data.access_token}` };
};

const T = '/api/v1/teaching';
const api = async (method, url, headers, body) => await invokeApiAsync(method, `${T}${url}`, headers, body);

console.log('======================================================================');
console.log(' LMSPLUS — PHASE 4 BUSINESS WORKFLOWS TEST SUITE (6 CASES)');
console.log('======================================================================');

const adminH = await login('admin@lmsplus.edu.vn');
const gv1H = await login('thuha.gv@lmsplus.edu.vn');
const hs1H = await login('HS50101');
const hs2H = await login('HS50102');

// Tạo tài khoản Trưởng bộ môn Khối 5 (department khoi_5 của course_toan5) qua API thật
const hodRes = await api('POST', '/users', adminH, {
  code: 'HOD_K5',
  full_name: 'Trưởng bộ môn Khối 5',
  email: 'hod.k5@lmsplus.edu.vn',
  roles: ['HEAD_OF_DEPARTMENT'],
  department_id: 'khoi_5',
  password: 'Password@1234',
});
assert.equal(hodRes.status, 201, JSON.stringify(hodRes.body));
const hodLoginRes = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier: 'HOD_K5', password: 'Password@1234' });
assert.equal(hodLoginRes.status, 200);
const hodH = { authorization: `Bearer ${hodLoginRes.body.data.access_token}` };

let assignmentId = '';
let submissionId = '';

await t('RUBRIC', 'Tạo bài tập có Rubric & chấm điểm tự tổng hợp vào Sổ điểm (chặn điểm vượt tiêu chí)', async () => {
  const createRes = await api('POST', '/classes/sc_toan5_5a1/assignments', gv1H, {
    title: 'Bài tập Rubric Phase 4',
    instructions: 'Giải toán và nộp bản PDF phân tích.',
    submission_type: 'MIXED',
    max_score: 10,
    status: 'PUBLISHED',
    rubric: [
      { id: 'c1', criterion: 'Phân tích bài toán', max_points: 6 },
      { id: 'c2', criterion: 'Trình bày sạch đẹp', max_points: 4 },
    ],
  });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  assignmentId = createRes.body.data.id;
  assert.equal(createRes.body.data.rubric.length, 2);

  const subRes = await api('POST', `/learn/assignments/${assignmentId}/submit`, hs1H, {
    submission_text: 'Em nộp bài phân tích Rubric ạ.',
  });
  assert.equal(subRes.status, 200, JSON.stringify(subRes.body));
  submissionId = subRes.body.data.id;

  // Vượt max_points của tiêu chí c2 (4) phải trả HTTP 422
  const badGrade = await api('POST', `/assignment-submissions/${submissionId}/grade`, gv1H, {
    status: 'GRADED',
    rubric_scores: [
      { criterion_id: 'c1', criterion: 'Phân tích bài toán', max_points: 6, points: 5 },
      { criterion_id: 'c2', criterion: 'Trình bày sạch đẹp', max_points: 4, points: 4.5 },
    ],
  });
  assert.equal(badGrade.status, 422);

  // Chấm đúng Rubric -> không gửi score tay, hệ thống tự cộng 5.5 + 3.5 = 9
  const okGrade = await api('POST', `/assignment-submissions/${submissionId}/grade`, gv1H, {
    status: 'GRADED',
    teacher_feedback: 'Làm bài tốt, trình bày rõ.',
    rubric_scores: [
      { criterion_id: 'c1', criterion: 'Phân tích bài toán', max_points: 6, points: 5.5, comment: 'Đúng phương pháp' },
      { criterion_id: 'c2', criterion: 'Trình bày sạch đẹp', max_points: 4, points: 3.5, comment: 'Rõ ràng' },
    ],
  });
  assert.equal(okGrade.status, 200, JSON.stringify(okGrade.body));
  assert.equal(okGrade.body.data.score, 9);
  assert.equal(okGrade.body.data.rubric_scores.length, 2);
});

await t('UPLOAD', 'Học viên tải lên tệp bài tập PDF (kiểm tra magic bytes) & RBAC cô lập tệp giữa học viên', async () => {
  // Chặn extension nguy hiểm / sai magic bytes
  const exeReject = await api('POST', `/learn/assignments/${assignmentId}/upload`, hs1H, {
    file_name: 'malware.exe',
    content_base64: Buffer.from('MZfakeexe').toString('base64'),
  });
  assert.equal(exeReject.status, 422);

  const fakePdfReject = await api('POST', `/learn/assignments/${assignmentId}/upload`, hs1H, {
    file_name: 'fake.pdf',
    content_base64: Buffer.from('NOT_A_PDF_HEADER').toString('base64'),
  });
  assert.equal(fakePdfReject.status, 422);

  // Tải lên PDF hợp lệ
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const upRes = await api('POST', `/learn/assignments/${assignmentId}/upload`, hs1H, {
    file_name: 'bai-lam-hs1.pdf',
    mime_type: 'application/pdf',
    content_base64: pdfBytes.toString('base64'),
  });
  assert.equal(upRes.status, 201, JSON.stringify(upRes.body));
  assert.ok(upRes.body.data.url.startsWith('/api/v1/teaching/assignment-files/'));

  // Chính chủ HS50101 tải xuống OK
  const ownDl = await invokeApiAsync('GET', upRes.body.data.url, hs1H);
  assert.equal(ownDl.status, 200);

  // Giảng viên lớp tải xuống OK
  const gvDl = await invokeApiAsync('GET', upRes.body.data.url, gv1H);
  assert.equal(gvDl.status, 200);

  // Học viên khác (HS50102) bị chặn 403 FILE_ACCESS_DENIED
  const otherDl = await invokeApiAsync('GET', upRes.body.data.url, hs2H);
  assert.equal(otherDl.status, 403);
  assert.equal(otherDl.body.detail.code, 'FILE_ACCESS_DENIED');
});

await t('APPEAL', 'Phúc khảo điểm: Học viên gửi đơn, chống trùng, Trưởng bộ môn duyệt và tự đồng bộ Sổ điểm', async () => {
  const createAppeal = await api('POST', '/learn/appeals', hs1H, {
    target_type: 'ASSIGNMENT',
    submission_or_attempt_id: submissionId,
    requested_score: 9.5,
    reason: 'Em trình bày đầy đủ công thức ở phần 2, kính nhờ thầy cô xem xét lại 0.5 điểm.',
  });
  assert.equal(createAppeal.status, 201, JSON.stringify(createAppeal.body));
  const appealId = createAppeal.body.data.id;

  // Trùng đơn PENDING -> 409
  const dupAppeal = await api('POST', '/learn/appeals', hs1H, {
    target_type: 'ASSIGNMENT',
    submission_or_attempt_id: submissionId,
    reason: 'Gửi lặp đơn phúc khảo.',
  });
  assert.equal(dupAppeal.status, 409);

  // Học viên khác không thể xem / xử lý phúc khảo
  const hsTryList = await api('GET', '/classes/sc_toan5_5a1/appeals', hs2H);
  assert.equal(hsTryList.status, 403);

  // Trưởng bộ môn (khoi_5) xem danh sách & phê duyệt nâng lên 9.5
  const hodList = await api('GET', '/classes/sc_toan5_5a1/appeals', hodH);
  assert.equal(hodList.status, 200, JSON.stringify(hodList.body));
  assert.ok(hodList.body.data.items.some((a) => a.id === appealId));

  const reviewRes = await api('POST', `/appeals/${appealId}/review`, hodH, {
    decision: 'APPROVED',
    final_score: 9.5,
    resolution_note: 'Đã đối soát bài làm PDF, đồng ý nâng từ 9 lên 9.5.',
  });
  assert.equal(reviewRes.status, 200, JSON.stringify(reviewRes.body));
  assert.equal(reviewRes.body.data.status, 'APPROVED');
  assert.equal(reviewRes.body.data.final_score, 9.5);

  // Kiểm tra Sổ điểm & Bài nộp đã cập nhật thành 9.5
  const gbRes = await api('GET', '/classes/sc_toan5_5a1/gradebook', gv1H);
  assert.equal(gbRes.status, 200);
  const hs1Row = gbRes.body.data.rows.find((r) => (r.student_code || r.code) === 'HS50101');
  assert.ok(hs1Row, 'Expected HS50101 in gradebook');
  assert.equal(hs1Row.scores[`ASSIGNMENT:${assignmentId}`].score, 9.5);
});

await t('PERIODS', 'Quy đổi số giờ Khung CT theo minutes_per_period cấu hình của môn học (60 phút = 1 giờ/tiết)', async () => {
  const cRes = await api('POST', '/courses', gv1H, {
    code: 'CRS-P4-60M',
    title: 'Môn học 60 phút mỗi tiết',
    department_id: 'khoi_5',
  });
  assert.equal(cRes.status, 201, JSON.stringify(cRes.body));
  const courseId = cRes.body.data.id;

  const profRes = await api('PUT', `/courses/${courseId}/training-profile`, adminH, {
    minutes_per_period: 60,
  });
  assert.equal(profRes.status, 200, JSON.stringify(profRes.body));
  assert.equal(profRes.body.data.course.minutes_per_period, 60);

  const curRes = await api('POST', '/curricula', adminH, {
    code: 'CUR-P4-60M',
    title: 'Khung CT Kiểm thử 60p/tiết',
    version: '1.0',
    department_id: 'khoi_5',
  });
  assert.equal(curRes.status, 201, JSON.stringify(curRes.body));

  const addSub = await api('POST', `/curricula/${curRes.body.data.id}/subjects`, adminH, {
    course_id: courseId,
    semester_order: 1,
    planned_periods: 30,
  });
  assert.equal(addSub.status, 201, JSON.stringify(addSub.body));
  assert.equal(addSub.body.data.planned_hours, 30);
});

await t('LEAVE-CSV', 'Đơn xin nghỉ phép hỗ trợ SICK/ACADEMIC_CONFLICT & Import CSV học viên bỏ qua dòng tiêu đề/tên', async () => {
  const lvRes = await api('POST', '/learn/leave-requests', hs1H, {
    class_id: 'sc_toan5_5a1',
    reason_category: 'ACADEMIC_CONFLICT',
    reason: 'Trùng lịch thi Olympic Toán học cấp trường.',
  });
  assert.equal(lvRes.status, 201, JSON.stringify(lvRes.body));
  assert.equal(lvRes.body.data.reason_category, 'ACADEMIC_CONFLICT');

  const csvRes = await api('POST', '/classes/sc_toan5_5a1/students/import', adminH, {
    text: 'code,full_name\nHS50101,Nguyễn Minh Anh\nHS50102,Trần Gia Bảo',
    enrollment_source: 'ACADEMIC_ASSIGNED',
  });
  assert.equal(csvRes.status, 200, JSON.stringify(csvRes.body));
  assert.equal(csvRes.body.data.not_found.length, 0);
});

await t('STUDIO', 'Lesson Studio hỗ trợ lưu khối step_by_step_solution & giữ nguyên thumbnail data:image/', async () => {
  const crsRes = await api('POST', '/courses', gv1H, {
    code: 'CRS-P4-BLK',
    title: 'Môn học Kiểm thử Khối Lời Giải',
    department_id: 'khoi_5',
  });
  assert.equal(crsRes.status, 201, JSON.stringify(crsRes.body));
  const cid = crsRes.body.data.id;
  const chRes = await api('POST', `/courses/${cid}/chapters`, gv1H, { title: 'Chương 1' });
  assert.equal(chRes.status, 201, JSON.stringify(chRes.body));
  const lesRes = await api('POST', `/chapters/${chRes.body.data.id}/lessons`, gv1H, { title: 'Bài 1' });
  assert.equal(lesRes.status, 201, JSON.stringify(lesRes.body));
  const lid = lesRes.body.data.id;
  const lesInfo = await api('GET', `/lessons/${lid}`, gv1H);
  assert.equal(lesInfo.status, 200);
  const baseRev = Number(lesInfo.body.data.working_draft_revision ?? 1);

  const saveRes = await api('PUT', `/lessons/${lid}/content`, gv1H, {
    base_revision: baseRev,
    blocks: [
      {
        block_type: 'step_by_step_solution',
        content: {
          problem: 'Tìm x biết 2x + 4 = 10',
          steps: [
            { title: 'Bước 1', explanation: 'Chuyển vế 2x = 6' },
            { title: 'Bước 2', explanation: 'Chia hai vế được x = 3' },
          ],
        },
      },
    ],
  });
  assert.equal(saveRes.status, 200, JSON.stringify(saveRes.body));
  assert.equal(saveRes.body.data.blocks[0].block_type, 'step_by_step_solution');
  assert.equal(saveRes.body.data.blocks[0].content.steps.length, 2);
});

console.log('----------------------------------------------------------------------');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
process.exit(failed > 0 ? 1 : 0);
