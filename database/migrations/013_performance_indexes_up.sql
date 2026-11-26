-- Migration 013 UP: Composite Indexes tối ưu truy vấn N+1, Dashboard, Điểm danh, Tiến độ & Khảo thí
BEGIN;

CREATE INDEX IF NOT EXISTS idx_lessons_chapter_sort
  ON lessons(chapter_id, publish_status, sort_order);

CREATE INDEX IF NOT EXISTS idx_sessions_class_sched_status
  ON sessions(subject_class_id, session_status, scheduled_start_at);

CREATE INDEX IF NOT EXISTS idx_class_enrollments_student_status
  ON class_enrollments(student_id, status, subject_class_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_status
  ON attendance_records(class_session_id, attendance_status);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_class_student
  ON lesson_progress(subject_class_id, student_id, status);

CREATE INDEX IF NOT EXISTS idx_class_exam_attempts_student
  ON class_exam_attempts(exam_id, student_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_class_assign_subs_student
  ON class_assignment_submissions(class_assignment_id, student_id, status, attempt_number);

INSERT INTO schema_migrations (id, applied_at)
VALUES ('013_performance_indexes', '2026-11-25T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

COMMIT;
