/**
 * LMSPLUS Teaching Module — Không gian học của học viên (lớp của tôi, học bài, tiến độ video/quiz tương tác, điểm danh cá nhân).
 * Học viên chỉ xem nội dung ĐÃ XUẤT BẢN của khóa học gắn với lớp mình đang theo học (+ nội dung bổ sung đã xuất bản của lớp đó).
 */

import crypto from 'node:crypto';
import { fail, nowIso, nowVn, text } from './http.mjs';
import { outline, latestPublishedBlocks } from './courses.mjs';
import { getAttendancePolicy, rateFromCounts } from './attendance.mjs';
import {
  buildStudentLessonPayload,
  getPublishedClassCustom,
  latestPublishedMarkers,
  submitStandaloneQuizBlock,
  submitVideoMarkerAnswer,
} from './studio.mjs';
import { safeJson } from './scope.mjs';

function requireEnrollment(db, user, classId) {
  const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
  if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
  const e = db
    .prepare(`SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`)
    .get(cls.id, user.id);
  if (!e) fail(403, 'NOT_ENROLLED', 'Bạn chưa được ghi danh vào lớp học này.');
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(cls.status)) fail(403, 'CLASS_NOT_AVAILABLE', 'Lớp học hiện không mở cho học viên.');
  const course = cls.course_id ? db.prepare('SELECT * FROM courses WHERE id = ?').get(cls.course_id) : null;
  return { cls, course };
}

function publishedLessonIds(db, courseId) {
  return outline(db, courseId, { publishedOnly: true }).flatMap((ch) =>
    ch.lessons.map((l) => ({ ...l, chapter_id: ch.id, chapter_title: ch.title }))
  );
}

function studentProgress(db, userId, classId) {
  return Object.fromEntries(
    db
      .prepare('SELECT lesson_id, status, completed_at FROM lesson_progress WHERE student_id = ? AND subject_class_id = ?')
      .all(userId, classId)
      .map((r) => [r.lesson_id, r])
  );
}

function loadLessonForStudent(db, user, classId, lessonId) {
  const { cls, course } = requireEnrollment(db, user, classId);
  if (!course || course.status !== 'PUBLISHED') fail(403, 'COURSE_NOT_PUBLISHED', 'Nội dung khóa học đang được chuẩn bị.');
  const list = publishedLessonIds(db, course.id);
  const idx = list.findIndex((l) => l.id === lessonId);
  if (idx === -1) fail(403, 'LESSON_NOT_AVAILABLE', 'Bài học chưa được xuất bản hoặc không thuộc lớp của bạn.');
  return { cls, course, list, idx, lesson: db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) };
}

function mergedPublishedBlocksForClass(db, lessonId, classId) {
  const baseBlocks = latestPublishedBlocks(db, lessonId);
  const publishedCustom = getPublishedClassCustom(db, classId, lessonId);
  if (!publishedCustom) return baseBlocks;
  return [...baseBlocks, ...publishedCustom.blocks];
}

export function registerLearnRoutes(route, { jwtSecret = 'lmsplus-production-grade-hmac-secret-2026' } = {}) {
  route('GET', '/learn/classes', ({ db, user }) => {
    const rows = db
      .prepare(
        `SELECT sc.* FROM class_enrollments e JOIN subject_classes sc ON sc.id = e.subject_class_id
         WHERE e.student_id = ? AND e.status = 'ACTIVE' AND sc.status NOT IN ('DRAFT','CANCELLED','ARCHIVED')
         ORDER BY sc.code`
      )
      .all(user.id);
    const now = nowVn();
    return {
      items: rows.map((cls) => {
        const course = cls.course_id ? db.prepare('SELECT id, code, title, status, thumbnail_url FROM courses WHERE id = ?').get(cls.course_id) : null;
        const lessons = course && course.status === 'PUBLISHED' ? publishedLessonIds(db, course.id) : [];
        const prog = studentProgress(db, user.id, cls.id);
        const done = lessons.filter((l) => prog[l.id]?.status === 'COMPLETED').length;
        const next = db
          .prepare(`SELECT session_id, session_title, scheduled_start_at, scheduled_end_at, room_or_link FROM sessions
                    WHERE subject_class_id = ? AND session_status <> 'CANCELLED' AND scheduled_end_at >= ? ORDER BY scheduled_start_at LIMIT 1`)
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
          instructor_name: instructor ? instructor.full_name : cls.instructor_name,
          course: course ? { id: course.id, title: course.title, status: course.status, thumbnail_url: course.thumbnail_url || '' } : null,
          progress: { completed: done, total: lessons.length, pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0 },
          resume_lesson_id: resume ? resume.id : null,
          next_session: next || null,
        };
      }),
    };
  });

  route('GET', '/learn/classes/:id', ({ db, user, params }) => {
    const { cls, course } = requireEnrollment(db, user, params.id);
    const prog = studentProgress(db, user.id, cls.id);
    const available = course && course.status === 'PUBLISHED';
    const chapters = available
      ? outline(db, course.id, { publishedOnly: true })
          .map((ch) => ({
            id: ch.id,
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
    return {
      class: { id: cls.id, code: cls.code, title: cls.title, room: cls.room || '', schedule_text: cls.schedule_text || '' },
      course: course ? { id: course.id, title: course.title, description: course.description || '', objectives: course.objectives || '', status: course.status } : null,
      content_available: Boolean(available),
      chapters,
      progress: { completed: done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 },
    };
  });

  route('GET', '/learn/classes/:id/lessons/:lessonId', ({ db, user, params }) => {
    const { cls, list, idx, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const now = nowIso();
    db.prepare(
      `INSERT INTO lesson_progress (id, student_id, subject_class_id, chapter_id, lesson_id, status, started_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id) DO UPDATE SET last_accessed_at = excluded.last_accessed_at`
    ).run(crypto.randomUUID(), user.id, cls.id, list[idx].chapter_id, lesson.id, now, now);

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

  // Lưu tiến độ xem video & vị trí đang xem dở (Resume Playback)
  route('PUT', '/learn/classes/:id/lessons/:lessonId/video-progress', ({ db, user, body, params }) => {
    const { cls, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const blockId = text(body, 'block_id', { required: true, max: 64, label: 'mã khối video' });
    const allBlocks = mergedPublishedBlocksForClass(db, lesson.id, cls.id);
    const vBlock = allBlocks.find((b) => b.id === blockId && ['video', 'youtube'].includes(b.block_type));
    if (!vBlock) fail(404, 'VIDEO_BLOCK_NOT_FOUND', 'Không tìm thấy khối video trong bài học.');

    const lastPos = Math.max(0, Math.round(Number(body.last_position_sec ?? 0) * 10) / 10);
    const watchedIn = Math.max(0, Math.round(Number(body.watched_seconds ?? 0) * 10) / 10);
    const durIn = Math.max(0, Math.round(Number(body.duration_sec ?? vBlock.content?.duration_seconds ?? 0) * 10) / 10);
    if (!Number.isFinite(lastPos) || !Number.isFinite(watchedIn) || !Number.isFinite(durIn)) {
      fail(422, 'INVALID_VIDEO_PROGRESS', 'Dữ liệu tiến độ video không hợp lệ.');
    }

    const existing = db
      .prepare(
        'SELECT * FROM video_watch_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ? AND block_id = ?'
      )
      .get(user.id, cls.id, lesson.id, blockId);

    const maxWatched = Math.max(Number(existing?.max_watched_sec || 0), lastPos);
    const totalWatched = Math.max(Number(existing?.watched_seconds || 0), watchedIn);
    const durationSec = durIn > 0 ? durIn : Number(existing?.duration_sec || 0);

    let computedPct = 0;
    if (durationSec > 0) {
      const covered = Math.max(maxWatched, Math.min(totalWatched, durationSec));
      computedPct = Math.min(100, Math.round((covered / durationSec) * 100));
    } else if (body.watch_pct != null && Number.isFinite(Number(body.watch_pct))) {
      computedPct = Math.max(0, Math.min(100, Math.round(Number(body.watch_pct))));
    }
    const watchPct = Math.max(Number(existing?.watch_pct || 0), computedPct);
    const configuredMinPct = Number(lesson.min_video_watch_pct || 0);
    const threshold = configuredMinPct > 0 ? configuredMinPct : 85;
    const isCompleted = watchPct >= threshold ? 1 : Number(existing?.is_completed || 0);
    const now = nowIso();

    db.prepare(
      `INSERT INTO video_watch_progress (
         id, student_id, subject_class_id, lesson_id, block_id,
         last_position_sec, max_watched_sec, watched_seconds, duration_sec, watch_pct, is_completed, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id, block_id) DO UPDATE SET
         last_position_sec = excluded.last_position_sec,
         max_watched_sec = excluded.max_watched_sec,
         watched_seconds = excluded.watched_seconds,
         duration_sec = excluded.duration_sec,
         watch_pct = excluded.watch_pct,
         is_completed = excluded.is_completed,
         updated_at = excluded.updated_at`
    ).run(
      crypto.randomUUID(),
      user.id,
      cls.id,
      lesson.id,
      blockId,
      lastPos,
      maxWatched,
      totalWatched,
      durationSec,
      watchPct,
      isCompleted,
      now
    );

    return {
      block_id: blockId,
      last_position_sec: lastPos,
      max_watched_sec: maxWatched,
      watched_seconds: totalWatched,
      duration_sec: durationSec,
      watch_pct: watchPct,
      is_completed: Boolean(isCompleted),
    };
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
    const block = mergedPublishedBlocksForClass(db, lesson.id, cls.id).find((b) => b.id === body.block_id);
    if (!block || !['review_question', 'inline_mcq'].includes(block.block_type)) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi.');
    const opt = (block.content.options || []).find((o) => o.id === body.option_id);
    if (!opt) fail(422, 'VALIDATION_ERROR', 'Phương án không hợp lệ.');
    return { correct: Boolean(opt.is_correct), feedback: opt.feedback || (opt.is_correct ? 'Chính xác!' : 'Chưa đúng, hãy thử lại.') };
  });

  route('POST', '/learn/classes/:id/lessons/:lessonId/complete', ({ db, user, body, params }) => {
    const { cls, list, idx, lesson } = loadLessonForStudent(db, user, params.id, params.lessonId);
    const rule = lesson.completion_rule || 'MANUAL';
    const allBlocks = mergedPublishedBlocksForClass(db, lesson.id, cls.id);

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

    // 2. Điều kiện tỷ lệ xem video tối thiểu
    const minWatchPct = Number(lesson.min_video_watch_pct || 0);
    if (minWatchPct > 0) {
      const videoBlocks = allBlocks.filter((b) => ['video', 'youtube'].includes(b.block_type) && !b.content?.display?.hidden);
      for (const vb of videoBlocks) {
        const vp = db
          .prepare(
            'SELECT watch_pct FROM video_watch_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ? AND block_id = ?'
          )
          .get(user.id, cls.id, lesson.id, vb.id);
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
        ...latestPublishedMarkers(db, lesson.id),
        ...(publishedCustom ? publishedCustom.markers : []),
      ].filter((m) => m.behavior === 'PAUSE_AND_ASK' && Boolean(m.is_required));

      const unmet = reqMarkers.filter((m) => {
        const subs = db
          .prepare(
            `SELECT is_correct FROM lesson_quiz_submissions
             WHERE student_id = ? AND subject_class_id = ? AND target_type = 'VIDEO_MARKER' AND target_id = ?`
          )
          .all(user.id, cls.id, m.id);
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
           WHERE student_id = ? AND subject_class_id = ? AND target_type = 'QUIZ_BLOCK' AND target_id = ?`
        )
        .all(user.id, cls.id, qb.id);
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
      `INSERT INTO lesson_progress (id, student_id, subject_class_id, chapter_id, lesson_id, status, started_at, last_accessed_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id) DO UPDATE SET status = 'COMPLETED',
         completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at), last_accessed_at = excluded.last_accessed_at`
    ).run(crypto.randomUUID(), user.id, cls.id, list[idx].chapter_id, lesson.id, now, now, now);
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
