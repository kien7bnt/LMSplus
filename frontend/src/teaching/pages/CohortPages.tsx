/**
 * Cấp 2 — Quản lý Lớp khóa học (Program Cohorts) với 8 tab đầy đủ
 * và đồng bộ quân số xuống các Lớp môn học (Cấp 3) giữ nguyên học viên học bù/học lại.
 */
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CohortDetail,
  CohortStudentProgressRow,
  CohortSummary,
  CurriculumItem,
  DeliveryMode,
  masterApi,
  saveBlob,
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
  ProgressMeter,
  SearchInput,
  StatCard,
  Tabs,
  errMsg,
  fmtDate,
  fmtDateTime,
  useAsync,
  useDebounced,
  useToast,
} from '../ui';

export const CohortListPage: React.FC = () => {
  const nav = useNavigate();
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const list = useAsync(() => masterApi.listCohorts({ q: dq, status, page, page_size: 20 }), [dq, status, page]);

  return (
    <div className="t-page">
      <PageHeader
        title="Lớp khóa học (Program Cohorts)"
        subtitle="Cấp 2 — Quản lý học viên theo khóa/niên khóa, liên kết Khung chương trình và sinh tự động các Lớp môn học."
        actions={
          <Btn variant="primary" onClick={() => setCreating(true)}>
            + Tạo lớp khóa học
          </Btn>
        }
      />

      <Card>
        <div className="t-toolbar">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Tìm theo mã, tên lớp khóa học…" />
          <select className="t-input t-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Lọc trạng thái lớp khóa học">
            <option value="">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang đào tạo</option>
            <option value="PLANNING">Đang lập kế hoạch</option>
            <option value="COMPLETED">Đã hoàn thành</option>
            <option value="ARCHIVED">Đã lưu trữ</option>
          </select>
        </div>

        {list.loading && <Loading rows={4} />}
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            title="Chưa có lớp khóa học nào"
            text="Hãy tạo lớp khóa học gắn với một Khung chương trình để bắt đầu ghi danh và mở lớp môn học."
            action={<Btn variant="primary" onClick={() => setCreating(true)}>+ Tạo lớp khóa học</Btn>}
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã khóa</th>
                    <th>Tên lớp khóa học</th>
                    <th>Khung chương trình</th>
                    <th>Sĩ số thực (DISTINCT)</th>
                    <th>Lớp môn học</th>
                    <th>Thời gian</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((ch: CohortSummary) => (
                    <tr key={ch.id}>
                      <td><code>{ch.code}</code></td>
                      <td>
                        <Link to={`/teaching/cohorts/${ch.id}`} className="t-row-link">
                          <strong>{ch.title}</strong>
                        </Link>
                        <div className="t-muted t-small">{ch.academic_year || '—'} · {ch.semester || '—'}</div>
                      </td>
                      <td>
                        {ch.curriculum ? (
                          <Link to={`/teaching/curricula/${ch.curriculum.id}`} className="t-row-link">
                            {ch.curriculum.code} — {ch.curriculum.title}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="tabular-nums">{ch.active_students_count} HV</td>
                      <td className="tabular-nums">{ch.subject_classes_count} lớp</td>
                      <td className="tabular-nums">{fmtDate(ch.start_date)} – {fmtDate(ch.end_date)}</td>
                      <td><Badge kind="cohort" value={ch.status} /></td>
                      <td className="t-right">
                        <Btn small onClick={() => nav(`/teaching/cohorts/${ch.id}`)}>Quản lý (8 tab)</Btn>
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
        <CreateCohortModal
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            push('Đã tạo lớp khóa học', c.title, 'success');
            nav(`/teaching/cohorts/${c.id}`);
          }}
        />
      )}
    </div>
  );
};

const CreateCohortModal: React.FC<{ onClose: () => void; onCreated: (c: CohortSummary) => void }> = ({
  onClose,
  onCreated,
}) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const curricula = useAsync(() => masterApi.listCurricula({ page_size: 100 }), []);
  const [curriculumId, setCurriculumId] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [academicYear, setAcademicYear] = useState('2026-2027');
  const [semester, setSemester] = useState('HK1');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('HYBRID');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [maxStudents, setMaxStudents] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items: CurriculumItem[] = curricula.data?.items || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetCurrId = curriculumId || items[0]?.id;
    if (!targetCurrId) {
      setErr('Cần có ít nhất 1 khung chương trình trước khi mở lớp khóa học.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await masterApi.createCohort({
        curriculum_id: targetCurrId,
        code: code.trim(),
        title: title.trim(),
        academic_year: academicYear.trim(),
        semester: semester.trim(),
        delivery_mode: deliveryMode,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        max_students: maxStudents ? Number(maxStudents) : undefined,
        status: 'ACTIVE',
      });
      onCreated(created);
    } catch (ex) {
      setErr(errMsg(ex));
      push('Không thể tạo lớp khóa học', errMsg(ex), 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo lớp khóa học mới"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="cohort-create-form" loading={busy} disabled={items.length === 0}>
            Tạo lớp khóa học
          </Btn>
        </>
      }
    >
      {curricula.loading && <Loading rows={2} />}
      {!curricula.loading && items.length === 0 ? (
        <EmptyState title="Chưa có Khung chương trình" text="Hãy tạo Khung chương trình ở Cấp 1 trước." />
      ) : (
        <form id="cohort-create-form" className="t-form-grid" onSubmit={submit}>
          <Field label="Khung chương trình áp dụng" required wide>
            <select className="t-input" value={curriculumId || items[0]?.id || ''} onChange={(e) => setCurriculumId(e.target.value)}>
              {items.map((curr) => (
                <option key={curr.id} value={curr.id}>
                  [{curr.code}] {curr.title} (v{curr.version})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mã lớp khóa học" required>
            <input className="t-input" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="VD: K26-TOAN5-A" />
          </Field>
          <Field label="Hình thức đào tạo">
            <select className="t-input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}>
              <option value="HYBRID">Kết hợp</option>
              <option value="OFFLINE">Trực tiếp</option>
              <option value="ONLINE">Trực tuyến</option>
            </select>
          </Field>
          <Field label="Tên lớp khóa học" required wide>
            <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Niên khóa">
            <input className="t-input" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
          </Field>
          <Field label="Học kỳ">
            <input className="t-input" value={semester} onChange={(e) => setSemester(e.target.value)} />
          </Field>
          <Field label="Ngày bắt đầu">
            <input type="date" className="t-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Ngày kết thúc">
            <input type="date" className="t-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Sĩ số tối đa">
            <input type="number" min={1} max={1000} className="t-input" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} />
          </Field>
          {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
        </form>
      )}
    </Modal>
  );
};

export const CohortDetailPage: React.FC = () => {
  const { cohortId = '' } = useParams();
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const detail = useAsync(() => masterApi.getCohort(cohortId), [cohortId]);
  const allCohorts = useAsync(() => masterApi.listCohorts({ page_size: 100 }), []);
  const [tab, setTab] = useState('students');
  const [busyAction, setBusyAction] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState<CohortStudentProgressRow | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [transferTarget, setTransferTarget] = useState<CohortStudentProgressRow | null>(null);
  const [targetCohortId, setTargetCohortId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  if (detail.loading) return <div className="t-page"><Loading rows={6} /></div>;
  if (detail.error) return <div className="t-page"><ErrorState error={detail.error} onRetry={detail.reload} /></div>;
  const c: CohortDetail = detail.data!;

  const otherCohorts = (allCohorts.data?.items || []).filter((x) => x.id !== c.id);

  const handleSyncRoster = async () => {
    setBusyAction(true);
    try {
      const res = await masterApi.syncCohortRoster(c.id);
      push(
        'Đã đồng bộ danh sách học viên',
        `${res.classes_synced} lớp môn học: +${res.added} mới, ${res.reactivated} kích hoạt lại, ${res.dropped} rút.`,
        'success'
      );
      detail.reload();
    } catch (ex) {
      push('Đồng bộ thất bại', errMsg(ex), 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleGenerateClasses = async () => {
    setBusyAction(true);
    try {
      const res = await masterApi.generateCohortClasses(c.id);
      push(
        'Khởi tạo Lớp môn học hoàn tất',
        `Đã tạo mới ${res.created.length} lớp môn học (bỏ qua ${res.skipped.length} lớp đã liên kết).`,
        'success'
      );
      detail.reload();
    } catch (ex) {
      push('Không tạo được lớp môn học', errMsg(ex), 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction(true);
    try {
      const res = await masterApi.importCohortStudents(c.id, importText, true);
      push(
        'Đã nhập danh sách học viên vào khóa',
        `Thêm ${res.added.length}, kích hoạt lại ${res.reactivated.length}, đã có ${res.already_enrolled.length}, không tìm thấy ${res.not_found.length}.`,
        'success'
      );
      setImportText('');
      setImportOpen(false);
      detail.reload();
    } catch (ex) {
      push('Lỗi nhập danh sách', errMsg(ex), 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const file = await masterApi.exportCohortStudents(c.id);
      saveBlob(file);
    } catch (ex) {
      push('Không thể xuất CSV', errMsg(ex), 'error');
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/teaching/cohorts">Lớp khóa học</Link> / <span>{c.code}</span>
          </>
        }
        title={
          <span className="t-title-inline">
            {c.title} <Badge kind="cohort" value={c.status} />
          </span>
        }
        subtitle={`Khung: ${c.curriculum?.title || '—'} · ${c.academic_year || ''} · ${c.semester || ''} · Sĩ số thực ${c.statistics.distinct_active_students} học viên`}
        actions={
          c.capabilities.can_manage ? (
            <>
              <Btn onClick={handleSyncRoster} loading={busyAction}>
                Đồng bộ quân số xuống Lớp môn học
              </Btn>
              <Btn variant="primary" onClick={handleGenerateClasses} loading={busyAction}>
                Khởi tạo Lớp môn học từ Khung CT
              </Btn>
            </>
          ) : undefined
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'students', label: 'Học viên', badge: c.students.length },
          { id: 'curriculum', label: 'Khung chương trình', badge: c.curriculum_subjects.length },
          { id: 'classes', label: 'Lớp môn học', badge: c.subject_classes.length },
          { id: 'instructors', label: 'Giảng viên', badge: c.instructors.length },
          { id: 'schedule', label: 'Lịch học', badge: c.schedule.length },
          { id: 'progress', label: 'Tiến độ', badge: c.progress.length },
          { id: 'statistics', label: 'Thống kê' },
          { id: 'audit', label: 'Nhật ký', badge: c.audit_logs.length },
        ]}
      />

      {tab === 'students' && (
        <Card
          title="Danh sách học viên cấp Lớp khóa học"
          actions={
            <div className="t-actions">
              <Btn small onClick={handleExportCsv}>Xuất CSV</Btn>
              {c.capabilities.can_manage && (
                <Btn small variant="primary" onClick={() => setImportOpen(true)}>+ Thêm / Import học viên</Btn>
              )}
            </div>
          }
        >
          <div className="m-semantic-notice" style={{ marginBottom: 16 }}>
            {c.statistics.no_double_counting_note}
          </div>
          {c.students.length === 0 ? (
            <EmptyState title="Chưa có học viên nào trong lớp khóa học" text="Import danh sách mã học viên hoặc email để đồng bộ xuống tất cả lớp môn học liên kết." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã HV</th>
                    <th>Họ tên</th>
                    <th>Email</th>
                    <th>Trạng thái</th>
                    <th>Chuyên cần</th>
                    <th>Tiến độ tổng</th>
                    <th>Ngày vào</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {c.students.map((s) => (
                    <tr key={s.student_id}>
                      <td><code>{s.code}</code></td>
                      <td><strong>{s.full_name}</strong></td>
                      <td>{s.email}</td>
                      <td><Badge kind="cohortStudent" value={s.status} /></td>
                      <td className="tabular-nums">{s.attendance_rate !== null ? `${s.attendance_rate}%` : '—'}</td>
                      <td><ProgressMeter value={s.completed_lessons} total={Math.max(1, s.total_lessons)} /></td>
                      <td className="tabular-nums">{fmtDate(s.enrolled_at)}</td>
                      <td className="t-right">
                        {c.capabilities.can_manage && s.status === 'ACTIVE' && (
                          <div className="t-actions">
                            <Btn small onClick={() => { setTransferTarget(s); setTargetCohortId(otherCohorts[0]?.id || ''); }}>
                              Chuyển khóa
                            </Btn>
                            <Btn small variant="ghost" onClick={() => setWithdrawTarget(s)}>
                              Rút khỏi khóa
                            </Btn>
                          </div>
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

      {tab === 'curriculum' && (
        <Card title="Môn học thuộc Khung chương trình">
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Học kỳ</th>
                  <th>Mã môn</th>
                  <th>Tên môn học</th>
                  <th>Số tiết</th>
                  <th>Số giờ</th>
                  <th>Loại</th>
                </tr>
              </thead>
              <tbody>
                {c.curriculum_subjects.map((cs) => (
                  <tr key={cs.id}>
                    <td className="tabular-nums">HK {cs.semester_order}</td>
                    <td><code>{cs.course_code}</code></td>
                    <td><Link to={`/teaching/courses/${cs.course_id}`} className="t-row-link">{cs.course_title}</Link></td>
                    <td className="tabular-nums">{cs.planned_periods}</td>
                    <td className="tabular-nums">{cs.planned_hours}</td>
                    <td>{cs.is_mandatory ? 'Bắt buộc' : 'Tự chọn'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'classes' && (
        <Card title="Các Lớp môn học (Cấp 3) liên kết với Lớp khóa học này">
          {c.subject_classes.length === 0 ? (
            <EmptyState
              title="Chưa có Lớp môn học nào được tạo"
              text="Nhấn nút 'Khởi tạo Lớp môn học từ Khung CT' ở góc trên để tự động sinh lớp và đồng bộ học viên."
            />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã lớp</th>
                    <th>Môn học & Lớp môn</th>
                    <th>Phiên bản gắn (Snapshot)</th>
                    <th>Đồng bộ từ khóa</th>
                    <th>Học bù / Bổ sung riêng</th>
                    <th>Tổng sĩ số lớp</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {c.subject_classes.map((sc) => (
                    <tr key={sc.id}>
                      <td><code>{sc.code}</code></td>
                      <td>
                        <Link to={`/teaching/classes/${sc.id}`} className="t-row-link"><strong>{sc.title}</strong></Link>
                        <div className="t-muted t-small">{sc.course_code} · GV: {sc.instructor_name}</div>
                      </td>
                      <td>
                        <span className="t-badge t-badge--info">{sc.pinned_version_label}</span>
                        {sc.has_newer_version && <div className="t-small t-muted">Đã có bản v{sc.latest_version_number}.0 mới hơn</div>}
                      </td>
                      <td className="tabular-nums">{sc.synced_students_count}</td>
                      <td className="tabular-nums">{sc.extra_students_count}</td>
                      <td className="tabular-nums"><strong>{sc.total_students_count}</strong></td>
                      <td><Badge kind="class" value={sc.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'instructors' && (
        <Card title="Đội ngũ giảng viên giảng dạy trong khóa">
          {c.instructors.length === 0 ? (
            <EmptyState title="Chưa phân công giảng viên" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Họ tên giảng viên</th>
                    <th>Email</th>
                    <th>Vai trò</th>
                    <th>Các lớp môn phụ trách</th>
                  </tr>
                </thead>
                <tbody>
                  {c.instructors.map((ins) => (
                    <tr key={ins.id}>
                      <td><strong>{ins.full_name}</strong></td>
                      <td>{ins.email}</td>
                      <td><Badge kind="staffRole" value={ins.staff_role} /></td>
                      <td>{ins.class_codes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'schedule' && (
        <Card title="Lịch học hợp nhất của toàn bộ Lớp môn học trong khóa">
          {c.schedule.length === 0 ? (
            <EmptyState title="Chưa có buổi học nào được lên lịch" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Lớp môn học</th>
                    <th>Buổi học</th>
                    <th>Hình thức</th>
                    <th>Phòng / Link</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {c.schedule.map((ses) => (
                    <tr key={ses.id}>
                      <td className="tabular-nums">{fmtDateTime(ses.start_at)}</td>
                      <td><Link to={`/teaching/classes/${ses.class_id}`} className="t-row-link"><code>{ses.class_code}</code></Link></td>
                      <td>{ses.title}</td>
                      <td><Badge kind="delivery" value={ses.delivery_mode} /></td>
                      <td>{ses.room_or_link || '—'}</td>
                      <td>{ses.session_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'progress' && (
        <Card title="Tiến độ học tập từng học viên trên toàn Khóa">
          {c.progress.length === 0 ? (
            <EmptyState title="Chưa có học viên đang theo học" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã HV</th>
                    <th>Học viên</th>
                    <th>Bài đã hoàn thành</th>
                    <th>Tỷ lệ hoàn thành</th>
                    <th>Chuyên cần</th>
                  </tr>
                </thead>
                <tbody>
                  {c.progress.map((p) => (
                    <tr key={p.student_id}>
                      <td><code>{p.code}</code></td>
                      <td><strong>{p.full_name}</strong></td>
                      <td className="tabular-nums">{p.completed_lessons}/{p.total_lessons}</td>
                      <td><ProgressMeter value={p.completion_pct} /></td>
                      <td className="tabular-nums">{p.attendance_rate !== null ? `${p.attendance_rate}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'statistics' && (
        <div className="t-stats">
          <StatCard label="Sĩ số thực (DISTINCT)" value={c.statistics.distinct_active_students} hint="Không đếm trùng giữa các lớp môn" tone="success" />
          <StatCard label="Đã đồng bộ xuống lớp môn" value={c.statistics.distinct_synced_to_classes} />
          <StatCard label="Học bù / Bổ sung riêng" value={c.statistics.distinct_extra_subject_students} tone="warning" />
          <StatCard label="Lớp môn học trực thuộc" value={c.statistics.subject_classes_count} />
          <StatCard label="Hoàn thành trung bình" value={`${c.statistics.avg_completion_pct}%`} />
          <StatCard label="Đã chuyển / rút" value={`${c.statistics.transferred_count} chuyển · ${c.statistics.withdrawn_count} rút`} />
        </div>
      )}

      {tab === 'audit' && (
        <Card title="Nhật ký vận hành Lớp khóa học">
          {c.audit_logs.length === 0 ? (
            <EmptyState title="Chưa có nhật ký thao tác" />
          ) : (
            <ul className="t-list">
              {c.audit_logs.map((l) => (
                <li key={l.id} className="t-list-item">
                  <div>
                    <strong>{l.action}</strong>
                    <div className="t-muted t-small">{l.actor_name} · {fmtDateTime(l.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {importOpen && (
        <Modal
          title="Thêm / Import học viên vào Lớp khóa học"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setImportOpen(false)} disabled={busyAction}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="cohort-import-form" loading={busyAction}>Xác nhận & Đồng bộ lớp môn</Btn>
            </>
          }
        >
          <form id="cohort-import-form" onSubmit={handleImportSubmit}>
            <Field label="Danh sách mã học viên hoặc email (cách nhau bởi xuống dòng hoặc dấu phẩy)" required wide>
              <textarea
                className="t-input"
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'HV001\nHV002\nstudent3@example.com'}
                required
              />
            </Field>
          </form>
        </Modal>
      )}

      {withdrawTarget && (
        <Modal
          title={`Rút học viên ${withdrawTarget.full_name} khỏi khóa`}
          onClose={() => setWithdrawTarget(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setWithdrawTarget(null)} disabled={busyAction}>Hủy</Btn>
              <Btn
                variant="danger"
                loading={busyAction}
                onClick={async () => {
                  setBusyAction(true);
                  try {
                    await masterApi.withdrawCohortStudent(c.id, withdrawTarget.student_id, withdrawReason);
                    push('Đã rút học viên khỏi khóa', 'Các lớp môn học đồng bộ đã cập nhật theo quy tắc.', 'info');
                    setWithdrawTarget(null);
                    setWithdrawReason('');
                    detail.reload();
                  } catch (ex) {
                    push('Thao tác thất bại', errMsg(ex), 'error');
                  } finally {
                    setBusyAction(false);
                  }
                }}
              >
                Xác nhận rút học viên
              </Btn>
            </>
          }
        >
          <p>Các lớp môn học đồng bộ theo khóa sẽ chuyển trạng thái ghi danh của học viên sang Rút lớp (không xóa lịch sử học tập). Ghi danh học bù/bổ sung riêng vẫn được giữ nguyên.</p>
          <Field label="Lý do rút khỏi khóa" wide>
            <input className="t-input" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} maxLength={300} />
          </Field>
        </Modal>
      )}

      {transferTarget && (
        <Modal
          title={`Chuyển ${transferTarget.full_name} sang Lớp khóa học khác`}
          onClose={() => setTransferTarget(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setTransferTarget(null)} disabled={busyAction}>Hủy</Btn>
              <Btn
                variant="primary"
                loading={busyAction}
                disabled={!targetCohortId}
                onClick={async () => {
                  setBusyAction(true);
                  try {
                    await masterApi.transferCohortStudent(c.id, transferTarget.student_id, targetCohortId, transferReason);
                    push('Đã chuyển lớp khóa học', '', 'success');
                    setTransferTarget(null);
                    setTransferReason('');
                    detail.reload();
                  } catch (ex) {
                    push('Chuyển khóa thất bại', errMsg(ex), 'error');
                  } finally {
                    setBusyAction(false);
                  }
                }}
              >
                Xác nhận chuyển khóa
              </Btn>
            </>
          }
        >
          {otherCohorts.length === 0 ? (
            <EmptyState title="Không có lớp khóa học đích khác" text="Vui lòng tạo ít nhất một lớp khóa học khác trước khi chuyển." />
          ) : (
            <div className="t-form-grid">
              <Field label="Chọn lớp khóa học đích" required wide>
                <select className="t-input" value={targetCohortId} onChange={(e) => setTargetCohortId(e.target.value)}>
                  {otherCohorts.map((o) => (
                    <option key={o.id} value={o.id}>[{o.code}] {o.title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Lý do chuyển khóa" wide>
                <input className="t-input" value={transferReason} onChange={(e) => setTransferReason(e.target.value)} maxLength={300} />
              </Field>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
