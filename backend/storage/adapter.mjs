/**
 * LMSPLUS Unified Storage Adapter (`backend/storage/adapter.mjs`)
 * Chuẩn hóa lưu trữ tệp giữa Local Disk (dev/test/Docker) và Cloud Object Storage
 * (S3 / Cloudflare R2 / Vercel Blob HTTP API khi triển khai Production Serverless).
 *
 * Danh mục thư mục chuẩn theo loại tài nguyên:
 *  - videos/       : Video bài giảng tải lên theo mảnh
 *  - pdfs/         : Tài liệu PDF nhúng trực tiếp
 *  - documents/    : Tài liệu học tập & ngân hàng tài nguyên
 *  - images/       : Hình ảnh minh họa & thumbnail tĩnh
 *  - assignments/  : Bài nộp tệp của học viên
 *  - attachments/  : Tệp đính kèm khác (diễn đàn, đề cương, đơn nghỉ)
 *  - _tmp_videos/  : Vùng ghép mảnh tạm cho chunked upload
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeResolveUnder, validateUploadMagicBytes } from '../common/security.mjs';

export const RESOURCE_CATEGORIES = new Set([
  'videos',
  'pdfs',
  'documents',
  'images',
  'assignments',
  'attachments',
  '_tmp_videos',
]);

export function resolveStorageConfig(env = process.env, fallbackBaseDir = path.resolve(process.cwd(), 'uploads')) {
  const providerRaw = String(env.LMSPLUS_STORAGE_PROVIDER || 'LOCAL_DISK').trim().toUpperCase();
  const provider = ['S3', 'R2', 'VERCEL_BLOB'].includes(providerRaw) ? providerRaw : 'LOCAL_DISK';
  const baseUrl = String(
    env.LMSPLUS_STORAGE_BASE_URL || env.LMSPLUS_S3_PUBLIC_BASE_URL || env.LMSPLUS_S3_ENDPOINT || ''
  ).trim().replace(/\/+$/, '');
  const token = String(env.LMSPLUS_STORAGE_TOKEN || env.BLOB_READ_WRITE_TOKEN || '').trim();
  const bucket = String(env.LMSPLUS_STORAGE_BUCKET || env.LMSPLUS_S3_BUCKET || '').trim();
  const baseDir = env.LMSPLUS_UPLOADS_DIR ? path.resolve(env.LMSPLUS_UPLOADS_DIR) : path.resolve(fallbackBaseDir);
  const isRemote = provider !== 'LOCAL_DISK' && Boolean(baseUrl);
  return {
    provider: isRemote ? provider : 'LOCAL_DISK',
    isRemote,
    baseUrl,
    token,
    bucket,
    baseDir,
  };
}

function sanitizeSegment(seg) {
  return String(seg || 'default')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
}

function buildRemoteHeaders(config, extra = {}) {
  const headers = { ...extra };
  if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
  if (config.bucket) headers['x-lmsplus-bucket'] = config.bucket;
  return headers;
}

function resolveRemoteUrl(config, storageKey) {
  const cleanKey = String(storageKey || '').replace(/^\/+/, '');
  return `${config.baseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
}

export function createStorageAdapter({ baseDir, env = process.env, log = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const config = resolveStorageConfig(env, baseDir);
  const doFetch = (...args) => fetchImpl(...args);
  fs.mkdirSync(config.baseDir, { recursive: true });

  const isServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless && !config.isRemote) {
    log(
      'WARN',
      '[storage] Đang chạy LOCAL_DISK trên môi trường Serverless (/tmp sẽ mất sau cold start). Hãy cấu hình LMSPLUS_STORAGE_PROVIDER=S3|R2|VERCEL_BLOB cùng LMSPLUS_STORAGE_BASE_URL & LMSPLUS_STORAGE_TOKEN.'
    );
  }

  function buildKey(category, scopeId, fileName) {
    const safeCat = RESOURCE_CATEGORIES.has(category) ? category : 'attachments';
    const safeScope = sanitizeSegment(scopeId);
    const safeFile = sanitizeSegment(fileName);
    return `${safeCat}/${safeScope}/${safeFile}`;
  }

  function resolveLocalPath(storageKey) {
    return safeResolveUnder(config.baseDir, storageKey);
  }

  async function putBuffer(storageKey, buffer, contentType = 'application/octet-stream') {
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (config.isRemote) {
      const resp = await doFetch(resolveRemoteUrl(config, storageKey), {
        method: 'PUT',
        headers: buildRemoteHeaders(config, {
          'Content-Type': contentType,
          'Content-Length': String(buffer.length),
          'x-content-sha256': sha256,
        }),
        body: buffer,
      });
      if (!resp.ok) {
        throw new Error(`Remote storage PUT thất bại (${resp.status}) cho key ${storageKey}`);
      }
      return {
        storageProvider: config.provider,
        storageKey,
        sizeBytes: buffer.length,
        checksumSha256: sha256,
      };
    }

    const full = resolveLocalPath(storageKey);
    if (!full) throw new Error(`Storage key không hợp lệ: ${storageKey}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return {
      storageProvider: 'LOCAL_DISK',
      storageKey,
      sizeBytes: buffer.length,
      checksumSha256: sha256,
    };
  }

  function initTempVideo(uploadId, ext) {
    const tmpDir = path.join(config.baseDir, '_tmp_videos');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tempPath = path.join(tmpDir, `${sanitizeSegment(uploadId)}.${sanitizeSegment(ext)}.part`);
    fs.writeFileSync(tempPath, Buffer.alloc(0));
    return tempPath;
  }

  function appendTempChunk(tempPath, buf) {
    const safeTemp = safeResolveUnder(config.baseDir, path.relative(config.baseDir, tempPath));
    if (!safeTemp) throw new Error('Đường dẫn tệp tạm không hợp lệ.');
    fs.appendFileSync(safeTemp, buf);
  }

  function cleanupTemp(tempPath) {
    if (!tempPath) return;
    const safeTemp = safeResolveUnder(config.baseDir, path.relative(config.baseDir, tempPath));
    if (safeTemp && fs.existsSync(safeTemp)) {
      try {
        fs.unlinkSync(safeTemp);
      } catch {
        // Bỏ qua lỗi dọn tệp tạm nếu đã bị xóa
      }
    }
  }

  function inspectTempFile(tempPath, ext) {
    const safeTemp = safeResolveUnder(config.baseDir, path.relative(config.baseDir, tempPath));
    if (!safeTemp || !fs.existsSync(safeTemp)) return { exists: false, size: 0 };
    const stat = fs.statSync(safeTemp);

    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(safeTemp, 'r');
    try {
      const chunkBuf = Buffer.allocUnsafe(1024 * 1024);
      let pos = 0;
      while (pos < stat.size) {
        const bytesRead = fs.readSync(fd, chunkBuf, 0, chunkBuf.length, pos);
        if (bytesRead <= 0) break;
        hash.update(chunkBuf.subarray(0, bytesRead));
        pos += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }

    const headBuf = Buffer.alloc(Math.min(64, stat.size));
    if (headBuf.length > 0) {
      const hFd = fs.openSync(safeTemp, 'r');
      try {
        fs.readSync(hFd, headBuf, 0, headBuf.length, 0);
      } finally {
        fs.closeSync(hFd);
      }
      const magic = validateUploadMagicBytes(headBuf, ext);
      if (!magic.ok) {
        return { exists: true, size: stat.size, checksum: hash.digest('hex'), magic };
      }
    }
    return { exists: true, size: stat.size, checksum: hash.digest('hex'), magic: { ok: true } };
  }

  async function finalizeTempVideo(tempPath, finalKey, contentType = 'video/mp4') {
    const safeTemp = safeResolveUnder(config.baseDir, path.relative(config.baseDir, tempPath));
    if (!safeTemp || !fs.existsSync(safeTemp)) {
      throw new Error('Tệp tạm không còn tồn tại.');
    }
    if (config.isRemote) {
      const buf = fs.readFileSync(safeTemp);
      const uploaded = await putBuffer(finalKey, buf, contentType);
      cleanupTemp(safeTemp);
      return uploaded;
    }
    const finalPath = resolveLocalPath(finalKey);
    if (!finalPath) throw new Error('Đường dẫn đích lưu video không hợp lệ.');
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(safeTemp, finalPath);
    const stat = fs.statSync(finalPath);
    return {
      storageProvider: 'LOCAL_DISK',
      storageKey: finalKey,
      sizeBytes: stat.size,
      fullPath: finalPath,
    };
  }

  async function statObject(storageKey, storageProvider = 'LOCAL_DISK') {
    if (storageProvider !== 'LOCAL_DISK' && config.isRemote) {
      const resp = await doFetch(resolveRemoteUrl(config, storageKey), {
        method: 'HEAD',
        headers: buildRemoteHeaders(config),
      });
      if (!resp.ok) return { exists: false, size: 0 };
      const len = Number(resp.headers.get('content-length') || 0);
      return { exists: true, size: len, remote: true };
    }
    if (storageProvider !== 'LOCAL_DISK') {
      return { exists: false, size: 0 };
    }
    const full = resolveLocalPath(storageKey);
    if (!full || !fs.existsSync(full)) return { exists: false, size: 0 };
    const st = fs.statSync(full);
    return { exists: true, size: st.size, fullPath: full, remote: false };
  }

  async function readObjectBuffer(storageKey, storageProvider = 'LOCAL_DISK', start = null, end = null) {
    if (storageProvider !== 'LOCAL_DISK' && config.isRemote) {
      const hdrs = {};
      if (start !== null && end !== null) hdrs['Range'] = `bytes=${start}-${end}`;
      const resp = await doFetch(resolveRemoteUrl(config, storageKey), {
        method: 'GET',
        headers: buildRemoteHeaders(config, hdrs),
      });
      if (!resp.ok && resp.status !== 206) {
        throw new Error(`Không đọc được đối tượng lưu trữ từ xa (${resp.status})`);
      }
      return Buffer.from(await resp.arrayBuffer());
    }
    const full = resolveLocalPath(storageKey);
    if (!full || !fs.existsSync(full)) {
      throw new Error('Không tìm thấy tệp trên máy chủ.');
    }
    const st = fs.statSync(full);
    if (start !== null && end !== null) {
      const len = Math.max(0, end - start + 1);
      const buf = Buffer.allocUnsafe(len);
      const fd = fs.openSync(full, 'r');
      try {
        fs.readSync(fd, buf, 0, len, start);
      } finally {
        fs.closeSync(fd);
      }
      return buf;
    }
    return fs.readFileSync(full);
  }

  async function streamObjectToResponse({
    res,
    raw,
    status = 200,
    headers = {},
    storageKey,
    storageProvider = 'LOCAL_DISK',
    start = null,
    end = null,
    size,
  }) {
    if (storageProvider === 'LOCAL_DISK') {
      const full = resolveLocalPath(storageKey);
      if (!full || !fs.existsSync(full)) {
        raw(404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ detail: { code: 'FILE_MISSING', message: 'Không tìm thấy tệp trên máy chủ.' } }));
        return;
      }
      const chunkLen = start !== null && end !== null ? end - start + 1 : size;
      if (chunkLen > 16 * 1024 * 1024 && res && typeof res.write === 'function') {
        res.writeHead(status, {
          ...(res.__securityHeaders || {}),
          ...headers,
        });
        return new Promise((resolve, reject) => {
          const stream = start !== null && end !== null ? fs.createReadStream(full, { start, end }) : fs.createReadStream(full);
          stream.on('error', reject);
          res.on('close', () => {
            stream.destroy();
            resolve();
          });
          stream.on('end', resolve);
          stream.pipe(res);
        });
      }
      const buf = await readObjectBuffer(storageKey, 'LOCAL_DISK', start, end);
      raw(status, headers, buf);
      return;
    }

    const buf = await readObjectBuffer(storageKey, storageProvider, start, end);
    raw(status, headers, buf);
  }

  async function removeObject(storageKey, storageProvider = 'LOCAL_DISK') {
    if (!storageKey) return;
    if (storageProvider !== 'LOCAL_DISK' && config.isRemote) {
      try {
        await doFetch(resolveRemoteUrl(config, storageKey), {
          method: 'DELETE',
          headers: buildRemoteHeaders(config),
        });
      } catch {
        // Bỏ qua lỗi xóa tệp cũ trên remote
      }
      return;
    }
    const full = resolveLocalPath(storageKey);
    if (full && fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
      } catch {
        // Bỏ qua nếu HĐH chưa nhả tệp
      }
    }
  }

  return {
    providerName: config.provider,
    isRemote: config.isRemote,
    baseDir: config.baseDir,
    buildKey,
    resolveLocalPath,
    putBuffer,
    initTempVideo,
    appendTempChunk,
    cleanupTemp,
    inspectTempFile,
    finalizeTempVideo,
    statObject,
    readObjectBuffer,
    streamObjectToResponse,
    removeObject,
  };
}
