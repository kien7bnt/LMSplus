/**
 * LMSPLUS Teaching Module — Lớp học, học viên, phân công, buổi học, lịch dạy, tổng quan, nhật ký giảng dạy.
 */

import crypto from 'node:crypto';
import { CLASS_STATUSES, DELIVERY_MODES, insertClassSession, vnIso, vnDate, vnDateTime } from './schema.mjs';
import {
  canCreateClass, classCapabilities, classScopeSql, canViewCourse, courseScopeSql,
  isAdmin, isStaff, isInstructor, isStudent, INSTRUCTOR_CAN_MANAGE_ROSTER, staffAssignments,
} from './scope.mjs';
import {
  fail, pageParams, nowIso, nowVn, text, intField, oneOf, dateField, timeField, tx, publicUser,
  compareVietnameseName,
} from './http.mjs';
import { getAttendancePolicy, rateFromCounts } from './attendance.mjs';

const CLASS_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export function getClass(db, id) {
  return db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(id) || null;
}

export function requireClassAccess(db, user, id, capability = 'can_view') {
  const cls = getClass(db, id);
  if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
  const caps = classCapabilities(db, user, cls);
  if (!caps.can_view) fail(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền truy cập lớp học này.');
  if (!caps[capability]) fail(403, 'CLASS_ACTION_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này trong lớp.');
  return { cls, caps };
}

export function requireSession(db, user, sessionId, capability = 'can_view') {
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!session) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy buổi học.');
  const { cls, caps } = requireClassAccess(db, user, session.subject_class_id, capability);
  return { session, cls, caps };
}

function classStaff(db, classId) {
  return db
    .prepare(
      `SELECT t.id AS assignment_id, t.staff_role, t.permissions_json, u.id, u.code, u.full_name, u.email
       FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id
       WHERE t.subject_class_id = ? AND t.is_active = 1
       ORDER BY CASE t.staff_role WHEN 'PRIMARY_INSTRUCTOR' THEN 0 WHEN 'CO_INSTRUCTOR' THEN 1 ELSE 2 END, u.full_name`
    )
    .all(classId)
    .map((r) => ({ ...publicUser(r), assignment_id: r.assignment_id, staff_role: r.staff_role, permissions: JSON.parse(r.permissions_json || '{}') }));
}

function classCounters(db, cls) {
  const now = nowVn();
  const students = db.prepare(`SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'`).get(cls.id).n;
  const sess = db
    .prepare(
      `SELECT COUNT(*) total,
         SUM(CASE WHEN scheduled_end_at < ? THEN 1 ELSE 0 END) done,
         SUM(CASE WHEN scheduled_end_at < ? AND attendance_saved_at IS NULL THEN 1 ELSE 0 END) unmarked
       FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED'`
    )
    .get(now, now, cls.id);
  const agg = db
    .prepare(
      `SELECT
         SUM(ar.attendance_status = 'PRESENT') p, SUM(ar.attendance_status = 'LATE') l,
         SUM(ar.attendance_status = 'EXCUSED_ABSENCE') e, SUM(ar.attendance_status = 'UNEXCUSED_ABSENCE') a
       FROM attendance_records ar JOIN sessions s ON s.session_id = ar.class_session_id
       WHERE ar.subject_class_id = ? AND s.session_status <> 'CANCELLED'`
    )
    .get(cls.id);
  const next = db
    .prepare(
      `SELECT session_id, session_title, scheduled_start_at, scheduled_end_at, room_or_link FROM sessions
       WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at >= ?
       ORDER BY scheduled_start_at LIMIT 1`
    )
    .get(cls.id, now);
  return {
    student_count: students,
    sessions_total: sess.total || 0,
    sessions_done: sess.done || 0,
    sessions_unmarked: sess.unmarked || 0,
    attendance_rate: rateFromCounts(
      { PRESENT: agg.p || 0, LATE: agg.l || 0, EXCUSED_ABSENCE: agg.e || 0, UNEXCUSED_ABSENCE: agg.a || 0 },
      getAttendancePolicy(db)
    ),
    next_session: next || null,
  };
}

export function classDto(db, cls, user = null) {
  const course = cls.course_id ? db.prepare('SELECT id, code, title, status FROM courses WHERE id = ?').get(cls.course_id) : null;
  return {
    id: cls.id,
    code: cls.code,
    title: cls.title,
    subject: cls.subject || '',
    description: cls.description || '',
    course: course || null,
    start_date: cls.start_date,
    end_date: cls.end_date,
    max_students: cls.max_students,
    delivery_mode: cls.delivery_mode,
    status: cls.status,
    room: cls.room || '',
    schedule_text: cls.schedule_text || '',
    department_id: cls.department_id,
    staff: classStaff(db, cls.id),
    updated_at: cls.updated_at,
    ...(user ? { capabilities: classCapabilities(db, user, cls) } : {}),
    ...classCounters(db, cls),
  };
}

function readClassFields(db, user, body, { partial }) {
  const f = {};
  const req = !partial;
  if (!partial || 'code' in body) {
    const code = text(body, 'code', { required: true, max: 40, label: 'mã lớp' });
    if (!CLASS_CODE_RE.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã lớp chỉ gồm chữ, số, dấu chấm, gạch ngang.', { field: 'code' });
    f.code = code.toUpperCase();
  }
  if (!partial || 'title' in body) f.title = text(body, 'title', { required: req || 'title' in body, min: 2, max: 200, label: 'tên lớp' });
  if (!partial || 'subject' in body) f.subject = text(body, 'subject', { max: 100, label: 'môn học' });
  if (!partial || 'description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' });
  if (!partial || 'room' in body) f.room = text(body, 'room', { max: 200, label: 'phòng học / đường dẫn' });
  if (!partial || 'schedule_text' in body) f.schedule_text = text(body, 'schedule_text', { max: 300, label: 'lịch học' });
  if (!partial || 'start_date' in body) f.start_date = dateField(body, 'start_date', { label: 'ngày bắt đầu' });
  if (!partial || 'end_date' in body) f.end_date = dateField(body, 'end_date', { label: 'ngày kết thúc' });
  if (!partial || 'max_students' in body) f.max_students = intField(body, 'max_students', { min: 1, max: 1000, label: 'sĩ số tối đa' });
  if (!partial || 'delivery_mode' in body) f.delivery_mode = oneOf(body, 'delivery_mode', DELIVERY_MODES, { fallback: 'OFFLINE', label: 'hình thức học' });
  if ('status' in body) f.status = oneOf(body, 'status', CLASS_STATUSES, { required: true, label: 'trạng thái' });
  if ('course_id' in body) {
    if (!body.course_id) {
      f.course_id = null;
    } else {
      const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(body.course_id);
      if (!course) fail(422, 'VALIDATION_ERROR', 'Khóa học không tồn tại.', { field: 'course_id' });
      if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền sử dụng khóa học này.');
      if (course.status === 'ARCHIVED' || course.status === 'INACTIVE') {
        fail(422, 'VALIDATION_ERROR', 'Không thể liên kết với khóa học đã lưu trữ hoặc ngừng hoạt động.', { field: 'course_id' });
      }
      f.course_id = course.id;
    }
  }
  return f;
}

function assertDates(start, end) {
  if (start && end && end < start) fail(422, 'VALIDATION_ERROR', 'Ngày kết thúc phải sau ngày bắt đầu.', { field: 'end_date' });
}

function sessionDto(db, s, rosterSize = null) {
  const counts = db
    .prepare(`SELECT attendance_status st, COUNT(*) n FROM attendance_records WHERE class_session_id = ? GROUP BY attendance_status`)
    .all(s.session_id)
    .reduce((acc, r) => ({ ...acc, [r.st]: r.n }), {});
  const marked = Object.values(counts).reduce((a, b) => a + b, 0);
  const now = nowVn();
  let attendance_state = 'NOT_STARTED';
  if (s.session_status === 'CANCELLED') attendance_state = 'CANCELLED';
  else if (s.attendance_locked_at) attendance_state = 'LOCKED';
  else if (s.attendance_saved_at) attendance_state = 'SAVED';
  else if (s.scheduled_start_at <= now) attendance_state = 'NEEDS_ATTENDANCE';
  return {
    id: s.session_id,
    class_id: s.subject_class_id,
    class_code: s.subject_class_code,
    title: s.session_title,
    start_at: s.scheduled_start_at,
    end_at: s.scheduled_end_at,
    room_or_link: s.room_or_link || '',
    session_status: s.session_status,
    cancel_reason: s.cancel_reason || '',
    instructor_name: s.actual_instructor_name || s.scheduled_instructor_name || '',
    attendance_state,
    attendance_saved_at: s.attendance_saved_at,
    attendance_locked_at: s.attendance_locked_at,
    counts,
    marked_count: marked,
    roster_size: rosterSize,
    confirmation_status: s.confirmation_status,
    confirmation_deadline_at: s.confirmation_deadline_at,
    confirmed_at: s.confirmed_at,
    is_late_confirmation: Boolean(s.is_late_confirmation),
  };
}

function findUsersByIdentifiers(db, identifiers) {
  const found = [];
  const notFound = [];
  for (const raw of identifiers) {
    const key = String(raw).trim();
    if (!key) continue;
    const u = db.prepare('SELECT * FROM users WHERE id = ? OR UPPER(code) = UPPER(?) OR LOWER(email) = LOWER(?)').get(key, key, key);
    if (!u || !JSON.parse(u.roles_json).includes('STUDENT')) notFound.push(key);
    else found.push(u);
  }
  return { found, notFound };
}

function enrollStudents(db, user, cls, identifiers, log) {
  if (identifiers.length === 0) fail(422, 'VALIDATION_ERROR', 'Danh sách học viên trống.');
  if (identifiers.length > 1000) fail(422, 'VALIDATION_ERROR', 'Tối đa 1000 học viên mỗi lần.');
  const { found, notFound } = findUsersByIdentifiers(db, identifiers);
  const result = { added: [], reactivated: [], already_enrolled: [], not_found: notFound };
  tx(db, () => {
    for (const u of found) {
      const e = db.prepare('SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ?').get(cls.id, u.id);
      if (e && e.status === 'ACTIVE') {
        result.already_enrolled.push(u.code);
        continue;
      }
      if (cls.max_students) {
        const n = db.prepare(`SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'`).get(cls.id).n;
        if (n >= cls.max_students) fail(422, 'CLASS_FULL', `Lớp đã đủ sĩ số tối đa (${cls.max_students}).`);
      }
      if (e) {
        db.prepare(`UPDATE class_enrollments SET status = 'ACTIVE', dropped_at = NULL, enrolled_at = ?, updated_by = ? WHERE id = ?`)
          .run(nowIso(), user.id, e.id);
        result.reactivated.push(u.code);
      } else {
        db.prepare(
          `INSERT INTO class_enrollments (id, subject_class_id, student_id, enrollment_source, status, enrolled_at, updated_by)
           VALUES (?, ?, ?, 'ACADEMIC_ASSIGNED', 'ACTIVE', ?, ?)`
        ).run(crypto.randomUUID(), cls.id, u.id, nowIso(), user.id);
        result.added.push(u.code);
      }
    }
  });
  log('INFO', `[teaching] roster ${cls.code}: +${result.added.length} ~${result.reactivated.length} by ${user.id}`);
  return result;
}

export function registerClassRoutes(route) {
  // ---------- Năng lực của người dùng hiện tại
  route('GET', '/me', ({ db, user }) => ({
    user: { id: user.id, full_name: user.full_name, email: user.email, roles: user.roles, department_id: user.department_id },
    can_create_course: canCreateClass(user),
    can_create_class: canCreateClass(user),
    can_pick_instructor: isAdmin(user) || isStaff(user),
    instructor_can_manage_roster: INSTRUCTOR_CAN_MANAGE_ROSTER,
    attendance_policy: getAttendancePolicy(db),
  }));

  // ---------- Tra cứu người dùng (phục vụ chọn giảng viên / thêm học viên)
  route('GET', '/users', ({ db, user, url }) => {
    const role = url.searchParams.get('role');
    if (!['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT'].includes(role)) fail(422, 'VALIDATION_ERROR', 'Vai trò tra cứu không hợp lệ.');
    const allowed = isAdmin(user) || isStaff(user) || (role === 'STUDENT' && isInstructor(user) && INSTRUCTOR_CAN_MANAGE_ROSTER);
    if (!allowed) fail(403, 'USER_LOOKUP_FORBIDDEN', 'Bạn không có quyền tra cứu danh sách người dùng.');
    const q = (url.searchParams.get('q') || '').trim();
    const params = [`%"${role}"%`];
    let where = 'roles_json LIKE ?';
    if (!isAdmin(user) && user.department_id) {
      where += ' AND department_id = ?';
      params.push(user.department_id);
    }
    if (q) {
      where += ' AND (full_name LIKE ? OR code LIKE ? OR email LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db.prepare(`SELECT id, code, full_name, email FROM users WHERE ${where} ORDER BY full_name LIMIT 50`).all(...params);
    return { items: rows.map(publicUser) };
  });

  // ---------- Danh sách lớp
  route('GET', '/classes', ({ db, user, url }) => {
    const { page, size, offset } = pageParams(url, 12, 100);
    const scope = classScopeSql(user);
    const where = [scope.sql];
    const params = [...scope.params];
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push('(sc.code LIKE ? OR sc.title LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const status = url.searchParams.get('status');
    if (status && status !== 'ALL') {
      where.push('sc.status = ?');
      params.push(status);
    } else if (!status) {
      where.push("sc.status <> 'ARCHIVED'");
    }
    const courseId = url.searchParams.get('course_id');
    if (courseId) {
      where.push('sc.course_id = ?');
      params.push(courseId);
    }
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM subject_classes sc WHERE ${whereSql}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT sc.* FROM subject_classes sc WHERE ${whereSql}
         ORDER BY CASE sc.status WHEN 'ACTIVE' THEN 0 WHEN 'UPCOMING' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, sc.code
         LIMIT ? OFFSET ?`
      )
      .all(...params, size, offset);
    return { items: rows.map((r) => classDto(db, r, user)), page, page_size: size, total };
  });

  // ---------- Tạo lớp
  route('POST', '/classes', ({ db, user, body, log }) => {
    if (!canCreateClass(user)) fail(403, 'CLASS_CREATE_FORBIDDEN', 'Bạn chưa được cấp quyền tạo lớp học.');
    const f = readClassFields(db, user, body, { partial: false });
    assertDates(f.start_date, f.end_date);
    if (db.prepare('SELECT 1 FROM subject_classes WHERE UPPER(code) = ?').get(f.code)) {
      fail(409, 'CLASS_CODE_EXISTS', `Mã lớp "${f.code}" đã tồn tại.`, { field: 'code' });
    }
    // Giảng viên phụ trách
    let instructor;
    if ((isAdmin(user) || isStaff(user)) && body.instructor_id) {
      instructor = db.prepare('SELECT * FROM users WHERE id = ?').get(body.instructor_id);
      if (!instructor || !JSON.parse(instructor.roles_json).includes('INSTRUCTOR')) {
        fail(422, 'VALIDATION_ERROR', 'Giảng viên phụ trách không hợp lệ.', { field: 'instructor_id' });
      }
      if (!isAdmin(user) && instructor.department_id !== user.department_id) fail(403, 'OUT_OF_SCOPE', 'Giảng viên không thuộc đơn vị bạn quản lý.');
    } else if (isInstructor(user)) {
      instructor = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn giảng viên phụ trách.', { field: 'instructor_id' });
    }
    const status = f.status || 'UPCOMING';
    if (!['DRAFT', 'UPCOMING', 'ACTIVE'].includes(status)) fail(422, 'VALIDATION_ERROR', 'Lớp mới chỉ có thể ở trạng thái Nháp, Sắp diễn ra hoặc Đang học.');
    const id = `sc_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    const course = f.course_id ? db.prepare('SELECT * FROM courses WHERE id = ?').get(f.course_id) : null;
    tx(db, () => {
      db.prepare(
        `INSERT INTO subject_classes (id, course_id, code, title, subject, description, instructor_name, ta_names_json,
           schedule_text, room, student_count, start_date, end_date, max_students, delivery_mode, status, department_id,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, f.course_id || null, f.code, f.title, f.subject || (course ? course.subject : null), f.description,
        instructor.full_name, f.schedule_text, f.room, f.start_date, f.end_date, f.max_students, f.delivery_mode,
        status, instructor.department_id || user.department_id || (course ? course.department_id : null), user.id, now, now);
      db.prepare(
        `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active,
           assigned_by, created_at, updated_at) VALUES (?, ?, ?, 'PRIMARY_INSTRUCTOR', ?, 1, ?, ?, ?)`
      ).run(crypto.randomUUID(), id, instructor.id, '{"can_manage_materials":true,"can_take_attendance":true}', user.id, now, now);
    });
    log('INFO', `[teaching] class created ${f.code} by ${user.id}`);
    return [201, classDto(db, getClass(db, id), user)];
  });

  // ---------- Chi tiết lớp + việc cần xử lý
  route('GET', '/classes/:id', ({ db, user, params }) => {
    const { cls, caps } = requireClassAccess(db, user, params.id);
    if (caps.role === 'STUDENT') fail(403, 'CLASS_ACCESS_DENIED', 'Học viên xem lớp tại mục "Lớp của tôi".');
    const now = nowVn();
    const upcoming = db
      .prepare(`SELECT * FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at >= ? ORDER BY scheduled_start_at LIMIT 5`)
      .all(cls.id, now)
      .map((s) => sessionDto(db, s));
    const unmarked = db
      .prepare(`SELECT * FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_start_at <= ? AND attendance_saved_at IS NULL ORDER BY scheduled_start_at DESC LIMIT 10`)
      .all(cls.id, now)
      .map((s) => sessionDto(db, s));
    const unconfirmed = db
      .prepare(`SELECT * FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at < ? AND confirmation_status IN ('AWAITING_CONFIRMATION','OVERDUE_UNCONFIRMED') ORDER BY scheduled_start_at DESC LIMIT 10`)
      .all(cls.id, now)
      .map((s) => sessionDto(db, s));
    let progress = null;
    if (cls.course_id) {
      const total = db
        .prepare(`SELECT COUNT(*) n FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ch.course_id = ? AND ch.status = 'PUBLISHED' AND l.publish_status = 'PUBLISHED'`)
        .get(cls.course_id).n;
      const done = db
        .prepare(
          `SELECT COUNT(*) n FROM lesson_progress p JOIN class_enrollments e ON e.subject_class_id = p.subject_class_id AND e.student_id = p.student_id AND e.status = 'ACTIVE'
           JOIN lessons l ON l.id = p.lesson_id AND l.publish_status = 'PUBLISHED'
           WHERE p.subject_class_id = ? AND p.status = 'COMPLETED'`
        )
        .get(cls.id).n;
      const students = db.prepare(`SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'`).get(cls.id).n;
      progress = { published_lessons: total, avg_completion_pct: total && students ? Math.round((done / (total * students)) * 1000) / 10 : 0 };
    }
    return { ...classDto(db, cls), capabilities: caps, upcoming_sessions: upcoming, sessions_need_attendance: unmarked, logs_unconfirmed: unconfirmed, progress };
  });

  route('PATCH', '/classes/:id', ({ db, user, body, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_class');
    const f = readClassFields(db, user, body, { partial: true });
    if (f.code && f.code !== cls.code && db.prepare('SELECT 1 FROM subject_classes WHERE UPPER(code) = ? AND id <> ?').get(f.code, cls.id)) {
      fail(409, 'CLASS_CODE_EXISTS', `Mã lớp "${f.code}" đã tồn tại.`, { field: 'code' });
    }
    assertDates(f.start_date ?? cls.start_date, f.end_date ?? cls.end_date);

    let nextPrimary = null;
    if ((isAdmin(user) || isStaff(user)) && body && typeof body.instructor_id === 'string' && body.instructor_id.trim()) {
      const cand = db.prepare('SELECT * FROM users WHERE id = ?').get(body.instructor_id.trim());
      if (!cand || !JSON.parse(cand.roles_json || '[]').includes('INSTRUCTOR')) {
        fail(422, 'VALIDATION_ERROR', 'Giảng viên phụ trách không hợp lệ.', { field: 'instructor_id' });
      }
      if (!isAdmin(user) && cand.department_id !== user.department_id) {
        fail(403, 'OUT_OF_SCOPE', 'Giảng viên không thuộc đơn vị bạn quản lý.');
      }
      nextPrimary = cand;
      f.instructor_name = cand.full_name;
    }

    const keys = Object.keys(f);
    tx(db, () => {
      if (keys.length) {
        db.prepare(`UPDATE subject_classes SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...keys.map((k) => f[k]), nowIso(), cls.id);
      }
      if (nextPrimary) {
        const curPrimary = db
          .prepare(`SELECT * FROM teaching_staff_assignments WHERE subject_class_id = ? AND staff_role = 'PRIMARY_INSTRUCTOR' AND is_active = 1`)
          .get(cls.id);
        if (!curPrimary || curPrimary.user_id !== nextPrimary.id) {
          db.prepare(`UPDATE teaching_staff_assignments SET is_active = 0, updated_at = ? WHERE subject_class_id = ? AND staff_role = 'PRIMARY_INSTRUCTOR' AND is_active = 1`)
            .run(nowIso(), cls.id);
          db.prepare(
            `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
             VALUES (?, ?, ?, 'PRIMARY_INSTRUCTOR', '{"can_manage_materials":true,"can_take_attendance":true}', 1, ?, ?, ?)`
          ).run(crypto.randomUUID(), cls.id, nextPrimary.id, user.id, nowIso(), nowIso());
        }
      }
    });
    if (keys.length || nextPrimary) {
      log('INFO', `[teaching] class ${cls.code} updated (${keys.join(',')}) by ${user.id}`);
    }
    return classDto(db, getClass(db, cls.id), user);
  });

  // ---------- Học viên
  route('GET', '/classes/:id/students', ({ db, user, params, url }) => {
    const { cls, caps } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const status = url.searchParams.get('status') || 'ACTIVE';
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let rows = db
      .prepare(
        `SELECT e.student_id, e.status, e.enrolled_at, e.dropped_at, u.code, u.full_name, u.email
         FROM class_enrollments e JOIN users u ON u.id = e.student_id WHERE e.subject_class_id = ?`
      )
      .all(cls.id);
    if (status !== 'ALL') rows = rows.filter((r) => r.status === status);
    if (q) rows = rows.filter((r) => `${r.code} ${r.full_name} ${r.email}`.toLowerCase().includes(q));
    const policy = getAttendancePolicy(db);
    const att = db
      .prepare(
        `SELECT ar.student_id, ar.attendance_status st, COUNT(*) n FROM attendance_records ar
         JOIN sessions s ON s.session_id = ar.class_session_id
         WHERE ar.subject_class_id = ? AND s.session_status <> 'CANCELLED' GROUP BY ar.student_id, ar.attendance_status`
      )
      .all(cls.id);
    const attMap = {};
    for (const a of att) (attMap[a.student_id] ||= {})[a.st] = a.n;
    let totalLessons = 0;
    const doneMap = {};
    if (cls.course_id) {
      totalLessons = db
        .prepare(`SELECT COUNT(*) n FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ch.course_id = ? AND ch.status = 'PUBLISHED' AND l.publish_status = 'PUBLISHED'`)
        .get(cls.course_id).n;
      for (const r of db
        .prepare(`SELECT p.student_id, COUNT(*) n FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id AND l.publish_status = 'PUBLISHED' WHERE p.subject_class_id = ? AND p.status = 'COMPLETED' GROUP BY p.student_id`)
        .all(cls.id)) doneMap[r.student_id] = r.n;
    }
    rows.sort((a, b) => compareVietnameseName(a.full_name, b.full_name));
    return {
      items: rows.map((r) => {
        const counts = attMap[r.student_id] || {};
        return {
          id: r.student_id,
          code: r.code,
          full_name: r.full_name,
          email: r.email,
          status: r.status,
          enrolled_at: r.enrolled_at,
          dropped_at: r.dropped_at,
          attendance: {
            present: counts.PRESENT || 0,
            late: counts.LATE || 0,
            excused: counts.EXCUSED_ABSENCE || 0,
            absent: counts.UNEXCUSED_ABSENCE || 0,
            rate: rateFromCounts(counts, policy),
          },
          progress: { completed: doneMap[r.student_id] || 0, total: totalLessons },
        };
      }),
      capabilities: caps,
    };
  });

  route('POST', '/classes/:id/students', ({ db, user, body, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_roster');
    const ids = Array.isArray(body.students) ? body.students : [];
    return enrollStudents(db, user, cls, ids, log);
  });

  route('POST', '/classes/:id/students/import', ({ db, user, body, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_roster');
    const raw = typeof body.text === 'string' ? body.text : '';
    if (raw.length > 200_000) fail(413, 'PAYLOAD_TOO_LARGE', 'Danh sách quá lớn.');
    const identifiers = raw
      .split(/[\r\n,;\t]+/)
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter((s) => s && !/^(mã|ma|code|email|stt)/i.test(s));
    return enrollStudents(db, user, cls, [...new Set(identifiers)], log);
  });

  route('DELETE', '/classes/:id/students/:studentId', ({ db, user, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_roster');
    const e = db.prepare(`SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`).get(cls.id, params.studentId);
    if (!e) fail(404, 'ENROLLMENT_NOT_FOUND', 'Học viên không có trong lớp.');
    db.prepare(`UPDATE class_enrollments SET status = 'DROPPED', dropped_at = ?, updated_by = ? WHERE id = ?`).run(nowIso(), user.id, e.id);
    log('INFO', `[teaching] roster ${cls.code}: dropped ${params.studentId} by ${user.id}`);
    return { student_id: params.studentId, status: 'DROPPED' };
  });

  // ---------- Phân công giảng dạy
  route('GET', '/classes/:id/staff', ({ db, user, params }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    return { items: classStaff(db, cls.id) };
  });

  route('POST', '/classes/:id/staff', ({ db, user, body, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_staff');
    const role = oneOf(body, 'staff_role', ['PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR', 'TEACHING_ASSISTANT'], { required: true, label: 'vai trò' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(body.user_id);
    const needRole = role === 'TEACHING_ASSISTANT' ? 'TEACHING_ASSISTANT' : 'INSTRUCTOR';
    if (!u || !JSON.parse(u.roles_json).includes(needRole)) fail(422, 'VALIDATION_ERROR', 'Người được phân công không phù hợp với vai trò.', { field: 'user_id' });
    const perms = {
      can_manage_materials: Boolean(body.permissions?.can_manage_materials ?? role !== 'TEACHING_ASSISTANT'),
      can_take_attendance: Boolean(body.permissions?.can_take_attendance ?? true),
    };
    const now = nowIso();
    const existing = db.prepare('SELECT id FROM teaching_staff_assignments WHERE subject_class_id = ? AND user_id = ? AND staff_role = ?').get(cls.id, u.id, role);
    if (existing) {
      db.prepare('UPDATE teaching_staff_assignments SET is_active = 1, permissions_json = ?, assigned_by = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(perms), user.id, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(crypto.randomUUID(), cls.id, u.id, role, JSON.stringify(perms), user.id, now, now);
    }
    log('INFO', `[teaching] staff ${role} ${u.id} assigned to ${cls.code} by ${user.id}`);
    return [201, { items: classStaff(db, cls.id) }];
  });

  route('DELETE', '/classes/:id/staff/:assignmentId', ({ db, user, params }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_staff');
    const a = db.prepare('SELECT * FROM teaching_staff_assignments WHERE id = ? AND subject_class_id = ? AND is_active = 1').get(params.assignmentId, cls.id);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy phân công.');
    if (a.staff_role === 'PRIMARY_INSTRUCTOR') {
      const others = db.prepare(`SELECT COUNT(*) n FROM teaching_staff_assignments WHERE subject_class_id = ? AND staff_role = 'PRIMARY_INSTRUCTOR' AND is_active = 1`).get(cls.id).n;
      if (others <= 1) fail(422, 'LAST_PRIMARY_INSTRUCTOR', 'Lớp cần ít nhất một giảng viên phụ trách chính.');
    }
    db.prepare('UPDATE teaching_staff_assignments SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), a.id);
    return { items: classStaff(db, cls.id) };
  });

  // ---------- Buổi học
  route('GET', '/classes/:id/sessions', ({ db, user, params, url }) => {
    const { cls, caps } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const where = ['subject_class_id = ?'];
    const p = [cls.id];
    if (from) {
      where.push('scheduled_start_at >= ?');
      p.push(`${from}T00:00:00+07:00`);
    }
    if (to) {
      where.push('scheduled_start_at <= ?');
      p.push(`${to}T23:59:59+07:00`);
    }
    const rosterSize = db.prepare(`SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'`).get(cls.id).n;
    const rows = db.prepare(`SELECT * FROM sessions WHERE ${where.join(' AND ')} ORDER BY scheduled_start_at`).all(...p);
    return { items: rows.map((s) => sessionDto(db, s, rosterSize)), capabilities: caps };
  });

  route('POST', '/classes/:id/sessions', ({ db, user, body, params, log }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_sessions');
    const startTime = timeField(body, 'start_time', { label: 'giờ bắt đầu' });
    const endTime = timeField(body, 'end_time', { label: 'giờ kết thúc' });
    if (endTime <= startTime) fail(422, 'VALIDATION_ERROR', 'Giờ kết thúc phải sau giờ bắt đầu.', { field: 'end_time' });
    const title = text(body, 'title', { max: 200, label: 'nội dung buổi học' });
    const room = text(body, 'room_or_link', { max: 300, label: 'phòng học / đường dẫn' }) || cls.room || null;
    let dates = [];
    if (body.recurrence) {
      const r = body.recurrence;
      const startDate = dateField(r, 'start_date', { required: true, label: 'ngày bắt đầu' });
      const endDate = dateField(r, 'end_date', { required: true, label: 'ngày kết thúc' });
      if (endDate < startDate) fail(422, 'VALIDATION_ERROR', 'Ngày kết thúc phải sau ngày bắt đầu.');
      const weekdays = Array.isArray(r.weekdays) ? r.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [];
      if (weekdays.length === 0) fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn ít nhất một ngày trong tuần.');
      for (let t = Date.parse(`${startDate}T12:00:00+07:00`); t <= Date.parse(`${endDate}T12:00:00+07:00`); t += 86400000) {
        const d = new Date(t);
        if (weekdays.includes(d.getUTCDay())) dates.push(vnDate(d));
        if (dates.length > 150) fail(422, 'VALIDATION_ERROR', 'Tối đa 150 buổi mỗi lần tạo.');
      }
    } else {
      dates = [dateField(body, 'date', { required: true, label: 'ngày học' })];
    }
    const instructor = classStaff(db, cls.id).find((s) => s.staff_role === 'PRIMARY_INSTRUCTOR');
    const created = [];
    const skipped = [];
    tx(db, () => {
      dates.forEach((d, i) => {
        const startAt = vnDateTime(d, startTime);
        if (db.prepare('SELECT 1 FROM sessions WHERE subject_class_id = ? AND scheduled_start_at = ?').get(cls.id, startAt)) {
          skipped.push(d);
          return;
        }
        const id = `ses_${crypto.randomBytes(5).toString('hex')}`;
        insertClassSession(db, {
          session_id: id,
          subject_class_id: cls.id,
          subject_class_code: cls.code,
          subject_title: cls.title,
          session_title: title || `Buổi học ngày ${d.split('-').reverse().join('/')}`,
          scheduled_start_at: startAt,
          scheduled_end_at: vnDateTime(d, endTime),
          instructor_id: instructor ? instructor.id : '',
          instructor_name: instructor ? instructor.full_name : '',
          room_or_link: room,
          created_by: user.id,
        });
        created.push(id);
      });
    });
    log('INFO', `[teaching] ${created.length} session(s) created for ${cls.code} by ${user.id}`);
    return [201, { created_count: created.length, skipped_dates: skipped, created_ids: created }];
  });

  route('PATCH', '/sessions/:id', ({ db, user, body, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_manage_sessions');
    const f = {};
    if ('title' in body) f.session_title = text(body, 'title', { required: true, max: 200, label: 'nội dung buổi học' });
    if ('room_or_link' in body) f.room_or_link = text(body, 'room_or_link', { max: 300, label: 'phòng học / đường dẫn' });
    if ('date' in body || 'start_time' in body || 'end_time' in body) {
      if (session.attendance_saved_at) fail(409, 'ATTENDANCE_EXISTS', 'Buổi học đã có dữ liệu điểm danh, không thể đổi thời gian.');
      const d = dateField(body, 'date', { required: true, label: 'ngày học' });
      const st = timeField(body, 'start_time', { label: 'giờ bắt đầu' });
      const et = timeField(body, 'end_time', { label: 'giờ kết thúc' });
      if (et <= st) fail(422, 'VALIDATION_ERROR', 'Giờ kết thúc phải sau giờ bắt đầu.');
      f.scheduled_start_at = vnDateTime(d, st);
      f.scheduled_end_at = vnDateTime(d, et);
      f.actual_start_at = f.scheduled_start_at;
      f.actual_end_at = f.scheduled_end_at;
      f.confirmation_deadline_at = vnIso(new Date(Date.parse(f.scheduled_end_at) + 24 * 3600 * 1000));
    }
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE session_id = ?`).run(...keys.map((k) => f[k]), session.session_id);
    return sessionDto(db, db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id));
  });

  route('POST', '/sessions/:id/cancel', ({ db, user, body, params, log }) => {
    const { session } = requireSession(db, user, params.id, 'can_manage_sessions');
    const reason = text(body, 'reason', { required: true, max: 500, label: 'lý do hủy' });
    if (session.session_status === 'CANCELLED') fail(409, 'SESSION_ALREADY_CANCELLED', 'Buổi học đã được hủy trước đó.');
    tx(db, () => {
      db.prepare("UPDATE sessions SET session_status = 'CANCELLED', cancel_reason = ? WHERE session_id = ?").run(reason, session.session_id);
      db.prepare(
        `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, 'CANCELLED', ?, ?, ?)`
      ).run(`hist_${crypto.randomBytes(4).toString('hex')}`, session.session_id, session.subject_class_code, session.session_status, user.full_name || user.id, nowIso(), `Hủy buổi học: ${reason}`);
    });
    log('INFO', `[teaching] session ${session.session_id} cancelled by ${user.id}`);
    return sessionDto(db, db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id));
  });

  route('POST', '/sessions/:id/restore', ({ db, user, params }) => {
    const { session } = requireSession(db, user, params.id, 'can_manage_sessions');
    if (session.session_status !== 'CANCELLED') fail(409, 'SESSION_NOT_CANCELLED', 'Buổi học chưa bị hủy.');
    const status = session.scheduled_end_at < nowVn() ? 'COMPLETED' : 'SCHEDULED';
    db.prepare('UPDATE sessions SET session_status = ?, cancel_reason = NULL WHERE session_id = ?').run(status, session.session_id);
    return sessionDto(db, db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id));
  });

  // ---------- Nhật ký giảng dạy: xác nhận (quy tắc 24 giờ, không khóa xác nhận muộn)
  route('POST', '/sessions/:id/confirm-log', ({ db, user, body, params, log }) => {
    const { session } = requireSession(db, user, params.id, 'can_confirm_teaching_log');
    if (session.session_status === 'CANCELLED') fail(422, 'SESSION_CANCELLED', 'Buổi học đã hủy.');
    if (session.scheduled_end_at > nowVn()) fail(422, 'SESSION_NOT_ENDED', 'Chỉ xác nhận nhật ký sau khi buổi học kết thúc.');
    if (['CONFIRMED', 'CONFIRMED_LATE'].includes(session.confirmation_status)) fail(409, 'ALREADY_CONFIRMED', 'Nhật ký buổi học đã được xác nhận.');
    const nowMs = Date.now();
    const isLate = session.confirmation_status === 'OVERDUE_UNCONFIRMED' || nowMs > Date.parse(session.confirmation_deadline_at);
    const reason = text(body, 'note', { max: 1000, label: 'ghi chú' });
    if (isLate && !reason) fail(422, 'LATE_REASON_REQUIRED', 'Xác nhận sau 24 giờ cần nhập lý do.', { field: 'note' });
    const next = isLate ? 'CONFIRMED_LATE' : 'CONFIRMED';
    const now = nowIso();
    tx(db, () => {
      db.prepare('UPDATE sessions SET confirmation_status = ?, confirmed_at = ?, is_late_confirmation = ?, late_confirmation_reason = ? WHERE session_id = ?')
        .run(next, now, isLate ? 1 : 0, isLate ? reason : null, session.session_id);
      db.prepare(
        `INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`hist_${crypto.randomBytes(4).toString('hex')}`, session.session_id, session.subject_class_code, session.confirmation_status, next,
        user.full_name || user.id, now, `Kết thúc buổi: ${session.scheduled_end_at} | Xác nhận: ${now}${reason ? ` | Ghi chú: ${reason}` : ''}`);
    });
    log('INFO', `[teaching] teaching log ${session.session_id} -> ${next} by ${user.id}`);
    return sessionDto(db, db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session.session_id));
  });

  route('GET', '/classes/:id/teaching-log', ({ db, user, params }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const items = db
      .prepare(
        `SELECT h.* FROM teaching_log_history h JOIN sessions s ON s.session_id = h.session_id
         WHERE s.subject_class_id = ? ORDER BY h.changed_at DESC LIMIT 200`
      )
      .all(cls.id);
    return { items };
  });

  // ---------- Lịch giảng dạy
  route('GET', '/schedule', ({ db, user, url }) => {
    const today = vnDate();
    const from = url.searchParams.get('from') || today;
    const to = url.searchParams.get('to') || vnDate(new Date(Date.now() + 6 * 86400000));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) fail(422, 'VALIDATION_ERROR', 'Khoảng thời gian không hợp lệ.');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) fail(422, 'VALIDATION_ERROR', 'Chỉ xem tối đa 62 ngày mỗi lần.');
    const params = [`${from}T00:00:00+07:00`, `${to}T23:59:59+07:00`];
    let classFilter;
    if (isStudent(user) && !isInstructor(user) && !isStaff(user) && !isAdmin(user)) {
      classFilter = `s.subject_class_id IN (SELECT subject_class_id FROM class_enrollments WHERE student_id = ? AND status = 'ACTIVE')`;
      params.push(user.id);
    } else {
      const scope = classScopeSql(user);
      classFilter = `s.subject_class_id IN (SELECT sc.id FROM subject_classes sc WHERE ${scope.sql})`;
      params.push(...scope.params);
    }
    const classId = url.searchParams.get('class_id');
    let extra = '';
    if (classId) {
      extra = ' AND s.subject_class_id = ?';
      params.push(classId);
    }
    const rows = db
      .prepare(
        `SELECT s.*, sc.title AS class_title FROM sessions s JOIN subject_classes sc ON sc.id = s.subject_class_id
         WHERE s.scheduled_start_at >= ? AND s.scheduled_start_at <= ? AND ${classFilter}${extra}
         ORDER BY s.scheduled_start_at`
      )
      .all(...params);
    return { from, to, items: rows.map((s) => ({ ...sessionDto(db, s), class_title: s.class_title })) };
  });

  // ---------- Tổng quan giảng dạy
  route('GET', '/dashboard', ({ db, user }) => {
    const now = nowVn();
    const today = vnDate();
    const cScope = courseScopeSql(user);
    const sScope = classScopeSql(user);
    const courses = db.prepare(`SELECT COUNT(*) n FROM courses c WHERE ${cScope.sql} AND c.status <> 'ARCHIVED'`).get(...cScope.params).n;
    const classIds = db.prepare(`SELECT sc.id FROM subject_classes sc WHERE ${sScope.sql} AND sc.status IN ('ACTIVE','UPCOMING')`).all(...sScope.params).map((r) => r.id);
    const inList = classIds.length ? classIds.map(() => '?').join(',') : "''";
    const students = classIds.length
      ? db.prepare(`SELECT COUNT(DISTINCT student_id) n FROM class_enrollments WHERE status = 'ACTIVE' AND subject_class_id IN (${inList})`).get(...classIds).n
      : 0;
    const sel = (where, extraParams, limit) =>
      classIds.length
        ? db
            .prepare(
              `SELECT s.*, sc.title AS class_title FROM sessions s JOIN subject_classes sc ON sc.id = s.subject_class_id
               WHERE s.subject_class_id IN (${inList}) AND s.session_status <> 'CANCELLED' AND ${where} LIMIT ${limit}`
            )
            .all(...classIds, ...extraParams)
            .map((s) => ({ ...sessionDto(db, s), class_title: s.class_title }))
        : [];
    const todaySessions = sel(`substr(s.scheduled_start_at, 1, 10) = ? ORDER BY s.scheduled_start_at`, [today], 20);
    const upcoming = sel(`s.scheduled_start_at > ? ORDER BY s.scheduled_start_at`, [`${today}T23:59:59+07:00`], 8);
    const needAttendance = sel(`s.scheduled_start_at <= ? AND s.attendance_saved_at IS NULL AND s.scheduled_start_at >= ? ORDER BY s.scheduled_start_at DESC`, [now, vnIso(new Date(Date.now() - 30 * 86400000))], 10);
    const logsUnconfirmed = sel(`s.scheduled_end_at < ? AND s.confirmation_status IN ('AWAITING_CONFIRMATION','OVERDUE_UNCONFIRMED') ORDER BY s.scheduled_start_at DESC`, [now], 10);

    // Cảnh báo chuyên cần thấp
    const policy = getAttendancePolicy(db);
    const lowAttendance = [];
    if (classIds.length) {
      const rows = db
        .prepare(
          `SELECT ar.subject_class_id, ar.student_id, ar.attendance_status st, COUNT(*) n, u.full_name, u.code, sc.code AS class_code
           FROM attendance_records ar JOIN sessions s ON s.session_id = ar.class_session_id
           JOIN users u ON u.id = ar.student_id JOIN subject_classes sc ON sc.id = ar.subject_class_id
           JOIN class_enrollments e ON e.subject_class_id = ar.subject_class_id AND e.student_id = ar.student_id AND e.status = 'ACTIVE'
           WHERE ar.subject_class_id IN (${inList}) AND s.session_status <> 'CANCELLED'
           GROUP BY ar.subject_class_id, ar.student_id, ar.attendance_status`
        )
        .all(...classIds);
      const map = {};
      for (const r of rows) {
        const k = `${r.subject_class_id}|${r.student_id}`;
        map[k] ||= { class_id: r.subject_class_id, class_code: r.class_code, student_id: r.student_id, full_name: r.full_name, code: r.code, counts: {} };
        map[k].counts[r.st] = r.n;
      }
      for (const v of Object.values(map)) {
        const rate = rateFromCounts(v.counts, policy);
        if (rate !== null && rate < policy.warning_threshold_pct) lowAttendance.push({ ...v, rate });
      }
      lowAttendance.sort((a, b) => a.rate - b.rate);
    }
    return {
      counts: { courses, classes: classIds.length, students, sessions_today: todaySessions.length },
      today_sessions: todaySessions,
      upcoming_sessions: upcoming,
      sessions_need_attendance: needAttendance,
      logs_unconfirmed: logsUnconfirmed,
      low_attendance: lowAttendance.slice(0, 10),
      assignments_to_grade: null, // Module bài tập chưa chạy ở môi trường hiện tại
      attendance_policy: policy,
    };
  });
}

export { sessionDto, staffAssignments };
