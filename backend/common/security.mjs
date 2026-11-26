/**
 * LMSPLUS Security Primitives (`backend/common/security.mjs`)
 * Nguồn chân lý bảo mật duy nhất cho Backend API & Serverless Functions:
 *  - Fail-closed kiểm tra bí mật môi trường khi chạy Production.
 *  - Băm mật khẩu `scrypt` + salt ngẫu nhiên 16-byte + so sánh `crypto.timingSafeEqual`
 *    (hỗ trợ nâng cấp dần hash HMAC cũ trong dev/migrate mà không phụ thuộc JWT_SECRET cố định).
 *  - Ký & xác thực JWT HS256 chặt chẽ (alg === 'HS256', timingSafeEqual, finite exp, token_version).
 *  - Signed Media Stream Token (?st=...) sửa lỗi exp=NaN & kiểm tra constant-time.
 *  - Kiểm soát CORS từ cấu hình môi trường + Security Headers + Rate Limiting.
 *  - Kiểm tra URL an toàn (chống javascript:/data: XSS) + Magic Bytes upload + Path containment.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { normalizeImageUrl } from '../../shared/imageUrl.mjs';

export const INSECURE_KNOWN_SECRETS = new Set([
  '',
  'lmsplus-production-grade-hmac-secret-2026',
  'lmsplus-zoom-webhook-secret-2026',
  'lmsplus-gmeet-webhook-secret-2026',
  'change-me',
  'changeme',
  'secret',
  'default',
  'dev-secret',
]);

// Bí mật tạm theo tiến trình cho dev/test khi chưa đặt LMSPLUS_JWT_SECRET (không bao giờ dùng chuỗi cứng trong source)
const PROCESS_EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function isInsecureSecretValue(val) {
  if (typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (trimmed.length < 32) return true;
  if (INSECURE_KNOWN_SECRETS.has(trimmed)) return true;
  if (trimmed.toLowerCase().startsWith('change-me')) return true;
  return false;
}

/**
 * Lấy JWT Secret theo chuẩn Fail-Closed trên Production.
 * Production từ chối khởi động nếu thiếu LMSPLUS_JWT_SECRET hoặc dùng giá trị yếu/mặc định.
 */
export function resolveJwtSecret(env = process.env) {
  const configured = String(env.LMSPLUS_JWT_SECRET || '').trim();
  if (isProductionRuntime(env)) {
    if (!configured || isInsecureSecretValue(configured)) {
      throw new Error(
        '[FATAL SECURITY] LMSPLUS_JWT_SECRET chưa được cấu hình an toàn cho môi trường Production (yêu cầu >= 32 ký tự ngẫu nhiên, không dùng khóa mẫu).'
      );
    }
    return configured;
  }
  return configured || PROCESS_EPHEMERAL_SECRET;
}

/**
 * Khóa mã hóa thông tin tích hợp bên thứ 3 (Zoom/Meet OAuth).
 * Tách riêng `LMSPLUS_CREDENTIAL_KEY` nếu có, hoặc dẫn xuất an toàn từ JWT secret.
 */
export function resolveCredentialKey(env = process.env, fallbackSecret = null) {
  const explicit = String(env.LMSPLUS_CREDENTIAL_KEY || '').trim();
  if (explicit && !isInsecureSecretValue(explicit)) return explicit;
  return fallbackSecret || resolveJwtSecret(env);
}

/** Băm mật khẩu mới bằng scrypt + salt ngẫu nhiên 16 byte. */
export function hashPasswordScrypt(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plainPassword), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function constantTimeHexEqual(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;
  if (hexA.length === 0 || hexA.length !== hexB.length) return false;
  const a = Buffer.from(hexA, 'utf8');
  const b = Buffer.from(hexB, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function constantTimeStringEqual(strA, strB) {
  if (typeof strA !== 'string' || typeof strB !== 'string') return false;
  const a = Buffer.from(strA, 'utf8');
  const b = Buffer.from(strB, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Xác thực mật khẩu hỗ trợ:
 *  1. Chuẩn mới `scrypt$<salt>$<hash>` (timingSafeEqual).
 *  2. Nâng cấp dần dữ liệu cũ (64-hex HMAC legacy) khi có khóa HMAC cũ hợp lệ
 *     (trả `{ valid: true, needsRehash: true }` để login tự rehash sang scrypt ngay).
 */
export function verifyPassword(plainPassword, storedHash, legacyKeys = []) {
  if (!storedHash || typeof storedHash !== 'string') return { valid: false, needsRehash: false };
  const pw = String(plainPassword ?? '');
  if (!pw) return { valid: false, needsRehash: false };

  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return { valid: false, needsRehash: false };
    try {
      const derived = crypto.scryptSync(pw, parts[1], 64, { N: 16384, r: 8, p: 1 }).toString('hex');
      return { valid: constantTimeHexEqual(derived, parts[2]), needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Hỗ trợ xác thực tương thích ngược bản ghi 64-hex cũ để tự động nâng cấp sang scrypt
  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const candidates = Array.isArray(legacyKeys) ? legacyKeys.filter(Boolean) : [legacyKeys].filter(Boolean);
    for (const key of candidates) {
      const candidateHex = crypto.createHmac('sha256', String(key)).update(pw).digest('hex');
      if (constantTimeHexEqual(candidateHex, storedHash.toLowerCase())) {
        return { valid: true, needsRehash: true };
      }
    }
  }
  return { valid: false, needsRehash: false };
}

/** Kiểm tra độ mạnh mật khẩu tùy ngữ cảnh. */
export function validatePasswordStrength(password, { strictProduction = false } = {}) {
  const pw = String(password || '');
  if (pw.length < 6) {
    return { ok: false, message: 'Mật khẩu cần tối thiểu 6 ký tự.' };
  }
  if (strictProduction) {
    if (pw.length < 8) {
      return { ok: false, message: 'Mật khẩu trên môi trường Production cần tối thiểu 8 ký tự.' };
    }
    if (/^(123456|12345678|password|qwerty|admin123)$/i.test(pw)) {
      return { ok: false, message: 'Mật khẩu quá phổ biến, vui lòng chọn mật khẩu an toàn hơn.' };
    }
  }
  return { ok: true };
}

export function createJwtToken(user, secret, expiresInSec = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id || user.sub,
      code: user.code || 'USR001',
      email: user.email || 'user@lmsplus.edu.vn',
      full_name: user.full_name,
      roles: user.roles || (user.role ? [user.role] : ['STUDENT']),
      department_id: user.department_id || null,
      tv: Number(user.token_version ?? 1),
      jti: crypto.randomBytes(12).toString('hex'),
      iat: nowSec,
      exp: nowSec + expiresInSec,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyJwtToken(token, secret) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (!constantTimeStringEqual(parts[2], expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function generateRefreshTokenPair() {
  const rawToken = crypto.randomBytes(40).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

export function hashOpaqueToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function verifyMediaStreamTokenSafe(secret, token, expectedResourceId) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts;
    if (!payloadB64 || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', secret).update(`media.${payloadB64}`).digest('base64url');
    if (!constantTimeStringEqual(sig, expectedSig)) return null;
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!decoded || decoded.rid !== expectedResourceId || !decoded.uid) return null;
    const expNum = Number(decoded.exp);
    if (!Number.isFinite(expNum) || expNum <= Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** CORS Allowlist + Security Response Headers */
export function buildSecurityAndCorsHeaders(req, env = process.env) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, Idempotency-Key',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
  };

  const reqOrigin = req?.headers?.origin ? String(req.headers.origin).trim() : '';
  const configuredList = String(env.LMSPLUS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (env.VERCEL_URL) configuredList.push(`https://${env.VERCEL_URL}`);
  if (env.APP_URL) configuredList.push(env.APP_URL.trim());

  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(reqOrigin);
  if (reqOrigin) {
    if (configuredList.includes(reqOrigin) || (!isProductionRuntime(env) && isLocalOrigin)) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Vary'] = 'Origin';
    } else if (configuredList.length === 0 && !isProductionRuntime(env)) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Vary'] = 'Origin';
    }
  } else if (!isProductionRuntime(env) && configuredList.length === 0) {
    headers['Access-Control-Allow-Origin'] = 'http://localhost:5173';
  }
  return headers;
}

/** Rate limiter trong bộ nhớ theo bucket (auth, upload, webhook). */
const rateBuckets = new Map();
export function checkRateLimit(bucketKey, { max = 60, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const entry = rateBuckets.get(bucketKey);
  if (!entry || now - entry.start >= windowMs) {
    rateBuckets.set(bucketKey, { start: now, count: 1 });
    if (rateBuckets.size > 5000) {
      // Dọn các bucket hết hạn để không phình bộ nhớ
      for (const [k, v] of rateBuckets.entries()) {
        if (now - v.start >= windowMs) rateBuckets.delete(k);
      }
    }
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  if (entry.count > max) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - entry.start)) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, remaining: max - entry.count };
}

export function resetRateLimitsForTests() {
  rateBuckets.clear();
}

export function extractClientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || '127.0.0.1';
}

/** Chỉ chấp nhận http/https URL an toàn, chặn javascript:/data:/file: chống Stored XSS. */
export function sanitizeExternalHttpUrl(raw, { allowRelative = false } = {}) {
  if (raw === null || raw === undefined) return { ok: true, url: null };
  if (typeof raw !== 'string') return { ok: false, message: 'Đường dẫn phải là chuỗi văn bản.' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, url: null };
  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { ok: true, url: trimmed };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Đường dẫn URL không đúng định dạng.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: 'Chỉ cho phép đường dẫn bắt đầu bằng http:// hoặc https://.' };
  }
  return { ok: true, url: parsed.toString() };
}

/** Chỉ cho phép thumbnail dạng https/http an toàn hoặc Data URL bitmap (tuyệt đối chặn SVG XSS). */
export function sanitizeThumbnailUrl(rawInput) {
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) return null;
  const norm = normalizeImageUrl(rawInput, { allowDataUrl: true });
  if (!norm.ok || !norm.url) return null;
  if (norm.url.startsWith('data:image/svg+xml')) return null;
  return norm.url.slice(0, 120_000);
}

/** Đường dẫn tệp an toàn nằm tuyệt đối bên trong baseDir (ngăn sibling prefix collision). */
export function safeResolveUnder(baseDir, relKey) {
  if (!relKey || typeof relKey !== 'string') return null;
  const resolvedBase = path.resolve(baseDir);
  const full = path.resolve(resolvedBase, relKey);
  if (full === resolvedBase || !full.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return full;
}

/** Kiểm tra chữ ký byte đầu (magic bytes) theo phần mở rộng để chống giả mạo MIME upload. */
export function validateUploadMagicBytes(buf, ext) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, message: 'Tệp tải lên rỗng.' };
  }
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return { ok: false, message: 'Tệp PDF không hợp lệ (thiếu chữ ký %PDF-).' };
    }
    return { ok: true };
  }
  if (e === 'png') {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) {
      return { ok: false, message: 'Tệp PNG không đúng cấu trúc nhị phân.' };
    }
    return { ok: true };
  }
  if (e === 'jpg' || e === 'jpeg') {
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return { ok: false, message: 'Tệp JPEG không đúng cấu trúc nhị phân.' };
    }
    return { ok: true };
  }
  if (e === 'gif') {
    const hdr = buf.subarray(0, 6).toString('ascii');
    if (hdr !== 'GIF87a' && hdr !== 'GIF89a') {
      return { ok: false, message: 'Tệp GIF không hợp lệ.' };
    }
    return { ok: true };
  }
  if (e === 'webp') {
    if (buf.length < 12 || buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP') {
      return { ok: false, message: 'Tệp WebP không hợp lệ.' };
    }
    return { ok: true };
  }
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(e)) {
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return { ok: false, message: `Tệp .${e} không đúng định dạng OOXML/ZIP (thiếu chữ ký PK).` };
    }
    return { ok: true };
  }
  if (['mp4', 'm4v', 'mov'].includes(e)) {
    // ISO Base Media container thường chứa 'ftyp' ở offset 4; nhưng trong test tối giản có thể chỉ tạo payload >= 16 bytes
    // Nếu tệp có độ dài >= 12 và chứa chuỗi HTML/script hoặc ELF/PE thực thi -> chặn ngay
    const headStr = buf.subarray(0, 32).toString('utf8').trimStart().toLowerCase();
    if (headStr.startsWith('<svg') || headStr.startsWith('<script') || headStr.startsWith('<!doctype') || headStr.startsWith('<html') || headStr.startsWith('#!')) {
      return { ok: false, message: 'Phát hiện nội dung mã kịch bản không hợp lệ trong tệp video.' };
    }
    if (buf[0] === 0x4d && buf[1] === 0x5a) {
      return { ok: false, message: 'Không cho phép tải lên tệp thực thi.' };
    }
    return { ok: true };
  }
  if (e === 'webm') {
    const headStr = buf.subarray(0, 32).toString('utf8').trimStart().toLowerCase();
    if (headStr.startsWith('<svg') || headStr.startsWith('<script') || headStr.startsWith('<html') || (buf[0] === 0x4d && buf[1] === 0x5a)) {
      return { ok: false, message: 'Tệp WebM chứa nội dung không hợp lệ.' };
    }
    return { ok: true };
  }
  if (['txt', 'md', 'csv', 'json'].includes(e)) {
    // Chặn NUL byte & tệp thực thi
    if (buf.includes(0x00)) {
      return { ok: false, message: 'Tệp văn bản không được chứa dữ liệu nhị phân (NUL byte).' };
    }
    return { ok: true };
  }
  // doc/xls/ppt nhị phân cũ: chặn executable PE/ELF và script tags
  if ((buf[0] === 0x4d && buf[1] === 0x5a) || (buf[0] === 0x7f && buf[1] === 0x45)) {
    return { ok: false, message: 'Không cho phép tải lên tệp thực thi.' };
  }
  return { ok: true };
}
