import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthenticatedUser } from '../api/elearningClient';
import { NotificationItem } from '../teaching/api';
import { ThemeMode, UserRole } from '../types/elearning';
import { Breadcrumb } from './Breadcrumb';
import { BreadcrumbProvider } from './BreadcrumbContext';
import { GlobalSearchModal } from './GlobalSearch';
import { HelpCenterModal } from './HelpCenterModal';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';

const SIDEBAR_STORAGE_KEY = 'lmsplus_sidebar_collapsed_v1';

function readInitialSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface AppLayoutProps {
  user: AuthenticatedUser;
  theme: ThemeMode;
  onChangeTheme: (next: ThemeMode) => void;
  onLogout: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  onRefreshNotifications: () => void;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  user,
  theme,
  onChangeTheme,
  onLogout,
  notifications,
  unreadCount,
  onRefreshNotifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  children,
}) => {
  const location = useLocation();
  const headerRef = useRef<HTMLElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readInitialSidebarCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const roles = (user.roles || []) as UserRole[];
  const isStudentOnly = roles.includes('STUDENT') && roles.every((r) => r === 'STUDENT');
  const homePath = isStudentOnly ? '/learn' : '/teaching';
  const isFlushWorkspace =
    location.pathname.endsWith('/studio') || location.pathname.startsWith('/teaching/lessons/');

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
  }, [user.id]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [mobileOpen]);

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      setMobileOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  };

  return (
    <BreadcrumbProvider>
      <div className="saas-app-shell">
        <TopHeader
          headerRef={headerRef}
          homePath={homePath}
          user={user}
          theme={theme}
          sidebarExpandedOrMobileOpen={mobileOpen || (!sidebarCollapsed && !isFlushWorkspace)}
          onToggleSidebar={handleToggleSidebar}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          notifications={notifications}
          unreadCount={unreadCount}
          onRefreshNotifications={onRefreshNotifications}
          onMarkNotificationRead={onMarkNotificationRead}
          onMarkAllNotificationsRead={onMarkAllNotificationsRead}
          onChangeTheme={onChangeTheme}
          onLogout={onLogout}
        />

        <div className="saas-shell-body">
          <Sidebar
            roles={roles}
            pathname={location.pathname}
            search={location.search}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileOpen}
            flushHidden={isFlushWorkspace}
            onCloseMobile={() => setMobileOpen(false)}
          />

          <div className="saas-content-col">
            {!isFlushWorkspace && <Breadcrumb roles={roles} />}
            <main className={isFlushWorkspace ? 'app-main app-main--flush' : 'app-main'}>
              {children}
            </main>
          </div>
        </div>

        <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} roles={roles} />
        <HelpCenterModal open={helpOpen} onClose={() => setHelpOpen(false)} roles={roles} />
      </div>
    </BreadcrumbProvider>
  );
};
