/**
 * LMSPLUS — Phân hệ Chuẩn bị Đào tạo (1.1 Môn học, 1.2 Khung chương trình, 1.3 Khởi tạo Khóa học).
 *
 * Tái sử dụng hoàn toàn các bảng cốt lõi: courses, curricula, curriculum_subjects,
 * program_cohorts, subject_classes, sessions, course_versions, learning_resources, assignment_bank_items.
 */

import crypto from 'node:crypto';
import {
  fail, nowIso, text, intField, oneOf, dateField, timeField, tx,
  mapAsync,
} from './http.mjs';
import {
  canManageCourse, canViewCourse, isAdmin, isStaff, isInstructor, safeJson,
} from './scope.mjs';
import { buildCourseSnapshotPayload } from './masterSchema.mjs';
import { insertClassSession, vnDate, vnDateTime } from './schema.mjs';
import { syncCohortRosterToClasses } from './curriculaAndCohorts.mjs';

const ROOM_TYPES = ['THEORY_ROOM', 'COMPUTER_LAB', 'ONLINE'];
const LIFECYCLE_STATES = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'DEPRECATED'];
const ASSESSMENT_SOURCES = ['ATTENDANCE', 'ASSIGNMENT', 'EXAM', 'EXAM_MATRIX', 'MANUAL'];

async function requireCourseRow(db, id) {
  const c = await db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!c) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy môn học.');
  return c;
}

async function requireCurriculumRow(db, id) {
  const c = await db.prepare('SELECT * FROM curricula WHERE id = ?').get(id);
  if (!c) fail(404, 'CURRICULUM_NOT_FOUND', 'Không tìm thấy khung chương trình.');
  return c;
}

function requireApprovePermission(user, deptId = null) {
  if (isAdmin(user)) return;
  if (isStaff(user)) {
    if (deptId && user.department_id && deptId !== user.department_id) {
      fail(403, 'OUT_OF_SCOPE', 'Bạn không có quyền phê duyệt ngoài đơn vị phụ trách.');
    }
    return;
  }
  fail(403, 'APPROVAL_FORBIDDEN', 'Chỉ Giáo vụ / Trưởng bộ môn hoặc Quản trị viên mới có quyền phê duyệt ban hành.');
}

function nextVersionLabel(currentLabel) {
  const year = new Date().getUTCFullYear();
  const m = String(currentLabel || '').match(/^v?(\d{4})\.(\d+)$/i);
  if (m) return `v${m[1]}.${Number(m[2]) + 1}`;
  const mSimple = String(currentLabel || '').match(/^v?(\d+)(?:\.(\d+))?$/i);
  if (mSimple) return `v${year}.${Number(mSimple[1]) + 1}`;
  return `v${year}.2`;
}

/** Kiểm tra chu trình đồ thị môn tiên quyết (chống A -> B -> A). */
async function hasPrerequisiteCycle(db, courseId, candidatePrereqIds) {
  const adj = new Map();
  for (const r of await db.prepare('SELECT course_id, prerequisite_course_id FROM course_prerequisites').all()) {
    if (!adj.has(r.course_id)) adj.set(r.course_id, new Set());
    adj.get(r.course_id).add(r.prerequisite_course_id);
  }
  adj.set(courseId, new Set(candidatePrereqIds));

  const visited = new Set();
  const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const nxt of adj.get(node) || []) {
      if (dfs(nxt)) return true;
    }
    stack.delete(node);
    return false;
  }
  return dfs(courseId);
}

/** Quy đổi hạn nộp tương đối của bài tập lớp dựa trên ngày kết thúc buổi học dạy bài đó. */
export async function resolveRelativeAssignmentDueDates(db, classId) {
  const assignments = await db
    .prepare(
      `SELECT * FROM class_assignments
       WHERE subject_class_id = ? AND relative_due_days IS NOT NULL AND (anchor_lesson_id IS NOT NULL OR lesson_id IS NOT NULL)`
    )
    .all(classId);

  let updatedCount = 0;
  const now = nowIso();
  for (const a of assignments) {
    const targetLessonId = a.anchor_lesson_id || a.lesson_id;
    if (!targetLessonId) continue;
    const ses = await db
      .prepare(
        `SELECT s.scheduled_end_at FROM sessions s
         JOIN session_lessons sl ON sl.session_id = s.session_id
         WHERE s.subject_class_id = ? AND sl.lesson_id = ?
           AND s.session_status <> 'CANCELLED' AND s.schedule_state = 'PUBLISHED'
         ORDER BY s.scheduled_end_at DESC LIMIT 1`
      )
      .get(classId, targetLessonId);
    if (!ses || !ses.scheduled_end_at) continue;
    const dueMs = Date.parse(ses.scheduled_end_at) + Number(a.relative_due_days || 0) * 86400000;
    if (Number.isNaN(dueMs)) continue;
    const dueDate = vnDate(new Date(dueMs));
    const dueAt = vnDateTime(dueDate, '23:59');
    await db.prepare(
      `UPDATE class_assignments SET due_at = ?, status = CASE WHEN status = 'DRAFT' THEN 'PUBLISHED' ELSE status END, updated_at = ?
       WHERE id = ?`
    ).run(dueAt, now, a.id);
    updatedCount++;
  }
  return updatedCount;
}

/** Tính toán tổng thời lượng, học phí và cảnh báo thứ tự môn tiên quyết trong Khung chương trình. */
export async function computeCurriculumStructureAndTotals(db, curriculumId) {
  const curr = await requireCurriculumRow(db, curriculumId);
  const stages = await db
    .prepare('SELECT * FROM curriculum_stages WHERE curriculum_id = ? ORDER BY sort_order, id')
    .all(curriculumId);
  const stageOrderMap = new Map(stages.map((s, idx) => [s.id, Number(s.sort_order ?? (idx + 1) * 10)]));

  const subjects = await db
    .prepare(
      `SELECT cs.*, c.code AS course_code, c.title AS course_title, c.instructor_name,
              c.reference_tuition_fee, c.theory_periods, c.practice_periods, c.self_study_periods,
              c.minutes_per_period, c.required_room_type, c.lifecycle_status AS course_lifecycle_status,
              c.version_code AS course_version_code
       FROM curriculum_subjects cs
       JOIN courses c ON c.id = cs.course_id
       WHERE cs.curriculum_id = ?
       ORDER BY cs.semester_order, cs.sort_order, cs.id`
    )
    .all(curriculumId);

  const globalPrereqs = await db.prepare('SELECT course_id, prerequisite_course_id FROM course_prerequisites').all();
  const globalMap = new Map();
  for (const r of globalPrereqs) {
    if (!globalMap.has(r.course_id)) globalMap.set(r.course_id, new Set());
    globalMap.get(r.course_id).add(r.prerequisite_course_id);
  }

  const coursePosMap = new Map();
  const enrichedSubjects = subjects.map((s, idx) => {
    const localIds = safeJson(s.prerequisite_course_ids_json, []);
    const mergedPrereqs = new Set([...(globalMap.get(s.course_id) || []), ...(Array.isArray(localIds) ? localIds : [])]);
    const stageRank = s.stage_id && stageOrderMap.has(s.stage_id)
      ? stageOrderMap.get(s.stage_id)
      : Number(s.semester_order || 1) * 100;
    const rankTuple = stageRank * 10000 + Number(s.sort_order || (idx + 1) * 10);
    coursePosMap.set(s.course_id, {
      rankTuple,
      stageRank,
      course_code: s.course_code,
      course_title: s.course_title,
    });
    const minsPerPeriod = Number(s.minutes_per_period || 45);
    const totalPeriods = Number(s.planned_periods || (Number(s.theory_periods || 0) + Number(s.practice_periods || 0)) || 30);
    const totalHours = Math.round(((totalPeriods * minsPerPeriod) / 60) * 10) / 10;
    return {
      ...s,
      prerequisite_course_ids: [...mergedPrereqs],
      effective_periods: totalPeriods,
      effective_hours: totalHours,
      stage_rank: stageRank,
      rank_tuple: rankTuple,
    };
  });

  const warnings = [];
  for (const s of enrichedSubjects) {
    for (const preId of s.prerequisite_course_ids) {
      const preInCurr = coursePosMap.get(preId);
      const preCourse = await db.prepare('SELECT id, code, title FROM courses WHERE id = ?').get(preId);
      if (!preCourse) continue;
      if (!preInCurr) {
        warnings.push({
          type: 'MISSING_PREREQUISITE_IN_CURRICULUM',
          course_id: s.course_id,
          course_code: s.course_code,
          prerequisite_course_id: preId,
          prerequisite_code: preCourse.code,
          message: `Môn "${s.course_code} – ${s.course_title}" yêu cầu môn tiên quyết "${preCourse.code} – ${preCourse.title}" chưa có trong khung chương trình.`,
        });
      } else if (preInCurr.rankTuple >= s.rank_tuple) {
        warnings.push({
          type: 'PREREQUISITE_ORDER_VIOLATION',
          course_id: s.course_id,
          course_code: s.course_code,
          prerequisite_course_id: preId,
          prerequisite_code: preCourse.code,
          message: `Cảnh báo thứ tự: Môn tiên quyết "${preCourse.code}" đang xếp sau hoặc ngang vị trí với môn phụ thuộc "${s.course_code}".`,
        });
      }
    }
  }

  const fees = await db
    .prepare('SELECT * FROM curriculum_service_fees WHERE curriculum_id = ? ORDER BY sort_order, id')
    .all(curriculumId);

  const subjectsTuition = enrichedSubjects
    .filter((s) => Boolean(s.is_mandatory))
    .reduce((sum, s) => sum + Number(s.reference_tuition_fee || 0), 0);
  const servicesTuition = fees
    .filter((f) => Boolean(f.is_mandatory))
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const autoTuition = subjectsTuition + servicesTuition;
  const finalTuition = curr.is_tuition_overridden ? Number(curr.final_tuition_fee || 0) : autoTuition;

  await db.prepare('UPDATE curricula SET auto_tuition_fee = ?, final_tuition_fee = ? WHERE id = ?')
    .run(autoTuition, finalTuition, curriculumId);

  const totalPeriods = enrichedSubjects.reduce((sum, s) => sum + s.effective_periods, 0);
  const totalHours = Math.round(enrichedSubjects.reduce((sum, s) => sum + s.effective_hours, 0) * 10) / 10;

  const stageSummaries = stages.map((stg) => {
    const items = enrichedSubjects.filter((s) => s.stage_id === stg.id);
    return {
      ...stg,
      subjects_count: items.length,
      total_periods: items.reduce((sum, x) => sum + x.effective_periods, 0),
      total_hours: Math.round(items.reduce((sum, x) => sum + x.effective_hours, 0) * 10) / 10,
    };
  });

  return {
    stages: stageSummaries,
    subjects: enrichedSubjects,
    service_fees: fees,
    prerequisite_warnings: warnings,
    totals: {
      subjects_count: enrichedSubjects.length,
      mandatory_count: enrichedSubjects.filter((s) => Boolean(s.is_mandatory)).length,
      elective_count: enrichedSubjects.filter((s) => !s.is_mandatory).length,
      total_periods: totalPeriods,
      total_hours: totalHours,
      subjects_tuition: subjectsTuition,
      services_tuition: servicesTuition,
      auto_tuition_fee: autoTuition,
      final_tuition_fee: finalTuition,
      is_tuition_overridden: Boolean(curr.is_tuition_overridden),
    },
  };
}

async function generateDefaultSessionPlansForCourse(db, courseId, curriculumId = null) {
  const course = await requireCourseRow(db, courseId);
  const minsPerPeriod = Number(course.minutes_per_period || 45);
  const roomType = course.required_room_type || 'THEORY_ROOM';
  const lessons = await db
    .prepare(
      `SELECT l.id, l.title, l.duration_minutes, ch.title AS chapter_title
       FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
       WHERE ch.course_id = ? AND ch.status <> 'ARCHIVED' AND l.publish_status <> 'ARCHIVED'
       ORDER BY ch.sort_order, l.sort_order`
    )
    .all(courseId);

  const scopeType = curriculumId ? 'CURRICULUM_SUBJECT' : 'COURSE';
  const now = nowIso();
  await tx(db, async () => {
    if (curriculumId) {
      await db.prepare("DELETE FROM session_plan_items WHERE scope_type = 'CURRICULUM_SUBJECT' AND course_id = ? AND curriculum_id = ?")
        .run(courseId, curriculumId);
    } else {
      await db.prepare("DELETE FROM session_plan_items WHERE scope_type = 'COURSE' AND course_id = ?").run(courseId);
    }

    for (const [idx, l] of (lessons).entries()) {
      const dur = Math.max(minsPerPeriod, Number(l.duration_minutes || minsPerPeriod * 2));
      const periods = Math.max(1, Math.round((dur / minsPerPeriod) * 10) / 10);
      await db.prepare(
        `INSERT INTO session_plan_items (
           id, scope_type, course_id, curriculum_id, session_order, title,
           duration_minutes, periods_count, delivery_mode, required_room_type, lesson_ids_json, note, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `spi_${crypto.randomBytes(5).toString('hex')}`,
        scopeType,
        courseId,
        curriculumId || null,
        idx + 1,
        `Buổi ${idx + 1}: ${l.title}`,
        dur,
        periods,
        roomType === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
        roomType,
        JSON.stringify([l.id]),
        `${l.chapter_title}`,
        now
      );
    }
  });

  return await getEffectiveSessionPlan(db, courseId, curriculumId);
}

export async function getEffectiveSessionPlan(db, courseId, curriculumId = null) {
  let rows = [];
  if (curriculumId) {
    rows = await db
      .prepare("SELECT * FROM session_plan_items WHERE scope_type = 'CURRICULUM_SUBJECT' AND course_id = ? AND curriculum_id = ? ORDER BY session_order")
      .all(courseId, curriculumId);
  }
  if (!rows.length) {
    rows = await db
      .prepare("SELECT * FROM session_plan_items WHERE scope_type = 'COURSE' AND course_id = ? ORDER BY session_order")
      .all(courseId);
  }
  const lessonMap = new Map(
    (await db.prepare(
      `SELECT l.id, l.title, l.duration_minutes, ch.title AS chapter_title
       FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ch.course_id = ?`
    ).all(courseId)).map((l) => [l.id, l])
  );

  return rows.map((r) => {
    const lessonIds = safeJson(r.lesson_ids_json, []);
    return {
      ...r,
      lesson_ids: lessonIds,
      lessons: lessonIds.map((id) => lessonMap.get(id)).filter(Boolean),
    };
  });
}

async function isHolidayDate(db, dateStr, campusId = null) {
  const mmdd = dateStr.slice(5);
  const rows = await db.prepare('SELECT * FROM academic_holidays WHERE campus_id IS NULL OR campus_id = ?').all(campusId || '');
  return rows.some((h) => {
    if (h.start_date <= dateStr && dateStr <= h.end_date) return true;
    if (h.is_recurring_yearly) {
      const startMd = String(h.start_date || '').slice(5);
      const endMd = String(h.end_date || '').slice(5);
      if (startMd && endMd && startMd <= mmdd && mmdd <= endMd) return true;
    }
    return false;
  });
}

export function registerTrainingPrepRoutes(route) {
  // =========================================================================
  // 1.1 MÔN HỌC — THÔNG TIN, TIÊN QUYẾT, ĐẦU ĐIỂM, ĐỀ CƯƠNG & PHIÊN BẢN
  // =========================================================================

  route('GET', '/courses/:id/training-profile', async ({ db, user, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem môn học này.');

    const prereqs = await db
      .prepare(
        `SELECT cp.id, cp.prerequisite_course_id, cp.note, c.code, c.title, c.lifecycle_status
         FROM course_prerequisites cp JOIN courses c ON c.id = cp.prerequisite_course_id
         WHERE cp.course_id = ? ORDER BY c.code`
      )
      .all(course.id);

    const candidateCourses = await db
      .prepare("SELECT id, code, title, subject, lifecycle_status FROM courses WHERE id <> ? AND status <> 'ARCHIVED' ORDER BY code")
      .all(course.id);

    const components = (await db
      .prepare('SELECT * FROM course_assessment_components WHERE course_id = ? ORDER BY sort_order, id')
      .all(course.id))
      .map((c) => ({ ...c, source_config: safeJson(c.source_config_json, {}), is_mandatory: Boolean(c.is_mandatory) }));

    const weightSum = Math.round(components.reduce((s, c) => s + Number(c.weight_pct || 0), 0) * 100) / 100;
    const minsPerPeriod = Number(course.minutes_per_period || 45);
    const totalPeriods = Number(course.theory_periods || 0) + Number(course.practice_periods || 0) + Number(course.self_study_periods || 0);
    const totalHours = Math.round(((totalPeriods * minsPerPeriod) / 60) * 10) / 10;

    const versions = await db
      .prepare('SELECT id, version_number, version_label, status, changelog_note, published_by_name, published_at FROM course_versions WHERE course_id = ? ORDER BY version_number DESC')
      .all(course.id);

    const lessons = await db
      .prepare(
        `SELECT l.id, l.title, l.duration_minutes, ch.title AS chapter_title
         FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
         WHERE ch.course_id = ? AND ch.status <> 'ARCHIVED' AND l.publish_status <> 'ARCHIVED'
         ORDER BY ch.sort_order, l.sort_order`
      )
      .all(course.id);

    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        subject: course.subject || '',
        department_id: course.department_id || '',
        department_name: course.department_name || '',
        instructor_id: course.instructor_id,
        instructor_name: course.instructor_name,
        description: course.description || '',
        objectives: course.objectives || '',
        outcomes: safeJson(course.outcomes_json, []),
        reference_tuition_fee: Number(course.reference_tuition_fee || 0),
        theory_periods: Number(course.theory_periods || 0),
        practice_periods: Number(course.practice_periods || 0),
        self_study_periods: Number(course.self_study_periods || 0),
        minutes_per_period: minsPerPeriod,
        total_periods: totalPeriods,
        total_hours: totalHours,
        required_room_type: course.required_room_type || 'THEORY_ROOM',
        grading_scale: Number(course.grading_scale || 10),
        pass_score: Number(course.pass_score || 5),
        exam_conditions: safeJson(course.exam_conditions_json, { min_attendance_pct: 70, require_all_mandatory_assignments: true }),
        lifecycle_status: course.lifecycle_status || (course.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'),
        version_code: course.version_code || 'v2026.1',
      },
      prerequisites: prereqs,
      candidate_courses: candidateCourses,
      assessment_components: components,
      weight_sum_pct: weightSum,
      is_weight_valid: components.length === 0 || Math.abs(weightSum - 100) < 0.01,
      session_plan: await getEffectiveSessionPlan(db, course.id),
      lessons,
      versions,
      capabilities: {
        can_manage: canManageCourse(db, user, course),
        can_approve: isAdmin(user) || (isStaff(user) && (!course.department_id || course.department_id === user.department_id)),
      },
    };
  });

  route('PUT', '/courses/:id/training-profile', async ({ db, user, body, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền cập nhật thông số đào tạo của môn học.');

    const outcomes = Array.isArray(body.outcomes)
      ? body.outcomes
          .map((o, i) => {
            if (typeof o === 'string') return { code: `CLO${i + 1}`, text: o.trim().slice(0, 500) };
            return {
              code: String(o?.code || `CLO${i + 1}`).trim().slice(0, 24),
              text: String(o?.text || '').trim().slice(0, 500),
            };
          })
          .filter((o) => o.text)
      : safeJson(course.outcomes_json, []);

    const refTuition = Math.max(0, Number(body.reference_tuition_fee ?? course.reference_tuition_fee ?? 0) || 0);
    const theoryPeriods = Math.max(0, Math.round(Number(body.theory_periods ?? course.theory_periods ?? 0) || 0));
    const practicePeriods = Math.max(0, Math.round(Number(body.practice_periods ?? course.practice_periods ?? 0) || 0));
    const selfStudyPeriods = Math.max(0, Math.round(Number(body.self_study_periods ?? course.self_study_periods ?? 0) || 0));
    const minsPerPeriod = intField(body, 'minutes_per_period', { min: 15, max: 180, label: 'số phút mỗi tiết' }) ?? Number(course.minutes_per_period || 45);
    const roomType = oneOf(body, 'required_room_type', ROOM_TYPES, { fallback: course.required_room_type || 'THEORY_ROOM', label: 'loại phòng yêu cầu' });
    const rawScale = body.grading_scale ?? course.grading_scale ?? 10;
    const parsedScale = rawScale === 'SCALE_4' ? 4 : rawScale === 'SCALE_100' ? 100 : rawScale === 'SCALE_10' ? 10 : Number(rawScale);
    const gradingScale = Math.max(4, Number.isFinite(parsedScale) ? parsedScale : 10);
    const parsedPass = Number(body.pass_score ?? course.pass_score ?? 5);
    const passScore = Math.max(0, Math.min(gradingScale, Number.isFinite(parsedPass) ? parsedPass : 5));

    const prevExamCond = safeJson(course.exam_conditions_json, { min_attendance_pct: 70, require_all_mandatory_assignments: true });
    const examCond = body.exam_conditions && typeof body.exam_conditions === 'object'
      ? {
          min_attendance_pct: Math.max(0, Math.min(100, Number(body.exam_conditions.min_attendance_pct ?? prevExamCond.min_attendance_pct ?? 70))),
          require_all_mandatory_assignments: Boolean(body.exam_conditions.require_all_mandatory_assignments ?? prevExamCond.require_all_mandatory_assignments ?? true),
          extra_note: String(body.exam_conditions.extra_note ?? prevExamCond.extra_note ?? '').slice(0, 500),
        }
      : prevExamCond;

    // Nếu môn đang PUBLISHED mà chỉnh sửa -> tự động mở phiên bản nháp kế tiếp (1.2.6)
    let nextLifecycle = course.lifecycle_status || 'PUBLISHED';
    let nextVerCode = course.version_code || 'v2026.1';
    if (nextLifecycle === 'PUBLISHED' && body.fork_new_version !== false) {
      const hasSnap = await db.prepare('SELECT 1 FROM course_versions WHERE course_id = ? LIMIT 1').get(course.id);
      if (!hasSnap) {
        const snap = await buildCourseSnapshotPayload(db, course.id);
        await db.prepare(
          `INSERT INTO course_versions (id, course_id, version_number, version_label, status, snapshot_json, changelog_note, published_by, published_by_name, published_at)
           VALUES (?, ?, 1, ?, 'PUBLISHED', ?, 'Bản lưu tự động trước khi chỉnh sửa phiên bản mới', ?, ?, ?)`
        ).run(`cver_${crypto.randomBytes(5).toString('hex')}`, course.id, nextVerCode, JSON.stringify(snap), user.id, user.full_name, nowIso());
      }
      nextLifecycle = 'DRAFT';
      nextVerCode = nextVersionLabel(nextVerCode);
    }

    const now = nowIso();
    await db.prepare(
      `UPDATE courses SET
         description = COALESCE(?, description),
         objectives = COALESCE(?, objectives),
         department_name = COALESCE(?, department_name),
         outcomes_json = ?,
         reference_tuition_fee = ?,
         theory_periods = ?,
         practice_periods = ?,
         self_study_periods = ?,
         minutes_per_period = ?,
         required_room_type = ?,
         grading_scale = ?,
         pass_score = ?,
         exam_conditions_json = ?,
         lifecycle_status = ?,
         version_code = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      'description' in body ? text(body, 'description', { max: 2000, label: 'mô tả' }) : null,
      'objectives' in body ? text(body, 'objectives', { max: 5000, label: 'mục tiêu' }) : null,
      'department_name' in body ? text(body, 'department_name', { max: 120, label: 'tổ / bộ môn' }) : null,
      JSON.stringify(outcomes),
      refTuition,
      theoryPeriods,
      practicePeriods,
      selfStudyPeriods,
      minsPerPeriod,
      roomType,
      gradingScale,
      passScore,
      JSON.stringify(examCond),
      nextLifecycle,
      nextVerCode,
      now,
      course.id
    );

    // Cập nhật lại tổng học phí tham chiếu ở các khung chương trình có chứa môn này
    const linkedCurrs = await db.prepare('SELECT DISTINCT curriculum_id FROM curriculum_subjects WHERE course_id = ?').all(course.id);
    for (const lc of linkedCurrs) await computeCurriculumStructureAndTotals(db, lc.curriculum_id);

    const refreshed = await requireCourseRow(db, course.id);
    return {
      updated: true,
      lifecycle_status: nextLifecycle,
      version_code: nextVerCode,
      course: {
        id: refreshed.id,
        code: refreshed.code,
        title: refreshed.title,
        outcomes: safeJson(refreshed.outcomes_json, []),
        reference_tuition_fee: Number(refreshed.reference_tuition_fee || 0),
        theory_periods: Number(refreshed.theory_periods || 0),
        practice_periods: Number(refreshed.practice_periods || 0),
        self_study_periods: Number(refreshed.self_study_periods || 0),
        minutes_per_period: Number(refreshed.minutes_per_period || 45),
        required_room_type: refreshed.required_room_type || 'THEORY_ROOM',
        grading_scale: Number(refreshed.grading_scale || 10),
        pass_score: Number(refreshed.pass_score || 5),
        exam_conditions: safeJson(refreshed.exam_conditions_json, {}),
        lifecycle_status: nextLifecycle,
        version_code: nextVerCode,
      },
    };
  });

  route('PUT', '/courses/:id/prerequisites', async ({ db, user, body, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền cập nhật môn tiên quyết.');
    const items = Array.isArray(body.prerequisite_course_ids) ? [...new Set(body.prerequisite_course_ids.map(String))] : [];
    if (items.includes(course.id)) {
      fail(422, 'SELF_PREREQUISITE', 'Một môn học không thể là môn tiên quyết của chính nó.');
    }
    for (const pid of items) {
      if (!await db.prepare('SELECT 1 FROM courses WHERE id = ?').get(pid)) {
        fail(404, 'PREREQUISITE_NOT_FOUND', `Không tìm thấy môn tiên quyết (${pid}).`);
      }
    }
    if (await hasPrerequisiteCycle(db, course.id, items)) {
      fail(422, 'PREREQUISITE_CYCLE_DETECTED', 'Phát hiện vòng lặp môn tiên quyết (A tiên quyết B nhưng B lại phụ thuộc A).');
    }

    const now = nowIso();
    await tx(db, async () => {
      await db.prepare('DELETE FROM course_prerequisites WHERE course_id = ?').run(course.id);
      for (const pid of items) {
        await db.prepare(
          `INSERT INTO course_prerequisites (id, course_id, prerequisite_course_id, note, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(`cpr_${crypto.randomBytes(5).toString('hex')}`, course.id, pid, String(body.note || '').slice(0, 300), now);
      }
    });
    return { course_id: course.id, prerequisite_course_ids: items };
  });

  route('PUT', '/courses/:id/assessment-components', async ({ db, user, body, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền cấu hình đầu điểm môn học.');
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) fail(422, 'VALIDATION_ERROR', 'Cần ít nhất 1 đầu điểm đánh giá.');

    const normalized = rawItems.map((it, idx) => {
      const title = String(it?.title || '').trim();
      if (!title) fail(422, 'VALIDATION_ERROR', `Đầu điểm thứ ${idx + 1} thiếu tên gọi.`);
      const weight = Number(it?.weight_pct || 0);
      if (Number.isNaN(weight) || weight <= 0 || weight > 100) {
        fail(422, 'VALIDATION_ERROR', `Trọng số của "${title}" phải lớn hơn 0% và tối đa 100%.`);
      }
      const sourceType = ASSESSMENT_SOURCES.includes(it?.source_type) ? it.source_type : 'MANUAL';
      return {
        code: String(it?.code || `D${idx + 1}`).trim().toUpperCase().slice(0, 24),
        title: title.slice(0, 200),
        weight_pct: Math.round(weight * 100) / 100,
        source_type: sourceType,
        source_config: it?.source_config && typeof it.source_config === 'object' ? it.source_config : {},
        is_mandatory: Boolean(it?.is_mandatory ?? true),
        sort_order: (idx + 1) * 10,
      };
    });

    const sum = Math.round(normalized.reduce((s, x) => s + x.weight_pct, 0) * 100) / 100;
    if (Math.abs(sum - 100) >= 0.01) {
      fail(422, 'ASSESSMENT_WEIGHT_SUM_INVALID', `Tổng trọng số các đầu điểm phải đúng bằng 100% (hiện tại: ${sum}%).`);
    }

    const now = nowIso();
    await tx(db, async () => {
      await db.prepare('DELETE FROM course_assessment_components WHERE course_id = ?').run(course.id);
      for (const c of normalized) {
        await db.prepare(
          `INSERT INTO course_assessment_components (id, course_id, code, title, weight_pct, source_type, source_config_json, is_mandatory, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `cac_${crypto.randomBytes(5).toString('hex')}`,
          course.id,
          c.code,
          c.title,
          c.weight_pct,
          c.source_type,
          JSON.stringify(c.source_config),
          c.is_mandatory ? 1 : 0,
          c.sort_order,
          now,
          now
        );
      }
    });

    return { items: normalized, weight_sum_pct: sum };
  });

  // 1.1.5 Đề cương môn học hợp nhất & gắn tag Bắt buộc / Tham khảo
  route('GET', '/courses/:id/syllabus', async ({ db, user, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem đề cương môn học.');

    const topics = await db.prepare("SELECT * FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, id").all(course.id);
    const chapters = await db.prepare("SELECT * FROM chapters WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, id").all(course.id);
    const lessons = await db
      .prepare(
        `SELECT l.* FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
         WHERE ch.course_id = ? AND ch.status <> 'ARCHIVED' AND l.publish_status <> 'ARCHIVED'
         ORDER BY l.sort_order, l.id`
      )
      .all(course.id);

    const questions = await db
      .prepare('SELECT id, lesson_id, question_type, difficulty, prompt, points FROM question_bank_items WHERE course_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(course.id);
    const assignments = await db
      .prepare('SELECT id, lesson_id, title, submission_type, max_score, relative_due_days, is_mandatory FROM assignment_bank_items WHERE course_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(course.id);
    const resources = (await db
      .prepare('SELECT id, lesson_id, title, resource_type, storage_provider, storage_key, file_name, usage_type, tags_json FROM learning_resources WHERE course_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(course.id))
      .map((r) => ({
        ...r,
        url: r.storage_provider === 'EXTERNAL_URL' ? r.storage_key : null,
        usage_type: r.usage_type || 'MANDATORY',
        tags: safeJson(r.tags_json, []),
      }));

    const qByLesson = {};
    const aByLesson = {};
    const rByLesson = {};
    questions.forEach((q) => { if (q.lesson_id) (qByLesson[q.lesson_id] ||= []).push(q); });
    assignments.forEach((a) => { if (a.lesson_id) (aByLesson[a.lesson_id] ||= []).push({ ...a, is_mandatory: Boolean(a.is_mandatory) }); });
    resources.forEach((r) => { if (r.lesson_id) (rByLesson[r.lesson_id] ||= []).push(r); });

    const chByTopic = {};
    for (const ch of chapters) {
      const chLessons = lessons
        .filter((l) => l.chapter_id === ch.id)
        .map((l) => ({
          id: l.id,
          code: l.code,
          title: l.title,
          duration_minutes: l.duration_minutes,
          publish_status: l.publish_status,
          questions: qByLesson[l.id] || [],
          assignments: aByLesson[l.id] || [],
          resources: rByLesson[l.id] || [],
        }));
      const tid = ch.topic_id || (topics[0]?.id || 'default');
      (chByTopic[tid] ||= []).push({ id: ch.id, code: ch.code, title: ch.title, lessons: chLessons });
    }

    return {
      course: { id: course.id, code: course.code, title: course.title },
      tree: topics.map((tp) => ({
        id: tp.id,
        code: tp.code,
        title: tp.title,
        chapters: chByTopic[tp.id] || [],
      })),
    };
  });

  route('PATCH', '/resources/:id/usage', async ({ db, user, body, params }) => {
    const res = await db.prepare('SELECT * FROM learning_resources WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!res) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài liệu.');
    const course = await requireCourseRow(db, res.course_id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền cập nhật gắn nhãn tài liệu.');
    const usageType = oneOf(body, 'usage_type', ['MANDATORY', 'REFERENCE'], { fallback: res.usage_type || 'MANDATORY', label: 'phân loại tài liệu' });
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : safeJson(res.tags_json, []);
    await db.prepare('UPDATE learning_resources SET usage_type = ?, tags_json = ?, updated_at = ? WHERE id = ?')
      .run(usageType, JSON.stringify(tags), nowIso(), res.id);
    return { id: res.id, usage_type: usageType, tags };
  });

  route('PATCH', '/banks/assignments/:id/meta', async ({ db, user, body, params }) => {
    const row = await db.prepare('SELECT * FROM assignment_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập mẫu.');
    const course = await requireCourseRow(db, row.course_id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa bài tập mẫu.');
    const relDays = body.relative_due_days === null || body.relative_due_days === ''
      ? null
      : Math.max(0, Math.min(90, Math.round(Number(body.relative_due_days))));
    const isMandatory = body.is_mandatory === undefined ? Boolean(row.is_mandatory) : Boolean(body.is_mandatory);
    await db.prepare('UPDATE assignment_bank_items SET relative_due_days = ?, is_mandatory = ?, updated_at = ? WHERE id = ?')
      .run(relDays, isMandatory ? 1 : 0, nowIso(), row.id);
    return { id: row.id, relative_due_days: relDays, is_mandatory: isMandatory };
  });

  // 1.2.4 Chia buổi học cho Môn học
  route('POST', '/courses/:id/session-plan/auto-generate', async ({ db, user, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chia buổi cho môn học.');
    return { items: await generateDefaultSessionPlansForCourse(db, course.id, null) };
  });

  route('PUT', '/courses/:id/session-plan', async ({ db, user, body, params }) => {
    const course = await requireCourseRow(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền lưu cấu hình chia buổi.');
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const minsPerPeriod = Number(course.minutes_per_period || 45);
    const now = nowIso();

    await tx(db, async () => {
      await db.prepare("DELETE FROM session_plan_items WHERE scope_type = 'COURSE' AND course_id = ?").run(course.id);
      for (const [idx, it] of (rawItems).entries()) {
        const dur = Math.max(15, Number(it?.duration_minutes || minsPerPeriod * 2));
        const periods = Number(it?.periods_count) > 0 ? Number(it.periods_count) : Math.round((dur / minsPerPeriod) * 10) / 10;
        const lessonIds = Array.isArray(it?.lesson_ids) ? it.lesson_ids.map(String) : [];
        await db.prepare(
          `INSERT INTO session_plan_items (
             id, scope_type, course_id, session_order, title, duration_minutes, periods_count,
             delivery_mode, required_room_type, lesson_ids_json, note, updated_at
           ) VALUES (?, 'COURSE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `spi_${crypto.randomBytes(5).toString('hex')}`,
          course.id,
          idx + 1,
          String(it?.title || `Buổi ${idx + 1}`).trim().slice(0, 240),
          dur,
          periods,
          it?.delivery_mode || 'OFFLINE',
          ROOM_TYPES.includes(it?.required_room_type) ? it.required_room_type : course.required_room_type || 'THEORY_ROOM',
          JSON.stringify(lessonIds),
          String(it?.note || '').slice(0, 300),
          now
        );
      }
    });

    return { items: await getEffectiveSessionPlan(db, course.id) };
  });

  // 1.2.6 Quy trình duyệt Ban hành & So sánh phiên bản Môn học
  route('POST', '/courses/:id/lifecycle', async ({ db, user, body, params }) => {
    const course = await requireCourseRow(db, params.id);
    const action = oneOf(body, 'action', ['SUBMIT_REVIEW', 'APPROVE_PUBLISH', 'RETURN_DRAFT', 'DEPRECATE', 'START_NEW_VERSION'], {
      required: true,
      label: 'thao tác phê duyệt',
    });
    const note = text(body, 'note', { max: 500, label: 'ghi chú' }) || '';
    const now = nowIso();

    if (action === 'SUBMIT_REVIEW') {
      if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền gửi duyệt môn học.');
      const comps = await db.prepare('SELECT weight_pct FROM course_assessment_components WHERE course_id = ?').all(course.id);
      if (comps.length > 0) {
        const sum = comps.reduce((s, c) => s + Number(c.weight_pct || 0), 0);
        if (Math.abs(sum - 100) >= 0.01) {
          fail(422, 'ASSESSMENT_WEIGHT_INVALID', `Tổng trọng số đầu điểm phải bằng 100% trước khi gửi duyệt (hiện tại ${sum}%).`);
        }
      }
      await db.prepare("UPDATE courses SET lifecycle_status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?").run(now, course.id);
      return { id: course.id, lifecycle_status: 'PENDING_APPROVAL' };
    }

    if (action === 'RETURN_DRAFT') {
      requireApprovePermission(user, course.department_id);
      await db.prepare("UPDATE courses SET lifecycle_status = 'DRAFT', updated_at = ? WHERE id = ?").run(now, course.id);
      return { id: course.id, lifecycle_status: 'DRAFT' };
    }

    if (action === 'START_NEW_VERSION') {
      if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền tạo phiên bản mới.');
      const nextLabel = nextVersionLabel(course.version_code || 'v2026.1');
      await db.prepare("UPDATE courses SET lifecycle_status = 'DRAFT', version_code = ?, updated_at = ? WHERE id = ?")
        .run(nextLabel, now, course.id);
      return { id: course.id, lifecycle_status: 'DRAFT', version_code: nextLabel };
    }

    if (action === 'DEPRECATE') {
      requireApprovePermission(user, course.department_id);
      await db.prepare("UPDATE courses SET lifecycle_status = 'DEPRECATED', status = 'INACTIVE', updated_at = ? WHERE id = ?")
        .run(now, course.id);
      return { id: course.id, lifecycle_status: 'DEPRECATED' };
    }

    // APPROVE_PUBLISH
    requireApprovePermission(user, course.department_id);
    const comps = await db.prepare('SELECT weight_pct FROM course_assessment_components WHERE course_id = ?').all(course.id);
    if (comps.length > 0) {
      const sum = comps.reduce((s, c) => s + Number(c.weight_pct || 0), 0);
      if (Math.abs(sum - 100) >= 0.01) {
        fail(422, 'ASSESSMENT_WEIGHT_INVALID', `Tổng trọng số đầu điểm phải bằng 100% trước khi ban hành.`);
      }
    }

    const maxVer = (await db.prepare('SELECT COALESCE(MAX(version_number), 0) m FROM course_versions WHERE course_id = ?').get(course.id)).m;
    const nextNum = maxVer + 1;
    const verLabel = text(body, 'version_label', { max: 40, label: 'nhãn phiên bản' }) || course.version_code || `v2026.${nextNum}`;
    const snap = await buildCourseSnapshotPayload(db, course.id);
    const verId = `cver_${crypto.randomBytes(5).toString('hex')}`;

    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO course_versions (id, course_id, version_number, version_label, status, snapshot_json, changelog_note, published_by, published_by_name, published_at)
         VALUES (?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?)`
      ).run(verId, course.id, nextNum, verLabel, JSON.stringify(snap), note || `Ban hành ${verLabel}`, user.id, user.full_name, now);
      await db.prepare("UPDATE courses SET lifecycle_status = 'PUBLISHED', status = 'PUBLISHED', version_code = ?, updated_at = ? WHERE id = ?")
        .run(verLabel, now, course.id);
    });

    return { id: course.id, lifecycle_status: 'PUBLISHED', version_id: verId, version_number: nextNum, version_label: verLabel };
  });

  route('GET', '/courses/:id/versions/compare', async ({ db, user, params, url }) => {
    const course = await requireCourseRow(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền so sánh phiên bản môn học.');

    const versions = await db.prepare('SELECT * FROM course_versions WHERE course_id = ? ORDER BY version_number DESC').all(course.id);
    const fromId = url.searchParams.get('from_id') || versions[1]?.id || versions[0]?.id;
    const toId = url.searchParams.get('to_id') || 'CURRENT';

    const fromSnap = fromId
      ? safeJson((await db.prepare('SELECT snapshot_json FROM course_versions WHERE id = ? AND course_id = ?').get(fromId, course.id))?.snapshot_json, null)
      : null;
    const toSnap = toId === 'CURRENT'
      ? await buildCourseSnapshotPayload(db, course.id)
      : safeJson((await db.prepare('SELECT snapshot_json FROM course_versions WHERE id = ? AND course_id = ?').get(toId, course.id))?.snapshot_json, null);

    if (!fromSnap || !toSnap) {
      return { available_versions: versions.map((v) => ({ id: v.id, version_number: v.version_number, version_label: v.version_label, published_at: v.published_at })), diff: null };
    }

    const fromLessons = new Map((fromSnap.lessons || []).map((l) => [l.id, l]));
    const toLessons = new Map((toSnap.lessons || []).map((l) => [l.id, l]));

    const lessonsAdded = [];
    const lessonsRemoved = [];
    const lessonsModified = [];

    for (const [id, l] of toLessons.entries()) {
      if (!fromLessons.has(id)) {
        lessonsAdded.push({ id, title: l.title, duration_minutes: l.duration_minutes });
      } else {
        const old = fromLessons.get(id);
        const oldBlocks = JSON.stringify((fromSnap.blocks_by_lesson || {})[id] || []);
        const newBlocks = JSON.stringify((toSnap.blocks_by_lesson || {})[id] || []);
        if (old.title !== l.title || Number(old.duration_minutes) !== Number(l.duration_minutes) || oldBlocks !== newBlocks) {
          lessonsModified.push({
            id,
            old_title: old.title,
            new_title: l.title,
            old_duration: old.duration_minutes,
            new_duration: l.duration_minutes,
            content_changed: oldBlocks !== newBlocks,
          });
        }
      }
    }
    for (const [id, l] of fromLessons.entries()) {
      if (!toLessons.has(id)) lessonsRemoved.push({ id, title: l.title, duration_minutes: l.duration_minutes });
    }

    return {
      available_versions: versions.map((v) => ({ id: v.id, version_number: v.version_number, version_label: v.version_label, published_at: v.published_at })),
      diff: {
        lessons_added: lessonsAdded,
        lessons_removed: lessonsRemoved,
        lessons_modified: lessonsModified,
        duration_before: {
          theory: fromSnap.course?.theory_periods ?? 0,
          practice: fromSnap.course?.practice_periods ?? 0,
          self_study: fromSnap.course?.self_study_periods ?? 0,
        },
        duration_after: {
          theory: toSnap.course?.theory_periods ?? 0,
          practice: toSnap.course?.practice_periods ?? 0,
          self_study: toSnap.course?.self_study_periods ?? 0,
        },
        tuition_before: fromSnap.course?.reference_tuition_fee ?? 0,
        tuition_after: toSnap.course?.reference_tuition_fee ?? 0,
        assessment_before: fromSnap.assessment_components || [],
        assessment_after: toSnap.assessment_components || [],
      },
    };
  });

  // =========================================================================
  // 1.2 KHUNG CHƯƠNG TRÌNH — HỌC PHÍ, GIAI ĐOẠN, CHIA BUỔI, TỐT NGHIỆP & BAN HÀNH
  // =========================================================================

  route('GET', '/curricula/:id/blueprint', async ({ db, user, params }) => {
    if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'PROGRAM_ACCESS_DENIED', 'Bạn không có quyền xem thiết kế Khung chương trình.');
    }
    const curr = await requireCurriculumRow(db, params.id);
    const structure = await computeCurriculumStructureAndTotals(db, curr.id);
    const freshCurr = await requireCurriculumRow(db, curr.id);

    const sessionPlansByCourse = {};
    for (const s of structure.subjects) {
      sessionPlansByCourse[s.course_id] = await getEffectiveSessionPlan(db, s.course_id, curr.id);
    }

    const versions = await db
      .prepare('SELECT id, version_number, version_label, changelog_note, published_by_name, published_at FROM curriculum_versions WHERE curriculum_id = ? ORDER BY version_number DESC')
      .all(curr.id);

    const templates = await db.prepare("SELECT * FROM certificate_templates WHERE status = 'ACTIVE' ORDER BY code").all();
    const auditLogs = await db.prepare('SELECT * FROM curriculum_audit_logs WHERE curriculum_id = ? ORDER BY created_at DESC LIMIT 40').all(curr.id);

    return {
      curriculum: {
        id: freshCurr.id,
        code: freshCurr.code,
        title: freshCurr.title,
        description: freshCurr.description || '',
        version: freshCurr.version || 'v2026.1',
        effective_date: freshCurr.effective_date || null,
        department_id: freshCurr.department_id || null,
        status: freshCurr.status,
        lifecycle_status: freshCurr.lifecycle_status || (freshCurr.status === 'ACTIVE' ? 'PUBLISHED' : freshCurr.status === 'ARCHIVED' ? 'DEPRECATED' : 'DRAFT'),
        program_type: freshCurr.program_type || 'INSTRUCTOR_LED',
        delivery_mode: freshCurr.delivery_mode || 'HYBRID',
        standard_duration_months: Number(freshCurr.standard_duration_months || 6),
        standard_duration_text: freshCurr.standard_duration_text || '6 tháng',
        target_audience: freshCurr.target_audience || '',
        entry_requirements: freshCurr.entry_requirements || '',
        auto_tuition_fee: Number(freshCurr.auto_tuition_fee || 0),
        final_tuition_fee: Number(freshCurr.final_tuition_fee || 0),
        is_tuition_overridden: Boolean(freshCurr.is_tuition_overridden),
        graduation_criteria: safeJson(freshCurr.graduation_criteria_json, {
          pass_all_mandatory: true,
          min_electives_passed: 0,
          min_avg_score: 5,
          min_attendance_pct: 80,
          extra_requirements: [],
          certificate_template_code: 'CERT-STD-2026',
        }),
      },
      ...structure,
      session_plans_by_course: sessionPlansByCourse,
      certificate_templates: templates,
      versions,
      audit_logs: auditLogs,
      capabilities: {
        can_manage: isAdmin(user) || (isStaff(user) && (!curr.department_id || curr.department_id === user.department_id)),
        can_approve: isAdmin(user) || (isStaff(user) && (!curr.department_id || curr.department_id === user.department_id)),
      },
    };
  });

  route('PUT', '/curricula/:id/blueprint', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);

    const programType = oneOf(body, 'program_type', ['INSTRUCTOR_LED', 'SELF_PACED'], { fallback: curr.program_type || 'INSTRUCTOR_LED', label: 'loại khung' });
    const deliveryMode = oneOf(body, 'delivery_mode', ['OFFLINE', 'ONLINE', 'HYBRID'], { fallback: curr.delivery_mode || 'HYBRID', label: 'hình thức đào tạo' });
    const stdMonths = Math.max(0.5, Number(body.standard_duration_months ?? curr.standard_duration_months ?? 6));
    const stdText = text(body, 'standard_duration_text', { max: 100, label: 'thời gian đào tạo chuẩn' }) || `${stdMonths} tháng`;
    const targetAud = text(body, 'target_audience', { max: 1000, label: 'đối tượng đầu vào' }) ?? curr.target_audience ?? '';
    const entryReq = text(body, 'entry_requirements', { max: 2000, label: 'điều kiện đầu vào' }) ?? curr.entry_requirements ?? '';

    const isOverridden = body.is_tuition_overridden !== undefined ? Boolean(body.is_tuition_overridden) : Boolean(curr.is_tuition_overridden);
    const manualTuition = Math.max(0, Number(body.final_tuition_fee ?? curr.final_tuition_fee ?? 0));

    const prevGrad = safeJson(curr.graduation_criteria_json, {});
    const grad = body.graduation_criteria && typeof body.graduation_criteria === 'object'
      ? {
          pass_all_mandatory: Boolean(body.graduation_criteria.pass_all_mandatory ?? prevGrad.pass_all_mandatory ?? true),
          min_electives_passed: Math.max(0, Math.round(Number(body.graduation_criteria.min_electives_passed ?? prevGrad.min_electives_passed ?? 0))),
          min_avg_score: Math.max(0, Number(body.graduation_criteria.min_avg_score ?? prevGrad.min_avg_score ?? 5)),
          min_attendance_pct: Math.max(0, Math.min(100, Number(body.graduation_criteria.min_attendance_pct ?? prevGrad.min_attendance_pct ?? 80))),
          extra_requirements: Array.isArray(body.graduation_criteria.extra_requirements)
            ? body.graduation_criteria.extra_requirements.map((x) => String(x).trim()).filter(Boolean)
            : prevGrad.extra_requirements || [],
          certificate_template_code: String(body.graduation_criteria.certificate_template_code || prevGrad.certificate_template_code || 'CERT-STD-2026'),
        }
      : prevGrad;

    let nextLifecycle = curr.lifecycle_status || 'PUBLISHED';
    let nextVer = curr.version || 'v2026.1';
    if (nextLifecycle === 'PUBLISHED' && body.fork_new_version !== false) {
      nextLifecycle = 'DRAFT';
      nextVer = nextVersionLabel(nextVer);
    }

    const now = nowIso();
    await db.prepare(
      `UPDATE curricula SET
         title = COALESCE(?, title),
         description = COALESCE(?, description),
         program_type = ?,
         delivery_mode = ?,
         standard_duration_months = ?,
         standard_duration_text = ?,
         target_audience = ?,
         entry_requirements = ?,
         is_tuition_overridden = ?,
         final_tuition_fee = ?,
         graduation_criteria_json = ?,
         lifecycle_status = ?,
         version = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      'title' in body ? text(body, 'title', { required: true, min: 3, max: 200, label: 'tên khung chương trình' }) : null,
      'description' in body ? text(body, 'description', { max: 2000, label: 'mô tả' }) : null,
      programType,
      deliveryMode,
      stdMonths,
      stdText,
      targetAud,
      entryReq,
      isOverridden ? 1 : 0,
      manualTuition,
      JSON.stringify(grad),
      nextLifecycle,
      nextVer,
      now,
      curr.id
    );

    await db.prepare(
      `INSERT INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at)
       VALUES (?, ?, 'BLUEPRINT_UPDATED', ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), curr.id, JSON.stringify({ version: nextVer, lifecycle_status: nextLifecycle }), user.id, user.full_name, now);

    return await computeCurriculumStructureAndTotals(db, curr.id);
  });

  route('PUT', '/curricula/:id/stages', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    const items = Array.isArray(body.items) ? body.items : [];
    const now = nowIso();

    await tx(db, async () => {
      const keepIds = new Set(items.map((x) => x.id).filter(Boolean));
      const existing = await db.prepare('SELECT id FROM curriculum_stages WHERE curriculum_id = ?').all(curr.id);
      for (const ex of existing) {
        if (!keepIds.has(ex.id)) {
          await db.prepare('UPDATE curriculum_subjects SET stage_id = NULL WHERE stage_id = ?').run(ex.id);
          await db.prepare('DELETE FROM curriculum_stages WHERE id = ?').run(ex.id);
        }
      }
      for (const [idx, st] of (items).entries()) {
        const id = st.id && keepIds.has(st.id) ? String(st.id) : `stg_${crypto.randomBytes(5).toString('hex')}`;
        const code = String(st.code || `GD${idx + 1}`).trim().toUpperCase().slice(0, 32);
        const title = String(st.title || `Giai đoạn ${idx + 1}`).trim().slice(0, 200);
        const stype = ['SEMESTER', 'PHASE', 'CUSTOM'].includes(st.stage_type) ? st.stage_type : 'PHASE';
        const order = (idx + 1) * 10;
        const found = await db.prepare('SELECT 1 FROM curriculum_stages WHERE id = ? AND curriculum_id = ?').get(id, curr.id);
        if (found) {
          await db.prepare('UPDATE curriculum_stages SET code = ?, title = ?, stage_type = ?, sort_order = ? WHERE id = ?')
            .run(code, title, stype, order, id);
        } else {
          await db.prepare('INSERT INTO curriculum_stages (id, curriculum_id, code, title, stage_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, curr.id, code, title, stype, order, now);
        }
      }
    });

    return await computeCurriculumStructureAndTotals(db, curr.id);
  });

  route('PUT', '/curricula/:id/structure', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    const items = Array.isArray(body.items) ? body.items : [];

    await tx(db, async () => {
      for (const [idx, it] of (items).entries()) {
        if (!it.id) continue;
        const prereqs = Array.isArray(it.prerequisite_course_ids) ? it.prerequisite_course_ids.map(String) : [];
        const periods = Math.max(1, Math.round(Number(it.planned_periods || 30)));
        const hours = Math.round(((periods * 45) / 60) * 10) / 10;
        await db.prepare(
          `UPDATE curriculum_subjects SET
             stage_id = ?,
             semester_order = ?,
             sort_order = ?,
             planned_periods = ?,
             planned_hours = ?,
             is_mandatory = ?,
             prerequisite_course_ids_json = ?,
             note = COALESCE(?, note)
           WHERE id = ? AND curriculum_id = ?`
        ).run(
          it.stage_id || null,
          Math.max(1, Number(it.semester_order || 1)),
          Number(it.sort_order ?? (idx + 1) * 10),
          periods,
          hours,
          it.is_mandatory === false ? 0 : 1,
          JSON.stringify(prereqs),
          it.note !== undefined ? String(it.note).slice(0, 300) : null,
          it.id,
          curr.id
        );
      }
    });

    return await computeCurriculumStructureAndTotals(db, curr.id);
  });

  route('PUT', '/curricula/:id/service-fees', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    const items = Array.isArray(body.items) ? body.items : [];
    const now = nowIso();

    await tx(db, async () => {
      await db.prepare('DELETE FROM curriculum_service_fees WHERE curriculum_id = ?').run(curr.id);
      for (const [idx, f] of (items).entries()) {
        const title = String(f?.title || '').trim();
        if (!title) continue;
        await db.prepare(
          `INSERT INTO curriculum_service_fees (id, curriculum_id, code, title, amount, is_mandatory, note, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `fee_${crypto.randomBytes(5).toString('hex')}`,
          curr.id,
          String(f?.code || `PHI-${idx + 1}`).trim().toUpperCase().slice(0, 32),
          title.slice(0, 200),
          Math.max(0, Number(f?.amount || 0)),
          f?.is_mandatory === false ? 0 : 1,
          String(f?.note || '').slice(0, 300),
          (idx + 1) * 10,
          now
        );
      }
    });

    return await computeCurriculumStructureAndTotals(db, curr.id);
  });

  route('POST', '/curricula/:id/session-plans/:courseId/auto-generate', async ({ db, user, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    return { items: await generateDefaultSessionPlansForCourse(db, params.courseId, curr.id) };
  });

  route('PUT', '/curricula/:id/session-plans/:courseId', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    const course = await requireCourseRow(db, params.courseId);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const minsPerPeriod = Number(course.minutes_per_period || 45);
    const now = nowIso();

    await tx(db, async () => {
      await db.prepare("DELETE FROM session_plan_items WHERE scope_type = 'CURRICULUM_SUBJECT' AND course_id = ? AND curriculum_id = ?")
        .run(course.id, curr.id);
      for (const [idx, it] of (rawItems).entries()) {
        const dur = Math.max(15, Number(it?.duration_minutes || minsPerPeriod * 2));
        const periods = Number(it?.periods_count) > 0 ? Number(it.periods_count) : Math.round((dur / minsPerPeriod) * 10) / 10;
        const lessonIds = Array.isArray(it?.lesson_ids) ? it.lesson_ids.map(String) : [];
        await db.prepare(
          `INSERT INTO session_plan_items (
             id, scope_type, course_id, curriculum_id, session_order, title, duration_minutes, periods_count,
             delivery_mode, required_room_type, lesson_ids_json, note, updated_at
           ) VALUES (?, 'CURRICULUM_SUBJECT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `spi_${crypto.randomBytes(5).toString('hex')}`,
          course.id,
          curr.id,
          idx + 1,
          String(it?.title || `Buổi ${idx + 1}`).trim().slice(0, 240),
          dur,
          periods,
          it?.delivery_mode || curr.delivery_mode || 'OFFLINE',
          ROOM_TYPES.includes(it?.required_room_type) ? it.required_room_type : course.required_room_type || 'THEORY_ROOM',
          JSON.stringify(lessonIds),
          String(it?.note || '').slice(0, 300),
          now
        );
      }
    });

    return { items: await getEffectiveSessionPlan(db, course.id, curr.id) };
  });

  // 1.2.6 Duyệt Ban hành, Snapshot & Diff Khung chương trình
  route('POST', '/curricula/:id/lifecycle', async ({ db, user, body, params }) => {
    const curr = await requireCurriculumRow(db, params.id);
    requireApprovePermission(user, curr.department_id);
    const action = oneOf(body, 'action', ['SUBMIT_REVIEW', 'APPROVE_PUBLISH', 'RETURN_DRAFT', 'DEPRECATE', 'START_NEW_VERSION'], {
      required: true,
      label: 'thao tác trạng thái khung',
    });
    const note = text(body, 'note', { max: 500, label: 'ghi chú' }) || '';
    const now = nowIso();

    if (action === 'SUBMIT_REVIEW') {
      const calc = await computeCurriculumStructureAndTotals(db, curr.id);
      if (calc.subjects.length === 0) fail(422, 'CURRICULUM_EMPTY', 'Khung chương trình cần có ít nhất 1 môn học trước khi gửi duyệt.');
      await db.prepare("UPDATE curricula SET lifecycle_status = 'PENDING_APPROVAL', status = 'DRAFT', updated_at = ? WHERE id = ?").run(now, curr.id);
      await db.prepare(`INSERT INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at) VALUES (?, ?, 'SUBMITTED_FOR_REVIEW', ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), curr.id, JSON.stringify({ note }), user.id, user.full_name, now);
      return { id: curr.id, lifecycle_status: 'PENDING_APPROVAL', prerequisite_warnings: calc.prerequisite_warnings };
    }

    if (action === 'RETURN_DRAFT') {
      await db.prepare("UPDATE curricula SET lifecycle_status = 'DRAFT', status = 'DRAFT', updated_at = ? WHERE id = ?").run(now, curr.id);
      return { id: curr.id, lifecycle_status: 'DRAFT' };
    }

    if (action === 'START_NEW_VERSION') {
      const nextVer = nextVersionLabel(curr.version || 'v2026.1');
      await db.prepare("UPDATE curricula SET lifecycle_status = 'DRAFT', version = ?, updated_at = ? WHERE id = ?").run(nextVer, now, curr.id);
      return { id: curr.id, lifecycle_status: 'DRAFT', version: nextVer };
    }

    if (action === 'DEPRECATE') {
      await db.prepare("UPDATE curricula SET lifecycle_status = 'DEPRECATED', status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now, curr.id);
      await db.prepare(`INSERT INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at) VALUES (?, ?, 'DEPRECATED', ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), curr.id, JSON.stringify({ note }), user.id, user.full_name, now);
      return { id: curr.id, lifecycle_status: 'DEPRECATED' };
    }

    // APPROVE_PUBLISH
    const calc = await computeCurriculumStructureAndTotals(db, curr.id);
    if (calc.subjects.length === 0) fail(422, 'CURRICULUM_EMPTY', 'Khung chương trình chưa có môn học nào để ban hành.');
    const maxNum = (await db.prepare('SELECT COALESCE(MAX(version_number), 0) m FROM curriculum_versions WHERE curriculum_id = ?').get(curr.id)).m;
    const nextNum = maxNum + 1;
    const verLabel = text(body, 'version_label', { max: 40, label: 'nhãn phiên bản' }) || curr.version || `v2026.${nextNum}`;

    const snapshot = {
      version_label: verLabel,
      program_type: curr.program_type || 'INSTRUCTOR_LED',
      delivery_mode: curr.delivery_mode || 'HYBRID',
      standard_duration_months: Number(curr.standard_duration_months || 6),
      final_tuition_fee: calc.totals.final_tuition_fee,
      auto_tuition_fee: calc.totals.auto_tuition_fee,
      total_periods: calc.totals.total_periods,
      total_hours: calc.totals.total_hours,
      graduation_criteria: safeJson(curr.graduation_criteria_json, {}),
      stages: calc.stages,
      service_fees: calc.service_fees,
      subjects: calc.subjects.map((s) => ({
        course_id: s.course_id,
        code: s.course_code,
        title: s.course_title,
        stage_id: s.stage_id,
        periods: s.effective_periods,
        hours: s.effective_hours,
        is_mandatory: Boolean(s.is_mandatory),
      })),
    };

    const verId = `kver_${crypto.randomBytes(5).toString('hex')}`;
    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO curriculum_versions (id, curriculum_id, version_number, version_label, snapshot_json, changelog_note, published_by, published_by_name, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(verId, curr.id, nextNum, verLabel, JSON.stringify(snapshot), note || `Ban hành ${verLabel}`, user.id, user.full_name, now);
      await db.prepare("UPDATE curricula SET lifecycle_status = 'PUBLISHED', status = 'ACTIVE', version = ?, effective_date = COALESCE(effective_date, ?), updated_at = ? WHERE id = ?")
        .run(verLabel, vnDate(), now, curr.id);
      await db.prepare(`INSERT INTO curriculum_audit_logs (id, curriculum_id, action_type, payload_json, actor_id, actor_name, created_at) VALUES (?, ?, 'PUBLISHED_VERSION', ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), curr.id, JSON.stringify({ version_id: verId, version_label: verLabel, note }), user.id, user.full_name, now);
    });

    return { id: curr.id, lifecycle_status: 'PUBLISHED', version_id: verId, version_number: nextNum, version_label: verLabel };
  });

  route('GET', '/curricula/:id/versions/compare', async ({ db, user, params, url }) => {
    if (!isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'PROGRAM_ACCESS_DENIED', 'Bạn không có quyền xem phiên bản Khung chương trình.');
    }
    const curr = await requireCurriculumRow(db, params.id);
    const versions = await db.prepare('SELECT * FROM curriculum_versions WHERE curriculum_id = ? ORDER BY version_number DESC').all(curr.id);
    const fromId = url.searchParams.get('from_id') || versions[1]?.id || versions[0]?.id;
    const toId = url.searchParams.get('to_id') || 'CURRENT';

    const fromSnap = fromId
      ? safeJson((await db.prepare('SELECT snapshot_json FROM curriculum_versions WHERE id = ? AND curriculum_id = ?').get(fromId, curr.id))?.snapshot_json, null)
      : null;

    let toSnap = null;
    if (toId === 'CURRENT') {
      const calc = await computeCurriculumStructureAndTotals(db, curr.id);
      toSnap = {
        version_label: 'Bản hiện tại',
        final_tuition_fee: calc.totals.final_tuition_fee,
        total_periods: calc.totals.total_periods,
        total_hours: calc.totals.total_hours,
        graduation_criteria: safeJson(curr.graduation_criteria_json, {}),
        subjects: calc.subjects.map((s) => ({
          course_id: s.course_id,
          code: s.course_code,
          title: s.course_title,
          periods: s.effective_periods,
          is_mandatory: Boolean(s.is_mandatory),
        })),
      };
    } else {
      toSnap = safeJson((await db.prepare('SELECT snapshot_json FROM curriculum_versions WHERE id = ? AND curriculum_id = ?').get(toId, curr.id))?.snapshot_json, null);
    }

    if (!fromSnap || !toSnap) {
      return { available_versions: versions, diff: null };
    }

    const fromMap = new Map((fromSnap.subjects || []).map((s) => [s.course_id, s]));
    const toMap = new Map((toSnap.subjects || []).map((s) => [s.course_id, s]));
    const added = [];
    const removed = [];
    const changed = [];

    for (const [cid, s] of toMap.entries()) {
      if (!fromMap.has(cid)) added.push(s);
      else {
        const old = fromMap.get(cid);
        if (Number(old.periods) !== Number(s.periods) || Boolean(old.is_mandatory) !== Boolean(s.is_mandatory)) {
          changed.push({ course_id: cid, code: s.code, title: s.title, old_periods: old.periods, new_periods: s.periods });
        }
      }
    }
    for (const [cid, s] of fromMap.entries()) {
      if (!toMap.has(cid)) removed.push(s);
    }

    return {
      available_versions: versions.map((v) => ({ id: v.id, version_number: v.version_number, version_label: v.version_label, published_at: v.published_at })),
      diff: {
        subjects_added: added,
        subjects_removed: removed,
        subjects_changed: changed,
        periods_before: fromSnap.total_periods ?? 0,
        periods_after: toSnap.total_periods ?? 0,
        tuition_before: fromSnap.final_tuition_fee ?? 0,
        tuition_after: toSnap.final_tuition_fee ?? 0,
        graduation_changed: JSON.stringify(fromSnap.graduation_criteria || {}) !== JSON.stringify(toSnap.graduation_criteria || {}),
      },
    };
  });

  // =========================================================================
  // 1.3 KHỞI TẠO KHÓA HỌC 5 BƯỚC KHÉP KÍN (WIZARD)
  // =========================================================================

  route('POST', '/training/cohorts/initialize', async ({ db, user, body }) => {
    const curriculumId = text(body, 'curriculum_id', { required: true, max: 64, label: 'khung chương trình' });
    const curr = await requireCurriculumRow(db, curriculumId);
    requireApprovePermission(user, curr.department_id);

    // Quy tắc cứng 1.2.6: Chỉ Khung chương trình Đã ban hành mới mở được lớp!
    const effLifecycle = curr.lifecycle_status || (curr.status === 'ACTIVE' ? 'PUBLISHED' : 'DRAFT');
    if (effLifecycle !== 'PUBLISHED' || curr.status !== 'ACTIVE') {
      fail(422, 'CURRICULUM_NOT_PUBLISHED', 'Chỉ Khung chương trình ở trạng thái "Đã ban hành" mới được phép mở khóa học / tuyển sinh.');
    }

    const structure = await computeCurriculumStructureAndTotals(db, curr.id);
    if (!structure.subjects.length) {
      fail(422, 'CURRICULUM_EMPTY', 'Khung chương trình chưa có môn học nào.');
    }

    const code = text(body, 'code', { required: true, max: 40, label: 'mã khóa học' }).toUpperCase();
    if (await db.prepare('SELECT 1 FROM program_cohorts WHERE UPPER(code) = ?').get(code)) {
      fail(409, 'COHORT_CODE_EXISTS', `Mã khóa học "${code}" đã tồn tại.`);
    }
    const title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên khóa học' });
    const startDate = dateField(body, 'start_date', { label: 'ngày khai giảng' }) || vnDate();
    const endDate = dateField(body, 'end_date', { label: 'ngày bế giảng' }) || null;
    const maxStudents = intField(body, 'max_students', { min: 1, max: 2000, label: 'sĩ số tối đa' }) || 35;
    const deliveryMode = oneOf(body, 'delivery_mode', ['OFFLINE', 'ONLINE', 'HYBRID'], { fallback: curr.delivery_mode || 'HYBRID', label: 'hình thức' });
    const campusId = body.campus_id || 'cp_cs1';
    const defaultClassroomId = body.classroom_id || null;
    const publishScheduleNow = Boolean(body.publish_schedule);

    const latestCurrVer = await db
      .prepare('SELECT id FROM curriculum_versions WHERE curriculum_id = ? ORDER BY version_number DESC LIMIT 1')
      .get(curr.id);

    const cohortId = `coh_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    const createdClasses = [];
    let totalDraftSessions = 0;
    let totalDraftAssignments = 0;
    let resolvedAssignments = 0;

    await tx(db, async () => {
      // Bước 1: Tạo Lớp khóa học (program_cohort)
      await db.prepare(
        `INSERT INTO program_cohorts (
           id, curriculum_id, curriculum_version_id, tuition_fee_snapshot,
           code, title, academic_year, semester, start_date, end_date,
           delivery_mode, location_note, coordinator_id, coordinator_name, max_students,
           department_id, status, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
      ).run(
        cohortId,
        curr.id,
        latestCurrVer?.id || null,
        structure.totals.final_tuition_fee,
        code,
        title,
        text(body, 'academic_year', { max: 64, label: 'niên khóa' }) || `${new Date().getUTCFullYear()}`,
        text(body, 'semester', { max: 64, label: 'đợt tuyển sinh' }) || 'Đợt 1',
        startDate,
        endDate,
        deliveryMode,
        text(body, 'location_note', { max: 300, label: 'địa điểm' }) || '',
        user.id,
        user.full_name,
        maxStudents,
        curr.department_id || user.department_id || 'khoi_5',
        user.id,
        now,
        now
      );

      // Cấu hình xếp lịch nhanh tùy chọn (Bước 4)
      const qs = body.quick_schedule && typeof body.quick_schedule === 'object' ? body.quick_schedule : null;
      let rollingCursorMs = Date.parse(`${startDate}T12:00:00+07:00`);

      for (const s of structure.subjects) {
        const crs = await requireCourseRow(db, s.course_id);
        let latestCourseVer = await db
          .prepare("SELECT * FROM course_versions WHERE course_id = ? AND status = 'PUBLISHED' ORDER BY version_number DESC LIMIT 1")
          .get(crs.id);
        if (!latestCourseVer) {
          const snap = await buildCourseSnapshotPayload(db, crs.id);
          const vId = `cver_${crypto.randomBytes(5).toString('hex')}`;
          await db.prepare(
            `INSERT INTO course_versions (id, course_id, version_number, version_label, status, snapshot_json, changelog_note, published_by, published_by_name, published_at)
             VALUES (?, ?, 1, ?, 'PUBLISHED', ?, 'Khởi tạo tự động khi mở khóa học', ?, ?, ?)`
          ).run(vId, crs.id, crs.version_code || 'v2026.1', JSON.stringify(snap), user.id, user.full_name, now);
          latestCourseVer = await db.prepare('SELECT * FROM course_versions WHERE id = ?').get(vId);
        }

        const snapObj = safeJson(latestCourseVer.snapshot_json, {});
        const assessComps = snapObj.assessment_components || await db
          .prepare('SELECT code, title, weight_pct, source_type, is_mandatory FROM course_assessment_components WHERE course_id = ? ORDER BY sort_order')
          .all(crs.id);

        let clsCode = `${code.slice(0, 14)}-${crs.code.slice(0, 14)}`.toUpperCase();
        if (await db.prepare('SELECT 1 FROM subject_classes WHERE UPPER(code) = ?').get(clsCode)) {
          clsCode = `${clsCode}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`.slice(0, 40);
        }
        const clsId = `sc_${crypto.randomBytes(5).toString('hex')}`;
        const clsCfg = body?.class_configs && typeof body.class_configs === 'object' ? (body.class_configs[crs.id] || {}) : {};
        const instrId = clsCfg.instructor_id || body?.instructor_overrides?.[crs.id] || crs.instructor_id;
        const instrRow = instrId ? await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(instrId) : null;
        const reqRoomType = ROOM_TYPES.includes(clsCfg.required_room_type) ? clsCfg.required_room_type : (crs.required_room_type || 'THEORY_ROOM');
        const taIds = Array.isArray(clsCfg.ta_ids) ? clsCfg.ta_ids.filter(Boolean) : [];
        const taRows = (await mapAsync(taIds, async (tid) => await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(tid))).filter(Boolean);

        // Bước 2a: Sinh Lớp môn học + ghim phiên bản Snapshot + cấu hình đánh giá
        await db.prepare(
          `INSERT INTO subject_classes (
             id, course_id, cohort_id, course_version_id, course_version_number,
             required_room_type, assessment_components_json, planned_periods,
             code, title, subject, description, instructor_name, ta_names_json,
             schedule_text, room, student_count, start_date, end_date, max_students, delivery_mode, status,
             department_id, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`
        ).run(
          clsId,
          crs.id,
          cohortId,
          latestCourseVer.id,
          latestCourseVer.version_number,
          reqRoomType,
          JSON.stringify(assessComps),
          s.effective_periods,
          clsCode,
          `${crs.title} – ${code}`,
          crs.subject || crs.title,
          `Lớp môn học thuộc khóa ${title}`,
          instrRow?.full_name || crs.instructor_name || '',
          JSON.stringify(taRows.map((t) => t.full_name)),
          startDate,
          endDate,
          maxStudents,
          deliveryMode,
          curr.department_id || crs.department_id,
          user.id,
          now,
          now
        );

        if (instrRow) {
          await db.prepare(
            `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
             VALUES (?, ?, ?, 'PRIMARY_INSTRUCTOR', '{"can_manage_materials":true,"can_take_attendance":true}', 1, ?, ?, ?)`
          ).run(crypto.randomUUID(), clsId, instrRow.id, user.id, now, now);
        }
        for (const ta of taRows) {
          await db.prepare(
            `INSERT INTO teaching_staff_assignments (id, subject_class_id, user_id, staff_role, permissions_json, is_active, assigned_by, created_at, updated_at)
             VALUES (?, ?, ?, 'TEACHING_ASSISTANT', '{"can_manage_materials":true,"can_take_attendance":true}', 1, ?, ?, ?) ON CONFLICT DO NOTHING`
          ).run(crypto.randomUUID(), clsId, ta.id, user.id, now, now);
        }

        // Bước 2b: Sao chép bài tập mẫu từ phiên bản đang ban hành (với hạn nộp tương đối)
        const bankAssignments = await db
          .prepare('SELECT * FROM assignment_bank_items WHERE course_id = ? AND deleted_at IS NULL')
          .all(crs.id);
        for (const ba of bankAssignments) {
          await db.prepare(
            `INSERT INTO class_assignments (
               id, subject_class_id, course_id, assignment_bank_item_id, topic_id, chapter_id, lesson_id,
               anchor_lesson_id, relative_due_days, is_mandatory,
               title, instructions, submission_type, max_score, max_attempts, allow_resubmit,
               due_at, attachments_json, status, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'DRAFT', ?, ?, ?)`
          ).run(
            `ca_${crypto.randomBytes(5).toString('hex')}`,
            clsId,
            crs.id,
            ba.id,
            ba.topic_id || null,
            ba.chapter_id || null,
            ba.lesson_id,
            ba.lesson_id,
            ba.relative_due_days ?? 7,
            ba.is_mandatory ?? 1,
            ba.title,
            ba.instructions,
            ba.submission_type || 'MIXED',
            Number(ba.max_score || 10),
            Number(ba.max_attempts || 3),
            ba.allow_resubmit ?? 1,
            ba.attachments_json || '[]',
            user.id,
            now,
            now
          );
          totalDraftAssignments++;
        }

        // Bước 3 & 4: Gợi ý số buổi + liên kết Bài ↔ Buổi + Xếp thời gian nhanh (Tuần / Tháng)
        let plans = await getEffectiveSessionPlan(db, crs.id, curr.id);
        if (!plans.length) {
          plans = await generateDefaultSessionPlansForCourse(db, crs.id, null);
        }

        const effQs = clsCfg.quick_schedule && typeof clsCfg.quick_schedule === 'object' ? clsCfg.quick_schedule : qs;
        const startTime = effQs?.start_time ? timeField(effQs, 'start_time', { label: 'giờ bắt đầu' }) : '18:30';
        const endTime = effQs?.end_time ? timeField(effQs, 'end_time', { label: 'giờ kết thúc' }) : '20:00';
        const mode = effQs?.recurrence_mode === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY';
        const weekdays = Array.isArray(effQs?.weekdays) && effQs.weekdays.length ? effQs.weekdays.map(Number) : [1, 3, 5];
        const monthDays = Array.isArray(effQs?.month_days) && effQs.month_days.length ? effQs.month_days.map(Number) : [5, 15, 25];

        const matchedRoom = (clsCfg.classroom_id || defaultClassroomId)
          ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(clsCfg.classroom_id || defaultClassroomId)
          : await db.prepare('SELECT * FROM classrooms WHERE campus_id = ? AND room_type = ? AND capacity >= ? ORDER BY capacity ASC LIMIT 1')
              .get(campusId, reqRoomType, maxStudents);

        for (const plan of plans) {
          let pickedDateStr = startDate;
          if (effQs && effQs.enabled !== false) {
            for (let guard = 0; guard < 500; guard++) {
              const d = new Date(rollingCursorMs);
              const dStr = vnDate(d);
              const wd = d.getUTCDay();
              const dom = Number(dStr.slice(8, 10));
              const matchesPattern = mode === 'MONTHLY' ? monthDays.includes(dom) : weekdays.includes(wd);
              rollingCursorMs += 86400000;
              if (matchesPattern && !await isHolidayDate(db, dStr, campusId)) {
                pickedDateStr = dStr;
                break;
              }
            }
          } else {
            pickedDateStr = vnDate(new Date(rollingCursorMs));
            rollingCursorMs += 7 * 86400000;
          }

          const sesId = `ses_${crypto.randomBytes(5).toString('hex')}`;
          const schedState = effQs && effQs.enabled !== false
            ? (publishScheduleNow ? 'PUBLISHED' : 'DRAFT')
            : 'UNSCHEDULED';

          await insertClassSession(db, {
            session_id: sesId,
            subject_class_id: clsId,
            subject_class_code: clsCode,
            subject_title: `${crs.title} – ${code}`,
            session_title: plan.title,
            scheduled_start_at: vnDateTime(pickedDateStr, startTime),
            scheduled_end_at: vnDateTime(pickedDateStr, endTime),
            instructor_id: instrRow?.id || '',
            instructor_name: instrRow?.full_name || '',
            room_or_link: matchedRoom?.name || '',
            delivery_mode: plan.delivery_mode || deliveryMode,
            teaching_content: plan.lessons.map((l) => l.title).join(' · ') || plan.note || null,
            created_by: user.id,
          });

          await db.prepare(
            `UPDATE sessions SET
               campus_id = ?,
               classroom_id = ?,
               schedule_state = ?,
               planned_periods = ?,
               actual_instructor_id = ?,
               actual_instructor_name = ?,
               hour_category = ?
             WHERE session_id = ?`
          ).run(
            campusId,
            matchedRoom?.id || null,
            schedState,
            Number(plan.periods_count || 2),
            instrRow?.id || null,
            instrRow?.full_name || '',
            reqRoomType === 'COMPUTER_LAB' ? 'PRACTICE' : reqRoomType === 'ONLINE' ? 'ONLINE' : 'THEORY',
            sesId
          );

          for (const [lIdx, lid] of ((plan.lesson_ids || [])).entries()) {
            if (await db.prepare('SELECT 1 FROM lessons WHERE id = ?').get(lid)) {
              await db.prepare("INSERT INTO session_lessons (session_id, lesson_id, sort_order) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
                .run(sesId, lid, (lIdx + 1) * 10);
            }
          }
          totalDraftSessions++;
        }

        // Bước 5: Quy đổi hạn nộp bài tập tương đối nếu công bố TKB ngay
        if (publishScheduleNow) {
          resolvedAssignments += await resolveRelativeAssignmentDueDates(db, clsId);
        }

        createdClasses.push({
          id: clsId,
          code: clsCode,
          course_id: crs.id,
          course_title: crs.title,
          course_version_id: latestCourseVer.id,
          sessions_count: plans.length,
        });
      }

      if (Array.isArray(body.student_identifiers) && body.student_identifiers.length > 0) {
        for (const raw of body.student_identifiers) {
          const key = String(raw).trim();
          if (!key) continue;
          const st = await db.prepare('SELECT * FROM users WHERE id = ? OR UPPER(code) = UPPER(?) OR LOWER(email) = LOWER(?)').get(key, key, key);
          if (st && JSON.parse(st.roles_json || '[]').includes('STUDENT')) {
            await db.prepare(
              `INSERT INTO cohort_enrollments (id, cohort_id, student_id, status, enrolled_at, note, updated_by)
               VALUES (?, ?, ?, 'ACTIVE', ?, 'Ghi danh khi khởi tạo khóa học', ?) ON CONFLICT DO NOTHING`
            ).run(crypto.randomUUID(), cohortId, st.id, now, user.id);
          }
        }
        await syncCohortRosterToClasses(db, cohortId, user);
      }

      await db.prepare(
        `INSERT INTO cohort_audit_logs (id, cohort_id, action_type, payload_json, actor_id, actor_name, created_at)
         VALUES (?, ?, 'COHORT_WIZARD_INITIALIZED', ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        cohortId,
        JSON.stringify({ classes: createdClasses.length, sessions: totalDraftSessions, assignments: totalDraftAssignments, published: publishScheduleNow }),
        user.id,
        user.full_name,
        now
      );
    });

    return [201, {
      cohort_id: cohortId,
      code,
      title,
      classes: createdClasses,
      sessions_created: totalDraftSessions,
      assignments_copied: totalDraftAssignments,
      assignments_due_resolved: resolvedAssignments,
      schedule_published: publishScheduleNow,
    }];
  });
}
