/**
 * LMSPLUS Teaching Module — tiện ích HTTP, phân trang, kiểm tra dữ liệu đầu vào dùng chung.
 */

import { normalizeImageUrl } from '../../shared/imageUrl.mjs';
import { vnIso } from './schema.mjs';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (status, code, message, extra) => {
  throw new ApiError(status, code, message, extra);
};

export function pageParams(url, defSize = 20, maxSize = 100) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const size = Math.min(
    maxSize,
    Math.max(1, parseInt(url.searchParams.get('page_size') || String(defSize), 10) || defSize)
  );
  return { page, size, offset: (page - 1) * size };
}

export const nowIso = () => new Date().toISOString();
export const nowVn = () => vnIso(new Date());

/** Chuỗi bắt buộc / tùy chọn, có giới hạn độ dài. */
export function text(body, field, { required = false, max = 255, min = 0, label = field } = {}) {
  const v = body[field];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) fail(422, 'VALIDATION_ERROR', `Vui lòng nhập ${label}.`, { field });
    return null;
  }
  if (typeof v !== 'string') fail(422, 'VALIDATION_ERROR', `${label} không hợp lệ.`, { field });
  const t = v.trim();
  if (t.length < min) fail(422, 'VALIDATION_ERROR', `${label} cần tối thiểu ${min} ký tự.`, { field });
  if (t.length > max) fail(422, 'VALIDATION_ERROR', `${label} tối đa ${max} ký tự.`, { field });
  return t;
}

export function intField(body, field, { min, max, label = field, required = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(422, 'VALIDATION_ERROR', `Vui lòng nhập ${label}.`, { field });
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    fail(422, 'VALIDATION_ERROR', `${label} phải là số nguyên từ ${min} đến ${max}.`, { field });
  }
  return n;
}

export function oneOf(body, field, allowed, { label = field, required = false, fallback = null } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(422, 'VALIDATION_ERROR', `Vui lòng chọn ${label}.`, { field });
    return fallback;
  }
  if (!allowed.includes(v)) fail(422, 'VALIDATION_ERROR', `${label} không hợp lệ.`, { field });
  return v;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dateField(body, field, { required = false, label = field } = {}) {
  const v = body[field];
  if (!v) {
    if (required) fail(422, 'VALIDATION_ERROR', `Vui lòng nhập ${label}.`, { field });
    return null;
  }
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    fail(422, 'VALIDATION_ERROR', `${label} phải có dạng YYYY-MM-DD.`, { field });
  }
  return v;
}

export function timeField(body, field, { required = true, label = field } = {}) {
  const v = body[field];
  if (!v) {
    if (required) fail(422, 'VALIDATION_ERROR', `Vui lòng nhập ${label}.`, { field });
    return null;
  }
  if (typeof v !== 'string' || !TIME_RE.test(v)) fail(422, 'VALIDATION_ERROR', `${label} phải có dạng HH:MM.`, { field });
  return v;
}

export function httpsUrlField(body, field, { label = field } = {}) {
  const v = text(body, field, { max: 2048, label });
  if (!v) return null;
  let u;
  try {
    u = new URL(v);
  } catch {
    fail(422, 'VALIDATION_ERROR', `${label} không phải đường dẫn hợp lệ.`, { field });
  }
  if (u.protocol !== 'https:') fail(422, 'VALIDATION_ERROR', `${label} phải bắt đầu bằng https://`, { field });
  return u.toString();
}

/**
 * Kiểm tra & chuẩn hóa đường dẫn hình ảnh (tự bóc link Bing/Google/Drive/Dropbox và hỗ trợ Data URL ảnh bitmap an toàn).
 */
export function imageUrlField(body, field, { label = field } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return null;
  }
  if (typeof raw !== 'string') {
    fail(422, 'VALIDATION_ERROR', `${label} không hợp lệ.`, { field });
  }
  const normalized = normalizeImageUrl(raw, { allowDataUrl: true });
  if (!normalized.ok) {
    fail(422, 'VALIDATION_ERROR', normalized.message, { field });
  }
  if (!normalized.isDataUrl && !normalized.url.startsWith('https://')) {
    fail(422, 'VALIDATION_ERROR', `${label} phải là đường dẫn https:// hợp lệ.`, { field });
  }
  return normalized.url;
}

/** Thực thi trong transaction; tự rollback nếu lỗi. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, code: row.code, full_name: row.full_name, email: row.email };
}

/** Sắp xếp tên tiếng Việt theo tên riêng (từ cuối), sau đó họ tên đầy đủ. */
export function compareVietnameseName(a, b) {
  const given = (n) => String(n || '').trim().split(/\s+/).pop() || '';
  return given(a).localeCompare(given(b), 'vi') || String(a).localeCompare(String(b), 'vi');
}

/** Chuẩn hóa tên tệp an toàn chống path traversal / ký tự điều khiển. */
export function safeFilename(name, fallback = 'file') {
  const cleaned = String(name || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim();
  return cleaned.slice(0, 200) || fallback;
}
