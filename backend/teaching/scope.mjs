/**
 * LMSPLUS Teaching Module — RBAC + Data Scope.
 * Mọi kiểm tra quyền được thực hiện tại Backend; Frontend chỉ dùng `capabilities` để ẩn/hiện nút.
 *
 * Vai trò chuẩn trong cùng 1 hệ thống RBAC thống nhất:
 *  - SUPER_ADMIN: Toàn quyền quản trị hạ tầng & tổ chức
 *  - ADMIN: Quản trị hệ thống / đơn vị gốc
 *  - ACADEMIC_STAFF: Giáo vụ (giới hạn chặt theo department_id)
 *  - HEAD_OF_DEPARTMENT: Trưởng bộ môn (tách permission riêng: duyệt đề cương/khung CT & bảng giờ giảng trong bộ môn, KHÔNG có quyền xóa user hay đổi cấu hình Provider toàn hệ thống)
 *  - INSTRUCTOR: Giảng viên
 *  - TEACHING_ASSISTANT: Trợ giảng (theo flag-scoped trên lớp)
 *  - STUDENT: Học viên
 */

import { fail, someAsync } from './http.mjs';

/** Chính sách nghiệp vụ: mặc định chỉ Giáo vụ/Quản trị được thêm/bớt học viên. */
export const INSTRUCTOR_CAN_MANAGE_ROSTER = process.env.LMSPLUS_INSTRUCTOR_CAN_MANAGE_ROSTER === 'true';

export const has = (user, role) => Array.isArray(user?.roles) && user.roles.includes(role);
export const isSuperAdmin = (user) => has(user, 'SUPER_ADMIN');
export const isAdmin = (user) => has(user, 'ADMIN') || isSuperAdmin(user);
export const isStaff = (user) => has(user, 'ACADEMIC_STAFF');
export const isHeadOfDepartment = (user) => has(user, 'HEAD_OF_DEPARTMENT');
export const isInstructor = (user) => has(user, 'INSTRUCTOR');
export const isTA = (user) => has(user, 'TEACHING_ASSISTANT');
export const isStudent = (user) => has(user, 'STUDENT');

/** Kiểm tra trùng đơn vị/bộ môn nghiêm ngặt (tuyệt đối không bypass khi user.department_id bị null). */
export const sameDept = (user, deptId) => {
  if (!user?.department_id || !deptId) return false;
  return user.department_id === deptId;
};

/**
 * Bắt buộc người dùng có phạm vi thuộc `targetDeptId` (trừ ADMIN / SUPER_ADMIN).
 * Ngăn triệt để lỗi bảo mật khi ACADEMIC_STAFF hoặc HEAD_OF_DEPARTMENT thiếu department_id vẫn lọt qua check.
 */
export function assertDepartmentScope(user, targetDeptId, message = 'Bạn không có quyền thao tác ngoài bộ môn/đơn vị phụ trách.') {
  if (isAdmin(user)) return true;
  if (!user?.department_id) {
    fail(403, 'DEPARTMENT_SCOPE_REQUIRED', 'Tài khoản của bạn chưa được gán đơn vị/bộ môn phụ trách.');
  }
  if (!targetDeptId || targetDeptId !== user.department_id) {
    fail(403, 'OUT_OF_SCOPE', message);
  }
  return true;
}

/** Quyền phê duyệt học thuật cấp bộ môn (Đề cương, Khung CT, Giờ giảng bộ môn): ADMIN, ACADEMIC_STAFF hoặc HEAD_OF_DEPARTMENT đúng bộ môn. */
export function canApproveDepartmentAcademic(user, deptId) {
  if (isAdmin(user)) return true;
  if (isHeadOfDepartment(user) || isStaff(user)) {
    return sameDept(user, deptId);
  }
  return false;
}

export async function staffAssignments(db, userId, classId = null) {
  const rows = classId
    ? await db.prepare(
        `SELECT * FROM teaching_staff_assignments WHERE user_id = ? AND subject_class_id = ? AND is_active = 1`
      ).all(userId, classId)
    : await db.prepare(`SELECT * FROM teaching_staff_assignments WHERE user_id = ? AND is_active = 1`).all(userId);
  return rows.map((r) => ({ ...r, permissions: safeJson(r.permissions_json, {}) }));
}

export function safeJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

// ----------------------------------------------------------------- Courses

export function canCreateCourse(user) {
  return isAdmin(user) || isStaff(user) || isHeadOfDepartment(user) || isInstructor(user);
}

export function canManageCourse(db, user, course) {
  if (!course) return false;
  if (isAdmin(user)) return true;
  if ((isStaff(user) || isHeadOfDepartment(user)) && sameDept(user, course.department_id)) return true;
  if (isInstructor(user) && course.instructor_id === user.id) return true;
  return false;
}

/** Trợ giảng được giảng viên cấp quyền "biên tập học liệu" trong một lớp dùng khóa học này → chỉ sửa bản nháp. */
export async function canEditCourseDraft(db, user, course) {
  if (canManageCourse(db, user, course)) return true;
  if (!course) return false;
  return await someAsync(await staffAssignments(db, user.id), async (a) => {
    if (!a.permissions.can_manage_materials) return false;
    const cls = await db.prepare('SELECT course_id FROM subject_classes WHERE id = ?').get(a.subject_class_id);
    return cls && cls.course_id === course.id;
  });
}

export async function canViewCourse(db, user, course) {
  if (!course) return false;
  if (canManageCourse(db, user, course)) return true;
  return await someAsync(await staffAssignments(db, user.id), async (a) => {
    const cls = await db.prepare('SELECT course_id FROM subject_classes WHERE id = ?').get(a.subject_class_id);
    return cls && cls.course_id === course.id;
  });
}

/** SQL WHERE cho danh sách khóa học theo phạm vi dữ liệu. */
export function courseScopeSql(user) {
  if (isAdmin(user)) return { sql: '1 = 1', params: [] };
  const clauses = [];
  const params = [];
  if ((isStaff(user) || isHeadOfDepartment(user)) && user.department_id) {
    clauses.push('c.department_id = ?');
    params.push(user.department_id);
  }
  if (isInstructor(user)) {
    clauses.push('c.instructor_id = ?');
    params.push(user.id);
  }
  clauses.push(`c.id IN (SELECT sc.course_id FROM subject_classes sc
                 JOIN teaching_staff_assignments t ON t.subject_class_id = sc.id
                 WHERE t.user_id = ? AND t.is_active = 1)`);
  params.push(user.id);
  return { sql: `(${clauses.join(' OR ')})`, params };
}

// ----------------------------------------------------------------- Classes

export function canCreateClass(user) {
  return isAdmin(user) || isStaff(user) || isHeadOfDepartment(user) || isInstructor(user);
}

export async function classRole(db, user, cls) {
  if (!cls) return null;
  if (isAdmin(user)) return 'ADMIN';
  if (isStaff(user) && sameDept(user, cls.department_id)) return 'ACADEMIC_STAFF';
  if (isHeadOfDepartment(user) && sameDept(user, cls.department_id)) return 'HEAD_OF_DEPARTMENT';
  const assignment = (await staffAssignments(db, user.id, cls.id))[0];
  if (assignment) return assignment.staff_role;
  if (isStudent(user)) {
    const e = await db
      .prepare(`SELECT 1 FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`)
      .get(cls.id, user.id);
    if (e) return 'STUDENT';
  }
  return null;
}

export async function classCapabilities(db, user, cls) {
  const role = await classRole(db, user, cls);
  const assignment = role && ['PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR', 'TEACHING_ASSISTANT'].includes(role)
    ? (await staffAssignments(db, user.id, cls.id))[0]
    : null;
  const perms = assignment ? assignment.permissions : {};
  const admin = role === 'ADMIN' || role === 'ACADEMIC_STAFF';
  const deptHead = role === 'HEAD_OF_DEPARTMENT';
  const instructor = role === 'PRIMARY_INSTRUCTOR' || role === 'CO_INSTRUCTOR';
  return {
    role,
    can_view: Boolean(role),
    can_view_roster: Boolean(role) && role !== 'STUDENT',
    can_manage_class: admin || instructor,
    can_manage_sessions: admin || instructor,
    can_manage_roster: admin || (instructor && INSTRUCTOR_CAN_MANAGE_ROSTER),
    can_manage_staff: admin || deptHead,
    can_take_attendance: admin || instructor || (role === 'TEACHING_ASSISTANT' && Boolean(perms.can_take_attendance)),
    can_lock_attendance: admin,
    can_confirm_teaching_log: instructor || role === 'ADMIN',
    can_approve_academic: admin || deptHead,
  };
}

export function classScopeSql(user) {
  if (isAdmin(user)) return { sql: '1 = 1', params: [] };
  const clauses = [];
  const params = [];
  if ((isStaff(user) || isHeadOfDepartment(user)) && user.department_id) {
    clauses.push('sc.department_id = ?');
    params.push(user.department_id);
  }
  clauses.push(`sc.id IN (SELECT subject_class_id FROM teaching_staff_assignments WHERE user_id = ? AND is_active = 1)`);
  params.push(user.id);
  return { sql: `(${clauses.join(' OR ')})`, params };
}
