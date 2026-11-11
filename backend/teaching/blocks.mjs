/**
 * LMSPLUS — Kiểm tra (validation) và chuẩn hóa nội dung bài học dạng khối, schema_version "1.2".
 * Hỗ trợ đầy đủ 15 nhóm khối của Lesson Studio (tương thích ngược 100% với dữ liệu schema 1.0/1.1):
 *   1. heading          (Tiêu đề)
 *   2. paragraph        (Văn bản)
 *   3. image            (Hình ảnh)
 *   4. video / youtube  (Video tải lên hệ thống, YouTube, hoặc nguồn HTTPS được phê duyệt)
 *   5. pdf              (Tài liệu PDF xem trực tiếp + tải về)
 *   6. file             (Tệp đính kèm)
 *   7. table            (Bảng)
 *   8. math             (Công thức toán học)
 *   9. code             (Code block / code_block)
 *  10. quote            (Trích dẫn)
 *  11. callout          (Ghi chú sư phạm)
 *  12. link             (Link bên ngoài)
 *  13. quiz             (Quiz độc lập đầu/giữa/cuối bài + review_question / inline_mcq tương thích ngược)
 *  14. assignment       (Bài tập / assignment_link)
 *  15. embed            (Nội dung nhúng từ domain giáo dục được hệ thống cho phép — cấm iframe/HTML tùy ý)
 */

import crypto from 'node:crypto';
import { normalizeImageUrl } from '../../shared/imageUrl.mjs';
import { parseYouTubeUrl, isValidYouTubeVideoId } from '../../shared/youtube.mjs';
import {
  ALLOWED_DIRECT_VIDEO_DOMAINS,
  ALLOWED_EMBED_DOMAINS,
  QUIZ_KINDS,
  QuizValidationError,
  normalizeQuestionSpec,
} from './quizEngine.mjs';

export const BLOCK_SCHEMA_VERSION = '1.2';
export const MAX_BLOCKS_PER_LESSON = 200;
const MAX_BLOCK_JSON_BYTES = 96_000;
const MAX_IMAGE_BLOCK_JSON_BYTES = 1_600_000;

export const CALLOUT_VARIANTS = [
  'learning_objective', 'definition', 'remember', 'note', 'warning', 'exam_tip', 'summary',
];

export const ALLOWED_BLOCK_TYPES = [
  'heading', 'paragraph', 'image', 'video', 'youtube', 'pdf', 'file', 'table', 'math',
  'code', 'quote', 'callout', 'link', 'quiz', 'review_question', 'assignment', 'assignment_link', 'embed',
  // Kiểu khối cũ vẫn được chấp nhận để không phá dữ liệu hiện hữu:
  'inline_mcq', 'step_by_step_solution', 'code_block',
];

class BlockError extends Error {
  constructor(index, message) {
    super(`Khối #${index + 1}: ${message}`);
    this.code = 'INVALID_BLOCK';
    this.blockIndex = index;
  }
}

const str = (v, max, field, idx, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BlockError(idx, `thiếu trường "${field}".`);
    return '';
  }
  if (typeof v !== 'string') throw new BlockError(idx, `"${field}" phải là chuỗi.`);
  const t = v.trim();
  if (t.length > max) throw new BlockError(idx, `"${field}" vượt quá ${max} ký tự.`);
  if (required && !t) throw new BlockError(idx, `thiếu trường "${field}".`);
  return t;
};

const httpUrl = (v, field, idx, { httpsOnly = false, required = true } = {}) => {
  const raw = str(v, 2048, field, idx, { required });
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockError(idx, `"${field}" không phải URL hợp lệ.`);
  }
  if (u.username || u.password) {
    throw new BlockError(idx, `"${field}" không được chứa thông tin xác thực trong URL.`);
  }
  if (httpsOnly ? u.protocol !== 'https:' : !['http:', 'https:'].includes(u.protocol)) {
    throw new BlockError(idx, `"${field}" phải dùng giao thức ${httpsOnly ? 'https' : 'http/https'}.`);
  }
  return u.toString();
};

function normalizeDisplayConfig(rawDisplay) {
  if (!rawDisplay || typeof rawDisplay !== 'object') return undefined;
  const out = {};
  if (typeof rawDisplay.hidden === 'boolean') out.hidden = rawDisplay.hidden;
  if (typeof rawDisplay.collapsible === 'boolean') out.collapsible = rawDisplay.collapsible;
  if (typeof rawDisplay.default_collapsed === 'boolean') out.default_collapsed = rawDisplay.default_collapsed;
  if (typeof rawDisplay.highlight === 'boolean') out.highlight = rawDisplay.highlight;
  return Object.keys(out).length > 0 ? out : undefined;
}

function findResourceInScope(ctx, resourceId, idx, allowedTypes = null) {
  const res = ctx.db
    .prepare(
      `SELECT * FROM learning_resources
       WHERE id = ? AND course_id = ? AND deleted_at IS NULL
         AND (class_id IS NULL OR class_id = ?)`
    )
    .get(resourceId, ctx.courseId, ctx.classId || '');
  if (!res) {
    throw new BlockError(idx, 'tài nguyên không tồn tại hoặc không thuộc khóa học/lớp học này.');
  }
  if (allowedTypes && !allowedTypes.includes(res.resource_type)) {
    throw new BlockError(idx, `tài nguyên được chọn không đúng định dạng yêu cầu (${allowedTypes.join('/')}).`);
  }
  return res;
}

export function validateDirectVideoUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, message: 'Đường dẫn video trực tiếp không hợp lệ.' };
  }
  if (u.protocol !== 'https:' || u.username || u.password) {
    return { ok: false, message: 'Link video trực tiếp phải sử dụng giao thức HTTPS an toàn.' };
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_DIRECT_VIDEO_DOMAINS.has(host)) {
    return {
      ok: false,
      message: `Tên miền "${host}" chưa nằm trong danh sách nguồn video được hệ thống cho phép.`,
    };
  }
  if (!/\.(mp4|webm|m4v|ogg)$/i.test(u.pathname)) {
    return { ok: false, message: 'Link video trực tiếp phải trỏ tới tệp định dạng .mp4, .webm, .m4v hoặc .ogg.' };
  }
  return { ok: true, url: u.toString(), host };
}

function normalizeContent(type, c, idx, ctx) {
  switch (type) {
    case 'heading':
      return { text: str(c.text, 300, 'text', idx, { required: true }), level: c.level === 3 ? 3 : 2 };
    case 'paragraph': {
      const out = { text: str(c.text, 20000, 'text', idx) };
      if (c.linked_term_id) out.linked_term_id = str(c.linked_term_id, 64, 'linked_term_id', idx);
      return out;
    }
    case 'image': {
      const normalizedImg = normalizeImageUrl(c.url, { allowDataUrl: true });
      if (!normalizedImg.ok) {
        throw new BlockError(idx, normalizedImg.message);
      }
      if (!normalizedImg.isDataUrl && !normalizedImg.url.startsWith('https://')) {
        throw new BlockError(idx, '"url" phải dùng giao thức https.');
      }
      return {
        url: normalizedImg.url,
        alt: str(c.alt, 300, 'alt', idx),
        caption: str(c.caption, 500, 'caption', idx),
      };
    }
    case 'youtube': {
      let videoId = c.video_id;
      let start = Number.isFinite(c.start_seconds) ? Math.max(0, Math.floor(c.start_seconds)) : 0;
      if (c.url) {
        const parsed = parseYouTubeUrl(String(c.url));
        if (!parsed.ok) throw new BlockError(idx, parsed.message);
        videoId = parsed.videoId;
        start = start || parsed.startSeconds;
      }
      if (!isValidYouTubeVideoId(videoId)) throw new BlockError(idx, 'mã video YouTube không hợp lệ.');
      return {
        video_id: videoId,
        start_seconds: Math.min(start, 86400),
        title: str(c.title, 200, 'title', idx),
        description: str(c.description, 2000, 'description', idx),
      };
    }
    case 'video': {
      const sourceType = String(c.source_type || (c.resource_id ? 'UPLOAD' : c.direct_url ? 'DIRECT_URL' : 'YOUTUBE')).toUpperCase();
      if (!['UPLOAD', 'YOUTUBE', 'DIRECT_URL'].includes(sourceType)) {
        throw new BlockError(idx, 'nguồn video phải là UPLOAD, YOUTUBE hoặc DIRECT_URL.');
      }
      const startSeconds = Number.isFinite(Number(c.start_seconds)) ? Math.max(0, Math.min(86400, Math.floor(Number(c.start_seconds)))) : 0;
      const durationSeconds = Number.isFinite(Number(c.duration_seconds)) && Number(c.duration_seconds) > 0
        ? Math.round(Number(c.duration_seconds) * 100) / 100
        : 0;
      const rawThumb = typeof c.thumbnail_url === 'string' ? c.thumbnail_url.trim() : '';
      let cleanThumb = '';
      if (rawThumb) {
        const thumbRes = normalizeImageUrl(rawThumb, { allowDataUrl: true, maxDataUrlChars: 64_000 });
        if (!thumbRes.ok) {
          throw new BlockError(idx, thumbRes.message);
        }
        if (thumbRes.isDataUrl) {
          // Với video UPLOAD, ảnh thu nhỏ đã lưu trong learning_resources.thumbnail_url → tránh phình lesson_blocks.content_json
          cleanThumb = sourceType === 'UPLOAD' ? '' : thumbRes.url;
        } else if (thumbRes.url.startsWith('https://')) {
          cleanThumb = thumbRes.url;
        } else {
          throw new BlockError(idx, '"thumbnail_url" phải dùng giao thức https.');
        }
      }
      const base = {
        source_type: sourceType,
        title: str(c.title, 200, 'title', idx),
        description: str(c.description, 2000, 'description', idx),
        duration_seconds: durationSeconds,
        start_seconds: startSeconds,
        autoplay: Boolean(c.autoplay),
        allow_seeking_ahead: c.allow_seeking_ahead !== false,
        thumbnail_url: cleanThumb,
      };
      if (sourceType === 'UPLOAD') {
        const resId = str(c.resource_id, 64, 'resource_id', idx, { required: true });
        const res = findResourceInScope(ctx, resId, idx, ['VIDEO']);
        const resHttpsThumb =
          typeof res.thumbnail_url === 'string' && res.thumbnail_url.startsWith('https://') ? res.thumbnail_url : '';
        return {
          ...base,
          resource_id: res.id,
          title: base.title || res.title,
          duration_seconds: base.duration_seconds || Number(res.duration_seconds || 0),
          thumbnail_url: base.thumbnail_url || resHttpsThumb,
        };
      }
      if (sourceType === 'YOUTUBE') {
        let videoId = c.video_id;
        let start = startSeconds;
        if (c.url) {
          const parsed = parseYouTubeUrl(String(c.url));
          if (!parsed.ok) throw new BlockError(idx, parsed.message);
          videoId = parsed.videoId;
          start = start || parsed.startSeconds;
        }
        if (!isValidYouTubeVideoId(videoId)) throw new BlockError(idx, 'mã video YouTube không hợp lệ.');
        return {
          ...base,
          video_id: videoId,
          start_seconds: start,
          thumbnail_url: base.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
      }
      const dv = validateDirectVideoUrl(c.direct_url || c.url);
      if (!dv.ok) throw new BlockError(idx, dv.message);
      return {
        ...base,
        direct_url: dv.url,
      };
    }
    case 'pdf': {
      const resourceId = str(c.resource_id, 64, 'resource_id', idx, { required: true });
      const res = findResourceInScope(ctx, resourceId, idx, ['PDF', 'FILE']);
      if (res.resource_type === 'FILE' && res.mime_type !== 'application/pdf') {
        throw new BlockError(idx, 'tài nguyên được chọn không phải tệp PDF.');
      }
      return {
        resource_id: res.id,
        title: str(c.title, 200, 'title', idx) || res.title,
        description: str(c.description, 1000, 'description', idx),
        allow_download: c.allow_download !== false,
      };
    }
    case 'file': {
      const resourceId = str(c.resource_id, 64, 'resource_id', idx, { required: true });
      const res = findResourceInScope(ctx, resourceId, idx);
      return {
        resource_id: res.id,
        title: str(c.title, 200, 'title', idx) || res.title,
        description: str(c.description, 1000, 'description', idx) || undefined,
      };
    }
    case 'table': {
      if (!Array.isArray(c.rows) || c.rows.length === 0) throw new BlockError(idx, 'bảng cần ít nhất 1 dòng.');
      if (c.rows.length > 50) throw new BlockError(idx, 'bảng tối đa 50 dòng.');
      const rows = c.rows.map((r) => {
        if (!Array.isArray(r) || r.length > 10) throw new BlockError(idx, 'mỗi dòng tối đa 10 cột.');
        return r.map((cell) => str(String(cell ?? ''), 500, 'ô bảng', idx));
      });
      return { rows, has_header: Boolean(c.has_header) };
    }
    case 'math':
      return { latex: str(c.latex, 2000, 'latex', idx, { required: true }), display: c.display !== false };
    case 'code':
    case 'code_block':
      return {
        language: str(c.language, 30, 'language', idx) || 'text',
        code: str(c.code, 20000, 'code', idx, { required: true }),
      };
    case 'quote':
      return { text: str(c.text, 2000, 'text', idx, { required: true }), cite: str(c.cite, 200, 'cite', idx) };
    case 'callout':
      return {
        variant: CALLOUT_VARIANTS.includes(c.variant) ? c.variant : 'note',
        title: str(c.title, 200, 'title', idx),
        text: str(c.text, 5000, 'text', idx),
      };
    case 'link': {
      const out = { url: httpUrl(c.url, 'url', idx), label: str(c.label, 200, 'label', idx) };
      const desc = str(c.description, 500, 'description', idx);
      if (desc) out.description = desc;
      return out;
    }
    case 'quiz': {
      const quizKind = String(c.quiz_kind || 'QUICK_CHECK').toUpperCase();
      if (!QUIZ_KINDS.includes(quizKind)) {
        throw new BlockError(idx, `loại quiz "${quizKind}" không hợp lệ.`);
      }
      const title = str(c.title, 200, 'title', idx) || 'Bài kiểm tra kiến thức';
      const description = str(c.description, 1500, 'description', idx);
      const passScorePct = Number.isFinite(Number(c.pass_score_pct))
        ? Math.max(0, Math.min(100, Math.round(Number(c.pass_score_pct))))
        : 60;
      const maxAttempts = Number.isFinite(Number(c.max_attempts))
        ? Math.max(0, Math.min(20, Math.floor(Number(c.max_attempts))))
        : 3;
      if (!Array.isArray(c.questions) || c.questions.length === 0 || c.questions.length > 40) {
        throw new BlockError(idx, 'khối Quiz độc lập cần từ 1 đến 40 câu hỏi.');
      }
      let questions;
      try {
        questions = c.questions.map((q, qi) => normalizeQuestionSpec(q, `Câu #${qi + 1}`));
      } catch (err) {
        if (err instanceof QuizValidationError) throw new BlockError(idx, err.message);
        throw err;
      }
      return {
        quiz_kind: quizKind,
        title,
        description,
        pass_score_pct: passScorePct,
        max_attempts: maxAttempts,
        is_required: Boolean(c.is_required),
        show_answer_after_submit: c.show_answer_after_submit !== false,
        show_explanation: c.show_explanation !== false,
        questions,
      };
    }
    case 'review_question':
    case 'inline_mcq': {
      const question = str(c.question, 1000, 'question', idx, { required: true });
      if (!Array.isArray(c.options) || c.options.length < 2 || c.options.length > 6) {
        throw new BlockError(idx, 'câu hỏi cần từ 2 đến 6 phương án.');
      }
      const options = c.options.map((o, i) => ({
        id: str(o.id, 32, 'option.id', idx) || `opt_${i + 1}`,
        text: str(o.text, 500, 'option.text', idx, { required: true }),
        is_correct: Boolean(o.is_correct),
        feedback: str(o.feedback, 500, 'option.feedback', idx),
      }));
      if (!options.some((o) => o.is_correct)) throw new BlockError(idx, 'cần ít nhất một phương án đúng.');
      return { question, options };
    }
    case 'assignment': {
      const maxScoreNum = Number(c.max_score ?? 10);
      return {
        title: str(c.title, 200, 'title', idx, { required: true }),
        description: str(c.description, 4000, 'description', idx),
        instructions: str(c.instructions, 4000, 'instructions', idx),
        due_at: str(c.due_at, 40, 'due_at', idx),
        max_score: Number.isFinite(maxScoreNum) && maxScoreNum > 0 ? Math.min(1000, maxScoreNum) : 10,
        submission_type: ['TEXT', 'FILE', 'BOTH', 'EXTERNAL'].includes(c.submission_type) ? c.submission_type : 'BOTH',
        url: c.url ? httpUrl(c.url, 'url', idx, { required: false }) : '',
      };
    }
    case 'assignment_link':
      return {
        title: str(c.title, 200, 'title', idx, { required: true }),
        description: str(c.description, 2000, 'description', idx),
        url: c.url ? httpUrl(c.url, 'url', idx) : '',
        due_at: str(c.due_at, 40, 'due_at', idx),
      };
    case 'embed': {
      if (typeof c.html === 'string' && c.html.trim()) {
        throw new BlockError(idx, 'không cho phép chèn mã HTML hoặc thẻ iframe tùy ý.');
      }
      const embedUrl = httpUrl(c.embed_url || c.url, 'embed_url', idx, { httpsOnly: true, required: true });
      const u = new URL(embedUrl);
      const provider = ALLOWED_EMBED_DOMAINS.get(u.hostname.toLowerCase());
      if (!provider) {
        throw new BlockError(
          idx,
          `tên miền nhúng "${u.hostname}" không nằm trong danh sách học liệu an toàn được phép (GeoGebra, PhET, Desmos, YouTube).`
        );
      }
      const heightNum = Number(c.height ?? 420);
      return {
        provider,
        embed_url: u.toString(),
        title: str(c.title, 200, 'title', idx) || `Học liệu tương tác ${provider}`,
        caption: str(c.caption, 500, 'caption', idx),
        height: Number.isFinite(heightNum) ? Math.max(240, Math.min(800, Math.round(heightNum))) : 420,
      };
    }
    case 'step_by_step_solution':
      return c; // kiểu cũ: giữ nguyên, chỉ giới hạn kích thước
    default:
      throw new BlockError(idx, `loại khối "${type}" không được hỗ trợ.`);
  }
}

/**
 * @returns {{ ok: true, blocks: Array<{id:string, block_type:string, sort_order:number, content:object, anchor_block_id?:string|null}> }
 *          | { ok: false, code: string, message: string, block_index?: number }}
 */
export function validateBlocks(input, ctx) {
  if (!Array.isArray(input)) return { ok: false, code: 'INVALID_BLOCKS', message: 'Nội dung bài học phải là danh sách khối.' };
  if (input.length > MAX_BLOCKS_PER_LESSON) {
    return { ok: false, code: 'TOO_MANY_BLOCKS', message: `Mỗi bài học tối đa ${MAX_BLOCKS_PER_LESSON} khối.` };
  }
  const seen = new Set();
  try {
    const blocks = input.map((b, idx) => {
      if (!b || typeof b !== 'object') throw new BlockError(idx, 'dữ liệu không hợp lệ.');
      const type = b.block_type || b.type;
      if (!ALLOWED_BLOCK_TYPES.includes(type)) throw new BlockError(idx, `loại khối "${type}" không được hỗ trợ.`);
      let id = typeof b.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.id) ? b.id : `blk_${crypto.randomBytes(6).toString('hex')}`;
      if (seen.has(id)) id = `blk_${crypto.randomBytes(6).toString('hex')}`;
      seen.add(id);
      const rawContent = b.content || {};
      const content = normalizeContent(type, rawContent, idx, ctx);
      const display = normalizeDisplayConfig(rawContent.display);
      if (display) content.display = display;
      const maxBytes = type === 'image' ? MAX_IMAGE_BLOCK_JSON_BYTES : MAX_BLOCK_JSON_BYTES;
      if (Buffer.byteLength(JSON.stringify(content)) > maxBytes) {
        throw new BlockError(idx, 'nội dung khối quá lớn.');
      }
      const anchor =
        typeof b.anchor_block_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.anchor_block_id)
          ? b.anchor_block_id
          : null;
      return { id, block_type: type, sort_order: (idx + 1) * 1000, content, anchor_block_id: anchor };
    });
    return { ok: true, blocks };
  } catch (err) {
    if (err instanceof BlockError) {
      return { ok: false, code: err.code, message: err.message, block_index: err.blockIndex };
    }
    throw err;
  }
}

/** Chuẩn hóa snapshot phiên bản (hỗ trợ cả định dạng cũ có `content_json`). */
export function normalizeSnapshot(snapshotJson) {
  let arr;
  try {
    arr = JSON.parse(snapshotJson || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((b, i) => {
      let content = b.content;
      if (!content && typeof b.content_json === 'string') {
        try {
          content = JSON.parse(b.content_json);
        } catch {
          content = {};
        }
      }
      return {
        id: b.id || `blk_${i}`,
        block_type: b.block_type || b.type,
        sort_order: b.sort_order ?? (i + 1) * 1000,
        content: content || {},
        status: b.status || 'ACTIVE',
      };
    })
    .filter((b) => b.status !== 'HIDDEN' && !b.content?.display?.hidden)
    .sort((a, b) => a.sort_order - b.sort_order);
}
