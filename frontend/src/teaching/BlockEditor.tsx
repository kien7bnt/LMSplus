import React, { useState } from 'react';
import { BlockType, LessonBlock, Resource, teachingApi, YouTubeCheck } from './api';
import { YouTubeEmbed } from './BlockRenderer';
import { Btn, errMsg, Field, ImageUrlInput } from './ui';

const BLOCK_LABELS: Record<string, string> = {
  heading: 'Tiêu đề',
  paragraph: 'Văn bản',
  youtube: 'Video YouTube',
  image: 'Hình ảnh',
  file: 'Tài liệu',
  table: 'Bảng',
  math: 'Công thức',
  code: 'Mã nguồn',
  code_block: 'Mã nguồn',
  quote: 'Trích dẫn',
  callout: 'Hộp ghi chú',
  link: 'Liên kết',
  review_question: 'Câu hỏi ôn tập',
  inline_mcq: 'Câu hỏi ôn tập',
  assignment_link: 'Bài tập liên quan',
  step_by_step_solution: 'Lời giải từng bước',
};

const INSERTABLE: BlockType[] = [
  'paragraph', 'heading', 'youtube', 'image', 'file', 'callout', 'review_question',
  'table', 'math', 'code', 'quote', 'link', 'assignment_link',
];

const newId = () => `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export function emptyBlock(type: BlockType): LessonBlock {
  const defaults: Record<string, Record<string, any>> = {
    heading: { text: '', level: 2 },
    paragraph: { text: '' },
    youtube: { video_id: '', title: '', description: '', start_seconds: 0 },
    image: { url: '', alt: '', caption: '' },
    file: { resource_id: '', title: '' },
    table: { rows: [['', ''], ['', '']], has_header: true },
    math: { latex: '' },
    code: { language: 'python', code: '' },
    quote: { text: '', cite: '' },
    callout: { variant: 'note', title: '', text: '' },
    link: { url: '', label: '' },
    review_question: { question: '', options: [{ id: 'a', text: '', is_correct: true, feedback: '' }, { id: 'b', text: '', is_correct: false, feedback: '' }] },
    assignment_link: { title: '', description: '', url: '', due_at: '' },
  };
  return { id: newId(), block_type: type, content: { ...(defaults[type] || {}) } };
}

// ------------------------------------------------------------------ YouTube block editor

const YouTubeFields: React.FC<{ block: LessonBlock; onChange: (c: Record<string, any>) => void; disabled: boolean }> = ({ block, onChange, disabled }) => {
  const c = block.content;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<YouTubeCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      const r = await teachingApi.validateYouTube(url);
      setCheck(r);
      onChange({ ...c, video_id: r.video_id, start_seconds: r.start_seconds, title: c.title || r.title });
      setUrl('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!c.video_id || !disabled ? (
        <Field label={c.video_id ? 'Thay video khác' : 'Đường dẫn video YouTube'} hint="Hỗ trợ youtube.com/watch?v=…, youtu.be/…, /embed/…, /shorts/…" error={error || undefined}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="t-input"
              value={url}
              disabled={disabled}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (url.trim()) validate();
                }
              }}
              placeholder="Dán đường dẫn video YouTube tại đây"
            />
            <Btn variant="primary" onClick={validate} loading={busy} disabled={disabled || !url.trim()}>
              Kiểm tra
            </Btn>
          </div>
        </Field>
      ) : null}
      {check && check.embeddable === false && (
        <div className="t-notice t-notice--warning" role="alert">
          {check.check_message} Học viên vẫn có thể mở video trực tiếp trên YouTube.
        </div>
      )}
      {check && check.embeddable === null && check.check_message && <div className="t-notice">{check.check_message}</div>}
      {c.video_id ? (
        <>
          <YouTubeEmbed videoId={c.video_id} startSeconds={c.start_seconds} title={c.title} />
          <div className="t-form-grid">
            <Field label="Tiêu đề video">
              <input className="t-input" value={c.title || ''} maxLength={200} disabled={disabled} onChange={(e) => onChange({ ...c, title: e.target.value })} />
            </Field>
            <Field label="Bắt đầu từ giây">
              <input
                className="t-input tabular-nums"
                type="number"
                min={0}
                value={c.start_seconds || 0}
                disabled={disabled}
                onChange={(e) => onChange({ ...c, start_seconds: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label="Mô tả (không bắt buộc)" wide>
              <textarea className="t-input" rows={2} maxLength={2000} value={c.description || ''} disabled={disabled} onChange={(e) => onChange({ ...c, description: e.target.value })} />
            </Field>
          </div>
        </>
      ) : (
        <p className="t-sub">Chưa có video. Dán đường dẫn rồi bấm "Kiểm tra" để xem trước.</p>
      )}
    </>
  );
};

// ------------------------------------------------------------------ Per-type fields

const BlockFields: React.FC<{
  block: LessonBlock;
  onChange: (content: Record<string, any>) => void;
  disabled: boolean;
  resources: Resource[];
}> = ({ block, onChange, disabled, resources }) => {
  const c = block.content;
  const set = (patch: Record<string, any>) => onChange({ ...c, ...patch });
  switch (block.block_type) {
    case 'heading':
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="t-input" style={{ width: 140 }} value={c.level === 3 ? 3 : 2} disabled={disabled} onChange={(e) => set({ level: Number(e.target.value) })} aria-label="Cấp tiêu đề">
            <option value={2}>Tiêu đề lớn</option>
            <option value={3}>Tiêu đề nhỏ</option>
          </select>
          <input className="t-input" value={c.text || ''} maxLength={300} disabled={disabled} placeholder="Nội dung tiêu đề" onChange={(e) => set({ text: e.target.value })} aria-label="Tiêu đề" />
        </div>
      );
    case 'paragraph':
      return <textarea className="t-input" rows={4} value={c.text || ''} maxLength={20000} disabled={disabled} placeholder="Nhập nội dung bài học…" onChange={(e) => set({ text: e.target.value })} aria-label="Văn bản" />;
    case 'youtube':
      return <YouTubeFields block={block} onChange={onChange} disabled={disabled} />;
    case 'image':
      return (
        <div className="t-form-grid">
          <Field
            label="Hình ảnh"
            wide
            hint="Dán đường dẫn ảnh (Google/Bing Images, Google Drive, https://...) hoặc chọn ảnh từ máy"
          >
            <ImageUrlInput
              value={c.url || ''}
              disabled={disabled}
              variant="content"
              onChange={(nextUrl) => set({ url: nextUrl })}
              ariaLabel="Đường dẫn ảnh"
            />
          </Field>
          <Field label="Mô tả ảnh (cho người dùng trình đọc màn hình)">
            <input className="t-input" value={c.alt || ''} maxLength={300} disabled={disabled} onChange={(e) => set({ alt: e.target.value })} />
          </Field>
          <Field label="Chú thích">
            <input className="t-input" value={c.caption || ''} maxLength={500} disabled={disabled} onChange={(e) => set({ caption: e.target.value })} />
          </Field>
        </div>
      );
    case 'file':
      return resources.length === 0 ? (
        <p className="t-sub">Khóa học chưa có tài liệu. Hãy thêm tài liệu ở mục "Tài liệu" của khóa học trước.</p>
      ) : (
        <Field label="Chọn tài liệu của khóa học">
          <select className="t-input" value={c.resource_id || ''} disabled={disabled} onChange={(e) => set({ resource_id: e.target.value })}>
            <option value="">— Chọn tài liệu —</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} {r.file_name ? `(${r.file_name})` : '(liên kết)'}
              </option>
            ))}
          </select>
        </Field>
      );
    case 'table': {
      const rows: string[][] = c.rows || [['']];
      const update = (ri: number, ci: number, v: string) => set({ rows: rows.map((r, i) => (i === ri ? r.map((x, j) => (j === ci ? v : x)) : r)) });
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="t-table-wrap">
            <table className="t-table">
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => (
                      <td key={ci} style={{ padding: 4 }}>
                        <input className="t-input" value={cell} disabled={disabled} onChange={(e) => update(ri, ci, e.target.value)} aria-label={`Ô dòng ${ri + 1} cột ${ci + 1}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="t-actions">
            <Btn small disabled={disabled || rows.length >= 50} onClick={() => set({ rows: [...rows, rows[0].map(() => '')] })}>+ Dòng</Btn>
            <Btn small disabled={disabled || rows[0].length >= 10} onClick={() => set({ rows: rows.map((r) => [...r, '']) })}>+ Cột</Btn>
            <Btn small disabled={disabled || rows.length <= 1} onClick={() => set({ rows: rows.slice(0, -1) })}>− Dòng</Btn>
            <Btn small disabled={disabled || rows[0].length <= 1} onClick={() => set({ rows: rows.map((r) => r.slice(0, -1)) })}>− Cột</Btn>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input type="checkbox" checked={Boolean(c.has_header)} disabled={disabled} onChange={(e) => set({ has_header: e.target.checked })} /> Dòng đầu là tiêu đề
            </label>
          </div>
        </div>
      );
    }
    case 'math':
      return <textarea className="t-input" style={{ fontFamily: 'var(--font-mono)' }} rows={2} value={c.latex || ''} maxLength={2000} disabled={disabled} placeholder="Ví dụ: S = \frac{a \times h}{2}" onChange={(e) => set({ latex: e.target.value })} aria-label="Công thức LaTeX" />;
    case 'code':
    case 'code_block':
      return (
        <>
          <input className="t-input" style={{ maxWidth: 200 }} value={c.language || ''} maxLength={30} disabled={disabled} onChange={(e) => set({ language: e.target.value })} aria-label="Ngôn ngữ" placeholder="Ngôn ngữ (python, sql…)" />
          <textarea className="t-input" style={{ fontFamily: 'var(--font-mono)' }} rows={6} value={c.code || ''} maxLength={20000} disabled={disabled} onChange={(e) => set({ code: e.target.value })} aria-label="Mã nguồn" />
        </>
      );
    case 'quote':
      return (
        <>
          <textarea className="t-input" rows={2} value={c.text || ''} maxLength={2000} disabled={disabled} onChange={(e) => set({ text: e.target.value })} aria-label="Trích dẫn" placeholder="Nội dung trích dẫn" />
          <input className="t-input" value={c.cite || ''} maxLength={200} disabled={disabled} onChange={(e) => set({ cite: e.target.value })} aria-label="Nguồn" placeholder="Nguồn (không bắt buộc)" />
        </>
      );
    case 'callout':
      return (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="t-input" style={{ width: 180 }} value={c.variant || 'note'} disabled={disabled} onChange={(e) => set({ variant: e.target.value })} aria-label="Loại ghi chú">
              <option value="learning_objective">Mục tiêu</option>
              <option value="definition">Định nghĩa</option>
              <option value="remember">Ghi nhớ</option>
              <option value="note">Lưu ý</option>
              <option value="warning">Cảnh báo</option>
              <option value="exam_tip">Mẹo làm bài</option>
              <option value="summary">Tóm tắt</option>
            </select>
            <input className="t-input" style={{ flex: 1 }} value={c.title || ''} maxLength={200} disabled={disabled} onChange={(e) => set({ title: e.target.value })} placeholder="Tiêu đề (không bắt buộc)" aria-label="Tiêu đề ghi chú" />
          </div>
          <textarea className="t-input" rows={3} value={c.text || ''} maxLength={5000} disabled={disabled} onChange={(e) => set({ text: e.target.value })} aria-label="Nội dung ghi chú" />
        </>
      );
    case 'link':
      return (
        <div className="t-form-grid">
          <Field label="Đường dẫn">
            <input className="t-input" value={c.url || ''} disabled={disabled} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Tên hiển thị">
            <input className="t-input" value={c.label || ''} maxLength={200} disabled={disabled} onChange={(e) => set({ label: e.target.value })} />
          </Field>
        </div>
      );
    case 'review_question':
    case 'inline_mcq': {
      const options: any[] = c.options || [];
      const setOpt = (i: number, patch: Record<string, any>) => set({ options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
      return (
        <>
          <input className="t-input" value={c.question || ''} maxLength={1000} disabled={disabled} onChange={(e) => set({ question: e.target.value })} placeholder="Nội dung câu hỏi" aria-label="Câu hỏi" />
          {options.map((o, i) => (
            <div key={o.id || i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', minHeight: 44, fontSize: 13 }}>
                <input type="radio" name={`correct-${block.id}`} checked={Boolean(o.is_correct)} disabled={disabled} onChange={() => set({ options: options.map((x, j) => ({ ...x, is_correct: j === i })) })} />
                Đúng
              </label>
              <input className="t-input" style={{ flex: '2 1 200px' }} value={o.text || ''} maxLength={500} disabled={disabled} onChange={(e) => setOpt(i, { text: e.target.value })} placeholder={`Phương án ${i + 1}`} aria-label={`Phương án ${i + 1}`} />
              <input className="t-input" style={{ flex: '1 1 160px' }} value={o.feedback || ''} maxLength={500} disabled={disabled} onChange={(e) => setOpt(i, { feedback: e.target.value })} placeholder="Phản hồi (không bắt buộc)" aria-label={`Phản hồi phương án ${i + 1}`} />
              <button type="button" className="t-icon-btn" disabled={disabled || options.length <= 2} aria-label={`Xóa phương án ${i + 1}`} onClick={() => set({ options: options.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <div>
            <Btn small disabled={disabled || options.length >= 6} onClick={() => set({ options: [...options, { id: `o${Date.now().toString(36)}`, text: '', is_correct: false, feedback: '' }] })}>
              + Thêm phương án
            </Btn>
          </div>
        </>
      );
    }
    case 'assignment_link':
      return (
        <div className="t-form-grid">
          <Field label="Tên bài tập">
            <input className="t-input" value={c.title || ''} maxLength={200} disabled={disabled} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Hạn nộp (không bắt buộc)">
            <input className="t-input" value={c.due_at || ''} maxLength={40} disabled={disabled} onChange={(e) => set({ due_at: e.target.value })} placeholder="vd: 20/11/2026" />
          </Field>
          <Field label="Mô tả" wide>
            <textarea className="t-input" rows={2} value={c.description || ''} maxLength={2000} disabled={disabled} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Đường dẫn bài tập (không bắt buộc)" wide>
            <input className="t-input" value={c.url || ''} disabled={disabled} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
          </Field>
        </div>
      );
    default:
      return <p className="t-sub">Khối nội dung kiểu cũ — giữ nguyên khi lưu.</p>;
  }
};

// ------------------------------------------------------------------ Editor

export const BlockEditor: React.FC<{
  blocks: LessonBlock[];
  onChange: (blocks: LessonBlock[]) => void;
  disabled: boolean;
  resources: Resource[];
}> = ({ blocks, onChange, disabled, resources }) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const insert = (type: BlockType, at: number) => {
    const next = [...blocks];
    next.splice(at, 0, emptyBlock(type));
    onChange(next);
    setInsertAt(null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    onChange(next);
  };

  const InsertMenu: React.FC<{ at: number }> = ({ at }) => (
    <div className="t-insert" role="group" aria-label="Chèn khối nội dung">
      {INSERTABLE.map((t) => (
        <Btn key={t} small variant={t === 'youtube' ? 'primary' : 'quiet'} onClick={() => insert(t, at)} disabled={disabled}>
          + {BLOCK_LABELS[t]}
        </Btn>
      ))}
      {blocks.length > 0 && (
        <Btn small variant="ghost" onClick={() => setInsertAt(null)}>
          Đóng
        </Btn>
      )}
    </div>
  );

  return (
    <div>
      {blocks.length === 0 && <InsertMenu at={0} />}
      {blocks.map((b, i) => (
        <React.Fragment key={b.id}>
          {insertAt === i && <InsertMenu at={i} />}
          <div
            className="t-block"
            data-drop={dropIndex === i && dragIndex !== null && dragIndex !== i}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              setDropIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
              setDropIndex(null);
            }}
          >
            <div className="t-block__bar">
              <span
                className="t-drag"
                draggable={!disabled}
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                title="Kéo để sắp xếp"
                aria-hidden="true"
              >
                ⠿
              </span>
              <span className="t-block__type">
                {i + 1}. {BLOCK_LABELS[b.block_type] || b.block_type}
              </span>
              <button type="button" className="t-icon-btn" aria-label="Chèn khối phía trên" title="Chèn khối phía trên" disabled={disabled} onClick={() => setInsertAt(i)}>
                ＋
              </button>
              <button type="button" className="t-icon-btn" aria-label="Di chuyển lên" disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="t-icon-btn" aria-label="Di chuyển xuống" disabled={disabled || i === blocks.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              <button
                type="button"
                className="t-icon-btn"
                aria-label="Xóa khối"
                disabled={disabled}
                onClick={() => {
                  const hasContent = Object.values(b.content || {}).some((v) => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : Boolean(v)));
                  if (!hasContent || window.confirm('Xóa khối nội dung này khỏi bản nháp?')) onChange(blocks.filter((x) => x.id !== b.id));
                }}
              >
                🗑
              </button>
            </div>
            <div className="t-block__body">
              <BlockFields
                block={b}
                disabled={disabled}
                resources={resources}
                onChange={(content) => onChange(blocks.map((x) => (x.id === b.id ? { ...x, content } : x)))}
              />
            </div>
          </div>
        </React.Fragment>
      ))}
      {blocks.length > 0 && (insertAt === blocks.length ? <InsertMenu at={blocks.length} /> : (
        <div style={{ marginTop: 12 }}>
          <Btn onClick={() => setInsertAt(blocks.length)} disabled={disabled}>
            + Thêm khối nội dung
          </Btn>
        </div>
      ))}
    </div>
  );
};
