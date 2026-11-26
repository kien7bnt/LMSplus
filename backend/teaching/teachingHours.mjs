/**
 * LMSPLUS Training Lifecycle — Phần 2.2: Ghi nhận buổi dạy, Thống kê giờ giảng & Chốt bảng công chuyển Tài chính.
 * - 2.2.1: Đến giờ bắt đầu buổi học → tự động mở buổi dạy, ghi giờ bắt đầu/kết thúc thực tế & người dạy thực tế (chính / dạy thay).
 * - 2.2.2: Thống kê giờ dạy theo tháng/kỳ, môn, lớp, loại giờ (LT / TH / Trực tuyến), dạy thay/dạy bù/nghỉ, định mức & vượt định mức.
 * - 2.2.3: Quy trình chốt 4 bước: Tổng hợp cuối tháng → GV xác nhận / phản hồi sai sót → Giáo vụ/TBM duyệt → Khóa & chuyển Tài chính.
 */

import crypto from 'node:crypto';
import { fail, nowIso, nowVn, oneOf, text, tx , mapAsync} from './http.mjs';
import { vnDate } from './schema.mjs';
import { isAdmin, isInstructor, isStaff, isHeadOfDepartment, canApproveDepartmentAcademic, assertDepartmentScope } from './scope.mjs';

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseIsoMs(iso) {
  if (!iso) return NaN;
  return Date.parse(iso);
}

function computeHoursAndPeriods(sessionRow, courseRow) {
  const minPerPeriod = Math.max(15, Number(courseRow?.minutes_per_period || 45));
  const startIso = sessionRow.actual_start_at || sessionRow.scheduled_start_at;
  const endIso = sessionRow.actual_end_at || sessionRow.scheduled_end_at;
  const diffMs = parseIsoMs(endIso) - parseIsoMs(startIso);
  const rawMinutes = Number.isFinite(diffMs) && diffMs > 0 ? diffMs / 60000 : Number(sessionRow.planned_periods || 2) * minPerPeriod;
  const hours = round2(rawMinutes / 60);
  const periods = sessionRow.actual_periods != null
    ? round2(Number(sessionRow.actual_periods))
    : sessionRow.planned_periods != null
      ? round2(Number(sessionRow.planned_periods))
      : round2(rawMinutes / minPerPeriod);
  return { periods, hours, minutes: Math.round(rawMinutes) };
}

function inferHourCategory(sessionRow, courseRow) {
  if (sessionRow.hour_category && ['THEORY', 'PRACTICE', 'ONLINE'].includes(sessionRow.hour_category)) {
    return sessionRow.hour_category;
  }
  if (sessionRow.delivery_mode === 'ONLINE' || courseRow?.required_room_type === 'ONLINE') return 'ONLINE';
  if (courseRow?.required_room_type === 'COMPUTER_LAB') return 'PRACTICE';
  return 'THEORY';
}

/**
 * 2.2.1: Khi đến giờ bắt đầu buổi học (scheduled_start_at <= nowVn), hệ thống tự động coi như
 * giảng viên đã mở buổi dạy, gán giờ bắt đầu thực tế và người dạy thực tế mặc định nếu chưa ghi nhận.
 */
export async function syncAutoOpenedSessions(db) {
  const now = nowVn();
  await db.prepare(
    `UPDATE sessions
     SET live_status = CASE
           WHEN scheduled_end_at > ? AND COALESCE(live_status, 'NOT_STARTED') = 'NOT_STARTED' THEN 'LIVE'
           WHEN scheduled_end_at <= ? AND COALESCE(live_status, 'NOT_STARTED') IN ('NOT_STARTED', 'LIVE') THEN 'ENDED'
           ELSE COALESCE(live_status, 'NOT_STARTED')
         END,
         session_status = CASE
           WHEN scheduled_end_at <= ? AND session_status = 'SCHEDULED' THEN 'COMPLETED'
           ELSE session_status
         END,
         actual_start_at = COALESCE(actual_start_at, scheduled_start_at),
         actual_end_at = CASE
           WHEN scheduled_end_at <= ? THEN COALESCE(actual_end_at, scheduled_end_at)
           ELSE actual_end_at
         END,
         actual_instructor_id = COALESCE(NULLIF(actual_instructor_id, ''), NULLIF(scheduled_instructor_id, '')),
         actual_instructor_name = COALESCE(NULLIF(actual_instructor_name, ''), scheduled_instructor_name)
     WHERE session_status <> 'CANCELLED'
       AND COALESCE(schedule_state, 'PUBLISHED') = 'PUBLISHED'
       AND scheduled_start_at <= ?
       AND timesheet_locked_id IS NULL`
  ).run(now, now, now, now, now);
}

async function resolveQuotaForInstructor(db, instructorId, periodKey) {
  const exact = await db
    .prepare('SELECT * FROM instructor_quotas WHERE instructor_id = ? AND period_key = ?')
    .get(instructorId, periodKey);
  if (exact) return exact;
  const def = await db
    .prepare("SELECT * FROM instructor_quotas WHERE instructor_id = ? ORDER BY period_key DESC LIMIT 1")
    .get(instructorId);
  if (def) return def;
  return { instructor_id: instructorId, period_key: periodKey, standard_periods: 40, standard_hours: 30, note: 'Định mức chuẩn' };
}

function assertAnalyticsAccess(user, requestedInstructorId) {
  if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
    fail(403, 'FORBIDDEN', 'Chỉ Giảng viên, Giáo vụ hoặc Quản trị viên mới có quyền truy cập thống kê giờ dạy.');
  }
  if (!isAdmin(user) && !isStaff(user) && isInstructor(user)) {
    if (requestedInstructorId && requestedInstructorId !== user.id) {
      fail(403, 'INSTRUCTOR_SCOPE_FORBIDDEN', 'Giảng viên chỉ được xem thống kê giờ dạy của chính mình.');
    }
  }
}

export function registerTeachingHoursRoutes(route) {
  // =========================================================================
  // 1. GHI NHẬN BUỔI DẠY THỰC TẾ & NGƯỜI DẠY THAY (2.2.1)
  // =========================================================================

  route('PATCH', '/teaching-hours/sessions/:id/record', async ({ db, user, body, params }) => {
    await syncAutoOpenedSessions(db);
    const ses = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(params.id);
    if (!ses) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy buổi học.');
    if (ses.timesheet_locked_id) {
      fail(409, 'SESSION_TIMESHEET_LOCKED', 'Buổi học đã chốt công chuyển Tài chính, không thể chỉnh sửa.');
    }

    const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(ses.subject_class_id);
    const isOwnSession = ses.scheduled_instructor_id === user.id || ses.actual_instructor_id === user.id;
    const isDeptStaff = isStaff(user) && (!user.department_id || !cls?.department_id || user.department_id === cls.department_id);
    if (!isAdmin(user) && !isDeptStaff && !(isInstructor(user) && isOwnSession)) {
      fail(403, 'FORBIDDEN', 'Bạn không có quyền cập nhật giờ dạy thực tế của buổi học này.');
    }

    const nextStart = text(body, 'actual_start_at', { max: 40, label: 'giờ bắt đầu thực tế' }) || ses.actual_start_at || ses.scheduled_start_at;
    const nextEnd = text(body, 'actual_end_at', { max: 40, label: 'giờ kết thúc thực tế' }) || ses.actual_end_at || ses.scheduled_end_at;
    if (parseIsoMs(nextEnd) <= parseIsoMs(nextStart)) {
      fail(422, 'VALIDATION_ERROR', 'Giờ kết thúc thực tế phải sau giờ bắt đầu thực tế.');
    }

    const hourCategory = body.hour_category
      ? oneOf(body, 'hour_category', ['THEORY', 'PRACTICE', 'ONLINE'], { label: 'loại giờ giảng' })
      : ses.hour_category || 'THEORY';

    let actualInstructorId = ses.actual_instructor_id || ses.scheduled_instructor_id || null;
    let actualInstructorName = ses.actual_instructor_name || ses.scheduled_instructor_name || '';
    let isSubstitute = Boolean(ses.is_substitute_teaching);
    let subReason = ses.substitute_reason || null;

    if (body.actual_instructor_id !== undefined) {
      if (!isAdmin(user) && !isDeptStaff && body.actual_instructor_id !== user.id) {
        fail(403, 'SUBSTITUTE_ASSIGN_FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới được ghi nhận giảng viên dạy thay khác.');
      }
      const gv = await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(body.actual_instructor_id);
      if (!gv) fail(404, 'INSTRUCTOR_NOT_FOUND', 'Không tìm thấy giảng viên thực dạy.');
      actualInstructorId = gv.id;
      actualInstructorName = gv.full_name;
      isSubstitute = Boolean(ses.scheduled_instructor_id && gv.id !== ses.scheduled_instructor_id);
      subReason = isSubstitute ? (text(body, 'substitute_reason', { max: 500, label: 'lý do dạy thay' }) || subReason || 'Dạy thay theo phân công') : null;
    }

    const course = cls?.course_id ? await db.prepare('SELECT * FROM courses WHERE id = ?').get(cls.course_id) : null;
    const actualPeriods = body.actual_periods !== undefined && body.actual_periods !== null && body.actual_periods !== ''
      ? Math.max(0.5, Number(body.actual_periods))
      : computeHoursAndPeriods({ ...ses, actual_start_at: nextStart, actual_end_at: nextEnd, actual_periods: null }, course).periods;

    await db.prepare(
      `UPDATE sessions
       SET actual_start_at = ?,
           actual_end_at = ?,
           actual_periods = ?,
           hour_category = ?,
           actual_instructor_id = ?,
           actual_instructor_name = ?,
           is_substitute_teaching = ?,
           substitute_reason = ?,
           live_status = CASE WHEN COALESCE(live_status, 'NOT_STARTED') = 'NOT_STARTED' THEN 'LIVE' ELSE live_status END
       WHERE session_id = ?`
    ).run(
      nextStart,
      nextEnd,
      round2(actualPeriods),
      hourCategory,
      actualInstructorId,
      actualInstructorName,
      isSubstitute ? 1 : 0,
      subReason,
      ses.session_id
    );

    const updated = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(ses.session_id);
    const metrics = computeHoursAndPeriods(updated, course);
    return {
      session_id: updated.session_id,
      actual_start_at: updated.actual_start_at,
      actual_end_at: updated.actual_end_at,
      actual_periods: metrics.periods,
      actual_hours: metrics.hours,
      hour_category: updated.hour_category,
      actual_instructor_id: updated.actual_instructor_id,
      actual_instructor_name: updated.actual_instructor_name,
      is_substitute_teaching: Boolean(updated.is_substitute_teaching),
      substitute_reason: updated.substitute_reason || '',
    };
  });

  // =========================================================================
  // 2. ĐỊNH MỨC GIỜ GIẢNG & THỐNG KÊ ĐA CHIỀU (2.2.2)
  // =========================================================================

  route('GET', '/teaching-hours/quotas', async ({ db, user, url }) => {
    const periodKey = url.searchParams.get('period_key') || vnDate().slice(0, 7);
    assertAnalyticsAccess(user, url.searchParams.get('instructor_id') || '');

    let instrSql = `SELECT u.id, u.code, u.full_name, u.email, u.department_id
                    FROM users u
                    WHERE u.roles_json LIKE '%"INSTRUCTOR"%'`;
    const params = [];
    if (!isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user)) {
      instrSql += ' AND u.id = ?';
      params.push(user.id);
    } else if (!isAdmin(user)) {
      if (!user.department_id) {
        instrSql += ' AND 1 = 0';
      } else {
        instrSql += ' AND u.department_id = ?';
        params.push(user.department_id);
      }
    }
    instrSql += ' ORDER BY u.full_name';

    const instructors = await db.prepare(instrSql).all(...params);
    return {
      period_key: periodKey,
      items: await mapAsync(instructors, async (ins) => {
        const q = await resolveQuotaForInstructor(db, ins.id, periodKey);
        return {
          instructor_id: ins.id,
          instructor_code: ins.code || '',
          instructor_name: ins.full_name,
          email: ins.email,
          department_id: ins.department_id,
          department_name: ins.department_id || '',
          period_key: periodKey,
          standard_periods: Number(q.standard_periods || 40),
          standard_hours: Number(q.standard_hours || 30),
          note: q.note || '',
        };
      }),
    };
  });

  route('PUT', '/teaching-hours/quotas', async ({ db, user, body }) => {
    if (!isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Trưởng bộ môn, Giáo vụ hoặc Quản trị viên mới được thiết lập định mức giờ giảng.');
    }
    const instructorId = text(body, 'instructor_id', { required: true, max: 64, label: 'giảng viên' });
    const targetInstr = await db.prepare('SELECT id, department_id FROM users WHERE id = ?').get(instructorId);
    if (!targetInstr) fail(404, 'INSTRUCTOR_NOT_FOUND', 'Không tìm thấy giảng viên.');
    if (!isAdmin(user)) {
      assertDepartmentScope(user, targetInstr.department_id, 'Chỉ được thiết lập định mức cho giảng viên trong bộ môn/đơn vị phụ trách.');
    }
    const periodKey = text(body, 'period_key', { required: true, max: 32, label: 'kỳ/tháng định mức' });
    const standardPeriods = Math.max(0, Number(body.standard_periods ?? 40));
    const standardHours = Math.max(0, Number(body.standard_hours ?? round2((standardPeriods * 45) / 60)));
    const note = text(body, 'note', { max: 300, label: 'ghi chú' }) || '';
    const now = nowIso();

    await tx(db, async () => {
      const existing = await db.prepare('SELECT id FROM instructor_quotas WHERE instructor_id = ? AND period_key = ?').get(instructorId, periodKey);
      if (existing) {
        await db.prepare('UPDATE instructor_quotas SET standard_periods = ?, standard_hours = ?, note = ?, updated_at = ? WHERE id = ?')
          .run(standardPeriods, standardHours, note, now, existing.id);
      } else {
        await db.prepare(
          `INSERT INTO instructor_quotas (id, instructor_id, period_key, standard_periods, standard_hours, note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(`iq_${crypto.randomBytes(5).toString('hex')}`, instructorId, periodKey, standardPeriods, standardHours, note, now);
      }
    });

    return await resolveQuotaForInstructor(db, instructorId, periodKey);
  });

  route('GET', '/teaching-hours/analytics', async ({ db, user, url }) => {
    await syncAutoOpenedSessions(db);
    const periodMonth = url.searchParams.get('period_month') || vnDate().slice(0, 7);
    const fromDate = url.searchParams.get('from') || `${periodMonth}-01`;
    const toDate = url.searchParams.get('to') || `${periodMonth}-31`;
    const reqInstructorId = url.searchParams.get('instructor_id') || '';
    const courseId = url.searchParams.get('course_id') || '';
    const classId = url.searchParams.get('class_id') || '';
    const includeFuture = url.searchParams.get('include_future') === 'true';

    assertAnalyticsAccess(user, reqInstructorId);
    const effectiveInstructorId = !isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user) ? user.id : reqInstructorId;

    const where = [
      "COALESCE(s.schedule_state, 'PUBLISHED') = 'PUBLISHED'",
      'substr(s.scheduled_start_at, 1, 10) >= ?',
      'substr(s.scheduled_start_at, 1, 10) <= ?',
    ];
    const params = [fromDate, toDate];

    if (!includeFuture) {
      where.push("(s.scheduled_start_at <= ? OR s.confirmation_status IN ('CONFIRMED','CONFIRMED_LATE') OR s.session_status = 'CANCELLED')");
      params.push(nowVn());
    }
    if ((isStaff(user) || isHeadOfDepartment(user)) && !isAdmin(user)) {
      if (!user.department_id) {
        where.push('1 = 0');
      } else {
        where.push('sc.department_id = ?');
        params.push(user.department_id);
      }
    }
    if (courseId) { where.push('sc.course_id = ?'); params.push(courseId); }
    if (classId) { where.push('s.subject_class_id = ?'); params.push(classId); }
    if (effectiveInstructorId) {
      where.push('(COALESCE(NULLIF(s.actual_instructor_id, \'\'), s.scheduled_instructor_id) = ? OR s.scheduled_instructor_id = ?)');
      params.push(effectiveInstructorId, effectiveInstructorId);
    }

    const rows = await db
      .prepare(
        `SELECT s.*, sc.code AS class_code, sc.title AS class_title, sc.course_id, sc.department_id,
                c.code AS course_code, c.title AS course_title, c.minutes_per_period, c.required_room_type
         FROM sessions s
         JOIN subject_classes sc ON sc.id = s.subject_class_id
         LEFT JOIN courses c ON c.id = sc.course_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.scheduled_start_at DESC`
      )
      .all(...params);

    const byInstructorMap = new Map();
    const byCourseMap = new Map();
    const byClassMap = new Map();
    const sessionLedger = [];

    const ensureInstructorBucket = async (insId, insName) => {
      if (!insId) return null;
      if (!byInstructorMap.has(insId)) {
        const u = await db.prepare('SELECT id, full_name, department_id FROM users WHERE id = ?').get(insId);
        const quota = await resolveQuotaForInstructor(db, insId, periodMonth);
        byInstructorMap.set(insId, {
          instructor_id: insId,
          instructor_name: u?.full_name || insName || insId,
          department_id: u?.department_id || null,
          total_sessions: 0,
          confirmed_sessions: 0,
          regular_sessions: 0,
          substitute_sessions: 0,
          substituted_out_sessions: 0,
          makeup_sessions: 0,
          cancelled_sessions: 0,
          theory_periods: 0,
          practice_periods: 0,
          online_periods: 0,
          total_periods: 0,
          total_hours: 0,
          quota_periods: Number(quota.standard_periods || 40),
          quota_hours: Number(quota.standard_hours || 30),
          overtime_periods: 0,
          overtime_hours: 0,
        });
      }
      return byInstructorMap.get(insId);
    };

    for (const r of rows) {
      const actualId = r.actual_instructor_id || r.scheduled_instructor_id || '';
      const scheduledId = r.scheduled_instructor_id || actualId;
      const courseMeta = { minutes_per_period: r.minutes_per_period || 45, required_room_type: r.required_room_type || 'THEORY_ROOM' };
      const { periods, hours } = computeHoursAndPeriods(r, courseMeta);
      const category = inferHourCategory(r, courseMeta);
      const isCancelled = r.session_status === 'CANCELLED';
      const isSub = Boolean(r.is_substitute_teaching || (actualId && scheduledId && actualId !== scheduledId));
      const isMakeup = r.session_kind === 'MAKEUP';
      const isConfirmed = ['CONFIRMED', 'CONFIRMED_LATE'].includes(r.confirmation_status);

      // Ghi nhận buổi nghỉ cho GV được phân công
      if (isCancelled) {
        if (!effectiveInstructorId || scheduledId === effectiveInstructorId) {
          const b = await ensureInstructorBucket(scheduledId, r.scheduled_instructor_name);
          if (b) b.cancelled_sessions += 1;
        }
      } else {
        // Nếu người dạy thực tế khác người phân công: cộng giờ cho người dạy thay, ghi nhận "được dạy thay" cho người phân công
        if (isSub && scheduledId && scheduledId !== actualId && (!effectiveInstructorId || scheduledId === effectiveInstructorId)) {
          const origBucket = await ensureInstructorBucket(scheduledId, r.scheduled_instructor_name);
          if (origBucket) origBucket.substituted_out_sessions += 1;
        }

        if (!effectiveInstructorId || actualId === effectiveInstructorId) {
          const bucket = await ensureInstructorBucket(actualId, r.actual_instructor_name || r.scheduled_instructor_name);
          if (bucket) {
            bucket.total_sessions += 1;
            if (isConfirmed) bucket.confirmed_sessions += 1;
            if (isMakeup) bucket.makeup_sessions += 1;
            else if (isSub) bucket.substitute_sessions += 1;
            else bucket.regular_sessions += 1;

            if (category === 'PRACTICE') bucket.practice_periods = round2(bucket.practice_periods + periods);
            else if (category === 'ONLINE') bucket.online_periods = round2(bucket.online_periods + periods);
            else bucket.theory_periods = round2(bucket.theory_periods + periods);

            bucket.total_periods = round2(bucket.total_periods + periods);
            bucket.total_hours = round2(bucket.total_hours + hours);
          }

          // Phân rã theo Môn học
          const cKey = r.course_id || 'UNLINKED';
          if (!byCourseMap.has(cKey)) {
            byCourseMap.set(cKey, {
              course_id: r.course_id,
              course_code: r.course_code || '—',
              course_title: r.course_title || r.subject_title || 'Chưa gắn môn',
              sessions_count: 0,
              theory_periods: 0,
              practice_periods: 0,
              online_periods: 0,
              total_periods: 0,
              total_hours: 0,
            });
          }
          const cb = byCourseMap.get(cKey);
          cb.sessions_count += 1;
          if (category === 'PRACTICE') cb.practice_periods = round2(cb.practice_periods + periods);
          else if (category === 'ONLINE') cb.online_periods = round2(cb.online_periods + periods);
          else cb.theory_periods = round2(cb.theory_periods + periods);
          cb.total_periods = round2(cb.total_periods + periods);
          cb.total_hours = round2(cb.total_hours + hours);

          // Phân rã theo Lớp môn học
          if (!byClassMap.has(r.subject_class_id)) {
            byClassMap.set(r.subject_class_id, {
              class_id: r.subject_class_id,
              class_code: r.class_code,
              class_title: r.class_title,
              course_code: r.course_code || '',
              sessions_count: 0,
              substitute_sessions: 0,
              makeup_sessions: 0,
              total_periods: 0,
              total_hours: 0,
            });
          }
          const clb = byClassMap.get(r.subject_class_id);
          clb.sessions_count += 1;
          if (isSub) clb.substitute_sessions += 1;
          if (isMakeup) clb.makeup_sessions += 1;
          clb.total_periods = round2(clb.total_periods + periods);
          clb.total_hours = round2(clb.total_hours + hours);
        }
      }

      sessionLedger.push({
        session_id: r.session_id,
        class_id: r.subject_class_id,
        class_code: r.class_code,
        class_title: r.class_title,
        course_code: r.course_code || '',
        course_title: r.course_title || r.subject_title || '',
        session_title: r.session_title,
        scheduled_start_at: r.scheduled_start_at,
        scheduled_end_at: r.scheduled_end_at,
        actual_start_at: r.actual_start_at || r.scheduled_start_at,
        actual_end_at: r.actual_end_at || r.scheduled_end_at,
        scheduled_instructor_id: scheduledId,
        scheduled_instructor_name: r.scheduled_instructor_name || '',
        actual_instructor_id: actualId,
        actual_instructor_name: r.actual_instructor_name || r.scheduled_instructor_name || '',
        is_substitute: isSub,
        substitute_reason: r.substitute_reason || '',
        session_kind: r.session_kind || 'REGULAR',
        session_status: r.session_status,
        confirmation_status: r.confirmation_status,
        hour_category: category,
        periods: isCancelled ? 0 : periods,
        hours: isCancelled ? 0 : hours,
        timesheet_locked_id: r.timesheet_locked_id || null,
      });
    }

    // Nếu giảng viên đăng nhập chưa có buổi nào trong kỳ vẫn hiển thị thẻ định mức của chính họ
    if (effectiveInstructorId && !byInstructorMap.has(effectiveInstructorId)) {
      await ensureInstructorBucket(effectiveInstructorId, user.full_name);
    }

    const instructorsSummary = [...byInstructorMap.values()].map((b) => ({
      ...b,
      overtime_periods: round2(Math.max(0, b.total_periods - b.quota_periods)),
      overtime_hours: round2(Math.max(0, b.total_hours - b.quota_hours)),
    }));

    const totals = instructorsSummary.reduce(
      (acc, i) => ({
        total_sessions: acc.total_sessions + i.total_sessions,
        confirmed_sessions: acc.confirmed_sessions + i.confirmed_sessions,
        substitute_sessions: acc.substitute_sessions + i.substitute_sessions,
        makeup_sessions: acc.makeup_sessions + i.makeup_sessions,
        cancelled_sessions: acc.cancelled_sessions + i.cancelled_sessions,
        theory_periods: round2(acc.theory_periods + i.theory_periods),
        practice_periods: round2(acc.practice_periods + i.practice_periods),
        online_periods: round2(acc.online_periods + i.online_periods),
        total_periods: round2(acc.total_periods + i.total_periods),
        total_hours: round2(acc.total_hours + i.total_hours),
        overtime_hours: round2(acc.overtime_hours + i.overtime_hours),
      }),
      {
        total_sessions: 0,
        confirmed_sessions: 0,
        substitute_sessions: 0,
        makeup_sessions: 0,
        cancelled_sessions: 0,
        theory_periods: 0,
        practice_periods: 0,
        online_periods: 0,
        total_periods: 0,
        total_hours: 0,
        overtime_hours: 0,
      }
    );

    return {
      period_month: periodMonth,
      from: fromDate,
      to: toDate,
      totals,
      by_instructor: instructorsSummary,
      by_course: [...byCourseMap.values()],
      by_class: [...byClassMap.values()],
      sessions: sessionLedger,
    };
  });

  // =========================================================================
  // 3. QUY TRÌNH CHỐT BẢNG GIỜ GIẢNG CUỐI THÁNG 4 BƯỚC (2.2.3)
  // =========================================================================

  route('GET', '/teaching-hours/timesheets', async ({ db, user, url }) => {
    const periodMonth = url.searchParams.get('period_month') || vnDate().slice(0, 7);
    assertAnalyticsAccess(user, url.searchParams.get('instructor_id') || '');

    const where = ['period_month = ?'];
    const params = [periodMonth];
    if (!isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user)) {
      where.push('instructor_id = ?');
      params.push(user.id);
    } else if (!isAdmin(user)) {
      if (!user.department_id) {
        where.push('1 = 0');
      } else {
        where.push('department_id = ?');
        params.push(user.department_id);
      }
    }

    const items = await db
      .prepare(`SELECT * FROM teaching_timesheets WHERE ${where.join(' AND ')} ORDER BY instructor_name`)
      .all(...params);
    return { period_month: periodMonth, items };
  });

  route('GET', '/teaching-hours/timesheets/export-finance', async ({ db, user, url, raw }) => {
    if (!isAdmin(user) && !isStaff(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới được xuất gói dữ liệu chuyển Tài chính.');
    }
    const periodMonth = url.searchParams.get('period_month') || vnDate().slice(0, 7);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const onlyLocked = url.searchParams.get('only_locked') !== 'false';

    const where = ['period_month = ?'];
    const params = [periodMonth];
    if (onlyLocked) where.push("status IN ('LOCKED','APPROVED')");
    if ((isStaff(user) || isHeadOfDepartment(user)) && !isAdmin(user)) {
      if (!user.department_id) {
        where.push('1 = 0');
      } else {
        where.push('department_id = ?');
        params.push(user.department_id);
      }
    }

    const sheets = await db
      .prepare(`SELECT * FROM teaching_timesheets WHERE ${where.join(' AND ')} ORDER BY instructor_name`)
      .all(...params);

    if (format === 'csv') {
      const header = [
        'Ky_Chot',
        'Ma_Lo_Tai_Chinh',
        'Ma_GV',
        'Ho_Ten_Giang_Vien',
        'Trang_Thai',
        'So_Buoi_Chinh',
        'So_Buoi_Day_Thay',
        'So_Buoi_Day_Bu',
        'Tiet_Ly_Thuyet',
        'Tiet_Thuc_Hanh',
        'Tiet_Truc_Tuyen',
        'Tong_So_Tiet',
        'Tong_So_Gio',
        'Dinh_Muc_Gio',
        'Gio_Vuot_Dinh_Muc',
        'Nguoi_Duyet',
        'Thoi_Diem_Khoa',
      ];
      const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [
        header.join(','),
        ...sheets.map((s) =>
          [
            s.period_month,
            s.finance_batch_code || '',
            s.instructor_id,
            s.instructor_name,
            s.status,
            s.regular_sessions,
            s.substitute_sessions,
            s.makeup_sessions,
            s.theory_periods,
            s.practice_periods,
            s.online_periods,
            s.total_periods,
            s.total_hours,
            s.quota_hours,
            s.overtime_hours,
            s.approved_by_name || '',
            s.locked_at || '',
          ]
            .map(csvEscape)
            .join(',')
        ),
      ];
      const payload = `\uFEFF${lines.join('\r\n')}`;
      raw(
        200,
        {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="bang-gio-giang-tai-chinh-${periodMonth}.csv"`,
        },
        Buffer.from(payload, 'utf8')
      );
      return undefined;
    }

    return {
      period_month: periodMonth,
      exported_at: nowIso(),
      exported_by: user.full_name || user.id,
      records_count: sheets.length,
      items: await mapAsync(sheets, async (s) => ({
        ...s,
        line_items: await db.prepare('SELECT * FROM teaching_timesheet_items WHERE timesheet_id = ? ORDER BY start_at').all(s.id),
      })),
    };
  });

  route('GET', '/teaching-hours/timesheets/:id', async ({ db, user, params }) => {
    const sheet = await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(params.id);
    if (!sheet) fail(404, 'TIMESHEET_NOT_FOUND', 'Không tìm thấy bảng tổng hợp giờ giảng.');
    assertAnalyticsAccess(user, sheet.instructor_id);
    const items = await db.prepare('SELECT * FROM teaching_timesheet_items WHERE timesheet_id = ? ORDER BY start_at').all(sheet.id);
    return { ...sheet, items };
  });

  // Bước 1: Cuối tháng tổng hợp bảng giờ giảng từ các buổi ĐÃ XÁC NHẬN
  route('POST', '/teaching-hours/timesheets/generate', async ({ db, user, body }) => {
    if (!isAdmin(user) && !isStaff(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới được tổng hợp bảng giờ giảng tháng.');
    }
    await syncAutoOpenedSessions(db);
    const periodMonth = text(body, 'period_month', { required: true, max: 7, label: 'tháng chốt công' });
    if (!PERIOD_MONTH_RE.test(periodMonth)) {
      fail(422, 'VALIDATION_ERROR', 'Tháng chốt công phải có định dạng YYYY-MM (VD: 2026-11).');
    }
    const targetInstructorId = text(body, 'instructor_id', { max: 64, label: 'giảng viên' });

    const where = [
      "COALESCE(s.schedule_state, 'PUBLISHED') = 'PUBLISHED'",
      'substr(s.scheduled_start_at, 1, 7) = ?',
      "(s.confirmation_status IN ('CONFIRMED','CONFIRMED_LATE') OR s.session_status = 'CANCELLED')",
    ];
    const params = [periodMonth];
    if (targetInstructorId) {
      where.push('(COALESCE(NULLIF(s.actual_instructor_id, \'\'), s.scheduled_instructor_id) = ? OR s.scheduled_instructor_id = ?)');
      params.push(targetInstructorId, targetInstructorId);
    }
    if (isStaff(user) && !isAdmin(user)) {
      if (!user.department_id) {
        where.push('1 = 0');
      } else {
        where.push('sc.department_id = ?');
        params.push(user.department_id);
      }
    }

    const sessions = await db
      .prepare(
        `SELECT s.*, sc.code AS class_code, sc.department_id, c.code AS course_code, c.title AS course_title,
                c.minutes_per_period, c.required_room_type
         FROM sessions s
         JOIN subject_classes sc ON sc.id = s.subject_class_id
         LEFT JOIN courses c ON c.id = sc.course_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.scheduled_start_at`
      )
      .all(...params);

    const grouped = new Map();
    const ensureGroup = async (insId) => {
      if (!insId) return null;
      if (!grouped.has(insId)) {
        const u = await db.prepare('SELECT id, full_name, department_id FROM users WHERE id = ?').get(insId);
        if (!u) return null;
        grouped.set(insId, {
          user: u,
          confirmedRows: [],
          cancelledCount: 0,
        });
      }
      return grouped.get(insId);
    };

    for (const s of sessions) {
      if (s.session_status === 'CANCELLED') {
        const g = await ensureGroup(s.scheduled_instructor_id);
        if (g) g.cancelledCount += 1;
        continue;
      }
      const actualId = s.actual_instructor_id || s.scheduled_instructor_id;
      const g = await ensureGroup(actualId);
      if (g) g.confirmedRows.push(s);
    }

    const now = nowIso();
    const generated = [];
    const skippedLocked = [];

    await tx(db, async () => {
      for (const [insId, grp] of grouped.entries()) {
        const existing = await db
          .prepare('SELECT * FROM teaching_timesheets WHERE period_month = ? AND instructor_id = ?')
          .get(periodMonth, insId);

        if (existing && existing.status === 'LOCKED') {
          skippedLocked.push(existing.id);
          continue;
        }

        const quota = await resolveQuotaForInstructor(db, insId, periodMonth);
        let regular = 0;
        let sub = 0;
        let makeup = 0;
        let theoryP = 0;
        let practiceP = 0;
        let onlineP = 0;
        let totalP = 0;
        let totalH = 0;
        const lineItems = [];

        for (const r of grp.confirmedRows) {
          const courseMeta = { minutes_per_period: r.minutes_per_period || 45, required_room_type: r.required_room_type || 'THEORY_ROOM' };
          const { periods, hours } = computeHoursAndPeriods(r, courseMeta);
          const category = inferHourCategory(r, courseMeta);
          const isSub = Boolean(r.is_substitute_teaching || (r.scheduled_instructor_id && r.scheduled_instructor_id !== insId));
          const isMakeup = r.session_kind === 'MAKEUP';

          if (isMakeup) makeup += 1;
          else if (isSub) sub += 1;
          else regular += 1;

          if (category === 'PRACTICE') practiceP = round2(practiceP + periods);
          else if (category === 'ONLINE') onlineP = round2(onlineP + periods);
          else theoryP = round2(theoryP + periods);
          totalP = round2(totalP + periods);
          totalH = round2(totalH + hours);

          lineItems.push({
            session_id: r.session_id,
            subject_class_id: r.subject_class_id,
            class_code: r.class_code,
            course_code: r.course_code || '',
            course_title: r.course_title || r.subject_title || '',
            session_title: r.session_title,
            session_date: String(r.actual_start_at || r.scheduled_start_at).slice(0, 10),
            start_at: r.actual_start_at || r.scheduled_start_at,
            end_at: r.actual_end_at || r.scheduled_end_at,
            hour_category: category,
            role_kind: isMakeup ? 'MAKEUP' : isSub ? 'SUBSTITUTE' : 'PRIMARY',
            periods,
            hours,
          });
        }

        const quotaHours = Number(quota.standard_hours || 30);
        const overtimeHours = round2(Math.max(0, totalH - quotaHours));
        const tsId = existing ? existing.id : `ts_${crypto.randomBytes(6).toString('hex')}`;

        if (existing) {
          await db.prepare(
            `UPDATE teaching_timesheets SET
               instructor_name = ?, department_id = ?, total_sessions = ?, regular_sessions = ?,
               substitute_sessions = ?, makeup_sessions = ?, cancelled_sessions = ?,
               theory_periods = ?, practice_periods = ?, online_periods = ?,
               total_periods = ?, total_hours = ?, quota_hours = ?, overtime_hours = ?,
               status = 'PENDING_TEACHER', review_note = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            grp.user.full_name,
            grp.user.department_id || null,
            grp.confirmedRows.length,
            regular,
            sub,
            makeup,
            grp.cancelledCount,
            theoryP,
            practiceP,
            onlineP,
            totalP,
            totalH,
            quotaHours,
            overtimeHours,
            text(body, 'review_note', { max: 500, label: 'ghi chú tổng hợp' }) || existing.review_note || null,
            now,
            tsId
          );
          await db.prepare('DELETE FROM teaching_timesheet_items WHERE timesheet_id = ?').run(tsId);
        } else {
          await db.prepare(
            `INSERT INTO teaching_timesheets (
               id, period_month, instructor_id, instructor_name, department_id,
               total_sessions, regular_sessions, substitute_sessions, makeup_sessions, cancelled_sessions,
               theory_periods, practice_periods, online_periods, total_periods, total_hours,
               quota_hours, overtime_hours, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_TEACHER', ?, ?)`
          ).run(
            tsId,
            periodMonth,
            insId,
            grp.user.full_name,
            grp.user.department_id || null,
            grp.confirmedRows.length,
            regular,
            sub,
            makeup,
            grp.cancelledCount,
            theoryP,
            practiceP,
            onlineP,
            totalP,
            totalH,
            quotaHours,
            overtimeHours,
            now,
            now
          );
        }

        for (const li of lineItems) {
          await db.prepare(
            `INSERT INTO teaching_timesheet_items (
               id, timesheet_id, session_id, subject_class_id, class_code, course_code, course_title,
               session_title, session_date, start_at, end_at, hour_category, role_kind, periods, hours
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            `tsi_${crypto.randomBytes(6).toString('hex')}`,
            tsId,
            li.session_id,
            li.subject_class_id,
            li.class_code,
            li.course_code,
            li.course_title,
            li.session_title,
            li.session_date,
            li.start_at,
            li.end_at,
            li.hour_category,
            li.role_kind,
            li.periods,
            li.hours
          );
        }

        await db.prepare(
          `INSERT INTO teaching_notifications (id, user_id, notification_type, title, body, link_url, is_read, created_at)
           VALUES (?, ?, 'TIMESHEET_READY', ?, ?, '/teaching/hours', 0, ?)`
        ).run(
          `ntf_${crypto.randomBytes(6).toString('hex')}`,
          insId,
          `Bảng tổng hợp giờ giảng kỳ ${periodMonth} đã sẵn sàng`,
          `Tổng cộng ${totalP} tiết (${totalH} giờ) từ ${grp.confirmedRows.length} buổi dạy đã xác nhận. Vui lòng kiểm tra và xác nhận.`,
          now
        );

        generated.push(await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(tsId));
      }
    });

    return [201, { period_month: periodMonth, generated_count: generated.length, skipped_locked_ids: skippedLocked, items: generated }];
  });

  // Bước 2: Giảng viên kiểm tra, xác nhận hoặc phản hồi sai sót
  route('POST', '/teaching-hours/timesheets/:id/teacher-review', async ({ db, user, body, params }) => {
    const sheet = await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(params.id);
    if (!sheet) fail(404, 'TIMESHEET_NOT_FOUND', 'Không tìm thấy bảng giờ giảng.');
    if (sheet.status === 'LOCKED') {
      fail(409, 'TIMESHEET_LOCKED', 'Bảng giờ giảng đã khóa chuyển Tài chính, không thể thay đổi.');
    }
    if (sheet.instructor_id !== user.id && !isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ chính giảng viên đứng tên bảng giờ giảng mới được xác nhận hoặc phản hồi sai sót.');
    }

    const decision = oneOf(body, 'decision', ['CONFIRM', 'DISPUTE'], { required: true, label: 'quyết định xác nhận' });
    const note = text(body, 'teacher_note', {
      required: decision === 'DISPUTE',
      min: decision === 'DISPUTE' ? 5 : 0,
      max: 1000,
      label: 'nội dung phản hồi sai sót',
    }) || '';
    const now = nowIso();
    const nextStatus = decision === 'CONFIRM' ? 'TEACHER_CONFIRMED' : 'DISPUTED';

    await db.prepare(
      `UPDATE teaching_timesheets
       SET status = ?, teacher_note = ?, teacher_confirmed_at = CASE WHEN ? = 'TEACHER_CONFIRMED' THEN ? ELSE teacher_confirmed_at END, updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, note, nextStatus, now, now, sheet.id);

    return await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(sheet.id);
  });

  // Bước 3: Trưởng bộ môn / Giáo vụ duyệt bảng giờ giảng thuộc bộ môn mình phụ trách
  route('POST', '/teaching-hours/timesheets/:id/approve', async ({ db, user, body, params }) => {
    if (!isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Trưởng bộ môn, Giáo vụ hoặc Quản trị viên mới được duyệt bảng giờ giảng.');
    }
    const sheet = await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(params.id);
    if (!sheet) fail(404, 'TIMESHEET_NOT_FOUND', 'Không tìm thấy bảng giờ giảng.');
    if (sheet.status === 'LOCKED') {
      fail(409, 'TIMESHEET_LOCKED', 'Bảng giờ giảng đã khóa.');
    }
    if (!canApproveDepartmentAcademic(user, sheet.department_id)) {
      fail(403, 'DEPARTMENT_MISMATCH', 'Bạn chỉ được duyệt bảng giờ giảng thuộc tổ/bộ môn của mình.');
    }
    if (sheet.status !== 'TEACHER_CONFIRMED' && !body.force_approve) {
      fail(422, 'TEACHER_CONFIRMATION_REQUIRED', 'Bảng giờ giảng chưa được giảng viên xác nhận (hoặc đang có phản hồi sai sót cần xử lý trước khi duyệt).');
    }

    const reviewNote = text(body, 'review_note', { max: 1000, label: 'ghi chú duyệt' }) || '';
    const now = nowIso();

    await db.prepare(
      `UPDATE teaching_timesheets
       SET status = 'APPROVED', review_note = ?, approved_by = ?, approved_by_name = ?, approved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(reviewNote, user.id, user.full_name || user.id, now, now, sheet.id);

    return await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(sheet.id);
  });

  // Bước 4: Khóa bảng đã duyệt & gắn mã lô chuyển sang Tài chính tính thù lao (chỉ ADMIN / ACADEMIC_STAFF trong đơn vị)
  route('POST', '/teaching-hours/timesheets/:id/lock', async ({ db, user, body, params }) => {
    if (!isAdmin(user) && !isStaff(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới được khóa sổ chuyển Tài chính.');
    }
    const sheet = await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(params.id);
    if (!sheet) fail(404, 'TIMESHEET_NOT_FOUND', 'Không tìm thấy bảng giờ giảng.');
    if (!isAdmin(user)) {
      assertDepartmentScope(user, sheet.department_id, 'Bạn chỉ được khóa sổ bảng giờ giảng thuộc đơn vị phụ trách.');
    }
    if (sheet.status === 'LOCKED') {
      return sheet;
    }
    if (sheet.status !== 'APPROVED') {
      fail(422, 'APPROVAL_REQUIRED_BEFORE_LOCK', 'Chỉ bảng giờ giảng Đã duyệt (APPROVED) mới được khóa và chuyển sang Tài chính.');
    }

    const now = nowIso();
    const batchCode =
      text(body || {}, 'finance_batch_code', { max: 64, label: 'mã lô Tài chính' }) ||
      `FIN-${sheet.period_month.replace('-', '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const lineItems = await db.prepare('SELECT session_id FROM teaching_timesheet_items WHERE timesheet_id = ?').all(sheet.id);

    await tx(db, async () => {
      await db.prepare(
        `UPDATE teaching_timesheets
         SET status = 'LOCKED', locked_by = ?, locked_by_name = ?, locked_at = ?, finance_batch_code = ?, updated_at = ?
         WHERE id = ?`
      ).run(user.id, user.full_name || user.id, now, batchCode, now, sheet.id);

      const lockStmt = db.prepare('UPDATE sessions SET timesheet_locked_id = ? WHERE session_id = ?');
      for (const li of lineItems) {
        await lockStmt.run(sheet.id, li.session_id);
      }

      await db.prepare(
        `INSERT INTO teaching_notifications (id, user_id, notification_type, title, body, link_url, is_read, created_at)
         VALUES (?, ?, 'TIMESHEET_LOCKED', ?, ?, '/teaching/hours', 0, ?)`
      ).run(
        `ntf_${crypto.randomBytes(6).toString('hex')}`,
        sheet.instructor_id,
        `Đã chốt công & chuyển Tài chính kỳ ${sheet.period_month}`,
        `Bảng giờ giảng (${sheet.total_periods} tiết · ${sheet.total_hours} giờ) đã khóa sổ với mã lô ${batchCode} để tính thù lao.`,
        now
      );
    });

    return await db.prepare('SELECT * FROM teaching_timesheets WHERE id = ?').get(sheet.id);
  });
}
