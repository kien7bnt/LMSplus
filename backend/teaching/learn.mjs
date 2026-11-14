/**
 * LMSPLUS Teaching Module — Không gian học của học viên (lớp của tôi, học bài, tiến độ video/quiz tương tác, điểm danh cá nhân).
 * Học viên chỉ xem nội dung ĐÃ XUẤT BẢN của khóa học gắn với lớp mình đang theo học (+ nội dung bổ sung đã xuất bản của lớp đó).
 */

import crypto from 'node:crypto';
import { fail, nowIso, nowVn, text } from './http.mjs';
import { outline } from './courses.mjs';
import { getAttendancePolicy, rateFromCounts } from './attendance.mjs';
import { getClassContentVersionKey } from './masterSchema.mjs';
import { recordStrictVideoProgress } from './strictVideo.mjs';
import {
  buildStudentLessonPayload,
  filterActiveMarkerSubs,
  getClassCourseSnapshot,
  getEffectiveLessonBaseBlocks,
  getEffectiveLessonBaseMarkers,
  getPublishedClassCustom,
  submitStandaloneQuizBlock,
  submitVideoMarkerAnswer,
} from './studio.mjs';
import { safeJson } from './scope.mjs';
import { virtualRoomSummaryDto } from './virtualClassroom.mjs';

function requireEnrollment(db, user, classId) {
  const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
  if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
  const e = db
    .prepare(`SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`)
    .get(cls.id, user.id);
  if (!e) fail(403, 'NOT_ENROLLED', 'Bạn chưa được ghi danh vào lớp học này.');
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(cls.status)) fail(403, 'CLASS_NOT_AVAILABLE', 'Lớp học hiện không mở cho học viên.');
  const course = cls.course_id ? db.prepare('SELECT * FROM courses WHERE id = ?').get(cls.course_id) : null;
  return { cls, course, enrollment: e };
}

function publishedOutlineForClass(db, cls, course) {
  const snapCtx = getClassCourseSnapshot(db, cls);
  if (snapCtx && Array.isArray(snapCtx.snapshot.chapters) && Array.isArray(snapCtx.snapshot.lessons)) {
    const lessonsByChapter = new Map();
    for (const l of snapCtx.snapshot.lessons) {
      const arr = lessonsByChapter.get(l.chapter_id) || [];
      arr.push(l);
      lessonsByChapter.set(l.chapter_id, arr);
    }
    const chapters = snapCtx.snapshot.chapters.map((ch) => ({
      id: ch.id,
      topic_id: ch.topic_id || null,
      title: ch.title,
      description: ch.description || '',
      sort_order: ch.sort_order,
      lessons: (lessonsByChapter.get(ch.id) || []).map((l) => ({
        ...l,
        chapter_id: ch.id,
        chapter_title: ch.title,
      })),
    }));
    const topics = Array.isArray(snapCtx.snapshot.topics) ? snapCtx.snapshot.topics : [];
    return { available: true, chapters, topics, snapCtx };
  }
  const available = Boolean(course && course.status === 'PUBLISHED');
  if (!available) return { available: false, chapters: [], topics: [], snapCtx: null };
  const chapters = outline(db, course.id, { publishedOnly: true });
  const topics = db
    .prepare("SELECT * FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, code")
    .all(course.id);
  return { available: true, chapters, topics, snapCtx: null };
}

function publishedLessonIdsForClass(db, cls, course) {
  const { chapters } = publishedOutlineForClass(db, cls, course);
  return chapters.flatMap((ch) =>
    ch.lessons.map((l) => ({ ...l, chapter_id: ch.id, chapter_title: ch.title, topic_id: ch.topic_id || null }))
  );
}

function studentProgress(db, userId, cls) {
  const verKey = getClassContentVersionKey(cls);
  return Object.fromEntries(
    db
      .prepare(
        'SELECT lesson_id, status, completed_at FROM lesson_progress WHERE student_id = ? AND subject_class_id = ? AND content_version_key = ?'
      )
      .all(userId, cls.id, verKey)
      .map((r) => [r.lesson_id, r])
  );
}

function loadLessonForStudent(db, user, classId, lessonId) {
  const { cls, course } = requireEnrollment(db, user, classId);
  const { available, snapCtx } = publishedOutlineForClass(db, cls, course);
  if (!available) fail(403, 'COURSE_NOT_PUBLISHED', 'Nội dung khóa học đang được chuẩn bị.');
  const list = publishedLessonIdsForClass(db, cls, course);
  const idx = list.findIndex((l) => l.id === lessonId);
  if (idx === -1) fail(403, 'LESSON_NOT_AVAILABLE', 'Bài học chưa được xuất bản hoặc không thuộc lớp của bạn.');
  const dbLesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  const snapLesson = snapCtx?.snapshot?.lessons?.find((l) => l.id === lessonId);
  const effectiveLesson = snapLesson ? { ...dbLesson, ...snapLesson } : dbLesson;
  return { cls, course, list, idx, lesson: effectiveLesson };
}

function mergedPublishedBlocksForClass(db, lessonId, cls) {
  const baseBlocks = getEffectiveLessonBaseBlocks(db, cls, lessonId);
  const publishedCustom = getPublishedClassCustom(db, cls.id, lessonId);
  if (!publishedCustom) return baseBlocks;
  return [...baseBlocks, ...publishedCustom.blocks];
}

export function registerLearnRoutes(route, { jwtSecret = 'lmsplus-production-grade-hmac-secret-2026' } = {}) {
  route('GET', '/learn/classes', ({ db, user }) => {
    const rows = db
      .prepare(
        `SELECT sc.*, e.enrollment_source FROM class_enrollments e JOIN subject_classes sc ON sc.id = e.subject_class_id
         WHERE e.student_id = ? AND e.status = 'ACTIVE' AND sc.status NOT IN ('DRAFT','CANCELLED','ARCHIVED')
         ORDER BY sc.code`
      )
      .all(user.id);
    const now = nowVn();
    return {
      items: rows.map((cls) => {
        const course = cls.course_id ? db.prepare('SELECT id, code, title, status, thumbnail_url FROM courses WHERE id = ?').get(cls.course_id) : null;
        const cohort = cls.cohort_id ? db.prepare('SELECT id, code, title FROM program_cohorts WHERE id = ?').get(cls.cohort_id) : null;
        const courseVersion = cls.course_version_id
          ? db.prepare('SELECT id, version_number, version_label FROM course_versions WHERE id = ?').get(cls.course_version_id)
          : null;
        const lessons = publishedLessonIdsForClass(db, cls, course);
        const prog = studentProgress(db, user.id, cls);
        const done = lessons.filter((l) => prog[l.id]?.status === 'COMPLETED').length;
        const next = db
          .prepare(
            `SELECT session_id, session_title, scheduled_start_at, scheduled_end_at, room_or_link,
                    delivery_mode, virtual_room_id, live_status, attendance_sync_status
             FROM sessions
             WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at >= ?
             ORDER BY scheduled_start_at LIMIT 1`
          )
          .get(cls.id, now);
        const instructor = db
          .prepare(`SELECT u.full_name FROM teaching_staff_assignments t JOIN users u ON u.id = t.user_id
                    WHERE t.subject_class_id = ? AND t.staff_role = 'PRIMARY_INSTRUCTOR' AND t.is_active = 1 LIMIT 1`)
          .get(cls.id);
        const resume = lessons.find((l) => prog[l.id]?.status !== 'COMPLETED');
        return {
          id: cls.id,
          code: cls.code,
          title: cls.title,
          subject: cls.subject || '',
          enrollment_source: cls.enrollment_source || 'ACADEMIC_ASSIGNED',
          cohort,
          course_version: courseVersion,
          instructor_name: instructor ? instructor.full_name : cls.instructor_name,
          course: course ? { id: course.id, title: course.title, status: course.status, thumbnail_url: course.thumbnail_url || '' } : null,
          progress: { completed: done, total: lessons.length, pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0 },
          resume_lesson_id: resume ? resume.id : null,
          next_session: next ? { ...next, virtual_room: virtualRoomSummaryDto(db, next) } : null,
        };
      }),
    };
  });

  route('GET', '/learn/classes/:id', ({ db, user, params }) => {
    const { cls, course, enrollment } = requireEnrollment(db, user, params.id);
    const prog = studentProgress(db, user.id, cls);
    const { available, chapters: rawChapters, topics, snapCtx } = publishedOutlineForClass(db, cls, course);
    const cohort = cls.cohort_id ? db.prepare('SELECT id, code, title FROM program_cohorts WHERE id = ?').get(cls.cohort_id) : null;
    const courseVersion = snapCtx?.version
      ? { id: snapCtx.version.id, version_number: snapCtx.version.version_number, version_label: snapCtx.version.version_label }
      : null;
    const chapters = available
      ? rawChapters
          .map((ch) => ({
            id: ch.id,
            topic_id: ch.topic_id || null,
            title: ch.title,
            description: ch.description,
            lessons: ch.lessons.map((l) => ({
              id: l.id,
              title: l.title,
              duration_minutes: l.duration_minutes,
              progress_status: prog[l.id]?.status || 'NOT_STARTED',
            })),
          }))
          .filter((ch) => ch.lessons.length > 0)
      : [];
    const all = chapters.flatMap((c) => c.lessons);
    const done = all.filter((l) => l.progress_status === 'COMPLETED').length;
    const now = nowVn();
    const upcomingSessions = db
      .prepare(
        `SELECT * FROM sessions
         WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at >= ?
         ORDER BY scheduled_start_at ASC LIMIT 6`
      )
      .all(cls.id, now)
      .map((s) => ({
        id: s.session_id,
        title: s.session_title,
        teaching_content: s.teaching_content || '',
        start_at: s.scheduled_start_at,
        end_at: s.scheduled_end_at,
        room_or_link: s.room_or_link || '',
        delivery_mode: s.delivery_mode || 'OFFLINE',
        live_status: s.live_status || 'NOT_STARTED',
        instructor_name: s.actual_instructor_name || s.scheduled_instructor_name || cls.instructor_name || '',
        virtual_room: virtualRoomSummaryDto(db, s),
      }));
    return {
      class: {
        id: cls.id,
        code: cls.code,
        title: cls.title,
        room: cls.room || '',
        schedule_text: cls.schedule_text || '',
        instructor_name: cls.instructor_name || '',
        enrollment_source: enrollment.enrollment_source || 'ACADEMIC_ASSIGNED',
        cohort,
        course_version: courseVersion,
      },
      course: course ? { id: course.id, title: course.title, description: course.description || '', objectives: course.objectives || '', status: course.status } : null,
      content_available: Boolean(available),
      topics,
      chapters,
      upcoming_sessions: upcomingSessions,
      progress: { completed: done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 },
    };
  });

  route('GET', '/learn/classes/:id/lessons/:lessonId', ({ db, user, params }) => {
    const { cls, list, idx, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const verKey = getClassContentVersionKey(cls);
    const now = nowIso();
    db.prepare(
      `INSERT INTO lesson_progress (id, student_id, subject_class_id, chapter_id, lesson_id, content_version_key, status, started_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id, content_version_key) DO UPDATE SET last_accessed_at = excluded.last_accessed_at`
    ).run(crypto.randomUUID(), user.id, cls.id, list[idx].chapter_id, lesson.id, verKey, now, now);

    return buildStudentLessonPayload(db, {
      user,
      cls,
      lesson,
      chapterInfo: { id: list[idx].chapter_id, title: list[idx].chapter_title },
      idx,
      list,
      jwtSecret,
    });
  });

  // Lưu tiến độ xem video theo chế độ STRICT (Interval Union + chống tua vượt + hàng đợi idempotent)
  route('PUT', '/learn/classes/:id/lessons/:lessonId/video-progress', ({ db, user, body, params }) => {
    const { cls, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const blockId = text(body, 'block_id', { required: true, max: 64, label: 'mã khối video' });
    const allBlocks = mergedPublishedBlocksForClass(db, lesson.id, cls);
    const vBlock = allBlocks.find((b) => b.id === blockId && ['video', 'youtube'].includes(b.block_type));
    if (!vBlock) fail(404, 'VIDEO_BLOCK_NOT_FOUND', 'Không tìm thấy khối video trong bài học.');

    return recordStrictVideoProgress(db, { user, cls, lesson, vBlock, body });
  });

  // Nộp câu trả lời tại mốc tương tác trong video (có idempotency_key chống gửi trùng)
  route('POST', '/learn/classes/:id/lessons/:lessonId/video-markers/:markerId/submit', ({ db, user, body, params }) => {
    const { cls, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    return submitVideoMarkerAnswer(db, { user, cls, lesson, markerId: params.markerId, body });
  });

  // Nộp bài kiểm tra độc lập (Quiz block trong bài học)
  route('POST', '/learn/classes/:id/lessons/:lessonId/quizzes/:blockId/submit', ({ db, user, body, params }) => {
    const { cls, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    return submitStandaloneQuizBlock(db, { user, cls, lesson, blockId: params.blockId, body });
  });

  // Giữ nguyên tương thích ngược cho review_question / inline_mcq
  route('POST', '/learn/classes/:id/lessons/:lessonId/check', ({ db, user, body, params }) => {
    const { cls, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const block = mergedPublishedBlocksForClass(db, lesson.id, cls).find((b) => b.id === body.block_id);
    if (!block || !['review_question', 'inline_mcq'].includes(block.block_type)) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi.');
    const opt = (block.content.options || []).find((o) => o.id === body.option_id);
    if (!opt) fail(422, 'VALIDATION_ERROR', 'Phương án không hợp lệ.');
    return { correct: Boolean(opt.is_correct), feedback: opt.feedback || (opt.is_correct ? 'Chính xác!' : 'Chưa đúng, hãy thử lại.') };
  });

  route('POST', '/learn/classes/:id/lessons/:lessonId/complete', ({ db, user, body, params }) => {
    const { cls, list, idx, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const verKey = getClassContentVersionKey(cls);
    const rule = lesson.completion_rule || 'MANUAL';
    const allBlocks = mergedPublishedBlocksForClass(db, lesson.id, cls);

    // 1. Điều kiện câu hỏi ôn tập cũ (REVIEW_CORRECT)
    if (rule === 'REVIEW_CORRECT') {
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const questions = allBlocks.filter((b) => ['review_question', 'inline_mcq'].includes(b.block_type));
      const wrong = questions.filter((q) => {
        const opt = (q.content.options || []).find((o) => o.id === answers[q.id]);
        return !opt || !opt.is_correct;
      });
      if (wrong.length) {
        fail(
          422,
          'COMPLETION_CRITERIA_NOT_MET',
          `Cần trả lời đúng tất cả câu hỏi ôn tập (${questions.length - wrong.length}/${questions.length} câu đúng).`
        );
      }
    }

    // 2. Điều kiện tỷ lệ xem video tối thiểu (chế độ STRICT theo content_version_key)
    const minWatchPct = Number(lesson.min_video_watch_pct || 0);
    if (minWatchPct > 0) {
      const videoBlocks = allBlocks.filter((b) => ['video', 'youtube'].includes(b.block_type) && !b.content?.display?.hidden);
      for (const vb of videoBlocks) {
        const vp = db
          .prepare(
            'SELECT watch_pct FROM video_watch_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ? AND block_id = ? AND content_version_key = ?'
          )
          .get(user.id, cls.id, lesson.id, vb.id, verKey);
        const pct = Number(vp?.watch_pct || 0);
        if (pct < minWatchPct) {
          fail(
            422,
            'COMPLETION_CRITERIA_NOT_MET',
            `Bạn cần xem tối thiểu ${minWatchPct}% thời lượng video "${vb.content?.title || 'bài giảng'}" (hiện đạt ${pct}%).`
          );
        }
      }
    }

    // 3. Điều kiện câu hỏi tương tác trên video (VIDEO_AND_QUIZ)
    if (rule === 'VIDEO_AND_QUIZ' && Boolean(lesson.require_video_quizzes ?? 1)) {
      const publishedCustom = getPublishedClassCustom(db, cls.id, lesson.id);
      const reqMarkers = [
        ...getEffectiveLessonBaseMarkers(db, cls, lesson.id),
        ...(publishedCustom ? publishedCustom.markers : []),
      ].filter((m) => m.behavior === 'PAUSE_AND_ASK' && Boolean(m.is_required));

      const unmet = reqMarkers.filter((m) => {
        const rawSubs = db
          .prepare(
            `SELECT is_correct, feedback_json, submitted_at FROM lesson_quiz_submissions
             WHERE student_id = ? AND subject_class_id = ? AND target_type = 'VIDEO_MARKER' AND target_id = ? AND content_version_key = ?`
          )
          .all(user.id, cls.id, m.id, verKey);
        const subs = filterActiveMarkerSubs(rawSubs, m, allBlocks);
        if (subs.length === 0) return true;
        if (subs.some((s) => Boolean(s.is_correct))) return false;
        const maxAtt = Number(m.max_attempts ?? 2);
        return maxAtt === 0 || subs.length < maxAtt;
      });

      if (unmet.length > 0) {
        fail(
          422,
          'COMPLETION_CRITERIA_NOT_MET',
          `Bạn cần hoàn thành đầy đủ các câu hỏi tương tác bắt buộc trong video (còn ${unmet.length}/${reqMarkers.length} mốc chưa hoàn thành).`
        );
      }
    }

    // 4. Điều kiện khối Quiz độc lập có gắn bắt buộc (is_required = true)
    const reqQuizBlocks = allBlocks.filter((b) => b.block_type === 'quiz' && Boolean(b.content?.is_required));
    for (const qb of reqQuizBlocks) {
      const subs = db
        .prepare(
          `SELECT is_correct FROM lesson_quiz_submissions
           WHERE student_id = ? AND subject_class_id = ? AND target_type = 'QUIZ_BLOCK' AND target_id = ? AND content_version_key = ?`
        )
        .all(user.id, cls.id, qb.id, verKey);
      const maxAtt = Number(qb.content?.max_attempts ?? 3);
      const passed = subs.some((s) => Boolean(s.is_correct));
      const exhausted = maxAtt > 0 && subs.length >= maxAtt;
      if (!passed && !exhausted) {
        fail(
          422,
          'COMPLETION_CRITERIA_NOT_MET',
          `Bạn cần hoàn thành bài kiểm tra bắt buộc "${qb.content?.title || 'Kiểm tra kiến thức'}" trước khi đánh dấu hoàn thành bài học.`
        );
      }
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO lesson_progress (id, student_id, subject_class_id, chapter_id, lesson_id, content_version_key, status, started_at, last_accessed_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id, content_version_key) DO UPDATE SET status = 'COMPLETED',
         completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at), last_accessed_at = excluded.last_accessed_at`
    ).run(crypto.randomUUID(), user.id, cls.id, list[idx].chapter_id, lesson.id, verKey, now, now, now);
    return {
      lesson_id: lesson.id,
      progress_status: 'COMPLETED',
      next_lesson: idx < list.length - 1 ? { id: list[idx + 1].id, title: list[idx + 1].title } : null,
    };
  });

  route('GET', '/learn/classes/:id/attendance', ({ db, user, params }) => {
    const { cls } = requireEnrollment(db, user, params.id);
    const rows = db
      .prepare(
        `SELECT s.session_id, s.session_title, s.scheduled_start_at, s.session_status, s.attendance_saved_at,
           ar.attendance_status, ar.check_in_at, ar.check_in_method, ar.note
         FROM sessions s LEFT JOIN attendance_records ar ON ar.class_session_id = s.session_id AND ar.student_id = ?
         WHERE s.subject_class_id = ? AND s.scheduled_start_at <= ? ORDER BY s.scheduled_start_at DESC`
      )
      .all(user.id, cls.id, nowVn());
    const counts = {};
    for (const r of rows) if (r.session_status !== 'CANCELLED' && r.attendance_status) counts[r.attendance_status] = (counts[r.attendance_status] || 0) + 1;
    const policy = getAttendancePolicy(db);
    return { items: rows, counts, rate: rateFromCounts(counts, policy), policy };
  });
}
