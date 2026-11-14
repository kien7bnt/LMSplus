/**
 * LMSPLUS Master LMS — 3 Ngân hàng Học liệu Đồng bộ theo Cây nội dung 4 cấp:
 *   1. Ngân hàng Câu hỏi (question_bank_items)
 *   2. Ngân hàng Bài tập (assignment_bank_items)
 *   3. Ngân hàng Tài nguyên / Video / PDF / File (learning_resources)
 *
 * Quy tắc cứng bắt buộc:
 *  - Cây thư mục của cả 3 ngân hàng tự động sinh từ: Môn học -> Chủ đề -> Chương -> Bài.
 *  - CHỈ cho phép tạo / import trực tiếp vào nút lá Bài (lesson_id) -> nếu thiếu trả về HTTP 400 LEAF_LESSON_REQUIRED.
 *  - Xem ở cấp Môn học / Chủ đề / Chương sẽ tự động tổng hợp toàn bộ mục thuộc nhánh con qua SQL JOIN ổn định.
 */

import crypto from 'node:crypto';
import { fail, pageParams, nowIso, text, intField, oneOf, tx } from './http.mjs';
import { canEditCourseDraft, canViewCourse, courseScopeSql, safeJson } from './scope.mjs';
import { resolveLessonTreeIds } from './masterSchema.mjs';
import { buildCourseTree } from './contentTreeAndSnapshots.mjs';
import { normalizeQuestionSpec, QuizValidationError } from './quizEngine.mjs';

function assertLeafLessonTarget(db, user, body, expectedCourseId = null) {
  if (body?.node_level && body.node_level !== 'LESSON') {
    fail(
      400,
      'LEAF_LESSON_REQUIRED',
      'Chỉ được phép tạo hoặc nhập mới ở cấp Bài học (nút lá cuối cùng). Không thể tạo trực tiếp tại cấp Môn học, Chủ đề hay Chương.'
    );
  }
  const lessonId = typeof body?.lesson_id === 'string' ? body.lesson_id.trim() : '';
  if (!lessonId) {
    fail(
      400,
      'LEAF_LESSON_REQUIRED',
      'Vui lòng chọn Bài học đích (nút lá cuối cùng) trước khi thêm vào ngân hàng.'
    );
  }
  const resolved = resolveLessonTreeIds(db, lessonId);
  if (!resolved || !resolved.course) {
    fail(404, 'LESSON_NOT_FOUND', 'Không tìm thấy bài học lá tương ứng trong cây nội dung.');
  }
  if (expectedCourseId && resolved.course.id !== expectedCourseId) {
    fail(422, 'LESSON_COURSE_MISMATCH', 'Bài học được chọn không thuộc môn học đang thao tác.');
  }
  if (!canEditCourseDraft(db, user, resolved.course)) {
    fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền biên tập ngân hàng cho môn học này.');
  }
  return resolved;
}

function resolveCourseFilterScope(db, user, url) {
  const scope = courseScopeSql(user);
  const courses = db
    .prepare(`SELECT c.id, c.code, c.title, c.subject, c.status FROM courses c WHERE ${scope.sql} AND c.status <> 'ARCHIVED' ORDER BY c.title`)
    .all(...scope.params);
  const courseId = url.searchParams.get('course_id');
  if (courseId) {
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!crs) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy môn học.');
    if (!canViewCourse(db, user, crs)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền truy cập ngân hàng môn học này.');
    return { allowedCourses: [crs], selectedCourse: crs };
  }
  return { allowedCourses: courses, selectedCourse: null };
}

function buildBankScopeWhere(alias, url, allowedCourseIds) {
  const where = [`${alias}.deleted_at IS NULL`];
  const params = [];

  const courseId = url.searchParams.get('course_id');
  const topicId = url.searchParams.get('topic_id');
  const chapterId = url.searchParams.get('chapter_id');
  const lessonId = url.searchParams.get('lesson_id');

  if (courseId) {
    where.push(`${alias}.course_id = ?`);
    params.push(courseId);
  } else if (allowedCourseIds.length) {
    where.push(`${alias}.course_id IN (${allowedCourseIds.map(() => '?').join(',')})`);
    params.push(...allowedCourseIds);
  } else {
    where.push('1 = 0');
  }

  // Lọc theo nhánh cây qua quan hệ JOIN trực tiếp l -> ch -> t (nếu đã gắn lesson_id)
  if (lessonId) {
    where.push(`${alias}.lesson_id = ?`);
    params.push(lessonId);
  } else if (chapterId) {
    where.push(`(ch.id = ? OR ${alias}.chapter_id = ?)`);
    params.push(chapterId, chapterId);
  } else if (topicId) {
    where.push(`(ch.topic_id = ? OR ${alias}.topic_id = ?)`);
    params.push(topicId, topicId);
  }
  return { where, params };
}

export function registerBankRoutes(route) {
  // ---------- 1. Cây thư mục dùng chung cho cả 3 ngân hàng (100% động từ Cây nội dung)
  route('GET', '/banks/tree', ({ db, user, url }) => {
    const { allowedCourses } = resolveCourseFilterScope(db, user, url);
    const tree = allowedCourses.map((c) => {
      const topics = buildCourseTree(db, c.id);
      const qAll = db.prepare('SELECT COUNT(*) n FROM question_bank_items WHERE course_id = ? AND deleted_at IS NULL').get(c.id).n;
      const aAll = db.prepare('SELECT COUNT(*) n FROM assignment_bank_items WHERE course_id = ? AND deleted_at IS NULL').get(c.id).n;
      const rAll = db.prepare('SELECT COUNT(*) n FROM learning_resources WHERE course_id = ? AND class_id IS NULL AND deleted_at IS NULL').get(c.id).n;
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        subject: c.subject || '',
        questions_count: qAll,
        assignments_count: aAll,
        resources_count: rAll,
        can_edit: canEditCourseDraft(db, user, c),
        topics,
      };
    });
    return { courses: tree };
  });

  // ---------- 2. NGÂN HÀNG CÂU HỎI (QUESTION BANK)
  route('GET', '/banks/questions', ({ db, user, url }) => {
    const { allowedCourses } = resolveCourseFilterScope(db, user, url);
    const { page, size, offset } = pageParams(url, 30, 200);
    const { where, params } = buildBankScopeWhere('qb', url, allowedCourses.map((c) => c.id));
    const qType = url.searchParams.get('question_type');
    if (qType) { where.push('qb.question_type = ?'); params.push(qType); }
    const diff = url.searchParams.get('difficulty');
    if (diff) { where.push('qb.difficulty = ?'); params.push(diff); }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) { where.push('(qb.prompt LIKE ? OR qb.tags_json LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

    const joins = `
      FROM question_bank_items qb
      LEFT JOIN courses c ON c.id = qb.course_id
      LEFT JOIN lessons l ON l.id = qb.lesson_id
      LEFT JOIN chapters ch ON ch.id = COALESCE(l.chapter_id, qb.chapter_id)
      LEFT JOIN course_topics t ON t.id = COALESCE(ch.topic_id, qb.topic_id)
    `;
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n ${joins} WHERE ${whereSql}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT qb.*, c.code AS course_code, c.title AS course_title,
                t.id AS resolved_topic_id, t.title AS topic_title,
                ch.id AS resolved_chapter_id, ch.title AS chapter_title,
                l.title AS lesson_title
         ${joins} WHERE ${whereSql} ORDER BY qb.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, size, offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        course_id: r.course_id,
        course_code: r.course_code || '',
        course_title: r.course_title || '',
        topic_id: r.resolved_topic_id || r.topic_id || null,
        topic_title: r.topic_title || '',
        chapter_id: r.resolved_chapter_id || r.chapter_id || null,
        chapter_title: r.chapter_title || '',
        lesson_id: r.lesson_id || null,
        lesson_title: r.lesson_title || '',
        subject: r.subject || '',
        question_type: r.question_type,
        prompt: r.prompt,
        options: safeJson(r.options_json, []),
        answer_key: safeJson(r.answer_key_json, {}),
        points: Number(r.points || 1),
        explanation: r.explanation || '',
        correct_feedback: r.correct_feedback || '',
        wrong_feedback: r.wrong_feedback || '',
        difficulty: r.difficulty || 'MEDIUM',
        tags: safeJson(r.tags_json, []),
        updated_at: r.updated_at,
      })),
      page,
      page_size: size,
      total,
    };
  });

  route('POST', '/banks/questions', ({ db, user, body }) => {
    const { lesson, chapter, topic, course } = assertLeafLessonTarget(db, user, body, body.course_id || null);
    let spec;
    try {
      spec = normalizeQuestionSpec(body, 'Câu hỏi ngân hàng');
    } catch (err) {
      if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
      throw err;
    }
    const difficulty = oneOf(body, 'difficulty', ['EASY', 'MEDIUM', 'HARD'], { fallback: 'MEDIUM', label: 'độ khó' });
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [];
    const id = `qb_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    db.prepare(
      `INSERT INTO question_bank_items (
         id, course_id, topic_id, chapter_id, lesson_id, subject, question_type, prompt, options_json, answer_key_json,
         points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, course.id, topic?.id || null, chapter.id, lesson.id, course.subject || '',
      spec.question_type, spec.prompt, JSON.stringify(spec.options || []), JSON.stringify(spec.answer_key || {}),
      spec.points, spec.explanation || '', spec.correct_feedback || '', spec.wrong_feedback || '',
      difficulty, JSON.stringify(tags), user.id, now, now
    );
    return [201, {
      id, course_id: course.id, topic_id: topic?.id || null, chapter_id: chapter.id, lesson_id: lesson.id,
      ...spec, difficulty, tags, updated_at: now,
    }];
  });

  route('PATCH', '/banks/questions/:id', ({ db, user, body, params }) => {
    const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền sửa câu hỏi này.');

    let lessonId = row.lesson_id;
    let chapterId = row.chapter_id;
    let topicId = row.topic_id;
    if ('lesson_id' in body && body.lesson_id !== row.lesson_id) {
      const target = assertLeafLessonTarget(db, user, { lesson_id: body.lesson_id, node_level: body.node_level }, crs.id);
      lessonId = target.lesson.id;
      chapterId = target.chapter.id;
      topicId = target.topic?.id || null;
    }

    const merged = {
      id: row.id,
      question_type: body.question_type || row.question_type,
      prompt: body.prompt !== undefined ? body.prompt : row.prompt,
      options: body.options !== undefined ? body.options : safeJson(row.options_json, []),
      answer_key: body.answer_key !== undefined ? body.answer_key : safeJson(row.answer_key_json, {}),
      points: body.points !== undefined ? body.points : row.points,
      explanation: body.explanation !== undefined ? body.explanation : row.explanation,
      correct_feedback: body.correct_feedback !== undefined ? body.correct_feedback : row.correct_feedback,
      wrong_feedback: body.wrong_feedback !== undefined ? body.wrong_feedback : row.wrong_feedback,
    };
    let spec;
    try {
      spec = normalizeQuestionSpec(merged, 'Câu hỏi ngân hàng');
    } catch (err) {
      if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
      throw err;
    }
    const difficulty = 'difficulty' in body ? oneOf(body, 'difficulty', ['EASY', 'MEDIUM', 'HARD'], { required: true }) : row.difficulty;
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : safeJson(row.tags_json, []);
    const now = nowIso();
    db.prepare(
      `UPDATE question_bank_items SET topic_id = ?, chapter_id = ?, lesson_id = ?, question_type = ?, prompt = ?,
         options_json = ?, answer_key_json = ?, points = ?, explanation = ?, correct_feedback = ?, wrong_feedback = ?,
         difficulty = ?, tags_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      topicId, chapterId, lessonId, spec.question_type, spec.prompt,
      JSON.stringify(spec.options || []), JSON.stringify(spec.answer_key || {}), spec.points,
      spec.explanation || '', spec.correct_feedback || '', spec.wrong_feedback || '',
      difficulty, JSON.stringify(tags), now, row.id
    );
    return { id: row.id, lesson_id: lessonId, chapter_id: chapterId, topic_id: topicId, ...spec, difficulty, tags, updated_at: now };
  });

  route('POST', '/banks/questions/import', ({ db, user, body }) => {
    const { lesson, chapter, topic, course } = assertLeafLessonTarget(db, user, body, body.course_id || null);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 200) fail(422, 'VALIDATION_ERROR', 'Cần gửi từ 1 đến 200 câu hỏi để import.');
    const now = nowIso();
    const createdIds = [];
    tx(db, () => {
      items.forEach((raw, idx) => {
        let spec;
        try {
          spec = normalizeQuestionSpec(raw, `Câu hỏi #${idx + 1}`);
        } catch (err) {
          if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
          throw err;
        }
        const id = `qb_${crypto.randomBytes(5).toString('hex')}`;
        const diff = ['EASY', 'MEDIUM', 'HARD'].includes(raw.difficulty) ? raw.difficulty : 'MEDIUM';
        const tags = Array.isArray(raw.tags) ? raw.tags.slice(0, 12) : [];
        db.prepare(
          `INSERT INTO question_bank_items (
             id, course_id, topic_id, chapter_id, lesson_id, subject, question_type, prompt, options_json, answer_key_json,
             points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, course.id, topic?.id || null, chapter.id, lesson.id, course.subject || '',
          spec.question_type, spec.prompt, JSON.stringify(spec.options || []), JSON.stringify(spec.answer_key || {}),
          spec.points, spec.explanation || '', spec.correct_feedback || '', spec.wrong_feedback || '',
          diff, JSON.stringify(tags), user.id, now, now
        );
        createdIds.push(id);
      });
    });
    return [201, { imported_count: createdIds.length, lesson_id: lesson.id, ids: createdIds }];
  });

  route('GET', '/banks/questions/export', ({ db, user, url }) => {
    const { allowedCourses } = resolveCourseFilterScope(db, user, url);
    const { where, params } = buildBankScopeWhere('qb', url, allowedCourses.map((c) => c.id));
    const rows = db
      .prepare(`SELECT qb.* FROM question_bank_items qb LEFT JOIN lessons l ON l.id = qb.lesson_id LEFT JOIN chapters ch ON ch.id = COALESCE(l.chapter_id, qb.chapter_id) WHERE ${where.join(' AND ')} ORDER BY qb.created_at`)
      .all(...params);
    return {
      exported_at: nowIso(),
      total: rows.length,
      items: rows.map((r) => ({
        lesson_id: r.lesson_id,
        question_type: r.question_type,
        prompt: r.prompt,
        options: safeJson(r.options_json, []),
        answer_key: safeJson(r.answer_key_json, {}),
        points: Number(r.points || 1),
        difficulty: r.difficulty,
        explanation: r.explanation || '',
        tags: safeJson(r.tags_json, []),
      })),
    };
  });

  route('DELETE', '/banks/questions/:id', ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền xóa câu hỏi này.');
    db.prepare('UPDATE question_bank_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
    return { deleted_id: row.id };
  });

  // ---------- 3. NGÂN HÀNG BÀI TẬP (ASSIGNMENT BANK)
  route('GET', '/banks/assignments', ({ db, user, url }) => {
    const { allowedCourses } = resolveCourseFilterScope(db, user, url);
    const { page, size, offset } = pageParams(url, 30, 200);
    const { where, params } = buildBankScopeWhere('ab', url, allowedCourses.map((c) => c.id));
    const q = (url.searchParams.get('q') || '').trim();
    if (q) { where.push('(ab.title LIKE ? OR ab.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

    const joins = `
      FROM assignment_bank_items ab
      LEFT JOIN courses c ON c.id = ab.course_id
      LEFT JOIN lessons l ON l.id = ab.lesson_id
      LEFT JOIN chapters ch ON ch.id = COALESCE(l.chapter_id, ab.chapter_id)
      LEFT JOIN course_topics t ON t.id = COALESCE(ch.topic_id, ab.topic_id)
    `;
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n ${joins} WHERE ${whereSql}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT ab.*, c.code AS course_code, c.title AS course_title,
                t.id AS resolved_topic_id, t.title AS topic_title,
                ch.id AS resolved_chapter_id, ch.title AS chapter_title,
                l.title AS lesson_title
         ${joins} WHERE ${whereSql} ORDER BY ab.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, size, offset);

    return {
      items: rows.map((r) => ({
        ...r,
        topic_id: r.resolved_topic_id || r.topic_id || null,
        chapter_id: r.resolved_chapter_id || r.chapter_id || null,
        allow_resubmit: Boolean(r.allow_resubmit),
        rubric: safeJson(r.rubric_json, []),
        attachments: safeJson(r.attachments_json, []),
        tags: safeJson(r.tags_json, []),
      })),
      page,
      page_size: size,
      total,
    };
  });

  route('POST', '/banks/assignments', ({ db, user, body }) => {
    const { lesson, chapter, topic, course } = assertLeafLessonTarget(db, user, body, body.course_id || null);
    const title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên bài tập' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' }) || '';
    const instructions = text(body, 'instructions', { required: true, max: 10000, label: 'hướng dẫn làm bài' });
    const submissionType = oneOf(body, 'submission_type', ['TEXT', 'FILE', 'LINK', 'MIXED'], { fallback: 'MIXED', label: 'hình thức nộp' });
    const maxScore = Number.isFinite(Number(body.max_score)) ? Math.max(1, Math.min(1000, Number(body.max_score))) : 10;
    const maxAttempts = intField(body, 'max_attempts', { min: 1, max: 20, label: 'số lần nộp tối đa' }) ?? 3;
    const allowResubmit = body.allow_resubmit === false ? 0 : 1;
    const rubric = Array.isArray(body.rubric) ? body.rubric.slice(0, 20) : [];
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 20) : [];
    const tags = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];
    const id = `ab_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    db.prepare(
      `INSERT INTO assignment_bank_items (
         id, course_id, topic_id, chapter_id, lesson_id, title, description, instructions,
         submission_type, max_score, max_attempts, allow_resubmit, rubric_json, attachments_json, tags_json, status,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
    ).run(
      id, course.id, topic?.id || null, chapter.id, lesson.id, title, description, instructions,
      submissionType, maxScore, maxAttempts, allowResubmit, JSON.stringify(rubric), JSON.stringify(attachments), JSON.stringify(tags),
      user.id, now, now
    );
    return [201, db.prepare('SELECT * FROM assignment_bank_items WHERE id = ?').get(id)];
  });

  route('POST', '/banks/assignments/import', ({ db, user, body }) => {
    const { lesson, chapter, topic, course } = assertLeafLessonTarget(db, user, body, body.course_id || null);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 100) fail(422, 'VALIDATION_ERROR', 'Cần gửi từ 1 đến 100 bài tập.');
    const now = nowIso();
    const createdIds = [];
    tx(db, () => {
      for (const raw of items) {
        const title = text(raw, 'title', { required: true, min: 3, max: 200, label: 'tên bài tập' });
        const instructions = text(raw, 'instructions', { required: true, max: 10000, label: 'hướng dẫn' });
        const id = `ab_${crypto.randomBytes(5).toString('hex')}`;
        db.prepare(
          `INSERT INTO assignment_bank_items (
             id, course_id, topic_id, chapter_id, lesson_id, title, description, instructions,
             submission_type, max_score, max_attempts, allow_resubmit, rubric_json, attachments_json, tags_json, status,
             created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'ACTIVE', ?, ?, ?)`
        ).run(
          id, course.id, topic?.id || null, chapter.id, lesson.id, title,
          String(raw.description || '').slice(0, 2000), instructions,
          ['TEXT', 'FILE', 'LINK', 'MIXED'].includes(raw.submission_type) ? raw.submission_type : 'MIXED',
          Number(raw.max_score || 10), Number(raw.max_attempts || 3), raw.allow_resubmit === false ? 0 : 1,
          JSON.stringify(Array.isArray(raw.rubric) ? raw.rubric : []), JSON.stringify(Array.isArray(raw.tags) ? raw.tags : []),
          user.id, now, now
        );
        createdIds.push(id);
      }
    });
    return [201, { imported_count: createdIds.length, lesson_id: lesson.id, ids: createdIds }];
  });

  route('PATCH', '/banks/assignments/:id', ({ db, user, body, params }) => {
    const row = db.prepare('SELECT * FROM assignment_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập mẫu.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền sửa bài tập này.');

    let lessonId = row.lesson_id;
    let chapterId = row.chapter_id;
    let topicId = row.topic_id;
    if ('lesson_id' in body && body.lesson_id !== row.lesson_id) {
      const target = assertLeafLessonTarget(db, user, { lesson_id: body.lesson_id, node_level: body.node_level }, crs.id);
      lessonId = target.lesson.id;
      chapterId = target.chapter.id;
      topicId = target.topic?.id || null;
    }
    const f = { topic_id: topicId, chapter_id: chapterId, lesson_id: lessonId };
    if ('title' in body) f.title = text(body, 'title', { required: true, min: 3, max: 200, label: 'tên bài tập' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' }) || '';
    if ('instructions' in body) f.instructions = text(body, 'instructions', { required: true, max: 10000, label: 'hướng dẫn' });
    if ('submission_type' in body) f.submission_type = oneOf(body, 'submission_type', ['TEXT', 'FILE', 'LINK', 'MIXED'], { required: true });
    if ('max_score' in body) f.max_score = Number(body.max_score) || 10;
    if ('max_attempts' in body) f.max_attempts = intField(body, 'max_attempts', { min: 1, max: 20, required: true });
    if ('allow_resubmit' in body) f.allow_resubmit = body.allow_resubmit ? 1 : 0;
    if (Array.isArray(body.tags)) f.tags_json = JSON.stringify(body.tags.slice(0, 12));
    const keys = Object.keys(f);
    db.prepare(`UPDATE assignment_bank_items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => f[k]), nowIso(), row.id);
    return db.prepare('SELECT * FROM assignment_bank_items WHERE id = ?').get(row.id);
  });

  route('DELETE', '/banks/assignments/:id', ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM assignment_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài tập mẫu.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền xóa bài tập này.');
    db.prepare('UPDATE assignment_bank_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
    return { deleted_id: row.id };
  });

  // ---------- 4. NGÂN HÀNG TÀI NGUYÊN (LEARNING RESOURCES)
  route('GET', '/banks/resources', ({ db, user, url }) => {
    const { allowedCourses } = resolveCourseFilterScope(db, user, url);
    const { page, size, offset } = pageParams(url, 30, 200);
    const { where, params } = buildBankScopeWhere('r', url, allowedCourses.map((c) => c.id));
    where.push('r.class_id IS NULL');
    const rType = url.searchParams.get('resource_type');
    if (rType) { where.push('r.resource_type = ?'); params.push(rType); }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) { where.push('(r.title LIKE ? OR r.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

    const joins = `
      FROM learning_resources r
      LEFT JOIN courses c ON c.id = r.course_id
      LEFT JOIN lessons l ON l.id = r.lesson_id
      LEFT JOIN chapters ch ON ch.id = COALESCE(l.chapter_id, r.chapter_id)
      LEFT JOIN course_topics t ON t.id = COALESCE(ch.topic_id, r.topic_id)
    `;
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n ${joins} WHERE ${whereSql}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT r.*, c.code AS course_code, c.title AS course_title,
                t.id AS resolved_topic_id, t.title AS topic_title,
                ch.id AS resolved_chapter_id, ch.title AS chapter_title,
                l.title AS lesson_title
         ${joins} WHERE ${whereSql} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, size, offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        course_id: r.course_id,
        course_code: r.course_code || '',
        course_title: r.course_title || '',
        topic_id: r.resolved_topic_id || r.topic_id || null,
        topic_title: r.topic_title || '',
        chapter_id: r.resolved_chapter_id || r.chapter_id || null,
        chapter_title: r.chapter_title || '',
        lesson_id: r.lesson_id || null,
        lesson_title: r.lesson_title || '',
        title: r.title,
        description: r.description || '',
        resource_type: r.resource_type,
        storage_provider: r.storage_provider,
        url: r.storage_provider === 'EXTERNAL_URL' ? r.storage_key : null,
        file_name: r.file_name || null,
        mime_type: r.mime_type || null,
        file_size_bytes: r.file_size_bytes || null,
        duration_seconds: r.duration_seconds || null,
        visibility: r.visibility || 'ENROLLED',
        updated_at: r.updated_at,
      })),
      page,
      page_size: size,
      total,
    };
  });

  route('POST', '/banks/resources', ({ db, user, body }) => {
    const { lesson, chapter, topic, course } = assertLeafLessonTarget(db, user, body, body.course_id || null);
    const title = text(body, 'title', { required: true, min: 2, max: 200, label: 'tên tài nguyên' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' }) || '';
    const resourceType = oneOf(body, 'resource_type', ['LINK', 'VIDEO', 'PDF', 'FILE'], { fallback: 'LINK', label: 'loại tài nguyên' });
    const rawUrl = text(body, 'url', { required: true, max: 2048, label: 'đường dẫn tài nguyên' });
    let u;
    try {
      u = new URL(rawUrl);
    } catch {
      fail(422, 'VALIDATION_ERROR', 'Đường dẫn tài nguyên không hợp lệ.');
    }
    if (!['http:', 'https:'].includes(u.protocol)) fail(422, 'VALIDATION_ERROR', 'Chỉ hỗ trợ đường dẫn http/https.');
    const visibility = oneOf(body, 'visibility', ['ENROLLED', 'INSTRUCTOR_ONLY'], { fallback: 'ENROLLED', label: 'quyền xem' });
    const id = `res_${crypto.randomBytes(6).toString('hex')}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO learning_resources (
         id, course_id, topic_id, chapter_id, lesson_id, title, description, visibility,
         resource_type, storage_provider, storage_key, status, processing_status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXTERNAL_URL', ?, 'READY', 'READY', ?, ?, ?)`
    ).run(id, course.id, topic?.id || null, chapter.id, lesson.id, title, description, visibility, resourceType, u.toString(), user.id, now, now);
    return [201, { id, course_id: course.id, topic_id: topic?.id || null, chapter_id: chapter.id, lesson_id: lesson.id, title, resource_type: resourceType, url: u.toString() }];
  });

  route('PATCH', '/banks/resources/:id', ({ db, user, body, params }) => {
    const row = db.prepare('SELECT * FROM learning_resources WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài nguyên.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền sửa tài nguyên này.');
    let lessonId = row.lesson_id;
    let chapterId = row.chapter_id;
    let topicId = row.topic_id;
    if ('lesson_id' in body && body.lesson_id !== row.lesson_id) {
      const target = assertLeafLessonTarget(db, user, { lesson_id: body.lesson_id, node_level: body.node_level }, crs.id);
      lessonId = target.lesson.id;
      chapterId = target.chapter.id;
      topicId = target.topic?.id || null;
    }
    const f = { topic_id: topicId, chapter_id: chapterId, lesson_id: lessonId };
    if ('title' in body) f.title = text(body, 'title', { required: true, min: 2, max: 200, label: 'tên tài nguyên' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' }) || '';
    if ('visibility' in body) f.visibility = oneOf(body, 'visibility', ['ENROLLED', 'INSTRUCTOR_ONLY'], { required: true });
    const keys = Object.keys(f);
    db.prepare(`UPDATE learning_resources SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => f[k]), nowIso(), row.id);
    return { id: row.id, ...f };
  });

  route('DELETE', '/banks/resources/:id', ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM learning_resources WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài nguyên.');
    const crs = db.prepare('SELECT * FROM courses WHERE id = ?').get(row.course_id);
    if (!canEditCourseDraft(db, user, crs)) fail(403, 'BANK_EDIT_FORBIDDEN', 'Bạn không có quyền xóa tài nguyên.');
    db.prepare('UPDATE learning_resources SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
    return { deleted_id: row.id };
  });
}
