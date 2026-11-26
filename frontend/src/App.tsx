import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthenticatedUser, apiLogout, getSavedAuthUser } from './api/elearningClient';
import { AuthPage } from './components/elearning/AuthPage';
import { AppLayout } from './layout/AppLayout';
import { masterApi, NotificationItem, teachingApi } from './teaching/api';
import { Loading, useToast } from './teaching/ui';
import { ThemeMode, UserRole } from './types/elearning';

const AdminAccountsPage = lazy(() => import('./teaching/pages/AdminAccountsPage').then((m) => ({ default: m.AdminAccountsPage })));
const DepartmentsPage = lazy(() => import('./teaching/pages/DepartmentsPage').then((m) => ({ default: m.DepartmentsPage })));
const AttendancePage = lazy(() => import('./teaching/pages/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const BanksPage = lazy(() => import('./teaching/pages/BanksPage').then((m) => ({ default: m.BanksPage })));
const ClassDetailPage = lazy(() => import('./teaching/pages/ClassDetailPage').then((m) => ({ default: m.ClassDetailPage })));
const ClassListPage = lazy(() => import('./teaching/pages/ClassListPage').then((m) => ({ default: m.ClassListPage })));
const CohortDetailPage = lazy(() => import('./teaching/pages/CohortPages').then((m) => ({ default: m.CohortDetailPage })));
const CohortListPage = lazy(() => import('./teaching/pages/CohortPages').then((m) => ({ default: m.CohortListPage })));
const CourseDetailPage = lazy(() => import('./teaching/pages/CourseDetailPage').then((m) => ({ default: m.CourseDetailPage })));
const CourseListPage = lazy(() => import('./teaching/pages/CourseListPage').then((m) => ({ default: m.CourseListPage })));
const CurriculumDetailPage = lazy(() => import('./teaching/pages/CurriculumPages').then((m) => ({ default: m.CurriculumDetailPage })));
const CurriculumListPage = lazy(() => import('./teaching/pages/CurriculumPages').then((m) => ({ default: m.CurriculumListPage })));
const StaffLeaveRequestsPage = lazy(() => import('./teaching/pages/LeaveRequestsPage').then((m) => ({ default: m.StaffLeaveRequestsPage })));
const StudentLeaveRequestsPage = lazy(() => import('./teaching/pages/LeaveRequestsPage').then((m) => ({ default: m.StudentLeaveRequestsPage })));
const SchedulePage = lazy(() => import('./teaching/pages/SchedulePage').then((m) => ({ default: m.SchedulePage })));
const TeachingHoursPage = lazy(() => import('./teaching/pages/TeachingHoursPage').then((m) => ({ default: m.TeachingHoursPage })));
const TimetablePage = lazy(() => import('./teaching/pages/TimetablePage').then((m) => ({ default: m.TimetablePage })));
const StudentAssignmentsPage = lazy(() => import('./teaching/pages/StudentAssessmentPages').then((m) => ({ default: m.StudentAssignmentsPage })));
const StudentExamsPage = lazy(() => import('./teaching/pages/StudentAssessmentPages').then((m) => ({ default: m.StudentExamsPage })));
const StudentClassPage = lazy(() => import('./teaching/pages/StudentPages').then((m) => ({ default: m.StudentClassPage })));
const StudentHomePage = lazy(() => import('./teaching/pages/StudentPages').then((m) => ({ default: m.StudentHomePage })));
const StudentLessonPage = lazy(() => import('./teaching/pages/StudentPages').then((m) => ({ default: m.StudentLessonPage })));
const TeachingDashboard = lazy(() => import('./teaching/pages/TeachingDashboard').then((m) => ({ default: m.TeachingDashboard })));
const VirtualSessionPage = lazy(() => import('./teaching/pages/VirtualSessionPage').then((m) => ({ default: m.VirtualSessionPage })));
const LessonStudioPage = lazy(() => import('./teaching/studio/LessonStudioPage').then((m) => ({ default: m.LessonStudioPage })));

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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const refreshNotifications = () => {
    if (!currentUser) return;
    masterApi
      .listNotifications()
      .then((res) => {
        setNotifications(res.items || []);
        setUnreadCount(Number(res.unread_count || 0));
      })
      .catch(() => {
        // non-blocking
      });
  };

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
  const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
  const isStaff = roles.includes('ACADEMIC_STAFF');
  const isHod = roles.includes('HEAD_OF_DEPARTMENT');
  const isInstructor = roles.includes('INSTRUCTOR');
  const canViewGovernance = isAdmin || isStaff || isHod;
  const canCoordinateTraining = isAdmin || isStaff || isHod;
  const canReviewLeaves = isAdmin || isStaff || isHod || isInstructor;
  const homePath = isStudentOnly ? '/learn' : '/teaching';

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await masterApi.markNotificationRead(id);
      setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // non-blocking
    }
  };

  const handleMarkAllNotificationsRead = async () => {
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
    setCurrentUser(null);
    toast({ tone: 'info', title: 'Bạn đã đăng xuất khỏi hệ thống' });
    navigate('/', { replace: true });
  };

  return (
    <AppLayout
      user={currentUser}
      theme={theme}
      onChangeTheme={setTheme}
      onLogout={handleLogout}
      notifications={notifications}
      unreadCount={unreadCount}
      onRefreshNotifications={refreshNotifications}
      onMarkNotificationRead={handleMarkNotificationRead}
      onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
    >
      <Suspense fallback={<div style={{ padding: 24 }}><Loading rows={5} /></div>}>
        <Routes>
          <Route path="/" element={<Navigate to={homePath} replace />} />

          {/* Cổng Giảng dạy & Đào tạo */}
          <Route path="/teaching" element={isStudentOnly ? <Navigate to="/learn" replace /> : <TeachingDashboard />} />
          <Route path="/teaching/curricula" element={canCoordinateTraining ? <CurriculumListPage /> : <Navigate to={homePath} replace />} />
          <Route path="/teaching/curricula/:curriculumId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CurriculumDetailPage />} />
          <Route path="/teaching/cohorts" element={canCoordinateTraining ? <CohortListPage /> : <Navigate to={homePath} replace />} />
          <Route path="/teaching/cohorts/:cohortId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CohortDetailPage />} />
          <Route path="/teaching/banks" element={isStudentOnly ? <Navigate to="/learn" replace /> : <BanksPage />} />
          <Route path="/teaching/leave-requests" element={canReviewLeaves ? <StaffLeaveRequestsPage /> : <Navigate to={homePath} replace />} />
          <Route path="/teaching/courses" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseListPage />} />
          <Route path="/teaching/courses/:courseId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <CourseDetailPage />} />
          <Route path="/teaching/courses/:courseId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/lessons/:lessonId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="COURSE" />} />
          <Route path="/teaching/classes" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassListPage />} />
          <Route path="/teaching/classes/:classId" element={isStudentOnly ? <Navigate to="/learn" replace /> : <ClassDetailPage />} />
          <Route path="/teaching/classes/:classId/studio" element={isStudentOnly ? <Navigate to="/learn" replace /> : <LessonStudioPage mode="CLASS" />} />
          <Route path="/teaching/classes/:classId/attendance" element={isStudentOnly ? <Navigate to="/learn" replace /> : <AttendancePage />} />
          <Route path="/teaching/classes/:classId/sessions/:sessionId/live" element={isStudentOnly ? <Navigate to="/learn" replace /> : <VirtualSessionPage />} />
          <Route path="/teaching/timetable" element={canCoordinateTraining ? <TimetablePage /> : <Navigate to={homePath} replace />} />
          <Route path="/teaching/schedule" element={isStudentOnly ? <Navigate to="/learn" replace /> : <SchedulePage />} />
          <Route path="/teaching/hours" element={isStudentOnly ? <Navigate to="/learn" replace /> : <TeachingHoursPage />} />
          <Route path="/teaching-hours" element={<Navigate to="/teaching/hours" replace />} />

          {/* Cổng Học viên */}
          <Route path="/learn" element={<StudentHomePage />} />
          <Route path="/learn/exams" element={<StudentExamsPage />} />
          <Route path="/learn/assignments" element={<StudentAssignmentsPage />} />
          <Route path="/learn/leave-requests" element={<StudentLeaveRequestsPage />} />
          <Route path="/learn/classes/:classId" element={<StudentClassPage />} />
          <Route path="/learn/classes/:classId/lessons/:lessonId" element={<StudentLessonPage />} />
          <Route path="/learn/schedule" element={<SchedulePage studentMode />} />

          {/* Quản trị hệ thống */}
          <Route path="/admin/departments" element={canViewGovernance ? <DepartmentsPage /> : <Navigate to={homePath} replace />} />
          <Route path="/admin/accounts" element={canViewGovernance ? <AdminAccountsPage /> : <Navigate to={homePath} replace />} />

          <Route path="*" element={<Navigate to={homePath} replace />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
};
