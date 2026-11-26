import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconKeyboard, IconSearch, IconX, NavIcon } from '../teaching/components/Icons';
import { UserRole } from '../types/elearning';
import { getSearchableActions, SearchableActionItem } from './navigationConfig';

function normalizeVi(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

export const GlobalSearchTrigger: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <div className="saas-search-slot">
    <button
      type="button"
      className="saas-search-trigger"
      onClick={onOpen}
      aria-label="Tìm kiếm trang và chức năng (Ctrl + K)"
    >
      <IconSearch size={17} />
      <span className="saas-search-trigger__text">Tìm trang, chức năng…</span>
      <kbd className="saas-kbd">Ctrl K</kbd>
    </button>
    <button
      type="button"
      className="saas-icon-btn saas-search-mobile-btn"
      onClick={onOpen}
      aria-label="Mở tìm kiếm nhanh (Ctrl + K)"
    >
      <IconSearch size={18} />
    </button>
  </div>
);

export const GlobalSearchModal: React.FC<{
  open: boolean;
  onClose: () => void;
  roles: UserRole[];
}> = ({ open, onClose, roles }) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const allItems = useMemo(() => getSearchableActions(roles), [roles]);

  const filtered = useMemo<SearchableActionItem[]>(() => {
    const q = normalizeVi(query);
    if (!q) return allItems;
    const tokens = q.split(/\s+/).filter(Boolean);
    return allItems.filter((item) => {
      const hay = normalizeVi(`${item.label} ${item.groupTitle} ${item.keywords.join(' ')}`);
      return tokens.every((tk) => hay.includes(tk));
    });
  }, [allItems, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const pick = (item: SearchableActionItem) => {
    onClose();
    navigate(item.to);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      pick(filtered[activeIndex]);
    }
  };

  return (
    <div
      className="saas-cmd-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="saas-cmd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Tìm kiếm nhanh phân hệ và chức năng"
        onKeyDown={handleKeyDown}
      >
        <div className="saas-cmd-head">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            type="search"
            className="saas-cmd-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập tên trang hoặc chức năng (VD: lớp học, thời khóa biểu, điểm danh…)"
            aria-label="Từ khóa tìm kiếm điều hướng"
          />
          <button type="button" className="saas-icon-btn" aria-label="Đóng tìm kiếm" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>

        <div className="saas-cmd-body" role="listbox" aria-label="Kết quả điều hướng">
          {filtered.length === 0 ? (
            <div className="saas-cmd-empty">
              Không tìm thấy trang hoặc chức năng khớp với “{query}”.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`saas-cmd-item${active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => pick(item)}
                >
                  <span className="saas-cmd-item__icon">
                    <NavIcon name={item.icon} size={18} />
                  </span>
                  <span className="saas-cmd-item__meta">
                    <strong>{item.label}</strong>
                    <span>{item.groupTitle}</span>
                  </span>
                  <span className="saas-cmd-item__hint">Đi tới</span>
                </button>
              );
            })
          )}
        </div>

        <div className="saas-cmd-foot">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconKeyboard size={14} /> ↑ ↓ chọn nhanh · Enter mở trang · Esc đóng
          </span>
          <span className="tabular-nums">{filtered.length} mục khả dụng</span>
        </div>
      </div>
    </div>
  );
};
