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

export type EnrollmentSource = 'ACADEMIC_ASSIGNED' | 'COHORT_SYNCED' | 'MAKEUP' | 'RETAKE' | 'SUPPLEMENTAL';

export interface CourseTopicSummary {
  id: string;
  course_id: string;
  code: string;
  title: string;
  description: string;
  sort_order: number;
  status: LessonStatus;
}

export interface OutlineChapter {
  id: string;
  topic_id?: string | null;
  code?: string;
  title: string;
  description: string;
  status: LessonStatus;
  sort_order: number;
  lessons: OutlineLesson[];
}

export interface CourseDetail extends Course {
  topics?: CourseTopicSummary[];
  versions_count?: number;
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
  unique_watched_sec?: number;
  max_contiguous_watched_sec?: number;
  watched_intervals?: Array<[number, number]>;
  duration_sec: number;
  watch_pct: number;
  required_pct?: number;
  strict_mode?: boolean;
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
  teaching_content?: string;
  delivery_mode?: DeliveryMode;
  live_status?: 'NOT_STARTED' | 'LIVE' | 'ENDED';
  live_started_at?: string | null;
  live_ended_at?: string | null;
  attendance_sync_status?: VirtualSyncStatus;
  virtual_room?: VirtualRoomSummary | null;
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

export type VirtualProviderType = 'ZOOM' | 'GOOGLE_MEET' | 'EXTERNAL';
export type VirtualAttendanceStatus = 'PRESENT' | 'LATE' | 'PARTIAL' | 'ABSENT' | 'EXCUSED' | 'UNKNOWN' | 'MANUAL_REVIEW';
export type VirtualSyncStatus = 'IDLE' | 'WAITING_PROVIDER_DATA' | 'SYNCING' | 'ATTENDANCE_CALCULATED' | 'NEEDS_REVIEW' | 'CONFIRMED';

export interface VirtualRoomSummary {
  id: string;
  provider: VirtualProviderType;
  external_platform_name: string;
  creation_mode: 'AUTO_API' | 'MANUAL_LINK' | 'REUSED_ROOM';
  is_recurring_room: boolean;
  room_title: string;
  external_meeting_id: string | null;
  join_url: string;
  has_passcode: boolean;
  room_status: string;
  live_status: 'NOT_STARTED' | 'LIVE' | 'ENDED';
  live_started_at: string | null;
  live_ended_at: string | null;
  attendance_sync_status: VirtualSyncStatus;
  supports_auto_sync: boolean;
  sync_notice: string | null;
  current_in_room: number;
  total_joined: number;
  matched_students: number;
  unknown_count: number;
}

export interface VirtualProviderConfig {
  provider: VirtualProviderType;
  display_name: string;
  auth_mode: string;
  account_id: string;
  client_id: string;
  has_client_secret: boolean;
  masked_client_secret: string;
  has_webhook_secret: boolean;
  masked_webhook_secret: string;
  scopes: string[];
  capabilities: Record<string, boolean>;
  connection_status: string;
  last_verified_at: string | null;
  status_message: string;
  webhook_endpoint: string;
  updated_at: string;
}

export interface VirtualParticipantSession {
  id: string;
  external_participant_id: string | null;
  participant_email: string | null;
  display_name: string;
  matched_student_id: string | null;
  matched_student_code: string | null;
  matched_student_name: string | null;
  identity_match_method: string;
  join_at: string;
  leave_at: string | null;
  duration_sec: number;
  duration_minutes: number;
  is_currently_in_room: boolean;
  device_info: string | null;
  source: string;
}

export interface VirtualMergedInterval {
  start_at: string;
  end_at: string;
  durationSec: number;
}

export interface VirtualAttendanceRow {
  index: number;
  student_id: string;
  code: string;
  full_name: string;
  email: string;
  first_join_at: string | null;
  last_leave_at: string | null;
  raw_sessions_count: number;
  raw_sessions: VirtualParticipantSession[];
  merged_intervals: VirtualMergedInterval[];
  total_duration_sec: number;
  total_duration_minutes: number;
  valid_duration_sec: number;
  valid_duration_minutes: number;
  attendance_ratio_pct: number;
  late_minutes: number;
  calculated_status: VirtualAttendanceStatus;
  final_status: VirtualAttendanceStatus;
  identity_match_method: string;
  is_manually_adjusted: boolean;
  adjustment_reason: string | null;
  adjusted_by_name: string | null;
  adjusted_at: string | null;
}

export interface VirtualAttendanceRules {
  late_grace_minutes: number;
  min_duration_minutes: number;
  min_attendance_pct: number;
  min_valid_seconds: number;
  attendance_window_start_at: string;
  attendance_window_end_at: string;
  window_duration_sec: number;
  window_duration_minutes: number;
  allow_instructor_adjustment: boolean;
}

export interface VirtualSessionDetail {
  session: {
    id: string;
    class_id: string;
    class_code: string;
    class_title: string;
    subject: string;
    title: string;
    teaching_content: string;
    instructor_name: string;
    start_at: string;
    end_at: string;
    delivery_mode: DeliveryMode;
    session_status: string;
    live_status: 'NOT_STARTED' | 'LIVE' | 'ENDED';
    live_started_at: string | null;
    live_ended_at: string | null;
    attendance_sync_status: VirtualSyncStatus;
    attendance_saved_at: string | null;
    attendance_locked_at: string | null;
  };
  room: {
    id: string;
    provider: VirtualProviderType;
    external_platform_name: string;
    creation_mode: string;
    is_recurring_room: boolean;
    room_title: string;
    external_meeting_id: string | null;
    raw_meeting_id: string | null;
    join_url: string;
    passcode: string | null;
    has_host_start_url: boolean;
    room_status: string;
    supports_auto_sync: boolean;
    sync_notice: string | null;
    provider_metadata: Record<string, any>;
    updated_at: string;
  } | null;
  live_stats: {
    roster_size: number;
    current_in_room: number | null;
    total_unique_joined: number | null;
    matched_students_count: number | null;
    unknown_participants_count: number | null;
    status_counts: Record<VirtualAttendanceStatus, number>;
  };
  rules: VirtualAttendanceRules;
  participant_sessions: VirtualParticipantSession[];
  unknown_participants: VirtualParticipantSession[];
  attendance_rows: VirtualAttendanceRow[];
  capabilities: {
    can_manage_room: boolean;
    can_start_host: boolean;
    can_sync_attendance: boolean;
    can_adjust_attendance: boolean;
    can_confirm_attendance: boolean;
    can_lock_attendance: boolean;
  };
}

export interface VirtualJoinResult {
  session_id: string;
  session_title: string;
  class_code: string;
  class_title: string;
  provider: VirtualProviderType;
  external_platform_name: string;
  external_meeting_id: string | null;
  join_url: string;
  passcode: string | null;
  registrant_id: string | null;
  lms_join_token: string | null;
  verified_identity: {
    user_id: string;
    code: string;
    full_name: string;
    email: string;
  };
  supports_auto_sync: boolean;
  sync_notice: string | null;
}

export interface VirtualAttendanceHistory {
  adjustments: Array<{
    id: string;
    session_id: string;
    student_id: string | null;
    student_code?: string | null;
    student_name?: string | null;
    action_type: string;
    previous_status: string | null;
    new_status: string;
    reason: string;
    actor_id: string;
    actor_name: string;
    created_at: string;
  }>;
  sync_jobs: Array<{
    id: string;
    provider: string;
    trigger_source: string;
    status: string;
    attempt_count: number;
    participants_fetched: number;
    matched_students: number;
    unknown_participants: number;
    started_at: string;
    completed_at: string | null;
  }>;
  webhook_events: Array<{
    id: string;
    event_key: string;
    provider: string;
    event_type: string;
    external_meeting_id: string | null;
    signature_verified: number;
    processing_status: string;
    received_at: string;
  }>;
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
  cohort_id?: string | null;
  cohort?: { id: string; code: string; title: string; status?: string } | null;
  course_version_id?: string | null;
  course_version_number?: number | null;
  course_version?: { id: string; version_number: number; version_label: string; published_at?: string } | null;
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
  enrollment_source?: 'ACADEMIC_ASSIGNED' | 'COHORT_SYNCED' | 'MAKEUP' | 'RETAKE' | 'SUPPLEMENTAL';
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
  leave_requests_pending?: number;
  attendance_policy: AttendancePolicy;
}

export interface LearnClass {
  id: string;
  code: string;
  title: string;
  subject: string;
  enrollment_source?: string;
  cohort?: { id: string; code: string; title: string } | null;
  course_version?: { id: string; version_number: number; version_label: string } | null;
  instructor_name: string;
  course: { id: string; title: string; status: CourseStatus; thumbnail_url: string } | null;
  progress: { completed: number; total: number; pct: number };
  resume_lesson_id: string | null;
  next_session: {
    session_id: string;
    session_title: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
    room_or_link: string;
    delivery_mode?: DeliveryMode;
    live_status?: 'NOT_STARTED' | 'LIVE' | 'ENDED';
    virtual_room?: VirtualRoomSummary | null;
  } | null;
}

export interface LearnClassDetail {
  class: {
    id: string;
    code: string;
    title: string;
    room: string;
    schedule_text: string;
    instructor_name?: string;
    enrollment_source?: string;
    cohort?: { id: string; code: string; title: string } | null;
    course_version?: { id: string; version_number: number; version_label: string } | null;
  };
  course: { id: string; title: string; description: string; objectives: string; status: CourseStatus } | null;
  content_available: boolean;
  topics?: Array<{ id: string; code: string; title: string; description?: string; sort_order: number }>;
  chapters: Array<{ id: string; topic_id?: string | null; title: string; description: string; lessons: Array<{ id: string; title: string; duration_minutes: number; progress_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' }> }>;
  upcoming_sessions?: Array<{
    id: string;
    title: string;
    teaching_content?: string;
    start_at: string;
    end_at: string;
    room_or_link: string;
    delivery_mode: DeliveryMode;
    live_status: 'NOT_STARTED' | 'LIVE' | 'ENDED';
    instructor_name: string;
    virtual_room: VirtualRoomSummary | null;
  }>;
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
  course_version?: { id: string; version_number: number; version_label: string } | null;
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
  createChapter: (courseId: string, body: { title: string; description?: string; topic_id?: string | null }) => send<OutlineChapter>('POST', `/courses/${courseId}/chapters`, body),
  updateChapter: (id: string, body: Partial<{ title: string; description: string; status: LessonStatus; topic_id: string | null }>) => send<OutlineChapter>('PATCH', `/chapters/${id}`, body),
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
  addStudents: (id: string, students: string[], enrollment_source: EnrollmentSource = 'ACADEMIC_ASSIGNED') =>
    send<EnrollResult>('POST', `/classes/${id}/students`, { students, enrollment_source }),
  importStudents: (id: string, text: string, enrollment_source: EnrollmentSource = 'ACADEMIC_ASSIGNED') =>
    send<EnrollResult>('POST', `/classes/${id}/students/import`, { text, enrollment_source }),
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
    body: {
      block_id: string;
      last_position_sec: number;
      watched_seconds?: number;
      duration_sec: number;
      playback_rate?: number;
      is_visible?: boolean;
      segments?: Array<{ start_sec: number; end_sec: number; is_visible?: boolean }>;
      events?: Array<{ idempotency_key: string; start_sec: number; end_sec: number; playback_rate?: number; is_visible?: boolean }>;
    }
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

  // Phòng học trực tuyến & Điểm danh tự động (Virtual Classroom & Auto-Attendance)
  virtualProviders: () => get<{ items: VirtualProviderConfig[] }>('/virtual-providers'),
  updateVirtualProvider: (provider: VirtualProviderType, body: Record<string, unknown>) =>
    send<unknown>('PUT', `/virtual-providers/${provider}`, body),
  validateVirtualProvider: (provider: VirtualProviderType) =>
    send<{ provider: string; connected: boolean; mode: string; connection_status: string; message: string }>(
      'POST',
      `/virtual-providers/${provider}/validate`
    ),
  classVirtualRooms: (classId: string) =>
    get<{
      items: Array<{
        id: string;
        provider: VirtualProviderType;
        external_platform_name: string;
        room_title: string;
        external_meeting_id: string | null;
        join_url: string;
        is_recurring_room: boolean;
        supports_auto_sync: boolean;
        created_at: string;
      }>;
    }>(`/classes/${classId}/virtual-rooms`),
  virtualSession: (sessionId: string) => get<VirtualSessionDetail>(`/sessions/${sessionId}/virtual-room`),
  createVirtualRoom: (sessionId: string, body: Record<string, unknown>) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-room`, body),
  updateVirtualRoom: (sessionId: string, body: Record<string, unknown>) =>
    send<VirtualSessionDetail>('PATCH', `/sessions/${sessionId}/virtual-room`, body),
  deleteVirtualRoom: (sessionId: string) =>
    send<{ detached: boolean; session_id: string }>('DELETE', `/sessions/${sessionId}/virtual-room`),
  startVirtualRoomHost: (sessionId: string) =>
    send<{ session_id: string; live_status: string; live_started_at: string; host_start_url: string; join_url: string }>(
      'POST',
      `/sessions/${sessionId}/virtual-room/start`
    ),
  joinVirtualRoom: (sessionId: string) => send<VirtualJoinResult>('POST', `/sessions/${sessionId}/virtual-room/join`),
  endVirtualRoom: (sessionId: string, body?: { wait_for_provider_report?: boolean }) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-room/end`, body || {}),
  simulateVirtualEvent: (sessionId: string, body: Record<string, unknown>) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-room/simulate-event`, body),
  syncVirtualAttendance: (sessionId: string) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-attendance/sync`),
  saveVirtualAttendanceRules: (sessionId: string, body: Partial<VirtualAttendanceRules> & { apply_to_class?: boolean }) =>
    send<VirtualSessionDetail>('PUT', `/sessions/${sessionId}/virtual-attendance/rules`, body),
  mapUnknownParticipant: (sessionId: string, body: { participant_session_id: string; student_id: string; reason?: string }) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-attendance/map-participant`, body),
  adjustVirtualAttendance: (sessionId: string, studentId: string, body: { status: VirtualAttendanceStatus; reason: string }) =>
    send<VirtualSessionDetail>('PATCH', `/sessions/${sessionId}/virtual-attendance/records/${studentId}`, body),
  confirmVirtualAttendance: (sessionId: string, body?: { resolve_unmatched_as_absent?: boolean }) =>
    send<VirtualSessionDetail>('POST', `/sessions/${sessionId}/virtual-attendance/confirm`, body || {}),
  virtualAttendanceHistory: (sessionId: string) =>
    get<VirtualAttendanceHistory>(`/sessions/${sessionId}/virtual-attendance/history`),
  exportVirtualAttendance: (sessionId: string) =>
    apiDownload(`${T}/sessions/${sessionId}/virtual-attendance/export`),
};

// ============================================================================
// MASTER LMS EXTENSIONS (Curricula, Cohorts, Tree, Snapshots, Banks, Exams, Assignments, Leave, Forums)
// ============================================================================

export type CurriculumStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CohortStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type ExamScopeType = 'COURSE' | 'TOPIC' | 'CHAPTER' | 'LESSON';
export type ScoringPolicy = 'HIGHEST' | 'LATEST' | 'AVERAGE';
export type AssignmentSubmissionType = 'TEXT' | 'FILE' | 'LINK' | 'MIXED';
export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveReasonCategory = 'ILLNESS' | 'FAMILY' | 'WORK' | 'ACADEMIC_CONFLICT' | 'OTHER';
export type ForumCategory = 'QA' | 'DISCUSSION' | 'ANNOUNCEMENT' | 'EXPERIENCE';

export interface CurriculumItem {
  id: string;
  code: string;
  title: string;
  description: string;
  version: string;
  effective_date: string | null;
  department_id: string | null;
  status: CurriculumStatus;
  lifecycle_status?: 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'DEPRECATED';
  program_type?: 'INSTRUCTOR_LED' | 'SELF_PACED';
  delivery_mode?: DeliveryMode;
  standard_duration_text?: string;
  final_tuition_fee?: number;
  subjects_count: number;
  cohorts_count: number;
  created_at: string;
  updated_at: string;
}

export interface CurriculumSubjectItem {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  subject_name: string;
  course_status: CourseStatus;
  instructor_name: string;
  latest_version_number: number | null;
  semester_order: number;
  sort_order: number;
  planned_periods: number;
  planned_hours: number;
  is_mandatory: boolean;
  note: string;
}

export interface CohortSummary {
  id: string;
  code: string;
  title: string;
  curriculum: { id: string; code: string; title: string; version: string } | null;
  academic_year: string;
  semester: string;
  start_date: string | null;
  end_date: string | null;
  delivery_mode: DeliveryMode;
  location_note: string;
  coordinator_id: string | null;
  coordinator_name: string;
  max_students: number | null;
  department_id: string | null;
  status: CohortStatus;
  active_students_count: number;
  subject_classes_count: number;
  created_at: string;
  updated_at: string;
}

export interface CurriculumDetail extends CurriculumItem {
  subjects: CurriculumSubjectItem[];
  cohorts: CohortSummary[];
  audit_logs: Array<{ id: string; action: string; actor_name: string; payload: Record<string, any>; created_at: string }>;
  capabilities: { can_manage: boolean };
}

export interface CohortStudentProgressRow {
  student_id: string;
  code: string;
  full_name: string;
  email: string;
  status: 'ACTIVE' | 'WITHDRAWN' | 'TRANSFERRED' | 'COMPLETED';
  enrolled_at: string;
  ended_at: string | null;
  note: string;
  attendance_rate: number | null;
  completed_lessons: number;
  total_lessons: number;
  completion_pct: number;
}

export interface CohortDetail extends CohortSummary {
  students: CohortStudentProgressRow[];
  curriculum_subjects: CurriculumSubjectItem[];
  subject_classes: Array<{
    id: string;
    code: string;
    title: string;
    subject: string;
    course_id: string;
    course_code: string;
    course_title: string;
    instructor_name: string;
    delivery_mode: DeliveryMode;
    status: ClassStatus;
    course_version_id: string | null;
    pinned_version_number: number | null;
    pinned_version_label: string;
    latest_version_number: number | null;
    has_newer_version: boolean;
    synced_students_count: number;
    extra_students_count: number;
    total_students_count: number;
  }>;
  instructors: Array<{ id: string; full_name: string; email: string; staff_role: string; class_codes: string[] }>;
  schedule: Array<{
    id: string;
    class_id: string;
    class_code: string;
    class_title: string;
    title: string;
    start_at: string;
    end_at: string;
    delivery_mode: DeliveryMode;
    session_status: string;
    room_or_link: string;
  }>;
  progress: CohortStudentProgressRow[];
  statistics: {
    distinct_active_students: number;
    distinct_synced_to_classes: number;
    distinct_extra_subject_students: number;
    subject_classes_count: number;
    avg_completion_pct: number;
    transferred_count: number;
    withdrawn_count: number;
    no_double_counting_note: string;
  };
  audit_logs: Array<{ id: string; action: string; actor_name: string; payload: Record<string, any>; created_at: string }>;
  capabilities: { can_manage: boolean };
}

export interface ContentTreeLesson {
  id: string;
  chapter_id: string;
  code: string;
  title: string;
  description: string;
  duration_minutes: number;
  sort_order: number;
  publish_status: LessonStatus;
  published_version: number;
  completion_rule: CompletionRule;
  questions_count: number;
  assignments_count: number;
  resources_count: number;
  wiki_count: number;
}

export interface ContentTreeChapter {
  id: string;
  topic_id: string | null;
  code: string;
  title: string;
  description: string;
  status: LessonStatus;
  sort_order: number;
  lessons: ContentTreeLesson[];
  questions_count: number;
  assignments_count: number;
  resources_count: number;
}

export interface ContentTreeTopic {
  id: string;
  course_id: string;
  code: string;
  title: string;
  description: string;
  sort_order: number;
  status: LessonStatus;
  chapters: ContentTreeChapter[];
  questions_count: number;
  assignments_count: number;
  resources_count: number;
}

export interface CourseVersionSummary {
  id: string;
  version_number: number;
  version_label: string;
  status: string;
  changelog_note: string;
  published_by: string;
  published_by_name: string;
  published_at: string;
  topics_count: number;
  chapters_count: number;
  lessons_count: number;
  classes_using: Array<{ id: string; code: string; title: string; status: ClassStatus }>;
}

export interface WikiPageItem {
  id: string;
  course_id: string;
  topic_id: string | null;
  chapter_id: string | null;
  lesson_id: string | null;
  topic_title?: string;
  chapter_title?: string;
  lesson_title?: string;
  slug: string;
  title: string;
  summary: string;
  content_markdown: string;
  tags: string[];
  related_page_ids: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  updated_at: string;
}

export interface WikiPageDetail extends WikiPageItem {
  related_pages: Array<{ id: string; title: string; slug: string; summary: string }>;
  revisions: Array<{ id: string; revision_number: number; title: string; change_note: string; edited_by_name: string; created_at: string }>;
  can_edit: boolean;
}

export interface BankTreeCourse {
  id: string;
  code: string;
  title: string;
  subject: string;
  questions_count: number;
  assignments_count: number;
  resources_count: number;
  can_edit: boolean;
  topics: ContentTreeTopic[];
}

export interface BankQuestionRow extends QuestionBankItem {
  course_code: string;
  course_title: string;
  topic_id: string | null;
  topic_title: string;
  chapter_id: string | null;
  chapter_title: string;
  lesson_id: string | null;
  lesson_title: string;
}

export interface AssignmentBankItem {
  id: string;
  course_id: string;
  course_code?: string;
  course_title?: string;
  topic_id: string | null;
  topic_title?: string;
  chapter_id: string | null;
  chapter_title?: string;
  lesson_id: string | null;
  lesson_title?: string;
  title: string;
  description: string;
  instructions: string;
  submission_type: AssignmentSubmissionType;
  max_score: number;
  max_attempts: number;
  allow_resubmit: boolean;
  relative_due_days?: number | null;
  is_mandatory?: boolean;
  tags: string[];
  attachments?: Array<Record<string, unknown>>;
  updated_at: string;
}

export interface BankResourceItem {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  topic_id: string | null;
  topic_title: string;
  chapter_id: string | null;
  chapter_title: string;
  lesson_id: string | null;
  lesson_title: string;
  title: string;
  description: string;
  resource_type: 'LINK' | 'VIDEO' | 'PDF' | 'FILE';
  storage_provider: string;
  url: string | null;
  file_name: string | null;
  file_size_bytes?: number | null;
  visibility: 'ENROLLED' | 'INSTRUCTOR_ONLY';
  usage_type?: 'MANDATORY' | 'REFERENCE';
  tags?: string[];
  updated_at: string;
}

export interface ClassExamItem {
  id: string;
  class_id: string;
  course_id: string;
  scope_type: ExamScopeType;
  topic_id: string | null;
  topic_title: string | null;
  chapter_id: string | null;
  chapter_title: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  title: string;
  description: string;
  time_limit_minutes: number;
  max_attempts: number;
  shuffle_questions: boolean;
  scoring_policy: ScoringPolicy;
  pass_score_pct: number;
  open_at: string | null;
  close_at: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  question_count: number;
  total_points: number;
  attempt_count: number;
  submitted_count: number;
  pending_manual_count: number;
  updated_at: string;
}

export interface StudentExamItem extends ClassExamItem {
  class_code: string;
  class_title: string;
  course_title: string;
  attempts_used: number;
  in_progress_attempt_id: string | null;
  effective_score: number | null;
  effective_pct: number | null;
  passed: boolean | null;
  can_start: boolean;
  attempts: Array<{
    id: string;
    attempt_number: number;
    grading_status: 'IN_PROGRESS' | 'PENDING_MANUAL' | 'GRADED';
    auto_score: number;
    manual_score: number;
    total_score: number;
    max_score: number;
    teacher_feedback: string;
    started_at: string;
    submitted_at: string | null;
    graded_at: string | null;
  }>;
}

export interface ClassAssignmentItem {
  id: string;
  class_id: string;
  course_id: string;
  assignment_bank_item_id: string | null;
  topic_id: string | null;
  topic_title: string | null;
  chapter_id: string | null;
  chapter_title: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  title: string;
  instructions: string;
  submission_type: AssignmentSubmissionType;
  max_score: number;
  max_attempts: number;
  allow_resubmit: boolean;
  due_at: string | null;
  attachments: Array<{ title: string; url: string }>;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  students_touched: number;
  submissions_total: number;
  pending_grade_count: number;
  updated_at: string;
}

export interface AssignmentSubmissionRow {
  id: string;
  class_assignment_id: string;
  student_id: string;
  student_code?: string;
  student_name?: string;
  attempt_number: number;
  submission_text: string;
  submission_link: string;
  attachments: Array<{ title?: string; name?: string; url: string }>;
  status: 'DRAFT' | 'SUBMITTED' | 'GRADED' | 'RETURNED';
  score: number | null;
  teacher_feedback: string;
  submitted_at: string | null;
  graded_at: string | null;
  updated_at: string;
}

export interface StudentAssignmentItem extends ClassAssignmentItem {
  class_code: string;
  class_title: string;
  course_title: string;
  latest_submission: AssignmentSubmissionRow | null;
  submissions: AssignmentSubmissionRow[];
  submitted_count: number;
  can_submit: boolean;
  is_overdue: boolean;
}

export interface LeaveRequestItem {
  id: string | number;
  class_id: string;
  class_code: string;
  class_title: string;
  session_id: string | null;
  session_title: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  student_id: string | null;
  student_code: string;
  student_name: string;
  reason_category: LeaveReasonCategory;
  reason: string;
  makeup_class_requested: string;
  evidence_url: string | null;
  evidence_name: string | null;
  status: LeaveRequestStatus;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_at: string | null;
  logs: Array<{ id: string; action: string; actor_name: string; note: string; created_at: string }>;
}

export interface ForumInfo {
  id: string;
  scope_type: 'COURSE' | 'CLASS';
  course_id: string | null;
  class_id: string | null;
  title: string;
  description: string;
}

export interface ForumThreadItem {
  id: string;
  forum_id: string;
  lesson_id: string | null;
  author_id: string;
  author_name: string;
  author_role: string;
  category: ForumCategory;
  title: string;
  body: string;
  is_pinned: boolean;
  is_locked: boolean;
  is_hidden: boolean;
  helpful_count: number;
  reply_count: number;
  helpful_by_me: boolean;
  last_activity_at: string;
  created_at: string;
}

export interface ForumReplyItem {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  body: string;
  is_hidden: boolean;
  is_endorsed: boolean;
  helpful_count: number;
  helpful_by_me: boolean;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  notif_type: string;
  title: string;
  body: string;
  link_path: string | null;
  is_read: boolean;
  created_at: string;
}

export interface StudentOverviewData {
  total_classes: number;
  total_lessons: number;
  completed_lessons: number;
  overall_progress_pct: number;
  upcoming_sessions: Array<{
    session_id: string;
    class_id: string;
    class_code: string;
    class_title: string;
    session_title: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
    delivery_mode: DeliveryMode;
    room_or_link: string;
  }>;
  pending_assignments: Array<{ id: string; class_id: string; class_code: string; class_title: string; title: string; due_at: string | null; max_score: number }>;
  pending_assignments_count: number;
  pending_exams: Array<{ id: string; class_id: string; class_code: string; class_title: string; title: string; time_limit_minutes: number; close_at: string | null }>;
  pending_exams_count: number;
  attendance_summary: { rate: number | null; present: number; late: number; excused: number; absent: number; total_sessions: number };
  pending_leave_requests: number;
  recent_grades: Array<{ id: string; class_id: string; class_code: string; class_title: string; source_type: string; title: string; score: number; max_score: number; updated_at: string }>;
  continue_learning: { class_id: string; class_code: string; class_title: string; lesson_id: string; lesson_title: string } | null;
  recent_forum_activity: Array<{ id: string; forum_id: string; title: string; author_name: string; reply_count: number; last_activity_at: string; forum_title: string }>;
  notifications: { unread_count: number; items: NotificationItem[] };
}

function normalizeForum(f: any): ForumInfo {
  return {
    id: f.id,
    scope_type: f.scope_type,
    course_id: f.course_id || null,
    class_id: f.subject_class_id || f.class_id || null,
    title: f.title,
    description: f.description || '',
  };
}

export const masterApi = {
  // Khung chương trình (Level 1)
  listCurricula: (p: { q?: string; status?: string; page?: number; page_size?: number } = {}) =>
    get<Paged<CurriculumItem>>(`/curricula${qs(p)}`),
  getCurriculum: (id: string) => get<CurriculumDetail>(`/curricula/${id}`),
  createCurriculum: (body: { code: string; title: string; description?: string; version?: string; effective_date?: string; status?: CurriculumStatus }) =>
    send<CurriculumItem>('POST', '/curricula', body),
  updateCurriculum: (id: string, body: Partial<{ title: string; description: string; version: string; effective_date: string; status: CurriculumStatus }>) =>
    send<CurriculumItem>('PATCH', `/curricula/${id}`, body),
  deleteCurriculum: (id: string) => send<{ deleted_id: string }>('DELETE', `/curricula/${id}`),
  addCurriculumSubject: (id: string, body: { course_id: string; semester_order?: number; planned_periods?: number; planned_hours?: number; is_mandatory?: boolean; note?: string }) =>
    send<unknown>('POST', `/curricula/${id}/subjects`, body),
  updateCurriculumSubject: (id: string, itemId: string, body: Partial<{ semester_order: number; planned_periods: number; planned_hours: number; is_mandatory: boolean; note: string }>) =>
    send<unknown>('PATCH', `/curricula/${id}/subjects/${itemId}`, body),
  removeCurriculumSubject: (id: string, itemId: string) =>
    send<{ deleted_id: string }>('DELETE', `/curricula/${id}/subjects/${itemId}`),

  // Lớp khóa học (Level 2)
  listCohorts: (p: { q?: string; status?: string; curriculum_id?: string; page?: number; page_size?: number } = {}) =>
    get<Paged<CohortSummary>>(`/cohorts${qs(p)}`),
  getCohort: (id: string) => get<CohortDetail>(`/cohorts/${id}`),
  createCohort: (body: Record<string, unknown>) => send<CohortSummary>('POST', '/cohorts', body),
  updateCohort: (id: string, body: Record<string, unknown>) => send<CohortSummary>('PATCH', `/cohorts/${id}`, body),
  addCohortStudents: (id: string, students: string[], sync_to_classes = true) =>
    send<EnrollResult & { sync_summary?: Record<string, number> }>('POST', `/cohorts/${id}/students`, { students, sync_to_classes }),
  importCohortStudents: (id: string, text: string, sync_to_classes = true) =>
    send<EnrollResult & { sync_summary?: Record<string, number> }>('POST', `/cohorts/${id}/students/import`, { text, sync_to_classes }),
  exportCohortStudents: (id: string) => apiDownload(`${T}/cohorts/${id}/students/export`),
  withdrawCohortStudent: (id: string, studentId: string, reason?: string) =>
    send<{ status: string }>('POST', `/cohorts/${id}/students/${studentId}/withdraw`, { reason }),
  transferCohortStudent: (id: string, studentId: string, target_cohort_id: string, reason?: string) =>
    send<{ source_cohort_id: string; target_cohort_id: string }>('POST', `/cohorts/${id}/students/${studentId}/transfer`, { target_cohort_id, reason }),
  syncCohortRoster: (id: string, class_ids?: string[]) =>
    send<{ classes_synced: number; added: number; reactivated: number; dropped: number }>('POST', `/cohorts/${id}/sync-roster`, class_ids ? { class_ids } : {}),
  generateCohortClasses: (id: string, body?: { course_ids?: string[] }) =>
    send<{ created: Array<{ id: string; code: string }>; skipped: Array<{ course_code: string; reason: string }> }>('POST', `/cohorts/${id}/generate-classes`, body || {}),

  // Cây 4 cấp, Snapshot phiên bản môn học & Wiki
  getCourseTree: (courseId: string) => get<{ course_id: string; topics: ContentTreeTopic[] }>(`/courses/${courseId}/tree`),
  createTopic: (courseId: string, body: { code?: string; title: string; description?: string; status?: LessonStatus }) =>
    send<ContentTreeTopic>('POST', `/courses/${courseId}/topics`, body),
  updateTopic: (topicId: string, body: Partial<{ title: string; description: string; status: LessonStatus; sort_order: number }>) =>
    send<CourseTopicSummary>('PATCH', `/topics/${topicId}`, body),
  deleteTopic: (topicId: string) => send<{ deleted_id: string }>('DELETE', `/topics/${topicId}`),
  listCourseVersions: (courseId: string) =>
    get<{ course_id: string; has_unpublished_snapshot_changes: boolean; items: CourseVersionSummary[] }>(`/courses/${courseId}/versions`),
  publishCourseVersion: (courseId: string, body: { version_label?: string; changelog_note?: string }) =>
    send<CourseVersionSummary>('POST', `/courses/${courseId}/versions`, body),
  cloneVersionToDraft: (courseId: string, versionId: string) =>
    send<{ version_label: string; restored_lessons: number }>('POST', `/courses/${courseId}/versions/${versionId}/clone-to-draft`, {}),
  upgradeClassVersion: (classId: string, body: { target_version_id: string; upgrade_reason: string; confirmed: boolean }) =>
    send<{ class_id: string; course_version_id: string; course_version_number: number; version_label: string }>('POST', `/classes/${classId}/upgrade-version`, body),

  // Wiki môn học
  listCourseWiki: (courseId: string, p: { q?: string; lesson_id?: string } = {}) =>
    get<{ items: WikiPageItem[]; can_edit: boolean }>(`/courses/${courseId}/wiki${qs(p)}`),
  createCourseWiki: (courseId: string, body: { title: string; summary?: string; content_markdown: string; tags?: string[]; lesson_id?: string | null; status?: 'DRAFT' | 'PUBLISHED' }) =>
    send<WikiPageItem>('POST', `/courses/${courseId}/wiki`, body),
  getWikiPage: (pageId: string) => get<WikiPageDetail>(`/wiki/${pageId}`),
  updateWikiPage: (pageId: string, body: Partial<{ title: string; summary: string; content_markdown: string; tags: string[]; status: string; change_note: string }>) =>
    send<WikiPageItem>('PATCH', `/wiki/${pageId}`, body),
  deleteWikiPage: (pageId: string) => send<{ deleted_id: string }>('DELETE', `/wiki/${pageId}`),
  listStudentClassWiki: (classId: string, p: { q?: string; lesson_id?: string } = {}) =>
    get<{ items: WikiPageItem[] }>(`/learn/classes/${classId}/wiki${qs(p)}`),

  // 3 Ngân hàng học liệu đồng bộ theo nút lá
  getBanksTree: (course_id?: string) => get<{ courses: BankTreeCourse[] }>(`/banks/tree${qs({ course_id })}`),
  listQuestionBank: (p: { course_id?: string; topic_id?: string; chapter_id?: string; lesson_id?: string; q?: string; question_type?: string; difficulty?: string; page?: number; page_size?: number } = {}) =>
    get<Paged<BankQuestionRow>>(`/banks/questions${qs(p)}`),
  createQuestionBankItem: (body: Record<string, unknown>) => send<BankQuestionRow>('POST', '/banks/questions', body),
  updateQuestionBankItem: (id: string, body: Record<string, unknown>) => send<BankQuestionRow>('PATCH', `/banks/questions/${id}`, body),
  deleteQuestionBankItem: (id: string) => send<{ deleted_id: string }>('DELETE', `/banks/questions/${id}`),
  importQuestionBank: (body: { lesson_id: string; node_level: 'LESSON'; items: Array<Record<string, unknown>> }) =>
    send<{ imported_count: number; lesson_id: string }>('POST', '/banks/questions/import', body),
  exportQuestionBank: (p: { course_id?: string; topic_id?: string; chapter_id?: string; lesson_id?: string } = {}) =>
    get<{ exported_at: string; total: number; items: Array<Record<string, unknown>> }>(`/banks/questions/export${qs(p)}`),

  listAssignmentBank: (p: { course_id?: string; topic_id?: string; chapter_id?: string; lesson_id?: string; q?: string; page?: number; page_size?: number } = {}) =>
    get<Paged<AssignmentBankItem>>(`/banks/assignments${qs(p)}`),
  createAssignmentBankItem: (body: Record<string, unknown>) => send<AssignmentBankItem>('POST', '/banks/assignments', body),
  updateAssignmentBankItem: (id: string, body: Record<string, unknown>) => send<AssignmentBankItem>('PATCH', `/banks/assignments/${id}`, body),
  deleteAssignmentBankItem: (id: string) => send<{ deleted_id: string }>('DELETE', `/banks/assignments/${id}`),
  importAssignmentBank: (body: { lesson_id: string; node_level: 'LESSON'; items: Array<Record<string, unknown>> }) =>
    send<{ imported_count: number; lesson_id: string }>('POST', '/banks/assignments/import', body),

  listResourceBank: (p: { course_id?: string; topic_id?: string; chapter_id?: string; lesson_id?: string; q?: string; resource_type?: string; page?: number; page_size?: number } = {}) =>
    get<Paged<BankResourceItem>>(`/banks/resources${qs(p)}`),
  createResourceBankItem: (body: Record<string, unknown>) => send<BankResourceItem>('POST', '/banks/resources', body),
  updateResourceBankItem: (id: string, body: Record<string, unknown>) => send<BankResourceItem>('PATCH', `/banks/resources/${id}`, body),
  deleteResourceBankItem: (id: string) => send<{ deleted_id: string }>('DELETE', `/banks/resources/${id}`),

  // Bài kiểm tra riêng của Lớp (Class Exams)
  listClassExams: (classId: string) => get<{ items: ClassExamItem[] }>(`/classes/${classId}/exams`),
  createClassExam: (classId: string, body: Record<string, unknown>) => send<ClassExamItem>('POST', `/classes/${classId}/exams`, body),
  getExam: (examId: string) => get<ClassExamItem & { questions: Array<{ id: string; bank_question_id: string | null; points: number; question: QuestionSpec }> }>(`/exams/${examId}`),
  updateExam: (examId: string, body: Record<string, unknown>) => send<ClassExamItem>('PATCH', `/exams/${examId}`, body),
  deleteExam: (examId: string) => send<{ deleted: boolean }>('DELETE', `/exams/${examId}`),
  listExamAttempts: (examId: string) =>
    get<{
      exam: ClassExamItem;
      questions: Array<{ id: string; bank_question_id: string | null; points: number; question: QuestionSpec }>;
      attempts: Array<{
        id: string;
        exam_id: string;
        student_id: string;
        student_code: string;
        student_name: string;
        attempt_number: number;
        grading_status: 'IN_PROGRESS' | 'PENDING_MANUAL' | 'GRADED';
        auto_score: number;
        manual_score: number;
        total_score: number;
        max_score: number;
        teacher_feedback: string;
        answers: Record<string, any>;
        item_grades: Record<string, any>;
        started_at: string;
        submitted_at: string | null;
        graded_at: string | null;
      }>;
    }>(`/exams/${examId}/attempts`),
  gradeExamAttempt: (attemptId: string, body: { item_scores?: Record<string, number>; teacher_feedback?: string }) =>
    send<unknown>('POST', `/exam-attempts/${attemptId}/grade`, body),

  // Học viên làm bài kiểm tra
  listStudentExams: (p: { class_id?: string } = {}) => get<{ items: StudentExamItem[] }>(`/learn/exams${qs(p)}`),
  startStudentExam: (examId: string) =>
    send<{
      exam: ClassExamItem;
      attempt: {
        id: string;
        attempt_number: number;
        grading_status: string;
        auto_score: number;
        manual_score: number;
        total_score: number;
        max_score: number;
        answers: Record<string, any>;
        item_grades: Record<string, any>;
        started_at: string;
        submitted_at: string | null;
        remaining_seconds?: number;
        questions: Array<{ id: string; question_type: QuestionType; prompt: string; points: number; options: Array<{ id: string; text: string }> }>;
      };
    }>('POST', `/learn/exams/${examId}/start`, {}),
  saveStudentExamAttempt: (attemptId: string, answers: Record<string, any>) =>
    send<{ attempt_id: string; saved_at: string }>('PUT', `/learn/exam-attempts/${attemptId}/save`, { answers }),
  submitStudentExamAttempt: (attemptId: string, answers: Record<string, any>) =>
    send<{ exam: ClassExamItem; attempt: any }>('POST', `/learn/exam-attempts/${attemptId}/submit`, { answers }),

  // Bài tập lớp & nộp bài
  listClassAssignments: (classId: string) => get<{ items: ClassAssignmentItem[] }>(`/classes/${classId}/assignments`),
  createClassAssignment: (classId: string, body: Record<string, unknown>) => send<ClassAssignmentItem>('POST', `/classes/${classId}/assignments`, body),
  updateClassAssignment: (assignmentId: string, body: Record<string, unknown>) => send<ClassAssignmentItem>('PATCH', `/assignments/${assignmentId}`, body),
  deleteClassAssignment: (assignmentId: string) => send<{ deleted: boolean }>('DELETE', `/assignments/${assignmentId}`),
  listAssignmentSubmissions: (assignmentId: string) =>
    get<{
      assignment: ClassAssignmentItem;
      submissions: AssignmentSubmissionRow[];
      roster_status: Array<{ student_id: string; student_code: string; student_name: string; latest_status: string; latest_submission: AssignmentSubmissionRow | null; submissions_count: number }>;
    }>(`/assignments/${assignmentId}/submissions`),
  gradeAssignmentSubmission: (subId: string, body: { status: 'GRADED' | 'RETURNED'; score?: number; teacher_feedback?: string }) =>
    send<AssignmentSubmissionRow>('POST', `/assignment-submissions/${subId}/grade`, body),
  listStudentAssignments: (p: { class_id?: string } = {}) => get<{ items: StudentAssignmentItem[] }>(`/learn/assignments${qs(p)}`),
  saveStudentAssignmentDraft: (assignmentId: string, body: { submission_text?: string; submission_link?: string; attachments?: Array<{ title: string; url: string }> }) =>
    send<AssignmentSubmissionRow>('PUT', `/learn/assignments/${assignmentId}/draft`, body),
  submitStudentAssignment: (assignmentId: string, body: { submission_text?: string; submission_link?: string; attachments?: Array<{ title: string; url: string }> }) =>
    send<AssignmentSubmissionRow>('POST', `/learn/assignments/${assignmentId}/submit`, body),

  // Bảng điểm lớp
  getClassGradebook: (classId: string) =>
    get<{
      class_id: string;
      columns: Array<{ key: string; source_type: 'EXAM' | 'ASSIGNMENT'; source_id: string; title: string; max_score?: number }>;
      rows: Array<{ student_id: string; code: string; full_name: string; scores: Record<string, { score: number; max_score: number }>; graded_count: number; average_scale_10: number | null }>;
    }>(`/classes/${classId}/gradebook`),
  getStudentClassGrades: (classId: string) =>
    get<{
      class_id: string;
      average_scale_10: number | null;
      gradebook_entries: Array<{ id: string; source_type: string; title: string; score: number; max_score: number; weight: number; updated_at: string }>;
    }>(`/learn/classes/${classId}/grades`),

  // Đơn xin nghỉ phép
  listStudentLeaveRequests: () => get<{ items: LeaveRequestItem[] }>('/learn/leave-requests'),
  createStudentLeaveRequest: (body: { class_id: string; session_id?: string | null; reason_category?: LeaveReasonCategory; reason: string; makeup_class_requested?: string; evidence_url?: string }) =>
    send<LeaveRequestItem>('POST', '/learn/leave-requests', body),
  cancelStudentLeaveRequest: (id: string | number) => send<{ id: string | number; status: string }>('POST', `/learn/leave-requests/${id}/cancel`, {}),
  listStaffLeaveRequests: (p: { class_id?: string; status?: string } = {}) => get<{ items: LeaveRequestItem[] }>(`/leave-requests${qs(p)}`),
  reviewLeaveRequest: (id: string | number, body: { decision: 'APPROVED' | 'REJECTED'; review_note?: string }) =>
    send<{ request: LeaveRequestItem; attendance_sync: string }>('POST', `/leave-requests/${id}/review`, body),

  // Diễn đàn môn học & lớp học
  getCourseForum: async (courseId: string, p: { category?: string; search?: string; lesson_id?: string } = {}) => {
    const r = await get<{ forum: any; threads: ForumThreadItem[]; can_moderate: boolean; can_post: boolean }>(`/courses/${courseId}/forum${qs(p)}`);
    return { ...r, forum: normalizeForum(r.forum) };
  },
  getClassForum: async (classId: string, p: { category?: string; search?: string; lesson_id?: string } = {}) => {
    const r = await get<{ forum: any; threads: ForumThreadItem[]; can_moderate: boolean; can_post: boolean }>(`/classes/${classId}/forum${qs(p)}`);
    return { ...r, forum: normalizeForum(r.forum) };
  },
  getStudentClassForums: async (classId: string, p: { category?: string; search?: string; lesson_id?: string } = {}) => {
    const r = await get<{ class_forum: { forum: any; threads: ForumThreadItem[]; can_moderate: boolean }; course_forum: { forum: any; threads: ForumThreadItem[]; can_moderate: boolean } | null }>(`/learn/classes/${classId}/forums${qs(p)}`);
    return {
      class_forum: { ...r.class_forum, forum: normalizeForum(r.class_forum.forum) },
      course_forum: r.course_forum ? { ...r.course_forum, forum: normalizeForum(r.course_forum.forum) } : null,
    };
  },
  createForumThread: (forumId: string, body: { category: ForumCategory; title: string; body: string; lesson_id?: string | null; is_pinned?: boolean }) =>
    send<ForumThreadItem>('POST', `/forums/${forumId}/threads`, body),
  getForumThread: async (threadId: string) => {
    const r = await get<{ forum: any; can_moderate: boolean; thread: ForumThreadItem; replies: ForumReplyItem[] }>(`/forum-threads/${threadId}`);
    return { ...r, forum: normalizeForum(r.forum) };
  },
  createForumReply: (threadId: string, body: string) => send<ForumReplyItem>('POST', `/forum-threads/${threadId}/replies`, { body }),
  moderateForumThread: (
    threadId: string,
    body: { is_pinned?: boolean; is_locked?: boolean; is_hidden?: boolean; action?: 'PIN' | 'UNPIN' | 'LOCK' | 'UNLOCK' | 'HIDE' | 'UNHIDE'; reason?: string },
  ) => {
    const action = body.action
      ?? (body.is_pinned !== undefined ? (body.is_pinned ? 'PIN' : 'UNPIN')
        : body.is_locked !== undefined ? (body.is_locked ? 'LOCK' : 'UNLOCK')
        : body.is_hidden !== undefined ? (body.is_hidden ? 'HIDE' : 'UNHIDE')
        : undefined);
    return send<ForumThreadItem>('POST', `/forum-threads/${threadId}/moderate`, { action, reason: body.reason });
  },
  moderateForumReply: (
    replyId: string,
    body: { is_endorsed?: boolean; is_hidden?: boolean; action?: 'ENDORSE' | 'UNENDORSE' | 'HIDE' | 'UNHIDE'; reason?: string },
  ) => {
    const action = body.action
      ?? (body.is_endorsed !== undefined ? (body.is_endorsed ? 'ENDORSE' : 'UNENDORSE')
        : body.is_hidden !== undefined ? (body.is_hidden ? 'HIDE' : 'UNHIDE')
        : undefined);
    return send<ForumReplyItem>('POST', `/forum-replies/${replyId}/moderate`, { action, reason: body.reason });
  },
  toggleForumHelpful: (target_type: 'THREAD' | 'REPLY', target_id: string) =>
    send<{ helpful_by_me: boolean; helpful_count: number }>('POST', '/forum-helpful', { target_type, target_id }),
  createForumReport: (body: { target_type: 'THREAD' | 'REPLY'; target_id: string; reason: string }) =>
    send<unknown>('POST', '/forum-reports', body),
  listForumReports: (forumId: string) =>
    get<{ items: Array<{ id: string; target_type: string; target_id: string; reporter_name: string; reason: string; status: string; created_at: string }> }>(`/forums/${forumId}/reports`),
  resolveForumReport: (
    reportId: string,
    body: { action?: 'DISMISS' | 'HIDE_CONTENT'; status?: 'RESOLVED' | 'DISMISSED'; hide_target?: boolean; resolution_note?: string },
  ) => {
    const status = body.status ?? (body.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED');
    const hide_target = body.hide_target ?? (body.action === 'HIDE_CONTENT');
    return send<unknown>('POST', `/forum-reports/${reportId}/resolve`, {
      status,
      hide_target,
      resolution_note: body.resolution_note,
    });
  },

  // Thông báo, Tổng quan học viên 10 mục & Phân tích Video STRICT
  listNotifications: () => get<{ unread_count: number; items: NotificationItem[] }>('/notifications'),
  markNotificationRead: (id: string) => send<{ id: string; is_read: boolean }>('POST', `/notifications/${id}/read`, {}),
  markAllNotificationsRead: () => send<{ marked_read: number }>('POST', '/notifications/read-all', {}),
  getStudentOverview: async () => {
    const r = await get<any>('/learn/overview');
    return {
      ...r,
      upcoming_sessions: (r.upcoming_sessions || []).map((s: any) => ({ ...s, class_id: s.class_id || s.subject_class_id })),
      recent_grades: (r.recent_grades || []).map((g: any) => ({ ...g, class_id: g.class_id || g.subject_class_id })),
    } as StudentOverviewData;
  },
  getClassVideoAnalytics: (classId: string, p: { lesson_id?: string; student_id?: string } = {}) =>
    get<{
      class_id: string;
      content_version_key: string;
      summary: { records_count: number; completed_count: number; avg_watch_pct: number; total_tamper_rejected: number };
      items: Array<{
        id: string;
        student_id: string;
        student_code: string;
        student_name: string;
        lesson_id: string;
        lesson_title: string;
        block_id: string;
        watched_intervals: Array<[number, number]>;
        unique_watched_sec: number;
        max_contiguous_watched_sec: number;
        duration_sec: number;
        watch_pct: number;
        required_pct: number;
        is_completed: boolean;
        tamper_attempts_count: number;
        updated_at: string;
      }>;
    }>(`/classes/${classId}/video-analytics${qs(p)}`),

  // =========================================================================
  // PHÂN HỆ ĐÀO TẠO TOÀN VÒNG ĐỜI (1.1 MÔN HỌC · 1.2 KHUNG · 1.3 KHÓA HỌC · 2.1 TKB · 2.2 GIỜ DẠY)
  // =========================================================================

  // 1.1 Môn học — Thông số đào tạo, Tiên quyết, Đầu điểm, Đề cương, Chia buổi & Ban hành
  getCourseTrainingProfile: (courseId: string) => get<CourseTrainingProfile>(`/courses/${courseId}/training-profile`),
  saveCourseTrainingProfile: (courseId: string, body: Record<string, unknown>) =>
    send<{ updated: boolean; lifecycle_status: LifecycleStatus; version_code: string; course: CourseTrainingProfile['course'] }>(
      'PUT',
      `/courses/${courseId}/training-profile`,
      body
    ),
  saveCoursePrerequisites: (courseId: string, prerequisite_course_ids: string[]) =>
    send<{ course_id: string; prerequisite_course_ids: string[] }>('PUT', `/courses/${courseId}/prerequisites`, { prerequisite_course_ids }),
  saveCourseAssessmentComponents: (
    courseId: string,
    items: Array<{ code?: string; title: string; weight_pct: number; source_type: AssessmentSourceType; is_mandatory?: boolean }>
  ) => send<{ items: AssessmentComponentItem[]; weight_sum_pct: number }>('PUT', `/courses/${courseId}/assessment-components`, { items }),
  getCourseSyllabus: (courseId: string) => get<CourseSyllabusData>(`/courses/${courseId}/syllabus`),
  updateResourceUsage: (resourceId: string, body: { usage_type: 'MANDATORY' | 'REFERENCE'; tags?: string[] }) =>
    send<{ id: string; usage_type: 'MANDATORY' | 'REFERENCE'; tags: string[] }>('PATCH', `/resources/${resourceId}/usage`, body),
  updateBankAssignmentMeta: (assignmentId: string, body: { relative_due_days?: number | null; is_mandatory?: boolean }) =>
    send<{ id: string; relative_due_days: number | null; is_mandatory: boolean }>('PATCH', `/banks/assignments/${assignmentId}/meta`, body),
  autoGenerateCourseSessionPlan: (courseId: string) =>
    send<{ items: SessionPlanItem[] }>('POST', `/courses/${courseId}/session-plan/auto-generate`, {}),
  saveCourseSessionPlan: (courseId: string, items: Array<Partial<SessionPlanItem>>) =>
    send<{ items: SessionPlanItem[] }>('PUT', `/courses/${courseId}/session-plan`, { items }),
  transitionCourseLifecycle: (
    courseId: string,
    body: { action: 'SUBMIT_REVIEW' | 'APPROVE_PUBLISH' | 'RETURN_DRAFT' | 'DEPRECATE' | 'START_NEW_VERSION'; version_label?: string; note?: string }
  ) => send<{ id: string; lifecycle_status: LifecycleStatus; version_id?: string; version_code?: string; version_label?: string }>('POST', `/courses/${courseId}/lifecycle`, body),
  compareCourseVersions: (courseId: string, p: { from_id?: string; to_id?: string } = {}) =>
    get<CourseVersionCompareData>(`/courses/${courseId}/versions/compare${qs(p)}`),

  // 1.2 Khung chương trình — Học phí & Dịch vụ, Giai đoạn, Tiên quyết, Chia buổi, Tốt nghiệp & Ban hành
  getCurriculumBlueprint: (curriculumId: string) => get<CurriculumBlueprintData>(`/curricula/${curriculumId}/blueprint`),
  saveCurriculumBlueprint: (curriculumId: string, body: Record<string, unknown>) =>
    send<CurriculumStructureTotals>('PUT', `/curricula/${curriculumId}/blueprint`, body),
  saveCurriculumStages: (
    curriculumId: string,
    items: Array<{ id?: string; code?: string; title: string; stage_type?: 'SEMESTER' | 'PHASE' | 'CUSTOM' }>
  ) => send<CurriculumStructureTotals>('PUT', `/curricula/${curriculumId}/stages`, { items }),
  saveCurriculumStructure: (
    curriculumId: string,
    items: Array<{
      id: string;
      stage_id: string | null;
      semester_order?: number;
      sort_order?: number;
      planned_periods: number;
      is_mandatory: boolean;
      prerequisite_course_ids: string[];
      note?: string;
    }>
  ) => send<CurriculumStructureTotals>('PUT', `/curricula/${curriculumId}/structure`, { items }),
  saveCurriculumServiceFees: (
    curriculumId: string,
    items: Array<{ code?: string; title: string; amount: number; is_mandatory: boolean; note?: string }>
  ) => send<CurriculumStructureTotals>('PUT', `/curricula/${curriculumId}/service-fees`, { items }),
  autoGenerateCurriculumSessionPlan: (curriculumId: string, courseId: string) =>
    send<{ items: SessionPlanItem[] }>('POST', `/curricula/${curriculumId}/session-plans/${courseId}/auto-generate`, {}),
  saveCurriculumSessionPlan: (curriculumId: string, courseId: string, items: Array<Partial<SessionPlanItem>>) =>
    send<{ items: SessionPlanItem[] }>('PUT', `/curricula/${curriculumId}/session-plans/${courseId}`, { items }),
  transitionCurriculumLifecycle: (
    curriculumId: string,
    body: { action: 'SUBMIT_REVIEW' | 'APPROVE_PUBLISH' | 'RETURN_DRAFT' | 'DEPRECATE' | 'START_NEW_VERSION'; version_label?: string; note?: string }
  ) => send<{ id: string; lifecycle_status: LifecycleStatus; version_id?: string; version?: string; version_label?: string }>('POST', `/curricula/${curriculumId}/lifecycle`, body),
  compareCurriculumVersions: (curriculumId: string, p: { from_id?: string; to_id?: string } = {}) =>
    get<CurriculumVersionCompareData>(`/curricula/${curriculumId}/versions/compare${qs(p)}`),

  // 1.3 Khởi tạo Khóa học 5 bước
  initializeCohortWizard: (body: Record<string, unknown>) =>
    send<{
      cohort_id: string;
      code: string;
      title: string;
      classes: Array<{ id: string; code: string; course_id: string; course_title: string; sessions_count: number }>;
      sessions_created: number;
      assignments_copied: number;
      assignments_due_resolved: number;
      schedule_published: boolean;
    }>('POST', '/training/cohorts/initialize', body),

  // 2.1 Thời khóa biểu & Hạ tầng Cơ sở / Phòng / Lịch nghỉ / Lịch bận GV
  getFacilitiesOverview: () => get<FacilitiesOverview>('/facilities/overview'),
  createCampus: (body: { code: string; name: string; address?: string; open_time?: string; close_time?: string; travel_buffers?: Record<string, number> }) =>
    send<CampusItem>('POST', '/facilities/campuses', body),
  createClassroom: (body: { campus_id: string; code: string; name: string; room_type: RoomType; capacity: number; equipment_note?: string }) =>
    send<ClassroomItem>('POST', '/facilities/classrooms', body),
  createHoliday: (body: { campus_id?: string | null; title: string; start_date: string; end_date: string; is_recurring_yearly?: boolean; note?: string }) =>
    send<AcademicHolidayItem>('POST', '/facilities/holidays', body),
  deleteHoliday: (id: string) => send<{ deleted_id: string }>('DELETE', `/facilities/holidays/${id}`),
  createInstructorAvailability: (body: {
    instructor_id?: string;
    rule_type: 'WEEKLY' | 'DATE';
    weekday?: number;
    specific_date?: string;
    start_time: string;
    end_time: string;
    status?: 'BUSY' | 'AVAILABLE';
    note?: string;
  }) => send<InstructorAvailabilityItem>('POST', '/facilities/instructor-availabilities', body),
  deleteInstructorAvailability: (id: string) => send<{ deleted_id: string }>('DELETE', `/facilities/instructor-availabilities/${id}`),
  getTimetableGrid: (p: {
    from?: string;
    to?: string;
    cohort_id?: string;
    course_id?: string;
    class_id?: string;
    instructor_id?: string;
    classroom_id?: string;
    campus_id?: string;
    shift_code?: string;
    schedule_state?: string;
  }) => get<TimetableGridData>(`/timetable/grid${qs(p)}`),
  getTimetableSlotHints: (body: {
    session_id?: string;
    subject_class_id?: string;
    week_start?: string;
    dates?: string[];
    campus_id?: string;
    classroom_id?: string | null;
    instructor_id?: string;
  }) => send<{ slots: TimetableSlotHint[] }>('POST', '/timetable/slot-hints', body),
  moveTimetableSession: (
    sessionId: string,
    body: {
      date: string;
      shift_code?: string;
      start_time?: string;
      end_time?: string;
      campus_id?: string;
      classroom_id?: string | null;
      instructor_id?: string;
      merged_group_code?: string | null;
      is_substitute?: boolean;
    }
  ) => send<{ session_id: string; schedule_state: string }>('POST', `/timetable/sessions/${sessionId}/move`, body),
  generateTimetableRecurrence: (body: Record<string, unknown>) =>
    send<{ scheduled_count: number; skipped_holidays: string[]; skipped_conflicts: Array<{ date: string; reason: string }>; audit: TimetableAuditReport }>(
      'POST',
      '/timetable/generate-recurrence',
      body
    ),
  autoScheduleTimetable: (body: { cohort_id?: string; class_ids?: string[]; start_date: string; end_date: string; campus_id?: string }) =>
    send<{ draft_placed_count: number; unplaced_items: Array<{ class_id: string; class_code: string; title: string }>; audit: TimetableAuditReport }>(
      'POST',
      '/timetable/auto-schedule',
      body
    ),
  copyTimetable: (body: Record<string, unknown>) =>
    send<{ copied_count: number; skipped_count: number }>('POST', '/timetable/copy', body),
  auditTimetable: (p: { cohort_id?: string; class_id?: string } = {}) =>
    get<TimetableAuditReport>(`/timetable/audit${qs(p)}`),
  publishTimetable: (body: { cohort_id?: string; class_ids?: string[]; allow_with_warnings?: boolean }) =>
    send<{ published_sessions: number; assignments_due_resolved: number; notifications_sent: number; audit: TimetableAuditReport }>(
      'POST',
      '/timetable/publish',
      body
    ),
  adjustTimetableSession: (sessionId: string, body: Record<string, unknown>) =>
    send<Record<string, unknown>>('POST', `/timetable/sessions/${sessionId}/adjust`, body),

  // 2.2 Thống kê & Chốt Giờ dạy chuyển Tài chính
  recordSessionActualHours: (
    sessionId: string,
    body: {
      actual_start_at?: string;
      actual_end_at?: string;
      actual_periods?: number;
      hour_category?: 'THEORY' | 'PRACTICE' | 'ONLINE';
      actual_instructor_id?: string;
      substitute_reason?: string;
    }
  ) => send<Record<string, unknown>>('PATCH', `/teaching-hours/sessions/${sessionId}/record`, body),
  listInstructorQuotas: (p: { period_key?: string; instructor_id?: string } = {}) =>
    get<{ period_key: string; items: InstructorQuotaRow[] }>(`/teaching-hours/quotas${qs(p)}`),
  saveInstructorQuota: (body: { instructor_id: string; period_key: string; standard_periods: number; standard_hours: number; note?: string }) =>
    send<InstructorQuotaRow>('PUT', '/teaching-hours/quotas', body),
  getTeachingHoursAnalytics: (p: {
    period_month?: string;
    from?: string;
    to?: string;
    instructor_id?: string;
    course_id?: string;
    class_id?: string;
    include_future?: string;
  } = {}) => get<TeachingHoursAnalytics>(`/teaching-hours/analytics${qs(p)}`),
  listTeachingTimesheets: (p: { period_month?: string; instructor_id?: string } = {}) =>
    get<{ period_month: string; items: TeachingTimesheetItem[] }>(`/teaching-hours/timesheets${qs(p)}`),
  getTeachingTimesheetDetail: (timesheetId: string) =>
    get<TeachingTimesheetItem & { items: TeachingTimesheetLineItem[] }>(`/teaching-hours/timesheets/${timesheetId}`),
  generateTeachingTimesheets: (body: { period_month: string; instructor_id?: string; review_note?: string }) =>
    send<{ period_month: string; generated_count: number; skipped_locked_ids: string[]; items: TeachingTimesheetItem[] }>(
      'POST',
      '/teaching-hours/timesheets/generate',
      body
    ),
  teacherReviewTimesheet: (timesheetId: string, body: { decision: 'CONFIRM' | 'DISPUTE'; teacher_note?: string }) =>
    send<TeachingTimesheetItem>('POST', `/teaching-hours/timesheets/${timesheetId}/teacher-review`, body),
  approveTimesheet: (timesheetId: string, body: { review_note?: string; force_approve?: boolean } = {}) =>
    send<TeachingTimesheetItem>('POST', `/teaching-hours/timesheets/${timesheetId}/approve`, body),
  lockTimesheet: (timesheetId: string, body: { finance_batch_code?: string } = {}) =>
    send<TeachingTimesheetItem>('POST', `/teaching-hours/timesheets/${timesheetId}/lock`, body),
  exportFinanceTimesheetsCsv: (period_month: string) =>
    apiDownload(`${T}/teaching-hours/timesheets/export-finance${qs({ period_month, format: 'csv', only_locked: 'false' })}`),
  exportFinanceTimesheetsJson: (period_month: string) =>
    get<{ period_month: string; exported_at: string; records_count: number; items: Array<TeachingTimesheetItem & { line_items: TeachingTimesheetLineItem[] }> }>(
      `/teaching-hours/timesheets/export-finance${qs({ period_month, format: 'json', only_locked: 'false' })}`
    ),
};

export type LifecycleStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'DEPRECATED';
export type RoomType = 'THEORY_ROOM' | 'COMPUTER_LAB' | 'ONLINE';
export type AssessmentSourceType = 'ATTENDANCE' | 'ASSIGNMENT' | 'EXAM' | 'EXAM_MATRIX' | 'MANUAL';

export interface AssessmentComponentItem {
  id?: string;
  code: string;
  title: string;
  weight_pct: number;
  source_type: AssessmentSourceType;
  is_mandatory: boolean;
}

export interface SessionPlanItem {
  id: string;
  session_order: number;
  title: string;
  duration_minutes: number;
  periods_count: number;
  delivery_mode: DeliveryMode;
  required_room_type: RoomType;
  lesson_ids: string[];
  lessons: Array<{ id: string; title: string; duration_minutes: number; chapter_title: string }>;
  note: string;
}

export interface CourseTrainingProfile {
  course: {
    id: string;
    code: string;
    title: string;
    subject: string;
    department_id: string;
    department_name: string;
    instructor_id: string;
    instructor_name: string;
    description: string;
    objectives: string;
    outcomes: Array<{ code: string; text: string }>;
    reference_tuition_fee: number;
    theory_periods: number;
    practice_periods: number;
    self_study_periods: number;
    minutes_per_period: number;
    total_periods: number;
    total_hours: number;
    required_room_type: RoomType;
    grading_scale: number;
    pass_score: number;
    exam_conditions: { min_attendance_pct: number; require_all_mandatory_assignments: boolean; extra_note?: string };
    lifecycle_status: LifecycleStatus;
    version_code: string;
  };
  prerequisites: Array<{ id: string; prerequisite_course_id: string; code: string; title: string; lifecycle_status: LifecycleStatus }>;
  candidate_courses: Array<{ id: string; code: string; title: string; subject: string; lifecycle_status: LifecycleStatus }>;
  assessment_components: AssessmentComponentItem[];
  weight_sum_pct: number;
  is_weight_valid: boolean;
  session_plan: SessionPlanItem[];
  lessons: Array<{ id: string; title: string; duration_minutes: number; chapter_title: string }>;
  versions: Array<{ id: string; version_number: number; version_label: string; status: string; changelog_note: string; published_by_name: string; published_at: string }>;
  capabilities: { can_manage: boolean; can_approve: boolean };
}

export interface CourseSyllabusData {
  course: { id: string; code: string; title: string };
  tree: Array<{
    id: string;
    code: string;
    title: string;
    chapters: Array<{
      id: string;
      code: string;
      title: string;
      lessons: Array<{
        id: string;
        code: string;
        title: string;
        duration_minutes: number;
        publish_status: LessonStatus;
        questions: Array<{ id: string; question_type: QuestionType; difficulty: string; prompt: string; points: number }>;
        assignments: Array<{ id: string; title: string; submission_type: string; max_score: number; relative_due_days: number | null; is_mandatory: boolean }>;
        resources: Array<{ id: string; title: string; resource_type: string; url: string | null; file_name: string | null; usage_type: 'MANDATORY' | 'REFERENCE'; tags: string[] }>;
      }>;
    }>;
  }>;
}

export interface CourseVersionCompareData {
  available_versions: Array<{ id: string; version_number: number; version_label: string; published_at: string }>;
  diff: {
    lessons_added: Array<{ id: string; title: string; duration_minutes: number }>;
    lessons_removed: Array<{ id: string; title: string; duration_minutes: number }>;
    lessons_modified: Array<{ id: string; old_title: string; new_title: string; old_duration: number; new_duration: number; content_changed: boolean }>;
    duration_before: { theory: number; practice: number; self_study: number };
    duration_after: { theory: number; practice: number; self_study: number };
    tuition_before: number;
    tuition_after: number;
    assessment_before: AssessmentComponentItem[];
    assessment_after: AssessmentComponentItem[];
  } | null;
}

export interface CurriculumStageItem {
  id: string;
  code: string;
  title: string;
  stage_type: 'SEMESTER' | 'PHASE' | 'CUSTOM';
  sort_order: number;
  subjects_count: number;
  total_periods: number;
  total_hours: number;
}

export interface CurriculumStructureSubject {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  stage_id: string | null;
  semester_order: number;
  sort_order: number;
  planned_periods: number;
  effective_periods: number;
  effective_hours: number;
  reference_tuition_fee: number;
  required_room_type: RoomType;
  is_mandatory: boolean;
  prerequisite_course_ids: string[];
  note: string;
}

export interface CurriculumServiceFeeItem {
  id?: string;
  code: string;
  title: string;
  amount: number;
  is_mandatory: boolean;
  note?: string;
}

export interface CurriculumStructureTotals {
  stages: CurriculumStageItem[];
  subjects: CurriculumStructureSubject[];
  service_fees: CurriculumServiceFeeItem[];
  prerequisite_warnings: Array<{
    type: 'MISSING_PREREQUISITE_IN_CURRICULUM' | 'PREREQUISITE_ORDER_VIOLATION';
    course_id: string;
    course_code: string;
    prerequisite_course_id: string;
    prerequisite_code: string;
    message: string;
  }>;
  totals: {
    subjects_count: number;
    mandatory_count: number;
    elective_count: number;
    total_periods: number;
    total_hours: number;
    subjects_tuition: number;
    services_tuition: number;
    auto_tuition_fee: number;
    final_tuition_fee: number;
    is_tuition_overridden: boolean;
  };
}

export interface CurriculumBlueprintData extends CurriculumStructureTotals {
  curriculum: {
    id: string;
    code: string;
    title: string;
    description: string;
    version: string;
    effective_date: string | null;
    status: CurriculumStatus;
    lifecycle_status: LifecycleStatus;
    program_type: 'INSTRUCTOR_LED' | 'SELF_PACED';
    delivery_mode: DeliveryMode;
    standard_duration_months: number;
    standard_duration_text: string;
    target_audience: string;
    entry_requirements: string;
    auto_tuition_fee: number;
    final_tuition_fee: number;
    is_tuition_overridden: boolean;
    graduation_criteria: {
      pass_all_mandatory: boolean;
      min_electives_passed: number;
      min_avg_score: number;
      min_attendance_pct: number;
      extra_requirements: string[];
      certificate_template_code: string;
    };
  };
  session_plans_by_course: Record<string, SessionPlanItem[]>;
  certificate_templates: Array<{ id: string; code: string; title: string; issuer_name: string }>;
  candidate_courses: Array<{ id: string; code: string; title: string; reference_tuition_fee: number; theory_periods: number; practice_periods: number; lifecycle_status: LifecycleStatus }>;
  versions: Array<{ id: string; version_number: number; version_label: string; changelog_note: string; published_by_name: string; published_at: string }>;
  audit_logs: Array<{ id: string; action_type: string; actor_name: string; payload: Record<string, unknown>; created_at: string }>;
  capabilities: { can_manage: boolean };
}

export interface CurriculumVersionCompareData {
  available_versions: Array<{ id: string; version_number: number; version_label: string; published_at: string }>;
  diff: {
    subjects_added: Array<{ course_id: string; code: string; title: string; periods: number }>;
    subjects_removed: Array<{ course_id: string; code: string; title: string; periods: number }>;
    subjects_changed: Array<{ course_id: string; code: string; title: string; old_periods: number; new_periods: number }>;
    periods_before: number;
    periods_after: number;
    tuition_before: number;
    tuition_after: number;
    graduation_changed: boolean;
  } | null;
}

export interface CampusItem {
  id: string;
  code: string;
  name: string;
  address: string;
  open_time: string;
  close_time: string;
  travel_buffers: Record<string, number>;
}

export interface ClassroomItem {
  id: string;
  campus_id: string;
  campus_code?: string;
  campus_name?: string;
  code: string;
  name: string;
  room_type: RoomType;
  capacity: number;
  equipment_note: string;
}

export interface ShiftPresetItem {
  id: string;
  code: string;
  title: string;
  start_time: string;
  end_time: string;
  periods_count: number;
}

export interface AcademicHolidayItem {
  id: string;
  campus_id: string | null;
  title: string;
  start_date: string;
  end_date: string;
  is_recurring_yearly: number | boolean;
  note: string;
}

export interface InstructorAvailabilityItem {
  id: string;
  instructor_id: string;
  instructor_name?: string;
  instructor_code?: string;
  rule_type: 'WEEKLY' | 'DATE';
  weekday: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  status: 'BUSY' | 'AVAILABLE';
  note: string;
}

export interface FacilitiesOverview {
  campuses: CampusItem[];
  classrooms: ClassroomItem[];
  shifts: ShiftPresetItem[];
  holidays: AcademicHolidayItem[];
  instructors: Array<{ id: string; code: string; full_name: string; email: string; department_id: string | null }>;
  availabilities: InstructorAvailabilityItem[];
  capabilities: { can_manage_facilities: boolean };
}

export interface TimetableSessionItem {
  id: string;
  class_id: string;
  class_code: string;
  class_title: string;
  cohort_id: string | null;
  course_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  date: string;
  start_time: string;
  end_time: string;
  schedule_state: 'UNSCHEDULED' | 'DRAFT' | 'PUBLISHED';
  session_status: string;
  session_kind: 'REGULAR' | 'MAKEUP';
  planned_periods: number;
  campus_id: string | null;
  campus_code: string;
  campus_name: string;
  classroom_id: string | null;
  classroom_code: string;
  classroom_name: string;
  classroom_capacity: number | null;
  instructor_id: string | null;
  instructor_name: string;
  is_substitute: boolean;
  merged_group_code: string | null;
  delivery_mode: DeliveryMode;
}

export interface UnscheduledSessionItem {
  id: string;
  class_id: string;
  class_code: string;
  class_title: string;
  title: string;
  planned_periods: number;
  required_room_type: RoomType;
  instructor_id: string | null;
  instructor_name: string;
}

export interface TimetableGridData {
  from: string;
  to: string;
  items: TimetableSessionItem[];
  unscheduled_items: UnscheduledSessionItem[];
}

export interface TimetableSlotHint {
  date: string;
  shift_code: string;
  shift_title: string;
  start_time: string;
  end_time: string;
  valid: boolean;
  conflicts: Array<{ code: string; message: string }>;
}

export interface TimetableAuditReport {
  checked_classes: number;
  total_conflicts: number;
  classes: Array<{
    class_id: string;
    class_code: string;
    class_title: string;
    planned_periods: number;
    scheduled_periods: number;
    unscheduled_sessions: number;
    is_hours_sufficient: boolean;
    conflicts_count: number;
    conflicts: Array<{ session_id: string; session_title: string; date: string; code: string; message: string }>;
  }>;
}

export interface InstructorQuotaRow {
  instructor_id: string;
  instructor_code: string;
  instructor_name: string;
  email: string;
  department_id: string | null;
  department_name: string;
  period_key: string;
  standard_periods: number;
  standard_hours: number;
  note: string;
}

export interface TeachingHoursAnalytics {
  period_month: string;
  from: string;
  to: string;
  totals: {
    total_sessions: number;
    confirmed_sessions: number;
    substitute_sessions: number;
    makeup_sessions: number;
    cancelled_sessions: number;
    theory_periods: number;
    practice_periods: number;
    online_periods: number;
    total_periods: number;
    total_hours: number;
    overtime_hours: number;
  };
  by_instructor: Array<{
    instructor_id: string;
    instructor_name: string;
    department_id: string | null;
    total_sessions: number;
    confirmed_sessions: number;
    regular_sessions: number;
    substitute_sessions: number;
    substituted_out_sessions: number;
    makeup_sessions: number;
    cancelled_sessions: number;
    theory_periods: number;
    practice_periods: number;
    online_periods: number;
    total_periods: number;
    total_hours: number;
    quota_periods: number;
    quota_hours: number;
    overtime_periods: number;
    overtime_hours: number;
  }>;
  by_course: Array<{
    course_id: string | null;
    course_code: string;
    course_title: string;
    sessions_count: number;
    theory_periods: number;
    practice_periods: number;
    online_periods: number;
    total_periods: number;
    total_hours: number;
  }>;
  by_class: Array<{
    class_id: string;
    class_code: string;
    class_title: string;
    course_code: string;
    sessions_count: number;
    substitute_sessions: number;
    makeup_sessions: number;
    total_periods: number;
    total_hours: number;
  }>;
  sessions: Array<{
    session_id: string;
    class_id: string;
    class_code: string;
    class_title: string;
    course_code: string;
    course_title: string;
    session_title: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
    actual_start_at: string;
    actual_end_at: string;
    scheduled_instructor_id: string;
    scheduled_instructor_name: string;
    actual_instructor_id: string;
    actual_instructor_name: string;
    is_substitute: boolean;
    substitute_reason: string;
    session_kind: 'REGULAR' | 'MAKEUP';
    session_status: string;
    confirmation_status: string;
    hour_category: 'THEORY' | 'PRACTICE' | 'ONLINE';
    periods: number;
    hours: number;
    timesheet_locked_id: string | null;
  }>;
}

export interface TeachingTimesheetItem {
  id: string;
  period_month: string;
  instructor_id: string;
  instructor_name: string;
  department_id: string | null;
  total_sessions: number;
  regular_sessions: number;
  substitute_sessions: number;
  makeup_sessions: number;
  cancelled_sessions: number;
  theory_periods: number;
  practice_periods: number;
  online_periods: number;
  total_periods: number;
  total_hours: number;
  quota_hours: number;
  overtime_hours: number;
  status: 'DRAFT' | 'PENDING_TEACHER' | 'DISPUTED' | 'TEACHER_CONFIRMED' | 'APPROVED' | 'LOCKED';
  teacher_note: string | null;
  review_note: string | null;
  teacher_confirmed_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  locked_by_name: string | null;
  locked_at: string | null;
  finance_batch_code: string | null;
  updated_at: string;
}

export interface TeachingTimesheetLineItem {
  id: string;
  timesheet_id: string;
  session_id: string;
  subject_class_id: string;
  class_code: string;
  course_code: string;
  course_title: string;
  session_title: string;
  session_date: string;
  start_at: string;
  end_at: string;
  hour_category: 'THEORY' | 'PRACTICE' | 'ONLINE';
  role_kind: 'PRIMARY' | 'SUBSTITUTE' | 'MAKEUP';
  periods: number;
  hours: number;
}

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
