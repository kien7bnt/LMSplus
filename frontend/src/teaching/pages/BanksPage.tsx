/**
 * 3 Ngân hàng Học liệu đồng bộ tự động từ Cây nội dung 4 cấp:
 * Môn học -> Chủ đề -> Chương -> Bài học (nút lá cuối cùng).
 * Quy tắc cứng: Chỉ cho phép tạo / import ở nút lá Bài học (HTTP 400 LEAF_LESSON_REQUIRED ở backend).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AssignmentBankItem,
  AssignmentSubmissionType,
  BankQuestionRow,
  BankResourceItem,
  BankTreeCourse,
  QuestionType,
  masterApi,
  saveBlob,
  teachingApi,
} from '../api';
import {
  BankQuestionAttachment,
  BankQuestionPicker,
  mergeInstructionsWithQuestions,
} from '../components/BankQuestionPicker';
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
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
  fmtBytes,
  fmtDateTime,
  label,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

type LeafLessonOption = {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  topicId: string;
  topicTitle: string;
  chapterId: string;
  chapterTitle: string;
  lessonId: string;
  lessonTitle: string;
};

type SelectedNode =
  | { level: 'ALL' }
  | { level: 'COURSE'; courseId: string; title: string; canEdit: boolean }
  | { level: 'TOPIC'; courseId: string; topicId: string; title: string; canEdit: boolean }
  | { level: 'CHAPTER'; courseId: string; chapterId: string; title: string; canEdit: boolean }
  | { level: 'LESSON'; courseId: string; topicId: string; chapterId: string; lessonId: string; title: string; canEdit: boolean };

export const BanksPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCourseId = searchParams.get('course_id') || '';
  const initialLessonId = searchParams.get('lesson_id') || '';
  const rawTabParam = searchParams.get('tab');
  const activeTabFromUrl: 'questions' | 'assignments' | 'resources' =
    rawTabParam === 'assignments' || rawTabParam === 'resources' ? rawTabParam : 'questions';
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });

  const treeRes = useAsync(() => masterApi.getBanksTree(), []);
  const [selected, setSelected] = useState<SelectedNode>({ level: 'ALL' });
  const bankTab = activeTabFromUrl;
  const setBankTab = (nextTab: 'questions' | 'assignments' | 'resources') => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'questions') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);

  const [createQuestionOpen, setCreateQuestionOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<BankQuestionRow | null>(null);
  const [importQuestionOpen, setImportQuestionOpen] = useState(false);
  const [createAssignmentOpen, setCreateAssignmentOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentBankItem | null>(null);
  const [createResourceOpen, setCreateResourceOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<BankResourceItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);

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

  const editableCourseIds = useMemo(
    () => new Set((treeRes.data?.courses || []).filter((c) => c.can_edit).map((c) => c.id)),
    [treeRes.data]
  );

  const lessonOptions = useMemo<LeafLessonOption[]>(() => {
    const out: LeafLessonOption[] = [];
    for (const crs of treeRes.data?.courses || []) {
      if (!crs.can_edit) continue;
      for (const tp of crs.topics) {
        for (const ch of tp.chapters) {
          for (const l of ch.lessons) {
            out.push({
              courseId: crs.id,
              courseCode: crs.code,
              courseTitle: crs.title,
              topicId: tp.id,
              topicTitle: tp.title,
              chapterId: ch.id,
              chapterTitle: ch.title,
              lessonId: l.id,
              lessonTitle: l.title,
            });
          }
        }
      }
    }
    return out;
  }, [treeRes.data]);

  const scopedLessonOptions = useMemo(() => {
    if (selected.level === 'LESSON') {
      const exact = lessonOptions.filter((o) => o.lessonId === selected.lessonId);
      return exact.length > 0 ? exact : lessonOptions;
    }
    if (selected.level === 'CHAPTER') {
      const sub = lessonOptions.filter((o) => o.chapterId === selected.chapterId);
      return sub.length > 0 ? sub : lessonOptions;
    }
    if (selected.level === 'TOPIC') {
      const sub = lessonOptions.filter((o) => o.topicId === selected.topicId);
      return sub.length > 0 ? sub : lessonOptions;
    }
    if (selected.level === 'COURSE') {
      const sub = lessonOptions.filter((o) => o.courseId === selected.courseId);
      return sub.length > 0 ? sub : lessonOptions;
    }
    return lessonOptions;
  }, [lessonOptions, selected]);

  const isLeafLesson = selected.level === 'LESSON';
  const canCreateAny = lessonOptions.length > 0;
  const defaultModalLessonId = isLeafLesson ? selected.lessonId : scopedLessonOptions[0]?.lessonId || '';

  const handleDownloadBankResource = async (id: string, fallbackName: string) => {
    try {
      const result = await teachingApi.downloadResource(id);
      if ('url' in result && result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else if ('blob' in result) {
        saveBlob({ blob: result.blob, filename: result.filename || fallbackName || 'tai-nguyen' });
      }
    } catch (ex) {
      push('Không tải được tài nguyên', errMsg(ex), 'error');
    }
  };

  const reloadAll = () => {
    treeRes.reload();
    if (bankTab === 'questions') questionsRes.reload();
    if (bankTab === 'assignments') assignmentsRes.reload();
    if (bankTab === 'resources') resourcesRes.reload();
  };

  return (
    <div className="t-page">
      <PageHeader
        title="Ngân hàng học liệu 4 cấp"
        subtitle="Cây thư mục học liệu tự động sinh từ Cấu trúc Môn học & Giáo trình → Chủ đề → Chương → Bài học. Nhấp chọn cấp cha để xem tổng hợp; chọn Bài học (nút lá) để thêm hoặc import mới."
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
                    <Btn small disabled={!canCreateAny} onClick={() => setImportQuestionOpen(true)}>Import câu hỏi</Btn>
                    <Btn small variant="primary" disabled={!canCreateAny} onClick={() => setCreateQuestionOpen(true)}>+ Thêm câu hỏi</Btn>
                  </>
                )}
                {bankTab === 'assignments' && (
                  <Btn small variant="primary" disabled={!canCreateAny} onClick={() => setCreateAssignmentOpen(true)}>+ Thêm bài tập</Btn>
                )}
                {bankTab === 'resources' && (
                  <Btn small variant="primary" disabled={!canCreateAny} onClick={() => setCreateResourceOpen(true)}>+ Đẩy / Thêm tài nguyên</Btn>
                )}
              </div>
            </div>

            {!treeRes.loading && !canCreateAny ? (
              <div className="m-semantic-notice m-semantic-notice--warning" style={{ marginBottom: 16 }}>
                Chưa có bài học nào trong các môn học bạn phụ trách. Hãy tạo ít nhất 1 Chương và 1 Bài học trong <strong>Môn học & Giáo trình</strong> để gắn học liệu.
              </div>
            ) : !isLeafLesson && (
              <div className="m-semantic-notice" style={{ marginBottom: 16 }}>
                Đang xem tổng hợp cho <strong>{selected.level === 'ALL' ? 'toàn bộ giáo trình' : selected.title}</strong>. Nhấn nút thêm ở góc phải để tạo mới và chọn bài học gắn kết ngay trong hộp thoại (hoặc chọn bài học ở cây bên trái).
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
                            <th className="num">Điểm</th>
                            <th>Cập nhật</th>
                            <th className="actions">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {questionsRes.data.items.map((item) => (
                            <tr key={item.id}>
                              <td style={{ minWidth: 220 }}>
                                <strong>{item.prompt}</strong>
                                {item.explanation && <div className="t-small t-muted">{item.explanation}</div>}
                              </td>
                              <td className="t-small">
                                {item.course_code} › {item.chapter_title} › <strong>{item.lesson_title}</strong>
                              </td>
                              <td className="t-nowrap">{label('questionType', item.question_type)}</td>
                              <td><Badge kind="difficulty" value={item.difficulty} /></td>
                              <td className="num tabular-nums">{item.points}</td>
                              <td className="tabular-nums t-nowrap">{fmtDateTime(item.updated_at)}</td>
                              <td className="actions">
                                {Boolean(item.course_id && editableCourseIds.has(item.course_id)) && (
                                  <div className="t-actions">
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() => setEditingQuestion(item)}
                                    >
                                      Sửa
                                    </Btn>
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() =>
                                        setConfirmDelete({
                                          title: 'Xóa câu hỏi khỏi ngân hàng?',
                                          message: `Bạn sắp xóa câu hỏi "${item.prompt.slice(0, 80)}". Hành động này không thể hoàn tác.`,
                                          onConfirm: async () => {
                                            try {
                                              await masterApi.deleteQuestionBankItem(item.id);
                                              setConfirmDelete(null);
                                              push('Đã xóa câu hỏi khỏi ngân hàng', '', 'info');
                                              reloadAll();
                                            } catch (ex) {
                                              push('Không xóa được câu hỏi', errMsg(ex), 'error');
                                            }
                                          },
                                        })
                                      }
                                    >
                                      Xóa
                                    </Btn>
                                  </div>
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
                            <th className="num">Thang điểm</th>
                            <th>Cập nhật</th>
                            <th className="actions">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignmentsRes.data.items.map((a) => (
                            <tr key={a.id}>
                              <td style={{ minWidth: 200 }}>
                                <strong>{a.title}</strong>
                                <div className="t-small t-muted">{a.description || a.instructions.slice(0, 90)}</div>
                              </td>
                              <td className="t-small">{a.course_code} › {a.lesson_title}</td>
                              <td className="t-nowrap">{label('submissionType', a.submission_type)}</td>
                              <td className="num tabular-nums">{a.max_score}</td>
                              <td className="tabular-nums t-nowrap">{fmtDateTime(a.updated_at)}</td>
                              <td className="actions">
                                {editableCourseIds.has(a.course_id) && (
                                  <div className="t-actions">
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() => setEditingAssignment(a)}
                                    >
                                      Sửa
                                    </Btn>
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() =>
                                        setConfirmDelete({
                                          title: `Xóa bài tập mẫu "${a.title}"?`,
                                          message: 'Bài tập mẫu sẽ bị xóa khỏi ngân hàng môn học.',
                                          onConfirm: async () => {
                                            try {
                                              await masterApi.deleteAssignmentBankItem(a.id);
                                              setConfirmDelete(null);
                                              push('Đã xóa bài tập mẫu', '', 'info');
                                              reloadAll();
                                            } catch (ex) {
                                              push('Không xóa được bài tập mẫu', errMsg(ex), 'error');
                                            }
                                          },
                                        })
                                      }
                                    >
                                      Xóa
                                    </Btn>
                                  </div>
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
                            <th className="actions">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resourcesRes.data.items.map((r) => (
                            <tr key={r.id}>
                              <td style={{ minWidth: 180 }}>
                                <strong>{r.title}</strong>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                  <Badge kind="resourceUsage" value={r.usage_type || 'MANDATORY'} />
                                  {(r.tags || []).map((tg) => (
                                    <span key={tg} className="t-badge t-badge--neutral">{tg}</span>
                                  ))}
                                </div>
                                {r.description && <div className="t-small t-muted">{r.description}</div>}
                              </td>
                              <td><Badge kind="course" value={r.resource_type === 'VIDEO' ? 'PUBLISHED' : 'DRAFT'}>{r.resource_type}</Badge></td>
                              <td className="t-small">{r.course_code} › {r.lesson_title || r.chapter_title}</td>
                              <td>
                                {r.url ? (
                                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="t-row-link t-nowrap">Mở liên kết</a>
                                ) : (
                                  <Btn
                                    small
                                    variant="ghost"
                                    onClick={() => handleDownloadBankResource(r.id, r.file_name || r.title)}
                                  >
                                    Tải về: {r.file_name || 'Tệp'}
                                    {r.file_size_bytes ? ` (${fmtBytes(r.file_size_bytes)})` : ''}
                                  </Btn>
                                )}
                              </td>
                              <td className="actions">
                                {editableCourseIds.has(r.course_id) && (
                                  <div className="t-actions">
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() => setEditingResource(r)}
                                    >
                                      Sửa
                                    </Btn>
                                    <Btn
                                      small
                                      variant="ghost"
                                      onClick={() =>
                                        setConfirmDelete({
                                          title: `Xóa tài nguyên "${r.title}"?`,
                                          message: 'Tài nguyên sẽ bị gỡ khỏi danh mục ngân hàng học liệu.',
                                          onConfirm: async () => {
                                            try {
                                              await masterApi.deleteResourceBankItem(r.id);
                                              setConfirmDelete(null);
                                              push('Đã xóa tài nguyên', '', 'info');
                                              reloadAll();
                                            } catch (ex) {
                                              push('Không xóa được tài nguyên', errMsg(ex), 'error');
                                            }
                                          },
                                        })
                                      }
                                    >
                                      Xóa
                                    </Btn>
                                  </div>
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

      {(createQuestionOpen || editingQuestion) && canCreateAny && (
        <CreateBankQuestionModal
          options={editingQuestion ? lessonOptions.filter((o) => o.courseId === editingQuestion.course_id) : scopedLessonOptions}
          defaultLessonId={editingQuestion?.lesson_id || defaultModalLessonId}
          existing={editingQuestion}
          onClose={() => { setCreateQuestionOpen(false); setEditingQuestion(null); }}
          onSaved={() => {
            const wasEdit = Boolean(editingQuestion);
            setCreateQuestionOpen(false);
            setEditingQuestion(null);
            push(wasEdit ? 'Đã cập nhật câu hỏi' : 'Đã thêm câu hỏi vào ngân hàng', '', 'success');
            reloadAll();
          }}
        />
      )}

      {importQuestionOpen && canCreateAny && (
        <ImportBankQuestionModal
          options={scopedLessonOptions}
          defaultLessonId={defaultModalLessonId}
          onClose={() => setImportQuestionOpen(false)}
          onImported={(cnt) => { setImportQuestionOpen(false); push(`Đã import ${cnt} câu hỏi`, '', 'success'); reloadAll(); }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.title}
          message={confirmDelete.message}
          confirmLabel="Xác nhận xóa"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={confirmDelete.onConfirm}
        />
      )}

      {(createAssignmentOpen || editingAssignment) && canCreateAny && (
        <CreateBankAssignmentModal
          options={editingAssignment ? lessonOptions.filter((o) => o.courseId === editingAssignment.course_id) : scopedLessonOptions}
          defaultLessonId={editingAssignment?.lesson_id || defaultModalLessonId}
          existing={editingAssignment}
          onClose={() => { setCreateAssignmentOpen(false); setEditingAssignment(null); }}
          onSaved={() => {
            const wasEdit = Boolean(editingAssignment);
            setCreateAssignmentOpen(false);
            setEditingAssignment(null);
            push(wasEdit ? 'Đã cập nhật bài tập mẫu' : 'Đã thêm bài tập vào ngân hàng', '', 'success');
            reloadAll();
          }}
        />
      )}

      {(createResourceOpen || editingResource) && canCreateAny && (
        <CreateBankResourceModal
          options={editingResource ? lessonOptions.filter((o) => o.courseId === editingResource.course_id) : scopedLessonOptions}
          defaultLessonId={editingResource?.lesson_id || defaultModalLessonId}
          existing={editingResource}
          onClose={() => { setCreateResourceOpen(false); setEditingResource(null); }}
          onSaved={() => {
            const wasEdit = Boolean(editingResource);
            setCreateResourceOpen(false);
            setEditingResource(null);
            push(wasEdit ? 'Đã cập nhật tài nguyên' : 'Đã lưu tài nguyên vào ngân hàng', '', 'success');
            reloadAll();
          }}
        />
      )}
    </div>
  );
};

const LessonTargetSelect: React.FC<{
  options: LeafLessonOption[];
  value: string;
  onChange: (lessonId: string) => void;
}> = ({ options, value, onChange }) => {
  const active = useMemo(
    () => options.find((o) => o.lessonId === value) || options[0] || null,
    [options, value]
  );

  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    options.forEach((o) => {
      if (!seen.has(o.courseId)) seen.set(o.courseId, `${o.courseCode} — ${o.courseTitle}`);
    });
    return Array.from(seen.entries()).map(([courseId, label]) => ({ courseId, label }));
  }, [options]);

  const inCourse = useMemo(
    () => (active ? options.filter((o) => o.courseId === active.courseId) : []),
    [options, active]
  );

  const chapters = useMemo(() => {
    const topicCount = new Set(inCourse.map((o) => o.topicTitle)).size;
    const seen = new Map<string, string>();
    inCourse.forEach((o) => {
      const key = `${o.topicTitle}\0${o.chapterTitle}`;
      if (!seen.has(key)) {
        seen.set(key, topicCount > 1 ? `${o.topicTitle} › ${o.chapterTitle}` : o.chapterTitle);
      }
    });
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [inCourse]);

  const activeChapterKey = active ? `${active.topicTitle}\0${active.chapterTitle}` : '';
  const inChapter = useMemo(
    () => inCourse.filter((o) => `${o.topicTitle}\0${o.chapterTitle}` === activeChapterKey),
    [inCourse, activeChapterKey]
  );

  if (!active) {
    return (
      <Field label="Bài học gắn kết" required wide>
        <input className="t-input" value="Chưa có bài học nào trong giáo trình" disabled readOnly />
      </Field>
    );
  }

  return (
    <div className="t-field t-field--wide" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="t-field__label">
        Bài học gắn kết <span className="t-field__req">*</span>
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="t-sub">Giáo trình</span>
          <select
            className="t-input"
            aria-label="Chọn giáo trình"
            value={active.courseId}
            onChange={(e) => {
              const next = options.find((o) => o.courseId === e.target.value);
              if (next) onChange(next.lessonId);
            }}
          >
            {courses.map((c) => (
              <option key={c.courseId} value={c.courseId}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="t-sub">Chương</span>
          <select
            className="t-input"
            aria-label="Chọn chương"
            value={activeChapterKey}
            onChange={(e) => {
              const next = inCourse.find((o) => `${o.topicTitle}\0${o.chapterTitle}` === e.target.value);
              if (next) onChange(next.lessonId);
            }}
          >
            {chapters.map((ch) => (
              <option key={ch.key} value={ch.key}>{ch.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="t-sub">Bài học</span>
          <select
            className="t-input"
            aria-label="Chọn bài học"
            value={active.lessonId}
            onChange={(e) => onChange(e.target.value)}
            required
          >
            {inChapter.map((ls) => (
              <option key={ls.lessonId} value={ls.lessonId}>{ls.lessonTitle}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};

const CreateBankQuestionModal: React.FC<{
  options: LeafLessonOption[];
  defaultLessonId: string;
  existing?: BankQuestionRow | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ options, defaultLessonId, existing, onClose, onSaved }) => {
  const existingOpts = Array.isArray(existing?.options) ? existing!.options : [];
  const existingCorrectIds = new Set<string>(
    Array.isArray(existing?.answer_key?.correct_option_ids)
      ? existing!.answer_key!.correct_option_ids.map(String)
      : existingOpts.filter((o) => o.is_correct).map((o) => o.id)
  );
  const initialCorrectIndices = existingOpts
    .map((o, idx) => (existingCorrectIds.has(o.id) ? idx : -1))
    .filter((idx) => idx >= 0);

  const [lessonId, setLessonId] = useState(existing?.lesson_id || defaultLessonId || options[0]?.lessonId || '');
  const picked = options.find((o) => o.lessonId === lessonId) || options[0];
  const [questionType, setQuestionType] = useState<QuestionType>(existing?.question_type || 'SINGLE_CHOICE');
  const [prompt, setPrompt] = useState(existing?.prompt || '');
  const [opt1, setOpt1] = useState(existingOpts[0]?.text || '');
  const [opt2, setOpt2] = useState(existingOpts[1]?.text || '');
  const [opt3, setOpt3] = useState(existingOpts[2]?.text || '');
  const [opt4, setOpt4] = useState(existingOpts[3]?.text || '');
  const [correctIdx, setCorrectIdx] = useState(initialCorrectIndices[0] ?? 0);
  const [correctMulti, setCorrectMulti] = useState<number[]>(initialCorrectIndices.length ? initialCorrectIndices : [0]);
  const [boolAnswer, setBoolAnswer] = useState(
    existing?.answer_key?.boolean_answer !== undefined ? Boolean(existing.answer_key.boolean_answer) : true
  );
  const [acceptedTexts, setAcceptedTexts] = useState(() => {
    const arr = existing?.answer_key?.accepted_texts || existing?.answer_key?.keywords || [];
    return Array.isArray(arr) ? arr.join(', ') : '';
  });
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>(existing?.difficulty || 'MEDIUM');
  const [points, setPoints] = useState(Number(existing?.points ?? 1));
  const [explanation, setExplanation] = useState(existing?.explanation || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleMultiIdx = (idx: number) => {
    setCorrectMulti((prev) =>
      prev.includes(idx) ? (prev.length > 1 ? prev.filter((x) => x !== idx) : prev) : [...prev, idx]
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        course_id: picked.courseId,
        lesson_id: picked.lessonId,
        node_level: 'LESSON',
        question_type: questionType,
        prompt: prompt.trim(),
        difficulty,
        points: Number(points) || 1,
        explanation: explanation.trim(),
      };
      if (questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') {
        const activeIndices = questionType === 'MULTIPLE_CHOICE' ? correctMulti : [correctIdx];
        const opts = [opt1, opt2, opt3, opt4]
          .map((t, i) => ({ id: existingOpts[i]?.id || `opt_${i + 1}`, text: t.trim(), is_correct: activeIndices.includes(i) }))
          .filter((o) => o.text);
        const correctIds = opts.filter((o) => o.is_correct).map((o) => o.id);
        payload.options = opts;
        payload.answer_key = { correct_option_ids: correctIds.length ? correctIds : [opts[0]?.id] };
      } else if (questionType === 'TRUE_FALSE') {
        payload.answer_key = { boolean_answer: boolAnswer };
      } else if (questionType === 'FILL_BLANK') {
        payload.answer_key = { accepted_texts: acceptedTexts.split(',').map((s) => s.trim()).filter(Boolean) };
      } else {
        payload.answer_key = { manual_review: true, keywords: acceptedTexts.split(',').map((s) => s.trim()).filter(Boolean) };
      }
      if (existing) {
        await masterApi.updateQuestionBankItem(existing.id, payload);
      } else {
        await masterApi.createQuestionBankItem(payload);
      }
      onSaved();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Chỉnh sửa câu hỏi trong ngân hàng' : 'Thêm câu hỏi vào ngân hàng'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="qb-create-form" loading={busy}>
            {existing ? 'Cập nhật câu hỏi' : 'Lưu câu hỏi'}
          </Btn>
        </>
      }
    >
      <form id="qb-create-form" className="t-form-grid" onSubmit={submit}>
        <LessonTargetSelect options={options} value={lessonId} onChange={setLessonId} />

        <div
          className="t-field--wide"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}
        >
          <Field label="Loại câu hỏi">
            <select className="t-input" value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
              <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
              <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
              <option value="TRUE_FALSE">Đúng / Sai</option>
              <option value="FILL_BLANK">Điền khuyết</option>
              <option value="SHORT_ANSWER">Tự luận ngắn</option>
            </select>
          </Field>
          <Field label="Độ khó">
            <select className="t-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'EASY' | 'MEDIUM' | 'HARD')}>
              <option value="EASY">Dễ</option>
              <option value="MEDIUM">Trung bình</option>
              <option value="HARD">Khó</option>
            </select>
          </Field>
          <Field label="Điểm">
            <input type="number" min={1} max={100} className="t-input tabular-nums" value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </Field>
        </div>

        <Field label="Nội dung câu hỏi" required wide>
          <textarea className="t-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Nhập đề bài hoặc câu hỏi..." required />
        </Field>

        {(questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') && (
          <div className="t-field t-field--wide">
            <span className="t-field__label">
              Các lựa chọn ({questionType === 'MULTIPLE_CHOICE' ? 'tick chọn nhiều đáp án đúng' : 'chọn 1 đáp án đúng'})
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { key: 'A', val: opt1, set: setOpt1, idx: 0 },
                { key: 'B', val: opt2, set: setOpt2, idx: 1 },
                { key: 'C', val: opt3, set: setOpt3, idx: 2 },
                { key: 'D', val: opt4, set: setOpt4, idx: 3 },
              ].map((o) => {
                const isSelected = questionType === 'MULTIPLE_CHOICE' ? correctMulti.includes(o.idx) : correctIdx === o.idx;
                return (
                  <div
                    key={o.idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--accent-learning)' : 'var(--border-subtle)'}`,
                      background: isSelected ? 'var(--accent-learning-tint)' : 'var(--bg-surface-subtle)',
                    }}
                  >
                    {questionType === 'MULTIPLE_CHOICE' ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMultiIdx(o.idx)}
                        style={{ width: 20, height: 20, accentColor: 'var(--accent-learning)', flexShrink: 0, cursor: 'pointer' }}
                        aria-label={`Chọn đáp án ${o.key} làm đáp án đúng`}
                      />
                    ) : (
                      <input
                        type="radio"
                        name="correctOpt"
                        checked={isSelected}
                        onChange={() => setCorrectIdx(o.idx)}
                        style={{ width: 20, height: 20, accentColor: 'var(--accent-learning)', flexShrink: 0, cursor: 'pointer' }}
                        aria-label={`Chọn đáp án ${o.key} làm đáp án đúng`}
                      />
                    )}
                    <strong style={{ width: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {o.key}
                    </strong>
                    <input
                      className="t-input"
                      style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)' }}
                      value={o.val}
                      onChange={(e) => o.set(e.target.value)}
                      placeholder={`Nhập nội dung đáp án ${o.key}${o.idx < 2 ? ' (bắt buộc)' : ' (tùy chọn)'}`}
                      required={o.idx < 2}
                    />
                    {isSelected && (
                      <span className="t-badge t-badge--success" style={{ flexShrink: 0 }}>
                        Đáp án đúng
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
          <Field
            label={questionType === 'SHORT_ANSWER' ? 'Từ khóa gợi ý (tùy chọn, để trống nếu chấm tay)' : 'Đáp án chấp nhận (cách nhau bởi dấu phẩy)'}
            required={questionType === 'FILL_BLANK'}
            wide
          >
            <input className="t-input" value={acceptedTexts} onChange={(e) => setAcceptedTexts(e.target.value)} required={questionType === 'FILL_BLANK'} />
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

const SAMPLE_QB_CSV = [
  'question_type,prompt,options_pipe,answer,points,difficulty,explanation',
  'TRUE_FALSE,"Phân số có mẫu bằng 0 là hợp lệ.", "",false,1,EASY,"Mẫu số phải luôn khác 0."',
  'SINGLE_CHOICE,"2 + 3 x 4 bằng bao nhiêu?","20|14|24|10",1,2,MEDIUM,"Nhân chia trước, cộng trừ sau."',
].join('\n');

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseQuestionsInput(mode: 'JSON' | 'CSV', raw: string): {
  items: Array<Record<string, unknown>>;
  errors: Array<{ row: number; message: string }>;
  duplicates: number;
} {
  const errors: Array<{ row: number; message: string }> = [];
  const items: Array<Record<string, unknown>> = [];
  const seenPrompts = new Set<string>();
  let duplicates = 0;

  if (mode === 'JSON') {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(list)) throw new Error('JSON cần là một mảng các đối tượng câu hỏi.');
    list.forEach((entry, idx) => {
      const prompt = String(entry?.prompt || '').trim();
      if (!prompt) {
        errors.push({ row: idx + 1, message: 'Thiếu nội dung câu hỏi (prompt).' });
        return;
      }
      const norm = prompt.toLowerCase();
      if (seenPrompts.has(norm)) {
        duplicates++;
        return;
      }
      seenPrompts.add(norm);
      items.push(entry);
    });
    return { items, errors, duplicates };
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { items: [], errors: [{ row: 1, message: 'CSV cần có dòng tiêu đề và ít nhất 1 dòng câu hỏi.' }], duplicates: 0 };
  }
  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const idxOf = (name: string) => headers.indexOf(name);
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvRow(lines[r]);
    const rowNum = r + 1;
    const qType = String(cols[idxOf('question_type')] || 'SINGLE_CHOICE').toUpperCase();
    const prompt = String(cols[idxOf('prompt')] || '').trim();
    if (!prompt) {
      errors.push({ row: rowNum, message: 'Thiếu cột prompt.' });
      continue;
    }
    const norm = prompt.toLowerCase();
    if (seenPrompts.has(norm)) {
      duplicates++;
      continue;
    }
    seenPrompts.add(norm);
    const optsPipe = String(cols[idxOf('options_pipe')] || '').trim();
    const ansRaw = String(cols[idxOf('answer')] || '').trim();
    const points = Number(cols[idxOf('points')] || 1) || 1;
    const difficulty = String(cols[idxOf('difficulty')] || 'MEDIUM').toUpperCase();
    const explanation = String(cols[idxOf('explanation')] || '').trim();

    let options: Array<{ id: string; text: string }> | undefined;
    let answer_key: Record<string, unknown> = {};
    if (qType === 'TRUE_FALSE') {
      answer_key = { boolean_answer: ansRaw.toLowerCase() === 'true' || ansRaw === '1' || ansRaw.toLowerCase() === 'đúng' };
    } else if (qType === 'SINGLE_CHOICE' || qType === 'MULTIPLE_CHOICE') {
      const labels = optsPipe.split('|').map((s) => s.trim()).filter(Boolean);
      if (labels.length < 2) {
        errors.push({ row: rowNum, message: 'Câu trắc nghiệm cần tối thiểu 2 lựa chọn (ngăn bởi "|").' });
        continue;
      }
      options = labels.map((t, oi) => ({ id: `opt_${oi}`, text: t }));
      if (qType === 'SINGLE_CHOICE') {
        const pickIdx = Number(ansRaw);
        const selId = Number.isInteger(pickIdx) && options[pickIdx] ? options[pickIdx].id : options[0].id;
        answer_key = { correct_option_id: selId };
      } else {
        const picks = ansRaw.split('|').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && options![n]);
        answer_key = { correct_option_ids: picks.map((p) => options![p].id) };
      }
    } else if (qType === 'FILL_BLANK' || qType === 'SHORT_ANSWER') {
      answer_key = { accepted_answers: ansRaw.split('|').map((s) => s.trim()).filter(Boolean) };
    } else {
      errors.push({ row: rowNum, message: `Loại câu hỏi "${qType}" không hợp lệ.` });
      continue;
    }
    items.push({ question_type: qType, prompt, options, answer_key, points, difficulty, explanation });
  }
  return { items, errors, duplicates };
}

const ImportBankQuestionModal: React.FC<{
  options: LeafLessonOption[];
  defaultLessonId: string;
  onClose: () => void;
  onImported: (n: number) => void;
}> = ({ options, defaultLessonId, onClose, onImported }) => {
  const [lessonId, setLessonId] = useState(defaultLessonId || options[0]?.lessonId || '');
  const [mode, setMode] = useState<'CSV' | 'JSON'>('JSON');
  const [rawInput, setRawInput] = useState(
    '[\n  {\n    "question_type": "TRUE_FALSE",\n    "prompt": "Phân số có mẫu bằng 0 là hợp lệ.",\n    "answer_key": { "boolean_answer": false },\n    "points": 1,\n    "difficulty": "EASY"\n  }\n]'
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => {
    try {
      return { ok: true as const, ...parseQuestionsInput(mode, rawInput) };
    } catch (e) {
      return { ok: false as const, errorMsg: errMsg(e), items: [], errors: [], duplicates: 0 };
    }
  }, [mode, rawInput]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lessonId || !preview.ok || preview.items.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await masterApi.importQuestionBank({ lesson_id: lessonId, node_level: 'LESSON', items: preview.items });
      onImported(res.imported_count);
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import câu hỏi (CSV / JSON) vào Ngân hàng"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn
            variant="primary"
            type="submit"
            form="qb-import-form"
            loading={busy}
            disabled={!preview.ok || preview.items.length === 0}
          >
            Import {preview.ok ? preview.items.length : 0} câu hợp lệ
          </Btn>
        </>
      }
    >
      <form id="qb-import-form" className="t-form-grid" onSubmit={submit}>
        <LessonTargetSelect options={options} value={lessonId} onChange={setLessonId} />
        <div className="t-field--wide" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn
            small
            variant={mode === 'JSON' ? 'primary' : 'secondary'}
            onClick={() => { setMode('JSON'); setRawInput('[\n  {\n    "question_type": "TRUE_FALSE",\n    "prompt": "Phân số có mẫu bằng 0 là hợp lệ.",\n    "answer_key": { "boolean_answer": false },\n    "points": 1,\n    "difficulty": "EASY"\n  }\n]'); }}
          >
            Định dạng JSON
          </Btn>
          <Btn
            small
            variant={mode === 'CSV' ? 'primary' : 'secondary'}
            onClick={() => { setMode('CSV'); setRawInput(SAMPLE_QB_CSV); }}
          >
            Định dạng CSV
          </Btn>
          <label className="t-btn t-btn--small" style={{ cursor: 'pointer', minHeight: 44 }}>
            Chọn tệp {mode}
            <input
              type="file"
              accept={mode === 'CSV' ? '.csv,.txt' : '.json'}
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setRawInput(await f.text());
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <Field label={`Dán dữ liệu ${mode} câu hỏi`} required wide>
          <textarea
            className="t-input"
            rows={8}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)' }}
            required
          />
        </Field>
        <div className="t-field--wide m-semantic-notice">
          {!preview.ok ? (
            <span style={{ color: 'var(--status-danger)' }}>Lỗi cú pháp: {preview.errorMsg}</span>
          ) : (
            <div>
              <strong>Xem trước kiểm tra dữ liệu:</strong>{' '}
              <span className="tabular-nums">{preview.items.length}</span> câu hợp lệ ·{' '}
              <span className="tabular-nums">{preview.duplicates}</span> câu trùng lặp đã lọc ·{' '}
              <span className="tabular-nums">{preview.errors.length}</span> dòng lỗi
              {preview.errors.length > 0 && (
                <ul className="t-small" style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--status-danger)' }}>
                  {preview.errors.slice(0, 8).map((er) => (
                    <li key={er.row}>Dòng {er.row}: {er.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const CreateBankAssignmentModal: React.FC<{
  options: LeafLessonOption[];
  defaultLessonId: string;
  existing?: AssignmentBankItem | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ options, defaultLessonId, existing, onClose, onSaved }) => {
  const existingAttachments = useMemo<BankQuestionAttachment[]>(() => {
    if (!Array.isArray(existing?.attachments)) return [];
    return existing!.attachments
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object' && 'prompt' in a))
      .map((a) => a as unknown as BankQuestionAttachment);
  }, [existing]);

  const [lessonId, setLessonId] = useState(existing?.lesson_id || defaultLessonId || options[0]?.lessonId || '');
  const picked = options.find((o) => o.lessonId === lessonId) || options[0];
  const [title, setTitle] = useState(existing?.title || '');
  const [instructions, setInstructions] = useState(existing?.instructions || '');
  const [submissionType, setSubmissionType] = useState<AssignmentSubmissionType>(existing?.submission_type || 'MIXED');
  const [maxScore, setMaxScore] = useState(Number(existing?.max_score ?? 10));
  const [relativeDueDays, setRelativeDueDays] = useState(
    existing?.relative_due_days !== null && existing?.relative_due_days !== undefined ? Number(existing.relative_due_days) : 7
  );
  const [isMandatory, setIsMandatory] = useState(existing ? Boolean(existing.is_mandatory) : true);
  const [maxScoreTouched, setMaxScoreTouched] = useState(Boolean(existing));
  const [selectedQuestions, setSelectedQuestions] = useState<BankQuestionAttachment[]>(existingAttachments);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleLessonChange = (nextLessonId: string) => {
    const nextOption = options.find((o) => o.lessonId === nextLessonId);
    if (nextOption && picked && nextOption.courseId !== picked.courseId) {
      setSelectedQuestions([]);
    }
    setLessonId(nextLessonId);
  };

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    const finalInstructions = existing
      ? instructions.trim() || mergeInstructionsWithQuestions('', selectedQuestions)
      : mergeInstructionsWithQuestions(instructions, selectedQuestions);
    if (!finalInstructions) {
      setErr('Vui lòng nhập hướng dẫn hoặc chọn ít nhất 1 câu hỏi từ ngân hàng.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        course_id: picked.courseId,
        lesson_id: picked.lessonId,
        node_level: 'LESSON',
        title: title.trim(),
        instructions: finalInstructions,
        submission_type: submissionType,
        max_score: Number(maxScore) || 10,
        relative_due_days: Number(relativeDueDays) || null,
        is_mandatory: isMandatory,
        attachments: selectedQuestions as unknown as Array<Record<string, unknown>>,
      };
      if (existing) {
        await masterApi.updateAssignmentBankItem(existing.id, payload);
      } else {
        await masterApi.createAssignmentBankItem(payload);
      }
      onSaved();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Chỉnh sửa bài tập mẫu' : 'Thêm bài tập vào ngân hàng'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="ab-create-form" loading={busy}>
            {existing ? 'Cập nhật bài tập' : 'Lưu bài tập'}
          </Btn>
        </>
      }
    >
      <form id="ab-create-form" className="t-form-grid" onSubmit={submit}>
        <LessonTargetSelect options={options} value={lessonId} onChange={handleLessonChange} />
        <Field label="Tên bài tập" required wide>
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
          <input
            type="number"
            min={1}
            max={1000}
            className="t-input tabular-nums"
            value={maxScore}
            onChange={(e) => {
              setMaxScoreTouched(true);
              setMaxScore(Number(e.target.value));
            }}
          />
        </Field>
        <Field label="Hạn nộp tương đối (ngày sau buổi học)" hint="Quy ra ngày cụ thể khi công bố TKB">
          <input
            type="number"
            min={0}
            max={90}
            className="t-input tabular-nums"
            value={relativeDueDays}
            onChange={(e) => setRelativeDueDays(Number(e.target.value))}
          />
        </Field>
        <Field label="Tính chất bài tập">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
            <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} />
            <span>Bài tập bắt buộc (điều kiện dự thi)</span>
          </label>
        </Field>
        <BankQuestionPicker
          courseId={picked?.courseId}
          lessonId={picked?.lessonId}
          selected={selectedQuestions}
          onChange={handleQuestionsChange}
          onInsertPrompt={handleInsertPrompt}
        />
        <Field label="Hướng dẫn chi tiết cho học viên" required={selectedQuestions.length === 0} wide>
          <textarea
            className="t-input"
            rows={4}
            placeholder={
              selectedQuestions.length > 0
                ? 'Nhập thêm ghi chú cho học viên (nội dung câu hỏi đã chọn sẽ được tự động đính kèm khi lưu)...'
                : 'Nhập yêu cầu và hướng dẫn làm bài cho học viên...'
            }
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required={selectedQuestions.length === 0}
          />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      resolve(res.includes(',') ? res.split(',').pop() || '' : res);
    };
    reader.onerror = () => reject(new Error('Không đọc được tệp đã chọn.'));
    reader.readAsDataURL(file);
  });

const CreateBankResourceModal: React.FC<{
  options: LeafLessonOption[];
  defaultLessonId: string;
  existing?: BankResourceItem | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ options, defaultLessonId, existing, onClose, onSaved }) => {
  const isEditing = Boolean(existing);
  const isExternalExisting = Boolean(existing?.url);
  const [lessonId, setLessonId] = useState(existing?.lesson_id || defaultLessonId || options[0]?.lessonId || '');
  const picked = options.find((o) => o.lessonId === lessonId) || options[0];
  const [mode, setMode] = useState<'UPLOAD' | 'LINK'>(isExternalExisting ? 'LINK' : 'UPLOAD');
  const [title, setTitle] = useState(existing?.title || '');
  const [resourceType, setResourceType] = useState<'LINK' | 'VIDEO' | 'PDF' | 'FILE'>(
    (existing?.resource_type as 'LINK' | 'VIDEO' | 'PDF' | 'FILE') || 'PDF'
  );
  const [url, setUrl] = useState(existing?.url || '');
  const [file, setFile] = useState<File | null>(null);
  const [usageType, setUsageType] = useState<'MANDATORY' | 'REFERENCE'>(existing?.usage_type || 'MANDATORY');
  const [tagInput, setTagInput] = useState((existing?.tags || []).join(', '));
  const [description, setDescription] = useState(existing?.description || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFilePick = (f: File | null) => {
    setErr(null);
    setFile(f);
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      setErr('Tệp vượt quá giới hạn 15 MB.');
      return;
    }
    const baseName = f.name.replace(/\.[^.]+$/, '');
    if (!title.trim()) setTitle(baseName);
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') setResourceType('PDF');
    else if (ext === 'mp4' || ext === 'webm') setResourceType('VIDEO');
    else setResourceType('FILE');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setErr(null);
    if (!isEditing && mode === 'UPLOAD') {
      if (!file) {
        setErr('Vui lòng chọn tệp tài liệu từ máy.');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setErr('Tệp vượt quá giới hạn 15 MB.');
        return;
      }
    }
    setBusy(true);
    try {
      const parsedTags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
      if (existing) {
        const patch: Record<string, unknown> = {
          lesson_id: picked.lessonId,
          node_level: 'LESSON',
          title: title.trim(),
          usage_type: usageType,
          tags: parsedTags,
          description: description.trim(),
        };
        if (isExternalExisting) {
          patch.resource_type = resourceType;
          patch.url = url.trim();
        }
        await masterApi.updateResourceBankItem(existing.id, patch);
      } else if (mode === 'UPLOAD' && file) {
        const data_base64 = await readFileAsBase64(file);
        await masterApi.createResourceBankItem({
          course_id: picked.courseId,
          lesson_id: picked.lessonId,
          node_level: 'LESSON',
          title: title.trim() || file.name,
          resource_type: resourceType === 'LINK' ? 'FILE' : resourceType,
          file_name: file.name,
          data_base64,
          usage_type: usageType,
          tags: parsedTags,
          description: description.trim(),
        });
      } else {
        await masterApi.createResourceBankItem({
          course_id: picked.courseId,
          lesson_id: picked.lessonId,
          node_level: 'LESSON',
          title: title.trim(),
          resource_type: resourceType,
          url: url.trim(),
          usage_type: usageType,
          tags: parsedTags,
          description: description.trim(),
        });
      }
      onSaved();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Chỉnh sửa tài nguyên' : 'Đẩy / Thêm tài nguyên vào ngân hàng'}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="rb-create-form" loading={busy}>
            {existing ? 'Cập nhật tài nguyên' : mode === 'UPLOAD' ? 'Tải lên tài nguyên' : 'Lưu tài nguyên'}
          </Btn>
        </>
      }
    >
      <form id="rb-create-form" className="t-form-grid" onSubmit={submit}>
        <LessonTargetSelect options={options} value={lessonId} onChange={setLessonId} />

        {!isEditing && (
          <div className="t-field t-field--wide">
            <span className="t-field__label">Nguồn tài nguyên</span>
            <div className="bento-segmented" role="tablist" aria-label="Chọn nguồn tài nguyên">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'UPLOAD'}
                className={`bento-seg-btn ${mode === 'UPLOAD' ? 'is-active' : ''}`}
                onClick={() => { setMode('UPLOAD'); if (resourceType === 'LINK') setResourceType('PDF'); }}
              >
                Tải tệp từ máy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'LINK'}
                className={`bento-seg-btn ${mode === 'LINK' ? 'is-active' : ''}`}
                onClick={() => { setMode('LINK'); setResourceType('LINK'); }}
              >
                Gắn liên kết URL
              </button>
            </div>
          </div>
        )}

        <Field label="Tên tài nguyên" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Phân loại tài liệu (Preset)">
          <select className="t-input" value={usageType} onChange={(e) => setUsageType(e.target.value as 'MANDATORY' | 'REFERENCE')}>
            <option value="MANDATORY">Bắt buộc (Học tập chính quy)</option>
            <option value="REFERENCE">Tham khảo (Đọc thêm)</option>
          </select>
        </Field>
        <Field label="Tag tùy chọn (phân tách bằng dấu phẩy)">
          <input className="t-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="VD: Slide, Đề cương, Đọc thêm" />
        </Field>

        {isEditing ? (
          isExternalExisting ? (
            <>
              <Field label="Loại tài nguyên">
                <select className="t-input" value={resourceType} onChange={(e) => setResourceType(e.target.value as 'LINK' | 'VIDEO' | 'PDF' | 'FILE')}>
                  <option value="LINK">Liên kết web</option>
                  <option value="PDF">Tài liệu PDF</option>
                  <option value="VIDEO">Video</option>
                  <option value="FILE">Tài liệu khác</option>
                </select>
              </Field>
              <Field label="Đường dẫn URL (https://...)" required>
                <input type="url" className="t-input" value={url} onChange={(e) => setUrl(e.target.value)} required />
              </Field>
            </>
          ) : (
            <Field label="Tệp đã tải lên" wide>
              <input
                className="t-input"
                readOnly
                disabled
                value={
                  existing?.file_name
                    ? `${existing.file_name}${existing.file_size_bytes ? ` (${fmtBytes(existing.file_size_bytes)})` : ''}`
                    : existing?.resource_type || 'Tệp đính kèm'
                }
              />
            </Field>
          )
        ) : mode === 'UPLOAD' ? (
          <Field label="Chọn tệp tài liệu (PDF, Word, Excel, Slide, Ảnh, MP4 — tối đa 15 MB)" required wide>
            <input
              type="file"
              className="t-input"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.png,.jpg,.jpeg,.mp4,.webm"
              onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
              required
            />
            {file && (
              <span className="t-field__hint tabular-nums">
                Đã chọn: {file.name} ({fmtBytes(file.size)})
              </span>
            )}
          </Field>
        ) : (
          <>
            <Field label="Loại tài nguyên">
              <select className="t-input" value={resourceType} onChange={(e) => setResourceType(e.target.value as 'LINK' | 'VIDEO' | 'PDF' | 'FILE')}>
                <option value="LINK">Liên kết web</option>
                <option value="PDF">Tài liệu PDF</option>
                <option value="VIDEO">Video</option>
                <option value="FILE">Tài liệu khác</option>
              </select>
            </Field>
            <Field label="Đường dẫn URL (https://...)" required>
              <input type="url" className="t-input" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </Field>
          </>
        )}

        <Field label="Mô tả" wide>
          <textarea className="t-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};
