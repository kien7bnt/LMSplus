import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CourseDetail, CourseStatus, OutlineChapter, masterApi, saveBlob, teachingApi } from '../api';
import {
  Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, ProgressMeter, SmartImage, Tone,
  errMsg, fmtBytes, fmtDate, fmtDateTime, useAsync, useToast,
} from '../ui';
import { CourseFormModal } from './CourseFormModal';
import { CourseWikiPanel } from './WikiPanel';
import { ForumWorkspace } from './ForumPanel';

type Section = 'overview' | 'content' | 'versions' | 'resources' | 'wiki' | 'forum' | 'classes' | 'stats';
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'content', label: 'Chương & bài học' },
  { id: 'versions', label: 'Phiên bản Snapshot' },
  { id: 'resources', label: 'Tài liệu' },
  { id: 'wiki', label: 'Wiki môn học' },
  { id: 'forum', label: 'Diễn đàn môn học' },
  { id: 'classes', label: 'Lớp học sử dụng' },
  { id: 'stats', label: 'Thống kê' },
];

// ------------------------------------------------------------------ Outline editor (drag & drop)

const OutlineEditor: React.FC<{ course: CourseDetail; onChanged: () => void; setOutline: (o: OutlineChapter[]) => void }> = ({ course, onChanged, setOutline }) => {
  const toast = useToast();
  const canManage = course.capabilities.can_manage;
  const [newChapter, setNewChapter] = useState('');
  const [newChapterTopicId, setNewChapterTopicId] = useState('');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicCode, setNewTopicCode] = useState('');
  const [newLesson, setNewLesson] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [drag, setDrag] = useState<{ type: 'chapter' | 'lesson'; id: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; danger?: boolean; run: () => Promise<unknown> }>(null);
  const treeReq = useAsync(() => masterApi.getCourseTree(course.id), [course.id]);
  const topics = treeReq.data?.topics || course.topics || [];
  const outline = course.outline;

  const persist = async (next: OutlineChapter[]) => {
    const prev = outline;
    setOutline(next);
    try {
      const r = await teachingApi.saveOutline(course.id, next.map((c) => ({ id: c.id, lesson_ids: c.lessons.map((l) => l.id) })));
      setOutline(r.outline);
    } catch (e) {
      setOutline(prev);
      toast({ tone: 'error', title: 'Không lưu được thứ tự', detail: errMsg(e) });
    }
  };

  const moveChapter = (from: number, to: number) => {
    if (to < 0 || to >= outline.length) return;
    const next = [...outline];
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    persist(next);
  };
  const moveLesson = (lessonId: string, toChapterId: string, toIndex: number) => {
    const next = outline.map((c) => ({ ...c, lessons: c.lessons.filter((l) => l.id !== lessonId) }));
    const lesson = outline.flatMap((c) => c.lessons).find((l) => l.id === lessonId);
    const target = next.find((c) => c.id === toChapterId);
    if (!lesson || !target) return;
    target.lessons.splice(Math.min(toIndex, target.lessons.length), 0, lesson);
    persist(next);
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast({ tone: 'success', title: success });
      onChanged();
    } catch (e) {
      toast({ tone: 'error', title: 'Thao tác không thành công', detail: errMsg(e) });
    }
  };

  const addTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopicTitle.trim()) return;
    await run(
      () => masterApi.createTopic(course.id, { title: newTopicTitle.trim(), code: newTopicCode.trim() || undefined }),
      'Đã thêm chủ đề 4 cấp'
    );
    setNewTopicTitle('');
    setNewTopicCode('');
    treeReq.reload();
  };

  const addChapter = async () => {
    if (!newChapter.trim()) return;
    await run(
      () => teachingApi.createChapter(course.id, { title: newChapter.trim(), topic_id: newChapterTopicId || null }),
      'Đã thêm chương'
    );
    setNewChapter('');
  };
  const addLesson = async (chapterId: string) => {
    const title = (newLesson[chapterId] || '').trim();
    if (!title) return;
    try {
      const r = await teachingApi.createLesson(chapterId, { title });
      setNewLesson((p) => ({ ...p, [chapterId]: '' }));
      toast({ tone: 'success', title: 'Đã thêm bài học', detail: 'Mở trình soạn thảo để thêm nội dung và video.' });
      onChanged();
      return r;
    } catch (e) {
      toast({ tone: 'error', title: 'Không thêm được bài học', detail: errMsg(e) });
      return null;
    }
  };

  return (
    <Card
      title="Chương & bài học"
      actions={
        <div className="t-actions">
          {canManage ? <span className="t-sub">Kéo biểu tượng ⠿ để sắp xếp, hoặc dùng nút ↑ ↓.</span> : <Tone tone="neutral">Chỉ xem</Tone>}
          <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/courses/${course.id}/studio`}>
            🎬 Mở Lesson Studio
          </Link>
        </div>
      }
    >
      {course.classes.length > 1 && (
        <div className="t-notice" style={{ marginBottom: 16 }}>
          Khóa học đang được <strong>{course.classes.length} lớp</strong> sử dụng chung. Lớp đang hoạt động ghim theo Snapshot phiên bản đã cấp; khi muốn cập nhật giáo án mới cho các lớp mới, hãy xuất bản phiên bản Snapshot mới.
        </div>
      )}

      {/* Cây cấu trúc Chủ đề (Cấp Chủ đề -> Chương -> Bài học) */}
      <div style={{ marginBottom: 20, padding: 14, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: topics.length || canManage ? 10 : 0 }}>
          <div>
            <strong style={{ fontSize: 14 }}>Chủ đề học tập (Cấp 1 của cây nội dung 4 cấp)</strong>
            <span className="t-sub" style={{ margin: '2px 0 0' }}>Nhóm các chương theo chủ đề để đồng bộ với 3 Ngân hàng học liệu.</span>
          </div>
          <Link className="t-btn t-btn--small" to={`/teaching/banks?course_id=${course.id}`}>
            Mở Ngân hàng theo cây
          </Link>
        </div>
        {topics.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: canManage ? 10 : 0 }}>
            {topics.map((tp) => (
              <span
                key={tp.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface)',
                  fontSize: 13,
                }}
              >
                <strong className="tabular-nums">{tp.code}</strong>
                <span>{tp.title}</span>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Xóa chủ đề ${tp.title}`}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--status-danger)', fontWeight: 700, padding: '0 4px' }}
                    onClick={() =>
                      setConfirm({
                        title: `Xóa chủ đề "${tp.title}"?`,
                        message: 'Chủ đề sẽ bị xóa; các chương gắn với chủ đề này sẽ chuyển về chưa phân nhóm.',
                        label: 'Xóa chủ đề',
                        danger: true,
                        run: async () => {
                          await masterApi.deleteTopic(tp.id);
                          treeReq.reload();
                        },
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {canManage && (
          <form onSubmit={addTopic} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="t-input"
              style={{ width: 130 }}
              value={newTopicCode}
              maxLength={40}
              onChange={(e) => setNewTopicCode(e.target.value)}
              placeholder="Mã chủ đề…"
              aria-label="Mã chủ đề mới"
            />
            <input
              className="t-input"
              style={{ flex: '1 1 220px' }}
              value={newTopicTitle}
              maxLength={180}
              onChange={(e) => setNewTopicTitle(e.target.value)}
              placeholder="Tên chủ đề mới (ví dụ: Đại số tuyến tính)…"
              aria-label="Tên chủ đề mới"
            />
            <Btn type="submit" small disabled={!newTopicTitle.trim()}>
              + Thêm chủ đề
            </Btn>
          </form>
        )}
      </div>
      {outline.length === 0 && <EmptyState title="Chưa có chương nào" text="Thêm chương đầu tiên, sau đó thêm bài học vào chương." />}
      {outline.map((ch, ci) => (
        <div
          key={ch.id}
          className="t-chapter"
          data-dragging={drag?.type === 'chapter' && drag.id === ch.id}
          data-drop={over === ch.id}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            setOver(ch.id);
          }}
          onDragLeave={() => setOver((o) => (o === ch.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            if (!drag) return;
            if (drag.type === 'chapter') moveChapter(outline.findIndex((c) => c.id === drag.id), ci);
            else moveLesson(drag.id, ch.id, ch.lessons.length);
            setDrag(null);
          }}
        >
          <div className="t-chapter__head">
            {canManage && (
              <span className="t-drag" draggable onDragStart={() => setDrag({ type: 'chapter', id: ch.id, from: ch.id })} onDragEnd={() => setDrag(null)} title="Kéo để sắp xếp chương" aria-hidden="true">
                ⠿
              </span>
            )}
            {editing?.id === ch.id ? (
              <form
                style={{ display: 'flex', gap: 8, flex: '1 1 300px' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => teachingApi.updateChapter(ch.id, { title: editing.title }), 'Đã đổi tên chương').then(() => setEditing(null));
                }}
              >
                <input className="t-input" value={editing.title} maxLength={200} autoFocus onChange={(e) => setEditing({ id: ch.id, title: e.target.value })} aria-label="Tên chương" />
                <Btn type="submit" variant="primary" small>Lưu</Btn>
                <Btn small variant="ghost" onClick={() => setEditing(null)}>Hủy</Btn>
              </form>
            ) : (
              <h3>
                Chương {ci + 1}. {ch.title}
              </h3>
            )}
            <Badge kind="lesson" value={ch.status} />
            {canManage && topics.length > 0 && editing?.id !== ch.id && (
              <select
                className="t-input"
                style={{ width: 'auto', minWidth: 150, paddingBlock: 6, fontSize: 13 }}
                aria-label={`Chủ đề của chương ${ci + 1}`}
                value={ch.topic_id || ''}
                onChange={(e) =>
                  run(
                    async () => {
                      await teachingApi.updateChapter(ch.id, { topic_id: e.target.value || null });
                      treeReq.reload();
                    },
                    'Đã cập nhật chủ đề chương'
                  )
                }
              >
                <option value="">-- Chưa gắn chủ đề --</option>
                {topics.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.code} — {tp.title}
                  </option>
                ))}
              </select>
            )}
            {canManage && editing?.id !== ch.id && (
              <div className="t-actions">
                <button type="button" className="t-icon-btn" aria-label="Chuyển chương lên" disabled={ci === 0} onClick={() => moveChapter(ci, ci - 1)}>↑</button>
                <button type="button" className="t-icon-btn" aria-label="Chuyển chương xuống" disabled={ci === outline.length - 1} onClick={() => moveChapter(ci, ci + 1)}>↓</button>
                <Btn small variant="ghost" onClick={() => setEditing({ id: ch.id, title: ch.title })}>Đổi tên</Btn>
                {ch.status === 'ARCHIVED' ? (
                  <Btn small variant="ghost" onClick={() => run(() => teachingApi.updateChapter(ch.id, { status: 'PUBLISHED' }), 'Đã khôi phục chương')}>Khôi phục</Btn>
                ) : (
                  <Btn
                    small
                    variant="ghost"
                    onClick={() =>
                      setConfirm({
                        title: 'Lưu trữ chương?',
                        message: 'Chương và các bài học bên trong sẽ bị ẩn với học viên. Dữ liệu tiến độ được giữ nguyên và có thể khôi phục.',
                        label: 'Lưu trữ',
                        run: () => teachingApi.updateChapter(ch.id, { status: 'ARCHIVED' }),
                      })
                    }
                  >
                    Lưu trữ
                  </Btn>
                )}
                <Btn
                  small
                  variant="danger"
                  onClick={() =>
                    setConfirm({
                      title: 'Xóa chương?',
                      message: 'Chỉ xóa được khi chương chưa có bài học nào đã xuất bản hoặc đã có học viên học. Thao tác này không thể hoàn tác.',
                      label: 'Xóa chương',
                      danger: true,
                      run: () => teachingApi.deleteChapter(ch.id),
                    })
                  }
                >
                  Xóa
                </Btn>
              </div>
            )}
          </div>

          {ch.lessons.length === 0 && <p className="t-sub" style={{ padding: '12px 16px', margin: 0 }}>Chương chưa có bài học.</p>}
          {ch.lessons.map((l, li) => (
            <div
              key={l.id}
              className="t-lesson-row"
              data-dragging={drag?.type === 'lesson' && drag.id === l.id}
              data-drop={over === l.id}
              onDragOver={(e) => {
                if (drag?.type !== 'lesson') return;
                e.preventDefault();
                e.stopPropagation();
                setOver(l.id);
              }}
              onDrop={(e) => {
                if (drag?.type !== 'lesson') return;
                e.preventDefault();
                e.stopPropagation();
                setOver(null);
                moveLesson(drag.id, ch.id, li);
                setDrag(null);
              }}
            >
              {canManage && (
                <span className="t-drag" draggable onDragStart={(e) => { e.stopPropagation(); setDrag({ type: 'lesson', id: l.id, from: ch.id }); }} onDragEnd={() => setDrag(null)} title="Kéo để sắp xếp bài học" aria-hidden="true">
                  ⠿
                </span>
              )}
              <div className="t-lesson-row__title">
                <Link to={`/teaching/lessons/${l.id}`}>
                  Bài {ci + 1}.{li + 1}. {l.title}
                </Link>
                <span className="t-sub tabular-nums">
                  {l.duration_minutes} phút{l.completion_rule === 'REVIEW_CORRECT' ? ' · Hoàn thành khi trả lời đúng câu hỏi' : ''}
                </span>
              </div>
              <Badge kind="lesson" value={l.publish_status} />
              {l.has_unpublished_changes && l.publish_status !== 'ARCHIVED' && <Tone tone="warning">Có thay đổi chưa xuất bản</Tone>}
              <Link className="t-btn t-btn--small" to={`/teaching/lessons/${l.id}`}>
                {course.capabilities.can_edit_draft ? 'Soạn nội dung' : 'Xem'}
              </Link>
              {canManage && (
                <>
                  <button type="button" className="t-icon-btn" aria-label="Chuyển bài lên" disabled={li === 0} onClick={() => moveLesson(l.id, ch.id, li - 1)}>↑</button>
                  <button type="button" className="t-icon-btn" aria-label="Chuyển bài xuống" disabled={li === ch.lessons.length - 1} onClick={() => moveLesson(l.id, ch.id, li + 2)}>↓</button>
                  {l.publish_status === 'ARCHIVED' ? (
                    <Btn small variant="ghost" onClick={() => run(() => teachingApi.restoreLesson(l.id), 'Đã khôi phục bài học')}>Khôi phục</Btn>
                  ) : (
                    <Btn
                      small
                      variant="ghost"
                      onClick={() =>
                        setConfirm({
                          title: 'Lưu trữ bài học?',
                          message: 'Bài học sẽ bị ẩn khỏi học viên nhưng tiến độ học tập vẫn được giữ lại.',
                          label: 'Lưu trữ',
                          run: () => teachingApi.archiveLesson(l.id),
                        })
                      }
                    >
                      Lưu trữ
                    </Btn>
                  )}
                  <button
                    type="button"
                    className="t-icon-btn"
                    aria-label={`Xóa bài ${l.title}`}
                    onClick={() =>
                      setConfirm({
                        title: 'Xóa bài học?',
                        message: l.published_version > 0
                          ? 'Bài học đã từng được xuất bản nên không thể xóa — hệ thống sẽ yêu cầu lưu trữ thay thế.'
                          : 'Bài học chưa xuất bản sẽ bị xóa vĩnh viễn cùng toàn bộ bản nháp.',
                        label: 'Xóa',
                        danger: true,
                        run: () => teachingApi.deleteLesson(l.id),
                      })
                    }
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
          {canManage && ch.status !== 'ARCHIVED' && (
            <form
              className="t-lesson-row"
              onSubmit={(e) => {
                e.preventDefault();
                addLesson(ch.id);
              }}
            >
              <input
                className="t-input"
                style={{ flex: '1 1 260px' }}
                value={newLesson[ch.id] || ''}
                maxLength={200}
                onChange={(e) => setNewLesson((p) => ({ ...p, [ch.id]: e.target.value }))}
                placeholder="Tên bài học mới…"
                aria-label={`Tên bài học mới trong chương ${ci + 1}`}
              />
              <Btn type="submit" small disabled={!(newLesson[ch.id] || '').trim()}>
                + Thêm bài học
              </Btn>
            </form>
          )}
        </div>
      ))}
      {canManage && (
        <form
          style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            addChapter();
          }}
        >
          {topics.length > 0 && (
            <select
              className="t-input"
              style={{ width: 200 }}
              aria-label="Chủ đề cho chương mới"
              value={newChapterTopicId}
              onChange={(e) => setNewChapterTopicId(e.target.value)}
            >
              <option value="">-- Chủ đề (tùy chọn) --</option>
              {topics.map((tp) => (
                <option key={tp.id} value={tp.id}>{tp.title}</option>
              ))}
            </select>
          )}
          <input className="t-input" style={{ flex: '1 1 300px' }} value={newChapter} maxLength={200} onChange={(e) => setNewChapter(e.target.value)} placeholder="Tên chương mới…" aria-label="Tên chương mới" />
          <Btn type="submit" variant="primary" disabled={!newChapter.trim()}>
            + Thêm chương
          </Btn>
        </form>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.run();
            setConfirm(null);
            toast({ tone: 'success', title: 'Đã cập nhật' });
            onChanged();
          }}
        />
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ Resources

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsDataURL(file);
  });

const ResourcesSection: React.FC<{ courseId: string }> = ({ courseId }) => {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => teachingApi.resources(courseId), [courseId]);
  const [adding, setAdding] = useState<null | 'LINK' | 'FILE'>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    if (!title.trim()) return setFormError('Vui lòng nhập tên tài liệu.');
    if (adding === 'FILE' && !file) return setFormError('Vui lòng chọn tệp.');
    if (file && file.size > 10 * 1024 * 1024) return setFormError('Tệp vượt quá 10 MB.');
    setBusy(true);
    try {
      if (adding === 'LINK') await teachingApi.addResource(courseId, { title, resource_type: 'LINK', url });
      else await teachingApi.addResource(courseId, { title, resource_type: 'FILE', file_name: file!.name, data_base64: await toBase64(file!) });
      toast({ tone: 'success', title: 'Đã thêm tài liệu' });
      setAdding(null);
      setTitle('');
      setUrl('');
      setFile(null);
      reload();
    } catch (e) {
      setFormError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Tài liệu học tập"
      padded={false}
      actions={
        data?.can_edit && (
          <>
            <Btn small onClick={() => setAdding('LINK')}>+ Liên kết</Btn>
            <Btn small variant="primary" onClick={() => setAdding('FILE')}>+ Tải tệp lên</Btn>
          </>
        )
      }
    >
      <p className="t-sub" style={{ padding: '0 24px', margin: '0 0 12px' }}>
        Tài liệu dùng chung cho khóa học; chèn vào bài học bằng khối "Tài liệu". Tệp tối đa 10 MB (PDF, Word, PowerPoint, Excel, ảnh, ZIP, TXT).
      </p>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="Chưa có tài liệu" />}
      {data && data.items.length > 0 && (
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Tài liệu</th>
                <th>Loại</th>
                <th>Người thêm</th>
                <th>Ngày thêm</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.title}</strong>
                    <span className="t-sub">{r.file_name || r.url}</span>
                  </td>
                  <td>
                    {r.resource_type === 'VIDEO'
                      ? `Video tải lên · ${fmtBytes(r.file_size_bytes)}`
                      : r.resource_type === 'PDF'
                      ? `Tài liệu PDF · ${fmtBytes(r.file_size_bytes)}`
                      : r.resource_type === 'FILE'
                      ? `Tệp ${fmtBytes(r.file_size_bytes)}`
                      : 'Liên kết'}
                  </td>
                  <td>{r.created_by_name || '—'}</td>
                  <td className="tabular-nums">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="t-actions" style={{ justifyContent: 'flex-end' }}>
                      <Btn
                        small
                        onClick={async () => {
                          try {
                            saveBlob(await teachingApi.downloadResource(r.id));
                          } catch (e) {
                            toast({ tone: 'error', title: 'Không tải được tài liệu', detail: errMsg(e) });
                          }
                        }}
                      >
                        {r.resource_type === 'LINK' ? 'Mở' : 'Tải xuống'}
                      </Btn>
                      {data.can_edit && (
                        <button type="button" className="t-icon-btn" aria-label={`Gỡ ${r.title}`} onClick={() => setToDelete(r.id)}>
                          🗑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <Modal
          title={adding === 'LINK' ? 'Thêm liên kết tài liệu' : 'Tải tệp tài liệu lên'}
          onClose={() => setAdding(null)}
          width={520}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setAdding(null)}>Hủy</Btn>
              <Btn variant="primary" onClick={submit} loading={busy}>Thêm tài liệu</Btn>
            </>
          }
        >
          <Field label="Tên tài liệu" required>
            <input className="t-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {adding === 'LINK' ? (
            <Field label="Đường dẫn" required>
              <input className="t-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          ) : (
            <Field label="Chọn tệp" required hint={file ? `${file.name} · ${fmtBytes(file.size)}` : undefined}>
              <input
                className="t-input"
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                }}
              />
            </Field>
          )}
          {formError && <p className="t-field__error" role="alert">{formError}</p>}
        </Modal>
      )}
      {toDelete && (
        <ConfirmDialog
          title="Gỡ tài liệu?"
          message="Tài liệu sẽ không còn tải được từ bài học. Lịch sử vẫn được lưu."
          confirmLabel="Gỡ tài liệu"
          danger
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            await teachingApi.deleteResource(toDelete);
            setToDelete(null);
            toast({ tone: 'success', title: 'Đã gỡ tài liệu' });
            reload();
          }}
        />
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ Snapshot Versions (Immutable Release)

const VersionsSection: React.FC<{ course: CourseDetail; onCourseChanged: () => void }> = ({ course, onCourseChanged }) => {
  const toast = useToast();
  const canManage = course.capabilities.can_manage;
  const req = useAsync(() => masterApi.listCourseVersions(course.id), [course.id]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<{ id: string; label: string } | null>(null);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishing(true);
    try {
      const created = await masterApi.publishCourseVersion(course.id, {
        version_label: label.trim() || undefined,
        changelog_note: note.trim() || undefined,
      });
      setLabel('');
      setNote('');
      toast({
        tone: 'success',
        title: `Đã xuất bản Snapshot ${created.version_label}`,
        detail: 'Các lớp đang hoạt động vẫn giữ nguyên bản ghim cũ cho tới khi chủ động nâng cấp.',
      });
      req.reload();
      onCourseChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không xuất bản được phiên bản', detail: errMsg(ex) });
    } finally {
      setPublishing(false);
    }
  };

  if (req.loading) return <Loading rows={4} />;
  if (req.error || !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;

  const items = req.data.items;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="m-semantic-notice" data-tone={req.data.has_unpublished_snapshot_changes ? 'warning' : 'info'}>
        <div>
          <strong>Quy tắc phiên bản Snapshot bất biến:</strong> Mọi lớp học đang mở được ghim vào một bản Snapshot cụ thể. Khi bạn chỉnh sửa bài giảng ở bản nháp hiện tại, lớp đang chạy <strong>không bị tự động thay đổi</strong>; học viên chỉ nhận phiên bản mới cho các lớp mở sau hoặc khi được nâng cấp có kiểm soát.
          {req.data.has_unpublished_snapshot_changes && (
            <span style={{ display: 'block', marginTop: 6, fontWeight: 600 }}>
              Lưu ý: Khóa học hiện có thay đổi mới chưa đóng gói thành bản Snapshot.
            </span>
          )}
        </div>
      </div>

      {canManage && (
        <Card title="Xuất bản Snapshot mới từ cấu trúc hiện tại">
          <form onSubmit={publish} className="t-form-grid">
            <Field label="Nhãn phiên bản (tùy chọn)" hint="Nếu để trống, hệ thống tự đặt vN theo thứ tự">
              <input className="t-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: v2.0 — Học kỳ Spring 2027" />
            </Field>
            <Field label="Ghi chú thay đổi (Changelog)">
              <input className="t-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mô tả nội dung cập nhật..." />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Btn type="submit" variant="primary" loading={publishing}>
                Đóng gói & Xuất bản Snapshot mới
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <Card title="Lịch sử Snapshot đã xuất bản" padded={false}>
        {items.length === 0 ? (
          <EmptyState title="Chưa có bản Snapshot nào" text="Hãy xuất bản phiên bản Snapshot đầu tiên (v1) để các lớp học có thể ghim nội dung ổn định." />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Phiên bản</th>
                  <th>Ghi chú thay đổi</th>
                  <th>Ngày xuất bản</th>
                  <th>Người xuất bản</th>
                  <th className="num">Số lớp đang ghim</th>
                  {canManage && <th className="actions">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <strong className="tabular-nums">{v.version_label}</strong>
                      <span className="t-sub tabular-nums">#{v.version_number}</span>
                    </td>
                    <td>{v.changelog_note || <span className="t-sub">Không có ghi chú</span>}</td>
                    <td className="tabular-nums">{fmtDateTime(v.published_at)}</td>
                    <td>{v.published_by_name || '—'}</td>
                    <td className="num tabular-nums">{v.classes_using?.length ?? 0}</td>
                    {canManage && (
                      <td className="actions">
                        <Btn small variant="ghost" onClick={() => setCloneTarget({ id: v.id, label: v.version_label })}>
                          Khôi phục về bản nháp
                        </Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {cloneTarget && (
        <ConfirmDialog
          title={`Khôi phục Snapshot ${cloneTarget.label} về bản nháp?`}
          message="Hệ thống sẽ đồng bộ cấu trúc bài học nháp hiện tại theo đúng ảnh chụp của phiên bản này (không làm thay đổi các lớp đang chạy)."
          confirmLabel="Khôi phục bản nháp"
          onCancel={() => setCloneTarget(null)}
          onConfirm={async () => {
            try {
              const r = await masterApi.cloneVersionToDraft(course.id, cloneTarget.id);
              toast({
                tone: 'success',
                title: `Đã khôi phục bản nháp từ ${cloneTarget.label}`,
                detail: `${r.restored_lessons} bài học đã được nạp lại.`,
              });
              setCloneTarget(null);
              req.reload();
              onCourseChanged();
            } catch (ex) {
              toast({ tone: 'error', title: 'Không thể khôi phục bản nháp', detail: errMsg(ex) });
            }
          }}
        />
      )}
    </div>
  );
};

// ------------------------------------------------------------------ Page

export const CourseDetailPage: React.FC = () => {
  const { courseId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const section = (params.get('section') as Section) || 'overview';
  const navigate = useNavigate();
  const toast = useToast();
  const { data, setData, error, loading, reload } = useAsync(() => teachingApi.course(courseId), [courseId]);
  const me = useAsync(() => teachingApi.me(), []);
  const stats = useAsync(() => (section === 'stats' ? teachingApi.courseStats(courseId) : Promise.resolve(null)), [courseId, section]);
  const [editOpen, setEditOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<CourseStatus | null>(null);
  const [dupOpen, setDupOpen] = useState(false);

  if (loading && !data) return <Loading rows={5} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const c = data;
  const canManage = c.capabilities.can_manage;

  const STATUS_TEXT: Record<CourseStatus, string> = {
    PUBLISHED: 'Khóa học sẽ hiển thị với học viên của các lớp đang sử dụng (chỉ những bài học đã xuất bản).',
    DRAFT: 'Học viên sẽ không còn thấy nội dung khóa học cho tới khi xuất bản lại.',
    INACTIVE: 'Khóa học ngừng hoạt động: học viên không truy cập được và không thể liên kết với lớp mới.',
    ARCHIVED: 'Khóa học được lưu trữ, ẩn khỏi danh sách mặc định. Dữ liệu được giữ nguyên.',
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={<><Link to="/teaching/courses">Khóa học</Link><span aria-hidden="true">›</span><span>{c.code}</span></>}
        title={c.title}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge kind="course" value={c.status} />
            <span>{c.code}</span>
            {c.subject && <span>· {c.subject}</span>}
            <span>· Phụ trách: {c.instructor_name}</span>
          </span>
        }
        actions={
          <>
            <Link className="t-btn t-btn--primary" to={`/teaching/courses/${c.id}/studio`}>
              🎬 Mở Lesson Studio
            </Link>
            <Link className="t-btn" to={`/teaching/banks?course_id=${c.id}`}>
              Ngân hàng học liệu
            </Link>
            {canManage && c.status !== 'PUBLISHED' && <Btn variant="secondary" onClick={() => setStatusConfirm('PUBLISHED')}>Xuất bản khóa học</Btn>}
            {canManage && <Btn onClick={() => setEditOpen(true)}>Sửa thông tin</Btn>}
            {c.capabilities.can_duplicate && <Btn variant="ghost" onClick={() => setDupOpen(true)}>Sao chép</Btn>}
          </>
        }
      />

      <div className="t-split">
        <nav className="t-sidenav" aria-label="Mục quản lý khóa học">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" aria-current={section === s.id} onClick={() => setParams({ section: s.id })}>
              {s.label}
              <span className="t-sub tabular-nums" style={{ margin: 0 }}>
                {s.id === 'content' ? c.lessons_count : s.id === 'resources' ? c.resources_count : s.id === 'classes' ? c.classes.length : ''}
              </span>
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          {section === 'overview' && (
            <>
              <div className="t-stats">
                <div className="t-stat"><span className="t-stat__label">Chương</span><strong className="t-stat__value tabular-nums">{c.chapters_count}</strong></div>
                <div className="t-stat"><span className="t-stat__label">Bài học</span><strong className="t-stat__value tabular-nums">{c.lessons_count}</strong></div>
                <div className="t-stat"><span className="t-stat__label">Lớp sử dụng</span><strong className="t-stat__value tabular-nums">{c.classes.length}</strong></div>
                <div className="t-stat"><span className="t-stat__label">Cập nhật</span><strong className="t-stat__value tabular-nums" style={{ fontSize: 18 }}>{fmtDate(c.updated_at)}</strong></div>
              </div>
              <Card title="Thông tin khóa học">
                {c.thumbnail_url && (
                  <div className="t-img-preview" style={{ marginBottom: 16 }}>
                    <SmartImage src={c.thumbnail_url} alt={c.title} />
                  </div>
                )}
                <dl className="t-dl">
                  {[
                    ['Mô tả', c.description],
                    ['Mục tiêu học tập', c.objectives],
                    ['Đối tượng học', c.target_audience],
                    ['Kiến thức tiên quyết', c.prerequisites],
                    ['Giới thiệu', c.intro],
                  ].map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{v || <span className="t-sub">Chưa cập nhật</span>}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </Card>
              {canManage && (
                <Card title="Trạng thái khóa học">
                  <div className="t-actions">
                    {(['PUBLISHED', 'DRAFT', 'INACTIVE', 'ARCHIVED'] as CourseStatus[])
                      .filter((s) => s !== c.status)
                      .map((s) => (
                        <Btn key={s} variant={s === 'PUBLISHED' ? 'primary' : s === 'ARCHIVED' ? 'danger' : 'secondary'} onClick={() => setStatusConfirm(s)}>
                          {s === 'PUBLISHED' ? 'Xuất bản' : s === 'DRAFT' ? 'Chuyển về bản nháp' : s === 'INACTIVE' ? 'Ngừng hoạt động' : 'Lưu trữ'}
                        </Btn>
                      ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {section === 'content' && <OutlineEditor course={c} onChanged={reload} setOutline={(o) => setData({ ...c, outline: o })} />}
          {section === 'versions' && <VersionsSection course={c} onCourseChanged={reload} />}
          {section === 'resources' && <ResourcesSection courseId={c.id} />}
          {section === 'wiki' && <CourseWikiPanel courseId={c.id} />}
          {section === 'forum' && <ForumWorkspace mode="course" targetId={c.id} />}

          {section === 'classes' && (
            <Card
              title="Lớp học đang sử dụng khóa học"
              actions={me.data?.can_create_class && c.status !== 'ARCHIVED' && c.status !== 'INACTIVE' && (
                <Link className="t-btn t-btn--primary t-btn--small" to={`/teaching/classes?new=1&course=${c.id}`}>+ Tạo lớp dùng khóa học này</Link>
              )}
            >
              {c.classes.length === 0 ? (
                <EmptyState title="Chưa có lớp nào sử dụng khóa học" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead><tr><th>Lớp</th><th>Trạng thái</th><th className="num">Học viên</th></tr></thead>
                    <tbody>
                      {c.classes.map((k) => (
                        <tr key={k.id}>
                          <td><Link className="t-row-link" to={`/teaching/classes/${k.id}`}>{k.code}</Link><span className="t-sub">{k.title}</span></td>
                          <td><Badge kind="class" value={k.status} /></td>
                          <td className="num">{k.student_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {section === 'stats' && (
            <Card title="Mức độ hoàn thành bài học">
              {stats.loading && <Loading />}
              {stats.error && <ErrorState error={stats.error} onRetry={stats.reload} />}
              {stats.data && (stats.data.lessons.length === 0 ? (
                <EmptyState title="Chưa có bài học nào được xuất bản" />
              ) : (
                <>
                  <p className="t-sub" style={{ marginTop: -8 }}>
                    {stats.data.published_lessons} bài học đã xuất bản · {stats.data.total_students} học viên thuộc {stats.data.classes.length} lớp.
                  </p>
                  <div className="t-table-wrap">
                    <table className="t-table">
                      <thead><tr><th>Bài học</th><th>Số học viên đã hoàn thành</th></tr></thead>
                      <tbody>
                        {stats.data.lessons.map((l) => (
                          <tr key={l.lesson_id}>
                            <td>{l.title}</td>
                            <td><ProgressMeter value={l.completed_count} total={stats.data!.total_students} label={`Hoàn thành ${l.title}`} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ))}
            </Card>
          )}
        </div>
      </div>

      {editOpen && me.data && (
        <CourseFormModal
          course={c}
          canPickInstructor={me.data.can_pick_instructor}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            reload();
          }}
        />
      )}
      {statusConfirm && (
        <ConfirmDialog
          title="Đổi trạng thái khóa học?"
          message={STATUS_TEXT[statusConfirm]}
          confirmLabel="Xác nhận"
          danger={statusConfirm === 'ARCHIVED' || statusConfirm === 'INACTIVE'}
          onCancel={() => setStatusConfirm(null)}
          onConfirm={async () => {
            await teachingApi.setCourseStatus(c.id, statusConfirm);
            setStatusConfirm(null);
            toast({ tone: 'success', title: 'Đã cập nhật trạng thái khóa học' });
            reload();
          }}
        />
      )}
      {dupOpen && (
        <ConfirmDialog
          title="Sao chép khóa học?"
          message="Hệ thống tạo một khóa học mới ở trạng thái Bản nháp với toàn bộ chương, bài học (bản nháp) và tài liệu. Lớp đang dùng khóa gốc không bị ảnh hưởng."
          confirmLabel="Tạo bản sao"
          onCancel={() => setDupOpen(false)}
          onConfirm={async () => {
            const copy = await teachingApi.duplicateCourse(c.id, {});
            setDupOpen(false);
            toast({ tone: 'success', title: 'Đã tạo bản sao', detail: copy.code });
            navigate(`/teaching/courses/${copy.id}`);
          }}
        />
      )}
    </div>
  );
};
