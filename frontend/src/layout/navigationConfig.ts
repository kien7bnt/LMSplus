import { NavIconKey } from '../teaching/components/Icons';
import { UserRole } from '../types/elearning';

export interface NavChildItem {
  id: string;
  to: string;
  label: string;
  keywords?: string[];
  allowedRoles?: UserRole[];
}

export interface NavItemConfig {
  id: string;
  to: string;
  label: string;
  icon: NavIconKey;
  end?: boolean;
  keywords?: string[];
  allowedRoles?: UserRole[];
  children?: NavChildItem[];
}

export interface NavGroupConfig {
  id: string;
  title: string;
  allowedRoles?: UserRole[];
  items: NavItemConfig[];
}

export interface SearchableActionItem {
  id: string;
  to: string;
  label: string;
  groupTitle: string;
  icon: NavIconKey;
  keywords: string[];
}

export interface BreadcrumbCrumb {
  label: string;
  to?: string;
}

const TEACHING_ROLES: UserRole[] = [
  'ADMIN',
  'SUPER_ADMIN',
  'ACADEMIC_STAFF',
  'HEAD_OF_DEPARTMENT',
  'INSTRUCTOR',
  'TEACHING_ASSISTANT',
];
const GOVERNANCE_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN', 'ACADEMIC_STAFF', 'HEAD_OF_DEPARTMENT'];
const LEAVE_REVIEW_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN', 'ACADEMIC_STAFF', 'HEAD_OF_DEPARTMENT', 'INSTRUCTOR'];
const QUOTA_ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN', 'ACADEMIC_STAFF'];

/**
 * Cấu hình menu tập trung — 100% đối chiếu trực tiếp với Router và API thật của LMSPLUS.
 * Không tạo menu giả hay liên kết ngoài hệ thống RBAC hiện có.
 */
export const TEACHING_NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'overview',
    title: 'Tổng quan',
    allowedRoles: TEACHING_ROLES,
    items: [
      {
        id: 'teaching-dashboard',
        to: '/teaching',
        label: 'Tổng quan',
        icon: 'dashboard',
        end: true,
        keywords: ['dashboard', 'bang dieu khien', 'thong ke', 'hom nay', 'tong quan'],
      },
      {
        id: 'teaching-schedule',
        to: '/teaching/schedule',
        label: 'Lịch & Thời khóa biểu',
        icon: 'schedule',
        keywords: ['lich giang day', 'thoi khoa bieu', 'lich day', 'schedule', 'phong hoc'],
      },
    ],
  },
  {
    id: 'organization',
    title: 'Tổ chức đào tạo',
    allowedRoles: TEACHING_ROLES,
    items: [
      {
        id: 'admin-departments',
        to: '/admin/departments',
        label: 'Khoa & Bộ môn',
        icon: 'departments',
        allowedRoles: GOVERNANCE_ROLES,
        keywords: ['khoa', 'bo mon', 'don vi', 'truong bo mon', 'departments'],
      },
      {
        id: 'teaching-courses',
        to: '/teaching/courses',
        label: 'Môn học & Giáo trình',
        icon: 'courses',
        keywords: ['mon hoc', 'giao trinh', 'de cuong', 'lesson studio', 'courses', 'khoa hoc'],
      },
      {
        id: 'teaching-curricula',
        to: '/teaching/curricula',
        label: 'Khung chương trình',
        icon: 'curricula',
        allowedRoles: GOVERNANCE_ROLES,
        keywords: ['khung chuong trinh', 'hoc phi', 'curricula', 'nien khoa'],
      },
      {
        id: 'teaching-cohorts',
        to: '/teaching/cohorts',
        label: 'Lớp khóa học',
        icon: 'cohorts',
        allowedRoles: GOVERNANCE_ROLES,
        keywords: ['lop khoa hoc', 'khoa hoc', 'cohorts', 'nien khoa', 'tuyen sinh'],
      },
      {
        id: 'teaching-classes',
        to: '/teaching/classes',
        label: 'Lớp môn học',
        icon: 'classes',
        keywords: ['lop mon hoc', 'diem danh', 'hoc vien', 'phong truc tuyen', 'zoom', 'meet', 'classes'],
      },
    ],
  },
  {
    id: 'teaching-eval',
    title: 'Giảng dạy & Đánh giá',
    allowedRoles: TEACHING_ROLES,
    items: [
      {
        id: 'teaching-timetable',
        to: '/teaching/timetable',
        label: 'Điều phối thời khóa biểu',
        icon: 'timetable',
        allowedRoles: GOVERNANCE_ROLES,
        keywords: ['xep lich', 'thoi khoa bieu', 'co so', 'phong hoc', 'ngay le', 'timetable'],
        children: [
          {
            id: 'teaching-timetable-board',
            to: '/teaching/timetable?tab=board',
            label: 'Bảng xếp lịch',
            keywords: ['keo tha', 'xep tu dong', 'xung dot', 'cong bo tkb'],
          },
          {
            id: 'teaching-timetable-facilities',
            to: '/teaching/timetable?tab=facilities',
            label: 'Cơ sở, Phòng & Lịch bận',
            keywords: ['co so', 'phong hoc', 'ngay nghi le', 'lich ban giang vien'],
          },
        ],
      },
      {
        id: 'teaching-banks',
        to: '/teaching/banks',
        label: 'Ngân hàng học liệu',
        icon: 'banks',
        keywords: ['ngan hang cau hoi', 'bai tap', 'tai nguyen', 'hoc lieu', 'import json csv', 'banks'],
        children: [
          {
            id: 'teaching-banks-questions',
            to: '/teaching/banks?tab=questions',
            label: 'Ngân hàng câu hỏi',
            keywords: ['cau hoi', 'trac nghiem', 'tu luan', 'import'],
          },
          {
            id: 'teaching-banks-assignments',
            to: '/teaching/banks?tab=assignments',
            label: 'Ngân hàng bài tập',
            keywords: ['bai tap', 'rubric', 'tu luan'],
          },
          {
            id: 'teaching-banks-resources',
            to: '/teaching/banks?tab=resources',
            label: 'Ngân hàng tài nguyên',
            keywords: ['video', 'pdf', 'tai lieu', 'slide'],
          },
        ],
      },
      {
        id: 'teaching-assessment',
        to: '/teaching/classes?focus=assessment',
        label: 'Kiểm tra, Bài tập & Điểm',
        icon: 'assessment',
        keywords: ['bai kiem tra', 'de thi', 'bai tap', 'bang diem', 'rubric', 'phuc khao', 'exam', 'gradebook'],
      },
      {
        id: 'teaching-leave',
        to: '/teaching/leave-requests',
        label: 'Duyệt đơn xin nghỉ',
        icon: 'leave',
        allowedRoles: LEAVE_REVIEW_ROLES,
        keywords: ['don xin nghi', 'phep', 'vang co phep', 'leave'],
      },
      {
        id: 'teaching-hours',
        to: '/teaching/hours',
        label: 'Giờ dạy & Định mức',
        icon: 'hours',
        keywords: ['gio day', 'dinh muc', 'bang cong', 'tai chinh', 'timesheets'],
        children: [
          {
            id: 'teaching-hours-analytics',
            to: '/teaching/hours?tab=analytics',
            label: 'Thống kê giờ dạy',
            keywords: ['buoi day thuc te', 'day thay', 'thong ke'],
          },
          {
            id: 'teaching-hours-timesheets',
            to: '/teaching/hours?tab=timesheets',
            label: 'Chốt bảng giờ giảng',
            keywords: ['bang cong thang', 'xuat csv tai chinh', 'khoa so'],
          },
          {
            id: 'teaching-hours-quotas',
            to: '/teaching/hours?tab=quotas',
            label: 'Định mức giờ giảng',
            allowedRoles: QUOTA_ADMIN_ROLES,
            keywords: ['dinh muc', 'so phut mot tiet', 'quota'],
          },
        ],
      },
    ],
  },
  {
    id: 'admin',
    title: 'Quản trị hệ thống',
    allowedRoles: GOVERNANCE_ROLES,
    items: [
      {
        id: 'admin-accounts',
        to: '/admin/accounts',
        label: 'Tài khoản & Phân quyền',
        icon: 'accounts',
        allowedRoles: GOVERNANCE_ROLES,
        keywords: ['tai khoan', 'phan quyen', 'vai tro rbac', 'nhan su bo mon', 'khoa tai khoan', 'users'],
      },
    ],
  },
];

export const STUDENT_NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'learn-overview',
    title: 'Tổng quan',
    items: [
      {
        id: 'learn-home',
        to: '/learn',
        label: 'Không gian học tập',
        icon: 'learn',
        end: true,
        keywords: ['hoc tap', 'lop cua toi', 'tien do', 'diem danh'],
      },
      {
        id: 'learn-schedule',
        to: '/learn/schedule',
        label: 'Lịch học của tôi',
        icon: 'schedule',
        keywords: ['lich hoc', 'phong hoc truc tuyen', 'thoi khoa bieu'],
      },
    ],
  },
  {
    id: 'learn-study',
    title: 'Đánh giá & Thủ tục',
    items: [
      {
        id: 'learn-exams',
        to: '/learn/exams',
        label: 'Bài kiểm tra',
        icon: 'assessment',
        keywords: ['thi', 'kiem tra', 'trac nghiem', 'phuc khao'],
      },
      {
        id: 'learn-assignments',
        to: '/learn/assignments',
        label: 'Bài tập được giao',
        icon: 'courses',
        keywords: ['nop bai', 'bai tap', 'rubric', 'tai tep'],
      },
      {
        id: 'learn-leave',
        to: '/learn/leave-requests',
        label: 'Đơn xin nghỉ phép',
        icon: 'leave',
        keywords: ['xin nghi', 'vang co phep'],
      },
    ],
  },
];

function hasRoleIntersection(userRoles: UserRole[], allowed?: UserRole[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return userRoles.some((r) => allowed.includes(r));
}

export function getVisibleNavGroups(roles: UserRole[]): NavGroupConfig[] {
  const hasStudent = roles.includes('STUDENT');
  const isStudentOnly = hasStudent && roles.every((r) => r === 'STUDENT');
  const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');

  if (isStudentOnly) {
    return STUDENT_NAV_GROUPS;
  }

  const teachingGroups = TEACHING_NAV_GROUPS.filter((g) => hasRoleIntersection(roles, g.allowedRoles))
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => hasRoleIntersection(roles, item.allowedRoles))
        .map((item) => {
          const dynamicLabel =
            item.id === 'admin-accounts' && !isAdmin ? 'Nhân sự bộ môn' : item.label;
          const filteredChildren = item.children?.filter((c) => hasRoleIntersection(roles, c.allowedRoles));
          return {
            ...item,
            label: dynamicLabel,
            children: filteredChildren && filteredChildren.length > 0 ? filteredChildren : undefined,
          };
        }),
    }))
    .filter((g) => g.items.length > 0);

  if (hasStudent) {
    return [
      ...teachingGroups,
      {
        id: 'learn-portal',
        title: 'Không gian học viên',
        items: STUDENT_NAV_GROUPS.flatMap((g) => g.items),
      },
    ];
  }

  return teachingGroups;
}

export function isFocusAssessmentRoute(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/teaching/classes')) return false;
  const sp = new URLSearchParams(search);
  return (
    sp.get('focus') === 'assessment' ||
    ['exams', 'assignments', 'gradebook', 'results'].includes(sp.get('tab') || '')
  );
}

export function isNavChildActive(child: NavChildItem, pathname: string, search: string): boolean {
  const [targetPath, targetQuery = ''] = child.to.split('?');
  if (pathname !== targetPath && !pathname.startsWith(`${targetPath}/`)) return false;
  if (!targetQuery) return pathname === targetPath;
  const targetParams = new URLSearchParams(targetQuery);
  const currentParams = new URLSearchParams(search);
  const tabVal = targetParams.get('tab');
  if (tabVal) {
    const curTab = currentParams.get('tab');
    if (curTab) return curTab === tabVal;
    // Khi không có query ?tab= trên URL, tab mặc định (phần tử đầu tiên) được coi là đang mở khi bấm cha
    return tabVal === 'board' || tabVal === 'questions' || tabVal === 'analytics';
  }
  return true;
}

export function isNavItemActive(item: NavItemConfig, pathname: string, search: string): boolean {
  const focusAssessment = isFocusAssessmentRoute(pathname, search);
  if (item.id === 'teaching-assessment') return focusAssessment;
  if (item.id === 'teaching-classes') return pathname.startsWith('/teaching/classes') && !focusAssessment;

  const basePath = item.to.split('?')[0];
  if (item.end) return pathname === basePath;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function getSearchableActions(roles: UserRole[]): SearchableActionItem[] {
  const groups = getVisibleNavGroups(roles);
  const items: SearchableActionItem[] = [];
  for (const g of groups) {
    for (const item of g.items) {
      items.push({
        id: item.id,
        to: item.to,
        label: item.label,
        groupTitle: g.title,
        icon: item.icon,
        keywords: [...(item.keywords || []), item.label.toLowerCase(), g.title.toLowerCase()],
      });
      if (item.children) {
        for (const ch of item.children) {
          items.push({
            id: ch.id,
            to: ch.to,
            label: `${item.label} → ${ch.label}`,
            groupTitle: g.title,
            icon: item.icon,
            keywords: [
              ...(item.keywords || []),
              ...(ch.keywords || []),
              ch.label.toLowerCase(),
              item.label.toLowerCase(),
            ],
          });
        }
      }
    }
  }
  return items;
}

export function resolveBreadcrumbs(
  pathname: string,
  search: string,
  roles: UserRole[],
  extraTrail: BreadcrumbCrumb[] = []
): BreadcrumbCrumb[] {
  const isStudentOnly = roles.includes('STUDENT') && roles.every((r) => r === 'STUDENT');
  const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
  const inStudentPortal = isStudentOnly || pathname.startsWith('/learn');
  const accountsLabel = isAdmin ? 'Tài khoản & Phân quyền' : 'Nhân sự bộ môn';
  const focusAssessment = isFocusAssessmentRoute(pathname, search);
  const sp = new URLSearchParams(search);
  const tab = sp.get('tab') || '';

  const crumbs: BreadcrumbCrumb[] = [
    {
      label: inStudentPortal ? 'Không gian học tập' : 'Cổng đào tạo',
      to: inStudentPortal ? '/learn' : '/teaching',
    },
  ];

  if (pathname === '/teaching') {
    crumbs.push({ label: 'Tổng quan' });
    return crumbs;
  }
  if (pathname === '/learn') {
    return crumbs;
  }

  if (pathname.startsWith('/teaching/courses')) {
    crumbs.push({ label: 'Môn học & Giáo trình', to: '/teaching/courses' });
  } else if (pathname.startsWith('/teaching/curricula')) {
    crumbs.push({ label: 'Khung chương trình', to: '/teaching/curricula' });
  } else if (pathname.startsWith('/teaching/cohorts')) {
    crumbs.push({ label: 'Lớp khóa học', to: '/teaching/cohorts' });
  } else if (focusAssessment) {
    crumbs.push({ label: 'Kiểm tra, Bài tập & Điểm', to: '/teaching/classes?focus=assessment' });
  } else if (pathname.startsWith('/teaching/classes')) {
    crumbs.push({ label: 'Lớp môn học', to: '/teaching/classes' });
  } else if (pathname.startsWith('/teaching/banks')) {
    crumbs.push({ label: 'Ngân hàng học liệu', to: '/teaching/banks' });
    if (tab === 'assignments') crumbs.push({ label: 'Ngân hàng bài tập' });
    else if (tab === 'resources') crumbs.push({ label: 'Ngân hàng tài nguyên' });
    else if (tab === 'questions') crumbs.push({ label: 'Ngân hàng câu hỏi' });
  } else if (pathname.startsWith('/teaching/timetable')) {
    crumbs.push({ label: 'Điều phối thời khóa biểu', to: '/teaching/timetable' });
    if (tab === 'facilities') crumbs.push({ label: 'Cơ sở, Phòng & Lịch bận' });
  } else if (pathname.startsWith('/teaching/schedule')) {
    crumbs.push({ label: 'Lịch & Thời khóa biểu', to: '/teaching/schedule' });
  } else if (pathname.startsWith('/teaching/hours')) {
    crumbs.push({ label: 'Giờ dạy & Định mức', to: '/teaching/hours' });
    if (tab === 'timesheets') crumbs.push({ label: 'Chốt bảng giờ giảng' });
    else if (tab === 'quotas') crumbs.push({ label: 'Định mức giờ giảng' });
  } else if (pathname.startsWith('/teaching/leave-requests')) {
    crumbs.push({ label: 'Duyệt đơn xin nghỉ', to: '/teaching/leave-requests' });
  } else if (pathname.startsWith('/admin/departments')) {
    crumbs.push({ label: 'Khoa & Bộ môn', to: '/admin/departments' });
  } else if (pathname.startsWith('/admin/accounts')) {
    crumbs.push({ label: accountsLabel, to: '/admin/accounts' });
  } else if (pathname.startsWith('/learn/exams')) {
    crumbs.push({ label: 'Bài kiểm tra', to: '/learn/exams' });
  } else if (pathname.startsWith('/learn/assignments')) {
    crumbs.push({ label: 'Bài tập được giao', to: '/learn/assignments' });
  } else if (pathname.startsWith('/learn/schedule')) {
    crumbs.push({ label: 'Lịch học của tôi', to: '/learn/schedule' });
  } else if (pathname.startsWith('/learn/leave-requests')) {
    crumbs.push({ label: 'Đơn xin nghỉ phép', to: '/learn/leave-requests' });
  } else if (pathname.startsWith('/learn/classes')) {
    // chi tiết lớp học viên đi từ Không gian học tập -> extraTrail
  }

  for (const extra of extraTrail) {
    const prev = crumbs[crumbs.length - 1];
    if (!prev || prev.label !== extra.label) {
      crumbs.push(extra);
    }
  }

  if (pathname.endsWith('/studio') && crumbs[crumbs.length - 1]?.label !== 'Lesson Studio') {
    crumbs.push({ label: 'Lesson Studio' });
  }
  if (pathname.endsWith('/attendance') && crumbs[crumbs.length - 1]?.label !== 'Điểm danh buổi học') {
    crumbs.push({ label: 'Điểm danh buổi học' });
  }
  if (pathname.endsWith('/live') && crumbs[crumbs.length - 1]?.label !== 'Phòng học trực tuyến') {
    crumbs.push({ label: 'Phòng học trực tuyến' });
  }

  return crumbs;
}
