/**
 * LMSPLUS Users & RBAC Account Management (`backend/users/usersService.mjs`)
 * Thay thế dần legacy `workspace/bootstrap` & `/crud/users` với:
 *  - Băm mật khẩu scrypt + random salt
 *  - Tự động tăng `token_version` & thu hồi Refresh Token khi đổi vai trò / đơn vị / mật khẩu / khóa tài khoản
 *  - Kiểm tra Data Scope nghiêm ngặt & soft-deactivate bảo toàn khóa ngoại lịch sử học tập
 */

import crypto from 'node:crypto';
import { fail, nowIso, text, tx } from '../teaching/http.mjs';
import {
  isAdmin,
  isHeadOfDepartment,
  isStaff,
  isSuperAdmin,
  safeJson,
} from '../teaching/scope.mjs';
import { hashPasswordScrypt, isProductionRuntime, validatePasswordStrength } from '../common/security.mjs';

const VALID_ROLES = [
  'STUDENT',
  'INSTRUCTOR',
  'TEACHING_ASSISTANT',
  'HEAD_OF_DEPARTMENT',
  'ACADEMIC_STAFF',
  'ADMIN',
  'SUPER_ADMIN',
];

function formatUserDto(row) {
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    full_name: row.full_name,
    roles: safeJson(row.roles_json, []),
    department_id: row.department_id || null,
    is_active: Number(row.is_active ?? 1) === 1,
    token_version: Number(row.token_version ?? 1),
  };
}

function normalizeRolesInput(user, body) {
  const rawList = Array.isArray(body.roles)
    ? body.roles
    : typeof body.role === 'string' && body.role.trim()
      ? [body.role.trim()]
      : null;
  if (!rawList || rawList.length === 0) {
    fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn ít nhất một vai trò hợp lệ.', { field: 'roles' });
  }
  const unique = [...new Set(rawList.map((r) => String(r).trim()).filter(Boolean))];
  for (const r of unique) {
    if (!VALID_ROLES.includes(r)) {
      fail(422, 'VALIDATION_ERROR', `Vai trò "${r}" không hợp lệ.`, { field: 'roles' });
    }
    if (r === 'SUPER_ADMIN' && !isSuperAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị tối cao (SUPER_ADMIN) mới được cấp quyền SUPER_ADMIN.');
    }
  }
  return unique;
}

export function registerUsersRoutes(route) {
  route('GET', '/users', async ({ db, user, url }) => {
    if (!isAdmin(user) && !isStaff(user) && !isHeadOfDepartment(user)) {
      fail(403, 'FORBIDDEN', 'Bạn không có quyền truy cập danh sách tài khoản hệ thống.');
    }

    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const roleFilter = (url.searchParams.get('role') || '').trim();
    const deptFilter = (url.searchParams.get('department_id') || '').trim();
    const includeInactive = url.searchParams.get('include_inactive') === '1';

    let rows;
    if (isAdmin(user)) {
      rows = await db
        .prepare(
          `SELECT id, code, email, full_name, roles_json, department_id, is_active, token_version
           FROM users
           ORDER BY LOWER(full_name) ASC`
        )
        .all();
    } else {
      if (!user.department_id) {
        return { items: [], total: 0, capabilities: { can_create: false, can_manage: false } };
      }
      // Giáo vụ / Trưởng bộ môn chỉ thấy nhân sự thuộc bộ môn hoặc học viên trong lớp thuộc bộ môn mình
      rows = await db
        .prepare(
          `SELECT DISTINCT u.id, u.code, u.email, u.full_name, u.roles_json, u.department_id, u.is_active, u.token_version
           FROM users u
           LEFT JOIN class_enrollments ce ON ce.student_id = u.id AND ce.status = 'ACTIVE'
           LEFT JOIN subject_classes sc ON sc.id = ce.subject_class_id
           LEFT JOIN courses c ON c.id = sc.course_id
           WHERE u.department_id = ? OR c.department_id = ?
           ORDER BY LOWER(u.full_name) ASC`
        )
        .all(user.department_id, user.department_id);
    }

    let items = rows.map(formatUserDto);
    if (!includeInactive) items = items.filter((u) => u.is_active);
    if (roleFilter) items = items.filter((u) => u.roles.includes(roleFilter));
    if (deptFilter) items = items.filter((u) => u.department_id === deptFilter);
    if (q) {
      items = items.filter(
        (u) =>
          (u.full_name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.code || '').toLowerCase().includes(q)
      );
    }

    return {
      items,
      total: items.length,
      capabilities: {
        can_create: isAdmin(user),
        can_manage: isAdmin(user),
      },
    };
  });

  route('POST', '/users', async ({ db, user, body, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được tạo tài khoản người dùng.');
    }
    const fullName = text(body, 'full_name', { required: true, min: 2, max: 160, label: 'họ và tên' });
    const email = text(body, 'email', { required: true, min: 5, max: 180, label: 'email' }).toLowerCase();
    if (!email.includes('@')) {
      fail(422, 'VALIDATION_ERROR', 'Email không đúng định dạng.', { field: 'email' });
    }
    const roles = normalizeRolesInput(user, body);
    const pwdCheck = validatePasswordStrength(body.password || '', { strictProduction: isProductionRuntime() });
    if (!pwdCheck.ok) {
      fail(422, 'WEAK_PASSWORD', pwdCheck.message, { field: 'password' });
    }
    const departmentId = body.department_id ? text(body, 'department_id', { max: 64, label: 'đơn vị/bộ môn' }) : null;
    if (departmentId) {
      const dept = await db.prepare('SELECT id FROM departments WHERE id = ?').get(departmentId);
      if (!dept) fail(404, 'DEPARTMENT_NOT_FOUND', 'Đơn vị/bộ môn không tồn tại.');
    }

    const code =
      (body.code ? text(body, 'code', { max: 40, label: 'mã định danh' }) : null) ||
      `USR${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const existing = await db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(code) = LOWER(?)')
      .get(email, code);
    if (existing) {
      fail(409, 'DUPLICATE', 'Email hoặc mã định danh đã tồn tại trong hệ thống.');
    }

    const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const pwdHash = hashPasswordScrypt(String(body.password));

    await tx(db, async () => {
      await db
        .prepare(
          `INSERT INTO users (id, code, email, full_name, password_hash, roles_json, department_id, assigned_course_ids_json, enrolled_subject_class_ids_json, token_version, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 1, 1)`
        )
        .run(id, code, email, fullName, pwdHash, JSON.stringify(roles), departmentId);
    });

    log('INFO', `[users] created account ${code} (${roles.join(',')}) by ${user.id}`);
    const created = await db.prepare('SELECT id, code, email, full_name, roles_json, department_id, is_active, token_version FROM users WHERE id = ?').get(id);
    return [201, formatUserDto(created)];
  });

  route('PATCH', '/users/:id', async ({ db, user, body, params, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được chỉnh sửa tài khoản.');
    }
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!target) fail(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    const targetRoles = safeJson(target.roles_json, []);
    if (targetRoles.includes('SUPER_ADMIN') && !isSuperAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Không có quyền sửa tài khoản SUPER_ADMIN.');
    }

    const sets = [];
    const args = [];
    let mustRevokeSession = false;

    if ('full_name' in body) {
      sets.push('full_name = ?');
      args.push(text(body, 'full_name', { required: true, min: 2, max: 160, label: 'họ và tên' }));
    }
    if ('email' in body) {
      const nextEmail = text(body, 'email', { required: true, min: 5, max: 180, label: 'email' }).toLowerCase();
      const dup = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?').get(nextEmail, target.id);
      if (dup) fail(409, 'DUPLICATE', 'Email đã được sử dụng bởi tài khoản khác.');
      sets.push('email = ?');
      args.push(nextEmail);
    }
    if ('code' in body && body.code) {
      const nextCode = text(body, 'code', { required: true, min: 2, max: 40, label: 'mã định danh' });
      const dup = await db.prepare('SELECT id FROM users WHERE LOWER(code) = LOWER(?) AND id <> ?').get(nextCode, target.id);
      if (dup) fail(409, 'DUPLICATE', 'Mã định danh đã tồn tại.');
      sets.push('code = ?');
      args.push(nextCode);
    }
    if ('roles' in body || 'role' in body) {
      const nextRoles = normalizeRolesInput(user, body);
      sets.push('roles_json = ?');
      args.push(JSON.stringify(nextRoles));
      mustRevokeSession = true;
    }
    if ('department_id' in body) {
      const nextDept = body.department_id ? text(body, 'department_id', { max: 64, label: 'đơn vị/bộ môn' }) : null;
      if (nextDept) {
        const dept = await db.prepare('SELECT id FROM departments WHERE id = ?').get(nextDept);
        if (!dept) fail(404, 'DEPARTMENT_NOT_FOUND', 'Đơn vị/bộ môn không tồn tại.');
      }
      sets.push('department_id = ?');
      args.push(nextDept);
      mustRevokeSession = true;
    }
    if ('is_active' in body) {
      const activeFlag = body.is_active ? 1 : 0;
      if (target.id === user.id && activeFlag === 0) {
        fail(422, 'CANNOT_LOCK_SELF', 'Bạn không thể tự khóa tài khoản đang đăng nhập.');
      }
      sets.push('is_active = ?');
      args.push(activeFlag);
      mustRevokeSession = true;
    }
    if (body.password) {
      const pwdCheck = validatePasswordStrength(body.password, { strictProduction: isProductionRuntime() });
      if (!pwdCheck.ok) fail(422, 'WEAK_PASSWORD', pwdCheck.message, { field: 'password' });
      sets.push('password_hash = ?');
      args.push(hashPasswordScrypt(String(body.password)));
      mustRevokeSession = true;
    }

    if (sets.length > 0) {
      if (mustRevokeSession) {
        sets.push('token_version = COALESCE(token_version, 1) + 1');
      }
      await tx(db, async () => {
        await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, target.id);
        if (mustRevokeSession) {
          await db.prepare('UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?').run(nowIso(), target.id);
        }
      });
      log('INFO', `[users] updated ${target.id} (revoked=${mustRevokeSession}) by ${user.id}`);
    }

    const updated = await db
      .prepare('SELECT id, code, email, full_name, roles_json, department_id, is_active, token_version FROM users WHERE id = ?')
      .get(target.id);
    return formatUserDto(updated);
  });

  route('DELETE', '/users/:id', async ({ db, user, params, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được vô hiệu hóa tài khoản.');
    }
    if (params.id === user.id) {
      fail(422, 'CANNOT_DELETE_SELF', 'Không thể tự vô hiệu hóa chính mình.');
    }
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!target) fail(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    const roles = safeJson(target.roles_json, []);
    if (roles.includes('SUPER_ADMIN') && !isSuperAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Không có quyền vô hiệu hóa tài khoản SUPER_ADMIN.');
    }

    await tx(db, async () => {
      await db
        .prepare('UPDATE users SET is_active = 0, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?')
        .run(target.id);
      await db.prepare('UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?').run(nowIso(), target.id);
    });
    log('INFO', `[users] deactivated ${target.id} by ${user.id}`);
    return { deactivated_id: target.id, is_active: false };
  });
}
