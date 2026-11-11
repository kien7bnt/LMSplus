#!/usr/bin/env node
/**
 * LMSPLUS — Kiểm thử tích hợp module Giảng dạy (khóa học, bài học + YouTube, lớp học, điểm danh, bảo mật).
 * Chạy trên CSDL SQLite tạm (tests/.tmp), không ảnh hưởng dữ liệu phát triển.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `teaching-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-teaching-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { initSchemaAndSeed, invokeApi, invokeApiAsync, db } = await import('../backend/server_fallback.mjs');
const { parseYouTubeUrl } = await import('../shared/youtube.mjs');
const { insertClassSession, vnIso, vnDate } = await import('../backend/teaching/schema.mjs');

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
  }
}

const login = (identifier) => {
  const r = invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier, password: '123456' });
  assert.equal(r.status, 200, `login ${identifier}`);
  return { authorization: `Bearer ${r.body.data.access_token}` };
};
const T = '/api/v1/teaching';
const api = (method, url, who, body) => invokeApi(method, `${T}${url}`, who, body);
const expectStatus = (r, status, code) => {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  if (code) assert.equal(r.body.detail?.code, code);
  return r.body.data;
};

const GV = login('thuha.gv@lmsplus.edu.vn'); // Giảng viên lớp 5A1
const GV2 = login('vankhoa.gv@lmsplus.edu.vn'); // Giảng viên lớp 5A2
const TA = login('minhquan.tg@lmsplus.edu.vn'); // Trợ giảng 5A1 (được điểm danh)
const STAFF = login('giaovu@lmsplus.edu.vn'); // Giáo vụ khối 5
const ADMIN = login('admin@lmsplus.edu.vn');
const HS1 = login('HS50101'); // Học sinh 5A1
const HS2A2 = login('HS50201'); // Học sinh 5A2
const hs1Id = db.prepare("SELECT id FROM users WHERE code = 'HS50101'").get().id;

console.log('======================================================================');
console.log(' LMSPLUS — TEACHING MODULE INTEGRATION TEST SUITE');
console.log('======================================================================');

// ---------------------------------------------------------------- YouTube parser
await t('YOUTUBE', 'Hỗ trợ 4 định dạng URL và tạo URL nhúng youtube-nocookie', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'youtube.com/watch?v=dQw4w9WgXcQ&list=PL1',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ]) {
    const r = parseYouTubeUrl(u);
    assert.ok(r.ok, u);
    assert.equal(r.videoId, 'dQw4w9WgXcQ');
    assert.ok(r.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  }
  assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s').startSeconds, 90);
});

await t('YOUTUBE', 'Từ chối domain giả mạo, giao thức nguy hiểm và Video ID sai', () => {
  for (const [u, code] of [
    ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'DOMAIN_NOT_ALLOWED'],
    ['https://evil.com/embed/dQw4w9WgXcQ', 'DOMAIN_NOT_ALLOWED'],
    ['javascript:alert(1)', 'INVALID_URL'],
    ['https://www.youtube.com/watch?v=short', 'INVALID_VIDEO_ID'],
    ['https://www.youtube.com/watch?v=<script>xx', 'INVALID_VIDEO_ID'],
    ['https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ', 'INVALID_URL'],
    ['', 'EMPTY_URL'],
  ]) {
    const r = parseYouTubeUrl(u);
    assert.equal(r.ok, false, u);
    assert.equal(r.error, code, u);
  }
});

await t('YOUTUBE', 'API /youtube/validate trả về embed_url chuẩn hóa và báo lỗi domain', async () => {
  const ok = await invokeApiAsync('POST', `${T}/youtube/validate`, GV, { url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.video_id, 'dQw4w9WgXcQ');
  const bad = await invokeApiAsync('POST', `${T}/youtube/validate`, GV, { url: 'https://vimeo.com/123' });
  expectStatus(bad, 422, 'DOMAIN_NOT_ALLOWED');
});

// ---------------------------------------------------------------- Course flow
let courseId;
let chapterId;
let lessonId;
let resLinkId;
let resFileId;
let revision;

await t('COURSE', 'Giảng viên xem danh sách khóa học trong phạm vi', () => {
  const d = expectStatus(api('GET', '/courses', GV), 200);
  assert.ok(d.items.some((c) => c.code === 'TOAN5-2026'));
  assert.ok(d.items.every((c) => typeof c.lessons_count === 'number'));
});

await t('COURSE', 'Kiểm tra dữ liệu khi tạo khóa học (thiếu tên 422, trùng mã 409)', () => {
  expectStatus(api('POST', '/courses', GV, { code: 'X1' }), 422, 'VALIDATION_ERROR');
  expectStatus(api('POST', '/courses', GV, { code: 'TOAN5-2026', title: 'Trùng mã' }), 409, 'COURSE_CODE_EXISTS');
  expectStatus(api('POST', '/courses', GV, { code: 'OK-1', title: 'Ảnh http', thumbnail_url: 'http://x.com/a.png' }), 422);
});

await t('COURSE', 'Giảng viên tạo khóa học (mặc định Bản nháp, tự là người phụ trách)', () => {
  const d = expectStatus(api('POST', '/courses', GV, {
    code: 'toan5-nangcao', title: 'Toán 5 nâng cao', subject: 'Toán', description: 'Bồi dưỡng học sinh giỏi',
    objectives: 'Giải toán có lời văn', target_audience: 'Học sinh lớp 5',
  }), 201);
  courseId = d.id;
  assert.equal(d.code, 'TOAN5-NANGCAO');
  assert.equal(d.status, 'DRAFT');
  assert.equal(d.instructor_name, 'Cô Lê Thu Hà');
});

await t('COURSE', 'Học viên không được tạo khóa học (403)', () => {
  expectStatus(api('POST', '/courses', HS1, { code: 'HS-1', title: 'Khóa của học sinh' }), 403, 'COURSE_CREATE_FORBIDDEN');
});

await t('CURRICULUM', 'Thêm chương và bài học (bài mới ở trạng thái Bản nháp)', () => {
  chapterId = expectStatus(api('POST', `/courses/${courseId}/chapters`, GV, { title: 'Chương 1: Số thập phân' }), 201).id;
  const l = expectStatus(api('POST', `/chapters/${chapterId}/lessons`, GV, { title: 'Bài 1: Ôn tập', duration_minutes: 30 }), 201);
  lessonId = l.id;
  assert.equal(l.publish_status, 'DRAFT');
  const lesson = expectStatus(api('GET', `/lessons/${lessonId}`, GV), 200);
  revision = lesson.revision;
  assert.equal(lesson.blocks.length, 0);
});

await t('RESOURCES', 'Thêm tài liệu liên kết và tệp; chặn định dạng không cho phép', () => {
  resLinkId = expectStatus(api('POST', `/courses/${courseId}/resources`, GV, { title: 'Phiếu bài tập online', resource_type: 'LINK', url: 'https://example.edu.vn/phieu.pdf' }), 201).id;
  resFileId = expectStatus(api('POST', `/courses/${courseId}/resources`, GV, {
    title: 'Đề cương', resource_type: 'FILE', file_name: 'de-cuong.txt', data_base64: Buffer.from('Nội dung đề cương').toString('base64'),
  }), 201).id;
  expectStatus(api('POST', `/courses/${courseId}/resources`, GV, { title: 'Virus', resource_type: 'FILE', file_name: 'x.exe', data_base64: 'AAAA' }), 422, 'FILE_TYPE_NOT_ALLOWED');
  expectStatus(api('POST', `/courses/${courseId}/resources`, GV, { title: 'JS', resource_type: 'LINK', url: 'javascript:alert(1)' }), 422);
});

await t('BLOCK EDITOR', 'Lưu nội dung nhiều khối, chèn nhiều video YouTube ở các vị trí khác nhau', () => {
  const blocks = [
    { block_type: 'heading', content: { text: 'Mở đầu', level: 2 } },
    { block_type: 'youtube', content: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Video 1' } },
    { block_type: 'paragraph', content: { text: 'Số thập phân gồm phần nguyên và phần thập phân.' } },
    { block_type: 'youtube', content: { url: 'https://youtu.be/9bZkp7q19f0?t=30', title: 'Video 2' } },
    { block_type: 'file', content: { resource_id: resFileId } },
    { block_type: 'math', content: { latex: '0{,}5 = \\frac{1}{2}' } },
    { block_type: 'review_question', content: { question: '0,5 bằng phân số nào?', options: [
      { id: 'a', text: '1/2', is_correct: true, feedback: 'Đúng' }, { id: 'b', text: '1/5', is_correct: false } ] } },
  ];
  const d = expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV, { base_revision: revision, blocks }), 200);
  revision = d.revision;
  const yt = d.blocks.filter((b) => b.block_type === 'youtube');
  assert.equal(yt.length, 2);
  assert.equal(yt[0].content.video_id, 'dQw4w9WgXcQ');
  assert.equal(yt[1].content.start_seconds, 30);
  assert.equal(yt[0].content.url, undefined, 'URL gốc không được lưu, chỉ lưu video_id');
});

await t('BLOCK EDITOR', 'Từ chối khối video không thuộc YouTube, khối HTML tùy ý và tài liệu khóa khác', () => {
  expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV, { base_revision: revision, blocks: [{ block_type: 'youtube', content: { url: 'https://evil.com/v/x' } }] }), 422, 'INVALID_BLOCK');
  expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV, { base_revision: revision, blocks: [{ block_type: 'html', content: { html: '<iframe src="https://evil.com">' } }] }), 422, 'INVALID_BLOCK');
  const otherRes = expectStatus(api('POST', '/courses/crs_toan5/resources', GV, { title: 'Khác', resource_type: 'LINK', url: 'https://a.vn' }), 201).id;
  expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV, { base_revision: revision, blocks: [{ block_type: 'file', content: { resource_id: otherRes } }] }), 422, 'INVALID_BLOCK');
});

await t('BLOCK EDITOR', 'Xung đột phiên bản khi lưu bằng revision cũ (409)', () => {
  expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV, { base_revision: revision - 1, blocks: [] }), 409, 'REVISION_CONFLICT');
});

await t('PUBLISH', 'Xuất bản bài học và khóa học', () => {
  expectStatus(api('PATCH', `/lessons/${lessonId}`, GV, { completion_rule: 'REVIEW_CORRECT' }), 200);
  const p = expectStatus(api('POST', `/lessons/${lessonId}/publish`, GV), 200);
  assert.equal(p.published_version, 1);
  const c = expectStatus(api('POST', `/courses/${courseId}/status`, GV, { status: 'PUBLISHED' }), 200);
  assert.equal(c.status, 'PUBLISHED');
  const detail = expectStatus(api('GET', `/courses/${courseId}`, GV), 200);
  assert.equal(detail.outline[0].lessons[0].publish_status, 'PUBLISHED');
});

await t('PUBLISH', 'Trợ giảng và giảng viên khác không được sửa / xuất bản khóa học không thuộc quyền', () => {
  expectStatus(api('POST', `/lessons/${lessonId}/publish`, TA), 403);
  expectStatus(api('PUT', `/lessons/${lessonId}/content`, GV2, { base_revision: revision, blocks: [] }), 403, 'CONTENT_EDIT_FORBIDDEN');
  expectStatus(api('PATCH', `/courses/${courseId}`, GV2, { title: 'Sửa trộm' }), 403, 'COURSE_MANAGE_FORBIDDEN');
  expectStatus(api('GET', `/courses/${courseId}`, GV2), 403);
});

await t('CURRICULUM', 'Bài đã xuất bản không được xóa (409) — phải lưu trữ', () => {
  expectStatus(api('DELETE', `/lessons/${lessonId}`, GV), 409, 'CONTENT_IN_USE');
  const draft = expectStatus(api('POST', `/chapters/${chapterId}/lessons`, GV, { title: 'Bài nháp xóa được' }), 201).id;
  expectStatus(api('DELETE', `/lessons/${draft}`, GV), 200);
});

await t('CURRICULUM', 'Sắp xếp kéo thả: từ chối bài học không thuộc khóa học', () => {
  const foreignLesson = db.prepare("SELECT id FROM lessons WHERE chapter_id = 'ch_1' LIMIT 1").get().id;
  expectStatus(api('PUT', `/courses/${courseId}/outline`, GV, { chapters: [{ id: chapterId, lesson_ids: [lessonId, foreignLesson] }] }), 422);
  const ch2 = expectStatus(api('POST', `/courses/${courseId}/chapters`, GV, { title: 'Chương 2' }), 201).id;
  const d = expectStatus(api('PUT', `/courses/${courseId}/outline`, GV, { chapters: [{ id: ch2, lesson_ids: [lessonId] }, { id: chapterId, lesson_ids: [] }] }), 200);
  assert.equal(d.outline[0].id, ch2);
  assert.equal(d.outline[0].lessons[0].id, lessonId);
});

// ---------------------------------------------------------------- Class flow
let classId;
await t('CLASS', 'Giảng viên tạo lớp liên kết khóa học, trùng mã lớp bị từ chối', () => {
  const d = expectStatus(api('POST', '/classes', GV, {
    code: '5a1-nc', title: 'Bồi dưỡng Toán 5A1', course_id: courseId, start_date: '2026-11-01', end_date: '2027-01-31',
    max_students: 30, delivery_mode: 'HYBRID', status: 'ACTIVE',
  }), 201);
  classId = d.id;
  assert.equal(d.code, '5A1-NC');
  assert.equal(d.staff[0].staff_role, 'PRIMARY_INSTRUCTOR');
  expectStatus(api('POST', '/classes', GV, { code: '5A1', title: 'Trùng' }), 409, 'CLASS_CODE_EXISTS');
  expectStatus(api('POST', '/classes', GV, { code: 'BAD', title: 'Ngày sai', start_date: '2026-12-01', end_date: '2026-11-01' }), 422);
});

await t('CLASS', 'Giảng viên không được thêm học viên khi chính sách chỉ cho Giáo vụ (403)', () => {
  expectStatus(api('POST', `/classes/${classId}/students`, GV, { students: ['HS50101'] }), 403, 'CLASS_ACTION_FORBIDDEN');
});

await t('CLASS', 'Giáo vụ thêm học viên theo mã / email; báo mã không tồn tại; nhập danh sách', () => {
  const d = expectStatus(api('POST', `/classes/${classId}/students`, STAFF, { students: ['HS50101', 'HS50102', 'KHONGTONTAI'] }), 200);
  assert.deepEqual(d.added.sort(), ['HS50101', 'HS50102']);
  assert.deepEqual(d.not_found, ['KHONGTONTAI']);
  const imp = expectStatus(api('POST', `/classes/${classId}/students/import`, STAFF, { text: 'Mã HS\nHS50103\nHS50101\n' }), 200);
  assert.deepEqual(imp.added, ['HS50103']);
  assert.deepEqual(imp.already_enrolled, ['HS50101']);
});

await t('CLASS', 'Giảng viên xem danh sách học viên kèm tiến độ và chuyên cần', () => {
  const d = expectStatus(api('GET', `/classes/${classId}/students`, GV), 200);
  assert.equal(d.items.length, 3);
  assert.equal(d.items[0].progress.total, 1);
  assert.equal(d.capabilities.can_manage_roster, false);
});

await t('CLASS', 'Lớp mới xuất hiện trên Tổng quan giảng dạy của giảng viên', () => {
  const d = expectStatus(api('GET', '/dashboard', GV), 200);
  assert.equal(d.counts.classes, 2);
  assert.ok(Array.isArray(d.sessions_need_attendance));
});

await t('CLASS', 'Tạo lịch học lặp theo tuần, bỏ qua buổi trùng', () => {
  const body = { start_time: '14:00', end_time: '15:30', recurrence: { start_date: '2026-12-01', end_date: '2026-12-14', weekdays: [2, 4] } };
  const d = expectStatus(api('POST', `/classes/${classId}/sessions`, GV, body), 201);
  assert.equal(d.created_count, 4);
  const again = expectStatus(api('POST', `/classes/${classId}/sessions`, GV, body), 201);
  assert.equal(again.created_count, 0);
  assert.equal(again.skipped_dates.length, 4);
});

// ---------------------------------------------------------------- Student learning
await t('LEARN', 'Học viên thấy lớp, nội dung đã xuất bản, video YouTube và không thấy đáp án', () => {
  const classes = expectStatus(api('GET', '/learn/classes', HS1), 200);
  assert.ok(classes.items.some((c) => c.id === classId));
  const detail = expectStatus(api('GET', `/learn/classes/${classId}`, HS1), 200);
  assert.equal(detail.chapters.length, 1);
  const lesson = expectStatus(api('GET', `/learn/classes/${classId}/lessons/${lessonId}`, HS1), 200);
  assert.equal(lesson.blocks.filter((b) => b.block_type === 'youtube').length, 2);
  const q = lesson.blocks.find((b) => b.block_type === 'review_question');
  assert.equal(q.content.options[0].is_correct, undefined, 'Không lộ đáp án cho học viên');
  assert.ok(lesson.resources[resFileId].available);
});

await t('LEARN', 'Điều kiện hoàn thành: phải trả lời đúng câu hỏi ôn tập', () => {
  const lesson = expectStatus(api('GET', `/learn/classes/${classId}/lessons/${lessonId}`, HS1), 200);
  const q = lesson.blocks.find((b) => b.block_type === 'review_question');
  const chk = expectStatus(api('POST', `/learn/classes/${classId}/lessons/${lessonId}/check`, HS1, { block_id: q.id, option_id: 'b' }), 200);
  assert.equal(chk.correct, false);
  expectStatus(api('POST', `/learn/classes/${classId}/lessons/${lessonId}/complete`, HS1, { answers: { [q.id]: 'b' } }), 422, 'COMPLETION_CRITERIA_NOT_MET');
  const ok = expectStatus(api('POST', `/learn/classes/${classId}/lessons/${lessonId}/complete`, HS1, { answers: { [q.id]: 'a' } }), 200);
  assert.equal(ok.progress_status, 'COMPLETED');
  const st = expectStatus(api('GET', `/classes/${classId}/students`, GV), 200);
  assert.equal(st.items.find((s) => s.code === 'HS50101').progress.completed, 1);
});

await t('LEARN', 'Học viên tải tài liệu của lớp mình; học viên lớp khác bị chặn', () => {
  const r = api('GET', `/resources/${resFileId}/download`, HS1);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'Nội dung đề cương');
  expectStatus(api('GET', `/resources/${resFileId}/download`, HS2A2), 403, 'RESOURCE_ACCESS_DENIED');
});

await t('LEARN', 'Học viên không truy cập được lớp chưa ghi danh hoặc bài học chưa xuất bản', () => {
  expectStatus(api('GET', `/learn/classes/sc_toan5_5a2`, HS1), 403, 'NOT_ENROLLED');
  const draft = expectStatus(api('POST', `/chapters/${chapterId}/lessons`, GV, { title: 'Bài chưa xuất bản' }), 201).id;
  expectStatus(api('GET', `/learn/classes/${classId}/lessons/${draft}`, HS1), 403, 'LESSON_NOT_AVAILABLE');
  expectStatus(api('POST', `/lessons/${lessonId}/archive`, GV), 200);
  expectStatus(api('GET', `/learn/classes/${classId}/lessons/${lessonId}`, HS1), 403, 'LESSON_NOT_AVAILABLE');
  expectStatus(api('POST', `/lessons/${lessonId}/restore`, GV), 200);
});

// ---------------------------------------------------------------- Attendance flow
const nowVnIso = vnIso(new Date());
const todaySession = db.prepare(
  "SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND session_status <> 'CANCELLED' AND attendance_saved_at IS NULL AND scheduled_start_at <= ? ORDER BY scheduled_start_at DESC LIMIT 1"
).get(nowVnIso).session_id;

await t('ATTENDANCE', 'Mở buổi học: tải danh sách học viên tại thời điểm buổi học', () => {
  const d = expectStatus(api('GET', `/sessions/${todaySession}/attendance`, GV), 200);
  assert.equal(d.items.length, 24);
  assert.ok(d.items.every((i) => i.status === null));
  assert.equal(d.counts.NOT_MARKED, 24);
  assert.equal(d.capabilities.can_edit, true);
});

await t('ATTENDANCE', 'Đánh dấu tất cả có mặt rồi chỉnh vài học viên vắng / đi muộn', () => {
  const view = expectStatus(api('GET', `/sessions/${todaySession}/attendance`, GV), 200);
  const all = view.items.map((i) => ({ student_id: i.student_id, status: 'PRESENT' }));
  const first = expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: all }), 200);
  assert.equal(first.created, 24);
  all[0].status = 'UNEXCUSED_ABSENCE';
  all[1].status = 'LATE';
  all[2] = { ...all[2], status: 'EXCUSED_ABSENCE', note: 'Phụ huynh xin phép' };
  const second = expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: all }), 200);
  assert.equal(second.changed, 3);
  assert.equal(second.unchanged, 21);
  assert.equal(second.counts.PRESENT, 21);
  assert.equal(second.counts.UNEXCUSED_ABSENCE, 1);
});

await t('ATTENDANCE', 'Lịch sử thay đổi ghi người sửa, trạng thái trước/sau', () => {
  const d = expectStatus(api('GET', `/sessions/${todaySession}/attendance/history`, GV), 200);
  const change = d.items.find((i) => i.previous_status === 'PRESENT' && i.new_status === 'UNEXCUSED_ABSENCE');
  assert.ok(change);
  assert.equal(change.changed_by_name, 'Cô Lê Thu Hà');
  assert.ok(change.changed_at);
});

await t('ATTENDANCE', 'Chống gửi trùng: cùng idempotency_key chỉ ghi một lần', () => {
  const view = expectStatus(api('GET', `/sessions/${todaySession}/attendance`, GV), 200);
  const records = [{ student_id: view.items[5].student_id, status: 'LATE' }];
  const key = crypto.randomUUID();
  const before = db.prepare('SELECT COUNT(*) n FROM attendance_audit_logs').get().n;
  const a = expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records, idempotency_key: key }), 200);
  const b = expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records, idempotency_key: key }), 200);
  assert.equal(a.changed, 1);
  assert.equal(b.replayed, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_audit_logs').get().n, before + 1);
});

await t('ATTENDANCE', 'Từ chối học viên trùng trong dữ liệu, học viên ngoài lớp, trạng thái sai', () => {
  const view = expectStatus(api('GET', `/sessions/${todaySession}/attendance`, GV), 200);
  const id = view.items[0].student_id;
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: [{ student_id: id, status: 'PRESENT' }, { student_id: id, status: 'LATE' }] }), 422, 'DUPLICATE_STUDENT');
  const outsider = db.prepare("SELECT id FROM users WHERE code = 'HS50201'").get().id;
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: [{ student_id: outsider, status: 'PRESENT' }] }), 422, 'STUDENT_NOT_IN_CLASS');
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: [{ student_id: id, status: 'NOT_MARKED' }] }), 422, 'INVALID_STATUS');
});

await t('ATTENDANCE', 'Không điểm danh buổi đã hủy hoặc buổi chưa diễn ra', () => {
  const cancelled = db.prepare("SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND session_status = 'CANCELLED' LIMIT 1").get().session_id;
  expectStatus(api('PUT', `/sessions/${cancelled}/attendance`, GV, { records: [{ student_id: hs1Id, status: 'PRESENT' }] }), 422, 'SESSION_CANCELLED');
  const future = db.prepare("SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND scheduled_start_at > ? ORDER BY scheduled_start_at DESC LIMIT 1").get(vnIso(new Date(Date.now() + 2 * 86400000))).session_id;
  expectStatus(api('PUT', `/sessions/${future}/attendance`, GV, { records: [{ student_id: hs1Id, status: 'PRESENT' }] }), 422, 'SESSION_NOT_STARTED');
});

await t('ATTENDANCE', 'Trợ giảng được cấp quyền điểm danh; không được chốt', () => {
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, TA, { records: [{ student_id: hs1Id, status: 'PRESENT' }] }), 200);
  expectStatus(api('POST', `/sessions/${todaySession}/attendance/lock`, TA), 403);
});

await t('ATTENDANCE', 'Giáo vụ chốt → giảng viên không sửa được (423); mở chốt cần lý do', () => {
  expectStatus(api('POST', `/sessions/${todaySession}/attendance/lock`, STAFF), 200);
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: [{ student_id: hs1Id, status: 'LATE' }] }), 423, 'ATTENDANCE_LOCKED');
  expectStatus(api('POST', `/sessions/${todaySession}/attendance/unlock`, STAFF, {}), 422);
  expectStatus(api('POST', `/sessions/${todaySession}/attendance/unlock`, STAFF, { reason: 'Giáo viên báo nhầm' }), 200);
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, GV, { records: [{ student_id: hs1Id, status: 'LATE' }] }), 200);
});

await t('ATTENDANCE', 'Sửa điểm danh sau 24 giờ bắt buộc nhập lý do', () => {
  const old = db.prepare("SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND attendance_saved_at IS NOT NULL AND scheduled_end_at < ? ORDER BY scheduled_start_at LIMIT 1")
    .get(vnIso(new Date(Date.now() - 2 * 86400000))).session_id;
  const rec = db.prepare('SELECT student_id, attendance_status FROM attendance_records WHERE class_session_id = ? LIMIT 1').get(old);
  const next = rec.attendance_status === 'PRESENT' ? 'LATE' : 'PRESENT';
  expectStatus(api('PUT', `/sessions/${old}/attendance`, GV, { records: [{ student_id: rec.student_id, status: next }] }), 422, 'CHANGE_REASON_REQUIRED');
  expectStatus(api('PUT', `/sessions/${old}/attendance`, GV, { records: [{ student_id: rec.student_id, status: next }], change_reason: 'Học sinh có giấy xác nhận' }), 200);
  const audit = db.prepare(
    `SELECT l.change_reason FROM attendance_audit_logs l JOIN attendance_records r ON r.id = l.attendance_record_id
     WHERE r.class_session_id = ? AND r.student_id = ? ORDER BY l.rowid DESC LIMIT 1`
  ).get(old, rec.student_id);
  assert.equal(audit.change_reason, 'Học sinh có giấy xác nhận');
});

await t('STATS', 'Thống kê chuyên cần không tính buổi hủy, hiển thị công thức', () => {
  const d = expectStatus(api('GET', '/classes/sc_toan5_5a1/attendance/stats', GV), 200);
  const cancelledCount = db.prepare("SELECT COUNT(*) n FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND session_status = 'CANCELLED'").get().n;
  assert.ok(cancelledCount >= 1);
  assert.equal(d.cancelled_sessions, cancelledCount);
  const held = db.prepare("SELECT COUNT(*) n FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND session_status <> 'CANCELLED' AND scheduled_start_at <= ?").get(vnIso(new Date())).n;
  assert.equal(d.sessions_held, held);
  assert.ok(d.policy.formula_text.includes('Buổi bị hủy'));
  const s = d.students[0];
  assert.equal(s.total_sessions, s.present + s.late + s.excused + s.absent + s.not_marked);
  const expected = Math.round(((s.present + s.late) / (s.present + s.late + s.absent)) * 1000) / 10;
  assert.equal(s.rate, expected);
});

await t('STATS', 'Xuất CSV (UTF-8 BOM, chống chèn công thức)', () => {
  const r = api('GET', '/classes/sc_toan5_5a1/attendance/export', GV);
  assert.equal(r.status, 200);
  assert.ok(r.headers['Content-Type'].startsWith('text/csv'));
  assert.ok(r.body.startsWith('\uFEFFSTT,Mã học viên,Họ và tên'));
  assert.equal(r.body.split('\r\n').filter((l) => /^\d+,/.test(l)).length, 24);
});

// ---------------------------------------------------------------- QR / dynamic code
let qrSession;
await t('QR', 'Giảng viên mở mã điểm danh động cho buổi đang diễn ra', () => {
  qrSession = `ses_qr_${Date.now()}`;
  const now = new Date();
  insertClassSession(db, {
    session_id: qrSession, subject_class_id: 'sc_toan5_5a1', subject_class_code: '5A1', subject_title: 'Toán lớp 5',
    session_title: 'Buổi kiểm thử mã', scheduled_start_at: vnIso(new Date(now.getTime() - 5 * 60000)),
    scheduled_end_at: vnIso(new Date(now.getTime() + 40 * 60000)), instructor_id: '', instructor_name: '',
  });
  expectStatus(api('POST', `/sessions/${qrSession}/attendance/qr`, GV, { duration_minutes: 5 }), 201);
  const q = expectStatus(api('GET', `/sessions/${qrSession}/attendance/qr`, GV), 200);
  assert.equal(q.active, true);
  assert.match(q.code, /^\d{6}$/);
});

await t('QR', 'Học viên nhập mã đúng → có mặt; gửi lại không tạo bản ghi trùng; mã sai bị từ chối', () => {
  const q = expectStatus(api('GET', `/sessions/${qrSession}/attendance/qr`, GV), 200);
  const wrong = q.code === '000000' ? '111111' : '000000';
  expectStatus(api('POST', '/attendance/check-in', HS1, { code: wrong }), 422, 'INVALID_CODE');
  const ok = expectStatus(api('POST', '/attendance/check-in', HS1, { code: q.code }), 201);
  assert.equal(ok.status, 'PRESENT');
  const again = expectStatus(api('POST', '/attendance/check-in', HS1, { code: q.code }), 200);
  assert.equal(again.already_checked_in, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records WHERE class_session_id = ? AND student_id = ?').get(qrSession, hs1Id).n, 1);
});

await t('QR', 'Học viên lớp khác và giảng viên không dùng được mã của lớp', () => {
  const q = expectStatus(api('GET', `/sessions/${qrSession}/attendance/qr`, GV), 200);
  expectStatus(api('POST', '/attendance/check-in', HS2A2, { code: q.code }), 404, 'NO_ACTIVE_CHECKIN');
  expectStatus(api('POST', '/attendance/check-in', GV, { code: q.code }), 403, 'CHECKIN_STUDENT_ONLY');
  expectStatus(api('DELETE', `/sessions/${qrSession}/attendance/qr`, GV), 200);
  expectStatus(api('POST', '/attendance/check-in', login('HS50102'), { code: q.code }), 404, 'NO_ACTIVE_CHECKIN');
});

// ---------------------------------------------------------------- Security / scope
await t('SECURITY', 'Giảng viên truy cập lớp ngoài phạm vi bị chặn (xem, điểm danh, thống kê)', () => {
  expectStatus(api('GET', '/classes/sc_toan5_5a2', GV), 403, 'CLASS_ACCESS_DENIED');
  const s5a2 = db.prepare("SELECT session_id FROM sessions WHERE subject_class_id = 'sc_toan5_5a2' AND scheduled_start_at <= ? LIMIT 1").get(nowVnIso).session_id;
  expectStatus(api('PUT', `/sessions/${s5a2}/attendance`, GV, { records: [] }), 403);
  expectStatus(api('GET', '/classes/sc_toan5_5a2/attendance/stats', GV), 403);
  const list = expectStatus(api('GET', '/classes', GV), 200);
  assert.ok(!list.items.some((c) => c.id === 'sc_toan5_5a2'));
});

await t('SECURITY', 'Học viên không truy cập API giảng dạy và không sửa điểm danh', () => {
  expectStatus(api('GET', '/classes/sc_toan5_5a1', HS1), 403);
  expectStatus(api('PUT', `/sessions/${todaySession}/attendance`, HS1, { records: [{ student_id: hs1Id, status: 'PRESENT' }] }), 403);
  expectStatus(api('GET', `/sessions/${todaySession}/attendance`, HS1), 403);
  const list = expectStatus(api('GET', '/classes', HS1), 200);
  assert.equal(list.items.length, 0);
});

await t('SECURITY', 'Thiếu / sai JWT → 401; JSON lỗi → 400', async () => {
  expectStatus(api('GET', '/courses', {}), 401, 'INVALID_OR_EXPIRED_JWT');
  expectStatus(api('GET', '/courses', { authorization: 'Bearer x.y.z' }), 401);
  const bad = await invokeApiAsync('POST', `${T}/courses`, GV, null, '{"title": ');
  expectStatus(bad, 400, 'INVALID_JSON');
});

await t('SECURITY', 'Giáo vụ thấy lớp trong đơn vị; Quản trị viên thấy tất cả', () => {
  const staff = expectStatus(api('GET', '/classes', STAFF), 200);
  assert.ok(staff.items.some((c) => c.id === 'sc_toan5_5a2') && staff.items.some((c) => c.id === 'sc_toan5_5a1'));
  const admin = expectStatus(api('GET', '/classes?status=ALL', ADMIN), 200);
  assert.ok(admin.total >= 3);
});

await t('COURSE', 'Sao chép khóa học tạo bản nháp riêng (không ảnh hưởng lớp đang dùng bản gốc)', () => {
  const d = expectStatus(api('POST', `/courses/${courseId}/duplicate`, GV, {}), 201);
  assert.equal(d.status, 'DRAFT');
  assert.equal(d.chapters_count, 2);
  assert.equal(d.classes_count, 0);
});

await t('TEACHING LOG', 'Xác nhận nhật ký buổi dạy; sau 24 giờ bắt buộc ghi lý do', () => {
  const recent = db.prepare("SELECT session_id, scheduled_end_at FROM sessions WHERE subject_class_id = 'sc_toan5_5a1' AND confirmation_status = 'AWAITING_CONFIRMATION' AND session_status <> 'CANCELLED' AND scheduled_end_at < ? ORDER BY scheduled_end_at DESC LIMIT 1").get(nowVnIso);
  if (Date.now() - Date.parse(recent.scheduled_end_at) > 24 * 3600000) {
    expectStatus(api('POST', `/sessions/${recent.session_id}/confirm-log`, GV, {}), 422, 'LATE_REASON_REQUIRED');
    const d = expectStatus(api('POST', `/sessions/${recent.session_id}/confirm-log`, GV, { note: 'Bận họp chuyên môn' }), 200);
    assert.equal(d.confirmation_status, 'CONFIRMED_LATE');
  } else {
    const d = expectStatus(api('POST', `/sessions/${recent.session_id}/confirm-log`, GV, {}), 200);
    assert.equal(d.confirmation_status, 'CONFIRMED');
  }
  expectStatus(api('POST', `/sessions/${recent.session_id}/confirm-log`, TA, {}), 403);
});

await t('SCHEDULE', 'Lịch dạy theo tuần chỉ gồm lớp trong phạm vi', () => {
  const from = vnDate(new Date(Date.now() - 3 * 86400000));
  const to = vnDate(new Date(Date.now() + 3 * 86400000));
  const d = expectStatus(api('GET', `/schedule?from=${from}&to=${to}`, GV), 200);
  assert.ok(d.items.length > 0);
  assert.ok(d.items.every((s) => s.class_id !== 'sc_toan5_5a2'));
});

await t('IMAGE LINK', 'Tự bóc link ảnh gốc từ Bing Images, Google Images, Google Drive và hỗ trợ Data URL bitmap an toàn', () => {
  const bingWrapper =
    'https://www.bing.com/images/search?view=detailV2&mediaurl=https%3a%2f%2fvstatic.vietnam.vn%2fvietnam%2fphoto.webp&cdnurl=https%3a%2f%2fth.bing.com%2fth%2fid%2fR.12345%3fpid%3dImgRaw%26r%3d0';
  const c1 = expectStatus(api('PATCH', `/courses/${courseId}`, GV, { thumbnail_url: bingWrapper }), 200);
  assert.equal(c1.thumbnail_url, 'https://vstatic.vietnam.vn/vietnam/photo.webp');

  const googleWrapper =
    'https://www.google.com/imgres?imgurl=https%3A%2F%2Fimages.example.org%2Fcover.jpg&tbnid=Abc123';
  const c2 = expectStatus(api('PATCH', `/courses/${courseId}`, GV, { thumbnail_url: googleWrapper }), 200);
  assert.equal(c2.thumbnail_url, 'https://images.example.org/cover.jpg');

  const driveShare = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing';
  const c3 = expectStatus(api('PATCH', `/courses/${courseId}`, GV, { thumbnail_url: driveShare }), 200);
  assert.equal(c3.thumbnail_url, 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz');

  const tinyPngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const c4 = expectStatus(api('PATCH', `/courses/${courseId}`, GV, { thumbnail_url: tinyPngDataUrl }), 200);
  assert.equal(c4.thumbnail_url, tinyPngDataUrl);

  // Chặn SVG chứa script dưới dạng Data URL để chống XSS
  expectStatus(
    api('PATCH', `/courses/${courseId}`, GV, {
      thumbnail_url: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=',
    }),
    422
  );

  // Kiểm tra khối image trong bài học cũng tự bóc link & nhận Data URL bitmap
  const curLesson = expectStatus(api('GET', `/lessons/${lessonId}`, GV), 200);
  const savedDraft = expectStatus(
    api('PUT', `/lessons/${lessonId}/content`, GV, {
      base_revision: curLesson.revision,
      blocks: [
        { id: 'img_bing', block_type: 'image', content: { url: bingWrapper, alt: 'Ảnh Bing', caption: '' } },
        { id: 'img_data', block_type: 'image', content: { url: tinyPngDataUrl, alt: 'Ảnh tải từ máy', caption: '' } },
      ],
    }),
    200
  );
  assert.equal(savedDraft.blocks[0].content.url, 'https://vstatic.vietnam.vn/vietnam/photo.webp');
  assert.equal(savedDraft.blocks[1].content.url, tinyPngDataUrl);
});

db.close();
fs.rmSync(process.env.LMSPLUS_DB_PATH, { force: true });
fs.rmSync(process.env.LMSPLUS_UPLOADS_DIR, { recursive: true, force: true });

console.log('======================================================================');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
if (failed > 0) process.exit(1);
