/**
 * Diễn đàn Thảo luận — Hỗ trợ cả Diễn đàn Môn học (Course) & Diễn đàn riêng của Lớp (Class)
 * cùng kiểm duyệt (ghim, khóa, ẩn, xác nhận câu trả lời hay, xử lý báo cáo vi phạm).
 */
import React, { useState } from 'react';
import {
  ForumCategory,
  ForumInfo,
  ForumReplyItem,
  ForumThreadItem,
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
  SearchInput,
  Tone,
  errMsg,
  fmtDateTime,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

interface ForumWorkspaceProps {
  mode: 'course' | 'class' | 'student_class';
  targetId: string;
  lessonIdFilter?: string;
  compact?: boolean;
}

export const ForumWorkspace: React.FC<ForumWorkspaceProps> = ({ mode, targetId, lessonIdFilter, compact }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [studentScope, setStudentScope] = useState<'CLASS' | 'COURSE'>('CLASS');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);

  const [creatingOpen, setCreatingOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'THREAD' | 'REPLY'; id: string } | null>(null);

  const res = useAsync(async () => {
    const q = { category: category || undefined, search: dSearch || undefined, lesson_id: lessonIdFilter || undefined };
    if (mode === 'course') return { active: await masterApi.getCourseForum(targetId, q), courseForum: null as null | { forum: ForumInfo; threads: ForumThreadItem[]; can_moderate: boolean } };
    if (mode === 'class') return { active: await masterApi.getClassForum(targetId, q), courseForum: null };
    const st = await masterApi.getStudentClassForums(targetId, q);
    return { active: { ...st.class_forum, can_post: true }, courseForum: st.course_forum ? { ...st.course_forum, can_post: true } : null };
  }, [mode, targetId, category, dSearch, lessonIdFilter]);

  const threadRes = useAsync(
    () => (selectedThreadId ? masterApi.getForumThread(selectedThreadId) : Promise.resolve(null)),
    [selectedThreadId]
  );

  if (res.loading) return <Loading rows={4} />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;

  const activeData = mode === 'student_class' && studentScope === 'COURSE' && res.data?.courseForum
    ? res.data.courseForum
    : res.data!.active;

  const { forum, threads, can_moderate } = activeData;

  return (
    <Card
      title={forum.title}
      actions={
        <div className="t-actions">
          {mode === 'student_class' && res.data?.courseForum && (
            <div className="t-actions">
              <Btn small variant={studentScope === 'CLASS' ? 'primary' : 'secondary'} onClick={() => { setStudentScope('CLASS'); setSelectedThreadId(null); }}>
                Diễn đàn lớp (riêng tư)
              </Btn>
              <Btn small variant={studentScope === 'COURSE' ? 'primary' : 'secondary'} onClick={() => { setStudentScope('COURSE'); setSelectedThreadId(null); }}>
                Diễn đàn chung môn học
              </Btn>
            </div>
          )}
          {can_moderate && (
            <Btn small onClick={() => setReportsOpen(true)}>Báo cáo vi phạm</Btn>
          )}
          <Btn small variant="primary" onClick={() => setCreatingOpen(true)}>+ Tạo chủ đề mới</Btn>
        </div>
      }
    >
      {!compact && forum.description && <p className="t-muted" style={{ marginTop: 0 }}>{forum.description}</p>}

      <div className="t-toolbar" style={{ marginBottom: 16 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm bài thảo luận, câu hỏi…" />
        <select className="t-input t-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Lọc chuyên mục thảo luận">
          <option value="">Tất cả chuyên mục</option>
          <option value="QA">Hỏi đáp bài học</option>
          <option value="DISCUSSION">Thảo luận chuyên môn</option>
          <option value="ANNOUNCEMENT">Thông báo giảng viên</option>
          <option value="EXPERIENCE">Chia sẻ kinh nghiệm</option>
        </select>
      </div>

      {threads.length === 0 ? (
        <EmptyState
          title="Chưa có bài viết thảo luận nào"
          text="Hãy tạo chủ đề đầu tiên để trao đổi cùng giảng viên và các học viên khác."
          action={<Btn variant="primary" onClick={() => setCreatingOpen(true)}>Tạo bài viết</Btn>}
        />
      ) : (
        <div className={compact ? 't-list' : 't-two-col'}>
          <div className="t-list">
            {threads.map((t) => (
              <div
                key={t.id}
                className="t-list-item"
                style={{
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  borderColor: selectedThreadId === t.id ? 'var(--brand-primary)' : undefined,
                  opacity: t.is_hidden ? 0.65 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <button
                    type="button"
                    className="t-row-link"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 700 }}
                    onClick={() => setSelectedThreadId(t.id)}
                  >
                    {t.is_pinned ? '📌 ' : ''}
                    {t.title}
                  </button>
                  <div className="t-actions">
                    <Badge kind="forumCategory" value={t.category} />
                    {t.is_locked && <Tone tone="muted">Đã khóa</Tone>}
                    {t.is_hidden && <Tone tone="danger">Đang ẩn</Tone>}
                  </div>
                </div>
                <div className="t-small t-muted">
                  {t.author_name} · {fmtDateTime(t.last_activity_at)} · {t.reply_count} phản hồi · {t.helpful_count} hữu ích
                </div>
              </div>
            ))}
          </div>

          {!compact && (
            <div>
              {!selectedThreadId ? (
                <EmptyState title="Chọn một bài thảo luận để xem và phản hồi" />
              ) : threadRes.loading ? (
                <Loading rows={3} />
              ) : threadRes.error ? (
                <ErrorState error={threadRes.error} />
              ) : threadRes.data ? (
                <ThreadDetailBox
                  thread={threadRes.data.thread}
                  replies={threadRes.data.replies}
                  canModerate={threadRes.data.can_moderate}
                  onReload={() => { threadRes.reload(); res.reload(); }}
                  onReport={(type, id) => setReportTarget({ type, id })}
                />
              ) : null}
            </div>
          )}

          {compact && selectedThreadId && threadRes.data && (
            <div style={{ marginTop: 12 }}>
              <ThreadDetailBox
                thread={threadRes.data.thread}
                replies={threadRes.data.replies}
                canModerate={threadRes.data.can_moderate}
                onReload={() => { threadRes.reload(); res.reload(); }}
                onReport={(type, id) => setReportTarget({ type, id })}
              />
            </div>
          )}
        </div>
      )}

      {creatingOpen && (
        <CreateThreadModal
          forumId={forum.id}
          canModerate={can_moderate}
          lessonId={lessonIdFilter || null}
          onClose={() => setCreatingOpen(false)}
          onCreated={(created) => {
            setCreatingOpen(false);
            setSelectedThreadId(created.id);
            push('Đã đăng bài thảo luận', '', 'success');
            res.reload();
          }}
        />
      )}

      {reportTarget && (
        <ReportContentModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            setReportTarget(null);
            push('Đã gửi báo cáo cho giảng viên kiểm duyệt', '', 'info');
          }}
        />
      )}

      {reportsOpen && (
        <ForumReportsModal
          forumId={forum.id}
          onClose={() => setReportsOpen(false)}
          onResolved={() => {
            res.reload();
            threadRes.reload();
          }}
        />
      )}
    </Card>
  );
};

const ThreadDetailBox: React.FC<{
  thread: ForumThreadItem;
  replies: ForumReplyItem[];
  canModerate: boolean;
  onReload: () => void;
  onReport: (type: 'THREAD' | 'REPLY', id: string) => void;
}> = ({ thread, replies, canModerate, onReload, onReport }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [replyBody, setReplyBody] = useState('');
  const [busy, setBusy] = useState(false);

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setBusy(true);
    try {
      await masterApi.createForumReply(thread.id, replyBody.trim());
      setReplyBody('');
      onReload();
    } catch (ex) {
      push('Không gửi được phản hồi', errMsg(ex), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ls-block-surface">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{thread.title}</h3>
          <div className="t-small t-muted">
            Đăng bởi <strong>{thread.author_name}</strong> · {fmtDateTime(thread.created_at)}
          </div>
        </div>
        <div className="t-actions">
          <Btn
            small
            variant={thread.helpful_by_me ? 'primary' : 'secondary'}
            onClick={async () => {
              await masterApi.toggleForumHelpful('THREAD', thread.id);
              onReload();
            }}
          >
            Hữu ích ({thread.helpful_count})
          </Btn>
          <Btn small variant="ghost" onClick={() => onReport('THREAD', thread.id)}>Báo cáo</Btn>
        </div>
      </div>

      <p className="m-measure" style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{thread.body}</p>

      {canModerate && (
        <div className="t-actions" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <Btn
            small
            onClick={async () => {
              await masterApi.moderateForumThread(thread.id, { is_pinned: !thread.is_pinned });
              onReload();
            }}
          >
            {thread.is_pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
          </Btn>
          <Btn
            small
            onClick={async () => {
              await masterApi.moderateForumThread(thread.id, { is_locked: !thread.is_locked });
              onReload();
            }}
          >
            {thread.is_locked ? 'Mở khóa phản hồi' : 'Khóa phản hồi'}
          </Btn>
          <Btn
            small
            variant="ghost"
            onClick={async () => {
              await masterApi.moderateForumThread(thread.id, { is_hidden: !thread.is_hidden });
              onReload();
            }}
          >
            {thread.is_hidden ? 'Hiện lại bài' : 'Ẩn bài'}
          </Btn>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <strong className="t-small">Phản hồi ({replies.length})</strong>
        <div className="t-list" style={{ marginTop: 8 }}>
          {replies.map((r) => (
            <div
              key={r.id}
              className={`m-semantic-notice ${r.is_endorsed ? 'm-semantic-notice--success' : ''}`}
              style={{ opacity: r.is_hidden ? 0.6 : 1 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div className="t-small">
                  <strong>{r.author_name}</strong> · {fmtDateTime(r.created_at)}
                  {r.is_endorsed && <> <Tone tone="success">Giảng viên xác nhận chuẩn</Tone></>}
                </div>
                <div className="t-actions">
                  <Btn
                    small
                    variant={r.helpful_by_me ? 'primary' : 'ghost'}
                    onClick={async () => {
                      await masterApi.toggleForumHelpful('REPLY', r.id);
                      onReload();
                    }}
                  >
                    Hữu ích ({r.helpful_count})
                  </Btn>
                  <Btn small variant="ghost" onClick={() => onReport('REPLY', r.id)}>Báo cáo</Btn>
                  {canModerate && (
                    <>
                      <Btn
                        small
                        onClick={async () => {
                          await masterApi.moderateForumReply(r.id, { is_endorsed: !r.is_endorsed });
                          onReload();
                        }}
                      >
                        {r.is_endorsed ? 'Bỏ xác nhận' : 'Xác nhận hay'}
                      </Btn>
                      <Btn
                        small
                        variant="ghost"
                        onClick={async () => {
                          await masterApi.moderateForumReply(r.id, { is_hidden: !r.is_hidden });
                          onReload();
                        }}
                      >
                        {r.is_hidden ? 'Hiện' : 'Ẩn'}
                      </Btn>
                    </>
                  )}
                </div>
              </div>
              <div className="m-measure" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.body}</div>
            </div>
          ))}
        </div>

        {thread.is_locked && !canModerate ? (
          <p className="t-muted t-small" style={{ marginTop: 12 }}>Chủ đề này đã được giảng viên khóa trả lời mới.</p>
        ) : (
          <form onSubmit={sendReply} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="t-input"
              rows={2}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Viết câu trả lời hoặc trao đổi…"
              required
            />
            <div>
              <Btn small variant="primary" type="submit" loading={busy}>Gửi phản hồi</Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const CreateThreadModal: React.FC<{
  forumId: string;
  canModerate: boolean;
  lessonId: string | null;
  onClose: () => void;
  onCreated: (t: ForumThreadItem) => void;
}> = ({ forumId, canModerate, lessonId, onClose, onCreated }) => {
  const [category, setCategory] = useState<ForumCategory>('QA');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await masterApi.createForumThread(forumId, {
        category,
        title: title.trim(),
        body: body.trim(),
        lesson_id: lessonId,
        is_pinned: canModerate ? isPinned : false,
      });
      onCreated(created);
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo chủ đề thảo luận mới"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="forum-create-thread" loading={busy}>Đăng bài viết</Btn>
        </>
      }
    >
      <form id="forum-create-thread" className="t-form-grid" onSubmit={submit}>
        <Field label="Chuyên mục">
          <select className="t-input" value={category} onChange={(e) => setCategory(e.target.value as ForumCategory)}>
            <option value="QA">Hỏi đáp bài học</option>
            <option value="DISCUSSION">Thảo luận chuyên môn</option>
            <option value="EXPERIENCE">Chia sẻ kinh nghiệm</option>
            {canModerate && <option value="ANNOUNCEMENT">Thông báo giảng viên</option>}
          </select>
        </Field>
        {canModerate && (
          <Field label="Ghim bài viết">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
              Ghim lên đầu diễn đàn
            </label>
          </Field>
        )}
        <Field label="Tiêu đề" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Nội dung chi tiết" required wide>
          <textarea className="t-input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const ReportContentModal: React.FC<{
  target: { type: 'THREAD' | 'REPLY'; id: string };
  onClose: () => void;
  onSubmitted: () => void;
}> = ({ target, onClose, onSubmitted }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await masterApi.createForumReport({ target_type: target.type, target_id: target.id, reason: reason.trim() });
      onSubmitted();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Báo cáo nội dung vi phạm"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="danger" type="submit" form="forum-report-form" loading={busy}>Gửi báo cáo</Btn>
        </>
      }
    >
      <form id="forum-report-form" onSubmit={submit}>
        <Field label="Lý do báo cáo" required wide>
          <textarea className="t-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        {err && <p className="t-field__error" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const ForumReportsModal: React.FC<{ forumId: string; onClose: () => void; onResolved: () => void }> = ({
  forumId,
  onClose,
  onResolved,
}) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const reports = useAsync(() => masterApi.listForumReports(forumId), [forumId]);

  return (
    <Modal title="Danh sách báo cáo vi phạm" onClose={onClose} width={680}>
      {reports.loading && <Loading rows={3} />}
      {reports.error && <ErrorState error={reports.error} />}
      {reports.data && reports.data.items.length === 0 && (
        <EmptyState title="Không có báo cáo nào đang chờ xử lý" />
      )}
      {reports.data && reports.data.items.length > 0 && (
        <div className="t-list">
          {reports.data.items.map((rep) => (
            <div key={rep.id} className="t-list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>{rep.reporter_name} · {rep.target_type}</strong>
                <Tone tone={rep.status === 'OPEN' ? 'warning' : 'success'}>{rep.status}</Tone>
              </div>
              <p style={{ margin: '6px 0' }}>{rep.reason}</p>
              {rep.status === 'OPEN' && (
                <div className="t-actions">
                  <Btn
                    small
                    onClick={async () => {
                      await masterApi.resolveForumReport(rep.id, { action: 'DISMISS', resolution_note: 'Không vi phạm quy định' });
                      push('Đã bỏ qua báo cáo', '', 'info');
                      reports.reload();
                      onResolved();
                    }}
                  >
                    Bỏ qua
                  </Btn>
                  <Btn
                    small
                    variant="danger"
                    onClick={async () => {
                      await masterApi.resolveForumReport(rep.id, { action: 'HIDE_CONTENT', resolution_note: 'Ẩn nội dung vi phạm' });
                      push('Đã ẩn nội dung bị báo cáo', '', 'success');
                      reports.reload();
                      onResolved();
                    }}
                  >
                    Ẩn nội dung vi phạm
                  </Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
