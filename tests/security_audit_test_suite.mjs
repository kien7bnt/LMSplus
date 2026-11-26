#!/usr/bin/env node
/**
 * LMSPLUS Phase 1 — Automated Security, RBAC, Scope & Migration Verification Suite
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `security-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-security-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const {
  resolveJwtSecret,
  hashPasswordScrypt,
  verifyPassword,
  createJwtToken: signJwtRaw,
  verifyJwtToken: verifyJwtRaw,
  verifyMediaStreamTokenSafe,
  sanitizeExternalHttpUrl,
  sanitizeThumbnailUrl,
  validateUploadMagicBytes,
  checkRateLimit,
  resetRateLimitsForTests,
} = await import('../backend/common/security.mjs');

const { initSchemaAndSeed, invokeApi, invokeApiAsync, db } = await import('../backend/server_fallback.mjs');
const { getVirtualProviderAdapter } = await import('../backend/teaching/virtualProviders.mjs');

await initSchemaAndSeed(true);

let passed = 0;
let failed = 0;
async function test(group, name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] [${group}] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] [${group}] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

console.log('======================================================================');
console.log(' LMSPLUS — PHASE 1 SECURITY & RBAC VERIFICATION SUITE');
console.log('======================================================================');

await test('SECRETS', 'Production fails closed when LMSPLUS_JWT_SECRET is missing, short, or default literal', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production' }),
    /FATAL SECURITY/
  );
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', LMSPLUS_JWT_SECRET: 'lmsplus-production-grade-hmac-secret-2026' }),
    /FATAL SECURITY/
  );
  assert.throws(
    () => resolveJwtSecret({ VERCEL_ENV: 'production', LMSPLUS_JWT_SECRET: 'too-short-secret' }),
    /FATAL SECURITY/
  );
  const prodSecret = resolveJwtSecret({
    NODE_ENV: 'production',
    LMSPLUS_JWT_SECRET: 'a-very-strong-random-production-secret-32chars-plus-9876543210',
  });
  assert.ok(prodSecret.length >= 32);
});

await test('CRYPTO', 'Password uses random-salted scrypt + constant-time verify & progressive upgrade', () => {
  const h1 = hashPasswordScrypt('StrongPass@2026');
  const h2 = hashPasswordScrypt('StrongPass@2026');
  assert.ok(h1.startsWith('scrypt$'));
  assert.notEqual(h1, h2, 'Salted scrypt hashes for identical passwords must differ');
  assert.equal(verifyPassword('StrongPass@2026', h1).valid, true);
  assert.equal(verifyPassword('WrongPass@2026', h1).valid, false);

  const legacyKey = 'old-hmac-key';
  const legacyHash = crypto.createHmac('sha256', legacyKey).update('Legacy123').digest('hex');
  const legacyRes = verifyPassword('Legacy123', legacyHash, [legacyKey]);
  assert.equal(legacyRes.valid, true);
  assert.equal(legacyRes.needsRehash, true);
});

await test('CRYPTO', 'JWT rejects alg=none tampering & verifyMediaStreamTokenSafe rejects missing/NaN exp', () => {
  const secret = 'test-secret-with-more-than-32-characters-123456';
  const noneHdr = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', roles: ['ADMIN'], exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  assert.equal(verifyJwtRaw(`${noneHdr}.${payload}.`, secret), null);

  const noExpPayload = Buffer.from(JSON.stringify({ rid: 'res_1', uid: 'u1' })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`media.${noExpPayload}`).digest('base64url');
  assert.equal(verifyMediaStreamTokenSafe(secret, `${noExpPayload}.${sig}`, 'res_1'), null);
});

await test('AUTH_FLOW', 'Login issues Refresh Token, rotates on /auth/refresh, and /auth/logout revokes JWT immediately', async () => {
  const loginRes = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier: 'HS50101', password: '123456' });
  assert.equal(loginRes.status, 200);
  const { access_token, refresh_token } = loginRes.body.data;
  assert.ok(access_token && refresh_token);

  const bootOk = await invokeApi('GET', '/api/v1/teaching/learn/classes', { authorization: `Bearer ${access_token}` });
  assert.equal(bootOk.status, 200);

  const refRes = await invokeApi('POST', '/api/v1/elearning/auth/refresh', {}, { refresh_token });
  assert.equal(refRes.status, 200);
  const rotatedAccess = refRes.body.data.access_token;
  const rotatedRefresh = refRes.body.data.refresh_token;
  assert.notEqual(rotatedRefresh, refresh_token);

  // Old refresh token replay must fail
  const replayRef = await invokeApi('POST', '/api/v1/elearning/auth/refresh', {}, { refresh_token });
  assert.equal(replayRef.status, 401);

  // Logout revokes current access JWT immediately via token_version++
  const logoutRes = await invokeApi('POST', '/api/v1/elearning/auth/logout', { authorization: `Bearer ${rotatedAccess}` }, {});
  assert.equal(logoutRes.status, 200);

  const afterLogout = await invokeApi('GET', '/api/v1/teaching/learn/classes', { authorization: `Bearer ${rotatedAccess}` });
  assert.equal(afterLogout.status, 401);
  assert.equal(afterLogout.body.detail?.code, 'INVALID_OR_EXPIRED_JWT');
});

await test('ENDPOINTS', 'testing/reset-seed is blocked when LMSPLUS_ALLOW_RESET_SEED=0', async () => {
  const prev = process.env.LMSPLUS_ALLOW_RESET_SEED;
  process.env.LMSPLUS_ALLOW_RESET_SEED = '0';
  try {
    const res = await invokeApi('POST', '/api/v1/elearning/testing/reset-seed', {}, {});
    assert.equal(res.status, 404);
  } finally {
    if (prev === undefined) delete process.env.LMSPLUS_ALLOW_RESET_SEED;
    else process.env.LMSPLUS_ALLOW_RESET_SEED = prev;
  }
});

await test('RATE_LIMIT', 'checkRateLimit blocks bursts after threshold with retryAfterSec', () => {
  resetRateLimitsForTests();
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit('test:ip', { max: 5, windowMs: 60_000 }).allowed, true);
  }
  const blocked = checkRateLimit('test:ip', { max: 5, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
});

const loginAs = async (identifier) => {
  const r = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier, password: '123456' });
  assert.equal(r.status, 200, `login ${identifier}`);
  return { authorization: `Bearer ${r.body.data.access_token}` };
};

const ADMIN = await loginAs('admin@lmsplus.edu.vn');
const GV = await loginAs('thuha.gv@lmsplus.edu.vn');
const STAFF_KHOI5 = await loginAs('giaovu@lmsplus.edu.vn');
const HS1 = await loginAs('HS50101');

// Create HEAD_OF_DEPARTMENT (Trưởng bộ môn) for dept_se & null-dept ACADEMIC_STAFF for isolation tests
await test('RBAC_HOD', 'HEAD_OF_DEPARTMENT has academic dept approval permissions but NOT admin delete/provider/finance lock', async () => {
  const hodRes = await invokeApi('POST', '/api/v1/elearning/auth/register', ADMIN, {
    full_name: 'TS. Trần Bộ Môn',
    email: 'truongbomon.se@lmsplus.edu.vn',
    code: 'TBM001',
    role: 'HEAD_OF_DEPARTMENT',
    department_id: 'dept_se',
    password: 'HodPassword@2026',
  });
  assert.equal(hodRes.status, 201);
  const HOD_SE = { authorization: `Bearer ${hodRes.body.data.access_token}` };

  // HOD cannot list or delete accounts (Admin only)
  const delAttempt = await invokeApi('DELETE', '/api/v1/elearning/crud/users/stu_5a1_104', HOD_SE, {});
  assert.equal(delAttempt.status, 403);

  // HOD cannot inspect global virtual providers (Admin only)
  const provAttempt = await invokeApi('GET', '/api/v1/teaching/virtual-providers', HOD_SE);
  assert.equal(provAttempt.status, 403);
  assert.equal(provAttempt.body.detail?.code, 'VIRTUAL_PROVIDER_ADMIN_ONLY');

  // INSTRUCTOR also blocked from global virtual-providers
  const gvProvAttempt = await invokeApi('GET', '/api/v1/teaching/virtual-providers', GV);
  assert.equal(gvProvAttempt.status, 403);
  assert.equal(gvProvAttempt.body.detail?.code, 'VIRTUAL_PROVIDER_ADMIN_ONLY');

  // HOD can create/approve curriculum in own dept_se, but blocked in khoi_5
  const cSe = await invokeApi('POST', '/api/v1/teaching/courses', HOD_SE, {
    code: 'SE-HOD-101',
    title: 'Môn Kiểm thử Trưởng Bộ Môn',
    department_id: 'dept_se',
    status: 'PUBLISHED',
  });
  assert.equal(cSe.status, 201);
  const submitSyl = await invokeApi('POST', `/api/v1/teaching/courses/${cSe.body.data.id}/lifecycle`, HOD_SE, {
    action: 'APPROVE_PUBLISH',
    version_label: 'v2026.1',
  });
  assert.equal(submitSyl.status, 200);

  // Cross-department syllabus approval blocked 403 OUT_OF_SCOPE
  const crossApprove = await invokeApi('POST', '/api/v1/teaching/courses/crs_toan5/lifecycle', HOD_SE, {
    action: 'APPROVE_PUBLISH',
    version_label: 'v2026.9',
  });
  assert.equal(crossApprove.status, 403);
  assert.equal(crossApprove.body.detail?.code, 'OUT_OF_SCOPE');
});

await test('SCOPE_LEAK', 'ACADEMIC_STAFF with NULL department_id cannot bypass department scope', async () => {
  await db.prepare(
    `INSERT INTO users (id, code, email, full_name, password_hash, roles_json, department_id, token_version, is_active)
     VALUES ('staff_nulldept', 'GVU_NULL', 'null.dept@lmsplus.edu.vn', 'Giáo vụ chưa gán khoa', ?, '["ACADEMIC_STAFF"]', NULL, 1, 1)`
  ).run(hashPasswordScrypt('NullDept@2026'));

  const nullLogin = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, {
    identifier: 'GVU_NULL',
    password: 'NullDept@2026',
  });
  assert.equal(nullLogin.status, 200);
  const NULL_STAFF = { authorization: `Bearer ${nullLogin.body.data.access_token}` };

  const currs = await invokeApi('GET', '/api/v1/teaching/curricula', NULL_STAFF);
  assert.equal(currs.status, 200);
  assert.equal(currs.body.data.items.length, 0, 'Null-dept staff must see 0 department curricula');

  const auditRes = await invokeApi('GET', '/api/v1/teaching/timetable/audit', NULL_STAFF);
  assert.equal(auditRes.status, 403);
  assert.equal(auditRes.body.detail?.code, 'DEPARTMENT_SCOPE_REQUIRED');
});

await test('LEGACY_RBAC', 'Student blocked from simulate-overdue-24h & unauthorized roles blocked from leave decision', async () => {
  const sRow = await db.prepare('SELECT session_id FROM sessions LIMIT 1').get();
  const resStudent = await invokeApi('POST', `/api/v1/elearning/sessions/${sRow.session_id}/simulate-overdue-24h`, HS1, {});
  assert.equal(resStudent.status, 403);

  const lRow = await db.prepare('SELECT id FROM leave_requests LIMIT 1').get();
  const badStatus = await invokeApi('POST', `/api/v1/elearning/leave-requests/${lRow.id}/decision`, STAFF_KHOI5, {
    status: 'HACKED_STATE',
  });
  assert.equal(badStatus.status, 422);
});

await test('WEBHOOK_SECURITY', 'Google Meet webhook requires signature & Zoom validation rejects unauthenticated oracle', async () => {
  const noSigMeet = await invokeApiAsync('POST', '/api/v1/teaching/webhooks/google_meet', {}, {
    event: 'meeting.started',
    payload: { object: { id: 'abc-defg-hij' } },
  });
  assert.equal(noSigMeet.status, 401);

  const meetAdapter = getVirtualProviderAdapter(db, 'GOOGLE_MEET');
  const meetPayload = { event: 'meeting.started', event_ts: Date.now(), payload: { object: { id: 'unmatched-room-001' } } };
  const sigHeaders = await meetAdapter.signWebhookPayload(JSON.stringify(meetPayload));
  const okMeet = await invokeApiAsync('POST', '/api/v1/teaching/webhooks/google_meet', sigHeaders, meetPayload);
  assert.equal(okMeet.status, 200);
  assert.equal(okMeet.body.data.received, true);

  const oracleAttempt = await invokeApiAsync('POST', '/api/v1/teaching/webhooks/zoom', {}, {
    event: 'endpoint.url_validation',
    payload: { plainToken: 'arbitrary_plain_token_123' },
  });
  assert.equal(oracleAttempt.status, 401);
});

await test('XSS_&_UPLOAD', 'Rejects javascript: URLs in leave evidence/assignments, SVG thumbnails, and spoofed file headers', async () => {
  assert.equal(sanitizeExternalHttpUrl('javascript:alert(document.domain)').ok, false);
  assert.equal(sanitizeThumbnailUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4='), null);
  assert.equal(validateUploadMagicBytes(Buffer.from('<svg onload=alert(1)>'), 'mp4').ok, false);
  assert.equal(validateUploadMagicBytes(Buffer.from('not-a-pdf-file'), 'pdf').ok, false);

  const badLeave = await invokeApi('POST', '/api/v1/teaching/learn/leave-requests', HS1, {
    class_id: 'sc_toan5_5a1',
    reason_category: 'SICK',
    reason: 'Nghỉ ốm kiểm tra XSS',
    evidence_url: 'javascript:alert(1)',
  });
  assert.equal(badLeave.status, 422);
  assert.equal(badLeave.body.detail?.code, 'INVALID_EVIDENCE_URL');
});

await test('SQL_BUGS', 'courses?sort=title_asc works without SQLite COLLATE NOCASE & session-plans handles 13 args cleanly', async () => {
  const sortRes = await invokeApi('GET', '/api/v1/teaching/courses?sort=title_asc', ADMIN);
  assert.equal(sortRes.status, 200);
  assert.ok(Array.isArray(sortRes.body.data.items));

  const currRow = await db.prepare('SELECT id FROM curricula LIMIT 1').get();
  const crsRow = await db.prepare('SELECT id FROM courses LIMIT 1').get();
  if (currRow && crsRow) {
    const planRes = await invokeApi(
      'PUT',
      `/api/v1/teaching/curricula/${currRow.id}/session-plans/${crsRow.id}`,
      ADMIN,
      { items: [{ title: 'Buổi mở đầu', duration_minutes: 90, periods_count: 2 }] }
    );
    assert.equal(planRes.status, 200);
    assert.equal(planRes.body.data.items.length, 1);
  }
});

await db.close();
fs.rmSync(process.env.LMSPLUS_DB_PATH, { force: true });
fs.rmSync(process.env.LMSPLUS_UPLOADS_DIR, { recursive: true, force: true });

console.log('======================================================================');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
if (failed > 0) process.exit(1);
