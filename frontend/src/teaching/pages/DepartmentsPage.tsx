/**
 * Quản lý Tổ chức Khoa / Bộ môn & Không gian xử lý học thuật cấp Bộ môn (Trưởng bộ môn / Quản trị).
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DepartmentItem, ManagedUserItem, masterApi, teachingApi } from '../api';
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
  SearchInput,
  StatCard,
  Tone,
  errMsg,
  useAsync,
  useToast,
} from '../ui';

type DepartmentOrgType = DepartmentItem['org_type'];

const ORG_TYPE_LABELS: Record<DepartmentOrgType, string> = {
  ORGANIZATION: 'Đơn vị chủ quản',
  FACULTY: 'Khoa chuyên môn',
  DEPARTMENT: 'Bộ môn / Tổ chuyên môn',
  CENTER: 'Trung tâm đào tạo',
};

export const DepartmentsPage: React.FC = () => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [modalDept, setModalDept] = useState<null | 'new' | DepartmentItem>(null);
  const [deleteTarget, setDeleteTarget] = useState<DepartmentItem | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState<DepartmentOrgType>('DEPARTMENT');
  const [parentId, setParentId] = useState<string>('');
  const [headUserId, setHeadUserId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const meReq = useAsync(() => teachingApi.me(), []);
  const dataReq = useAsync(async () => {
    const deptRes = await teachingApi.listDepartments({ active_only: showInactive ? 0 : 1 });
    let users: ManagedUserItem[] = [];
    try {
      const roles = meReq.data?.user?.roles || [];
      if (roles.some((r) => ['SUPER_ADMIN', 'ADMIN', 'ACADEMIC_STAFF'].includes(r))) {
        const u = await teachingApi.listUsers({ include_inactive: 0 });
        users = u.items || [];
      }
    } catch {
      users = [];
    }
    return { departments: deptRes.items || [], capabilities: deptRes.capabilities, users };
  }, [showInactive, meReq.data?.user?.id]);

  const roles = meReq.data?.user?.roles || [];
  const canManage = Boolean(dataReq.data?.capabilities?.can_manage) || roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  const canApproveAcademic = roles.some((r) => ['ADMIN', 'SUPER_ADMIN', 'HEAD_OF_DEPARTMENT', 'ACADEMIC_STAFF'].includes(r));

  const departments = dataReq.data?.departments || [];
  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const activeId = selectedId || meReq.data?.user?.department_id || departments[0]?.id || '';
  const summaryReq = useAsync(
    () => (activeId ? teachingApi.getDepartmentSummary(activeId) : Promise.resolve(null)),
    [activeId]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter(
      (d) =>
        d.code.toLowerCase().includes(needle) ||
        d.name.toLowerCase().includes(needle) ||
        (d.head_user_name || '').toLowerCase().includes(needle)
    );
  }, [departments, q]);

  const headCandidates = useMemo(() => {
    const list = dataReq.data?.users || [];
    return list.filter((u) =>
      u.roles.some((r) => ['HEAD_OF_DEPARTMENT', 'INSTRUCTOR', 'ACADEMIC_STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(r))
    );
  }, [dataReq.data]);

  const openCreate = () => {
    setCode('');
    setName('');
    setOrgType('DEPARTMENT');
    setParentId(departments.find((d) => d.org_type === 'ORGANIZATION' || d.org_type === 'FACULTY')?.id || '');
    setHeadUserId('');
    setDescription('');
    setIsActive(true);
    setFormErr(null);
    setModalDept('new');
  };

  const openEdit = (d: DepartmentItem) => {
    setCode(d.code);
    setName(d.name);
    setOrgType(d.org_type);
    setParentId(d.parent_id || '');
    setHeadUserId(d.head_user_id || '');
    setDescription(d.description || '');
    setIsActive(Boolean(d.is_active));
    setFormErr(null);
    setModalDept(d);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    try {
      if (modalDept === 'new') {
        const created = await teachingApi.createDepartment({
          code: code.trim(),
          name: name.trim(),
          org_type: orgType,
          parent_id: parentId || null,
          head_user_id: headUserId || null,
          description: description.trim(),
        });
        toast({ tone: 'success', title: `Đã tạo đơn vị "${created.name}"` });
        setSelectedId(created.id);
      } else if (modalDept) {
        await teachingApi.updateDepartment(modalDept.id, {
          name: name.trim(),
          org_type: orgType,
          parent_id: parentId || null,
          head_user_id: headUserId || null,
          description: description.trim(),
          is_active: isActive,
        });
        toast({ tone: 'success', title: `Đã cập nhật đơn vị "${name.trim()}"` });
      }
      setModalDept(null);
      dataReq.reload();
      summaryReq.reload();
    } catch (ex) {
      setFormErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  };

  const approveCourse = async (courseId: string, title: string) => {
    try {
      await masterApi.transitionCourseLifecycle(courseId, { action: 'APPROVE_PUBLISH', note: 'Phê duyệt từ bảng điều hành Bộ môn' });
      toast({ tone: 'success', title: `Đã duyệt ban hành môn học "${title}"` });
      summaryReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể duyệt môn học', detail: errMsg(ex) });
    }
  };

  const approveCurriculum = async (currId: string, title: string) => {
    try {
      await masterApi.transitionCurriculumLifecycle(currId, { action: 'APPROVE_PUBLISH', note: 'Phê duyệt từ bảng điều hành Bộ môn' });
      toast({ tone: 'success', title: `Đã duyệt ban hành khung chương trình "${title}"` });
      summaryReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể duyệt khung chương trình', detail: errMsg(ex) });
    }
  };

  if (dataReq.loading) return <div className="t-page"><Loading rows={6} /></div>;
  if (dataReq.error) return <div className="t-page"><ErrorState error={dataReq.error} onRetry={dataReq.reload} /></div>;

  return (
    <div className="t-page">
      <PageHeader
        title="Khoa & Bộ môn"
        subtitle="Quản lý sơ đồ tổ chức đào tạo, phân công Trưởng bộ môn và theo dõi hồ sơ chờ phê duyệt cấp đơn vị."
        actions={
          canManage ? (
            <Btn variant="primary" onClick={openCreate}>
              + Thêm đơn vị / Bộ môn
            </Btn>
          ) : undefined
        }
      />

      <div className="t-stats">
        <StatCard label="Tổng đơn vị hiển thị" value={departments.length} />
        <StatCard label="Đã bổ nhiệm Trưởng ĐV" value={departments.filter((d) => Boolean(d.head_user_id)).length} />
        <StatCard
          label="Môn học trực thuộc"
          value={departments.reduce((sum, d) => sum + Number(d.courses_count || 0), 0)}
        />
        <StatCard
          label="Nhân sự thuộc đơn vị"
          value={departments.reduce((sum, d) => sum + Number(d.members_count || 0), 0)}
        />
      </div>

      <Card>
        <div className="t-toolbar" style={{ marginBottom: 16 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Tìm theo mã, tên bộ môn hoặc Trưởng đơn vị…" />
          <label className="t-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Hiển thị đơn vị ngừng hoạt động
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="Không tìm thấy đơn vị phù hợp" text="Thử đổi từ khóa tìm kiếm hoặc tạo mới một đơn vị chuyên môn." />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên Khoa / Bộ môn</th>
                  <th>Loại hình</th>
                  <th>Trưởng đơn vị</th>
                  <th className="num">Môn học</th>
                  <th className="num">Nhân sự</th>
                  <th>Trạng thái</th>
                  <th className="actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const selected = d.id === activeId;
                  const parentName = d.parent_id ? deptMap.get(d.parent_id)?.name : undefined;
                  return (
                    <tr key={d.id} style={selected ? { backgroundColor: 'var(--bg-surface-subtle)' } : undefined}>
                      <td><code>{d.code}</code></td>
                      <td>
                        <button
                          type="button"
                          className="t-row-link"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                          onClick={() => setSelectedId(d.id)}
                        >
                          {d.name}
                        </button>
                        {parentName && <div className="t-sub">Trực thuộc: {parentName}</div>}
                      </td>
                      <td>{ORG_TYPE_LABELS[d.org_type] || d.org_type}</td>
                      <td>{d.head_user_name || <span className="t-sub">Chưa bổ nhiệm</span>}</td>
                      <td className="num tabular-nums">{d.courses_count ?? 0}</td>
                      <td className="num tabular-nums">{d.members_count ?? 0}</td>
                      <td>
                        <Tone tone={d.is_active ? 'success' : 'muted'}>
                          {d.is_active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                        </Tone>
                      </td>
                      <td className="actions">
                        <div className="t-actions">
                          <Btn small variant={selected ? 'primary' : 'secondary'} onClick={() => setSelectedId(d.id)}>
                            Hồ sơ ĐV
                          </Btn>
                          {canManage && (
                            <>
                              <Btn small onClick={() => openEdit(d)}>Sửa</Btn>
                              <Btn small variant="danger" onClick={() => setDeleteTarget(d)}>Ngừng</Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {activeId && (
        <Card
          title={
            summaryReq.data
              ? `Tổng quan học thuật: ${summaryReq.data.department.name} (${summaryReq.data.department.code})`
              : 'Hồ sơ điều hành Bộ môn'
          }
        >
          {summaryReq.loading ? (
            <Loading rows={3} />
          ) : summaryReq.error ? (
            <ErrorState error={summaryReq.error} onRetry={summaryReq.reload} />
          ) : summaryReq.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="t-stats">
                <StatCard label="Tổng môn học" value={summaryReq.data.courses.length} />
                <StatCard label="Lớp đang hoạt động" value={summaryReq.data.department.active_classes_count ?? 0} />
                <StatCard label="Nhân sự đơn vị" value={summaryReq.data.members.length} />
                <StatCard
                  label="Hồ sơ chờ duyệt"
                  value={summaryReq.data.pending_syllabus_courses.length + summaryReq.data.pending_curricula.length}
                />
              </div>

              <div className="t-grid-2">
                <div>
                  <h4 style={{ margin: '0 0 10px' }}>Đề cương môn học chờ phê duyệt</h4>
                  {summaryReq.data.pending_syllabus_courses.length === 0 ? (
                    <EmptyState title="Không có môn học chờ duyệt" />
                  ) : (
                    <div className="t-list">
                      {summaryReq.data.pending_syllabus_courses.map((c) => (
                        <div key={c.id} className="t-list-item">
                          <div>
                            <Link to={`/teaching/courses/${c.id}`} className="t-row-link">
                              {c.code} · {c.title}
                            </Link>
                            <div className="t-sub">
                              <Badge kind="lifecycleStatus" value={c.syllabus_status || 'PENDING_APPROVAL'} />
                              {c.instructor_name ? ` · ${c.instructor_name}` : ''}
                            </div>
                          </div>
                          {(canApproveAcademic || summaryReq.data?.can_approve_academic) && (
                            <Btn small variant="primary" onClick={() => approveCourse(c.id, c.title)}>
                              Duyệt ban hành
                            </Btn>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 style={{ margin: '0 0 10px' }}>Khung chương trình chờ phê duyệt</h4>
                  {summaryReq.data.pending_curricula.length === 0 ? (
                    <EmptyState title="Không có khung chương trình chờ duyệt" />
                  ) : (
                    <div className="t-list">
                      {summaryReq.data.pending_curricula.map((cu) => (
                        <div key={cu.id} className="t-list-item">
                          <div>
                            <Link to={`/teaching/curricula/${cu.id}`} className="t-row-link">
                              {cu.code} · {cu.title}
                            </Link>
                            <div className="t-sub">
                              <Badge kind="curriculum" value={cu.status} />
                            </div>
                          </div>
                          {(canApproveAcademic || summaryReq.data?.can_approve_academic) && (
                            <Btn small variant="primary" onClick={() => approveCurriculum(cu.id, cu.title)}>
                              Duyệt ban hành
                            </Btn>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {modalDept && (
        <Modal
          title={modalDept === 'new' ? 'Thêm Khoa / Bộ môn mới' : `Cập nhật ${modalDept.name}`}
          onClose={() => setModalDept(null)}
          width={620}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setModalDept(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" type="submit" form="dept-modal-form" loading={busy}>
                {modalDept === 'new' ? 'Tạo đơn vị' : 'Lưu thay đổi'}
              </Btn>
            </>
          }
        >
          <form id="dept-modal-form" className="t-form-grid" onSubmit={submitForm}>
            <Field label="Mã đơn vị" required>
              <input
                className="t-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={modalDept !== 'new'}
                required
                placeholder="VD: DEPT-MATH"
              />
            </Field>
            <Field label="Loại hình tổ chức">
              <select className="t-input" value={orgType} onChange={(e) => setOrgType(e.target.value as DepartmentOrgType)}>
                <option value="ORGANIZATION">Đơn vị chủ quản</option>
                <option value="FACULTY">Khoa chuyên môn</option>
                <option value="DEPARTMENT">Bộ môn / Tổ chuyên môn</option>
                <option value="CENTER">Trung tâm đào tạo</option>
              </select>
            </Field>
            <Field label="Tên đơn vị" required wide>
              <input className="t-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Đơn vị cấp trên">
              <select className="t-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">-- Không có (Đơn vị gốc) --</option>
                {departments
                  .filter((d) => modalDept === 'new' || d.id !== modalDept.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                  ))}
              </select>
            </Field>
            <Field label="Trưởng đơn vị / Trưởng bộ môn">
              <select className="t-input" value={headUserId} onChange={(e) => setHeadUserId(e.target.value)}>
                <option value="">-- Chưa bổ nhiệm --</option>
                {headCandidates.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Mô tả chức năng" wide>
              <textarea className="t-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            {modalDept !== 'new' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Đơn vị đang hoạt động
                </label>
              </div>
            )}
            {formErr && <p className="t-field__error t-field--wide" role="alert">{formErr}</p>}
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Ngừng hoạt động đơn vị "${deleteTarget.name}"?`}
          message="Đơn vị sẽ chuyển sang trạng thái ngừng hoạt động nhưng dữ liệu môn học và nhân sự cũ vẫn được bảo toàn."
          confirmLabel="Xác nhận ngừng"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            try {
              await teachingApi.deleteDepartment(deleteTarget.id);
              toast({ tone: 'info', title: `Đã chuyển "${deleteTarget.name}" sang ngừng hoạt động` });
              setDeleteTarget(null);
              dataReq.reload();
            } catch (ex) {
              toast({ tone: 'error', title: 'Không thể ngừng đơn vị', detail: errMsg(ex) });
            }
          }}
        />
      )}
    </div>
  );
};
