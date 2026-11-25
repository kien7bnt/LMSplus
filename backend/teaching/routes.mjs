/**
 * LMSPLUS Teaching Module — bộ định tuyến cho /api/v1/teaching/*
 */

import { ApiError } from './http.mjs';
import { isUniqueViolation, isForeignKeyViolation, isCheckViolation } from '../db/client.mjs';
import { registerCourseRoutes } from './courses.mjs';
import { registerClassRoutes } from './classes.mjs';
import { registerAttendanceRoutes } from './attendance.mjs';
import { registerLearnRoutes } from './learn.mjs';
import { registerStudioRoutes } from './studio.mjs';
import { registerVirtualClassroomRoutes } from './virtualClassroom.mjs';
import { registerStrictVideoRoutes } from './strictVideo.mjs';
import { registerCurriculaAndCohortRoutes } from './curriculaAndCohorts.mjs';
import { registerContentTreeAndSnapshotRoutes } from './contentTreeAndSnapshots.mjs';
import { registerBankRoutes } from './banks.mjs';
import { registerAssessmentAndAssignmentRoutes } from './assessmentsAndAssignments.mjs';
import { registerLeaveAndForumRoutes } from './leaveAndForums.mjs';
import { registerTrainingPrepRoutes } from './trainingPrep.mjs';
import { registerTimetableRoutes } from './timetableEngine.mjs';
import { registerTeachingHoursRoutes } from './teachingHours.mjs';

export const TEACHING_PREFIX = '/api/v1/teaching';

export function createTeachingRouter({
  db,
  uploadsDir,
  jwtSecret = 'lmsplus-production-grade-hmac-secret-2026',
  log,
}) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const re = new RegExp(`^${TEACHING_PREFIX}${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
    routes.push({ method, re, handler });
  };
  registerCourseRoutes(route, { uploadsDir });
  registerClassRoutes(route);
  registerAttendanceRoutes(route);
  registerLearnRoutes(route, { jwtSecret });
  registerStudioRoutes(route, { uploadsDir, jwtSecret });
  registerVirtualClassroomRoutes(route, { jwtSecret });
  registerStrictVideoRoutes(route);
  registerCurriculaAndCohortRoutes(route);
  registerTrainingPrepRoutes(route);
  registerContentTreeAndSnapshotRoutes(route);
  registerBankRoutes(route, { uploadsDir });
  registerAssessmentAndAssignmentRoutes(route);
  registerLeaveAndForumRoutes(route);
  registerTimetableRoutes(route);
  registerTeachingHoursRoutes(route);

  /**
   * @returns {Promise<void>}
   */
  return async function handleTeaching({ req, method, pathname, url, body, bodyError, user, res, sendJson }) {
    let matched = null;
    let methodMismatch = false;
    for (const r of routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) {
        methodMismatch = true;
        continue;
      }
      matched = { r, params: Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)])) };
      break;
    }
    if (!matched) {
      sendJson(res, methodMismatch ? 405 : 404, {
        detail: { code: methodMismatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: 'Không tìm thấy chức năng yêu cầu.' },
      });
      return;
    }
    if (bodyError && ['POST', 'PUT', 'PATCH'].includes(method)) {
      sendJson(res, 400, { detail: { code: 'INVALID_JSON', message: 'Dữ liệu gửi lên không đúng định dạng JSON.' } });
      return;
    }

    let sent = false;
    const raw = (status, headers, payload) => {
      sent = true;
      res.writeHead(status, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
        ...headers,
      });
      res.end(payload);
    };
    const finish = (out) => {
      if (sent || res.headersSent) return;
      if (Array.isArray(out) && out.length === 2 && typeof out[0] === 'number') {
        sendJson(res, out[0], { success: true, data: out[1] });
      } else {
        sendJson(res, 200, { success: true, data: out });
      }
    };
    const onError = (err) => {
      if (err instanceof ApiError) {
        sendJson(res, err.status, { detail: { code: err.code, message: err.message, ...err.extra } });
        return;
      }
      if (isUniqueViolation(err)) {
        sendJson(res, 409, { detail: { code: 'DUPLICATE', message: 'Dữ liệu bị trùng lặp.' } });
        return;
      }
      if (isForeignKeyViolation(err)) {
        sendJson(res, 409, { detail: { code: 'REFERENTIAL_INTEGRITY_CONFLICT', message: 'Dữ liệu đang được liên kết bởi bản ghi khác.' } });
        return;
      }
      if (isCheckViolation(err)) {
        sendJson(res, 422, { detail: { code: 'VALIDATION_ERROR', message: 'Giá trị dữ liệu không hợp lệ.' } });
        return;
      }
      log('ERROR', `[teaching] ${method} ${pathname}: ${err && err.stack ? err.stack : err}`);
      sendJson(res, 500, { detail: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' } });
    };

    try {
      const out = await matched.r.handler({ req, db, user, body, url, query: url.searchParams, params: matched.params, res, raw, log });
      finish(out);
    } catch (err) {
      onError(err);
    }
  };
}
