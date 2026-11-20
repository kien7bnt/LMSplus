/**
 * Wiki Môn học (Subject Wiki) — CRUD, lịch sử phiên bản & hiển thị cho học viên.
 */
import React, { useState } from 'react';
import { WikiPageDetail, WikiPageItem, masterApi } from '../api';
import { WikiMarkdownView, WikiReaderProvider } from '../WikiText';
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
  errMsg,
  fmtDateTime,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

export const CourseWikiPanel: React.FC<{ courseId: string; lessonIdFilter?: string }> = ({ courseId, lessonIdFilter }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useAsync(() => masterApi.listCourseWiki(courseId, { q: dq, lesson_id: lessonIdFilter }), [courseId, dq, lessonIdFilter]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WikiPageItem | null>(null);
  const [creating, setCreating] = useState(false);

  const activeDetail = useAsync(() => (activeId ? masterApi.getWikiPage(activeId) : Promise.resolve(null)), [activeId]);

  if (res.loading) return <Loading rows={4} />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  const data = res.data!;

  return (
    <Card
      title="Wiki & Kiến thức trọng tâm môn học"
      actions={
        data.can_edit ? (
          <Btn small variant="primary" onClick={() => setCreating(true)}>
            + Tạo trang Wiki
          </Btn>
        ) : undefined
      }
    >
      <div className="t-toolbar" style={{ marginBottom: 16 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Tìm theo từ khóa, nội dung Wiki…" />
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="Chưa có trang Wiki nào" text="Tạo sổ tay công thức, thuật ngữ và tài liệu hướng dẫn dùng chung cho môn học." />
      ) : (
        <div className="t-two-col">
          <div className="t-list">
            {data.items.map((w) => (
              <div key={w.id} className="t-list-item">
                <div>
                  <button
                    type="button"
                    className="t-row-link"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 700 }}
                    onClick={() => setActiveId(w.id)}
                  >
                    {w.title}
                  </button>
                  {w.summary && <div className="t-small t-muted m-measure">{w.summary}</div>}
                  {w.tags && w.tags.length > 0 && (
                    <div className="wiki-tag-list" style={{ marginTop: 6 }}>
                      {w.tags.map((tag) => (
                        <span key={tag} className="wiki-tag-pill">#{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="t-small t-muted" style={{ marginTop: 4 }}>
                    {w.lesson_title ? `Bài: ${w.lesson_title} · ` : 'Toàn môn · '}
                    Cập nhật {fmtDateTime(w.updated_at)}
                  </div>
                </div>
                <div className="t-actions">
                  <Badge kind="course" value={w.status} />
                  {data.can_edit && (
                    <Btn small onClick={() => setEditing(w)}>Sửa</Btn>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            {!activeId ? (
              <EmptyState title="Chọn một trang Wiki để xem chi tiết" />
            ) : activeDetail.loading ? (
              <Loading rows={4} />
            ) : activeDetail.error ? (
              <ErrorState error={activeDetail.error} />
            ) : activeDetail.data ? (
              <WikiDetailCard
                detail={activeDetail.data}
                allPages={data.items}
                onSelectPage={(p) => setActiveId(p.id)}
                onDelete={async () => {
                  await masterApi.deleteWikiPage(activeDetail.data!.id);
                  setActiveId(null);
                  push('Đã xóa trang Wiki', '', 'info');
                  res.reload();
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <WikiEditorModal
          courseId={courseId}
          lessonId={lessonIdFilter || editing?.lesson_id || null}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(saved) => {
            setCreating(false);
            setEditing(null);
            setActiveId(saved.id);
            push(editing ? 'Đã cập nhật trang Wiki' : 'Đã tạo trang Wiki mới', '', 'success');
            res.reload();
            activeDetail.reload();
          }}
        />
      )}
    </Card>
  );
};

export const StudentWikiPanel: React.FC<{ classId: string; lessonId?: string }> = ({ classId, lessonId }) => {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useAsync(() => masterApi.listStudentClassWiki(classId, { q: dq, lesson_id: lessonId }), [classId, dq, lessonId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const detail = useAsync(() => (activeId ? masterApi.getWikiPage(activeId) : Promise.resolve(null)), [activeId]);

  if (res.loading) return <Loading rows={3} />;
  if (res.error) return <ErrorState error={res.error} onRetry={res.reload} />;

  return (
    <Card title="Wiki & Sổ tay môn học">
      <div className="t-toolbar" style={{ marginBottom: 12 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Tra cứu khái niệm, công thức…" />
      </div>
      {res.data!.items.length === 0 ? (
        <EmptyState title="Chưa có trang Wiki công khai" text="Giảng viên chưa đăng trang Wiki nào cho nội dung này." />
      ) : (
        <WikiReaderProvider wikiPages={res.data!.items}>
          <div className="t-list">
            {res.data!.items.map((w) => (
              <div key={w.id} className="t-list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{w.title}</strong>
                    {w.summary && <div className="t-small t-muted" style={{ marginTop: 2 }}>{w.summary}</div>}
                    {w.tags && w.tags.length > 0 && (
                      <div className="wiki-tag-list" style={{ marginTop: 6 }}>
                        {w.tags.map((tag) => (
                          <span key={tag} className="wiki-tag-pill">#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Btn small onClick={() => setActiveId(activeId === w.id ? null : w.id)}>
                    {activeId === w.id ? 'Thu gọn' : 'Đọc chi tiết'}
                  </Btn>
                </div>
                {activeId === w.id && detail.data && (
                  <div className="ls-block-surface m-measure" style={{ marginTop: 12 }}>
                    <WikiMarkdownView
                      content={detail.data.content_markdown}
                      wikiPages={res.data!.items}
                      excludePageId={detail.data.id}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </WikiReaderProvider>
      )}
    </Card>
  );
};

const WikiDetailCard: React.FC<{
  detail: WikiPageDetail;
  allPages?: WikiPageItem[];
  onSelectPage?: (p: WikiPageItem) => void;
  onDelete: () => Promise<void>;
}> = ({ detail, allPages = [], onSelectPage, onDelete }) => (
  <div className="ls-block-surface">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>{detail.title}</h3>
        {detail.tags.length > 0 && (
          <div className="wiki-tag-list" style={{ marginTop: 8 }}>
            {detail.tags.map((tag) => (
              <span key={tag} className="wiki-tag-pill">#{tag}</span>
            ))}
          </div>
        )}
      </div>
      {detail.can_edit && (
        <Btn small variant="ghost" onClick={onDelete}>Xóa trang</Btn>
      )}
    </div>
    <div className="m-measure">
      <WikiMarkdownView
        content={detail.content_markdown}
        wikiPages={allPages}
        excludePageId={detail.id}
        onOpenWiki={onSelectPage}
      />
    </div>
    {detail.revisions.length > 0 && (
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <strong className="t-small">Lịch sử chỉnh sửa ({detail.revisions.length} bản):</strong>
        <ul className="t-list" style={{ marginTop: 8 }}>
          {detail.revisions.slice(0, 5).map((r) => (
            <li key={r.id} className="t-small t-muted">
              Bản {r.revision_number} · {r.change_note} — {r.edited_by_name} ({fmtDateTime(r.created_at)})
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

const WikiEditorModal: React.FC<{
  courseId: string;
  lessonId: string | null;
  existing: WikiPageItem | null;
  onClose: () => void;
  onSaved: (w: WikiPageItem) => void;
}> = ({ courseId, lessonId, existing, onClose, onSaved }) => {
  const [title, setTitle] = useState(existing?.title || '');
  const [summary, setSummary] = useState(existing?.summary || '');
  const [content, setContent] = useState(existing?.content_markdown || '');
  const [tagsText, setTagsText] = useState((existing?.tags || []).join(', '));
  const [status, setStatus] = useState<'DRAFT' | 'PUBLISHED'>(existing?.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED');
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const saved = existing
        ? await masterApi.updateWikiPage(existing.id, {
            title: title.trim(),
            summary: summary.trim(),
            content_markdown: content,
            tags,
            status,
            change_note: changeNote.trim() || 'Cập nhật nội dung Wiki',
          })
        : await masterApi.createCourseWiki(courseId, {
            title: title.trim(),
            summary: summary.trim(),
            content_markdown: content,
            tags,
            lesson_id: lessonId,
            status,
          });
      onSaved(saved);
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Chỉnh sửa trang Wiki' : 'Tạo trang Wiki mới'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="wiki-edit-form" loading={busy}>Lưu trang Wiki</Btn>
        </>
      }
    >
      <form id="wiki-edit-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Tiêu đề" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Trạng thái">
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'PUBLISHED')}>
            <option value="PUBLISHED">Công khai cho học viên</option>
            <option value="DRAFT">Bản nháp</option>
          </select>
        </Field>
        <Field
          label="Thẻ từ khóa tự động liên kết trong bài học (cách nhau bởi dấu phẩy)"
          hint="Khi bất kỳ từ khóa nào trong thẻ (hoặc tiêu đề trang Wiki) xuất hiện trong bài học, học viên di chuột hoặc chạm vào từ đó sẽ thấy thẻ trích dẫn nội dung kiểu Wikipedia."
          wide
        >
          <input className="t-input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="VD: phân số, công thức, từ đồng nghĩa" />
        </Field>
        <Field label="Tóm tắt ngắn" wide>
          <input className="t-input" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label="Nội dung Wiki (hỗ trợ văn bản có cấu trúc / Markdown)" required wide>
          <textarea className="t-input" rows={8} value={content} onChange={(e) => setContent(e.target.value)} required />
        </Field>
        {existing && (
          <Field label="Ghi chú phiên bản chỉnh sửa" wide>
            <input className="t-input" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="VD: Bổ sung ví dụ minh họa" />
          </Field>
        )}
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};
