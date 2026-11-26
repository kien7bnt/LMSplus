import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationItem } from '../teaching/api';
import { IconBell } from '../teaching/components/Icons';
import { Btn, fmtDateTime } from '../teaching/ui';

interface NotificationDropdownProps {
  notifications: NotificationItem[];
  unreadCount: number;
  onRefresh: () => void;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  notifications,
  unreadCount,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
}) => {
  const navigate = useNavigate();
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

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) onRefresh();
  };

  const handleClickItem = async (item: NotificationItem) => {
    if (!item.is_read) {
      await onMarkRead(item.id);
    }
    setOpen(false);
    if (item.link_path) navigate(item.link_path);
  };

  return (
    <div ref={wrapRef} className="m-notif-wrap">
      <button
        type="button"
        className="saas-icon-btn"
        aria-label={`Thông báo hệ thống${unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ''}`}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <IconBell size={19} />
        {unreadCount > 0 && <span className="saas-notif-badge tabular-nums">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="m-notif-popover" role="dialog" aria-label="Danh sách thông báo">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 15 }}>Thông báo ({notifications.length})</strong>
            {unreadCount > 0 && (
              <Btn small variant="ghost" onClick={onMarkAllRead}>
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
                  onClick={() => handleClickItem(n)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%' }}>
                    <strong style={{ fontSize: 13 }}>{n.title}</strong>
                    {!n.is_read && <span className="saas-unread-dot" aria-label="Chưa đọc" />}
                  </div>
                  {n.body && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.body}</span>}
                  <span className="tabular-nums" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {fmtDateTime(n.created_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
