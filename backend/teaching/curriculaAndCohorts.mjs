/**
 * LMSPLUS Master LMS — Tầng 1 (Khung chương trình) & Tầng 2 (Khóa học / Lớp khóa học) + Đồng bộ Học viên (LINKED).
 *
 * Nguyên tắc kiến trúc:
 *  - Tách biệt 3 tầng: Khung chương trình (curricula) -> Lớp khóa học (program_cohorts) -> Lớp môn học (subject_classes).
 *  - Tổng học viên trong Lớp khóa học đếm DISTINCT student_id, không cộng dồn từ nhiều lớp môn học.
 *  - Đồng bộ danh sách học viên theo nguồn COHORT_SYNCED, không ghi đè/xóa học viên học bù/học lại (MAKEUP, RETAKE, SUPPLEMENTAL).
 */

import crypto from 'node:crypto';
import {
  fail, pageParams, nowIso, text, intField, oneOf, dateField, tx, publicUser, compareVietnameseName,
  mapAsync,
} from './http.mjs';
import { isAdmin, isStaff, isInstructor, isStudent, safeJson } from './scope.mjs';
import { getAttendancePolicy, rateFromCounts } from './attendance.mjs';

const CURR_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;

function requireAdminOrStaff(user, deptId = null) {
  if (isAdmin(user)) return;
  if (isStaff(user)) {
    if (deptId && user.department_id && deptId !== user.department_id) {
      fail(403, 'OUT_OF_SCOPE', 'Bạn không có quyền thao tác ngoài đơn vị phụ trách.');
    }
    return;
  }
  fail(403, 'PROGRAM_MANAGE_FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới có quyền quản lý Khung chương trình và Lớp khóa học.');
}

function canViewPrograms(user) {
  return isAdmin(user) || isStaff(user) || isInstructor(user);
}

async function logCurriculumAudit(db, curriculumId, actionType, payload, user) {
  await db.prepare(
    `INSERT INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), curriculumId, actionType, JSON.stringify(payload || {}), user?.id || null, user?.full_name || 'Hệ thống', nowIso());
}

async function logCohortAudit(db, cohortId, actionType, targetStudentId, payload, user) {
  await db.prepare(
    `INSERT INTO cohort_audit_logs (id, cohort_id, action_type, target_student_id, payload_json, actor_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), cohortId, actionType, targetStudentId || null, JSON.stringify(payload || {}), user?.id || null, user?.full_name || 'Hệ thống', nowIso());
}

/**
 * Đồng bộ danh sách học viên từ Lớp khóa học xuống các Lớp môn học liên kết.
 * Bảo toàn học viên có enrollment_source IN ('MAKEUP','RETAKE','SUPPLEMENTAL','ACADEMIC_ASSIGNED').
 */
export async function syncCohortRosterToClasses(db, cohortId, actorUser = null, specificClassIds = null) {
  const activeCohortStudents = (await db
    .prepare(`SELECT student_id FROM cohort_enrollments WHERE cohort_id = ? AND status = 'ACTIVE'`)
    .all(cohortId))
    .map((r) => r.student_id);
  const inactiveCohortStudents = (await db
    .prepare(`SELECT student_id FROM cohort_enrollments WHERE cohort_id = ? AND status IN ('WITHDRAWN','TRANSFERRED')`)
    .all(cohortId))
    .map((r) => r.student_id);

  let classes = await db
    .prepare(`SELECT * FROM subject_classes WHERE cohort_id = ? AND status NOT IN ('ARCHIVED','CANCELLED')`)
    .all(cohortId);
  if (Array.isArray(specificClassIds) && specificClassIds.length > 0) {
    const allow = new Set(specificClassIds);
    classes = classes.filter((c) => allow.has(c.id));
  }

  const now = nowIso();
  let insertedCount = 0;
  let reactivatedCount = 0;
  let droppedCount = 0;

  for (const cls of classes) {
    for (const sid of activeCohortStudents) {
      const existing = await db
        .prepare('SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ?')
        .get(cls.id, sid);
      if (!existing) {
        await db.prepare(
          `INSERT INTO class_enrollments (id, subject_class_id, student_id, enrollment_source, status, enrolled_at, updated_by)
           VALUES (?, ?, ?, 'COHORT_SYNCED', 'ACTIVE', ?, ?)`
        ).run(crypto.randomUUID(), cls.id, sid, now, actorUser?.id || null);
        insertedCount++;
      } else if (existing.status === 'DROPPED' && existing.enrollment_source === 'COHORT_SYNCED') {
        await db.prepare(
          `UPDATE class_enrollments SET status = 'ACTIVE', dropped_at = NULL, updated_by = ? WHERE id = ?`
        ).run(actorUser?.id || null, existing.id);
        reactivatedCount++;
      }
    }

    for (const sid of inactiveCohortStudents) {
      const existing = await db
        .prepare(`SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE' AND enrollment_source = 'COHORT_SYNCED'`)
        .get(cls.id, sid);
      if (existing) {
        await db.prepare(
          `UPDATE class_enrollments SET status = 'DROPPED', dropped_at = ?, updated_by = ? WHERE id = ?`
        ).run(now, actorUser?.id || null, existing.id);
        droppedCount++;
      }
    }

    const activeCount = (await db
      .prepare(`SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'`)
      .get(cls.id)).n;
    await db.prepare('UPDATE subject_classes SET student_count = ?, updated_at = ? WHERE id = ?').run(activeCount, now, cls.id);
  }

  return { classes_synced: classes.length, added: insertedCount, reactivated: reactivatedCount, dropped: droppedCount };
}

async function curriculumDto(db, row) {
  const subjectsCount = (await db.prepare('SELECT COUNT(*) n FROM curriculum_subjects WHERE curriculum_id = ?').get(row.id)).n;
  const cohortsCount = (await db.prepare("SELECT COUNT(*) n FROM program_cohorts WHERE curriculum_id = ? AND status <> 'ARCHIVED'").get(row.id)).n;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    version: row.version || '1.0',
    effective_date: row.effective_date || null,
    department_id: row.department_id || null,
    status: row.status,
    lifecycle_status: row.lifecycle_status || (row.status === 'ACTIVE' ? 'PUBLISHED' : row.status === 'ARCHIVED' ? 'DEPRECATED' : 'DRAFT'),
    program_type: row.program_type || 'INSTRUCTOR_LED',
    delivery_mode: row.delivery_mode || 'HYBRID',
    standard_duration_text: row.standard_duration_text || '',
    final_tuition_fee: Number(row.final_tuition_fee || 0),
    subjects_count: subjectsCount,
    cohorts_count: cohortsCount,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function cohortSummaryDto(db, row) {
  const curr = await db.prepare('SELECT id, code, title, version FROM curricula WHERE id = ?').get(row.curriculum_id);
  const activeStudents = (await db
    .prepare("SELECT COUNT(DISTINCT student_id) n FROM cohort_enrollments WHERE cohort_id = ? AND status = 'ACTIVE'")
    .get(row.id)).n;
  const classesCount = (await db
    .prepare("SELECT COUNT(*) n FROM subject_classes WHERE cohort_id = ? AND status NOT IN ('ARCHIVED','CANCELLED')")
    .get(row.id)).n;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    curriculum: curr || null,
    academic_year: row.academic_year || '',
    semester: row.semester || '',
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    delivery_mode: row.delivery_mode || 'HYBRID',
    location_note: row.location_note || '',
    coordinator_id: row.coordinator_id || null,
    coordinator_name: row.coordinator_name || '',
    max_students: row.max_students || null,
    department_id: row.department_id || null,
    status: row.status,
    active_students_count: activeStudents,
    subject_classes_count: classesCount,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerCurriculaAndCohortRoutes(route) {
  // =========================================================================
  // LEVEL 1: KHUNG CHƯƠNG TRÌNH (CURRICULA)
  // =========================================================================
  route('GET', '/curricula', async ({ db, user, url }) => {
    if (!canViewPrograms(user)) fail(403, 'PROGRAM_ACCESS_DENIED', 'Bạn không có quyền xem Khung chương trình.');
    const { page, size, offset } = pageParams(url, 20, 100);
    const where = ['1 = 1'];
    const params = [];
    if (!isAdmin(user) && user.department_id) {
      where.push('(department_id = ? OR department_id IS NULL)');
      params.push(user.department_id);
    }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push("(LOWER(code) LIKE LOWER(?) OR LOWER(title) LIKE LOWER(?))");
      params.push(`%${q}%`, `%${q}%`);
    }
    const status = url.searchParams.get('status');
    if (status && status !== 'ALL') {
      where.push('status = ?');
      params.push(status);
    } else if (!status) {
      where.push("status <> 'ARCHIVED'");
    }
    const whereSql = where.join(' AND ');
    const total = (await db.prepare(`SELECT COUNT(*) n FROM curricula WHERE ${whereSql}`).get(...params)).n;
    const rows = await db.prepare(`SELECT * FROM curricula WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    return {
      items: await mapAsync(rows, async (r) => await curriculumDto(db, r)),
      page,
      page_size: size,
      total,
      capabilities: { can_manage: isAdmin(user) || isStaff(user) },
    };
  });

  route('POST', '/curricula', async ({ db, user, body }) => {
    const deptId = body.department_id || user.department_id || 'khoi_5';
    requireAdminOrStaff(user, deptId);
    const code = text(body, 'code', { required: true, max: 40, label: 'mã khung chương trình' }).toUpperCase();
    if (!CURR_CODE_RE.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã khung chương trình chỉ gồm chữ, số, dấu chấm, gạch ngang.');
    if (await db.prepare('SELECT 1 FROM curricula WHERE UPPER(code) = ?').get(code)) {
      fail(409, 'CURRICULUM_CODE_EXISTS', `Mã khung chương trình "${code}" đã tồn tại.`);
    }
    const title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên khung chương trình' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' });
    const version = text(body, 'version', { max: 32, label: 'phiên bản' }) || '1.0';
    const effectiveDate = dateField(body, 'effective_date', { label: 'ngày hiệu lực' });
    const status = oneOf(body, 'status', ['DRAFT', 'ACTIVE'], { fallback: 'ACTIVE', label: 'trạng thái' });
    const lifecycleStatus = body.lifecycle_status
      ? oneOf(body, 'lifecycle_status', ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'DEPRECATED'], { fallback: 'PUBLISHED', label: 'trạng thái ban hành' })
      : status === 'ACTIVE'
        ? 'PUBLISHED'
        : 'DRAFT';
    const mappedStatus = lifecycleStatus === 'PUBLISHED' ? 'ACTIVE' : lifecycleStatus === 'DEPRECATED' ? 'ARCHIVED' : 'DRAFT';
    const id = `curr_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO curricula (id, code, title, description, version, effective_date, department_id, status, lifecycle_status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, code, title, description, version, effectiveDate, deptId, mappedStatus, lifecycleStatus, user.id, now, now);
      await logCurriculumAudit(db, id, 'CURRICULUM_CREATED', { code, title, version }, user);
    });
    return [201, await curriculumDto(db, await db.prepare('SELECT * FROM curricula WHERE id = ?').get(id))];
  });

  route('GET', '/curricula/:id', async ({ db, user, params }) => {
    if (!canViewPrograms(user)) fail(403, 'PROGRAM_ACCESS_DENIED', 'Bạn không có quyền xem Khung chương trình.');
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    const subjects = await db
      .prepare(
        `SELECT cs.*, c.code AS course_code, c.title AS course_title, c.subject AS subject_name,
                c.status AS course_status, c.instructor_name,
                (SELECT MAX(version_number) FROM course_versions cv WHERE cv.course_id = c.id) AS latest_version_number
         FROM curriculum_subjects cs
         JOIN courses c ON c.id = cs.course_id
         WHERE cs.curriculum_id = ?
         ORDER BY cs.semester_order ASC, cs.sort_order ASC`
      )
      .all(curr.id);
    const cohorts = await mapAsync(await db
      .prepare('SELECT * FROM program_cohorts WHERE curriculum_id = ? ORDER BY created_at DESC')
      .all(curr.id), async (c) => await cohortSummaryDto(db, c));
    const logs = (await db
      .prepare('SELECT * FROM curriculum_audit_logs WHERE curriculum_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(curr.id))
      .map((l) => ({ ...l, payload: safeJson(l.payload_json, {}) }));

    return {
      ...await curriculumDto(db, curr),
      subjects: subjects.map((s) => ({
        id: s.id,
        course_id: s.course_id,
        course_code: s.course_code,
        course_title: s.course_title,
        subject_name: s.subject_name || '',
        course_status: s.course_status,
        instructor_name: s.instructor_name,
        latest_version_number: s.latest_version_number || null,
        semester_order: s.semester_order,
        sort_order: s.sort_order,
        planned_periods: s.planned_periods,
        planned_hours: Number(s.planned_hours || 0),
        is_mandatory: Boolean(s.is_mandatory),
        note: s.note || '',
      })),
      cohorts,
      audit_logs: logs,
      capabilities: { can_manage: isAdmin(user) || (isStaff(user) && (!curr.department_id || curr.department_id === user.department_id)) },
    };
  });

  route('PATCH', '/curricula/:id', async ({ db, user, body, params }) => {
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    requireAdminOrStaff(user, curr.department_id);
    const f = {};
    if ('title' in body) f.title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên khung chương trình' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' });
    if ('version' in body) f.version = text(body, 'version', { required: true, max: 32, label: 'phiên bản' });
    if ('effective_date' in body) f.effective_date = dateField(body, 'effective_date', { label: 'ngày hiệu lực' });
    if ('status' in body) f.status = oneOf(body, 'status', ['DRAFT', 'ACTIVE', 'ARCHIVED'], { required: true, label: 'trạng thái' });
    const keys = Object.keys(f);
    if (keys.length) {
      await tx(db, async () => {
        await db.prepare(`UPDATE curricula SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...keys.map((k) => f[k]), nowIso(), curr.id);
        await logCurriculumAudit(db, curr.id, 'CURRICULUM_UPDATED', f, user);
      });
    }
    return await curriculumDto(db, await db.prepare('SELECT * FROM curricula WHERE id = ?').get(curr.id));
  });

  route('DELETE', '/curricula/:id', async ({ db, user, params }) => {
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    requireAdminOrStaff(user, curr.department_id);
    const cohortsUsing = (await db.prepare('SELECT COUNT(*) n FROM program_cohorts WHERE curriculum_id = ?').get(curr.id)).n;
    if (cohortsUsing > 0) {
      fail(409, 'CURRICULUM_IN_USE', `Không thể xóa khung chương trình đang được ${cohortsUsing} lớp khóa học sử dụng. Hãy lưu trữ thay vì xóa.`);
    }
    await db.prepare('DELETE FROM curricula WHERE id = ?').run(curr.id);
    return { deleted_id: curr.id };
  });

  route('POST', '/curricula/:id/subjects', async ({ db, user, body, params }) => {
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    requireAdminOrStaff(user, curr.department_id);
    const courseId = text(body, 'course_id', { required: true, max: 64, label: 'môn học' });
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy môn học.');
    if (await db.prepare('SELECT 1 FROM curriculum_subjects WHERE curriculum_id = ? AND course_id = ?').get(curr.id, course.id)) {
      fail(409, 'SUBJECT_ALREADY_IN_CURRICULUM', 'Môn học này đã nằm trong khung chương trình.');
    }
    const maxSort = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM curriculum_subjects WHERE curriculum_id = ?').get(curr.id)).m;
    const itemId = `cs_${crypto.randomBytes(5).toString('hex')}`;
    const sem = intField(body, 'semester_order', { min: 1, max: 12, label: 'học kỳ' }) ?? 1;
    const periods = intField(body, 'planned_periods', { min: 1, max: 1000, label: 'số tiết' }) ?? 30;
    const hours = Number.isFinite(Number(body.planned_hours)) ? Number(body.planned_hours) : Math.round(periods * 0.75 * 10) / 10;
    const isMandatory = body.is_mandatory === false ? 0 : 1;
    const note = text(body, 'note', { max: 500, label: 'ghi chú' }) || '';

    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO curriculum_subjects (id, curriculum_id, course_id, semester_order, sort_order, planned_periods, planned_hours, is_mandatory, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(itemId, curr.id, course.id, sem, maxSort + 10, periods, hours, isMandatory, note, nowIso());
      await db.prepare('UPDATE curricula SET updated_at = ? WHERE id = ?').run(nowIso(), curr.id);
      await logCurriculumAudit(db, curr.id, 'SUBJECT_ADDED', { course_id: course.id, course_code: course.code, semester_order: sem }, user);
    });
    return [201, { id: itemId, curriculum_id: curr.id, course_id: course.id, semester_order: sem, sort_order: maxSort + 10, planned_periods: periods, planned_hours: hours }];
  });

  route('PATCH', '/curricula/:id/subjects/:itemId', async ({ db, user, body, params }) => {
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    requireAdminOrStaff(user, curr.department_id);
    const item = await db.prepare('SELECT * FROM curriculum_subjects WHERE id = ? AND curriculum_id = ?').get(params.itemId, curr.id);
    if (!item) fail(404, 'CURRICULUM_SUBJECT_NOT_FOUND', 'Không tìm thấy môn học trong khung chương trình.');
    const f = {};
    if ('semester_order' in body) f.semester_order = intField(body, 'semester_order', { min: 1, max: 12, required: true, label: 'học kỳ' });
    if ('sort_order' in body) f.sort_order = intField(body, 'sort_order', { min: 0, max: 10000, required: true, label: 'thứ tự' });
    if ('planned_periods' in body) f.planned_periods = intField(body, 'planned_periods', { min: 1, max: 1000, required: true, label: 'số tiết' });
    if ('planned_hours' in body) f.planned_hours = Number(body.planned_hours) || item.planned_hours;
    if ('is_mandatory' in body) f.is_mandatory = body.is_mandatory ? 1 : 0;
    if ('note' in body) f.note = text(body, 'note', { max: 500, label: 'ghi chú' }) || '';
    const keys = Object.keys(f);
    if (keys.length) {
      await db.prepare(`UPDATE curriculum_subjects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => f[k]), item.id);
      await logCurriculumAudit(db, curr.id, 'SUBJECT_UPDATED', { item_id: item.id, ...f }, user);
    }
    return { ...item, ...f };
  });

  route('DELETE', '/curricula/:id/subjects/:itemId', async ({ db, user, params }) => {
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(params.id);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
    requireAdminOrStaff(user, curr.department_id);
    const item = await db.prepare('SELECT * FROM curriculum_subjects WHERE id = ? AND curriculum_id = ?').get(params.itemId, curr.id);
    if (!item) fail(404, 'CURRICULUM_SUBJECT_NOT_FOUND', 'Không tìm thấy môn học trong khung chương trình.');
    const linkedCls = (await db
      .prepare(
        `SELECT COUNT(*) n FROM subject_classes sc JOIN program_cohorts pc ON pc.id = sc.cohort_id
         WHERE pc.curriculum_id = ? AND sc.course_id = ? AND sc.status NOT IN ('ARCHIVED','CANCELLED')`
      )
      .get(curr.id, item.course_id)).n;
    if (linkedCls > 0) {
      fail(409, 'SUBJECT_IN_COHORT_CLASSES', 'Môn học này đang có lớp môn học hoạt động thuộc lớp khóa học dùng khung chương trình.');
    }
    await db.prepare('DELETE FROM curriculum_subjects WHERE id = ?').run(item.id);
    await logCurriculumAudit(db, curr.id, 'SUBJECT_REMOVED', { course_id: item.course_id }, user);
    return { deleted_id: item.id };
  });

  // =========================================================================
  // LEVEL 2: KHÓA HỌC / LỚP KHÓA HỌC (PROGRAM COHORTS)
  // =========================================================================
  route('GET', '/cohorts', async ({ db, user, url }) => {
    if (!canViewPrograms(user) && !isStudent(user)) {
      fail(403, 'COHORT_ACCESS_DENIED', 'Bạn không có quyền xem Lớp khóa học.');
    }
    const { page, size, offset } = pageParams(url, 20, 100);
    const where = ['1 = 1'];
    const params = [];
    if (isStudent(user) && !isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      where.push(`id IN (SELECT cohort_id FROM cohort_enrollments WHERE student_id = ? AND status = 'ACTIVE')`);
      params.push(user.id);
    } else if (!isAdmin(user) && user.department_id) {
      where.push('(department_id = ? OR department_id IS NULL)');
      params.push(user.department_id);
    }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push("(LOWER(code) LIKE LOWER(?) OR LOWER(title) LIKE LOWER(?) OR LOWER(academic_year) LIKE LOWER(?))");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const currId = url.searchParams.get('curriculum_id');
    if (currId) {
      where.push('curriculum_id = ?');
      params.push(currId);
    }
    const status = url.searchParams.get('status');
    if (status && status !== 'ALL') {
      where.push('status = ?');
      params.push(status);
    } else if (!status) {
      where.push("status <> 'ARCHIVED'");
    }
    const whereSql = where.join(' AND ');
    const total = (await db.prepare(`SELECT COUNT(*) n FROM program_cohorts WHERE ${whereSql}`).get(...params)).n;
    const rows = await db.prepare(`SELECT * FROM program_cohorts WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    return {
      items: await mapAsync(rows, async (r) => await cohortSummaryDto(db, r)),
      page,
      page_size: size,
      total,
      capabilities: { can_manage: isAdmin(user) || isStaff(user) },
    };
  });

  route('POST', '/cohorts', async ({ db, user, body }) => {
    const curriculumId = text(body, 'curriculum_id', { required: true, max: 64, label: 'khung chương trình' });
    const curr = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(curriculumId);
    if (!curr) fail(404, 'CURRICULUM_NOT_FOUND', 'Khung chương trình không tồn tại.');
    const deptId = body.department_id || curr.department_id || user.department_id || 'khoi_5';
    requireAdminOrStaff(user, deptId);
    const effLifecycle = curr.lifecycle_status || (curr.status === 'ACTIVE' ? 'PUBLISHED' : 'DRAFT');
    if (curr.status !== 'ACTIVE' || effLifecycle !== 'PUBLISHED') {
      fail(422, 'CURRICULUM_NOT_PUBLISHED', 'Chỉ Khung chương trình ở trạng thái "Đã ban hành" mới được mở lớp khóa học.');
    }

    const code = text(body, 'code', { required: true, max: 40, label: 'mã lớp khóa học' }).toUpperCase();
    if (!CURR_CODE_RE.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã lớp khóa học không hợp lệ.');
    if (await db.prepare('SELECT 1 FROM program_cohorts WHERE UPPER(code) = ?').get(code)) {
      fail(409, 'COHORT_CODE_EXISTS', `Mã lớp khóa học "${code}" đã tồn tại.`);
    }
    const title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên lớp khóa học' });
    const academicYear = text(body, 'academic_year', { max: 64, label: 'niên khóa' }) || '2026–2027';
    const semester = text(body, 'semester', { max: 64, label: 'học kỳ' }) || 'Cả năm';
    const startDate = dateField(body, 'start_date', { label: 'ngày bắt đầu' });
    const endDate = dateField(body, 'end_date', { label: 'ngày kết thúc' });
    if (startDate && endDate && endDate < startDate) fail(422, 'VALIDATION_ERROR', 'Ngày kết thúc phải sau ngày bắt đầu.');
    const deliveryMode = oneOf(body, 'delivery_mode', ['OFFLINE', 'ONLINE', 'HYBRID'], { fallback: 'HYBRID', label: 'hình thức' });
    const locationNote = text(body, 'location_note', { max: 500, label: 'địa điểm / phòng học' }) || '';
    const coordinatorId = text(body, 'coordinator_id', { max: 64, label: 'người điều phối' }) || user.id;
    const coordUser = await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(coordinatorId);
    const maxStudents = intField(body, 'max_students', { min: 1, max: 2000, label: 'sĩ số tối đa' });
    const status = oneOf(body, 'status', ['DRAFT', 'ACTIVE', 'COMPLETED'], { fallback: 'ACTIVE', label: 'trạng thái' });
    const id = `coh_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO program_cohorts (
           id, curriculum_id, code, title, academic_year, semester, start_date, end_date,
           delivery_mode, location_note, coordinator_id, coordinator_name, max_students, department_id, status,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, curr.id, code, title, academicYear, semester, startDate, endDate,
        deliveryMode, locationNote, coordUser?.id || user.id, coordUser?.full_name || user.full_name,
        maxStudents, deptId, status, user.id, now, now
      );
      await logCohortAudit(db, id, 'COHORT_CREATED', null, { code, title, curriculum_id: curr.id }, user);
    });
    return [201, await cohortSummaryDto(db, await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(id))];
  });

  // Chi tiết 8 tab của Lớp khóa học
  route('GET', '/cohorts/:id', async ({ db, user, params }) => {
    if (!canViewPrograms(user) && !isStudent(user)) {
      fail(403, 'COHORT_ACCESS_DENIED', 'Bạn không có quyền xem Lớp khóa học.');
    }
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    if (isStudent(user) && !canViewPrograms(user)) {
      const mem = await db.prepare(`SELECT 1 FROM cohort_enrollments WHERE cohort_id = ? AND student_id = ? AND status = 'ACTIVE'`).get(cohort.id, user.id);
      if (!mem) fail(403, 'COHORT_ACCESS_DENIED', 'Bạn không thuộc lớp khóa học này.');
    }

    const summary = await cohortSummaryDto(db, cohort);
    const studentsRaw = (await db
      .prepare(
        `SELECT ce.*, u.code AS student_code, u.full_name, u.email
         FROM cohort_enrollments ce JOIN users u ON u.id = ce.student_id
         WHERE ce.cohort_id = ?`
      )
      .all(cohort.id))
      .sort((a, b) => compareVietnameseName(a.full_name, b.full_name));

    const linkedClasses = await db
      .prepare(
        `SELECT sc.*, c.code AS course_code, c.title AS course_title,
                cv.version_number AS pinned_version_number, cv.version_label AS pinned_version_label,
                (SELECT MAX(cv2.version_number) FROM course_versions cv2 WHERE cv2.course_id = sc.course_id) AS latest_version_number,
                (SELECT COUNT(*) FROM class_enrollments e WHERE e.subject_class_id = sc.id AND e.status = 'ACTIVE' AND e.enrollment_source = 'COHORT_SYNCED') AS synced_students_count,
                (SELECT COUNT(*) FROM class_enrollments e WHERE e.subject_class_id = sc.id AND e.status = 'ACTIVE' AND e.enrollment_source <> 'COHORT_SYNCED') AS extra_students_count
         FROM subject_classes sc
         LEFT JOIN courses c ON c.id = sc.course_id
         LEFT JOIN course_versions cv ON cv.id = sc.course_version_id
         WHERE sc.cohort_id = ?
         ORDER BY sc.code`
      )
      .all(cohort.id);

    const curriculumSubjects = await db
      .prepare(
        `SELECT cs.*, c.code AS course_code, c.title AS course_title, c.instructor_id, c.instructor_name
         FROM curriculum_subjects cs JOIN courses c ON c.id = cs.course_id
         WHERE cs.curriculum_id = ? ORDER BY cs.semester_order, cs.sort_order`
      )
      .all(cohort.curriculum_id);

    const linkedClassIds = linkedClasses.map((c) => c.id);
    const inCls = linkedClassIds.length ? linkedClassIds.map(() => '?').join(',') : "''";

    // Tab Giảng viên (gom nhóm theo giảng viên & vai trò để tránh trùng dòng và trả đúng class_codes[])
    const rawInstructors = linkedClassIds.length
      ? await db
          .prepare(
            `SELECT u.id, u.code, u.full_name, u.email, t.staff_role, sc.id AS class_id, sc.code AS class_code, sc.title AS class_title
             FROM teaching_staff_assignments t
             JOIN users u ON u.id = t.user_id
             JOIN subject_classes sc ON sc.id = t.subject_class_id
             WHERE t.subject_class_id IN (${inCls}) AND t.is_active = 1
             ORDER BY u.full_name, sc.code`
          )
          .all(...linkedClassIds)
      : [];
    const instructorMap = new Map();
    for (const row of rawInstructors) {
      const key = `${row.id}:${row.staff_role}`;
      let entry = instructorMap.get(key);
      if (!entry) {
        entry = {
          id: row.id,
          code: row.code,
          full_name: row.full_name,
          email: row.email,
          staff_role: row.staff_role,
          class_codes: [],
          classes: [],
        };
        instructorMap.set(key, entry);
      }
      if (row.class_code && !entry.class_codes.includes(row.class_code)) {
        entry.class_codes.push(row.class_code);
        entry.classes.push({ id: row.class_id, code: row.class_code, title: row.class_title });
      }
    }
    const instructors = Array.from(instructorMap.values());

    // Tab Lịch học
    const schedule = linkedClassIds.length
      ? await db
          .prepare(
            `SELECT s.*, sc.code AS class_code, sc.title AS class_title
             FROM sessions s JOIN subject_classes sc ON sc.id = s.subject_class_id
             WHERE s.subject_class_id IN (${inCls}) AND s.session_status <> 'CANCELLED'
             ORDER BY s.scheduled_start_at DESC LIMIT 80`
          )
          .all(...linkedClassIds)
      : [];

    // Tab Tiến độ & Thống kê toàn lớp khóa học (dùng DISTINCT student_id, không cộng trùng)
    const activeCohortIds = studentsRaw.filter((s) => s.status === 'ACTIVE').map((s) => s.student_id);
    const policy = await getAttendancePolicy(db);
    const studentProgressRows = await mapAsync(studentsRaw, async (st) => {
      let attP = 0; let attL = 0; let attE = 0; let attA = 0;
      let doneLessons = 0; let totalLessons = 0;
      if (linkedClassIds.length) {
        const att = await db
          .prepare(
            `SELECT ar.attendance_status, COUNT(*) n
             FROM attendance_records ar JOIN sessions s ON s.session_id = ar.class_session_id
             WHERE ar.student_id = ? AND ar.subject_class_id IN (${inCls}) AND s.session_status <> 'CANCELLED'
             GROUP BY ar.attendance_status`
          )
          .all(st.student_id, ...linkedClassIds);
        for (const a of att) {
          if (a.attendance_status === 'PRESENT') attP = a.n;
          else if (a.attendance_status === 'LATE') attL = a.n;
          else if (a.attendance_status === 'EXCUSED_ABSENCE') attE = a.n;
          else if (a.attendance_status === 'UNEXCUSED_ABSENCE') attA = a.n;
        }
        doneLessons = (await db
          .prepare(
            `SELECT COUNT(*) n FROM lesson_progress p
             WHERE p.student_id = ? AND p.subject_class_id IN (${inCls}) AND p.status = 'COMPLETED'`
          )
          .get(st.student_id, ...linkedClassIds)).n;
        totalLessons = (await db
          .prepare(
            `SELECT COUNT(*) n FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
             JOIN subject_classes sc ON sc.course_id = ch.course_id
             WHERE sc.id IN (${inCls}) AND ch.status = 'PUBLISHED' AND l.publish_status = 'PUBLISHED'`
          )
          .get(...linkedClassIds)).n;
      }
      const attRate = rateFromCounts({ PRESENT: attP, LATE: attL, EXCUSED_ABSENCE: attE, UNEXCUSED_ABSENCE: attA }, policy);
      const completionPct = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
      return {
        student_id: st.student_id,
        code: st.student_code,
        full_name: st.full_name,
        email: st.email,
        status: st.status,
        enrolled_at: st.enrolled_at,
        ended_at: st.ended_at,
        note: st.note || '',
        attendance_rate: attRate,
        completed_lessons: doneLessons,
        total_lessons: totalLessons,
        completion_pct: completionPct,
      };
    });

    const distinctTotalEnrolled = activeCohortIds.length;
    const distinctFromClasses = linkedClassIds.length
      ? (await db.prepare(
          `SELECT COUNT(DISTINCT student_id) n FROM class_enrollments
           WHERE subject_class_id IN (${inCls}) AND status = 'ACTIVE' AND enrollment_source = 'COHORT_SYNCED'`
        ).get(...linkedClassIds)).n
      : 0;
    const distinctExtraStudents = linkedClassIds.length
      ? (await db.prepare(
          `SELECT COUNT(DISTINCT student_id) n FROM class_enrollments
           WHERE subject_class_id IN (${inCls}) AND status = 'ACTIVE' AND enrollment_source <> 'COHORT_SYNCED'`
        ).get(...linkedClassIds)).n
      : 0;

    const avgCompletion = studentProgressRows.filter((s) => s.status === 'ACTIVE').length
      ? Math.round(
          (studentProgressRows.filter((s) => s.status === 'ACTIVE').reduce((acc, s) => acc + s.completion_pct, 0) /
            studentProgressRows.filter((s) => s.status === 'ACTIVE').length) * 10
        ) / 10
      : 0;

    const auditLogs = (await db
      .prepare('SELECT * FROM cohort_audit_logs WHERE cohort_id = ? ORDER BY created_at DESC LIMIT 80')
      .all(cohort.id))
      .map((l) => ({ ...l, payload: safeJson(l.payload_json, {}) }));

    return {
      ...summary,
      students: studentProgressRows,
      curriculum_subjects: curriculumSubjects,
      subject_classes: linkedClasses.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        subject: c.subject || '',
        course_id: c.course_id,
        course_code: c.course_code || '',
        course_title: c.course_title || '',
        instructor_name: c.instructor_name,
        delivery_mode: c.delivery_mode,
        status: c.status,
        course_version_id: c.course_version_id || null,
        pinned_version_number: c.pinned_version_number || c.course_version_number || null,
        pinned_version_label: c.pinned_version_label || (c.course_version_number ? `v${c.course_version_number}.0` : 'Đang dùng bản mới nhất'),
        latest_version_number: c.latest_version_number || null,
        has_newer_version: Boolean(c.latest_version_number && c.course_version_number && Number(c.latest_version_number) > Number(c.course_version_number)),
        synced_students_count: c.synced_students_count || 0,
        extra_students_count: c.extra_students_count || 0,
        total_students_count: (c.synced_students_count || 0) + (c.extra_students_count || 0),
      })),
      instructors,
      schedule: schedule.map((s) => ({
        id: s.session_id,
        class_id: s.subject_class_id,
        class_code: s.class_code,
        class_title: s.class_title,
        title: s.session_title,
        start_at: s.scheduled_start_at,
        end_at: s.scheduled_end_at,
        delivery_mode: s.delivery_mode || 'OFFLINE',
        session_status: s.session_status || 'SCHEDULED',
        room_or_link: s.room_or_link || '',
      })),
      progress: studentProgressRows.filter((s) => s.status === 'ACTIVE'),
      statistics: {
        distinct_active_students: distinctTotalEnrolled,
        distinct_synced_to_classes: distinctFromClasses,
        distinct_extra_subject_students: distinctExtraStudents,
        subject_classes_count: linkedClasses.length,
        avg_completion_pct: avgCompletion,
        transferred_count: studentsRaw.filter((s) => s.status === 'TRANSFERRED').length,
        withdrawn_count: studentsRaw.filter((s) => s.status === 'WITHDRAWN').length,
        no_double_counting_note: 'Tổng sĩ số lớp khóa học được đếm theo từng mã học viên duy nhất (DISTINCT), không cộng dồn theo số lớp môn học.',
      },
      audit_logs: auditLogs,
      capabilities: {
        can_manage: isAdmin(user) || (isStaff(user) && (!cohort.department_id || cohort.department_id === user.department_id)),
      },
    };
  });

  route('PATCH', '/cohorts/:id', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const f = {};
    if ('title' in body) f.title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên lớp khóa học' });
    if ('academic_year' in body) f.academic_year = text(body, 'academic_year', { max: 64, label: 'niên khóa' });
    if ('semester' in body) f.semester = text(body, 'semester', { max: 64, label: 'học kỳ' });
    if ('start_date' in body) f.start_date = dateField(body, 'start_date', { label: 'ngày bắt đầu' });
    if ('end_date' in body) f.end_date = dateField(body, 'end_date', { label: 'ngày kết thúc' });
    if ('delivery_mode' in body) f.delivery_mode = oneOf(body, 'delivery_mode', ['OFFLINE', 'ONLINE', 'HYBRID'], { required: true, label: 'hình thức' });
    if ('location_note' in body) f.location_note = text(body, 'location_note', { max: 500, label: 'địa điểm' });
    if ('max_students' in body) f.max_students = intField(body, 'max_students', { min: 1, max: 2000, label: 'sĩ số tối đa' });
    if ('status' in body) f.status = oneOf(body, 'status', ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'], { required: true, label: 'trạng thái' });
    const keys = Object.keys(f);
    if (keys.length) {
      await tx(db, async () => {
        await db.prepare(`UPDATE program_cohorts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...keys.map((k) => f[k]), nowIso(), cohort.id);
        await logCohortAudit(db, cohort.id, 'COHORT_UPDATED', null, f, user);
      });
    }
    return await cohortSummaryDto(db, await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(cohort.id));
  });

  async function enrollStudentsInCohort(db, user, cohort, identifiers, syncNow = true) {
    if (!identifiers.length) fail(422, 'VALIDATION_ERROR', 'Danh sách học viên trống.');
    const added = [];
    const reactivated = [];
    const already = [];
    const notFound = [];
    const now = nowIso();

    await tx(db, async () => {
      for (const raw of identifiers) {
        const key = String(raw).trim();
        if (!key) continue;
        const u = await db.prepare('SELECT * FROM users WHERE id = ? OR UPPER(code) = UPPER(?) OR LOWER(email) = LOWER(?)').get(key, key, key);
        if (!u || !JSON.parse(u.roles_json || '[]').includes('STUDENT')) {
          notFound.push(key);
          continue;
        }
        if (cohort.max_students) {
          const cnt = (await db.prepare(`SELECT COUNT(*) n FROM cohort_enrollments WHERE cohort_id = ? AND status = 'ACTIVE'`).get(cohort.id)).n;
          if (cnt >= cohort.max_students) fail(422, 'COHORT_FULL', `Lớp khóa học đã đạt sĩ số tối đa (${cohort.max_students}).`);
        }
        const ex = await db.prepare('SELECT * FROM cohort_enrollments WHERE cohort_id = ? AND student_id = ?').get(cohort.id, u.id);
        if (ex && ex.status === 'ACTIVE') {
          already.push(u.code);
          continue;
        }
        if (ex) {
          await db.prepare(`UPDATE cohort_enrollments SET status = 'ACTIVE', ended_at = NULL, transfer_to_cohort_id = NULL, enrolled_at = ?, updated_by = ? WHERE id = ?`)
            .run(now, user.id, ex.id);
          reactivated.push(u.code);
        } else {
          await db.prepare(
            `INSERT INTO cohort_enrollments (id, cohort_id, student_id, status, enrolled_at, note, updated_by)
             VALUES (?, ?, ?, 'ACTIVE', ?, 'Thêm vào lớp khóa học', ?)`
          ).run(crypto.randomUUID(), cohort.id, u.id, now, user.id);
          added.push(u.code);
        }
        await logCohortAudit(db, cohort.id, 'STUDENT_ENROLLED', u.id, { student_code: u.code, student_name: u.full_name }, user);
      }
      const syncResult = syncNow ? await syncCohortRosterToClasses(db, cohort.id, user) : { classes_synced: 0 };
      await db.prepare('UPDATE program_cohorts SET updated_at = ? WHERE id = ?').run(now, cohort.id);
      return syncResult;
    });

    const syncSummary = syncNow ? await syncCohortRosterToClasses(db, cohort.id, user) : { classes_synced: 0 };
    return { added, reactivated, already_enrolled: already, not_found: notFound, sync_summary: syncSummary };
  }

  route('POST', '/cohorts/:id/students', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const ids = Array.isArray(body.students) ? body.students : [];
    const syncNow = body.sync_to_classes !== false;
    return await enrollStudentsInCohort(db, user, cohort, ids, syncNow);
  });

  route('POST', '/cohorts/:id/students/import', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const raw = typeof body.text === 'string' ? body.text : '';
    const identifiers = raw
      .split(/[\r\n,;\t]+/)
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter((s) => s && !/^(mã|ma|code|email|stt|họ)/i.test(s));
    return await enrollStudentsInCohort(db, user, cohort, [...new Set(identifiers)], body.sync_to_classes !== false);
  });

  route('GET', '/cohorts/:id/students/export', async ({ db, user, params, raw }) => {
    if (!canViewPrograms(user)) fail(403, 'COHORT_ACCESS_DENIED', 'Bạn không có quyền xuất danh sách lớp khóa học.');
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    const rows = await db
      .prepare(
        `SELECT u.code, u.full_name, u.email, ce.status, ce.enrolled_at, ce.ended_at
         FROM cohort_enrollments ce JOIN users u ON u.id = ce.student_id
         WHERE ce.cohort_id = ? ORDER BY ce.status, u.full_name`
      )
      .all(cohort.id);
    const csv = [
      'STT,MaHocVien,HoTen,Email,TrangThai,NgayVaoLop,NgayKetThuc',
      ...rows.map((r, i) => [
        i + 1,
        r.code,
        `"${String(r.full_name || '').replace(/"/g, '""')}"`,
        r.email || '',
        r.status,
        r.enrolled_at || '',
        r.ended_at || '',
      ].join(',')),
    ].join('\n');
    raw(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cohort-${cohort.code}.csv"`,
    }, `\uFEFF${csv}`);
  });

  route('POST', '/cohorts/:id/students/:studentId/withdraw', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const enr = await db.prepare(`SELECT * FROM cohort_enrollments WHERE cohort_id = ? AND student_id = ? AND status = 'ACTIVE'`).get(cohort.id, params.studentId);
    if (!enr) fail(404, 'ENROLLMENT_NOT_FOUND', 'Học viên không có trong danh sách đang học của lớp khóa học.');
    const note = text(body || {}, 'note', { max: 500, label: 'lý do rời lớp' }) || 'Học viên rời lớp khóa học';
    const now = nowIso();
    let syncRes;
    await tx(db, async () => {
      await db.prepare(`UPDATE cohort_enrollments SET status = 'WITHDRAWN', ended_at = ?, note = ?, updated_by = ? WHERE id = ?`)
        .run(now, note, user.id, enr.id);
      syncRes = await syncCohortRosterToClasses(db, cohort.id, user);
      await logCohortAudit(db, cohort.id, 'STUDENT_WITHDRAWN', params.studentId, { note, sync: syncRes }, user);
    });
    return { cohort_id: cohort.id, student_id: params.studentId, status: 'WITHDRAWN', sync_summary: syncRes };
  });

  route('POST', '/cohorts/:id/students/:studentId/transfer', async ({ db, user, body, params }) => {
    const srcCohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!srcCohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học nguồn.');
    requireAdminOrStaff(user, srcCohort.department_id);
    const targetCohortId = text(body, 'target_cohort_id', { required: true, max: 64, label: 'lớp khóa học đích' });
    if (targetCohortId === srcCohort.id) fail(422, 'VALIDATION_ERROR', 'Lớp khóa học đích phải khác lớp nguồn.');
    const dstCohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(targetCohortId);
    if (!dstCohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học đích.');
    const enr = await db.prepare(`SELECT * FROM cohort_enrollments WHERE cohort_id = ? AND student_id = ? AND status = 'ACTIVE'`).get(srcCohort.id, params.studentId);
    if (!enr) fail(404, 'ENROLLMENT_NOT_FOUND', 'Học viên không thuộc lớp khóa học nguồn.');
    const note = text(body, 'note', { max: 500, label: 'ghi chú chuyển lớp' }) || `Chuyển sang ${dstCohort.code}`;
    const now = nowIso();
    let srcSync; let dstSync;
    await tx(db, async () => {
      await db.prepare(`UPDATE cohort_enrollments SET status = 'TRANSFERRED', ended_at = ?, transfer_to_cohort_id = ?, note = ?, updated_by = ? WHERE id = ?`)
        .run(now, dstCohort.id, note, user.id, enr.id);
      const dstExisting = await db.prepare('SELECT * FROM cohort_enrollments WHERE cohort_id = ? AND student_id = ?').get(dstCohort.id, params.studentId);
      if (dstExisting) {
        await db.prepare(`UPDATE cohort_enrollments SET status = 'ACTIVE', ended_at = NULL, enrolled_at = ?, note = ?, updated_by = ? WHERE id = ?`)
          .run(now, `Chuyển từ ${srcCohort.code}`, user.id, dstExisting.id);
      } else {
        await db.prepare(
          `INSERT INTO cohort_enrollments (id, cohort_id, student_id, status, enrolled_at, note, updated_by)
           VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)`
        ).run(crypto.randomUUID(), dstCohort.id, params.studentId, now, `Chuyển từ ${srcCohort.code}`, user.id);
      }
      srcSync = await syncCohortRosterToClasses(db, srcCohort.id, user);
      dstSync = await syncCohortRosterToClasses(db, dstCohort.id, user);
      await logCohortAudit(db, srcCohort.id, 'STUDENT_TRANSFERRED_OUT', params.studentId, { target_cohort_id: dstCohort.id, target_code: dstCohort.code, note }, user);
      await logCohortAudit(db, dstCohort.id, 'STUDENT_TRANSFERRED_IN', params.studentId, { source_cohort_id: srcCohort.id, source_code: srcCohort.code, note }, user);
    });
    return {
      student_id: params.studentId,
      from_cohort_id: srcCohort.id,
      to_cohort_id: dstCohort.id,
      source_sync: srcSync,
      target_sync: dstSync,
    };
  });

  route('POST', '/cohorts/:id/sync-roster', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const classIds = Array.isArray(body?.class_ids) ? body.class_ids : null;
    let res;
    await tx(db, async () => {
      res = await syncCohortRosterToClasses(db, cohort.id, user, classIds);
      await logCohortAudit(db, cohort.id, 'ROSTER_SYNCED_TO_CLASSES', null, res, user);
    });
    return res;
  });

  // Khởi tạo hàng loạt Lớp môn học từ Khung chương trình cho Lớp khóa học (gắn phiên bản Snapshot mới nhất nếu có)
  route('POST', '/cohorts/:id/generate-classes', async ({ db, user, body, params }) => {
    const cohort = await db.prepare('SELECT * FROM program_cohorts WHERE id = ?').get(params.id);
    if (!cohort) fail(404, 'COHORT_NOT_FOUND', 'Không tìm thấy lớp khóa học.');
    requireAdminOrStaff(user, cohort.department_id);
    const subjects = await db
      .prepare(
        `SELECT cs.*, c.code AS course_code, c.title AS course_title, c.subject AS subject_name,
                c.instructor_id, c.instructor_name, c.department_id
         FROM curriculum_subjects cs JOIN courses c ON c.id = cs.course_id
         WHERE cs.curriculum_id = ? ORDER BY cs.semester_order, cs.sort_order`
      )
      .all(cohort.curriculum_id);
    if (!subjects.length) fail(422, 'CURRICULUM_EMPTY', 'Khung chương trình chưa có môn học nào để mở lớp.');

    const selectedCourseIds = Array.isArray(body?.course_ids) && body.course_ids.length
      ? new Set(body.course_ids)
      : null;

    const created = [];
    const skipped = [];
    const now = nowIso();

    await tx(db, async () => {
      for (const s of subjects) {
        if (selectedCourseIds && !selectedCourseIds.has(s.course_id)) continue;
        const already = await db
          .prepare(`SELECT id FROM subject_classes WHERE cohort_id = ? AND course_id = ? AND status NOT IN ('ARCHIVED','CANCELLED')`)
          .get(cohort.id, s.course_id);
        if (already) {
          skipped.push({ course_id: s.course_id, course_code: s.course_code, reason: 'ALREADY_LINKED' });
          continue;
        }
        const latestVer = await db
          .prepare(`SELECT id, version_number FROM course_versions WHERE course_id = ? AND status = 'PUBLISHED' ORDER BY version_number DESC LIMIT 1`)
          .get(s.course_id);
        let codeCandidate = `${cohort.code.slice(0, 14)}-${s.course_code.slice(0, 14)}`.toUpperCase();
        if (await db.prepare('SELECT 1 FROM subject_classes WHERE UPPER(code) = ?').get(codeCandidate)) {
          codeCandidate = `${codeCandidate}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`.slice(0, 40);
        }
        const clsId = `sc_${crypto.randomBytes(5).toString('hex')}`;
        const instrId = body?.instructor_overrides?.[s.course_id] || s.instructor_id;
        const instrRow = await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(instrId);

        await db.prepare(
          `INSERT INTO subject_classes (
             id, course_id, cohort_id, course_version_id, course_version_number,
             code, title, subject, description, instructor_name, ta_names_json,
             schedule_text, room, student_count, start_date, end_date, max_students, delivery_mode, status,
             department_id, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`
        ).run(
          clsId, s.course_id, cohort.id, latestVer?.id || null, latestVer?.version_number || null,
          codeCandidate, `${s.course_title} – ${cohort.code}`, s.subject_name || s.course_title,
          `Lớp môn học thuộc ${cohort.title}`, instrRow?.full_name || s.instructor_name || '',
          cohort.semester || '', cohort.location_note || '',
          cohort.start_date, cohort.end_date, cohort.max_students || null, cohort.delivery_mode || 'HYBRID',
          cohort.department_id || s.department_id, user.id, now, now
        );

        if (instrRow) {
          await db.prepare(
            `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
             VALUES (?, ?, ?, 'PRIMARY_INSTRUCTOR', '{"can_manage_materials":true,"can_take_attendance":true}', 1, ?, ?, ?)`
          ).run(crypto.randomUUID(), clsId, instrRow.id, user.id, now, now);
        }
        created.push({ id: clsId, code: codeCandidate, course_id: s.course_id, course_version_id: latestVer?.id || null });
      }
      const syncRes = await syncCohortRosterToClasses(db, cohort.id, user);
      await logCohortAudit(db, cohort.id, 'CLASSES_GENERATED', null, { created_count: created.length, sync: syncRes }, user);
    });

    return [201, { created, skipped, sync_summary: await syncCohortRosterToClasses(db, cohort.id, user) }];
  });
}
