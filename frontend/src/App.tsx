import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthenticatedUser, apiLogout, getSavedAuthUser } from './api/elearningClient';
import { AuthPage, ROLE_DISPLAY_LABELS } from './components/elearning/AuthPage';
import { ThemeSwitcher } from './components/ui/Primitives';
import { teachingApi } from './teaching/api';
import { AdminAccountsPage } from './teaching/pages/AdminAccountsPage';
import { AttendancePage } from './teaching/pages/AttendancePage';
import { ClassDetailPage } from './teaching/pages/ClassDetailPage';
import { ClassListPage } from './teaching/pages/ClassListPage';
import { CourseDetailPage } from './teaching/pages/CourseDetailPage';
import { CourseListPage } from './teaching/pages/CourseListPage';
import { SchedulePage } from './teaching/pages/SchedulePage';
import { StudentClassPage, StudentHomePage, StudentLessonPage } from './teaching/pages/StudentPages';
import { TeachingDashboard } from './teaching/pages/TeachingDashboard';
import { LessonStudioPage } from './teaching/studio/LessonStudioPage';
import { Btn, useToast } from './teaching/ui';
import { ThemeMode, UserRole } from './types/elearning';

const THEME_STORAGE_KEY = 'lmsplus_theme_v1';

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'airbnb-light' || saved === 'cinema-dark' || saved === 'babu-academy') return saved;
  } catch {
    // ignore storage errors
  }
  return 'airbnb-light';
}

export const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(getSavedAuthUser);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const syncHeaderHeight = () => {
      const h = Math.max(56, Math.round(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--app-header-h', `${h}px`);
    };
    syncHeaderHeight();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeaderHeight) : null;
    ro?.observe(el);
    window.addEventListener('resize', syncHeaderHeight);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncHeaderHeight);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    const onExpired = () => {
      setCurrentUser(null);
      setIsUserMenuOpen(false);
      toast({ tone: 'info', title: 'Phiên đăng nhập đã hết hạn', detail: 'Vui lòng đăng nhập lại để tiếp tục.' });
    };
    window.addEventListener('lmsplus:session-expired', onExpired);
    return () => window.removeEventListener('lmsplus:session-expired', onExpired);
  }, [toast]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    teachingApi
      .me()
      .then((res) => {
        if (cancelled) return;
        setCurrentUser((prev) =>
          prev
            ? {
                ...prev,
                id: res.user.id,
                full_name: res.user.full_name,
                email: res.user.email,
                roles: res.user.roles as UserRole[],
                department_id: res.user.department_id,
              }
            : prev
        );
      })
      .catch(() => {
        if (!cancelled && !getSavedAuthUser()) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!isUserMenuOpen) return undefined;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsUserMenuOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isUserMenuOpen]);

  if (!currentUser) {
    return (
      <AuthPage
        onAuthSuccess={(user, msg) => {
          setCurrentUser(user);
          toast({ tone: 'success', title: msg });
          const studentOnly = user.roles.includes('STUDENT') && user.roles.every((r) => r === 'STUDENT');
          navigate(studentOnly ? '/learn' : '/teaching', { replace: true });
        }}
      />
    );
  }

  const roles = currentUser.roles || [];
  const isStudentOnly = roles.includes('STUDENT') && roles.every((r) => r === 'STUDENT');
  const isAdmin = roles.includes('ADMIN');
  const homePath = isStudentOnly ? '/learn' : '/teaching';

  const navItems: Array<{ to: string; label: string; end?: boolean }> = isStudentOnly
    ? [
        { to: '/learn', label: 'Lớp của tôi', end: true },
        { to: '/learn/schedule', label: 'Lịch học' },
      ]
    : [
        { to: '/teaching', label: 'Tổng quan', end: true },
        { to: '/teaching/courses', label: 'Khóa học' },
        { to: '/teaching/classes', label: 'Lớp học' },
        { to: '/teaching/schedule', label: 'Lịch giảng dạy' },
        ...(isAdmin ? [{ to: '/admin/accounts', label: 'Tài khoản' }] : []),
      ];

  const handleLogout = () => {
    apiLogout();
    setIsUserMenuOpen(false);
    setCurrentUser(null);
    toast({ tone: 'info', title: 'Bạn đã đăng xuất khỏi hệ thống' });
    navigate('/', { replace: true });
  };

  const avatarChar = currentUser.full_name.trim().split(/\s+/).pop()?.slice(0, 1).toUpperCase() || 'U';
  const roleLabel = roles.map((r) => ROLE_DISPLAY_LABELS[r] || r).join(' · ');

  const isFlushWorkspace =
    location.pathname.endsWith('/studio') || location.pathname.startsWith('/teaching/lessons/');

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <header ref={headerRef} className="app-header">
        <div className="app-header__inner">
          <Link
            to={homePath}
            aria-label="Về trang chủ LMSPLUS"
            className="app-header__brand"
            style={{ textDecoration: 'none' }}
          >
            <span
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--brand-primary)',
                color: 'var(--text-on-brand)',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '16px',
              }}
            >
              L+
            </span>
            <strong style={{ fontSize: '18px', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              LMSPLUS
            </strong>
          </Link>

          <nav
            aria-label="Điều hướng chính"
            className="app-header__nav"
            style={{ justifySelf: 'center', maxWidth: '100%' }}
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="app-nav-link"
                style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div ref={menuRef} className="app-header__actions">
            <button
              type="button"
              className="user-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              onClick={() => setIsUserMenuOpen((v) => !v)}
            >
              <span
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: 'var(--accent-learning)',
                  color: 'var(--text-on-brand)',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '14px',
                }}
              >
                {avatarChar}
              </span>
              <span
                className="user-menu-trigger__meta"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  maxWidth: '180px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentUser.full_name}
              </span>
              <span aria-hidden="true" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                ▾
              </span>
            </button>

            {isUserMenuOpen && (
              <div role="menu" className="app-user-dropdown">
                <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
                  <strong style={{ display: 'block', fontSize: '15px', overflowWrap: 'anywhere' }}>{currentUser.full_name}</strong>
                  <span style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginTop: 4, overflowWrap: 'anywhere' }}>
                    {currentUser.email}
                  </span>
                  <span className="tabular-nums" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {roleLabel}{currentUser.code ? ` · Mã số ${currentUser.code}` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Giao diện hiển thị
                  </span>
                  <ThemeSwitcher theme={theme} onChange={setTheme} />
                </div>

                <Btn variant="danger" onClick={handleLogout} style={{ width: '100%' }}>
                  Đăng xuất
                </Btn>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={isFlushWorkspace ? 'app-main app-main--flush' : 'app-main'}>
        <Routes>
          <Route path="/" element={<Navigate to={homePath} replace />} />

          {/* Cổng Giảng dạy & Lesson Studio */}
          <Route path="/teaching" element={isStudentOnly ? <Navigate to="/learn" replace /> : <TeachingDashboard />} />
          <Route path="/teaching/courses" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseListPage />} />
          <Route path="/teaching/courses/:courseId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseDetailPage />} />
          <Route path="/teaching/courses/:courseId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/lessons/:lessonId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/classes" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassListPage />} />
          <Route path="/teaching/classes/:classId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassDetailPage />} />
          <Route path="/teaching/classes/:classId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="CLASS" />} />
          <Route path="/teaching/classes/:classId/attendance" element={isStudentOnly ? <Navigate to="/learn" replace /> : <AttendancePage />} />
          <Route path="/teaching/schedule" element={isStudentOnly ? <Navigate to="/learn" replace /> : <SchedulePage />} />

          {/* Cổng Học viên */}
          <Route path="/learn" element={<StudentHomePage />} />
          <Route path="/learn/classes/:classId" element={<StudentClassPage />} />
          <Route path="/learn/classes/:classId/lessons/:lessonId" element={<StudentLessonPage />} />
          <Route path="/learn/schedule" element={<SchedulePage studentMode />} />

          {/* Quản trị tài khoản */}
          <Route path="/admin/accounts" element={isAdmin ? <AdminAccountsPage /> : <Navigate to={homePath} replace />} />

          <Route path="*" element={<Navigate to={homePath} replace />} />
        </Routes>
      </main>
    </div>
  );
};
