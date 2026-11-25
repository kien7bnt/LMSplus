#!/usr/bin/env node
/**
 * LMSPLUS — Unit tests cho PostgreSQL 18 Adapter, SQL Placeholder Translator & Schema 010.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { convertQmarksToDollars, resolveDbMode, ROOT_DIR } from '../backend/db/client.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  [PASS] [PG18] ${name}`);
}

console.log('======================================================================');
console.log(' LMSPLUS — POSTGRESQL 18 ADAPTER & SCHEMA VERIFICATION');
console.log('======================================================================');

check('convertQmarksToDollars giữ nguyên ? bên trong chuỗi, comment và dollar-quote', () => {
  const sql = `
    SELECT id, 'Chào?''bạn?' AS msg, "col?"
    FROM users -- comment ? ignored
    /* block ? comment */
    WHERE code = ? AND status = ? AND note <> $$a?b$$ AND id = ?
  `;
  const out = convertQmarksToDollars(sql);
  assert.ok(out.includes("'Chào?''bạn?'"), 'literal ? preserved');
  assert.ok(out.includes('"col?"'), 'quoted identifier ? preserved');
  assert.ok(out.includes('-- comment ? ignored'), 'line comment ? preserved');
  assert.ok(out.includes('/* block ? comment */'), 'block comment ? preserved');
  assert.ok(out.includes('$$a?b$$'), 'dollar-quoted ? preserved');
  assert.ok(out.includes('WHERE code = $1 AND status = $2 AND note <> $$a?b$$ AND id = $3'), out);
});

check('resolveDbMode chọn đúng PostgreSQL 18 khi có DATABASE_URL hoặc PGHOST', () => {
  const prev = {
    LMSPLUS_DB_CLIENT: process.env.LMSPLUS_DB_CLIENT,
    LMSPLUS_DB_PATH: process.env.LMSPLUS_DB_PATH,
    DATABASE_URL: process.env.DATABASE_URL,
    PGHOST: process.env.PGHOST,
  };
  try {
    delete process.env.LMSPLUS_DB_CLIENT;
    delete process.env.LMSPLUS_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    assert.equal(resolveDbMode(), 'sqlite');

    process.env.DATABASE_URL = 'postgresql://lmsplus:pass@127.0.0.1:5432/lmsplus';
    assert.equal(resolveDbMode(), 'postgres');

    process.env.LMSPLUS_DB_PATH = 'tests/.tmp/x.sqlite';
    assert.equal(resolveDbMode(), 'sqlite');

    process.env.LMSPLUS_DB_CLIENT = 'postgres';
    assert.equal(resolveDbMode(), 'postgres');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

check('010_postgres18_live_schema.sql hợp lệ cú pháp PostgreSQL 18 cho đủ 80 bảng và 43 index', () => {
  const ddlPath = path.join(ROOT_DIR, 'database', 'migrations', '010_postgres18_live_schema.sql');
  const sql = fs.readFileSync(ddlPath, 'utf8');
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;/);
  assert.equal(/\bPRAGMA\b|\bAUTOINCREMENT\b|\browid\b|\bINSERT\s+OR\b/i.test(sql), false);

  const tables = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
  const indexes = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.equal(tables.length, 80, `expected 80 tables, got ${tables.length}`);
  assert.equal(indexes.length, 43, `expected 43 indexes, got ${indexes.length}`);
  assert.equal(new Set(indexes).size, 43);

  // Kiểm tra không có FK tham chiếu tới bảng khai báo sau
  const stmts = sql.split(/;\s*\n/).filter((s) => /CREATE\s+TABLE/i.test(s));
  const seen = new Set();
  for (const s of stmts) {
    const t = s.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/i)[1];
    seen.add(t);
    for (const m of s.matchAll(/\bREFERENCES\s+([a-z0-9_]+)/gi)) {
      assert.ok(seen.has(m[1]), `FK forward reference: ${t} -> ${m[1]}`);
    }
  }
});

console.log(`TOTAL: ${passed} | PASSED: ${passed} | FAILED: 0`);
