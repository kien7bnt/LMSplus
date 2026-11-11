/**
 * LMSPLUS Teaching Module — Điểm danh: lưu theo lô, lịch sử, chốt/mở chốt, mã điểm danh động, thống kê, xuất CSV.
 *
 * Trạng thái lưu trong DB dùng enum đã có trong migration 005:
 *   PRESENT (Có mặt) · LATE (Đi muộn) · EXCUSED_ABSENCE (Vắng có phép) · UNEXCUSED_ABSENCE (Vắng không phép)
 *   "Chưa điểm danh" = chưa có bản ghi.
 */

import crypto from 'node:crypto';
import { ATTENDANCE_STATUSES, vnIso } from './schema.mjs';
import { isStudent } from './scope.mjs';
import { fail, nowIso, nowVn, text, intField, tx, compareVietnameseName } from './http.mjs';
import { requireSession, requireClassAccess } from './classes.mjs';

const DEFAULT_POLICY = { late_counts_as_present: true, excused_in_denominator: false, warning_threshold_pct: 80 };
const EDIT_REASON_AFTER_HOURS = 24;
const OPEN_BEFORE_START_MIN = 30;

export function getAttendancePolicy(db) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'attendance_policy'").get();
  let p = {};
  try {
    p = row ? JSON.parse(row.value) : {};
  } catch {
    p = {};
  }
  const policy = { ...DEFAULT_POLICY, ...p };
  policy.formula_text =
    `Tỷ lệ chuyên cần = (Có mặt${policy.late_counts_as_present ? ' + Đi muộn' : ''}) ÷ ` +
    `(Có mặt + Đi muộn + Vắng không phép${policy.excused_in_denominator ? ' + Vắng có phép' : ''}) × 100%. ` +
    'Buổi bị hủy và học viên chưa được điểm danh không được tính.';
  return policy;
}

export function rateFromCounts(counts, policy) {
  const p = counts.PRESENT || 0;
  const l = counts.LATE || 0;
  const e = counts.EXCUSED_ABSENCE || 0;
  const a = counts.UNEXCUSED_ABSENCE || 0;
  const num = p + (policy.late_counts_as_present ? l : 0);
  const den = p + l + a + (policy.excused_in_denominator ? e : 0);
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/** Danh sách học viên thuộc lớp tại thời điểm diễn ra buổi học. */
export function sessionRoster(db, session) {
  const start = Date.parse(session.scheduled_start_at);
  const end = Date.parse(session.scheduled_end_at);
  return db
    .prepare(
      `SELECT e.student_id, e.status, e.enrolled_at, e.dropped_at, u.code, u.full_name, u.email
       FROM class_enrollments e JOIN users u ON u.id = e.student_id WHERE e.subject_class_id = ?`
    )
    .all(session.subject_class_id)
    .filter((r) => Date.parse(r.enrolled_at) <= end && (r.status === 'ACTIVE' || (r.dropped_at && Date.parse(r.dropped_at) > start)))
    .sort((a, b) => compareVietnameseName(a.full_name, b.full_name));
}

function attendanceView(db, user, session, cls, caps) {
  const roster = sessionRoster(db, session);
  const records = db.prepare('SELECT * FROM attendance_records WHERE class_session_id = ?').all(session.session_id);
  const byStudent = Object.fromEntries(records.map((r) => [r.student_id, r]));
  const staff = db
    .prepare(
      `SELECT u.full_name, t.staff_role FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id
       WHERE t.subject_class_id = ? AND t.is_active = 1`
    )
    .all(cls.id);
  const counts = { total: roster.length, PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0, NOT_MARKED: 0 };
  const items = roster.map((r, i) => {
    const rec = byStudent[r.student_id];
    counts[rec ? rec.attendance_status : 'NOT_MARKED']++;
    return {
      index: i + 1,
      student_id: r.student_id,
      code: r.code,
      full_name: r.full_name,
      status: rec ? rec.attendance_status : null,
      note: rec ? rec.note || '' : '',
      check_in_at: rec ? rec.check_in_at : null,
      check_in_method: rec ? rec.check_in_method : null,
      updated_at: rec ? rec.updated_at : null,
    };
  });
  const now = nowVn();
  const openFrom = vnIso(new Date(Date.parse(session.scheduled_start_at) - OPEN_BEFORE_START_MIN * 60000));
  const cancelled = session.session_status === 'CANCELLED';
  const locked = Boolean(session.attendance_locked_at);
  const qr = db
    .prepare('SELECT * FROM attendance_qr_sessions WHERE class_session_id = ? AND is_active = 1 AND valid_until > ? ORDER BY created_at DESC LIMIT 1')
    .get(session.session_id, nowIso());
  return {
    session: {
      id: session.session_id,
      title: session.session_title,
      start_at: session.scheduled_start_at,
      end_at: session.scheduled_end_at,
      room_or_link: session.room_or_link || cls.room || '',
      session_status: session.session_status,
      cancel_reason: session.cancel_reason || '',
      attendance_saved_at: session.attendance_saved_at,
      attendance_locked_at: session.attendance_locked_at,
    },
    class: {
      id: cls.id,
      code: cls.code,
      title: cls.title,
      subject: cls.subject || '',
      delivery_mode: cls.delivery_mode,
      staff,
    },
    counts,
    items,
    qr_active: Boolean(qr),
    capabilities: {
      can_edit: caps.can_take_attendance && !cancelled && (!locked || caps.can_lock_attendance) && now >= openFrom,
      can_lock: caps.can_lock_attendance && !locked && Boolean(session.attendance_saved_at),
      can_unlock: caps.can_lock_attendance && locked,
      can_use_qr: caps.can_take_attendance && !cancelled && !locked,
      reason_required: Date.now() > Date.parse(session.scheduled_end_at) + EDIT_REASON_AFTER_HOURS * 3600000,
      not_open_reason: now < openFrom ? `Điểm danh mở từ ${OPEN_BEFORE_START_MIN} phút trước giờ học.` : null,
    },
  };
}

// --- Mã điểm danh động (6 chữ số, đổi theo chu kỳ) ---
function codeForWindow(secret, windowIndex) {
  const h = crypto.createHmac('sha256', secret).update(String(windowIndex)).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

const failedCheckins = new Map(); // userId|sessionId -> { count, first }
function guardBruteForce(key) {
  const now = Date.now();
  const entry = failedCheckins.get(key);
  if (entry && now - entry.first < 5 * 60000 && entry.count >= 8) {
    fail(429, 'TOO_MANY_ATTEMPTS', 'Bạn nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút hoặc báo giảng viên điểm danh thủ công.');
  }
}
function recordFailure(key) {
  const now = Date.now();
  const entry = failedCheckins.get(key);
  if (!entry || now - entry.first >= 5 * 60000) failedCheckins.set(key, { count: 1, first: now });
  else entry.count++;
}

function computeStats(db, cls, { from, to, includeDropped = false }) {
  const policy = getAttendancePolicy(db);
  const now = nowVn();
  const where = ["subject_class_id = ?", "session_status <> 'CANCELLED'", 'scheduled_start_at <= ?'];
  const p = [cls.id, now];
  if (from) {
    where.push('scheduled_start_at >= ?');
    p.push(`${from}T00:00:00+07:00`);
  }
  if (to) {
    where.push('scheduled_start_at <= ?');
    p.push(`${to}T23:59:59+07:00`);
  }
  const sessions = db.prepare(`SELECT * FROM sessions WHERE ${where.join(' AND ')} ORDER BY scheduled_start_at`).all(...p);
  const sessionIds = new Set(sessions.map((s) => s.session_id));
  const records = db.prepare('SELECT class_session_id, student_id, attendance_status FROM attendance_records WHERE subject_class_id = ?').all(cls.id)
    .filter((r) => sessionIds.has(r.class_session_id));
  const recMap = new Map(records.map((r) => [`${r.class_session_id}|${r.student_id}`, r.attendance_status]));
  let students = db
    .prepare(
      `SELECT e.student_id, e.status, e.enrolled_at, e.dropped_at, u.code, u.full_name
       FROM class_enrollments e JOIN users u ON u.id = e.student_id WHERE e.subject_class_id = ?`
    )
    .all(cls.id);
  if (!includeDropped) students = students.filter((s) => s.status === 'ACTIVE');
  students.sort((a, b) => compareVietnameseName(a.full_name, b.full_name));

  const classCounts = { PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0, NOT_MARKED: 0 };
  const rows = students.map((s) => {
    const c = { PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0, NOT_MARKED: 0 };
    let expected = 0;
    for (const ses of sessions) {
      const start = Date.parse(ses.scheduled_start_at);
      const end = Date.parse(ses.scheduled_end_at);
      const enrolled = Date.parse(s.enrolled_at) <= end && (s.status === 'ACTIVE' || (s.dropped_at && Date.parse(s.dropped_at) > start));
      if (!enrolled) continue;
      expected++;
      const st = recMap.get(`${ses.session_id}|${s.student_id}`);
      c[st || 'NOT_MARKED']++;
    }
    for (const k of Object.keys(c)) classCounts[k] += c[k];
    return {
      student_id: s.student_id,
      code: s.code,
      full_name: s.full_name,
      enrollment_status: s.status,
      total_sessions: expected,
      present: c.PRESENT,
      late: c.LATE,
      excused: c.EXCUSED_ABSENCE,
      absent: c.UNEXCUSED_ABSENCE,
      not_marked: c.NOT_MARKED,
      rate: rateFromCounts(c, policy),
    };
  });
  const sessionRows = sessions.map((ses) => {
    const c = { PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0 };
    for (const r of records) if (r.class_session_id === ses.session_id) c[r.attendance_status]++;
    return {
      id: ses.session_id,
      title: ses.session_title,
      start_at: ses.scheduled_start_at,
      attendance_saved: Boolean(ses.attendance_saved_at),
      ...c,
    };
  });
  return {
    policy,
    sessions_held: sessions.length,
    sessions_with_attendance: sessions.filter((s) => s.attendance_saved_at).length,
    cancelled_sessions: db.prepare(`SELECT COUNT(*) n FROM sessions WHERE subject_class_id = ? AND session_status = 'CANCELLED'`).get(cls.id).n,
    class_totals: { ...classCounts, rate: rateFromCounts(classCounts, policy) },
    students: rows,
    sessions: sessionRows,
  };
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Chặn CSV/Formula injection khi mở bằng Excel
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function registerAttendanceRoutes(route) {
  route('GET', '/sessions/:id/attendance', ({ db, user, params }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_view_roster');
    return attendanceView(db, user, session, cls, caps);
  });

  // ---------- Lưu điểm danh theo lô (một transaction)
  route('PUT', '/sessions/:id/attendance', ({ db, user, body, params, log }) => {
    const { session, cls, caps } = requireSession(db, user, params.id, 'can_take_attendance');
    const endpoint = `PUT /sessions/${session.session_id}/attendance`;
    const idemKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.slice(0, 100) : null;
    if (idemKey) {
      const prev = db.prepare('SELECT * FROM api_idempotency_keys WHERE idempotency_key = ?').get(idemKey);
      if (prev) {
        if (prev.user_id !== user.id || prev.endpoint !== endpoint) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'Mã yêu cầu đã được dùng cho thao tác khác.');
        return { ...JSON.parse(prev.response_json), replayed: true };
      }
    }
    if (session.session_status === 'CANCELLED') fail(422, 'SESSION_CANCELLED', 'Buổi học đã bị hủy, không thể điểm danh.');
    if (session.attendance_locked_at && !caps.can_lock_attendance) {
      fail(423, 'ATTENDANCE_LOCKED', 'Điểm danh buổi này đã được Giáo vụ chốt. Vui lòng liên hệ Giáo vụ để mở chốt.');
    }
    const openFrom = Date.parse(session.scheduled_start_at) - OPEN_BEFORE_START_MIN * 60000;
    if (Date.now() < openFrom) fail(422, 'SESSION_NOT_STARTED', `Chỉ có thể điểm danh từ ${OPEN_BEFORE_START_MIN} phút trước giờ học.`);
    if (!Array.isArray(body.records) || body.records.length === 0) fail(422, 'VALIDATION_ERROR', 'Không có dữ liệu điểm danh.');
    if (body.records.length > 2000) fail(422, 'VALIDATION_ERROR', 'Quá nhiều bản ghi trong một lần lưu.');

    const roster = new Map(sessionRoster(db, session).map((r) => [r.student_id, r]));
    const seen = new Set();
    for (const r of body.records) {
      if (!r || typeof r.student_id !== 'string') fail(422, 'VALIDATION_ERROR', 'Thiếu mã học viên.');
      if (seen.has(r.student_id)) fail(422, 'DUPLICATE_STUDENT', 'Một học viên xuất hiện nhiều lần trong dữ liệu gửi lên.', { student_id: r.student_id });
      seen.add(r.student_id);
      if (!roster.has(r.student_id)) fail(422, 'STUDENT_NOT_IN_CLASS', 'Có học viên không thuộc danh sách lớp tại buổi học này.', { student_id: r.student_id });
      if (!ATTENDANCE_STATUSES.includes(r.status)) fail(422, 'INVALID_STATUS', 'Trạng thái điểm danh không hợp lệ.', { student_id: r.student_id });
      if (r.note !== undefined && r.note !== null && (typeof r.note !== 'string' || r.note.length > 500)) {
        fail(422, 'VALIDATION_ERROR', 'Ghi chú tối đa 500 ký tự.', { student_id: r.student_id });
      }
    }
    const reasonRequired = Date.now() > Date.parse(session.scheduled_end_at) + EDIT_REASON_AFTER_HOURS * 3600000;
    const reason = text(body, 'change_reason', { max: 500, label: 'lý do chỉnh sửa' });

    const now = nowIso();
    const result = tx(db, () => {
      let created = 0;
      let changed = 0;
      let unchanged = 0;
      for (const r of body.records) {
        const note = (r.note || '').trim() || null;
        const existing = db.prepare('SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ?').get(session.session_id, r.student_id);
        if (!existing) {
          const id = crypto.randomUUID();
          db.prepare(
            `INSERT INTO attendance_records (id, subject_class_id, class_session_id, student_id, attendance_status, check_in_method,
               check_in_at, note, recorded_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?)`
          ).run(id, cls.id, session.session_id, r.student_id, r.status, ['PRESENT', 'LATE'].includes(r.status) ? now : null, note, user.id, user.id, now, now);
          db.prepare(
            `INSERT INTO attendance_audit_logs (id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at)
             VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)`
          ).run(crypto.randomUUID(), id, r.status, note, reason || 'Điểm danh lần đầu', user.id, now);
          created++;
        } else if (existing.attendance_status !== r.status || (existing.note || null) !== note) {
          if (reasonRequired && !reason) {
            fail(422, 'CHANGE_REASON_REQUIRED', `Chỉnh sửa điểm danh sau ${EDIT_REASON_AFTER_HOURS} giờ kể từ khi kết thúc buổi học cần nhập lý do.`, { field: 'change_reason' });
          }
          db.prepare('UPDATE attendance_records SET attendance_status = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
            .run(r.status, note, user.id, now, existing.id);
          db.prepare(
            `INSERT INTO attendance_audit_logs (id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(crypto.randomUUID(), existing.id, existing.attendance_status, r.status, existing.note, note, reason || 'Cập nhật điểm danh', user.id, now);
          changed++;
        } else {
          unchanged++;
        }
      }
      db.prepare('UPDATE sessions SET attendance_saved_at = ?, attendance_saved_by = ? WHERE session_id = ?').run(now, user.id, session.session_id);
      const view = attendanceView(db, user, db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id), cls, caps);
      const response = { created, changed, unchanged, saved_at: now, counts: view.counts };
      if (idemKey) {
        db.prepare('INSERT INTO api_idempotency_keys (idempotency_key, user_id, endpoint, response_json, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(idemKey, user.id, endpoint, JSON.stringify(response), now);
      }
      return response;
    });
    log('INFO', `[teaching] attendance ${session.session_id}: +${result.created} ~${result.changed} by ${user.id}`);
    return result;
  });

  route('GET', '/sessions/:id/attendance/history', ({ db, user, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_view_roster');
    const items = db
      .prepare(
        `SELECT l.*, s.code AS student_code, s.full_name AS student_name, a.full_name AS changed_by_name
         FROM attendance_audit_logs l
         JOIN attendance_records r ON r.id = l.attendance_record_id
         JOIN users s ON s.id = r.student_id
         LEFT JOIN users a ON a.id = l.changed_by
         WHERE r.class_session_id = ? ORDER BY l.changed_at DESC, l.rowid DESC LIMIT 500`
      )
      .all(session.session_id);
    const events = db
      .prepare(`SELECT * FROM teaching_log_history WHERE session_id = ? ORDER BY changed_at DESC`)
      .all(session.session_id);
    return { items, session_events: events };
  });

  const lockToggle = (lock) => ({ db, user, body, params, log }) => {
    const { session } = requireSession(db, user, params.id, 'can_lock_attendance');
    if (lock && !session.attendance_saved_at) fail(422, 'ATTENDANCE_NOT_SAVED', 'Buổi học chưa có dữ liệu điểm danh để chốt.');
    if (lock && session.attendance_locked_at) fail(409, 'ALREADY_LOCKED', 'Điểm danh đã được chốt.');
    if (!lock && !session.attendance_locked_at) fail(409, 'NOT_LOCKED', 'Điểm danh chưa được chốt.');
    const reason = text(body, 'reason', { required: !lock, max: 500, label: 'lý do mở chốt' });
    const now = nowIso();
    tx(db, () => {
      db.prepare('UPDATE sessions SET attendance_locked_at = ?, attendance_locked_by = ? WHERE session_id = ?')
        .run(lock ? now : null, lock ? user.id : null, session.session_id);
      db.prepare(
        `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`hist_${crypto.randomBytes(4).toString('hex')}`, session.session_id, session.subject_class_code,
        lock ? 'ATTENDANCE_OPEN' : 'ATTENDANCE_LOCKED', lock ? 'ATTENDANCE_LOCKED' : 'ATTENDANCE_OPEN',
        user.full_name || user.id, now, lock ? 'Chốt dữ liệu điểm danh' : `Mở chốt điểm danh: ${reason}`);
    });
    log('INFO', `[teaching] attendance ${session.session_id} ${lock ? 'locked' : 'unlocked'} by ${user.id}`);
    return { id: session.session_id, attendance_locked_at: lock ? now : null };
  };
  route('POST', '/sessions/:id/attendance/lock', lockToggle(true));
  route('POST', '/sessions/:id/attendance/unlock', lockToggle(false));

  // ---------- Mã điểm danh động (bổ sung, không thay thế điểm danh thủ công)
  route('POST', '/sessions/:id/attendance/qr', ({ db, user, body, params, log }) => {
    const { session } = requireSession(db, user, params.id, 'can_take_attendance');
    if (session.session_status === 'CANCELLED') fail(422, 'SESSION_CANCELLED', 'Buổi học đã bị hủy.');
    if (session.attendance_locked_at) fail(423, 'ATTENDANCE_LOCKED', 'Điểm danh đã được chốt.');
    const now = Date.now();
    if (now < Date.parse(session.scheduled_start_at) - OPEN_BEFORE_START_MIN * 60000 || now > Date.parse(session.scheduled_end_at) + 2 * 3600000) {
      fail(422, 'OUTSIDE_SESSION_WINDOW', 'Chỉ tạo mã điểm danh trong khoảng thời gian diễn ra buổi học.');
    }
    const minutes = intField(body, 'duration_minutes', { min: 1, max: 60, label: 'thời hạn (phút)' }) || 10;
    const late = intField(body, 'late_threshold_minutes', { min: 0, max: 120, label: 'ngưỡng đi muộn (phút)' }) ?? 15;
    const id = crypto.randomUUID();
    tx(db, () => {
      db.prepare('UPDATE attendance_qr_sessions SET is_active = 0 WHERE class_session_id = ?').run(session.session_id);
      db.prepare(
        `INSERT INTO attendance_qr_sessions (id, class_session_id, secret_seed, rotation_interval_sec, late_threshold_minutes,
           valid_from, valid_until, is_active, created_by, created_at) VALUES (?, ?, ?, 30, ?, ?, ?, 1, ?, ?)`
      ).run(id, session.session_id, crypto.randomBytes(32).toString('hex'), late, new Date(now).toISOString(),
        new Date(now + minutes * 60000).toISOString(), user.id, nowIso());
    });
    log('INFO', `[teaching] check-in code opened for ${session.session_id} (${minutes}m) by ${user.id}`);
    return [201, { id, valid_until: new Date(now + minutes * 60000).toISOString() }];
  });

  route('GET', '/sessions/:id/attendance/qr', ({ db, user, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_take_attendance');
    const q = db
      .prepare('SELECT * FROM attendance_qr_sessions WHERE class_session_id = ? AND is_active = 1 AND valid_until > ? ORDER BY created_at DESC LIMIT 1')
      .get(session.session_id, nowIso());
    if (!q) return { active: false };
    const interval = q.rotation_interval_sec;
    const windowIndex = Math.floor(Date.now() / 1000 / interval);
    const checkedIn = db.prepare(`SELECT COUNT(*) n FROM attendance_records WHERE class_session_id = ? AND check_in_method = 'QR_CODE'`).get(session.session_id).n;
    return {
      active: true,
      code: codeForWindow(q.secret_seed, windowIndex),
      rotates_in_seconds: interval - (Math.floor(Date.now() / 1000) % interval),
      rotation_interval_sec: interval,
      valid_until: q.valid_until,
      late_threshold_minutes: q.late_threshold_minutes,
      checked_in_count: checkedIn,
      session_id: session.session_id,
    };
  });

  route('DELETE', '/sessions/:id/attendance/qr', ({ db, user, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_take_attendance');
    db.prepare('UPDATE attendance_qr_sessions SET is_active = 0 WHERE class_session_id = ?').run(session.session_id);
    return { active: false };
  });

  route('POST', '/attendance/check-in', ({ db, user, body, log }) => {
    if (!isStudent(user)) fail(403, 'CHECKIN_STUDENT_ONLY', 'Chỉ học viên mới tự điểm danh bằng mã.');
    const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
    if (!/^\d{6}$/.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã điểm danh gồm 6 chữ số.');
    // Tìm các phiên mã đang hoạt động thuộc lớp học viên đang theo học
    const candidates = db
      .prepare(
        `SELECT q.*, s.subject_class_id, s.scheduled_start_at, s.session_title, s.session_status, s.attendance_locked_at
         FROM attendance_qr_sessions q JOIN sessions s ON s.session_id = q.class_session_id
         JOIN class_enrollments e ON e.subject_class_id = s.subject_class_id AND e.student_id = ? AND e.status = 'ACTIVE'
         WHERE q.is_active = 1 AND q.valid_until > ? AND q.valid_from <= ?`
      )
      .all(user.id, nowIso(), nowIso());
    const guardKey = `${user.id}|checkin`;
    guardBruteForce(guardKey);
    if (candidates.length === 0) fail(404, 'NO_ACTIVE_CHECKIN', 'Hiện không có buổi học nào của bạn đang mở điểm danh bằng mã.');
    const nowSec = Math.floor(Date.now() / 1000);
    const match = candidates.find((q) => {
      const w = Math.floor(nowSec / q.rotation_interval_sec);
      return [w, w - 1].some((x) => crypto.timingSafeEqual(Buffer.from(codeForWindow(q.secret_seed, x)), Buffer.from(code)));
    });
    if (!match) {
      recordFailure(guardKey);
      fail(422, 'INVALID_CODE', 'Mã điểm danh không đúng hoặc đã hết hạn. Vui lòng nhập mã đang hiển thị trên màn hình lớp.');
    }
    if (match.session_status === 'CANCELLED' || match.attendance_locked_at) fail(422, 'CHECKIN_CLOSED', 'Buổi học không còn nhận điểm danh.');
    const existing = db.prepare('SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ?').get(match.class_session_id, user.id);
    if (existing) {
      if (existing.check_in_method === 'QR_CODE') {
        return { already_checked_in: true, status: existing.attendance_status, check_in_at: existing.check_in_at, session_title: match.session_title };
      }
      fail(409, 'ALREADY_MARKED', 'Giảng viên đã điểm danh bạn cho buổi học này.');
    }
    const lateAfter = Date.parse(match.scheduled_start_at) + match.late_threshold_minutes * 60000;
    const status = Date.now() > lateAfter ? 'LATE' : 'PRESENT';
    const now = nowIso();
    const id = crypto.randomUUID();
    try {
      tx(db, () => {
        db.prepare(
          `INSERT INTO attendance_records (id, subject_class_id, class_session_id, student_id, attendance_status, check_in_method,
             check_in_at, note, recorded_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'QR_CODE', ?, NULL, ?, ?, ?, ?)`
        ).run(id, match.subject_class_id, match.class_session_id, user.id, status, now, user.id, user.id, now, now);
        db.prepare(
          `INSERT INTO attendance_audit_logs (id, attendance_record_id, previous_status, new_status, change_reason, changed_by, changed_at)
           VALUES (?, ?, NULL, ?, 'Học viên tự điểm danh bằng mã', ?, ?)`
        ).run(crypto.randomUUID(), id, status, user.id, now);
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return { already_checked_in: true, status, session_title: match.session_title };
      throw err;
    }
    log('INFO', `[teaching] self check-in ${user.id} -> ${match.class_session_id} (${status})`);
    return [201, { already_checked_in: false, status, check_in_at: now, session_title: match.session_title }];
  });

  // ---------- Thống kê chuyên cần
  route('GET', '/classes/:id/attendance/stats', ({ db, user, params, url }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    return computeStats(db, cls, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      includeDropped: url.searchParams.get('include_dropped') === '1',
    });
  });

  route('GET', '/classes/:id/attendance/export', ({ db, user, params, url, raw }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const stats = computeStats(db, cls, { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    const header = ['STT', 'Mã học viên', 'Họ và tên', 'Tổng số buổi', 'Có mặt', 'Đi muộn', 'Vắng có phép', 'Vắng không phép', 'Chưa điểm danh', 'Tỷ lệ chuyên cần (%)'];
    const lines = [header.map(csvCell).join(',')];
    stats.students.forEach((s, i) => {
      lines.push([i + 1, s.code, s.full_name, s.total_sessions, s.present, s.late, s.excused, s.absent, s.not_marked, s.rate ?? ''].map(csvCell).join(','));
    });
    lines.push('');
    lines.push(csvCell(stats.policy.formula_text));
    raw(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chuyen-can.csv"; filename*=UTF-8''${encodeURIComponent(`chuyen-can-${cls.code}.csv`)}`,
    }, `\uFEFF${lines.join('\r\n')}`);
  });
}

export { computeStats };
