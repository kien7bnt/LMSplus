/**
 * Trang Bài kiểm tra (Exams với đồng hồ đếm ngược, lưu nháp tự động) & Bài tập (Assignments) cho Học viên.
 * Có thể dùng độc lập (/learn/exams, /learn/assignments) hoặc nhúng trong Không gian Lớp môn học (prop classId).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  QuestionType,
  StudentAssignmentItem,
  StudentExamItem,
  masterApi,
} from '../api';
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Tone,
  errMsg,
  fmtDateTime,
  useAsync,
  useToast,
} from '../ui';

interface ActiveExamSession {
  exam: { id: string; title: string; time_limit_minutes: number };
  attemptId: string;
  attemptNumber: number;
  questions: Array<{ id: string; question_type: QuestionType; prompt: string; points: number; options: Array<{ id: string; text: string }> }>;
  answers: Record<string, Record<string, unknown>>;
  remainingSec: number;
  submittedResult: {
    grading_status: string;
    auto_score: number;
    manual_score: number;
    total_score: number;
    max_score: number;
    teacher_feedback?: string;
    questions?: Array<{
      id: string;
      prompt: string;
      points: number;
      grade?: { is_correct: boolean; earned_points: number; max_points: number; feedback: string; grading_status: string };
    }>;
  } | null;
}

function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const StudentExamsPage: React.FC<{ classId?: string }> = ({ classId }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const res = useAsync(() => masterApi.listStudentExams({ class_id: classId }), [classId]);
  const [runner, setRunner] = useState<ActiveExamSession | null>(null);
  const [busy, setBusy] = useState(false);

  const startOrResume = async (examItem: StudentExamItem) => {
    setBusy(true);
    try {
      const started = await masterApi.startStudentExam(examItem.id);
      const initialAnswers: Record<string, Record<string, unknown>> = { ...(started.attempt.answers || {}) };
      setRunner({
        exam: { id: started.exam.id, title: started.exam.title, time_limit_minutes: started.exam.time_limit_minutes },
        attemptId: started.attempt.id,
        attemptNumber: started.attempt.attempt_number,
        questions: started.attempt.questions || [],
        answers: initialAnswers,
        remainingSec: started.attempt.remaining_seconds ?? started.exam.time_limit_minutes * 60,
        submittedResult: null,
      });
    } catch (ex) {
      push('Không thể bắt đầu bài kiểm tra', errMsg(ex), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAttempt = useCallback(
    async (session: ActiveExamSession) => {
      setBusy(true);
      try {
        const result = await masterApi.submitStudentExamAttempt(session.attemptId, session.answers);
        setRunner((prev) =>
          prev && prev.attemptId === session.attemptId
            ? { ...prev, submittedResult: result.attempt }
            : prev
        );
        push('Đã nộp bài kiểm tra thành công', '', 'success');
        res.reload();
      } catch (ex) {
        push('Không nộp được bài kiểm tra', errMsg(ex), 'error');
      } finally {
        setBusy(false);
      }
    },
    [push, res]
  );

  // Bộ đếm ngược thời gian làm bài
  useEffect(() => {
    if (!runner || runner.submittedResult) return;
    const timer = window.setInterval(() => {
      setRunner((prev) => {
        if (!prev || prev.submittedResult) return prev;
        if (prev.remainingSec <= 1) {
          void handleSubmitAttempt(prev);
          return { ...prev, remainingSec: 0 };
        }
        return { ...prev, remainingSec: prev.remainingSec - 1 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runner?.attemptId, runner?.submittedResult, handleSubmitAttempt]);

  const setAnswer = (questionId: string, val: Record<string, unknown>) => {
    setRunner((prev) => (prev ? { ...prev, answers: { ...prev.answers, [questionId]: val } } : prev));
  };

  const saveDraft = async () => {
    if (!runner || runner.submittedResult) return;
    try {
      await masterApi.saveStudentExamAttempt(runner.attemptId, runner.answers);
      push('Đã lưu tạm bài làm', '', 'info');
    } catch (ex) {
      push('Lưu tạm thất bại', errMsg(ex), 'error');
    }
  };

  const mainBody = (
    <>
      {res.loading && <Loading rows={3} />}
      {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
      {res.data && res.data.items.length === 0 && (
        <EmptyState title="Chưa có bài kiểm tra nào" text="Khi giảng viên mở bài kiểm tra cho lớp môn học, đề thi sẽ hiển thị tại đây." />
      )}
      {res.data && res.data.items.length > 0 && (
        <div className="t-list">
          {res.data.items.map((ex) => (
            <Card
              key={ex.id}
              title={
                <span className="t-title-inline">
                  {ex.title} <Badge kind="examStatus" value={ex.status} />
                </span>
              }
              actions={
                ex.can_start && (
                  <Btn small variant="primary" loading={busy} onClick={() => startOrResume(ex)}>
                    {ex.in_progress_attempt_id ? 'Tiếp tục làm bài' : ex.attempts_used > 0 ? 'Làm lại lượt mới' : 'Bắt đầu làm bài'}
                  </Btn>
                )
              }
            >
              <div className="t-small t-muted" style={{ marginBottom: 8 }}>
                <code>{ex.class_code}</code> · {ex.class_title} · {ex.question_count} câu ({ex.total_points} điểm) · Thời gian: <strong className="tabular-nums">{ex.time_limit_minutes} phút</strong> · Tối đa <strong className="tabular-nums">{ex.attempts_used}/{ex.max_attempts}</strong> lượt
                {ex.close_at && <> · Hạn đóng: {fmtDateTime(ex.close_at)}</>}
              </div>
              {ex.description && <p className="m-measure" style={{ margin: '0 0 8px' }}>{ex.description}</p>}
              {ex.effective_score !== null && (
                <div className="m-semantic-notice m-semantic-notice--success">
                  Điểm chính thức ({ex.scoring_policy}): <strong className="tabular-nums">{ex.effective_score}/{ex.total_points}</strong> (<span className="tabular-nums">{ex.effective_pct}%</span>) · {ex.passed ? 'Đạt' : 'Chưa đạt'}
                </div>
              )}
              {ex.attempts.length > 0 && (
                <div className="t-table-wrap" style={{ marginTop: 12 }}>
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Lượt</th>
                        <th>Trạng thái</th>
                        <th>Điểm tự động</th>
                        <th>Điểm tự luận</th>
                        <th>Tổng điểm</th>
                        <th>Nộp lúc</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.attempts.map((a) => (
                        <tr key={a.id}>
                          <td className="tabular-nums">#{a.attempt_number}</td>
                          <td><Badge kind="gradingStatus" value={a.grading_status} /></td>
                          <td className="tabular-nums">{a.auto_score}</td>
                          <td className="tabular-nums">{a.manual_score}</td>
                          <td className="tabular-nums"><strong>{a.total_score}/{a.max_score}</strong></td>
                          <td className="tabular-nums">{fmtDateTime(a.submitted_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {runner && (
        <Modal
          title={`${runner.exam.title} (Lượt #${runner.attemptNumber})`}
          width={820}
          onClose={() => { if (!busy) setRunner(null); }}
          footer={
            runner.submittedResult ? (
              <Btn variant="primary" onClick={() => setRunner(null)}>Đóng kết quả</Btn>
            ) : (
              <>
                <div className="m-timer-pill" aria-live="polite" style={{ marginRight: 'auto' }}>
                  Còn lại: {formatCountdown(runner.remainingSec)}
                </div>
                <Btn onClick={saveDraft} disabled={busy}>Lưu tạm bài làm</Btn>
                <Btn variant="primary" loading={busy} onClick={() => handleSubmitAttempt(runner)}>Nộp bài kiểm tra</Btn>
              </>
            )
          }
        >
          {runner.submittedResult ? (
            <div>
              <div className="m-semantic-notice m-semantic-notice--success" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Kết quả lượt làm #{runner.attemptNumber}</strong>
                  <Badge kind="gradingStatus" value={runner.submittedResult.grading_status} />
                </div>
                <div style={{ marginTop: 6 }} className="tabular-nums">
                  Tổng điểm hiện tại: <strong>{runner.submittedResult.total_score}/{runner.submittedResult.max_score}</strong> (Tự động: {runner.submittedResult.auto_score}, Tự luận: {runner.submittedResult.manual_score})
                </div>
                {runner.submittedResult.teacher_feedback && (
                  <div style={{ marginTop: 6 }}>Nhận xét: {runner.submittedResult.teacher_feedback}</div>
                )}
              </div>
              {runner.submittedResult.questions?.map((q, idx) => (
                <div key={q.id} className="ls-block-surface" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>Câu {idx + 1}: {q.prompt}</strong>
                    {q.grade && (
                      <Tone tone={q.grade.grading_status === 'PENDING_REVIEW' ? 'warning' : q.grade.is_correct ? 'success' : 'danger'}>
                        {q.grade.earned_points}/{q.grade.max_points} điểm
                      </Tone>
                    )}
                  </div>
                  {q.grade?.feedback && <div className="t-small t-muted" style={{ marginTop: 4 }}>{q.grade.feedback}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="t-list">
              {runner.questions.map((q, idx) => {
                const ans = runner.answers[q.id] || {};
                const selectedIds = Array.isArray(ans.selected_option_ids)
                  ? (ans.selected_option_ids as string[])
                  : typeof ans.selected_option_id === 'string'
                    ? [ans.selected_option_id]
                    : [];

                return (
                  <div key={q.id} className="ls-block-surface">
                    <div style={{ marginBottom: 8 }}>
                      <strong>Câu {idx + 1}</strong> <span className="t-muted t-small tabular-nums">({q.points} điểm)</span>
                      <div className="m-measure" style={{ marginTop: 4 }}>{q.prompt}</div>
                    </div>

                    {q.question_type === 'SINGLE_CHOICE' && (
                      <div className="t-list">
                        {q.options.map((opt) => (
                          <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name={`q_${q.id}`}
                              checked={ans.selected_option_id === opt.id}
                              onChange={() => setAnswer(q.id, { selected_option_id: opt.id })}
                            />
                            <span>{opt.text}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {q.question_type === 'MULTIPLE_CHOICE' && (
                      <div className="t-list">
                        {q.options.map((opt) => {
                          const checked = selectedIds.includes(opt.id);
                          return (
                            <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked ? selectedIds.filter((id) => id !== opt.id) : [...selectedIds, opt.id];
                                  setAnswer(q.id, { selected_option_ids: next });
                                }}
                              />
                              <span>{opt.text}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {q.question_type === 'TRUE_FALSE' && (
                      <div className="t-actions">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
                          <input type="radio" name={`tf_${q.id}`} checked={ans.boolean_answer === true} onChange={() => setAnswer(q.id, { boolean_answer: true })} />
                          Đúng
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
                          <input type="radio" name={`tf_${q.id}`} checked={ans.boolean_answer === false} onChange={() => setAnswer(q.id, { boolean_answer: false })} />
                          Sai
                        </label>
                      </div>
                    )}

                    {(q.question_type === 'FILL_BLANK' || q.question_type === 'SHORT_ANSWER') && (
                      <textarea
                        className="t-input"
                        rows={q.question_type === 'SHORT_ANSWER' ? 4 : 2}
                        value={typeof ans.text === 'string' ? ans.text : ''}
                        onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                        placeholder="Nhập câu trả lời của bạn…"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </>
  );

  if (classId) return mainBody;

  return (
    <div className="t-page">
      <PageHeader
        title="Bài kiểm tra & Đánh giá"
        subtitle="Danh sách bài kiểm tra chính thức từ các lớp môn học bạn đang tham gia."
      />
      {mainBody}
    </div>
  );
};

export const StudentAssignmentsPage: React.FC<{ classId?: string }> = ({ classId }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const res = useAsync(() => masterApi.listStudentAssignments({ class_id: classId }), [classId]);
  const [editing, setEditing] = useState<StudentAssignmentItem | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionLink, setSubmissionLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openEditor = (item: StudentAssignmentItem) => {
    setEditing(item);
    setSubmissionText(item.latest_submission?.status === 'DRAFT' ? item.latest_submission.submission_text || '' : '');
    setSubmissionLink(item.latest_submission?.status === 'DRAFT' ? item.latest_submission.submission_link || '' : '');
    setErr(null);
  };

  const handleSave = async (submitNow: boolean) => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    const body = {
      submission_text: submissionText,
      submission_link: submissionLink,
      attachments: submissionLink.trim() ? [{ title: 'Tài liệu đính kèm', url: submissionLink.trim() }] : [],
    };
    try {
      if (submitNow) {
        await masterApi.submitStudentAssignment(editing.id, body);
        push('Đã nộp bài tập thành công', '', 'success');
      } else {
        await masterApi.saveStudentAssignmentDraft(editing.id, body);
        push('Đã lưu bản nháp bài tập', '', 'info');
      }
      setEditing(null);
      res.reload();
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      {res.loading && <Loading rows={3} />}
      {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
      {res.data && res.data.items.length === 0 && (
        <EmptyState title="Chưa có bài tập nào được giao" text="Khi giảng viên giao bài tập mới cho lớp môn học, bài tập sẽ hiển thị tại đây." />
      )}
      {res.data && res.data.items.length > 0 && (
        <div className="t-list">
          {res.data.items.map((a) => (
            <Card
              key={a.id}
              title={
                <span className="t-title-inline">
                  {a.title}
                  {a.latest_submission ? (
                    <Badge kind="gradingStatus" value={a.latest_submission.status} />
                  ) : (
                    <Tone tone={a.is_overdue ? 'danger' : 'warning'}>{a.is_overdue ? 'Quá hạn nộp' : 'Chưa nộp'}</Tone>
                  )}
                </span>
              }
              actions={
                a.can_submit && (
                  <Btn small variant="primary" onClick={() => openEditor(a)}>
                    {a.latest_submission?.status === 'DRAFT' ? 'Sửa bản nháp & Nộp' : a.submitted_count > 0 ? 'Nộp lại bài' : 'Làm & Nộp bài'}
                  </Btn>
                )
              }
            >
              <div className="t-small t-muted" style={{ marginBottom: 8 }}>
                <code>{a.class_code}</code> · {a.class_title} · Hình thức: {a.submission_type} · Thang điểm: <strong className="tabular-nums">{a.max_score}</strong> · Đã nộp <strong className="tabular-nums">{a.submitted_count}/{a.max_attempts}</strong> lần
                {a.due_at && <> · Hạn nộp: {fmtDateTime(a.due_at)}</>}
              </div>
              <p className="m-measure" style={{ whiteSpace: 'pre-wrap' }}>{a.instructions}</p>

              {a.latest_submission && a.latest_submission.status !== 'DRAFT' && (
                <div className="m-semantic-notice" style={{ marginTop: 12 }}>
                  <div>
                    <strong>Bài nộp lần #{a.latest_submission.attempt_number}</strong> ({fmtDateTime(a.latest_submission.submitted_at)})
                    {a.latest_submission.score !== null && (
                      <> · Điểm đạt: <strong className="tabular-nums">{a.latest_submission.score}/{a.max_score}</strong></>
                    )}
                  </div>
                  {a.latest_submission.teacher_feedback && (
                    <div className="t-small" style={{ marginTop: 4 }}>Nhận xét giảng viên: {a.latest_submission.teacher_feedback}</div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={`Nộp bài tập: ${editing.title}`}
          onClose={() => setEditing(null)}
          width={680}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Hủy</Btn>
              <Btn onClick={() => handleSave(false)} disabled={busy}>Lưu nháp</Btn>
              <Btn variant="primary" loading={busy} onClick={() => handleSave(true)}>Nộp bài chính thức</Btn>
            </>
          }
        >
          <div className="t-form-grid">
            <Field label="Nội dung bài làm" wide>
              <textarea className="t-input" rows={6} value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} placeholder="Trình bày bài làm hoặc ghi chú cho giảng viên…" />
            </Field>
            <Field label="Liên kết bài nộp / Google Docs / GitHub (https://...)" wide>
              <input type="url" className="t-input" value={submissionLink} onChange={(e) => setSubmissionLink(e.target.value)} placeholder="https://..." />
            </Field>
            {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
          </div>
        </Modal>
      )}
    </>
  );

  if (classId) return body;

  return (
    <div className="t-page">
      <PageHeader
        title="Bài tập được giao"
        subtitle="Quản lý bài tập về nhà, lưu bản nháp, nộp bài trực tuyến và xem nhận xét chấm điểm."
      />
      {body}
    </div>
  );
};
