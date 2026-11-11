import React, { useState } from 'react';
import {
  AuthenticatedUser, apiAdminCreateUser, apiDeleteUser, apiUpdateUser, fetchWorkspaceBootstrap,
} from '../../api/elearningClient';
import { ROLE_DISPLAY_LABELS } from '../../components/elearning/AuthPage';
import { UserRole } from '../../types/elearning';
import {
  Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Pagination, SearchInput, Tone,
  errMsg, useAsync, useToast,
} from '../ui';

const ROLES: UserRole[] = ['STUDENT', 'INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN'];
const PAGE_SIZE = 10;

export const AdminAccountsPage: React.FC = () => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [modalUser, setModalUser] = useState<null | 'new' | AuthenticatedUser>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthenticatedUser | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<UserRole>('STUDENT');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const bootReq = useAsync(async () => {
    const b = await fetchWorkspaceBootstrap();
    if (!b) throw new Error('Không thể tải danh sách tài khoản.');
    return b.users_list || [];
  }, []);

  const openCreate = () => {
    setFullName('');
    setEmail('');
    setCode('');
    setRole('STUDENT');
    setPassword('123456');
    setFormErr(null);
    setModalUser('new');
  };

  const openEdit = (u: AuthenticatedUser) => {
    setFullName(u.full_name);
    setEmail(u.email);
    setCode(u.code);
    setRole((u.roles?.[0] as UserRole) || 'STUDENT');
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
        await apiAdminCreateUser({
          full_name: fullName.trim(),
          email: email.trim(),
          code: code.trim() || undefined,
          role,
          password,
        });
        toast({ tone: 'success', title: 'Đã tạo tài khoản người dùng mới' });
      } else if (modalUser) {
        await apiUpdateUser(
          modalUser.id,
          { full_name: fullName.trim(), email: email.trim(), code: code.trim(), role },
          'ADMIN'
        );
        toast({ tone: 'success', title: 'Đã cập nhật thông tin tài khoản' });
      }
      setModalUser(null);
      bootReq.reload();
    } catch (err) {
      setFormErr(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const items = (bootReq.data || []).filter((u) => {
    if (roleFilter && !u.roles.includes(roleFilter as UserRole)) return false;
    if (q.trim() && !`${u.code} ${u.full_name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="t-page">
      <PageHeader
        title="Quản lý tài khoản hệ thống"
        subtitle="Cấp mới, chỉnh sửa vai trò hoặc thu hồi tài khoản giảng viên, trợ giảng, giáo vụ và học viên."
        actions={
          <Btn variant="primary" onClick={openCreate}>
            + Tạo tài khoản
          </Btn>
        }
      />

      <Card padded={false}>
        <div className="t-toolbar" style={{ padding: '16px var(--card-pad, 24px)', borderBottom: '1px solid var(--border-subtle)' }}>
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
            <option value="">Tất cả nhóm người dùng</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_DISPLAY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {bootReq.loading && <Loading rows={5} />}
        {bootReq.error && <ErrorState error={bootReq.error} onRetry={bootReq.reload} />}
        {!bootReq.loading && !bootReq.error && (
          items.length === 0 ? (
            <EmptyState
              title="Không tìm thấy tài khoản nào"
              text={q.trim() || roleFilter ? 'Thử đổi từ khóa tìm kiếm hoặc bộ lọc nhóm người dùng.' : 'Chưa có tài khoản trong hệ thống.'}
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
                      <th>Nhóm người dùng</th>
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
                            {u.roles.map((r) => ROLE_DISPLAY_LABELS[r] || r).join(', ')}
                          </Tone>
                        </td>
                        <td className="actions">
                          <div className="t-actions">
                            <Btn small variant="quiet" onClick={() => openEdit(u)}>
                              Sửa
                            </Btn>
                            {!u.roles.includes('ADMIN') && (
                              <Btn small variant="danger" onClick={() => setDeleteTarget(u)}>
                                Xóa
                              </Btn>
                            )}
                          </div>
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
          title={modalUser === 'new' ? 'Tạo tài khoản mới' : 'Chỉnh sửa tài khoản'}
          onClose={() => setModalUser(null)}
          width={520}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setModalUser(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" onClick={submitForm} loading={busy}>Lưu</Btn>
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
            <Field label="Nhóm người dùng" required>
              <select className="t-input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_DISPLAY_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            {modalUser === 'new' && (
              <Field label="Mật khẩu khởi tạo" required wide>
                <input className="t-input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            {formErr && <p className="t-field__error t-field--wide" role="alert">{formErr}</p>}
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Xóa tài khoản người dùng?"
          message={`Bạn sắp xóa tài khoản "${deleteTarget.full_name}" (${deleteTarget.email}).`}
          confirmLabel="Xóa tài khoản"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            try {
              await apiDeleteUser(deleteTarget.id, 'ADMIN');
              setDeleteTarget(null);
              toast({ tone: 'success', title: 'Đã xóa tài khoản' });
              bootReq.reload();
            } catch (err) {
              toast({ tone: 'error', title: 'Không xóa được tài khoản', detail: errMsg(err) });
            }
          }}
        />
      )}
    </div>
  );
};
