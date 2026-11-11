/**
 * LMSPLUS — YouTube URL parser dùng chung cho Backend (Node) và Frontend (Vite).
 *
 * Quy tắc bảo mật:
 *  - Chỉ chấp nhận domain YouTube trong danh sách cho phép.
 *  - Chỉ trích xuất Video ID hợp lệ (11 ký tự [A-Za-z0-9_-]).
 *  - URL nhúng luôn được TẠO LẠI từ Video ID (youtube-nocookie.com), không bao giờ dùng URL người dùng nhập.
 */

export const YOUTUBE_ALLOWED_HOSTS = Object.freeze([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isValidYouTubeVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

/** "90", "90s", "1m30s", "1h2m3s" -> giây. Trả về 0 nếu không hợp lệ. */
function parseStartSeconds(value) {
  if (!value) return 0;
  const raw = String(value).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 86400);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  const total = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return Math.min(total, 86400);
}

export function buildYouTubeEmbedUrl(videoId, startSeconds = 0) {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error('INVALID_VIDEO_ID');
  }
  const start = Number.isFinite(startSeconds) && startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0${start}`;
}

export function buildYouTubeWatchUrl(videoId, startSeconds = 0) {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error('INVALID_VIDEO_ID');
  }
  const start = startSeconds > 0 ? `&t=${Math.floor(startSeconds)}s` : '';
  return `https://www.youtube.com/watch?v=${videoId}${start}`;
}

/**
 * @param {string} input
 * @returns {{ ok: true, videoId: string, startSeconds: number, embedUrl: string, watchUrl: string, thumbnailUrl: string }
 *          | { ok: false, error: 'EMPTY_URL'|'INVALID_URL'|'DOMAIN_NOT_ALLOWED'|'INVALID_VIDEO_ID', message: string }}
 */
export function parseYouTubeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'EMPTY_URL', message: 'Vui lòng dán đường dẫn video YouTube.' };
  }
  const raw = input.trim();
  if (raw.length > 2048) {
    return { ok: false, error: 'INVALID_URL', message: 'Đường dẫn quá dài.' };
  }

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'INVALID_URL', message: 'Đường dẫn không đúng định dạng URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'INVALID_URL', message: 'Chỉ hỗ trợ đường dẫn http/https.' };
  }
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) {
    return { ok: false, error: 'INVALID_URL', message: 'Đường dẫn không hợp lệ.' };
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      error: 'DOMAIN_NOT_ALLOWED',
      message: 'Chỉ cho phép nhúng video từ YouTube (youtube.com, youtu.be).',
    };
  }

  const parts = url.pathname.split('/').filter(Boolean);
  let videoId = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = parts[0] || null;
  } else if (parts[0] === 'watch') {
    videoId = url.searchParams.get('v');
  } else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
    videoId = parts[1] || null;
  }

  if (!isValidYouTubeVideoId(videoId)) {
    return {
      ok: false,
      error: 'INVALID_VIDEO_ID',
      message: 'Không tìm thấy mã video hợp lệ trong đường dẫn YouTube.',
    };
  }

  const startSeconds = parseStartSeconds(url.searchParams.get('t') || url.searchParams.get('start'));
  return {
    ok: true,
    videoId,
    startSeconds,
    embedUrl: buildYouTubeEmbedUrl(videoId, startSeconds),
    watchUrl: buildYouTubeWatchUrl(videoId, startSeconds),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
