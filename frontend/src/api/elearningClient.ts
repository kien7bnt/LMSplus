/**
 * LMSPLUS E-Learning — Typed REST API Client (`frontend/src/api/elearningClient.ts`)
 * Connects React Frontend to the SQL-backed Backend (`/api/v1/elearning` or `http://localhost:8000/api/v1/elearning`)
 * using real HMAC-SHA256 JWT Bearer authentication, Login/Register, and Full CRUD endpoints.
 */

import type {
  UserRole,
  DiscoverableCourse,
  CurriculumChapterNode,
  CurriculumLessonNode,
  LessonBlock,
  TeachingSessionLogRecord,
  WikiTermPopoverData,
} from '../types/elearning';

export interface AuthenticatedUser {
  id: string;
  code: string;
  email: string;
  full_name: string;
  roles: UserRole[];
  department_id: string | null;
}

export interface LeaveRequestRecord {
  id: string;
  subject_class_id: string;
  student_code: string;
  student_name: string;
  reason: string;
  makeup_class_requested: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface TeachingLogAuditRecord {
  id: string;
  session_id: string;
  session_code: string;
  previous_status: string;
  new_status: string;
  changed_by: string;
  changed_at: string;
  note: string;
}

export interface BootstrapPayload {
  viewer: AuthenticatedUser;
  courses: DiscoverableCourse[];
  all_courses?: DiscoverableCourse[];
  chapters: CurriculumChapterNode[];
  blocks: LessonBlock[];
  wiki_terms?: WikiTermPopoverData[];
  users_list?: AuthenticatedUser[];
  sessions: TeachingSessionLogRecord[];
  teaching_log_history: TeachingLogAuditRecord[];
  leave_requests: LeaveRequestRecord[];
}

const AUTH_STORAGE_KEY = 'lmsplus_auth_session_v2';

let currentJwtToken: string | null = null;
let currentAuthUser: AuthenticatedUser | null = null;

try {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    currentJwtToken = parsed.access_token || null;
    currentAuthUser = parsed.user || null;
  }
} catch {
  // ignore storage errors
}

function saveAuthSession(accessToken: string | null, user: AuthenticatedUser | null) {
  currentJwtToken = accessToken;
  currentAuthUser = user;
  try {
    if (accessToken && user) {
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({ access_token: accessToken, user })
      );
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getSavedAuthUser(): AuthenticatedUser | null {
  return currentAuthUser;
}

export function apiLogout(): void {
  saveAuthSession(null, null);
}

export class ApiHttpError extends Error {
  status: number;
  code: string;
  detail: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const IS_LOCAL_DEV_HOST =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  _role?: UserRole
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (currentJwtToken) {
    headers['Authorization'] = `Bearer ${currentJwtToken}`;
  }

  const candidateBases = IS_LOCAL_DEV_HOST
    ? ['/api/v1/elearning', 'http://localhost:8000/api/v1/elearning']
    : ['/api/v1/elearning'];
  let lastError: unknown = null;

  for (const base of candidateBases) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers,
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || payload || {};
        if (response.status === 401 && !path.startsWith('/auth/')) {
          notifySessionExpired();
        }
        throw new ApiHttpError(
          response.status,
          detail.code || `HTTP_${response.status}`,
          detail.message || `Lỗi kết nối máy chủ (${response.status})`,
          detail
        );
      }
      return (payload.data !== undefined ? payload.data : payload) as T;
    } catch (err) {
      if (err instanceof ApiHttpError) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError || new Error('Không thể kết nối tới máy chủ. Vui lòng kiểm tra dịch vụ Backend.');
}

const API_ORIGINS = IS_LOCAL_DEV_HOST ? ['', 'http://localhost:8000'] : [''];

function notifySessionExpired() {
  saveAuthSession(null, null);
  try {
    window.dispatchEvent(new Event('lmsplus:session-expired'));
  } catch {
    // ignore (non-browser)
  }
}

/**
 * Gọi API bất kỳ dưới /api/v1/* với phiên đăng nhập hiện tại (dùng cho module Giảng dạy).
 * @param absPath ví dụ "/api/v1/teaching/courses?page=1"
 */
export async function apiRequest<T>(absPath: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  if (currentJwtToken) headers['Authorization'] = `Bearer ${currentJwtToken}`;
  let lastError: unknown = null;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetch(`${origin}${absPath}`, { ...options, headers });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) continue;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || {};
        if (response.status === 401) notifySessionExpired();
        throw new ApiHttpError(
          response.status,
          detail.code || `HTTP_${response.status}`,
          detail.message || `Lỗi máy chủ (${response.status})`,
          detail
        );
      }
      return (payload.data !== undefined ? payload.data : payload) as T;
    } catch (err) {
      if (err instanceof ApiHttpError) throw err;
      lastError = err;
    }
  }
  throw new ApiHttpError(
    0,
    'NETWORK_ERROR',
    'Không kết nối được máy chủ. Vui lòng kiểm tra cửa sổ Backend đang chạy.',
    { cause: String(lastError) }
  );
}

/** Tải tệp (CSV, tài liệu) có kèm xác thực; trả về Blob và tên tệp. */
export async function apiDownload(absPath: string): Promise<{ blob: Blob; filename: string } | { url: string }> {
  const headers: Record<string, string> = {};
  if (currentJwtToken) headers['Authorization'] = `Bearer ${currentJwtToken}`;
  let lastError: unknown = null;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetch(`${origin}${absPath}`, { headers });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) continue;
      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || {};
          if (response.status === 401) notifySessionExpired();
          throw new ApiHttpError(response.status, detail.code || `HTTP_${response.status}`, detail.message || 'Không tải được tệp.', detail);
        }
        if (payload?.data?.url) return { url: payload.data.url as string };
      }
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = match ? decodeURIComponent(match[1]) : 'tai-lieu';
      return { blob: await response.blob(), filename };
    } catch (err) {
      if (err instanceof ApiHttpError) throw err;
      lastError = err;
    }
  }
  throw new ApiHttpError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ.', { cause: String(lastError) });
}

// ============================================================================
// AUTHENTICATION APIs (Login, Register, Logout)
// ============================================================================

export async function apiLogin(
  identifier: string,
  password: string
): Promise<{ access_token: string; user: AuthenticatedUser }> {
  const data = await requestJson<{ access_token: string; user: AuthenticatedUser }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }
  );
  saveAuthSession(data.access_token, data.user);
  return data;
}

/** Tự đăng ký công khai: luôn tạo tài khoản Học viên và đăng nhập ngay. */
export async function apiRegister(payload: {
  full_name: string;
  email: string;
  code?: string;
  password: string;
}): Promise<{ access_token: string; user: AuthenticatedUser }> {
  const data = await requestJson<{ access_token: string; user: AuthenticatedUser }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ ...payload, role: 'STUDENT' }),
    }
  );
  saveAuthSession(data.access_token, data.user);
  return data;
}

/** Quản trị viên tạo tài khoản: KHÔNG thay đổi phiên đăng nhập hiện tại. */
export async function apiAdminCreateUser(payload: {
  full_name: string;
  email: string;
  code?: string;
  role: UserRole;
  password: string;
}): Promise<AuthenticatedUser> {
  const data = await requestJson<{ access_token: string; user: AuthenticatedUser }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return data.user;
}

export async function fetchWorkspaceBootstrap(): Promise<BootstrapPayload | null> {
  if (!currentJwtToken) return null;
  try {
    return await requestJson<BootstrapPayload>('/workspace/bootstrap', { method: 'GET' });
  } catch {
    return null;
  }
}

// ============================================================================
// CRUD MANAGEMENT APIs (Courses, Chapters, Lessons, Wiki Terms, Users)
// ============================================================================

export async function apiCreateCourse(
  payload: Partial<DiscoverableCourse>,
  role: UserRole
): Promise<DiscoverableCourse> {
  return requestJson<DiscoverableCourse>(
    '/crud/courses',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiUpdateCourse(
  courseId: string,
  payload: Partial<DiscoverableCourse>,
  role: UserRole
): Promise<DiscoverableCourse> {
  return requestJson<DiscoverableCourse>(
    `/crud/courses/${courseId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiDeleteCourse(
  courseId: string,
  role: UserRole
): Promise<{ deleted_id: string }> {
  return requestJson(
    `/crud/courses/${courseId}`,
    {
      method: 'DELETE',
    },
    role
  );
}

export async function apiCreateChapter(
  payload: { code: string; title: string; course_id?: string },
  role: UserRole
): Promise<CurriculumChapterNode> {
  return requestJson<CurriculumChapterNode>(
    '/crud/chapters',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiUpdateChapter(
  chapterId: string,
  payload: { code: string; title: string },
  role: UserRole
): Promise<{ id: string; code: string; title: string }> {
  return requestJson(
    `/crud/chapters/${chapterId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiDeleteChapter(
  chapterId: string,
  role: UserRole
): Promise<{ deleted_id: string }> {
  return requestJson(
    `/crud/chapters/${chapterId}`,
    {
      method: 'DELETE',
    },
    role
  );
}

export async function apiCreateLesson(
  payload: {
    chapter_id: string;
    code: string;
    title: string;
    duration_minutes: number;
    status: 'COMPLETED' | 'IN_PROGRESS' | 'LOCKED';
    unlock_condition_text?: string;
  },
  role: UserRole
): Promise<CurriculumLessonNode & { chapter_id: string }> {
  return requestJson(
    '/crud/lessons',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiUpdateLesson(
  lessonId: string,
  payload: Partial<CurriculumLessonNode>,
  role: UserRole
): Promise<CurriculumLessonNode> {
  return requestJson(
    `/crud/lessons/${lessonId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiDeleteLesson(
  lessonId: string,
  role: UserRole
): Promise<{ deleted_id: string }> {
  return requestJson(
    `/crud/lessons/${lessonId}`,
    {
      method: 'DELETE',
    },
    role
  );
}

export async function apiCreateWikiTerm(
  payload: Omit<WikiTermPopoverData, 'id'>,
  role: UserRole
): Promise<WikiTermPopoverData> {
  return requestJson(
    '/crud/wiki-terms',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiUpdateWikiTerm(
  termId: string,
  payload: Partial<WikiTermPopoverData>,
  role: UserRole
): Promise<WikiTermPopoverData> {
  return requestJson(
    `/crud/wiki-terms/${termId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiDeleteWikiTerm(
  termId: string,
  role: UserRole
): Promise<{ deleted_id: string }> {
  return requestJson(
    `/crud/wiki-terms/${termId}`,
    {
      method: 'DELETE',
    },
    role
  );
}

export async function apiUpdateUser(
  userId: string,
  payload: { full_name: string; email: string; code: string; role: UserRole },
  role: UserRole
): Promise<AuthenticatedUser> {
  return requestJson(
    `/crud/users/${userId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    role
  );
}

export async function apiDeleteUser(
  userId: string,
  role: UserRole
): Promise<{ deleted_id: string }> {
  return requestJson(
    `/crud/users/${userId}`,
    {
      method: 'DELETE',
    },
    role
  );
}

// ============================================================================
// CORE DOMAIN ACTIONS
// ============================================================================

export async function apiEnrollCourse(
  courseId: string,
  role: UserRole
): Promise<{ course_id: string; enrollment_status: string; progress_pct?: number }> {
  const note = 'Đăng ký từ giao diện Khám phá khóa học';
  return requestJson(
    `/courses/${courseId}/enroll`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: note, request_note: note }),
    },
    role
  );
}

export async function apiApproveCourseRequest(
  courseId: string,
  decision: 'APPROVED' | 'REJECTED',
  role: UserRole
): Promise<{ course_id: string; enrollment_status: string }> {
  return requestJson(
    `/courses/${courseId}/approve-request`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
    role
  );
}

export async function apiSaveDraftBlocks(
  lessonId: string,
  baseRevisionNumber: number,
  blocks: LessonBlock[],
  role: UserRole
): Promise<{ lesson_id: string; new_revision_number: number; block_count: number }> {
  return requestJson(
    `/lessons/${lessonId}/draft-blocks`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        base_revision_number: baseRevisionNumber,
        blocks,
      }),
    },
    role
  );
}

export async function apiPublishLessonVersion(
  lessonId: string,
  changeSummary: string,
  role: UserRole
): Promise<{ lesson_id: string; published_version: number }> {
  return requestJson(
    `/lessons/${lessonId}/publish`,
    {
      method: 'POST',
      body: JSON.stringify({ change_summary: changeSummary }),
    },
    role
  );
}

export async function apiSendProgressHeartbeat(
  lessonId: string,
  lastVideoPositionSec: number,
  quickCheckPassed: boolean,
  role: UserRole
): Promise<{ lesson_id: string; last_video_position_sec: number }> {
  return requestJson(
    '/progress/heartbeat',
    {
      method: 'POST',
      body: JSON.stringify({
        lesson_id: lessonId,
        last_video_position_sec: lastVideoPositionSec,
        quick_check_passed: quickCheckPassed,
      }),
    },
    role
  );
}

export async function apiCompleteLesson(
  lessonId: string,
  role: UserRole
): Promise<{ completed_lesson_id: string; unlocked_lesson_id: string; chapter_progress_pct: number }> {
  return requestJson(
    `/progress/lessons/${lessonId}/complete`,
    {
      method: 'POST',
    },
    role
  );
}

export async function apiSimulateOverdue24h(
  sessionId: string,
  role: UserRole
): Promise<{ session_id: string; new_status: string }> {
  return requestJson(
    `/sessions/${sessionId}/simulate-overdue-24h`,
    {
      method: 'POST',
    },
    role
  );
}

export async function apiConfirmTeachingLog(
  sessionId: string,
  lateConfirmationReason: string | undefined,
  role: UserRole
): Promise<{
  session_id: string;
  confirmation_status: string;
  confirmed_at: string;
  is_late_confirmation: boolean;
}> {
  return requestJson(
    `/sessions/${sessionId}/teaching-log/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ late_confirmation_reason: lateConfirmationReason }),
    },
    role
  );
}

export async function apiDecideLeaveRequest(
  leaveId: string,
  status: 'APPROVED' | 'REJECTED',
  role: UserRole
): Promise<{ id: string; status: string }> {
  return requestJson(
    `/leave-requests/${leaveId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ status }),
    },
    role
  );
}

export async function apiResetSqlSeed(role: UserRole): Promise<{ reset: boolean }> {
  return requestJson(
    '/testing/reset-seed',
    {
      method: 'POST',
    },
    role
  );
}
