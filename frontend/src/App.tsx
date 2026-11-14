import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthenticatedUser, apiLogout, getSavedAuthUser } from './api/elearningClient';
import { AuthPage, ROLE_DISPLAY_LABELS } from './components/elearning/AuthPage';
import { ThemeSwitcher } from './components/ui/Primitives';
import { masterApi, NotificationItem, teachingApi } from './teaching/api';
import { AdminAccountsPage } from './teaching/pages/AdminAccountsPage';
import { AttendancePage } from './teaching/pages/AttendancePage';
import { BanksPage } from './teaching/pages/BanksPage';
import { ClassDetailPage } from './teaching/pages/ClassDetailPage';
import { ClassListPage } from './teaching/pages/ClassListPage';
import { CohortDetailPage, CohortListPage } from './teaching/pages/CohortPages';
import { CourseDetailPage } from './teaching/pages/CourseDetailPage';
import { CourseListPage } from './teaching/pages/CourseListPage';
import { CurriculumDetailPage, CurriculumListPage } from './teaching/pages/CurriculumPages';
import { StaffLeaveRequestsPage, StudentLeaveRequestsPage } from './teaching/pages/LeaveRequestsPage';
import { SchedulePage } from './teaching/pages/SchedulePage';
import { StudentAssignmentsPage, StudentExamsPage } from './teaching/pages/StudentAssessmentPages';
import { StudentClassPage, StudentHomePage, StudentLessonPage } from './teaching/pages/StudentPages';
import { TeachingDashboard } from './teaching/pages/TeachingDashboard';
import { VirtualSessionPage } from './teaching/pages/VirtualSessionPage';
import { LessonStudioPage } from './teaching/studio/LessonStudioPage';
import { Btn, fmtDateTime, useToast } from './teaching/ui';
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
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
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
    if (!currentUser) return;
    let cancelled = false;
    masterApi
      .listNotifications()
      .then((res) => {
        if (cancelled) return;
        setNotifications(res.items || []);
        setUnreadCount(Number(res.unread_count || 0));
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, location.pathname]);

  useEffect(() => {
    if (!isUserMenuOpen && !isNotifOpen) return undefined;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsUserMenuOpen(false);
        setIsNotifOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isUserMenuOpen, isNotifOpen]);

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
        { to: '/learn/exams', label: 'Kiểm tra' },
        { to: '/learn/assignments', label: 'Bài tập' },
        { to: '/learn/schedule', label: 'Lịch học' },
        { to: '/learn/leave-requests', label: 'Xin nghỉ' },
      ]
    : [
        { to: '/teaching', label: 'Tổng quan', end: true },
        { to: '/teaching/curricula', label: 'Khung CT' },
        { to: '/teaching/cohorts', label: 'Lớp khóa' },
        { to: '/teaching/courses', label: 'Môn học' },
        { to: '/teaching/classes', label: 'Lớp môn' },
        { to: '/teaching/banks', label: 'Ngân hàng' },
        { to: '/teaching/schedule', label: 'Lịch dạy' },
        { to: '/teaching/leave-requests', label: 'Đơn nghỉ' },
        ...(isAdmin ? [{ to: '/admin/accounts', label: 'Tài khoản' }] : []),
      ];

  const handleOpenNotifications = async () => {
    const next = !isNotifOpen;
    setIsNotifOpen(next);
    if (next) {
      try {
        const res = await masterApi.listNotifications();
        setNotifications(res.items || []);
        setUnreadCount(Number(res.unread_count || 0));
      } catch {
        // non-blocking
      }
    }
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      try {
        await masterApi.markNotificationRead(item.id);
        setNotifications((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // non-blocking
      }
    }
    setIsNotifOpen(false);
    if (item.link_path) navigate(item.link_path);
  };

  const handleMarkAllRead = async () => {
    try {
      await masterApi.markAllNotificationsRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setUnreadCount(0);
    } catch {
      // non-blocking
    }
  };

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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div ref={notifRef} className="m-notif-wrap">
              <button
                type="button"
                className="m-notif-btn"
                aria-label="Thông báo hệ thống"
                aria-expanded={isNotifOpen}
                onClick={handleOpenNotifications}
              >
                <span aria-hidden="true">🔔</span>
                {unreadCount > 0 && <span className="m-notif-dot tabular-nums">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>

              {isNotifOpen && (
                <div className="m-notif-popover" role="dialog" aria-label="Danh sách thông báo">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>Thông báo ({notifications.length})</strong>
                    {unreadCount > 0 && (
                      <Btn small variant="ghost" onClick={handleMarkAllRead}>
                        Đánh dấu đã đọc
                      </Btn>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '16px 0 4px' }}>
                      Bạn chưa có thông báo nào.
                    </p>
                  ) : (
                    <div className="m-notif-list">
                      {notifications.slice(0, 15).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className={`m-notif-item ${!n.is_read ? 'is-unread' : ''}`}
                          onClick={() => handleNotificationClick(n)}
                        >
                          <strong style={{ fontSize: 13 }}>{n.title}</strong>
                          {n.body && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.body}</span>}
                          <span className="tabular-nums" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {fmtDateTime(n.created_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

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
        </div>
      </header>

      <main className={isFlushWorkspace ? 'app-main app-main--flush' : 'app-main'}>
        <Routes>
          <Route path="/" element={<Navigate to={homePath} replace />} />

          {/* Cổng Giảng dạy & Lesson Studio */}
          <Route path="/teaching" element={isStudentOnly ? <Navigate to="/learn" replace /> : <TeachingDashboard />} />
          <Route path="/teaching/curricula" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CurriculumListPage />} />
          <Route path="/teaching/curricula/:curriculumId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CurriculumDetailPage />} />
          <Route path="/teaching/cohorts" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CohortListPage />} />
          <Route path="/teaching/cohorts/:cohortId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CohortDetailPage />} />
          <Route path="/teaching/banks" element={isStudentOnly ? <Navigate to="/learn" replace /> : <BanksPage />} />
          <Route path="/teaching/leave-requests" element={isStudentOnly ? <Navigate to="/learn" replace /> : <StaffLeaveRequestsPage />} />
          <Route path="/teaching/courses" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseListPage />} />
          <Route path="/teaching/courses/:courseId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseDetailPage />} />
          <Route path="/teaching/courses/:courseId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/lessons/:lessonId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/classes" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassListPage />} />
          <Route path="/teaching/classes/:classId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassDetailPage />} />
          <Route path="/teaching/classes/:classId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="CLASS" />} />
          <Route path="/teaching/classes/:classId/attendance" element={isStudentOnly ? <Navigate to="/learn" replace /> : <AttendancePage />} />
          <Route path="/teaching/classes/:classId/sessions/:sessionId/live" element={isStudentOnly ? <Navigate to="/learn" replace /> : <VirtualSessionPage />} />
          <Route path="/teaching/schedule" element={isStudentOnly ? <Navigate to="/learn" replace /> : <SchedulePage />} />

          {/* Cổng Học viên */}
          <Route path="/learn" element={<StudentHomePage />} />
          <Route path="/learn/exams" element={<StudentExamsPage />} />
          <Route path="/learn/assignments" element={<StudentAssignmentsPage />} />
          <Route path="/learn/leave-requests" element={<StudentLeaveRequestsPage />} />
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
