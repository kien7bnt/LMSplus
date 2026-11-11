import React, { useState } from 'react';
import {
  QuestionBankItem,
  QuestionOptionSpec,
  QuestionSpec,
  QuestionType,
  teachingApi,
} from '../api';
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  SearchInput,
  Tone,
  errMsg,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Trắc nghiệm 1 đáp án',
  MULTIPLE_CHOICE: 'Chọn nhiều đáp án',
  TRUE_FALSE: 'Đúng / Sai',
  FILL_BLANK: 'Điền vào chỗ trống',
  SHORT_ANSWER: 'Tự luận ngắn',
};

export const DIFFICULTY_LABELS: Record<'EASY' | 'MEDIUM' | 'HARD', string> = {
  EASY: 'Cơ bản',
  MEDIUM: 'Vận dụng',
  HARD: 'Nâng cao',
};

export function createDefaultQuestionSpec(questionType: QuestionType = 'SINGLE_CHOICE'): QuestionSpec {
  const uid = () => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  if (questionType === 'TRUE_FALSE') {
    return {
      id: uid(),
      question_type: 'TRUE_FALSE',
      prompt: 'Nhận định sau đây là Đúng hay Sai?',
      options: [
        { id: 'true', text: 'Đúng', is_correct: true },
        { id: 'false', text: 'Sai', is_correct: false },
      ],
      answer_key: { correct_option_ids: ['true'], boolean_answer: true },
      points: 1,
      explanation: '',
    };
  }
  if (questionType === 'MULTIPLE_CHOICE') {
    return {
      id: uid(),
      question_type: 'MULTIPLE_CHOICE',
      prompt: 'Chọn tất cả các phương án đúng:',
      options: [
        { id: 'opt_a', text: 'Phương án A', is_correct: true },
        { id: 'opt_b', text: 'Phương án B', is_correct: true },
        { id: 'opt_c', text: 'Phương án C', is_correct: false },
      ],
      answer_key: { correct_option_ids: ['opt_a', 'opt_b'] },
      points: 1,
      explanation: '',
    };
  }
  if (questionType === 'FILL_BLANK') {
    return {
      id: uid(),
      question_type: 'FILL_BLANK',
      prompt: 'Điền kết quả thích hợp vào chỗ trống:',
      options: [],
      answer_key: { accepted_texts: [''], case_sensitive: false },
      points: 1,
      explanation: '',
    };
  }
  if (questionType === 'SHORT_ANSWER') {
    return {
      id: uid(),
      question_type: 'SHORT_ANSWER',
      prompt: 'Giải thích ngắn gọn cách làm của em:',
      options: [],
      answer_key: { keywords: [], sample_answer: '' },
      points: 1,
      explanation: '',
    };
  }
  return {
    id: uid(),
    question_type: 'SINGLE_CHOICE',
    prompt: 'Nhập nội dung câu hỏi…',
    options: [
      { id: 'opt_a', text: 'Phương án A', is_correct: true },
      { id: 'opt_b', text: 'Phương án B', is_correct: false },
      { id: 'opt_c', text: 'Phương án C', is_correct: false },
    ],
    answer_key: { correct_option_ids: ['opt_a'] },
    points: 1,
    explanation: '',
  };
}

export const QuestionForm: React.FC<{
  value: QuestionSpec;
  onChange: (next: QuestionSpec) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const qType = value.question_type || 'SINGLE_CHOICE';
  const options = value.options || [];
  const answerKey = value.answer_key || {};

  const handleTypeChange = (nextType: QuestionType) => {
    if (nextType === qType) return;
    const base = createDefaultQuestionSpec(nextType);
    onChange({
      ...base,
      id: value.id || base.id,
      prompt: value.prompt || base.prompt,
      points: value.points ?? 1,
      explanation: value.explanation || '',
      correct_feedback: value.correct_feedback || '',
      wrong_feedback: value.wrong_feedback || '',
    });
  };

  const syncChoiceOptions = (nextOptions: QuestionOptionSpec[], singleMode: boolean) => {
    let ensured = nextOptions;
    if (singleMode && ensured.filter((o) => o.is_correct).length === 0 && ensured.length > 0) {
      ensured = ensured.map((o, idx) => ({ ...o, is_correct: idx === 0 }));
    }
    const correctIds = ensured.filter((o) => o.is_correct).map((o) => o.id);
    onChange({
      ...value,
      options: ensured,
      answer_key: {
        ...answerKey,
        correct_option_ids: correctIds,
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="t-form-grid">
        <Field label="Loại câu hỏi">
          <select
            className="t-input"
            value={qType}
            disabled={disabled}
            onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
          >
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Điểm số câu hỏi">
          <input
            type="number"
            min={0.5}
            max={100}
            step={0.5}
            className="t-input tabular-nums"
            value={value.points ?? 1}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, points: Math.max(0.5, Number(e.target.value) || 1) })}
          />
        </Field>
      </div>

      <Field label="Nội dung câu hỏi" required>
        <textarea
          className="t-input"
          rows={2}
          value={value.prompt || ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          placeholder="Nhập câu hỏi rõ ràng, ngắn gọn cho học viên…"
        />
      </Field>

      {(qType === 'SINGLE_CHOICE' || qType === 'MULTIPLE_CHOICE') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="t-field__label">
            Các phương án trả lời ({qType === 'SINGLE_CHOICE' ? 'chọn 1 đáp án đúng' : 'chọn 1 hoặc nhiều đáp án đúng'})
          </span>
          {options.map((opt, idx) => {
            const isCorrect =
              Boolean(opt.is_correct) || Boolean(answerKey.correct_option_ids?.includes(opt.id));
            return (
              <div key={opt.id} className="ls-option-editor-row">
                <button
                  type="button"
                  className={`t-btn t-btn--small ${isCorrect ? 't-btn--primary' : 't-btn--quiet'}`}
                  disabled={disabled}
                  aria-pressed={isCorrect}
                  onClick={() => {
                    if (qType === 'SINGLE_CHOICE') {
                      syncChoiceOptions(
                        options.map((o) => ({ ...o, is_correct: o.id === opt.id })),
                        true
                      );
                    } else {
                      syncChoiceOptions(
                        options.map((o) => (o.id === opt.id ? { ...o, is_correct: !isCorrect } : o)),
                        false
                      );
                    }
                  }}
                >
                  {isCorrect ? '✓ Đúng' : 'Đặt đúng'}
                </button>
                <input
                  className="t-input"
                  style={{ flex: '1 1 180px', minWidth: 0 }}
                  value={opt.text}
                  disabled={disabled}
                  placeholder={`Phương án ${idx + 1}…`}
                  aria-label={`Nội dung phương án ${idx + 1}`}
                  onChange={(e) =>
                    syncChoiceOptions(
                      options.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)),
                      qType === 'SINGLE_CHOICE'
                    )
                  }
                />
                <button
                  type="button"
                  className="t-icon-btn"
                  disabled={disabled || options.length <= 2}
                  aria-label={`Xóa phương án ${idx + 1}`}
                  onClick={() =>
                    syncChoiceOptions(
                      options.filter((o) => o.id !== opt.id),
                      qType === 'SINGLE_CHOICE'
                    )
                  }
                >
                  ✕
                </button>
              </div>
            );
          })}
          {!disabled && options.length < 8 && (
            <div>
              <Btn
                small
                variant="quiet"
                onClick={() => {
                  const nextId = `opt_${Date.now().toString(36)}_${options.length + 1}`;
                  syncChoiceOptions(
                    [...options, { id: nextId, text: `Phương án ${options.length + 1}`, is_correct: false }],
                    qType === 'SINGLE_CHOICE'
                  );
                }}
              >
                + Thêm phương án
              </Btn>
            </div>
          )}
        </div>
      )}

      {qType === 'TRUE_FALSE' && (
        <Field label="Đáp án đúng">
          <div className="t-actions">
            {[
              { id: 'true', label: 'Đúng', boolVal: true },
              { id: 'false', label: 'Sai', boolVal: false },
            ].map((choice) => {
              const active =
                answerKey.boolean_answer === choice.boolVal ||
                answerKey.correct_option_ids?.includes(choice.id) ||
                options.find((o) => o.id === choice.id)?.is_correct;
              return (
                <Btn
                  key={choice.id}
                  variant={active ? 'primary' : 'quiet'}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      options: [
                        { id: 'true', text: 'Đúng', is_correct: choice.boolVal },
                        { id: 'false', text: 'Sai', is_correct: !choice.boolVal },
                      ],
                      answer_key: {
                        ...answerKey,
                        correct_option_ids: [choice.id],
                        boolean_answer: choice.boolVal,
                      },
                    })
                  }
                >
                  {active ? '✓ ' : ''}
                  {choice.label}
                </Btn>
              );
            })}
          </div>
        </Field>
      )}

      {qType === 'FILL_BLANK' && (
        <>
          <Field
            label="Các đáp án chấp nhận (mỗi dòng một cách viết đúng)"
            hint="Ví dụ: 3/4, 0.75 và 0,75 đều được tính đúng nếu liệt kê trên từng dòng."
          >
            <textarea
              className="t-input"
              rows={3}
              disabled={disabled}
              value={(answerKey.accepted_texts || []).join('\n')}
              onChange={(e) =>
                onChange({
                  ...value,
                  answer_key: {
                    ...answerKey,
                    accepted_texts: e.target.value
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder={'0,75\n0.75\n3/4'}
            />
          </Field>
          <label className="ls-check-row">
            <input
              type="checkbox"
              disabled={disabled}
              checked={Boolean(answerKey.case_sensitive)}
              onChange={(e) =>
                onChange({
                  ...value,
                  answer_key: { ...answerKey, case_sensitive: e.target.checked },
                })
              }
            />
            <span>Phân biệt chữ hoa và chữ thường</span>
          </label>
        </>
      )}

      {qType === 'SHORT_ANSWER' && (
        <div className="t-form-grid">
          <Field
            label="Từ khóa trọng tâm để chấm gợi ý (cách nhau bởi dấu phẩy)"
            hint="Để trống nếu chỉ thu thập câu trả lời tự do."
          >
            <input
              className="t-input"
              disabled={disabled}
              value={(answerKey.keywords || []).join(', ')}
              onChange={(e) =>
                onChange({
                  ...value,
                  answer_key: {
                    ...answerKey,
                    keywords: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="Ví dụ: mẫu số chung, quy đồng"
            />
          </Field>
          <Field label="Đáp án mẫu tham khảo">
            <input
              className="t-input"
              disabled={disabled}
              value={answerKey.sample_answer || ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  answer_key: { ...answerKey, sample_answer: e.target.value },
                })
              }
              placeholder="Gợi ý trình bày chuẩn cho học viên…"
            />
          </Field>
        </div>
      )}

      <Field label="Giải thích chi tiết (hiển thị sau khi học viên nộp bài)">
        <textarea
          className="t-input"
          rows={2}
          disabled={disabled}
          value={value.explanation || ''}
          onChange={(e) => onChange({ ...value, explanation: e.target.value })}
          placeholder="Giải thích ngắn gọn vì sao đáp án này đúng…"
        />
      </Field>
    </div>
  );
};

// ------------------------------------------------------------------ Question Bank Modal

export const QuestionBankModal: React.FC<{
  courseId: string;
  canEdit: boolean;
  onPickQuestion?: (item: QuestionBankItem) => void;
  onClose: () => void;
}> = ({ courseId, canEdit, onPickQuestion, onClose }) => {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const debouncedQ = useDebounced(search, 250);

  const bankReq = useAsync(
    () =>
      teachingApi.questionBank(courseId, {
        q: debouncedQ || undefined,
        question_type: (filterType as QuestionType) || undefined,
      }),
    [courseId, debouncedQ, filterType]
  );

  const [editingItem, setEditingItem] = useState<Partial<QuestionBankItem> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionBankItem | null>(null);

  const startCreate = () => {
    const spec = createDefaultQuestionSpec('SINGLE_CHOICE');
    setFormErr(null);
    setEditingItem({
      ...spec,
      difficulty: 'MEDIUM',
      tags: [],
    });
  };

  const handleSaveBankItem = async () => {
    if (!editingItem) return;
    if (!String(editingItem.prompt || '').trim()) {
      setFormErr('Vui lòng nhập nội dung câu hỏi.');
      return;
    }
    setSaving(true);
    setFormErr(null);
    try {
      if (editingItem.id && bankReq.data?.items.some((x) => x.id === editingItem.id)) {
        await teachingApi.updateQuestionBankItem(editingItem.id, editingItem);
        toast({ tone: 'success', title: 'Đã cập nhật câu hỏi trong ngân hàng' });
      } else {
        await teachingApi.createQuestionBankItem(courseId, editingItem);
        toast({ tone: 'success', title: 'Đã lưu câu hỏi mới vào ngân hàng' });
      }
      setEditingItem(null);
      bankReq.reload();
    } catch (e) {
      setFormErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={onPickQuestion ? 'Chọn câu hỏi từ Ngân hàng câu hỏi' : 'Ngân hàng câu hỏi của khóa học'}
      onClose={onClose}
      width={840}
      footer={
        editingItem ? (
          <>
            <Btn variant="ghost" onClick={() => setEditingItem(null)} disabled={saving}>
              Quay lại danh sách
            </Btn>
            <Btn variant="primary" onClick={handleSaveBankItem} loading={saving}>
              Lưu vào ngân hàng
            </Btn>
          </>
        ) : (
          <Btn onClick={onClose}>Đóng</Btn>
        )
      }
    >
      {editingItem ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="t-form-grid">
            <Field label="Mức độ nhận thức">
              <select
                className="t-input"
                value={editingItem.difficulty || 'MEDIUM'}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD',
                  })
                }
              >
                <option value="EASY">Cơ bản</option>
                <option value="MEDIUM">Vận dụng</option>
                <option value="HARD">Nâng cao</option>
              </select>
            </Field>
            <Field label="Nhãn chủ đề (cách nhau bởi dấu phẩy)">
              <input
                className="t-input"
                value={(editingItem.tags || []).join(', ')}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Ví dụ: phân số, hỗn số, ôn tập"
              />
            </Field>
          </div>

          <QuestionForm
            value={editingItem as QuestionSpec}
            onChange={(spec) => setEditingItem({ ...editingItem, ...spec })}
          />

          {formErr && (
            <p className="t-field__error" role="alert">
              {formErr}
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="t-toolbar">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Tìm theo nội dung câu hỏi…"
              label="Tìm câu hỏi trong ngân hàng"
            />
            <select
              className="t-input"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              aria-label="Lọc theo loại câu hỏi"
            >
              <option value="">Tất cả loại câu hỏi</option>
              {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {(canEdit || bankReq.data?.can_edit) && (
              <Btn variant="primary" onClick={startCreate}>
                + Tạo câu hỏi mới
              </Btn>
            )}
          </div>

          {bankReq.loading && <Loading rows={3} />}
          {bankReq.error && <ErrorState error={bankReq.error} onRetry={bankReq.reload} />}

          {!bankReq.loading && !bankReq.error && (
            (bankReq.data?.items.length || 0) === 0 ? (
              <EmptyState
                title="Chưa có câu hỏi phù hợp"
                text="Tạo câu hỏi trong ngân hàng để tái sử dụng nhanh cho nhiều bài học và mốc tương tác trên video."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(bankReq.data?.items || []).map((item) => (
                  <div key={item.id} className="ls-bank-card">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Tone tone="info">{QUESTION_TYPE_LABELS[item.question_type] || item.question_type}</Tone>
                        <Tone
                          tone={
                            item.difficulty === 'HARD'
                              ? 'warning'
                              : item.difficulty === 'EASY'
                              ? 'success'
                              : 'neutral'
                          }
                        >
                          {DIFFICULTY_LABELS[item.difficulty] || 'Vận dụng'}
                        </Tone>
                        <span className="t-sub tabular-nums">{item.points || 1} điểm</span>
                      </div>
                      <strong style={{ fontSize: 15 }}>{item.prompt}</strong>
                      {item.tags?.length > 0 && (
                        <span className="t-sub">Chủ đề: {item.tags.join(' · ')}</span>
                      )}
                    </div>
                    <div className="t-actions">
                      {onPickQuestion && (
                        <Btn
                          small
                          variant="primary"
                          onClick={() => {
                            onPickQuestion(item);
                            onClose();
                          }}
                        >
                          Chèn câu hỏi này
                        </Btn>
                      )}
                      {(canEdit || bankReq.data?.can_edit) && (
                        <>
                          <Btn small variant="ghost" onClick={() => setEditingItem({ ...item })}>
                            Sửa
                          </Btn>
                          <Btn small variant="danger" onClick={() => setDeleteTarget(item)}>
                            Xóa
                          </Btn>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Xóa câu hỏi khỏi ngân hàng?"
          message="Các bài học đã xuất bản trước đó vẫn giữ nguyên bản sao câu hỏi, nhưng bạn sẽ không còn chọn lại câu hỏi này cho bài mới."
          confirmLabel="Xóa câu hỏi"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            try {
              await teachingApi.deleteQuestionBankItem(deleteTarget.id);
              setDeleteTarget(null);
              toast({ tone: 'success', title: 'Đã xóa câu hỏi khỏi ngân hàng' });
              bankReq.reload();
            } catch (err) {
              toast({ tone: 'error', title: 'Không xóa được câu hỏi', detail: errMsg(err) });
            }
          }}
        />
      )}
    </Modal>
  );
};
