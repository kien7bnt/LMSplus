import React, { useMemo, useState } from 'react';
import { ROLE_DISPLAY_LABELS } from '../../components/elearning/AuthPage';
import { UserRole } from '../../types/elearning';
import { ManagedUserItem, teachingApi } from '../api';
import {
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
  Tone,
  errMsg,
  useAsync,
  useToast,
} from '../ui';

const ROLES: UserRole[] = [
  'STUDENT',
  'INSTRUCTOR',
  'TEACHING_ASSISTANT',
  'HEAD_OF_DEPARTMENT',
  'ACADEMIC_STAFF',
  'ADMIN',
  'SUPER_ADMIN',
];
const PAGE_SIZE = 10;

export const AdminAccountsPage: React.FC = () => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState<number>(1);
  const [modalUser, setModalUser] = useState<null | 'new' | ManagedUserItem>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ManagedUserItem | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const dataReq = useAsync(async () => {
    const [usersRes, deptRes] = await Promise.all([
      teachingApi.listUsers({ include_inactive: 1 }),
      teachingApi.listDepartments(),
    ]);
    return {
      users: usersRes.items || [],
      canManage: usersRes.capabilities?.can_manage ?? false,
      departments: deptRes.items || [],
    };
  }, []);

  const deptMap = useMemo(() => {
    const m = new Map<string, string>();
    (dataReq.data?.departments || []).forEach((d) => m.set(d.id, d.name));
    return m;
  }, [dataReq.data?.departments]);

  const openCreate = () => {
    setFullName('');
    setEmail('');
    setCode('');
    setRole('STUDENT');
    setDepartmentId('');
    setIsActive(true);
    setPassword('');
    setFormErr(null);
    setModalUser('new');
  };

  const openEdit = (u: ManagedUserItem) => {
    setFullName(u.full_name);
    setEmail(u.email);
    setCode(u.code);
    setRole((u.roles?.[0] as UserRole) || 'STUDENT');
    setDepartmentId(u.department_id || '');
    setIsActive(u.is_active);
    setPassword('');
    setFormErr(null);
    setModalUser(u);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    if (!fullName.trim() || !email.trim()) {
      setFormErr('Vui lòng nhập đầy đủ họ tên và email.');
      return;
    }
    setBusy(true);
    try {
      if (modalUser === 'new') {
        if (password.length < 6) {
          setFormErr('Mật khẩu cần tối thiểu 6 ký tự.');
          setBusy(false);
          return;
        }
        await teachingApi.createUser({
          full_name: fullName.trim(),
          email: email.trim(),
          code: code.trim() || undefined,
          roles: [role],
          department_id: departmentId || null,
          password,
        });
        toast({ tone: 'success', title: 'Đã tạo tài khoản người dùng mới' });
      } else if (modalUser) {
        await teachingApi.updateUser(modalUser.id, {
          full_name: fullName.trim(),
          email: email.trim(),
          code: code.trim(),
          roles: [role],
          department_id: departmentId || null,
          is_active: isActive,
          password: password.trim() || undefined,
        });
        toast({ tone: 'success', title: 'Đã cập nhật thông tin & phân quyền tài khoản' });
      }
      setModalUser(null);
      dataReq.reload();
    } catch (err) {
      setFormErr(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const items = (dataReq.data?.users || []).filter((u) => {
    if (!showInactive && !u.is_active) return false;
    if (roleFilter && !u.roles.includes(roleFilter)) return false;
    if (deptFilter && (u.department_id || '') !== deptFilter) return false;
    if (q.trim() && !`${u.code} ${u.full_name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const canManage = dataReq.data?.canManage ?? false;

  return (
    <div className="t-page">
      <PageHeader
        title="Quản lý tài khoản & Phân quyền"
        subtitle="Quản trị tài khoản theo vai trò RBAC, đơn vị/bộ môn và trạng thái phiên đăng nhập."
        actions={
          canManage ? (
            <Btn variant="primary" onClick={openCreate}>
              + Tạo tài khoản
            </Btn>
          ) : null
        }
      />

      <Card padded={false}>
        <div
          className="t-toolbar"
          style={{ padding: '16px var(--card-pad, 24px)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', gap: 12 }}
        >
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm theo họ tên, mã số, email…"
          />
          <select
            className="t-input"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Lọc theo nhóm người dùng"
          >
            <option value="">Tất cả vai trò</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_DISPLAY_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            className="t-input"
            value={deptFilter}
            onChange={(e) => {
              setDeptFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Lọc theo đơn vị bộ môn"
          >
            <option value="">Tất cả bộ môn/đơn vị</option>
            {(dataReq.data?.departments || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => {
                setShowInactive(e.target.checked);
                setPage(1);
              }}
            />
            Hiện tài khoản đã khóa
          </label>
        </div>

        {dataReq.loading && <Loading rows={5} />}
        {dataReq.error && <ErrorState error={dataReq.error} onRetry={dataReq.reload} />}
        {!dataReq.loading && !dataReq.error && (
          items.length === 0 ? (
            <EmptyState
              title="Không tìm thấy tài khoản nào"
              text={q.trim() || roleFilter || deptFilter ? 'Thử đổi từ khóa tìm kiếm hoặc bộ lọc.' : 'Chưa có tài khoản trong hệ thống.'}
            />
          ) : (
            <>
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Mã số</th>
                      <th>Họ và tên</th>
                      <th>Email</th>
                      <th>Vai trò RBAC</th>
                      <th>Đơn vị / Bộ môn</th>
                      <th>Trạng thái</th>
                      <th className="actions">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((u) => (
                      <tr key={u.id}>
                        <td className="tabular-nums">{u.code}</td>
                        <td><strong>{u.full_name}</strong></td>
                        <td style={{ overflowWrap: 'anywhere' }}>{u.email}</td>
                        <td>
                          <Tone tone="neutral">
                            {u.roles.map((r) => ROLE_DISPLAY_LABELS[r as UserRole] || r).join(', ')}
                          </Tone>
                        </td>
                        <td>{u.department_id ? deptMap.get(u.department_id) || u.department_id : 'Toàn hệ thống / Chưa gán'}</td>
                        <td>
                          <Tone tone={u.is_active ? 'success' : 'danger'}>
                            {u.is_active ? 'Đang hoạt động' : 'Đã vô hiệu'}
                          </Tone>
                        </td>
                        <td className="actions">
                          {canManage ? (
                            <div className="t-actions">
                              <Btn small variant="quiet" onClick={() => openEdit(u)}>
                                Sửa
                              </Btn>
                              {u.is_active && !u.roles.includes('ADMIN') && !u.roles.includes('SUPER_ADMIN') && (
                                <Btn small variant="danger" onClick={() => setDeactivateTarget(u)}>
                                  Vô hiệu hóa
                                </Btn>
                              )}
                            </div>
                          ) : (
                            <span className="t-sub">Chỉ xem</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items.length > PAGE_SIZE && (
                <div style={{ padding: '0 var(--card-pad, 24px) 16px' }}>
                  <Pagination page={safePage} pageSize={PAGE_SIZE} total={items.length} onChange={setPage} />
                </div>
              )}
            </>
          )
        )}
      </Card>

      {modalUser && (
        <Modal
          title={modalUser === 'new' ? 'Tạo tài khoản mới' : 'Chỉnh sửa tài khoản & Quyền'}
          onClose={() => setModalUser(null)}
          width={560}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setModalUser(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" onClick={submitForm} loading={busy}>Lưu thay đổi</Btn>
            </>
          }
        >
          <form onSubmit={submitForm} className="t-form-grid">
            <Field label="Họ và tên" required wide>
              <input className="t-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Email đăng nhập" required wide>
              <input className="t-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mã định danh" hint="Để trống nếu tạo mới để hệ thống tự cấp">
              <input className="t-input tabular-nums" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Vai trò RBAC" required>
              <select className="t-input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_DISPLAY_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Đơn vị / Khoa / Bộ môn" wide>
              <select className="t-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">-- Không giới hạn / Chưa gắn đơn vị --</option>
                {(dataReq.data?.departments || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </Field>
            {modalUser !== 'new' && (
              <Field label="Trạng thái hoạt động" wide>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Tài khoản đang hoạt động (bỏ chọn để khóa và thu hồi JWT ngay)
                </label>
              </Field>
            )}
            <Field
              label={modalUser === 'new' ? 'Mật khẩu khởi tạo' : 'Đặt lại mật khẩu mới (tùy chọn)'}
              required={modalUser === 'new'}
              wide
            >
              <input
                className="t-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={modalUser === 'new' ? 'Tối thiểu 6 ký tự (8+ ở Production)' : 'Để trống nếu giữ nguyên mật khẩu hiện tại'}
              />
            </Field>
            {formErr && <p className="t-field__error t-field--wide" role="alert">{formErr}</p>}
          </form>
        </Modal>
      )}

      {deactivateTarget && (
        <ConfirmDialog
          title="Vô hiệu hóa tài khoản người dùng?"
          message={`Tài khoản "${deactivateTarget.full_name}" (${deactivateTarget.email}) sẽ bị khóa đăng nhập và thu hồi toàn bộ phiên hiện tại, nhưng dữ liệu học tập/giảng dạy lịch sử vẫn được bảo toàn.`}
          confirmLabel="Vô hiệu hóa"
          danger
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={async () => {
            try {
              await teachingApi.deleteUser(deactivateTarget.id);
              setDeactivateTarget(null);
              toast({ tone: 'success', title: 'Đã vô hiệu hóa tài khoản' });
              dataReq.reload();
            } catch (err) {
              toast({ tone: 'error', title: 'Không vô hiệu hóa được tài khoản', detail: errMsg(err) });
            }
          }}
        />
      )}
    </div>
  );
};
