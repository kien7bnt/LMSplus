#!/usr/bin/env node
/**
 * LMSPLUS — Kiểm thử tích hợp toàn diện module Virtual Classroom (Phòng học trực tuyến,
 * Đồng bộ người tham gia đa nền tảng & Tự động điểm danh).
 * Bao phủ đầy đủ 15 kịch bản bắt buộc trong Mục XII + Bảo mật RBAC, HMAC Webhook, Interval Union.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `virtual-classroom-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-virtual-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { initSchemaAndSeed, invokeApi, invokeApiAsync, db } = await import('../backend/server_fallback.mjs');
const { getVirtualProviderAdapter, EXTERNAL_NO_SYNC_NOTICE } = await import('../backend/teaching/virtualProviders.mjs');
const { mergeTimeIntervals } = await import('../backend/teaching/virtualClassroom.mjs');

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

const login = (identifier) => {
  const r = invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier, password: '123456' });
  assert.equal(r.status, 200, `login ${identifier}`);
  return { authorization: `Bearer ${r.body.data.access_token}` };
};

const T = '/api/v1/teaching';
const apiAsync = (method, url, headers, body) => invokeApiAsync(method, `${T}${url}`, headers, body);
const expectStatus = (r, status, code) => {
  assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
  if (code) assert.equal(r.body.detail?.code, code);
  return r.body.data;
};

const GV = login('thuha.gv@lmsplus.edu.vn'); // Giảng viên lớp 5A1
const GV2 = login('vankhoa.gv@lmsplus.edu.vn'); // Giảng viên lớp 5A2
const ADMIN = login('admin@lmsplus.edu.vn');
const HS1 = login('HS50101'); // Học sinh thuộc lớp 5A1 (Nguyễn Minh Anh)
const HS2 = login('HS50102'); // Học sinh thuộc lớp 5A1
const HS3 = login('HS50103'); // Học sinh thuộc lớp 5A1
const HS4 = login('HS50104'); // Học sinh thuộc lớp 5A1
const HS_OTHER_CLASS = login('HS50201'); // Học sinh lớp 5A2 (không thuộc lớp 5A1)

const hs1Row = db.prepare("SELECT * FROM users WHERE code = 'HS50101'").get();
const hs2Row = db.prepare("SELECT * FROM users WHERE code = 'HS50102'").get();
const hs3Row = db.prepare("SELECT * FROM users WHERE code = 'HS50103'").get();
const hs4Row = db.prepare("SELECT * FROM users WHERE code = 'HS50104'").get();

console.log('======================================================================');
console.log(' LMSPLUS — VIRTUAL CLASSROOM & AUTO-ATTENDANCE TEST SUITE (15 CASES)');
console.log('======================================================================');

let zoomSessionId = null;
let zoomMeetingId = null;
let externalSessionId = null;

// ---------------------------------------------------------------- Case 1: Tạo buổi học có phòng Zoom tự động
await t('CASE-01', 'Tạo buổi học trực tuyến từ lớp học hiện có với phòng Zoom tự động', async () => {
  const createRes = await apiAsync('POST', '/classes/sc_toan5_5a1/sessions', GV, {
    title: 'Buổi chuyên đề trực tuyến: Tỉ số phần trăm',
    teaching_content: 'Giải bài toán tìm tỉ số phần trăm và ứng dụng thực tế',
    delivery_mode: 'ONLINE',
    date: '2026-11-28',
    start_time: '14:00',
    end_time: '15:30',
    virtual_room_config: {
      mode: 'CREATE_NEW',
      provider: 'ZOOM',
      room_title: '5A1 — Tỉ số phần trăm (Zoom)',
      passcode: '501999',
    },
  });
  const created = expectStatus(createRes, 201);
  assert.equal(created.created_count, 1);
  zoomSessionId = created.created_ids[0];
  assert.ok(zoomSessionId);

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  assert.ok(detail.room, 'Phải gắn phòng Zoom thành công');
  assert.equal(detail.room.provider, 'ZOOM');
  assert.equal(detail.room.supports_auto_sync, true);
  assert.ok(detail.room.external_meeting_id);
  assert.ok(detail.room.join_url.includes('zoom.us/j/'));
  assert.equal(detail.room.passcode, '501999');
  assert.equal(detail.room.has_host_start_url, true);
  // Không lộ raw host_start_url trong GET summary
  assert.equal(detail.room.host_start_url, undefined);
  zoomMeetingId = detail.room.raw_meeting_id || detail.room.external_meeting_id;
});

// ---------------------------------------------------------------- Case 2: Tạo buổi học có link phòng nhập tay (External Link)
await t('CASE-02', 'Tạo buổi học có link phòng bên ngoài nhập tay & hiển thị rõ cảnh báo không giả lập điểm danh', async () => {
  const createRes = await apiAsync('POST', '/classes/sc_toan5_5a1/sessions', GV, {
    title: 'Buổi thảo luận nhóm qua Microsoft Teams',
    delivery_mode: 'ONLINE',
    date: '2026-11-29',
    start_time: '14:00',
    end_time: '15:30',
    virtual_room_config: {
      mode: 'EXTERNAL_LINK',
      provider: 'EXTERNAL',
      external_platform_name: 'Microsoft Teams',
      room_title: 'Phòng Teams Lớp 5A1',
      join_url: 'https://teams.microsoft.com/l/meetup-join/5a1-teams-room',
      meeting_code: 'TEAMS-5A1-01',
      passcode: '123456',
    },
  });
  const created = expectStatus(createRes, 201);
  externalSessionId = created.created_ids[0];

  const detail = expectStatus(await apiAsync('GET', `/sessions/${externalSessionId}/virtual-room`, GV), 200);
  assert.equal(detail.room.provider, 'EXTERNAL');
  assert.equal(detail.room.supports_auto_sync, false);
  assert.equal(detail.room.sync_notice, EXTERNAL_NO_SYNC_NOTICE);
  assert.equal(detail.room.sync_notice, 'Chưa hỗ trợ đồng bộ điểm danh tự động với nền tảng này');
  // Không giả lập số lượng người tham gia hoặc kết quả điểm danh
  assert.equal(detail.live_stats.current_in_room, null);
  assert.equal(detail.live_stats.total_unique_joined, null);
});

// ---------------------------------------------------------------- Case 3: Sửa thông tin buổi học không tạo phòng mới trùng lặp
await t('CASE-03', 'Chỉnh sửa tên hoặc nội dung buổi học giữ nguyên phòng trực tuyến hiện có (không tự tạo phòng mới)', async () => {
  const beforeDetail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const originalRoomId = beforeDetail.room.id;
  const originalMeetingId = beforeDetail.room.external_meeting_id;

  const patchRes = await apiAsync('PATCH', `/sessions/${zoomSessionId}`, GV, {
    title: 'Buổi chuyên đề trực tuyến: Tỉ số phần trăm (Đã cập nhật tiêu đề)',
    teaching_content: 'Cập nhật nội dung bài giảng mới nhất',
  });
  expectStatus(patchRes, 200);

  const afterDetail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  assert.equal(afterDetail.session.title, 'Buổi chuyên đề trực tuyến: Tỉ số phần trăm (Đã cập nhật tiêu đề)');
  assert.equal(afterDetail.room.id, originalRoomId, 'Không được tạo phòng mới khi chỉ sửa tên/nội dung');
  assert.equal(afterDetail.room.external_meeting_id, originalMeetingId);
});

// ---------------------------------------------------------------- Case 4: Học viên thuộc lớp tham gia phòng học & không lộ host_start_url
let hs1JoinToken = null;
await t('CASE-04', 'Học viên thuộc lớp tham gia phòng học trực tuyến, nhận LMS_JOIN_TOKEN & bảo vệ host_start_url', async () => {
  const joinRes = await apiAsync('POST', `/sessions/${zoomSessionId}/virtual-room/join`, HS1);
  const joinData = expectStatus(joinRes, 200);
  assert.ok(joinData.join_url.includes('zoom.us/j/'));
  assert.ok(joinData.lms_join_token, 'Phải sinh lms_join_token cho học viên thuộc lớp');
  assert.equal(joinData.host_start_url, undefined, 'Tuyệt đối không trả host_start_url cho học viên');
  hs1JoinToken = joinData.lms_join_token;

  // Học viên gọi start-host phải bị chặn 403
  const startAttempt = await apiAsync('POST', `/sessions/${zoomSessionId}/virtual-room/start`, HS1);
  expectStatus(startAttempt, 403, 'CLASS_ACTION_FORBIDDEN');
});

// ---------------------------------------------------------------- Case 5: Học viên không thuộc lớp bị chặn truy cập
await t('CASE-05', 'Học viên lớp khác hoặc giảng viên không phụ trách lớp bị chặn truy cập phòng trực tuyến', async () => {
  const joinOtherStudent = await apiAsync('POST', `/sessions/${zoomSessionId}/virtual-room/join`, HS_OTHER_CLASS);
  expectStatus(joinOtherStudent, 403, 'CLASS_ACCESS_DENIED');

  const viewOtherInstructor = await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV2);
  expectStatus(viewOtherInstructor, 403, 'CLASS_ACCESS_DENIED');
});

// Helper gửi Zoom Webhook có chữ ký HMAC-SHA256 thật
const zoomAdapter = getVirtualProviderAdapter(db, 'ZOOM');
async function sendSignedZoomWebhook(payloadObj) {
  const rawBody = JSON.stringify(payloadObj);
  const signedHeaders = zoomAdapter.signWebhookPayload(rawBody);
  return invokeApiAsync('POST', `${T}/webhooks/zoom`, signedHeaders, payloadObj);
}

// ---------------------------------------------------------------- Case 6: Nhận webhook meeting.started & xác thực chữ ký HMAC-SHA256
await t('CASE-06', 'Xác thực chữ ký HMAC-SHA256 trên Webhook Zoom & xử lý sự kiện meeting.started (chặn chữ ký giả / replay)', async () => {
  // 6a. Chữ ký giả phải bị từ chối 401
  const fakeRes = await invokeApiAsync(
    'POST',
    `${T}/webhooks/zoom`,
    {
      'x-zm-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-zm-signature': 'v0=invalid_hmac_signature_123456',
    },
    { event: 'meeting.started', payload: { object: { id: zoomMeetingId } } }
  );
  expectStatus(fakeRes, 401, 'INVALID_WEBHOOK_SIGNATURE');

  // 6b. Chữ ký hợp lệ cho meeting.started
  const startEvent = {
    event: 'meeting.started',
    event_ts: Date.now(),
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        uuid: 'zm_uuid_case06',
        start_time: '2026-11-28T07:00:00.000Z', // 14:00 VN
      },
    },
  };
  const okRes = await sendSignedZoomWebhook(startEvent);
  const okData = expectStatus(okRes, 200);
  assert.equal(okData.received, true);

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  assert.equal(detail.session.live_status, 'LIVE');
});

// ---------------------------------------------------------------- Case 7: Nhận webhook participant_joined
await t('CASE-07', 'Nhận sự kiện meeting.participant_joined và cập nhật số lượng người đang tham gia trực tiếp', async () => {
  // HS1 vào đúng giờ (14:02 VN = 07:02 UTC)
  const joinEv = {
    event: 'meeting.participant_joined',
    event_ts: Date.now() + 10,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_part_hs1_1',
          user_name: hs1Row.full_name,
          email: hs1Row.email,
          join_time: '2026-11-28T07:02:00.000Z',
        },
      },
    },
  };
  expectStatus(await sendSignedZoomWebhook(joinEv), 200);

  const midDetail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  assert.ok(midDetail.live_stats.current_in_room >= 1, 'Số người đang trong phòng phải tăng lên khi join');
});

// ---------------------------------------------------------------- Case 8: Nhận webhook participant_left
await t('CASE-08', 'Nhận sự kiện meeting.participant_left và tính thời lượng phiên tham gia thực tế', async () => {
  // HS1 ở tới 15:25 VN (08:25 UTC) -> 83 phút / 90 phút = 92.2% -> PRESENT
  const leaveEv = {
    event: 'meeting.participant_left',
    event_ts: Date.now() + 20,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_part_hs1_1',
          user_name: hs1Row.full_name,
          email: hs1Row.email,
          join_time: '2026-11-28T07:02:00.000Z',
          leave_time: '2026-11-28T08:25:00.000Z',
        },
      },
    },
  };
  expectStatus(await sendSignedZoomWebhook(leaveEv), 200);
});

// ---------------------------------------------------------------- Case 9: Học viên vào rồi rời phòng nhiều lần
await t('CASE-09', 'Học viên vào và rời phòng nhiều lần do rớt mạng (13:05-13:40, 13:45-14:10, 14:15-14:50 -> cộng dồn đúng)', async () => {
  // HS2 vào 3 chặng trong buổi học 14:00 - 15:30 VN (07:00 - 08:30 UTC):
  // Chặng 1: 07:03 -> 07:33 (30 phút)
  // Chặng 2: 07:38 -> 08:03 (25 phút)
  // Chặng 3: 08:06 -> 08:26 (20 phút)
  // Tổng = 30 + 25 + 20 = 75 phút (83.3% của 90 phút) -> PRESENT
  const slices = [
    ['zm_hs2_s1', '2026-11-28T07:03:00.000Z', '2026-11-28T07:33:00.000Z'],
    ['zm_hs2_s2', '2026-11-28T07:38:00.000Z', '2026-11-28T08:03:00.000Z'],
    ['zm_hs2_s3', '2026-11-28T08:06:00.000Z', '2026-11-28T08:26:00.000Z'],
  ];
  for (const [uid, jTime, lTime] of slices) {
    await sendSignedZoomWebhook({
      event: 'meeting.participant_left',
      event_ts: Date.now() + Math.floor(Math.random() * 10000),
      payload: {
        object: {
          id: String(zoomMeetingId).replace(/\s+/g, ''),
          participant: {
            user_id: uid,
            user_name: hs2Row.full_name,
            email: hs2Row.email,
            join_time: jTime,
            leave_time: lTime,
          },
        },
      },
    });
  }

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const rowHs2 = detail.attendance_rows.find((r) => r.student_id === hs2Row.id);
  assert.ok(rowHs2);
  assert.equal(rowHs2.raw_sessions_count, 3, 'Phải lưu đủ 3 lần vào/rời phòng');
  assert.equal(rowHs2.total_duration_minutes, 75, 'Tổng thời gian thực tế sau 3 chặng phải đúng 75 phút');
  assert.equal(rowHs2.calculated_status, 'PRESENT');
});

// ---------------------------------------------------------------- Case 10: Hai khoảng thời gian chồng lấn không bị cộng trùng
await t('CASE-10', 'Hai khoảng thời gian chồng lấn (tham gia đồng thời trên Laptop & Điện thoại) không bị cộng trùng', async () => {
  // Kiểm tra trực tiếp thuật toán mergeTimeIntervals + qua sự kiện thực tế của HS3:
  // Thiết bị 1 (Laptop): 07:20 -> 08:00 (40 phút)
  // Thiết bị 2 (iPad):   07:40 -> 08:10 (30 phút, chồng lấn 20 phút từ 07:40-08:00)
  // Hợp nhất chuẩn (Union): 07:20 -> 08:10 = 50 phút (không phải 70 phút!).
  // Ngoài ra vào lúc 07:20 là trễ 20 phút (> late_grace_minutes = 15p) và 50/90 = 55.6% (< 70%) -> PARTIAL.
  const unionTest = mergeTimeIntervals([
    { startMs: Date.parse('2026-11-28T07:20:00.000Z'), endMs: Date.parse('2026-11-28T08:00:00.000Z') },
    { startMs: Date.parse('2026-11-28T07:40:00.000Z'), endMs: Date.parse('2026-11-28T08:10:00.000Z') },
  ]);
  assert.equal(unionTest.length, 1, 'Hai khoảng chồng lấn phải gộp thành 1 khoảng duy nhất');
  assert.equal(unionTest[0].durationSec, 50 * 60, 'Thời lượng gộp phải bằng 50 phút (3000 giây)');

  await sendSignedZoomWebhook({
    event: 'meeting.participant_left',
    event_ts: Date.now() + 301,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_hs3_laptop',
          user_name: hs3Row.full_name,
          email: hs3Row.email,
          join_time: '2026-11-28T07:20:00.000Z',
          leave_time: '2026-11-28T08:00:00.000Z',
        },
      },
    },
  });
  await sendSignedZoomWebhook({
    event: 'meeting.participant_left',
    event_ts: Date.now() + 302,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_hs3_ipad',
          user_name: hs3Row.full_name,
          email: hs3Row.email,
          join_time: '2026-11-28T07:40:00.000Z',
          leave_time: '2026-11-28T08:10:00.000Z',
        },
      },
    },
  });

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const rowHs3 = detail.attendance_rows.find((r) => r.student_id === hs3Row.id);
  assert.equal(rowHs3.raw_sessions_count, 2);
  assert.equal(rowHs3.total_duration_minutes, 50, 'Không được cộng trùng 20 phút chồng lấn');
  assert.equal(rowHs3.calculated_status, 'PARTIAL');
});

// ---------------------------------------------------------------- Case 11: Người tham gia vài giây không được tính PRESENT
await t('CASE-11', 'Người tham gia chỉ vào phòng vài giây (< min_valid_seconds = 60s) không được tính là PRESENT', async () => {
  // HS4 chỉ vào phòng 12 giây rồi thoát
  await sendSignedZoomWebhook({
    event: 'meeting.participant_left',
    event_ts: Date.now() + 401,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_hs4_brief',
          user_name: hs4Row.full_name,
          email: hs4Row.email,
          join_time: '2026-11-28T07:05:00.000Z',
          leave_time: '2026-11-28T07:05:12.000Z',
        },
      },
    },
  });

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const rowHs4 = detail.attendance_rows.find((r) => r.student_id === hs4Row.id);
  assert.equal(rowHs4.total_duration_sec, 12);
  assert.notEqual(rowHs4.calculated_status, 'PRESENT', 'Vào phòng 12 giây tuyệt đối không được tính PRESENT');
});

// ---------------------------------------------------------------- Case 12: Người tham gia đủ điều kiện được đánh dấu PRESENT
await t('CASE-12', 'Học viên tham gia đủ thời lượng & đúng giờ được tự động đánh dấu PRESENT', async () => {
  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const rowHs1 = detail.attendance_rows.find((r) => r.student_id === hs1Row.id);
  // HS1 có 1 lượt bấm Join trên LMS + 1 phiên Zoom 83 phút (07:02 -> 08:25)
  assert.ok(rowHs1.total_duration_minutes >= 83);
  assert.equal(rowHs1.calculated_status, 'PRESENT');
  assert.equal(rowHs1.final_status, 'PRESENT');
});

// ---------------------------------------------------------------- Case 13: Người tham gia không xác định danh tính (kể cả trùng tên hiển thị) -> UNKNOWN
let unknownParticipantSessionId = null;
await t('CASE-13', 'Người tham gia trùng tên hiển thị nhưng không có email/token xác thực phải ghi nhận là UNKNOWN & cho phép gán thủ công', async () => {
  // Một người vào Zoom đặt tên hiển thị y hệt học viên HS4 nhưng không có email xác thực
  await sendSignedZoomWebhook({
    event: 'meeting.participant_left',
    event_ts: Date.now() + 501,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_guest_same_name_no_email',
          user_name: hs4Row.full_name, // Trùng tên hiển thị!
          email: '', // Không có email xác thực
          join_time: '2026-11-28T07:04:00.000Z',
          leave_time: '2026-11-28T08:28:00.000Z',
        },
      },
    },
  });

  const detail = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-room`, GV), 200);
  const unknownItem = detail.unknown_participants.find((u) => u.external_participant_id === 'zm_guest_same_name_no_email');
  assert.ok(unknownItem, 'Phải đưa vào danh sách UNKNOWN chứ không tự ghép theo display_name');
  assert.equal(unknownItem.matched_student_id, null);
  assert.equal(unknownItem.identity_match_method, 'UNKNOWN');
  unknownParticipantSessionId = unknownItem.id;

  // Giảng viên xác nhận thủ công người tham gia UNKNOWN này chính là HS4
  const mapRes = await apiAsync('POST', `/sessions/${zoomSessionId}/virtual-attendance/map-participant`, GV, {
    participant_session_id: unknownParticipantSessionId,
    student_id: hs4Row.id,
    reason: 'Giảng viên xác nhận HS4 dùng thiết bị của phụ huynh vào lớp',
  });
  const afterMap = expectStatus(mapRes, 200);
  const rowHs4After = afterMap.attendance_rows.find((r) => r.student_id === hs4Row.id);
  assert.equal(rowHs4After.calculated_status, 'PRESENT', 'Sau khi giảng viên gán thủ công, thời lượng 84 phút của HS4 được tính PRESENT');
});

// ---------------------------------------------------------------- Case 14: Webhook trùng lặp không tạo dữ liệu trùng (Idempotency)
await t('CASE-14', 'Sự kiện Webhook trùng lặp (replay cùng event payload) được xử lý idempotent, không nhân đôi dữ liệu', async () => {
  const fixedTs = Date.now() + 777;
  const dupPayload = {
    event: 'meeting.participant_left',
    event_ts: fixedTs,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        participant: {
          user_id: 'zm_idempotent_check',
          user_name: hs1Row.full_name,
          email: hs1Row.email,
          join_time: '2026-11-28T07:10:00.000Z',
          leave_time: '2026-11-28T07:25:00.000Z',
        },
      },
    },
  };

  const firstCall = expectStatus(await sendSignedZoomWebhook(dupPayload), 200);
  assert.equal(firstCall.deduplicated, false);

  const secondCall = expectStatus(await sendSignedZoomWebhook(dupPayload), 200);
  assert.equal(secondCall.deduplicated, true, 'Lần gửi thứ 2 của cùng sự kiện phải trả về deduplicated: true');
});

// ---------------------------------------------------------------- Case 15: Giảng viên điều chỉnh kết quả điểm danh & lưu lịch sử + Xuất CSV + Chốt điểm danh
await t('CASE-15', 'Giảng viên điều chỉnh kết quả điểm danh bắt buộc có lý do, lưu lịch sử kiểm toán, xuất CSV & chốt điểm danh', async () => {
  // 15a. Không nhập lý do khi điều chỉnh phải bị từ chối 422
  const noReasonRes = await apiAsync(
    'PATCH',
    `/sessions/${zoomSessionId}/virtual-attendance/records/${hs3Row.id}`,
    GV,
    { status: 'PRESENT', reason: '   ' }
  );
  expectStatus(noReasonRes, 422, 'VALIDATION_ERROR');

  // 15b. Nhập lý do hợp lệ -> Cập nhật thành EXCUSED và lưu vào virtual_attendance_adjustments
  const adjustRes = await apiAsync(
    'PATCH',
    `/sessions/${zoomSessionId}/virtual-attendance/records/${hs3Row.id}`,
    GV,
    {
      status: 'EXCUSED',
      reason: 'Học viên báo mất điện khu vực sau 50 phút học, phụ huynh đã nhắn xin phép',
    }
  );
  const adjustedDetail = expectStatus(adjustRes, 200);
  const rowHs3 = adjustedDetail.attendance_rows.find((r) => r.student_id === hs3Row.id);
  assert.equal(rowHs3.calculated_status, 'PARTIAL', 'Trạng thái tự động gốc vẫn được lưu là PARTIAL');
  assert.equal(rowHs3.final_status, 'EXCUSED', 'Trạng thái cuối cùng chuyển sang EXCUSED');
  assert.equal(rowHs3.is_manually_adjusted, true);

  // 15c. Kiểm tra lịch sử điều chỉnh
  const history = expectStatus(await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-attendance/history`, GV), 200);
  assert.ok(history.adjustments.length >= 2, 'Phải lưu cả lịch sử gán UNKNOWN và lịch sử điều chỉnh trạng thái');
  assert.ok(
    history.adjustments.some(
      (a) => a.student_id === hs3Row.id && a.new_status === 'EXCUSED' && a.reason.includes('mất điện')
    )
  );

  // 15d. Xuất báo cáo CSV (Excel UTF-8 BOM)
  const csvRes = await apiAsync('GET', `/sessions/${zoomSessionId}/virtual-attendance/export`, GV);
  assert.equal(csvRes.status, 200);
  assert.ok(String(csvRes.body).includes('Mã SV'), 'File CSV phải có tiêu đề cột Mã SV');
  assert.ok(String(csvRes.body).includes(hs1Row.code), 'File CSV phải chứa mã học viên');

  // 15e. Kết thúc & Chốt điểm danh chính thức (CONFIRMED)
  await sendSignedZoomWebhook({
    event: 'meeting.ended',
    event_ts: Date.now() + 999,
    payload: {
      object: {
        id: String(zoomMeetingId).replace(/\s+/g, ''),
        end_time: '2026-11-28T08:30:00.000Z',
      },
    },
  });

  const confirmRes = await apiAsync('POST', `/sessions/${zoomSessionId}/virtual-attendance/confirm`, GV, {
    resolve_unmatched_as_absent: true,
  });
  const confirmedData = expectStatus(confirmRes, 200);
  assert.equal(confirmedData.session.attendance_sync_status, 'CONFIRMED');
  assert.ok(confirmedData.session.attendance_saved_at, 'Sau khi chốt, bảng điểm danh chính thức của buổi học phải được lưu');
});

console.log('----------------------------------------------------------------------');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
if (failed > 0) process.exit(1);
