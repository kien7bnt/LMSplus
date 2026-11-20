import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className: className ? `ls-svg ${className}` : 'ls-svg',
});

export const IconArrowLeft: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

export const IconSidebarLeft: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

export const IconSidebarRight: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);

export const IconUndo: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export const IconRedo: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </svg>
);

export const IconEye: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconTools: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h10" />
  </svg>
);

export const IconHistory: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconDatabase: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);

export const IconLibrary: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  </svg>
);

export const IconMoreHorizontal: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChevronDown: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconChevronRight: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const IconChevronUp: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

export const IconArrowUp: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

export const IconArrowDown: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14" />
    <path d="M19 12l-7 7-7-7" />
  </svg>
);

export const IconGripVertical: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size, className)}>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCopy: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconTrash: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export const IconEdit: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const IconPlus: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const IconX: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

export const IconCheck: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const IconAlertTriangle: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconUpload: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

export const IconPlay: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

export const IconPause: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const IconRotateCcw: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const IconVolume2: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

export const IconVolumeX: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M22 9l-6 6" />
    <path d="M16 9l6 6" />
  </svg>
);

export const IconGlobe: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </svg>
);

export const IconMonitor: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </svg>
);

export const IconSmartphone: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M12 18h.01" />
  </svg>
);

export const IconSliders: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...base(size, className)}>
    <path d="M4 21v-7" />
    <path d="M4 10V3" />
    <path d="M12 21v-9" />
    <path d="M12 8V3" />
    <path d="M20 21v-5" />
    <path d="M20 12V3" />
    <path d="M2 14h4" />
    <path d="M10 8h4" />
    <path d="M18 16h4" />
  </svg>
);

export const BlockTypeIcon: React.FC<{ type: string; size?: number }> = ({ type, size = 16 }) => {
  switch (type) {
    case 'heading':
      return (
        <svg {...base(size)}>
          <path d="M6 4v16" />
          <path d="M18 4v16" />
          <path d="M6 12h12" />
        </svg>
      );
    case 'paragraph':
      return (
        <svg {...base(size)}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h10" />
        </svg>
      );
    case 'callout':
      return (
        <svg {...base(size)}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      );
    case 'quote':
      return (
        <svg {...base(size)}>
          <path d="M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3v6c0 3-1 5-4 6" />
          <path d="M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3v6c0 3-1 5-4 6" />
        </svg>
      );
    case 'table':
      return (
        <svg {...base(size)}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M9 4v16" />
        </svg>
      );
    case 'math':
      return (
        <svg {...base(size)}>
          <path d="M18 5H7l6 7-6 7h11" />
        </svg>
      );
    case 'code':
    case 'code_block':
      return (
        <svg {...base(size)}>
          <path d="M8 9l-4 3 4 3" />
          <path d="M16 9l4 3-4 3" />
          <path d="M13 6l-2 12" />
        </svg>
      );
    case 'video':
    case 'youtube':
      return (
        <svg {...base(size)}>
          <rect x="2" y="5" width="20" height="14" rx="2.5" />
          <polygon points="10 9 16 12 10 15 10 9" />
        </svg>
      );
    case 'pdf':
      return (
        <svg {...base(size)}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      );
    case 'image':
      return (
        <svg {...base(size)}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M21 15l-5-5L5 20" />
        </svg>
      );
    case 'file':
      return (
        <svg {...base(size)}>
          <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case 'link':
      return (
        <svg {...base(size)}>
          <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L11.4 4.5" />
          <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.4-1.4" />
        </svg>
      );
    case 'embed':
      return (
        <svg {...base(size)}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
      );
    case 'quiz':
    case 'review_question':
    case 'inline_mcq':
      return (
        <svg {...base(size)}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 12l2.5 2.5L16 9" />
        </svg>
      );
    case 'assignment':
    case 'assignment_link':
    default:
      return (
        <svg {...base(size)}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </svg>
      );
  }
};
