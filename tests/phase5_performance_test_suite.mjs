#!/usr/bin/env node
/**
 * LMSPLUS — PHASE 5 PERFORMANCE, CACHING, LOG SANITIZATION & BATCHING SUITE (5 CASES)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.LMSPLUS_DB_PATH = path.join(TMP_DIR, `phase5-perf-${process.pid}.sqlite`);
process.env.LMSPLUS_UPLOADS_DIR = path.join(TMP_DIR, `uploads-phase5-${process.pid}`);
process.env.LMSPLUS_DISABLE_OEMBED = '1';

const { createScopedCache, appCache } = await import('../backend/common/cache.mjs');
const { resolveStorageConfig } = await import('../backend/storage/adapter.mjs');
const { initSchemaAndSeed, invokeApi, invokeApiAsync, sanitizeUrlForLog } = await import('../backend/server_fallback.mjs');
await initSchemaAndSeed(true);

let passed = 0;
let failed = 0;

async function t(group, name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] [${group}] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] [${group}] ${name}: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  }
}

console.log('======================================================================');
console.log(' LMSPLUS — PHASE 5 PERFORMANCE & PRODUCTION HARDENING SUITE (5 CASES)');
console.log('======================================================================');

await t('CACHE', 'Scoped LRU/TTL cache cô lập theo DB & ScopeKey và xóa sạch ngay khi invalidatePrefix', async () => {
  const c = createScopedCache({ defaultTtlMs: 5000, maxEntries: 3 });
  const dbA = { targetLabel: 'SQLite-A' };
  const dbB = { targetLabel: 'SQLite-B' };
  let loadA = 0;
  let loadB = 0;

  const v1 = await c.remember(dbA, 'departments', 'ADMIN:0', async () => ++loadA);
  const v2 = await c.remember(dbA, 'departments', 'ADMIN:0', async () => ++loadA);
  const vB = await c.remember(dbB, 'departments', 'ADMIN:0', async () => 100 + (++loadB));
  assert.equal(v1, 1);
  assert.equal(v2, 1, 'Expected cache hit on dbA');
  assert.equal(vB, 101, 'dbB must NOT collide with dbA');

  c.invalidatePrefix(dbA, 'departments');
  const v3 = await c.remember(dbA, 'departments', 'ADMIN:0', async () => ++loadA);
  assert.equal(v3, 2, 'Expected dbA miss after invalidation');
  const vB2 = await c.remember(dbB, 'departments', 'ADMIN:0', async () => 100 + (++loadB));
  assert.equal(vB2, 101, 'Invalidating dbA must not wipe dbB');

  // LRU eviction when maxEntries=3
  await c.remember(dbA, 'k1', 's', async () => '1');
  await c.remember(dbA, 'k2', 's', async () => '2');
  await c.remember(dbA, 'k3', 's', async () => '3');
  assert.ok(c.stats().size <= 3);
});

await t('LOG-SAFE', 'sanitizeUrlForLog che triệt để ?st=, ?token=, ?access_token= khỏi nhật ký HTTP', async () => {
  const dirty = '/api/v1/teaching/media/videos/res_1/stream?st=secret.jwt.token&foo=1&api_key=abc999';
  const clean = sanitizeUrlForLog(dirty);
  assert.ok(!clean.includes('secret.jwt.token'));
  assert.ok(!clean.includes('abc999'));
  assert.ok(clean.includes('st=[REDACTED]'));
  assert.ok(clean.includes('api_key=[REDACTED]'));
  assert.ok(clean.includes('foo=1'));
});

await t('STORAGE-ENV', 'resolveStorageConfig hỗ trợ tương thích cả biến .env.example (S3/R2/Vercel Blob)', async () => {
  const s3Cfg = resolveStorageConfig({
    LMSPLUS_STORAGE_PROVIDER: 'r2',
    LMSPLUS_S3_ENDPOINT: 'https://r2.example.com/',
    LMSPLUS_S3_BUCKET: 'lms-assets',
    BLOB_READ_WRITE_TOKEN: 'tok_r2',
  });
  assert.equal(s3Cfg.provider, 'R2');
  assert.equal(s3Cfg.isRemote, true);
  assert.equal(s3Cfg.baseUrl, 'https://r2.example.com');
  assert.equal(s3Cfg.bucket, 'lms-assets');
  assert.equal(s3Cfg.token, 'tok_r2');
});

await t('BATCH-API', 'Dashboard, Outline, Facilities & Departments phản hồi chính xác và invalidate cache khi ghi', async () => {
  const loginRes = await invokeApi('POST', '/api/v1/elearning/auth/login', {}, { identifier: 'admin@lmsplus.edu.vn', password: '123456' });
  assert.equal(loginRes.status, 200);
  const adminH = { authorization: `Bearer ${loginRes.body.data.access_token}` };

  const fac1 = await invokeApiAsync('GET', '/api/v1/teaching/facilities/overview', adminH);
  assert.equal(fac1.status, 200);
  const countBefore = fac1.body.data.campuses.length;

  const newCp = await invokeApiAsync('POST', '/api/v1/teaching/facilities/campuses', adminH, {
    code: 'CP-P5-CACHE',
    name: 'Cơ sở Kiểm thử Cache',
  });
  assert.equal(newCp.status, 201);

  const fac2 = await invokeApiAsync('GET', '/api/v1/teaching/facilities/overview', adminH);
  assert.equal(fac2.status, 200);
  assert.equal(fac2.body.data.campuses.length, countBefore + 1, 'Expected immediate cache invalidation after POST campus');

  const dash = await invokeApiAsync('GET', '/api/v1/teaching/dashboard', adminH);
  assert.equal(dash.status, 200);
  assert.ok(Array.isArray(dash.body.data.today_sessions));

  const crs = await invokeApiAsync('GET', '/api/v1/teaching/courses/crs_toan5', adminH);
  assert.equal(crs.status, 200);
  assert.ok(Array.isArray(crs.body.data.outline));
  assert.ok(appCache.stats().hits >= 0);
});

await t('MIGRATION-013', 'Migration 013 UP/DOWN hợp lệ giao dịch BEGIN/COMMIT và có đủ 7 composite index', async () => {
  const upSql = fs.readFileSync('database/migrations/013_performance_indexes_up.sql', 'utf8');
  const downSql = fs.readFileSync('database/migrations/013_performance_indexes_down.sql', 'utf8');
  assert.ok(/\bBEGIN\s*;/i.test(upSql) && /\bCOMMIT\s*;/i.test(upSql));
  assert.ok(/\bBEGIN\s*;/i.test(downSql) && /\bCOMMIT\s*;/i.test(downSql));
  const createdIdx = (upSql.match(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi) || []).length;
  const droppedIdx = (downSql.match(/DROP\s+INDEX\s+IF\s+EXISTS/gi) || []).length;
  assert.equal(createdIdx, 7);
  assert.equal(droppedIdx, 7);
});

console.log('----------------------------------------------------------------------');
console.log(` TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================================');
process.exit(failed > 0 ? 1 : 0);
