/**
 * Cấp 1 — Quản lý Khung chương trình (Curricula) & Môn học trực thuộc.
 */
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Course,
  CurriculumDetail,
  CurriculumItem,
  CurriculumStatus,
  masterApi,
  teachingApi,
} from '../api';
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
  fmtDate,
  fmtDateTime,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

export const CurriculumListPage: React.FC = () => {
  const nav = useNavigate();
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const list = useAsync(
    () => masterApi.listCurricula({ q: dq, status, page, page_size: 20 }),
    [dq, status, page]
  );

  return (
    <div className="t-page">
      <PageHeader
        title="Khung chương trình đào tạo"
        subtitle="Cấp 1 — Quản lý danh mục môn học, định mức tiết học và các khóa đào tạo sử dụng khung chương trình."
        actions={
          <Btn variant="primary" onClick={() => setCreating(true)}>
            + Tạo khung chương trình
          </Btn>
        }
      />

      <Card>
        <div className="t-toolbar">
          <SearchInput
            value={q}
            onChange={(v) => { setQ(v); setPage(1); }}
            placeholder="Tìm theo mã hoặc tên khung chương trình…"
          />
          <select
            className="t-input t-select"
            aria-label="Lọc trạng thái khung chương trình"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang áp dụng</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </div>

        {list.loading && <Loading rows={4} />}
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            title="Chưa có khung chương trình nào"
            text="Hãy tạo khung chương trình đầu tiên để gắn các môn học và triển khai lớp khóa học."
            action={
              <Btn variant="primary" onClick={() => setCreating(true)}>
                Tạo khung chương trình
              </Btn>
            }
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã khung</th>
                    <th>Tên khung chương trình</th>
                    <th>Phiên bản</th>
                    <th>Số môn học</th>
                    <th>Khóa đang dùng</th>
                    <th>Trạng thái</th>
                    <th>Cập nhật</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c: CurriculumItem) => (
                    <tr key={c.id}>
                      <td><code>{c.code}</code></td>
                      <td>
                        <Link to={`/teaching/curricula/${c.id}`} className="t-row-link">
                          <strong>{c.title}</strong>
                        </Link>
                        {c.description && <div className="t-muted t-small">{c.description}</div>}
                      </td>
                      <td className="tabular-nums">v{c.version}</td>
                      <td className="tabular-nums">{c.subjects_count} môn</td>
                      <td className="tabular-nums">{c.cohorts_count} khóa</td>
                      <td><Badge kind="curriculum" value={c.status} /></td>
                      <td className="tabular-nums">{fmtDate(c.updated_at)}</td>
                      <td className="t-right">
                        <Btn small onClick={() => nav(`/teaching/curricula/${c.id}`)}>
                          Chi tiết
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <CreateCurriculumModal
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            push('Đã tạo khung chương trình mới', created.title, 'success');
            nav(`/teaching/curricula/${created.id}`);
          }}
        />
      )}
    </div>
  );
};

const CreateCurriculumModal: React.FC<{ onClose: () => void; onCreated: (c: CurriculumItem) => void }> = ({
  onClose,
  onCreated,
}) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('1.0');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [status, setStatus] = useState<CurriculumStatus>('ACTIVE');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await masterApi.createCurriculum({
        code: code.trim(),
        title: title.trim(),
        version: version.trim() || '1.0',
        effective_date: effectiveDate || undefined,
        status,
        description: description.trim(),
      });
      onCreated(created);
    } catch (ex) {
      setErr(errMsg(ex));
      push('Không tạo được khung chương trình', errMsg(ex), 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo khung chương trình mới"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="curr-create-form" loading={busy}>Lưu khung chương trình</Btn>
        </>
      }
    >
      <form id="curr-create-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Mã khung chương trình" required hint="Ví dụ: CT-CNTT-2026">
          <input className="t-input" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} />
        </Field>
        <Field label="Phiên bản">
          <input className="t-input" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={24} />
        </Field>
        <Field label="Tên khung chương trình" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="Ngày hiệu lực">
          <input type="date" className="t-input" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <Field label="Trạng thái">
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as CurriculumStatus)}>
            <option value="ACTIVE">Đang áp dụng</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </Field>
        <Field label="Mô tả tổng quan" wide>
          <textarea className="t-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

export const CurriculumDetailPage: React.FC = () => {
  const { curriculumId = '' } = useParams();
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const detail = useAsync(() => masterApi.getCurriculum(curriculumId), [curriculumId]);
  const [tab, setTab] = useState('subjects');
  const [editingInfo, setEditingInfo] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const [removingItem, setRemovingItem] = useState<{ id: string; title: string } | null>(null);

  if (detail.loading) return <div className="t-page"><Loading rows={6} /></div>;
  if (detail.error) return <div className="t-page"><ErrorState error={detail.error} onRetry={detail.reload} /></div>;
  const c = detail.data!;

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/teaching/curricula">Khung chương trình</Link> / <span>{c.code}</span>
          </>
        }
        title={
          <span className="t-title-inline">
            {c.title} <Badge kind="curriculum" value={c.status} />
          </span>
        }
        subtitle={`Mã ${c.code} · Phiên bản ${c.version} · Hiệu lực ${fmtDate(c.effective_date)} · ${c.subjects.length} môn học`}
        actions={
          <>
            {c.capabilities.can_manage && (
              <>
                <Btn onClick={() => setEditingInfo(true)}>Sửa thông tin</Btn>
                <Btn variant="primary" onClick={() => setAddingSubject(true)}>+ Thêm môn học vào khung</Btn>
              </>
            )}
          </>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'subjects', label: 'Danh sách môn học', badge: c.subjects.length },
          { id: 'cohorts', label: 'Lớp khóa học áp dụng', badge: c.cohorts.length },
          { id: 'audit', label: 'Nhật ký thay đổi', badge: c.audit_logs.length },
        ]}
      />

      {tab === 'subjects' && (
        <Card title="Cấu trúc môn học theo học kỳ">
          {c.subjects.length === 0 ? (
            <EmptyState
              title="Khung chương trình chưa có môn học"
              text="Hãy thêm các môn học hiện có vào khung để chuẩn bị mở Lớp khóa học."
              action={c.capabilities.can_manage ? <Btn variant="primary" onClick={() => setAddingSubject(true)}>+ Thêm môn học</Btn> : undefined}
            />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Học kỳ</th>
                    <th>Mã môn</th>
                    <th>Môn học</th>
                    <th>Phiên bản mới nhất</th>
                    <th>Số tiết dự kiến</th>
                    <th>Số giờ</th>
                    <th>Loại</th>
                    <th>Ghi chú</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {c.subjects.map((s) => (
                    <tr key={s.id}>
                      <td className="tabular-nums">HK {s.semester_order}</td>
                      <td><code>{s.course_code}</code></td>
                      <td>
                        <Link to={`/teaching/courses/${s.course_id}`} className="t-row-link">
                          <strong>{s.course_title}</strong>
                        </Link>
                        <div className="t-muted t-small">GV: {s.instructor_name}</div>
                      </td>
                      <td className="tabular-nums">{s.latest_version_number ? `v${s.latest_version_number}.0` : 'Bản nháp'}</td>
                      <td className="tabular-nums">{s.planned_periods} tiết</td>
                      <td className="tabular-nums">{s.planned_hours} giờ</td>
                      <td>{s.is_mandatory ? 'Bắt buộc' : 'Tự chọn'}</td>
                      <td className="t-small">{s.note || '—'}</td>
                      <td className="t-right">
                        {c.capabilities.can_manage && (
                          <Btn small variant="ghost" onClick={() => setRemovingItem({ id: s.id, title: s.course_title })}>
                            Gỡ môn
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'cohorts' && (
        <Card
          title="Các Lớp khóa học đang áp dụng khung chương trình này"
          actions={<Link className="t-btn t-btn--secondary t-btn--small" to="/teaching/cohorts">Quản lý lớp khóa học</Link>}
        >
          {c.cohorts.length === 0 ? (
            <EmptyState title="Chưa có lớp khóa học nào" text="Tạo một lớp khóa học mới từ mục Lớp khóa học và chọn khung chương trình này." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã khóa</th>
                    <th>Tên lớp khóa học</th>
                    <th>Niên khóa / Kỳ</th>
                    <th>Học viên (DISTINCT)</th>
                    <th>Số lớp môn học</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {c.cohorts.map((ch) => (
                    <tr key={ch.id}>
                      <td><code>{ch.code}</code></td>
                      <td><Link to={`/teaching/cohorts/${ch.id}`} className="t-row-link"><strong>{ch.title}</strong></Link></td>
                      <td>{ch.academic_year || '—'} · {ch.semester || '—'}</td>
                      <td className="tabular-nums">{ch.active_students_count}</td>
                      <td className="tabular-nums">{ch.subject_classes_count}</td>
                      <td><Badge kind="cohort" value={ch.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Nhật ký chỉnh sửa khung chương trình">
          {c.audit_logs.length === 0 ? (
            <EmptyState title="Chưa có nhật ký thay đổi" />
          ) : (
            <ul className="t-list">
              {c.audit_logs.map((log) => (
                <li key={log.id} className="t-list-item">
                  <div>
                    <strong>{log.action}</strong>
                    <div className="t-muted t-small">Thực hiện bởi {log.actor_name} · {fmtDateTime(log.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {editingInfo && (
        <EditCurriculumModal
          curr={c}
          onClose={() => setEditingInfo(false)}
          onSaved={() => {
            setEditingInfo(false);
            push('Đã cập nhật khung chương trình', '', 'success');
            detail.reload();
          }}
        />
      )}

      {addingSubject && (
        <AddSubjectModal
          curriculum={c}
          onClose={() => setAddingSubject(false)}
          onAdded={() => {
            setAddingSubject(false);
            push('Đã gắn môn học vào khung chương trình', '', 'success');
            detail.reload();
          }}
        />
      )}

      {removingItem && (
        <ConfirmDialog
          title="Gỡ môn học khỏi khung chương trình?"
          message={<>Môn <strong>{removingItem.title}</strong> sẽ bị gỡ khỏi khung chương trình. Các lớp môn học đang học hiện tại vẫn giữ nguyên nếu đã khởi tạo.</>}
          confirmLabel="Gỡ khỏi khung"
          danger
          onCancel={() => setRemovingItem(null)}
          onConfirm={async () => {
            await masterApi.removeCurriculumSubject(c.id, removingItem.id);
            setRemovingItem(null);
            push('Đã gỡ môn học', '', 'info');
            detail.reload();
          }}
        />
      )}
    </div>
  );
};

const EditCurriculumModal: React.FC<{ curr: CurriculumDetail; onClose: () => void; onSaved: () => void }> = ({
  curr,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState(curr.title);
  const [version, setVersion] = useState(curr.version);
  const [status, setStatus] = useState<CurriculumStatus>(curr.status);
  const [description, setDescription] = useState(curr.description);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await masterApi.updateCurriculum(curr.id, { title: title.trim(), version: version.trim(), status, description: description.trim() });
      onSaved();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Chỉnh sửa khung chương trình"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="curr-edit-form" loading={busy}>Lưu thay đổi</Btn>
        </>
      }
    >
      <form id="curr-edit-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Tên khung chương trình" required wide>
          <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Phiên bản">
          <input className="t-input" value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>
        <Field label="Trạng thái">
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as CurriculumStatus)}>
            <option value="ACTIVE">Đang áp dụng</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </Field>
        <Field label="Mô tả" wide>
          <textarea className="t-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};

const AddSubjectModal: React.FC<{ curriculum: CurriculumDetail; onClose: () => void; onAdded: () => void }> = ({
  curriculum,
  onClose,
  onAdded,
}) => {
  const courses = useAsync(() => teachingApi.courses({ page_size: 100 }), []);
  const existingIds = useMemo(() => new Set(curriculum.subjects.map((s) => s.course_id)), [curriculum.subjects]);
  const availableCourses = useMemo(
    () => (courses.data?.items || []).filter((c: Course) => !existingIds.has(c.id)),
    [courses.data, existingIds]
  );

  const [courseId, setCourseId] = useState('');
  const [semesterOrder, setSemesterOrder] = useState(1);
  const [plannedPeriods, setPlannedPeriods] = useState(30);
  const [plannedHours, setPlannedHours] = useState(45);
  const [isMandatory, setIsMandatory] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = courseId || availableCourses[0]?.id || '';
    if (!targetId) {
      setErr('Vui lòng chọn một môn học.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await masterApi.addCurriculumSubject(curriculum.id, {
        course_id: targetId,
        semester_order: Number(semesterOrder) || 1,
        planned_periods: Number(plannedPeriods) || 30,
        planned_hours: Number(plannedHours) || 45,
        is_mandatory: isMandatory,
        note: note.trim(),
      });
      onAdded();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Thêm môn học vào khung chương trình"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="curr-add-subj" loading={busy} disabled={availableCourses.length === 0}>
            Thêm vào khung
          </Btn>
        </>
      }
    >
      {courses.loading && <Loading rows={2} />}
      {!courses.loading && availableCourses.length === 0 ? (
        <EmptyState title="Không còn môn học chưa gắn" text="Tất cả môn học hiện có đã nằm trong khung chương trình này." />
      ) : (
        <form id="curr-add-subj" className="t-form-grid" onSubmit={submit}>
          <Field label="Chọn môn học" required wide>
            <select className="t-input" value={courseId || availableCourses[0]?.id || ''} onChange={(e) => setCourseId(e.target.value)}>
              {availableCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.code}] {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Học kỳ / Đợt">
            <input type="number" min={1} max={12} className="t-input" value={semesterOrder} onChange={(e) => setSemesterOrder(Number(e.target.value))} />
          </Field>
          <Field label="Loại môn học">
            <select className="t-input" value={isMandatory ? '1' : '0'} onChange={(e) => setIsMandatory(e.target.value === '1')}>
              <option value="1">Bắt buộc</option>
              <option value="0">Tự chọn</option>
            </select>
          </Field>
          <Field label="Số tiết dự kiến">
            <input type="number" min={1} max={500} className="t-input" value={plannedPeriods} onChange={(e) => setPlannedPeriods(Number(e.target.value))} />
          </Field>
          <Field label="Số giờ học">
            <input type="number" min={1} max={500} className="t-input" value={plannedHours} onChange={(e) => setPlannedHours(Number(e.target.value))} />
          </Field>
          <Field label="Ghi chú" wide>
            <input className="t-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
        </form>
      )}
    </Modal>
  );
};
