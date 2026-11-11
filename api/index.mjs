import fs from 'node:fs';
import { handleApiRequest, MAX_BODY_BYTES } from '../backend/server_fallback.mjs';

// Giúp trình đóng gói Vercel (@vercel/nft) luôn kèm theo dữ liệu khởi tạo mẫu khi triển khai Serverless
const SEED_URL = new URL('../database/lmsplus_elearning_seed.json', import.meta.url);
void fs.existsSync(SEED_URL);

export default async function handler(req, res) {
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const rewrittenParts = parsed.searchParams.getAll('__lms_path');
    if (rewrittenParts.length > 0) {
      parsed.searchParams.delete('__lms_path');
      const joined = rewrittenParts.join('/').replace(/\/{2,}/g, '/');
      const cleanPath = joined.startsWith('/') ? joined : `/${joined}`;
      const qs = parsed.searchParams.toString();
      req.url = `${cleanPath}${qs ? `?${qs}` : ''}`;
    }

    let rawBody = '';
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (req.readable) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
              JSON.stringify({
                detail: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên vượt quá giới hạn 24 MB.' },
              })
            );
            return;
          }
          chunks.push(buf);
        }
        rawBody = Buffer.concat(chunks).toString('utf8');
      }

      if (!rawBody) {
        try {
          if (typeof req.body === 'string') {
            rawBody = req.body;
          } else if (Buffer.isBuffer(req.body)) {
            rawBody = req.body.toString('utf8');
          } else if (req.body && typeof req.body === 'object') {
            rawBody = JSON.stringify(req.body);
          }
        } catch {
          rawBody = '{invalid_json';
        }
      }
    }

    await handleApiRequest(req, res, rawBody);
  } catch (err) {
    console.error('[lmsplus-vercel-api]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          detail: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' },
        })
      );
    }
  }
}
