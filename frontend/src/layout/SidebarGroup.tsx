import React from 'react';
import { IconChevronDown, IconChevronRight } from '../teaching/components/Icons';
import { NavGroupConfig } from './navigationConfig';
import { SidebarItem } from './SidebarItem';

interface SidebarGroupProps {
  group: NavGroupConfig;
  pathname: string;
  search: string;
  isRail: boolean;
  groupOpen: boolean;
  openSubmenus: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  onToggleSubmenu: (itemId: string) => void;
  onNavigate?: () => void;
}

export const SidebarGroup: React.FC<SidebarGroupProps> = ({
  group,
  pathname,
  search,
  isRail,
  groupOpen,
  openSubmenus,
  onToggleGroup,
  onToggleSubmenu,
  onNavigate,
}) => (
  <section className="saas-sidebar-group" aria-label={group.title}>
    {isRail ? (
      <div className="saas-sidebar-group__divider" aria-hidden="true" />
    ) : (
      <button
        type="button"
        className="saas-sidebar-group__header"
        aria-expanded={groupOpen}
        onClick={() => onToggleGroup(group.id)}
      >
        <span>{group.title}</span>
        {groupOpen ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
      </button>
    )}

    {(isRail || groupOpen) && (
      <div className="saas-sidebar-group__list">
        {group.items.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            pathname={pathname}
            search={search}
            isRail={isRail}
            submenuOpen={Boolean(openSubmenus[item.id])}
            onToggleSubmenu={onToggleSubmenu}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    )}
  </section>
);
