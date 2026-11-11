import http from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function lmsplusSqlApiPlugin() {
  let apiHandlerPromise: Promise<{ handleApiRequest: (req: any, res: any, body: string) => unknown }> | null = null;

  const getHandler = () => {
    if (!apiHandlerPromise) {
      // Lazy fallback: only loaded when standalone `npm run dev` runs without backend :8000
      const modulePath = '../backend/server_fallback.mjs';
      apiHandlerPromise = import(/* @vite-ignore */ modulePath);
    }
    return apiHandlerPromise;
  };

  const MAX_BODY_BYTES = 24 * 1024 * 1024;
  const BACKEND_HOST = process.env.LMSPLUS_BACKEND_HOST || '127.0.0.1';
  const BACKEND_PORT = Number(process.env.LMSPLUS_BACKEND_PORT || 8000);

  const middleware = (req: any, res: any, next: () => void) => {
    const url = req.url || '';
    if (!url.startsWith('/api/v1/') && !url.startsWith('/health')) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES && !aborted) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ detail: { code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên vượt quá 24 MB.' } }));
        req.destroy();
        return;
      }
      if (!aborted) chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const bodyBuf = Buffer.concat(chunks);
      const forwardHeaders: Record<string, any> = { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` };
      if (bodyBuf.length > 0) {
        forwardHeaders['content-length'] = String(bodyBuf.length);
      }

      const proxyReq = http.request(
        {
          hostname: BACKEND_HOST,
          port: BACKEND_PORT,
          path: url,
          method: req.method || 'GET',
          headers: forwardHeaders,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );

      proxyReq.on('error', async (err: NodeJS.ErrnoException) => {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (err && (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH')) {
          try {
            const mod = await getHandler();
            await mod.handleApiRequest(req, res, bodyBuf.toString('utf8'));
            return;
          } catch {
            // Fall through to 500 JSON response below
          }
        }
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ detail: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi hệ thống.' } }));
        }
      });

      if (bodyBuf.length > 0) proxyReq.write(bodyBuf);
      proxyReq.end();
    });
  };

  return {
    name: 'lmsplus-sql-api-middleware',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), lmsplusSqlApiPlugin()],
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
});
