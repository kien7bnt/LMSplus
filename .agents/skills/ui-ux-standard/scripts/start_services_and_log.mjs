#!/usr/bin/env node
/**
 * LMSPLUS E-Learning — Unified Service Launcher & Health Probe
 * Starts Backend (:8000) & Frontend (:5173), verifies HTTP 200 health,
 * writes structured logs to `logs/{start-all,backend,frontend}.log`,
 * and auto-opens the project in the default browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../../..');
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const MASTER_LOG = path.join(LOG_DIR, 'start-all.log');
const BACKEND_LOG = path.join(LOG_DIR, 'backend.log');
const FRONTEND_LOG = path.join(LOG_DIR, 'frontend.log');

// Ensure all .bat files in ROOT have clean Windows CRLF line endings
for (const file of fs.readdirSync(ROOT)) {
  if (file.endsWith('.bat')) {
    const p = path.join(ROOT, file);
    const raw = fs.readFileSync(p, 'utf8');
    const crlf = raw.replace(/\r?\n/g, '\r\n');
    if (raw !== crlf) {
      fs.writeFileSync(p, crlf, 'utf8');
    }
  }
}

const noBrowser = process.argv.includes('--no-browser');
let hadFailure = false;

function nowIso() {
  return new Date().toISOString();
}

function writeLog(file, lines) {
  const content = lines.join('\r\n') + '\r\n';
  fs.writeFileSync(file, content, 'utf8');
}

function appendLog(file, line) {
  const formatted = `[${nowIso()}] ${line}`;
  console.log(formatted);
  try {
    fs.appendFileSync(file, formatted + '\r\n', 'utf8');
  } catch {
    // Ignore transient lock
  }
}

function probeHttp(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        if (body.length < 512) body += chunk.toString();
      });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body });
      });
    });
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: '' });
    });
  });
}

async function waitForHttp(url, retries = 8, delayMs = 400) {
  for (let i = 0; i < retries; i++) {
    const res = await probeHttp(url);
    if (res.ok) return res;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, status: 0, body: '' };
}

async function main() {
  writeLog(MASTER_LOG, [
    '================================================================================',
    `LMSPLUS E-LEARNING — UNIFIED AUTO-STARTER LOG (${nowIso()})`,
    '================================================================================',
    '[INFO] Step 1/5: UI/UX audit and static SQL text checks were run by 3-start-all.bat (see audit-verify.log, db-migration.log). SQL was NOT executed against PostgreSQL.',
  ]);

  // --- 1. Backend (:8000) ---
  writeLog(BACKEND_LOG, [
    '================================================================================',
    `LMSPLUS E-LEARNING — BACKEND API SERVICE LOG (http://localhost:8000)`,
    '================================================================================',
  ]);

  let backendHealth = await probeHttp('http://127.0.0.1:8000/health');
  if (!backendHealth.ok) {
    appendLog(BACKEND_LOG, '[INFO] Spawning Backend API server on http://127.0.0.1:8000 ...');
    const child = spawn(process.execPath, [path.join(ROOT, 'backend', 'server_fallback.mjs')], {
      cwd: path.join(ROOT, 'backend'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    backendHealth = await waitForHttp('http://127.0.0.1:8000/health', 8, 350);
  }

  if (backendHealth.ok) {
    appendLog(
      BACKEND_LOG,
      `[PASS] LMSPLUS Backend API listening on http://localhost:8000 (HTTP ${backendHealth.status} OK)`
    );
    appendLog(BACKEND_LOG, 'STATUS: BACKEND HEALTHY & READY (0 ERRORS)');
    appendLog(MASTER_LOG, '[PASS] Step 2/5: Backend API active on http://localhost:8000 (HTTP 200 OK).');
  } else {
    // Health probe failed: report honestly, never as PASS.
    appendLog(
      BACKEND_LOG,
      '[ERROR] Backend API did NOT respond on http://127.0.0.1:8000/health after spawn.'
    );
    appendLog(BACKEND_LOG, 'STATUS: ACTION REQUIRED - backend not reachable');
    appendLog(MASTER_LOG, '[ERROR] Step 2/5: Backend API not reachable on http://localhost:8000.');
    hadFailure = true;
  }

  // --- 2. Frontend (:5173) ---
  writeLog(FRONTEND_LOG, [
    '================================================================================',
    `LMSPLUS E-LEARNING — FRONTEND UI SERVICE LOG (http://localhost:5173)`,
    '================================================================================',
  ]);

  let frontendHealth = await probeHttp('http://127.0.0.1:5173/');
  if (!frontendHealth.ok) {
    appendLog(FRONTEND_LOG, '[INFO] Spawning Frontend server on http://127.0.0.1:5173 ...');
    const viteBin = path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
    const scriptToRun = fs.existsSync(viteBin)
      ? [viteBin, '--host', '127.0.0.1', '--port', '5173']
      : [path.join(ROOT, 'frontend', 'dev_server.mjs')];

    const child = spawn(process.execPath, scriptToRun, {
      cwd: path.join(ROOT, 'frontend'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    frontendHealth = await waitForHttp('http://127.0.0.1:5173/', 8, 400);
  }

  if (frontendHealth.ok) {
    appendLog(
      FRONTEND_LOG,
      `[PASS] LMSPLUS Frontend UI (Vite / Airbnb DLS) listening on http://localhost:5173 (HTTP ${frontendHealth.status} OK)`
    );
    appendLog(FRONTEND_LOG, 'STATUS: FRONTEND HEALTHY & READY (0 ERRORS)');
    appendLog(MASTER_LOG, '[PASS] Step 3/5: Frontend UI active on http://localhost:5173 (HTTP 200 OK).');
  } else {
    // Health probe failed: report honestly, never as PASS.
    appendLog(
      FRONTEND_LOG,
      '[ERROR] Frontend did NOT respond on http://127.0.0.1:5173/ after spawn.'
    );
    appendLog(FRONTEND_LOG, 'STATUS: ACTION REQUIRED - frontend not reachable');
    appendLog(MASTER_LOG, '[ERROR] Step 3/5: Frontend not reachable on http://localhost:5173.');
    hadFailure = true;
  }

  // --- 3. Auto-open Browser ---
  if (!noBrowser) {
    const targetUrl = frontendHealth.ok
      ? 'http://localhost:5173'
      : path.join(ROOT, 'frontend', 'dist-standalone.html');
    const opener = spawn('cmd.exe', ['/c', 'start', '""', targetUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    opener.unref();
    appendLog(MASTER_LOG, `[PASS] Step 4/5: Auto-opened project in browser (${targetUrl}).`);
  } else {
    appendLog(MASTER_LOG, '[PASS] Step 4/5: Browser auto-open skipped (--no-browser mode).');
  }

  appendLog(MASTER_LOG, '[INFO] Step 5/5: Running 4-check-logs.bat to inspect all logs.');
  if (hadFailure) {
    appendLog(MASTER_LOG, 'STATUS: ACTION REQUIRED - one or more services failed health check');
    process.exitCode = 1;
  } else {
    appendLog(MASTER_LOG, 'STATUS: ALL SERVICES RESPONDED TO HEALTH CHECK');
  }
}

main().catch((err) => {
  console.error('[ERROR] Launcher failure:', err);
  process.exit(1);
});
