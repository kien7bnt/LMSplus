/**
 * LMSPLUS — Trình chuẩn hóa & trích xuất đường dẫn hình ảnh dùng chung cho Backend (Node) và Frontend (Vite).
 *
 * Xử lý triệt để lỗi "bắt ảnh qua link" khi người dùng sao chép đường dẫn từ:
 *  - Bing Images (`bing.com/images/search?...&mediaurl=...&cdnurl=...`)
 *  - Google Images (`google.com/imgres?imgurl=...`, `google.com/url?...`)
 *  - Google Drive (`drive.google.com/file/d/<ID>/view`, `open?id=<ID>`, `uc?id=<ID>`)
 *  - Dropbox (`dropbox.com/...?dl=0` -> `raw=1`)
 *  - GitHub (`github.com/<owner>/<repo>/blob/...` -> `raw.githubusercontent.com/...`)
 *  - Imgur trang đơn (`imgur.com/<id>` -> `i.imgur.com/<id>.jpg`)
 *  - Mã nhúng HTML `<img src="...">` hoặc Markdown `![alt](url)`
 *  - Ảnh tải trực tiếp dạng `data:image/(png|jpeg|jpg|webp|gif);base64,...` (an toàn, chặn SVG chứa script)
 */

const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_DATA_URL_CHARS = 1_500_000;
const MAX_HTTP_URL_CHARS = 4096;

/**
 * Kiểm tra chuỗi có phải Data URL hình ảnh bitmap an toàn (không cho phép SVG chứa script).
 * @param {unknown} input
 * @param {number} [maxChars]
 * @returns {boolean}
 */
export function isSafeImageDataUrl(input, maxChars = MAX_DATA_URL_CHARS) {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > maxChars) return false;
  return SAFE_DATA_IMAGE_RE.test(trimmed);
}

/**
 * Trích xuất chuỗi URL bên trong thẻ `<img src="...">` hoặc cú pháp Markdown `![alt](url)` nếu có.
 * @param {string} raw
 * @returns {{ value: string, extracted: boolean }}
 */
function unwrapMarkupSnippet(raw) {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const imgTagMatch = s.match(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  if (imgTagMatch) {
    const src = (imgTagMatch[1] || imgTagMatch[2] || imgTagMatch[3] || '').trim();
    if (src) return { value: decodeHtmlEntities(src), extracted: true };
  }
  const mdMatch = s.match(/^!\[[^\]]*\]\(\s*<?([^>\s)]+)>?(?:\s+["'][^"']*["'])?\s*\)$/);
  if (mdMatch && mdMatch[1]) {
    return { value: mdMatch[1].trim(), extracted: true };
  }
  return { value: s, extracted: false };
}

/**
 * Giải mã các thực thể HTML phổ biến khi người dùng sao chép từ mã nguồn HTML (`&amp;` -> `&`).
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Chuẩn hóa một URL đơn lẻ sang HTTPS hợp lệ (hoặc đường dẫn nội bộ `/api/...`).
 * @param {string} rawUrl
 * @param {{ allowRelative?: boolean, upgradeHttp?: boolean }} [opts]
 * @returns {string | null}
 */
function sanitizeSingleHttpUrl(rawUrl, opts = {}) {
  if (typeof rawUrl !== 'string') return null;
  let s = decodeHtmlEntities(rawUrl.trim());
  if (!s || s.length > MAX_HTTP_URL_CHARS) return null;

  if (opts.allowRelative && s.startsWith('/') && !s.startsWith('//')) {
    return s;
  }
  if (s.startsWith('//')) {
    s = `https:${s}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/.+/i.test(s)) {
    s = `https://${s}`;
  }

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && opts.upgradeHttp) {
    u.protocol = 'https:';
    return u.toString();
  }
  return null;
}

/**
 * Đệ quy trích xuất danh sách ứng viên URL ảnh trực tiếp từ đường dẫn gốc hoặc trang tìm kiếm/chia sẻ.
 * @param {string} rawInput
 * @param {number} [depth]
 * @param {{ upgradeHttp?: boolean, allowRelative?: boolean }} [opts]
 * @returns {{ candidates: string[], unwrapped: boolean, isDataUrl: boolean }}
 */
function resolveCandidatesInternal(rawInput, depth = 0, opts = {}) {
  if (typeof rawInput !== 'string' || !rawInput.trim() || depth > 3) {
    return { candidates: [], unwrapped: false, isDataUrl: false };
  }

  const { value: unquoted, extracted } = unwrapMarkupSnippet(rawInput);
  if (!unquoted) {
    return { candidates: [], unwrapped: false, isDataUrl: false };
  }

  if (isSafeImageDataUrl(unquoted)) {
    return {
      candidates: [unquoted.replace(/\s+/g, '')],
      unwrapped: extracted,
      isDataUrl: true,
    };
  }

  if (opts.allowRelative && unquoted.startsWith('/') && !unquoted.startsWith('//')) {
    return { candidates: [unquoted], unwrapped: extracted, isDataUrl: false };
  }

  let normalizedForParse = decodeHtmlEntities(unquoted);
  if (normalizedForParse.startsWith('//')) {
    normalizedForParse = `https:${normalizedForParse}`;
  } else if (
    !/^[a-z][a-z0-9+.-]*:/i.test(normalizedForParse) &&
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/.+/i.test(normalizedForParse)
  ) {
    normalizedForParse = `https://${normalizedForParse}`;
  }

  let u;
  try {
    u = new URL(normalizedForParse);
  } catch {
    return { candidates: [], unwrapped: false, isDataUrl: false };
  }

  if (u.username || u.password || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
    return { candidates: [], unwrapped: false, isDataUrl: false };
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  /** @type {string[]} */
  const out = [];
  const pushUnique = (/** @type {string | null} */ candidate) => {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  };

  // 1. Bing Images (`bing.com/images/search?...&mediaurl=...&cdnurl=...`)
  if (
    /(?:^|\.)bing\.com$/i.test(host) &&
    (path.startsWith('/images/') || u.searchParams.has('mediaurl') || u.searchParams.has('cdnurl'))
  ) {
    const mediaUrl = u.searchParams.get('mediaurl');
    const cdnUrl = u.searchParams.get('cdnurl');
    const thId = u.searchParams.get('thid');

    if (mediaUrl) {
      const nestedHttps = resolveCandidatesInternal(mediaUrl, depth + 1, { upgradeHttp: false });
      nestedHttps.candidates.forEach(pushUnique);
    }
    if (cdnUrl) {
      pushUnique(sanitizeSingleHttpUrl(cdnUrl, { upgradeHttp: true }));
    }
    if (thId) {
      pushUnique(`https://th.bing.com/th/id/${encodeURIComponent(thId)}?pid=ImgRaw&r=0`);
    }
    if (mediaUrl && out.length === 0) {
      const nestedUpgraded = resolveCandidatesInternal(mediaUrl, depth + 1, { upgradeHttp: true });
      nestedUpgraded.candidates.forEach(pushUnique);
    }
    return { candidates: out, unwrapped: true, isDataUrl: false };
  }

  // 2. Google Images (`google.*/imgres?imgurl=...` hoặc `google.*/url?url=...`)
  if (
    /(?:^|\.)google\.[a-z.]+$/i.test(host) &&
    (path === '/imgres' || path === '/url' || u.searchParams.has('imgurl'))
  ) {
    const imgUrl = u.searchParams.get('imgurl') || u.searchParams.get('url') || u.searchParams.get('q');
    const tbnId = u.searchParams.get('tbnid');
    if (imgUrl) {
      const nestedHttps = resolveCandidatesInternal(imgUrl, depth + 1, { upgradeHttp: false });
      nestedHttps.candidates.forEach(pushUnique);
    }
    if (tbnId) {
      pushUnique(`https://encrypted-tbn0.gstatic.com/images?q=tbn:${encodeURIComponent(tbnId)}`);
    }
    if (imgUrl && out.length === 0) {
      const nestedUpgraded = resolveCandidatesInternal(imgUrl, depth + 1, { upgradeHttp: true });
      nestedUpgraded.candidates.forEach(pushUnique);
    }
    if (out.length > 0) {
      return { candidates: out, unwrapped: true, isDataUrl: false };
    }
  }

  // 3. Google Drive (`drive.google.com/file/d/<ID>/view`, `/open?id=<ID>`, `/uc?id=<ID>`)
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const fileMatch = path.match(/\/(?:file|document)\/d\/([A-Za-z0-9_-]{10,})/);
    const fileId = (fileMatch && fileMatch[1]) || u.searchParams.get('id');
    if (fileId && /^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      pushUnique(`https://lh3.googleusercontent.com/d/${fileId}`);
      pushUnique(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`);
      return { candidates: out, unwrapped: true, isDataUrl: false };
    }
  }

  // 4. Dropbox (`dropbox.com/...?dl=0` -> `raw=1`)
  if (/(?:^|\.)dropbox\.com$/i.test(host)) {
    const copy = new URL(u.toString());
    copy.protocol = 'https:';
    const hadDlZero = copy.searchParams.get('dl') === '0' || !copy.searchParams.has('raw');
    copy.searchParams.delete('dl');
    copy.searchParams.set('raw', '1');
    pushUnique(copy.toString());
    return { candidates: out, unwrapped: hadDlZero || extracted, isDataUrl: false };
  }

  // 5. GitHub blob (`github.com/<owner>/<repo>/blob/<ref>/<path>`)
  if (host === 'github.com') {
    const ghMatch = path.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (ghMatch) {
      pushUnique(`https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`);
      return { candidates: out, unwrapped: true, isDataUrl: false };
    }
  }

  // 6. Imgur trang đơn (`imgur.com/<id>` không có phần mở rộng)
  if ((host === 'imgur.com' || host === 'www.imgur.com') && /^\/([A-Za-z0-9]{5,12})$/.test(path)) {
    const id = path.slice(1);
    pushUnique(`https://i.imgur.com/${id}.jpg`);
    pushUnique(`https://i.imgur.com/${id}.png`);
    pushUnique(`https://i.imgur.com/${id}.webp`);
    return { candidates: out, unwrapped: true, isDataUrl: false };
  }

  // 7. Đường dẫn trực tiếp thông thường
  const cleanDirect = sanitizeSingleHttpUrl(u.toString(), {
    allowRelative: Boolean(opts.allowRelative),
    upgradeHttp: Boolean(opts.upgradeHttp),
  });
  const wasUpgraded = Boolean(cleanDirect && cleanDirect !== unquoted.trim());
  pushUnique(cleanDirect);
  return {
    candidates: out,
    unwrapped: extracted || wasUpgraded,
    isDataUrl: false,
  };
}

/**
 * Trả về danh sách các URL ảnh trực tiếp có thể thử tải theo thứ tự ưu tiên (dùng cho `<SmartImage>`).
 * @param {string | null | undefined} input
 * @returns {string[]}
 */
export function extractImageUrlCandidates(input) {
  if (!input || typeof input !== 'string') return [];
  return resolveCandidatesInternal(input, 0, { upgradeHttp: true, allowRelative: true }).candidates;
}

/**
 * Chuẩn hóa và kiểm tra đường dẫn hình ảnh khi người dùng nhập/lưu.
 * @param {unknown} input
 * @param {{ allowDataUrl?: boolean, maxDataUrlChars?: number, upgradeHttp?: boolean }} [opts]
 * @returns {{ ok: true, url: string, candidates: string[], unwrapped: boolean, isDataUrl: boolean }
 *          | { ok: false, error: 'EMPTY_URL' | 'INVALID_IMAGE_URL' | 'DATA_URL_NOT_ALLOWED' | 'IMAGE_TOO_LARGE', message: string }}
 */
export function normalizeImageUrl(input, opts = {}) {
  const allowDataUrl = opts.allowDataUrl !== false;
  const maxDataUrlChars = opts.maxDataUrlChars ?? MAX_DATA_URL_CHARS;
  const upgradeHttp = Boolean(opts.upgradeHttp);

  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'EMPTY_URL', message: 'Vui lòng nhập đường dẫn hình ảnh.' };
  }

  const raw = input.trim();
  if (raw.startsWith('data:')) {
    if (!allowDataUrl) {
      return {
        ok: false,
        error: 'DATA_URL_NOT_ALLOWED',
        message: 'Chỉ hỗ trợ đường dẫn ảnh https:// tại trường này.',
      };
    }
    if (raw.length > maxDataUrlChars) {
      return {
        ok: false,
        error: 'IMAGE_TOO_LARGE',
        message: 'Dung lượng ảnh vượt quá giới hạn cho phép. Vui lòng chọn ảnh nhỏ hơn.',
      };
    }
    if (!isSafeImageDataUrl(raw, maxDataUrlChars)) {
      return {
        ok: false,
        error: 'INVALID_IMAGE_URL',
        message: 'Định dạng ảnh không hợp lệ (chỉ hỗ trợ PNG, JPEG, WebP hoặc GIF).',
      };
    }
    const cleanData = raw.replace(/\s+/g, '');
    return {
      ok: true,
      url: cleanData,
      candidates: [cleanData],
      unwrapped: false,
      isDataUrl: true,
    };
  }

  const resolved = resolveCandidatesInternal(raw, 0, { upgradeHttp, allowRelative: false });
  if (resolved.candidates.length === 0) {
    const isPlainHttp = /^http:\/\//i.test(raw);
    return {
      ok: false,
      error: 'INVALID_IMAGE_URL',
      message: isPlainHttp
        ? 'Đường dẫn ảnh phải bắt đầu bằng https:// hoặc chọn ảnh từ máy.'
        : 'Đường dẫn ảnh không hợp lệ. Hãy dán link ảnh trực tiếp (https://...) hoặc chọn ảnh từ máy.',
    };
  }

  const primary = resolved.candidates[0];
  if (primary.length > MAX_HTTP_URL_CHARS) {
    return {
      ok: false,
      error: 'INVALID_IMAGE_URL',
      message: 'Đường dẫn ảnh quá dài. Hãy sao chép địa chỉ hình ảnh trực tiếp.',
    };
  }

  return {
    ok: true,
    url: primary,
    candidates: resolved.candidates,
    unwrapped: resolved.unwrapped,
    isDataUrl: resolved.isDataUrl,
  };
}
