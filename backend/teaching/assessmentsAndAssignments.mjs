/**
 * Đánh giá theo Lớp môn học (Không gian Kiểm tra, Bài tập tách biệt & Sổ điểm):
 * - Bài kiểm tra theo lớp (class_exams, class_exam_questions, class_exam_attempts)
 * - Bài tập giao theo lớp (class_assignments, class_assignment_submissions)
 * - Tự chấm câu hỏi khách quan & chấm thủ công tự luận/bài tập
 * - Sổ điểm tổng hợp theo từng lớp môn học (class_gradebook_entries)
 */

import crypto from 'node:crypto';
import { fail, nowIso, text, intField, oneOf, tx, compareVietnameseName } from './http.mjs';
import { isAdmin, safeJson } from './scope.mjs';
import { requireClassAccess, getClass } from './classes.mjs';
import { getClassContentVersionKey, resolveLessonTreeIds } from './masterSchema.mjs';
import {
  normalizeQuestionSpec,
  stripQuestionForStudent,
  gradeQuestionResponse,
  QuizValidationError,
} from './quizEngine.mjs';

function requireStaffViewClass(db, user, classId) {
  const ctx = requireClassAccess(db, user, classId);
  if (!ctx.caps.can_view_roster) {
    fail(403, 'CLASS_VIEW_FORBIDDEN', 'Bạn không có quyền xem dữ liệu đánh giá của lớp môn học này.');
  }
  return ctx;
}

function requireStaffManageClass(db, user, classId) {
  const ctx = requireClassAccess(db, user, classId);
  if (!ctx.caps.can_manage_class) {
    fail(403, 'CLASS_MANAGE_FORBIDDEN', 'Bạn không có quyền tạo, chỉnh sửa hoặc chấm điểm trong lớp môn học này.');
  }
  return ctx;
}

function requireStudentInClass(db, user, classId) {
  const cls = getClass(db, classId);
  if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp môn học.');
  const enrolled = db
    .prepare("SELECT * FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'")
    .get(cls.id, user.id);
  if (!enrolled) {
    fail(403, 'NOT_ENROLLED', 'Bạn chưa ghi danh hoạt động trong lớp môn học này.');
  }
  return cls;
}

function validateScopeLinks(db, courseId, scopeType, body = {}) {
  const lessonId = text(body, 'lesson_id', { max: 80, label: 'bài học' }) || null;
  let chapterId = text(body, 'chapter_id', { max: 80, label: 'chương học' }) || null;
  let topicId = text(body, 'topic_id', { max: 80, label: 'chủ đề' }) || null;

  if (lessonId) {
    const tree = resolveLessonTreeIds(db, lessonId);
    if (!tree || tree.course.id !== courseId) {
      fail(400, 'INVALID_LESSON_SCOPE', 'Bài học được chọn không thuộc môn học của lớp này.');
    }
    chapterId = tree.chapter.id;
    topicId = tree.topic?.id || topicId;
  } else if (chapterId) {
    const ch = db.prepare('SELECT id, course_id, topic_id FROM chapters WHERE id = ?').get(chapterId);
    if (!ch || ch.course_id !== courseId) {
      fail(400, 'INVALID_CHAPTER_SCOPE', 'Chương học được chọn không thuộc môn học của lớp này.');
    }
    topicId = ch.topic_id || topicId;
  } else if (topicId) {
    const tp = db.prepare('SELECT id, course_id FROM course_topics WHERE id = ?').get(topicId);
    if (!tp || tp.course_id !== courseId) {
      fail(400, 'INVALID_TOPIC_SCOPE', 'Chủ đề được chọn không thuộc môn học của lớp này.');
    }
  }

  return { scope_type: scopeType, topic_id: topicId, chapter_id: chapterId, lesson_id: lessonId };
}

function computePolicyScore(submittedAttempts, policy = 'HIGHEST') {
  if (!submittedAttempts || submittedAttempts.length === 0) return null;
  const scores = submittedAttempts.map((a) => Number(a.total_score || 0));
  if (policy === 'LATEST') {
    const sorted = [...submittedAttempts].sort((a, b) => Number(b.attempt_number) - Number(a.attempt_number));
    return Number(sorted[0].total_score || 0);
  }
  if (policy === 'AVERAGE') {
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    return Math.round(avg * 100) / 100;
  }
  return Math.max(...scores);
}

function syncGradebookEntry(db, { classId, studentId, sourceType, sourceId, title, score, maxScore, gradedBy }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO class_gradebook_entries
       (id, subject_class_id, student_id, source_type, source_id, title, score, max_score, weight, graded_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(subject_class_id, student_id, source_type, source_id) DO UPDATE SET
       title = excluded.title,
       score = excluded.score,
       max_score = excluded.max_score,
       graded_by = excluded.graded_by,
       updated_at = excluded.updated_at`
  ).run(crypto.randomUUID(), classId, studentId, sourceType, sourceId, title, score, maxScore, gradedBy || null, now);
}

function syncExamGradebookForStudent(db, exam, studentId, gradedBy = null) {
  const attempts = db
    .prepare(
      `SELECT * FROM class_exam_attempts
       WHERE exam_id = ? AND student_id = ? AND submitted_at IS NOT NULL
       ORDER BY attempt_number ASC`
    )
    .all(exam.id, studentId);
  if (attempts.length === 0) return;
  const effectiveScore = computePolicyScore(attempts, exam.scoring_policy || 'HIGHEST');
  const maxScore = Number(attempts[0].max_score || 0) || 10;
  syncGradebookEntry(db, {
    classId: exam.subject_class_id,
    studentId,
    sourceType: 'EXAM',
    sourceId: exam.id,
    title: exam.title,
    score: effectiveScore,
    maxScore,
    gradedBy,
  });
}

function pushNotification(db, userId, type, title, bodyText, linkUrl) {
  db.prepare(
    `INSERT INTO teaching_notifications (id, user_id, notification_type, title, body, link_url, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(crypto.randomUUID(), userId, type, title, bodyText || '', linkUrl || '', nowIso());
}

function mapBankRowToSpec(row, overridePoints) {
  const opts = safeJson(row.options_json, []);
  const key = safeJson(row.answer_key_json, {});
  return normalizeQuestionSpec(
    {
      question_id: row.id,
      question_type: row.question_type,
      prompt: row.prompt,
      options: opts,
      answer_key: key,
      points: overridePoints ?? row.points ?? 1,
      explanation: row.explanation || '',
      correct_feedback: row.correct_feedback || '',
      wrong_feedback: row.wrong_feedback || '',
    },
    'Câu hỏi từ ngân hàng'
  );
}

function resolveExamQuestionsInput(db, courseId, body) {
  const out = [];
  const bankIds = Array.isArray(body?.question_bank_ids)
    ? body.question_bank_ids
    : Array.isArray(body?.bank_question_ids)
      ? body.bank_question_ids
      : [];
  for (const qId of bankIds) {
    const cleanId = String(qId || '').trim();
    if (!cleanId) continue;
    const row = db
      .prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL')
      .get(cleanId);
    if (!row) fail(404, 'BANK_QUESTION_NOT_FOUND', `Không tìm thấy câu hỏi ngân hàng "${cleanId}".`);
    if (row.course_id && courseId && row.course_id !== courseId) {
      fail(400, 'BANK_QUESTION_WRONG_COURSE', 'Câu hỏi ngân hàng không thuộc môn học của lớp này.');
    }
    try {
      const spec = mapBankRowToSpec(row);
      out.push({ bank_question_id: row.id, spec, points: Number(spec.points || 1) });
    } catch (err) {
      if (err instanceof QuizValidationError) fail(400, 'INVALID_QUESTION', err.message);
      throw err;
    }
  }

  const inlineList = Array.isArray(body?.questions) ? body.questions : [];
  for (let i = 0; i < inlineList.length; i++) {
    const raw = inlineList[i];
    if (!raw || typeof raw !== 'object') continue;
    if (raw.bank_question_id && !raw.prompt) {
      const row = db
        .prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL')
        .get(String(raw.bank_question_id));
      if (!row) fail(404, 'BANK_QUESTION_NOT_FOUND', `Không tìm thấy câu hỏi ngân hàng "${raw.bank_question_id}".`);
      if (row.course_id && courseId && row.course_id !== courseId) {
        fail(400, 'BANK_QUESTION_WRONG_COURSE', 'Câu hỏi ngân hàng không thuộc môn học của lớp này.');
      }
      const spec = mapBankRowToSpec(row, raw.points !== undefined ? Number(raw.points) : undefined);
      out.push({ bank_question_id: row.id, spec, points: Number(spec.points || 1) });
    } else {
      try {
        const spec = normalizeQuestionSpec(raw, `Câu hỏi #${i + 1}`);
        out.push({
          bank_question_id: raw.bank_question_id || raw.question_id || null,
          spec,
          points: Number(spec.points || 1),
        });
      } catch (err) {
        if (err instanceof QuizValidationError) fail(400, 'INVALID_QUESTION', err.message);
        throw err;
      }
    }
  }
  return out;
}

function hydrateExamDto(db, exam) {
  const qs = db
    .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
    .all(exam.id);
  const totalPoints = qs.reduce((sum, q) => sum + Number(q.points || 0), 0);
  const attemptAgg = db
    .prepare(
      `SELECT
         COUNT(*) AS attempt_count,
         SUM(CASE WHEN grading_status = 'PENDING_MANUAL' THEN 1 ELSE 0 END) AS pending_manual_count,
         SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_count
       FROM class_exam_attempts WHERE exam_id = ?`
    )
    .get(exam.id);
  const topic = exam.topic_id ? db.prepare('SELECT id, title FROM course_topics WHERE id = ?').get(exam.topic_id) : null;
  const chapter = exam.chapter_id ? db.prepare('SELECT id, title FROM chapters WHERE id = ?').get(exam.chapter_id) : null;
  const lesson = exam.lesson_id ? db.prepare('SELECT id, title FROM lessons WHERE id = ?').get(exam.lesson_id) : null;

  return {
    id: exam.id,
    class_id: exam.subject_class_id,
    course_id: exam.course_id,
    scope_type: exam.scope_type,
    topic_id: exam.topic_id || null,
    topic_title: topic?.title || null,
    chapter_id: exam.chapter_id || null,
    chapter_title: chapter?.title || null,
    lesson_id: exam.lesson_id || null,
    lesson_title: lesson?.title || null,
    title: exam.title,
    description: exam.description || '',
    time_limit_minutes: Number(exam.time_limit_minutes || 20),
    max_attempts: Number(exam.max_attempts || 1),
    shuffle_questions: Boolean(exam.shuffle_questions),
    scoring_policy: exam.scoring_policy || 'HIGHEST',
    pass_score_pct: Number(exam.pass_score_pct ?? 50),
    open_at: exam.open_at || null,
    close_at: exam.close_at || null,
    status: exam.status,
    question_count: qs.length,
    total_points: Math.round(totalPoints * 100) / 100,
    attempt_count: Number(attemptAgg?.attempt_count || 0),
    submitted_count: Number(attemptAgg?.submitted_count || 0),
    pending_manual_count: Number(attemptAgg?.pending_manual_count || 0),
    created_by: exam.created_by,
    created_at: exam.created_at,
    updated_at: exam.updated_at,
  };
}

function hydrateAssignmentDto(db, a) {
  const agg = db
    .prepare(
      `SELECT
         COUNT(DISTINCT student_id) AS students_touched,
         SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END) AS pending_grade_count,
         SUM(CASE WHEN status = 'GRADED' THEN 1 ELSE 0 END) AS graded_count,
         SUM(CASE WHEN status IN ('SUBMITTED','GRADED','RETURNED') THEN 1 ELSE 0 END) AS submissions_total
       FROM class_assignment_submissions WHERE class_assignment_id = ?`
    )
    .get(a.id);
  const topic = a.topic_id ? db.prepare('SELECT id, title FROM course_topics WHERE id = ?').get(a.topic_id) : null;
  const chapter = a.chapter_id ? db.prepare('SELECT id, title FROM chapters WHERE id = ?').get(a.chapter_id) : null;
  const lesson = a.lesson_id ? db.prepare('SELECT id, title FROM lessons WHERE id = ?').get(a.lesson_id) : null;

  return {
    id: a.id,
    class_id: a.subject_class_id,
    course_id: a.course_id,
    assignment_bank_item_id: a.assignment_bank_item_id || null,
    topic_id: a.topic_id || null,
    topic_title: topic?.title || null,
    chapter_id: a.chapter_id || null,
    chapter_title: chapter?.title || null,
    lesson_id: a.lesson_id || null,
    lesson_title: lesson?.title || null,
    title: a.title,
    instructions: a.instructions,
    submission_type: a.submission_type,
    max_score: Number(a.max_score || 10),
    max_attempts: Number(a.max_attempts || 3),
    allow_resubmit: Boolean(a.allow_resubmit),
    due_at: a.due_at || null,
    attachments: safeJson(a.attachments_json, []),
    status: a.status,
    students_touched: Number(agg?.students_touched || 0),
    submissions_total: Number(agg?.submissions_total || 0),
    pending_grade_count: Number(agg?.pending_grade_count || 0),
    graded_count: Number(agg?.graded_count || 0),
    created_by: a.created_by,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function finalizeExamAttempt(db, exam, attempt, rawAnswersOverride = null) {
  const answers = rawAnswersOverride && typeof rawAnswersOverride === 'object'
    ? { ...safeJson(attempt.answers_json, {}), ...rawAnswersOverride }
    : safeJson(attempt.answers_json, {});

  const qRows = db
    .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
    .all(exam.id);

  let autoScore = 0;
  let maxScore = 0;
  let hasManual = false;
  const itemGrades = {};

  for (const row of qRows) {
    const spec = safeJson(row.question_snapshot_json, {});
    const pts = Number(row.points ?? spec.points ?? 1);
    spec.points = pts;
    maxScore += pts;

    const studentResp = answers[row.id] ?? answers[spec.id] ?? {};
    const graded = gradeQuestionResponse(spec, studentResp);
    const needsManual = graded.grading_status === 'PENDING_REVIEW';

    if (needsManual) {
      hasManual = true;
      itemGrades[row.id] = {
        question_id: row.id,
        question_type: spec.question_type,
        grading_status: 'PENDING_REVIEW',
        is_correct: false,
        earned_points: 0,
        max_points: pts,
        feedback: 'Đã ghi nhận bài làm tự luận. Chờ giảng viên chấm điểm.',
        normalized_response: graded.normalized_response,
      };
    } else {
      autoScore += Number(graded.earned_points || 0);
      itemGrades[row.id] = {
        question_id: row.id,
        question_type: spec.question_type,
        grading_status: 'GRADED',
        is_correct: Boolean(graded.is_correct),
        earned_points: Number(graded.earned_points || 0),
        max_points: pts,
        feedback: graded.feedback,
        normalized_response: graded.normalized_response,
      };
    }
  }

  autoScore = Math.round(autoScore * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;
  const gradingStatus = hasManual ? 'PENDING_MANUAL' : 'AUTO_GRADED';
  const now = nowIso();

  db.prepare(
    `UPDATE class_exam_attempts
     SET answers_json = ?, item_grades_json = ?, auto_score = ?, manual_score = 0,
         total_score = ?, max_score = ?, grading_status = ?, submitted_at = ?,
         graded_at = CASE WHEN ? = 'AUTO_GRADED' THEN ? ELSE graded_at END
     WHERE id = ?`
  ).run(
    JSON.stringify(answers),
    JSON.stringify(itemGrades),
    autoScore,
    autoScore,
    maxScore,
    gradingStatus,
    now,
    gradingStatus,
    now,
    attempt.id
  );

  syncExamGradebookForStudent(db, exam, attempt.student_id, null);
  return db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(attempt.id);
}

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function checkAttemptWindowExpired(exam, attempt) {
  const limitMin = Number(exam.time_limit_minutes || 20);
  if (!limitMin || limitMin <= 0) return false;
  const startedMs = Date.parse(attempt.started_at);
  if (Number.isNaN(startedMs)) return false;
  return Date.now() > startedMs + limitMin * 60000 + 15000;
}

function studentAttemptDto(attempt, exam, qRows, revealAnswers = false) {
  const order = safeJson(attempt.question_order_json, []);
  const byId = new Map(qRows.map((q) => [q.id, q]));
  const orderedRows = order.length > 0 ? order.map((id) => byId.get(id)).filter(Boolean) : qRows;
  const answers = safeJson(attempt.answers_json, {});
  const itemGrades = safeJson(attempt.item_grades_json, {});
  const submitted = Boolean(attempt.submitted_at);

  const questions = orderedRows.map((r) => {
    const spec = safeJson(r.question_snapshot_json, {});
    const st = stripQuestionForStudent(
      { ...spec, id: r.id, points: Number(r.points ?? spec.points ?? 1) },
      { revealAnswer: submitted && revealAnswers, revealExplanation: submitted }
    );
    return {
      ...st,
      bank_question_id: r.bank_question_id || null,
      response: answers[r.id] || null,
      grade: submitted ? itemGrades[r.id] || null : null,
    };
  });

  const limitSec = Number(exam.time_limit_minutes || 20) * 60;
  const startedMs = Date.parse(attempt.started_at);
  const remainingSec = !submitted && !Number.isNaN(startedMs)
    ? Math.max(0, Math.round((startedMs + limitSec * 1000 - Date.now()) / 1000))
    : 0;

  return {
    id: attempt.id,
    exam_id: attempt.exam_id,
    class_id: attempt.subject_class_id,
    attempt_number: attempt.attempt_number,
    grading_status: attempt.grading_status,
    auto_score: Number(attempt.auto_score || 0),
    manual_score: Number(attempt.manual_score || 0),
    total_score: Number(attempt.total_score || 0),
    max_score: Number(attempt.max_score || 0),
    teacher_feedback: attempt.teacher_feedback || '',
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at || null,
    graded_at: attempt.graded_at || null,
    remaining_seconds: remainingSec,
    questions,
  };
}

export function registerAssessmentAndAssignmentRoutes(route) {
  // =========================================================================
  // 1. BÀI KIỂM TRA THEO LỚP MÔN HỌC (STAFF / INSTRUCTOR)
  // =========================================================================

  route('GET', '/classes/:id/exams', ({ db, user, params }) => {
    const { cls } = requireStaffViewClass(db, user, params.id);
    const rows = db
      .prepare('SELECT * FROM class_exams WHERE subject_class_id = ? ORDER BY created_at DESC')
      .all(cls.id);
    return { items: rows.map((r) => hydrateExamDto(db, r)) };
  });

  route('POST', '/classes/:id/exams', ({ db, user, body, params }) => {
    const { cls } = requireStaffManageClass(db, user, params.id);
    if (!cls.course_id) fail(400, 'CLASS_NO_COURSE', 'Lớp môn học chưa liên kết môn học.');

    const title = text(body, 'title', { required: true, max: 200, label: 'tên bài kiểm tra' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' });
    const scopeType = oneOf(body, 'scope_type', ['COURSE', 'TOPIC', 'CHAPTER', 'LESSON'], { fallback: 'CHAPTER', label: 'phạm vi' });
    const scopeLinks = validateScopeLinks(db, cls.course_id, scopeType, body);

    const timeLimitMinutes = intField(body, 'time_limit_minutes', { min: 1, max: 300, fallback: 20, label: 'thời gian làm bài (phút)' });
    const maxAttempts = intField(body, 'max_attempts', { min: 1, max: 20, fallback: 1, label: 'số lượt làm tối đa' });
    const shuffleQuestions = body?.shuffle_questions === undefined ? 1 : body.shuffle_questions ? 1 : 0;
    const scoringPolicy = oneOf(body, 'scoring_policy', ['HIGHEST', 'LATEST', 'AVERAGE'], { fallback: 'HIGHEST', label: 'cách tính điểm' });
    const passScorePct = body?.pass_score_pct !== undefined ? Math.min(100, Math.max(0, Number(body.pass_score_pct))) : 50;
    if (Number.isNaN(passScorePct)) fail(400, 'INVALID_PASS_SCORE', 'Điểm đạt (%) không hợp lệ.');
    const status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'CLOSED'], { fallback: 'PUBLISHED', label: 'trạng thái' });
    const openAt = text(body, 'open_at', { max: 40, label: 'thời điểm mở' }) || null;
    const closeAt = text(body, 'close_at', { max: 40, label: 'thời điểm đóng' }) || null;

    const resolvedQuestions = resolveExamQuestionsInput(db, cls.course_id, body);
    if (status === 'PUBLISHED' && resolvedQuestions.length === 0) {
      fail(400, 'EXAM_QUESTIONS_REQUIRED', 'Bài kiểm tra phát hành cần ít nhất 1 câu hỏi (chọn từ Ngân hàng hoặc nhập trực tiếp).');
    }

    const id = `ex_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    tx(db, () => {
      db.prepare(
        `INSERT INTO class_exams
           (id, subject_class_id, course_id, scope_type, topic_id, chapter_id, lesson_id,
            title, description, time_limit_minutes, max_attempts, shuffle_questions, scoring_policy,
            pass_score_pct, open_at, close_at, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        cls.id,
        cls.course_id,
        scopeLinks.scope_type,
        scopeLinks.topic_id,
        scopeLinks.chapter_id,
        scopeLinks.lesson_id,
        title,
        description,
        timeLimitMinutes,
        maxAttempts,
        shuffleQuestions,
        scoringPolicy,
        passScorePct,
        openAt,
        closeAt,
        status,
        user.id,
        now,
        now
      );

      resolvedQuestions.forEach((item, idx) => {
        db.prepare(
          `INSERT INTO class_exam_questions (id, exam_id, bank_question_id, question_snapshot_json, points, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          `exq_${crypto.randomBytes(5).toString('hex')}`,
          id,
          item.bank_question_id || null,
          JSON.stringify(item.spec),
          item.points,
          (idx + 1) * 10
        );
      });
    });

    if (status === 'PUBLISHED') {
      const students = db
        .prepare("SELECT student_id FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'")
        .all(cls.id);
      for (const s of students) {
        pushNotification(db, s.student_id, 'NEW_EXAM', `Bài kiểm tra mới: ${title}`, `Lớp ${cls.code} vừa mở bài kiểm tra "${title}".`, '/learn/exams');
      }
    }

    const created = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(id);
    return [201, hydrateExamDto(db, created)];
  });

  route('GET', '/exams/:examId', ({ db, user, params }) => {
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(params.examId);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStaffViewClass(db, user, exam.subject_class_id);
    const questions = db
      .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
      .all(exam.id)
      .map((q) => ({
        id: q.id,
        bank_question_id: q.bank_question_id,
        points: Number(q.points || 1),
        sort_order: Number(q.sort_order || 10),
        question: safeJson(q.question_snapshot_json, {}),
      }));
    return { ...hydrateExamDto(db, exam), questions };
  });

  route('PATCH', '/exams/:examId', ({ db, user, body, params }) => {
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(params.examId);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStaffManageClass(db, user, exam.subject_class_id);

    const hasReplacingQuestions = Array.isArray(body?.question_bank_ids) || Array.isArray(body?.questions);
    const attemptCount = db.prepare('SELECT COUNT(*) n FROM class_exam_attempts WHERE exam_id = ?').get(exam.id).n;
    if (hasReplacingQuestions && attemptCount > 0) {
      fail(409, 'EXAM_HAS_ATTEMPTS', 'Không thể thay đổi bộ câu hỏi sau khi đã có học viên làm bài.');
    }

    const title = body?.title !== undefined ? text(body, 'title', { required: true, max: 200, label: 'tên bài kiểm tra' }) : exam.title;
    const description = body?.description !== undefined ? text(body, 'description', { max: 2000, label: 'mô tả' }) : exam.description;
    const status = body?.status !== undefined ? oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'CLOSED'], { label: 'trạng thái' }) : exam.status;
    const scopeType = body?.scope_type !== undefined
      ? oneOf(body, 'scope_type', ['COURSE', 'TOPIC', 'CHAPTER', 'LESSON'], { label: 'phạm vi' })
      : exam.scope_type;
    const scopeLinks = (body?.scope_type !== undefined || body?.topic_id !== undefined || body?.chapter_id !== undefined || body?.lesson_id !== undefined)
      ? validateScopeLinks(db, exam.course_id, scopeType, {
          topic_id: body?.topic_id !== undefined ? body.topic_id : exam.topic_id,
          chapter_id: body?.chapter_id !== undefined ? body.chapter_id : exam.chapter_id,
          lesson_id: body?.lesson_id !== undefined ? body.lesson_id : exam.lesson_id,
        })
      : { scope_type: exam.scope_type, topic_id: exam.topic_id, chapter_id: exam.chapter_id, lesson_id: exam.lesson_id };

    const timeLimitMinutes = body?.time_limit_minutes !== undefined
      ? intField(body, 'time_limit_minutes', { min: 1, max: 300, label: 'thời gian làm bài' })
      : exam.time_limit_minutes;
    const maxAttempts = body?.max_attempts !== undefined
      ? intField(body, 'max_attempts', { min: 1, max: 20, label: 'số lượt làm tối đa' })
      : exam.max_attempts;
    const shuffleQuestions = body?.shuffle_questions !== undefined ? (body.shuffle_questions ? 1 : 0) : exam.shuffle_questions;
    const scoringPolicy = body?.scoring_policy !== undefined
      ? oneOf(body, 'scoring_policy', ['HIGHEST', 'LATEST', 'AVERAGE'], { label: 'cách tính điểm' })
      : exam.scoring_policy;
    const passScorePct = body?.pass_score_pct !== undefined
      ? Math.min(100, Math.max(0, Number(body.pass_score_pct)))
      : Number(exam.pass_score_pct ?? 50);
    const openAt = body?.open_at !== undefined ? text(body, 'open_at', { max: 40 }) || null : exam.open_at;
    const closeAt = body?.close_at !== undefined ? text(body, 'close_at', { max: 40 }) || null : exam.close_at;

    const resolvedQuestions = hasReplacingQuestions ? resolveExamQuestionsInput(db, exam.course_id, body) : null;
    const currentQCount = db.prepare('SELECT COUNT(*) n FROM class_exam_questions WHERE exam_id = ?').get(exam.id).n;
    const targetQCount = resolvedQuestions ? resolvedQuestions.length : currentQCount;
    if (status === 'PUBLISHED' && targetQCount === 0) {
      fail(400, 'EXAM_QUESTIONS_REQUIRED', 'Bài kiểm tra phát hành cần ít nhất 1 câu hỏi.');
    }

    tx(db, () => {
      db.prepare(
        `UPDATE class_exams
         SET scope_type = ?, topic_id = ?, chapter_id = ?, lesson_id = ?,
             title = ?, description = ?, time_limit_minutes = ?, max_attempts = ?,
             shuffle_questions = ?, scoring_policy = ?, pass_score_pct = ?,
             open_at = ?, close_at = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        scopeLinks.scope_type,
        scopeLinks.topic_id,
        scopeLinks.chapter_id,
        scopeLinks.lesson_id,
        title,
        description,
        timeLimitMinutes,
        maxAttempts,
        shuffleQuestions,
        scoringPolicy,
        passScorePct,
        openAt,
        closeAt,
        status,
        nowIso(),
        exam.id
      );

      if (resolvedQuestions) {
        db.prepare('DELETE FROM class_exam_questions WHERE exam_id = ?').run(exam.id);
        resolvedQuestions.forEach((item, idx) => {
          db.prepare(
            `INSERT INTO class_exam_questions (id, exam_id, bank_question_id, question_snapshot_json, points, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            `exq_${crypto.randomBytes(5).toString('hex')}`,
            exam.id,
            item.bank_question_id || null,
            JSON.stringify(item.spec),
            item.points,
            (idx + 1) * 10
          );
        });
      }
    });

    return hydrateExamDto(db, db.prepare('SELECT * FROM class_exams WHERE id = ?').get(exam.id));
  });

  route('DELETE', '/exams/:examId', ({ db, user, params }) => {
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(params.examId);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStaffManageClass(db, user, exam.subject_class_id);

    tx(db, () => {
      db.prepare("DELETE FROM class_gradebook_entries WHERE subject_class_id = ? AND source_type = 'EXAM' AND source_id = ?").run(
        exam.subject_class_id,
        exam.id
      );
      db.prepare('DELETE FROM class_exams WHERE id = ?').run(exam.id);
    });
    return { deleted: true, id: exam.id };
  });

  route('GET', '/exams/:examId/attempts', ({ db, user, params }) => {
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(params.examId);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStaffViewClass(db, user, exam.subject_class_id);

    const questions = db
      .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
      .all(exam.id)
      .map((q) => ({
        id: q.id,
        bank_question_id: q.bank_question_id,
        points: Number(q.points || 1),
        question: safeJson(q.question_snapshot_json, {}),
      }));

    const rows = db
      .prepare(
        `SELECT a.*, u.code AS student_code, u.full_name AS student_name, u.email AS student_email
         FROM class_exam_attempts a
         JOIN users u ON u.id = a.student_id
         WHERE a.exam_id = ?
         ORDER BY a.submitted_at DESC, a.started_at DESC`
      )
      .all(exam.id);

    const attempts = rows.map((r) => ({
      id: r.id,
      exam_id: r.exam_id,
      student_id: r.student_id,
      student_code: r.student_code,
      student_name: r.student_name,
      student_email: r.student_email,
      content_version_key: r.content_version_key,
      attempt_number: r.attempt_number,
      grading_status: r.grading_status,
      auto_score: Number(r.auto_score || 0),
      manual_score: Number(r.manual_score || 0),
      total_score: Number(r.total_score || 0),
      max_score: Number(r.max_score || 0),
      teacher_feedback: r.teacher_feedback || '',
      answers: safeJson(r.answers_json, {}),
      item_grades: safeJson(r.item_grades_json, {}),
      started_at: r.started_at,
      submitted_at: r.submitted_at,
      graded_at: r.graded_at,
    }));

    return {
      exam: hydrateExamDto(db, exam),
      questions,
      attempts,
    };
  });

  route('POST', '/exam-attempts/:attemptId/grade', ({ db, user, body, params }) => {
    const attempt = db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(params.attemptId);
    if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài.');
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(attempt.exam_id);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStaffManageClass(db, user, exam.subject_class_id);

    if (!attempt.submitted_at) {
      fail(400, 'ATTEMPT_NOT_SUBMITTED', 'Học viên chưa nộp bài kiểm tra.');
    }

    const qRows = db.prepare('SELECT * FROM class_exam_questions WHERE exam_id = ?').all(exam.id);
    const qById = new Map(qRows.map((q) => [q.id, q]));
    const itemGrades = { ...safeJson(attempt.item_grades_json, {}) };
    const itemScores = body?.item_scores && typeof body.item_scores === 'object' ? body.item_scores : null;

    let manualScore = Number(attempt.manual_score || 0);
    let autoScore = Number(attempt.auto_score || 0);

    if (itemScores) {
      let newAuto = 0;
      let newManual = 0;
      for (const q of qRows) {
        const current = itemGrades[q.id] || {
          question_id: q.id,
          grading_status: 'GRADED',
          earned_points: 0,
          max_points: Number(q.points || 1),
        };
        const override = itemScores[q.id];
        if (override !== undefined) {
          const val = typeof override === 'object' ? Number(override.score ?? override.earned_points ?? 0) : Number(override);
          if (Number.isNaN(val) || val < 0 || val > Number(q.points || 1)) {
            fail(400, 'INVALID_ITEM_SCORE', `Điểm câu hỏi phải từ 0 đến ${q.points}.`);
          }
          current.earned_points = Math.round(val * 100) / 100;
          current.is_correct = current.earned_points >= Number(q.points || 1);
          current.grading_status = 'GRADED';
          if (typeof override === 'object' && override.feedback !== undefined) {
            current.feedback = String(override.feedback || '').slice(0, 1000);
          }
          itemGrades[q.id] = current;
        }
        const spec = safeJson(q.question_snapshot_json, {});
        if (spec.question_type === 'SHORT_ANSWER') {
          newManual += Number(current.earned_points || 0);
        } else {
          newAuto += Number(current.earned_points || 0);
        }
      }
      autoScore = Math.round(newAuto * 100) / 100;
      manualScore = Math.round(newManual * 100) / 100;
    } else if (body?.manual_score !== undefined) {
      const m = Number(body.manual_score);
      if (Number.isNaN(m) || m < 0) fail(400, 'INVALID_SCORE', 'Điểm tự luận không hợp lệ.');
      const maxManualPool = Math.max(0, Number(attempt.max_score || 0) - autoScore);
      manualScore = Math.min(maxManualPool, Math.round(m * 100) / 100);
    }

    const totalScore = Math.min(Number(attempt.max_score || 0), Math.round((autoScore + manualScore) * 100) / 100);
    const feedback = text(body, 'teacher_feedback', { max: 2000, fallback: attempt.teacher_feedback || '', label: 'nhận xét giảng viên' });
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `UPDATE class_exam_attempts
         SET item_grades_json = ?, auto_score = ?, manual_score = ?, total_score = ?,
             grading_status = 'GRADED', teacher_feedback = ?, graded_by = ?, graded_at = ?
         WHERE id = ?`
      ).run(JSON.stringify(itemGrades), autoScore, manualScore, totalScore, feedback, user.id, now, attempt.id);

      syncExamGradebookForStudent(db, exam, attempt.student_id, user.id);
      pushNotification(
        db,
        attempt.student_id,
        'EXAM_GRADED',
        `Đã chấm điểm: ${exam.title}`,
        `Bạn đạt ${totalScore}/${attempt.max_score} điểm.`,
        '/learn/exams'
      );
    });

    const updated = db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(attempt.id);
    return {
      ...updated,
      item_grades: safeJson(updated.item_grades_json, {}),
      answers: safeJson(updated.answers_json, {}),
    };
  });

  // =========================================================================
  // 2. BÀI KIỂM TRA HỌC VIÊN (/learn/exams...)
  // =========================================================================

  route('GET', '/learn/exams', ({ db, user, query }) => {
    const classId = query.get('class_id');
    if (classId) requireStudentInClass(db, user, classId);

    const enrolledClasses = db
      .prepare(
        `SELECT sc.id, sc.code, sc.title, sc.course_id, c.title AS course_title
         FROM class_enrollments e
         JOIN subject_classes sc ON sc.id = e.subject_class_id
         LEFT JOIN courses c ON c.id = sc.course_id
         WHERE e.student_id = ? AND e.status = 'ACTIVE' ${classId ? 'AND sc.id = ?' : ''}`
      )
      .all(...(classId ? [user.id, classId] : [user.id]));

    if (enrolledClasses.length === 0) return { items: [] };
    const clsMap = new Map(enrolledClasses.map((c) => [c.id, c]));
    const placeholders = enrolledClasses.map(() => '?').join(',');
    const exams = db
      .prepare(
        `SELECT * FROM class_exams
         WHERE subject_class_id IN (${placeholders}) AND status IN ('PUBLISHED','CLOSED')
         ORDER BY COALESCE(close_at, '9999'), created_at DESC`
      )
      .all(...enrolledClasses.map((c) => c.id));

    const nowMs = Date.now();
    const items = exams.map((ex) => {
      const dto = hydrateExamDto(db, ex);
      const clsInfo = clsMap.get(ex.subject_class_id);
      const myAttempts = db
        .prepare(
          `SELECT id, attempt_number, grading_status, auto_score, manual_score, total_score, max_score,
                  teacher_feedback, started_at, submitted_at, graded_at
           FROM class_exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY attempt_number DESC`
        )
        .all(ex.id, user.id);

      const inProgress = myAttempts.find((a) => !a.submitted_at);
      const submitted = myAttempts.filter((a) => Boolean(a.submitted_at));
      const effectiveScore = computePolicyScore(submitted, ex.scoring_policy);
      const maxScore = submitted[0]?.max_score ?? dto.total_points;
      const pct = effectiveScore !== null && maxScore > 0 ? Math.round((effectiveScore / maxScore) * 1000) / 10 : null;
      const openOk = !ex.open_at || Date.parse(ex.open_at) <= nowMs;
      const closeOk = !ex.close_at || Date.parse(ex.close_at) >= nowMs;
      const attemptsOk = Boolean(inProgress) || myAttempts.length < Number(ex.max_attempts || 1);

      return {
        ...dto,
        class_code: clsInfo?.code || '',
        class_title: clsInfo?.title || '',
        course_title: clsInfo?.course_title || '',
        attempts_used: myAttempts.length,
        in_progress_attempt_id: inProgress?.id || null,
        effective_score: effectiveScore,
        effective_pct: pct,
        passed: pct !== null ? pct >= Number(ex.pass_score_pct ?? 50) : null,
        can_start: ex.status === 'PUBLISHED' && openOk && closeOk && attemptsOk,
        attempts: myAttempts,
      };
    });

    return { items };
  });

  route('POST', '/learn/exams/:examId/start', ({ db, user, params }) => {
    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(params.examId);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    const cls = requireStudentInClass(db, user, exam.subject_class_id);

    if (exam.status !== 'PUBLISHED') {
      fail(400, 'EXAM_NOT_OPEN', 'Bài kiểm tra hiện không mở để làm bài.');
    }
    const nowMs = Date.now();
    if (exam.open_at && Date.parse(exam.open_at) > nowMs) {
      fail(400, 'EXAM_NOT_STARTED_YET', 'Chưa đến thời gian mở bài kiểm tra.');
    }
    if (exam.close_at && Date.parse(exam.close_at) < nowMs) {
      fail(400, 'EXAM_WINDOW_CLOSED', 'Đã hết thời gian mở bài kiểm tra.');
    }

    const qRows = db
      .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
      .all(exam.id);
    if (qRows.length === 0) {
      fail(400, 'EXAM_EMPTY', 'Bài kiểm tra chưa có câu hỏi.');
    }

    const existingAttempts = db
      .prepare('SELECT * FROM class_exam_attempts WHERE exam_id = ? AND student_id = ? ORDER BY attempt_number ASC')
      .all(exam.id, user.id);

    let inProgress = existingAttempts.find((a) => a.grading_status === 'IN_PROGRESS' && !a.submitted_at);
    if (inProgress) {
      if (checkAttemptWindowExpired(exam, inProgress)) {
        finalizeExamAttempt(db, exam, inProgress);
        inProgress = null;
      } else {
        return {
          exam: hydrateExamDto(db, exam),
          attempt: studentAttemptDto(inProgress, exam, qRows, false),
        };
      }
    }

    const currentCount = db
      .prepare('SELECT COUNT(*) n FROM class_exam_attempts WHERE exam_id = ? AND student_id = ?')
      .get(exam.id, user.id).n;
    if (currentCount >= Number(exam.max_attempts || 1)) {
      fail(409, 'MAX_ATTEMPTS_REACHED', `Bạn đã dùng hết ${exam.max_attempts} lượt làm bài kiểm tra này.`);
    }

    const orderedIds = exam.shuffle_questions ? shuffleArray(qRows.map((q) => q.id)) : qRows.map((q) => q.id);
    const maxScore = Math.round(qRows.reduce((sum, q) => sum + Number(q.points || 1), 0) * 100) / 100;
    const attemptId = `att_${crypto.randomBytes(5).toString('hex')}`;
    const verKey = getClassContentVersionKey(cls);
    const now = nowIso();

    db.prepare(
      `INSERT INTO class_exam_attempts
         (id, exam_id, subject_class_id, student_id, content_version_key, attempt_number,
          question_order_json, answers_json, item_grades_json, auto_score, manual_score,
          total_score, max_score, grading_status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', 0, 0, 0, ?, 'IN_PROGRESS', ?)`
    ).run(attemptId, exam.id, cls.id, user.id, verKey, currentCount + 1, JSON.stringify(orderedIds), maxScore, now);

    const created = db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(attemptId);
    return [
      201,
      {
        exam: hydrateExamDto(db, exam),
        attempt: studentAttemptDto(created, exam, qRows, false),
      },
    ];
  });

  route('PUT', '/learn/exam-attempts/:attemptId/save', ({ db, user, body, params }) => {
    const attempt = db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(params.attemptId);
    if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài.');
    if (attempt.student_id !== user.id) fail(403, 'ATTEMPT_FORBIDDEN', 'Bạn không có quyền truy cập lượt làm bài này.');
    if (attempt.submitted_at || attempt.grading_status !== 'IN_PROGRESS') {
      fail(409, 'ATTEMPT_ALREADY_SUBMITTED', 'Lượt làm bài đã được nộp.');
    }

    const incoming = body?.answers && typeof body.answers === 'object' ? body.answers : {};
    const merged = { ...safeJson(attempt.answers_json, {}), ...incoming };
    db.prepare('UPDATE class_exam_attempts SET answers_json = ? WHERE id = ?').run(JSON.stringify(merged), attempt.id);
    return { attempt_id: attempt.id, saved_at: nowIso(), answers_count: Object.keys(merged).length };
  });

  route('POST', '/learn/exam-attempts/:attemptId/submit', ({ db, user, body, params }) => {
    const attempt = db.prepare('SELECT * FROM class_exam_attempts WHERE id = ?').get(params.attemptId);
    if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'Không tìm thấy lượt làm bài.');
    if (attempt.student_id !== user.id) fail(403, 'ATTEMPT_FORBIDDEN', 'Bạn không có quyền nộp lượt làm bài này.');

    const exam = db.prepare('SELECT * FROM class_exams WHERE id = ?').get(attempt.exam_id);
    if (!exam) fail(404, 'EXAM_NOT_FOUND', 'Không tìm thấy bài kiểm tra.');
    requireStudentInClass(db, user, exam.subject_class_id);

    const qRows = db
      .prepare('SELECT * FROM class_exam_questions WHERE exam_id = ? ORDER BY sort_order, id')
      .all(exam.id);

    if (attempt.submitted_at && attempt.grading_status !== 'IN_PROGRESS') {
      const reveal = attempt.grading_status !== 'PENDING_MANUAL' || exam.status === 'CLOSED';
      return { exam: hydrateExamDto(db, exam), attempt: studentAttemptDto(attempt, exam, qRows, reveal) };
    }

    const finalAttempt = tx(db, () => finalizeExamAttempt(db, exam, attempt, body?.answers || null));
    const reveal = finalAttempt.grading_status !== 'PENDING_MANUAL' || exam.status === 'CLOSED';
    return {
      exam: hydrateExamDto(db, exam),
      attempt: studentAttemptDto(finalAttempt, exam, qRows, reveal),
    };
  });

  // =========================================================================
  // 3. BÀI TẬP GIAO THEO LỚP (STAFF / INSTRUCTOR)
  // =========================================================================

  route('GET', '/classes/:id/assignments', ({ db, user, params }) => {
    const { cls } = requireStaffViewClass(db, user, params.id);
    const rows = db
      .prepare('SELECT * FROM class_assignments WHERE subject_class_id = ? ORDER BY COALESCE(due_at, \'9999\'), created_at DESC')
      .all(cls.id);
    return { items: rows.map((r) => hydrateAssignmentDto(db, r)) };
  });

  route('POST', '/classes/:id/assignments', ({ db, user, body, params }) => {
    const { cls } = requireStaffManageClass(db, user, params.id);
    if (!cls.course_id) fail(400, 'CLASS_NO_COURSE', 'Lớp môn học chưa liên kết môn học.');

    let bankItem = null;
    const bankItemId = text(body, 'assignment_bank_item_id', { max: 80, label: 'bài tập ngân hàng' }) || null;
    if (bankItemId) {
      bankItem = db
        .prepare('SELECT * FROM assignment_bank_items WHERE id = ? AND deleted_at IS NULL')
        .get(bankItemId);
      if (!bankItem) fail(404, 'BANK_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập mẫu trong Ngân hàng.');
      if (bankItem.course_id !== cls.course_id) {
        fail(400, 'BANK_ASSIGNMENT_WRONG_COURSE', 'Bài tập ngân hàng không thuộc môn học của lớp này.');
      }
    }

    const title = body?.title !== undefined
      ? text(body, 'title', { required: true, max: 200, label: 'tiêu đề bài tập' })
      : bankItem?.title || fail(400, 'TITLE_REQUIRED', 'Vui lòng nhập tiêu đề bài tập.');
    const instructions = body?.instructions !== undefined
      ? text(body, 'instructions', { required: true, max: 8000, label: 'hướng dẫn làm bài' })
      : bankItem?.instructions || '';
    if (!instructions) fail(400, 'INSTRUCTIONS_REQUIRED', 'Vui lòng nhập hướng dẫn làm bài tập.');

    const submissionType = body?.submission_type !== undefined
      ? oneOf(body, 'submission_type', ['TEXT', 'FILE', 'LINK', 'MIXED'], { label: 'hình thức nộp' })
      : bankItem?.submission_type || 'MIXED';
    const maxScore = body?.max_score !== undefined ? Number(body.max_score) : Number(bankItem?.max_score ?? 10);
    if (Number.isNaN(maxScore) || maxScore <= 0 || maxScore > 1000) {
      fail(400, 'INVALID_MAX_SCORE', 'Thang điểm tối đa không hợp lệ.');
    }
    const maxAttempts = body?.max_attempts !== undefined
      ? intField(body, 'max_attempts', { min: 1, max: 20, label: 'số lần nộp tối đa' })
      : Number(bankItem?.max_attempts ?? 3);
    const allowResubmit = body?.allow_resubmit !== undefined
      ? (body.allow_resubmit ? 1 : 0)
      : bankItem ? Number(bankItem.allow_resubmit) : 1;
    const dueAt = text(body, 'due_at', { max: 40, label: 'hạn nộp' }) || null;
    const status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'CLOSED'], { fallback: 'PUBLISHED', label: 'trạng thái' });
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments
      : bankItem ? safeJson(bankItem.attachments_json, []) : [];

    const scopeLinks = validateScopeLinks(db, cls.course_id, 'LESSON', {
      lesson_id: body?.lesson_id ?? bankItem?.lesson_id,
      chapter_id: body?.chapter_id ?? bankItem?.chapter_id,
      topic_id: body?.topic_id ?? bankItem?.topic_id,
    });

    const id = `ca_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO class_assignments
         (id, subject_class_id, course_id, assignment_bank_item_id, topic_id, chapter_id, lesson_id,
          title, instructions, submission_type, max_score, max_attempts, allow_resubmit, due_at,
          attachments_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      cls.id,
      cls.course_id,
      bankItem?.id || null,
      scopeLinks.topic_id,
      scopeLinks.chapter_id,
      scopeLinks.lesson_id,
      title,
      instructions,
      submissionType,
      maxScore,
      maxAttempts,
      allowResubmit,
      dueAt,
      JSON.stringify(attachments),
      status,
      user.id,
      now,
      now
    );

    if (status === 'PUBLISHED') {
      const students = db
        .prepare("SELECT student_id FROM class_enrollments WHERE subject_class_id = ? AND status = 'ACTIVE'")
        .all(cls.id);
      for (const s of students) {
        pushNotification(db, s.student_id, 'NEW_ASSIGNMENT', `Bài tập mới: ${title}`, `Lớp ${cls.code} vừa giao bài tập "${title}".`, '/learn/assignments');
      }
    }

    const created = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(id);
    return [201, hydrateAssignmentDto(db, created)];
  });

  route('PATCH', '/assignments/:assignmentId', ({ db, user, body, params }) => {
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(params.assignmentId);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    requireStaffManageClass(db, user, a.subject_class_id);

    const title = body?.title !== undefined ? text(body, 'title', { required: true, max: 200 }) : a.title;
    const instructions = body?.instructions !== undefined ? text(body, 'instructions', { required: true, max: 8000 }) : a.instructions;
    const submissionType = body?.submission_type !== undefined
      ? oneOf(body, 'submission_type', ['TEXT', 'FILE', 'LINK', 'MIXED'])
      : a.submission_type;
    const maxScore = body?.max_score !== undefined ? Number(body.max_score) : Number(a.max_score || 10);
    if (Number.isNaN(maxScore) || maxScore <= 0 || maxScore > 1000) fail(400, 'INVALID_MAX_SCORE', 'Thang điểm không hợp lệ.');
    const maxAttempts = body?.max_attempts !== undefined ? intField(body, 'max_attempts', { min: 1, max: 20 }) : a.max_attempts;
    const allowResubmit = body?.allow_resubmit !== undefined ? (body.allow_resubmit ? 1 : 0) : a.allow_resubmit;
    const dueAt = body?.due_at !== undefined ? text(body, 'due_at', { max: 40 }) || null : a.due_at;
    const status = body?.status !== undefined ? oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'CLOSED']) : a.status;
    const attachments = Array.isArray(body?.attachments) ? body.attachments : safeJson(a.attachments_json, []);

    db.prepare(
      `UPDATE class_assignments
       SET title = ?, instructions = ?, submission_type = ?, max_score = ?, max_attempts = ?,
           allow_resubmit = ?, due_at = ?, attachments_json = ?, status = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      title,
      instructions,
      submissionType,
      maxScore,
      maxAttempts,
      allowResubmit,
      dueAt,
      JSON.stringify(attachments),
      status,
      nowIso(),
      a.id
    );

    return hydrateAssignmentDto(db, db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(a.id));
  });

  route('DELETE', '/assignments/:assignmentId', ({ db, user, params }) => {
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(params.assignmentId);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    requireStaffManageClass(db, user, a.subject_class_id);

    tx(db, () => {
      db.prepare("DELETE FROM class_gradebook_entries WHERE subject_class_id = ? AND source_type = 'ASSIGNMENT' AND source_id = ?").run(
        a.subject_class_id,
        a.id
      );
      db.prepare('DELETE FROM class_assignments WHERE id = ?').run(a.id);
    });
    return { deleted: true, id: a.id };
  });

  route('GET', '/assignments/:assignmentId/submissions', ({ db, user, params }) => {
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(params.assignmentId);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    requireStaffViewClass(db, user, a.subject_class_id);

    const roster = db
      .prepare(
        `SELECT e.student_id, u.code AS student_code, u.full_name AS student_name, u.email AS student_email
         FROM class_enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.subject_class_id = ? AND e.status = 'ACTIVE'`
      )
      .all(a.subject_class_id)
      .sort((x, y) => compareVietnameseName(x.student_name, y.student_name));

    const allSubs = db
      .prepare(
        `SELECT s.*, u.code AS student_code, u.full_name AS student_name
         FROM class_assignment_submissions s
         JOIN users u ON u.id = s.student_id
         WHERE s.class_assignment_id = ?
         ORDER BY s.attempt_number DESC, s.updated_at DESC`
      )
      .all(a.id);

    const latestByStudent = new Map();
    for (const s of allSubs) {
      if (!latestByStudent.has(s.student_id)) {
        latestByStudent.set(s.student_id, { ...s, attachments: safeJson(s.attachments_json, []) });
      }
    }

    const rosterStatus = roster.map((st) => {
      const latest = latestByStudent.get(st.student_id) || null;
      return {
        ...st,
        latest_status: latest?.status || 'NOT_SUBMITTED',
        latest_submission: latest,
        submissions_count: allSubs.filter((x) => x.student_id === st.student_id && x.status !== 'DRAFT').length,
      };
    });

    return {
      assignment: hydrateAssignmentDto(db, a),
      submissions: allSubs.map((s) => ({ ...s, attachments: safeJson(s.attachments_json, []) })),
      roster_status: rosterStatus,
    };
  });

  route('POST', '/assignment-submissions/:subId/grade', ({ db, user, body, params }) => {
    const sub = db.prepare('SELECT * FROM class_assignment_submissions WHERE id = ?').get(params.subId);
    if (!sub) fail(404, 'SUBMISSION_NOT_FOUND', 'Không tìm thấy bài nộp.');
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(sub.class_assignment_id);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    requireStaffManageClass(db, user, a.subject_class_id);

    if (sub.status === 'DRAFT') {
      fail(400, 'SUBMISSION_IS_DRAFT', 'Học viên chưa nộp chính thức bài làm này.');
    }

    const targetStatus = oneOf(body, 'status', ['GRADED', 'RETURNED'], { fallback: 'GRADED', label: 'trạng thái chấm' });
    const maxScore = Number(a.max_score || 10);
    let score = sub.score;

    if (targetStatus === 'GRADED') {
      if (body?.score === undefined || body.score === null) {
        fail(400, 'SCORE_REQUIRED', 'Vui lòng nhập điểm số cho bài tập.');
      }
      score = Number(body.score);
      if (Number.isNaN(score) || score < 0 || score > maxScore) {
        fail(400, 'INVALID_SCORE', `Điểm phải nằm trong khoảng 0 - ${maxScore}.`);
      }
      score = Math.round(score * 100) / 100;
    }

    const feedback = text(body, 'teacher_feedback', { max: 4000, fallback: sub.teacher_feedback || '', label: 'nhận xét giảng viên' });
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `UPDATE class_assignment_submissions
         SET score = ?, status = ?, teacher_feedback = ?, graded_by = ?, graded_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(score, targetStatus, feedback, user.id, now, now, sub.id);

      if (targetStatus === 'GRADED' && score !== null) {
        syncGradebookEntry(db, {
          classId: a.subject_class_id,
          studentId: sub.student_id,
          sourceType: 'ASSIGNMENT',
          sourceId: a.id,
          title: a.title,
          score,
          maxScore,
          gradedBy: user.id,
        });
        pushNotification(
          db,
          sub.student_id,
          'ASSIGNMENT_GRADED',
          `Đã chấm bài tập: ${a.title}`,
          `Điểm của bạn: ${score}/${maxScore}.`,
          '/learn/assignments'
        );
      } else if (targetStatus === 'RETURNED') {
        pushNotification(
          db,
          sub.student_id,
          'ASSIGNMENT_RETURNED',
          `Cần hoàn thiện lại bài tập: ${a.title}`,
          feedback || 'Giảng viên yêu cầu chỉnh sửa và nộp lại bài tập.',
          '/learn/assignments'
        );
      }
    });

    const updated = db.prepare('SELECT * FROM class_assignment_submissions WHERE id = ?').get(sub.id);
    return { ...updated, attachments: safeJson(updated.attachments_json, []) };
  });

  // =========================================================================
  // 4. BÀI TẬP HỌC VIÊN (/learn/assignments...)
  // =========================================================================

  route('GET', '/learn/assignments', ({ db, user, query }) => {
    const classId = query.get('class_id');
    if (classId) requireStudentInClass(db, user, classId);

    const enrolledClasses = db
      .prepare(
        `SELECT sc.id, sc.code, sc.title, sc.course_id, c.title AS course_title
         FROM class_enrollments e
         JOIN subject_classes sc ON sc.id = e.subject_class_id
         LEFT JOIN courses c ON c.id = sc.course_id
         WHERE e.student_id = ? AND e.status = 'ACTIVE' ${classId ? 'AND sc.id = ?' : ''}`
      )
      .all(...(classId ? [user.id, classId] : [user.id]));

    if (enrolledClasses.length === 0) return { items: [] };
    const clsMap = new Map(enrolledClasses.map((c) => [c.id, c]));
    const placeholders = enrolledClasses.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM class_assignments
         WHERE subject_class_id IN (${placeholders}) AND status IN ('PUBLISHED','CLOSED')
         ORDER BY COALESCE(due_at, '9999'), created_at DESC`
      )
      .all(...enrolledClasses.map((c) => c.id));

    const nowMs = Date.now();
    const items = rows.map((a) => {
      const dto = hydrateAssignmentDto(db, a);
      const clsInfo = clsMap.get(a.subject_class_id);
      const subs = db
        .prepare(
          `SELECT * FROM class_assignment_submissions
           WHERE class_assignment_id = ? AND student_id = ?
           ORDER BY attempt_number DESC`
        )
        .all(a.id, user.id)
        .map((s) => ({ ...s, attachments: safeJson(s.attachments_json, []) }));

      const latest = subs[0] || null;
      const submittedCount = subs.filter((s) => s.status !== 'DRAFT').length;
      const hasDraft = latest?.status === 'DRAFT';
      const canNewAttempt =
        submittedCount === 0 ||
        (Boolean(a.allow_resubmit) && submittedCount < Number(a.max_attempts || 3));
      const canSubmit = a.status === 'PUBLISHED' && (hasDraft || canNewAttempt);
      const isOverdue = Boolean(a.due_at && Date.parse(a.due_at) < nowMs && (!latest || latest.status === 'DRAFT'));

      return {
        ...dto,
        class_code: clsInfo?.code || '',
        class_title: clsInfo?.title || '',
        course_title: clsInfo?.course_title || '',
        latest_submission: latest,
        submissions: subs,
        submitted_count: submittedCount,
        can_submit: canSubmit,
        is_overdue: isOverdue,
      };
    });

    return { items };
  });

  function upsertStudentAssignmentSubmission(db, user, a, cls, body, targetState) {
    if (a.status !== 'PUBLISHED') {
      fail(400, 'ASSIGNMENT_NOT_OPEN', 'Bài tập hiện không còn mở để nộp bài.');
    }

    const submissionText = text(body, 'submission_text', { max: 20000, label: 'nội dung bài làm' });
    const submissionLink = text(body, 'submission_link', { max: 1000, label: 'liên kết bài làm' });
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    if (targetState === 'SUBMITTED') {
      if (!submissionText && !submissionLink && attachments.length === 0) {
        fail(400, 'SUBMISSION_EMPTY', 'Vui lòng nhập nội dung, gắn link hoặc đính kèm tệp trước khi nộp bài.');
      }
      if (a.submission_type === 'LINK' && !submissionLink) {
        fail(400, 'SUBMISSION_LINK_REQUIRED', 'Bài tập này yêu cầu nộp qua đường dẫn (Link).');
      }
      if (a.submission_type === 'TEXT' && !submissionText) {
        fail(400, 'SUBMISSION_TEXT_REQUIRED', 'Bài tập này yêu cầu nhập câu trả lời trực tiếp.');
      }
    }

    const existing = db
      .prepare(
        `SELECT * FROM class_assignment_submissions
         WHERE class_assignment_id = ? AND student_id = ?
         ORDER BY attempt_number DESC`
      )
      .all(a.id, user.id);

    const latest = existing[0] || null;
    const submittedCount = existing.filter((s) => s.status !== 'DRAFT').length;
    const verKey = getClassContentVersionKey(cls);
    const now = nowIso();

    if (latest && latest.status === 'DRAFT') {
      db.prepare(
        `UPDATE class_assignment_submissions
         SET submission_text = ?, submission_link = ?, attachments_json = ?,
             status = ?, submitted_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        submissionText,
        submissionLink,
        JSON.stringify(attachments),
        targetState,
        targetState === 'SUBMITTED' ? now : null,
        now,
        latest.id
      );
      const updated = db.prepare('SELECT * FROM class_assignment_submissions WHERE id = ?').get(latest.id);
      return { ...updated, attachments: safeJson(updated.attachments_json, []) };
    }

    if (submittedCount > 0 && !a.allow_resubmit) {
      fail(409, 'RESUBMIT_DISABLED', 'Bài tập này không cho phép nộp lại sau khi đã nộp.');
    }
    if (submittedCount >= Number(a.max_attempts || 3)) {
      fail(409, 'MAX_ATTEMPTS_REACHED', `Bạn đã dùng hết ${a.max_attempts} lần nộp cho bài tập này.`);
    }

    const subId = `sub_${crypto.randomBytes(5).toString('hex')}`;
    const nextNum = existing.length + 1;
    db.prepare(
      `INSERT INTO class_assignment_submissions
         (id, class_assignment_id, subject_class_id, student_id, content_version_key, attempt_number,
          submission_text, submission_link, attachments_json, status, max_score, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      subId,
      a.id,
      cls.id,
      user.id,
      verKey,
      nextNum,
      submissionText,
      submissionLink,
      JSON.stringify(attachments),
      targetState,
      Number(a.max_score || 10),
      targetState === 'SUBMITTED' ? now : null,
      now
    );

    if (targetState === 'SUBMITTED') {
      const teachers = db
        .prepare("SELECT user_id FROM teaching_staff_assignments WHERE subject_class_id = ? AND is_active = 1 AND staff_role IN ('PRIMARY_INSTRUCTOR','CO_INSTRUCTOR')")
        .all(cls.id);
      for (const t of teachers) {
        pushNotification(db, t.user_id, 'ASSIGNMENT_SUBMITTED', `Học viên nộp bài: ${a.title}`, `${user.full_name} vừa nộp bài tập trong lớp ${cls.code}.`, `/classes/${cls.id}`);
      }
    }

    const created = db.prepare('SELECT * FROM class_assignment_submissions WHERE id = ?').get(subId);
    return { ...created, attachments: safeJson(created.attachments_json, []) };
  }

  route('PUT', '/learn/assignments/:assignmentId/draft', ({ db, user, body, params }) => {
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(params.assignmentId);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    const cls = requireStudentInClass(db, user, a.subject_class_id);
    return upsertStudentAssignmentSubmission(db, user, a, cls, body, 'DRAFT');
  });

  route('POST', '/learn/assignments/:assignmentId/submit', ({ db, user, body, params }) => {
    const a = db.prepare('SELECT * FROM class_assignments WHERE id = ?').get(params.assignmentId);
    if (!a) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập.');
    const cls = requireStudentInClass(db, user, a.subject_class_id);
    return upsertStudentAssignmentSubmission(db, user, a, cls, body, 'SUBMITTED');
  });

  // =========================================================================
  // 5. SỔ ĐIỂM TỔNG HỢP THEO LỚP MÔN HỌC (GRADEBOOK)
  // =========================================================================

  route('GET', '/classes/:id/gradebook', ({ db, user, params }) => {
    const { cls } = requireStaffViewClass(db, user, params.id);
    const exams = db
      .prepare('SELECT id, title, scoring_policy, max_attempts FROM class_exams WHERE subject_class_id = ? ORDER BY created_at')
      .all(cls.id);
    const assignments = db
      .prepare('SELECT id, title, max_score FROM class_assignments WHERE subject_class_id = ? ORDER BY created_at')
      .all(cls.id);
    const roster = db
      .prepare(
        `SELECT e.student_id, e.enrollment_source, u.code AS student_code, u.full_name AS student_name, u.email AS student_email
         FROM class_enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.subject_class_id = ? AND e.status = 'ACTIVE'`
      )
      .all(cls.id)
      .sort((a, b) => compareVietnameseName(a.student_name, b.student_name));

    const entries = db
      .prepare('SELECT * FROM class_gradebook_entries WHERE subject_class_id = ?')
      .all(cls.id);
    const entryMap = new Map(entries.map((e) => [`${e.student_id}|${e.source_type}|${e.source_id}`, e]));

    const rows = roster.map((st) => {
      const scores = {};
      let sumPct = 0;
      let gradedItems = 0;

      for (const ex of exams) {
        const entry = entryMap.get(`${st.student_id}|EXAM|${ex.id}`);
        if (entry) {
          scores[`EXAM:${ex.id}`] = { score: Number(entry.score), max_score: Number(entry.max_score), updated_at: entry.updated_at };
          if (entry.max_score > 0) {
            sumPct += (Number(entry.score) / Number(entry.max_score)) * 10;
            gradedItems++;
          }
        }
      }
      for (const a of assignments) {
        const entry = entryMap.get(`${st.student_id}|ASSIGNMENT|${a.id}`);
        if (entry) {
          scores[`ASSIGNMENT:${a.id}`] = { score: Number(entry.score), max_score: Number(entry.max_score), updated_at: entry.updated_at };
          if (entry.max_score > 0) {
            sumPct += (Number(entry.score) / Number(entry.max_score)) * 10;
            gradedItems++;
          }
        }
      }

      return {
        ...st,
        scores,
        graded_count: gradedItems,
        average_scale_10: gradedItems > 0 ? Math.round((sumPct / gradedItems) * 100) / 100 : null,
      };
    });

    return {
      class_id: cls.id,
      columns: [
        ...exams.map((e) => ({ key: `EXAM:${e.id}`, source_type: 'EXAM', source_id: e.id, title: e.title })),
        ...assignments.map((a) => ({ key: `ASSIGNMENT:${a.id}`, source_type: 'ASSIGNMENT', source_id: a.id, title: a.title, max_score: a.max_score })),
      ],
      rows,
    };
  });

  route('GET', '/learn/classes/:id/grades', ({ db, user, params }) => {
    const cls = requireStudentInClass(db, user, params.id);
    const entries = db
      .prepare('SELECT * FROM class_gradebook_entries WHERE subject_class_id = ? AND student_id = ? ORDER BY updated_at DESC')
      .all(cls.id, user.id);

    const examAttempts = db
      .prepare(
        `SELECT a.*, e.title AS exam_title, e.scoring_policy
         FROM class_exam_attempts a
         JOIN class_exams e ON e.id = a.exam_id
         WHERE a.subject_class_id = ? AND a.student_id = ? AND a.submitted_at IS NOT NULL
         ORDER BY a.submitted_at DESC`
      )
      .all(cls.id, user.id);

    const assignmentSubs = db
      .prepare(
        `SELECT s.*, a.title AS assignment_title
         FROM class_assignment_submissions s
         JOIN class_assignments a ON a.id = s.class_assignment_id
         WHERE s.subject_class_id = ? AND s.student_id = ? AND s.status <> 'DRAFT'
         ORDER BY s.updated_at DESC`
      )
      .all(cls.id, user.id);

    const gradedEntries = entries.filter((e) => Number(e.max_score || 0) > 0);
    const avg10 = gradedEntries.length > 0
      ? Math.round(
          (gradedEntries.reduce((sum, e) => sum + (Number(e.score) / Number(e.max_score)) * 10, 0) / gradedEntries.length) * 100
        ) / 100
      : null;

    return {
      class_id: cls.id,
      average_scale_10: avg10,
      gradebook_entries: entries,
      exam_attempts: examAttempts,
      assignment_submissions: assignmentSubs.map((s) => ({ ...s, attachments: safeJson(s.attachments_json, []) })),
    };
  });

  // Kiểm tra quyền Admin khi xóa dữ liệu nếu cần
  void isAdmin;
}
