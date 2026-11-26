import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconChevronDown, IconChevronRight, NavIcon } from '../teaching/components/Icons';
import { isNavChildActive, isNavItemActive, NavItemConfig } from './navigationConfig';

interface SidebarItemProps {
  item: NavItemConfig;
  pathname: string;
  search: string;
  isRail: boolean;
  submenuOpen: boolean;
  onToggleSubmenu: (id: string) => void;
  onNavigate?: () => void;
}

export const SidebarItem: React.FC<SidebarItemProps> = ({
  item,
  pathname,
  search,
  isRail,
  submenuOpen,
  onToggleSubmenu,
  onNavigate,
}) => {
  const active = isNavItemActive(item, pathname, search);
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const showRailTip = (el: HTMLElement) => {
    if (!isRail) return;
    const rect = el.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideRailTip = () => {
    if (tooltipPos) setTooltipPos(null);
  };

  return (
    <div className="saas-sidebar-item-wrap">
      <div className={`saas-sidebar-row${active ? ' is-active' : ''}`}>
        <Link
          to={item.to}
          aria-label={item.label}
          aria-current={active && (!hasChildren || !submenuOpen) ? 'page' : undefined}
          className={`saas-sidebar-item${active ? ' active' : ''}`}
          onClick={() => {
            if (hasChildren && !isRail && !submenuOpen) {
              onToggleSubmenu(item.id);
            }
            onNavigate?.();
          }}
          onMouseEnter={(e) => showRailTip(e.currentTarget)}
          onMouseLeave={hideRailTip}
          onFocus={(e) => showRailTip(e.currentTarget)}
          onBlur={hideRailTip}
        >
          <span className="saas-sidebar-item__icon">
            <NavIcon name={item.icon} size={18} />
          </span>
          <span className="saas-sidebar-item__label">{item.label}</span>
        </Link>

        {hasChildren && !isRail && (
          <button
            type="button"
            className="saas-sidebar-expand-btn"
            aria-label={submenuOpen ? `Thu gọn ${item.label}` : `Mở rộng ${item.label}`}
            aria-expanded={submenuOpen}
            onClick={() => onToggleSubmenu(item.id)}
          >
            {submenuOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        )}
      </div>

      {isRail && tooltipPos && (
        <div
          role="tooltip"
          className="saas-rail-tooltip"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {item.label}
        </div>
      )}

      {hasChildren && !isRail && submenuOpen && (
        <div className="saas-sidebar-sublist" role="group" aria-label={`Mục con của ${item.label}`}>
          {item.children!.map((child) => {
            const childActive = isNavChildActive(child, pathname, search);
            return (
              <Link
                key={child.id}
                to={child.to}
                aria-current={childActive ? 'page' : undefined}
                className={`saas-sidebar-subitem${childActive ? ' active' : ''}`}
                onClick={() => onNavigate?.()}
              >
                <span className="saas-sidebar-subitem__dot" aria-hidden="true" />
                <span className="saas-sidebar-subitem__label">{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
