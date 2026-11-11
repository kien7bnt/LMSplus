import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { extractImageUrlCandidates, isSafeImageDataUrl, normalizeImageUrl } from '../../../shared/imageUrl.mjs';
import { ApiHttpError } from '../api/elearningClient';

// ------------------------------------------------------------------ formatting

const TZ = 'Asia/Ho_Chi_Minh';
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDateTime = (iso?: string | null) => (iso ? `${fmtTime(iso)} · ${fmtDate(iso)}` : '—');
export const fmtWeekday = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { timeZone: TZ, weekday: 'long' });
export const fmtBytes = (n?: number | null) =>
  !n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('vi-VN')}%`);
/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export const todayVn = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

/** Hiển thị tên lớp rõ ràng, phân biệt với tên khóa học gốc khi trùng tên. */
export function displayClassTitle(cls: { code: string; title: string; course?: { title: string } | null }): string {
  const code = (cls.code || '').trim();
  const title = (cls.title || '').trim();
  if (!code) return title;
  if (!title) return `Lớp ${code}`;
  if (title.toLowerCase().includes(code.toLowerCase())) return title;
  if (cls.course && title === cls.course.title.trim()) {
    return `Lớp ${code} — ${title}`;
  }
  return `Lớp ${code} · ${title}`;
}

export function errMsg(err: unknown): string {
  if (err instanceof ApiHttpError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

// ------------------------------------------------------------------ hooks

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (id === seq.current) setData(d);
      })
      .catch((e) => {
        if (id === seq.current) setError(e instanceof Error ? e : new Error(errMsg(e)));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { data, setData, error, loading, reload: load };
}

/** Cảnh báo khi rời trang nếu còn dữ liệu chưa lưu. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

// ------------------------------------------------------------------ toast

type Toast = { id: number; tone: 'success' | 'error' | 'info'; title: string; detail?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="t-toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`t-toast t-toast--${t.tone}`}>
            <strong>{t.title}</strong>
            {t.detail && <span>{t.detail}</span>}
            <button type="button" className="t-icon-btn" aria-label="Đóng thông báo" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

// ------------------------------------------------------------------ primitives

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
  loading?: boolean;
  small?: boolean;
};
export const Btn: React.FC<BtnProps> = ({ variant = 'secondary', loading, small, className = '', children, disabled, type = 'button', ...rest }) => (
  <button
    type={type}
    className={`t-btn t-btn--${variant}${small ? ' t-btn--small' : ''} ${className}`}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    {loading ? 'Đang xử lý…' : children}
  </button>
);

export const PageHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}> = ({ title, subtitle, actions, breadcrumb }) => (
  <header className="t-page-header">
    <div>
      {breadcrumb && <nav className="t-breadcrumb" aria-label="Vị trí">{breadcrumb}</nav>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="t-actions">{actions}</div>}
  </header>
);

export const Card: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }> = ({
  title,
  actions,
  children,
  className = '',
  padded = true,
}) => (
  <section className={`t-card ${padded ? '' : 't-card--flush'} ${className}`}>
    {(title || actions) && (
      <div className="t-card__head">
        {title && <h2>{title}</h2>}
        {actions && <div className="t-actions">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

export const StatCard: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success' }> = ({
  label,
  value,
  hint,
  tone = 'default',
}) => (
  <div className={`t-stat t-stat--${tone}`}>
    <span className="t-stat__label">{label}</span>
    <strong className="t-stat__value tabular-nums">{value}</strong>
    {hint && <span className="t-stat__hint">{hint}</span>}
  </div>
);

export const Loading: React.FC<{ label?: string; rows?: number }> = ({ label = 'Đang tải dữ liệu…', rows = 3 }) => (
  <div className="t-loading" role="status" aria-live="polite">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="t-skeleton" style={{ width: `${92 - i * 14}%` }} />
    ))}
  </div>
);

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void }> = ({ error, onRetry }) => {
  const forbidden = error instanceof ApiHttpError && (error.status === 403 || error.status === 404);
  return (
    <div className="t-state t-state--error" role="alert">
      <strong>{forbidden ? 'Không thể truy cập' : 'Không tải được dữ liệu'}</strong>
      <p>{errMsg(error)}</p>
      {onRetry && !forbidden && <Btn onClick={onRetry}>Thử lại</Btn>}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="t-state">
    <strong>{title}</strong>
    {text && <p>{text}</p>}
    {action}
  </div>
);

const LABELS: Record<string, Record<string, [string, string]>> = {
  course: {
    DRAFT: ['Bản nháp', 'neutral'],
    PUBLISHED: ['Đã xuất bản', 'success'],
    ARCHIVED: ['Đã lưu trữ', 'muted'],
    INACTIVE: ['Ngừng hoạt động', 'warning'],
  },
  lesson: {
    DRAFT: ['Bản nháp', 'neutral'],
    PUBLISHED: ['Đã xuất bản', 'success'],
    ARCHIVED: ['Đã lưu trữ', 'muted'],
  },
  class: {
    DRAFT: ['Nháp', 'neutral'],
    UPCOMING: ['Sắp diễn ra', 'info'],
    ACTIVE: ['Đang học', 'success'],
    COMPLETED: ['Đã kết thúc', 'muted'],
    CANCELLED: ['Đã hủy', 'danger'],
    ARCHIVED: ['Đã lưu trữ', 'muted'],
  },
  attendanceState: {
    NOT_STARTED: ['Chưa diễn ra', 'neutral'],
    NEEDS_ATTENDANCE: ['Chưa điểm danh', 'warning'],
    SAVED: ['Đã điểm danh', 'success'],
    LOCKED: ['Đã chốt', 'info'],
    CANCELLED: ['Đã hủy', 'danger'],
  },
  attendance: {
    PRESENT: ['Có mặt', 'success'],
    LATE: ['Đi muộn', 'warning'],
    EXCUSED_ABSENCE: ['Vắng có phép', 'info'],
    UNEXCUSED_ABSENCE: ['Vắng', 'danger'],
    NOT_MARKED: ['Chưa điểm danh', 'neutral'],
  },
  log: {
    AWAITING_CONFIRMATION: ['Chờ xác nhận', 'warning'],
    OVERDUE_UNCONFIRMED: ['Quá hạn 24 giờ', 'danger'],
    CONFIRMED: ['Đã xác nhận', 'success'],
    CONFIRMED_LATE: ['Xác nhận muộn', 'info'],
  },
  delivery: {
    OFFLINE: ['Trực tiếp', 'neutral'],
    ONLINE: ['Trực tuyến', 'neutral'],
    HYBRID: ['Kết hợp', 'neutral'],
  },
  staffRole: {
    PRIMARY_INSTRUCTOR: ['Giảng viên chính', 'neutral'],
    CO_INSTRUCTOR: ['Đồng giảng dạy', 'neutral'],
    TEACHING_ASSISTANT: ['Trợ giảng', 'neutral'],
  },
};
export const label = (kind: keyof typeof LABELS | string, value: string | null | undefined) =>
  (value && LABELS[kind]?.[value]?.[0]) || value || '—';

export const Badge: React.FC<{ kind: string; value: string | null | undefined; children?: React.ReactNode }> = ({ kind, value, children }) => {
  const entry = value ? LABELS[kind]?.[value] : undefined;
  return <span className={`t-badge t-badge--${entry ? entry[1] : 'neutral'}`}>{children ?? (entry ? entry[0] : value || '—')}</span>;
};

export const Tone: React.FC<{ tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted'; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`t-badge t-badge--${tone}`}>{children}</span>
);

export const Field: React.FC<{ label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; wide?: boolean }> = ({
  label: text,
  hint,
  error,
  required,
  children,
  wide,
}) => (
  <label className={`t-field${wide ? ' t-field--wide' : ''}`}>
    <span className="t-field__label">
      {text}
      {required && <span aria-hidden="true"> *</span>}
    </span>
    {children}
    {hint && !error && <span className="t-field__hint">{hint}</span>}
    {error && <span className="t-field__error" role="alert">{error}</span>}
  </label>
);

export const Tabs: React.FC<{ tabs: Array<{ id: string; label: string; badge?: React.ReactNode }>; active: string; onChange: (id: string) => void }> = ({
  tabs,
  active,
  onChange,
}) => (
  <div className="t-tabs" role="tablist">
    {tabs.map((t) => (
      <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className="t-tab" onClick={() => onChange(t.id)}>
        {t.label}
        {t.badge !== undefined && t.badge !== null && <span className="t-tab__badge tabular-nums">{t.badge}</span>}
      </button>
    ))}
  </div>
);

export const Pagination: React.FC<{ page: number; pageSize: number; total: number; onChange: (p: number) => void }> = ({ page, pageSize, total, onChange }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="t-pagination" aria-label="Phân trang">
      <Btn small onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ‹ Trước
      </Btn>
      <span className="tabular-nums">
        Trang {page}/{pages} · {total} mục
      </span>
      <Btn small onClick={() => onChange(page + 1)} disabled={page >= pages}>
        Sau ›
      </Btn>
    </nav>
  );
};

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}> = ({ title, onClose, children, footer, width = 640 }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.t-modal__close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="t-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="t-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={ref}>
        <div className="t-modal__head">
          <h2>{title}</h2>
          <button type="button" className="t-icon-btn t-modal__close" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="t-modal__body">{children}</div>
        {footer && <div className="t-modal__foot">{footer}</div>}
      </div>
    </div>
  );
};

/** Hộp xác nhận; có thể yêu cầu nhập lý do. */
export const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel = 'Xác nhận', danger, reasonLabel, reasonRequired, onConfirm, onCancel }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (reasonRequired && !reason.trim()) {
      setError('Vui lòng nhập lý do.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={480}
      footer={
        <>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>
            Hủy
          </Btn>
          <Btn variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="t-confirm-text">{message}</div>
      {reasonLabel && (
        <Field label={reasonLabel} required={reasonRequired}>
          <textarea className="t-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
      )}
      {error && <p className="t-field__error" role="alert">{error}</p>}
    </Modal>
  );
};

export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; label?: string }> = ({ value, onChange, placeholder, label: aria }) => (
  <input type="search" className="t-input t-input--search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={aria || placeholder} />
);

/** Giá trị trì hoãn (debounce) để không gọi API liên tục khi gõ. */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const ProgressMeter: React.FC<{ value: number; total?: number; label?: string }> = ({ value, total, label: text }) => {
  const pct = total ? Math.round((value / Math.max(1, total)) * 100) : Math.round(value);
  return (
    <div className="t-meter" title={text}>
      <div className="t-meter__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={text}>
        <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="tabular-nums">{total !== undefined ? `${value}/${total}` : `${pct}%`}</span>
    </div>
  );
};

// ------------------------------------------------------------------ SmartImage & ImageUrlInput

export interface SmartImageProps {
  src?: string | null;
  extraCandidates?: string[];
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  fallback?: React.ReactNode;
  onResolvedUrl?: (resolvedUrl: string) => void;
  onLoadStatusChange?: (status: 'idle' | 'loaded' | 'error') => void;
}

/**
 * Hiển thị hình ảnh an toàn từ link bất kỳ (tự bóc link Bing/Google/Drive/Dropbox,
 * gửi `referrerPolicy="no-referrer"` chống chặn hotlink và tự chuyển sang nguồn dự phòng hoặc fallback sạch khi lỗi).
 */
export const SmartImage: React.FC<SmartImageProps> = ({
  src,
  extraCandidates,
  alt = '',
  className,
  style,
  fallback = null,
  onResolvedUrl,
  onLoadStatusChange,
}) => {
  const candidates = useMemo(() => {
    const base = extractImageUrlCandidates(src);
    if (!extraCandidates || extraCandidates.length === 0) return base;
    const merged = [...base];
    for (const c of extraCandidates) {
      if (c && !merged.includes(c)) merged.push(c);
    }
    return merged;
  }, [src, extraCandidates]);

  const candidatesKey = candidates.join('\n');
  const [runtime, setRuntime] = useState<{ key: string; idx: number; failed: boolean }>({
    key: candidatesKey,
    idx: 0,
    failed: false,
  });

  const effective =
    runtime.key === candidatesKey ? runtime : { key: candidatesKey, idx: 0, failed: false };

  if (candidates.length === 0 || effective.failed) {
    return <>{fallback}</>;
  }

  const activeUrl = candidates[effective.idx] || candidates[0];

  return (
    <img
      src={activeUrl}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => {
        onLoadStatusChange?.('loaded');
        if (activeUrl && src && activeUrl !== src.trim()) {
          onResolvedUrl?.(activeUrl);
        }
      }}
      onError={() => {
        if (effective.idx + 1 < candidates.length) {
          setRuntime({ key: candidatesKey, idx: effective.idx + 1, failed: false });
        } else {
          setRuntime({ key: candidatesKey, idx: effective.idx, failed: true });
          onLoadStatusChange?.('error');
        }
      }}
    />
  );
};

/** Nén & thu gọn ảnh chọn từ máy sang Data URL an toàn (tối đa 1280×800) để hiển thị tức thì. */
async function fileToOptimizedImageDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
    throw new Error('Chỉ hỗ trợ tệp hình ảnh PNG, JPEG, WebP hoặc GIF.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Ảnh quá lớn (tối đa 8 MB). Vui lòng chọn ảnh nhẹ hơn.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp hình ảnh.'));
    reader.readAsDataURL(file);
  });

  // Giữ nguyên ảnh GIF động hoặc ảnh nhỏ dưới 140 KB
  if ((file.type === 'image/gif' && file.size <= 700 * 1024) || rawDataUrl.length <= 180_000) {
    if (!isSafeImageDataUrl(rawDataUrl)) {
      throw new Error('Định dạng dữ liệu ảnh không hợp lệ.');
    }
    return rawDataUrl;
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      const maxH = 800;
      let w = img.naturalWidth || maxW;
      let h = img.naturalHeight || maxH;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/jpeg', 0.84);
      if (out.length > 1_450_000) {
        const smaller = canvas.toDataURL('image/jpeg', 0.68);
        resolve(smaller);
      } else {
        resolve(out);
      }
    };
    img.onerror = () => reject(new Error('Tệp hình ảnh bị hỏng hoặc không đọc được.'));
    img.src = rawDataUrl;
  });
}

function shouldImmediateUnwrap(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.startsWith('<img') || s.startsWith('![')) return true;
  return /(?:bing\.com\/images\/|google\.[a-z.]+\/(?:imgres|url)|drive\.google\.com\/|dropbox\.com\/|github\.com\/[^/]+\/[^/]+\/blob\/|imgur\.com\/[A-Za-z0-9]+$)/i.test(
    s
  );
}

export interface ImageUrlInputProps {
  value: string;
  onChange: (nextUrl: string) => void;
  disabled?: boolean;
  placeholder?: string;
  variant?: 'cover' | 'content';
  allowFileUpload?: boolean;
  ariaLabel?: string;
}

/**
 * Ô nhập đường dẫn ảnh thông minh kèm xem trước trực tiếp:
 *  - Tự bóc link ảnh gốc khi dán từ Bing Images, Google Images, Google Drive, Dropbox, GitHub, Imgur, `<img src>`.
 *  - Tự chuyển sang link dự phòng (như CDN ảnh gốc của Bing) nếu nguồn chính chặn nhúng ngoài.
 *  - Hỗ trợ chọn ảnh trực tiếp từ máy tính.
 */
export const ImageUrlInput: React.FC<ImageUrlInputProps> = ({
  value,
  onChange,
  disabled = false,
  placeholder = 'Dán đường dẫn ảnh (https://..., Google/Bing Images, Drive) hoặc chọn ảnh từ máy',
  variant = 'cover',
  allowFileUpload = true,
  ariaLabel,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [extraCandidates, setExtraCandidates] = useState<string[]>([]);
  const [unwrappedNotice, setUnwrappedNotice] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loaded' | 'error'>('idle');

  const isData = value.startsWith('data:image/');

  const applyRawInput = (raw: string, forceNormalize: boolean) => {
    setFileError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setExtraCandidates([]);
      setUnwrappedNotice(null);
      setLoadState('idle');
      onChange('');
      return;
    }

    if (forceNormalize || shouldImmediateUnwrap(trimmed)) {
      const res = normalizeImageUrl(trimmed, { upgradeHttp: true });
      if (res.ok) {
        setExtraCandidates(res.candidates.slice(1));
        if (res.unwrapped && res.url !== trimmed) {
          setUnwrappedNotice('Đã tự động trích xuất đường dẫn ảnh trực tiếp từ liên kết bạn dán.');
        } else {
          setUnwrappedNotice(null);
        }
        setLoadState('idle');
        onChange(res.url);
        return;
      }
    }

    setExtraCandidates([]);
    setUnwrappedNotice(null);
    setLoadState('idle');
    onChange(raw);
  };

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    setUnwrappedNotice(null);
    try {
      const dataUrl = await fileToOptimizedImageDataUrl(file);
      setExtraCandidates([]);
      setLoadState('loaded');
      onChange(dataUrl);
    } catch (err) {
      setFileError(errMsg(err));
    }
  };

  return (
    <div className="t-img-picker">
      <div className="t-img-picker__row">
        <input
          className="t-input"
          value={isData ? 'Ảnh đã tải lên từ máy tính' : value}
          readOnly={isData}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e) => {
            if (!isData) applyRawInput(e.target.value, false);
          }}
          onBlur={() => {
            if (!isData && value.trim()) applyRawInput(value, true);
          }}
        />
        {allowFileUpload && !disabled && (
          <Btn onClick={() => fileRef.current?.click()}>
            Chọn ảnh từ máy
          </Btn>
        )}
        {value && !disabled && (
          <Btn
            variant="ghost"
            onClick={() => {
              setExtraCandidates([]);
              setUnwrappedNotice(null);
              setFileError(null);
              setLoadState('idle');
              onChange('');
            }}
          >
            Xóa ảnh
          </Btn>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          disabled={disabled}
          onChange={handlePickFile}
        />
      </div>

      {unwrappedNotice && <span className="t-img-picker__note">{unwrappedNotice}</span>}
      {fileError && (
        <span className="t-field__error" role="alert">
          {fileError}
        </span>
      )}

      {value.trim() && (
        <div className={`t-img-preview${variant === 'content' ? ' t-img-preview--content' : ''}`}>
          <SmartImage
            src={value}
            extraCandidates={extraCandidates}
            alt="Xem trước hình ảnh"
            onLoadStatusChange={setLoadState}
            onResolvedUrl={(resolved) => {
              if (!disabled && resolved && resolved !== value) {
                onChange(resolved);
              }
            }}
            fallback={
              <div className="t-img-preview__broken" role="alert">
                Không tải được hình ảnh từ đường dẫn này ({loadState === 'error' ? 'nguồn không phải tệp ảnh hoặc chặn truy cập' : 'đường dẫn không hợp lệ'}). Hãy nhấp chuột phải vào ảnh chọn &ldquo;Sao chép địa chỉ hình ảnh&rdquo; hoặc bấm &ldquo;Chọn ảnh từ máy&rdquo;.
              </div>
            }
          />
        </div>
      )}
    </div>
  );
};
