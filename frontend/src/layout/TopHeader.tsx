import React from 'react';
import { Link } from 'react-router-dom';
import { AuthenticatedUser } from '../api/elearningClient';
import { BrandLogo } from '../components/BrandLogo';
import { NotificationItem } from '../teaching/api';
import { IconHelpCircle, IconMenu } from '../teaching/components/Icons';
import { ThemeMode, UserRole } from '../types/elearning';
import { GlobalSearchTrigger } from './GlobalSearch';
import { NotificationDropdown } from './NotificationDropdown';
import { UserProfileMenu } from './UserProfileMenu';

interface TopHeaderProps {
  headerRef: React.RefObject<HTMLElement>;
  homePath: string;
  user: AuthenticatedUser;
  theme: ThemeMode;
  sidebarExpandedOrMobileOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  onRefreshNotifications: () => void;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onChangeTheme: (next: ThemeMode) => void;
  onLogout: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  headerRef,
  homePath,
  user,
  theme,
  sidebarExpandedOrMobileOpen,
  onToggleSidebar,
  onOpenSearch,
  onOpenHelp,
  notifications,
  unreadCount,
  onRefreshNotifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onChangeTheme,
  onLogout,
}) => {
  void (user.roles as UserRole[]);

  return (
    <header ref={headerRef} className="saas-header">
      <div className="saas-header__inner">
        <div className="saas-header__left">
          <button
            type="button"
            className="saas-icon-btn"
            aria-label="Đóng mở thanh điều hướng"
            aria-expanded={sidebarExpandedOrMobileOpen}
            onClick={onToggleSidebar}
          >
            <IconMenu size={20} />
          </button>

          <Link
            to={homePath}
            aria-label="Về trang chủ LMSPLUS"
            className="app-header__brand"
          >
            <BrandLogo size={36} wordmarkSize={19} />
          </Link>
        </div>

        <div className="saas-header__center">
          <GlobalSearchTrigger onOpen={onOpenSearch} />
        </div>

        <div className="saas-header__right">
          <button
            type="button"
            className="saas-icon-btn"
            aria-label="Trung tâm hỗ trợ và phím tắt"
            onClick={onOpenHelp}
          >
            <IconHelpCircle size={19} />
          </button>

          <NotificationDropdown
            notifications={notifications}
            unreadCount={unreadCount}
            onRefresh={onRefreshNotifications}
            onMarkRead={onMarkNotificationRead}
            onMarkAllRead={onMarkAllNotificationsRead}
          />

          <UserProfileMenu
            user={user}
            theme={theme}
            onChangeTheme={onChangeTheme}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
};
