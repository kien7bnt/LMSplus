/**
 * 3 Ngân hàng Học liệu đồng bộ tự động từ Cây nội dung 4 cấp:
 * Môn học -> Chủ đề -> Chương -> Bài học (nút lá cuối cùng).
 * Quy tắc cứng: Chỉ cho phép tạo / import ở nút lá Bài học (HTTP 400 LEAF_LESSON_REQUIRED ở backend).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AssignmentSubmissionType,
  BankTreeCourse,
  QuestionType,
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
  Pagination,
  SearchInput,
  Tabs,
  errMsg,
  fmtDateTime,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

type SelectedNode =
  | { level: 'ALL' }
  | { level: 'COURSE'; courseId: string; title: string; canEdit: boolean }
  | { level: 'TOPIC'; courseId: string; topicId: string; title: string; canEdit: boolean }
  | { level: 'CHAPTER'; courseId: string; chapterId: string; title: string; canEdit: boolean }
  | { level: 'LESSON'; courseId: string; topicId: string; chapterId: string; lessonId: string; title: string; canEdit: boolean };

export const BanksPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialCourseId = searchParams.get('course_id') || '';
  const initialLessonId = searchParams.get('lesson_id') || '';
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });

  const treeRes = useAsync(() => masterApi.getBanksTree(), []);
  const [selected, setSelected] = useState<SelectedNode>({ level: 'ALL' });
  const [bankTab, setBankTab] = useState<'questions' | 'assignments' | 'resources'>('questions');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);

  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const [importQuestionOpen, setImportQuestionOpen] = useState(false);
  const [createAssignmentOpen, setCreateAssignmentOpen] = useState(false);
  const [createResourceOpen, setCreateResourceOpen] = useState(false);

  // Tự động chọn node từ query param khi tải cây xong
  useEffect(() => {
    const courses = treeRes.data?.courses;
    if (!courses || selected.level !== 'ALL') return;
    if (initialLessonId) {
      for (const crs of courses) {
        for (const tp of crs.topics) {
          for (const ch of tp.chapters) {
            const found = ch.lessons.find((l) => l.id === initialLessonId);
            if (found) {
              setSelected({
                level: 'LESSON',
                courseId: crs.id,
                topicId: tp.id,
                chapterId: ch.id,
                lessonId: found.id,
                title: found.title,
                canEdit: crs.can_edit,
              });
              return;
            }
          }
        }
      }
    } else if (initialCourseId) {
      const crs = courses.find((c) => c.id === initialCourseId);
      if (crs) setSelected({ level: 'COURSE', courseId: crs.id, title: crs.title, canEdit: crs.can_edit });
    }
  }, [treeRes.data, initialCourseId, initialLessonId, selected.level]);

  const filterParams = useMemo(() => {
    const base: Record<string, string | number | undefined> = { q: dq, page, page_size: 20 };
    if (selected.level === 'COURSE') base.course_id = selected.courseId;
    if (selected.level === 'TOPIC') { base.course_id = selected.courseId; base.topic_id = selected.topicId; }
    if (selected.level === 'CHAPTER') { base.course_id = selected.courseId; base.chapter_id = selected.chapterId; }
    if (selected.level === 'LESSON') { base.course_id = selected.courseId; base.lesson_id = selected.lessonId; }
    return base;
  }, [selected, dq, page]);

  const questionsRes = useAsync(
    () => (bankTab === 'questions' ? masterApi.listQuestionBank(filterParams) : Promise.resolve(null)),
    [bankTab, filterParams]
  );
  const assignmentsRes = useAsync(
    () => (bankTab === 'assignments' ? masterApi.listAssignmentBank(filterParams) : Promise.resolve(null)),
    [bankTab, filterParams]
  );
  const resourcesRes = useAsync(
    () => (bankTab === 'resources' ? masterApi.listResourceBank(filterParams) : Promise.resolve(null)),
    [bankTab, filterParams]
  );

  const isLeafLesson = selected.level === 'LESSON';
  const canEditLeaf = isLeafLesson && selected.canEdit;

  const reloadAll = () => {
    treeRes.reload();
    if (bankTab === 'questions') questionsRes.reload();
    if (bankTab === 'assignments') assignmentsRes.reload();
    if (bankTab === 'resources') resourcesRes.reload();
  };

  const handleExportQuestions = async () => {
    try {
      const data = await masterApi.exportQuestionBank({
        course_id: selected.level !== 'ALL' ? selected.courseId : undefined,
        topic_id: selected.level === 'TOPIC' ? selected.topicId : undefined,
        chapter_id: selected.level === 'CHAPTER' ? selected.chapterId : undefined,
        lesson_id: selected.level === 'LESSON' ? selected.lessonId : undefined,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `ngan-hang-cau-hoi-${selected.level.toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      push('Đã xuất ngân hàng câu hỏi', `${data.total} câu hỏi`, 'success');
    } catch (ex) {
      push('Không xuất được dữ liệu', errMsg(ex), 'error');
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        title="Ngân hàng học liệu đồng bộ 4 cấp"
        subtitle="Cây thư mục 3 ngân hàng tự động sinh từ Cấu trúc Môn học → Chủ đề → Chương → Bài học. Nhấp chọn cấp cha để xem tổng hợp; chọn Bài học (nút lá) để thêm hoặc import mới."
      />

      <div className="m-banks-layout">
        <aside className="m-tree-panel" aria-label="Cây thư mục môn học 4 cấp">
          <button
            type="button"
            className={`m-tree-node ${selected.level === 'ALL' ? 'is-active' : ''}`}
            onClick={() => { setSelected({ level: 'ALL' }); setPage(1); }}
          >
            <span>Tất cả môn học được phép</span>
          </button>

          {treeRes.loading && <Loading rows={4} />}
          {treeRes.error && <ErrorState error={treeRes.error} onRetry={treeRes.reload} />}
          {treeRes.data?.courses.map((crs: BankTreeCourse) => (
            <div key={crs.id} style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`m-tree-node ${selected.level === 'COURSE' && selected.courseId === crs.id ? 'is-active' : ''}`}
                onClick={() => { setSelected({ level: 'COURSE', courseId: crs.id, title: crs.title, canEdit: crs.can_edit }); setPage(1); }}
              >
                <span><strong>{crs.code}</strong> · {crs.title}</span>
                <span className="t-muted t-small tabular-nums">{crs.questions_count + crs.assignments_count + crs.resources_count}</span>
              </button>

              {crs.topics.map((tp) => (
                <div key={tp.id} style={{ paddingLeft: 12 }}>
                  <button
                    type="button"
                    className={`m-tree-node ${selected.level === 'TOPIC' && selected.topicId === tp.id ? 'is-active' : ''}`}
                    onClick={() => { setSelected({ level: 'TOPIC', courseId: crs.id, topicId: tp.id, title: tp.title, canEdit: crs.can_edit }); setPage(1); }}
                  >
                    <span>Chủ đề: {tp.title}</span>
                    <span className="t-muted t-small tabular-nums">{tp.questions_count + tp.assignments_count + tp.resources_count}</span>
                  </button>

                  {tp.chapters.map((ch) => (
                    <div key={ch.id} style={{ paddingLeft: 12 }}>
                      <button
                        type="button"
                        className={`m-tree-node ${selected.level === 'CHAPTER' && selected.chapterId === ch.id ? 'is-active' : ''}`}
                        onClick={() => { setSelected({ level: 'CHAPTER', courseId: crs.id, chapterId: ch.id, title: ch.title, canEdit: crs.can_edit }); setPage(1); }}
                      >
                        <span>Chương: {ch.title}</span>
                        <span className="t-muted t-small tabular-nums">{ch.questions_count + ch.assignments_count + ch.resources_count}</span>
                      </button>

                      {ch.lessons.map((l) => (
                        <div key={l.id} style={{ paddingLeft: 12 }}>
                          <button
                            type="button"
                            className={`m-tree-node ${selected.level === 'LESSON' && selected.lessonId === l.id ? 'is-active' : ''}`}
                            onClick={() => {
                              setSelected({
                                level: 'LESSON',
                                courseId: crs.id,
                                topicId: tp.id,
                                chapterId: ch.id,
                                lessonId: l.id,
                                title: l.title,
                                canEdit: crs.can_edit,
                              });
                              setPage(1);
                            }}
                          >
                            <span>Bài: {l.title}</span>
                            <span className="t-muted t-small tabular-nums">
                              {l.questions_count}/{l.assignments_count}/{l.resources_count}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </aside>

        <div>
          <Tabs
            active={bankTab}
            onChange={(t) => { setBankTab(t as typeof bankTab); setPage(1); }}
            tabs={[
              { id: 'questions', label: 'Ngân hàng câu hỏi' },
              { id: 'assignments', label: 'Ngân hàng bài tập' },
              { id: 'resources', label: 'Ngân hàng tài nguyên' },
            ]}
          />

          <Card>
            <div className="t-toolbar" style={{ marginBottom: 12 }}>
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Tìm nội dung, tiêu đề, thẻ…" />
              <div className="t-actions">
                {bankTab === 'questions' && (
                  <>
                    <Btn small onClick={handleExportQuestions}>Xuất JSON</Btn>
                    <Btn small disabled={!canEditLeaf} onClick={() => setImportQuestionOpen(true)}>Import câu hỏi</Btn>
                    <Btn small variant="primary" disabled={!canEditLeaf} onClick={() => setCreateQuestionOpen(true)}>+ Thêm câu hỏi</Btn>
                  </>
                )}
                {bankTab === 'assignments' && (
                  <Btn small variant="primary" disabled={!canEditLeaf} onClick={() => setCreateAssignmentOpen(true)}>+ Thêm bài tập mẫu</Btn>
                )}
                {bankTab === 'resources' && (
                  <Btn small variant="primary" disabled={!canEditLeaf} onClick={() => setCreateResourceOpen(true)}>+ Thêm tài nguyên</Btn>
                )}
              </div>
            </div>

            {!isLeafLesson && (
              <div className="m-semantic-notice" style={{ marginBottom: 16 }}>
                Đang xem chế độ tổng hợp cho {selected.level === 'ALL' ? 'toàn bộ môn học' : selected.title}. Để tạo mới hoặc import học liệu, vui lòng chọn trực tiếp một <strong>Bài học (nút lá cuối cùng)</strong> ở cây bên trái.
              </div>
            )}

            {bankTab === 'questions' && (
              <>
                {questionsRes.loading && <Loading rows={4} />}
                {questionsRes.error && <ErrorState error={questionsRes.error} onRetry={questionsRes.reload} />}
                {questionsRes.data && questionsRes.data.items.length === 0 && (
                  <EmptyState title="Chưa có câu hỏi nào ở nút này" text={isLeafLesson ? 'Nhấn "+ Thêm câu hỏi" để tạo câu hỏi trực tiếp vào bài học này.' : 'Hãy chọn một bài học lá để thêm câu hỏi.'} />
                )}
                {questionsRes.data && questionsRes.data.items.length > 0 && (
                  <>
                    <div className="t-table-wrap">
                      <table className="t-table">
                        <thead>
                          <tr>
                            <th>Câu hỏi</th>
                            <th>Vị trí cây nội dung</th>
                            <th>Loại</th>
                            <th>Độ khó</th>
                            <th>Điểm</th>
                            <th>Cập nhật</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {questionsRes.data.items.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <strong>{item.prompt}</strong>
                                {item.explanation && <div className="t-small t-muted">{item.explanation}</div>}
                              </td>
                              <td className="t-small">
                                {item.course_code} › {item.chapter_title} › <strong>{item.lesson_title}</strong>
                              </td>
                              <td>{item.question_type}</td>
                              <td>{item.difficulty}</td>
                              <td className="tabular-nums">{item.points}</td>
                              <td className="tabular-nums">{fmtDateTime(item.updated_at)}</td>
                              <td className="t-right">
                                {selected.level === 'LESSON' && selected.canEdit && (
                                  <Btn
                                    small
                                    variant="ghost"
                                    onClick={async () => {
                                      await masterApi.deleteQuestionBankItem(item.id);
                                      push('Đã xóa câu hỏi khỏi ngân hàng', '', 'info');
                                      reloadAll();
                                    }}
                                  >
                                    Xóa
                                  </Btn>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={page} pageSize={questionsRes.data.page_size} total={questionsRes.data.total} onChange={setPage} />
                  </>
                )}
              </>
            )}

            {bankTab === 'assignments' && (
              <>
                {assignmentsRes.loading && <Loading rows={4} />}
                {assignmentsRes.error && <ErrorState error={assignmentsRes.error} onRetry={assignmentsRes.reload} />}
                {assignmentsRes.data && assignmentsRes.data.items.length === 0 && (
                  <EmptyState title="Chưa có bài tập mẫu nào ở nút này" />
                )}
                {assignmentsRes.data && assignmentsRes.data.items.length > 0 && (
                  <>
                    <div className="t-table-wrap">
                      <table className="t-table">
                        <thead>
                          <tr>
                            <th>Bài tập mẫu</th>
                            <th>Bài học gắn kết</th>
                            <th>Hình thức nộp</th>
                            <th>Thang điểm</th>
                            <th>Cập nhật</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignmentsRes.data.items.map((a) => (
                            <tr key={a.id}>
                              <td>
                                <strong>{a.title}</strong>
                                <div className="t-small t-muted">{a.description || a.instructions.slice(0, 90)}</div>
                              </td>
                              <td className="t-small">{a.course_code} › {a.lesson_title}</td>
                              <td>{a.submission_type}</td>
                              <td className="tabular-nums">{a.max_score}</td>
                              <td className="tabular-nums">{fmtDateTime(a.updated_at)}</td>
                              <td className="t-right">
                                {selected.level === 'LESSON' && selected.canEdit && (
                                  <Btn
                                    small
                                    variant="ghost"
                                    onClick={async () => {
                                      await masterApi.deleteAssignmentBankItem(a.id);
                                      push('Đã xóa bài tập mẫu', '', 'info');
                                      reloadAll();
                                    }}
                                  >
                                    Xóa
                                  </Btn>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={page} pageSize={assignmentsRes.data.page_size} total={assignmentsRes.data.total} onChange={setPage} />
                  </>
                )}
              </>
            )}

            {bankTab === 'resources' && (
              <>
                {resourcesRes.loading && <Loading rows={4} />}
                {resourcesRes.error && <ErrorState error={resourcesRes.error} onRetry={resourcesRes.reload} />}
                {resourcesRes.data && resourcesRes.data.items.length === 0 && (
                  <EmptyState title="Chưa có tài nguyên nào ở nút này" />
                )}
                {resourcesRes.data && resourcesRes.data.items.length > 0 && (
                  <>
                    <div className="t-table-wrap">
                      <table className="t-table">
                        <thead>
                          <tr>
                            <th>Tài nguyên</th>
                            <th>Loại</th>
                            <th>Bài học gắn kết</th>
                            <th>Liên kết / Tệp</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {resourcesRes.data.items.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <strong>{r.title}</strong>
                                {r.description && <div className="t-small t-muted">{r.description}</div>}
                              </td>
                              <td><Badge kind="course" value={r.resource_type === 'VIDEO' ? 'PUBLISHED' : 'DRAFT'}>{r.resource_type}</Badge></td>
                              <td className="t-small">{r.course_code} › {r.lesson_title || r.chapter_title}</td>
                              <td>
                                {r.url ? (
                                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="t-row-link">Mở liên kết</a>
                                ) : (r.file_name || 'Tệp nội bộ')}
                              </td>
                              <td className="t-right">
                                {selected.level === 'LESSON' && selected.canEdit && (
                                  <Btn
                                    small
                                    variant="ghost"
                                    onClick={async () => {
                                      await masterApi.deleteResourceBankItem(r.id);
                                      push('Đã xóa tài nguyên', '', 'info');
                                      reloadAll();
                                    }}
                                  >
                                    Xóa
                                  </Btn>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={page} pageSize={resourcesRes.data.page_size} total={resourcesRes.data.total} onChange={setPage} />
                  </>
                )}
              </>
            )}
          </Card>
        </div>
      </div>

      {createQuestionOpen && selected.level === 'LESSON' && (
        <CreateBankQuestionModal
          courseId={selected.courseId}
          lessonId={selected.lessonId}
          lessonTitle={selected.title}
          onClose={() => setCreateQuestionOpen(false)}
          onCreated={() => { setCreateQuestionOpen(false); push('Đã thêm câu hỏi vào bài học', '', 'success'); reloadAll(); }}
        />
      )}

      {importQuestionOpen && selected.level === 'LESSON' && (
        <ImportBankQuestionModal
          lessonId={selected.lessonId}
          lessonTitle={selected.title}
          onClose={() => setImportQuestionOpen(false)}
          onImported={(cnt) => { setImportQuestionOpen(false); push(`Đã import ${cnt} câu hỏi`, '', 'success'); reloadAll(); }}
        />
      )}

      {createAssignmentOpen && selected.level === 'LESSON' && (
        <CreateBankAssignmentModal
          courseId={selected.courseId}
          lessonId={selected.lessonId}
          lessonTitle={selected.title}
          onClose={() => setCreateAssignmentOpen(false)}
          onCreated={() => { setCreateAssignmentOpen(false); push('Đã thêm bài tập mẫu vào ngân hàng', '', 'success'); reloadAll(); }}
        />
      )}

      {createResourceOpen && selected.level === 'LESSON' && (
        <CreateBankResourceModal
          courseId={selected.courseId}
          lessonId={selected.lessonId}
          lessonTitle={selected.title}
          onClose={() => setCreateResourceOpen(false)}
          onCreated={() => { setCreateResourceOpen(false); push('Đã thêm tài nguyên vào bài học', '', 'success'); reloadAll(); }}
        />
      )}
    </div>
  );
};

const CreateBankQuestionModal: React.FC<{
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ courseId, lessonId, lessonTitle, onClose, onCreated }) => {
  const [questionType, setQuestionType] = useState<QuestionType>('SINGLE_CHOICE');
  const [prompt, setPrompt] = useState('');
  const [opt1, setOpt1] = useState('');
  const [opt2, setOpt2] = useState('');
  const [opt3, setOpt3] = useState('');
  const [opt4, setOpt4] = useState('');
  const [correctIdx, setCorrectIdx] = useState(0);
  const [boolAnswer, setBoolAnswer] = useState(true);
  const [acceptedTexts, setAcceptedTexts] = useState('');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');
  const [points, setPoints] = useState(1);
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        course_id: courseId,
        lesson_id: lessonId,
        node_level: 'LESSON',
        question_type: questionType,
        prompt: prompt.trim(),
        difficulty,
        points: Number(points) || 1,
        explanation: explanation.trim(),
      };
      if (questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') {
        const opts = [opt1, opt2, opt3, opt4]
          .map((t, i) => ({ id: `opt_${i + 1}`, text: t.trim(), is_correct: i === correctIdx }))
          .filter((o) => o.text);
        payload.options = opts;
        payload.answer_key = { correct_option_ids: [opts[correctIdx]?.id || opts[0]?.id] };
      } else if (questionType === 'TRUE_FALSE') {
        payload.answer_key = { boolean_answer: boolAnswer };
      } else if (questionType === 'FILL_BLANK') {
        payload.answer_key = { accepted_texts: acceptedTexts.split(',').map((s) => s.trim()).filter(Boolean) };
      } else {
        payload.answer_key = { manual_review: true, keywords: acceptedTexts.split(',').map((s) => s.trim()).filter(Boolean) };
      }
      await masterApi.createQuestionBankItem(payload);
      onCreated();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Thêm câu hỏi vào bài: ${lessonTitle}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="qb-create-form" loading={busy}>Lưu câu hỏi</Btn>
        </>
      }
    >
      <form id="qb-create-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Loại câu hỏi">
          <select className="t-input" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
            <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
            <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
            <option value="TRUE_FALSE">Đúng / Sai</option>
            <option value="FILL_BLANK">Điền khuyết</option>
            <option value="SHORT_ANSWER">Tự luận ngắn</option>
          </select>
        </Field>
        <Field label="Độ khó / Điểm">
          <div className="t-actions">
            <select className="t-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'EASY' | 'MEDIUM' | 'HARD')}>
              <option value="EASY">Dễ</option>
              <option value="MEDIUM">Trung bình</option>
              <option value="HARD">Khó</option>
            </select>
            <input type="number" min={1} max={100} className="t-input" style={{ width: 88 }} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </div>
        </Field>
        <Field label="Nội dung câu hỏi" required wide>
          <textarea className="t-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </Field>
        {(questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') && (
          <>
            {[
              { label: 'Đáp án A', val: opt1, set: setOpt1, idx: 0 },
              { label: 'Đáp án B', val: opt2, set: setOpt2, idx: 1 },
              { label: 'Đáp án C', val: opt3, set: setOpt3, idx: 2 },
              { label: 'Đáp án D', val: opt4, set: setOpt4, idx: 3 },
            ].map((o) => (
              <Field key={o.idx} label={o.label}>
                <div className="t-actions">
                  <input type="radio" name="correctOpt" checked={correctIdx === o.idx} onChange={() => setCorrectIdx(o.idx)} aria-label={`Chọn ${o.label} làm đáp án đúng`} />
                  <input className="t-input" value={o.val} onChange={(e) => o.set(e.target.value)} required={o.idx < 2} />
                </div>
              </Field>
            ))}
          </>
        )}
        {questionType === 'TRUE_FALSE' && (
          <Field label="Đáp án đúng" wide>
            <select className="t-input" value={boolAnswer ? 'true' : 'false'} onChange={(e) => setBoolAnswer(e.target.value === 'true')}>
              <option value="true">Đúng</option>
              <option value="false">Sai</option>
            </select>
          </Field>
        )}
        {(questionType === 'FILL_BLANK' || questionType === 'SHORT_ANSWER') && (
          <Field label="Đáp án / Từ khóa chấm (cách nhau bởi dấu phẩy)" wide>
            <input className="t-input" value={acceptedTexts} onChange={(e) => setAcceptedTexts(e.target.value)} required />
          </Field>
        )}
        <Field label="Giải thích đáp án" wide>
          <textarea className="t-input" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const ImportBankQuestionModal: React.FC<{
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
  onImported: (n: number) => void;
}> = ({ lessonId, lessonTitle, onClose, onImported }) => {
  const [rawJson, setRawJson] = useState(
    '[\n  {\n    "question_type": "TRUE_FALSE",\n    "prompt": "Phân số có mẫu bằng 0 là hợp lệ.",\n    "answer_key": { "boolean_answer": false },\n    "points": 1,\n    "difficulty": "EASY"\n  }\n]'
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const parsed = JSON.parse(rawJson);
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('JSON cần là một mảng các đối tượng câu hỏi.');
      }
      const res = await masterApi.importQuestionBank({ lesson_id: lessonId, node_level: 'LESSON', items });
      onImported(res.imported_count);
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Import JSON câu hỏi vào bài: ${lessonTitle}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="qb-import-form" loading={busy}>Import vào nút lá</Btn>
        </>
      }
    >
      <form id="qb-import-form" onSubmit={submit}>
        <Field label="Dán mảng JSON câu hỏi" required wide>
          <textarea className="t-input" rows={10} value={rawJson} onChange={(e) => setRawJson(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} required />
        </Field>
        {err && <p className="t-field__error" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const CreateBankAssignmentModal: React.FC<{
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ courseId, lessonId, lessonTitle, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submissionType, setSubmissionType] = useState<AssignmentSubmissionType>('MIXED');
  const [maxScore, setMaxScore] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await masterApi.createAssignmentBankItem({
        course_id: courseId,
        lesson_id: lessonId,
        node_level: 'LESSON',
        title: title.trim(),
        instructions: instructions.trim(),
        submission_type: submissionType,
        max_score: Number(maxScore) || 10,
      });
      onCreated();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Thêm bài tập mẫu vào bài: ${lessonTitle}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="ab-create-form" loading={busy}>Lưu bài tập mẫu</Btn>
        </>
      }
    >
      <form id="ab-create-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Tên bài tập mẫu" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Hình thức nộp">
          <select className="t-input" value={submissionType} onChange={(e) => setSubmissionType(e.target.value as AssignmentSubmissionType)}>
            <option value="MIXED">Tổng hợp (Bài viết + Link/Tệp)</option>
            <option value="TEXT">Văn bản trực tuyến</option>
            <option value="LINK">Liên kết (Link)</option>
            <option value="FILE">Tệp đính kèm</option>
          </select>
        </Field>
        <Field label="Điểm tối đa">
          <input type="number" min={1} max={1000} className="t-input" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} />
        </Field>
        <Field label="Hướng dẫn chi tiết cho học viên" required wide>
          <textarea className="t-input" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} required />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const CreateBankResourceModal: React.FC<{
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ courseId, lessonId, lessonTitle, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [resourceType, setResourceType] = useState<'LINK' | 'VIDEO' | 'PDF' | 'FILE'>('LINK');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await masterApi.createResourceBankItem({
        course_id: courseId,
        lesson_id: lessonId,
        node_level: 'LESSON',
        title: title.trim(),
        resource_type: resourceType,
        url: url.trim(),
        description: description.trim(),
      });
      onCreated();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Thêm tài nguyên vào bài: ${lessonTitle}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="rb-create-form" loading={busy}>Lưu tài nguyên</Btn>
        </>
      }
    >
      <form id="rb-create-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Tên tài nguyên" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Loại tài nguyên">
          <select className="t-input" value={resourceType} onChange={(e) => setResourceType(e.target.value as 'LINK' | 'VIDEO' | 'PDF' | 'FILE')}>
            <option value="LINK">Liên kết web</option>
            <option value="PDF">Tài liệu PDF</option>
            <option value="VIDEO">Video</option>
            <option value="FILE">Tài liệu khác</option>
          </select>
        </Field>
        <Field label="Đường dẫn URL (https://...)" required wide>
          <input type="url" className="t-input" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <Field label="Mô tả" wide>
          <textarea className="t-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};
