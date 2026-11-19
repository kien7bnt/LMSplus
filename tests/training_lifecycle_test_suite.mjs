#!/usr/bin/env node
/**
 * LMSPLUS — PHÂN HỆ ĐÀO TẠO TOÀN VÒNG ĐỜI (TRAINING LIFECYCLE & TIMETABLE & TEACHING HOURS)
 * Kiểm thử tích hợp toàn diện:
 * 1.1 Môn học: Chuẩn đầu ra (CLO), Tiên quyết chống chu trình DAG, Đầu điểm tổng = 100%, Đề cương & tag Bắt buộc/Tham khảo, Ban hành & Diff
 * 1.2 Khung chương trình: Dịch vụ kèm theo + Học phí tự động/chỉnh tay, Giai đoạn, Cảnh báo thứ tự tiên quyết, Chia buổi (1 buổi = 1 bài & gộp), Chặn mở lớp khi chưa Ban hành
 * 1.3 Khởi tạo Khóa học 5 bước: Sinh lớp môn, ghim Snapshot, sao chép bài tập hạn nộp tương đối, sinh buổi liên kết bài học, xếp lịch nhanh
 * 2.1 Thời khóa biểu: 6 Ràng buộc cứng (lễ, ngoài giờ mở cửa, sai loại phòng, quá sức chứa, trùng phòng vs lớp ghép, trùng GV + di chuyển liên cơ sở, lịch bận GV, trùng lớp), 4 phương pháp xếp, Công bố chốt hạn nộp bài tập, Điều chỉnh dời/nghỉ-dạy bù/dạy thay
 * 2.2 Thống kê & Chốt giờ dạy: Tự mở buổi dạy đến giờ, giờ thực tế & GV dạy thay, định mức & vượt định mức, cô lập RBAC theo GV, Chốt công 4 bước (Tổng hợp -> Phản hồi sai sót -> Xác nhận -> Duyệt -> Khóa chặn sửa buổi học + Xuất CSV/JSON Tài chính)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `training-lifecycle-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-training-${process.pid}`);
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
    `expected HTTP ${status}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`
  );
  if (code) {
    const actualCode = r.body?.detail?.code || r.body?.code || r.body?.error?.code;
    assert.equal(actualCode, code, `expected error code ${code}, got ${actualCode} (${JSON.stringify(r.body)})`);
  }
  return r.body?.data;
};

const ADMIN = login('admin@lmsplus.edu.vn');
const staffRow = db.prepare("SELECT * FROM users WHERE roles_json LIKE '%\"ACADEMIC_STAFF\"%' LIMIT 1").get();
const STAFF = login(staffRow ? staffRow.email : 'admin@lmsplus.edu.vn');
const GV1 = login('thuha.gv@lmsplus.edu.vn');
const GV2 = login('vankhoa.gv@lmsplus.edu.vn');
const HS1 = login('HS50101');

const gv1User = db.prepare("SELECT * FROM users WHERE email = 'thuha.gv@lmsplus.edu.vn'").get();
const gv2User = db.prepare("SELECT * FROM users WHERE email = 'vankhoa.gv@lmsplus.edu.vn'").get();

console.log('======================================================================');
console.log(' LMSPLUS — TRAINING LIFECYCLE, TIMETABLE & TEACHING HOURS SUITE');
console.log('======================================================================');

let py101Id = '';
let db201Id = '';
let pyLesson1Id = '';
let pyLesson2Id = '';
let fsCurrId = '';
let fsCohortId = '';
let pyClassId = '';
let dbClassId = '';

// ----------------------------------------------------------------------
// 1.1 MÔN HỌC (CHUẨN BỊ ĐÀO TẠO)
// ----------------------------------------------------------------------
await t('1.1-COURSE', 'Tạo 2 môn PY101 & DB201, lưu Chuẩn đầu ra (CLO), Thời lượng LT/TH/Tự học, Loại phòng & Học phí tham khảo', async () => {
  const py = expectStatus(await api('POST', '/courses', GV1, {
    code: 'PY101',
    title: 'Lập trình Python cơ bản',
    subject: 'Công nghệ thông tin',
    description: 'Môn nền tảng Python cho lộ trình Fullstack.',
    objectives: 'Nắm vững cú pháp, hàm, ngoại lệ và thao tác file.',
  }), 201);
  py101Id = py.id;

  const dbCrs = expectStatus(await api('POST', '/courses', GV2, {
    code: 'DB201',
    title: 'Cơ sở dữ liệu & SQL',
    subject: 'Công nghệ thông tin',
    description: 'Thiết kế CSDL quan hệ và truy vấn SQL.',
  }), 201);
  db201Id = dbCrs.id;

  // Thêm chương + 2 bài học cho PY101 và 1 bài cho DB201
  const pyCh = expectStatus(await api('POST', `/courses/${py101Id}/chapters`, GV1, { title: 'Chương 1: Nền tảng Python' }), 201);
  const l1 = expectStatus(await api('POST', `/chapters/${pyCh.id}/lessons`, GV1, { title: 'Bài 1: Biến, kiểu dữ liệu & Hàm', duration_minutes: 90 }), 201);
  const l2 = expectStatus(await api('POST', `/chapters/${pyCh.id}/lessons`, GV1, { title: 'Bài 2: Xử lý ngoại lệ & Đọc ghi File', duration_minutes: 90 }), 201);
  pyLesson1Id = l1.id;
  pyLesson2Id = l2.id;
  expectStatus(await api('PUT', `/lessons/${pyLesson1Id}/content`, GV1, {
    base_revision: 1,
    blocks: [{ block_type: 'paragraph', content: { text: 'Nội dung cú pháp hàm Python cơ bản.' } }],
  }), 200);
  expectStatus(await api('PUT', `/lessons/${pyLesson2Id}/content`, GV1, {
    base_revision: 1,
    blocks: [{ block_type: 'paragraph', content: { text: 'Nội dung try/except và đọc ghi file.' } }],
  }), 200);
  expectStatus(await api('POST', `/lessons/${pyLesson1Id}/publish`, GV1, {}), 200);
  expectStatus(await api('POST', `/lessons/${pyLesson2Id}/publish`, GV1, {}), 200);

  const dbCh = expectStatus(await api('POST', `/courses/${db201Id}/chapters`, GV2, { title: 'Chương 1: Mô hình quan hệ' }), 201);
  const dbL1 = expectStatus(await api('POST', `/chapters/${dbCh.id}/lessons`, GV2, { title: 'Bài 1: Thiết kế bảng & Khóa ngoại', duration_minutes: 90 }), 201);
  expectStatus(await api('PUT', `/lessons/${dbL1.id}/content`, GV2, {
    base_revision: 1,
    blocks: [{ block_type: 'paragraph', content: { text: 'Nội dung mô hình quan hệ 3NF.' } }],
  }), 200);
  expectStatus(await api('POST', `/lessons/${dbL1.id}/publish`, GV2, {}), 200);

  // Lưu training-profile cho PY101 & DB201
  const prof = expectStatus(await api('PUT', `/courses/${py101Id}/training-profile`, GV1, {
    outcomes: [
      'Viết được hàm tái sử dụng và module Python chuẩn',
      'Xử lý ngoại lệ an toàn với try/except/finally',
      'Đọc ghi dữ liệu tệp CSV/JSON thực tế',
    ],
    reference_tuition_fee: 3500000,
    theory_periods: 12,
    practice_periods: 18,
    self_study_periods: 15,
    minutes_per_period: 45,
    required_room_type: 'COMPUTER_LAB',
    grading_scale: 'SCALE_10',
    pass_score: 5.5,
    exam_conditions: { min_attendance_pct: 75, require_mandatory_assignments: true },
  }), 200);

  assert.equal(prof.course.outcomes.length, 3);
  assert.equal(prof.course.required_room_type, 'COMPUTER_LAB');
  assert.equal(prof.course.reference_tuition_fee, 3500000);
  assert.equal(prof.course.theory_periods + prof.course.practice_periods, 30);

  expectStatus(await api('PUT', `/courses/${db201Id}/training-profile`, GV2, {
    outcomes: ['Thiết kế ERD chuẩn 3NF', 'Viết truy vấn JOIN/GROUP BY tối ưu'],
    reference_tuition_fee: 3000000,
    theory_periods: 10,
    practice_periods: 10,
    self_study_periods: 10,
    required_room_type: 'THEORY_ROOM',
  }), 200);
});

await t('1.1-PREREQ-ASSESS', 'Tiên quyết chống chu trình DAG (422) & Đầu điểm kiểm tra tổng = 100%', async () => {
  // DB201 yêu cầu học xong PY101 -> Hợp lệ
  expectStatus(await api('PUT', `/courses/${db201Id}/prerequisites`, ADMIN, {
    prerequisite_course_ids: [py101Id],
  }), 200);

  // PY101 lại yêu cầu ngược DB201 -> Bắt buộc chặn chu trình DAG 422!
  expectStatus(await api('PUT', `/courses/${py101Id}/prerequisites`, ADMIN, {
    prerequisite_course_ids: [db201Id],
  }), 422, 'PREREQUISITE_CYCLE_DETECTED');

  // Đầu điểm tổng 90% -> Bị từ chối 422
  expectStatus(await api('PUT', `/courses/${py101Id}/assessment-components`, GV1, {
    items: [
      { code: 'CC', title: 'Chuyên cần', weight_pct: 10, source_type: 'ATTENDANCE' },
      { code: 'BT', title: 'Bài tập thực hành', weight_pct: 80, source_type: 'ASSIGNMENT' },
    ],
  }), 422, 'ASSESSMENT_WEIGHT_SUM_INVALID');

  // Đầu điểm tổng 100% -> Lưu thành công
  const saved = expectStatus(await api('PUT', `/courses/${py101Id}/assessment-components`, GV1, {
    items: [
      { code: 'CC', title: 'Chuyên cần', weight_pct: 10, source_type: 'ATTENDANCE' },
      { code: 'BT', title: 'Bài tập', weight_pct: 30, source_type: 'ASSIGNMENT' },
      { code: 'GK', title: 'Kiểm tra giữa kỳ', weight_pct: 20, source_type: 'EXAM_MATRIX' },
      { code: 'DA', title: 'Dự án cuối môn', weight_pct: 40, source_type: 'MANUAL' },
    ],
  }), 200);
  assert.equal(saved.weight_sum_pct, 100);
  assert.equal(saved.items.length, 4);
});

await t('1.1-SYLLABUS-LIFECYCLE', 'Đề cương môn học gắn Tài liệu Bắt buộc/Tham khảo, Bài tập hạn nộp tương đối & Ban hành v2026.1 -> v2026.2 + Diff', async () => {
  // Thêm tài liệu Bắt buộc & Tham khảo vào Bài 1
  const resMand = expectStatus(await api('POST', '/banks/resources', GV1, {
    lesson_id: pyLesson1Id,
    title: 'Giáo trình Python Chính khóa',
    url: 'https://docs.python.org/3/tutorial/index.html',
    usage_type: 'MANDATORY',
    tags: ['Chính quy'],
  }), 201);
  const resRef = expectStatus(await api('POST', '/banks/resources', GV1, {
    lesson_id: pyLesson1Id,
    title: 'PEP 8 Style Guide đọc thêm',
    url: 'https://peps.python.org/pep-0008/',
    usage_type: 'REFERENCE',
    tags: ['Đọc thêm'],
  }), 201);
  assert.equal(resMand.usage_type, 'MANDATORY');
  assert.equal(resRef.usage_type, 'REFERENCE');

  // Thêm bài tập mẫu có hạn nộp tương đối 5 ngày sau buổi học Bài 1
  const asg = expectStatus(await api('POST', '/banks/assignments', GV1, {
    lesson_id: pyLesson1Id,
    title: 'Bài tập Lab 1: Viết hàm tính thuế TNCN',
    instructions: 'Nộp file tax_calc.py xử lý đầy đủ ngoại lệ.',
    max_score: 10,
    relative_due_days: 5,
    is_mandatory: true,
  }), 201);
  assert.equal(asg.relative_due_days, 5);

  const syl = expectStatus(await api('GET', `/courses/${py101Id}/syllabus`, GV1), 200);
  const leafLesson = syl.tree[0].chapters[0].lessons.find((l) => l.id === pyLesson1Id);
  assert.equal(leafLesson.resources.length, 2);
  assert.equal(leafLesson.assignments.length, 1);

  // Ban hành v2026.1 cho cả PY101 & DB201
  expectStatus(await api('POST', `/courses/${py101Id}/lifecycle`, GV1, { action: 'SUBMIT_REVIEW' }), 200);
  const pub1 = expectStatus(await api('POST', `/courses/${py101Id}/lifecycle`, ADMIN, { action: 'APPROVE_PUBLISH', version_label: 'v2026.1' }), 200);
  assert.equal(pub1.lifecycle_status, 'PUBLISHED');

  expectStatus(await api('POST', `/courses/${db201Id}/lifecycle`, ADMIN, { action: 'APPROVE_PUBLISH', version_label: 'v2026.1' }), 200);

  // Tạo phiên bản mới v2026.2 cho PY101, tăng học phí tham khảo & thời lượng thực hành, ban hành và kiểm tra Diff
  const nextVer = expectStatus(await api('POST', `/courses/${py101Id}/lifecycle`, GV1, { action: 'START_NEW_VERSION' }), 200);
  assert.equal(nextVer.version_code, 'v2026.2');
  expectStatus(await api('PUT', `/courses/${py101Id}/training-profile`, GV1, {
    practice_periods: 22,
    reference_tuition_fee: 4000000,
  }), 200);
  const pub2 = expectStatus(await api('POST', `/courses/${py101Id}/lifecycle`, ADMIN, { action: 'APPROVE_PUBLISH', version_label: 'v2026.2' }), 200);

  const cmp = expectStatus(await api('GET', `/courses/${py101Id}/versions/compare?from_id=${pub1.version_id}&to_id=${pub2.version_id}`, GV1), 200);
  assert.equal(cmp.diff.duration_before.practice, 18);
  assert.equal(cmp.diff.duration_after.practice, 22);
  assert.equal(cmp.diff.tuition_before, 3500000);
  assert.equal(cmp.diff.tuition_after, 4000000);
});

// ----------------------------------------------------------------------
// 1.2 KHUNG CHƯƠNG TRÌNH
// ----------------------------------------------------------------------
await t('1.2-CURRICULUM', 'Khung chương trình: Phí dịch vụ + Học phí tự động/ghi đè, Giai đoạn, Cảnh báo ngược thứ tự tiên quyết, Chia buổi & Chặn mở lớp khi DRAFT', async () => {
  const curr = expectStatus(await api('POST', '/curricula', ADMIN, {
    code: 'FS-2026',
    title: 'Lập trình viên Fullstack Chuyên nghiệp',
    description: 'Đào tạo thực chiến Python & Database.',
    status: 'DRAFT',
  }), 201);
  fsCurrId = curr.id;

  // Thử mở lớp ngay khi Khung đang DRAFT -> Bắt buộc bị chặn 422 CURRICULUM_NOT_PUBLISHED!
  expectStatus(await api('POST', '/cohorts', ADMIN, {
    curriculum_id: fsCurrId,
    code: 'FS-BLOCKED',
    title: 'Khóa bị chặn do khung chưa ban hành',
  }), 422, 'CURRICULUM_NOT_PUBLISHED');

  // Tạo 2 giai đoạn: Đại cương -> Chuyên ngành
  const stgRes = expectStatus(await api('PUT', `/curricula/${fsCurrId}/stages`, ADMIN, {
    items: [
      { code: 'GD1', title: 'Giai đoạn 1: Đại cương lập trình', stage_type: 'PHASE' },
      { code: 'GD2', title: 'Giai đoạn 2: Chuyên ngành CSDL', stage_type: 'PHASE' },
    ],
  }), 200);
  const [stage1, stage2] = stgRes.stages;

  // Đưa DB201 và PY101 vào khung, cố tình xếp DB201 ở GD1 trước PY101 ở GD2 để kiểm tra cảnh báo tiên quyết!
  const subDb = expectStatus(await api('POST', `/curricula/${fsCurrId}/subjects`, ADMIN, { course_id: db201Id, semester_order: 1, planned_periods: 20 }), 201);
  const subPy = expectStatus(await api('POST', `/curricula/${fsCurrId}/subjects`, ADMIN, { course_id: py101Id, semester_order: 2, planned_periods: 34 }), 201);

  const wrongOrder = expectStatus(await api('PUT', `/curricula/${fsCurrId}/structure`, ADMIN, {
    items: [
      { id: subDb.id, stage_id: stage1.id, semester_order: 1, sort_order: 10, planned_periods: 20, is_mandatory: true, prerequisite_course_ids: [py101Id] },
      { id: subPy.id, stage_id: stage2.id, semester_order: 2, sort_order: 20, planned_periods: 34, is_mandatory: true, prerequisite_course_ids: [] },
    ],
  }), 200);
  assert.ok(
    wrongOrder.prerequisite_warnings.some((w) => w.type === 'PREREQUISITE_ORDER_VIOLATION'),
    'Phải cảnh báo khi môn tiên quyết PY101 xếp sau môn phụ thuộc DB201'
  );

  // Sửa lại đúng thứ tự: PY101 ở GD1 -> DB201 ở GD2 -> hết cảnh báo!
  const fixedOrder = expectStatus(await api('PUT', `/curricula/${fsCurrId}/structure`, ADMIN, {
    items: [
      { id: subPy.id, stage_id: stage1.id, semester_order: 1, sort_order: 10, planned_periods: 34, is_mandatory: true, prerequisite_course_ids: [] },
      { id: subDb.id, stage_id: stage2.id, semester_order: 2, sort_order: 20, planned_periods: 20, is_mandatory: true, prerequisite_course_ids: [py101Id] },
    ],
  }), 200);
  assert.equal(fixedOrder.prerequisite_warnings.length, 0);

  // Phí dịch vụ kèm theo + Học phí tự động cộng (4.000.000 + 3.000.000 + 500.000 = 7.500.000)
  const feeRes = expectStatus(await api('PUT', `/curricula/${fsCurrId}/service-fees`, ADMIN, {
    items: [
      { code: 'HOC-LIEU', title: 'Phí giáo trình & tài khoản Lab', amount: 500000, is_mandatory: true },
      { code: 'AO-KHOA', title: 'Đồng phục tùy chọn', amount: 200000, is_mandatory: false },
    ],
  }), 200);
  assert.equal(feeRes.totals.auto_tuition_fee, 7500000);
  assert.equal(feeRes.totals.final_tuition_fee, 7500000);

  // Cho phép chỉnh sửa ghi đè học phí trọn gói ưu đãi 6.900.000 + cấu hình Điều kiện tốt nghiệp
  const bpUpdated = expectStatus(await api('PUT', `/curricula/${fsCurrId}/blueprint`, ADMIN, {
    program_type: 'INSTRUCTOR_LED',
    delivery_mode: 'OFFLINE',
    standard_duration_months: 6,
    standard_duration_text: '6 tháng (54 tiết)',
    target_audience: 'Sinh viên CNTT hoặc người chuyển ngành',
    entry_requirements: 'Sử dụng máy tính thành thạo',
    is_tuition_overridden: true,
    final_tuition_fee: 6900000,
    graduation_criteria: {
      require_all_mandatory: true,
      min_elective_courses: 0,
      min_gpa: 6.5,
      min_attendance_pct: 80,
      extra_conditions: ['Hoàn thành dự án cuối khóa Fullstack'],
      certificate_template_id: 'cert_tpl_k5',
    },
  }), 200);
  assert.equal(bpUpdated.totals.auto_tuition_fee, 7500000);
  assert.equal(bpUpdated.totals.final_tuition_fee, 6900000);

  // Chia buổi tự động 1 buổi = 1 bài học cho PY101 (2 bài -> 2 buổi), rồi gộp/tùy chỉnh
  const autoPlan = expectStatus(await api('POST', `/curricula/${fsCurrId}/session-plans/${py101Id}/auto-generate`, ADMIN, {}), 200);
  assert.equal(autoPlan.items.length, 2);

  // Ban hành Khung chương trình FS-2026
  expectStatus(await api('POST', `/curricula/${fsCurrId}/lifecycle`, ADMIN, { action: 'SUBMIT_REVIEW' }), 200);
  const pubCurr = expectStatus(await api('POST', `/curricula/${fsCurrId}/lifecycle`, ADMIN, {
    action: 'APPROVE_PUBLISH',
    version_label: 'v2026.1',
  }), 200);
  assert.equal(pubCurr.lifecycle_status, 'PUBLISHED');
});

// ----------------------------------------------------------------------
// 1.3 KHỞI TẠO KHÓA HỌC 5 BƯỚC & QUY ĐỔI HẠN NỘP TƯƠNG ĐỐI
// ----------------------------------------------------------------------
await t('1.3-COHORT-INIT', 'Wizard mở Khóa học 5 bước: Tạo lớp môn, sao chép bài tập hạn nộp tương đối, sinh buổi nháp gắn bài học', async () => {
  const initRes = expectStatus(await api('POST', '/training/cohorts/initialize', ADMIN, {
    curriculum_id: fsCurrId,
    code: 'FS-K01',
    title: 'Khóa Fullstack K01 (Tối 2-4-6)',
    start_date: '2026-12-07',
    end_date: '2027-05-30',
    max_students: 25,
    campus_id: 'cp_cs1',
    publish_schedule: false,
    student_identifiers: ['HS50101'],
    class_configs: {
      [py101Id]: {
        instructor_id: gv1User.id,
        required_room_type: 'COMPUTER_LAB',
        quick_schedule: {
          enabled: true,
          recurrence_mode: 'WEEKLY',
          weekdays: [1, 3], // Thứ 2 & Thứ 4
          start_time: '18:00',
          end_time: '19:30',
        },
      },
      [db201Id]: {
        instructor_id: gv2User.id,
        required_room_type: 'THEORY_ROOM',
        quick_schedule: { enabled: false },
      },
    },
  }), 201);

  fsCohortId = initRes.cohort_id;
  assert.equal(initRes.classes.length, 2);
  assert.ok(initRes.assignments_copied >= 1, 'Phải sao chép bài tập từ ngân hàng của phiên bản đang ban hành');
  assert.equal(initRes.assignments_due_resolved, 0, 'Chưa công bố TKB thì due_at chưa chốt cứng');

  pyClassId = initRes.classes.find((c) => c.course_id === py101Id).id;
  dbClassId = initRes.classes.find((c) => c.course_id === db201Id).id;

  // Học viên HS50101 chưa thấy buổi DRAFT trên /learn trước khi Công bố TKB
  const learnBeforePub = expectStatus(await api('GET', `/learn/classes/${pyClassId}`, HS1), 200);
  assert.equal(learnBeforePub.upcoming_sessions.length, 0, 'Buổi DRAFT chưa công bố không được lộ sang học viên');
});

// ----------------------------------------------------------------------
// 2.1 THỜI KHÓA BIỂU, 6 RÀNG BUỘC CỨNG, CÔNG BỐ & ĐIỀU CHỈNH
// ----------------------------------------------------------------------
await t('2.1-TIMETABLE-CONSTRAINTS', 'Kiểm tra đủ 6 Ràng buộc cứng xếp lịch + Gợi ý ô xanh/đỏ kéo thả + Công bố TKB chốt hạn nộp bài tập', async () => {
  const grid = expectStatus(await api('GET', `/timetable/grid?from=2026-12-01&to=2026-12-31&cohort_id=${fsCohortId}`, ADMIN), 200);
  const pySessions = grid.items.filter((s) => s.class_id === pyClassId);
  assert.equal(pySessions.length, 2);
  const ses1 = pySessions[0];

  // 1) Ràng buộc Ngày nghỉ lễ (01/01/2027 là Tết Dương lịch trong seed)
  expectStatus(await api('POST', `/timetable/sessions/${ses1.id}/move`, ADMIN, {
    date: '2027-01-01',
    start_time: '08:00',
    end_time: '09:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_lab201',
  }), 422, 'SCHEDULE_CONFLICT');

  // 2) Ràng buộc Ngoài khung giờ hoạt động cơ sở (22:00 - 23:30 > 21:30 đóng cửa)
  expectStatus(await api('POST', `/timetable/sessions/${ses1.id}/move`, ADMIN, {
    date: '2026-12-08',
    start_time: '22:00',
    end_time: '23:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_lab201',
  }), 422, 'SCHEDULE_CONFLICT');

  // 3) Ràng buộc Sai loại phòng (PY101 yêu cầu COMPUTER_LAB nhưng xếp vào phòng lý thuyết rm_5a1)
  expectStatus(await api('POST', `/timetable/sessions/${ses1.id}/move`, ADMIN, {
    date: '2026-12-08',
    start_time: '08:00',
    end_time: '09:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_5a1',
  }), 422, 'SCHEDULE_CONFLICT');

  // 4) Ràng buộc Vượt sức chứa phòng (Tạo phòng Lab nhỏ sức chứa 10 < sĩ số tối đa 25)
  const tinyLab = expectStatus(await api('POST', '/facilities/classrooms', ADMIN, {
    campus_id: 'cp_cs1',
    code: 'LAB-MINI',
    name: 'Phòng Lab Mini 10 máy',
    room_type: 'COMPUTER_LAB',
    capacity: 10,
  }), 201);
  expectStatus(await api('POST', `/timetable/sessions/${ses1.id}/move`, ADMIN, {
    date: '2026-12-08',
    start_time: '08:00',
    end_time: '09:30',
    campus_id: 'cp_cs1',
    classroom_id: tinyLab.id,
  }), 422, 'SCHEDULE_CONFLICT');

  // 5) Ràng buộc Lịch bận giảng viên (GV1 tự đăng ký bận tối Thứ 6 18:00-21:00 qua API)
  expectStatus(await api('POST', '/facilities/instructor-availabilities', GV1, {
    rule_type: 'WEEKLY',
    weekday: 5,
    start_time: '18:00',
    end_time: '21:00',
    status: 'BUSY',
    note: 'Họp hội đồng chuyên môn tối Thứ 6',
  }), 201);
  expectStatus(await api('POST', `/timetable/sessions/${ses1.id}/move`, ADMIN, {
    date: '2026-12-11', // Thứ 6
    start_time: '18:00',
    end_time: '19:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_lab201',
  }), 422, 'SCHEDULE_CONFLICT');

  // 6) Ràng buộc Thời gian di chuyển liên cơ sở (CS1 <-> CS2 cần 45 phút di chuyển)
  // ses1 đang ở CS1 ngày 2026-12-07 18:00-19:30. Tạo 1 lớp khác của GV1 ở CS2 lúc 19:45-21:00 cùng ngày -> cách nhau 15 phút < 45 phút -> Bị chặn!
  const cs2Lab = expectStatus(await api('POST', '/facilities/classrooms', ADMIN, {
    campus_id: 'cp_cs2',
    code: 'LAB-CS2',
    name: 'Phòng Lab Đống Đa',
    room_type: 'COMPUTER_LAB',
    capacity: 35,
  }), 201);
  const unscheduledDb = grid.unscheduled_items.find((u) => u.class_id === dbClassId);
  assert.ok(unscheduledDb, 'DB201 có buổi chờ xếp trong khay UNSCHEDULED');
  // Thử gán GV1 dạy buổi DB201 chưa được phân công (không bật allow_substitute) -> chặn INSTRUCTOR_NOT_ASSIGNED!
  expectStatus(await api('POST', `/timetable/sessions/${unscheduledDb.id}/move`, ADMIN, {
    date: '2026-12-10',
    start_time: '08:00',
    end_time: '09:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_5a1',
    instructor_id: gv1User.id,
  }), 422, 'SCHEDULE_CONFLICT');

  // Nếu bật is_substitute = true nhưng giờ 19:45-21:00 ngày 2026-12-07 ở CS2 (cách buổi CS1 15 phút < 45p travel buffer) -> chặn INSTRUCTOR_TRAVEL_CONFLICT!
  const travelErr = await api('POST', `/timetable/sessions/${unscheduledDb.id}/move`, ADMIN, {
    date: '2026-12-07',
    start_time: '19:45',
    end_time: '21:00',
    campus_id: 'cp_cs2',
    classroom_id: 'rm_cs2_301',
    instructor_id: gv1User.id,
    is_substitute: true,
  });
  assert.equal(travelErr.status, 422);
  assert.ok(
    travelErr.body?.detail?.conflicts?.some((c) => c.code === 'INSTRUCTOR_TRAVEL_CONFLICT' || c.code === 'COHORT_CONFLICT'),
    `Phải phát hiện xung đột di chuyển liên cơ sở / khóa học: ${JSON.stringify(travelErr.body)}`
  );

  // Kéo thả hợp lệ cho DB201 bằng slot-hints & auto-schedule
  const hints = expectStatus(await api('POST', '/timetable/slot-hints', ADMIN, {
    session_id: unscheduledDb.id,
    week_start: '2026-12-07',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_5a1',
  }), 200);
  assert.ok(hints.slots.some((s) => s.valid === true), 'slot-hints trả về các ô xanh hợp lệ');
  assert.ok(hints.slots.some((s) => s.valid === false), 'slot-hints trả về các ô đỏ xung đột');

  const autoSched = expectStatus(await api('POST', '/timetable/auto-schedule', ADMIN, {
    cohort_id: fsCohortId,
    from_date: '2026-12-08',
    to_date: '2026-12-28',
    campus_id: 'cp_cs1',
  }), 200);
  assert.ok(autoSched.draft_placed_count >= 1, 'Xếp tự động sinh bản nháp cho buổi chưa xếp');

  // Công bố Thời khóa biểu -> Mở hiển thị cho học viên + Quy đổi hạn nộp tương đối của bài tập ra ngày cụ thể!
  const pubTkb = expectStatus(await api('POST', '/timetable/publish', ADMIN, {
    cohort_id: fsCohortId,
  }), 200);
  assert.ok(pubTkb.published_sessions >= 3);
  assert.ok(pubTkb.assignments_due_resolved >= 1, 'Công bố TKB phải quy đổi hạn nộp tương đối ra ngày cụ thể');

  const asgRow = db.prepare('SELECT due_at, status FROM class_assignments WHERE subject_class_id = ? LIMIT 1').get(pyClassId);
  assert.ok(asgRow.due_at && asgRow.due_at.startsWith('2026-12-12'), `Bài tập hạn 5 ngày sau buổi 07/12 phải có due_at 2026-12-12, nhận: ${asgRow.due_at}`);
  assert.equal(asgRow.status, 'PUBLISHED');

  // Bây giờ học viên HS50101 đã thấy lịch học trên /learn!
  const learnAfterPub = expectStatus(await api('GET', `/learn/classes/${pyClassId}`, HS1), 200);
  assert.ok(learnAfterPub.upcoming_sessions.length >= 2);

  // Điều chỉnh trong quá trình học: Báo nghỉ buổi 2 & tạo buổi dạy bù + Đổi GV dạy thay
  const adjMakeup = expectStatus(await api('POST', `/timetable/sessions/${pySessions[1].id}/adjust`, ADMIN, {
    action: 'CANCEL_AND_MAKEUP',
    reason: 'Giảng viên đi công tác đột xuất',
    makeup_date: '2026-12-16',
    makeup_start_time: '18:00',
    makeup_end_time: '19:30',
    campus_id: 'cp_cs1',
    classroom_id: 'rm_lab201',
    substitute_instructor_id: gv2User.id,
  }), 200);
  assert.ok(adjMakeup.makeup_session_id, 'Phải tạo thành công buổi dạy bù');
});

// ----------------------------------------------------------------------
// 2.2 THỐNG KÊ GIỜ DẠY & CHỐT CÔNG 4 BƯỚC CHUYỂN TÀI CHÍNH
// ----------------------------------------------------------------------
await t('2.2-TEACHING-HOURS', 'Tự mở buổi đến giờ, ghi nhận dạy thay, định mức/vượt định mức, cô lập RBAC & Chốt công 4 bước khóa sổ', async () => {
  // Tạo 2 buổi học trong quá khứ (tháng 2026-10) cho lớp PY101 để kiểm thử đầy đủ vòng đời xác nhận & chốt tháng
  const pastSes1 = 'ses_past_oct_01';
  const pastSes2 = 'ses_past_oct_02';
  db.prepare(
    `INSERT INTO sessions (
       session_id, subject_class_id, subject_class_code, subject_title, session_title,
       scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at, confirmation_deadline_at,
       scheduled_instructor_id, scheduled_instructor_name, actual_instructor_name,
       campus_id, classroom_id, schedule_state, planned_periods, hour_category,
       session_status, live_status, confirmation_status, delivery_mode
     ) VALUES (?, ?, 'FS-K01-PY101', 'Python', 'Buổi thực nghiệm tháng 10 #1',
       '2026-10-12T18:00:00+07:00', '2026-10-12T20:15:00+07:00', '2026-10-12T18:00:00+07:00', '2026-10-12T20:15:00+07:00', '2026-10-13T20:15:00+07:00',
       ?, ?, '', 'cp_cs1', 'rm_lab201', 'PUBLISHED', 3, 'PRACTICE', 'SCHEDULED', 'NOT_STARTED', 'CONFIRMED', 'OFFLINE')`
  ).run(pastSes1, pyClassId, gv1User.id, gv1User.full_name);

  db.prepare(
    `INSERT INTO sessions (
       session_id, subject_class_id, subject_class_code, subject_title, session_title,
       scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at, confirmation_deadline_at,
       scheduled_instructor_id, scheduled_instructor_name, actual_instructor_name,
       campus_id, classroom_id, schedule_state, planned_periods, hour_category,
       session_status, live_status, confirmation_status, delivery_mode
     ) VALUES (?, ?, 'FS-K01-PY101', 'Python', 'Buổi thực nghiệm tháng 10 #2 (Dạy thay)',
       '2026-10-14T18:00:00+07:00', '2026-10-14T19:30:00+07:00', '2026-10-14T18:00:00+07:00', '2026-10-14T19:30:00+07:00', '2026-10-15T19:30:00+07:00',
       ?, ?, '', 'cp_cs1', 'rm_lab201', 'PUBLISHED', 2, 'PRACTICE', 'SCHEDULED', 'NOT_STARTED', 'CONFIRMED', 'OFFLINE')`
  ).run(pastSes2, pyClassId, gv1User.id, gv1User.full_name);

  // Ghi nhận buổi #2 do GV2 dạy thay GV1
  const recSub = expectStatus(await api('PATCH', `/teaching-hours/sessions/${pastSes2}/record`, ADMIN, {
    actual_instructor_id: gv2User.id,
    substitute_reason: 'Thầy Khoa dạy thay Cô Hà buổi Lab',
    actual_periods: 2,
    hour_category: 'PRACTICE',
  }), 200);
  assert.equal(recSub.is_substitute_teaching, true);
  assert.equal(recSub.actual_instructor_id, gv2User.id);

  // Đặt định mức thấp (1.5 giờ) cho GV1 trong kỳ 2026-10 để kiểm tra tính giờ vượt định mức (overtime_hours)
  expectStatus(await api('PUT', '/teaching-hours/quotas', ADMIN, {
    instructor_id: gv1User.id,
    period_key: '2026-10',
    standard_periods: 2,
    standard_hours: 1.5,
  }), 200);

  // Cô lập RBAC: GV1 xem giờ của chính mình -> 200; GV1 cố xem giờ của GV2 -> 403!
  expectStatus(await api('GET', `/teaching-hours/analytics?period_month=2026-10&instructor_id=${gv2User.id}`, GV1), 403, 'INSTRUCTOR_SCOPE_FORBIDDEN');
  const gv1Stats = expectStatus(await api('GET', '/teaching-hours/analytics?period_month=2026-10', GV1), 200);
  const mySummary = gv1Stats.by_instructor[0];
  assert.equal(mySummary.instructor_id, gv1User.id);
  assert.ok(mySummary.overtime_hours > 0, `GV1 dạy > 1.5h phải có giờ vượt định mức, nhận: ${mySummary.overtime_hours}`);
  assert.ok(mySummary.substituted_out_sessions >= 1, 'GV1 phải ghi nhận 1 buổi được dạy thay');

  // GV2 xem giờ của mình -> thấy 1 buổi dạy thay (substitute_sessions >= 1)
  const gv2Stats = expectStatus(await api('GET', '/teaching-hours/analytics?period_month=2026-10', GV2), 200);
  assert.ok(gv2Stats.by_instructor[0].substitute_sessions >= 1, 'GV2 phải được cộng giờ buổi dạy thay');

  // Chốt giờ dạy 4 bước cho kỳ 2026-10:
  // Bước 1: Giáo vụ/Admin tổng hợp bảng giờ giảng
  const gen = expectStatus(await api('POST', '/teaching-hours/timesheets/generate', ADMIN, {
    period_month: '2026-10',
  }), 201);
  assert.ok(gen.generated_count >= 2);
  const sheetGv1 = gen.items.find((x) => x.instructor_id === gv1User.id);
  assert.equal(sheetGv1.status, 'PENDING_TEACHER');

  // Bước 2a: GV1 phản hồi sai sót -> DISPUTED -> Giáo vụ chưa được duyệt nếu chưa xác nhận!
  expectStatus(await api('POST', `/teaching-hours/timesheets/${sheetGv1.id}/teacher-review`, GV1, {
    decision: 'DISPUTE',
    teacher_note: 'Nhờ giáo vụ kiểm tra lại phụ cấp phòng máy buổi 12/10.',
  }), 200);
  expectStatus(await api('POST', `/teaching-hours/timesheets/${sheetGv1.id}/approve`, ADMIN, {}), 422, 'TEACHER_CONFIRMATION_REQUIRED');

  // Bước 2b: Giáo vụ tổng hợp lại & GV1 xác nhận -> TEACHER_CONFIRMED
  expectStatus(await api('POST', '/teaching-hours/timesheets/generate', ADMIN, {
    period_month: '2026-10',
    instructor_id: gv1User.id,
    review_note: 'Đã rà soát đầy đủ loại giờ Thực hành phòng máy.',
  }), 201);
  const confirmedSheet = expectStatus(await api('POST', `/teaching-hours/timesheets/${sheetGv1.id}/teacher-review`, GV1, {
    decision: 'CONFIRM',
    teacher_note: 'Số liệu chính xác, đồng ý chốt.',
  }), 200);
  assert.equal(confirmedSheet.status, 'TEACHER_CONFIRMED');

  // Bước 3: Trưởng bộ môn / Giáo vụ duyệt -> APPROVED
  const approvedSheet = expectStatus(await api('POST', `/teaching-hours/timesheets/${sheetGv1.id}/approve`, ADMIN, {
    review_note: 'Duyệt chuyển Tài chính tháng 10/2026.',
  }), 200);
  assert.equal(approvedSheet.status, 'APPROVED');

  // Bước 4: Khóa sổ -> LOCKED + Gán mã lô Tài chính + Chặn chỉnh sửa ngược buổi học đã khóa (409)!
  const lockedSheet = expectStatus(await api('POST', `/teaching-hours/timesheets/${sheetGv1.id}/lock`, ADMIN, {}), 200);
  assert.equal(lockedSheet.status, 'LOCKED');
  assert.ok(lockedSheet.finance_batch_code.startsWith('FIN-202610-'));

  expectStatus(await api('PATCH', `/teaching-hours/sessions/${pastSes1}/record`, ADMIN, {
    actual_periods: 5,
  }), 409, 'SESSION_TIMESHEET_LOCKED');

  expectStatus(await api('POST', `/timetable/sessions/${pastSes1}/move`, ADMIN, {
    date: '2026-10-20',
    start_time: '18:00',
    end_time: '20:00',
  }), 409, 'SESSION_TIMESHEET_LOCKED');

  // Xuất gói dữ liệu chuyển Tài chính (JSON & CSV)
  const finJson = expectStatus(await api('GET', '/teaching-hours/timesheets/export-finance?period_month=2026-10&format=json', ADMIN), 200);
  assert.ok(finJson.records_count >= 1);
  const finCsv = await api('GET', '/teaching-hours/timesheets/export-finance?period_month=2026-10&format=csv', ADMIN);
  assert.equal(finCsv.status, 200);
});

console.log('----------------------------------------------------------------------');
console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exit(1);
