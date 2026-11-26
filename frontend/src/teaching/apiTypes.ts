/**
 * LMSPLUS — Shared TypeScript Domain Types for Teaching & Master LMS API.
 * Tách khỏi teaching/api.ts ở Phase 2 để giảm kích thước module và dùng chung an toàn.
 */

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

export interface LessonBlockContent {
  id?: string;
  label?: string;
  title?: string;
  text?: string;
  caption?: string;
  alt?: string;
  cite?: string;
  description?: string;
  instructions?: string;
  variant?: 'learning_objective' | 'definition' | 'remember' | 'note' | 'warning' | 'exam_tip' | 'summary' | string;
  level?: 2 | 3 | number;
  url?: string;
  direct_url?: string;
  embed_url?: string;
  stream_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  resource_id?: string;
  source_type?: 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL' | string;
  provider?: string;
  start_seconds?: number;
  duration_seconds?: number;
  height?: number;
  allow_download?: boolean;
  allow_seeking_ahead?: boolean;
  has_header?: boolean;
  rows?: string[][];
  latex?: string;
  code?: string;
  language?: string;
  question?: string;
  prompt?: string;
  options?: Array<{ id?: string; text?: string; is_correct?: boolean; feedback?: string }>;
  quiz_kind?: QuizKind;
  pass_score_pct?: number;
  max_attempts?: number;
  is_required?: boolean;
  show_answer_after_submit?: boolean;
  show_explanation?: boolean;
  questions?: QuestionSpec[];
  due_at?: string;
  max_score?: number;
  submission_type?: 'TEXT' | 'FILE' | 'LINK' | 'MIXED' | 'BOTH' | string;
  problem?: string;
  steps?: Array<{ title?: string; explanation?: string }>;
  lessons?: Array<{ lesson_id?: string; id?: string; title?: string; note?: string; description?: string }>;
  display?: BlockDisplayConfig;
  [key: string]: unknown;
}

export interface LessonBlock {
  id: string;
  block_type: BlockType;
  sort_order?: number;
  anchor_block_id?: string | null;
  origin?: 'INHERITED' | 'CLASS_CUSTOM';
  is_published?: boolean;
  content: LessonBlockContent;
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
    correct_answer?: Record<string, unknown>;
    explanation?: string;
  } | null;
  learner_state: {
    completed: boolean;
    attempts_used: number;
    is_correct: boolean;
    best_points: number;
    can_retry: boolean;
    last_response: Record<string, unknown> | null;
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
  last_feedback: Record<string, unknown> | null;
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
  correct_answer?: Record<string, unknown>;
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
    correct_answer?: Record<string, unknown>;
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
  wiki_pages?: WikiPageItem[];
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
  wiki_pages?: WikiPageItem[];
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
    provider_metadata: Record<string, unknown>;
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
  wiki_pages?: WikiPageItem[];
  progress_status: 'IN_PROGRESS' | 'COMPLETED';
  position: { index: number; total: number };
  prev_lesson: { id: string; title: string } | null;
  next_lesson: { id: string; title: string } | null;
}


export type CurriculumStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CohortStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type ExamScopeType = 'COURSE' | 'TOPIC' | 'CHAPTER' | 'LESSON';
export type ScoringPolicy = 'HIGHEST' | 'LATEST' | 'AVERAGE';
export type AssignmentSubmissionType = 'TEXT' | 'FILE' | 'LINK' | 'MIXED';
export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveReasonCategory = 'SICK' | 'FAMILY' | 'OFFICIAL_DUTY' | 'ACADEMIC_CONFLICT' | 'OTHER';
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
  audit_logs: Array<{ id: string; action: string; actor_name: string; payload: Record<string, unknown>; created_at: string }>;
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
  audit_logs: Array<{ id: string; action: string; actor_name: string; payload: Record<string, unknown>; created_at: string }>;
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
  rubric?: RubricItem[];
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

export interface RubricItem {
  id: string;
  criterion: string;
  description?: string;
  max_points: number;
}

export interface RubricScoreItem {
  criterion_id: string;
  criterion: string;
  max_points: number;
  points: number;
  comment?: string;
}

export interface GradeAppealItem {
  id: string;
  target_type: 'ASSIGNMENT' | 'EXAM';
  target_id: string;
  target_title?: string;
  submission_or_attempt_id: string;
  subject_class_id: string;
  class_code?: string;
  class_title?: string;
  student_id: string;
  student_code?: string;
  student_name?: string;
  reason: string;
  current_score: number | null;
  requested_score: number | null;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  reviewer_id: string | null;
  reviewer_name: string | null;
  final_score: number | null;
  resolution_note: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
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
  rubric?: RubricItem[];
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
  attachments: Array<{ title?: string; name?: string; url: string; file_name?: string; mime_type?: string; size_bytes?: number }>;
  rubric_scores?: RubricScoreItem[];
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

export interface ExamAttemptDetail {
  id: string;
  student_id?: string;
  student_code?: string;
  student_name?: string;
  attempt_number: number;
  grading_status: 'IN_PROGRESS' | 'PENDING_MANUAL' | 'GRADED';
  auto_score: number;
  manual_score: number;
  total_score: number;
  max_score: number;
  teacher_feedback: string;
  answers: Record<string, unknown>;
  item_grades: Record<string, { earned_points?: number; is_correct?: boolean; feedback?: string } | unknown>;
  started_at: string;
  submitted_at: string | null;
  graded_at?: string | null;
  remaining_seconds?: number;
  questions?: Array<{ id: string; question_type: QuestionType; prompt: string; points: number; options: Array<{ id: string; text: string }> }>;
}

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
