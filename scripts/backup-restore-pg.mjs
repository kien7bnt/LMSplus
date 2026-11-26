#!/usr/bin/env node
/**
 * LMSPLUS — Backup & Restore PostgreSQL 18 an toàn (kèm SHA-256 checksum & kiểm tra toàn vẹn).
 *
 * Cách dùng:
 *   node scripts/backup-restore-pg.mjs backup [--out=database/backups/pg-backup.json]
 *   node scripts/backup-restore-pg.mjs restore --file=database/backups/pg-backup.json [--dry-run]
 *   node scripts/backup-restore-pg.mjs verify --file=database/backups/pg-backup.json
 *
 * Nếu máy có `pg_dump` trong PATH, script cũng hỗ trợ tùy chọn `--pgdump` tạo bản `.dump` chuẩn PostgreSQL.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

process.env.LMSPLUS_DB_CLIENT = 'postgres';
const { createDbClient, ROOT_DIR } = await import('../backend/db/client.mjs');

const args = process.argv.slice(2);
const cmd = args[0] || 'backup';
const getArg = (prefix) => {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const SCHEMA_ORDER = [
  'database/migrations/010_postgres18_live_schema.sql',
  'database/migrations/011_security_departments_and_lms_v2_up.sql',
  'database/migrations/012_rubrics_appeals_storage_up.sql',
  'database/migrations/013_performance_indexes_up.sql',
];

function collectTableOrder() {
  const ordered = [];
  const seen = new Set();
  for (const rel of SCHEMA_ORDER) {
    const p = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(p)) continue;
    const sql = fs.readFileSync(p, 'utf8');
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        ordered.push(m[1]);
      }
    }
  }
  return ordered;
}

if (cmd === 'verify') {
  const fileArg = getArg('--file=');
  if (!fileArg) {
    console.error('[ERROR] Vui lòng truyền --file=<duong-dan-backup.json>');
    process.exit(1);
  }
  const full = path.resolve(ROOT_DIR, fileArg);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  const { integrity_sha256, ...rest } = parsed;
  const computed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
  if (computed !== integrity_sha256) {
    console.error(`[ERROR] Checksum không khớp! Expected=${integrity_sha256}, Actual=${computed}`);
    process.exit(1);
  }
  const totalRows = Object.values(parsed.tables || {}).reduce((acc, rows) => acc + rows.length, 0);
  console.log(`[PASS] File backup hợp lệ (${Object.keys(parsed.tables || {}).length} bảng, ${totalRows} dòng, sha256=${computed.slice(0, 12)}...).`);
  process.exit(0);
}

const db = createDbClient();
try {
  const tableOrder = collectTableOrder();

  if (cmd === 'backup') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outRel = getArg('--out=') || `database/backups/lmsplus-pg18-${stamp}.json`;
    const outPath = path.resolve(ROOT_DIR, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (args.includes('--pgdump')) {
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        console.error('[ERROR] Cần DATABASE_URL để chạy pg_dump.');
        process.exit(1);
      }
      const dumpPath = outPath.replace(/\.json$/i, '.dump');
      execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${dumpPath}`, dbUrl], {
        stdio: 'inherit',
      });
      console.log(`[PASS] Đã tạo PostgreSQL custom dump: ${dumpPath}`);
    }

    const ver = await db.prepare('SELECT version() AS v').get();
    const tables = {};
    let totalRows = 0;

    for (const tbl of tableOrder) {
      const exists = await db.prepare(`SELECT to_regclass('public.' || ?) AS t`).get(tbl);
      if (!exists?.t) continue;
      const rows = await db.prepare(`SELECT * FROM "${tbl}"`).all();
      tables[tbl] = rows;
      totalRows += rows.length;
    }

    const payloadBody = {
      format: 'lmsplus-pg18-snapshot-v1',
      created_at: new Date().toISOString(),
      pg_version: ver?.v || db.targetLabel,
      table_order: Object.keys(tables),
      total_rows: totalRows,
      tables,
    };
    const integrity_sha256 = crypto.createHash('sha256').update(JSON.stringify(payloadBody)).digest('hex');
    fs.writeFileSync(outPath, JSON.stringify({ ...payloadBody, integrity_sha256 }, null, 2), 'utf8');
    console.log(`[PASS] Đã backup ${Object.keys(tables).length} bảng (${totalRows} bản ghi) -> ${outPath}`);
  } else if (cmd === 'restore') {
    const fileArg = getArg('--file=');
    if (!fileArg) {
      console.error('[ERROR] Vui lòng truyền --file=<duong-dan-backup.json>');
      process.exit(1);
    }
    const full = path.resolve(ROOT_DIR, fileArg);
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    const { integrity_sha256, ...rest } = parsed;
    const computed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    if (computed !== integrity_sha256) {
      console.error('[ERROR] Từ chối restore: file backup bị hỏng hoặc sai checksum.');
      process.exit(1);
    }

    const order = parsed.table_order || tableOrder;
    const dryRun = args.includes('--dry-run');
    if (dryRun) {
      console.log(`[DRY-RUN] Sẵn sàng khôi phục ${order.length} bảng (${parsed.total_rows} bản ghi) từ ${full}`);
      process.exit(0);
    }

    let restored = 0;
    await db.tx(async (txDb) => {
      for (const rel of SCHEMA_ORDER) {
        const p = path.join(ROOT_DIR, rel);
        if (fs.existsSync(p)) await txDb.exec(fs.readFileSync(p, 'utf8'));
      }
      for (const tbl of [...order].reverse()) {
        const exists = await txDb.prepare(`SELECT to_regclass('public.' || ?) AS t`).get(tbl);
        if (exists?.t) await txDb.exec(`TRUNCATE TABLE "${tbl}" CASCADE`);
      }
      const BATCH = 200;
      for (const tbl of order) {
        const rows = parsed.tables?.[tbl] || [];
        if (rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        const colList = cols.map((c) => `"${c}"`).join(', ');
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const params = [];
          const tuples = chunk.map((r) => {
            const ph = cols.map((c) => {
              params.push(r[c] === undefined ? null : r[c]);
              return `$${params.length}`;
            });
            return `(${ph.join(', ')})`;
          });
          await txDb.pool.query(`INSERT INTO "${tbl}" (${colList}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`, params);
        }
        restored += rows.length;
      }
    });
    console.log(`[PASS] Đã khôi phục ${restored} bản ghi qua ${order.length} bảng.`);
  } else {
    console.error(`[ERROR] Lệnh không hợp lệ: ${cmd}. Hỗ trợ: backup | restore | verify`);
    process.exit(1);
  }
} finally {
  await db.close();
}
