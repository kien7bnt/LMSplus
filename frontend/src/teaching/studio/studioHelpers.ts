import { BlockType, LessonBlock, Resource } from '../api';
import { createDefaultQuestionSpec } from './QuestionEditorFields';

export type SaveStatus = 'SAVED' | 'DIRTY' | 'SAVING' | 'ERROR' | 'CONFLICT';

export const SAVE_STATUS_LABELS: Record<SaveStatus, { text: string; tone: 'success' | 'warning' | 'info' | 'danger' }> = {
  SAVED: { text: 'Đã lưu bản nháp', tone: 'success' },
  DIRTY: { text: 'Có thay đổi chưa lưu', tone: 'warning' },
  SAVING: { text: 'Đang lưu…', tone: 'info' },
  ERROR: { text: 'Lưu chưa thành công', tone: 'danger' },
  CONFLICT: { text: 'Có phiên bản mới hơn từ tab khác', tone: 'danger' },
};

export const BLOCK_TYPE_NAMES: Record<string, string> = {
  heading: 'Tiêu đề mục',
  paragraph: 'Đoạn văn bản',
  image: 'Hình ảnh minh họa',
  video: 'Video & Câu hỏi tương tác',
  youtube: 'Video YouTube',
  pdf: 'Tài liệu PDF trực tuyến',
  file: 'Tệp đính kèm',
  table: 'Bảng dữ liệu',
  math: 'Công thức Toán học',
  code: 'Khối mã nguồn',
  code_block: 'Khối mã nguồn',
  quote: 'Trích dẫn',
  callout: 'Hộp ghi chú sư phạm',
  link: 'Liên kết tham khảo',
  quiz: 'Bài kiểm tra (Quiz độc lập)',
  review_question: 'Câu hỏi ôn tập nhanh',
  inline_mcq: 'Câu hỏi trắc nghiệm nhanh',
  assignment: 'Bài tập thực hành',
  assignment_link: 'Liên kết bài tập',
  step_by_step_solution: 'Lời giải từng bước',
  embed: 'Học liệu nhúng an toàn',
};

export const BLOCK_PALETTE_GROUPS: Array<{
  group: string;
  items: Array<{ type: BlockType; label: string; quick?: boolean }>;
}> = [
  {
    group: 'Văn bản & Trình bày',
    items: [
      { type: 'paragraph', label: 'Đoạn văn bản', quick: true },
      { type: 'heading', label: 'Tiêu đề mục' },
      { type: 'callout', label: 'Hộp ghi chú' },
      { type: 'quote', label: 'Trích dẫn' },
      { type: 'step_by_step_solution', label: 'Lời giải từng bước' },
      { type: 'table', label: 'Bảng dữ liệu' },
      { type: 'math', label: 'Công thức Toán' },
      { type: 'code', label: 'Khối mã nguồn' },
    ],
  },
  {
    group: 'Video & Học liệu số',
    items: [
      { type: 'video', label: 'Video & Quiz', quick: true },
      { type: 'image', label: 'Hình ảnh', quick: true },
      { type: 'pdf', label: 'Tài liệu PDF', quick: true },
      { type: 'file', label: 'Tệp đính kèm' },
      { type: 'link', label: 'Liên kết ngoài' },
      { type: 'embed', label: 'Nhúng mô phỏng' },
    ],
  },
  {
    group: 'Kiểm tra & Bài tập',
    items: [
      { type: 'quiz', label: 'Bài kiểm tra', quick: true },
      { type: 'assignment', label: 'Bài tập nộp' },
    ],
  },
];

export const QUICK_PALETTE_ITEMS = BLOCK_PALETTE_GROUPS.flatMap((g) => g.items).filter((it) => it.quick);

export function formatChapterHeading(index: number, rawTitle: string): string {
  const title = (rawTitle || '').trim();
  if (!title) return `Chương ${index + 1}`;
  if (/^chương\s+\d+/i.test(title)) return title;
  return `Chương ${index + 1}. ${title}`;
}

export function formatLessonHeading(chapterIdx: number, lessonIdx: number, rawTitle: string): string {
  const title = (rawTitle || '').trim();
  if (!title) return `${chapterIdx + 1}.${lessonIdx + 1}. Bài học mới`;
  if (/^(\d+(\.\d+)?[\s.:-]|bài\s+\d+)/i.test(title)) return title;
  return `${chapterIdx + 1}.${lessonIdx + 1}. ${title}`;
}

export function getBlockSummary(block: LessonBlock, markerCount: number): string {
  const c = block.content || {};
  switch (block.block_type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return String(c.text || '').trim().slice(0, 72) || 'Chưa nhập nội dung';
    case 'callout':
      return String(c.title || c.text || '').trim().slice(0, 72) || 'Ghi chú sư phạm';
    case 'video':
    case 'youtube': {
      const title = String(c.title || '').trim() || (c.video_id ? `YouTube (${c.video_id})` : 'Chưa gắn nguồn video');
      return markerCount > 0 ? `${title} · ${markerCount} mốc câu hỏi` : title;
    }
    case 'image':
      return String(c.caption || c.alt || (c.url ? 'Đã gắn hình ảnh' : 'Chưa gắn hình ảnh')).slice(0, 72);
    case 'pdf':
    case 'file':
      return String(c.title || (c.resource_id ? 'Đã đính kèm tệp' : 'Chưa chọn tệp')).slice(0, 72);
    case 'quiz': {
      const qs = Array.isArray(c.questions) ? c.questions.length : 0;
      return `${String(c.title || 'Bài kiểm tra').slice(0, 48)} · ${qs} câu hỏi`;
    }
    case 'assignment':
      return String(c.title || 'Bài tập thực hành').slice(0, 72);
    case 'link':
    case 'embed':
      return String(c.title || c.url || c.embed_url || 'Chưa gắn liên kết').slice(0, 72);
    case 'code':
    case 'code_block':
      return `${c.language || 'code'} · ${String(c.code || '').split('\n')[0]?.slice(0, 52) || ''}`;
    case 'math':
      return String(c.latex || 'Công thức').slice(0, 64);
    case 'table': {
      const rows = Array.isArray(c.rows) ? c.rows.length : 0;
      return `Bảng ${rows} dòng`;
    }
    case 'step_by_step_solution': {
      const steps = Array.isArray(c.steps) ? c.steps.length : 0;
      return `${String(c.problem || 'Bài toán mẫu').slice(0, 48)} · ${steps} bước`;
    }
    default:
      return String(c.title || c.prompt || '').slice(0, 72);
  }
}

export const ALLOWED_EMBED_HOST_HINTS = [
  { name: 'GeoGebra', example: 'https://www.geogebra.org/material/iframe/id/...' },
  { name: 'PhET Interactive', example: 'https://phet.colorado.edu/sims/html/...' },
  { name: 'Desmos', example: 'https://www.desmos.com/calculator/...' },
  { name: 'YouTube Nocookie', example: 'https://www.youtube-nocookie.com/embed/...' },
];

export function makeNewBlock(type: BlockType, resources: Resource[]): LessonBlock {
  const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const firstVideo = resources.find((r) => r.resource_type === 'VIDEO');
  const firstPdf = resources.find((r) => r.resource_type === 'PDF' || r.mime_type === 'application/pdf');
  const firstFile = resources[0];

  switch (type) {
    case 'heading':
      return { id, block_type: 'heading', content: { text: 'Tiêu đề phần mới', level: 2 } };
    case 'paragraph':
      return { id, block_type: 'paragraph', content: { text: '' } };
    case 'callout':
      return { id, block_type: 'callout', content: { variant: 'remember', title: 'Ghi nhớ trọng tâm', text: '' } };
    case 'quote':
      return { id, block_type: 'quote', content: { text: '', cite: '' } };
    case 'table':
      return {
        id,
        block_type: 'table',
        content: {
          has_header: true,
          rows: [
            ['Cột 1', 'Cột 2'],
            ['Nội dung 1', 'Nội dung 2'],
          ],
        },
      };
    case 'math':
      return { id, block_type: 'math', content: { latex: '\\frac{a}{b} + \\frac{c}{b} = \\frac{a + c}{b}' } };
    case 'code':
      return { id, block_type: 'code', content: { language: 'python', code: '# Nhập đoạn mã minh họa\n' } };
    case 'image':
      return { id, block_type: 'image', content: { url: '', alt: '', caption: '' } };
    case 'video':
      return {
        id,
        block_type: 'video',
        content: {
          source_type: firstVideo ? 'UPLOAD' : 'YOUTUBE',
          resource_id: firstVideo?.id || '',
          video_id: '',
          direct_url: '',
          title: firstVideo?.title || 'Video bài giảng',
          description: '',
          duration_seconds: firstVideo?.duration_seconds || 0,
          start_seconds: 0,
          allow_seeking_ahead: true,
          thumbnail_url: firstVideo?.thumbnail_url || '',
        },
      };
    case 'pdf':
      return {
        id,
        block_type: 'pdf',
        content: {
          resource_id: firstPdf?.id || '',
          title: firstPdf?.title || 'Tài liệu bài giảng PDF',
          description: '',
          allow_download: true,
        },
      };
    case 'file':
      return {
        id,
        block_type: 'file',
        content: {
          resource_id: firstFile?.id || '',
          title: firstFile?.title || 'Tài liệu học tập',
          description: '',
        },
      };
    case 'link':
      return { id, block_type: 'link', content: { url: 'https://', label: 'Tài liệu tham khảo thêm', description: '' } };
    case 'embed':
      return {
        id,
        block_type: 'embed',
        content: {
          provider: 'GeoGebra',
          embed_url: 'https://www.geogebra.org/classic',
          title: 'Mô phỏng trực quan GeoGebra',
          caption: '',
          height: 420,
        },
      };
    case 'quiz':
      return {
        id,
        block_type: 'quiz',
        content: {
          quiz_kind: 'QUICK_CHECK',
          title: 'Kiểm tra nhanh kiến thức',
          description: 'Hoàn thành các câu hỏi dưới đây để củng cố bài học.',
          pass_score_pct: 60,
          max_attempts: 3,
          is_required: false,
          show_answer_after_submit: true,
          show_explanation: true,
          questions: [createDefaultQuestionSpec('SINGLE_CHOICE')],
        },
      };
    case 'assignment':
      return {
        id,
        block_type: 'assignment',
        content: {
          title: 'Bài tập vận dụng cuối bài',
          description: '',
          instructions: 'Trình bày lời giải chi tiết hoặc đính kèm tệp bài làm.',
          due_at: '',
          max_score: 10,
          submission_type: 'BOTH',
          url: '',
        },
      };
    case 'step_by_step_solution':
      return {
        id,
        block_type: 'step_by_step_solution',
        content: {
          problem: 'Bài toán minh họa: Giải phương trình hoặc bài tập mẫu',
          steps: [
            { title: 'Bước 1: Phân tích đề bài', explanation: 'Xác định dữ kiện đầu vào và điều kiện bài toán.' },
            { title: 'Bước 2: Thực hiện biến đổi & Kết luận', explanation: 'Trình bày kết quả cuối cùng.' },
          ],
        },
      };
    default:
      return { id, block_type: 'paragraph', content: { text: '' } };
  }
}

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được tệp từ thiết bị.'));
    r.readAsDataURL(file);
  });
