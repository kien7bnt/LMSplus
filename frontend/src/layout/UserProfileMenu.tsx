import React, { useEffect, useRef, useState } from 'react';
import { AuthenticatedUser } from '../api/elearningClient';
import { ROLE_DISPLAY_LABELS } from '../components/elearning/AuthPage';
import { IconChevronDown, IconLogOut } from '../teaching/components/Icons';
import { Btn, ThemeSwitcher } from '../teaching/ui';
import { ThemeMode, UserRole } from '../types/elearning';

interface UserProfileMenuProps {
  user: AuthenticatedUser;
  theme: ThemeMode;
  onChangeTheme: (next: ThemeMode) => void;
  onLogout: () => void;
}

export const UserProfileMenu: React.FC<UserProfileMenuProps> = ({
  user,
  theme,
  onChangeTheme,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const roles = (user.roles || []) as UserRole[];
  const primaryRole = ROLE_DISPLAY_LABELS[roles[0]] || 'Thành viên';
  const allRolesLabel = roles.map((r) => ROLE_DISPLAY_LABELS[r] || r).join(' · ');
  const avatarChar = user.full_name.trim().split(/\s+/).pop()?.slice(0, 1).toUpperCase() || 'U';

  return (
    <div ref={wrapRef} className="app-header__actions">
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tài khoản ${user.full_name} (${primaryRole})`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="saas-avatar" aria-hidden="true">
          {avatarChar}
        </span>
        <span className="user-menu-trigger__meta saas-user-meta">
          <span className="saas-user-meta__name">{user.full_name}</span>
          <span className="saas-user-meta__role">{primaryRole}</span>
        </span>
        <IconChevronDown size={15} />
      </button>

      {open && (
        <div role="menu" className="app-user-dropdown">
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
            <strong style={{ display: 'block', fontSize: 15, overflowWrap: 'anywhere' }}>{user.full_name}</strong>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, overflowWrap: 'anywhere' }}>
              {user.email}
            </span>
            <span className="tabular-nums" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {allRolesLabel}{user.code ? ` · Mã số ${user.code}` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Giao diện hiển thị
            </span>
            <ThemeSwitcher theme={theme} onChange={onChangeTheme} />
          </div>

          <Btn
            variant="danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={{ width: '100%' }}
          >
            <IconLogOut size={16} /> Đăng xuất
          </Btn>
        </div>
      )}
    </div>
  );
};
