/**
 * LMSPLUS Organization & Departments Service (`backend/organization/departments.mjs`)
 * Quản lý cơ cấu tổ chức (Tổ chức / Khoa / Bộ môn / Trung tâm) và quy trình học thuật cấp bộ môn.
 */

import crypto from 'node:crypto';
import { appCache } from '../common/cache.mjs';
import { fail, nowIso, oneOf, text, tx } from '../teaching/http.mjs';
import {
  assertDepartmentScope,
  isAdmin,
  isHeadOfDepartment,
  isStaff,
  safeJson,
} from '../teaching/scope.mjs';

const VALID_ORG_TYPES = ['ORGANIZATION', 'FACULTY', 'DEPARTMENT', 'CENTER'];

async function wouldCreateCycle(db, deptId, targetParentId) {
  let cursor = targetParentId;
  const visited = new Set([deptId]);
  let hops = 0;
  while (cursor && hops < 32) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const parentRow = await db.prepare('SELECT parent_id FROM departments WHERE id = ?').get(cursor);
    if (!parentRow) break;
    cursor = parentRow.parent_id;
    hops++;
  }
  return false;
}

export function registerDepartmentRoutes(route) {
  route('GET', '/departments', async ({ db, user, url }) => {
    const activeOnly = url.searchParams.get('active_only') === '1';
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const scopeKey = isAdmin(user)
      ? `ADMIN:${activeOnly ? 1 : 0}`
      : (isHeadOfDepartment(user) || isStaff(user))
        ? `DEPT:${user.department_id || 'NONE'}:${activeOnly ? 1 : 0}`
        : `OTHER:${activeOnly ? 1 : 0}`;

    const basePayload = await appCache.remember(db, 'departments', scopeKey, async () => {
      const [rows, courseCounts, userCounts, classCounts] = await Promise.all([
        db
          .prepare(
            `SELECT d.*, u.full_name AS head_user_name, u.code AS head_user_code, u.email AS head_user_email
             FROM departments d
             LEFT JOIN users u ON u.id = d.head_user_id
             ORDER BY CASE WHEN d.parent_id IS NULL THEN 0 ELSE 1 END, LOWER(d.name) ASC`
          )
          .all(),
        db.prepare('SELECT department_id, COUNT(*) AS cnt FROM courses GROUP BY department_id').all(),
        db.prepare('SELECT department_id, COUNT(*) AS cnt FROM users WHERE COALESCE(is_active, 1) = 1 GROUP BY department_id').all(),
        db
          .prepare(
            `SELECT c.department_id, COUNT(*) AS cnt
             FROM subject_classes sc
             JOIN courses c ON c.id = sc.course_id
             WHERE sc.status IN ('ACTIVE', 'UPCOMING')
             GROUP BY c.department_id`
          )
          .all(),
      ]);

      const cMap = new Map(courseCounts.map((r) => [r.department_id, Number(r.cnt || 0)]));
      const uMap = new Map(userCounts.map((r) => [r.department_id, Number(r.cnt || 0)]));
      const scMap = new Map(classCounts.map((r) => [r.department_id, Number(r.cnt || 0)]));

      let items = rows.map((d) => ({
        ...d,
        is_active: Number(d.is_active ?? 1) === 1,
        courses_count: cMap.get(d.id) || 0,
        members_count: uMap.get(d.id) || 0,
        active_classes_count: scMap.get(d.id) || 0,
      }));

      if (!isAdmin(user) && (isHeadOfDepartment(user) || isStaff(user))) {
        items = items.filter((d) => !d.parent_id || d.id === user.department_id);
      }
      if (activeOnly) items = items.filter((d) => d.is_active);
      return items;
    });

    const filtered = q
      ? basePayload.filter(
          (d) =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.code || '').toLowerCase().includes(q) ||
            (d.head_user_name || '').toLowerCase().includes(q)
        )
      : basePayload;

    return {
      items: filtered,
      capabilities: {
        can_manage: isAdmin(user),
      },
    };
  });

  route('GET', '/departments/:id/summary', async ({ db, user, params }) => {
    const dept = await db
      .prepare(
        `SELECT d.*, u.full_name AS head_user_name, u.code AS head_user_code
         FROM departments d
         LEFT JOIN users u ON u.id = d.head_user_id
         WHERE d.id = ?`
      )
      .get(params.id);
    if (!dept) fail(404, 'DEPARTMENT_NOT_FOUND', 'Không tìm thấy đơn vị/bộ môn.');
    if (!isAdmin(user)) {
      assertDepartmentScope(user, dept.id, 'Bạn không có quyền xem tổng hợp bộ môn khác.');
    }

    const courseCols = typeof db.columnNames === 'function' ? await db.columnNames('courses') : [];
    const hasLifecycle = courseCols.includes('lifecycle_status');
    const hasVersionCode = courseCols.includes('version_code');
    const coursesRaw = await db
      .prepare(
        `SELECT id, code, title, status,
                ${hasLifecycle ? 'lifecycle_status' : 'status'} AS syllabus_status,
                ${hasVersionCode ? 'version_code' : "'v2026.1'"} AS version_code,
                instructor_id, instructor_name, updated_at
         FROM courses
         WHERE department_id = ?
         ORDER BY updated_at DESC`
      )
      .all(dept.id);
    const courses = coursesRaw.map((c) => ({
      ...c,
      current_version: Number(String(c.version_code || '1').replace(/^v/i, '')) || 1,
    }));

    const membersRaw = await db
      .prepare(
        `SELECT id, code, email, full_name, roles_json, department_id, is_active
         FROM users
         WHERE department_id = ? AND COALESCE(is_active, 1) = 1
         ORDER BY LOWER(full_name) ASC`
      )
      .all(dept.id);

    const members = membersRaw.map((m) => ({
      ...m,
      roles: safeJson(m.roles_json, []),
      roles_json: undefined,
    }));

    const currCols = typeof db.columnNames === 'function' ? await db.columnNames('curricula') : [];
    const hasCurrLifecycle = currCols.includes('lifecycle_status');
    const pendingCurricula =
      currCols.length === 0
        ? []
        : await db
            .prepare(
              `SELECT id, code, title, effective_date AS academic_year, status,
                      ${hasCurrLifecycle ? 'lifecycle_status' : 'status'} AS lifecycle_status,
                      updated_at
               FROM curricula
               WHERE department_id = ?
                 AND (${hasCurrLifecycle ? "lifecycle_status IN ('DRAFT', 'PENDING_APPROVAL') OR " : ''}status = 'DRAFT')
               ORDER BY updated_at DESC`
            )
            .all(dept.id);

    return {
      department: { ...dept, is_active: Number(dept.is_active ?? 1) === 1 },
      courses,
      pending_syllabus_courses: courses.filter((c) =>
        ['SYLLABUS_SUBMITTED', 'PENDING_APPROVAL', 'DRAFT'].includes(c.syllabus_status || c.status)
      ),
      pending_curricula: pendingCurricula,
      members,
      can_approve_academic: isAdmin(user) || isHeadOfDepartment(user) || isStaff(user),
    };
  });

  route('POST', '/departments', async ({ db, user, body, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được tạo đơn vị/khoa/bộ môn mới.');
    }
    const code = text(body, 'code', { required: true, min: 2, max: 40, label: 'mã đơn vị' }).toUpperCase();
    const name = text(body, 'name', { required: true, min: 2, max: 160, label: 'tên đơn vị/bộ môn' });
    const orgType = oneOf(body, 'org_type', VALID_ORG_TYPES, { fallback: 'DEPARTMENT', label: 'loại hình đơn vị' });
    const parentId = body.parent_id ? text(body, 'parent_id', { max: 64, label: 'đơn vị cấp trên' }) : null;
    const headUserId = body.head_user_id ? text(body, 'head_user_id', { max: 64, label: 'Trưởng bộ môn' }) : null;
    const description = text(body, 'description', { max: 1000, label: 'mô tả' }) || '';

    const dup = await db.prepare('SELECT id FROM departments WHERE LOWER(code) = LOWER(?)').get(code);
    if (dup) fail(409, 'DUPLICATE', `Mã đơn vị "${code}" đã tồn tại.`);

    if (parentId) {
      const parent = await db.prepare('SELECT id FROM departments WHERE id = ?').get(parentId);
      if (!parent) fail(404, 'PARENT_DEPARTMENT_NOT_FOUND', 'Đơn vị cấp trên không tồn tại.');
    }
    if (headUserId) {
      const head = await db.prepare('SELECT id FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1').get(headUserId);
      if (!head) fail(404, 'USER_NOT_FOUND', 'Không tìm thấy nhân sự được bổ nhiệm làm Trưởng bộ môn.');
    }

    const id = `dept_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    await tx(db, async () => {
      await db
        .prepare(
          `INSERT INTO departments (id, code, name, parent_id, org_type, head_user_id, description, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, code, name, parentId, orgType, headUserId, description, now, now);
    });

    appCache.invalidatePrefix(db, 'departments');
    log('INFO', `[org] department created ${code} (${id}) by ${user.id}`);
    return [201, await db.prepare('SELECT * FROM departments WHERE id = ?').get(id)];
  });

  route('PATCH', '/departments/:id', async ({ db, user, body, params, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được cập nhật cơ cấu đơn vị.');
    }
    const existing = await db.prepare('SELECT * FROM departments WHERE id = ?').get(params.id);
    if (!existing) fail(404, 'DEPARTMENT_NOT_FOUND', 'Không tìm thấy đơn vị/bộ môn.');

    const updates = {};
    if ('code' in body) {
      const nextCode = text(body, 'code', { required: true, min: 2, max: 40, label: 'mã đơn vị' }).toUpperCase();
      const dup = await db.prepare('SELECT id FROM departments WHERE LOWER(code) = LOWER(?) AND id <> ?').get(nextCode, existing.id);
      if (dup) fail(409, 'DUPLICATE', `Mã đơn vị "${nextCode}" đã tồn tại.`);
      updates.code = nextCode;
    }
    if ('name' in body) updates.name = text(body, 'name', { required: true, min: 2, max: 160, label: 'tên đơn vị' });
    if ('org_type' in body) updates.org_type = oneOf(body, 'org_type', VALID_ORG_TYPES, { required: true, label: 'loại hình đơn vị' });
    if ('description' in body) updates.description = text(body, 'description', { max: 1000, label: 'mô tả' }) || '';
    if ('is_active' in body) updates.is_active = body.is_active ? 1 : 0;

    if ('parent_id' in body) {
      const nextParent = body.parent_id ? text(body, 'parent_id', { max: 64, label: 'đơn vị cấp trên' }) : null;
      if (nextParent) {
        if (nextParent === existing.id || await wouldCreateCycle(db, existing.id, nextParent)) {
          fail(422, 'DEPARTMENT_CYCLE', 'Không thể chọn đơn vị cấp dưới hoặc chính đơn vị này làm cấp trên.');
        }
        const parent = await db.prepare('SELECT id FROM departments WHERE id = ?').get(nextParent);
        if (!parent) fail(404, 'PARENT_DEPARTMENT_NOT_FOUND', 'Đơn vị cấp trên không tồn tại.');
      }
      updates.parent_id = nextParent;
    }

    if ('head_user_id' in body) {
      const nextHead = body.head_user_id ? text(body, 'head_user_id', { max: 64, label: 'Trưởng bộ môn' }) : null;
      if (nextHead) {
        const u = await db.prepare('SELECT id FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1').get(nextHead);
        if (!u) fail(404, 'USER_NOT_FOUND', 'Không tìm thấy nhân sự được bổ nhiệm.');
      }
      updates.head_user_id = nextHead;
    }

    const keys = Object.keys(updates);
    if (keys.length > 0) {
      const now = nowIso();
      await tx(db, async () => {
        await db
          .prepare(`UPDATE departments SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...keys.map((k) => updates[k]), now, existing.id);

        if ('name' in updates) {
          await db.prepare('UPDATE courses SET department_name = ? WHERE department_id = ?').run(updates.name, existing.id);
        }
      });
      appCache.invalidatePrefix(db, 'departments');
      log('INFO', `[org] department updated ${existing.id} by ${user.id}`);
    }

    return await db.prepare('SELECT * FROM departments WHERE id = ?').get(existing.id);
  });

  route('DELETE', '/departments/:id', async ({ db, user, params, log }) => {
    if (!isAdmin(user)) {
      fail(403, 'FORBIDDEN', 'Chỉ Quản trị viên mới được xóa/ngừng hoạt động đơn vị.');
    }
    const existing = await db.prepare('SELECT * FROM departments WHERE id = ?').get(params.id);
    if (!existing) fail(404, 'DEPARTMENT_NOT_FOUND', 'Không tìm thấy đơn vị/bộ môn.');
    if (!existing.parent_id) {
      fail(409, 'CANNOT_DELETE_ROOT_ORG', 'Không thể xóa đơn vị gốc của hệ thống.');
    }

    const childCnt = Number((await db.prepare('SELECT COUNT(*) AS n FROM departments WHERE parent_id = ? AND is_active = 1').get(existing.id))?.n || 0);
    const userCnt = Number((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE department_id = ? AND COALESCE(is_active, 1) = 1').get(existing.id))?.n || 0);
    const courseCnt = Number((await db.prepare('SELECT COUNT(*) AS n FROM courses WHERE department_id = ?').get(existing.id))?.n || 0);
    if (childCnt > 0 || userCnt > 0 || courseCnt > 0) {
      fail(
        409,
        'DEPARTMENT_IN_USE',
        `Đơn vị đang có ${childCnt} đơn vị con, ${userCnt} nhân sự và ${courseCnt} khóa học. Hãy chuyển dữ liệu trước khi xóa.`
      );
    }

    await db.prepare('DELETE FROM departments WHERE id = ?').run(existing.id);
    appCache.invalidatePrefix(db, 'departments');
    log('INFO', `[org] department deleted ${existing.id} by ${user.id}`);
    return { deleted_id: existing.id };
  });
}
