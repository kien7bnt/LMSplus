/**
 * LMSPLUS — Client API cho module Giảng dạy & Lesson Studio (/api/v1/teaching).
 * Mọi dữ liệu đều lấy từ Backend thật; không có dữ liệu giả trong giao diện.
 */

import { apiRequest, apiDownload } from '../api/elearningClient';

const T = '/api/v1/teaching';

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'INACTIVE';
export type ClassStatus = 'DRAFT' | 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
export type DeliveryMode = 'OFFLINE' | 'ONLINE' | 'HYBRID';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'EXCUSED_ABSENCE' | 'UNEXCUSED_ABSENCE';
export type LessonStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type CompletionRule = 'MANUAL' | 'REVIEW_CORRECT' | 'VIDEO_AND_QUIZ';

export type QuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'TRUE_FALSE'
  | 'FILL_BLANK'
  | 'SHORT_ANSWER';

export type MarkerBehavior = 'PAUSE_AND_ASK' | 'PAUSE_OPTIONAL' | 'INFO_ONLY';
export type QuizKind = 'PRE_LESSON' | 'MID_LESSON' | 'POST_LESSON' | 'QUICK_CHECK' | 'PRACTICE';

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface AttendancePolicy {
  late_counts_as_present: boolean;
  excused_in_denominator: boolean;
  warning_threshold_pct: number;
  formula_text: string;
}

export interface TeachingMe {
  user: { id: string; full_name: string; email: string; roles: string[]; department_id: string | null };
  can_create_course: boolean;
  can_create_class: boolean;
  can_pick_instructor: boolean;
  instructor_can_manage_roster: boolean;
  attendance_policy: AttendancePolicy;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string;
  thumbnail_url: string;
  subject: string;
  objectives: string;
  target_audience: string;
  prerequisites: string;
  intro: string;
  status: CourseStatus;
  instructor_id: string;
  instructor_name: string;
  department_id: string;
  chapters_count: number;
  lessons_count: number;
  classes_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface OutlineLesson {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  publish_status: LessonStatus;
  published_version: number;
  has_unpublished_changes: boolean;
  completion_rule: CompletionRule;
  sort_order: number;
  min_video_watch_pct?: number;
  require_video_quizzes?: boolean;
  blocks_count?: number;
  video_markers_count?: number;
  warnings?: string[];
  class_publish_status?: 'DRAFT' | 'PUBLISHED' | 'INHERITED_ONLY';
  custom_blocks_count?: number;
  custom_markers_count?: number;
  has_class_note?: boolean;
}

export interface OutlineChapter {
  id: string;
  title: string;
  description: string;
  status: LessonStatus;
  sort_order: number;
  lessons: OutlineLesson[];
}

export interface CourseDetail extends Course {
  outline: OutlineChapter[];
  classes: Array<{ id: string; code: string; title: string; status: ClassStatus; student_count: number }>;
  resources_count: number;
  capabilities: { can_manage: boolean; can_edit_draft: boolean; can_duplicate: boolean };
}

export interface CourseStats {
  published_lessons: number;
  total_students: number;
  classes: Array<{ id: string; code: string; title: string; students: number }>;
  lessons: Array<{ lesson_id: string; title: string; completed_count: number }>;
}

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'video'
  | 'youtube'
  | 'pdf'
  | 'file'
  | 'table'
  | 'math'
  | 'code'
  | 'quote'
  | 'callout'
  | 'link'
  | 'quiz'
  | 'assignment'
  | 'embed'
  | 'review_question'
  | 'assignment_link'
  | 'inline_mcq'
  | 'step_by_step_solution'
  | 'code_block';

export interface BlockDisplayConfig {
  collapsible?: boolean;
  default_collapsed?: boolean;
  highlight?: boolean;
  hidden?: boolean;
}

export interface LessonBlock {
  id: string;
  block_type: BlockType;
  sort_order?: number;
  anchor_block_id?: string | null;
  origin?: 'INHERITED' | 'CLASS_CUSTOM';
  is_published?: boolean;
  content: Record<string, any>;
}

export interface QuestionOptionSpec {
  id: string;
  text: string;
  is_correct?: boolean;
  feedback?: string;
}

export interface QuestionSpec {
  id?: string;
  question_id?: string | null;
  question_type: QuestionType;
  prompt: string;
  options?: QuestionOptionSpec[];
  answer_key?: {
    correct_option_ids?: string[];
    boolean_answer?: boolean;
    accepted_texts?: string[];
    case_sensitive?: boolean;
    keywords?: string[];
    sample_answer?: string;
    manual_review?: boolean;
  };
  points?: number;
  explanation?: string;
  correct_feedback?: string;
  wrong_feedback?: string;
}

export interface QuestionBankItem extends QuestionSpec {
  id: string;
  course_id: string | null;
  subject: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  tags: string[];
  updated_at: string;
}

export interface VideoQuizMarker {
  id: string;
  lesson_id?: string;
  class_id?: string | null;
  origin?: 'INHERITED' | 'CLASS_CUSTOM';
  block_id: string;
  timestamp_sec: number;
  sort_order?: number;
  behavior: MarkerBehavior;
  title: string;
  info_body?: string;
  question_id?: string | null;
  question: QuestionSpec | null;
  is_required: boolean;
  allow_skip: boolean;
  max_attempts: number;
  show_answer_after_submit: boolean;
  show_explanation: boolean;
  allow_review: boolean;
  save_to_bank?: boolean;
  updated_at?: string;
}

export interface StudentVideoMarker {
  id: string;
  block_id: string;
  origin: 'INHERITED' | 'CLASS_CUSTOM';
  timestamp_sec: number;
  sort_order: number;
  behavior: MarkerBehavior;
  title: string;
  info_body: string;
  is_required: boolean;
  allow_skip: boolean;
  max_attempts: number;
  allow_review: boolean;
  question: {
    id: string;
    question_id: string | null;
    question_type: QuestionType;
    prompt: string;
    points: number;
    options: Array<{ id: string; text: string; is_correct?: boolean }>;
    correct_answer?: Record<string, any>;
    explanation?: string;
  } | null;
  learner_state: {
    completed: boolean;
    attempts_used: number;
    is_correct: boolean;
    best_points: number;
    can_retry: boolean;
    last_response: Record<string, any> | null;
    last_feedback: string;
  };
}

export interface VideoWatchProgress {
  last_position_sec: number;
  max_watched_sec: number;
  watched_seconds: number;
  duration_sec: number;
  watch_pct: number;
  is_completed: boolean;
}

export interface QuizBlockState {
  attempts_used: number;
  max_attempts: number;
  can_retry: boolean;
  passed: boolean;
  best_score_pct: number;
  earned_points: number;
  max_points: number;
  last_feedback: Record<string, any> | null;
}

export interface MarkerSubmitResult {
  deduplicated: boolean;
  submission_id?: string;
  attempt_number?: number;
  is_correct: boolean;
  grading_status?: 'GRADED' | 'PENDING_REVIEW';
  earned_points?: number;
  max_points?: number;
  max_attempts?: number;
  can_retry: boolean;
  can_continue: boolean;
  feedback: string;
  explanation?: string;
  correct_answer?: Record<string, any>;
}

export interface QuizSubmitResult {
  deduplicated: boolean;
  submission_id: string;
  attempt_number: number;
  is_correct: boolean;
  earned_points: number;
  max_points: number;
  score_pct: number;
  pass_score_pct: number;
  passed: boolean;
  max_attempts: number;
  can_retry: boolean;
  items: Array<{
    question_id: string;
    is_correct: boolean;
    grading_status: string;
    earned_points: number;
    max_points: number;
    feedback: string;
    explanation?: string;
    correct_answer?: Record<string, any>;
  }>;
}

export interface LessonEditorData {
  id: string;
  title: string;
  description: string;
  objectives: string;
  duration_minutes: number;
  completion_rule: CompletionRule;
  min_video_watch_pct: number;
  require_video_quizzes: boolean;
  publish_status: LessonStatus;
  published_version: number;
  published_at: string | null;
  updated_at: string | null;
  revision: number;
  chapter: { id: string; title: string };
  course: { id: string; code: string; title: string; status: CourseStatus; classes_using: number };
  blocks: LessonBlock[];
  video_markers: VideoQuizMarker[];
  capabilities: { can_edit: boolean; can_publish: boolean };
}

export interface Resource {
  id: string;
  course_id?: string;
  class_id?: string | null;
  title: string;
  description?: string;
  visibility?: 'ENROLLED' | 'INSTRUCTOR_ONLY';
  resource_type: 'LINK' | 'FILE' | 'VIDEO' | 'PDF';
  url: string | null;
  stream_url?: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds?: number | null;
  thumbnail_url?: string;
  processing_status?: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  available?: boolean;
  created_by_name: string | null;
  created_at: string;
}

export interface StudioCourseData {
  mode: 'COURSE';
  course: {
    id: string;
    code: string;
    title: string;
    subject: string;
    status: CourseStatus;
    description: string;
    objectives: string;
  };
  outline: OutlineChapter[];
  resources: Resource[];
  question_bank_count: number;
  classes_using: Array<{ id: string; code: string; title: string; status: ClassStatus; student_count: number }>;
  capabilities: {
    can_manage: boolean;
    can_edit_draft: boolean;
    can_publish: boolean;
    can_duplicate: boolean;
  };
}

export interface StudioClassData {
  mode: 'CLASS';
  class: { id: string; code: string; title: string; status: ClassStatus };
  course: { id: string; code: string; title: string; status: CourseStatus };
  outline: OutlineChapter[];
  resources: Resource[];
  capabilities: {
    can_edit_class_content: boolean;
    can_publish_class_content: boolean;
    can_open_canonical_course: boolean;
  };
}

export interface StudioClassLessonData {
  mode: 'CLASS';
  class: { id: string; code: string; title: string };
  course: { id: string; code: string; title: string };
  chapter: { id: string; title: string };
  lesson: {
    id: string;
    title: string;
    description: string;
    objectives: string;
    duration_minutes: number;
    published_version: number;
  };
  inherited_blocks: LessonBlock[];
  inherited_markers: VideoQuizMarker[];
  custom: {
    instructor_note: string;
    custom_objectives: string;
    publish_status: 'DRAFT' | 'PUBLISHED';
    revision: number;
    published_at: string | null;
  };
  custom_blocks: LessonBlock[];
  custom_markers: VideoQuizMarker[];
  capabilities: {
    can_edit: boolean;
    can_publish: boolean;
    can_open_canonical_course: boolean;
  };
}

export interface LessonVersionItem {
  id: string;
  version_number: number;
  published_by: string;
  published_at: string;
  change_note: string;
  blocks_count: number;
  markers_count: number;
}

export interface VideoLinkValidation {
  source_type: 'YOUTUBE' | 'DIRECT_URL';
  video_id?: string;
  start_seconds?: number;
  embed_url?: string;
  watch_url?: string;
  thumbnail_url?: string;
  direct_url?: string;
  host?: string;
  embeddable: boolean | null;
  title: string;
  author_name?: string;
  check_message: string;
}

export interface ClassQuizAnalytics {
  lesson_id: string;
  markers_total: number;
  students: Array<{
    student_id: string;
    code: string;
    full_name: string;
    lesson_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
    video_watch_pct: number;
    watched_seconds: number;
    markers_answered: number;
    markers_total: number;
    earned_points: number;
    max_points: number;
  }>;
}

export interface YouTubeCheck {
  video_id: string;
  start_seconds: number;
  embed_url: string;
  watch_url: string;
  thumbnail_url: string;
  embeddable: boolean | null;
  title: string;
  author_name: string;
  check_message: string;
}

export interface StaffMember {
  id: string;
  code: string;
  full_name: string;
  email: string;
  assignment_id: string;
  staff_role: 'PRIMARY_INSTRUCTOR' | 'CO_INSTRUCTOR' | 'TEACHING_ASSISTANT';
  permissions: { can_manage_materials?: boolean; can_take_attendance?: boolean };
}

export interface SessionSummary {
  id: string;
  class_id: string;
  class_code: string;
  class_title?: string;
  title: string;
  start_at: string;
  end_at: string;
  room_or_link: string;
  session_status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  cancel_reason: string;
  instructor_name: string;
  attendance_state: 'NOT_STARTED' | 'NEEDS_ATTENDANCE' | 'SAVED' | 'LOCKED' | 'CANCELLED';
  attendance_saved_at: string | null;
  attendance_locked_at: string | null;
  counts: Partial<Record<AttendanceStatus, number>>;
  marked_count: number;
  roster_size: number | null;
  confirmation_status: string;
  confirmation_deadline_at: string;
  confirmed_at: string | null;
  is_late_confirmation: boolean;
}

export interface ClassCapabilities {
  role: string | null;
  can_view: boolean;
  can_view_roster: boolean;
  can_manage_class: boolean;
  can_manage_sessions: boolean;
  can_manage_roster: boolean;
  can_manage_staff: boolean;
  can_take_attendance: boolean;
  can_lock_attendance: boolean;
  can_confirm_teaching_log: boolean;
}

export interface ClassSummary {
  id: string;
  code: string;
  title: string;
  subject: string;
  description: string;
  course: { id: string; code: string; title: string; status: CourseStatus } | null;
  start_date: string | null;
  end_date: string | null;
  max_students: number | null;
  delivery_mode: DeliveryMode;
  status: ClassStatus;
  room: string;
  schedule_text: string;
  department_id: string | null;
  staff: StaffMember[];
  updated_at: string | null;
  student_count: number;
  sessions_total: number;
  sessions_done: number;
  sessions_unmarked: number;
  attendance_rate: number | null;
  next_session: { session_id: string; session_title: string; scheduled_start_at: string; scheduled_end_at: string; room_or_link: string } | null;
  capabilities?: ClassCapabilities;
}

export interface ClassDetail extends ClassSummary {
  capabilities: ClassCapabilities;
  upcoming_sessions: SessionSummary[];
  sessions_need_attendance: SessionSummary[];
  logs_unconfirmed: SessionSummary[];
  progress: { published_lessons: number; avg_completion_pct: number } | null;
}

export interface RosterStudent {
  id: string;
  code: string;
  full_name: string;
  email: string;
  status: 'ACTIVE' | 'DROPPED';
  enrolled_at: string;
  dropped_at: string | null;
  attendance: { present: number; late: number; excused: number; absent: number; rate: number | null };
  progress: { completed: number; total: number };
}

export interface EnrollResult {
  added: string[];
  reactivated: string[];
  already_enrolled: string[];
  not_found: string[];
}

export interface AttendanceRow {
  index: number;
  student_id: string;
  code: string;
  full_name: string;
  status: AttendanceStatus | null;
  note: string;
  check_in_at: string | null;
  check_in_method: 'MANUAL' | 'QR_CODE' | null;
  updated_at: string | null;
}

export interface AttendanceSheet {
  session: {
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    room_or_link: string;
    session_status: string;
    cancel_reason: string;
    attendance_saved_at: string | null;
    attendance_locked_at: string | null;
  };
  class: { id: string; code: string; title: string; subject: string; delivery_mode: DeliveryMode; staff: Array<{ full_name: string; staff_role: string }> };
  counts: Record<AttendanceStatus | 'NOT_MARKED' | 'total', number>;
  items: AttendanceRow[];
  qr_active: boolean;
  capabilities: {
    can_edit: boolean;
    can_lock: boolean;
    can_unlock: boolean;
    can_use_qr: boolean;
    reason_required: boolean;
    not_open_reason: string | null;
  };
}

export interface AttendanceHistoryItem {
  id: string;
  previous_status: AttendanceStatus | null;
  new_status: AttendanceStatus;
  previous_note: string | null;
  new_note: string | null;
  change_reason: string;
  changed_by_name: string | null;
  changed_at: string;
  student_code: string;
  student_name: string;
}

export interface AttendanceStats {
  policy: AttendancePolicy;
  sessions_held: number;
  sessions_with_attendance: number;
  cancelled_sessions: number;
  class_totals: Record<AttendanceStatus | 'NOT_MARKED', number> & { rate: number | null };
  students: Array<{
    student_id: string;
    code: string;
    full_name: string;
    enrollment_status: string;
    total_sessions: number;
    present: number;
    late: number;
    excused: number;
    absent: number;
    not_marked: number;
    rate: number | null;
  }>;
  sessions: Array<{ id: string; title: string; start_at: string; attendance_saved: boolean } & Record<AttendanceStatus, number>>;
}

export interface QrState {
  active: boolean;
  code?: string;
  rotates_in_seconds?: number;
  rotation_interval_sec?: number;
  valid_until?: string;
  late_threshold_minutes?: number;
  checked_in_count?: number;
}

export interface Dashboard {
  counts: { courses: number; classes: number; students: number; sessions_today: number };
  today_sessions: SessionSummary[];
  upcoming_sessions: SessionSummary[];
  sessions_need_attendance: SessionSummary[];
  logs_unconfirmed: SessionSummary[];
  low_attendance: Array<{ class_id: string; class_code: string; student_id: string; full_name: string; code: string; rate: number }>;
  assignments_to_grade: number | null;
  attendance_policy: AttendancePolicy;
}

export interface LearnClass {
  id: string;
  code: string;
  title: string;
  subject: string;
  instructor_name: string;
  course: { id: string; title: string; status: CourseStatus; thumbnail_url: string } | null;
  progress: { completed: number; total: number; pct: number };
  resume_lesson_id: string | null;
  next_session: { session_id: string; session_title: string; scheduled_start_at: string; scheduled_end_at: string; room_or_link: string } | null;
}

export interface LearnClassDetail {
  class: { id: string; code: string; title: string; room: string; schedule_text: string };
  course: { id: string; title: string; description: string; objectives: string; status: CourseStatus } | null;
  content_available: boolean;
  chapters: Array<{ id: string; title: string; description: string; lessons: Array<{ id: string; title: string; duration_minutes: number; progress_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' }> }>;
  progress: { completed: number; total: number; pct: number };
}

export interface LearnLesson {
  id: string;
  title: string;
  description: string;
  objectives: string;
  duration_minutes: number;
  completion_rule: CompletionRule;
  min_video_watch_pct?: number;
  require_video_quizzes?: boolean;
  chapter: { id: string; title: string };
  class_custom_note?: { instructor_note: string; custom_objectives: string } | null;
  blocks: LessonBlock[];
  video_markers?: StudentVideoMarker[];
  video_progress?: Record<string, VideoWatchProgress>;
  quiz_states?: Record<string, QuizBlockState>;
  resources: Record<string, Resource & { available: boolean }>;
  progress_status: 'IN_PROGRESS' | 'COMPLETED';
  position: { index: number; total: number };
  prev_lesson: { id: string; title: string } | null;
  next_lesson: { id: string; title: string } | null;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : '';
};
const get = <R>(p: string) => apiRequest<R>(`${T}${p}`);
const send = <R>(method: string, p: string, body?: unknown) =>
  apiRequest<R>(`${T}${p}`, { method, body: body === undefined ? JSON.stringify({}) : JSON.stringify(body) });

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const step = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += step) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + step)));
  }
  return btoa(parts.join(''));
}

export interface VideoUploadOptions {
  file: File;
  courseId: string;
  classId?: string | null;
  title?: string;
  durationSeconds?: number | null;
  thumbnailDataUrl?: string | null;
  signal?: AbortSignal;
  onProgress?: (pct: number, receivedBytes: number, totalBytes: number) => void;
}

export const teachingApi = {
  me: () => get<TeachingMe>('/me'),
  dashboard: () => get<Dashboard>('/dashboard'),
  users: (role: 'STUDENT' | 'INSTRUCTOR' | 'TEACHING_ASSISTANT', q = '') =>
    get<{ items: Array<{ id: string; code: string; full_name: string; email: string }> }>(`/users${qs({ role, q })}`),

  // Khóa học
  courses: (p: { q?: string; subject?: string; status?: string; sort?: string; page?: number; page_size?: number }) =>
    get<Paged<Course> & { subjects: string[] }>(`/courses${qs(p)}`),
  course: (id: string) => get<CourseDetail>(`/courses/${id}`),
  createCourse: (body: Partial<Course> & { instructor_id?: string }) => send<Course>('POST', '/courses', body),
  updateCourse: (id: string, body: Partial<Course> & { instructor_id?: string }) => send<Course>('PATCH', `/courses/${id}`, body),
  setCourseStatus: (id: string, status: CourseStatus) => send<Course>('POST', `/courses/${id}/status`, { status }),
  duplicateCourse: (id: string, body: { code?: string; title?: string }) => send<Course>('POST', `/courses/${id}/duplicate`, body),
  courseStats: (id: string) => get<CourseStats>(`/courses/${id}/stats`),
  saveOutline: (id: string, chapters: Array<{ id: string; lesson_ids: string[] }>) =>
    send<{ outline: OutlineChapter[] }>('PUT', `/courses/${id}/outline`, { chapters }),

  // Chương & bài học
  createChapter: (courseId: string, body: { title: string; description?: string }) => send<OutlineChapter>('POST', `/courses/${courseId}/chapters`, body),
  updateChapter: (id: string, body: Partial<{ title: string; description: string; status: LessonStatus }>) => send<OutlineChapter>('PATCH', `/chapters/${id}`, body),
  duplicateChapter: (id: string) => send<{ id: string; outline: OutlineChapter[] }>('POST', `/chapters/${id}/duplicate`),
  deleteChapter: (id: string) => send<{ deleted_id: string }>('DELETE', `/chapters/${id}`),
  createLesson: (chapterId: string, body: { title: string; description?: string; duration_minutes?: number; completion_rule?: CompletionRule }) =>
    send<{ id: string }>('POST', `/chapters/${chapterId}/lessons`, body),
  lesson: (id: string) => get<LessonEditorData>(`/lessons/${id}`),
  updateLesson: (id: string, body: Partial<Pick<LessonEditorData, 'title' | 'description' | 'objectives' | 'duration_minutes' | 'completion_rule' | 'min_video_watch_pct' | 'require_video_quizzes'>>) =>
    send<unknown>('PATCH', `/lessons/${id}`, body),
  duplicateLesson: (id: string) => send<{ id: string; chapter_id: string; title: string }>('POST', `/lessons/${id}/duplicate`),
  saveLessonContent: (id: string, base_revision: number, blocks: LessonBlock[]) =>
    send<{ revision: number; blocks: LessonBlock[] }>('PUT', `/lessons/${id}/content`, { base_revision, blocks }),
  publishLesson: (id: string, change_note?: string) =>
    send<{ published_version: number; publish_status: LessonStatus; published_at: string }>('POST', `/lessons/${id}/publish`, change_note ? { change_note } : {}),
  unpublishLesson: (id: string) => send<unknown>('POST', `/lessons/${id}/unpublish`),
  archiveLesson: (id: string) => send<unknown>('POST', `/lessons/${id}/archive`),
  restoreLesson: (id: string) => send<unknown>('POST', `/lessons/${id}/restore`),
  deleteLesson: (id: string) => send<unknown>('DELETE', `/lessons/${id}`),
  lessonVersions: (id: string) => get<{ items: LessonVersionItem[] }>(`/lessons/${id}/versions`),
  restoreLessonVersion: (id: string, versionNumber: number) =>
    send<{ revision: number; blocks: LessonBlock[]; video_markers: VideoQuizMarker[] }>('POST', `/lessons/${id}/versions/${versionNumber}/restore`),
  validateYouTube: (url: string) => send<YouTubeCheck>('POST', '/youtube/validate', { url }),

  // Lesson Studio (Mode A & Mode B)
  studioCourse: (courseId: string) => get<StudioCourseData>(`/studio/courses/${courseId}`),
  studioClass: (classId: string) => get<StudioClassData>(`/studio/classes/${classId}`),
  studioClassLesson: (classId: string, lessonId: string) => get<StudioClassLessonData>(`/studio/classes/${classId}/lessons/${lessonId}`),
  saveStudioClassLesson: (
    classId: string,
    lessonId: string,
    body: { base_revision: number; instructor_note: string; custom_objectives: string; custom_blocks: LessonBlock[] }
  ) => send<{ revision: number; custom_blocks: LessonBlock[] }>('PUT', `/studio/classes/${classId}/lessons/${lessonId}/content`, body),
  saveStudioClassMarkers: (classId: string, lessonId: string, markers: Partial<VideoQuizMarker>[], blockId?: string) =>
    send<{ items: VideoQuizMarker[] }>('PUT', `/studio/classes/${classId}/lessons/${lessonId}/video-markers`, {
      markers,
      ...(blockId ? { block_id: blockId } : {}),
    }),
  publishStudioClassLesson: (classId: string, lessonId: string) =>
    send<{ publish_status: 'PUBLISHED'; published_at: string }>('POST', `/studio/classes/${classId}/lessons/${lessonId}/publish`),

  // Mốc câu hỏi tương tác trên Video (Mode A)
  lessonVideoMarkers: (lessonId: string) => get<{ items: VideoQuizMarker[] }>(`/lessons/${lessonId}/video-markers`),
  saveLessonVideoMarkers: (lessonId: string, markers: Partial<VideoQuizMarker>[], blockId?: string) =>
    send<{ items: VideoQuizMarker[] }>('PUT', `/lessons/${lessonId}/video-markers`, {
      markers,
      ...(blockId ? { block_id: blockId } : {}),
    }),

  // Ngân hàng câu hỏi (Question Bank)
  questionBank: (courseId: string, p: { q?: string; question_type?: QuestionType } = {}) =>
    get<{ items: QuestionBankItem[]; can_edit: boolean }>(`/courses/${courseId}/question-bank${qs(p)}`),
  createQuestionBankItem: (courseId: string, body: Partial<QuestionBankItem>) =>
    send<QuestionBankItem>('POST', `/courses/${courseId}/question-bank`, body),
  updateQuestionBankItem: (id: string, body: Partial<QuestionBankItem>) =>
    send<QuestionBankItem>('PATCH', `/question-bank/${id}`, body),
  deleteQuestionBankItem: (id: string) => send<{ deleted_id: string }>('DELETE', `/question-bank/${id}`),

  // Tải lên Video theo mảnh (Chunked Upload + Cancel) & PDF & Kiểm tra Link Video
  validateVideoLink: (url: string) => send<VideoLinkValidation>('POST', '/media/video-link/validate', { url }),
  uploadVideoFile: async (opts: VideoUploadOptions): Promise<Resource> => {
    const chunkSize = 1536 * 1024; // 1.5 MB mỗi mảnh nhị phân (~2 MB base64 JSON, dưới ngưỡng 16 MB an toàn)
    const totalBytes = opts.file.size;
    const init = await send<{ upload_id: string; chunk_max_bytes: number }>('POST', '/media/videos/init', {
      course_id: opts.courseId,
      class_id: opts.classId || undefined,
      title: (opts.title || opts.file.name.replace(/\.[^.]+$/, '')).slice(0, 200),
      file_name: opts.file.name,
      total_size_bytes: totalBytes,
    });

    const uploadId = init.upload_id;
    let offset = 0;
    let chunkIndex = 0;

    try {
      while (offset < totalBytes) {
        if (opts.signal?.aborted) {
          throw new DOMException('Đã hủy tải lên video.', 'AbortError');
        }
        const slice = opts.file.slice(offset, Math.min(offset + chunkSize, totalBytes));
        const buf = await slice.arrayBuffer();
        if (opts.signal?.aborted) {
          throw new DOMException('Đã hủy tải lên video.', 'AbortError');
        }
        const b64 = arrayBufferToBase64(buf);
        const stepRes = await send<{ received_bytes: number; total_size_bytes: number; progress_pct: number }>(
          'PUT',
          `/media/videos/${uploadId}/chunk`,
          { chunk_index: chunkIndex, data_base64: b64 }
        );
        offset = stepRes.received_bytes;
        chunkIndex += 1;
        opts.onProgress?.(stepRes.progress_pct, stepRes.received_bytes, stepRes.total_size_bytes);
      }

      if (opts.signal?.aborted) {
        throw new DOMException('Đã hủy tải lên video.', 'AbortError');
      }

      const completed = await send<Resource>('POST', `/media/videos/${uploadId}/complete`, {
        duration_seconds: opts.durationSeconds ?? undefined,
        thumbnail_url: opts.thumbnailDataUrl ?? undefined,
      });
      opts.onProgress?.(100, totalBytes, totalBytes);
      return completed;
    } catch (err: any) {
      if (opts.signal?.aborted || err?.name === 'AbortError') {
        try {
          await send('DELETE', `/media/videos/${uploadId}`);
        } catch {
          // ignore cleanup network error
        }
      }
      throw err;
    }
  },
  uploadPdfFile: async (opts: { file: File; courseId: string; classId?: string | null; title?: string }): Promise<Resource> => {
    const buf = await opts.file.arrayBuffer();
    return send<Resource>('POST', '/media/pdfs', {
      course_id: opts.courseId,
      class_id: opts.classId || undefined,
      title: (opts.title || opts.file.name.replace(/\.pdf$/i, '')).slice(0, 200),
      file_name: opts.file.name,
      data_base64: arrayBufferToBase64(buf),
    });
  },
  classLessonQuizAnalytics: (classId: string, lessonId: string) =>
    get<ClassQuizAnalytics>(`/classes/${classId}/lessons/${lessonId}/quiz-analytics`),

  // Tài liệu
  resources: (courseId: string) => get<{ items: Resource[]; can_edit: boolean }>(`/courses/${courseId}/resources`),
  addResource: (courseId: string, body: { title: string; resource_type: 'LINK' | 'FILE'; url?: string; file_name?: string; data_base64?: string }) =>
    send<{ id: string }>('POST', `/courses/${courseId}/resources`, body),
  deleteResource: (id: string) => send<unknown>('DELETE', `/resources/${id}`),
  downloadResource: (id: string) => apiDownload(`${T}/resources/${id}/download`),

  // Lớp học
  classes: (p: { q?: string; status?: string; course_id?: string; page?: number; page_size?: number }) => get<Paged<ClassSummary>>(`/classes${qs(p)}`),
  klass: (id: string) => get<ClassDetail>(`/classes/${id}`),
  createClass: (body: Record<string, unknown>) => send<ClassSummary>('POST', '/classes', body),
  updateClass: (id: string, body: Record<string, unknown>) => send<ClassSummary>('PATCH', `/classes/${id}`, body),
  students: (id: string, p: { q?: string; status?: string }) =>
    get<{ items: RosterStudent[]; capabilities: ClassCapabilities }>(`/classes/${id}/students${qs(p)}`),
  addStudents: (id: string, students: string[]) => send<EnrollResult>('POST', `/classes/${id}/students`, { students }),
  importStudents: (id: string, text: string) => send<EnrollResult>('POST', `/classes/${id}/students/import`, { text }),
  dropStudent: (id: string, studentId: string) => send<unknown>('DELETE', `/classes/${id}/students/${studentId}`),
  addStaff: (id: string, body: { user_id: string; staff_role: string; permissions?: Record<string, boolean> }) =>
    send<{ items: StaffMember[] }>('POST', `/classes/${id}/staff`, body),
  removeStaff: (id: string, assignmentId: string) => send<{ items: StaffMember[] }>('DELETE', `/classes/${id}/staff/${assignmentId}`),
  sessions: (id: string, p: { from?: string; to?: string } = {}) =>
    get<{ items: SessionSummary[]; capabilities: ClassCapabilities }>(`/classes/${id}/sessions${qs(p)}`),
  createSessions: (id: string, body: Record<string, unknown>) =>
    send<{ created_count: number; skipped_dates: string[] }>('POST', `/classes/${id}/sessions`, body),
  updateSession: (id: string, body: Record<string, unknown>) => send<SessionSummary>('PATCH', `/sessions/${id}`, body),
  cancelSession: (id: string, reason: string) => send<SessionSummary>('POST', `/sessions/${id}/cancel`, { reason }),
  restoreSession: (id: string) => send<SessionSummary>('POST', `/sessions/${id}/restore`),
  confirmLog: (id: string, note?: string) => send<SessionSummary>('POST', `/sessions/${id}/confirm-log`, { note }),
  teachingLog: (id: string) =>
    get<{ items: Array<{ id: string; session_code: string; previous_status: string; new_status: string; changed_by: string; changed_at: string; note: string }> }>(`/classes/${id}/teaching-log`),

  // Điểm danh
  attendance: (sessionId: string) => get<AttendanceSheet>(`/sessions/${sessionId}/attendance`),
  saveAttendance: (sessionId: string, body: { records: Array<{ student_id: string; status: AttendanceStatus; note?: string }>; idempotency_key: string; change_reason?: string }) =>
    send<{ created: number; changed: number; unchanged: number; saved_at: string; counts: AttendanceSheet['counts']; replayed?: boolean }>('PUT', `/sessions/${sessionId}/attendance`, body),
  attendanceHistory: (sessionId: string) =>
    get<{ items: AttendanceHistoryItem[]; session_events: Array<{ id: string; new_status: string; changed_by: string; changed_at: string; note: string }> }>(`/sessions/${sessionId}/attendance/history`),
  lockAttendance: (sessionId: string) => send<unknown>('POST', `/sessions/${sessionId}/attendance/lock`),
  unlockAttendance: (sessionId: string, reason: string) => send<unknown>('POST', `/sessions/${sessionId}/attendance/unlock`, { reason }),
  openQr: (sessionId: string, body: { duration_minutes: number; late_threshold_minutes: number }) => send<{ valid_until: string }>('POST', `/sessions/${sessionId}/attendance/qr`, body),
  qr: (sessionId: string) => get<QrState>(`/sessions/${sessionId}/attendance/qr`),
  closeQr: (sessionId: string) => send<QrState>('DELETE', `/sessions/${sessionId}/attendance/qr`),
  checkIn: (code: string) => send<{ already_checked_in: boolean; status: AttendanceStatus; session_title: string }>('POST', '/attendance/check-in', { code }),
  stats: (classId: string, p: { from?: string; to?: string } = {}) => get<AttendanceStats>(`/classes/${classId}/attendance/stats${qs(p)}`),
  exportStats: (classId: string, p: { from?: string; to?: string } = {}) => apiDownload(`${T}/classes/${classId}/attendance/export${qs(p)}`),

  // Lịch & Học viên
  schedule: (p: { from: string; to: string; class_id?: string }) => get<{ from: string; to: string; items: SessionSummary[] }>(`/schedule${qs(p)}`),
  learnClasses: () => get<{ items: LearnClass[] }>('/learn/classes'),
  learnClass: (id: string) => get<LearnClassDetail>(`/learn/classes/${id}`),
  learnLesson: (classId: string, lessonId: string) => get<LearnLesson>(`/learn/classes/${classId}/lessons/${lessonId}`),
  saveVideoProgress: (
    classId: string,
    lessonId: string,
    body: { block_id: string; last_position_sec: number; watched_seconds: number; duration_sec: number }
  ) => send<VideoWatchProgress & { block_id: string }>('PUT', `/learn/classes/${classId}/lessons/${lessonId}/video-progress`, body),
  submitVideoMarker: (
    classId: string,
    lessonId: string,
    markerId: string,
    body: { idempotency_key: string; response: Record<string, any> }
  ) => send<MarkerSubmitResult>('POST', `/learn/classes/${classId}/lessons/${lessonId}/video-markers/${markerId}/submit`, body),
  submitLessonQuiz: (
    classId: string,
    lessonId: string,
    blockId: string,
    body: { idempotency_key: string; responses: Record<string, Record<string, any>> }
  ) => send<QuizSubmitResult>('POST', `/learn/classes/${classId}/lessons/${lessonId}/quizzes/${blockId}/submit`, body),
  checkAnswer: (classId: string, lessonId: string, block_id: string, option_id: string) =>
    send<{ correct: boolean; feedback: string }>('POST', `/learn/classes/${classId}/lessons/${lessonId}/check`, { block_id, option_id }),
  completeLesson: (classId: string, lessonId: string, answers: Record<string, string>) =>
    send<{ next_lesson: { id: string; title: string } | null }>('POST', `/learn/classes/${classId}/lessons/${lessonId}/complete`, { answers }),
  myAttendance: (classId: string) =>
    get<{ items: Array<{ session_id: string; session_title: string; scheduled_start_at: string; session_status: string; attendance_saved_at: string | null; attendance_status: AttendanceStatus | null; check_in_at: string | null; check_in_method: string | null; note: string | null }>; counts: Record<string, number>; rate: number | null; policy: AttendancePolicy }>(`/learn/classes/${classId}/attendance`),
};

/** Tải Blob xuống máy người dùng. */
export function saveBlob(result: { blob: Blob; filename: string } | { url: string }) {
  if ('url' in result) {
    window.open(result.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const href = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
