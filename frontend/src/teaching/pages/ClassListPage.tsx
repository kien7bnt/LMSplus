import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClassStatus, ClassSummary, Course, DeliveryMode, teachingApi } from '../api';
import {
  Badge, Btn, Card, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Pagination, SearchInput, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, label, useAsync, useDebounced, useToast,
} from '../ui';

const CREATE_STATUSES: ClassStatus[] = ['UPCOMING', 'ACTIVE', 'DRAFT'];
const ALL_STATUSES: ClassStatus[] = ['DRAFT', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
const DELIVERY_MODES: DeliveryMode[] = ['OFFLINE', 'ONLINE', 'HYBRID'];

export const ClassFormModal: React.FC<{
  initial?: ClassSummary;
  defaultCourseId?: string;
  canPickInstructor: boolean;
  onClose: () => void;
  onSaved: (cls: ClassSummary) => void;
}> = ({ initial, defaultCourseId, canPickInstructor, onClose, onSaved }) => {
  const toast = useToast();
  const [code, setCode] = useState(initial?.code || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [subject, setSubject] = useState(initial?.subject || '');
  const [courseId, setCourseId] = useState(initial?.course?.id || defaultCourseId || '');
  const [instructorId, setInstructorId] = useState(
    initial?.staff.find((s) => s.staff_role === 'PRIMARY_INSTRUCTOR')?.id || ''
  );
  const [startDate, setStartDate] = useState(initial?.start_date || '');
  const [endDate, setEndDate] = useState(initial?.end_date || '');
  const [maxStudents, setMaxStudents] = useState(initial?.max_students ? String(initial.max_students) : '40');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(initial?.delivery_mode || 'OFFLINE');
  const [status, setStatus] = useState<ClassStatus>(initial?.status || 'ACTIVE');
  const [room, setRoom] = useState(initial?.room || '');
  const [scheduleText, setScheduleText] = useState(initial?.schedule_text || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coursesReq = useAsync(() => teachingApi.courses({ page_size: 100 }), []);
  const instructorsReq = useAsync(
    () => (canPickInstructor ? teachingApi.users('INSTRUCTOR') : Promise.resolve({ items: [] })),
    [canPickInstructor]
  );

  const availableCourses: Course[] = (coursesReq.data?.items || []).filter(
    (c) => c.status !== 'ARCHIVED' && c.status !== 'INACTIVE' || c.id === initial?.course?.id
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !title.trim()) {
      setError('Vui lòng nhập mã lớp và tên lớp học.');
      return;
    }
    if (!initial && canPickInstructor && !instructorId && (instructorsReq.data?.items.length || 0) > 0) {
      setError('Vui lòng chọn giảng viên phụ trách lớp.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: code.trim(),
        title: title.trim(),
        subject: subject.trim(),
        course_id: courseId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        max_students: maxStudents.trim() ? Number(maxStudents) : null,
        delivery_mode: deliveryMode,
        status,
        room: room.trim(),
        schedule_text: scheduleText.trim(),
        description: description.trim(),
      };
      if (canPickInstructor && instructorId) {
        payload.instructor_id = instructorId;
      }
      const saved = initial ? await teachingApi.updateClass(initial.id, payload) : await teachingApi.createClass(payload);
      toast({ tone: 'success', title: initial ? 'Đã cập nhật thông tin lớp học' : 'Đã tạo lớp học mới' });
      onSaved(saved);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  const statuses = initial ? ALL_STATUSES : CREATE_STATUSES;

  return (
    <Modal
      title={initial ? 'Chỉnh sửa lớp học' : 'Tạo lớp học mới'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Hủy
          </Btn>
          <Btn variant="primary" onClick={submit} loading={busy}>
            {initial ? 'Lưu thay đổi' : 'Tạo lớp học'}
          </Btn>
        </>
      }
    >
      <form onSubmit={submit} className="t-form-grid">
        <Field label="Mã lớp" required hint="Ví dụ: TOAN5-5A1-HK1">
          <input className="t-input" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Tên lớp học" required>
          <input className="t-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="vd: Toán 5 — Lớp 5A1" />
        </Field>
        <Field label="Khóa học sử dụng (giáo trình)" wide hint="Một khóa học có thể gắn cho nhiều lớp khác nhau.">
          <select
            className="t-input"
            value={courseId}
            onChange={(e) => {
              const id = e.target.value;
              setCourseId(id);
              const found = availableCourses.find((c) => c.id === id);
              if (found && !subject.trim()) setSubject(found.subject || '');
            }}
          >
            <option value="">— Chưa liên kết khóa học —</option>
            {availableCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title} ({label('course', c.status)})
              </option>
            ))}
          </select>
        </Field>
        {canPickInstructor && (
          <Field label="Giảng viên phụ trách chính" required={!initial} wide>
            <select className="t-input" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              <option value="">— Chọn giảng viên —</option>
              {(instructorsReq.data?.items || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Môn học / Chuyên đề">
          <input className="t-input" value={subject} maxLength={100} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Hình thức giảng dạy">
          <select className="t-input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}>
            {DELIVERY_MODES.map((m) => (
              <option key={m} value={m}>
                {label('delivery', m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ngày bắt đầu">
          <input className="t-input tabular-nums" type="date" value={startDate || ''} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Ngày kết thúc">
          <input className="t-input tabular-nums" type="date" value={endDate || ''} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Sĩ số tối đa">
          <input className="t-input tabular-nums" type="number" min={1} max={1000} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} />
        </Field>
        <Field label="Trạng thái lớp">
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as ClassStatus)}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {label('class', s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phòng học / Đường dẫn trực tuyến">
          <input className="t-input" value={room} maxLength={200} onChange={(e) => setRoom(e.target.value)} placeholder="vd: Phòng P.201 hoặc đường dẫn họp" />
        </Field>
        <Field label="Lịch học tóm tắt">
          <input className="t-input" value={scheduleText} maxLength={300} onChange={(e) => setScheduleText(e.target.value)} placeholder="vd: Thứ 2 & Thứ 5 · 08:00–09:30" />
        </Field>
        <Field label="Ghi chú / Mô tả lớp" wide>
          <textarea className="t-input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && (
          <p className="t-field__error t-field--wide" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
};

export const ClassListPage: React.FC = () => {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const dq = useDebounced(q);
  const status = sp.get('status') || '';
  const courseId = sp.get('course_id') || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [editing, setEditing] = useState<ClassSummary | null>(null);

  const meReq = useAsync(() => teachingApi.me(), []);
  const coursesReq = useAsync(() => teachingApi.courses({ page_size: 100 }), []);
  const listReq = useAsync(
    () => teachingApi.classes({ q: dq || undefined, status: status || undefined, course_id: courseId || undefined, page, page_size: 12 }),
    [dq, status, courseId, page]
  );

  const updateParam = (key: string, val: string) => {
    const next = new URLSearchParams(sp);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };

  return (
    <div className="t-page">
      <PageHeader
        title="Lớp học giảng dạy"
        subtitle="Quản lý danh sách lớp, học viên, lịch buổi học, điểm danh và nhật ký giảng dạy."
        actions={
          meReq.data?.can_create_class && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + Tạo lớp học
            </Btn>
          )
        }
      />

      <Card padded={false}>
        <div className="t-toolbar" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              updateParam('q', v);
            }}
            placeholder="Tìm theo mã lớp, tên lớp, môn học…"
          />
          <select className="t-input" value={status} onChange={(e) => updateParam('status', e.target.value)} aria-label="Lọc trạng thái lớp">
            <option value="">Tất cả trạng thái</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label('class', s)}
              </option>
            ))}
          </select>
          <select className="t-input" value={courseId} onChange={(e) => updateParam('course_id', e.target.value)} aria-label="Lọc theo khóa học">
            <option value="">Tất cả khóa học</option>
            {(coursesReq.data?.items || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
          {(q || status || courseId) && (
            <Btn
              small
              variant="ghost"
              onClick={() => {
                setQ('');
                setSp(new URLSearchParams(), { replace: true });
              }}
            >
              Xóa bộ lọc
            </Btn>
          )}
        </div>

        {listReq.loading && <Loading rows={4} />}
        {listReq.error && <ErrorState error={listReq.error} onRetry={listReq.reload} />}
        {!listReq.loading && !listReq.error && listReq.data && (
          <>
            {listReq.data.items.length === 0 ? (
              <EmptyState
                title="Không có lớp học nào phù hợp"
                text={q || status || courseId ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Tạo lớp học đầu tiên để bắt đầu quản lý buổi học và điểm danh.'}
                action={
                  meReq.data?.can_create_class && (
                    <Btn variant="primary" onClick={() => setCreating(true)}>
                      + Tạo lớp học
                    </Btn>
                  )
                }
              />
            ) : (
              <>
                <div className="t-table-wrap t-table-desktop-only">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Lớp học</th>
                        <th>Khóa học liên kết</th>
                        <th>Giảng dạy & Hình thức</th>
                        <th className="num">Học viên</th>
                        <th className="center">Buổi học</th>
                        <th className="num">Chuyên cần</th>
                        <th className="center">Trạng thái</th>
                        <th className="actions">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listReq.data.items.map((cls) => {
                        const primary = cls.staff.find((s) => s.staff_role === 'PRIMARY_INSTRUCTOR');
                        const fullTitle = displayClassTitle(cls);
                        const canManage = cls.capabilities ? cls.capabilities.can_manage_class : Boolean(meReq.data?.can_create_class);
                        const canAttend = cls.capabilities ? cls.capabilities.can_take_attendance : true;
                        const dateRange = [cls.start_date ? fmtDate(cls.start_date) : '', cls.end_date ? fmtDate(cls.end_date) : '']
                          .filter(Boolean)
                          .join(' – ');
                        return (
                          <tr key={cls.id}>
                            <td>
                              <Link className="t-row-link" to={`/teaching/classes/${cls.id}`}>
                                {fullTitle}
                              </Link>
                              {dateRange && <span className="t-sub tabular-nums">{dateRange}</span>}
                              {cls.next_session && (
                                <span className="t-sub tabular-nums">
                                  Buổi tới: {fmtDateTime(cls.next_session.scheduled_start_at)}
                                </span>
                              )}
                            </td>
                            <td>
                              {cls.course ? (
                                <Link className="t-row-link" to={`/teaching/courses/${cls.course.id}`}>
                                  {cls.course.title}
                                </Link>
                              ) : (
                                <span className="t-sub" style={{ marginTop: 0 }}>Chưa gắn khóa học</span>
                              )}
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{primary?.full_name || '—'}</span>
                              <span className="t-sub">
                                {label('delivery', cls.delivery_mode)}
                                {cls.room ? ` · ${cls.room}` : ''}
                              </span>
                            </td>
                            <td className="num">
                              <strong>
                                {cls.student_count}
                                {cls.max_students ? `/${cls.max_students}` : ''}
                              </strong>
                            </td>
                            <td className="center tabular-nums">
                              <div className="t-cell-metric">
                                <strong>
                                  {cls.sessions_done}/{cls.sessions_total}
                                </strong>
                                {cls.sessions_unmarked > 0 && (
                                  <Tone tone="warning">{cls.sessions_unmarked} chưa điểm danh</Tone>
                                )}
                              </div>
                            </td>
                            <td className="num">
                              <strong>{fmtPct(cls.attendance_rate)}</strong>
                            </td>
                            <td className="center">
                              <Badge kind="class" value={cls.status} />
                            </td>
                            <td className="actions">
                              <div className="t-actions">
                                <Link className="t-btn t-btn--small" to={`/teaching/classes/${cls.id}`}>
                                  Mở lớp
                                </Link>
                                {canAttend && (
                                  <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/classes/${cls.id}/attendance`}>
                                    Điểm danh
                                  </Link>
                                )}
                                {canManage && (
                                  <Btn small variant="quiet" onClick={() => setEditing(cls)}>
                                    Sửa
                                  </Btn>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="t-class-mobile-list">
                  {listReq.data.items.map((cls) => {
                    const primary = cls.staff.find((s) => s.staff_role === 'PRIMARY_INSTRUCTOR');
                    const fullTitle = displayClassTitle(cls);
                    const canManage = cls.capabilities ? cls.capabilities.can_manage_class : Boolean(meReq.data?.can_create_class);
                    const canAttend = cls.capabilities ? cls.capabilities.can_take_attendance : true;
                    return (
                      <div key={cls.id} className="t-class-mobile-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ minWidth: 0 }}>
                            <Link className="t-row-link" to={`/teaching/classes/${cls.id}`} style={{ fontSize: 16 }}>
                              {fullTitle}
                            </Link>
                            <span className="t-sub">
                              {primary?.full_name || '—'} · {label('delivery', cls.delivery_mode)}
                              {cls.room ? ` · ${cls.room}` : ''}
                            </span>
                            {cls.course && (
                              <span className="t-sub">
                                Khóa học: <Link className="t-row-link" to={`/teaching/courses/${cls.course.id}`}>{cls.course.title}</Link>
                              </span>
                            )}
                          </div>
                          <Badge kind="class" value={cls.status} />
                        </div>

                        <div className="t-class-mobile-metrics tabular-nums">
                          <div>
                            <span className="t-sub" style={{ marginTop: 0 }}>Học viên</span>
                            <strong>{cls.student_count}{cls.max_students ? `/${cls.max_students}` : ''}</strong>
                          </div>
                          <div>
                            <span className="t-sub" style={{ marginTop: 0 }}>Buổi học</span>
                            <strong>{cls.sessions_done}/{cls.sessions_total}</strong>
                          </div>
                          <div>
                            <span className="t-sub" style={{ marginTop: 0 }}>Chuyên cần</span>
                            <strong>{fmtPct(cls.attendance_rate)}</strong>
                          </div>
                        </div>

                        {(cls.sessions_unmarked > 0 || cls.next_session) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            {cls.sessions_unmarked > 0 && <Tone tone="warning">{cls.sessions_unmarked} chưa điểm danh</Tone>}
                            {cls.next_session && (
                              <span className="t-sub tabular-nums" style={{ marginTop: 0 }}>
                                Buổi tới: {fmtDateTime(cls.next_session.scheduled_start_at)}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="t-actions">
                          <Link className="t-btn t-btn--small" to={`/teaching/classes/${cls.id}`}>
                            Mở lớp
                          </Link>
                          {canAttend && (
                            <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/classes/${cls.id}/attendance`}>
                              Điểm danh
                            </Link>
                          )}
                          {canManage && (
                            <Btn small variant="quiet" onClick={() => setEditing(cls)}>
                              Sửa
                            </Btn>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <Pagination page={listReq.data.page} pageSize={listReq.data.page_size} total={listReq.data.total} onChange={(p) => updateParam('page', String(p))} />
          </>
        )}
      </Card>

      {(creating || editing) && (
        <ClassFormModal
          initial={editing || undefined}
          defaultCourseId={courseId || undefined}
          canPickInstructor={Boolean(meReq.data?.can_pick_instructor)}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            if (sp.get('new')) updateParam('new', '');
          }}
          onSaved={(saved) => {
            const wasCreating = creating;
            setCreating(false);
            setEditing(null);
            if (wasCreating) navigate(`/teaching/classes/${saved.id}`);
            else listReq.reload();
          }}
        />
      )}
    </div>
  );
};
