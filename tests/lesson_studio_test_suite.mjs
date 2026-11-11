#!/usr/bin/env node
/**
 * LMSPLUS — LESSON STUDIO & INTERACTIVE VIDEO QUIZ INTEGRATION TEST SUITE
 * Kiểm thử toàn diện 14 tiêu chí nghiệm thu:
 *  - Mode A (Course Studio): cây chương/bài, nhân bản chương/bài, 15 loại block, allowlist nhúng an toàn, lịch sử phiên bản & khôi phục
 *  - Chunked Video Upload, hủy upload giữa chừng, thay thế video, tải PDF & HTTP Range Streaming (206 Partial Content + signed st token)
 *  - Ngân hàng câu hỏi (Question Bank) & đủ 5 dạng câu hỏi (SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE, FILL_BLANK, SHORT_ANSWER)
 *  - Interactive Video Quiz theo mốc thời gian: sắp xếp mốc, ẩn đáp án tuyệt đối phía học viên, chấm điểm, giới hạn lượt thử, idempotency_key chống gửi trùng, lưu & khôi phục vị trí xem video (Resume Playback)
 *  - Quiz độc lập trong bài học & cổng hoàn thành bài học VIDEO_AND_QUIZ phía server
 *  - Mode B (Class Studio): bổ sung block & video quiz riêng cho lớp 5A1 mà không làm thay đổi khóa học gốc hay lớp 5A2
 *  - Phân quyền RBAC & phạm vi dữ liệu nghiêm ngặt
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
const TMP_DB = path.join(TMP_DIR, `studio-${process.pid}.sqlite`);
const TMP_UPLOADS = path.join(TMP_DIR, `uploads-studio-${process.pid}`);
process.env.LMSPLUS_DB_PATH = TMP_DB;
process.env.LMSPLUS_UPLOADS_DIR = TMP_UPLOADS;
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { invokeApi, invokeApiAsync, createJwtToken, initSchemaAndSeed, db } = await import('../backend/server_fallback.mjs');

initSchemaAndSeed(true);

function tokenForCode(code) {
  const r = db.prepare('SELECT * FROM users WHERE code = ?').get(code);
  assert.ok(r, `Thiếu người dùng seed ${code}`);
  return createJwtToken({
    id: r.id,
    code: r.code,
    email: r.email,
    full_name: r.full_name,
    roles: JSON.parse(r.roles_json),
    department_id: r.department_id,
  });
}

const GV = tokenForCode('GV5001'); // Cô Lê Thu Hà — phụ trách TOAN5-2026 & lớp 5A1
const GV2 = tokenForCode('GV5002'); // Thầy Đỗ Văn Khoa — phụ trách lớp 5A2 (không có quyền sửa khóa gốc / lớp 5A1)
const TA = tokenForCode('TG5001'); // Trợ giảng lớp 5A1
const STAFF = tokenForCode('GVU001'); // Giáo vụ khối 5
const HS5A1 = tokenForCode('HS50101'); // Học viên lớp 5A1
const HS5A2 = tokenForCode('HS50201'); // Học viên lớp 5A2 (cùng khóa TOAN5-2026 nhưng khác lớp!)

const P = '/api/v1/teaching';
const api = (m, u, tok, body, extraHeaders = {}) =>
  invokeApi(m, `${P}${u}`, { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...extraHeaders }, body);
const apiAsync = (m, u, tok, body, extraHeaders = {}) =>
  invokeApiAsync(m, `${P}${u}`, { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...extraHeaders }, body);

let passed = 0;
let failed = 0;
async function t(group, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  [PASS] [${group}] ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] [${group}] ${name}: ${err.stack || err.message}`);
  }
}

function expectStatus(res, code, errCode) {
  assert.equal(res.status, code, `Kỳ vọng HTTP ${code}, nhận ${res.status}: ${JSON.stringify(res.body)}`);
  if (errCode) assert.equal(res.body?.detail?.code, errCode);
  return res.body?.data ?? res.body;
}

console.log('======================================================================');
console.log(' LMSPLUS — LESSON STUDIO & VIDEO QUIZ INTEGRATION TEST SUITE');
console.log('======================================================================');

// ---------------------------------------------------------------- 1. Mode A Bootstrap & Duplication
await t('STUDIO MODE A', 'Tải dữ liệu Lesson Studio khóa học gốc kèm đa lớp & cảnh báo hoàn thiện', () => {
  const d = expectStatus(api('GET', '/studio/courses/crs_toan5', GV), 200);
  assert.equal(d.mode, 'COURSE');
  assert.equal(d.course.code, 'TOAN5-2026');
  assert.ok(d.question_bank_count >= 4, 'Seed ngân hàng câu hỏi Toán 5 phải có ít nhất 4 câu');
  assert.ok(d.classes_using.length >= 2, 'Khóa Toán 5 đang dùng cho ít nhất 2 lớp (5A1, 5A2)');
  const les101 = d.outline.flatMap((c) => c.lessons).find((l) => l.id === 'les_101');
  assert.ok(les101, 'Phải có bài học les_101');
  assert.ok(les101.video_markers_count >= 3, 'les_101 seed phải có sẵn 3 mốc câu hỏi tương tác trên video');
});

await t('STUDIO MODE A', 'Chặn giảng viên ngoài phạm vi, kiểm soát quyền xuất bản khóa gốc & chặn học viên mở Studio', () => {
  // GV2 phụ trách lớp 5A2 (dùng crs_toan5) nên KHÔNG phải chủ khóa học gốc -> không có quyền xuất bản / nhân bản chương của khóa gốc
  const gv2Studio = expectStatus(api('GET', '/studio/courses/crs_toan5', GV2), 200);
  assert.equal(gv2Studio.capabilities.can_manage, false);
  assert.equal(gv2Studio.capabilities.can_publish, false);
  expectStatus(api('POST', '/lessons/les_101/publish', GV2, {}), 403, 'PUBLISH_FORBIDDEN');
  // GV2 không được mở Lesson Studio của lớp 5A1 (thuộc GV1)
  expectStatus(api('GET', '/studio/classes/sc_toan5_5a1', GV2), 403, 'CLASS_ACCESS_DENIED');
  // Một giảng viên hoàn toàn ngoài phạm vi (chưa được phân công lớp nào của crs_toan5) bị chặn 403 COURSE_ACCESS_DENIED
  const outsiderToken = createJwtToken({
    id: 'gv_outsider_999',
    code: 'GV9999',
    email: 'outsider.gv@lmsplus.edu.vn',
    full_name: 'Giảng viên Khối Khác',
    roles: ['INSTRUCTOR'],
    department_id: 'khoi_9',
  });
  expectStatus(api('GET', '/studio/courses/crs_toan5', outsiderToken), 403, 'COURSE_ACCESS_DENIED');
  // Học viên bị chặn hoàn toàn khỏi Lesson Studio
  expectStatus(api('GET', '/studio/courses/crs_toan5', HS5A1), 403, 'COURSE_ACCESS_DENIED');
  expectStatus(api('GET', '/studio/classes/sc_toan5_5a1', HS5A1), 403, 'CLASS_ACCESS_DENIED');
});

let studioCourseId;
let studioChapterId;
let studioLessonId;

await t('STUDIO MODE A', 'Tạo khóa học mới, thêm chương/bài và nhân bản chương + bài học (deep copy)', () => {
  studioCourseId = expectStatus(
    api('POST', '/courses', GV, {
      code: 'STUDIO-2026',
      title: 'Khóa học Kiểm thử Lesson Studio',
      subject: 'Toán học',
      description: 'Kiểm thử toàn diện 15 khối nội dung & Video Quiz',
    }),
    201
  ).id;

  studioChapterId = expectStatus(
    api('POST', `/courses/${studioCourseId}/chapters`, GV, { title: 'Chương 1: Khái niệm nền tảng' }),
    201
  ).id;

  studioLessonId = expectStatus(
    api('POST', `/chapters/${studioChapterId}/lessons`, GV, {
      title: 'Bài 1.1: Bài giảng tương tác toàn diện',
      duration_minutes: 25,
      completion_rule: 'VIDEO_AND_QUIZ',
      min_video_watch_pct: 80,
      require_video_quizzes: true,
    }),
    201
  ).id;

  // Lưu thử 1 khối và 1 mốc quiz rồi nhân bản bài học & chương
  const vidBlkId = 'blk_studio_vid_main';
  const put1 = expectStatus(
    api('PUT', `/lessons/${studioLessonId}/content`, GV, {
      base_revision: 1,
      blocks: [
        {
          id: vidBlkId,
          block_type: 'video',
          content: {
            source_type: 'DIRECT_URL',
            direct_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
            title: 'Video mẫu',
            duration_seconds: 120,
          },
        },
      ],
    }),
    200
  );
  assert.equal(put1.revision, 2);

  expectStatus(
    api('PUT', `/lessons/${studioLessonId}/video-markers`, GV, {
      markers: [
        {
          block_id: vidBlkId,
          timestamp_sec: 15,
          behavior: 'PAUSE_AND_ASK',
          title: 'Câu hỏi kiểm tra nhanh 00:15',
          question: {
            question_type: 'TRUE_FALSE',
            prompt: ' Phân số 1/2 bằng 0,5 đúng hay sai?',
            answer_key: { value: true },
            points: 1,
          },
        },
      ],
    }),
    200
  );

  const dupLesson = expectStatus(api('POST', `/lessons/${studioLessonId}/duplicate`, GV), 201);
  const dupLessonDetail = expectStatus(api('GET', `/lessons/${dupLesson.id}`, GV), 200);
  assert.equal(dupLessonDetail.blocks.length, 1);
  assert.notEqual(dupLessonDetail.blocks[0].id, vidBlkId, 'Khối nhân bản phải mang ID mới');
  assert.equal(dupLessonDetail.video_markers.length, 1);
  assert.equal(
    dupLessonDetail.video_markers[0].block_id,
    dupLessonDetail.blocks[0].id,
    'Mốc quiz nhân bản phải trỏ sang ID khối video mới'
  );

  const dupChapter = expectStatus(api('POST', `/chapters/${studioChapterId}/duplicate`, GV), 201);
  assert.equal(dupChapter.outline.length, 2, 'Nhân bản chương tạo chương thứ 2 trong khóa học');
});

// ---------------------------------------------------------------- 2. Chunked Video Upload, Cancel, PDF & HTTP Range
let uploadedVideoResId;
let uploadedVideoStreamUrl;
let uploadedPdfResId;

await t('VIDEO UPLOAD', 'Tải video theo mảnh (chunked) + Hủy tải lên giữa chừng xóa sạch tệp tạm .part', () => {
  const fakeBytes = crypto.randomBytes(1500);
  const initRes = expectStatus(
    api('POST', '/media/videos/init', GV, {
      course_id: studioCourseId,
      title: 'Video sẽ bị hủy',
      file_name: 'bai-giang-nhap.mp4',
      total_size_bytes: 3000,
      total_chunks: 2,
      duration_seconds: 60,
    }),
    201
  );

  const ch0 = expectStatus(
    api('PUT', `/media/videos/${initRes.upload_id}/chunk`, GV, {
      chunk_index: 0,
      data_base64: fakeBytes.toString('base64'),
    }),
    200
  );
  assert.equal(ch0.progress_pct, 50);

  // Kiểm tra tệp tạm tồn tại trước khi hủy và bị xóa sau khi hủy
  const sessionRow = db.prepare('SELECT temp_path FROM video_upload_sessions WHERE id = ?').get(initRes.upload_id);
  const partFullPath = sessionRow.temp_path;
  assert.equal(fs.existsSync(partFullPath), true, 'Tệp .part phải tồn tại khi đang tải lên');

  const cancelled = expectStatus(api('DELETE', `/media/videos/${initRes.upload_id}`, GV), 200);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(fs.existsSync(partFullPath), false, 'Hủy tải lên phải dọn sạch tệp .part trên ổ đĩa');

  // Cố hoàn tất phiên đã hủy phải bị từ chối 409
  expectStatus(api('POST', `/media/videos/${initRes.upload_id}/complete`, GV, {}), 409, 'UPLOAD_NOT_ACTIVE');
});

await t('VIDEO UPLOAD & RANGE', 'Hoàn tất tải video nhiều mảnh & phát qua HTTP Range (206 Partial Content + signed st)', () => {
  // Tạo buffer giả lập tệp MP4 2048 bytes (có ftyp header chuẩn)
  const totalBuf = Buffer.alloc(2048);
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]).copy(totalBuf, 0);
  for (let i = 12; i < totalBuf.length; i++) totalBuf[i] = i % 251;

  const init = expectStatus(
    api('POST', '/media/videos/init', GV, {
      course_id: studioCourseId,
      title: 'Video bài giảng Toán tải lên máy chủ',
      file_name: 'toan5-phan-so.mp4',
      total_size_bytes: totalBuf.length,
      total_chunks: 2,
      duration_seconds: 180,
    }),
    201
  );

  expectStatus(
    api('PUT', `/media/videos/${init.upload_id}/chunk`, GV, {
      chunk_index: 0,
      data_base64: totalBuf.subarray(0, 1024).toString('base64'),
    }),
    200
  );
  expectStatus(
    api('PUT', `/media/videos/${init.upload_id}/chunk`, GV, {
      chunk_index: 1,
      data_base64: totalBuf.subarray(1024, 2048).toString('base64'),
    }),
    200
  );

  const done = expectStatus(
    api('POST', `/media/videos/${init.upload_id}/complete`, GV, { duration_seconds: 180 }),
    201
  );
  assert.equal(done.resource_type, 'VIDEO');
  assert.equal(done.processing_status, 'READY');
  assert.equal(done.duration_seconds, 180);
  assert.ok(done.stream_url && done.stream_url.includes('?st='), 'Phải cấp URL phát trực tuyến kèm chữ ký st');
  uploadedVideoResId = done.id;
  uploadedVideoStreamUrl = done.stream_url;

  // Thẻ <video> trình duyệt gửi GET kèm Range header mà KHÔNG có Authorization header (chỉ có ?st=...)
  const rangeRes = invokeApi('GET', uploadedVideoStreamUrl, { Range: 'bytes=0-511' });
  assert.equal(rangeRes.status, 206, 'Phải phản hồi 206 Partial Content khi có Range header');
  assert.equal(rangeRes.headers['Accept-Ranges'], 'bytes');
  assert.equal(rangeRes.headers['Content-Range'], 'bytes 0-511/2048');
  assert.equal(rangeRes.headers['Content-Length'], '512');
  assert.equal(rangeRes.rawBuffer.length, 512);
  assert.equal(Buffer.compare(rangeRes.rawBuffer, totalBuf.subarray(0, 512)), 0, 'Dữ liệu nhị phân mảnh 0-511 phải khớp tuyệt đối');

  // Tua tới giữa video (bytes=1000-1499)
  const seekRes = invokeApi('GET', uploadedVideoStreamUrl, { Range: 'bytes=1000-1499' });
  assert.equal(seekRes.status, 206);
  assert.equal(seekRes.headers['Content-Range'], 'bytes 1000-1499/2048');
  assert.equal(Buffer.compare(seekRes.rawBuffer, totalBuf.subarray(1000, 1500)), 0);

  // Chữ ký st bị giả mạo -> 401
  const tampered = invokeApi('GET', `${uploadedVideoStreamUrl}tampered`, { Range: 'bytes=0-127' });
  assert.equal(tampered.status, 401);
});

await t('PDF & VIDEO LINK', 'Tải tài liệu PDF có kiểm tra magic header %PDF- và xác thực nguồn link video', async () => {
  expectStatus(
    api('POST', '/media/pdfs', GV, {
      course_id: studioCourseId,
      title: 'Tệp giả mạo PDF',
      file_name: 'fake.pdf',
      data_base64: Buffer.from('NOT_A_PDF_FILE').toString('base64'),
    }),
    422,
    'INVALID_PDF'
  );

  const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
  const pdfDone = expectStatus(
    api('POST', '/media/pdfs', GV, {
      course_id: studioCourseId,
      title: 'Phiếu bài tập Toán 5 (PDF)',
      file_name: 'phieu-bai-tap.pdf',
      data_base64: validPdf.toString('base64'),
    }),
    201
  );
  assert.equal(pdfDone.resource_type, 'PDF');
  uploadedPdfResId = pdfDone.id;

  const ytOk = expectStatus(
    await apiAsync('POST', '/media/video-link/validate', GV, { url: 'https://youtu.be/dQw4w9WgXcQ?t=30' }),
    200
  );
  assert.equal(ytOk.source_type, 'YOUTUBE');
  assert.equal(ytOk.video_id, 'dQw4w9WgXcQ');

  const directOk = expectStatus(
    await apiAsync('POST', '/media/video-link/validate', GV, {
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    }),
    200
  );
  assert.equal(directOk.source_type, 'DIRECT_URL');

  expectStatus(
    await apiAsync('POST', '/media/video-link/validate', GV, { url: 'https://untrusted-pirate-video.example.org/movie.mp4' }),
    422
  );
});

// ---------------------------------------------------------------- 3. Question Bank & 5 Question Types
let qbSingleId;
let qbMultiId;

await t('QUESTION BANK', 'CRUD Ngân hàng câu hỏi với đủ 5 loại câu hỏi chuẩn', () => {
  qbSingleId = expectStatus(
    api('POST', `/courses/${studioCourseId}/question-bank`, GV, {
      question_type: 'SINGLE_CHOICE',
      prompt: 'Kết quả của 3/4 + 1/4 là bao nhiêu?',
      options: [
        { id: 'a', text: '1' },
        { id: 'b', text: '4/8' },
        { id: 'c', text: '3/8' },
      ],
      answer_key: { option_id: 'a' },
      points: 2,
      explanation: '3/4 + 1/4 = 4/4 = 1.',
      difficulty: 'EASY',
      tags: ['phân số', 'cộng'],
    }),
    201
  ).id;

  qbMultiId = expectStatus(
    api('POST', `/courses/${studioCourseId}/question-bank`, GV, {
      question_type: 'MULTIPLE_CHOICE',
      prompt: 'Chọn tất cả các phân số bằng 1/2:',
      options: [
        { id: 'a', text: '2/4' },
        { id: 'b', text: '3/5' },
        { id: 'c', text: '5/10' },
      ],
      answer_key: { option_ids: ['a', 'c'] },
      points: 2,
      explanation: '2/4 = 1/2 và 5/10 = 1/2.',
    }),
    201
  ).id;

  const tfId = expectStatus(
    api('POST', `/courses/${studioCourseId}/question-bank`, GV, {
      question_type: 'TRUE_FALSE',
      prompt: 'Mọi phân số có tử số nhỏ hơn mẫu số đều nhỏ hơn 1.',
      answer_key: { value: true },
      points: 1,
    }),
    201
  ).id;

  expectStatus(
    api('POST', `/courses/${studioCourseId}/question-bank`, GV, {
      question_type: 'FILL_BLANK',
      prompt: 'Điền số thích hợp: 0,25 viết dưới dạng phân số tối giản là ___',
      answer_key: { accepted: ['1/4', '1 / 4'], case_sensitive: false },
      points: 1.5,
    }),
    201
  );

  expectStatus(
    api('POST', `/courses/${studioCourseId}/question-bank`, GV, {
      question_type: 'SHORT_ANSWER',
      prompt: 'Nêu quy tắc cộng hai phân số khác mẫu số.',
      answer_key: { keywords: ['quy đồng', 'mẫu số'], sample_answer: 'Quy đồng mẫu số hai phân số rồi cộng tử số.' },
      points: 2,
    }),
    201
  );

  // Cập nhật và xóa mềm 1 câu
  const patched = expectStatus(
    api('PATCH', `/question-bank/${tfId}`, GV, { points: 1.5, difficulty: 'HARD' }),
    200
  );
  assert.equal(patched.points, 1.5);
  expectStatus(api('DELETE', `/question-bank/${tfId}`, GV), 200);

  const list = expectStatus(api('GET', `/courses/${studioCourseId}/question-bank`, GV), 200);
  assert.equal(list.items.length, 4, 'Còn 4 câu hỏi hoạt động sau khi xóa mềm 1 câu');
});

// ---------------------------------------------------------------- 4. All 15 Block Types, Security Allowlist & Versioning
const mainVideoBlockId = 'blk_uploaded_video_01';
const mainQuizBlockId = 'blk_standalone_quiz_01';

await t('15 BLOCK TYPES & SECURITY', 'Lưu trọn vẹn 15 loại khối chuẩn + chặn nhúng domain lạ + khôi phục phiên bản', () => {
  // Đính kèm thêm 1 tệp tài liệu thường cho khối file
  const fileResId = expectStatus(
    api('POST', `/courses/${studioCourseId}/resources`, GV, {
      title: 'Bảng công thức tóm tắt',
      resource_type: 'FILE',
      file_name: 'cong-thuc.txt',
      data_base64: Buffer.from('Tóm tắt kiến thức Toán 5', 'utf8').toString('base64'),
    }),
    201
  ).id;

  const cur = expectStatus(api('GET', `/lessons/${studioLessonId}`, GV), 200);

  // Thử nhúng domain không nằm trong allowlist -> phải bị chặn 422
  expectStatus(
    api('PUT', `/lessons/${studioLessonId}/content`, GV, {
      base_revision: cur.revision,
      blocks: [
        {
          block_type: 'embed',
          content: { provider: 'GEOGEBRA', embed_url: 'https://evil-xss.example.com/payload', title: 'Độc hại' },
        },
      ],
    }),
    422,
    'INVALID_BLOCK'
  );

  // Lưu đủ 15 loại khối nội dung chuẩn theo đặc tả Mục IV.3
  const blocks15 = [
    { block_type: 'heading', content: { level: 2, text: '1. Mở đầu bài giảng' } },
    { block_type: 'paragraph', content: { text: 'Trong bài học này, các em sẽ nắm vững khái niệm và phép tính phân số.' } },
    { block_type: 'image', content: { url: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb', alt: 'Minh họa toán học', caption: 'Hình 1.1' } },
    {
      id: mainVideoBlockId,
      block_type: 'video',
      content: {
        source_type: 'UPLOAD',
        resource_id: uploadedVideoResId,
        title: 'Video bài giảng chính (Tải lên hệ thống)',
        duration_seconds: 180,
        allow_seeking_ahead: false,
      },
    },
    { block_type: 'pdf', content: { resource_id: uploadedPdfResId, title: 'Phiếu bài tập thực hành PDF', height: 520, allow_download: true } },
    { block_type: 'file', content: { resource_id: fileResId, caption: 'Tệp công thức đính kèm' } },
    { block_type: 'table', content: { caption: 'Bảng quy đổi', headers: ['Phân số', 'Số thập phân'], rows: [['1/2', '0,5'], ['3/4', '0,75']] } },
    { block_type: 'math', content: { latex: '\\frac{a}{b} + \\frac{c}{b} = \\frac{a+c}{b}', caption: 'Cộng hai phân số cùng mẫu' } },
    { block_type: 'code', content: { language: 'python', code: 'from fractions import Fraction\nprint(Fraction(1, 2) + Fraction(1, 4))', caption: 'Kiểm chứng bằng Python' } },
    { block_type: 'quote', content: { text: 'Toán học là nữ hoàng của các ngành khoa học.', author: 'Carl Friedrich Gauss' } },
    { block_type: 'callout', content: { variant: 'TIP', title: 'Mẹo ghi nhớ nhanh', body: 'Luôn rút gọn phân số về tối giản sau khi tính.', display: { highlight: true } } },
    { block_type: 'link', content: { title: 'Cổng học liệu Bộ GD&ĐT', url: 'https://moet.gov.vn', description: 'Tài liệu tham khảo chính thống' } },
    {
      id: mainQuizBlockId,
      block_type: 'quiz',
      content: {
        quiz_kind: 'POST_LESSON',
        title: 'Kiểm tra cuối bài',
        pass_score_pct: 60,
        max_attempts: 3,
        is_required: true,
        questions: [
          {
            id: 'sq_1',
            question_type: 'SINGLE_CHOICE',
            prompt: 'Phân số nào lớn hơn 1?',
            options: [
              { id: 'a', text: '5/4' },
              { id: 'b', text: '3/4' },
            ],
            answer_key: { option_id: 'a' },
            points: 2,
          },
        ],
      },
    },
    { block_type: 'assignment', content: { title: 'Bài tập tự luyện tuần 1', instructions: 'Giải bài 1, 2, 3 trong phiếu PDF và nộp lời giải.', due_hint: 'Trước buổi học thứ Năm', max_score: 10, submission_type: 'BOTH' } },
    { block_type: 'embed', content: { provider: 'PHET', embed_url: 'https://phet.colorado.edu/sims/html/fractions-intro/latest/fractions-intro_vi.html', title: 'Mô phỏng Phân số PhET', height: 480, display: { collapsible: true } } },
  ];

  const saved = expectStatus(
    api('PUT', `/lessons/${studioLessonId}/content`, GV, { base_revision: cur.revision, blocks: blocks15 }),
    200
  );
  assert.equal(saved.blocks.length, 15, 'Phải lưu thành công trọn vẹn 15 khối nội dung chuẩn');

  // Gắn 5 mốc tương tác trên video (cố tình truyền không theo thứ tự thời gian để kiểm tra sắp xếp)
  const savedMarkers = expectStatus(
    api('PUT', `/lessons/${studioLessonId}/video-markers`, GV, {
      block_id: mainVideoBlockId,
      markers: [
        {
          id: 'mkr_fill',
          block_id: mainVideoBlockId,
          timestamp_sec: 120,
          behavior: 'PAUSE_AND_ASK',
          title: 'Điền khuyết tại 02:00',
          is_required: true,
          max_attempts: 2,
          question: {
            question_type: 'FILL_BLANK',
            prompt: '1/2 + 1/2 = ___',
            answer_key: { accepted: ['1', '2/2'], case_sensitive: false },
            points: 1,
          },
        },
        {
          id: 'mkr_sc',
          block_id: mainVideoBlockId,
          timestamp_sec: 25,
          behavior: 'PAUSE_AND_ASK',
          title: 'Trắc nghiệm 1 đáp án tại 00:25',
          is_required: true,
          max_attempts: 2,
          show_answer_after_submit: true,
          show_explanation: true,
          question_id: qbSingleId, // Kế thừa từ Ngân hàng câu hỏi!
        },
        {
          id: 'mkr_mc',
          block_id: mainVideoBlockId,
          timestamp_sec: 65,
          behavior: 'PAUSE_OPTIONAL',
          title: 'Chọn nhiều đáp án tại 01:05',
          is_required: false,
          allow_skip: true,
          max_attempts: 3,
          question_id: qbMultiId,
        },
        {
          id: 'mkr_short',
          block_id: mainVideoBlockId,
          timestamp_sec: 150,
          behavior: 'PAUSE_OPTIONAL',
          title: 'Tự luận ngắn tại 02:30',
          is_required: false,
          max_attempts: 2,
          question: {
            question_type: 'SHORT_ANSWER',
            prompt: 'Muốn rút gọn phân số ta chia cả tử và mẫu cho đại lượng nào?',
            answer_key: { keywords: ['ước chung', 'chia hết'] },
            points: 2,
          },
        },
        {
          id: 'mkr_info',
          block_id: mainVideoBlockId,
          timestamp_sec: 10,
          behavior: 'INFO_ONLY',
          title: 'Ghi chú đầu bài 00:10',
          info_body: 'Chuẩn bị giấy nháp trước khi xem ví dụ.',
        },
      ],
    }),
    200
  ).items;

  assert.equal(savedMarkers.length, 5);
  assert.deepEqual(
    savedMarkers.map((m) => m.timestamp_sec),
    [10, 25, 65, 120, 150],
    'API phải tự động sắp xếp các mốc tương tác tăng dần theo timestamp_sec'
  );

  // Xuất bản v1 kèm ghi chú phiên bản -> sửa nháp tạm -> khôi phục lại v1
  const pub1 = expectStatus(
    api('POST', `/lessons/${studioLessonId}/publish`, GV, { change_note: 'Bản xuất bản chuẩn đủ 15 khối và 5 mốc video' }),
    200
  );
  assert.equal(pub1.published_version, 1);

  expectStatus(
    api('PUT', `/lessons/${studioLessonId}/content`, GV, {
      base_revision: saved.revision,
      blocks: [{ block_type: 'heading', content: { level: 2, text: 'Bản nháp tạm thời' } }],
    }),
    200
  );

  const versions = expectStatus(api('GET', `/lessons/${studioLessonId}/versions`, GV), 200);
  assert.equal(versions.items.length, 1);
  assert.equal(versions.items[0].blocks_count, 15);
  assert.equal(versions.items[0].markers_count, 5);

  const restored = expectStatus(api('POST', `/lessons/${studioLessonId}/versions/1/restore`, GV), 200);
  assert.equal(restored.blocks.length, 15, 'Khôi phục phiên bản v1 phải trả lại đúng 15 khối nội dung');
  assert.equal(restored.video_markers.length, 5, 'Khôi phục phiên bản v1 phải trả lại đúng 5 mốc quiz video');

  // Xuất bản khóa học để mở cho lớp học
  expectStatus(api('POST', `/courses/${studioCourseId}/status`, GV, { status: 'PUBLISHED' }), 200);
});

// ---------------------------------------------------------------- 5. Interactive Video Quiz Learner Flow & Edge Cases
let testClassId;

await t('VIDEO QUIZ LEARNER', 'Ẩn tuyệt đối đáp án phía học viên, lưu Resume Playback, chống gửi trùng idempotency_key & giới hạn số lần thử', () => {
  const GA = STAFF; // Giáo vụ khoa
  testClassId = expectStatus(
    api('POST', '/classes', GV, {
      code: 'STUDIO-5A1',
      title: 'Lớp Thực nghiệm Video Quiz 5A1',
      course_id: studioCourseId,
      status: 'ACTIVE',
    }),
    201
  ).id;

  expectStatus(api('POST', `/classes/${testClassId}/students`, GA, { students: ['HS50101'] }), 200);

  // 1. Học viên mở bài học: kiểm tra KHÔNG lộ bất kỳ answer_key hay đáp án đúng nào!
  const view1 = expectStatus(api('GET', `/learn/classes/${testClassId}/lessons/${studioLessonId}`, HS5A1), 200);
  assert.equal(view1.blocks.length, 15);
  assert.equal(view1.video_markers.length, 5);
  for (const m of view1.video_markers) {
    if (m.question) {
      assert.equal(m.question.answer_key, undefined, `Không được lộ answer_key ở mốc ${m.id}`);
      assert.equal(m.question.correct_answer, undefined, `Không được lộ correct_answer khi chưa nộp bài ở mốc ${m.id}`);
      assert.equal(m.question.explanation, undefined, `Không được lộ giải thích khi chưa nộp bài ở mốc ${m.id}`);
    }
  }
  const quizBlockStudent = view1.blocks.find((b) => b.id === mainQuizBlockId);
  assert.equal(quizBlockStudent.content.questions[0].answer_key, undefined, 'Quiz độc lập cũng phải ẩn answer_key');

  // 2. Lưu tiến độ xem video (Resume Playback) & kiểm tra tải lại vẫn giữ nguyên vị trí
  const vp1 = expectStatus(
    api('PUT', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-progress`, HS5A1, {
      block_id: mainVideoBlockId,
      last_position_sec: 48.5,
      watched_seconds: 50,
      duration_sec: 180,
    }),
    200
  );
  assert.equal(vp1.last_position_sec, 48.5);
  assert.equal(vp1.watch_pct, 28);

  const viewReload = expectStatus(api('GET', `/learn/classes/${testClassId}/lessons/${studioLessonId}`, HS5A1), 200);
  assert.equal(viewReload.video_progress[mainVideoBlockId].last_position_sec, 48.5, 'Tải lại trang phải nhớ vị trí video 48.5s');

  // 3. Thử hoàn thành bài học khi mới xem 28% (< 80%) -> bị chặn 422
  expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/complete`, HS5A1, {}),
    422,
    'COMPLETION_CRITERIA_NOT_MET'
  );

  // 4. Nộp sai lần 1 ở mốc mkr_sc (max_attempts = 2) -> can_retry = true, chưa lộ correct_answer
  const idem1 = 'idem-mkr-sc-attempt-1';
  const subWrong1 = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_sc/submit`, HS5A1, {
      idempotency_key: idem1,
      response: { option_id: 'b' },
    }),
    200
  );
  assert.equal(subWrong1.is_correct, false);
  assert.equal(subWrong1.attempt_number, 1);
  assert.equal(subWrong1.can_retry, true);
  assert.equal(subWrong1.can_continue, false, 'Mốc PAUSE_AND_ASK bắt buộc khi còn lượt thử thì yêu cầu trả lời lại');
  assert.equal(subWrong1.correct_answer, undefined, 'Chưa hết lượt thử thì chưa tiết lộ đáp án đúng');

  // 5. Gửi trùng cùng idempotency_key (mô phỏng sự kiện timeupdate/click kép) -> deduplicated = true, không tốn lượt 2!
  const subDup = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_sc/submit`, HS5A1, {
      idempotency_key: idem1,
      response: { option_id: 'b' },
    }),
    200
  );
  assert.equal(subDup.deduplicated, true);
  assert.equal(subDup.attempt_number, 1);

  // 6. Nộp sai lần 2 (hết lượt thử max_attempts = 2) -> can_retry = false, tiết lộ correct_answer, mở khóa can_continue = true; nộp lần 3 -> 409!
  const subWrong2 = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_sc/submit`, HS5A1, {
      idempotency_key: 'idem-mkr-sc-attempt-2',
      response: { option_id: 'c' },
    }),
    200
  );
  assert.equal(subWrong2.attempt_number, 2);
  assert.equal(subWrong2.can_retry, false);
  assert.equal(subWrong2.can_continue, true);
  assert.deepEqual(subWrong2.correct_answer, { correct_option_ids: ['a'] });

  expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_sc/submit`, HS5A1, {
      response: { option_id: 'a' },
    }),
    409,
    'MAX_ATTEMPTS_REACHED'
  );

  // 7. Chấm điểm MULTIPLE_CHOICE, FILL_BLANK và SHORT_ANSWER
  const mcOk = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_mc/submit`, HS5A1, {
      response: { option_ids: ['c', 'a'] },
    }),
    200
  );
  assert.equal(mcOk.is_correct, true);
  assert.equal(mcOk.earned_points, 2);

  const fillOk = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_fill/submit`, HS5A1, {
      response: { text: ' 2/2 ' },
    }),
    200
  );
  assert.equal(fillOk.is_correct, true);

  const shortOk = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-markers/mkr_short/submit`, HS5A1, {
      response: { text: 'Ta chia cả tử và mẫu cho ước chung lớn nhất mà chúng cùng chia hết.' },
    }),
    200
  );
  assert.equal(shortOk.is_correct, true);

  // 8. Cập nhật xem video đạt 90% (>= 80%), thử hoàn thành khi chưa nộp Quiz độc lập bắt buộc -> 422; nộp Quiz -> Hoàn thành 200!
  expectStatus(
    api('PUT', `/learn/classes/${testClassId}/lessons/${studioLessonId}/video-progress`, HS5A1, {
      block_id: mainVideoBlockId,
      last_position_sec: 165,
      watched_seconds: 165,
      duration_sec: 180,
    }),
    200
  );

  expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/complete`, HS5A1, {}),
    422,
    'COMPLETION_CRITERIA_NOT_MET'
  );

  const quizSub = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/quizzes/${mainQuizBlockId}/submit`, HS5A1, {
      responses: { sq_1: { option_id: 'a' } },
    }),
    200
  );
  assert.equal(quizSub.is_correct, true);
  assert.equal(quizSub.score_pct, 100);

  const completed = expectStatus(
    api('POST', `/learn/classes/${testClassId}/lessons/${studioLessonId}/complete`, HS5A1, {}),
    200
  );
  assert.equal(completed.progress_status, 'COMPLETED');

  // 9. Giảng viên xem bảng thống kê tiến độ video & điểm quiz theo lớp
  const analytics = expectStatus(
    api('GET', `/classes/${testClassId}/lessons/${studioLessonId}/quiz-analytics`, GV),
    200
  );
  assert.equal(analytics.students.length, 1);
  assert.ok(analytics.students[0].video_watch_pct >= 90);
  assert.equal(analytics.students[0].lesson_status, 'COMPLETED');
  assert.ok(analytics.students[0].earned_points > 0);
});

// ---------------------------------------------------------------- 6. Mode B — Class Teaching Content Isolation
await t('STUDIO MODE B', 'Tùy biến giáo án & video quiz riêng cho lớp 5A1 KHÔNG ảnh hưởng khóa học gốc hay lớp 5A2', () => {
  // Đếm số khối gốc của les_101 trước khi tùy biến lớp 5A1
  const origCourseLesson = expectStatus(api('GET', '/lessons/les_101', GV), 200);
  const origBlockCount = origCourseLesson.blocks.length;
  const origMarkerCount = origCourseLesson.video_markers.length;

  // Khi chưa được cấp can_manage_materials, trợ giảng không có quyền sửa nội dung riêng của lớp
  const clsStudioBefore = expectStatus(api('GET', '/studio/classes/sc_toan5_5a1/lessons/les_101', TA), 200);
  assert.equal(clsStudioBefore.capabilities.can_edit, false);
  expectStatus(
    api('PUT', '/studio/classes/sc_toan5_5a1/lessons/les_101/content', TA, { base_revision: 1, custom_blocks: [] }),
    403,
    'CLASS_CONTENT_FORBIDDEN'
  );

  // Giảng viên / Giáo vụ cấp quyền quản lý học liệu (can_manage_materials = true) cho trợ giảng trên lớp 5A1
  db.prepare(
    `UPDATE teaching_staff_assignments
     SET permissions_json = '{"can_manage_materials":true,"can_take_attendance":true}'
     WHERE subject_class_id = 'sc_toan5_5a1' AND staff_role = 'TEACHING_ASSISTANT'`
  ).run();

  // Trợ giảng (có quyền can_manage_materials) được phép lưu bản nháp tùy biến cho lớp 5A1 nhưng không được xuất bản
  const clsStudio = expectStatus(api('GET', '/studio/classes/sc_toan5_5a1/lessons/les_101', TA), 200);
  assert.equal(clsStudio.capabilities.can_edit, true);
  assert.equal(clsStudio.capabilities.can_publish, false);

  const savedCustom = expectStatus(
    api('PUT', '/studio/classes/sc_toan5_5a1/lessons/les_101/content', TA, {
      base_revision: clsStudio.custom.revision,
      instructor_note: 'Lưu ý riêng cho lớp 5A1: Ôn kỹ bài tập nâng cao số 4 trước buổi kiểm tra thứ Sáu.',
      custom_objectives: 'Giải thành thạo bài toán tổng-tỉ mở rộng cho lớp 5A1.',
      custom_blocks: [
        {
          id: 'cblk_5a1_extra_note',
          block_type: 'callout',
          anchor_block_id: 'blk_101_vid1',
          content: {
            variant: 'IMPORTANT',
            title: 'Dặn dò riêng cho tập thể lớp 5A1',
            body: 'Các em hoàn thành thêm câu hỏi tương tác ở mốc 01:15 dành riêng cho lớp 5A1.',
          },
        },
      ],
    }),
    200
  );
  assert.equal(savedCustom.custom_blocks.length, 1);

  // Gắn thêm 1 mốc câu hỏi tương tác riêng cho lớp 5A1 trên chính khối video kế thừa blk_101_vid1
  expectStatus(
    api('PUT', '/studio/classes/sc_toan5_5a1/lessons/les_101/video-markers', TA, {
      markers: [
        {
          id: 'vqm_5a1_only',
          block_id: 'blk_101_vid1',
          timestamp_sec: 75,
          behavior: 'PAUSE_OPTIONAL',
          title: 'Câu hỏi mở rộng riêng lớp 5A1 (01:15)',
          question: {
            question_type: 'TRUE_FALSE',
            prompt: 'Phân số 6/8 sau khi rút gọn cho 2 sẽ bằng 3/4.',
            answer_key: { value: true },
            points: 1,
          },
        },
      ],
    }),
    200
  );

  // Trợ giảng cố xuất bản -> 403
  expectStatus(api('POST', '/studio/classes/sc_toan5_5a1/lessons/les_101/publish', TA), 403, 'CLASS_PUBLISH_FORBIDDEN');

  // Khi chưa xuất bản, học viên 5A1 chưa thấy khối nháp của lớp
  const beforePub5A1 = expectStatus(api('GET', '/learn/classes/sc_toan5_5a1/lessons/les_101', HS5A1), 200);
  assert.equal(beforePub5A1.blocks.some((b) => b.id === 'cblk_5a1_extra_note'), false);

  // Giảng viên chính Cô Lê Thu Hà xuất bản nội dung riêng của lớp 5A1
  expectStatus(api('POST', '/studio/classes/sc_toan5_5a1/lessons/les_101/publish', GV), 200);

  // Học viên lớp 5A1 thấy đầy đủ nội dung kế thừa + khối bổ sung 5A1 + mốc quiz 01:15 riêng 5A1!
  const afterPub5A1 = expectStatus(api('GET', '/learn/classes/sc_toan5_5a1/lessons/les_101', HS5A1), 200);
  assert.equal(afterPub5A1.blocks.some((b) => b.id === 'cblk_5a1_extra_note' && b.origin === 'CLASS_CUSTOM'), true);
  assert.equal(afterPub5A1.video_markers.some((m) => m.id === 'vqm_5a1_only' && m.origin === 'CLASS_CUSTOM'), true);
  assert.ok(afterPub5A1.class_custom_note?.instructor_note.includes('5A1'));

  // Học viên lớp 5A2 (cùng học khóa TOAN5-2026!) TUYỆT ĐỐI KHÔNG thấy nội dung riêng của lớp 5A1!
  const view5A2 = expectStatus(api('GET', '/learn/classes/sc_toan5_5a2/lessons/les_101', HS5A2), 200);
  assert.equal(view5A2.blocks.some((b) => b.id === 'cblk_5a1_extra_note'), false, 'Lớp 5A2 không bị ảnh hưởng bởi nội dung riêng lớp 5A1');
  assert.equal(view5A2.video_markers.some((m) => m.id === 'vqm_5a1_only'), false, 'Lớp 5A2 không thấy mốc quiz riêng lớp 5A1');

  // Khóa học gốc TOAN5-2026 giữ nguyên 100% số khối và số mốc gốc!
  const afterCourseLesson = expectStatus(api('GET', '/lessons/les_101', GV), 200);
  assert.equal(afterCourseLesson.blocks.length, origBlockCount, 'Khóa học gốc không bị thay đổi số khối');
  assert.equal(afterCourseLesson.video_markers.length, origMarkerCount, 'Khóa học gốc không bị thay đổi mốc video');
});

// ---------------------------------------------------------------- 7. Regression Audit — Thumbnail Data URL, Idempotent Chunk, HEAD/GET Stream, TA Metadata, Mode B Snapshot Isolation
await t('REGRESSION AUDIT', 'Ảnh bìa base64 khi tải video, gửi lại chunk idempotent, HEAD/GET stream, quyền trợ giảng sửa metadata & cô lập bản nháp Mode B sau xuất bản', () => {
  // 1. Idempotent chunk retry + thumbnail_data_url + lưu khối video có data:image/... không gây lỗi 422
  const miniMp4 = Buffer.alloc(1024);
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]).copy(miniMp4, 0);
  const initThumb = expectStatus(
    api('POST', '/media/videos/init', GV, {
      course_id: studioCourseId,
      title: 'Video kiểm thử ảnh bìa tự động',
      file_name: 'thumb-check.mp4',
      total_size_bytes: miniMp4.length,
      total_chunks: 1,
      duration_seconds: 45,
    }),
    201
  );
  // Gửi lặp cùng chunk_index = 0 hai lần (mô phỏng mạng chập chờn retry)
  expectStatus(
    api('PUT', `/media/videos/${initThumb.upload_id}/chunk`, GV, {
      chunk_index: 0,
      data_base64: miniMp4.toString('base64'),
    }),
    200
  );
  expectStatus(
    api('PUT', `/media/videos/${initThumb.upload_id}/chunk`, GV, {
      chunk_index: 0,
      data_base64: miniMp4.toString('base64'),
    }),
    200
  );
  const sampleDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const doneThumb = expectStatus(
    api('POST', `/media/videos/${initThumb.upload_id}/complete`, GV, {
      duration_seconds: 45,
      thumbnail_data_url: sampleDataUrl,
    }),
    201
  );
  assert.equal(doneThumb.thumbnail_url, sampleDataUrl, 'complete phải lưu thumbnail_data_url vào learning_resources');

  const curLes = expectStatus(api('GET', `/lessons/${studioLessonId}`, GV), 200);
  const blocksWithThumb = curLes.blocks.map((b) =>
    b.id === mainVideoBlockId
      ? {
          id: b.id,
          block_type: 'video',
          content: {
            ...b.content,
            resource_id: doneThumb.id,
            thumbnail_url: sampleDataUrl,
          },
        }
      : { id: b.id, block_type: b.block_type, content: b.content }
  );
  const savedWithThumb = expectStatus(
    api('PUT', `/lessons/${studioLessonId}/content`, GV, {
      base_revision: curLes.revision,
      blocks: blocksWithThumb,
    }),
    200
  );
  const updatedVidBlk = savedWithThumb.blocks.find((b) => b.id === mainVideoBlockId);
  assert.ok(!updatedVidBlk.content.thumbnail_url, 'Không nhân bản chuỗi base64 ảnh bìa trong content_json của khối');

  // 2. Non-Range GET và HEAD trên /media/:id/stream?st=...
  const fullGet = invokeApi('GET', uploadedVideoStreamUrl, {});
  assert.equal(fullGet.status, 200);
  assert.equal(fullGet.headers['Accept-Ranges'], 'bytes');
  assert.equal(fullGet.headers['Content-Length'], '2048');
  assert.equal(fullGet.rawBuffer.length, 2048);

  const headRes = invokeApi('HEAD', uploadedVideoStreamUrl, {});
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers['Accept-Ranges'], 'bytes');
  assert.equal(headRes.headers['Content-Length'], '2048');

  // 3. PATCH /question-bank/:id phải lưu lại tags mới
  const patchedQb = expectStatus(
    api('PATCH', `/question-bank/${qbSingleId}`, GV, { tags: ['phân số', 'ôn tập học kỳ'] }),
    200
  );
  assert.deepEqual(patchedQb.tags, ['phân số', 'ôn tập học kỳ']);

  // 4. Trợ giảng có can_manage_materials = true được phép cập nhật thông tin bài học nháp (PATCH /lessons/:id)
  const les101Before = expectStatus(api('GET', '/lessons/les_101', TA), 200);
  const patchedByTa = expectStatus(
    api('PATCH', '/lessons/les_101', TA, { summary: les101Before.summary || 'Tóm tắt bài học cập nhật bởi trợ giảng' }),
    200
  );
  assert.ok(patchedByTa.id === 'les_101');

  // 5. Cô lập bản nháp Mode B sau khi đã xuất bản v1: sửa nháp v2 chưa xuất bản KHÔNG được lộ sang học viên
  const studio5A1Cur = expectStatus(api('GET', '/studio/classes/sc_toan5_5a1/lessons/les_101', TA), 200);
  expectStatus(
    api('PUT', '/studio/classes/sc_toan5_5a1/lessons/les_101/content', TA, {
      base_revision: studio5A1Cur.custom.revision,
      instructor_note: 'BẢN NHÁP CHƯA XUẤT BẢN V2',
      custom_objectives: studio5A1Cur.custom.custom_objectives,
      custom_blocks: [
        ...studio5A1Cur.custom_blocks,
        {
          id: 'cblk_5a1_unpub_v2',
          block_type: 'paragraph',
          content: { text: 'Nội dung nháp v2 đang soạn dở chưa xuất bản.' },
        },
      ],
    }),
    200
  );
  expectStatus(
    api('PUT', '/studio/classes/sc_toan5_5a1/lessons/les_101/video-markers', TA, {
      markers: [
        ...studio5A1Cur.custom_markers,
        {
          id: 'vqm_5a1_unpub_v2',
          block_id: 'blk_101_vid1',
          timestamp_sec: 95,
          behavior: 'PAUSE_AND_ASK',
          is_required: true,
          title: 'Mốc nháp chưa xuất bản 01:35',
          question: {
            question_type: 'TRUE_FALSE',
            prompt: 'Câu hỏi nháp chưa xuất bản',
            answer_key: { value: true },
            points: 1,
          },
        },
      ],
    }),
    200
  );

  const studentViewDuringDraft = expectStatus(api('GET', '/learn/classes/sc_toan5_5a1/lessons/les_101', HS5A1), 200);
  assert.equal(studentViewDuringDraft.blocks.some((b) => b.id === 'cblk_5a1_extra_note'), true, 'Học viên vẫn thấy bản xuất bản v1');
  assert.equal(studentViewDuringDraft.blocks.some((b) => b.id === 'cblk_5a1_unpub_v2'), false, 'Không được lộ khối nháp v2 chưa xuất bản');
  assert.equal(studentViewDuringDraft.video_markers.some((m) => m.id === 'vqm_5a1_unpub_v2'), false, 'Không được lộ mốc nháp v2 chưa xuất bản');
  assert.notEqual(studentViewDuringDraft.class_custom_note?.instructor_note, 'BẢN NHÁP CHƯA XUẤT BẢN V2');

  // Sau khi GV xuất bản v2 -> học viên mới thấy đầy đủ bản mới
  expectStatus(api('POST', '/studio/classes/sc_toan5_5a1/lessons/les_101/publish', GV), 200);
  const studentViewAfterPub2 = expectStatus(api('GET', '/learn/classes/sc_toan5_5a1/lessons/les_101', HS5A1), 200);
  assert.equal(studentViewAfterPub2.blocks.some((b) => b.id === 'cblk_5a1_unpub_v2'), true, 'Sau khi xuất bản v2 học viên thấy khối mới');
  assert.equal(studentViewAfterPub2.video_markers.some((m) => m.id === 'vqm_5a1_unpub_v2'), true, 'Sau khi xuất bản v2 học viên thấy mốc mới');
});

// Dọn tệp tạm của phiên kiểm thử
try {
  db.close();
  fs.rmSync(TMP_DB, { force: true });
  fs.rmSync(`${TMP_DB}-wal`, { force: true });
  fs.rmSync(`${TMP_DB}-shm`, { force: true });
  fs.rmSync(TMP_UPLOADS, { recursive: true, force: true });
} catch {
  // ignore cleanup lock on Windows
}

console.log('======================================================================');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
if (failed > 0) process.exit(1);
