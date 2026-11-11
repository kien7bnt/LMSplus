import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiHttpError } from '../../api/elearningClient';
import { CompletionRule, LessonBlock, LessonEditorData, Resource, saveBlob, teachingApi } from '../api';
import { BlockEditor } from '../BlockEditor';
import { BlockList } from '../BlockRenderer';
import {
  Badge, Btn, Card, ConfirmDialog, ErrorState, Field, Loading, PageHeader, Tone,
  errMsg, fmtDateTime, useToast, useUnsavedWarning,
} from '../ui';

export const LessonEditorPage: React.FC = () => {
  const { lessonId = '' } = useParams();
  const toast = useToast();

  const [lesson, setLesson] = useState<LessonEditorData | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [meta, setMeta] = useState({
    title: '',
    description: '',
    objectives: '',
    duration_minutes: 30,
    completion_rule: 'MANUAL' as CompletionRule,
  });
  const [blocksDirty, setBlocksDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | 'unpublish' | 'archive'>(null);

  const dirty = blocksDirty || metaDirty;
  useUnsavedWarning(dirty);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    setConflict(null);
    try {
      const data = await teachingApi.lesson(lessonId);
      setLesson(data);
      setBlocks(data.blocks);
      setMeta({
        title: data.title,
        description: data.description || '',
        objectives: data.objectives || '',
        duration_minutes: data.duration_minutes || 30,
        completion_rule: data.completion_rule || 'MANUAL',
      });
      setBlocksDirty(false);
      setMetaDirty(false);
      const res = await teachingApi.resources(data.course.id).catch(() => ({ items: [], can_edit: false }));
      setResources(res.items);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  if (loading) return <Loading label="Đang tải bài học…" rows={5} />;
  if (error || !lesson) return <ErrorState error={error} onRetry={loadAll} />;

  const canEdit = lesson.capabilities.can_edit && lesson.publish_status !== 'ARCHIVED';
  const canPublish = lesson.capabilities.can_publish && lesson.publish_status !== 'ARCHIVED';

  const saveDraft = async (): Promise<boolean> => {
    if (!canEdit) return false;
    if (!meta.title.trim()) {
      toast({ tone: 'error', title: 'Thiếu tiêu đề bài học', detail: 'Vui lòng nhập tên bài học trước khi lưu.' });
      return false;
    }
    setSaving(true);
    setConflict(null);
    try {
      if (metaDirty) {
        await teachingApi.updateLesson(lesson.id, {
          title: meta.title.trim(),
          description: meta.description,
          objectives: meta.objectives,
          duration_minutes: Math.max(1, Number(meta.duration_minutes) || 15),
          completion_rule: meta.completion_rule,
        });
        setMetaDirty(false);
      }
      const saved = await teachingApi.saveLessonContent(lesson.id, lesson.revision, blocks);
      setBlocks(saved.blocks);
      setBlocksDirty(false);
      setLesson((prev) =>
        prev
          ? {
              ...prev,
              title: meta.title.trim(),
              description: meta.description,
              objectives: meta.objectives,
              duration_minutes: Math.max(1, Number(meta.duration_minutes) || 15),
              completion_rule: meta.completion_rule,
              revision: saved.revision,
              updated_at: new Date().toISOString(),
            }
          : prev
      );
      toast({ tone: 'success', title: 'Đã lưu bản nháp bài học' });
      return true;
    } catch (e) {
      if (e instanceof ApiHttpError && e.status === 409) {
        setConflict(e.message || 'Bài học vừa được cập nhật ở phiên làm việc khác. Hãy tải lại phiên bản mới nhất trước khi tiếp tục.');
      } else {
        toast({ tone: 'error', title: 'Không lưu được bài học', detail: errMsg(e) });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const publishNow = async () => {
    setPublishing(true);
    try {
      if (dirty) {
        const ok = await saveDraft();
        if (!ok) return;
      }
      const res = await teachingApi.publishLesson(lesson.id);
      setLesson((prev) =>
        prev
          ? {
              ...prev,
              publish_status: res.publish_status,
              published_version: res.published_version,
              published_at: new Date().toISOString(),
            }
          : prev
      );
      toast({
        tone: 'success',
        title: `Đã xuất bản phiên bản ${res.published_version}`,
        detail: 'Học viên trong các lớp đang học sẽ thấy ngay nội dung mới.',
      });
    } catch (e) {
      toast({ tone: 'error', title: 'Không thể xuất bản bài học', detail: errMsg(e) });
    } finally {
      setPublishing(false);
    }
  };

  const resourceMap: Record<string, Resource & { available: boolean }> = {};
  resources.forEach((r) => {
    resourceMap[r.id] = { ...r, available: r.available !== false };
  });

  const handleDownload = async (resourceId: string) => {
    try {
      const file = await teachingApi.downloadResource(resourceId);
      saveBlob(file);
    } catch (e) {
      toast({ tone: 'error', title: 'Không tải được tài liệu', detail: errMsg(e) });
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/teaching/courses">Khóa học</Link>
            <span>/</span>
            <Link to={`/teaching/courses/${lesson.course.id}?section=content`}>{lesson.course.title}</Link>
            <span>/</span>
            <span>{lesson.chapter.title}</span>
          </>
        }
        title={meta.title || lesson.title}
        subtitle={
          <>
            <Badge kind="lesson" value={lesson.publish_status} />{' '}
            {lesson.published_version > 0 && (
              <span className="tabular-nums">· Bản xuất bản v{lesson.published_version} ({fmtDateTime(lesson.published_at)})</span>
            )}
            {dirty && <> · <Tone tone="warning">Có thay đổi chưa lưu</Tone></>}
          </>
        }
        actions={
          <>
            <Btn variant={preview ? 'secondary' : 'quiet'} onClick={() => setPreview((p) => !p)}>
              {preview ? 'Quay lại chỉnh sửa' : 'Xem trước như học viên'}
            </Btn>
            {canEdit && (
              <Btn variant="secondary" onClick={saveDraft} loading={saving} disabled={!dirty && blocks.length > 0}>
                Lưu bản nháp
              </Btn>
            )}
            {canPublish && (
              <Btn variant="primary" onClick={publishNow} loading={publishing}>
                {lesson.published_version > 0 ? 'Cập nhật bản xuất bản' : 'Xuất bản bài học'}
              </Btn>
            )}
          </>
        }
      />

      {conflict && (
        <div className="t-notice t-notice--danger" role="alert" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong>Phát hiện xung đột phiên bản chỉnh sửa</strong>
            <div style={{ marginTop: 4 }}>{conflict}</div>
          </div>
          <Btn variant="danger" onClick={loadAll}>
            Tải lại bản mới nhất
          </Btn>
        </div>
      )}

      {lesson.publish_status === 'ARCHIVED' && (
        <div className="t-notice t-notice--warning" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Bài học này đang được lưu trữ và ẩn khỏi học viên. Khôi phục để chỉnh sửa hoặc xuất bản lại.</span>
          {lesson.capabilities.can_publish && (
            <Btn
              onClick={async () => {
                try {
                  await teachingApi.restoreLesson(lesson.id);
                  toast({ tone: 'success', title: 'Đã khôi phục bài học về bản nháp' });
                  await loadAll();
                } catch (e) {
                  toast({ tone: 'error', title: 'Không khôi phục được', detail: errMsg(e) });
                }
              }}
            >
              Khôi phục bài học
            </Btn>
          )}
        </div>
      )}

      {preview ? (
        <Card
          title="Xem trước giao diện học viên"
          actions={
            <span className="t-sub tabular-nums">
              Thời lượng dự kiến: {meta.duration_minutes} phút · {blocks.length} khối nội dung
            </span>
          }
        >
          {meta.objectives && (
            <div className="t-callout" style={{ marginBottom: 20, maxWidth: '75ch' }}>
              <strong>Mục tiêu bài học</strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{meta.objectives}</span>
            </div>
          )}
          {blocks.length === 0 ? (
            <p className="t-sub">Bài học chưa có khối nội dung nào.</p>
          ) : (
            <BlockList
              blocks={blocks}
              ctx={{
                previewMode: true,
                resources: resourceMap,
                videoMarkers: lesson.video_markers,
                onDownload: handleDownload,
              }}
            />
          )}
        </Card>
      ) : (
        <div className="t-editor">
          <Card
            title="Nội dung bài giảng & Video YouTube"
            actions={
              <span className="t-sub">
                Chèn nhiều khối văn bản, video YouTube, hình ảnh, công thức, tài liệu và câu hỏi ôn tập theo thứ tự sư phạm.
              </span>
            }
          >
            <BlockEditor
              blocks={blocks}
              disabled={!canEdit}
              resources={resources}
              onChange={(next) => {
                setBlocks(next);
                setBlocksDirty(true);
              }}
            />
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Thiết lập bài học">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Tên bài học" required>
                  <input
                    className="t-input"
                    value={meta.title}
                    maxLength={200}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setMeta((m) => ({ ...m, title: e.target.value }));
                      setMetaDirty(true);
                    }}
                  />
                </Field>
                <Field label="Thời lượng dự kiến (phút)">
                  <input
                    className="t-input tabular-nums"
                    type="number"
                    min={1}
                    max={600}
                    value={meta.duration_minutes}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setMeta((m) => ({ ...m, duration_minutes: Math.max(1, Number(e.target.value) || 15) }));
                      setMetaDirty(true);
                    }}
                  />
                </Field>
                <Field label="Điều kiện hoàn thành bài học">
                  <select
                    className="t-input"
                    value={meta.completion_rule}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setMeta((m) => ({ ...m, completion_rule: e.target.value as CompletionRule }));
                      setMetaDirty(true);
                    }}
                  >
                    <option value="MANUAL">Học viên bấm xác nhận hoàn thành</option>
                    <option value="REVIEW_CORRECT">Trả lời đúng mọi câu hỏi ôn tập</option>
                    <option value="VIDEO_AND_QUIZ">Xem đủ thời lượng video & trả lời mốc tương tác</option>
                  </select>
                </Field>
                <Field label="Mục tiêu cần đạt">
                  <textarea
                    className="t-input"
                    rows={3}
                    maxLength={2000}
                    value={meta.objectives}
                    disabled={!canEdit}
                    placeholder="Sau bài học này, học viên có thể…"
                    onChange={(e) => {
                      setMeta((m) => ({ ...m, objectives: e.target.value }));
                      setMetaDirty(true);
                    }}
                  />
                </Field>
                <Field label="Tóm tắt ngắn">
                  <textarea
                    className="t-input"
                    rows={2}
                    maxLength={1000}
                    value={meta.description}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setMeta((m) => ({ ...m, description: e.target.value }));
                      setMetaDirty(true);
                    }}
                  />
                </Field>
              </div>
            </Card>

            <Card title="Tài liệu & Trạng thái">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p className="t-sub" style={{ margin: 0 }}>
                  Khóa học hiện có <strong className="tabular-nums">{resources.length}</strong> tài liệu đính kèm và đang phục vụ{' '}
                  <strong className="tabular-nums">{lesson.course.classes_using}</strong> lớp học.
                </p>
                <Link className="t-btn t-btn--small" to={`/teaching/courses/${lesson.course.id}?section=resources`}>
                  Quản lý kho tài liệu khóa học
                </Link>
                {lesson.capabilities.can_publish && lesson.publish_status === 'PUBLISHED' && (
                  <Btn small variant="ghost" onClick={() => setConfirmAction('unpublish')}>
                    Chuyển về bản nháp (ẩn tạm thời)
                  </Btn>
                )}
                {lesson.capabilities.can_publish && lesson.publish_status !== 'ARCHIVED' && (
                  <Btn small variant="danger" onClick={() => setConfirmAction('archive')}>
                    Lưu trữ bài học
                  </Btn>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === 'unpublish' ? 'Chuyển bài học về bản nháp?' : 'Lưu trữ bài học?'}
          message={
            confirmAction === 'unpublish'
              ? 'Bài học sẽ tạm ẩn khỏi danh sách học tập của học viên cho tới khi bạn xuất bản lại. Tiến độ cũ vẫn được giữ nguyên.'
              : 'Bài học sẽ chuyển sang trạng thái lưu trữ và ẩn với học viên. Bạn có thể khôi phục bất kỳ lúc nào.'
          }
          confirmLabel={confirmAction === 'unpublish' ? 'Chuyển về nháp' : 'Lưu trữ'}
          danger={confirmAction === 'archive'}
          onCancel={() => setConfirmAction(null)}
          onConfirm={async () => {
            if (confirmAction === 'unpublish') await teachingApi.unpublishLesson(lesson.id);
            else await teachingApi.archiveLesson(lesson.id);
            setConfirmAction(null);
            toast({ tone: 'success', title: 'Đã cập nhật trạng thái bài học' });
            await loadAll();
          }}
        />
      )}
    </div>
  );
};
