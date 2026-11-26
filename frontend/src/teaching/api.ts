/**
 * LMSPLUS — Client API cho module Giảng dạy & Lesson Studio (/api/v1/teaching).
 * Mọi dữ liệu đều lấy từ Backend thật; không có dữ liệu giả trong giao diện.
 */

import { apiRequest, apiDownload } from '../api/elearningClient';

const T = '/api/v1/teaching';

import type { CourseStatus, ClassStatus, DeliveryMode, AttendanceStatus, LessonStatus, CompletionRule, QuestionType, MarkerBehavior, QuizKind, Paged, AttendancePolicy, TeachingMe, Course, OutlineLesson, EnrollmentSource, CourseTopicSummary, OutlineChapter, CourseDetail, CourseStats, BlockType, BlockDisplayConfig, LessonBlock, QuestionOptionSpec, QuestionSpec, QuestionBankItem, VideoQuizMarker, StudentVideoMarker, VideoWatchProgress, QuizBlockState, MarkerSubmitResult, QuizSubmitResult, LessonEditorData, Resource, StudioCourseData, StudioClassData, StudioClassLessonData, LessonVersionItem, VideoLinkValidation, ClassQuizAnalytics, YouTubeCheck, StaffMember, SessionSummary, VirtualProviderType, VirtualAttendanceStatus, VirtualSyncStatus, VirtualRoomSummary, VirtualProviderConfig, VirtualParticipantSession, VirtualMergedInterval, VirtualAttendanceRow, VirtualAttendanceRules, VirtualSessionDetail, VirtualJoinResult, VirtualAttendanceHistory, ClassCapabilities, ClassSummary, ClassDetail, RosterStudent, EnrollResult, AttendanceRow, AttendanceSheet, AttendanceHistoryItem, AttendanceStats, QrState, Dashboard, LearnClass, LearnClassDetail, LearnLesson, CurriculumStatus, CohortStatus, ExamScopeType, ScoringPolicy, AssignmentSubmissionType, LeaveRequestStatus, LeaveReasonCategory, ForumCategory, CurriculumItem, CurriculumSubjectItem, CohortSummary, CurriculumDetail, CohortStudentProgressRow, CohortDetail, ContentTreeLesson, ContentTreeChapter, ContentTreeTopic, CourseVersionSummary, WikiPageItem, WikiPageDetail, BankTreeCourse, BankQuestionRow, AssignmentBankItem, BankResourceItem, ClassExamItem, StudentExamItem, RubricItem, RubricScoreItem, GradeAppealItem, ClassAssignmentItem, AssignmentSubmissionRow, StudentAssignmentItem, LeaveRequestItem, ForumInfo, ForumThreadItem, ForumReplyItem, NotificationItem, StudentOverviewData, ExamAttemptDetail, LifecycleStatus, RoomType, AssessmentSourceType, AssessmentComponentItem, SessionPlanItem, CourseTrainingProfile, CourseSyllabusData, CourseVersionCompareData, CurriculumStageItem, CurriculumStructureSubject, CurriculumServiceFeeItem, CurriculumStructureTotals, CurriculumBlueprintData, CurriculumVersionCompareData, CampusItem, ClassroomItem, ShiftPresetItem, AcademicHolidayItem, InstructorAvailabilityItem, FacilitiesOverview, TimetableSessionItem, UnscheduledSessionItem, TimetableGridData, TimetableSlotHint, TimetableAuditReport, InstructorQuotaRow, TeachingHoursAnalytics, TeachingTimesheetItem, TeachingTimesheetLineItem } from './apiTypes';
export * from './apiTypes';

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

export interface DepartmentItem {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  org_type: 'ORGANIZATION' | 'FACULTY' | 'DEPARTMENT' | 'CENTER';
  head_user_id: string | null;
  head_user_name?: string | null;
  head_user_code?: string | null;
  head_user_email?: string | null;
  description: string;
  is_active: boolean;
  courses_count?: number;
  members_count?: number;
  active_classes_count?: number;
  created_at: string;
  updated_at: string;
}

export interface DepartmentSummary {
  department: DepartmentItem;
  courses: Array<{
    id: string;
    code: string;
    title: string;
    status: CourseStatus;
    syllabus_status?: string;
    current_version: number;
    instructor_id: string;
    instructor_name: string;
    updated_at: string;
  }>;
  pending_syllabus_courses: Array<{
    id: string;
    code: string;
    title: string;
    status: CourseStatus;
    syllabus_status?: string;
    instructor_name: string;
    updated_at: string;
  }>;
  pending_curricula: Array<{
    id: string;
    code: string;
    title: string;
    academic_year?: string;
    status: string;
    total_credits?: number;
    updated_at: string;
  }>;
  members: ManagedUserItem[];
  can_approve_academic: boolean;
}

export interface ManagedUserItem {
  id: string;
  code: string;
  email: string;
  full_name: string;
  roles: string[];
  department_id: string | null;
  is_active: boolean;
  token_version: number;
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
  listUsers: (p: { role?: string; q?: string; department_id?: string; include_inactive?: 1 | 0 } = {}) =>
    get<{ items: ManagedUserItem[]; total: number; capabilities: { can_create: boolean; can_manage: boolean } }>(`/users${qs(p)}`),
  createUser: (body: { full_name: string; email: string; code?: string; roles: string[]; department_id?: string | null; password: string }) =>
    send<ManagedUserItem>('POST', '/users', body),
  updateUser: (id: string, body: { full_name?: string; email?: string; code?: string; roles?: string[]; department_id?: string | null; is_active?: boolean; password?: string }) =>
    send<ManagedUserItem>('PATCH', `/users/${id}`, body),
  deleteUser: (id: string) => send<{ deactivated_id: string; is_active: boolean }>('DELETE', `/users/${id}`),

  // Tổ chức / Khoa / Bộ môn
  listDepartments: (p: { q?: string; active_only?: 1 | 0 } = {}) =>
    get<{ items: DepartmentItem[]; capabilities: { can_manage: boolean } }>(`/departments${qs(p)}`),
  getDepartmentSummary: (id: string) => get<DepartmentSummary>(`/departments/${id}/summary`),
  createDepartment: (body: { code: string; name: string; org_type?: DepartmentItem['org_type']; parent_id?: string | null; head_user_id?: string | null; description?: string }) =>
    send<DepartmentItem>('POST', '/departments', body),
  updateDepartment: (id: string, body: { code?: string; name?: string; org_type?: DepartmentItem['org_type']; parent_id?: string | null; head_user_id?: string | null; description?: string; is_active?: boolean }) =>
    send<DepartmentItem>('PATCH', `/departments/${id}`, body),
  deleteDepartment: (id: string) => send<{ deleted_id: string }>('DELETE', `/departments/${id}`),

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
    } catch (err: unknown) {
      if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
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
    body: { idempotency_key: string; response: Record<string, unknown> }
  ) => send<MarkerSubmitResult>('POST', `/learn/classes/${classId}/lessons/${lessonId}/video-markers/${markerId}/submit`, body),
  submitLessonQuiz: (
    classId: string,
    lessonId: string,
    blockId: string,
    body: { idempotency_key: string; responses: Record<string, Record<string, unknown>> }
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


interface RawForumDto {
  id: string;
  scope_type: 'COURSE' | 'CLASS';
  course_id?: string | null;
  subject_class_id?: string | null;
  class_id?: string | null;
  title: string;
  description?: string;
}

function normalizeForum(f: RawForumDto): ForumInfo {
  return {
    id: f.id,
    scope_type: f.scope_type,
    course_id: f.course_id || null,
    class_id: f.subject_class_id || f.class_id || null,
    title: f.title,
    description: f.description || '',
  };
}

function mapStudentOverview(raw: Omit<StudentOverviewData, 'upcoming_sessions' | 'recent_grades'> & {
  upcoming_sessions?: Array<StudentOverviewData['upcoming_sessions'][number] & { subject_class_id?: string }>;
  recent_grades?: Array<StudentOverviewData['recent_grades'][number] & { subject_class_id?: string }>;
}): StudentOverviewData {
  return {
    ...raw,
    upcoming_sessions: (raw.upcoming_sessions || []).map((s) => ({ ...s, class_id: s.class_id || s.subject_class_id || '' })),
    recent_grades: (raw.recent_grades || []).map((g) => ({ ...g, class_id: g.class_id || g.subject_class_id || '' })),
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
  updateTopic: (topicId: string, body: Partial<{ code: string; title: string; description: string; status: LessonStatus; sort_order: number }>) =>
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
        answers: Record<string, unknown>;
        item_grades: Record<string, { earned_points?: number; is_correct?: boolean; feedback?: string } | unknown>;
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
        answers: Record<string, unknown>;
        item_grades: Record<string, { earned_points?: number; is_correct?: boolean; feedback?: string } | unknown>;
        started_at: string;
        submitted_at: string | null;
        remaining_seconds?: number;
        questions: Array<{ id: string; question_type: QuestionType; prompt: string; points: number; options: Array<{ id: string; text: string }> }>;
      };
    }>('POST', `/learn/exams/${examId}/start`, {}),
  saveStudentExamAttempt: (attemptId: string, answers: Record<string, unknown>) =>
    send<{ attempt_id: string; saved_at: string }>('PUT', `/learn/exam-attempts/${attemptId}/save`, { answers }),
  submitStudentExamAttempt: (attemptId: string, answers: Record<string, unknown>) =>
    send<{ exam: ClassExamItem; attempt: ExamAttemptDetail }>('POST', `/learn/exam-attempts/${attemptId}/submit`, { answers }),

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
  gradeAssignmentSubmission: (
    subId: string,
    body: {
      status: 'GRADED' | 'RETURNED';
      score?: number;
      teacher_feedback?: string;
      rubric_scores?: Array<{ criterion_id: string; criterion: string; max_points: number; points: number; comment?: string }>;
    }
  ) => send<AssignmentSubmissionRow>('POST', `/assignment-submissions/${subId}/grade`, body),
  listStudentAssignments: (p: { class_id?: string } = {}) => get<{ items: StudentAssignmentItem[] }>(`/learn/assignments${qs(p)}`),
  uploadAssignmentFile: (assignmentId: string, body: { file_name: string; mime_type?: string; content_base64: string }) =>
    send<{ file_name: string; name?: string; title?: string; mime_type: string; size_bytes: number; url: string }>(
      'POST',
      `/learn/assignments/${assignmentId}/upload`,
      body
    ),
  saveStudentAssignmentDraft: (
    assignmentId: string,
    body: { submission_text?: string; submission_link?: string; attachments?: Array<{ title?: string; name?: string; url: string }> }
  ) => send<AssignmentSubmissionRow>('PUT', `/learn/assignments/${assignmentId}/draft`, body),
  submitStudentAssignment: (
    assignmentId: string,
    body: { submission_text?: string; submission_link?: string; attachments?: Array<{ title?: string; name?: string; url: string }> }
  ) => send<AssignmentSubmissionRow>('POST', `/learn/assignments/${assignmentId}/submit`, body),

  // Phúc khảo điểm
  createGradeAppeal: (body: {
    target_type: 'ASSIGNMENT' | 'EXAM';
    submission_or_attempt_id: string;
    reason: string;
    requested_score?: number;
  }) => send<GradeAppealItem>('POST', '/learn/appeals', body),
  listStudentAppeals: (p: { class_id?: string } = {}) => get<{ items: GradeAppealItem[] }>(`/learn/appeals${qs(p)}`),
  listClassAppeals: (classId: string, p: { status?: string } = {}) => get<{ items: GradeAppealItem[] }>(`/classes/${classId}/appeals${qs(p)}`),
  reviewGradeAppeal: (
    appealId: string,
    body: { decision: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'; final_score?: number; resolution_note?: string }
  ) => send<GradeAppealItem>('POST', `/appeals/${appealId}/review`, body),

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
    const r = await get<{ forum: RawForumDto; threads: ForumThreadItem[]; can_moderate: boolean; can_post: boolean }>(`/courses/${courseId}/forum${qs(p)}`);
    return { ...r, forum: normalizeForum(r.forum) };
  },
  getClassForum: async (classId: string, p: { category?: string; search?: string; lesson_id?: string } = {}) => {
    const r = await get<{ forum: RawForumDto; threads: ForumThreadItem[]; can_moderate: boolean; can_post: boolean }>(`/classes/${classId}/forum${qs(p)}`);
    return { ...r, forum: normalizeForum(r.forum) };
  },
  getStudentClassForums: async (classId: string, p: { category?: string; search?: string; lesson_id?: string } = {}) => {
    const r = await get<{ class_forum: { forum: RawForumDto; threads: ForumThreadItem[]; can_moderate: boolean }; course_forum: { forum: RawForumDto; threads: ForumThreadItem[]; can_moderate: boolean } | null }>(`/learn/classes/${classId}/forums${qs(p)}`);
    return {
      class_forum: { ...r.class_forum, forum: normalizeForum(r.class_forum.forum) },
      course_forum: r.course_forum ? { ...r.course_forum, forum: normalizeForum(r.course_forum.forum) } : null,
    };
  },
  createForumThread: (forumId: string, body: { category: ForumCategory; title: string; body: string; lesson_id?: string | null; is_pinned?: boolean }) =>
    send<ForumThreadItem>('POST', `/forums/${forumId}/threads`, body),
  getForumThread: async (threadId: string) => {
    const r = await get<{ forum: RawForumDto; can_moderate: boolean; thread: ForumThreadItem; replies: ForumReplyItem[] }>(`/forum-threads/${threadId}`);
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
    const r = await get<Parameters<typeof mapStudentOverview>[0]>('/learn/overview');
    return mapStudentOverview(r);
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

