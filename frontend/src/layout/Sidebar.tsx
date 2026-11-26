import React, { useEffect, useMemo, useState } from 'react';
import { ROLE_DISPLAY_LABELS } from '../components/elearning/AuthPage';
import { IconX } from '../teaching/components/Icons';
import { UserRole } from '../types/elearning';
import { getVisibleNavGroups, isNavItemActive } from './navigationConfig';
import { SidebarGroup } from './SidebarGroup';

const GROUP_STATE_STORAGE_KEY = 'lmsplus_nav_groups_v1';
const SUBMENU_STATE_STORAGE_KEY = 'lmsplus_nav_submenus_v1';

function readBoolMap(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface SidebarProps {
  roles: UserRole[];
  pathname: string;
  search: string;
  collapsed: boolean;
  mobileOpen: boolean;
  flushHidden: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  roles,
  pathname,
  search,
  collapsed,
  mobileOpen,
  flushHidden,
  onCloseMobile,
}) => {
  const groups = useMemo(() => getVisibleNavGroups(roles), [roles]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = readBoolMap(GROUP_STATE_STORAGE_KEY);
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.id] = saved[g.id] !== undefined ? Boolean(saved[g.id]) : true;
    }
    return init;
  });

  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>(() => readBoolMap(SUBMENU_STATE_STORAGE_KEY));

  // Tự động mở nhóm và menu cha chứa route hiện tại
  useEffect(() => {
    let nextGroups: Record<string, boolean> | null = null;
    let nextSubs: Record<string, boolean> | null = null;
    for (const g of groups) {
      let groupMatched = false;
      for (const item of g.items) {
        if (isNavItemActive(item, pathname, search)) {
          groupMatched = true;
          if (item.children && !openSubmenus[item.id]) {
            nextSubs = { ...(nextSubs || openSubmenus), [item.id]: true };
          }
        }
      }
      if (groupMatched && openGroups[g.id] === false) {
        nextGroups = { ...(nextGroups || openGroups), [g.id]: true };
      }
    }
    if (nextGroups) setOpenGroups(nextGroups);
    if (nextSubs) setOpenSubmenus(nextSubs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, groups]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_STATE_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // ignore storage quota
    }
  }, [openGroups]);

  useEffect(() => {
    try {
      localStorage.setItem(SUBMENU_STATE_STORAGE_KEY, JSON.stringify(openSubmenus));
    } catch {
      // ignore storage quota
    }
  }, [openSubmenus]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));
  };

  const toggleSubmenu = (itemId: string) => {
    setOpenSubmenus((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const isRail = collapsed && !mobileOpen && !flushHidden;
  const roleLabel = roles.map((r) => ROLE_DISPLAY_LABELS[r] || r).join(' · ');

  return (
    <>
      {mobileOpen && (
        <div
          className="saas-sidebar-backdrop"
          aria-hidden="true"
          onClick={onCloseMobile}
        />
      )}
      <aside
        aria-label="Điều hướng phân hệ LMSPLUS"
        className={`saas-sidebar${flushHidden && !mobileOpen ? ' is-hidden' : isRail ? ' is-rail' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}
      >
        <div className="saas-sidebar-mobile-head">
          <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>Danh mục nghiệp vụ</strong>
          <button
            type="button"
            className="saas-icon-btn"
            aria-label="Đóng thanh điều hướng"
            onClick={onCloseMobile}
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="saas-sidebar-scroll">
          {groups.map((group) => (
            <SidebarGroup
              key={group.id}
              group={group}
              pathname={pathname}
              search={search}
              isRail={isRail}
              groupOpen={openGroups[group.id] ?? true}
              openSubmenus={openSubmenus}
              onToggleGroup={toggleGroup}
              onToggleSubmenu={toggleSubmenu}
              onNavigate={mobileOpen ? onCloseMobile : undefined}
            />
          ))}
        </div>

        {!isRail && (
          <div className="saas-sidebar-footer">
            <span className="saas-sidebar-footer__label">Vai trò đang dùng</span>
            <strong className="saas-sidebar-footer__value">{roleLabel}</strong>
          </div>
        )}
      </aside>
    </>
  );
};
