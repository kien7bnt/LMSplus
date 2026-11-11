/**
 * LMSPLUS E-Learning Extension — Core TypeScript Domain Contracts
 * Synchronized with PostgreSQL Schema (`06-database-design.md`) & API (`08-api-specification.md`)
 */

export type UserRole =
  | 'STUDENT'
  | 'TEACHING_ASSISTANT'
  | 'INSTRUCTOR'
  | 'ACADEMIC_STAFF'
  | 'ADMIN';

export type ThemeMode = 'airbnb-light' | 'cinema-dark' | 'babu-academy';

export interface TAPermissionFlags {
  can_manage_materials: boolean;
  can_manage_assignments: boolean;
  can_grade: boolean;
  can_moderate_forum: boolean;
  can_take_attendance: boolean;
}

/**
 * Business Rule #2 (LP-02): Hybrid Course Discovery & Enrollment Policy
 */
export type EnrollmentPolicy =
  | 'ASSIGNED_ONLY'     // Default: Formal curriculum assigned by Academic Staff
  | 'REQUEST_APPROVAL'  // Electives/Skills: Student submits request, awaits approval
  | 'SELF_ENROLL';      // Off by default: Explicitly enabled by ADMIN only

export interface DiscoverableCourse {
  id: string;
  code: string;
  title: string;
  instructor_name: string;
  department_name: string;
  chapters_count: number;
  lessons_count: number;
  progress_pct: number;
  enrollment_policy: EnrollmentPolicy;
  enrollment_status: 'ENROLLED' | 'PENDING_APPROVAL' | 'NOT_ENROLLED';
  is_assigned_to_student: boolean;
}

/**
 * Distinguishes CourseClass (Lớp khóa học / Cohort) vs SubjectClass (Lớp môn học / Section)
 */
export interface CourseClassOverview {
  id: string;
  course_id: string;
  code: string;
  name: string;
  overall_progress_pct: number;
  learning_outcomes: string[];
  subject_classes: SubjectClassSummary[];
}

export interface SubjectClassSummary {
  id: string;
  course_class_id: string;
  subject_id: string;
  code: string;
  subject_title: string;
  instructor_name: string;
  ta_names: string[];
  progress_pct: number;
  completed_lessons: number;
  total_lessons: number;
  next_session_at: string;
}

/**
 * Notion-Style Block Editor JSON Schema v1.0 (`schema_version: "1.0"`)
 */
export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'divider'
  | 'accordion'
  | 'tabs'
  | 'callout'
  | 'latex_math'
  | 'table'
  | 'step_by_step_solution'
  | 'inline_mcq'
  | 'true_false'
  | 'form_poll'
  | 'quick_check'
  | 'image'
  | 'video'
  | 'audio'
  | 'diagram_mermaid'
  | 'attachment'
  | 'code_block';

export type CalloutVariant =
  | 'learning_objective'
  | 'definition'
  | 'remember'
  | 'note'
  | 'warning'
  | 'exam_tip'
  | 'summary';

export interface LessonBlock {
  id: string;
  lesson_id: string;
  schema_version: '1.0';
  block_type: BlockType;
  sort_order: number;
  status: 'ACTIVE' | 'HIDDEN' | 'DRAFT_ONLY';
  shared_block_id?: string | null;
  content: Record<string, any>;
}

export interface CurriculumLessonNode {
  id: string;
  code: string;
  title: string;
  duration_minutes: number;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'LOCKED';
  unlock_condition_text?: string;
  last_video_position_sec: number;
  total_video_seconds: number;
}

export interface CurriculumChapterNode {
  id: string;
  code: string;
  title: string;
  progress_pct: number;
  lessons: CurriculumLessonNode[];
}

export interface WikiTermPopoverData {
  id: string;
  canonical_name: string;
  aliases: string[];
  subject_context: string;
  short_definition: string;
  formula_or_example?: string;
}

/**
 * Business Rule #3 (TW-14, TW-15): 24-Hour Teaching Log Confirmation
 */
export type TeachingLogConfirmationStatus =
  | 'AWAITING_CONFIRMATION' // Within 24h after scheduled_end_at
  | 'OVERDUE_UNCONFIRMED'   // > 24h after scheduled_end_at (NOT locked, allows late confirmation)
  | 'CONFIRMED'             // Confirmed on time (<= 24h)
  | 'CONFIRMED_LATE';       // Confirmed after 24h deadline

export interface TeachingSessionLogRecord {
  session_id: string;
  subject_class_code: string;
  subject_title: string;
  session_title: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  confirmation_deadline_at: string; // scheduled_end_at + 24 hours
  actual_start_at: string;
  actual_end_at: string;
  scheduled_instructor_name: string;
  actual_instructor_name: string;
  is_substitute_teaching: boolean;
  ta_names: string[];
  confirmation_status: TeachingLogConfirmationStatus;
  confirmed_at?: string | null;
  is_late_confirmation: boolean;
  late_confirmation_reason?: string;
  reminder_sent_count: number;
  lessons_delivery: Array<{
    lesson_id: string;
    lesson_title: string;
    delivery_status: 'COMPLETED' | 'PARTIAL' | 'DEFERRED';
    progress_note: string;
  }>;
}
