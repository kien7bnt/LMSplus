#!/usr/bin/env node
/**
 * LMSPLUS E-Learning Frontend Server (Port 5173)
 * Serves the interactive LMSPLUS E-Learning Portal & Teaching Workspace on http://localhost:5173
 * and writes real-time access logs to `logs/frontend.log`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'frontend.log');

const PORT = Number(process.env.FRONTEND_PORT || 5173);

function writeLog(level, message) {
  const line = `[${level}] ${new Date().toISOString()} | ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  process.stdout.write(line);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const BACKEND_HOST = process.env.LMSPLUS_BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.LMSPLUS_BACKEND_PORT || 8000);

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/health')) {
    const proxyReq = http.request(
      {
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path: rawUrl,
        method: req.method || 'GET',
        headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ detail: { code: 'BACKEND_UNAVAILABLE', message: 'Backend :8000 chưa khởi động.' } }));
      }
    });
    req.pipe(proxyReq);
    return;
  }

  writeLog('INFO ', `GET ${url.pathname} -> Serving Frontend UI`);

  if (url.pathname === '/theme/tokens.css') {
    const cssPath = path.join(ROOT_DIR, 'theme', 'tokens.css');
    if (fs.existsSync(cssPath)) {
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.css'] });
      res.end(fs.readFileSync(cssPath));
      return;
    }
  }

  if (url.pathname === '/preview') {
    const previewPath = path.join(ROOT_DIR, 'theme', 'preview.html');
    if (fs.existsSync(previewPath)) {
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
      res.end(fs.readFileSync(previewPath));
      return;
    }
  }

  const appHtmlPath = path.join(__dirname, 'dist-standalone.html');
  res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
  res.end(fs.readFileSync(appHtmlPath));
});

server.listen(PORT, '127.0.0.1', () => {
  writeLog('PASS ', `LMSPLUS E-Learning Frontend UI listening on http://localhost:${PORT}`);
});
