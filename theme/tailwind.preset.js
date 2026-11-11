/**
 * ============================================================================
 * LMS E-LEARNING — TAILWIND CSS PRESET
 * Maps 3-Tier Semantic Tokens (Airbnb DLS + Impeccable + UI/UX Pro Max)
 * Usage in tailwind.config.js:
 *   presets: [require('./theme/tailwind.preset.js')]
 * ============================================================================
 */

module.exports = {
  darkMode: ['class', '[data-theme="cinema-dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: {
          DEFAULT: 'var(--bg-surface)',
          subtle: 'var(--bg-surface-subtle)',
          hover: 'var(--bg-surface-hover)',
        },
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          onBrand: 'var(--text-on-brand)',
        },
        line: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        brand: {
          DEFAULT: 'var(--brand-primary)',
          hover: 'var(--brand-primary-hover)',
          tint: 'var(--brand-tint)',
        },
        learning: {
          DEFAULT: 'var(--accent-learning)',
          tint: 'var(--accent-learning-tint)',
        },
        streak: {
          DEFAULT: 'var(--accent-streak)',
          tint: 'var(--accent-streak-tint)',
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          danger: 'var(--status-danger)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        display: ['var(--text-display)', { lineHeight: '1.12', letterSpacing: '-0.025em', fontWeight: '700' }],
        h1: ['var(--text-h1)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        h2: ['var(--text-h2)', { lineHeight: '1.28', letterSpacing: '-0.015em', fontWeight: '600' }],
        h3: ['var(--text-h3)', { lineHeight: '1.35', letterSpacing: '-0.01em', fontWeight: '600' }],
        'card-title': ['var(--text-card-title)', { lineHeight: '1.35', fontWeight: '600' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        card: 'var(--radius-lg)',
        modal: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        airbnb: 'var(--shadow-card)',
        'airbnb-hover': 'var(--shadow-card-hover)',
        floating: 'var(--shadow-floating)',
      },
      transitionTimingFunction: {
        airbnb: 'var(--ease-standard)',
        'out-expo': 'var(--ease-out-expo)',
      },
    },
  },
};
