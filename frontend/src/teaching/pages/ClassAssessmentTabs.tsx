import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClassAssignmentItem, ClassDetail, ClassExamItem, ClassQuizAnalytics, DeliveryMode, EnrollResult, EnrollmentSource,
  GradeAppealItem, masterApi, RubricItem, RubricScoreItem, saveBlob, SessionSummary, teachingApi, VirtualProviderType,
} from '../api';
import { attendanceLink, SessionRow, virtualSessionLink } from '../components/SessionRow';
import {
  Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, ProgressMeter, SearchInput, StatCard, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, fmtTime, fmtWeekday, label, todayVn, useAsync, useToast,
} from '../ui';
import { ClassLeaveRequestsPanel } from './LeaveRequestsPage';
import { CourseContentSection } from './ClassRosterAndContentTabs';
import { BankQuestionAttachment, BankQuestionPicker, extractBankQuestionAttachments, mergeInstructionsWithQuestions } from '../components/BankQuestionPicker';

// ------------------------------------------------------------------ Tabs: Kiểm tra, Bài tập lớp, Bảng điểm & Nâng cấp Snapshot

export const ClassExamsTab: React.FC<{ cls: ClassDetail }> = ({ cls }) => {
  const toast = useToast();
  const req = useAsync(() => masterApi.listClassExams(cls.id), [cls.id]);
  const [createOpen, setCreateOpen] = useState(false);
  const [attemptsExamId, setAttemptsExamId] = useState<string | null>(null);
  const [deleteExamTarget, setDeleteExamTarget] = useState<ClassExamItem | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimit, setTimeLimit] = useState(30);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [passPct, setPassPct] = useState(60);
  const [publishNow, setPublishNow] = useState(true);
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customType, setCustomType] = useState<'SHORT_ANSWER' | 'SINGLE_CHOICE'>('SHORT_ANSWER');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [correctOpt, setCorrectOpt] = useState<'A' | 'B'>('A');
  const [customPoints, setCustomPoints] = useState(2);
  const [saving, setSaving] = useState(false);

  const bankReq = useAsync(
    () => (createOpen && cls.course?.id ? masterApi.listQuestionBank({ course_id: cls.course.id, page_size: 100 }) : Promise.resolve(null)),
    [createOpen, cls.course?.id]
  );
  const attemptsReq = useAsync(
    () => (attemptsExamId ? masterApi.listExamAttempts(attemptsExamId) : Promise.resolve(null)),
    [attemptsExamId]
  );

  const [gradingAttemptId, setGradingAttemptId] = useState<string | null>(null);
  const [gradeScores, setGradeScores] = useState<Record<string, string>>({});
  const [gradeFeedback, setGradeFeedback] = useState('');
  const [gradingBusy, setGradingBusy] = useState(false);

  const canManage = cls.capabilities.can_manage_class;

  const createExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const inlineQuestions: Array<Record<string, unknown>> = [];
    if (customPrompt.trim()) {
      if (customType === 'SHORT_ANSWER') {
        inlineQuestions.push({ question_type: 'SHORT_ANSWER', prompt: customPrompt.trim(), points: customPoints });
      } else {
        inlineQuestions.push({
          question_type: 'SINGLE_CHOICE',
          prompt: customPrompt.trim(),
          points: customPoints,
          options: [
            { id: 'A', text: optA.trim() || 'Đáp án A', is_correct: correctOpt === 'A' },
            { id: 'B', text: optB.trim() || 'Đáp án B', is_correct: correctOpt === 'B' },
          ],
        });
      }
    }
    if (selectedBankIds.length === 0 && inlineQuestions.length === 0) {
      toast({ tone: 'error', title: 'Cần chọn ít nhất 1 câu hỏi từ ngân hàng hoặc tự nhập' });
      return;
    }
    setSaving(true);
    try {
      await masterApi.createClassExam(cls.id, {
        title: title.trim(),
        description: description.trim(),
        time_limit_minutes: timeLimit,
        max_attempts: maxAttempts,
        pass_score_pct: passPct,
        status: publishNow ? 'PUBLISHED' : 'DRAFT',
        bank_question_ids: selectedBankIds,
        questions: inlineQuestions,
      });
      toast({ tone: 'success', title: 'Đã tạo bài kiểm tra cho lớp' });
      setCreateOpen(false);
      setTitle('');
      setDescription('');
      setSelectedBankIds([]);
      setCustomPrompt('');
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không tạo được bài kiểm tra', detail: errMsg(ex) });
    } finally {
      setSaving(false);
    }
  };

  const openGradeAttempt = (
    attempt: { id: string; teacher_feedback: string; item_grades: Record<string, { earned_points?: number } | unknown> },
    questions: Array<{ id: string; points: number }>
  ) => {
    const initial: Record<string, string> = {};
    questions.forEach((q) => {
      const g = attempt.item_grades?.[q.id] as { earned_points?: number } | undefined;
      initial[q.id] = g && typeof g.earned_points === 'number' ? String(g.earned_points) : '0';
    });
    setGradeScores(initial);
    setGradeFeedback(attempt.teacher_feedback || '');
    setGradingAttemptId(attempt.id);
  };

  const saveGrade = async () => {
    if (!gradingAttemptId) return;
    setGradingBusy(true);
    try {
      const item_scores: Record<string, number> = {};
      Object.entries(gradeScores).forEach(([qid, val]) => {
        item_scores[qid] = Math.max(0, Number(val) || 0);
      });
      await masterApi.gradeExamAttempt(gradingAttemptId, { item_scores, teacher_feedback: gradeFeedback.trim() });
      toast({ tone: 'success', title: 'Đã lưu điểm bài kiểm tra' });
      setGradingAttemptId(null);
      attemptsReq.reload();
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không chấm được bài', detail: errMsg(ex) });
    } finally {
      setGradingBusy(false);
    }
  };

  if (req.loading) return <Loading rows={4} />;
  if (req.error || !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card
        title="Danh sách bài kiểm tra của lớp"
        actions={
          canManage && (
            <Btn variant="primary" small onClick={() => setCreateOpen(true)}>
              + Tạo bài kiểm tra
            </Btn>
          )
        }
      >
        {req.data.items.length === 0 ? (
          <EmptyState title="Lớp chưa có bài kiểm tra nào" text="Giảng viên có thể bốc câu hỏi từ Ngân hàng câu hỏi hoặc soạn câu hỏi mới cho lớp." />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Tiêu đề</th>
                  <th className="num">Câu hỏi / Điểm</th>
                  <th className="num">Thời gian / Lượt</th>
                  <th>Trạng thái</th>
                  <th className="num">Bài nộp / Chờ chấm</th>
                  <th className="actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {req.data.items.map((ex: ClassExamItem) => (
                  <tr key={ex.id}>
                    <td>
                      <strong>{ex.title}</strong>
                      {ex.description && <span className="t-sub">{ex.description}</span>}
                    </td>
                    <td className="num tabular-nums">{ex.question_count} câu · {ex.total_points}đ</td>
                    <td className="num tabular-nums">{ex.time_limit_minutes} phút · {ex.max_attempts} lượt</td>
                    <td><Badge kind="examStatus" value={ex.status} /></td>
                    <td className="num tabular-nums">{ex.submitted_count} nộp / {ex.pending_manual_count} chờ</td>
                    <td className="actions">
                      <div className="t-actions">
                        <Btn small onClick={() => setAttemptsExamId(ex.id)}>Bài làm ({ex.attempt_count})</Btn>
                        {canManage && ex.status === 'DRAFT' && (
                          <Btn
                            small
                            variant="primary"
                            onClick={async () => {
                              try {
                                await masterApi.updateExam(ex.id, { status: 'PUBLISHED' });
                                toast({ tone: 'success', title: 'Đã mở bài kiểm tra cho học viên' });
                                req.reload();
                              } catch (e) {
                                toast({ tone: 'error', title: 'Không mở được bài kiểm tra', detail: errMsg(e) });
                              }
                            }}
                          >
                            Mở thi
                          </Btn>
                        )}
                        {canManage && (
                          <Btn small variant="danger" onClick={() => setDeleteExamTarget(ex)}>
                            Xóa
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {createOpen && (
        <Modal
          title="Tạo bài kiểm tra lớp"
          onClose={() => setCreateOpen(false)}
          width={760}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="create-exam-form" loading={saving}>Lưu bài kiểm tra</Btn>
            </>
          }
        >
          <form id="create-exam-form" className="t-form-grid" onSubmit={createExam}>
            <Field label="Tiêu đề bài kiểm tra" required wide>
              <input className="t-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Kiểm tra giữa kỳ Chương 1-2" />
            </Field>
            <Field label="Thời gian làm bài (phút)" required>
              <input type="number" className="t-input tabular-nums" min={5} max={240} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value) || 30)} />
            </Field>
            <Field label="Số lượt thi tối đa">
              <input type="number" className="t-input tabular-nums" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)} />
            </Field>
            <Field label="Điểm đạt (%)">
              <input type="number" className="t-input tabular-nums" min={0} max={100} value={passPct} onChange={(e) => setPassPct(Number(e.target.value) || 50)} />
            </Field>
            <Field label="Mô tả / Lưu ý" wide>
              <textarea className="t-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                Mở cho học viên làm bài ngay sau khi tạo
              </label>
            </div>
            {cls.course?.id && (
              <Field label={`Chọn câu hỏi từ Ngân hàng môn học (${selectedBankIds.length} đã chọn)`} wide>
                {bankReq.loading ? (
                  <Loading rows={2} />
                ) : (bankReq.data?.items || []).length === 0 ? (
                  <span className="t-sub">Ngân hàng môn học chưa có câu hỏi.</span>
                ) : (
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(bankReq.data?.items || []).map((bq) => {
                      const checked = selectedBankIds.includes(bq.id);
                      return (
                        <label key={bq.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedBankIds((prev) =>
                                e.target.checked ? [...prev, bq.id] : prev.filter((id) => id !== bq.id)
                              )
                            }
                          />
                          <span>
                            <strong>[{label('difficulty', bq.difficulty)}]</strong> {bq.prompt} <em className="t-sub">({bq.points}đ · {bq.lesson_title || 'Lá'})</em>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>
            )}
            <Field label="Hoặc thêm 1 câu hỏi trực tiếp vào đề (tùy chọn)" wide>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="t-input" style={{ width: 180 }} value={customType} onChange={(e) => setCustomType(e.target.value as 'SHORT_ANSWER' | 'SINGLE_CHOICE')}>
                    <option value="SHORT_ANSWER">Tự luận ngắn (Giáo viên chấm)</option>
                    <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                  </select>
                  <input type="number" className="t-input tabular-nums" style={{ width: 110 }} min={1} max={100} value={customPoints} onChange={(e) => setCustomPoints(Number(e.target.value) || 1)} aria-label="Điểm câu hỏi" />
                </div>
                <textarea className="t-input" rows={2} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Nội dung câu hỏi..." />
                {customType === 'SINGLE_CHOICE' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input className="t-input" value={optA} onChange={(e) => setOptA(e.target.value)} placeholder="Đáp án A" />
                    <input className="t-input" value={optB} onChange={(e) => setOptB(e.target.value)} placeholder="Đáp án B" />
                    <select className="t-input" value={correctOpt} onChange={(e) => setCorrectOpt(e.target.value as 'A' | 'B')}>
                      <option value="A">Đáp án đúng: A</option>
                      <option value="B">Đáp án đúng: B</option>
                    </select>
                  </div>
                )}
              </div>
            </Field>
          </form>
        </Modal>
      )}

      {attemptsExamId && (
        <Modal
          title={attemptsReq.data ? `Bài làm: ${attemptsReq.data.exam.title}` : 'Danh sách lượt làm bài'}
          onClose={() => { setAttemptsExamId(null); setGradingAttemptId(null); }}
          width={840}
          footer={<Btn onClick={() => { setAttemptsExamId(null); setGradingAttemptId(null); }}>Đóng</Btn>}
        >
          {attemptsReq.loading && <Loading rows={3} />}
          {attemptsReq.error && <ErrorState error={attemptsReq.error} onRetry={attemptsReq.reload} />}
          {attemptsReq.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {attemptsReq.data.attempts.length === 0 ? (
                <EmptyState title="Chưa có học viên nào làm bài kiểm tra này" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Học viên</th>
                        <th className="num">Lần</th>
                        <th>Trạng thái</th>
                        <th className="num">Tự động / Chấm tay</th>
                        <th className="num">Tổng điểm</th>
                        {canManage && <th className="actions">Thao tác</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {attemptsReq.data.attempts.map((a) => (
                        <tr key={a.id}>
                          <td><strong>{a.student_name}</strong><span className="t-sub tabular-nums">{a.student_code}</span></td>
                          <td className="num tabular-nums">#{a.attempt_number}</td>
                          <td><Badge kind="gradingStatus" value={a.grading_status} /></td>
                          <td className="num tabular-nums">{a.auto_score} / {a.manual_score}</td>
                          <td className="num tabular-nums"><strong>{a.total_score} / {a.max_score}</strong></td>
                          {canManage && (
                            <td className="actions">
                              {a.submitted_at && (
                                <Btn small onClick={() => openGradeAttempt(a, attemptsReq.data!.questions)}>
                                  Chấm điểm
                                </Btn>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {gradingAttemptId && (
                <div style={{ padding: 16, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <strong>Chấm điểm lượt làm #{gradingAttemptId.slice(-6)}</strong>
                  {(() => {
                    const att = attemptsReq.data.attempts.find((x) => x.id === gradingAttemptId);
                    return attemptsReq.data.questions.map((q, qi) => (
                      <div key={q.id} style={{ padding: 10, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 13 }}><strong>Câu {qi + 1}:</strong> {q.question?.prompt}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              max={q.points}
                              className="t-input tabular-nums"
                              style={{ width: 84 }}
                              value={gradeScores[q.id] ?? '0'}
                              onChange={(e) => setGradeScores((p) => ({ ...p, [q.id]: e.target.value }))}
                              aria-label={`Điểm câu ${qi + 1}`}
                            />
                            <span className="t-sub tabular-nums">/ {q.points}đ</span>
                          </div>
                        </div>
                        <div className="t-sub" style={{ marginTop: 6 }}>
                          Trả lời của học viên: <code>{JSON.stringify(att?.answers?.[q.id] ?? '')}</code>
                        </div>
                      </div>
                    ));
                  })()}
                  <Field label="Nhận xét của giảng viên">
                    <input className="t-input" value={gradeFeedback} onChange={(e) => setGradeFeedback(e.target.value)} />
                  </Field>
                  <div className="t-actions">
                    <Btn variant="primary" small loading={gradingBusy} onClick={saveGrade}>Lưu kết quả chấm</Btn>
                    <Btn variant="ghost" small onClick={() => setGradingAttemptId(null)}>Đóng khung chấm</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
      {deleteExamTarget && (
        <ConfirmDialog
          title={`Xóa bài kiểm tra "${deleteExamTarget.title}"?`}
          message="Mọi lượt làm bài và điểm thành phần gắn với bài kiểm tra này trong lớp sẽ bị xóa."
          confirmLabel="Xóa bài kiểm tra"
          danger
          onCancel={() => setDeleteExamTarget(null)}
          onConfirm={async () => {
            try {
              await masterApi.deleteExam(deleteExamTarget.id);
              setDeleteExamTarget(null);
              toast({ tone: 'success', title: 'Đã xóa bài kiểm tra' });
              req.reload();
            } catch (e) {
              toast({ tone: 'error', title: 'Không xóa được bài kiểm tra', detail: errMsg(e) });
            }
          }}
        />
      )}
    </div>
  );
};

export const ClassAssignmentsTab: React.FC<{ cls: ClassDetail; onOpenEditClass: () => void }> = ({ cls, onOpenEditClass }) => {
  const toast = useToast();
  const req = useAsync(() => masterApi.listClassAssignments(cls.id), [cls.id]);
  const [createOpen, setCreateOpen] = useState(false);
  const [subsAssignmentId, setSubsAssignmentId] = useState<string | null>(null);
  const [deleteAssignTarget, setDeleteAssignTarget] = useState<ClassAssignmentItem | null>(null);
  const [bankItemId, setBankItemId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [subType, setSubType] = useState<'TEXT' | 'LINK' | 'FILE' | 'MIXED'>('MIXED');
  const [maxScore, setMaxScore] = useState(10);
  const [maxScoreTouched, setMaxScoreTouched] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<BankQuestionAttachment[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [rubric, setRubric] = useState<RubricItem[]>([]);
  const [saving, setSaving] = useState(false);

  const bankReq = useAsync(
    () => (createOpen && cls.course?.id ? masterApi.listAssignmentBank({ course_id: cls.course.id, page_size: 100 }) : Promise.resolve(null)),
    [createOpen, cls.course?.id]
  );
  const subsReq = useAsync(
    () => (subsAssignmentId ? masterApi.listAssignmentSubmissions(subsAssignmentId) : Promise.resolve(null)),
    [subsAssignmentId]
  );

  const [gradingSubId, setGradingSubId] = useState<string | null>(null);
  const [scoreVal, setScoreVal] = useState('8');
  const [fbVal, setFbVal] = useState('');
  const [rubricScores, setRubricScores] = useState<RubricScoreItem[]>([]);
  const [gradingBusy, setGradingBusy] = useState(false);

  const canManage = cls.capabilities.can_manage_class;

  const handleQuestionsChange = (next: BankQuestionAttachment[]) => {
    setSelectedQuestions(next);
    if (!maxScoreTouched) {
      const total = next.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
      if (total > 0) setMaxScore(total);
    }
  };

  const handleInsertPrompt = (text: string, totalPoints: number) => {
    setInstructions((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
    if (!maxScoreTouched && totalPoints > 0) setMaxScore(totalPoints);
  };

  const createAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const finalInstructions = mergeInstructionsWithQuestions(instructions, selectedQuestions);
      const validRubric = rubric.filter((r) => r.criterion.trim().length > 0);
      await masterApi.createClassAssignment(cls.id, {
        assignment_bank_item_id: bankItemId || undefined,
        title: title.trim(),
        instructions: finalInstructions,
        submission_type: subType,
        max_score: maxScore,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        status: publishNow ? 'PUBLISHED' : 'DRAFT',
        rubric: validRubric.length > 0 ? validRubric : undefined,
        attachments:
          selectedQuestions.length > 0
            ? (selectedQuestions as unknown as Array<Record<string, unknown>>)
            : undefined,
      });
      toast({ tone: 'success', title: 'Đã giao bài tập mới cho lớp' });
      setCreateOpen(false);
      setBankItemId('');
      setTitle('');
      setInstructions('');
      setRubric([]);
      setSelectedQuestions([]);
      setMaxScoreTouched(false);
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không tạo được bài tập', detail: errMsg(ex) });
    } finally {
      setSaving(false);
    }
  };

  const gradeSubmission = async (status: 'GRADED' | 'RETURNED') => {
    if (!gradingSubId) return;
    setGradingBusy(true);
    try {
      await masterApi.gradeAssignmentSubmission(gradingSubId, {
        status,
        score: status === 'GRADED' ? Number(scoreVal) || 0 : undefined,
        teacher_feedback: fbVal.trim(),
        rubric_scores: rubricScores.length > 0 ? rubricScores : undefined,
      });
      toast({ tone: 'success', title: status === 'GRADED' ? 'Đã chấm điểm bài nộp' : 'Đã trả lại bài yêu cầu sửa' });
      setGradingSubId(null);
      setRubricScores([]);
      subsReq.reload();
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không cập nhật được điểm bài tập', detail: errMsg(ex) });
    } finally {
      setGradingBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card
        title="Bài tập thực hành của lớp"
        actions={
          canManage && (
            <Btn variant="primary" small onClick={() => setCreateOpen(true)}>
              + Giao bài tập lớp
            </Btn>
          )
        }
      >
        {req.loading && <Loading rows={3} />}
        {req.error && <ErrorState error={req.error} onRetry={req.reload} />}
        {req.data && (
          req.data.items.length === 0 ? (
            <EmptyState title="Lớp chưa có bài tập thực hành nào" text="Bạn có thể giao bài tập lấy mẫu từ Ngân hàng bài tập hoặc tự nhập mới." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Bài tập</th>
                    <th className="num">Điểm tối đa</th>
                    <th>Hạn nộp</th>
                    <th>Trạng thái</th>
                    <th className="num">Đã nộp / Chờ chấm</th>
                    <th className="actions">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {req.data.items.map((a: ClassAssignmentItem) => (
                    <tr key={a.id}>
                      <td><strong>{a.title}</strong><span className="t-sub">{a.instructions.slice(0, 80)}</span></td>
                      <td className="num tabular-nums">{a.max_score}</td>
                      <td className="tabular-nums">{a.due_at ? fmtDateTime(a.due_at) : 'Không giới hạn'}</td>
                      <td><Badge kind="examStatus" value={a.status} /></td>
                      <td className="num tabular-nums">{a.submissions_total} / {a.pending_grade_count}</td>
                      <td className="actions">
                        <div className="t-actions">
                          <Btn small onClick={() => setSubsAssignmentId(a.id)}>Xem bài nộp</Btn>
                          {canManage && a.status === 'DRAFT' && (
                            <Btn
                              small
                              variant="primary"
                              onClick={async () => {
                                try {
                                  await masterApi.updateClassAssignment(a.id, { status: 'PUBLISHED' });
                                  toast({ tone: 'success', title: 'Đã xuất bản bài tập' });
                                  req.reload();
                                } catch (e) {
                                  toast({ tone: 'error', title: 'Không xuất bản được bài tập', detail: errMsg(e) });
                                }
                              }}
                            >
                              Xuất bản
                            </Btn>
                          )}
                          {canManage && (
                            <Btn small variant="danger" onClick={() => setDeleteAssignTarget(a)}>
                              Xóa
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>

      <CourseContentSection cls={cls} onOpenEditClass={onOpenEditClass} mode="assignments" />

      {createOpen && (
        <Modal
          title="Giao bài tập thực hành mới"
          onClose={() => setCreateOpen(false)}
          width={760}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="create-class-assignment" loading={saving}>Giao bài</Btn>
            </>
          }
        >
          <form id="create-class-assignment" className="t-form-grid" onSubmit={createAssignment}>
            {cls.course?.id && (bankReq.data?.items || []).length > 0 && (
              <Field label="Nạp nhanh từ Ngân hàng bài tập (tùy chọn)" wide>
                <select
                  className="t-input"
                  value={bankItemId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setBankItemId(id);
                    const picked = (bankReq.data?.items || []).find((it) => it.id === id);
                    if (picked) {
                      setTitle(picked.title);
                      setInstructions(picked.instructions);
                      setSubType(picked.submission_type);
                      setMaxScore(picked.max_score);
                      setSelectedQuestions(extractBankQuestionAttachments(picked.attachments));
                      setRubric(Array.isArray(picked.rubric) ? (picked.rubric as unknown as RubricItem[]) : []);
                      setMaxScoreTouched(false);
                    }
                  }}
                >
                  <option value="">-- Nhập mới hoàn toàn --</option>
                  {(bankReq.data?.items || []).map((it) => (
                    <option key={it.id} value={it.id}>{it.title} ({it.max_score}đ)</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Tên bài tập" required wide>
              <input className="t-input" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Hình thức nộp">
              <select className="t-input" value={subType} onChange={(e) => setSubType(e.target.value as 'TEXT' | 'LINK' | 'FILE' | 'MIXED')}>
                <option value="MIXED">Văn bản / Liên kết / Tệp</option>
                <option value="TEXT">Văn bản trực tiếp</option>
                <option value="LINK">Liên kết (Link)</option>
                <option value="FILE">Tệp đính kèm</option>
              </select>
            </Field>
            <Field label="Thang điểm tối đa">
              <input
                type="number"
                className="t-input tabular-nums"
                min={1}
                max={1000}
                value={maxScore}
                onChange={(e) => {
                  setMaxScoreTouched(true);
                  setMaxScore(Number(e.target.value) || 10);
                }}
              />
            </Field>
            <Field label="Hạn nộp (tùy chọn)" wide>
              <input type="datetime-local" className="t-input" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
            <BankQuestionPicker
              courseId={cls.course?.id}
              selected={selectedQuestions}
              onChange={handleQuestionsChange}
              onInsertPrompt={handleInsertPrompt}
            />
            <Field label="Hướng dẫn làm bài" wide>
              <textarea
                className="t-input"
                rows={4}
                placeholder={
                  selectedQuestions.length > 0
                    ? 'Nhập thêm ghi chú cho học viên (câu hỏi đã chọn sẽ được tự động đính kèm khi giao bài)...'
                    : 'Nhập yêu cầu và hướng dẫn làm bài cho học viên...'
                }
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong className="t-small">Tiêu chí chấm điểm (Rubric — tùy chọn)</strong>
                <Btn
                  small
                  onClick={() =>
                    setRubric((prev) => [
                      ...prev,
                      { id: `crit_${prev.length + 1}`, criterion: '', description: '', max_points: 2.5 },
                    ])
                  }
                >
                  + Thêm tiêu chí
                </Btn>
              </div>
              {rubric.map((rb, ri) => (
                <div key={rb.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="t-input"
                    style={{ flex: '2 1 200px' }}
                    placeholder={`Tiêu chí ${ri + 1} (VD: Phân tích yêu cầu)`}
                    value={rb.criterion}
                    onChange={(e) =>
                      setRubric((prev) => prev.map((x, i) => (i === ri ? { ...x, criterion: e.target.value } : x)))
                    }
                  />
                  <input
                    type="number"
                    step="0.5"
                    min={0.5}
                    max={1000}
                    className="t-input tabular-nums"
                    style={{ width: 96 }}
                    aria-label={`Điểm tối đa tiêu chí ${ri + 1}`}
                    value={rb.max_points}
                    onChange={(e) =>
                      setRubric((prev) => prev.map((x, i) => (i === ri ? { ...x, max_points: Number(e.target.value) || 1 } : x)))
                    }
                  />
                  <Btn small variant="ghost" onClick={() => setRubric((prev) => prev.filter((_, i) => i !== ri))}>Xóa</Btn>
                </div>
              ))}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                Hiển thị cho học viên ngay
              </label>
            </div>
          </form>
        </Modal>
      )}

      {subsAssignmentId && (
        <Modal
          title={subsReq.data ? `Bài nộp: ${subsReq.data.assignment.title}` : 'Danh sách nộp bài'}
          onClose={() => { setSubsAssignmentId(null); setGradingSubId(null); setRubricScores([]); }}
          width={860}
          footer={<Btn onClick={() => { setSubsAssignmentId(null); setGradingSubId(null); setRubricScores([]); }}>Đóng</Btn>}
        >
          {subsReq.loading && <Loading rows={3} />}
          {subsReq.error && <ErrorState error={subsReq.error} onRetry={subsReq.reload} />}
          {subsReq.data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Học viên</th>
                      <th>Trạng thái mới nhất</th>
                      <th className="num">Điểm</th>
                      <th>Nội dung / Liên kết / Tệp</th>
                      {canManage && <th className="actions">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {subsReq.data.roster_status.map((r) => {
                      const sub = r.latest_submission;
                      return (
                        <tr key={r.student_id}>
                          <td><strong>{r.student_name}</strong><span className="t-sub tabular-nums">{r.student_code}</span></td>
                          <td><Badge kind="gradingStatus" value={r.latest_status || 'DRAFT'} /></td>
                          <td className="num tabular-nums">{sub && sub.score !== null ? `${sub.score}/${subsReq.data!.assignment.max_score}` : '—'}</td>
                          <td style={{ maxWidth: 280 }}>
                            {sub ? (
                              <div style={{ fontSize: 13 }}>
                                {sub.submission_text.slice(0, 100)}
                                {sub.submission_link ? ` · ${sub.submission_link}` : ''}
                                {Array.isArray(sub.attachments) && sub.attachments.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                    {sub.attachments.map((att, ai) => (
                                      <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer" className="t-row-link">
                                        {att.file_name || att.name || att.title || 'Tệp đính kèm'}
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="t-sub">Chưa nộp</span>
                            )}
                          </td>
                          {canManage && (
                            <td className="actions">
                              {sub && sub.status !== 'DRAFT' && (
                                <Btn
                                  small
                                  onClick={() => {
                                    setGradingSubId(sub.id);
                                    setScoreVal(sub.score !== null ? String(sub.score) : String(subsReq.data!.assignment.max_score));
                                    setFbVal(sub.teacher_feedback || '');
                                    const assignRubric = subsReq.data!.assignment.rubric || [];
                                    if (Array.isArray(sub.rubric_scores) && sub.rubric_scores.length > 0) {
                                      setRubricScores(sub.rubric_scores);
                                    } else if (assignRubric.length > 0) {
                                      setRubricScores(
                                        assignRubric.map((rb) => ({
                                          criterion_id: rb.id,
                                          criterion: rb.criterion,
                                          max_points: rb.max_points,
                                          points: rb.max_points,
                                          comment: '',
                                        }))
                                      );
                                      const tot = assignRubric.reduce((acc, x) => acc + Number(x.max_points || 0), 0);
                                      setScoreVal(String(Math.min(subsReq.data!.assignment.max_score, Math.round(tot * 100) / 100)));
                                    } else {
                                      setRubricScores([]);
                                    }
                                  }}
                                >
                                  Chấm / Trả bài
                                </Btn>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {gradingSubId && (
                <div style={{ padding: 16, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <strong>Chấm điểm bài nộp</strong>
                  {rubricScores.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="t-small t-muted">Chấm chi tiết theo Rubric (tự động cộng tổng điểm):</span>
                      {rubricScores.map((rs, rsi) => (
                        <div key={rs.criterion_id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ flex: '2 1 180px', fontSize: 13 }}><strong>{rs.criterion}</strong> (/{rs.max_points})</span>
                          <input
                            type="number"
                            step="0.5"
                            min={0}
                            max={rs.max_points}
                            className="t-input tabular-nums"
                            style={{ width: 90 }}
                            aria-label={`Điểm tiêu chí ${rs.criterion}`}
                            value={rs.points}
                            onChange={(e) => {
                              const pts = Math.max(0, Math.min(rs.max_points, Number(e.target.value) || 0));
                              const next = rubricScores.map((x, idx) => (idx === rsi ? { ...x, points: pts } : x));
                              setRubricScores(next);
                              const sum = next.reduce((s, it) => s + Number(it.points || 0), 0);
                              setScoreVal(String(Math.min(subsReq.data!.assignment.max_score, Math.round(sum * 100) / 100)));
                            }}
                          />
                          <input
                            className="t-input"
                            style={{ flex: '2 1 180px' }}
                            placeholder="Ghi chú tiêu chí…"
                            value={rs.comment || ''}
                            onChange={(e) =>
                              setRubricScores((prev) => prev.map((x, idx) => (idx === rsi ? { ...x, comment: e.target.value } : x)))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="t-form-grid">
                    <Field label={`Điểm (tối đa ${subsReq.data.assignment.max_score})`}>
                      <input type="number" step="0.5" min={0} max={subsReq.data.assignment.max_score} className="t-input tabular-nums" value={scoreVal} onChange={(e) => setScoreVal(e.target.value)} />
                    </Field>
                    <Field label="Nhận xét">
                      <input className="t-input" value={fbVal} onChange={(e) => setFbVal(e.target.value)} />
                    </Field>
                  </div>
                  <div className="t-actions">
                    <Btn variant="primary" small loading={gradingBusy} onClick={() => gradeSubmission('GRADED')}>Chấm điểm & Công bố</Btn>
                    <Btn variant="secondary" small loading={gradingBusy} onClick={() => gradeSubmission('RETURNED')}>Trả lại yêu cầu sửa</Btn>
                    <Btn variant="ghost" small onClick={() => { setGradingSubId(null); setRubricScores([]); }}>Hủy</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {deleteAssignTarget && (
        <ConfirmDialog
          title={`Xóa bài tập "${deleteAssignTarget.title}"?`}
          message="Bài tập và toàn bộ bài nộp tương ứng trong lớp sẽ bị gỡ bỏ."
          confirmLabel="Xóa bài tập"
          danger
          onCancel={() => setDeleteAssignTarget(null)}
          onConfirm={async () => {
            try {
              await masterApi.deleteClassAssignment(deleteAssignTarget.id);
              setDeleteAssignTarget(null);
              toast({ tone: 'success', title: 'Đã xóa bài tập lớp' });
              req.reload();
            } catch (e) {
              toast({ tone: 'error', title: 'Không xóa được bài tập', detail: errMsg(e) });
            }
          }}
        />
      )}
    </div>
  );
};

export const ClassGradebookTab: React.FC<{ cls: ClassDetail }> = ({ cls }) => {
  const toast = useToast();
  const req = useAsync(() => masterApi.getClassGradebook(cls.id), [cls.id]);
  const appealsReq = useAsync(() => masterApi.listClassAppeals(cls.id), [cls.id]);
  const [reviewingAppeal, setReviewingAppeal] = useState<GradeAppealItem | null>(null);
  const [decision, setDecision] = useState<'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'>('APPROVED');
  const [finalScore, setFinalScore] = useState('');
  const [note, setNote] = useState('');
  const [savingAppeal, setSavingAppeal] = useState(false);

  if (req.loading) return <Loading rows={4} />;
  if (req.error || !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;

  const { columns, rows } = req.data;
  const appeals = appealsReq.data?.items || [];

  const submitAppealReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingAppeal) return;
    setSavingAppeal(true);
    try {
      await masterApi.reviewGradeAppeal(reviewingAppeal.id, {
        decision,
        final_score: decision === 'APPROVED' && finalScore.trim() ? Number(finalScore) : undefined,
        resolution_note: note.trim(),
      });
      toast({ tone: 'success', title: 'Đã xử lý đơn phúc khảo điểm' });
      setReviewingAppeal(null);
      appealsReq.reload();
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không xử lý được phúc khảo', detail: errMsg(ex) });
    } finally {
      setSavingAppeal(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Bảng điểm tổng hợp lớp (Hệ 10)" padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu điểm" text="Điểm từ bài kiểm tra và bài tập của lớp sẽ tự động tổng hợp vào bảng điểm này." />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Học viên</th>
                  {columns.map((col) => (
                    <th key={col.key} className="num">
                      {col.title}
                      {col.max_score ? ` (/${col.max_score})` : ''}
                    </th>
                  ))}
                  <th className="num">Trung bình (Hệ 10)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.student_id}>
                    <td>
                      <strong>{r.full_name}</strong>
                      <span className="t-sub tabular-nums">{r.code}</span>
                    </td>
                    {columns.map((col) => {
                      const entry = r.scores?.[col.key];
                      return (
                        <td key={col.key} className="num tabular-nums">
                          {entry ? `${entry.score}/${entry.max_score}` : '—'}
                        </td>
                      );
                    })}
                    <td className="num tabular-nums">
                      <strong>{r.average_scale_10 !== null ? r.average_scale_10.toFixed(2) : '—'}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Yêu cầu phúc khảo điểm của học viên">
        {appealsReq.loading ? (
          <Loading rows={2} />
        ) : appeals.length === 0 ? (
          <EmptyState title="Chưa có đơn phúc khảo điểm nào" text="Khi học viên gửi yêu cầu phúc khảo bài kiểm tra hoặc bài tập, đơn sẽ hiển thị tại đây để Giảng viên / Trưởng bộ môn xử lý." />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Học viên</th>
                  <th>Hạng mục</th>
                  <th className="num">Điểm cũ / Đề nghị</th>
                  <th>Lý do phúc khảo</th>
                  <th>Trạng thái</th>
                  <th className="actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {appeals.map((ap) => (
                  <tr key={ap.id}>
                    <td><strong>{ap.student_name || ap.student_code}</strong><span className="t-sub">{ap.student_code}</span></td>
                    <td>{ap.target_title || ap.target_id}</td>
                    <td className="num tabular-nums">
                      {ap.current_score ?? '—'} → {ap.requested_score ?? '—'}
                      {ap.final_score !== null && <div><strong>Chốt: {ap.final_score}</strong></div>}
                    </td>
                    <td style={{ maxWidth: 280 }}>{ap.reason}</td>
                    <td><Badge kind="appealStatus" value={ap.status} /></td>
                    <td className="actions">
                      <Btn
                        small
                        onClick={() => {
                          setReviewingAppeal(ap);
                          setDecision(ap.status === 'PENDING' ? 'APPROVED' : ap.status);
                          setFinalScore(String(ap.requested_score ?? ap.current_score ?? ''));
                          setNote(ap.resolution_note || '');
                        }}
                      >
                        Xử lý
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reviewingAppeal && (
        <Modal
          title={`Xử lý phúc khảo: ${reviewingAppeal.target_title || ''}`}
          onClose={() => setReviewingAppeal(null)}
          width={560}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setReviewingAppeal(null)} disabled={savingAppeal}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="appeal-review-form" loading={savingAppeal}>Lưu quyết định</Btn>
            </>
          }
        >
          <form id="appeal-review-form" className="t-form-grid" onSubmit={submitAppealReview}>
            <Field label="Quyết định xử lý" wide>
              <select className="t-input" value={decision} onChange={(e) => setDecision(e.target.value as 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED')}>
                <option value="UNDER_REVIEW">Đang xem xét đối soát</option>
                <option value="APPROVED">Chấp thuận điều chỉnh điểm</option>
                <option value="REJECTED">Từ chối điều chỉnh (giữ nguyên điểm)</option>
              </select>
            </Field>
            {decision === 'APPROVED' && (
              <Field label="Điểm chính thức sau phúc khảo" required wide>
                <input type="number" step="0.5" min={0} className="t-input tabular-nums" value={finalScore} onChange={(e) => setFinalScore(e.target.value)} required />
              </Field>
            )}
            <Field label="Ghi chú kết luận gửi học viên" wide>
              <textarea className="t-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Giải thích căn cứ điều chỉnh hoặc giữ nguyên điểm…" />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
};
