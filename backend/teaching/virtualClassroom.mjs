/**
 * LMSPLUS Teaching Module — Phòng học trực tuyến (Virtual Classroom),
 * Đồng bộ người tham gia thời gian thực (Webhook + Report) & Tự động điểm danh.
 */

import crypto from 'node:crypto';
import { vnIso } from './schema.mjs';
import { isAdmin, isStaff, isInstructor, isStudent, safeJson } from './scope.mjs';
import { fail, nowIso, nowVn, text, intField, oneOf, tx, compareVietnameseName } from './http.mjs';
import { requireClassAccess, requireSession } from './classes.mjs';
import { sessionRoster } from './attendance.mjs';
import {
  VIRTUAL_PROVIDERS,
  EXTERNAL_NO_SYNC_NOTICE,
  encryptSecret,
  decryptSecret,
  encryptJsonCredentials,
  decryptJsonCredentials,
  maskSecret,
  formatZoomMeetingId,
  createProviderAdapter,
} from './virtualProviders.mjs';

export const VIRTUAL_ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'PARTIAL',
  'ABSENT',
  'EXCUSED',
  'UNKNOWN',
  'MANUAL_REVIEW',
];

export const SYNC_PROCESS_STATUSES = [
  'IDLE',
  'WAITING_PROVIDER_DATA',
  'SYNCING',
  'ATTENDANCE_CALCULATED',
  'NEEDS_REVIEW',
  'CONFIRMED',
];

export const DEFAULT_VIRTUAL_ATTENDANCE_RULES = {
  late_grace_minutes: 10,
  min_duration_minutes: 20,
  min_attendance_pct: 70,
  min_valid_seconds: 60, // Không coi người chỉ vào phòng vài giây (< 60s) là đã tham gia hợp lệ
  attendance_window_start_at: null, // null = dùng scheduled_start_at của buổi học
  attendance_window_end_at: null,   // null = dùng scheduled_end_at của buổi học
  allow_instructor_adjustment: true,
};

/**
 * Lấy quy tắc điểm danh tự động áp dụng cho buổi học (ưu tiên cấu hình buổi học -> cấu hình lớp học -> mặc định).
 */
export function getSessionAttendanceRules(db, session, cls = null) {
  const classRow = cls || db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(session.subject_class_id);
  const classRules = safeJson(classRow?.attendance_rules_json, {});
  const sessionRules = safeJson(session?.attendance_rules_json, {});

  const startMs = Date.parse(session.scheduled_start_at);
  const endMs = Date.parse(session.scheduled_end_at);
  const scheduledMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

  // Nếu buổi học ngắn (ví dụ 35–45 phút), thời lượng tối thiểu mặc định tự co về 60% thời lượng buổi
  const defaultMinMinutes = Math.min(20, Math.max(5, Math.round(scheduledMinutes * 0.6)));

  const merged = {
    ...DEFAULT_VIRTUAL_ATTENDANCE_RULES,
    min_duration_minutes: defaultMinMinutes,
    ...classRules,
    ...sessionRules,
  };

  const windowStartAt = merged.attendance_window_start_at || session.scheduled_start_at;
  const windowEndAt = merged.attendance_window_end_at || session.scheduled_end_at;
  const windowDurationSec = Math.max(
    60,
    Math.round((Date.parse(windowEndAt) - Date.parse(windowStartAt)) / 1000)
  );

  return {
    late_grace_minutes: Math.max(0, Number(merged.late_grace_minutes ?? 10)),
    min_duration_minutes: Math.max(1, Number(merged.min_duration_minutes ?? defaultMinMinutes)),
    min_attendance_pct: Math.max(1, Math.min(100, Number(merged.min_attendance_pct ?? 70))),
    min_valid_seconds: Math.max(15, Number(merged.min_valid_seconds ?? 60)),
    attendance_window_start_at: windowStartAt,
    attendance_window_end_at: windowEndAt,
    window_duration_sec: windowDurationSec,
    window_duration_minutes: Math.round((windowDurationSec / 60) * 10) / 10,
    allow_instructor_adjustment: Boolean(merged.allow_instructor_adjustment ?? true),
  };
}

// ------------------------------------------------------------------ Thuật toán hợp nhất khoảng thời gian (Interval Union)

/**
 * Hợp nhất các khoảng thời gian vào/ra chồng lấn hoặc liền kề (tránh cộng trùng khi học viên vào bằng 2 thiết bị hoặc rớt mạng vào lại).
 * @param {Array<{ startMs: number, endMs: number }>} rawIntervals
 * @returns {Array<{ startMs: number, endMs: number, durationSec: number }>}
 */
export function mergeTimeIntervals(rawIntervals) {
  const valid = (rawIntervals || [])
    .map((it) => ({
      startMs: Number(it.startMs),
      endMs: Number(it.endMs),
    }))
    .filter((it) => Number.isFinite(it.startMs) && Number.isFinite(it.endMs) && it.endMs > it.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  if (valid.length === 0) return [];

  const merged = [{ startMs: valid[0].startMs, endMs: valid[0].endMs }];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i];
    const last = merged[merged.length - 1];
    // Chồng lấn hoặc sát nhau trong phạm vi 1 giây -> hợp nhất
    if (cur.startMs <= last.endMs + 1000) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      merged.push({ startMs: cur.startMs, endMs: cur.endMs });
    }
  }

  return merged.map((m) => ({
    startMs: m.startMs,
    endMs: m.endMs,
    start_at: vnIso(new Date(m.startMs)),
    end_at: vnIso(new Date(m.endMs)),
    durationSec: Math.max(0, Math.round((m.endMs - m.startMs) / 1000)),
  }));
}

/**
 * Cắt các khoảng thời gian đã hợp nhất theo khung giờ tính điểm danh [windowStartMs, windowEndMs].
 */
export function clipIntervalsToWindow(mergedIntervals, windowStartMs, windowEndMs) {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return mergedIntervals;
  }
  const clipped = [];
  for (const it of mergedIntervals) {
    const s = Math.max(it.startMs, windowStartMs);
    const e = Math.min(it.endMs, windowEndMs);
    if (e > s) {
      clipped.push({
        startMs: s,
        endMs: e,
        start_at: vnIso(new Date(s)),
        end_at: vnIso(new Date(e)),
        durationSec: Math.round((e - s) / 1000),
      });
    }
  }
  return clipped;
}

// ------------------------------------------------------------------ Đối chiếu danh tính học viên (Strict Identity Matching)

/**
 * Xác định học viên theo thứ tự ưu tiên nghiêm ngặt:
 *  1. Email tài khoản đã xác thực (`VERIFIED_EMAIL`)
 *  2. Tài khoản nền tảng đã liên kết hoặc giảng viên đã gán (`LINKED_PROVIDER_ACCOUNT` / `INSTRUCTOR_MANUAL_MAP`)
 *  3. Mã định danh đăng ký (`REGISTRATION_ID` — khớp `registrant_id` hoặc `reg_<student_code>`)
 *  4. Phương thức xác thực riêng do LMSPLUS cung cấp (`LMS_JOIN_TOKEN`)
 *
 * TUYỆT ĐỐI KHÔNG tự động khớp học viên chỉ dựa vào tên hiển thị (`display_name`).
 */
export function matchParticipantIdentity(
  db,
  {
    subjectClassId,
    roster,
    provider = 'ZOOM',
    email = null,
    externalParticipantId = null,
    registrantId = null,
    lmsJoinToken = null,
  }
) {
  const rosterList = roster || [];
  const normEmail = email ? String(email).trim().toLowerCase() : '';
  const normExtId = externalParticipantId ? String(externalParticipantId).trim() : '';
  const normRegId = registrantId ? String(registrantId).trim() : '';
  const normToken = lmsJoinToken ? String(lmsJoinToken).trim() : '';

  // Kiểm tra có phải là Giảng viên / Trợ giảng của lớp không (để không liệt kê nhầm giảng viên vào danh sách UNKNOWN của học viên)
  if (normEmail) {
    const staffHit = db
      .prepare(
        `SELECT u.id FROM teaching_staff_assignments t
         JOIN users u ON u.id = t.user_id
         WHERE t.subject_class_id = ? AND t.is_active = 1 AND LOWER(u.email) = ?`
      )
      .get(subjectClassId, normEmail);
    if (staffHit) {
      return { student_id: null, method: 'HOST_STAFF', is_staff: true };
    }
  }

  // 1. Email tài khoản đã xác thực trùng với học viên trong lớp
  if (normEmail) {
    const byEmail = rosterList.find((s) => String(s.email || '').trim().toLowerCase() === normEmail);
    if (byEmail) {
      return { student_id: byEmail.student_id, method: 'VERIFIED_EMAIL', is_staff: false };
    }
  }

  // 2. Bảng đối chiếu định danh (virtual_identity_mappings): LMS_JOIN_TOKEN, REGISTRATION_ID, LINKED_PROVIDER_ACCOUNT, INSTRUCTOR_MANUAL_MAP
  const mappings = db
    .prepare(
      `SELECT * FROM virtual_identity_mappings
       WHERE subject_class_id = ? AND (provider = ? OR provider = 'ANY')
       ORDER BY CASE mapped_by WHEN 'INSTRUCTOR_MANUAL' THEN 0 ELSE 1 END, updated_at DESC`
    )
    .all(subjectClassId, provider);

  const rosterIds = new Set(rosterList.map((s) => s.student_id));

  if (normToken) {
    const hit = mappings.find((m) => m.lms_join_token && m.lms_join_token === normToken && rosterIds.has(m.student_id));
    if (hit) {
      return { student_id: hit.student_id, method: 'LMS_JOIN_TOKEN', is_staff: false };
    }
  }

  if (normRegId) {
    const hit = mappings.find((m) => m.registrant_id && m.registrant_id === normRegId && rosterIds.has(m.student_id));
    if (hit) {
      return { student_id: hit.student_id, method: 'REGISTRATION_ID', is_staff: false };
    }
    // Hỗ trợ định dạng mã đăng ký cá nhân có nhúng mã học viên đã xác thực (vd: reg_HS50101)
    const regCodeMatch = normRegId.match(/^reg[_-]([A-Za-z0-9._-]+)$/i);
    if (regCodeMatch) {
      const codeUpper = regCodeMatch[1].toUpperCase();
      const byCode = rosterList.find((s) => String(s.code || '').toUpperCase() === codeUpper);
      if (byCode) {
        return { student_id: byCode.student_id, method: 'REGISTRATION_ID', is_staff: false };
      }
    }
  }

  if (normExtId) {
    const hit = mappings.find((m) => m.provider_user_id && m.provider_user_id === normExtId && rosterIds.has(m.student_id));
    if (hit) {
      return {
        student_id: hit.student_id,
        method: hit.mapped_by === 'INSTRUCTOR_MANUAL' ? 'INSTRUCTOR_MANUAL_MAP' : 'LINKED_PROVIDER_ACCOUNT',
        is_staff: false,
      };
    }
  }

  if (normEmail) {
    const hit = mappings.find(
      (m) => m.provider_email && String(m.provider_email).toLowerCase() === normEmail && rosterIds.has(m.student_id)
    );
    if (hit) {
      return {
        student_id: hit.student_id,
        method: hit.mapped_by === 'INSTRUCTOR_MANUAL' ? 'INSTRUCTOR_MANUAL_MAP' : 'LINKED_PROVIDER_ACCOUNT',
        is_staff: false,
      };
    }
  }

  // Không khớp bất kỳ định danh xác thực nào -> UNKNOWN (kể cả khi display_name trùng họ tên học viên!)
  return { student_id: null, method: 'UNKNOWN', is_staff: false };
}

// ------------------------------------------------------------------ Tính toán thời lượng & phân loại điểm danh tự động

/**
 * Tính toán điểm danh tự động cho toàn bộ học viên của buổi học trực tuyến.
 * Tuân thủ:
 *  - Hợp nhất khoảng thời gian chồng lấn (Interval Union).
 *  - Không tính người chỉ vào phòng vài giây (< min_valid_seconds) là tham gia hợp lệ.
 *  - Không tự động đánh dấu ABSENT khi đang WAITING_PROVIDER_DATA / SYNCING hoặc khi còn người tham gia UNKNOWN chưa đối chiếu.
 */
export function calculateSessionVirtualAttendance(db, session, { referenceTimeIso = null, preserveManualAdjustments = true } = {}) {
  const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(session.subject_class_id);
  const roster = sessionRoster(db, session);
  const rules = getSessionAttendanceRules(db, session, cls);
  const room = session.virtual_room_id
    ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
    : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);

  if (!room || !room.supports_auto_sync) {
    return {
      supported: false,
      unsupported_reason: EXTERNAL_NO_SYNC_NOTICE,
      rules,
      items: [],
      unknown_participants: [],
    };
  }

  const refMs = referenceTimeIso
    ? Date.parse(referenceTimeIso)
    : session.live_ended_at
    ? Date.parse(session.live_ended_at)
    : Date.now();

  const rawSessions = db
    .prepare(
      `SELECT * FROM virtual_participant_sessions
       WHERE session_id = ? AND virtual_room_id = ?
       ORDER BY join_at ASC`
    )
    .all(session.session_id, room.id);

  // Đối chiếu lại những phiên chưa có matched_student_id (trừ HOST_STAFF)
  const updateMatchStmt = db.prepare(
    `UPDATE virtual_participant_sessions
     SET matched_student_id = ?, identity_match_method = ?, updated_at = ?
     WHERE id = ?`
  );
  const now = nowIso();
  for (const ps of rawSessions) {
    if (!ps.matched_student_id && ps.identity_match_method !== 'HOST_STAFF') {
      const m = matchParticipantIdentity(db, {
        subjectClassId: session.subject_class_id,
        roster,
        provider: room.provider,
        email: ps.participant_email,
        externalParticipantId: ps.external_participant_id,
        registrantId: ps.registrant_id,
        lmsJoinToken: ps.lms_join_token,
      });
      if (m.student_id || m.is_staff) {
        ps.matched_student_id = m.student_id;
        ps.identity_match_method = m.method;
        updateMatchStmt.run(m.student_id, m.method, now, ps.id);
      }
    }
  }

  const unknownParticipants = rawSessions.filter(
    (ps) => !ps.matched_student_id && ps.identity_match_method !== 'HOST_STAFF'
  );
  const hasUnresolvedUnknowns = unknownParticipants.length > 0;
  const isWaitingOrSyncing = ['WAITING_PROVIDER_DATA', 'SYNCING'].includes(session.attendance_sync_status);
  const isLive = session.live_status === 'LIVE';

  // Các bản ghi điểm danh hiện có (ví dụ nghỉ có phép EXCUSED_ABSENCE đã duyệt trước)
  const existingAtt = Object.fromEntries(
    db
      .prepare('SELECT * FROM attendance_records WHERE class_session_id = ?')
      .all(session.session_id)
      .map((r) => [r.student_id, r])
  );
  const existingCalcs = Object.fromEntries(
    db
      .prepare('SELECT * FROM virtual_attendance_calculations WHERE session_id = ?')
      .all(session.session_id)
      .map((r) => [r.student_id, r])
  );

  const windowStartMs = Date.parse(rules.attendance_window_start_at);
  const windowEndMs = Date.parse(rules.attendance_window_end_at);
  const lateCutoffMs = windowStartMs + rules.late_grace_minutes * 60000;
  const minDurationSec = rules.min_duration_minutes * 60;

  const upsertCalcStmt = db.prepare(
    `INSERT INTO virtual_attendance_calculations (
       id, session_id, subject_class_id, student_id,
       first_join_at, last_leave_at, raw_sessions_count, merged_intervals_json,
       total_merged_duration_sec, valid_window_duration_sec, required_window_duration_sec,
       attendance_ratio_pct, late_minutes, calculated_status, final_status,
       identity_match_method, is_manually_adjusted, adjustment_reason, adjusted_by, adjusted_at, calculated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, student_id) DO UPDATE SET
       first_join_at = excluded.first_join_at,
       last_leave_at = excluded.last_leave_at,
       raw_sessions_count = excluded.raw_sessions_count,
       merged_intervals_json = excluded.merged_intervals_json,
       total_merged_duration_sec = excluded.total_merged_duration_sec,
       valid_window_duration_sec = excluded.valid_window_duration_sec,
       required_window_duration_sec = excluded.required_window_duration_sec,
       attendance_ratio_pct = excluded.attendance_ratio_pct,
       late_minutes = excluded.late_minutes,
       calculated_status = excluded.calculated_status,
       final_status = excluded.final_status,
       identity_match_method = excluded.identity_match_method,
       is_manually_adjusted = excluded.is_manually_adjusted,
       adjustment_reason = excluded.adjustment_reason,
       adjusted_by = excluded.adjusted_by,
       adjusted_at = excluded.adjusted_at,
       calculated_at = excluded.calculated_at`
  );

  let needsReviewCount = unknownParticipants.length;

  tx(db, () => {
    for (const student of roster) {
      const stuSessions = rawSessions.filter((ps) => ps.matched_student_id === student.student_id);
      const rawIntervals = stuSessions.map((ps) => {
        const jMs = Date.parse(ps.join_at);
        const lMs = ps.leave_at ? Date.parse(ps.leave_at) : Math.max(jMs + 1000, refMs);
        return { startMs: jMs, endMs: Math.max(jMs, lMs) };
      });

      const mergedAll = mergeTimeIntervals(rawIntervals);
      const totalMergedSec = mergedAll.reduce((acc, it) => acc + it.durationSec, 0);

      // Tính thời gian hợp lệ trong khung giờ tính điểm danh (nếu giảng viên dạy lố giờ hoặc vào sớm hợp lý vẫn tính tối đa theo thời lượng chuẩn)
      const clipped = clipIntervalsToWindow(mergedAll, windowStartMs - 15 * 60000, windowEndMs + 30 * 60000);
      const validWindowSec = clipped.length > 0
        ? clipped.reduce((acc, it) => acc + it.durationSec, 0)
        : totalMergedSec;

      const effectiveDurationSec = Math.max(totalMergedSec, validWindowSec);
      const ratioPct =
        rules.window_duration_sec > 0
          ? Math.min(100, Math.round((effectiveDurationSec / rules.window_duration_sec) * 1000) / 10)
          : 0;

      const firstJoinAt = mergedAll.length > 0 ? mergedAll[0].start_at : null;
      const lastLeaveAt =
        stuSessions.length > 0
          ? stuSessions.some((ps) => !ps.leave_at && ps.is_currently_in_room)
            ? null
            : mergedAll[mergedAll.length - 1]?.end_at || null
          : null;

      const firstJoinMs = mergedAll.length > 0 ? mergedAll[0].startMs : null;
      const lateMinutes =
        firstJoinMs !== null && firstJoinMs > windowStartMs
          ? Math.max(0, Math.round(((firstJoinMs - windowStartMs) / 60000) * 10) / 10)
          : 0;

      // Xác định trạng thái tự động
      let calcStatus = 'ABSENT';
      const prevAtt = existingAtt[student.student_id];

      if (prevAtt && prevAtt.attendance_status === 'EXCUSED_ABSENCE') {
        calcStatus = 'EXCUSED';
      } else if (effectiveDurationSec < rules.min_valid_seconds) {
        // Không coi một người vào phòng vài giây (< min_valid_seconds) là đã tham gia hợp lệ
        if (isWaitingOrSyncing || isLive) {
          calcStatus = 'MANUAL_REVIEW';
        } else if (hasUnresolvedUnknowns) {
          // Khi còn người tham gia UNKNOWN chưa xác định danh tính, không tự động chốt ABSENT cứng
          calcStatus = 'MANUAL_REVIEW';
        } else {
          calcStatus = 'ABSENT';
        }
      } else if (effectiveDurationSec < minDurationSec || ratioPct < rules.min_attendance_pct) {
        calcStatus = 'PARTIAL';
      } else if (firstJoinMs !== null && firstJoinMs > lateCutoffMs) {
        calcStatus = 'LATE';
      } else {
        calcStatus = 'PRESENT';
      }

      const prevCalc = existingCalcs[student.student_id];
      const keepManual = preserveManualAdjustments && prevCalc && prevCalc.is_manually_adjusted;
      const finalStatus = keepManual ? prevCalc.final_status : calcStatus;
      if (finalStatus === 'MANUAL_REVIEW') {
        needsReviewCount++;
      }

      const primaryMethod =
        stuSessions.find((s) => s.identity_match_method && s.identity_match_method !== 'UNKNOWN')?.identity_match_method ||
        'NONE';

      upsertCalcStmt.run(
        prevCalc ? prevCalc.id : `vac_${crypto.randomBytes(6).toString('hex')}`,
        session.session_id,
        session.subject_class_id,
        student.student_id,
        firstJoinAt,
        lastLeaveAt,
        stuSessions.length,
        JSON.stringify(mergedAll),
        totalMergedSec,
        validWindowSec,
        rules.window_duration_sec,
        ratioPct,
        lateMinutes,
        calcStatus,
        finalStatus,
        primaryMethod,
        keepManual ? 1 : 0,
        keepManual ? prevCalc.adjustment_reason : null,
        keepManual ? prevCalc.adjusted_by : null,
        keepManual ? prevCalc.adjusted_at : null,
        now
      );
    }

    // Cập nhật trạng thái xử lý đồng bộ trên buổi học (nếu chưa CONFIRMED và không đang WAITING_PROVIDER_DATA)
    const freshSession = db.prepare('SELECT attendance_sync_status, live_status FROM sessions WHERE session_id = ?').get(session.session_id);
    if (
      freshSession &&
      freshSession.attendance_sync_status !== 'CONFIRMED' &&
      freshSession.attendance_sync_status !== 'WAITING_PROVIDER_DATA'
    ) {
      const nextSyncStatus = needsReviewCount > 0 ? 'NEEDS_REVIEW' : 'ATTENDANCE_CALCULATED';
      db.prepare('UPDATE sessions SET attendance_sync_status = ? WHERE session_id = ?').run(nextSyncStatus, session.session_id);
    }
  });

  return {
    supported: true,
    rules,
    needs_review_count: needsReviewCount,
    unknown_participants_count: unknownParticipants.length,
  };
}

// ------------------------------------------------------------------ Xử lý sự kiện Webhook & Đồng bộ phiên tham gia

export function recordParticipantJoinEvent(
  db,
  {
    session,
    room,
    externalParticipantId,
    registrantId = null,
    lmsJoinToken = null,
    participantEmail = null,
    displayName = 'Người tham gia',
    joinAtIso,
    deviceInfo = null,
    source = 'WEBHOOK',
    sessionKey = null,
  }
) {
  const roster = sessionRoster(db, session);
  const match = matchParticipantIdentity(db, {
    subjectClassId: session.subject_class_id,
    roster,
    provider: room.provider,
    email: participantEmail,
    externalParticipantId,
    registrantId,
    lmsJoinToken,
  });

  const joinIso = joinAtIso ? vnIso(new Date(joinAtIso)) : nowVn();
  const key =
    sessionKey ||
    `ps_${room.id}_${externalParticipantId || displayName}_${new Date(joinIso).getTime()}`;
  const now = nowIso();

  // Kiểm tra xem sự kiện leave có đến trước sự kiện join không (Out-of-order webhook event)
  const outOfOrderRow = externalParticipantId
    ? db
        .prepare(
          `SELECT * FROM virtual_participant_sessions
           WHERE session_id = ? AND virtual_room_id = ? AND external_participant_id = ?
             AND is_currently_in_room = 0 AND duration_sec = 0
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(session.session_id, room.id, String(externalParticipantId))
    : null;

  if (outOfOrderRow && outOfOrderRow.leave_at && Date.parse(outOfOrderRow.leave_at) >= Date.parse(joinIso)) {
    const durSec = Math.max(0, Math.round((Date.parse(outOfOrderRow.leave_at) - Date.parse(joinIso)) / 1000));
    db.prepare(
      `UPDATE virtual_participant_sessions
       SET join_at = ?, duration_sec = ?, matched_student_id = COALESCE(matched_student_id, ?),
           identity_match_method = CASE WHEN identity_match_method = 'UNKNOWN' THEN ? ELSE identity_match_method END,
           participant_email = COALESCE(participant_email, ?), updated_at = ?
       WHERE id = ?`
    ).run(
      joinIso,
      durSec,
      match.student_id,
      match.method,
      participantEmail ? String(participantEmail).toLowerCase() : null,
      now,
      outOfOrderRow.id
    );
    return { id: outOfOrderRow.id, out_of_order_resolved: true, match };
  }

  // Chống tạo trùng nếu cùng session_key hoặc người đó đang có phiên mở trong vòng 5 giây
  const existingByKey = db.prepare('SELECT * FROM virtual_participant_sessions WHERE session_key = ?').get(key);
  if (existingByKey) {
    return { id: existingByKey.id, deduplicated: true, match };
  }

  const id = `vps_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO virtual_participant_sessions (
       id, session_key, session_id, virtual_room_id, provider,
       external_participant_id, registrant_id, lms_join_token, participant_email, display_name,
       matched_student_id, identity_match_method, join_at, leave_at, duration_sec,
       is_currently_in_room, device_info, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, ?, ?, ?, ?)`
  ).run(
    id,
    key,
    session.session_id,
    room.id,
    room.provider,
    externalParticipantId ? String(externalParticipantId) : null,
    registrantId || null,
    lmsJoinToken || null,
    participantEmail ? String(participantEmail).toLowerCase() : null,
    String(displayName || 'Người tham gia').trim(),
    match.student_id,
    match.method,
    joinIso,
    deviceInfo || null,
    source,
    now,
    now
  );

  return { id, deduplicated: false, match };
}

export function recordParticipantLeaveEvent(
  db,
  {
    session,
    room,
    externalParticipantId,
    participantEmail = null,
    displayName = 'Người tham gia',
    leaveAtIso,
    joinAtIso = null,
    sessionKey = null,
  }
) {
  const leaveIso = leaveAtIso ? vnIso(new Date(leaveAtIso)) : nowVn();
  const now = nowIso();

  // Tìm phiên đang mở của người tham gia này
  let openRow = null;
  if (externalParticipantId) {
    openRow = db
      .prepare(
        `SELECT * FROM virtual_participant_sessions
         WHERE session_id = ? AND virtual_room_id = ? AND external_participant_id = ? AND is_currently_in_room = 1
         ORDER BY join_at DESC LIMIT 1`
      )
      .get(session.session_id, room.id, String(externalParticipantId));
  }
  if (!openRow && participantEmail) {
    openRow = db
      .prepare(
        `SELECT * FROM virtual_participant_sessions
         WHERE session_id = ? AND virtual_room_id = ? AND LOWER(participant_email) = LOWER(?) AND is_currently_in_room = 1
         ORDER BY join_at DESC LIMIT 1`
      )
      .get(session.session_id, room.id, String(participantEmail));
  }
  if (!openRow && displayName) {
    openRow = db
      .prepare(
        `SELECT * FROM virtual_participant_sessions
         WHERE session_id = ? AND virtual_room_id = ? AND display_name = ? AND is_currently_in_room = 1
         ORDER BY join_at DESC LIMIT 1`
      )
      .get(session.session_id, room.id, String(displayName));
  }

  if (openRow) {
    const durSec = Math.max(0, Math.round((Date.parse(leaveIso) - Date.parse(openRow.join_at)) / 1000));
    db.prepare(
      `UPDATE virtual_participant_sessions
       SET leave_at = ?, duration_sec = ?, is_currently_in_room = 0, updated_at = ?
       WHERE id = ?`
    ).run(leaveIso, durSec, now, openRow.id);
    return { id: openRow.id, closed_existing: true, duration_sec: durSec };
  }

  // Trường hợp sự kiện participant_left đến trước participant_joined (Out-of-order webhook)
  const fallbackJoinIso = joinAtIso ? vnIso(new Date(joinAtIso)) : leaveIso;
  const durSec = Math.max(0, Math.round((Date.parse(leaveIso) - Date.parse(fallbackJoinIso)) / 1000));
  const roster = sessionRoster(db, session);
  const match = matchParticipantIdentity(db, {
    subjectClassId: session.subject_class_id,
    roster,
    provider: room.provider,
    email: participantEmail,
    externalParticipantId,
  });

  const key =
    sessionKey ||
    `ps_ooo_${room.id}_${externalParticipantId || displayName}_${new Date(leaveIso).getTime()}`;
  const existing = db.prepare('SELECT * FROM virtual_participant_sessions WHERE session_key = ?').get(key);
  if (existing) return { id: existing.id, deduplicated: true };

  const id = `vps_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO virtual_participant_sessions (
       id, session_key, session_id, virtual_room_id, provider,
       external_participant_id, participant_email, display_name,
       matched_student_id, identity_match_method, join_at, leave_at, duration_sec,
       is_currently_in_room, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'WEBHOOK', ?, ?)`
  ).run(
    id,
    key,
    session.session_id,
    room.id,
    room.provider,
    externalParticipantId ? String(externalParticipantId) : null,
    participantEmail ? String(participantEmail).toLowerCase() : null,
    String(displayName || 'Người tham gia').trim(),
    match.student_id,
    match.method,
    fallbackJoinIso,
    leaveIso,
    durSec,
    now,
    now
  );

  return { id, out_of_order_created: true, duration_sec: durSec };
}

// ------------------------------------------------------------------ Định dạng dữ liệu trả về cho Frontend (DTO)

export function virtualRoomSummaryDto(db, session) {
  if (!session) return null;
  const room = session.virtual_room_id
    ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
    : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
  if (!room) return null;

  const stats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN is_currently_in_room = 1 AND identity_match_method <> 'HOST_STAFF' THEN 1 ELSE 0 END) AS current_in_room,
         COUNT(DISTINCT COALESCE(matched_student_id, external_participant_id, display_name)) AS total_joined,
         COUNT(DISTINCT CASE WHEN matched_student_id IS NOT NULL THEN matched_student_id END) AS matched_students,
         SUM(CASE WHEN matched_student_id IS NULL AND identity_match_method = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count
       FROM virtual_participant_sessions
       WHERE session_id = ? AND virtual_room_id = ?`
    )
    .get(session.session_id, room.id);

  return {
    id: room.id,
    provider: room.provider,
    external_platform_name: room.external_platform_name || (room.provider === 'ZOOM' ? 'Zoom Meeting' : room.provider === 'GOOGLE_MEET' ? 'Google Meet' : 'Phòng trực tuyến'),
    creation_mode: room.creation_mode,
    is_recurring_room: Boolean(room.is_recurring_room),
    room_title: room.room_title,
    external_meeting_id: room.external_meeting_id ? formatZoomMeetingId(room.external_meeting_id) : null,
    join_url: room.join_url,
    has_passcode: Boolean(room.encrypted_passcode),
    room_status: session.live_status === 'LIVE' ? 'LIVE' : session.live_status === 'ENDED' ? 'ENDED' : room.room_status,
    live_status: session.live_status || 'NOT_STARTED',
    live_started_at: session.live_started_at || null,
    live_ended_at: session.live_ended_at || null,
    attendance_sync_status: session.attendance_sync_status || 'IDLE',
    supports_auto_sync: Boolean(room.supports_auto_sync),
    sync_notice: room.supports_auto_sync ? null : EXTERNAL_NO_SYNC_NOTICE,
    current_in_room: stats?.current_in_room || 0,
    total_joined: stats?.total_joined || 0,
    matched_students: stats?.matched_students || 0,
    unknown_count: stats?.unknown_count || 0,
  };
}

function buildVirtualSessionDetailDto(db, user, session, cls, caps, jwtSecret) {
  const room = session.virtual_room_id
    ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
    : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);

  const roster = sessionRoster(db, session);
  const rules = getSessionAttendanceRules(db, session, cls);

  if (room && room.supports_auto_sync) {
    calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });
  }

  const refreshedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
  const rosterById = Object.fromEntries(roster.map((r) => [r.student_id, r]));

  const participantSessions = room
    ? db
        .prepare(
          `SELECT * FROM virtual_participant_sessions
           WHERE session_id = ? AND virtual_room_id = ?
           ORDER BY join_at ASC`
        )
        .all(session.session_id, room.id)
        .map((ps) => {
          const st = ps.matched_student_id ? rosterById[ps.matched_student_id] : null;
          const liveDurSec =
            ps.is_currently_in_room && !ps.leave_at
              ? Math.max(0, Math.round((Date.now() - Date.parse(ps.join_at)) / 1000))
              : ps.duration_sec;
          return {
            id: ps.id,
            external_participant_id: ps.external_participant_id,
            participant_email: ps.participant_email,
            display_name: ps.display_name,
            matched_student_id: ps.matched_student_id,
            matched_student_code: st ? st.code : null,
            matched_student_name: st ? st.full_name : null,
            identity_match_method: ps.identity_match_method,
            join_at: ps.join_at,
            leave_at: ps.leave_at,
            duration_sec: liveDurSec,
            duration_minutes: Math.round((liveDurSec / 60) * 10) / 10,
            is_currently_in_room: Boolean(ps.is_currently_in_room),
            device_info: ps.device_info,
            source: ps.source,
          };
        })
    : [];

  const calcs = Object.fromEntries(
    db
      .prepare('SELECT * FROM virtual_attendance_calculations WHERE session_id = ?')
      .all(session.session_id)
      .map((c) => [c.student_id, c])
  );

  const actorIds = new Set(Object.values(calcs).map((c) => c.adjusted_by).filter(Boolean));
  const actorNames = {};
  for (const aid of actorIds) {
    const u = db.prepare('SELECT full_name FROM users WHERE id = ?').get(aid);
    if (u) actorNames[aid] = u.full_name;
  }

  const attendanceRows = roster.map((r, idx) => {
    const c = calcs[r.student_id];
    const stuRawSessions = participantSessions.filter((ps) => ps.matched_student_id === r.student_id);
    const mergedIntervals = c ? safeJson(c.merged_intervals_json, []) : [];
    const totalSec = c ? c.total_merged_duration_sec : 0;
    const validSec = c ? c.valid_window_duration_sec : 0;
    return {
      index: idx + 1,
      student_id: r.student_id,
      code: r.code,
      full_name: r.full_name,
      email: r.email,
      first_join_at: c?.first_join_at || null,
      last_leave_at: c?.last_leave_at || null,
      raw_sessions_count: stuRawSessions.length,
      raw_sessions: stuRawSessions,
      merged_intervals: mergedIntervals,
      total_duration_sec: totalSec,
      total_duration_minutes: Math.round((totalSec / 60) * 10) / 10,
      valid_duration_sec: validSec,
      valid_duration_minutes: Math.round((validSec / 60) * 10) / 10,
      attendance_ratio_pct: c ? c.attendance_ratio_pct : 0,
      late_minutes: c ? c.late_minutes : 0,
      calculated_status: c ? c.calculated_status : 'ABSENT',
      final_status: c ? c.final_status : 'ABSENT',
      identity_match_method: c ? c.identity_match_method : 'NONE',
      is_manually_adjusted: Boolean(c?.is_manually_adjusted),
      adjustment_reason: c?.adjustment_reason || null,
      adjusted_by_name: c?.adjusted_by ? actorNames[c.adjusted_by] || c.adjusted_by : null,
      adjusted_at: c?.adjusted_at || null,
    };
  });

  const unknownList = participantSessions.filter(
    (ps) => !ps.matched_student_id && ps.identity_match_method === 'UNKNOWN'
  );

  const currentInRoom = participantSessions.filter(
    (ps) => ps.is_currently_in_room && ps.identity_match_method !== 'HOST_STAFF'
  ).length;

  const uniqueJoinedKeys = new Set(
    participantSessions
      .filter((ps) => ps.identity_match_method !== 'HOST_STAFF')
      .map((ps) => ps.matched_student_id || ps.external_participant_id || ps.display_name)
  );
  const matchedStudentIds = new Set(
    participantSessions.map((ps) => ps.matched_student_id).filter(Boolean)
  );

  const statusCounts = {
    PRESENT: 0,
    LATE: 0,
    PARTIAL: 0,
    ABSENT: 0,
    EXCUSED: 0,
    MANUAL_REVIEW: 0,
    UNKNOWN: unknownList.length,
  };
  for (const r of attendanceRows) {
    statusCounts[r.final_status] = (statusCounts[r.final_status] || 0) + 1;
  }

  // Giải mã passcode cho thành viên hợp lệ trong lớp; TUYỆT ĐỐI KHÔNG gửi host_start_url xuống danh sách chung
  const decryptedPasscode = room?.encrypted_passcode ? decryptSecret(room.encrypted_passcode, jwtSecret) : null;

  return {
    session: {
      id: refreshedSession.session_id,
      class_id: cls.id,
      class_code: cls.code,
      class_title: cls.title,
      subject: cls.subject || refreshedSession.subject_title || '',
      title: refreshedSession.session_title,
      teaching_content: refreshedSession.teaching_content || '',
      instructor_name: refreshedSession.actual_instructor_name || refreshedSession.scheduled_instructor_name || cls.instructor_name || '',
      start_at: refreshedSession.scheduled_start_at,
      end_at: refreshedSession.scheduled_end_at,
      delivery_mode: refreshedSession.delivery_mode || cls.delivery_mode || 'OFFLINE',
      session_status: refreshedSession.session_status,
      live_status: refreshedSession.live_status || 'NOT_STARTED',
      live_started_at: refreshedSession.live_started_at || null,
      live_ended_at: refreshedSession.live_ended_at || null,
      attendance_sync_status: refreshedSession.attendance_sync_status || 'IDLE',
      attendance_saved_at: refreshedSession.attendance_saved_at,
      attendance_locked_at: refreshedSession.attendance_locked_at,
    },
    room: room
      ? {
          id: room.id,
          provider: room.provider,
          external_platform_name:
            room.external_platform_name ||
            (room.provider === 'ZOOM' ? 'Zoom Meeting' : room.provider === 'GOOGLE_MEET' ? 'Google Meet' : 'Nền tảng bên ngoài'),
          creation_mode: room.creation_mode,
          is_recurring_room: Boolean(room.is_recurring_room),
          room_title: room.room_title,
          external_meeting_id: room.external_meeting_id ? formatZoomMeetingId(room.external_meeting_id) : null,
          raw_meeting_id: room.external_meeting_id || null,
          join_url: room.join_url,
          passcode: decryptedPasscode,
          has_host_start_url: Boolean(room.encrypted_host_start_url),
          room_status: refreshedSession.live_status === 'LIVE' ? 'LIVE' : refreshedSession.live_status === 'ENDED' ? 'ENDED' : room.room_status,
          supports_auto_sync: Boolean(room.supports_auto_sync),
          sync_notice: room.supports_auto_sync ? null : EXTERNAL_NO_SYNC_NOTICE,
          provider_metadata: safeJson(room.provider_metadata_json, {}),
          updated_at: room.updated_at,
        }
      : null,
    live_stats: {
      roster_size: roster.length,
      current_in_room: room && room.supports_auto_sync ? currentInRoom : null,
      total_unique_joined: room && room.supports_auto_sync ? uniqueJoinedKeys.size : null,
      matched_students_count: room && room.supports_auto_sync ? matchedStudentIds.size : null,
      unknown_participants_count: room && room.supports_auto_sync ? unknownList.length : null,
      status_counts: statusCounts,
    },
    rules,
    participant_sessions: participantSessions,
    unknown_participants: unknownList,
    attendance_rows: attendanceRows,
    capabilities: {
      can_manage_room: caps.can_manage_sessions,
      can_start_host: caps.can_manage_sessions || caps.can_take_attendance,
      can_sync_attendance: caps.can_take_attendance,
      can_adjust_attendance:
        caps.can_take_attendance &&
        rules.allow_instructor_adjustment &&
        (!refreshedSession.attendance_locked_at || caps.can_lock_attendance),
      can_confirm_attendance:
        caps.can_take_attendance &&
        (!refreshedSession.attendance_locked_at || caps.can_lock_attendance),
      can_lock_attendance: caps.can_lock_attendance,
    },
  };
}

// ------------------------------------------------------------------ Xử lý Webhook chung (dùng cho cả HTTP endpoint & Simulator)

export function processProviderWebhook({ db, provider, headers, rawBody, body, jwtSecret, log, skipSignatureVerify = false }) {
  const normProvider = String(provider || 'ZOOM').toUpperCase();
  const adapter = createProviderAdapter(normProvider, { db, jwtSecret, log });

  // 1. Zoom URL Validation Challenge (endpoint.url_validation)
  if (normProvider === 'ZOOM' && body?.event === 'endpoint.url_validation') {
    const plainToken = body?.payload?.plainToken;
    if (!plainToken) fail(400, 'MISSING_PLAIN_TOKEN', 'Thiếu plainToken trong yêu cầu xác thực URL Webhook.');
    if (!skipSignatureVerify && headers['x-zm-signature']) {
      adapter.verifyWebhookSignature({ headers, rawBody });
    }
    return adapter.createValidationChallengeResponse(plainToken);
  }

  // 2. Xác thực chữ ký HMAC-SHA256 & chống replay
  if (!skipSignatureVerify) {
    if (normProvider === 'ZOOM') {
      adapter.verifyWebhookSignature({ headers, rawBody });
    }
  }

  const eventType = String(body?.event || '').trim();
  if (!eventType) {
    fail(422, 'MISSING_WEBHOOK_EVENT', 'Sự kiện Webhook không có trường event.');
  }

  const eventTs = Number(body?.event_ts || Date.now());
  const payloadObj = body?.payload?.object || {};
  const rawMeetingId = String(payloadObj.id || payloadObj.meeting_id || '').replace(/\s+/g, '');
  const participant = payloadObj.participant || {};
  const partId = String(participant.user_id || participant.id || participant.participant_user_id || '');
  const partActionTime = participant.join_time || participant.leave_time || payloadObj.start_time || payloadObj.end_time || String(eventTs);

  // Khóa idempotency duy nhất cho từng sự kiện
  const eventKey =
    String(body?.event_id || '').trim() ||
    `${normProvider}:${eventType}:${rawMeetingId}:${partId}:${partActionTime}:${eventTs}`;

  const existingEvent = db.prepare('SELECT * FROM virtual_webhook_events WHERE event_key = ?').get(eventKey);
  if (existingEvent) {
    return {
      received: true,
      deduplicated: true,
      event_id: existingEvent.id,
      event_type: eventType,
    };
  }

  // Tìm phòng họp & buổi học tương ứng
  const room = db
    .prepare(
      `SELECT * FROM virtual_meeting_rooms
       WHERE provider = ? AND (REPLACE(external_meeting_id, ' ', '') = ? OR id = ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(normProvider, rawMeetingId, rawMeetingId);

  const session = room
    ? room.session_id
      ? db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(room.session_id)
      : db.prepare('SELECT * FROM sessions WHERE virtual_room_id = ? ORDER BY scheduled_start_at DESC LIMIT 1').get(room.id)
    : null;

  const webhookRowId = `wh_${crypto.randomBytes(6).toString('hex')}`;
  const now = nowIso();

  let processingStatus = 'PROCESSED';
  let resultDetail = {};

  tx(db, () => {
    if (room && session) {
      if (eventType === 'meeting.started') {
        const startIso = payloadObj.start_time ? vnIso(new Date(payloadObj.start_time)) : nowVn();
        db.prepare("UPDATE virtual_meeting_rooms SET room_status = 'LIVE', updated_at = ? WHERE id = ?").run(now, room.id);
        db.prepare(
          `UPDATE sessions
           SET live_status = 'LIVE',
               live_started_at = COALESCE(live_started_at, ?),
               attendance_sync_status = CASE WHEN attendance_sync_status = 'IDLE' THEN 'SYNCING' ELSE attendance_sync_status END
           WHERE session_id = ?`
        ).run(startIso, session.session_id);
        resultDetail = { session_id: session.session_id, live_status: 'LIVE' };
      } else if (eventType === 'meeting.participant_joined') {
        const r = recordParticipantJoinEvent(db, {
          session,
          room,
          externalParticipantId: partId || `ext_${crypto.randomBytes(3).toString('hex')}`,
          registrantId: participant.registrant_id || null,
          lmsJoinToken: participant.lms_join_token || null,
          participantEmail: participant.email || participant.user_email || null,
          displayName: participant.user_name || participant.display_name || 'Người tham gia',
          joinAtIso: participant.join_time || new Date(eventTs).toISOString(),
          deviceInfo: participant.client_type || participant.device || null,
          source: 'WEBHOOK',
          sessionKey: `wh_join_${room.id}_${partId || participant.user_name}_${participant.join_time || eventTs}`,
        });
        if (r.out_of_order_resolved) processingStatus = 'OUT_OF_ORDER_RESOLVED';
        calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });
        resultDetail = { session_id: session.session_id, participant_session_id: r.id, match: r.match };
      } else if (eventType === 'meeting.participant_left') {
        const r = recordParticipantLeaveEvent(db, {
          session,
          room,
          externalParticipantId: partId || null,
          participantEmail: participant.email || participant.user_email || null,
          displayName: participant.user_name || participant.display_name || 'Người tham gia',
          leaveAtIso: participant.leave_time || new Date(eventTs).toISOString(),
          joinAtIso: participant.join_time || null,
          sessionKey: `wh_leave_${room.id}_${partId || participant.user_name}_${participant.leave_time || eventTs}`,
        });
        if (r.out_of_order_created) processingStatus = 'OUT_OF_ORDER_RESOLVED';
        calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });
        resultDetail = { session_id: session.session_id, participant_session_id: r.id };
      } else if (eventType === 'meeting.ended') {
        const endIso = payloadObj.end_time ? vnIso(new Date(payloadObj.end_time)) : nowVn();
        // Đóng các phiên tham gia còn đang mở khi phòng họp kết thúc
        const openRows = db
          .prepare('SELECT * FROM virtual_participant_sessions WHERE session_id = ? AND virtual_room_id = ? AND is_currently_in_room = 1')
          .all(session.session_id, room.id);
        for (const op of openRows) {
          const durSec = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(op.join_at)) / 1000));
          db.prepare(
            'UPDATE virtual_participant_sessions SET leave_at = ?, duration_sec = ?, is_currently_in_room = 0, updated_at = ? WHERE id = ?'
          ).run(endIso, durSec, now, op.id);
        }

        const waitReport = Boolean(body?.payload?.wait_for_final_report);
        db.prepare("UPDATE virtual_meeting_rooms SET room_status = 'ENDED', updated_at = ? WHERE id = ?").run(now, room.id);
        db.prepare(
          `UPDATE sessions
           SET live_status = 'ENDED',
               live_ended_at = ?,
               session_status = CASE WHEN session_status = 'SCHEDULED' THEN 'COMPLETED' ELSE session_status END,
               attendance_sync_status = ?
           WHERE session_id = ?`
        ).run(endIso, waitReport ? 'WAITING_PROVIDER_DATA' : 'SYNCING', session.session_id);

        const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
        const calcRes = calculateSessionVirtualAttendance(db, updatedSession, {
          referenceTimeIso: endIso,
          preserveManualAdjustments: true,
        });
        resultDetail = {
          session_id: session.session_id,
          live_status: 'ENDED',
          attendance_sync_status: waitReport
            ? 'WAITING_PROVIDER_DATA'
            : calcRes.needs_review_count > 0
            ? 'NEEDS_REVIEW'
            : 'ATTENDANCE_CALCULATED',
        };
      }
    }

    db.prepare(
      `INSERT INTO virtual_webhook_events (
         id, event_key, provider, event_type, external_meeting_id, session_id,
         event_timestamp_ms, signature_verified, processing_status, raw_payload_json, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      webhookRowId,
      eventKey,
      normProvider,
      eventType,
      rawMeetingId || null,
      session ? session.session_id : null,
      eventTs,
      processingStatus,
      rawBody || JSON.stringify(body || {}),
      now
    );
  });

  log('INFO', `[virtual-webhook] ${normProvider} ${eventType} (${processingStatus}) -> session=${session?.session_id || 'unmatched'}`);
  return {
    received: true,
    deduplicated: false,
    event_id: webhookRowId,
    event_type: eventType,
    processing_status: processingStatus,
    ...resultDetail,
  };
}

// ------------------------------------------------------------------ Đăng ký các Route Phòng học trực tuyến & Tự động điểm danh

function csvSafeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function registerVirtualClassroomRoutes(route, { jwtSecret = 'lmsplus-production-grade-hmac-secret-2026' } = {}) {
  // 1. Danh sách cấu hình nhà cung cấp (Zoom, Google Meet, External)
  route('GET', '/virtual-providers', ({ db, user }) => {
    if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'FORBIDDEN', 'Bạn không có quyền xem cấu hình tích hợp phòng học trực tuyến.');
    }
    const rows = db.prepare('SELECT * FROM virtual_provider_configs ORDER BY provider').all();
    return {
      items: rows.map((r) => {
        const creds = decryptJsonCredentials(r.encrypted_credentials_json, jwtSecret);
        return {
          provider: r.provider,
          display_name: r.display_name,
          auth_mode: r.auth_mode,
          account_id: r.account_id || '',
          client_id: r.client_id || '',
          has_client_secret: Boolean(creds.client_secret),
          masked_client_secret: maskSecret(creds.client_secret || ''),
          has_webhook_secret: Boolean(creds.webhook_secret_token),
          masked_webhook_secret: maskSecret(creds.webhook_secret_token || ''),
          scopes: safeJson(r.scopes_json, []),
          capabilities: safeJson(r.capabilities_json, {}),
          connection_status: r.connection_status,
          last_verified_at: r.last_verified_at,
          status_message: r.status_message || '',
          webhook_endpoint: `/api/v1/teaching/webhooks/${r.provider.toLowerCase()}`,
          updated_at: r.updated_at,
        };
      }),
    };
  });

  // 2. Cập nhật thông tin xác thực OAuth / Webhook cho Provider
  route('PUT', '/virtual-providers/:provider', ({ db, user, params, body, log }) => {
    if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên, Giáo vụ hoặc Giảng viên được cấu hình kết nối nền tảng.');
    }
    const provider = String(params.provider || '').toUpperCase();
    if (!VIRTUAL_PROVIDERS.includes(provider)) {
      fail(422, 'UNSUPPORTED_PROVIDER', 'Nền tảng không hợp lệ.');
    }
    const existing = db.prepare('SELECT * FROM virtual_provider_configs WHERE provider = ?').get(provider);
    if (!existing) fail(404, 'PROVIDER_NOT_FOUND', 'Không tìm thấy cấu hình nền tảng.');

    const oldCreds = decryptJsonCredentials(existing.encrypted_credentials_json, jwtSecret);
    const nextCreds = {
      ...oldCreds,
      ...(typeof body.client_secret === 'string' && body.client_secret.trim()
        ? { client_secret: body.client_secret.trim() }
        : {}),
      ...(typeof body.webhook_secret_token === 'string' && body.webhook_secret_token.trim()
        ? { webhook_secret_token: body.webhook_secret_token.trim() }
        : {}),
      ...(typeof body.refresh_token === 'string' && body.refresh_token.trim()
        ? { refresh_token: body.refresh_token.trim() }
        : {}),
    };

    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : existing.account_id;
    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : existing.client_id;
    const authMode = typeof body.auth_mode === 'string' ? body.auth_mode.trim() : existing.auth_mode;
    const now = nowIso();

    db.prepare(
      `UPDATE virtual_provider_configs
       SET account_id = ?, client_id = ?, auth_mode = ?, encrypted_credentials_json = ?,
           updated_by = ?, updated_at = ?
       WHERE provider = ?`
    ).run(
      accountId || null,
      clientId || null,
      authMode || 'SERVER_TO_SERVER_OAUTH',
      encryptJsonCredentials(nextCreds, jwtSecret),
      user.id,
      now,
      provider
    );

    log('INFO', `[virtual-provider] ${provider} credentials updated by ${user.id}`);
    return {
      provider,
      account_id: accountId || '',
      client_id: clientId || '',
      has_client_secret: Boolean(nextCreds.client_secret),
      has_webhook_secret: Boolean(nextCreds.webhook_secret_token),
      updated_at: now,
    };
  });

  // 3. Kiểm tra kết nối Provider
  route('POST', '/virtual-providers/:provider/validate', async ({ db, user, params, log }) => {
    if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'FORBIDDEN', 'Bạn không có quyền kiểm tra kết nối nền tảng.');
    }
    const provider = String(params.provider || '').toUpperCase();
    const adapter = createProviderAdapter(provider, { db, jwtSecret, log });
    return adapter.validateMeetingConnection();
  });

  // 4. Danh sách các phòng trực tuyến đã tạo trong lớp (phục vụ tái sử dụng / phòng cố định)
  route('GET', '/classes/:id/virtual-rooms', ({ db, user, params }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const rows = db
      .prepare(
        `SELECT * FROM virtual_meeting_rooms
         WHERE subject_class_id = ?
         ORDER BY is_recurring_room DESC, created_at DESC LIMIT 30`
      )
      .all(cls.id);
    return {
      items: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        external_platform_name: r.external_platform_name || (r.provider === 'ZOOM' ? 'Zoom Meeting' : r.provider === 'GOOGLE_MEET' ? 'Google Meet' : 'Nền tảng bên ngoài'),
        room_title: r.room_title,
        external_meeting_id: r.external_meeting_id ? formatZoomMeetingId(r.external_meeting_id) : null,
        join_url: r.join_url,
        is_recurring_room: Boolean(r.is_recurring_room),
        supports_auto_sync: Boolean(r.supports_auto_sync),
        created_at: r.created_at,
      })),
    };
  });

  // 5. Lấy chi tiết Phòng học trực tuyến & Bảng điểm danh tự động của một buổi học
  route('GET', '/sessions/:id/virtual-room', ({ db, user, params }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_view_roster');
    return buildVirtualSessionDetailDto(db, user, session, cls, caps, jwtSecret);
  });

  // 6. Tạo mới / Gắn phòng học trực tuyến cho buổi học
  route('POST', '/sessions/:id/virtual-room', async ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_manage_sessions');
    const mode = oneOf(body, 'creation_mode', ['AUTO_API', 'MANUAL_LINK', 'REUSED_ROOM'], {
      fallback: 'AUTO_API',
      label: 'chế độ tạo phòng',
    });

    const now = nowIso();
    let roomId = null;

    if (mode === 'REUSED_ROOM') {
      const targetRoomId = text(body, 'reuse_room_id', { required: true, max: 80, label: 'mã phòng sẵn có' });
      const existingRoom = db
        .prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ? AND subject_class_id = ?')
        .get(targetRoomId, cls.id);
      if (!existingRoom) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Không tìm thấy phòng học trực tuyến đã chọn trong lớp này.');
      roomId = existingRoom.id;
      db.prepare(
        `UPDATE sessions
         SET virtual_room_id = ?, room_or_link = ?, delivery_mode = CASE WHEN delivery_mode = 'OFFLINE' THEN 'ONLINE' ELSE delivery_mode END
         WHERE session_id = ?`
      ).run(existingRoom.id, `${existingRoom.provider === 'ZOOM' ? 'Zoom' : existingRoom.provider === 'GOOGLE_MEET' ? 'Google Meet' : existingRoom.external_platform_name || 'Online'} · ${existingRoom.external_meeting_id ? formatZoomMeetingId(existingRoom.external_meeting_id) : existingRoom.room_title}`, session.session_id);
    } else if (mode === 'MANUAL_LINK') {
      const provider = oneOf(body, 'provider', VIRTUAL_PROVIDERS, { fallback: 'EXTERNAL', label: 'nền tảng' });
      const roomTitle = text(body, 'room_title', { max: 200, label: 'tên phòng' }) || session.session_title;
      const joinUrl = text(body, 'join_url', { required: true, max: 500, label: 'Meeting URL' });
      if (!/^https:\/\//i.test(joinUrl)) {
        fail(422, 'INVALID_MEETING_URL', 'Đường dẫn phòng học trực tuyến phải bắt đầu bằng https://', { field: 'join_url' });
      }
      const externalPlatformName = text(body, 'external_platform_name', { max: 100, label: 'tên nền tảng' }) ||
        (provider === 'ZOOM' ? 'Zoom Meeting' : provider === 'GOOGLE_MEET' ? 'Google Meet' : 'Microsoft Teams / Nền tảng ngoài');
      const externalMeetingId = text(body, 'external_meeting_id', { max: 80, label: 'mã phòng' }) || null;
      const passcode = text(body, 'passcode', { max: 60, label: 'mật khẩu phòng' }) || null;
      const isRecurring = Boolean(body.is_recurring_room);
      // Nếu là link ngoài (EXTERNAL) hoặc không có mã phòng API của Zoom/Google Meet -> không giả lập đồng bộ tự động
      const supportsAutoSync = provider !== 'EXTERNAL' && Boolean(externalMeetingId) && Boolean(body.supports_auto_sync);

      roomId = `vmr_${crypto.randomBytes(6).toString('hex')}`;
      tx(db, () => {
        db.prepare(
          `INSERT INTO virtual_meeting_rooms (
             id, subject_class_id, session_id, provider, external_platform_name, creation_mode,
             is_recurring_room, room_title, external_meeting_id, join_url,
             encrypted_host_start_url, encrypted_passcode, scheduled_start_at, scheduled_end_at,
             room_status, supports_auto_sync, provider_metadata_json, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'MANUAL_LINK', ?, ?, ?, ?, NULL, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`
        ).run(
          roomId,
          cls.id,
          session.session_id,
          provider,
          externalPlatformName,
          isRecurring ? 1 : 0,
          roomTitle,
          externalMeetingId ? externalMeetingId.replace(/\s+/g, '') : null,
          joinUrl,
          passcode ? encryptSecret(passcode, jwtSecret) : null,
          session.scheduled_start_at,
          session.scheduled_end_at,
          supportsAutoSync ? 1 : 0,
          JSON.stringify({
            mode: 'MANUAL_LINK',
            platform_name: externalPlatformName,
            sync_notice: supportsAutoSync ? null : EXTERNAL_NO_SYNC_NOTICE,
          }),
          user.id,
          now,
          now
        );

        const displayRoom = `${externalPlatformName}${externalMeetingId ? ` · ID: ${formatZoomMeetingId(externalMeetingId)}` : ''}`;
        db.prepare(
          `UPDATE sessions
           SET virtual_room_id = ?, room_or_link = ?,
               delivery_mode = CASE WHEN delivery_mode = 'OFFLINE' THEN 'ONLINE' ELSE delivery_mode END
           WHERE session_id = ?`
        ).run(roomId, displayRoom, session.session_id);

        if (isRecurring) {
          db.prepare('UPDATE subject_classes SET default_virtual_room_id = ? WHERE id = ?').run(roomId, cls.id);
        }
      });
    } else {
      // AUTO_API (Tạo phòng tự động qua Zoom / Google Meet Provider Adapter)
      const provider = oneOf(body, 'provider', ['ZOOM', 'GOOGLE_MEET'], { fallback: 'ZOOM', label: 'nền tảng' });
      const roomTitle = text(body, 'room_title', { max: 200, label: 'tên phòng' }) || `${cls.code} — ${session.session_title}`;
      const passcode = text(body, 'passcode', { max: 40, label: 'mật khẩu phòng' }) || null;
      const isRecurring = Boolean(body.is_recurring_room);
      const durationMinutes = Math.max(
        15,
        Math.round((Date.parse(session.scheduled_end_at) - Date.parse(session.scheduled_start_at)) / 60000)
      );

      const adapter = createProviderAdapter(provider, { db, jwtSecret, log });
      const created = await adapter.createMeeting({
        topic: roomTitle,
        startTimeIso: session.scheduled_start_at,
        durationMinutes,
        passcode,
        isRecurring,
      });

      roomId = `vmr_${crypto.randomBytes(6).toString('hex')}`;
      tx(db, () => {
        db.prepare(
          `INSERT INTO virtual_meeting_rooms (
             id, subject_class_id, session_id, provider, external_platform_name, creation_mode,
             is_recurring_room, room_title, external_meeting_id, external_meeting_uuid, join_url,
             encrypted_host_start_url, encrypted_passcode, scheduled_start_at, scheduled_end_at,
             room_status, supports_auto_sync, provider_metadata_json, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'AUTO_API', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`
        ).run(
          roomId,
          cls.id,
          session.session_id,
          provider,
          provider === 'ZOOM' ? 'Zoom Meeting' : 'Google Meet',
          isRecurring ? 1 : 0,
          roomTitle,
          created.external_meeting_id,
          created.external_meeting_uuid,
          created.join_url,
          created.host_start_url ? encryptSecret(created.host_start_url, jwtSecret) : null,
          created.passcode ? encryptSecret(created.passcode, jwtSecret) : null,
          session.scheduled_start_at,
          session.scheduled_end_at,
          created.supports_auto_sync ? 1 : 0,
          JSON.stringify(created.provider_metadata || {}),
          user.id,
          now,
          now
        );

        const displayRoom =
          provider === 'ZOOM'
            ? `Zoom · ID: ${formatZoomMeetingId(created.external_meeting_id)}`
            : `Google Meet · ${created.external_meeting_id}`;
        db.prepare(
          `UPDATE sessions
           SET virtual_room_id = ?, room_or_link = ?,
               delivery_mode = CASE WHEN delivery_mode = 'OFFLINE' THEN 'ONLINE' ELSE delivery_mode END
           WHERE session_id = ?`
        ).run(roomId, displayRoom, session.session_id);

        if (isRecurring) {
          db.prepare('UPDATE subject_classes SET default_virtual_room_id = ? WHERE id = ?').run(roomId, cls.id);
        }
      });
    }

    log('INFO', `[virtual-room] attached ${roomId} (${mode}) to session ${session.session_id} by ${user.id}`);
    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    return [201, buildVirtualSessionDetailDto(db, user, updatedSession, cls, caps, jwtSecret)];
  });

  // 7. Cập nhật thông tin phòng học trực tuyến (KHÔNG tạo lại phòng mới khi chỉ đổi tên/mật khẩu/cấu hình)
  route('PATCH', '/sessions/:id/virtual-room', async ({ db, user, params, body }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_manage_sessions');
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học này chưa gắn phòng học trực tuyến.');

    const nextTitle = 'room_title' in body ? text(body, 'room_title', { required: true, max: 200, label: 'tên phòng' }) : room.room_title;
    const nextUrl = 'join_url' in body ? text(body, 'join_url', { required: true, max: 500, label: 'Meeting URL' }) : room.join_url;
    if (!/^https:\/\//i.test(nextUrl)) {
      fail(422, 'INVALID_MEETING_URL', 'Meeting URL phải bắt đầu bằng https://');
    }
    const nextMeetingId =
      'external_meeting_id' in body
        ? (text(body, 'external_meeting_id', { max: 80, label: 'mã phòng' }) || '').replace(/\s+/g, '') || null
        : room.external_meeting_id;
    const nextPasscode =
      'passcode' in body
        ? body.passcode
          ? encryptSecret(String(body.passcode).trim(), jwtSecret)
          : null
        : room.encrypted_passcode;
    const isRecurring = 'is_recurring_room' in body ? (body.is_recurring_room ? 1 : 0) : room.is_recurring_room;

    db.prepare(
      `UPDATE virtual_meeting_rooms
       SET room_title = ?, join_url = ?, external_meeting_id = ?, encrypted_passcode = ?,
           is_recurring_room = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextTitle, nextUrl, nextMeetingId, nextPasscode, isRecurring, nowIso(), room.id);

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    return buildVirtualSessionDetailDto(db, user, updatedSession, cls, caps, jwtSecret);
  });

  // 8. Xóa / Gỡ liên kết phòng học trực tuyến khỏi buổi học
  route('DELETE', '/sessions/:id/virtual-room', async ({ db, user, params, log }) => {
    const { session, cls } = requireSession(db, user, params.id, 'can_manage_sessions');
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa có phòng trực tuyến.');

    tx(db, () => {
      db.prepare('UPDATE sessions SET virtual_room_id = NULL, room_or_link = ? WHERE session_id = ?').run(cls.room || null, session.session_id);
      if (!room.is_recurring_room) {
        db.prepare('DELETE FROM virtual_meeting_rooms WHERE id = ?').run(room.id);
      }
    });
    log('INFO', `[virtual-room] detached room ${room.id} from ${session.session_id} by ${user.id}`);
    return { detached: true, session_id: session.session_id };
  });

  // 9. Giảng viên Bắt đầu buổi học trực tuyến (trả về Host Start URL đã giải mã — CHỈ dành cho Host/Giảng viên)
  route('POST', '/sessions/:id/virtual-room/start', ({ db, user, params, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    if (caps.role === 'STUDENT') {
      fail(403, 'HOST_START_FORBIDDEN', 'Học viên không có quyền khởi tạo quyền Host phòng học.');
    }
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa gắn phòng trực tuyến.');

    const nowVnStr = nowVn();
    const now = nowIso();
    tx(db, () => {
      db.prepare("UPDATE virtual_meeting_rooms SET room_status = 'LIVE', updated_at = ? WHERE id = ?").run(now, room.id);
      db.prepare(
        `UPDATE sessions
         SET live_status = 'LIVE',
             live_started_at = COALESCE(live_started_at, ?),
             attendance_sync_status = CASE WHEN attendance_sync_status = 'IDLE' THEN 'SYNCING' ELSE attendance_sync_status END
         WHERE session_id = ?`
      ).run(nowVnStr, session.session_id);
    });

    const hostStartUrl = room.encrypted_host_start_url
      ? decryptSecret(room.encrypted_host_start_url, jwtSecret)
      : room.join_url;

    log('INFO', `[virtual-room] host started session ${session.session_id} by ${user.id}`);
    return {
      session_id: session.session_id,
      live_status: 'LIVE',
      live_started_at: session.live_started_at || nowVnStr,
      host_start_url: hostStartUrl,
      join_url: room.join_url,
    };
  });

  // 10. Học viên (hoặc Giảng viên) nhấn "Tham gia lớp học trực tuyến"
  // Kiểm tra RBAC & ghi danh lớp học; sinh token định danh học viên; KHÔNG BAO GIỜ trả về host_start_url hay OAuth token!
  route('POST', '/sessions/:id/virtual-room/join', ({ db, user, params, log }) => {
    const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(params.id);
    if (!session) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy buổi học.');
    const { cls, caps } = requireClassAccess(db, user, session.subject_class_id, 'can_view');
    if (session.session_status === 'CANCELLED') {
      fail(422, 'SESSION_CANCELLED', 'Buổi học này đã bị hủy.');
    }

    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) {
      fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa có link phòng học trực tuyến.');
    }

    const now = nowIso();
    let lmsJoinToken = null;
    let registrantId = null;

    if (caps.role === 'STUDENT' || isStudent(user)) {
      // Kiểm tra ghi danh ACTIVE trong lớp
      const enrollment = db
        .prepare("SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'")
        .get(cls.id, user.id);
      if (!enrollment) {
        fail(403, 'NOT_ENROLLED_IN_CLASS', 'Bạn không nằm trong danh sách học viên của lớp học này.');
      }

      lmsJoinToken = `lmst_${crypto.randomBytes(8).toString('hex')}`;
      registrantId = `reg_${user.code}`;

      tx(db, () => {
        const existingMap = db
          .prepare('SELECT id FROM virtual_identity_mappings WHERE subject_class_id = ? AND student_id = ? AND provider = ?')
          .get(cls.id, user.id, room.provider);
        if (existingMap) {
          db.prepare(
            `UPDATE virtual_identity_mappings
             SET provider_email = ?, registrant_id = ?, lms_join_token = ?, updated_at = ?
             WHERE id = ?`
          ).run(user.email.toLowerCase(), registrantId, lmsJoinToken, now, existingMap.id);
        } else {
          db.prepare(
            `INSERT INTO virtual_identity_mappings (
               id, subject_class_id, student_id, provider, provider_email,
               provider_user_id, registrant_id, lms_join_token, mapped_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'SYSTEM_AUTH', ?, ?)`
          ).run(
            `vim_${crypto.randomBytes(6).toString('hex')}`,
            cls.id,
            user.id,
            room.provider,
            user.email.toLowerCase(),
            registrantId,
            lmsJoinToken,
            now,
            now
          );
        }

        // Nếu nền tảng hỗ trợ đồng bộ & buổi học đang diễn ra, ghi nhận sự kiện vào cổng LMS_GATEWAY
        if (room.supports_auto_sync && (session.live_status === 'LIVE' || Date.now() >= Date.parse(session.scheduled_start_at) - 15 * 60000)) {
          const alreadyIn = db
            .prepare(
              'SELECT id FROM virtual_participant_sessions WHERE session_id = ? AND virtual_room_id = ? AND matched_student_id = ? AND is_currently_in_room = 1'
            )
            .get(session.session_id, room.id, user.id);
          if (!alreadyIn) {
            recordParticipantJoinEvent(db, {
              session,
              room,
              externalParticipantId: `lms_${user.code}`,
              registrantId,
              lmsJoinToken,
              participantEmail: user.email,
              displayName: user.full_name,
              joinAtIso: new Date().toISOString(),
              deviceInfo: 'LMSPLUS Verified Gateway',
              source: 'LMS_GATEWAY',
            });
            calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });
          }
        }
      });
    }

    const passcode = room.encrypted_passcode ? decryptSecret(room.encrypted_passcode, jwtSecret) : null;
    const sep = room.join_url.includes('?') ? '&' : '?';
    const personalizedJoinUrl = lmsJoinToken
      ? `${room.join_url}${sep}uname=${encodeURIComponent(`${user.code} - ${user.full_name}`)}&lms_token=${encodeURIComponent(lmsJoinToken)}`
      : room.join_url;

    log('INFO', `[virtual-room] participant join ${user.code} (${user.id}) -> session ${session.session_id}`);
    return {
      session_id: session.session_id,
      session_title: session.session_title,
      class_code: cls.code,
      class_title: cls.title,
      provider: room.provider,
      external_platform_name:
        room.external_platform_name ||
        (room.provider === 'ZOOM' ? 'Zoom Meeting' : room.provider === 'GOOGLE_MEET' ? 'Google Meet' : 'Phòng học trực tuyến'),
      external_meeting_id: room.external_meeting_id ? formatZoomMeetingId(room.external_meeting_id) : null,
      join_url: personalizedJoinUrl,
      passcode,
      registrant_id: registrantId,
      lms_join_token: lmsJoinToken,
      verified_identity: {
        user_id: user.id,
        code: user.code,
        full_name: user.full_name,
        email: user.email,
      },
      supports_auto_sync: Boolean(room.supports_auto_sync),
      sync_notice: room.supports_auto_sync ? null : EXTERNAL_NO_SYNC_NOTICE,
    };
  });

  // 11. Kết thúc buổi học trực tuyến & Tự động tổng hợp điểm danh dự kiến
  route('POST', '/sessions/:id/virtual-room/end', async ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa có phòng trực tuyến.');

    const endVnStr = nowVn();
    const now = nowIso();
    const waitProviderReport = Boolean(body?.wait_for_provider_report);

    tx(db, () => {
      // Đóng toàn bộ các phiên còn mở tại thời điểm kết thúc buổi học
      const openRows = db
        .prepare('SELECT * FROM virtual_participant_sessions WHERE session_id = ? AND virtual_room_id = ? AND is_currently_in_room = 1')
        .all(session.session_id, room.id);
      for (const op of openRows) {
        const durSec = Math.max(0, Math.round((Date.parse(endVnStr) - Date.parse(op.join_at)) / 1000));
        db.prepare(
          'UPDATE virtual_participant_sessions SET leave_at = ?, duration_sec = ?, is_currently_in_room = 0, updated_at = ? WHERE id = ?'
        ).run(endVnStr, durSec, now, op.id);
      }

      db.prepare("UPDATE virtual_meeting_rooms SET room_status = 'ENDED', updated_at = ? WHERE id = ?").run(now, room.id);
      db.prepare(
        `UPDATE sessions
         SET live_status = 'ENDED',
             live_ended_at = ?,
             session_status = CASE WHEN session_status = 'SCHEDULED' THEN 'COMPLETED' ELSE session_status END,
             attendance_sync_status = ?
         WHERE session_id = ?`
      ).run(
        endVnStr,
        !room.supports_auto_sync
          ? 'IDLE'
          : waitProviderReport
          ? 'WAITING_PROVIDER_DATA'
          : 'SYNCING',
        session.session_id
      );
    });

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    if (room.supports_auto_sync && !waitProviderReport) {
      calculateSessionVirtualAttendance(db, updatedSession, {
        referenceTimeIso: endVnStr,
        preserveManualAdjustments: true,
      });
    }

    log('INFO', `[virtual-room] ended session ${session.session_id} by ${user.id}`);
    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 12. Nhận Webhook từ Zoom / Google Meet (Hỗ trợ xác thực chữ ký HMAC-SHA256, chống replay & idempotency)
  route('POST', '/webhooks/:provider', ({ req, db, params, body, log }) => {
    const rawBody = req.__rawBody || JSON.stringify(body || {});
    return processProviderWebhook({
      db,
      provider: params.provider,
      headers: req.headers || {},
      rawBody,
      body,
      jwtSecret,
      log,
      skipSignatureVerify: false,
    });
  });

  // 13. Mô phỏng sự kiện Webhook thời gian thực (cho phép Giảng viên/QA kiểm chứng luồng vào/ra nhiều lần & UNKNOWN ngay trên giao diện)
  route('POST', '/sessions/:id/virtual-room/simulate-event', ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa có phòng trực tuyến.');
    if (!room.supports_auto_sync) {
      fail(422, 'AUTO_SYNC_NOT_SUPPORTED', EXTERNAL_NO_SYNC_NOTICE);
    }

    const scenario = String(body?.scenario || 'REALISTIC_CLASSROOM_BATCH').toUpperCase();
    const roster = sessionRoster(db, session);
    const startMs = Date.parse(session.scheduled_start_at);
    const endMs = Date.parse(session.scheduled_end_at);
    const zoomAdapter = createProviderAdapter('ZOOM', { db, jwtSecret, log });

    const dispatchSignedWebhook = (eventPayload) => {
      const raw = JSON.stringify(eventPayload);
      const sigHeaders = zoomAdapter.signWebhookPayload(raw);
      return processProviderWebhook({
        db,
        provider: 'ZOOM',
        headers: sigHeaders,
        rawBody: raw,
        body: eventPayload,
        jwtSecret,
        log,
        skipSignatureVerify: false,
      });
    };

    if (scenario === 'SINGLE_JOIN') {
      const targetStudent = roster.find((r) => r.student_id === body.student_id) || roster[0];
      const isUnknown = Boolean(body.as_unknown);
      const joinIso = body.join_at || new Date().toISOString();
      dispatchSignedWebhook({
        event: 'meeting.participant_joined',
        event_ts: Date.now(),
        payload: {
          object: {
            id: room.external_meeting_id,
            participant: {
              user_id: isUnknown ? `unk_${Date.now()}` : `zm_${targetStudent.code}`,
              user_name: isUnknown ? body.display_name || 'Thiết bị iPad chưa đăng nhập' : targetStudent.full_name,
              email: isUnknown ? '' : targetStudent.email,
              join_time: joinIso,
            },
          },
        },
      });
    } else if (scenario === 'SINGLE_LEAVE') {
      const targetStudent = roster.find((r) => r.student_id === body.student_id) || roster[0];
      const leaveIso = body.leave_at || new Date().toISOString();
      dispatchSignedWebhook({
        event: 'meeting.participant_left',
        event_ts: Date.now(),
        payload: {
          object: {
            id: room.external_meeting_id,
            participant: {
              user_id: body.external_participant_id || `zm_${targetStudent.code}`,
              user_name: body.display_name || targetStudent.full_name,
              email: body.email ?? targetStudent.email,
              leave_time: leaveIso,
            },
          },
        },
      });
    } else {
      // Kịch bản đầy đủ: Khởi chạy phòng họp + học viên ra vào nhiều lần + thiết bị chồng lấn + đi muộn + tham gia một phần + khách UNKNOWN
      dispatchSignedWebhook({
        event: 'meeting.started',
        event_ts: Date.now(),
        payload: {
          object: {
            id: room.external_meeting_id,
            start_time: new Date(startMs).toISOString(),
          },
        },
      });

      roster.slice(0, 12).forEach((st, idx) => {
        if (idx === 0) {
          // Học viên 1 (HS50101): Vào/ra 3 lần + trùng lặp thiết bị (minh họa hợp nhất khoảng chồng lấn chính xác)
          const slices = [
            [0, 12],
            [5, 10], // Thiết bị thứ 2 chồng lấn hoàn toàn trong [0, 12] -> không bị cộng trùng!
            [14, 24],
            [26, 35],
          ];
          for (const [mIn, mOut] of slices) {
            dispatchSignedWebhook({
              event: 'meeting.participant_joined',
              event_ts: Date.now(),
              payload: {
                object: {
                  id: room.external_meeting_id,
                  participant: {
                    user_id: `zm_${st.code}_${mIn}`,
                    user_name: st.full_name,
                    email: st.email,
                    join_time: new Date(startMs + mIn * 60000).toISOString(),
                  },
                },
              },
            });
            dispatchSignedWebhook({
              event: 'meeting.participant_left',
              event_ts: Date.now(),
              payload: {
                object: {
                  id: room.external_meeting_id,
                  participant: {
                    user_id: `zm_${st.code}_${mIn}`,
                    user_name: st.full_name,
                    email: st.email,
                    leave_time: new Date(Math.min(endMs, startMs + mOut * 60000)).toISOString(),
                  },
                },
              },
            });
          }
        } else if (idx === 1) {
          // Học viên 2: Đi muộn 14 phút nhưng ở đến cuối buổi -> LATE
          dispatchSignedWebhook({
            event: 'meeting.participant_joined',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  join_time: new Date(startMs + 14 * 60000).toISOString(),
                },
              },
            },
          });
          dispatchSignedWebhook({
            event: 'meeting.participant_left',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  leave_time: new Date(endMs).toISOString(),
                },
              },
            },
          });
        } else if (idx === 2) {
          // Học viên 3: Chỉ tham gia 8 phút rồi thoát -> PARTIAL
          dispatchSignedWebhook({
            event: 'meeting.participant_joined',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  join_time: new Date(startMs + 2 * 60000).toISOString(),
                },
              },
            },
          });
          dispatchSignedWebhook({
            event: 'meeting.participant_left',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  leave_time: new Date(startMs + 10 * 60000).toISOString(),
                },
              },
            },
          });
        } else {
          // Các học viên còn lại trong nhóm: Tham gia đầy đủ -> PRESENT
          dispatchSignedWebhook({
            event: 'meeting.participant_joined',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  join_time: new Date(startMs + 1 * 60000).toISOString(),
                },
              },
            },
          });
          dispatchSignedWebhook({
            event: 'meeting.participant_left',
            event_ts: Date.now(),
            payload: {
              object: {
                id: room.external_meeting_id,
                participant: {
                  user_id: `zm_${st.code}`,
                  user_name: st.full_name,
                  email: st.email,
                  leave_time: new Date(endMs - 1 * 60000).toISOString(),
                },
              },
            },
          });
        }
      });

      // Thêm 1 người tham gia chỉ có display_name trùng tên học viên thứ 13 nhưng KHÔNG có email/token xác thực -> phải vào UNKNOWN
      const targetUnverified = roster[12];
      if (targetUnverified) {
        dispatchSignedWebhook({
          event: 'meeting.participant_joined',
          event_ts: Date.now(),
          payload: {
            object: {
              id: room.external_meeting_id,
              participant: {
                user_id: 'zm_guest_unverified_01',
                user_name: `${targetUnverified.full_name} (Khách Zoom chưa đăng nhập)`,
                email: '',
                join_time: new Date(startMs + 3 * 60000).toISOString(),
              },
            },
          },
        });
        dispatchSignedWebhook({
          event: 'meeting.participant_left',
          event_ts: Date.now(),
          payload: {
            object: {
              id: room.external_meeting_id,
              participant: {
                user_id: 'zm_guest_unverified_01',
                user_name: `${targetUnverified.full_name} (Khách Zoom chưa đăng nhập)`,
                email: '',
                leave_time: new Date(endMs - 2 * 60000).toISOString(),
              },
            },
          },
        });
      }
    }

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    return buildVirtualSessionDetailDto(db, user, updatedSession, cls, caps, jwtSecret);
  });

  // 14. Đồng bộ lại báo cáo người tham gia từ Provider & Tính lại điểm danh
  route('POST', '/sessions/:id/virtual-attendance/sync', async ({ db, user, params, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room) fail(404, 'VIRTUAL_ROOM_NOT_FOUND', 'Buổi học chưa có phòng trực tuyến.');
    if (!room.supports_auto_sync) {
      fail(422, 'AUTO_SYNC_NOT_SUPPORTED', EXTERNAL_NO_SYNC_NOTICE);
    }

    const jobId = `vsj_${crypto.randomBytes(6).toString('hex')}`;
    const startedAt = nowIso();
    db.prepare(
      `INSERT INTO virtual_sync_jobs (
         id, session_id, virtual_room_id, provider, trigger_source, status, attempt_count, started_at
       ) VALUES (?, ?, ?, ?, 'MANUAL_RESYNC', 'RUNNING', 1, ?)`
    ).run(jobId, session.session_id, room.id, room.provider, startedAt);

    if (session.attendance_sync_status !== 'CONFIRMED') {
      db.prepare("UPDATE sessions SET attendance_sync_status = 'SYNCING' WHERE session_id = ?").run(session.session_id);
    }

    const adapter = createProviderAdapter(room.provider, { db, jwtSecret, log });
    const report = await adapter.getMeetingReport({ room, session });

    // Nếu Provider trả thêm các bản ghi từ past_meetings report, hợp nhất idempotent vào virtual_participant_sessions
    for (const p of report.participants || []) {
      const key = `rep_${room.id}_${p.external_participant_id || p.display_name}_${p.join_at}`;
      const exists = db
        .prepare(
          `SELECT id FROM virtual_participant_sessions
           WHERE session_id = ? AND virtual_room_id = ?
             AND (session_key = ? OR (external_participant_id = ? AND join_at = ?))`
        )
        .get(session.session_id, room.id, key, p.external_participant_id || '', p.join_at);
      if (!exists && p.join_at) {
        const jRes = recordParticipantJoinEvent(db, {
          session,
          room,
          externalParticipantId: p.external_participant_id,
          registrantId: p.registrant_id || null,
          participantEmail: p.participant_email,
          displayName: p.display_name,
          joinAtIso: p.join_at,
          source: 'PROVIDER_REPORT',
          sessionKey: key,
        });
        if (p.leave_at && !jRes.deduplicated) {
          const durSec = Math.max(0, Math.round((Date.parse(p.leave_at) - Date.parse(p.join_at)) / 1000));
          db.prepare(
            'UPDATE virtual_participant_sessions SET leave_at = ?, duration_sec = ?, is_currently_in_room = 0 WHERE id = ?'
          ).run(vnIso(new Date(p.leave_at)), durSec, jRes.id);
        }
      }
    }

    const refreshedForCalc = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    if (refreshedForCalc.attendance_sync_status === 'WAITING_PROVIDER_DATA') {
      db.prepare("UPDATE sessions SET attendance_sync_status = 'SYNCING' WHERE session_id = ?").run(session.session_id);
    }

    const calcResult = calculateSessionVirtualAttendance(
      db,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      { preserveManualAdjustments: true }
    );

    const totalFetched = db
      .prepare('SELECT COUNT(*) n FROM virtual_participant_sessions WHERE session_id = ? AND virtual_room_id = ?')
      .get(session.session_id, room.id).n;
    const matchedCnt = db
      .prepare(
        'SELECT COUNT(DISTINCT matched_student_id) n FROM virtual_participant_sessions WHERE session_id = ? AND virtual_room_id = ? AND matched_student_id IS NOT NULL'
      )
      .get(session.session_id, room.id).n;

    db.prepare(
      `UPDATE virtual_sync_jobs
       SET status = 'COMPLETED', participants_fetched = ?, matched_students = ?, unknown_participants = ?, completed_at = ?
       WHERE id = ?`
    ).run(totalFetched, matchedCnt, calcResult.unknown_participants_count || 0, nowIso(), jobId);

    log('INFO', `[virtual-sync] synced session ${session.session_id} (${totalFetched} slices, ${matchedCnt} matched) by ${user.id}`);
    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 15. Cấu hình quy tắc điểm danh tự động cho buổi học hoặc cho cả lớp học
  route('PUT', '/sessions/:id/virtual-attendance/rules', ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const lateGrace = intField(body, 'late_grace_minutes', { min: 0, max: 120, label: 'thời gian cho phép vào muộn' }) ?? 10;
    const minDuration = intField(body, 'min_duration_minutes', { min: 1, max: 600, label: 'thời gian tham gia tối thiểu' }) ?? 20;
    const minPct = intField(body, 'min_attendance_pct', { min: 1, max: 100, label: 'tỷ lệ tham gia tối thiểu (%)' }) ?? 70;
    const minValidSec = intField(body, 'min_valid_seconds', { min: 15, max: 600, label: 'thời gian tối thiểu hợp lệ (giây)' }) ?? 60;
    const allowAdjust = body.allow_instructor_adjustment !== undefined ? Boolean(body.allow_instructor_adjustment) : true;
    const windowStart = typeof body.attendance_window_start_at === 'string' && body.attendance_window_start_at.trim()
      ? body.attendance_window_start_at.trim()
      : null;
    const windowEnd = typeof body.attendance_window_end_at === 'string' && body.attendance_window_end_at.trim()
      ? body.attendance_window_end_at.trim()
      : null;

    if (windowStart && windowEnd && Date.parse(windowEnd) <= Date.parse(windowStart)) {
      fail(422, 'INVALID_ATTENDANCE_WINDOW', 'Thời điểm kết thúc tính điểm danh phải sau thời điểm bắt đầu.');
    }

    const rulesObj = {
      late_grace_minutes: lateGrace,
      min_duration_minutes: minDuration,
      min_attendance_pct: minPct,
      min_valid_seconds: minValidSec,
      attendance_window_start_at: windowStart,
      attendance_window_end_at: windowEnd,
      allow_instructor_adjustment: allowAdjust,
    };

    tx(db, () => {
      db.prepare('UPDATE sessions SET attendance_rules_json = ? WHERE session_id = ?').run(
        JSON.stringify(rulesObj),
        session.session_id
      );
      if (body.apply_to_class && caps.can_manage_class) {
        db.prepare('UPDATE subject_classes SET attendance_rules_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(rulesObj),
          nowIso(),
          cls.id
        );
      }
    });

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    calculateSessionVirtualAttendance(db, updatedSession, { preserveManualAdjustments: true });
    log('INFO', `[virtual-rules] updated rules for ${session.session_id} by ${user.id}`);
    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 16. Giảng viên xác nhận thủ công danh tính cho người tham gia UNKNOWN
  route('POST', '/sessions/:id/virtual-attendance/map-participant', ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const participantSessionId = text(body, 'participant_session_id', { required: true, max: 80, label: 'mã phiên tham gia' });
    const studentId = text(body, 'student_id', { required: true, max: 80, label: 'mã học viên' });

    const roster = sessionRoster(db, session);
    const student = roster.find((s) => s.student_id === studentId);
    if (!student) {
      fail(422, 'STUDENT_NOT_IN_CLASS', 'Học viên được chọn không thuộc danh sách lớp học này.');
    }

    const ps = db
      .prepare('SELECT * FROM virtual_participant_sessions WHERE id = ? AND session_id = ?')
      .get(participantSessionId, session.session_id);
    if (!ps) {
      fail(404, 'PARTICIPANT_SESSION_NOT_FOUND', 'Không tìm thấy phiên người tham gia cần đối chiếu.');
    }

    const now = nowIso();
    tx(db, () => {
      // Cập nhật phiên hiện tại và các phiên cùng external_participant_id / display_name trong buổi học này
      if (ps.external_participant_id) {
        db.prepare(
          `UPDATE virtual_participant_sessions
           SET matched_student_id = ?, identity_match_method = 'INSTRUCTOR_MANUAL_MAP', updated_at = ?
           WHERE session_id = ? AND external_participant_id = ?`
        ).run(student.student_id, now, session.session_id, ps.external_participant_id);
      } else {
        db.prepare(
          `UPDATE virtual_participant_sessions
           SET matched_student_id = ?, identity_match_method = 'INSTRUCTOR_MANUAL_MAP', updated_at = ?
           WHERE id = ?`
        ).run(student.student_id, now, ps.id);
      }

      // Lưu vào bảng virtual_identity_mappings để những lần sau tự động nhận diện
      if (ps.external_participant_id || ps.participant_email) {
        db.prepare(
          `INSERT INTO virtual_identity_mappings (
             id, subject_class_id, student_id, provider, provider_email,
             provider_user_id, mapped_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'INSTRUCTOR_MANUAL', ?, ?)`
        ).run(
          `vim_${crypto.randomBytes(6).toString('hex')}`,
          cls.id,
          student.student_id,
          ps.provider,
          ps.participant_email || null,
          ps.external_participant_id || null,
          now,
          now
        );
      }

      // Lưu lịch sử kiểm toán
      db.prepare(
        `INSERT INTO virtual_attendance_adjustments (
           id, session_id, student_id, action_type, previous_status, new_status,
           reason, actor_id, actor_name, metadata_json, created_at
         ) VALUES (?, ?, ?, 'IDENTITY_MAPPING', 'UNKNOWN', 'MATCHED', ?, ?, ?, ?, ?)`
      ).run(
        `vaa_${crypto.randomBytes(6).toString('hex')}`,
        session.session_id,
        student.student_id,
        body.reason
          ? String(body.reason).trim()
          : `Giảng viên xác nhận người tham gia "${ps.display_name}" là học viên ${student.code} (${student.full_name})`,
        user.id,
        user.full_name || user.id,
        JSON.stringify({
          participant_session_id: ps.id,
          display_name: ps.display_name,
          external_participant_id: ps.external_participant_id,
        }),
        now
      );
    });

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    calculateSessionVirtualAttendance(db, updatedSession, { preserveManualAdjustments: true });
    log('INFO', `[virtual-map] mapped participant ${ps.id} -> student ${student.code} by ${user.id}`);

    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 17. Giảng viên điều chỉnh kết quả điểm danh của học viên (có lưu lịch sử & lý do bắt buộc)
  route('PATCH', '/sessions/:id/virtual-attendance/records/:studentId', ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    if (session.attendance_locked_at && !caps.can_lock_attendance) {
      fail(423, 'ATTENDANCE_LOCKED', 'Điểm danh buổi học này đã chốt khóa. Cần Giáo vụ mở khóa để chỉnh sửa.');
    }
    const rules = getSessionAttendanceRules(db, session, cls);
    if (!rules.allow_instructor_adjustment && !isAdmin(user) && !isStaff(user)) {
      fail(403, 'ADJUSTMENT_DISABLED', 'Cấu hình buổi học này không cho phép điều chỉnh thủ công kết quả điểm danh tự động.');
    }

    const newStatus = oneOf(body, 'status', ['PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED'], {
      required: true,
      label: 'trạng thái điểm danh',
    });
    const reason = text(body, 'reason', { required: true, min: 3, max: 500, label: 'lý do điều chỉnh' });

    const roster = sessionRoster(db, session);
    const student = roster.find((s) => s.student_id === params.studentId);
    if (!student) fail(404, 'STUDENT_NOT_IN_CLASS', 'Học viên không thuộc danh sách lớp.');

    calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });
    const existingCalc = db
      .prepare('SELECT * FROM virtual_attendance_calculations WHERE session_id = ? AND student_id = ?')
      .get(session.session_id, student.student_id);

    const prevStatus = existingCalc ? existingCalc.final_status : 'ABSENT';
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `UPDATE virtual_attendance_calculations
         SET final_status = ?, is_manually_adjusted = 1, adjustment_reason = ?, adjusted_by = ?, adjusted_at = ?
         WHERE session_id = ? AND student_id = ?`
      ).run(newStatus, reason, user.id, now, session.session_id, student.student_id);

      db.prepare(
        `INSERT INTO virtual_attendance_adjustments (
           id, session_id, student_id, action_type, previous_status, new_status,
           reason, actor_id, actor_name, metadata_json, created_at
         ) VALUES (?, ?, ?, 'STATUS_OVERRIDE', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `vaa_${crypto.randomBytes(6).toString('hex')}`,
        session.session_id,
        student.student_id,
        prevStatus,
        newStatus,
        reason,
        user.id,
        user.full_name || user.id,
        JSON.stringify({ student_code: student.code, student_name: student.full_name }),
        now
      );

      // Nếu buổi học đã CONFIRMED trước đó, đồng bộ luôn bản ghi sang attendance_records + attendance_audit_logs
      if (session.attendance_sync_status === 'CONFIRMED' || session.attendance_saved_at) {
        const mappedRecordStatus =
          newStatus === 'ABSENT'
            ? 'UNEXCUSED_ABSENCE'
            : newStatus === 'EXCUSED'
            ? 'EXCUSED_ABSENCE'
            : newStatus === 'PARTIAL'
            ? 'LATE'
            : newStatus;
        const attRow = db
          .prepare('SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ?')
          .get(session.session_id, student.student_id);
        if (attRow) {
          db.prepare(
            'UPDATE attendance_records SET attendance_status = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?'
          ).run(mappedRecordStatus, reason, user.id, now, attRow.id);
          db.prepare(
            `INSERT INTO attendance_audit_logs (
               id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            crypto.randomUUID(),
            attRow.id,
            attRow.attendance_status,
            mappedRecordStatus,
            attRow.note,
            reason,
            reason,
            user.id,
            now
          );
        }
      }
    });

    const updatedSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id);
    calculateSessionVirtualAttendance(db, updatedSession, { preserveManualAdjustments: true });
    log('INFO', `[virtual-adjust] ${student.code}: ${prevStatus} -> ${newStatus} by ${user.id}`);

    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 18. Xác nhận & Chốt kết quả điểm danh tự động (đồng bộ sang bảng attendance_records chính thức của lớp)
  route('POST', '/sessions/:id/virtual-attendance/confirm', ({ db, user, params, body, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    if (session.session_status === 'CANCELLED') {
      fail(422, 'SESSION_CANCELLED', 'Buổi học đã hủy, không thể chốt điểm danh.');
    }
    const room = session.virtual_room_id
      ? db.prepare('SELECT * FROM virtual_meeting_rooms WHERE id = ?').get(session.virtual_room_id)
      : db.prepare('SELECT * FROM virtual_meeting_rooms WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.session_id);
    if (!room || !room.supports_auto_sync) {
      fail(422, 'AUTO_SYNC_NOT_SUPPORTED', EXTERNAL_NO_SYNC_NOTICE);
    }
    if (session.attendance_sync_status === 'WAITING_PROVIDER_DATA') {
      fail(
        422,
        'PROVIDER_DATA_NOT_READY',
        'Hệ thống đang chờ báo cáo cuối cùng từ nền tảng họp trực tuyến. Vui lòng bấm "Đồng bộ lại dữ liệu" trước khi chốt.'
      );
    }

    // Nếu người dùng chọn giải quyết toàn bộ MANUAL_REVIEW còn lại thành ABSENT khi xác nhận
    const resolveRemainingAsAbsent = Boolean(body?.resolve_unmatched_as_absent);
    calculateSessionVirtualAttendance(db, session, { preserveManualAdjustments: true });

    const calcs = db
      .prepare('SELECT * FROM virtual_attendance_calculations WHERE session_id = ?')
      .all(session.session_id);
    const unresolved = calcs.filter((c) => c.final_status === 'MANUAL_REVIEW');

    if (unresolved.length > 0 && !resolveRemainingAsAbsent) {
      fail(
        422,
        'NEEDS_MANUAL_REVIEW',
        `Còn ${unresolved.length} học viên ở trạng thái Cần giảng viên xác nhận (MANUAL_REVIEW) hoặc còn người tham gia chưa đối chiếu danh tính. Vui lòng đối chiếu hoặc xác nhận chuyển sang Vắng trước khi chốt.`
      );
    }

    const now = nowIso();
    tx(db, () => {
      if (unresolved.length > 0 && resolveRemainingAsAbsent) {
        db.prepare(
          `UPDATE virtual_attendance_calculations
           SET final_status = 'ABSENT',
               adjustment_reason = COALESCE(adjustment_reason, 'Chốt điểm danh: không có phiên tham gia xác thực')
           WHERE session_id = ? AND final_status = 'MANUAL_REVIEW'`
        ).run(session.session_id);
      }

      const finalCalcs = db
        .prepare('SELECT * FROM virtual_attendance_calculations WHERE session_id = ?')
        .all(session.session_id);

      for (const c of finalCalcs) {
        // Ánh xạ sang enum chuẩn của bảng attendance_records để thống kê chuyên cần toàn lớp hoạt động đồng nhất
        const canonicalStatus =
          c.final_status === 'PRESENT'
            ? 'PRESENT'
            : c.final_status === 'LATE' || c.final_status === 'PARTIAL'
            ? 'LATE'
            : c.final_status === 'EXCUSED'
            ? 'EXCUSED_ABSENCE'
            : 'UNEXCUSED_ABSENCE';

        const durMin = Math.round((c.total_merged_duration_sec / 60) * 10) / 10;
        const autoNote =
          c.adjustment_reason ||
          (c.total_merged_duration_sec > 0
            ? `Phòng trực tuyến: tham gia ${durMin} phút (${c.attendance_ratio_pct}%)${c.final_status === 'PARTIAL' ? ' [Tham gia một phần]' : ''}`
            : 'Phòng trực tuyến: không có dữ liệu tham gia hợp lệ');

        const existingRec = db
          .prepare('SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ?')
          .get(session.session_id, c.student_id);

        if (!existingRec) {
          const recId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO attendance_records (
               id, subject_class_id, class_session_id, student_id, attendance_status,
               check_in_method, check_in_at, note, recorded_by, updated_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?)`
          ).run(
            recId,
            cls.id,
            session.session_id,
            c.student_id,
            canonicalStatus,
            c.first_join_at || null,
            autoNote.slice(0, 500),
            user.id,
            user.id,
            now,
            now
          );
          db.prepare(
            `INSERT INTO attendance_audit_logs (
               id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at
             ) VALUES (?, ?, NULL, ?, NULL, ?, 'Đồng bộ & xác nhận từ Phòng học trực tuyến', ?, ?)`
          ).run(crypto.randomUUID(), recId, canonicalStatus, autoNote.slice(0, 500), user.id, now);
        } else if (existingRec.attendance_status !== canonicalStatus || (existingRec.note || '') !== autoNote) {
          db.prepare(
            'UPDATE attendance_records SET attendance_status = ?, check_in_at = COALESCE(?, check_in_at), note = ?, updated_by = ?, updated_at = ? WHERE id = ?'
          ).run(canonicalStatus, c.first_join_at || null, autoNote.slice(0, 500), user.id, now, existingRec.id);
          db.prepare(
            `INSERT INTO attendance_audit_logs (
               id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'Cập nhật chốt điểm danh Phòng học trực tuyến', ?, ?)`
          ).run(
            crypto.randomUUID(),
            existingRec.id,
            existingRec.attendance_status,
            canonicalStatus,
            existingRec.note,
            autoNote.slice(0, 500),
            user.id,
            now
          );
        }
      }

      db.prepare(
        `UPDATE sessions
         SET attendance_sync_status = 'CONFIRMED',
             attendance_saved_at = ?,
             attendance_saved_by = ?
         WHERE session_id = ?`
      ).run(now, user.id, session.session_id);

      db.prepare(
        `INSERT INTO virtual_attendance_adjustments (
           id, session_id, student_id, action_type, previous_status, new_status,
           reason, actor_id, actor_name, metadata_json, created_at
         ) VALUES (?, ?, NULL, 'CONFIRM_LOCK', ?, 'CONFIRMED', ?, ?, ?, ?, ?)`
      ).run(
        `vaa_${crypto.randomBytes(6).toString('hex')}`,
        session.session_id,
        session.attendance_sync_status,
        'Giảng viên xác nhận và chốt bảng điểm danh tự động từ phòng học trực tuyến',
        user.id,
        user.full_name || user.id,
        JSON.stringify({ confirmed_students: finalCalcs.length }),
        now
      );
    });

    log('INFO', `[virtual-confirm] confirmed virtual attendance for ${session.session_id} by ${user.id}`);
    return buildVirtualSessionDetailDto(
      db,
      user,
      db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id),
      cls,
      caps,
      jwtSecret
    );
  });

  // 19. Lịch sử điều chỉnh, sự kiện Webhook & Job đồng bộ của buổi học
  route('GET', '/sessions/:id/virtual-attendance/history', ({ db, user, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_view_roster');
    const adjustments = db
      .prepare(
        `SELECT a.*, u.code AS student_code, u.full_name AS student_name
         FROM virtual_attendance_adjustments a
         LEFT JOIN users u ON u.id = a.student_id
         WHERE a.session_id = ?
         ORDER BY a.created_at DESC, a.rowid DESC LIMIT 200`
      )
      .all(session.session_id);
    const syncJobs = db
      .prepare('SELECT * FROM virtual_sync_jobs WHERE session_id = ? ORDER BY started_at DESC LIMIT 50')
      .all(session.session_id);
    const webhookEvents = db
      .prepare(
        `SELECT id, event_key, provider, event_type, external_meeting_id, event_timestamp_ms,
                signature_verified, processing_status, received_at
         FROM virtual_webhook_events
         WHERE session_id = ?
         ORDER BY received_at DESC, rowid DESC LIMIT 100`
      )
      .all(session.session_id);
    return {
      adjustments,
      sync_jobs: syncJobs,
      webhook_events: webhookEvents,
    };
  });

  // 20. Xuất báo cáo Excel (CSV UTF-8 BOM) chi tiết thời gian vào/ra và trạng thái điểm danh buổi học trực tuyến
  route('GET', '/sessions/:id/virtual-attendance/export', ({ db, user, params, raw }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_view_roster');
    const detail = buildVirtualSessionDetailDto(db, user, session, cls, caps, jwtSecret);
    const header = [
      'STT',
      'Mã SV',
      'Họ tên',
      'Email',
      'Thời gian vào',
      'Thời gian ra',
      'Số lần vào/ra',
      'Tổng thời gian (phút)',
      'Tỷ lệ tham gia (%)',
      'Phương thức đối chiếu',
      'Trạng thái tự động',
      'Trạng thái cuối cùng',
      'Người điều chỉnh',
      'Lý do điều chỉnh',
    ];
    const lines = [header.map(csvSafeCell).join(',')];
    for (const r of detail.attendance_rows) {
      lines.push(
        [
          r.index,
          r.code,
          r.full_name,
          r.email,
          r.first_join_at || '-',
          r.last_leave_at || '-',
          r.raw_sessions_count,
          r.total_duration_minutes,
          r.attendance_ratio_pct,
          r.identity_match_method,
          r.calculated_status,
          r.final_status,
          r.adjusted_by_name || '',
          r.adjustment_reason || '',
        ]
          .map(csvSafeCell)
          .join(',')
      );
    }
    raw(
      200,
      {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="diem-danh-truc-tuyen.csv"; filename*=UTF-8''${encodeURIComponent(
          `diem-danh-truc-tuyen-${cls.code}-${session.session_id}.csv`
        )}`,
      },
      `\uFEFF${lines.join('\r\n')}`
    );
  });
}
