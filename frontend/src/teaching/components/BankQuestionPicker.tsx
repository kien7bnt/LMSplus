import React, { useMemo, useState } from 'react';
import { BankQuestionRow, QuestionType, masterApi } from '../api';
import { Btn, label, useAsync } from '../ui';

export interface BankQuestionAttachment {
  kind: 'BANK_QUESTION';
  bank_question_id: string;
  prompt: string;
  question_type: QuestionType;
  points: number;
  options: Array<{ id: string; text: string }>;
}

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function toBankQuestionAttachment(q: BankQuestionRow): BankQuestionAttachment {
  return {
    kind: 'BANK_QUESTION',
    bank_question_id: q.id,
    prompt: q.prompt,
    question_type: q.question_type,
    points: Number(q.points) || 1,
    options: (q.options || []).map((opt) => ({ id: opt.id, text: opt.text })),
  };
}

export function extractBankQuestionAttachments(raw: unknown): BankQuestionAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && (item as { kind?: unknown }).kind === 'BANK_QUESTION')
    .map((item) => ({
      kind: 'BANK_QUESTION' as const,
      bank_question_id: String(item.bank_question_id || ''),
      prompt: String(item.prompt || ''),
      question_type: (item.question_type as QuestionType) || 'SINGLE_CHOICE',
      points: Number(item.points) || 1,
      options: Array.isArray(item.options)
        ? item.options.map((opt) => ({
            id: String((opt as { id?: unknown })?.id || ''),
            text: String((opt as { text?: unknown })?.text || ''),
          }))
        : [],
    }))
    .filter((item) => Boolean(item.bank_question_id) && Boolean(item.prompt));
}

export function formatQuestionsForInstructions(items: BankQuestionAttachment[]): string {
  return items
    .map((item, idx) => {
      const header = `Câu ${idx + 1} (${item.points} điểm): ${item.prompt}`;
      if (!item.options.length) return header;
      const lines = item.options.map((opt, optIdx) => {
        const prefix = OPTION_LETTERS[optIdx] || String(optIdx + 1);
        return `   ${prefix}. ${opt.text}`;
      });
      return `${header}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function mergeInstructionsWithQuestions(manualText: string, items: BankQuestionAttachment[]): string {
  const trimmed = manualText.trim();
  if (items.length === 0) return trimmed;
  const firstPrompt = items[0]?.prompt.trim();
  if (firstPrompt && trimmed.includes(firstPrompt)) return trimmed;
  const block = formatQuestionsForInstructions(items);
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

export interface BankQuestionPickerProps {
  courseId?: string;
  lessonId?: string;
  selected: BankQuestionAttachment[];
  onChange: (next: BankQuestionAttachment[]) => void;
  onInsertPrompt?: (text: string, totalPoints: number) => void;
}

export const BankQuestionPicker: React.FC<BankQuestionPickerProps> = ({
  courseId,
  lessonId,
  selected,
  onChange,
  onInsertPrompt,
}) => {
  const [search, setSearch] = useState('');
  const [onlyCurrentLesson, setOnlyCurrentLesson] = useState(false);

  const req = useAsync(
    () => (courseId ? masterApi.listQuestionBank({ course_id: courseId, page_size: 100 }) : Promise.resolve(null)),
    [courseId]
  );

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.bank_question_id)), [selected]);
  const totalPoints = useMemo(() => selected.reduce((sum, s) => sum + (Number(s.points) || 0), 0), [selected]);

  const filteredItems = useMemo(() => {
    const rows = req.data?.items || [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (onlyCurrentLesson && lessonId && row.lesson_id !== lessonId) return false;
      if (!q) return true;
      return (
        row.prompt.toLowerCase().includes(q) ||
        (row.lesson_title || '').toLowerCase().includes(q) ||
        (row.chapter_title || '').toLowerCase().includes(q)
      );
    });
  }, [req.data?.items, search, onlyCurrentLesson, lessonId]);

  const toggleQuestion = (row: BankQuestionRow) => {
    if (selectedIds.has(row.id)) {
      onChange(selected.filter((s) => s.bank_question_id !== row.id));
    } else {
      onChange([...selected, toBankQuestionAttachment(row)]);
    }
  };

  if (!courseId) return null;

  return (
    <div
      className="t-field t-field--wide"
      style={{
        padding: 12,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-surface-subtle)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <span className="t-field__label">Lấy câu hỏi từ Ngân hàng câu hỏi (tùy chọn)</span>
          <div className="t-sub tabular-nums">
            {selected.length > 0
              ? `Đã chọn ${selected.length} câu · Tổng ${totalPoints} điểm`
              : 'Chọn nhanh các câu hỏi có sẵn để gắn vào đề bài tập'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {selected.length > 0 && onInsertPrompt && (
            <Btn
              type="button"
              variant="secondary"
              small
              onClick={() => onInsertPrompt(formatQuestionsForInstructions(selected), totalPoints)}
            >
              Chèn vào hướng dẫn ({totalPoints}đ)
            </Btn>
          )}
          {selected.length > 0 && (
            <Btn type="button" variant="ghost" small onClick={() => onChange([])}>
              Bỏ chọn ({selected.length})
            </Btn>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <input
          type="search"
          className="t-input"
          aria-label="Tìm câu hỏi trong ngân hàng"
          placeholder="Tìm theo nội dung câu hỏi hoặc bài học..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        {lessonId && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyCurrentLesson}
              onChange={(e) => setOnlyCurrentLesson(e.target.checked)}
            />
            <span>Chỉ bài học đang chọn</span>
          </label>
        )}
      </div>

      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {req.loading && (
          <div style={{ padding: 12 }} className="t-muted">
            Đang tải câu hỏi từ ngân hàng...
          </div>
        )}
        {req.error && (
          <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="t-field__error">Không tải được ngân hàng câu hỏi.</span>
            <Btn type="button" variant="ghost" small onClick={req.reload}>
              Thử lại
            </Btn>
          </div>
        )}
        {!req.loading && !req.error && filteredItems.length === 0 && (
          <div style={{ padding: 12 }} className="t-muted">
            {onlyCurrentLesson
              ? 'Bài học này chưa có câu hỏi nào. Bỏ chọn bộ lọc để xem toàn bộ giáo trình.'
              : 'Chưa có câu hỏi phù hợp trong giáo trình này.'}
          </div>
        )}
        {!req.loading &&
          !req.error &&
          filteredItems.map((row) => {
            const checked = selectedIds.has(row.id);
            return (
              <label
                key={row.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '8px 12px',
                  minHeight: 44,
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleQuestion(row)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: checked ? 600 : 400 }}>{row.prompt}</div>
                  <div className="t-sub tabular-nums">
                    {label('questionType', row.question_type)}
                    {row.lesson_title ? ` · ${row.lesson_title}` : ''} · {row.points}đ
                  </div>
                </div>
              </label>
            );
          })}
      </div>
    </div>
  );
};
