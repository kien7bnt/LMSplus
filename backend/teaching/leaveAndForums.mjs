/**
 * Nghiệp vụ Xin nghỉ phép & đồng bộ điểm danh an toàn + Diễn đàn Môn học / Lớp + Thông báo + Tổng quan Học viên (10 mục):
 * - Học viên gửi/hủy đơn xin nghỉ phép gắn buổi học & minh chứng
 * - Giảng viên / Giáo vụ duyệt/từ chối đơn có log lịch sử; duyệt sẽ ghi EXCUSED_ABSENCE nhưng KHÔNG ghi đè PRESENT/LATE
 * - Diễn đàn cấp Môn học (COURSE) & Riêng tư theo Lớp (CLASS, cấm rò rỉ dữ liệu giữa các lớp)
 * - Kiểm duyệt bài đăng (pin, lock, hide, endorse), báo cáo vi phạm & hữu ích
 * - Thông báo người dùng & Dashboard học viên 10 hạng mục từ dữ liệu thật
 */

import crypto from 'node:crypto';
import { fail, nowIso, nowVn, text, oneOf, tx } from './http.mjs';
import { isAdmin, isStaff, isStudent, classRole, classCapabilities, classScopeSql, canManageCourse, canViewCourse, safeJson } from './scope.mjs';
import { getClass, requireClassAccess } from './classes.mjs';
import { getClassContentVersionKey } from './masterSchema.mjs';
import { getAttendancePolicy, rateFromCounts } from './attendance.mjs';

function pushNotification(db, userId, type, title, bodyText, linkUrl) {
  db.prepare(
    `INSERT INTO teaching_notifications (id, user_id, notification_type, title, body, link_url, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(crypto.randomUUID(), userId, type, title, bodyText || '', linkUrl || '', nowIso());
}

function getOrCreateForum(db, scopeType, courseId, classId) {
  if (scopeType === 'CLASS') {
    const existing = db
      .prepare("SELECT * FROM teaching_forums WHERE scope_type = 'CLASS' AND subject_class_id = ?")
      .get(classId);
    if (existing) return existing;
    const cls = db.prepare('SELECT id, code, title, course_id FROM subject_classes WHERE id = ?').get(classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');
    const id = `frm_cls_${crypto.randomBytes(4).toString('hex')}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO teaching_forums (id, scope_type, course_id, subject_class_id, title, description, status, created_at, updated_at)
       VALUES (?, 'CLASS', ?, ?, ?, ?, 'ACTIVE', ?, ?)`
    ).run(
      id,
      cls.course_id || null,
      cls.id,
      `Diễn đàn lớp ${cls.code} — ${cls.title}`,
      'Không gian trao đổi nội bộ chỉ dành cho giảng viên và học viên của lớp môn học này.',
      now,
      now
    );
    return db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(id);
  }

  const existing = db
    .prepare("SELECT * FROM teaching_forums WHERE scope_type = 'COURSE' AND course_id = ?")
    .get(courseId);
  if (existing) return existing;
  const crs = db.prepare('SELECT id, code, title FROM courses WHERE id = ?').get(courseId);
  if (!crs) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy môn học.');
  const id = `frm_crs_${crypto.randomBytes(4).toString('hex')}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO teaching_forums (id, scope_type, course_id, subject_class_id, title, description, status, created_at, updated_at)
     VALUES (?, 'COURSE', ?, NULL, ?, ?, 'ACTIVE', ?, ?)`
  ).run(
    id,
    crs.id,
    `Diễn đàn môn học: ${crs.title}`,
    'Trao đổi học thuật chung giữa các học viên và giảng viên cùng môn học.',
    now,
    now
  );
  return db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(id);
}

function assertCourseForumAccess(db, user, courseId) {
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy môn học.');
  if (canViewCourse(db, user, course) || isAdmin(user) || (isStaff(user) && user.department_id === course.department_id)) {
    return { course, can_moderate: canManageCourse(db, user, course) };
  }
  const studentEnrolledInCourse = db
    .prepare(
      `SELECT 1 FROM class_enrollments e
       JOIN subject_classes sc ON sc.id = e.subject_class_id
       WHERE e.student_id = ? AND e.status = 'ACTIVE' AND sc.course_id = ? LIMIT 1`
    )
    .get(user.id, courseId);
  if (studentEnrolledInCourse) {
    return { course, can_moderate: false };
  }
  fail(403, 'FORUM_ACCESS_DENIED', 'Bạn chưa ghi danh hoặc không có quyền truy cập diễn đàn môn học này.');
}

function assertClassForumAccess(db, user, classId) {
  const cls = getClass(db, classId);
  if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');
  const role = classRole(db, user, cls);
  if (!role) {
    fail(403, 'FORUM_ACCESS_DENIED', 'Diễn đàn lớp là không gian riêng tư. Bạn không thuộc lớp môn học này.');
  }
  const caps = classCapabilities(db, user, cls);
  return { cls, role, can_moderate: caps.can_manage_class };
}

function assertForumAccessByForum(db, user, forum) {
  if (!forum) fail(404, 'FORUM_NOT_FOUND', 'Không tìm thấy diễn đàn.');
  if (forum.scope_type === 'CLASS') {
    return assertClassForumAccess(db, user, forum.subject_class_id);
  }
  return assertCourseForumAccess(db, user, forum.course_id);
}

function hydrateForumThreads(db, forum, user, { canModerate, category, search, lessonId }) {
  const clauses = ['t.forum_id = ?'];
  const params = [forum.id];
  if (!canModerate) clauses.push('t.is_hidden = 0');
  if (category) {
    clauses.push('t.category = ?');
    params.push(category);
  }
  if (lessonId) {
    clauses.push('t.lesson_id = ?');
    params.push(lessonId);
  }
  if (search) {
    clauses.push('(LOWER(t.title) LIKE ? OR LOWER(t.body) LIKE ?)');
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q);
  }

  const rows = db
    .prepare(
      `SELECT t.*, l.title AS lesson_title
       FROM teaching_forum_threads t
       LEFT JOIN lessons l ON l.id = t.lesson_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.is_pinned DESC, t.last_activity_at DESC`
    )
    .all(...params);

  const helpfulIds = new Set(
    db
      .prepare("SELECT target_id FROM teaching_forum_helpful WHERE user_id = ? AND target_type = 'THREAD'")
      .all(user.id)
      .map((r) => r.target_id)
  );

  return rows.map((r) => ({
    ...r,
    is_pinned: Boolean(r.is_pinned),
    is_locked: Boolean(r.is_locked),
    is_hidden: Boolean(r.is_hidden),
    helpful_by_me: helpfulIds.has(r.id),
  }));
}

export function registerLeaveAndForumRoutes(route) {
  // =========================================================================
  // 1. ĐƠN XIN NGHỈ PHÉP & TỰ ĐỘNG ĐỒNG BỘ ĐIỂM DANH AN TOÀN
  // =========================================================================

  route('GET', '/learn/leave-requests', ({ db, user }) => {
    const rows = db
      .prepare(
        `SELECT lr.*, sc.code AS class_code, sc.title AS class_title,
                s.session_title, s.scheduled_start_at, s.scheduled_end_at
         FROM leave_requests lr
         JOIN subject_classes sc ON sc.id = lr.subject_class_id
         LEFT JOIN sessions s ON s.session_id = lr.class_session_id
         WHERE lr.student_id = ? OR lr.student_code = ?
         ORDER BY COALESCE(lr.created_at, s.scheduled_start_at) DESC, lr.id DESC`
      )
      .all(user.id, user.code || '');

    const logsStmt = db.prepare('SELECT * FROM leave_request_logs WHERE leave_request_id = ? ORDER BY created_at ASC');
    return {
      items: rows.map((r) => ({
        id: r.id,
        class_id: r.subject_class_id,
        class_code: r.class_code,
        class_title: r.class_title,
        session_id: r.class_session_id || null,
        session_title: r.session_title || null,
        scheduled_start_at: r.scheduled_start_at || null,
        scheduled_end_at: r.scheduled_end_at || null,
        student_id: r.student_id || user.id,
        student_code: r.student_code,
        student_name: r.student_name,
        reason_category: r.reason_category || 'OTHER',
        reason: r.reason,
        makeup_class_requested: r.makeup_class_requested || '',
        evidence_url: r.evidence_url || null,
        evidence_name: r.evidence_name || null,
        status: r.status,
        reviewed_by: r.reviewed_by || null,
        reviewed_by_name: r.reviewed_by_name || null,
        reviewed_at: r.reviewed_at || null,
        review_note: r.review_note || '',
        created_at: r.created_at || null,
        updated_at: r.updated_at || null,
        logs: logsStmt.all(r.id),
      })),
    };
  });

  route('POST', '/learn/leave-requests', ({ db, user, body }) => {
    const classId = text(body, 'class_id', { required: true, max: 80, label: 'lớp môn học' });
    const cls = getClass(db, classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');

    const enrolled = db
      .prepare("SELECT 1 FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'")
      .get(cls.id, user.id);
    if (!enrolled) {
      fail(403, 'NOT_ENROLLED', 'Bạn chưa ghi danh hoạt động trong lớp môn học này.');
    }

    const sessionId = text(body, 'session_id', { max: 80, label: 'buổi học' }) || null;
    if (sessionId) {
      const ses = db.prepare('SELECT session_id, subject_class_id FROM sessions WHERE session_id = ?').get(sessionId);
      if (!ses || ses.subject_class_id !== cls.id) {
        fail(400, 'INVALID_SESSION', 'Buổi học không thuộc lớp môn học đã chọn.');
      }
      const dup = db
        .prepare(
          `SELECT id FROM leave_requests
           WHERE subject_class_id = ? AND class_session_id = ?
             AND (student_id = ? OR student_code = ?)
             AND status IN ('PENDING','APPROVED')
           LIMIT 1`
        )
        .get(cls.id, sessionId, user.id, user.code || '');
      if (dup) {
        fail(409, 'LEAVE_REQUEST_DUPLICATE', 'Bạn đã có đơn xin nghỉ chờ duyệt hoặc đã duyệt cho buổi học này.');
      }
    }

    const reasonCategory = oneOf(body, 'reason_category', ['SICK', 'FAMILY', 'OFFICIAL_DUTY', 'OTHER'], { fallback: 'OTHER', label: 'nhóm lý do' });
    const reason = text(body, 'reason', { required: true, max: 2000, label: 'lý do xin nghỉ' });
    const makeup = text(body, 'makeup_class_requested', { max: 500, fallback: '', label: 'nguyện vọng học bù' }) || '';
    const evidenceUrl = text(body, 'evidence_url', { max: 500, label: 'liên kết minh chứng' }) || null;
    const evidenceName = text(body, 'evidence_name', { max: 200, label: 'tên tệp minh chứng' }) || null;

    const id = `lv_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `INSERT INTO leave_requests
           (id, subject_class_id, student_code, student_name, reason, makeup_class_requested, status,
            class_session_id, student_id, reason_category, evidence_url, evidence_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        cls.id,
        user.code || '',
        user.full_name || '',
        reason,
        makeup,
        sessionId,
        user.id,
        reasonCategory,
        evidenceUrl,
        evidenceName,
        now,
        now
      );

      db.prepare(
        `INSERT INTO leave_request_logs
           (id, leave_request_id, previous_status, new_status, action_note, actor_id, actor_name, created_at)
         VALUES (?, ?, NULL, 'PENDING', ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), id, 'Học viên gửi đơn xin nghỉ phép.', user.id, user.full_name, now);

      const teachers = db
        .prepare("SELECT user_id FROM teaching_staff_assignments WHERE subject_class_id = ? AND is_active = 1")
        .all(cls.id);
      for (const t of teachers) {
        pushNotification(
          db,
          t.user_id,
          'NEW_LEAVE_REQUEST',
          `Đơn xin nghỉ phép mới (${cls.code})`,
          `${user.full_name} gửi đơn xin nghỉ: ${reason.slice(0, 120)}`,
          '/leave-requests'
        );
      }
    });

    const created = db
      .prepare(
        `SELECT lr.*, sc.code AS class_code, sc.title AS class_title,
                s.session_title, s.scheduled_start_at, s.scheduled_end_at
         FROM leave_requests lr
         JOIN subject_classes sc ON sc.id = lr.subject_class_id
         LEFT JOIN sessions s ON s.session_id = lr.class_session_id
         WHERE lr.id = ?`
      )
      .get(id);

    return [
      201,
      {
        ...created,
        class_id: created.subject_class_id,
        session_id: created.class_session_id || null,
        logs: db.prepare('SELECT * FROM leave_request_logs WHERE leave_request_id = ?').all(id),
      },
    ];
  });

  route('POST', '/learn/leave-requests/:id/cancel', ({ db, user, params }) => {
    const req = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(params.id);
    if (!req) fail(404, 'LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn xin nghỉ.');
    const isOwner = req.student_id === user.id || (req.student_code && req.student_code === user.code);
    if (!isOwner) fail(403, 'LEAVE_FORBIDDEN', 'Bạn chỉ được hủy đơn xin nghỉ của chính mình.');
    if (req.status !== 'PENDING') fail(409, 'LEAVE_NOT_PENDING', 'Chỉ có thể hủy đơn đang ở trạng thái chờ duyệt.');

    const now = nowIso();
    tx(db, () => {
      db.prepare("UPDATE leave_requests SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(now, req.id);
      db.prepare(
        `INSERT INTO leave_request_logs
           (id, leave_request_id, previous_status, new_status, action_note, actor_id, actor_name, created_at)
         VALUES (?, ?, 'PENDING', 'CANCELLED', 'Học viên chủ động hủy đơn.', ?, ?, ?)`
      ).run(crypto.randomUUID(), req.id, user.id, user.full_name, now);
    });

    return {
      ...db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.id),
      class_id: req.subject_class_id,
      session_id: req.class_session_id || null,
      logs: db.prepare('SELECT * FROM leave_request_logs WHERE leave_request_id = ? ORDER BY created_at ASC').all(req.id),
    };
  });

  route('GET', '/leave-requests', ({ db, user, query }) => {
    if (isStudent(user) && !isAdmin(user) && !isStaff(user)) {
      fail(403, 'LEAVE_STAFF_ONLY', 'Chỉ giảng viên, giáo vụ hoặc quản trị viên mới được xem danh sách xét duyệt.');
    }
    const scope = classScopeSql(user);
    const clauses = [scope.sql];
    const params = [...scope.params];

    const classId = query.get('class_id');
    const status = query.get('status');
    if (classId) {
      clauses.push('lr.subject_class_id = ?');
      params.push(classId);
    }
    if (status) {
      clauses.push('lr.status = ?');
      params.push(status);
    }

    const rows = db
      .prepare(
        `SELECT lr.*, sc.code AS class_code, sc.title AS class_title, sc.department_id,
                s.session_title, s.scheduled_start_at, s.scheduled_end_at
         FROM leave_requests lr
         JOIN subject_classes sc ON sc.id = lr.subject_class_id
         LEFT JOIN sessions s ON s.session_id = lr.class_session_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY CASE lr.status WHEN 'PENDING' THEN 0 ELSE 1 END,
                  COALESCE(lr.created_at, s.scheduled_start_at) DESC,
                  lr.id DESC`
      )
      .all(...params);

    const logsStmt = db.prepare('SELECT * FROM leave_request_logs WHERE leave_request_id = ? ORDER BY created_at ASC');
    return {
      items: rows.map((r) => ({
        id: r.id,
        class_id: r.subject_class_id,
        class_code: r.class_code,
        class_title: r.class_title,
        session_id: r.class_session_id || null,
        session_title: r.session_title || null,
        scheduled_start_at: r.scheduled_start_at || null,
        scheduled_end_at: r.scheduled_end_at || null,
        student_id: r.student_id || null,
        student_code: r.student_code,
        student_name: r.student_name,
        reason_category: r.reason_category || 'OTHER',
        reason: r.reason,
        makeup_class_requested: r.makeup_class_requested || '',
        evidence_url: r.evidence_url || null,
        evidence_name: r.evidence_name || null,
        status: r.status,
        reviewed_by: r.reviewed_by || null,
        reviewed_by_name: r.reviewed_by_name || null,
        reviewed_at: r.reviewed_at || null,
        review_note: r.review_note || '',
        created_at: r.created_at || null,
        updated_at: r.updated_at || null,
        logs: logsStmt.all(r.id),
      })),
    };
  });

  route('POST', '/leave-requests/:id/review', ({ db, user, body, params }) => {
    const req = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(params.id);
    if (!req) fail(404, 'LEAVE_REQUEST_NOT_FOUND', 'Không tìm thấy đơn xin nghỉ.');

    const { caps } = requireClassAccess(db, user, req.subject_class_id);
    if (!caps.can_manage_class && !caps.can_take_attendance) {
      fail(403, 'LEAVE_REVIEW_FORBIDDEN', 'Bạn không có quyền duyệt đơn xin nghỉ của lớp môn học này.');
    }
    if (req.status !== 'PENDING') {
      fail(409, 'LEAVE_ALREADY_REVIEWED', 'Đơn xin nghỉ này đã được xử lý trước đó.');
    }

    const decision = oneOf(body, 'decision', ['APPROVED', 'REJECTED'], { required: true, label: 'quyết định duyệt' });
    const reviewNote = text(body, 'review_note', { max: 1000, label: 'ghi chú phản hồi' });
    if (decision === 'REJECTED' && !reviewNote) {
      fail(400, 'REVIEW_NOTE_REQUIRED', 'Vui lòng nhập lý do khi từ chối đơn xin nghỉ.');
    }

    const now = nowIso();
    let attendanceSyncResult = 'NO_SESSION';
    let resolvedStudentId = req.student_id || null;
    if (!resolvedStudentId && req.student_code) {
      const u = db.prepare('SELECT id FROM users WHERE code = ?').get(req.student_code);
      resolvedStudentId = u?.id || null;
    }

    tx(db, () => {
      db.prepare(
        `UPDATE leave_requests
         SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_note = ?, updated_at = ?
         WHERE id = ?`
      ).run(decision, user.id, user.full_name, now, reviewNote, now, req.id);

      db.prepare(
        `INSERT INTO leave_request_logs
           (id, leave_request_id, previous_status, new_status, action_note, actor_id, actor_name, created_at)
         VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), req.id, decision, reviewNote || (decision === 'APPROVED' ? 'Đã phê duyệt đơn.' : 'Đã từ chối đơn.'), user.id, user.full_name, now);

      if (decision === 'APPROVED' && req.class_session_id && resolvedStudentId) {
        const ses = db.prepare('SELECT session_id FROM sessions WHERE session_id = ? AND subject_class_id = ?').get(req.class_session_id, req.subject_class_id);
        if (ses) {
          const existingAtt = db
            .prepare('SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ?')
            .get(req.class_session_id, resolvedStudentId);

          const autoNote = `Nghỉ có phép (Đơn #${req.id}${reviewNote ? `: ${reviewNote}` : ''})`;

          if (!existingAtt) {
            const attId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO attendance_records
                 (id, subject_class_id, class_session_id, student_id, attendance_status,
                  check_in_method, note, recorded_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'EXCUSED_ABSENCE', 'MANUAL', ?, ?, ?, ?, ?)`
            ).run(attId, req.subject_class_id, req.class_session_id, resolvedStudentId, autoNote, user.id, user.id, now, now);

            db.prepare(
              `INSERT INTO attendance_audit_logs
                 (id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at)
               VALUES (?, ?, NULL, 'EXCUSED_ABSENCE', NULL, ?, ?, ?, ?)`
            ).run(crypto.randomUUID(), attId, autoNote, `Đồng bộ tự động khi duyệt đơn xin nghỉ #${req.id}`, user.id, now);
            attendanceSyncResult = 'CREATED_EXCUSED';
          } else if (existingAtt.attendance_status === 'PRESENT' || existingAtt.attendance_status === 'LATE') {
            // Bảo toàn dữ liệu thực tế: không ghi đè trạng thái đã có mặt / đi muộn
            attendanceSyncResult = 'SKIPPED_ALREADY_PRESENT';
          } else if (existingAtt.attendance_status !== 'EXCUSED_ABSENCE') {
            const prevStatus = existingAtt.attendance_status;
            const prevNote = existingAtt.note;
            db.prepare(
              `UPDATE attendance_records
               SET attendance_status = 'EXCUSED_ABSENCE', note = ?, updated_by = ?, updated_at = ?
               WHERE id = ?`
            ).run(autoNote, user.id, now, existingAtt.id);

            db.prepare(
              `INSERT INTO attendance_audit_logs
                 (id, attendance_record_id, previous_status, new_status, previous_note, new_note, change_reason, changed_by, changed_at)
               VALUES (?, ?, ?, 'EXCUSED_ABSENCE', ?, ?, ?, ?, ?)`
            ).run(crypto.randomUUID(), existingAtt.id, prevStatus, prevNote, autoNote, `Cập nhật từ duyệt đơn xin nghỉ #${req.id}`, user.id, now);
            attendanceSyncResult = 'UPDATED_TO_EXCUSED';
          } else {
            attendanceSyncResult = 'ALREADY_EXCUSED';
          }
        }
      }

      if (resolvedStudentId) {
        pushNotification(
          db,
          resolvedStudentId,
          decision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
          decision === 'APPROVED' ? 'Đơn xin nghỉ phép đã được duyệt' : 'Đơn xin nghỉ phép bị từ chối',
          reviewNote || (decision === 'APPROVED' ? 'Trạng thái chuyên cần sẽ được ghi nhận có phép.' : 'Vui lòng liên hệ giảng viên để biết thêm chi tiết.'),
          '/learn/leave-requests'
        );
      }
    });

    const updated = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.id);
    return {
      ...updated,
      class_id: updated.subject_class_id,
      session_id: updated.class_session_id || null,
      attendance_sync_result: attendanceSyncResult,
      logs: db.prepare('SELECT * FROM leave_request_logs WHERE leave_request_id = ? ORDER BY created_at ASC').all(req.id),
    };
  });

  // =========================================================================
  // 2. DIỄN ĐÀN MÔN HỌC (COURSE) & DIỄN ĐÀN RIÊNG TƯ LỚP MÔN HỌC (CLASS)
  // =========================================================================

  route('GET', '/courses/:id/forum', ({ db, user, params, query }) => {
    const access = assertCourseForumAccess(db, user, params.id);
    const forum = getOrCreateForum(db, 'COURSE', params.id, null);
    const threads = hydrateForumThreads(db, forum, user, {
      canModerate: access.can_moderate,
      category: query.get('category'),
      search: query.get('search'),
      lessonId: query.get('lesson_id'),
    });
    return { forum, threads, can_moderate: access.can_moderate, can_post: true };
  });

  route('GET', '/classes/:id/forum', ({ db, user, params, query }) => {
    const access = assertClassForumAccess(db, user, params.id);
    const forum = getOrCreateForum(db, 'CLASS', access.cls.course_id, params.id);
    const threads = hydrateForumThreads(db, forum, user, {
      canModerate: access.can_moderate,
      category: query.get('category'),
      search: query.get('search'),
      lessonId: query.get('lesson_id'),
    });
    return { forum, threads, can_moderate: access.can_moderate, can_post: true };
  });

  route('GET', '/learn/classes/:id/forums', ({ db, user, params, query }) => {
    const access = assertClassForumAccess(db, user, params.id);
    const classForum = getOrCreateForum(db, 'CLASS', access.cls.course_id, params.id);
    const courseForum = access.cls.course_id ? getOrCreateForum(db, 'COURSE', access.cls.course_id, null) : null;
    return {
      class_forum: {
        forum: classForum,
        threads: hydrateForumThreads(db, classForum, user, {
          canModerate: access.can_moderate,
          category: query.get('category'),
          search: query.get('search'),
          lessonId: query.get('lesson_id'),
        }),
        can_moderate: access.can_moderate,
      },
      course_forum: courseForum
        ? {
            forum: courseForum,
            threads: hydrateForumThreads(db, courseForum, user, {
              canModerate: false,
              category: query.get('category'),
              search: query.get('search'),
              lessonId: query.get('lesson_id'),
            }),
            can_moderate: false,
          }
        : null,
    };
  });

  route('POST', '/forums/:forumId/threads', ({ db, user, body, params }) => {
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(params.forumId);
    const access = assertForumAccessByForum(db, user, forum);

    const category = oneOf(body, 'category', ['QA', 'DISCUSSION', 'ANNOUNCEMENT', 'EXPERIENCE'], { fallback: 'QA', label: 'chủ đề' });
    if (category === 'ANNOUNCEMENT' && !access.can_moderate) {
      fail(403, 'ANNOUNCEMENT_MODERATOR_ONLY', 'Chỉ giảng viên hoặc người kiểm duyệt mới được đăng thông báo chính thức.');
    }

    const title = text(body, 'title', { required: true, max: 200, label: 'tiêu đề bài viết' });
    const bodyText = text(body, 'body', { required: true, max: 10000, label: 'nội dung bài viết' });
    const lessonId = text(body, 'lesson_id', { max: 80, label: 'bài học liên quan' }) || null;
    const isPinned = body?.is_pinned && access.can_moderate ? 1 : 0;

    const id = `th_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    const roles = safeJson(user.roles_json, []);
    const authorRole = access.can_moderate ? 'INSTRUCTOR' : roles[0] || 'STUDENT';

    db.prepare(
      `INSERT INTO teaching_forum_threads
         (id, forum_id, lesson_id, author_id, author_name, author_role, category,
          title, body, is_pinned, is_locked, is_hidden, helpful_count, reply_count,
          last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)`
    ).run(id, forum.id, lessonId, user.id, user.full_name, authorRole, category, title, bodyText, isPinned, now, now, now);

    const created = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(id);
    return [
      201,
      {
        ...created,
        is_pinned: Boolean(created.is_pinned),
        is_locked: Boolean(created.is_locked),
        is_hidden: Boolean(created.is_hidden),
        helpful_by_me: false,
      },
    ];
  });

  route('GET', '/forum-threads/:threadId', ({ db, user, params }) => {
    const thread = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(params.threadId);
    if (!thread) fail(404, 'THREAD_NOT_FOUND', 'Không tìm thấy bài viết trên diễn đàn.');
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(thread.forum_id);
    const access = assertForumAccessByForum(db, user, forum);
    if (thread.is_hidden && !access.can_moderate) {
      fail(404, 'THREAD_NOT_FOUND', 'Bài viết này đã bị ẩn.');
    }

    const replies = db
      .prepare(
        `SELECT * FROM teaching_forum_replies
         WHERE thread_id = ? ${access.can_moderate ? '' : 'AND is_hidden = 0'}
         ORDER BY is_endorsed DESC, created_at ASC`
      )
      .all(thread.id);

    const helpfulTargets = new Set(
      db
        .prepare("SELECT target_id FROM teaching_forum_helpful WHERE user_id = ?")
        .all(user.id)
        .map((r) => r.target_id)
    );

    return {
      forum,
      can_moderate: access.can_moderate,
      thread: {
        ...thread,
        is_pinned: Boolean(thread.is_pinned),
        is_locked: Boolean(thread.is_locked),
        is_hidden: Boolean(thread.is_hidden),
        helpful_by_me: helpfulTargets.has(thread.id),
      },
      replies: replies.map((r) => ({
        ...r,
        is_hidden: Boolean(r.is_hidden),
        is_endorsed: Boolean(r.is_endorsed),
        helpful_by_me: helpfulTargets.has(r.id),
      })),
    };
  });

  route('POST', '/forum-threads/:threadId/replies', ({ db, user, body, params }) => {
    const thread = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(params.threadId);
    if (!thread) fail(404, 'THREAD_NOT_FOUND', 'Không tìm thấy bài viết.');
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(thread.forum_id);
    const access = assertForumAccessByForum(db, user, forum);

    if (thread.is_locked && !access.can_moderate) {
      fail(409, 'THREAD_LOCKED', 'Chủ đề thảo luận này đã bị khóa bình luận.');
    }
    if (thread.is_hidden && !access.can_moderate) {
      fail(404, 'THREAD_NOT_FOUND', 'Bài viết không khả dụng.');
    }

    const bodyText = text(body, 'body', { required: true, max: 6000, label: 'nội dung trả lời' });
    const parentReplyId = text(body, 'parent_reply_id', { max: 80 }) || null;
    const id = `rep_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    const roles = safeJson(user.roles_json, []);
    const authorRole = access.can_moderate ? 'INSTRUCTOR' : roles[0] || 'STUDENT';

    tx(db, () => {
      db.prepare(
        `INSERT INTO teaching_forum_replies
           (id, thread_id, parent_reply_id, author_id, author_name, author_role, body,
            is_hidden, is_endorsed, helpful_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
      ).run(id, thread.id, parentReplyId, user.id, user.full_name, authorRole, bodyText, now, now);

      db.prepare(
        `UPDATE teaching_forum_threads
         SET reply_count = (SELECT COUNT(*) FROM teaching_forum_replies WHERE thread_id = ? AND is_hidden = 0),
             last_activity_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(thread.id, now, now, thread.id);

      if (thread.author_id && thread.author_id !== user.id) {
        pushNotification(
          db,
          thread.author_id,
          'FORUM_REPLY',
          `Phản hồi mới tại "${thread.title}"`,
          `${user.full_name} vừa trả lời chủ đề bạn đã đăng.`,
          forum.scope_type === 'CLASS' ? `/learn/classes/${forum.subject_class_id}` : `/courses/${forum.course_id}`
        );
      }
    });

    const created = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(id);
    return [201, { ...created, is_hidden: false, is_endorsed: false, helpful_by_me: false }];
  });

  route('POST', '/forum-threads/:threadId/moderate', ({ db, user, body, params }) => {
    const thread = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(params.threadId);
    if (!thread) fail(404, 'THREAD_NOT_FOUND', 'Không tìm thấy bài viết.');
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(thread.forum_id);
    const access = assertForumAccessByForum(db, user, forum);
    if (!access.can_moderate) {
      fail(403, 'FORUM_MODERATE_FORBIDDEN', 'Bạn không có quyền kiểm duyệt diễn đàn này.');
    }

    const action = oneOf(body, 'action', ['PIN', 'UNPIN', 'LOCK', 'UNLOCK', 'HIDE', 'UNHIDE'], { required: true, label: 'hành động kiểm duyệt' });
    const reason = text(body, 'reason', { max: 500, label: 'lý do kiểm duyệt' });
    const now = nowIso();

    const patch = {
      PIN: ['is_pinned', 1],
      UNPIN: ['is_pinned', 0],
      LOCK: ['is_locked', 1],
      UNLOCK: ['is_locked', 0],
      HIDE: ['is_hidden', 1],
      UNHIDE: ['is_hidden', 0],
    }[action];

    tx(db, () => {
      db.prepare(`UPDATE teaching_forum_threads SET ${patch[0]} = ?, updated_at = ? WHERE id = ?`).run(patch[1], now, thread.id);
      db.prepare(
        `INSERT INTO teaching_forum_mod_logs (id, forum_id, target_type, target_id, action, reason, actor_id, actor_name, created_at)
         VALUES (?, ?, 'THREAD', ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), forum.id, thread.id, action, reason, user.id, user.full_name, now);
    });

    const updated = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(thread.id);
    return {
      ...updated,
      is_pinned: Boolean(updated.is_pinned),
      is_locked: Boolean(updated.is_locked),
      is_hidden: Boolean(updated.is_hidden),
    };
  });

  route('POST', '/forum-replies/:replyId/moderate', ({ db, user, body, params }) => {
    const reply = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(params.replyId);
    if (!reply) fail(404, 'REPLY_NOT_FOUND', 'Không tìm thấy câu trả lời.');
    const thread = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(reply.thread_id);
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(thread.forum_id);
    const access = assertForumAccessByForum(db, user, forum);
    if (!access.can_moderate) {
      fail(403, 'FORUM_MODERATE_FORBIDDEN', 'Bạn không có quyền kiểm duyệt phản hồi.');
    }

    const action = oneOf(body, 'action', ['ENDORSE', 'UNENDORSE', 'HIDE', 'UNHIDE'], { required: true, label: 'hành động' });
    const reason = text(body, 'reason', { max: 500 });
    const now = nowIso();
    const patch = {
      ENDORSE: ['is_endorsed', 1],
      UNENDORSE: ['is_endorsed', 0],
      HIDE: ['is_hidden', 1],
      UNHIDE: ['is_hidden', 0],
    }[action];

    tx(db, () => {
      db.prepare(`UPDATE teaching_forum_replies SET ${patch[0]} = ?, updated_at = ? WHERE id = ?`).run(patch[1], now, reply.id);
      db.prepare(
        `UPDATE teaching_forum_threads
         SET reply_count = (SELECT COUNT(*) FROM teaching_forum_replies WHERE thread_id = ? AND is_hidden = 0),
             updated_at = ?
         WHERE id = ?`
      ).run(thread.id, now, thread.id);
      db.prepare(
        `INSERT INTO teaching_forum_mod_logs (id, forum_id, target_type, target_id, action, reason, actor_id, actor_name, created_at)
         VALUES (?, ?, 'REPLY', ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), forum.id, reply.id, action, reason, user.id, user.full_name, now);
    });

    const updated = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(reply.id);
    return { ...updated, is_hidden: Boolean(updated.is_hidden), is_endorsed: Boolean(updated.is_endorsed) };
  });

  route('POST', '/forum-helpful', ({ db, user, body }) => {
    const targetType = oneOf(body, 'target_type', ['THREAD', 'REPLY'], { required: true, label: 'loại nội dung' });
    const targetId = text(body, 'target_id', { required: true, max: 80, label: 'mã nội dung' });

    let forumId;
    if (targetType === 'THREAD') {
      const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(targetId);
      if (!th) fail(404, 'THREAD_NOT_FOUND', 'Không tìm thấy bài viết.');
      forumId = th.forum_id;
    } else {
      const rep = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(targetId);
      if (!rep) fail(404, 'REPLY_NOT_FOUND', 'Không tìm thấy phản hồi.');
      const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(rep.thread_id);
      forumId = th.forum_id;
    }
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(forumId);
    assertForumAccessByForum(db, user, forum);

    const existing = db
      .prepare('SELECT id FROM teaching_forum_helpful WHERE target_type = ? AND target_id = ? AND user_id = ?')
      .get(targetType, targetId, user.id);

    let active = false;
    let count = 0;
    tx(db, () => {
      if (existing) {
        db.prepare('DELETE FROM teaching_forum_helpful WHERE id = ?').run(existing.id);
        active = false;
      } else {
        db.prepare(
          'INSERT INTO teaching_forum_helpful (id, target_type, target_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(crypto.randomUUID(), targetType, targetId, user.id, nowIso());
        active = true;
      }
      count = db
        .prepare('SELECT COUNT(*) n FROM teaching_forum_helpful WHERE target_type = ? AND target_id = ?')
        .get(targetType, targetId).n;
      const tbl = targetType === 'THREAD' ? 'teaching_forum_threads' : 'teaching_forum_replies';
      db.prepare(`UPDATE ${tbl} SET helpful_count = ? WHERE id = ?`).run(count, targetId);
    });

    return { target_type: targetType, target_id: targetId, helpful_by_me: active, helpful_count: count };
  });

  route('POST', '/forum-reports', ({ db, user, body }) => {
    const targetType = oneOf(body, 'target_type', ['THREAD', 'REPLY'], { required: true });
    const targetId = text(body, 'target_id', { required: true, max: 80 });
    const reason = text(body, 'reason', { required: true, max: 1000, label: 'lý do báo cáo' });

    let forumId;
    if (targetType === 'THREAD') {
      const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(targetId);
      if (!th) fail(404, 'THREAD_NOT_FOUND', 'Không tìm thấy bài viết.');
      forumId = th.forum_id;
    } else {
      const rep = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(targetId);
      if (!rep) fail(404, 'REPLY_NOT_FOUND', 'Không tìm thấy phản hồi.');
      const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(rep.thread_id);
      forumId = th.forum_id;
    }
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(forumId);
    assertForumAccessByForum(db, user, forum);

    const id = `repv_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO teaching_forum_reports
         (id, target_type, target_id, reporter_id, reporter_name, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(id, targetType, targetId, user.id, user.full_name, reason, now);

    return [201, db.prepare('SELECT * FROM teaching_forum_reports WHERE id = ?').get(id)];
  });

  route('GET', '/forums/:forumId/reports', ({ db, user, params }) => {
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(params.forumId);
    const access = assertForumAccessByForum(db, user, forum);
    if (!access.can_moderate) {
      fail(403, 'FORUM_MODERATE_FORBIDDEN', 'Chỉ người kiểm duyệt mới xem được báo cáo vi phạm.');
    }

    const threadIds = db.prepare('SELECT id FROM teaching_forum_threads WHERE forum_id = ?').all(forum.id).map((r) => r.id);
    const replyIds = threadIds.length > 0
      ? db
          .prepare(`SELECT id FROM teaching_forum_replies WHERE thread_id IN (${threadIds.map(() => '?').join(',')})`)
          .all(...threadIds)
          .map((r) => r.id)
      : [];
    const targetIds = [...threadIds, ...replyIds];
    if (targetIds.length === 0) return { items: [] };

    const items = db
      .prepare(
        `SELECT * FROM teaching_forum_reports
         WHERE target_id IN (${targetIds.map(() => '?').join(',')})
         ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at DESC`
      )
      .all(...targetIds);

    return { items };
  });

  route('POST', '/forum-reports/:reportId/resolve', ({ db, user, body, params }) => {
    const report = db.prepare('SELECT * FROM teaching_forum_reports WHERE id = ?').get(params.reportId);
    if (!report) fail(404, 'REPORT_NOT_FOUND', 'Không tìm thấy báo cáo vi phạm.');

    let forumId;
    if (report.target_type === 'THREAD') {
      const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(report.target_id);
      if (th) forumId = th.forum_id;
    } else {
      const rep = db.prepare('SELECT * FROM teaching_forum_replies WHERE id = ?').get(report.target_id);
      if (rep) {
        const th = db.prepare('SELECT * FROM teaching_forum_threads WHERE id = ?').get(rep.thread_id);
        forumId = th?.forum_id;
      }
    }
    const forum = db.prepare('SELECT * FROM teaching_forums WHERE id = ?').get(forumId);
    const access = assertForumAccessByForum(db, user, forum);
    if (!access.can_moderate) {
      fail(403, 'FORUM_MODERATE_FORBIDDEN', 'Bạn không có quyền xử lý báo cáo vi phạm.');
    }

    const status = oneOf(body, 'status', ['RESOLVED', 'DISMISSED'], { fallback: 'RESOLVED', label: 'trạng thái xử lý' });
    const note = text(body, 'resolution_note', { max: 500, label: 'ghi chú xử lý' });
    const hideTarget = Boolean(body?.hide_target);
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `UPDATE teaching_forum_reports
         SET status = ?, resolved_by = ?, resolution_note = ?, resolved_at = ?
         WHERE id = ?`
      ).run(status, user.id, note, now, report.id);

      if (hideTarget && status === 'RESOLVED') {
        const tbl = report.target_type === 'THREAD' ? 'teaching_forum_threads' : 'teaching_forum_replies';
        db.prepare(`UPDATE ${tbl} SET is_hidden = 1, updated_at = ? WHERE id = ?`).run(now, report.target_id);
        db.prepare(
          `INSERT INTO teaching_forum_mod_logs (id, forum_id, target_type, target_id, action, reason, actor_id, actor_name, created_at)
           VALUES (?, ?, ?, ?, 'HIDE', ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), forum.id, report.target_type, report.target_id, note || report.reason, user.id, user.full_name, now);
      }
    });

    return db.prepare('SELECT * FROM teaching_forum_reports WHERE id = ?').get(report.id);
  });

  // =========================================================================
  // 3. THÔNG BÁO (NOTIFICATIONS)
  // =========================================================================

  route('GET', '/notifications', ({ db, user }) => {
    const items = db
      .prepare('SELECT * FROM teaching_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(user.id)
      .map((n) => ({ ...n, is_read: Boolean(n.is_read) }));
    const unreadCount = db
      .prepare('SELECT COUNT(*) n FROM teaching_notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id).n;
    return { unread_count: unreadCount, items };
  });

  route('POST', '/notifications/:id/read', ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM teaching_notifications WHERE id = ? AND user_id = ?').get(params.id, user.id);
    if (!row) fail(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.');
    db.prepare('UPDATE teaching_notifications SET is_read = 1 WHERE id = ?').run(row.id);
    return { id: row.id, is_read: true };
  });

  route('POST', '/notifications/read-all', ({ db, user }) => {
    const info = db.prepare('UPDATE teaching_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(user.id);
    return { marked_read: info.changes || 0 };
  });

  // =========================================================================
  // 4. TỔNG QUAN HỌC VIÊN 10 HẠNG MỤC (/learn/overview)
  // =========================================================================

  route('GET', '/learn/overview', ({ db, user }) => {
    const enrolledClasses = db
      .prepare(
        `SELECT sc.*, c.title AS course_title, e.enrollment_source
         FROM class_enrollments e
         JOIN subject_classes sc ON sc.id = e.subject_class_id
         LEFT JOIN courses c ON c.id = sc.course_id
         WHERE e.student_id = ? AND e.status = 'ACTIVE'
         ORDER BY sc.code`
      )
      .all(user.id);

    const nowVnStr = nowVn();
    const classIds = enrolledClasses.map((c) => c.id);

    // 1 & 2 & 9: Tiến độ bài học & bài học tiếp theo (hỗ trợ snapshot version)
    let totalLessons = 0;
    let completedLessons = 0;
    let continueLearning = null;

    for (const cls of enrolledClasses) {
      const verKey = getClassContentVersionKey(cls);
      let lessonsList = [];
      if (cls.course_version_id) {
        const verRow = db.prepare('SELECT snapshot_json FROM course_versions WHERE id = ?').get(cls.course_version_id);
        const snap = safeJson(verRow?.snapshot_json, null);
        if (snap && Array.isArray(snap.lessons)) {
          lessonsList = snap.lessons.map((l) => ({ id: l.id, title: l.title }));
        }
      }
      if (lessonsList.length === 0 && cls.course_id) {
        lessonsList = db
          .prepare(
            `SELECT l.id, l.title FROM lessons l
             JOIN chapters ch ON ch.id = l.chapter_id
             WHERE ch.course_id = ? AND ch.status = 'PUBLISHED' AND l.publish_status = 'PUBLISHED'
             ORDER BY ch.sort_order, l.sort_order`
          )
          .all(cls.course_id);
      }

      const progRows = db
        .prepare(
          `SELECT lesson_id, status, last_accessed_at
           FROM lesson_progress
           WHERE student_id = ? AND subject_class_id = ? AND content_version_key = ?`
        )
        .all(user.id, cls.id, verKey);
      const progMap = new Map(progRows.map((p) => [p.lesson_id, p]));

      totalLessons += lessonsList.length;
      for (const l of lessonsList) {
        const p = progMap.get(l.id);
        if (p?.status === 'COMPLETED') {
          completedLessons++;
        } else if (!continueLearning) {
          continueLearning = {
            class_id: cls.id,
            class_title: cls.title,
            lesson_id: l.id,
            lesson_title: l.title,
            status: p?.status || 'NOT_STARTED',
            last_accessed_at: p?.last_accessed_at || null,
          };
        }
      }
    }

    const overallProgressPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    if (classIds.length === 0) {
      const unreadCount = db.prepare('SELECT COUNT(*) n FROM teaching_notifications WHERE user_id = ? AND is_read = 0').get(user.id).n;
      const notifications = db.prepare('SELECT * FROM teaching_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').all(user.id);
      return {
        total_classes: 0,
        total_lessons: 0,
        completed_lessons: 0,
        overall_progress_pct: 0,
        upcoming_sessions: [],
        pending_assignments: [],
        pending_exams: [],
        attendance_summary: { rate: 100, present: 0, late: 0, excused: 0, absent: 0, total_sessions: 0 },
        pending_leave_requests: 0,
        recent_grades: [],
        continue_learning: null,
        recent_forum_activity: [],
        notifications: { unread_count: unreadCount, items: notifications },
      };
    }

    const ph = classIds.map(() => '?').join(',');

    // 3: Buổi học sắp tới
    const upcomingSessions = db
      .prepare(
        `SELECT s.session_id, s.subject_class_id AS class_id, s.session_title,
                s.scheduled_start_at, s.scheduled_end_at, s.delivery_mode, s.room_or_link,
                sc.code AS class_code, sc.title AS class_title
         FROM sessions s
         JOIN subject_classes sc ON sc.id = s.subject_class_id
         WHERE s.subject_class_id IN (${ph})
           AND s.session_status <> 'CANCELLED'
           AND s.scheduled_end_at >= ?
         ORDER BY s.scheduled_start_at ASC LIMIT 5`
      )
      .all(...classIds, nowVnStr);

    // 4: Bài tập cần nộp
    const assignments = db
      .prepare(
        `SELECT ca.id, ca.subject_class_id AS class_id, ca.title, ca.due_at, ca.max_score,
                sc.code AS class_code, sc.title AS class_title
         FROM class_assignments ca
         JOIN subject_classes sc ON sc.id = ca.subject_class_id
         WHERE ca.subject_class_id IN (${ph}) AND ca.status = 'PUBLISHED'
         ORDER BY COALESCE(ca.due_at, '9999') ASC LIMIT 20`
      )
      .all(...classIds);
    const pendingAssignments = assignments.filter((a) => {
      const sub = db
        .prepare("SELECT status FROM class_assignment_submissions WHERE class_assignment_id = ? AND student_id = ? AND status <> 'DRAFT' LIMIT 1")
        .get(a.id, user.id);
      return !sub;
    });

    // 5: Bài kiểm tra chưa hoàn thành
    const exams = db
      .prepare(
        `SELECT ce.id, ce.subject_class_id AS class_id, ce.title, ce.time_limit_minutes, ce.max_attempts, ce.close_at,
                sc.code AS class_code, sc.title AS class_title
         FROM class_exams ce
         JOIN subject_classes sc ON sc.id = ce.subject_class_id
         WHERE ce.subject_class_id IN (${ph}) AND ce.status = 'PUBLISHED'
         ORDER BY COALESCE(ce.close_at, '9999') ASC LIMIT 20`
      )
      .all(...classIds);
    const pendingExams = exams.filter((ex) => {
      const done = db
        .prepare('SELECT COUNT(*) n FROM class_exam_attempts WHERE exam_id = ? AND student_id = ? AND submitted_at IS NOT NULL')
        .get(ex.id, user.id).n;
      return done === 0;
    });

    // 6: Chuyên cần cá nhân
    const pastSessionsCount = db
      .prepare(
        `SELECT COUNT(*) n FROM sessions
         WHERE subject_class_id IN (${ph}) AND session_status <> 'CANCELLED' AND scheduled_start_at <= ?`
      )
      .get(...classIds, nowVnStr).n;
    const attRecords = db
      .prepare(
        `SELECT attendance_status FROM attendance_records
         WHERE subject_class_id IN (${ph}) AND student_id = ?`
      )
      .all(...classIds, user.id);
    const attCounts = { PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0, NOT_MARKED: 0 };
    for (const r of attRecords) {
      if (attCounts[r.attendance_status] !== undefined) attCounts[r.attendance_status]++;
    }
    const recordedTotal = attCounts.PRESENT + attCounts.LATE + attCounts.EXCUSED_ABSENCE + attCounts.UNEXCUSED_ABSENCE;
    attCounts.NOT_MARKED = Math.max(0, pastSessionsCount - recordedTotal);

    // 7: Đơn xin nghỉ phép chờ duyệt
    const pendingLeaveCount = db
      .prepare("SELECT COUNT(*) n FROM leave_requests WHERE (student_id = ? OR student_code = ?) AND status = 'PENDING'")
      .get(user.id, user.code || '').n;

    // 8: Điểm số gần đây
    const recentGrades = db
      .prepare(
        `SELECT g.*, sc.code AS class_code, sc.title AS class_title
         FROM class_gradebook_entries g
         JOIN subject_classes sc ON sc.id = g.subject_class_id
         WHERE g.student_id = ? AND g.subject_class_id IN (${ph})
         ORDER BY g.updated_at DESC LIMIT 5`
      )
      .all(user.id, ...classIds);

    // 10: Thảo luận mới nhất & Thông báo
    const courseIds = Array.from(new Set(enrolledClasses.map((c) => c.course_id).filter(Boolean)));
    const forumRows = db
      .prepare(
        `SELECT id, scope_type, course_id, subject_class_id
         FROM teaching_forums
         WHERE (scope_type = 'CLASS' AND subject_class_id IN (${ph}))
            ${courseIds.length ? `OR (scope_type = 'COURSE' AND course_id IN (${courseIds.map(() => '?').join(',')}))` : ''}`
      )
      .all(...classIds, ...courseIds);
    const forumIds = forumRows.map((f) => f.id);
    const recentForumActivity = forumIds.length
      ? db
          .prepare(
            `SELECT t.id, t.forum_id, t.title, t.author_name, t.reply_count, t.last_activity_at, f.title AS forum_title
             FROM teaching_forum_threads t
             JOIN teaching_forums f ON f.id = t.forum_id
             WHERE t.forum_id IN (${forumIds.map(() => '?').join(',')}) AND t.is_hidden = 0
             ORDER BY t.last_activity_at DESC LIMIT 5`
          )
          .all(...forumIds)
      : [];

    const unreadCount = db
      .prepare('SELECT COUNT(*) n FROM teaching_notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id).n;
    const notifItems = db
      .prepare('SELECT * FROM teaching_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(user.id)
      .map((n) => ({ ...n, is_read: Boolean(n.is_read) }));

    return {
      total_classes: enrolledClasses.length,
      total_lessons: totalLessons,
      completed_lessons: completedLessons,
      overall_progress_pct: overallProgressPct,
      upcoming_sessions: upcomingSessions,
      pending_assignments: pendingAssignments.slice(0, 6),
      pending_assignments_count: pendingAssignments.length,
      pending_exams: pendingExams.slice(0, 6),
      pending_exams_count: pendingExams.length,
      attendance_summary: {
        rate: rateFromCounts(attCounts, getAttendancePolicy(db)),
        present: attCounts.PRESENT,
        late: attCounts.LATE,
        excused: attCounts.EXCUSED_ABSENCE,
        absent: attCounts.UNEXCUSED_ABSENCE,
        total_sessions: pastSessionsCount,
      },
      pending_leave_requests: pendingLeaveCount,
      recent_grades: recentGrades,
      continue_learning: continueLearning,
      recent_forum_activity: recentForumActivity,
      notifications: { unread_count: unreadCount, items: notifItems },
    };
  });
}
