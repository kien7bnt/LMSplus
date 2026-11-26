import React from 'react';

export type NavIconKey =
  | 'dashboard'
  | 'courses'
  | 'curricula'
  | 'cohorts'
  | 'classes'
  | 'schedule'
  | 'timetable'
  | 'banks'
  | 'leave'
  | 'assessment'
  | 'hours'
  | 'departments'
  | 'accounts'
  | 'learn';

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className?: string): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  className,
  style: { flexShrink: 0, display: 'inline-block' },
});

export const NavIcon: React.FC<{ name: NavIconKey; size?: number }> = ({ name, size = 18 }) => {
  const p = baseProps(size);
  switch (name) {
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="9" rx="2" />
          <rect x="14" y="3" width="7" height="5" rx="2" />
          <rect x="14" y="12" width="7" height="9" rx="2" />
          <rect x="3" y="16" width="7" height="5" rx="2" />
        </svg>
      );
    case 'courses':
      return (
        <svg {...p}>
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <path d="M8 7h8" />
          <path d="M8 11h6" />
        </svg>
      );
    case 'curricula':
      return (
        <svg {...p}>
          <path d="M3 6h18" />
          <path d="M7 12h14" />
          <path d="M11 18h10" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="8" cy="18" r="1" />
        </svg>
      );
    case 'cohorts':
      return (
        <svg {...p}>
          <path d="M22 10 12 5 2 10l10 5 10-5Z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
        </svg>
      );
    case 'classes':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </svg>
      );
    case 'schedule':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
      );
    case 'timetable':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 4v17" />
          <path d="M15 4v17" />
        </svg>
      );
    case 'banks':
      return (
        <svg {...p}>
          <path d="M20 7h-9l-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
          <path d="M10 13h4" />
        </svg>
      );
    case 'leave':
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
          <path d="m9 15 2 2 4-4" />
        </svg>
      );
    case 'assessment':
      return (
        <svg {...p}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case 'hours':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case 'departments':
      return (
        <svg {...p}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M9 21v-4h6v4" />
          <path d="M8 7h2" />
          <path d="M14 7h2" />
          <path d="M8 11h2" />
          <path d="M14 11h2" />
        </svg>
      );
    case 'accounts':
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'learn':
    default:
      return (
        <svg {...p}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
  }
};

export const IconCheck: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}><path d="M20 6 9 17l-5-5" /></svg>
);

export const IconX: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);

export const IconTrash: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const IconVideo: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
);

export const IconChart: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

export const IconSun: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

export const IconMoon: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

export const IconGraduation: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M22 10 12 5 2 10l10 5 10-5Z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </svg>
);

export const IconBolt: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const IconDownload: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const IconLock: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const IconCalendar: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h18" />
  </svg>
);

export const IconSparkles: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
);

export const IconPin: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
  </svg>
);

export const IconFile: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

export const IconLink: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const IconClipboard: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </svg>
);

export const IconPuzzle: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
  </svg>
);

export const IconRocket: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

export const IconSend: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconHelpCircle: React.FC<IconProps> = ({ size = 19, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconBell: React.FC<IconProps> = ({ size = 19, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const IconChevronDown: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconChevronRight: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconMenu: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);

export const IconLogOut: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const IconKeyboard: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M6 8h.01" />
    <path d="M10 8h.01" />
    <path d="M14 8h.01" />
    <path d="M18 8h.01" />
    <path d="M8 12h.01" />
    <path d="M12 12h.01" />
    <path d="M16 12h.01" />
    <path d="M7 16h10" />
  </svg>
);

export const IconShield: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
