/**
 * LMSPLUS E-Learning — Unified Async Database Client (PostgreSQL 18 Primary + SQLite Fallback).
 *
 * - Khi có DATABASE_URL, PGHOST, hoặc LMSPLUS_DB_CLIENT=postgres: kết nối PostgreSQL 18 qua `pg.Pool`.
 * - Khi chưa cấu hình PostgreSQL (hoặc test cô lập đặt LMSPLUS_DB_PATH): chạy qua `node:sqlite`
 *   với cùng giao diện bất đồng bộ (async/await) và hàm SQL chuẩn PostgreSQL (`GREATEST`, `LEAST`, `NOW()`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

function loadEnvFileIfPresent() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Bỏ qua nếu không đọc được file .env
  }
}

loadEnvFileIfPresent();

// Chuẩn hóa kiểu trả về của PostgreSQL: INT8 (COUNT/SUM nguyên) & NUMERIC -> JavaScript number
pg.types.setTypeParser(20, (val) => {
  const n = Number(val);
  return Number.isSafeInteger(n) ? n : val;
});
pg.types.setTypeParser(1700, (val) => {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : val;
});

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Chuyển đổi placeholder `?` sang `$1, $2, ...` cho PostgreSQL,
 * giữ nguyên `?` nằm bên trong chuỗi `'...'`, định danh `"..."`, block `$$...$$`, hoặc comment SQL.
 */
export function convertQmarksToDollars(sql) {
  let out = '';
  let idx = 1;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    // Line comment --
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl === -1) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // Single-quoted literal '...'
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (j + 1 < n && sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Double-quoted identifier "..."
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (j + 1 < n && sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted block $tag$...$tag$
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end !== -1) {
          out += sql.slice(i, end + tag.length);
          i = end + tag.length;
          continue;
        }
      }
    }

    if (ch === '?') {
      out += `$${idx++}`;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function resolveDbMode() {
  const explicit = String(process.env.LMSPLUS_DB_CLIENT || 'auto').trim().toLowerCase();
  if (explicit === 'sqlite') return 'sqlite';
  if (explicit === 'postgres' || explicit === 'postgresql') return 'postgres';

  // Nếu bộ kiểm thử đặt LMSPLUS_DB_PATH riêng (không chỉ định TEST_DATABASE_URL) -> giữ cô lập trên SQLite tạm
  if (process.env.LMSPLUS_DB_PATH && !process.env.LMSPLUS_USE_PG_FOR_TESTS) {
    return 'sqlite';
  }
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PGHOST) {
    return 'postgres';
  }
  return 'sqlite';
}

function buildPgPoolConfig() {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();

  let ssl = undefined;
  if (sslMode === 'disable') {
    ssl = false;
  } else if (sslMode === 'require' || sslMode === 'no-verify' || sslMode === 'verify-ca') {
    ssl = { rejectUnauthorized: false };
  } else if (sslMode === 'verify-full') {
    ssl = { rejectUnauthorized: true };
  } else if (connStr) {
    const isLocal =
      /\/\/[^/]*@(localhost|127\.0\.0\.1|postgres|lmsplus-postgres)(:|\/|$)/i.test(connStr) ||
      /sslmode=disable/i.test(connStr);
    if (!isLocal || /sslmode=(require|no-verify|verify-full)/i.test(connStr)) {
      ssl = { rejectUnauthorized: false };
    }
  }

  const base = {
    max: IS_SERVERLESS ? 3 : 15,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 8000,
  };

  if (connStr) {
    return { ...base, connectionString: connStr, ...(ssl !== undefined ? { ssl } : {}) };
  }

  return {
    ...base,
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'lmsplus',
    user: process.env.PGUSER || 'lmsplus',
    password: process.env.PGPASSWORD || 'lmsplus_dev_password',
    ...(ssl !== undefined ? { ssl } : {}),
  };
}

export function createDbClient() {
  const engine = resolveDbMode();
  const txStorage = new AsyncLocalStorage();

  if (engine === 'postgres') {
    const pool = new pg.Pool(buildPgPoolConfig());
    pool.on('error', (err) => {
      console.error('[lmsplus-pg-pool]', err?.message || err);
    });

    const getRunner = () => txStorage.getStore()?.client || pool;

    const db = {
      engine: 'postgres',
      isPg: true,
      targetLabel: process.env.DATABASE_URL
        ? 'PostgreSQL 18 (DATABASE_URL)'
        : `PostgreSQL 18 (${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'lmsplus'})`,
      pool,

      prepare(sql) {
        const pgSql = convertQmarksToDollars(sql);
        return {
          async get(...params) {
            const res = await getRunner().query(pgSql, params);
            return res.rows[0];
          },
          async all(...params) {
            const res = await getRunner().query(pgSql, params);
            return res.rows;
          },
          async run(...params) {
            const res = await getRunner().query(pgSql, params);
            return { changes: res.rowCount ?? 0 };
          },
        };
      },

      async exec(sql) {
        await getRunner().query(sql);
      },

      async columnNames(table) {
        const res = await getRunner().query(
          `SELECT column_name AS name
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1
           ORDER BY ordinal_position`,
          [table]
        );
        return res.rows.map((r) => r.name);
      },

      async addColumn(table, column, definition) {
        const cols = await db.columnNames(table);
        if (cols.length > 0 && !cols.includes(column)) {
          const pgDef = String(definition).replace(/\bREAL\b/gi, 'DOUBLE PRECISION');
          await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${pgDef}`);
        }
      },

      async tx(fn) {
        const existing = txStorage.getStore();
        if (existing) {
          const nextDepth = existing.depth + 1;
          const sp = `sp_${nextDepth}`;
          await existing.client.query(`SAVEPOINT ${sp}`);
          try {
            const out = await txStorage.run({ client: existing.client, depth: nextDepth }, () => fn(db));
            await existing.client.query(`RELEASE SAVEPOINT ${sp}`);
            return out;
          } catch (err) {
            try {
              await existing.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
            } catch {
              // ignore rollback error
            }
            throw err;
          }
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await txStorage.run({ client, depth: 1 }, () => fn(db));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore rollback error
          }
          throw err;
        } finally {
          client.release();
        }
      },

      async close() {
        await pool.end();
      },
    };

    return db;
  }

  // ---- Fallback SQLite (vẫn bọc Promise + AsyncLocalStorage + các hàm PostgreSQL chuẩn) ----
  const dbDir = path.join(ROOT_DIR, 'database');
  const dbPath = process.env.LMSPLUS_DB_PATH
    ? path.resolve(process.env.LMSPLUS_DB_PATH)
    : IS_SERVERLESS
      ? path.join(os.tmpdir(), 'lmsplus_elearning.sqlite')
      : path.join(dbDir, 'lmsplus_elearning.sqlite');

  if (dbPath !== ':memory:' && !fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  sqlite.exec('PRAGMA journal_mode = WAL;');

  // Đăng ký hàm chuẩn PostgreSQL để cùng câu lệnh SQL chạy trên cả hai engine
  sqlite.function('greatest', { deterministic: true, varargs: true }, (...args) =>
    Math.max(...args.map((x) => Number(x ?? 0)))
  );
  sqlite.function('least', { deterministic: true, varargs: true }, (...args) =>
    Math.min(...args.map((x) => Number(x ?? 0)))
  );
  sqlite.function('now', () => new Date().toISOString());

  let txTail = Promise.resolve();

  const db = {
    engine: 'sqlite',
    isPg: false,
    targetLabel: `SQLite (${dbPath})`,
    dbPath,
    sqlite,

    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        async get(...params) {
          return stmt.get(...params);
        },
        async all(...params) {
          return stmt.all(...params);
        },
        async run(...params) {
          const info = stmt.run(...params);
          return { changes: Number(info?.changes ?? 0) };
        },
      };
    },

    async exec(sql) {
      sqlite.exec(sql);
    },

    async columnNames(table) {
      return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    },

    async addColumn(table, column, definition) {
      const cols = await db.columnNames(table);
      if (cols.length > 0 && !cols.includes(column)) {
        const sqliteDef = String(definition).replace(/\bDOUBLE\s+PRECISION\b/gi, 'REAL');
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqliteDef}`);
      }
    },

    async tx(fn) {
      const existing = txStorage.getStore();
      if (existing) {
        const nextDepth = existing.depth + 1;
        const sp = `sp_${nextDepth}`;
        sqlite.exec(`SAVEPOINT ${sp}`);
        try {
          const out = await txStorage.run({ depth: nextDepth }, () => fn(db));
          sqlite.exec(`RELEASE SAVEPOINT ${sp}`);
          return out;
        } catch (err) {
          try {
            sqlite.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
          } catch {
            // ignore
          }
          throw err;
        }
      }

      const runTx = async () => {
        sqlite.exec('BEGIN');
        try {
          const out = await txStorage.run({ depth: 1 }, () => fn(db));
          sqlite.exec('COMMIT');
          return out;
        } catch (err) {
          try {
            sqlite.exec('ROLLBACK');
          } catch {
            // ignore
          }
          throw err;
        }
      };

      const next = txTail.then(runTx, runTx);
      txTail = next.catch(() => {});
      return next;
    },

    async close() {
      sqlite.close();
    },
  };

  return db;
}

export function isUniqueViolation(err) {
  return err?.code === '23505' || String(err?.message || '').includes('UNIQUE constraint failed');
}

export function isForeignKeyViolation(err) {
  return err?.code === '23503' || String(err?.message || '').includes('FOREIGN KEY constraint failed');
}

export function isCheckViolation(err) {
  return (
    err?.code === '23514' ||
    err?.code === '23502' ||
    String(err?.message || '').includes('CHECK constraint failed')
  );
}
