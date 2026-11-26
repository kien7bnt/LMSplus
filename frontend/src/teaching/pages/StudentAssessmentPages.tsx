/**
 * Trang Bài kiểm tra (Exams với đồng hồ đếm ngược, lưu nháp tự động) & Bài tập (Assignments) cho Học viên.
 * Có thể dùng độc lập (/learn/exams, /learn/assignments) hoặc nhúng trong Không gian Lớp môn học (prop classId).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GradeAppealItem,
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
  label,
  useAsync,
  useToast,
} from '../ui';

const readFileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Không đọc được tệp đã chọn.'));
    r.readAsDataURL(file);
  });

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
  const push = useCallback(
    (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone }),
    [toast]
  );
  const res = useAsync(() => masterApi.listStudentExams({ class_id: classId }), [classId]);
  const appealsReq = useAsync(() => masterApi.listStudentAppeals({ class_id: classId }), [classId]);
  const [runner, setRunner] = useState<ActiveExamSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [appealTarget, setAppealTarget] = useState<{
    target_type: 'EXAM';
    attempt_id: string;
    title: string;
    current_score: number;
    max_score: number;
  } | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [appealReqScore, setAppealReqScore] = useState('');

  const startOrResume = async (examItem: StudentExamItem) => {
    setBusy(true);
    try {
      const started = await masterApi.startStudentExam(examItem.id);
      const initialAnswers = (started.attempt.answers || {}) as Record<string, Record<string, unknown>>;
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

  const submitAttemptRef = useRef(handleSubmitAttempt);
  submitAttemptRef.current = handleSubmitAttempt;
  const hasSubmitted = Boolean(runner?.submittedResult);

  // Bộ đếm ngược thời gian làm bài (chỉ khởi tạo 1 interval theo attemptId, không reset mỗi giây)
  useEffect(() => {
    if (!runner?.attemptId || hasSubmitted) return undefined;
    const timer = window.setInterval(() => {
      setRunner((prev) => {
        if (!prev || prev.submittedResult) return prev;
        if (prev.remainingSec <= 1) {
          void submitAttemptRef.current(prev);
          return { ...prev, remainingSec: 0 };
        }
        return { ...prev, remainingSec: prev.remainingSec - 1 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runner?.attemptId, hasSubmitted]);

  const submitExamAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealTarget) return;
    setBusy(true);
    try {
      await masterApi.createGradeAppeal({
        target_type: 'EXAM',
        submission_or_attempt_id: appealTarget.attempt_id,
        reason: appealReason.trim(),
        requested_score: appealReqScore.trim() ? Number(appealReqScore) : undefined,
      });
      toast({ tone: 'success', title: 'Đã gửi đơn phúc khảo bài kiểm tra' });
      setAppealTarget(null);
      setAppealReason('');
      setAppealReqScore('');
      appealsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không gửi được đơn phúc khảo', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const appealByAttempt = new Map<string, GradeAppealItem>();
  for (const ap of appealsReq.data?.items || []) {
    if (ap.target_type === 'EXAM' && !appealByAttempt.has(ap.submission_or_attempt_id)) {
      appealByAttempt.set(ap.submission_or_attempt_id, ap);
    }
  }

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
                        <th className="actions">Phúc khảo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.attempts.map((a) => {
                        const attAppeal = appealByAttempt.get(a.id);
                        return (
                          <tr key={a.id}>
                            <td className="tabular-nums">#{a.attempt_number}</td>
                            <td><Badge kind="gradingStatus" value={a.grading_status} /></td>
                            <td className="tabular-nums">{a.auto_score}</td>
                            <td className="tabular-nums">{a.manual_score}</td>
                            <td className="tabular-nums"><strong>{a.total_score}/{a.max_score}</strong></td>
                            <td className="tabular-nums">{fmtDateTime(a.submitted_at)}</td>
                            <td className="actions">
                              {attAppeal ? (
                                <Badge kind="appealStatus" value={attAppeal.status} />
                              ) : a.submitted_at ? (
                                <Btn
                                  small
                                  onClick={() => {
                                    setAppealTarget({
                                      target_type: 'EXAM',
                                      attempt_id: a.id,
                                      title: `${ex.title} (#${a.attempt_number})`,
                                      current_score: a.total_score,
                                      max_score: a.max_score,
                                    });
                                    setAppealReason('');
                                    setAppealReqScore(String(a.total_score));
                                  }}
                                >
                                  Phúc khảo
                                </Btn>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
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

      {appealTarget && (
        <Modal
          title={`Gửi đơn phúc khảo: ${appealTarget.title}`}
          onClose={() => setAppealTarget(null)}
          width={560}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setAppealTarget(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="exam-appeal-form" loading={busy}>Gửi phúc khảo</Btn>
            </>
          }
        >
          <form id="exam-appeal-form" className="t-form-grid" onSubmit={submitExamAppeal}>
            <Field label={`Điểm đề nghị xem xét lại (hiện tại ${appealTarget.current_score}/${appealTarget.max_score})`} wide>
              <input
                type="number"
                step="0.5"
                min={0}
                max={appealTarget.max_score}
                className="t-input tabular-nums"
                value={appealReqScore}
                onChange={(e) => setAppealReqScore(e.target.value)}
              />
            </Field>
            <Field label="Lý do đề nghị phúc khảo" required wide>
              <textarea
                className="t-input"
                rows={4}
                required
                minLength={5}
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Trình bày rõ câu hỏi hoặc phần tự luận cần chấm phúc khảo…"
              />
            </Field>
          </form>
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
  const appealsReq = useAsync(() => masterApi.listStudentAppeals({ class_id: classId }), [classId]);
  const [editing, setEditing] = useState<StudentAssignmentItem | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionLink, setSubmissionLink] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ title?: string; name?: string; file_name?: string; url: string; mime_type?: string; size_bytes?: number }>>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [appealTarget, setAppealTarget] = useState<{
    submission_id: string;
    title: string;
    current_score: number | null;
    max_score: number;
  } | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [appealReqScore, setAppealReqScore] = useState('');

  const openEditor = (item: StudentAssignmentItem) => {
    setEditing(item);
    const draft = item.latest_submission?.status === 'DRAFT' ? item.latest_submission : null;
    setSubmissionText(draft?.submission_text || '');
    setSubmissionLink(draft?.submission_link || '');
    setUploadedFiles(Array.isArray(draft?.attachments) ? draft!.attachments.filter((f) => f.url && !f.url.includes('https://') ? true : f.file_name !== undefined) : []);
    setErr(null);
  };

  const handleFileChosen = async (file: File) => {
    if (!editing) return;
    setUploadingFile(true);
    setErr(null);
    try {
      const b64 = await readFileAsBase64(file);
      const saved = await masterApi.uploadAssignmentFile(editing.id, {
        file_name: file.name,
        mime_type: file.type,
        content_base64: b64,
      });
      setUploadedFiles((prev) => [...prev, saved]);
      push('Đã tải lên tệp bài làm', saved.file_name || file.name, 'success');
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSave = async (submitNow: boolean) => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    const mergedAttachments = [
      ...uploadedFiles.map((f) => ({ title: f.file_name || f.name || f.title || 'Tệp đính kèm', name: f.file_name || f.name, file_name: f.file_name, url: f.url })),
      ...(submissionLink.trim() ? [{ title: 'Liên kết bài làm', url: submissionLink.trim() }] : []),
    ];
    const body = {
      submission_text: submissionText,
      submission_link: submissionLink,
      attachments: mergedAttachments,
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

  const submitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealTarget) return;
    setBusy(true);
    try {
      await masterApi.createGradeAppeal({
        target_type: 'ASSIGNMENT',
        submission_or_attempt_id: appealTarget.submission_id,
        reason: appealReason.trim(),
        requested_score: appealReqScore.trim() ? Number(appealReqScore) : undefined,
      });
      push('Đã gửi đơn phúc khảo điểm bài tập', '', 'success');
      setAppealTarget(null);
      setAppealReason('');
      setAppealReqScore('');
      appealsReq.reload();
    } catch (ex) {
      push('Không gửi được đơn phúc khảo', errMsg(ex), 'error');
    } finally {
      setBusy(false);
    }
  };

  const appealBySubmission = new Map<string, GradeAppealItem>();
  for (const ap of appealsReq.data?.items || []) {
    if (ap.target_type === 'ASSIGNMENT' && !appealBySubmission.has(ap.submission_or_attempt_id)) {
      appealBySubmission.set(ap.submission_or_attempt_id, ap);
    }
  }

  const body = (
    <>
      {res.loading && <Loading rows={3} />}
      {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
      {res.data && res.data.items.length === 0 && (
        <EmptyState title="Chưa có bài tập nào được giao" text="Khi giảng viên giao bài tập mới cho lớp môn học, bài tập sẽ hiển thị tại đây." />
      )}
      {res.data && res.data.items.length > 0 && (
        <div className="t-list">
          {res.data.items.map((a) => {
            const sub = a.latest_submission;
            const subAppeal = sub ? appealBySubmission.get(sub.id) : undefined;
            return (
              <Card
                key={a.id}
                title={
                  <span className="t-title-inline">
                    {a.title}
                    {sub ? (
                      <Badge kind="gradingStatus" value={sub.status} />
                    ) : (
                      <Tone tone={a.is_overdue ? 'danger' : 'warning'}>{a.is_overdue ? 'Quá hạn nộp' : 'Chưa nộp'}</Tone>
                    )}
                  </span>
                }
                actions={
                  <div className="t-actions">
                    {a.can_submit && (
                      <Btn small variant="primary" onClick={() => openEditor(a)}>
                        {sub?.status === 'DRAFT' ? 'Sửa bản nháp & Nộp' : a.submitted_count > 0 ? 'Nộp lại bài' : 'Làm & Nộp bài'}
                      </Btn>
                    )}
                    {sub && (sub.status === 'GRADED' || sub.status === 'RETURNED') && !subAppeal && (
                      <Btn
                        small
                        onClick={() => {
                          setAppealTarget({
                            submission_id: sub.id,
                            title: a.title,
                            current_score: sub.score,
                            max_score: a.max_score,
                          });
                          setAppealReason('');
                          setAppealReqScore(sub.score !== null ? String(sub.score) : '');
                        }}
                      >
                        Phúc khảo điểm
                      </Btn>
                    )}
                  </div>
                }
              >
                <div className="t-small t-muted" style={{ marginBottom: 8 }}>
                  <code>{a.class_code}</code> · {a.class_title} · Hình thức: {label('submissionType', a.submission_type)} · Thang điểm: <strong className="tabular-nums">{a.max_score}</strong> · Đã nộp <strong className="tabular-nums">{a.submitted_count}/{a.max_attempts}</strong> lần
                  {a.due_at && <> · Hạn nộp: {fmtDateTime(a.due_at)}</>}
                </div>
                <p className="m-measure" style={{ whiteSpace: 'pre-wrap' }}>{a.instructions}</p>

                {Array.isArray(a.rubric) && a.rubric.length > 0 && (
                  <div style={{ marginTop: 8, padding: 10, borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
                    <strong className="t-small">Tiêu chí chấm điểm (Rubric):</strong>
                    <ul className="t-small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {a.rubric.map((rb) => (
                        <li key={rb.id}>
                          {rb.criterion} — <strong className="tabular-nums">{rb.max_points} điểm</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sub && sub.status !== 'DRAFT' && (
                  <div className="m-semantic-notice" style={{ marginTop: 12 }}>
                    <div>
                      <strong>Bài nộp lần #{sub.attempt_number}</strong> ({fmtDateTime(sub.submitted_at)})
                      {sub.score !== null && (
                        <> · Điểm đạt: <strong className="tabular-nums">{sub.score}/{a.max_score}</strong></>
                      )}
                    </div>
                    {Array.isArray(sub.attachments) && sub.attachments.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                        {sub.attachments.map((att, ai) => (
                          <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer" className="t-small t-row-link">
                            {att.file_name || att.name || att.title || 'Tệp đã nộp'}
                          </a>
                        ))}
                      </div>
                    )}
                    {Array.isArray(sub.rubric_scores) && sub.rubric_scores.length > 0 && (
                      <ul className="t-small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {sub.rubric_scores.map((rs) => (
                          <li key={rs.criterion_id}>
                            {rs.criterion}: <strong className="tabular-nums">{rs.points}/{rs.max_points}</strong>
                            {rs.comment ? ` — ${rs.comment}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {sub.teacher_feedback && (
                      <div className="t-small" style={{ marginTop: 4 }}>Nhận xét giảng viên: {sub.teacher_feedback}</div>
                    )}
                    {subAppeal && (
                      <div className="t-small" style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>Đơn phúc khảo:</span>
                        <Badge kind="appealStatus" value={subAppeal.status} />
                        {subAppeal.resolution_note && <span>· {subAppeal.resolution_note}</span>}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal
          title={`Nộp bài tập: ${editing.title}`}
          onClose={() => setEditing(null)}
          width={680}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setEditing(null)} disabled={busy || uploadingFile}>Hủy</Btn>
              <Btn onClick={() => handleSave(false)} disabled={busy || uploadingFile}>Lưu nháp</Btn>
              <Btn variant="primary" loading={busy} disabled={uploadingFile} onClick={() => handleSave(true)}>Nộp bài chính thức</Btn>
            </>
          }
        >
          <div className="t-form-grid">
            <Field label="Nội dung bài làm" wide>
              <textarea className="t-input" rows={5} value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} placeholder="Trình bày bài làm hoặc ghi chú cho giảng viên…" />
            </Field>
            {(editing.submission_type === 'FILE' || editing.submission_type === 'MIXED') && (
              <Field label="Đính kèm tệp bài làm (PDF, DOCX, XLSX, ZIP, Ảnh — tối đa 15MB)" wide>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label className="t-btn t-btn--small" style={{ cursor: 'pointer', minHeight: 44 }}>
                      {uploadingFile ? 'Đang tải tệp…' : '+ Chọn tệp bài làm'}
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.png,.jpg,.jpeg,.webp"
                        style={{ display: 'none' }}
                        disabled={uploadingFile}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleFileChosen(f);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <div className="t-list">
                      {uploadedFiles.map((f, fi) => (
                        <div key={fi} className="t-list-item" style={{ padding: '6px 10px' }}>
                          <a href={f.url} target="_blank" rel="noopener noreferrer" className="t-small t-row-link">
                            {f.file_name || f.name || f.title || 'Tệp đính kèm'}
                          </a>
                          <Btn small variant="ghost" onClick={() => setUploadedFiles((prev) => prev.filter((_, idx) => idx !== fi))}>
                            Gỡ
                          </Btn>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            )}
            {(editing.submission_type === 'LINK' || editing.submission_type === 'MIXED') && (
              <Field label="Liên kết bài nộp / Google Docs / GitHub (https://...)" wide>
                <input type="url" className="t-input" value={submissionLink} onChange={(e) => setSubmissionLink(e.target.value)} placeholder="https://..." />
              </Field>
            )}
            {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
          </div>
        </Modal>
      )}

      {appealTarget && (
        <Modal
          title={`Gửi đơn phúc khảo: ${appealTarget.title}`}
          onClose={() => setAppealTarget(null)}
          width={560}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setAppealTarget(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="assign-appeal-form" loading={busy}>Gửi phúc khảo</Btn>
            </>
          }
        >
          <form id="assign-appeal-form" className="t-form-grid" onSubmit={submitAppeal}>
            <Field label={`Điểm đề nghị xem xét lại (hiện tại ${appealTarget.current_score ?? '—'}/${appealTarget.max_score})`} wide>
              <input
                type="number"
                step="0.5"
                min={0}
                max={appealTarget.max_score}
                className="t-input tabular-nums"
                value={appealReqScore}
                onChange={(e) => setAppealReqScore(e.target.value)}
              />
            </Field>
            <Field label="Lý do đề nghị phúc khảo" required wide>
              <textarea
                className="t-input"
                rows={4}
                required
                minLength={5}
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Trình bày rõ phần bài làm hoặc tiêu chí Rubric cần đối soát lại…"
              />
            </Field>
          </form>
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
