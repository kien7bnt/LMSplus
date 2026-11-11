import React from 'react';
import { TAPermissionFlags, ThemeMode, UserRole } from '../../types/elearning';

/**
 * 1. BUTTON PRIMITIVE (44x44px min touch target, Airbnb DLS easing)
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'subtle' | 'danger' | 'learning' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  style,
  disabled,
  ...rest
}) => {
  // Enforce >= 44px touch target height across interactive buttons per AGENTS.md
  const heights = { sm: '44px', md: '44px', lg: '48px' };
  const paddings = { sm: '0 16px', md: '0 20px', lg: '0 24px' };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--brand-primary)',
      color: 'var(--text-on-brand)',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-card)',
    },
    learning: {
      backgroundColor: 'var(--accent-learning)',
      color: 'var(--text-on-brand)',
      border: '1px solid transparent',
    },
    secondary: {
      backgroundColor: 'var(--bg-surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--text-primary)',
    },
    subtle: {
      backgroundColor: 'var(--bg-surface-subtle)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
    },
    danger: {
      backgroundColor: 'var(--status-danger)',
      color: 'var(--text-on-brand)',
      border: '1px solid transparent',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-subtle)',
    },
  };

  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        minHeight: heights[size],
        padding: paddings[size],
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-sans)',
        fontSize: size === 'sm' ? '13px' : '14px',
        fontWeight: 600,
        cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        opacity: disabled || isLoading ? 0.6 : 1,
        transition:
          'background-color 150ms var(--ease-standard), transform 150ms var(--ease-standard), box-shadow 150ms var(--ease-standard)',
        whiteSpace: 'nowrap',
        ...variantStyles[variant],
        ...style,
      }}
      {...rest}
    >
      {isLoading ? 'Đang xử lý...' : children}
    </button>
  );
};

/**
 * 2. SEMANTIC BADGE PRIMITIVE (Color + Dot/Symbol for accessibility)
 */
interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'learning' | 'streak';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', children }) => {
  const toneMap: Record<string, { bg: string; color: string; border: string }> = {
    neutral: {
      bg: 'var(--bg-surface-subtle)',
      color: 'var(--text-secondary)',
      border: 'var(--border-strong)',
    },
    success: {
      bg: 'var(--accent-learning-tint)',
      color: 'var(--status-success)',
      border: 'var(--accent-learning)',
    },
    warning: {
      bg: 'var(--accent-streak-tint)',
      color: 'var(--status-warning)',
      border: 'var(--accent-streak)',
    },
    danger: {
      bg: 'var(--brand-tint)',
      color: 'var(--status-danger)',
      border: 'var(--brand-primary)',
    },
    learning: {
      bg: 'var(--accent-learning-tint)',
      color: 'var(--accent-learning)',
      border: 'var(--accent-learning)',
    },
    streak: {
      bg: 'var(--accent-streak-tint)',
      color: 'var(--accent-streak)',
      border: 'var(--accent-streak)',
    },
  };

  const selected = toneMap[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 12px',
        borderRadius: 'var(--radius-pill)',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: selected.bg,
        color: selected.color,
        border: `1px solid ${selected.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

/**
 * 3. SURFACE PANEL CARD (No cards-in-cards, 16px radius, 1px hairline border)
 */
export const SurfacePanel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6)',
      boxShadow: 'var(--shadow-card)',
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * 4. PROGRESS BAR PRIMITIVE (Tabular Numerals + Babu Teal Learning Fill)
 */
export const ProgressBar: React.FC<{
  percent: number;
  label?: string;
  height?: string;
}> = ({ percent, label, height = '8px' }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            marginBottom: '6px',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
          <strong className="tabular-nums" style={{ color: 'var(--accent-learning)' }}>
            {clamped}%
          </strong>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: '100%',
          height,
          backgroundColor: 'var(--bg-surface-subtle)',
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            backgroundColor: 'var(--accent-learning)',
            borderRadius: 'var(--radius-pill)',
            transition: 'width 220ms var(--ease-standard)',
          }}
        />
      </div>
    </div>
  );
};

/**
 * 5. INTERACTIVE STEP-BY-STEP OPERATION GUIDE BANNER
 * Helps users clearly see what actions are available on the current screen and how RBAC affects them.
 */
export const InteractiveGuideBanner: React.FC<{
  screenCode: string;
  title: string;
  steps: string[];
}> = ({ screenCode, title, steps }) => (
  <div
    style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      padding: '16px 20px',
      marginBottom: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      boxShadow: 'var(--shadow-card)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <Badge tone="learning">HƯỚNG DẪN THAO TÁC TRỰC QUAN • {screenCode}</Badge>
      <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{title}</strong>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '2px' }}>
      {steps.map((step, idx) => (
        <div
          key={idx}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--bg-surface-subtle)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <span
            className="tabular-nums"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-on-brand)',
              fontSize: '11px',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {idx + 1}
          </span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  </div>
);

/**
 * 6. LIVE FEEDBACK TOAST BANNER
 */
export const ToastNotification: React.FC<{
  message: string | null;
  detail?: string;
  onClose: () => void;
}> = ({ message, detail, onClose }) => {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 100,
        maxWidth: 'min(440px, calc(100vw - 32px))',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        border: '1px solid var(--accent-learning)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        boxShadow: 'var(--shadow-floating)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '12px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-learning)', marginBottom: '4px' }}>
          ✔ THAO TÁC ĐÃ THỰC THI
        </div>
        <strong style={{ fontSize: '14px', display: 'block' }}>{message}</strong>
        {detail && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {detail}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Đóng thông báo"
        onClick={onClose}
        style={{
          minWidth: '44px',
          minHeight: '44px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface-subtle)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontWeight: 700,
        }}
      >
        ✕
      </button>
    </div>
  );
};

/**
 * 7. PERMISSION-BASED UI GUARD (`RBAC + Scope + TA Permission Flags`)
 */
interface ScopePermissionGuardProps {
  currentRole: UserRole;
  allowedRoles: UserRole[];
  taFlags?: TAPermissionFlags;
  requiredTaFlag?: keyof TAPermissionFlags;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const ScopePermissionGuard: React.FC<ScopePermissionGuardProps> = ({
  currentRole,
  allowedRoles,
  taFlags,
  requiredTaFlag,
  fallback = null,
  children,
}) => {
  if (!allowedRoles.includes(currentRole)) {
    return <>{fallback}</>;
  }
  if (currentRole === 'TEACHING_ASSISTANT' && requiredTaFlag && taFlags) {
    if (!taFlags[requiredTaFlag]) {
      return <>{fallback}</>;
    }
  }
  return <>{children}</>;
};

/**
 * 8. THEME SWITCHER (`airbnb-light` | `cinema-dark` | `babu-academy`)
 */
export const ThemeSwitcher: React.FC<{
  theme: ThemeMode;
  onChange: (next: ThemeMode) => void;
}> = ({ theme, onChange }) => {
  const options: Array<{ id: ThemeMode; label: string }> = [
    { id: 'airbnb-light', label: '☀ Daylight' },
    { id: 'cinema-dark', label: '🌙 Cinema Dark' },
    { id: 'babu-academy', label: '🎓 Babu Teal' },
  ];

  return (
    <div
      role="group"
      aria-label="Chế độ giao diện"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        maxWidth: '100%',
        gap: '4px',
        padding: '4px',
        backgroundColor: 'var(--bg-surface-subtle)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {options.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            style={{
              flex: '1 1 auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '44px',
              padding: '0 12px',
              borderRadius: 'var(--radius-md)',
              border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
              backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              boxShadow: active ? 'var(--shadow-card)' : 'none',
              transition: 'all 150ms var(--ease-standard)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
