import React, { useState } from 'react';
import { UserRole } from '../../types/elearning';
import { AuthenticatedUser, apiLogin, apiRegister } from '../../api/elearningClient';
import { Button } from '../ui/Primitives';

export const ROLE_DISPLAY_LABELS: Record<UserRole, string> = {
  STUDENT: 'Học viên',
  INSTRUCTOR: 'Giảng viên',
  TEACHING_ASSISTANT: 'Trợ giảng',
  ACADEMIC_STAFF: 'Giáo vụ',
  ADMIN: 'Quản trị viên',
};

/** Tài khoản dùng thử — chỉ điền sẵn biểu mẫu, người dùng vẫn phải bấm Đăng nhập. */
const DEMO_ACCOUNTS: Array<{ name: string; email: string }> = [
  { name: 'Cô Lê Thu Hà (Giảng viên)', email: 'thuha.gv@lmsplus.edu.vn' },
  { name: 'Thầy Đỗ Văn Khoa (Giảng viên)', email: 'vankhoa.gv@lmsplus.edu.vn' },
  { name: 'Thầy Phạm Minh Quân (Trợ giảng)', email: 'minhquan.tg@lmsplus.edu.vn' },
  { name: 'Cô Nguyễn Thu Trang (Giáo vụ)', email: 'giaovu@lmsplus.edu.vn' },
  { name: 'Nguyễn Minh Anh (Học viên)', email: 'minhanh.hs@lmsplus.edu.vn' },
  { name: 'Quản trị Hệ thống', email: 'admin@lmsplus.edu.vn' },
];

interface AuthPageProps {
  onAuthSuccess: (user: AuthenticatedUser, message: string) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '48px',
  padding: '0 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-strong)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '15px',
  fontFamily: 'var(--font-sans)',
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px', fontWeight: 600 }}>
    <span>{label}</span>
    {children}
  </label>
);

export const AuthPage: React.FC<AuthPageProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: 'LOGIN' | 'REGISTER') => {
    setMode(next);
    setErrorMsg(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!identifier.trim() || !password) {
      setErrorMsg('Vui lòng nhập Email (hoặc mã số) và mật khẩu.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiLogin(identifier.trim(), password);
      onAuthSuccess(res.user, `Chào mừng ${res.user.full_name} quay trở lại!`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Email hoặc mật khẩu không chính xác.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!fullName.trim() || !email.trim()) {
      setErrorMsg('Vui lòng nhập họ tên và email.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMsg('Mật khẩu cần tối thiểu 6 ký tự.');
      return;
    }
    if (regPassword !== regConfirm) {
      setErrorMsg('Mật khẩu xác nhận chưa trùng khớp.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRegister({
        full_name: fullName.trim(),
        email: email.trim(),
        code: studentCode.trim() || undefined,
        password: regPassword,
      });
      onAuthSuccess(res.user, `Tạo tài khoản thành công. Chào mừng ${res.user.full_name}!`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạo tài khoản. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-surface-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        className="auth-split"
        style={{
          width: '100%',
          maxWidth: '960px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-floating)',
          overflow: 'hidden',
        }}
      >
        {/* Cột trái: giới thiệu ngắn gọn */}
        <aside
          className="auth-hero-pane"
          style={{
            backgroundColor: 'var(--brand-primary)',
            color: 'var(--text-on-brand)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '32px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--text-on-brand)',
                color: 'var(--brand-primary)',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '18px',
              }}
            >
              L+
            </div>
            <strong style={{ fontSize: '20px' }}>LMSPLUS E-Learning</strong>
          </div>

          <div>
            <h1 style={{ fontSize: 'clamp(24px, 4vw, 32px)', lineHeight: 1.2, margin: '0 0 16px 0', color: 'var(--text-on-brand)' }}>
              Học tập và giảng dạy trên một nền tảng duy nhất
            </h1>
            <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.6, maxWidth: '40ch' }}>
              Theo dõi tiến độ, học bài giảng video, làm bài kiểm tra và quản lý lớp học — mọi lúc, mọi nơi.
            </p>
          </div>

          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '15px' }}>
            <li>Tiếp tục bài học đúng vị trí đang dừng</li>
            <li>Sổ đầu bài và điểm danh điện tử</li>
            <li>Quản lý khóa học, bài giảng tập trung</li>
          </ul>
        </aside>

        {/* Cột phải: biểu mẫu */}
        <section className="auth-form-pane" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h2 style={{ fontSize: 'clamp(22px, 3vw, 26px)', margin: '0 0 8px 0' }}>
              {mode === 'LOGIN' ? 'Đăng nhập' : 'Tạo tài khoản học viên'}
            </h2>
            <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
              {mode === 'LOGIN'
                ? 'Sử dụng email hoặc mã số được nhà trường cấp.'
                : 'Điền thông tin bên dưới để bắt đầu học ngay.'}
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--brand-tint)',
                border: '1px solid var(--status-danger)',
                color: 'var(--status-danger)',
                fontSize: '14px',
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          )}

          {mode === 'LOGIN' ? (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Field label="Email hoặc mã số">
                <input
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="vd: ten@lmsplus.edu.vn"
                  style={inputStyle}
                />
              </Field>
              <Field label="Mật khẩu">
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  />
                  <Button variant="subtle" onClick={() => setShowPassword((v) => !v)} style={{ minHeight: '48px', flexShrink: 0 }}>
                    {showPassword ? 'Ẩn' : 'Hiện'}
                  </Button>
                </div>
              </Field>
              <Button type="submit" variant="primary" size="lg" isLoading={submitting} style={{ width: '100%' }}>
                Đăng nhập
              </Button>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Chưa có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('REGISTER')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--brand-primary)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: '44px',
                    fontSize: '14px',
                  }}
                >
                  Đăng ký ngay
                </button>
              </p>

              <div
                style={{
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Tài khoản dùng thử (mật khẩu <strong>123456</strong>) — bấm để điền sẵn:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => {
                        setIdentifier(acc.email);
                        setPassword('123456');
                        setErrorMsg(null);
                      }}
                      style={{
                        minHeight: '44px',
                        padding: '0 14px',
                        borderRadius: 'var(--radius-pill)',
                        border: '1px solid var(--border-strong)',
                        backgroundColor: identifier === acc.email ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {acc.name}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Field label="Họ và tên">
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="vd: Lê Minh Khôi" style={inputStyle} />
              </Field>
              <Field label="Email">
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vd: khoi@lmsplus.edu.vn" style={inputStyle} />
              </Field>
              <Field label="Mã số sinh viên (không bắt buộc)">
                <input type="text" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} placeholder="Để trống để hệ thống tự cấp" style={inputStyle} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px' }}>
                <Field label="Mật khẩu">
                  <input type="password" autoComplete="new-password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="Tối thiểu 6 ký tự" style={inputStyle} />
                </Field>
                <Field label="Nhập lại mật khẩu">
                  <input type="password" autoComplete="new-password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} placeholder="Nhập lại" style={inputStyle} />
                </Field>
              </div>
              <Button type="submit" variant="primary" size="lg" isLoading={submitting} style={{ width: '100%' }}>
                Tạo tài khoản
              </Button>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('LOGIN')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--brand-primary)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    minHeight: '44px',
                    fontSize: '14px',
                  }}
                >
                  Đăng nhập
                </button>
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};
