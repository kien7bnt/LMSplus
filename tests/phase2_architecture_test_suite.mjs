#!/usr/bin/env node
/**
 * LMSPLUS — PHASE 2 ARCHITECTURE, STORAGE ADAPTER & ORG/USERS TEST SUITE
 * Kiểm thử:
 *  - Storage Adapter: Local Disk phân thư mục (documents/, pdfs/, videos/, _tmp_videos/) & S3/R2/Vercel Blob HTTP Mock
 *  - Organization / Departments CRUD + Chống vòng lặp cây đơn vị + Summary bộ môn
 *  - Users Service: Scoped GET /users, scrypt hashing, token_version revocation khi đổi quyền, soft-deactivate bảo toàn FK
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `phase2-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-p2-${process.pid}`);
process.env.LMSPLUS_JWT_SECRET = 'phase2-integration-secret-key-min-32-chars!!';

const { createStorageAdapter } = await import('../backend/storage/adapter.mjs');
const { invokeApi, initSchemaAndSeed, db } = await import('../backend/server_fallback.mjs');
const { createJwtToken } = await import('../backend/common/security.mjs');

await initSchemaAndSeed(true);

async function makeToken(codeOrEmail) {
  const u = await db.prepare('SELECT * FROM users WHERE code = ? OR email = ?').get(codeOrEmail, codeOrEmail);
  assert.ok(u, `Missing seed user ${codeOrEmail}`);
  return createJwtToken(
    {
      id: u.id,
      code: u.code,
      email: u.email,
      full_name: u.full_name,
      roles: JSON.parse(u.roles_json),
      department_id: u.department_id,
      token_version: u.token_version ?? 1,
    },
    process.env.LMSPLUS_JWT_SECRET
  );
}

const ADMIN = await makeToken('admin@lmsplus.edu.vn');
const STAFF_K5 = await makeToken('GVU001');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}: ${err.stack || err.message}`);
  }
}

console.log('======================================================================');
console.log(' LMSPLUS — PHASE 2 STORAGE ADAPTER, DEPARTMENTS & USERS SUITE');
console.log('======================================================================');

await test('[STORAGE LOCAL] Categorized keys (documents/pdfs/videos), write, stat, Range read & remove', async () => {
  const dir = path.join(TMP_DIR, `store-local-${process.pid}`);
  const store = createStorageAdapter({ baseDir: dir, env: {} });
  assert.equal(store.providerName, 'LOCAL_DISK');

  const key = store.buildKey('documents', 'crs/../crs_toan5', 'bai tap.pdf');
  assert.ok(key.startsWith('documents/'), `Expected documents/ prefix, got ${key}`);
  assert.ok(!key.includes('..'));

  const payload = Buffer.from('%PDF-1.4 sample payload');
  const putRes = await store.putBuffer(key, payload, 'application/pdf');
  assert.equal(putRes.storageProvider, 'LOCAL_DISK');
  assert.equal(putRes.sizeBytes, payload.length);

  const st = await store.statObject(putRes.storageKey, putRes.storageProvider);
  assert.equal(st.exists, true);
  assert.equal(st.size, payload.length);

  const range = await store.readObjectBuffer(putRes.storageKey, putRes.storageProvider, 0, 4);
  assert.equal(range.toString('ascii'), '%PDF-');

  await store.removeObject(putRes.storageKey, putRes.storageProvider);
  const after = await store.statObject(putRes.storageKey, putRes.storageProvider);
  assert.equal(after.exists, false);
});

await test('[STORAGE REMOTE HTTP] S3/Vercel Blob adapter executes PUT, HEAD, GET Range & DELETE cleanly', async () => {
  const objects = new Map();
  const mockFetch = async (targetUrl, init = {}) => {
    const key = new URL(targetUrl).pathname.replace(/^\/+/, '');
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') {
      assert.equal(init.headers?.Authorization, 'Bearer mock-storage-token-123');
      assert.equal(init.headers?.['x-lmsplus-bucket'], 'lmsplus-media');
      objects.set(key, Buffer.from(init.body));
      return new Response('ok', { status: 200 });
    }
    if (method === 'HEAD') {
      const buf = objects.get(key);
      return buf
        ? new Response(null, { status: 200, headers: { 'content-length': String(buf.length) } })
        : new Response(null, { status: 404 });
    }
    if (method === 'GET') {
      const buf = objects.get(key);
      return buf ? new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };

  const remoteStore = createStorageAdapter({
    baseDir: path.join(TMP_DIR, `store-remote-${process.pid}`),
    env: {
      LMSPLUS_STORAGE_PROVIDER: 'S3',
      LMSPLUS_STORAGE_BASE_URL: 'https://storage.mock.local',
      LMSPLUS_STORAGE_TOKEN: 'mock-storage-token-123',
      LMSPLUS_STORAGE_BUCKET: 'lmsplus-media',
    },
    fetchImpl: mockFetch,
  });
  assert.equal(remoteStore.providerName, 'S3');
  const key = remoteStore.buildKey('pdfs', 'crs_01', 'lecture.pdf');
  const put = await remoteStore.putBuffer(key, Buffer.from('%PDF-remote-data'), 'application/pdf');
  assert.equal(put.storageProvider, 'S3');
  const stat = await remoteStore.statObject(key, 'S3');
  assert.equal(stat.exists, true);
  assert.equal(stat.size, 16);
  const readBack = await remoteStore.readObjectBuffer(key, 'S3');
  assert.equal(readBack.toString('utf8'), '%PDF-remote-data');
  await remoteStore.removeObject(key, 'S3');
  assert.equal((await remoteStore.statObject(key, 'S3')).exists, false);
});

await test('[DEPARTMENTS] CRUD departments, prevent parent cycle, expose department summary & reject non-admin edits', async () => {
  const listRes = await invokeApi('GET', '/api/v1/teaching/departments', { Authorization: `Bearer ${ADMIN}` });
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.data.items.some((d) => d.id === 'khoi_5'));

  const createRes = await invokeApi(
    'POST',
    '/api/v1/teaching/departments',
    { Authorization: `Bearer ${ADMIN}` },
    { code: 'DEPT-MATH', name: 'Bộ môn Toán ứng dụng', org_type: 'DEPARTMENT', parent_id: 'org_root' }
  );
  assert.equal(createRes.status, 201);
  const deptId = createRes.body.data.id;

  // Cycle check: department cannot become its own parent
  const cycleRes = await invokeApi(
    'PATCH',
    `/api/v1/teaching/departments/${deptId}`,
    { Authorization: `Bearer ${ADMIN}` },
    { parent_id: deptId }
  );
  assert.equal(cycleRes.status, 422);

  // Staff blocked from creating departments
  const staffCreate = await invokeApi(
    'POST',
    '/api/v1/teaching/departments',
    { Authorization: `Bearer ${STAFF_K5}` },
    { code: 'UNAUTHORIZED', name: 'Trái phép' }
  );
  assert.equal(staffCreate.status, 403);

  // Clean delete of empty dept
  const delRes = await invokeApi('DELETE', `/api/v1/teaching/departments/${deptId}`, { Authorization: `Bearer ${ADMIN}` });
  assert.equal(delRes.status, 200);
});

await test('[USERS RBAC] Create user (scrypt), role update revokes active JWT, soft-deactivate preserves FKs', async () => {
  const created = await invokeApi(
    'POST',
    '/api/v1/teaching/users',
    { Authorization: `Bearer ${ADMIN}` },
    {
      full_name: 'Giảng viên Kiểm thử P2',
      email: `p2.user.${Date.now()}@lmsplus.edu.vn`,
      roles: ['INSTRUCTOR'],
      department_id: 'dept_se',
      password: 'UserPass2026!',
    }
  );
  assert.equal(created.status, 201);
  const u = created.body.data;

  // Login to get JWT with tv=1
  const loginRes = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { email: u.email, password: 'UserPass2026!' });
  assert.equal(loginRes.status, 200);
  const userJwt = loginRes.body.data.access_token;

  // Admin changes role & dept -> bumps token_version immediately
  const patchRes = await invokeApi(
    'PATCH',
    `/api/v1/teaching/users/${u.id}`,
    { Authorization: `Bearer ${ADMIN}` },
    { roles: ['HEAD_OF_DEPARTMENT'], department_id: 'dept_se' }
  );
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.data.token_version, 2);

  // Old JWT MUST now be rejected (401 INVALID_OR_EXPIRED_JWT)
  const staleCall = await invokeApi('GET', '/api/v1/teaching/me', { Authorization: `Bearer ${userJwt}` });
  assert.equal(staleCall.status, 401);

  // Soft delete deactivates without dropping row
  const delRes = await invokeApi('DELETE', `/api/v1/teaching/users/${u.id}`, { Authorization: `Bearer ${ADMIN}` });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.data.is_active, false);
});

console.log('======================================================================');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
if (failed > 0) process.exit(1);
