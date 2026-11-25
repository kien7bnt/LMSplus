/**
 * LMSPLUS — Phân hệ Thời khóa biểu & Điều phối Xếp lịch Thông minh (2.1)
 *
 * Bao gồm:
 * - Danh mục Cơ sở (campuses), Phòng học (classrooms), Ca học (shift_presets),
 *   Lịch nghỉ chung (academic_holidays), Lịch rảnh/bận GV (instructor_availabilities)
 * - Engine kiểm tra 6 Ràng buộc cứng + kiểm tra tiến độ đủ số tiết kế hoạch
 * - 4 Phương pháp xếp lịch: Kéo thả (tô sáng xanh/đỏ kèm lý do), Mẫu lặp né lễ,
 *   Xếp tự động sinh bản nháp, Sao chép lịch tuần / sao chép từ lớp khác
 * - Công bố TKB (kích hoạt thông báo + chốt ngày hạn nộp bài tập tương đối) & Điều chỉnh (dời, nghỉ, dạy bù, đổi GV/phòng)
 * - Xem lịch đa chiều (Lớp, Giảng viên, Phòng, Cơ sở — Tuần, Tháng, Danh sách)
 */

import crypto from 'node:crypto';
import {
  fail, nowIso, text, intField, oneOf, dateField, timeField, tx,
  mapAsync,
} from './http.mjs';
import {
  isAdmin, isStaff, isInstructor, isStudent, classScopeSql, safeJson,
} from './scope.mjs';
import { insertClassSession, vnDate, vnDateTime } from './schema.mjs';
import { resolveRelativeAssignmentDueDates, getEffectiveSessionPlan } from './trainingPrep.mjs';

const ROOM_TYPE_LABELS = {
  THEORY_ROOM: 'Phòng lý thuyết',
  COMPUTER_LAB: 'Phòng máy',
  ONLINE: 'Trực tuyến',
};

function requireSchedulerAccess(user, deptId = null) {
  if (isAdmin(user)) return;
  if (isStaff(user)) {
    if (deptId && user.department_id && deptId !== user.department_id) {
      fail(403, 'OUT_OF_SCOPE', 'Bạn không có quyền điều phối thời khóa biểu ngoài đơn vị phụ trách.');
    }
    return;
  }
  fail(403, 'TIMETABLE_FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên mới có quyền điều phối Thời khóa biểu.');
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function extractDate(isoStr) {
  return String(isoStr || '').slice(0, 10);
}

function extractTime(isoStr) {
  const m = String(isoStr || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '00:00';
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export async function findHolidayOnDate(db, dateStr, campusId = null) {
  const mmdd = dateStr.slice(5);
  const rows = await db.prepare('SELECT * FROM academic_holidays WHERE campus_id IS NULL OR campus_id = ?').all(campusId || '');
  for (const h of rows) {
    if (h.start_date <= dateStr && dateStr <= h.end_date) return h;
    if (h.is_recurring_yearly) {
      const sMd = String(h.start_date || '').slice(5);
      const eMd = String(h.end_date || '').slice(5);
      if (sMd && eMd && sMd <= mmdd && mmdd <= eMd) return h;
    }
  }
  return null;
}

/**
 * Kiểm tra đầy đủ 6 ràng buộc cứng cho 1 buổi học ứng viên.
 * Trả về mảng `conflicts: Array<{ code, message }>`. Rỗng = Hợp lệ.
 */
export async function evaluateCandidateConstraints(db, candidate, extraVirtualSessions = []) {
  const conflicts = [];
  const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(candidate.subject_class_id);
  if (!cls) {
    conflicts.push({ code: 'CLASS_NOT_FOUND', message: 'Không tìm thấy lớp môn học.' });
    return conflicts;
  }
  const course = cls.course_id ? await db.prepare('SELECT * FROM courses WHERE id = ?').get(cls.course_id) : null;

  const dateStr = candidate.date || extractDate(candidate.scheduled_start_at);
  const startTime = candidate.start_time || extractTime(candidate.scheduled_start_at);
  const endTime = candidate.end_time || extractTime(candidate.scheduled_end_at);
  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);

  if (endMin <= startMin) {
    conflicts.push({ code: 'INVALID_TIME_RANGE', message: 'Giờ kết thúc phải sau giờ bắt đầu.' });
    return conflicts;
  }

  const campusId = candidate.campus_id || 'cp_cs1';
  const campus = await db.prepare('SELECT * FROM campuses WHERE id = ?').get(campusId);
  const classroom = candidate.classroom_id ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(candidate.classroom_id) : null;
  const instructorId = candidate.instructor_id || null;

  // Ràng buộc 4a: Không xếp vào ngày nghỉ lễ
  const holiday = await findHolidayOnDate(db, dateStr, campus?.id || null);
  if (holiday) {
    conflicts.push({
      code: 'HOLIDAY_CONFLICT',
      message: `Ngày nghỉ của trung tâm: ${holiday.title} (${dateStr}).`,
    });
  }

  // Ràng buộc 4b: Trong khung giờ hoạt động của cơ sở
  if (campus) {
    const openMin = toMinutes(campus.open_time || '07:00');
    const closeMin = toMinutes(campus.close_time || '21:30');
    if (startMin < openMin || endMin > closeMin) {
      conflicts.push({
        code: 'OUTSIDE_OPERATING_HOURS',
        message: `Ngoài khung giờ hoạt động của ${campus.name} (${campus.open_time}–${campus.close_time}).`,
      });
    }
  }

  // Ràng buộc 5: Đúng loại phòng yêu cầu & sức chứa >= sĩ số
  const requiredRoomType = candidate.required_room_type || cls.required_room_type || course?.required_room_type || 'THEORY_ROOM';
  if (classroom) {
    if (requiredRoomType && classroom.room_type !== requiredRoomType && !(candidate.delivery_mode === 'ONLINE' && classroom.room_type === 'ONLINE')) {
      conflicts.push({
        code: 'ROOM_TYPE_MISMATCH',
        message: `Môn yêu cầu "${ROOM_TYPE_LABELS[requiredRoomType] || requiredRoomType}" nhưng phòng ${classroom.code} là "${ROOM_TYPE_LABELS[classroom.room_type] || classroom.room_type}".`,
      });
    }
    const activeEnrolled = (await db.prepare("SELECT COUNT(*) n FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'").get(cls.id)).n;
    const expectedSize = Math.max(activeEnrolled, Number(cls.student_count || 0), Number(cls.max_students || 0));
    if (classroom.room_type !== 'ONLINE' && expectedSize > 0 && Number(classroom.capacity) < expectedSize) {
      conflicts.push({
        code: 'ROOM_CAPACITY_EXCEEDED',
        message: `Phòng ${classroom.code} (${classroom.capacity} chỗ) không đủ sức chứa cho lớp (${expectedSize} học viên).`,
      });
    }
  }

  // Ràng buộc 6: Giảng viên chỉ dạy môn/lớp được phân công (trừ dạy thay hợp lệ)
  if (instructorId && !candidate.allow_substitute) {
    const assigned = await db
      .prepare('SELECT 1 FROM teaching_staff_assignments WHERE subject_class_id = ? AND user_id = ? AND is_active = 1')
      .get(cls.id, instructorId);
    const isCourseOwner = course && course.instructor_id === instructorId;
    if (!assigned && !isCourseOwner) {
      conflicts.push({
        code: 'INSTRUCTOR_NOT_ASSIGNED',
        message: 'Giảng viên chưa được phân công giảng dạy lớp môn học này.',
      });
    }
  }

  // Kiểm tra Lịch bận của Giảng viên (instructor_availabilities)
  if (instructorId) {
    const weekday = new Date(`${dateStr}T12:00:00+07:00`).getUTCDay();
    const availRows = await db
      .prepare(
        `SELECT * FROM instructor_availabilities
         WHERE instructor_id = ? AND status = 'BUSY'
           AND ((rule_type = 'DATE' AND specific_date = ?) OR (rule_type = 'WEEKLY' AND weekday = ?))`
      )
      .all(instructorId, dateStr, weekday);
    for (const av of availRows) {
      if (overlaps(startMin, endMin, toMinutes(av.start_time), toMinutes(av.end_time))) {
        conflicts.push({
          code: 'INSTRUCTOR_BUSY',
          message: `Giảng viên đăng ký bận (${av.start_time}–${av.end_time})${av.note ? `: ${av.note}` : ''}.`,
        });
        break;
      }
    }
  }

  // Lấy tất cả các buổi học khác trong cùng ngày để đối chiếu Ràng buộc 1, 2, 3
  const dbSessionsSameDay = await db
    .prepare(
      `SELECT s.*, sc.cohort_id, sc.student_count AS cls_student_count, sc.max_students AS cls_max_students
       FROM sessions s
       JOIN subject_classes sc ON sc.id = s.subject_class_id
       WHERE substr(s.scheduled_start_at, 1, 10) = ?
         AND s.session_status <> 'CANCELLED'
         AND COALESCE(s.schedule_state, 'PUBLISHED') <> 'UNSCHEDULED'`
    )
    .all(dateStr);

  const allSameDay = [...dbSessionsSameDay, ...extraVirtualSessions.filter((x) => (x.date || extractDate(x.scheduled_start_at)) === dateStr)];

  for (const other of allSameDay) {
    if (candidate.exclude_session_id && other.session_id === candidate.exclude_session_id) continue;
    const oStartMin = toMinutes(other.start_time || extractTime(other.scheduled_start_at));
    const oEndMin = toMinutes(other.end_time || extractTime(other.scheduled_end_at));
    const isTimeOverlap = overlaps(startMin, endMin, oStartMin, oEndMin);

    // Ràng buộc 3: Cùng lớp môn học hoặc cùng Khóa học (cohort) không học 2 buổi trùng giờ
    if (isTimeOverlap) {
      if (other.subject_class_id === cls.id) {
        conflicts.push({
          code: 'CLASS_CONFLICT',
          message: `Lớp ${cls.code} đã có buổi "${other.session_title}" (${extractTime(other.scheduled_start_at)}–${extractTime(other.scheduled_end_at)}).`,
        });
      } else if (cls.cohort_id && other.cohort_id && cls.cohort_id === other.cohort_id) {
        conflicts.push({
          code: 'COHORT_CONFLICT',
          message: `Trùng giờ học viên cùng khóa với lớp môn ${other.subject_class_code} (${extractTime(other.scheduled_start_at)}–${extractTime(other.scheduled_end_at)}).`,
        });
      }
    }

    // Ràng buộc 2: Cùng phòng học vật lý (trừ lớp ghép hợp lệ và đủ sức chứa)
    if (isTimeOverlap && classroom && classroom.room_type !== 'ONLINE' && other.classroom_id === classroom.id) {
      const sameMergedGroup = Boolean(
        candidate.merged_group_code &&
        other.merged_group_code &&
        candidate.merged_group_code === other.merged_group_code
      );
      if (!sameMergedGroup) {
        conflicts.push({
          code: 'ROOM_CONFLICT',
          message: `Phòng ${classroom.code} đã xếp cho lớp ${other.subject_class_code} (${extractTime(other.scheduled_start_at)}–${extractTime(other.scheduled_end_at)}).`,
        });
      } else {
        const mySize = Number(cls.student_count || cls.max_students || 0);
        const otherSize = Number(other.cls_student_count || other.cls_max_students || 0);
        if (mySize + otherSize > Number(classroom.capacity || 0)) {
          conflicts.push({
            code: 'MERGED_CAPACITY_EXCEEDED',
            message: `Lớp ghép vượt sức chứa phòng ${classroom.code} (${mySize + otherSize}/${classroom.capacity} chỗ).`,
          });
        }
      }
    }

    // Ràng buộc 1: Giảng viên không dạy 2 buổi trùng giờ + kiểm tra thời gian di chuyển khác cơ sở
    const otherInstr = other.actual_instructor_id || other.scheduled_instructor_id;
    if (instructorId && otherInstr && otherInstr === instructorId) {
      if (isTimeOverlap) {
        conflicts.push({
          code: 'INSTRUCTOR_CONFLICT',
          message: `Giảng viên trùng giờ dạy tại lớp ${other.subject_class_code} (${extractTime(other.scheduled_start_at)}–${extractTime(other.scheduled_end_at)}).`,
        });
      } else if (campus && other.campus_id && other.campus_id !== campus.id) {
        const buffers = safeJson(campus.travel_buffers_json, {});
        const otherCampus = await db.prepare('SELECT * FROM campuses WHERE id = ?').get(other.campus_id);
        const reverseBuffers = otherCampus ? safeJson(otherCampus.travel_buffers_json, {}) : {};
        const reqBuffer = Number(buffers[other.campus_id] ?? reverseBuffers[campus.id] ?? 30);
        const gapMinutes = startMin >= oEndMin ? startMin - oEndMin : oStartMin - endMin;
        if (gapMinutes < reqBuffer) {
          conflicts.push({
            code: 'INSTRUCTOR_TRAVEL_CONFLICT',
            message: `Cần tối thiểu ${reqBuffer} phút di chuyển giữa ${campus.code} và ${otherCampus?.code || other.campus_id} (hiện cách ${gapMinutes} phút).`,
          });
        }
      }
    }
  }

  return conflicts;
}

/** Tổng hợp tiến độ đủ giờ / đủ tiết và xung đột của một tập lớp học. */
async function buildTimetableAuditReport(db, classIds) {
  const classReports = [];
  let totalConflicts = 0;

  for (const cid of classIds) {
    const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(cid);
    if (!cls) continue;
    const course = cls.course_id ? await db.prepare('SELECT * FROM courses WHERE id = ?').get(cls.course_id) : null;
    const targetPeriods = Number(cls.planned_periods || (course ? Number(course.theory_periods || 0) + Number(course.practice_periods || 0) : 30) || 30);

    const sessions = await db
      .prepare("SELECT * FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED' ORDER BY scheduled_start_at")
      .all(cls.id);

    const scheduledSessions = sessions.filter((s) => (s.schedule_state || 'PUBLISHED') !== 'UNSCHEDULED');
    const scheduledPeriods = Math.round(scheduledSessions.reduce((sum, s) => sum + Number(s.planned_periods || 2), 0) * 10) / 10;
    const unscheduledCount = sessions.length - scheduledSessions.length;

    const sessionConflicts = [];
    for (const s of scheduledSessions) {
      const cList = await evaluateCandidateConstraints(db, {
        exclude_session_id: s.session_id,
        subject_class_id: s.subject_class_id,
        scheduled_start_at: s.scheduled_start_at,
        scheduled_end_at: s.scheduled_end_at,
        campus_id: s.campus_id,
        classroom_id: s.classroom_id,
        instructor_id: s.actual_instructor_id || s.scheduled_instructor_id,
        merged_group_code: s.merged_group_code,
        delivery_mode: s.delivery_mode,
        allow_substitute: Boolean(s.is_substitute_teaching),
      });
      if (cList.length > 0) {
        totalConflicts += cList.length;
        sessionConflicts.push({
          session_id: s.session_id,
          session_title: s.session_title,
          start_at: s.scheduled_start_at,
          conflicts: cList,
        });
      }
    }

    classReports.push({
      class_id: cls.id,
      class_code: cls.code,
      class_title: cls.title,
      target_periods: targetPeriods,
      scheduled_periods: scheduledPeriods,
      is_hours_sufficient: scheduledPeriods >= targetPeriods,
      missing_periods: Math.max(0, Math.round((targetPeriods - scheduledPeriods) * 10) / 10),
      unscheduled_sessions_count: unscheduledCount,
      draft_sessions_count: scheduledSessions.filter((s) => s.schedule_state === 'DRAFT').length,
      published_sessions_count: scheduledSessions.filter((s) => (s.schedule_state || 'PUBLISHED') === 'PUBLISHED').length,
      conflicts: sessionConflicts,
    });
  }

  return {
    total_conflicts: totalConflicts,
    all_hours_sufficient: classReports.every((r) => r.is_hours_sufficient),
    classes: classReports,
  };
}

export function registerTimetableRoutes(route) {
  // =========================================================================
  // 1. DANH MỤC CƠ SỞ, PHÒNG HỌC, CA HỌC, LỊCH NGHỈ & LỊCH RẢNH/BẬN GV
  // =========================================================================

  route('GET', '/facilities/overview', async ({ db, user }) => {
    if (isStudent(user) && !isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      fail(403, 'ACCESS_DENIED', 'Học viên không truy cập danh mục điều phối phòng học.');
    }
    const campuses = (await db.prepare('SELECT * FROM campuses WHERE is_active = 1 ORDER BY code').all()).map((c) => ({
      ...c,
      travel_buffers: safeJson(c.travel_buffers_json, {}),
    }));
    const classrooms = await db
      .prepare(
        `SELECT r.*, cp.code AS campus_code, cp.name AS campus_name
         FROM classrooms r JOIN campuses cp ON cp.id = r.campus_id
         WHERE r.is_active = 1 ORDER BY cp.code, r.code`
      )
      .all();
    const shifts = await db.prepare('SELECT * FROM shift_presets ORDER BY sort_order, start_time').all();
    const holidays = await db.prepare('SELECT * FROM academic_holidays ORDER BY start_date DESC').all();
    const instructors = await db
      .prepare("SELECT id, code, full_name, email, department_id FROM users WHERE roles_json LIKE '%\"INSTRUCTOR\"%' ORDER BY full_name")
      .all();
    const availabilities = await db
      .prepare(
        `SELECT ia.*, u.full_name AS instructor_name, u.code AS instructor_code
         FROM instructor_availabilities ia JOIN users u ON u.id = ia.instructor_id
         ORDER BY u.full_name, ia.rule_type, ia.weekday, ia.specific_date`
      )
      .all();

    return {
      campuses,
      classrooms,
      shifts,
      holidays,
      instructors,
      availabilities,
      capabilities: {
        can_manage_facilities: isAdmin(user) || isStaff(user),
      },
    };
  });

  route('POST', '/facilities/campuses', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const code = text(body, 'code', { required: true, max: 32, label: 'mã cơ sở' }).toUpperCase();
    const name = text(body, 'name', { required: true, max: 200, label: 'tên cơ sở' });
    const address = text(body, 'address', { max: 300, label: 'địa chỉ' }) || '';
    const openTime = timeField(body, 'open_time', { label: 'giờ mở cửa' }) || '07:00';
    const closeTime = timeField(body, 'close_time', { label: 'giờ đóng cửa' }) || '21:30';
    const buffers = body.travel_buffers && typeof body.travel_buffers === 'object' ? body.travel_buffers : {};
    const id = `cp_${crypto.randomBytes(4).toString('hex')}`;
    await db.prepare(
      `INSERT INTO campuses (id, code, name, address, open_time, close_time, travel_buffers_json, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, code, name, address, openTime, closeTime, JSON.stringify(buffers), nowIso());
    return [201, await db.prepare('SELECT * FROM campuses WHERE id = ?').get(id)];
  });

  route('POST', '/facilities/classrooms', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const campusId = text(body, 'campus_id', { required: true, max: 64, label: 'cơ sở' });
    if (!await db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(campusId)) fail(404, 'CAMPUS_NOT_FOUND', 'Không tìm thấy cơ sở.');
    const code = text(body, 'code', { required: true, max: 32, label: 'mã phòng' }).toUpperCase();
    const name = text(body, 'name', { required: true, max: 200, label: 'tên phòng' });
    const roomType = oneOf(body, 'room_type', ['THEORY_ROOM', 'COMPUTER_LAB', 'ONLINE'], { fallback: 'THEORY_ROOM', label: 'loại phòng' });
    const capacity = intField(body, 'capacity', { min: 1, max: 2000, label: 'sức chứa' }) || 40;
    const note = text(body, 'equipment_note', { max: 300, label: 'thiết bị' }) || '';
    const id = `rm_${crypto.randomBytes(4).toString('hex')}`;
    await db.prepare(
      `INSERT INTO classrooms (id, campus_id, code, name, room_type, capacity, equipment_note, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, campusId, code, name, roomType, capacity, note, nowIso());
    return [201, await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(id)];
  });

  route('POST', '/facilities/holidays', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const title = text(body, 'title', { required: true, max: 200, label: 'tên kỳ nghỉ' });
    const startDate = dateField(body, 'start_date', { required: true, label: 'ngày bắt đầu nghỉ' });
    const endDate = dateField(body, 'end_date', { required: true, label: 'ngày kết thúc nghỉ' });
    if (endDate < startDate) fail(422, 'VALIDATION_ERROR', 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.');
    const campusId = body.campus_id || null;
    const recurring = body.is_recurring_yearly ? 1 : 0;
    const id = `hol_${crypto.randomBytes(4).toString('hex')}`;
    await db.prepare(
      `INSERT INTO academic_holidays (id, campus_id, title, start_date, end_date, is_recurring_yearly, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, campusId, title, startDate, endDate, recurring, text(body, 'note', { max: 300, label: 'ghi chú' }) || '', nowIso());
    return [201, await db.prepare('SELECT * FROM academic_holidays WHERE id = ?').get(id)];
  });

  route('DELETE', '/facilities/holidays/:id', async ({ db, user, params }) => {
    requireSchedulerAccess(user);
    await db.prepare('DELETE FROM academic_holidays WHERE id = ?').run(params.id);
    return { deleted_id: params.id };
  });

  route('POST', '/facilities/instructor-availabilities', async ({ db, user, body }) => {
    const targetInstrId = body.instructor_id || user.id;
    if (!isAdmin(user) && !isStaff(user) && targetInstrId !== user.id) {
      fail(403, 'FORBIDDEN', 'Bạn chỉ được cập nhật lịch rảnh/bận của chính mình.');
    }
    const ruleType = oneOf(body, 'rule_type', ['WEEKLY', 'DATE'], { fallback: 'WEEKLY', label: 'loại lịch' });
    const weekday = ruleType === 'WEEKLY' ? intField(body, 'weekday', { min: 0, max: 6, required: true, label: 'thứ trong tuần' }) : null;
    const specificDate = ruleType === 'DATE' ? dateField(body, 'specific_date', { required: true, label: 'ngày cụ thể' }) : null;
    const startTime = timeField(body, 'start_time', { required: true, label: 'giờ bắt đầu' });
    const endTime = timeField(body, 'end_time', { required: true, label: 'giờ kết thúc' });
    if (endTime <= startTime) fail(422, 'VALIDATION_ERROR', 'Giờ kết thúc phải sau giờ bắt đầu.');
    const status = oneOf(body, 'status', ['BUSY', 'AVAILABLE'], { fallback: 'BUSY', label: 'trạng thái' });
    const id = `iav_${crypto.randomBytes(4).toString('hex')}`;
    await db.prepare(
      `INSERT INTO instructor_availabilities (id, instructor_id, rule_type, weekday, specific_date, start_time, end_time, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, targetInstrId, ruleType, weekday, specificDate, startTime, endTime, status, text(body, 'note', { max: 300, label: 'lý do' }) || '', nowIso());
    return [201, await db.prepare('SELECT * FROM instructor_availabilities WHERE id = ?').get(id)];
  });

  route('DELETE', '/facilities/instructor-availabilities/:id', async ({ db, user, params }) => {
    const row = await db.prepare('SELECT * FROM instructor_availabilities WHERE id = ?').get(params.id);
    if (!row) fail(404, 'NOT_FOUND', 'Không tìm thấy mục lịch bận/rảnh.');
    if (!isAdmin(user) && !isStaff(user) && row.instructor_id !== user.id) {
      fail(403, 'FORBIDDEN', 'Không có quyền xóa lịch của giảng viên khác.');
    }
    await db.prepare('DELETE FROM instructor_availabilities WHERE id = ?').run(row.id);
    return { deleted_id: row.id };
  });

  // =========================================================================
  // 2. XEM LỊCH ĐA CHIỀU (2.1.3) & KHAY BUỔI HỌC CHỜ XẾP
  // =========================================================================

  route('GET', '/timetable/grid', async ({ db, user, url }) => {
    const from = url.searchParams.get('from') || vnDate();
    const to = url.searchParams.get('to') || vnDate(new Date(Date.now() + 6 * 86400000));
    const cohortId = url.searchParams.get('cohort_id') || '';
    const courseId = url.searchParams.get('course_id') || '';
    const classId = url.searchParams.get('class_id') || '';
    const instructorId = url.searchParams.get('instructor_id') || '';
    const classroomId = url.searchParams.get('classroom_id') || '';
    const campusId = url.searchParams.get('campus_id') || '';
    const shiftCode = url.searchParams.get('shift_code') || '';
    const stateFilter = url.searchParams.get('schedule_state') || '';

    const where = ['1 = 1'];
    const params = [];

    if (isStudent(user) && !isAdmin(user) && !isStaff(user) && !isInstructor(user)) {
      where.push(`s.subject_class_id IN (SELECT subject_class_id FROM class_enrollments WHERE student_id = ? AND status = 'ACTIVE')`);
      where.push(`COALESCE(s.schedule_state, 'PUBLISHED') = 'PUBLISHED'`);
      params.push(user.id);
    } else if (!isAdmin(user) && !isStaff(user)) {
      const scope = classScopeSql(user);
      where.push(`s.subject_class_id IN (SELECT sc2.id FROM subject_classes sc2 WHERE ${scope.sql})`);
      params.push(...scope.params);
    }

    if (cohortId) { where.push('sc.cohort_id = ?'); params.push(cohortId); }
    if (courseId) { where.push('sc.course_id = ?'); params.push(courseId); }
    if (classId) { where.push('s.subject_class_id = ?'); params.push(classId); }
    if (instructorId) { where.push('(COALESCE(s.actual_instructor_id, s.scheduled_instructor_id) = ?)'); params.push(instructorId); }
    if (classroomId) { where.push('s.classroom_id = ?'); params.push(classroomId); }
    if (campusId) { where.push('s.campus_id = ?'); params.push(campusId); }
    if (shiftCode) { where.push('s.shift_code = ?'); params.push(shiftCode); }
    if (stateFilter) { where.push("COALESCE(s.schedule_state, 'PUBLISHED') = ?"); params.push(stateFilter); }

    const scheduledRows = await db
      .prepare(
        `SELECT s.*, sc.code AS class_code, sc.title AS class_title, sc.cohort_id, sc.course_id,
                sc.required_room_type, sc.student_count, sc.max_students,
                rm.code AS classroom_code, rm.name AS classroom_name, rm.room_type AS classroom_type, rm.capacity AS classroom_capacity,
                cp.code AS campus_code, cp.name AS campus_name
         FROM sessions s
         JOIN subject_classes sc ON sc.id = s.subject_class_id
         LEFT JOIN classrooms rm ON rm.id = s.classroom_id
         LEFT JOIN campuses cp ON cp.id = s.campus_id
         WHERE ${where.join(' AND ')}
           AND COALESCE(s.schedule_state, 'PUBLISHED') <> 'UNSCHEDULED'
           AND substr(s.scheduled_start_at, 1, 10) >= ?
           AND substr(s.scheduled_start_at, 1, 10) <= ?
         ORDER BY s.scheduled_start_at`
      )
      .all(...params, from, to);

    // Khay các buổi học chưa xếp thời gian (UNSCHEDULED) cho người điều phối
    let unscheduled = [];
    if (isAdmin(user) || isStaff(user)) {
      const uWhere = ["COALESCE(s.schedule_state, 'PUBLISHED') = 'UNSCHEDULED'", "s.session_status <> 'CANCELLED'"];
      const uParams = [];
      if (cohortId) { uWhere.push('sc.cohort_id = ?'); uParams.push(cohortId); }
      if (classId) { uWhere.push('s.subject_class_id = ?'); uParams.push(classId); }
      if (courseId) { uWhere.push('sc.course_id = ?'); uParams.push(courseId); }
      unscheduled = await db
        .prepare(
          `SELECT s.*, sc.code AS class_code, sc.title AS class_title, sc.required_room_type
           FROM sessions s JOIN subject_classes sc ON sc.id = s.subject_class_id
           WHERE ${uWhere.join(' AND ')}
           ORDER BY sc.code, s.session_title LIMIT 120`
        )
        .all(...uParams);
    }

    return {
      from,
      to,
      items: scheduledRows.map((s) => ({
        id: s.session_id,
        class_id: s.subject_class_id,
        class_code: s.class_code,
        class_title: s.class_title,
        cohort_id: s.cohort_id,
        course_id: s.course_id,
        title: s.session_title,
        start_at: s.scheduled_start_at,
        end_at: s.scheduled_end_at,
        date: extractDate(s.scheduled_start_at),
        start_time: extractTime(s.scheduled_start_at),
        end_time: extractTime(s.scheduled_end_at),
        schedule_state: s.schedule_state || 'PUBLISHED',
        session_status: s.session_status,
        session_kind: s.session_kind || 'REGULAR',
        planned_periods: Number(s.planned_periods || 2),
        campus_id: s.campus_id,
        campus_code: s.campus_code || '',
        campus_name: s.campus_name || '',
        classroom_id: s.classroom_id,
        classroom_code: s.classroom_code || '',
        classroom_name: s.classroom_name || s.room_or_link || '',
        classroom_capacity: s.classroom_capacity || null,
        instructor_id: s.actual_instructor_id || s.scheduled_instructor_id || null,
        instructor_name: s.actual_instructor_name || s.scheduled_instructor_name || '',
        is_substitute: Boolean(s.is_substitute_teaching),
        merged_group_code: s.merged_group_code || null,
        delivery_mode: s.delivery_mode || 'OFFLINE',
      })),
      unscheduled_items: unscheduled.map((s) => ({
        id: s.session_id,
        class_id: s.subject_class_id,
        class_code: s.class_code,
        class_title: s.class_title,
        title: s.session_title,
        planned_periods: Number(s.planned_periods || 2),
        required_room_type: s.required_room_type || 'THEORY_ROOM',
        instructor_id: s.actual_instructor_id || s.scheduled_instructor_id || null,
        instructor_name: s.actual_instructor_name || s.scheduled_instructor_name || '',
      })),
    };
  });

  // =========================================================================
  // 3. PHƯƠNG PHÁP 1: KÉO THẢ (GỢI Ý Ô HỢP LỆ XANH / Ô XUNG ĐỘT ĐỎ) & ÁP DỤNG
  // =========================================================================

  route('POST', '/timetable/slot-hints', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const session = body.session_id ? await db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(body.session_id) : null;
    const classId = session?.subject_class_id || text({ class_id: body.subject_class_id || body.class_id }, 'class_id', { required: true, max: 64, label: 'lớp môn học' });
    const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');

    const dates = Array.isArray(body.dates) && body.dates.length
      ? body.dates.slice(0, 14)
      : Array.from({ length: 7 }, (_, i) => vnDate(new Date(Date.parse(`${body.week_start || vnDate()}T12:00:00+07:00`) + i * 86400000)));
    const shifts = await db.prepare('SELECT * FROM shift_presets ORDER BY sort_order, start_time').all();

    const campusId = body.campus_id || session?.campus_id || 'cp_cs1';
    const classroomId = body.classroom_id !== undefined ? body.classroom_id : session?.classroom_id || null;
    const primaryStaff = await db
      .prepare("SELECT user_id FROM teaching_staff_assignments WHERE subject_class_id = ? AND staff_role = 'PRIMARY_INSTRUCTOR' AND is_active = 1 LIMIT 1")
      .get(cls.id);
    const instructorId = body.instructor_id || session?.actual_instructor_id || session?.scheduled_instructor_id || primaryStaff?.user_id || null;

    const hints = [];
    for (const d of dates) {
      for (const sh of shifts) {
        const conflicts = await evaluateCandidateConstraints(db, {
          exclude_session_id: session?.session_id || null,
          subject_class_id: cls.id,
          date: d,
          start_time: sh.start_time,
          end_time: sh.end_time,
          campus_id: campusId,
          classroom_id: classroomId,
          instructor_id: instructorId,
          merged_group_code: body.merged_group_code || session?.merged_group_code || null,
          delivery_mode: session?.delivery_mode || cls.delivery_mode,
        });
        hints.push({
          date: d,
          shift_code: sh.code,
          shift_title: sh.title,
          start_time: sh.start_time,
          end_time: sh.end_time,
          valid: conflicts.length === 0,
          conflicts,
        });
      }
    }
    return { slots: hints };
  });

  route('POST', '/timetable/sessions/:id/move', async ({ db, user, body, params }) => {
    requireSchedulerAccess(user);
    const ses = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(params.id);
    if (!ses) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy buổi học.');
    if (ses.timesheet_locked_id) {
      fail(409, 'SESSION_TIMESHEET_LOCKED', 'Buổi học đã chốt bảng giờ giảng chuyển Tài chính, không thể dời lịch.');
    }

    const date = dateField(body, 'date', { required: true, label: 'ngày học mới' });
    const shift = body.shift_code ? await db.prepare('SELECT * FROM shift_presets WHERE code = ?').get(body.shift_code) : null;
    const startTime = shift ? shift.start_time : timeField(body, 'start_time', { required: true, label: 'giờ bắt đầu' });
    const endTime = shift ? shift.end_time : timeField(body, 'end_time', { required: true, label: 'giờ kết thúc' });
    const campusId = body.campus_id || ses.campus_id || 'cp_cs1';
    const classroomId = body.classroom_id !== undefined ? body.classroom_id : ses.classroom_id;
    const instructorId = body.instructor_id || ses.actual_instructor_id || ses.scheduled_instructor_id;

    const conflicts = await evaluateCandidateConstraints(db, {
      exclude_session_id: ses.session_id,
      subject_class_id: ses.subject_class_id,
      date,
      start_time: startTime,
      end_time: endTime,
      campus_id: campusId,
      classroom_id: classroomId,
      instructor_id: instructorId,
      merged_group_code: body.merged_group_code ?? ses.merged_group_code,
      delivery_mode: ses.delivery_mode,
      allow_substitute: Boolean(body.is_substitute || ses.is_substitute_teaching),
    });

    if (conflicts.length > 0 && !body.force_draft) {
      fail(422, 'SCHEDULE_CONFLICT', conflicts.map((c) => c.message).join(' | '), { conflicts });
    }

    const room = classroomId ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(classroomId) : null;
    const instr = instructorId ? await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(instructorId) : null;
    const nextState = ses.schedule_state === 'UNSCHEDULED' ? 'DRAFT' : ses.schedule_state || 'DRAFT';

    await db.prepare(
      `UPDATE sessions SET
         scheduled_start_at = ?,
         scheduled_end_at = ?,
         campus_id = ?,
         classroom_id = ?,
         room_or_link = COALESCE(?, room_or_link),
         shift_code = ?,
         schedule_state = ?,
         actual_instructor_id = COALESCE(?, actual_instructor_id),
         actual_instructor_name = COALESCE(?, actual_instructor_name)
       WHERE session_id = ?`
    ).run(
      vnDateTime(date, startTime),
      vnDateTime(date, endTime),
      campusId,
      classroomId || null,
      room?.name || null,
      shift?.code || body.shift_code || null,
      nextState,
      instr?.id || null,
      instr?.full_name || null,
      ses.session_id
    );

    if (nextState === 'PUBLISHED') {
      await resolveRelativeAssignmentDueDates(db, ses.subject_class_id);
    }

    return { session_id: ses.session_id, date, start_time: startTime, end_time: endTime, schedule_state: nextState, conflicts };
  });

  // =========================================================================
  // 4. PHƯƠNG PHÁP 2: TẠO MẪU LẶP (TỰ BỎ QUA NGÀY NGHỈ LỄ & RẢI ĐỦ SỐ TIẾT)
  // =========================================================================

  route('POST', '/timetable/generate-recurrence', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const classId = text({ class_id: body.subject_class_id || body.class_id }, 'class_id', { required: true, max: 64, label: 'lớp môn học' });
    const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');

    const startDate = dateField(body, 'start_date', { required: true, label: 'ngày bắt đầu' });
    const weekdays = Array.isArray(body.weekdays) ? body.weekdays.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    if (!weekdays.length) fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn ít nhất một thứ trong tuần.');

    const shift = body.shift_code ? await db.prepare('SELECT * FROM shift_presets WHERE code = ?').get(body.shift_code) : null;
    const startTime = shift ? shift.start_time : timeField(body, 'start_time', { required: true, label: 'giờ bắt đầu' });
    const endTime = shift ? shift.end_time : timeField(body, 'end_time', { required: true, label: 'giờ kết thúc' });
    const periodsPerSession = Number(body.periods_per_session || shift?.periods_count || 2);
    const campusId = body.campus_id || 'cp_cs1';
    const classroomId = body.classroom_id || null;
    const room = classroomId ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(classroomId) : null;

    const primaryStaff = await db
      .prepare("SELECT u.id, u.full_name FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id WHERE t.subject_class_id = ? AND t.staff_role = 'PRIMARY_INSTRUCTOR' AND t.is_active = 1 LIMIT 1")
      .get(cls.id);
    const instr = body.instructor_id
      ? await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(body.instructor_id)
      : primaryStaff;

    // Ưu tiên xếp các buổi UNSCHEDULED sẵn có; nếu chưa có thì sinh từ session_plan của môn học
    const unscheduledRows = await db
      .prepare("SELECT * FROM sessions WHERE subject_class_id = ? AND schedule_state = 'UNSCHEDULED' AND session_status <> 'CANCELLED' ORDER BY scheduled_start_at ASC, session_id ASC")
      .all(cls.id);

    const plans = unscheduledRows.length > 0
      ? unscheduledRows.map((u) => ({ existing_session_id: u.session_id, title: u.session_title, periods_count: Number(u.planned_periods || periodsPerSession), lesson_ids: [] }))
      : (cls.course_id ? await getEffectiveSessionPlan(db, cls.course_id) : []);

    const totalSessionsNeeded = plans.length > 0
      ? plans.length
      : Math.max(1, Math.ceil(Number(cls.planned_periods || 30) / periodsPerSession));

    let cursorMs = Date.parse(`${startDate}T12:00:00+07:00`);
    const createdOrScheduled = [];
    const skippedHolidays = [];
    const skippedConflicts = [];

    await tx(db, async () => {
      let placed = 0;
      let safety = 0;
      while (placed < totalSessionsNeeded && safety < 365) {
        safety++;
        const dObj = new Date(cursorMs);
        cursorMs += 86400000;
        const wd = dObj.getUTCDay();
        if (!weekdays.includes(wd)) continue;

        const dStr = vnDate(dObj);
        const hol = await findHolidayOnDate(db, dStr, campusId);
        if (hol) {
          skippedHolidays.push({ date: dStr, title: hol.title });
          continue;
        }

        const plan = plans[placed] || null;
        const conflicts = await evaluateCandidateConstraints(db, {
          exclude_session_id: plan?.existing_session_id || null,
          subject_class_id: cls.id,
          date: dStr,
          start_time: startTime,
          end_time: endTime,
          campus_id: campusId,
          classroom_id: classroomId,
          instructor_id: instr?.id || null,
          merged_group_code: body.merged_group_code || null,
          delivery_mode: cls.delivery_mode,
        });

        if (conflicts.length > 0) {
          skippedConflicts.push({ date: dStr, conflicts });
          if (body.strict !== false) continue;
        }

        if (plan?.existing_session_id) {
          await db.prepare(
            `UPDATE sessions SET
               scheduled_start_at = ?, scheduled_end_at = ?, campus_id = ?, classroom_id = ?,
               room_or_link = COALESCE(?, room_or_link), shift_code = ?, schedule_state = 'DRAFT',
               planned_periods = ?, scheduled_instructor_id = COALESCE(?, scheduled_instructor_id),
               scheduled_instructor_name = COALESCE(?, scheduled_instructor_name),
               actual_instructor_id = COALESCE(?, actual_instructor_id),
               actual_instructor_name = COALESCE(?, actual_instructor_name)
             WHERE session_id = ?`
          ).run(
            vnDateTime(dStr, startTime),
            vnDateTime(dStr, endTime),
            campusId,
            classroomId,
            room?.name || null,
            shift?.code || null,
            Number(plan.periods_count || periodsPerSession),
            instr?.id || null,
            instr?.full_name || null,
            instr?.id || null,
            instr?.full_name || null,
            plan.existing_session_id
          );
          createdOrScheduled.push(plan.existing_session_id);
        } else {
          const sesId = `ses_${crypto.randomBytes(5).toString('hex')}`;
          await insertClassSession(db, {
            session_id: sesId,
            subject_class_id: cls.id,
            subject_class_code: cls.code,
            subject_title: cls.title,
            session_title: plan?.title || `Buổi ${placed + 1} — ${cls.title}`,
            scheduled_start_at: vnDateTime(dStr, startTime),
            scheduled_end_at: vnDateTime(dStr, endTime),
            instructor_id: instr?.id || '',
            instructor_name: instr?.full_name || '',
            room_or_link: room?.name || cls.room || '',
            delivery_mode: cls.delivery_mode || 'OFFLINE',
            teaching_content: null,
            created_by: user.id,
          });
          await db.prepare(
            `UPDATE sessions SET campus_id = ?, classroom_id = ?, shift_code = ?, schedule_state = 'DRAFT',
               planned_periods = ?, actual_instructor_id = ?, actual_instructor_name = ?, merged_group_code = ?
             WHERE session_id = ?`
          ).run(
            campusId,
            classroomId,
            shift?.code || null,
            Number(plan?.periods_count || periodsPerSession),
            instr?.id || null,
            instr?.full_name || '',
            body.merged_group_code || null,
            sesId
          );
          for (const [idx, lid] of ((plan?.lesson_ids || [])).entries()) {
            await db.prepare("INSERT INTO session_lessons (session_id, lesson_id, sort_order) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(sesId, lid, (idx + 1) * 10);
          }
          createdOrScheduled.push(sesId);
        }
        placed++;
      }
    });

    return [201, {
      scheduled_count: createdOrScheduled.length,
      session_ids: createdOrScheduled,
      skipped_holidays: skippedHolidays,
      skipped_conflicts: skippedConflicts,
      audit: await buildTimetableAuditReport(db, [cls.id]),
    }];
  });

  // =========================================================================
  // 5. PHƯƠNG PHÁP 3: XẾP TỰ ĐỘNG SINH BẢN NHÁP (MOST-CONSTRAINED-FIRST)
  // =========================================================================

  route('POST', '/timetable/auto-schedule', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const startDate = dateField({ start_date: body.start_date || body.from_date }, 'start_date', { required: true, label: 'từ ngày' });
    const endDate = dateField({ end_date: body.end_date || body.to_date }, 'end_date', { required: true, label: 'đến ngày' });
    if (endDate < startDate) fail(422, 'VALIDATION_ERROR', 'Khoảng thời gian xếp tự động không hợp lệ.');

    let classIds = Array.isArray(body.class_ids) ? body.class_ids.filter(Boolean) : [];
    if (!classIds.length && body.cohort_id) {
      classIds = (await db.prepare("SELECT id FROM subject_classes WHERE cohort_id = ? AND status = 'ACTIVE'").all(body.cohort_id)).map((r) => r.id);
    }
    if (!classIds.length) fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn ít nhất một lớp học hoặc khóa học để xếp tự động.');

    const campusId = body.campus_id || 'cp_cs1';
    const shifts = await db.prepare('SELECT * FROM shift_presets ORDER BY sort_order, start_time').all();
    const rooms = await db.prepare('SELECT * FROM classrooms WHERE campus_id = ? AND is_active = 1 ORDER BY capacity ASC').all(campusId);

    // Ưu tiên lớp yêu cầu phòng máy & sĩ số đông trước (Most-Constrained-First)
    const classes = (await mapAsync(classIds, async (id) => await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(id)))
      .filter(Boolean)
      .sort((a, b) => {
        const scoreA = (a.required_room_type === 'COMPUTER_LAB' ? 1000 : 0) + Number(a.student_count || a.max_students || 0);
        const scoreB = (b.required_room_type === 'COMPUTER_LAB' ? 1000 : 0) + Number(b.student_count || b.max_students || 0);
        return scoreB - scoreA;
      });

    const placedSessions = [];
    const unplacedItems = [];

    await tx(db, async () => {
      for (const cls of classes) {
        const primaryStaff = await db
          .prepare("SELECT u.id, u.full_name FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id WHERE t.subject_class_id = ? AND t.staff_role = 'PRIMARY_INSTRUCTOR' AND t.is_active = 1 LIMIT 1")
          .get(cls.id);

        const unsched = await db
          .prepare("SELECT * FROM sessions WHERE subject_class_id = ? AND schedule_state = 'UNSCHEDULED' AND session_status <> 'CANCELLED' ORDER BY scheduled_start_at ASC, session_id ASC")
          .all(cls.id);

        const tasks = unsched.length > 0
          ? unsched.map((s) => ({ existing_id: s.session_id, title: s.session_title, periods: Number(s.planned_periods || 2), lesson_ids: [] }))
          : await (async () => {
              const existingCount = (await db.prepare("SELECT COUNT(*) n FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED'").get(cls.id)).n;
              if (existingCount > 0) return [];
              const plans = cls.course_id ? await getEffectiveSessionPlan(db, cls.course_id) : [];
              return plans.map((p) => ({ existing_id: null, title: p.title, periods: Number(p.periods_count || 2), lesson_ids: p.lesson_ids || [] }));
            })();

        let cursorMs = Date.parse(`${startDate}T12:00:00+07:00`);
        const endMs = Date.parse(`${endDate}T12:00:00+07:00`);

        for (const task of tasks) {
          let scheduled = false;
          for (let t = cursorMs; t <= endMs && !scheduled; t += 86400000) {
            const dObj = new Date(t);
            const wd = dObj.getUTCDay();
            if (wd === 0) continue; // Mặc định tránh Chủ nhật khi xếp tự động
            const dStr = vnDate(dObj);
            if (await findHolidayOnDate(db, dStr, campusId)) continue;

            // Tối đa 1 buổi/ngày cho cùng 1 lớp môn để phân bổ đều trong tuần
            const hasSameClassDay = await db
              .prepare("SELECT 1 FROM sessions WHERE subject_class_id = ? AND substr(scheduled_start_at, 1, 10) = ? AND session_status <> 'CANCELLED' AND schedule_state <> 'UNSCHEDULED'")
              .get(cls.id, dStr);
            if (hasSameClassDay) continue;

            for (const sh of shifts) {
              const candidateRooms = rooms.filter((r) => r.room_type === (cls.required_room_type || 'THEORY_ROOM'));
              const roomPool = candidateRooms.length ? candidateRooms : rooms;
              for (const rm of roomPool) {
                const conflicts = await evaluateCandidateConstraints(db, {
                  exclude_session_id: task.existing_id,
                  subject_class_id: cls.id,
                  date: dStr,
                  start_time: sh.start_time,
                  end_time: sh.end_time,
                  campus_id: campusId,
                  classroom_id: rm.id,
                  instructor_id: primaryStaff?.id || null,
                  delivery_mode: cls.delivery_mode,
                });
                if (conflicts.length === 0) {
                  if (task.existing_id) {
                    await db.prepare(
                      `UPDATE sessions SET scheduled_start_at = ?, scheduled_end_at = ?, campus_id = ?, classroom_id = ?,
                         room_or_link = ?, shift_code = ?, schedule_state = 'DRAFT',
                         scheduled_instructor_id = COALESCE(?, scheduled_instructor_id),
                         scheduled_instructor_name = COALESCE(?, scheduled_instructor_name),
                         actual_instructor_id = COALESCE(?, actual_instructor_id),
                         actual_instructor_name = COALESCE(?, actual_instructor_name)
                       WHERE session_id = ?`
                    ).run(
                      vnDateTime(dStr, sh.start_time),
                      vnDateTime(dStr, sh.end_time),
                      campusId,
                      rm.id,
                      rm.name,
                      sh.code,
                      primaryStaff?.id || null,
                      primaryStaff?.full_name || null,
                      primaryStaff?.id || null,
                      primaryStaff?.full_name || null,
                      task.existing_id
                    );
                    placedSessions.push({ session_id: task.existing_id, class_code: cls.code, date: dStr, shift: sh.code, room: rm.code });
                  } else {
                    const sesId = `ses_${crypto.randomBytes(5).toString('hex')}`;
                    await insertClassSession(db, {
                      session_id: sesId,
                      subject_class_id: cls.id,
                      subject_class_code: cls.code,
                      subject_title: cls.title,
                      session_title: task.title,
                      scheduled_start_at: vnDateTime(dStr, sh.start_time),
                      scheduled_end_at: vnDateTime(dStr, sh.end_time),
                      instructor_id: primaryStaff?.id || '',
                      instructor_name: primaryStaff?.full_name || '',
                      room_or_link: rm.name,
                      delivery_mode: cls.delivery_mode || 'OFFLINE',
                      teaching_content: null,
                      created_by: user.id,
                    });
                    await db.prepare(
                      `UPDATE sessions SET campus_id = ?, classroom_id = ?, shift_code = ?, schedule_state = 'DRAFT',
                         planned_periods = ?, actual_instructor_id = ?, actual_instructor_name = ?
                       WHERE session_id = ?`
                    ).run(campusId, rm.id, sh.code, task.periods, primaryStaff?.id || null, primaryStaff?.full_name || '', sesId);
                    for (const [idx, lid] of (task.lesson_ids).entries()) {
                      await db.prepare("INSERT INTO session_lessons (session_id, lesson_id, sort_order) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(sesId, lid, (idx + 1) * 10);
                    }
                    placedSessions.push({ session_id: sesId, class_code: cls.code, date: dStr, shift: sh.code, room: rm.code });
                  }
                  cursorMs = t + 86400000;
                  scheduled = true;
                  break;
                }
              }
              if (scheduled) break;
            }
          }
          if (!scheduled) {
            unplacedItems.push({ class_id: cls.id, class_code: cls.code, title: task.title });
          }
        }
      }
    });

    return {
      draft_placed_count: placedSessions.length,
      placed_sessions: placedSessions,
      unplaced_items: unplacedItems,
      audit: await buildTimetableAuditReport(db, classes.map((c) => c.id)),
    };
  });

  // =========================================================================
  // 6. PHƯƠNG PHÁP 4: SAO CHÉP LỊCH TUẦN / SAO CHÉP TỪ LỚP KHÁC
  // =========================================================================

  route('POST', '/timetable/copy', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    const mode = oneOf(body, 'mode', ['COPY_WEEK', 'COPY_FROM_CLASS'], { required: true, label: 'chế độ sao chép' });

    if (mode === 'COPY_WEEK') {
      const classId = text({ class_id: body.subject_class_id || body.class_id }, 'class_id', { required: true, max: 64, label: 'lớp môn học' });
      const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
      if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
      const sourceWeekStart = dateField(body, 'source_week_start', { required: true, label: 'tuần nguồn' });
      const weeksForward = intField(body, 'weeks_count', { min: 1, max: 16, label: 'số tuần sao chép' }) || 1;
      const srcEnd = vnDate(new Date(Date.parse(`${sourceWeekStart}T12:00:00+07:00`) + 6 * 86400000));

      const srcSessions = await db
        .prepare(
          `SELECT * FROM sessions
           WHERE subject_class_id = ? AND session_status <> 'CANCELLED'
             AND substr(scheduled_start_at, 1, 10) >= ? AND substr(scheduled_start_at, 1, 10) <= ?
           ORDER BY scheduled_start_at`
        )
        .all(cls.id, sourceWeekStart, srcEnd);
      if (!srcSessions.length) fail(422, 'SOURCE_WEEK_EMPTY', 'Tuần nguồn chưa có buổi học nào để sao chép.');

      const copied = [];
      const skipped = [];
      await tx(db, async () => {
        for (let w = 1; w <= weeksForward; w++) {
          for (const s of srcSessions) {
            const targetDate = vnDate(new Date(Date.parse(`${extractDate(s.scheduled_start_at)}T12:00:00+07:00`) + w * 7 * 86400000));
            const sTime = extractTime(s.scheduled_start_at);
            const eTime = extractTime(s.scheduled_end_at);
            const conflicts = await evaluateCandidateConstraints(db, {
              subject_class_id: cls.id,
              date: targetDate,
              start_time: sTime,
              end_time: eTime,
              campus_id: s.campus_id,
              classroom_id: s.classroom_id,
              instructor_id: s.actual_instructor_id || s.scheduled_instructor_id,
              delivery_mode: s.delivery_mode,
            });
            if (conflicts.length > 0) {
              skipped.push({ date: targetDate, conflicts });
              continue;
            }
            const newId = `ses_${crypto.randomBytes(5).toString('hex')}`;
            await insertClassSession(db, {
              session_id: newId,
              subject_class_id: cls.id,
              subject_class_code: cls.code,
              subject_title: cls.title,
              session_title: `${s.session_title} (Tuần +${w})`,
              scheduled_start_at: vnDateTime(targetDate, sTime),
              scheduled_end_at: vnDateTime(targetDate, eTime),
              instructor_id: s.scheduled_instructor_id || '',
              instructor_name: s.scheduled_instructor_name || '',
              room_or_link: s.room_or_link || '',
              delivery_mode: s.delivery_mode || 'OFFLINE',
              teaching_content: s.teaching_content || null,
              created_by: user.id,
            });
            await db.prepare(
              `UPDATE sessions SET campus_id = ?, classroom_id = ?, shift_code = ?, schedule_state = 'DRAFT',
                 planned_periods = ?, actual_instructor_id = ?, actual_instructor_name = ?
               WHERE session_id = ?`
            ).run(s.campus_id, s.classroom_id, s.shift_code, s.planned_periods || 2, s.actual_instructor_id, s.actual_instructor_name, newId);
            copied.push(newId);
          }
        }
      });
      return { copied_count: copied.length, skipped };
    }

    // COPY_FROM_CLASS: Sao chép mẫu thứ/ca từ một lớp khác cùng môn/chương trình
    const sourceClassId = text(body, 'source_class_id', { required: true, max: 64, label: 'lớp nguồn' });
    const targetClassId = text(body, 'target_class_id', { required: true, max: 64, label: 'lớp đích' });
    const targetStartDate = dateField(body, 'target_start_date', { required: true, label: 'ngày bắt đầu lớp đích' });
    const dstCls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(targetClassId);
    if (!dstCls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp đích.');

    const srcSessions = await db
      .prepare("SELECT * FROM sessions WHERE subject_class_id = ? AND session_status <> 'CANCELLED' ORDER BY scheduled_start_at")
      .all(sourceClassId);
    if (!srcSessions.length) fail(422, 'SOURCE_CLASS_EMPTY', 'Lớp nguồn chưa có thời khóa biểu.');

    const baseDateMs = Date.parse(`${extractDate(srcSessions[0].scheduled_start_at)}T12:00:00+07:00`);
    const dstStartMs = Date.parse(`${targetStartDate}T12:00:00+07:00`);
    const offsetDays = Math.round((dstStartMs - baseDateMs) / 86400000);
    const primaryStaff = await db
      .prepare("SELECT u.id, u.full_name FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id WHERE t.subject_class_id = ? AND t.staff_role = 'PRIMARY_INSTRUCTOR' AND t.is_active = 1 LIMIT 1")
      .get(dstCls.id);

    const copied = [];
    const skipped = [];
    await tx(db, async () => {
      for (const [idx, s] of (srcSessions).entries()) {
        const dStr = vnDate(new Date(Date.parse(`${extractDate(s.scheduled_start_at)}T12:00:00+07:00`) + offsetDays * 86400000));
        const sTime = extractTime(s.scheduled_start_at);
        const eTime = extractTime(s.scheduled_end_at);
        const conflicts = await evaluateCandidateConstraints(db, {
          subject_class_id: dstCls.id,
          date: dStr,
          start_time: sTime,
          end_time: eTime,
          campus_id: s.campus_id,
          classroom_id: body.classroom_id || s.classroom_id,
          instructor_id: primaryStaff?.id || null,
          delivery_mode: dstCls.delivery_mode,
        });
        if (conflicts.length > 0) {
          skipped.push({ date: dStr, conflicts });
          continue;
        }
        const newId = `ses_${crypto.randomBytes(5).toString('hex')}`;
        await insertClassSession(db, {
          session_id: newId,
          subject_class_id: dstCls.id,
          subject_class_code: dstCls.code,
          subject_title: dstCls.title,
          session_title: s.session_title || `Buổi ${idx + 1}`,
          scheduled_start_at: vnDateTime(dStr, sTime),
          scheduled_end_at: vnDateTime(dStr, eTime),
          instructor_id: primaryStaff?.id || '',
          instructor_name: primaryStaff?.full_name || '',
          room_or_link: s.room_or_link || '',
          delivery_mode: dstCls.delivery_mode || s.delivery_mode,
          teaching_content: s.teaching_content,
          created_by: user.id,
        });
        await db.prepare(
          `UPDATE sessions SET campus_id = ?, classroom_id = ?, shift_code = ?, schedule_state = 'DRAFT',
             planned_periods = ?, actual_instructor_id = ?, actual_instructor_name = ?
           WHERE session_id = ?`
        ).run(s.campus_id, body.classroom_id || s.classroom_id, s.shift_code, s.planned_periods || 2, primaryStaff?.id || null, primaryStaff?.full_name || '', newId);
        copied.push(newId);
      }
    });

    return { copied_count: copied.length, skipped };
  });

  // =========================================================================
  // 7. KIỂM TRA XUNG ĐỘT & ĐỦ GIỜ, CÔNG BỐ TKB & ĐIỀU CHỈNH TRONG QUÁ TRÌNH HỌC
  // =========================================================================

  route('GET', '/timetable/audit', async ({ db, user, url }) => {
    requireSchedulerAccess(user);
    const cohortId = url.searchParams.get('cohort_id');
    const classId = url.searchParams.get('class_id');
    let classIds = [];
    if (classId) classIds = [classId];
    else if (cohortId) classIds = (await db.prepare("SELECT id FROM subject_classes WHERE cohort_id = ? AND status = 'ACTIVE'").all(cohortId)).map((r) => r.id);
    else classIds = (await db.prepare("SELECT id FROM subject_classes WHERE status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 30").all()).map((r) => r.id);
    return await buildTimetableAuditReport(db, classIds);
  });

  route('POST', '/timetable/publish', async ({ db, user, body }) => {
    requireSchedulerAccess(user);
    let classIds = Array.isArray(body.class_ids) ? body.class_ids.filter(Boolean) : [];
    if (!classIds.length && body.cohort_id) {
      classIds = (await db.prepare("SELECT id FROM subject_classes WHERE cohort_id = ? AND status = 'ACTIVE'").all(body.cohort_id)).map((r) => r.id);
    }
    if (!classIds.length) fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn lớp học hoặc khóa học cần công bố lịch.');

    const audit = await buildTimetableAuditReport(db, classIds);
    if (audit.total_conflicts > 0 && !body.allow_with_warnings) {
      fail(422, 'TIMETABLE_HAS_CONFLICTS', `Còn ${audit.total_conflicts} xung đột thời khóa biểu cần xử lý trước khi công bố.`, { audit });
    }

    const now = nowIso();
    let publishedSessions = 0;
    let resolvedAssignments = 0;
    let notificationsSent = 0;

    await tx(db, async () => {
      for (const cid of classIds) {
        const cls = await db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(cid);
        if (!cls) continue;
        const r = await db.prepare(
          "UPDATE sessions SET schedule_state = 'PUBLISHED' WHERE subject_class_id = ? AND schedule_state = 'DRAFT' AND session_status <> 'CANCELLED'"
        ).run(cid);
        publishedSessions += Number(r.changes || 0);

        // Quy hạn nộp tương đối của bài tập ra ngày cụ thể khi thời khóa biểu được công bố (1.3.1.5)
        resolvedAssignments += await resolveRelativeAssignmentDueDates(db, cid);

        // Gửi thông báo cho giảng viên và học viên của lớp (2.1.1.4)
        const recipients = new Set();
        (await db.prepare('SELECT user_id FROM teaching_staff_assignments WHERE subject_class_id = ? AND is_active = 1')
          .all(cid)).forEach((x) => recipients.add(x.user_id));
        (await db.prepare("SELECT student_id FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'")
          .all(cid)).forEach((x) => recipients.add(x.student_id));

        for (const uid of recipients) {
          await db.prepare(
            `INSERT INTO teaching_notifications (id, user_id, notification_type, title, body, link_url, is_read, created_at)
             VALUES (?, ?, 'TIMETABLE_PUBLISHED', ?, ?, ?, 0, ?)`
          ).run(
            crypto.randomUUID(),
            uid,
            `Đã công bố Thời khóa biểu lớp ${cls.code}`,
            `Lịch học chính thức của lớp "${cls.title}" đã được công bố. Vui lòng kiểm tra lịch và hạn nộp bài tập.`,
            '/learn/schedule',
            now
          );
          notificationsSent++;
        }
      }
    });

    return {
      published_sessions: publishedSessions,
      assignments_due_resolved: resolvedAssignments,
      notifications_sent: notificationsSent,
      audit,
    };
  });

  // 2.1.1.5 Điều chỉnh trong quá trình học: Dời buổi, Báo nghỉ, Dạy bù, Đổi GV dạy thay / Đổi phòng
  route('POST', '/timetable/sessions/:id/adjust', async ({ db, user, body, params }) => {
    requireSchedulerAccess(user);
    const ses = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(params.id);
    if (!ses) fail(404, 'SESSION_NOT_FOUND', 'Không tìm thấy buổi học.');
    if (ses.timesheet_locked_id) {
      fail(409, 'SESSION_TIMESHEET_LOCKED', 'Buổi học đã chốt công chuyển Tài chính, không thể chỉnh sửa.');
    }

    const action = oneOf(body, 'action', ['RESCHEDULE', 'CANCEL_AND_MAKEUP', 'CHANGE_STAFF_OR_ROOM'], {
      required: true,
      label: 'loại điều chỉnh',
    });
    const reason = text(body, 'reason', { required: true, min: 3, max: 500, label: 'lý do điều chỉnh' });
    const now = nowIso();

    if (action === 'CHANGE_STAFF_OR_ROOM') {
      const nextCampusId = body.campus_id || ses.campus_id || 'cp_cs1';
      const nextRoomId = body.classroom_id !== undefined ? body.classroom_id : ses.classroom_id;
      const nextInstrId = body.substitute_instructor_id || ses.actual_instructor_id || ses.scheduled_instructor_id;
      const isSub = Boolean(body.substitute_instructor_id && body.substitute_instructor_id !== ses.scheduled_instructor_id);

      const conflicts = await evaluateCandidateConstraints(db, {
        exclude_session_id: ses.session_id,
        subject_class_id: ses.subject_class_id,
        scheduled_start_at: ses.scheduled_start_at,
        scheduled_end_at: ses.scheduled_end_at,
        campus_id: nextCampusId,
        classroom_id: nextRoomId,
        instructor_id: nextInstrId,
        delivery_mode: ses.delivery_mode,
        allow_substitute: true,
      });
      if (conflicts.length > 0) {
        fail(422, 'SCHEDULE_CONFLICT', conflicts.map((c) => c.message).join(' | '), { conflicts });
      }

      const rm = nextRoomId ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(nextRoomId) : null;
      const gv = nextInstrId ? await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(nextInstrId) : null;

      await db.prepare(
        `UPDATE sessions SET
           campus_id = ?,
           classroom_id = ?,
           room_or_link = COALESCE(?, room_or_link),
           actual_instructor_id = ?,
           actual_instructor_name = ?,
           is_substitute_teaching = ?,
           substitute_reason = ?
         WHERE session_id = ?`
      ).run(nextCampusId, nextRoomId, rm?.name || null, gv?.id || null, gv?.full_name || '', isSub ? 1 : 0, isSub ? reason : null, ses.session_id);

      return { updated_session_id: ses.session_id, is_substitute: isSub };
    }

    if (action === 'RESCHEDULE') {
      const newDate = dateField(body, 'new_date', { required: true, label: 'ngày học mới' });
      const newStart = timeField(body, 'new_start_time', { required: true, label: 'giờ bắt đầu mới' });
      const newEnd = timeField(body, 'new_end_time', { required: true, label: 'giờ kết thúc mới' });
      const nextRoomId = body.classroom_id || ses.classroom_id;
      const nextCampusId = body.campus_id || ses.campus_id || 'cp_cs1';

      const conflicts = await evaluateCandidateConstraints(db, {
        exclude_session_id: ses.session_id,
        subject_class_id: ses.subject_class_id,
        date: newDate,
        start_time: newStart,
        end_time: newEnd,
        campus_id: nextCampusId,
        classroom_id: nextRoomId,
        instructor_id: ses.actual_instructor_id || ses.scheduled_instructor_id,
        delivery_mode: ses.delivery_mode,
        allow_substitute: Boolean(ses.is_substitute_teaching),
      });
      if (conflicts.length > 0) {
        fail(422, 'SCHEDULE_CONFLICT', conflicts.map((c) => c.message).join(' | '), { conflicts });
      }

      const rm = nextRoomId ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(nextRoomId) : null;
      await db.prepare(
        `UPDATE sessions SET scheduled_start_at = ?, scheduled_end_at = ?, campus_id = ?, classroom_id = ?, room_or_link = COALESCE(?, room_or_link)
         WHERE session_id = ?`
      ).run(vnDateTime(newDate, newStart), vnDateTime(newDate, newEnd), nextCampusId, nextRoomId, rm?.name || null, ses.session_id);
      await resolveRelativeAssignmentDueDates(db, ses.subject_class_id);
      return { updated_session_id: ses.session_id, new_date: newDate };
    }

    // CANCEL_AND_MAKEUP: Đánh dấu buổi hiện tại nghỉ (CANCELLED) và tùy chọn tạo ngay buổi dạy bù (MAKEUP)
    let makeupId = null;
    await tx(db, async () => {
      await db.prepare("UPDATE sessions SET session_status = 'CANCELLED', cancel_reason = ? WHERE session_id = ?")
        .run(reason, ses.session_id);

      if (body.makeup_date) {
        const mDate = dateField(body, 'makeup_date', { required: true, label: 'ngày dạy bù' });
        const mStart = timeField(body, 'makeup_start_time', { label: 'giờ bắt đầu bù' }) || extractTime(ses.scheduled_start_at);
        const mEnd = timeField(body, 'makeup_end_time', { label: 'giờ kết thúc bù' }) || extractTime(ses.scheduled_end_at);
        const mCampus = body.campus_id || ses.campus_id || 'cp_cs1';
        const mRoomId = body.classroom_id || ses.classroom_id;
        const mInstrId = body.substitute_instructor_id || ses.actual_instructor_id || ses.scheduled_instructor_id;

        const conflicts = await evaluateCandidateConstraints(db, {
          subject_class_id: ses.subject_class_id,
          date: mDate,
          start_time: mStart,
          end_time: mEnd,
          campus_id: mCampus,
          classroom_id: mRoomId,
          instructor_id: mInstrId,
          delivery_mode: ses.delivery_mode,
          allow_substitute: true,
        });
        if (conflicts.length > 0) {
          fail(422, 'MAKEUP_SCHEDULE_CONFLICT', conflicts.map((c) => c.message).join(' | '), { conflicts });
        }

        const rm = mRoomId ? await db.prepare('SELECT * FROM classrooms WHERE id = ?').get(mRoomId) : null;
        const gv = mInstrId ? await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(mInstrId) : null;
        makeupId = `ses_${crypto.randomBytes(5).toString('hex')}`;

        await insertClassSession(db, {
          session_id: makeupId,
          subject_class_id: ses.subject_class_id,
          subject_class_code: ses.subject_class_code,
          subject_title: ses.subject_title,
          session_title: `[Dạy bù] ${ses.session_title}`,
          scheduled_start_at: vnDateTime(mDate, mStart),
          scheduled_end_at: vnDateTime(mDate, mEnd),
          instructor_id: ses.scheduled_instructor_id || '',
          instructor_name: ses.scheduled_instructor_name || '',
          room_or_link: rm?.name || ses.room_or_link || '',
          delivery_mode: ses.delivery_mode || 'OFFLINE',
          teaching_content: ses.teaching_content,
          created_by: user.id,
        });

        await db.prepare(
          `UPDATE sessions SET
             campus_id = ?, classroom_id = ?, schedule_state = ?, planned_periods = ?,
             session_kind = 'MAKEUP', rescheduled_from_session_id = ?,
             actual_instructor_id = ?, actual_instructor_name = ?,
             is_substitute_teaching = ?, hour_category = ?
           WHERE session_id = ?`
        ).run(
          mCampus,
          mRoomId,
          ses.schedule_state || 'PUBLISHED',
          ses.planned_periods || 2,
          ses.session_id,
          gv?.id || null,
          gv?.full_name || '',
          mInstrId && mInstrId !== ses.scheduled_instructor_id ? 1 : 0,
          ses.hour_category || 'THEORY',
          makeupId
        );

        const linkedLessons = await db.prepare('SELECT * FROM session_lessons WHERE session_id = ?').all(ses.session_id);
        for (const ll of linkedLessons) {
          await db.prepare("INSERT INTO session_lessons (session_id, lesson_id, sort_order) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(makeupId, ll.lesson_id, ll.sort_order);
        }
        await resolveRelativeAssignmentDueDates(db, ses.subject_class_id);
      }
    });

    return { cancelled_session_id: ses.session_id, makeup_session_id: makeupId, created_at: now };
  });
}
