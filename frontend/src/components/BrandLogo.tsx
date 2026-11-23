import React from 'react';

export interface BrandLogoProps {
  /** Emblem size in px (default 40). */
  size?: number;
  /** Emblem shape: primary circular badge or rounded-square app icon. */
  variant?: 'circle' | 'rounded';
  /** Color tone: 'default' on light/dark canvas, 'inverted' on brand-colored panel. */
  tone?: 'default' | 'inverted';
  /** Wordmark font size in px (default 22). */
  wordmarkSize?: number;
  /** Optional tagline ("Mỗi ngày tiến thêm một bậc"). */
  showTagline?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 40,
  variant = 'circle',
  tone = 'default',
  wordmarkSize = 22,
  showTagline = false,
}) => {
  const isInverted = tone === 'inverted';
  const bgFill = isInverted ? 'var(--text-on-brand)' : 'var(--brand-primary)';
  const fgFill = isInverted ? 'var(--brand-primary)' : 'var(--text-on-brand)';
  const titleColor = isInverted ? 'var(--text-on-brand)' : 'var(--text-primary)';
  const taglineColor = isInverted ? 'var(--text-on-brand)' : 'var(--text-secondary)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showTagline ? '12px' : '10px',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'block' }}
      >
        {variant === 'rounded' ? (
          <rect width="120" height="120" rx="30" fill={bgFill} />
        ) : (
          <circle cx="60" cy="60" r="60" fill={bgFill} />
        )}
        <rect x="28" y="70" width="16" height="24" rx="8" fill={fgFill} fillOpacity={0.6} />
        <rect x="52" y="54" width="16" height="40" rx="8" fill={fgFill} fillOpacity={0.8} />
        <rect x="76" y="38" width="16" height="56" rx="8" fill={fgFill} />
        <circle cx="84" cy="24" r="6" fill={fgFill} />
      </svg>

      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <strong
          style={{
            fontSize: `${wordmarkSize}px`,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            color: titleColor,
          }}
        >
          lms
        </strong>
        {showTagline && (
          <span
            style={{
              marginTop: '4px',
              fontSize: '12px',
              fontWeight: 500,
              lineHeight: 1.2,
              color: taglineColor,
              opacity: isInverted ? 0.9 : 1,
            }}
          >
            Mỗi ngày tiến thêm một bậc
          </span>
        )}
      </span>
    </span>
  );
};

export default BrandLogo;
