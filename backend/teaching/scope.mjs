/**
 * LMSPLUS Teaching Module — RBAC + Data Scope.
 * Mọi kiểm tra quyền được thực hiện tại Backend; Frontend chỉ dùng `capabilities` để ẩn/hiện nút.
 */

/** Chính sách nghiệp vụ: mặc định chỉ Giáo vụ/Quản trị được thêm/bớt học viên. */
export const INSTRUCTOR_CAN_MANAGE_ROSTER = process.env.LMSPLUS_INSTRUCTOR_CAN_MANAGE_ROSTER === 'true';

export const has = (user, role) => Array.isArray(user?.roles) && user.roles.includes(role);
export const isAdmin = (user) => has(user, 'ADMIN');
export const isStaff = (user) => has(user, 'ACADEMIC_STAFF');
export const isInstructor = (user) => has(user, 'INSTRUCTOR');
export const isTA = (user) => has(user, 'TEACHING_ASSISTANT');
export const isStudent = (user) => has(user, 'STUDENT');

const sameDept = (user, deptId) => Boolean(user?.department_id) && user.department_id === deptId;

export function staffAssignments(db, userId, classId = null) {
  const rows = classId
    ? db.prepare(
        `SELECT * FROM teaching_staff_assignments WHERE user_id = ? AND subject_class_id = ? AND is_active = 1`
      ).all(userId, classId)
    : db.prepare(`SELECT * FROM teaching_staff_assignments WHERE user_id = ? AND is_active = 1`).all(userId);
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
  return isAdmin(user) || isStaff(user) || isInstructor(user);
}

export function canManageCourse(db, user, course) {
  if (!course) return false;
  if (isAdmin(user)) return true;
  if (isStaff(user) && sameDept(user, course.department_id)) return true;
  if (isInstructor(user) && course.instructor_id === user.id) return true;
  return false;
}

/** Trợ giảng được giảng viên cấp quyền "biên tập học liệu" trong một lớp dùng khóa học này → chỉ sửa bản nháp. */
export function canEditCourseDraft(db, user, course) {
  if (canManageCourse(db, user, course)) return true;
  if (!course) return false;
  return staffAssignments(db, user.id).some((a) => {
    if (!a.permissions.can_manage_materials) return false;
    const cls = db.prepare('SELECT course_id FROM subject_classes WHERE id = ?').get(a.subject_class_id);
    return cls && cls.course_id === course.id;
  });
}

export function canViewCourse(db, user, course) {
  if (!course) return false;
  if (canManageCourse(db, user, course)) return true;
  return staffAssignments(db, user.id).some((a) => {
    const cls = db.prepare('SELECT course_id FROM subject_classes WHERE id = ?').get(a.subject_class_id);
    return cls && cls.course_id === course.id;
  });
}

/** SQL WHERE cho danh sách khóa học theo phạm vi dữ liệu. */
export function courseScopeSql(user) {
  if (isAdmin(user)) return { sql: '1 = 1', params: [] };
  const clauses = [];
  const params = [];
  if (isStaff(user) && user.department_id) {
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
  return isAdmin(user) || isStaff(user) || isInstructor(user);
}

export function classRole(db, user, cls) {
  if (!cls) return null;
  if (isAdmin(user)) return 'ADMIN';
  if (isStaff(user) && sameDept(user, cls.department_id)) return 'ACADEMIC_STAFF';
  const assignment = staffAssignments(db, user.id, cls.id)[0];
  if (assignment) return assignment.staff_role;
  if (isStudent(user)) {
    const e = db
      .prepare(`SELECT 1 FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`)
      .get(cls.id, user.id);
    if (e) return 'STUDENT';
  }
  return null;
}

export function classCapabilities(db, user, cls) {
  const role = classRole(db, user, cls);
  const assignment = role && ['PRIMARY_INSTRUCTOR', 'CO_INSTRUCTOR', 'TEACHING_ASSISTANT'].includes(role)
    ? staffAssignments(db, user.id, cls.id)[0]
    : null;
  const perms = assignment ? assignment.permissions : {};
  const admin = role === 'ADMIN' || role === 'ACADEMIC_STAFF';
  const instructor = role === 'PRIMARY_INSTRUCTOR' || role === 'CO_INSTRUCTOR';
  return {
    role,
    can_view: Boolean(role),
    can_view_roster: Boolean(role) && role !== 'STUDENT',
    can_manage_class: admin || instructor,
    can_manage_sessions: admin || instructor,
    can_manage_roster: admin || (instructor && INSTRUCTOR_CAN_MANAGE_ROSTER),
    can_manage_staff: admin,
    can_take_attendance: admin || instructor || (role === 'TEACHING_ASSISTANT' && Boolean(perms.can_take_attendance)),
    can_lock_attendance: admin,
    can_confirm_teaching_log: instructor || role === 'ADMIN',
  };
}

export function classScopeSql(user) {
  if (isAdmin(user)) return { sql: '1 = 1', params: [] };
  const clauses = [];
  const params = [];
  if (isStaff(user) && user.department_id) {
    clauses.push('sc.department_id = ?');
    params.push(user.department_id);
  }
  clauses.push(`sc.id IN (SELECT subject_class_id FROM teaching_staff_assignments WHERE user_id = ? AND is_active = 1)`);
  params.push(user.id);
  return { sql: `(${clauses.join(' OR ')})`, params };
}
