#!/usr/bin/env node
/**
 * LMSPLUS E-Learning — Khởi tạo Schema PostgreSQL 18 (80 bảng) & Migrate toàn bộ dữ liệu từ SQLite.
 *
 * Cách dùng:
 *   node scripts/migrate-sqlite-to-pg.mjs               # Áp dụng schema + copy dữ liệu từ database/lmsplus_elearning.sqlite
 *   node scripts/migrate-sqlite-to-pg.mjs --schema-only # Chỉ khởi tạo 80 bảng & 43 index trên PostgreSQL 18
 *   node scripts/migrate-sqlite-to-pg.mjs --truncate    # Xóa sạch dữ liệu cũ trên PG rồi nạp lại toàn bộ từ SQLite
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

process.env.LMSPLUS_DB_CLIENT = 'postgres';
const { createDbClient, ROOT_DIR } = await import('../backend/db/client.mjs');

const args = new Set(process.argv.slice(2));
const schemaOnly = args.has('--schema-only');
const truncateFirst = args.has('--truncate');
const customSqlite = [...args].find((a) => a.startsWith('--sqlite='));
const sqlitePath = customSqlite
  ? path.resolve(ROOT_DIR, customSqlite.slice('--sqlite='.length))
  : path.join(ROOT_DIR, 'database', 'lmsplus_elearning.sqlite');

const schemaPath = path.join(ROOT_DIR, 'database', 'migrations', '010_postgres18_live_schema.sql');
if (!fs.existsSync(schemaPath)) {
  console.error(`[ERROR] Không tìm thấy schema PostgreSQL 18: ${schemaPath}`);
  process.exit(1);
}

const schemaSql = fs.readFileSync(schemaPath, 'utf8');
const tableOrder = [...schemaSql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi)].map(
  (m) => m[1]
);

const db = createDbClient();
try {
  const ver = await db.prepare('SELECT version() AS v').get();
  console.log(`[PG] Đã kết nối: ${ver?.v || db.targetLabel}`);

  await db.exec(schemaSql);
  console.log(`[PG] Đã áp dụng schema PostgreSQL 18 (${tableOrder.length} bảng).`);

  if (schemaOnly) {
    process.exit(0);
  }

  if (!fs.existsSync(sqlitePath)) {
    console.error(`[ERROR] Không tìm thấy file SQLite nguồn: ${sqlitePath}`);
    process.exit(1);
  }

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const sqliteTables = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
  );

  let totalCopied = 0;
  let mismatches = 0;

  await db.tx(async (txDb) => {
    if (truncateFirst) {
      for (const tbl of [...tableOrder].reverse()) {
        await txDb.exec(`TRUNCATE TABLE "${tbl}" CASCADE`);
      }
      console.log('[PG] Đã làm sạch toàn bộ 80 bảng trước khi nạp.');
    }

    const BATCH_SIZE = 200;
    for (const tbl of tableOrder) {
      if (!sqliteTables.has(tbl)) continue;
      const rows = sqlite.prepare(`SELECT * FROM "${tbl}"`).all();
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(', ');

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const params = [];
        const tuples = chunk.map((row) => {
          const placeholders = cols.map((c) => {
            params.push(row[c] === undefined ? null : row[c]);
            return `$${params.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        const insertSql = `INSERT INTO "${tbl}" (${colList}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`;
        await txDb.pool.query(insertSql, params);
      }
      totalCopied += rows.length;
    }
  });

  // Kiểm tra đối chiếu số dòng giữa SQLite và PostgreSQL 18
  for (const tbl of tableOrder) {
    const srcCount = sqliteTables.has(tbl)
      ? sqlite.prepare(`SELECT COUNT(*) AS c FROM "${tbl}"`).get().c
      : 0;
    const dstCount = (await db.prepare(`SELECT COUNT(*) AS c FROM "${tbl}"`).get())?.c || 0;
    if (dstCount < srcCount) {
      mismatches++;
      console.error(`[MISMATCH] ${tbl}: SQLite=${srcCount}, PostgreSQL=${dstCount}`);
    }
  }

  sqlite.close();
  console.log(
    `[PASS] Đã chuyển ${totalCopied} bản ghi qua ${tableOrder.length} bảng sang PostgreSQL 18 (lệch: ${mismatches}).`
  );
  if (mismatches > 0) process.exit(1);
} finally {
  await db.close();
}
