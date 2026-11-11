/**
 * LMSPLUS Lesson Studio — Backend APIs cho:
 *  - Chế độ A: Soạn giáo án gốc của Khóa học (tree, nhân bản chương/bài, lịch sử phiên bản, cảnh báo hoàn thiện)
 *  - Chế độ B: Tùy biến nội dung giảng dạy riêng cho Lớp học (kế thừa khóa học gốc + bổ sung block/video/quiz riêng)
 *  - Hệ thống Video tải lên theo phần (Chunked Upload, hủy upload, thay thế video) & HTTP Range Streaming (206 Partial Content)
 *  - Ngân hàng câu hỏi dùng chung (Question Bank: 5 dạng câu hỏi)
 *  - Interactive Video Quiz gắn mốc thời gian (Timeline Markers) & Báo cáo kết quả theo lớp
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseYouTubeUrl } from '../../shared/youtube.mjs';
import { BLOCK_SCHEMA_VERSION, normalizeSnapshot, validateBlocks, validateDirectVideoUrl } from './blocks.mjs';
import { draftBlocks, getCourse, latestPublishedBlocks, lessonContext, outline } from './courses.mjs';
import { fail, intField, nowIso, oneOf, safeFilename, text, tx } from './http.mjs';
import {
  MARKER_BEHAVIORS,
  QUESTION_TYPES,
  QuizValidationError,
  gradeQuestionResponse,
  normalizeQuestionSpec,
  publicCorrectAnswer,
  stripQuestionForStudent,
} from './quizEngine.mjs';
import {
  canCreateCourse,
  canEditCourseDraft,
  canManageCourse,
  canViewCourse,
  classCapabilities,
  classRole,
  safeJson,
  staffAssignments,
} from './scope.mjs';

const VIDEO_EXT_MIME = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
};

const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // 250 MB
const MAX_VIDEO_CHUNK_BYTES = 5 * 1024 * 1024; // 5 MB mỗi mảnh nhị phân
const MAX_PDF_BYTES = 12 * 1024 * 1024; // 12 MB
const RANGE_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB mỗi phản hồi 206 mở

// ------------------------------------------------------------------ Media Stream Token (HMAC)

export function createMediaStreamToken(secret, resourceId, userId, expiresInSec = 14400) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const payload = Buffer.from(JSON.stringify({ rid: resourceId, uid: userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`media.${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyMediaStreamToken(secret, token, expectedResourceId) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', secret).update(`media.${payloadB64}`).digest('base64url');
    if (sig !== expectedSig) return null;
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!decoded || decoded.rid !== expectedResourceId) return null;
    if (Number(decoded.exp) < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function buildMediaStreamUrl(secret, resourceId, userId) {
  const st = createMediaStreamToken(secret, resourceId, userId);
  return `/api/v1/teaching/media/${encodeURIComponent(resourceId)}/stream?st=${encodeURIComponent(st)}`;
}

// ------------------------------------------------------------------ Quyền & Helpers

export function canEditClassContent(db, user, cls) {
  const caps = classCapabilities(db, user, cls);
  if (caps.can_manage_class) return true;
  if (caps.role === 'TEACHING_ASSISTANT') {
    const a = staffAssignments(db, user.id, cls.id)[0];
    return Boolean(a && a.permissions && a.permissions.can_manage_materials);
  }
  return false;
}

export function canPublishClassContent(db, user, cls) {
  return classCapabilities(db, user, cls).can_manage_class;
}

function canStreamResource(db, user, resRow) {
  const course = getCourse(db, resRow.course_id);
  if (!course) return false;
  if (canViewCourse(db, user, course)) return true;
  if (resRow.class_id) {
    const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(resRow.class_id);
    if (cls && classRole(db, user, cls)) {
      if (resRow.visibility === 'INSTRUCTOR_ONLY' && classRole(db, user, cls) === 'STUDENT') return false;
      return true;
    }
    return false;
  }
  if (course.status !== 'PUBLISHED') return false;
  if (resRow.visibility === 'INSTRUCTOR_ONLY') return false;
  const enrolled = db
    .prepare(
      `SELECT 1 FROM class_enrollments e
       JOIN subject_classes sc ON sc.id = e.subject_class_id
       WHERE e.student_id = ? AND e.status = 'ACTIVE'
         AND sc.course_id = ? AND sc.status IN ('ACTIVE','UPCOMING','COMPLETED')
       LIMIT 1`
    )
    .get(user.id, course.id);
  return Boolean(enrolled);
}

export function mapMarkerRow(r) {
  const snap = safeJson(r.question_snapshot_json, {});
  return {
    id: r.id,
    lesson_id: r.lesson_id,
    class_id: r.class_id || null,
    origin: r.class_id ? 'CLASS_CUSTOM' : 'INHERITED',
    block_id: r.block_id,
    timestamp_sec: Number(r.timestamp_sec || 0),
    sort_order: Number(r.sort_order || 0),
    behavior: r.behavior || 'PAUSE_AND_ASK',
    title: r.title || '',
    info_body: r.info_body || '',
    question_id: r.question_id || null,
    question: snap && Object.keys(snap).length > 0 ? snap : null,
    is_required: Boolean(r.is_required),
    allow_skip: Boolean(r.allow_skip),
    max_attempts: Number(r.max_attempts ?? 2),
    show_answer_after_submit: Boolean(r.show_answer_after_submit),
    show_explanation: Boolean(r.show_explanation),
    allow_review: Boolean(r.allow_review),
    updated_at: r.updated_at,
  };
}

export function draftLessonMarkers(db, lessonId, classId = null) {
  const rows = classId
    ? db
        .prepare(
          'SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id = ? ORDER BY timestamp_sec ASC, sort_order ASC'
        )
        .all(lessonId, classId)
    : db
        .prepare(
          'SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec ASC, sort_order ASC'
        )
        .all(lessonId);
  return rows.map(mapMarkerRow);
}

export function latestPublishedMarkers(db, lessonId) {
  const v = db
    .prepare('SELECT markers_snapshot_json FROM lesson_versions WHERE lesson_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(lessonId);
  if (v && v.markers_snapshot_json) {
    const parsed = safeJson(v.markers_snapshot_json, null);
    if (Array.isArray(parsed)) {
      return parsed.map((r) => (r.question !== undefined ? r : mapMarkerRow(r)));
    }
  }
  return draftLessonMarkers(db, lessonId, null);
}

export function getPublishedClassCustom(db, classId, lessonId) {
  const meta = db
    .prepare('SELECT * FROM class_lesson_customs WHERE subject_class_id = ? AND lesson_id = ?')
    .get(classId, lessonId);
  if (!meta) return null;
  if (meta.published_snapshot_json) {
    const snap = safeJson(meta.published_snapshot_json, null);
    if (snap && typeof snap === 'object') {
      return {
        instructor_note: snap.instructor_note || '',
        custom_objectives: snap.custom_objectives || '',
        blocks: Array.isArray(snap.blocks) ? snap.blocks : [],
        markers: Array.isArray(snap.markers)
          ? snap.markers.map((r) => (r.question !== undefined ? r : mapMarkerRow(r)))
          : [],
      };
    }
  }
  if (meta.publish_status === 'PUBLISHED') {
    const blocks = db
      .prepare(
        'SELECT * FROM class_lesson_blocks WHERE subject_class_id = ? AND lesson_id = ? AND is_published = 1 ORDER BY sort_order'
      )
      .all(classId, lessonId)
      .map((b) => ({
        id: b.id,
        block_type: b.block_type,
        sort_order: b.sort_order,
        anchor_block_id: b.anchor_block_id || null,
        origin: 'CLASS_CUSTOM',
        content: safeJson(b.content_json, {}),
      }))
      .filter((b) => !b.content?.display?.hidden);
    return {
      instructor_note: meta.instructor_note || '',
      custom_objectives: meta.custom_objectives || '',
      blocks,
      markers: draftLessonMarkers(db, lessonId, classId),
    };
  }
  return null;
}

export function resourceDto(row, jwtSecret, userId) {
  const isStreamable = ['VIDEO', 'PDF', 'FILE'].includes(row.resource_type) && row.storage_provider === 'LOCAL_DISK';
  return {
    id: row.id,
    course_id: row.course_id,
    class_id: row.class_id || null,
    title: row.title,
    description: row.description || '',
    visibility: row.visibility || 'ENROLLED',
    resource_type: row.resource_type,
    url: row.resource_type === 'LINK' ? row.storage_key : null,
    stream_url: isStreamable && !row.deleted_at ? buildMediaStreamUrl(jwtSecret, row.id, userId) : null,
    file_name: row.file_name || null,
    mime_type: row.mime_type || null,
    file_size_bytes: row.file_size_bytes ?? null,
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    thumbnail_url: row.thumbnail_url || '',
    processing_status: row.processing_status || 'READY',
    error_message: row.error_message || null,
    available: !row.deleted_at,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
  };
}

export function computeLessonWarnings(blocks, markers) {
  const warnings = [];
  if (!blocks || blocks.length === 0) {
    warnings.push('Bài học chưa có khối nội dung nào.');
    return warnings;
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const c = b.content || {};
    if (b.block_type === 'video') {
      if (c.source_type === 'UPLOAD' && !c.resource_id) warnings.push(`Khối Video #${i + 1} chưa chọn tệp video.`);
      if (c.source_type === 'YOUTUBE' && !c.video_id) warnings.push(`Khối Video #${i + 1} chưa gắn mã YouTube.`);
      if (c.source_type === 'DIRECT_URL' && !c.direct_url) warnings.push(`Khối Video #${i + 1} chưa nhập đường dẫn video.`);
      const dur = Number(c.duration_seconds || 0);
      if (dur > 0) {
        const overflow = (markers || []).filter((m) => m.block_id === b.id && Number(m.timestamp_sec) > dur);
        if (overflow.length > 0) {
          warnings.push(`Khối Video #${i + 1} có ${overflow.length} mốc câu hỏi vượt thời lượng video.`);
        }
      }
    } else if (b.block_type === 'youtube' && !c.video_id) {
      warnings.push(`Khối YouTube #${i + 1} chưa gắn video.`);
    } else if (b.block_type === 'quiz' && (!Array.isArray(c.questions) || c.questions.length === 0)) {
      warnings.push(`Khối Quiz #${i + 1} chưa có câu hỏi.`);
    } else if ((b.block_type === 'pdf' || b.block_type === 'file') && !c.resource_id) {
      warnings.push(`Khối Tài liệu #${i + 1} chưa gắn tệp.`);
    }
  }
  return warnings;
}

function validateAndPersistMarkers(db, { lessonId, classId = null, courseId, markersInput, blockIdFilter = null, userId }) {
  if (!Array.isArray(markersInput)) fail(422, 'VALIDATION_ERROR', 'Danh sách mốc tương tác phải là mảng.');
  if (markersInput.length > 100) fail(422, 'VALIDATION_ERROR', 'Mỗi bài học tối đa 100 mốc tương tác trên video.');

  const now = nowIso();
  const normalized = markersInput.map((m, idx) => {
    if (!m || typeof m !== 'object') fail(422, 'VALIDATION_ERROR', `Mốc #${idx + 1} không hợp lệ.`);
    const blockId = String(m.block_id || '').trim();
    if (!blockId || !/^[A-Za-z0-9_-]{1,64}$/.test(blockId)) {
      fail(422, 'VALIDATION_ERROR', `Mốc #${idx + 1}: thiếu mã khối video (block_id).`);
    }
    const ts = Number(m.timestamp_sec);
    if (!Number.isFinite(ts) || ts < 0 || ts > 86400) {
      fail(422, 'VALIDATION_ERROR', `Mốc #${idx + 1}: thời điểm (giây) không hợp lệ.`);
    }
    const behavior = String(m.behavior || 'PAUSE_AND_ASK').toUpperCase();
    if (!MARKER_BEHAVIORS.includes(behavior)) {
      fail(422, 'VALIDATION_ERROR', `Mốc #${idx + 1}: hành vi "${behavior}" không hợp lệ.`);
    }
    const id =
      typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.id)
        ? m.id
        : `vqm_${crypto.randomBytes(5).toString('hex')}`;
    const title = String(m.title || '').trim().slice(0, 250);
    const infoBody = String(m.info_body || '').trim().slice(0, 3000);
    let questionId = typeof m.question_id === 'string' && m.question_id.trim() ? m.question_id.trim() : null;
    let questionSnap = {};

    if (behavior === 'INFO_ONLY') {
      if (!title && !infoBody) {
        fail(422, 'VALIDATION_ERROR', `Mốc thông tin #${idx + 1}: cần nhập tiêu đề hoặc nội dung ghi chú.`);
      }
    } else {
      let rawQ = m.question;
      if (!rawQ && questionId) {
        const bankRow = db
          .prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL')
          .get(questionId);
        if (!bankRow) fail(422, 'VALIDATION_ERROR', `Mốc #${idx + 1}: không tìm thấy câu hỏi trong ngân hàng.`);
        rawQ = {
          id: bankRow.id,
          question_id: bankRow.id,
          question_type: bankRow.question_type,
          prompt: bankRow.prompt,
          options: safeJson(bankRow.options_json, []),
          answer_key: safeJson(bankRow.answer_key_json, {}),
          points: bankRow.points,
          explanation: bankRow.explanation || '',
          correct_feedback: bankRow.correct_feedback || '',
          wrong_feedback: bankRow.wrong_feedback || '',
        };
      }
      try {
        questionSnap = normalizeQuestionSpec(rawQ, `Mốc #${idx + 1}`);
      } catch (err) {
        if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
        throw err;
      }

      if (m.save_to_bank && !questionId) {
        questionId = `qb_${crypto.randomBytes(5).toString('hex')}`;
        questionSnap.question_id = questionId;
        const crs = getCourse(db, courseId);
        db.prepare(
          `INSERT INTO question_bank_items (
             id, course_id, subject, question_type, prompt, options_json, answer_key_json,
             points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MEDIUM', '[]', ?, ?, ?)`
        ).run(
          questionId,
          courseId,
          crs?.subject || '',
          questionSnap.question_type,
          questionSnap.prompt,
          JSON.stringify(questionSnap.options || []),
          JSON.stringify(questionSnap.answer_key || {}),
          questionSnap.points,
          questionSnap.explanation || '',
          questionSnap.correct_feedback || '',
          questionSnap.wrong_feedback || '',
          userId,
          now,
          now
        );
      }
    }

    const isRequired = behavior === 'PAUSE_AND_ASK' ? (m.is_required !== false ? 1 : 0) : 0;
    const allowSkip = behavior === 'PAUSE_OPTIONAL' ? 1 : m.allow_skip ? 1 : 0;
    const maxAttempts = Number.isFinite(Number(m.max_attempts))
      ? Math.max(0, Math.min(20, Math.floor(Number(m.max_attempts))))
      : 2;

    return {
      id,
      block_id: blockId,
      timestamp_sec: Math.round(ts * 100) / 100,
      sort_order: Number.isFinite(Number(m.sort_order)) ? Number(m.sort_order) : (idx + 1) * 10,
      behavior,
      title,
      info_body: infoBody,
      question_id: questionId,
      question_snapshot_json: JSON.stringify(questionSnap),
      is_required: isRequired,
      allow_skip: allowSkip,
      max_attempts: maxAttempts,
      show_answer_after_submit: m.show_answer_after_submit !== false ? 1 : 0,
      show_explanation: m.show_explanation !== false ? 1 : 0,
      allow_review: m.allow_review !== false ? 1 : 0,
    };
  });

  normalized.sort((a, b) => a.timestamp_sec - b.timestamp_sec || a.sort_order - b.sort_order);

  tx(db, () => {
    if (classId) {
      if (blockIdFilter) {
        db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id = ? AND block_id = ?').run(
          lessonId,
          classId,
          blockIdFilter
        );
      } else {
        db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id = ?').run(lessonId, classId);
      }
    } else if (blockIdFilter) {
      db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL AND block_id = ?').run(
        lessonId,
        blockIdFilter
      );
    } else {
      db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL').run(lessonId);
    }

    const ins = db.prepare(
      `INSERT INTO video_quiz_markers (
         id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
         question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
         show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of normalized) {
      let mid = item.id;
      const clash = db.prepare('SELECT lesson_id FROM video_quiz_markers WHERE id = ?').get(mid);
      if (clash) mid = `vqm_${crypto.randomBytes(5).toString('hex')}`;
      ins.run(
        mid,
        lessonId,
        classId,
        item.block_id,
        item.timestamp_sec,
        item.sort_order,
        item.behavior,
        item.title,
        item.info_body,
        item.question_id,
        item.question_snapshot_json,
        item.is_required,
        item.allow_skip,
        item.max_attempts,
        item.show_answer_after_submit,
        item.show_explanation,
        item.allow_review,
        userId,
        now,
        now
      );
    }

    if (!classId) {
      db.prepare('UPDATE lessons SET updated_at = ? WHERE id = ?').run(now, lessonId);
    }
  });

  return draftLessonMarkers(db, lessonId, classId);
}

function questionBankDto(r) {
  return {
    id: r.id,
    course_id: r.course_id,
    subject: r.subject || '',
    question_type: r.question_type,
    prompt: r.prompt,
    options: safeJson(r.options_json, []),
    answer_key: safeJson(r.answer_key_json, {}),
    points: Number(r.points ?? 1),
    explanation: r.explanation || '',
    correct_feedback: r.correct_feedback || '',
    wrong_feedback: r.wrong_feedback || '',
    difficulty: r.difficulty || 'MEDIUM',
    tags: safeJson(r.tags_json, []),
    updated_at: r.updated_at,
  };
}

// ------------------------------------------------------------------ Đăng ký Routes

export function registerStudioRoutes(route, { uploadsDir, jwtSecret }) {
  // ==================== 1. MODE A — COURSE LESSON STUDIO ====================

  route('GET', '/studio/courses/:courseId', ({ db, user, params }) => {
    const course = getCourse(db, params.courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền truy cập khóa học này.');

    const rawOutline = outline(db, course.id);
    const enrichedOutline = rawOutline.map((ch) => ({
      ...ch,
      lessons: ch.lessons.map((l) => {
        const blocks = draftBlocks(db, l.id);
        const markers = draftLessonMarkers(db, l.id, null);
        const warnings = computeLessonWarnings(blocks, markers);
        const row = db.prepare('SELECT min_video_watch_pct, require_video_quizzes FROM lessons WHERE id = ?').get(l.id);
        return {
          ...l,
          min_video_watch_pct: Number(row?.min_video_watch_pct || 0),
          require_video_quizzes: Boolean(row?.require_video_quizzes ?? 1),
          blocks_count: blocks.length,
          video_markers_count: markers.length,
          warnings,
        };
      }),
    }));

    const classes = db
      .prepare(
        `SELECT sc.id, sc.code, sc.title, sc.status,
           (SELECT COUNT(*) FROM class_enrollments e WHERE e.subject_class_id = sc.id AND e.status = 'ACTIVE') AS student_count
         FROM subject_classes sc
         WHERE sc.course_id = ? AND sc.status NOT IN ('ARCHIVED','CANCELLED')
         ORDER BY sc.code`
      )
      .all(course.id);

    const resources = db
      .prepare(
        `SELECT r.*, u.full_name AS created_by_name
         FROM learning_resources r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.course_id = ? AND r.class_id IS NULL AND r.deleted_at IS NULL
         ORDER BY r.created_at DESC`
      )
      .all(course.id)
      .map((r) => resourceDto(r, jwtSecret, user.id));

    const qbCount = db
      .prepare('SELECT COUNT(*) AS n FROM question_bank_items WHERE course_id = ? AND deleted_at IS NULL')
      .get(course.id).n;

    return {
      mode: 'COURSE',
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        subject: course.subject || '',
        status: course.status || 'PUBLISHED',
        description: course.description || '',
        objectives: course.objectives || '',
      },
      outline: enrichedOutline,
      resources,
      question_bank_count: qbCount,
      classes_using: classes,
      capabilities: {
        can_manage: canManageCourse(db, user, course),
        can_edit_draft: canEditCourseDraft(db, user, course),
        can_publish: canManageCourse(db, user, course),
        can_duplicate: canCreateCourse(user),
      },
    };
  });

  // Nhân bản chương (kèm toàn bộ bài học, khối nội dung và mốc quiz trên video)
  route('POST', '/chapters/:id/duplicate', ({ db, user, params }) => {
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(params.id);
    if (!ch || !ch.course_id) fail(404, 'CHAPTER_NOT_FOUND', 'Không tìm thấy chương.');
    const course = getCourse(db, ch.course_id);
    if (!course || !canManageCourse(db, user, course)) {
      fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền nhân bản chương trong khóa học này.');
    }
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m, COUNT(*) n FROM chapters WHERE course_id = ?').get(course.id);
    const newChId = `ch_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `INSERT INTO chapters (id, subject_class_id, code, title, progress_pct, course_id, description, sort_order, status, updated_at)
         VALUES (?, '', ?, ?, 0, ?, ?, ?, 'DRAFT', ?)`
      ).run(newChId, `Chương ${max.n + 1}`, `${ch.title} (bản sao)`, course.id, ch.description || '', max.m + 10, now);

      const srcLessons = db
        .prepare("SELECT * FROM lessons WHERE chapter_id = ? AND publish_status <> 'ARCHIVED' ORDER BY sort_order")
        .all(ch.id);
      for (const l of srcLessons) {
        const newLesId = `les_${crypto.randomBytes(5).toString('hex')}`;
        db.prepare(
          `INSERT INTO lessons (
             id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
             required_video_pct, require_quick_check, last_video_position_sec, total_video_seconds, quick_check_passed,
             working_draft_revision, published_version, description, objectives, sort_order, publish_status,
             updated_at, completion_rule, min_video_watch_pct, require_video_quizzes
           ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, 0, 0, 0, ?, 0, 1, 0, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`
        ).run(
          newLesId,
          newChId,
          l.code,
          l.title,
          l.duration_minutes,
          l.duration_minutes * 60,
          l.description || '',
          l.objectives || '',
          l.sort_order,
          now,
          l.completion_rule || 'MANUAL',
          l.min_video_watch_pct || 0,
          l.require_video_quizzes ?? 1
        );

        const blockIdMap = {};
        for (const b of draftBlocks(db, l.id)) {
          const nbId = `blk_${crypto.randomBytes(6).toString('hex')}`;
          blockIdMap[b.id] = nbId;
          db.prepare(
            `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
          ).run(nbId, newLesId, BLOCK_SCHEMA_VERSION, b.block_type, b.sort_order, JSON.stringify(b.content));
        }

        const markers = db
          .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec, sort_order')
          .all(l.id);
        for (const m of markers) {
          db.prepare(
            `INSERT INTO video_quiz_markers (
               id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
               question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
               show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at
             ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            `vqm_${crypto.randomBytes(5).toString('hex')}`,
            newLesId,
            blockIdMap[m.block_id] || m.block_id,
            m.timestamp_sec,
            m.sort_order,
            m.behavior,
            m.title,
            m.info_body,
            m.question_id,
            m.question_snapshot_json,
            m.is_required,
            m.allow_skip,
            m.max_attempts,
            m.show_answer_after_submit,
            m.show_explanation,
            m.allow_review,
            user.id,
            now,
            now
          );
        }
      }
      db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    });

    return [201, { id: newChId, outline: outline(db, course.id) }];
  });

  // Nhân bản bài học (kèm khối nội dung và mốc quiz trên video)
  route('POST', '/lessons/:id/duplicate', ({ db, user, params }) => {
    const { lesson, chapter, course } = lessonContext(db, params.id);
    if (!canManageCourse(db, user, course)) {
      fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền nhân bản bài học này.');
    }
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m, COUNT(*) n FROM lessons WHERE chapter_id = ?').get(chapter.id);
    const newLesId = `les_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `INSERT INTO lessons (
           id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
           required_video_pct, require_quick_check, last_video_position_sec, total_video_seconds, quick_check_passed,
           working_draft_revision, published_version, description, objectives, sort_order, publish_status,
           updated_at, completion_rule, min_video_watch_pct, require_video_quizzes
         ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, 0, 0, 0, ?, 0, 1, 0, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`
      ).run(
        newLesId,
        chapter.id,
        String(max.n + 1),
        `${lesson.title} (bản sao)`.slice(0, 200),
        lesson.duration_minutes,
        lesson.duration_minutes * 60,
        lesson.description || '',
        lesson.objectives || '',
        max.m + 10,
        now,
        lesson.completion_rule || 'MANUAL',
        lesson.min_video_watch_pct || 0,
        lesson.require_video_quizzes ?? 1
      );

      const blockIdMap = {};
      for (const b of draftBlocks(db, lesson.id)) {
        const nbId = `blk_${crypto.randomBytes(6).toString('hex')}`;
        blockIdMap[b.id] = nbId;
        db.prepare(
          `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
        ).run(nbId, newLesId, BLOCK_SCHEMA_VERSION, b.block_type, b.sort_order, JSON.stringify(b.content));
      }

      const markers = db
        .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec, sort_order')
        .all(lesson.id);
      for (const m of markers) {
        db.prepare(
          `INSERT INTO video_quiz_markers (
             id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
             question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
             show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `vqm_${crypto.randomBytes(5).toString('hex')}`,
          newLesId,
          blockIdMap[m.block_id] || m.block_id,
          m.timestamp_sec,
          m.sort_order,
          m.behavior,
          m.title,
          m.info_body,
          m.question_id,
          m.question_snapshot_json,
          m.is_required,
          m.allow_skip,
          m.max_attempts,
          m.show_answer_after_submit,
          m.show_explanation,
          m.allow_review,
          user.id,
          now,
          now
        );
      }
      db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    });

    return [201, { id: newLesId, chapter_id: chapter.id, title: `${lesson.title} (bản sao)` }];
  });

  // Lịch sử phiên bản đã xuất bản của bài học
  route('GET', '/lessons/:id/versions', ({ db, user, params }) => {
    const { lesson, course } = lessonContext(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem lịch sử phiên bản.');
    const rows = db
      .prepare('SELECT * FROM lesson_versions WHERE lesson_id = ? ORDER BY version_number DESC')
      .all(lesson.id);
    return {
      items: rows.map((v) => {
        const blks = normalizeSnapshot(v.blocks_snapshot_json);
        const mkrs = safeJson(v.markers_snapshot_json, []);
        return {
          id: v.id,
          version_number: v.version_number,
          published_by: v.published_by,
          published_at: v.published_at,
          change_note: v.change_note || '',
          blocks_count: blks.length,
          markers_count: Array.isArray(mkrs) ? mkrs.length : 0,
        };
      }),
    };
  });

  // Khôi phục một phiên bản xuất bản cũ về bản nháp hiện tại
  route('POST', '/lessons/:id/versions/:versionNumber/restore', ({ db, user, params }) => {
    const { lesson, course } = lessonContext(db, params.id);
    if (!canEditCourseDraft(db, user, course)) {
      fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền khôi phục phiên bản bài học này.');
    }
    const verNum = Number(params.versionNumber);
    const ver = db
      .prepare('SELECT * FROM lesson_versions WHERE lesson_id = ? AND version_number = ?')
      .get(lesson.id, verNum);
    if (!ver) fail(404, 'VERSION_NOT_FOUND', 'Không tìm thấy phiên bản yêu cầu.');

    const snapBlocks = normalizeSnapshot(ver.blocks_snapshot_json);
    const snapMarkers = safeJson(ver.markers_snapshot_json, []);
    const nextRev = Number(lesson.working_draft_revision) + 1;
    const now = nowIso();

    tx(db, () => {
      db.prepare('DELETE FROM lesson_blocks WHERE lesson_id = ?').run(lesson.id);
      const insBlk = db.prepare(
        `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
      );
      const blockIdMap = {};
      snapBlocks.forEach((b, i) => {
        let bid = b.id;
        const clash = db.prepare('SELECT lesson_id FROM lesson_blocks WHERE id = ?').get(bid);
        if (clash) bid = `blk_${crypto.randomBytes(6).toString('hex')}`;
        blockIdMap[b.id] = bid;
        insBlk.run(bid, lesson.id, BLOCK_SCHEMA_VERSION, b.block_type, (i + 1) * 1000, JSON.stringify(b.content || {}));
      });

      db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL').run(lesson.id);
      if (Array.isArray(snapMarkers)) {
        const insM = db.prepare(
          `INSERT INTO video_quiz_markers (
             id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
             question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
             show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const m of snapMarkers) {
          let mid = m.id || `vqm_${crypto.randomBytes(5).toString('hex')}`;
          if (db.prepare('SELECT 1 FROM video_quiz_markers WHERE id = ?').get(mid)) {
            mid = `vqm_${crypto.randomBytes(5).toString('hex')}`;
          }
          const qSnap = m.question ? JSON.stringify(m.question) : m.question_snapshot_json || '{}';
          insM.run(
            mid,
            lesson.id,
            blockIdMap[m.block_id] || m.block_id,
            Number(m.timestamp_sec || 0),
            Number(m.sort_order || 0),
            m.behavior || 'PAUSE_AND_ASK',
            m.title || '',
            m.info_body || '',
            m.question_id || null,
            qSnap,
            m.is_required ? 1 : 0,
            m.allow_skip ? 1 : 0,
            Number(m.max_attempts ?? 2),
            m.show_answer_after_submit !== false ? 1 : 0,
            m.show_explanation !== false ? 1 : 0,
            m.allow_review !== false ? 1 : 0,
            user.id,
            now,
            now
          );
        }
      }

      db.prepare('UPDATE lessons SET working_draft_revision = ?, updated_at = ? WHERE id = ?').run(nextRev, now, lesson.id);
    });

    return {
      revision: nextRev,
      blocks: draftBlocks(db, lesson.id),
      video_markers: draftLessonMarkers(db, lesson.id, null),
    };
  });

  // ==================== 2. VIDEO QUIZ MARKERS (MODE A) ====================

  route('GET', '/lessons/:id/video-markers', ({ db, user, params }) => {
    const { lesson, course } = lessonContext(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem mốc câu hỏi video.');
    return { items: draftLessonMarkers(db, lesson.id, null) };
  });

  route('PUT', '/lessons/:id/video-markers', ({ db, user, body, params }) => {
    const { lesson, course } = lessonContext(db, params.id);
    if (!canEditCourseDraft(db, user, course)) {
      fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa mốc câu hỏi trên video.');
    }
    if (lesson.publish_status === 'ARCHIVED') {
      fail(409, 'LESSON_ARCHIVED', 'Bài học đã lưu trữ. Hãy khôi phục trước khi chỉnh sửa.');
    }
    const blockIdFilter = typeof body.block_id === 'string' && body.block_id.trim() ? body.block_id.trim() : null;
    const saved = validateAndPersistMarkers(db, {
      lessonId: lesson.id,
      classId: null,
      courseId: course.id,
      markersInput: body.markers || [],
      blockIdFilter,
      userId: user.id,
    });
    return { items: saved };
  });

  // ==================== 3. QUESTION BANK (NGÂN HÀNG CÂU HỎI KHÓA HỌC) ====================

  route('GET', '/courses/:courseId/question-bank', ({ db, user, params, url }) => {
    const course = getCourse(db, params.courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền truy cập ngân hàng câu hỏi.');

    const where = ['(course_id = ? OR (course_id IS NULL AND subject = ?))', 'deleted_at IS NULL'];
    const sqlParams = [course.id, course.subject || ''];
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push('prompt LIKE ?');
      sqlParams.push(`%${q}%`);
    }
    const qType = url.searchParams.get('question_type');
    if (qType && QUESTION_TYPES.includes(qType)) {
      where.push('question_type = ?');
      sqlParams.push(qType);
    }
    const rows = db
      .prepare(`SELECT * FROM question_bank_items WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 200`)
      .all(...sqlParams);

    return {
      items: rows.map(questionBankDto),
      can_edit: canEditCourseDraft(db, user, course),
    };
  });

  route('POST', '/courses/:courseId/question-bank', ({ db, user, body, params }) => {
    const course = getCourse(db, params.courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    if (!canEditCourseDraft(db, user, course)) {
      fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền thêm câu hỏi vào ngân hàng.');
    }
    let spec;
    try {
      spec = normalizeQuestionSpec(body, 'Ngân hàng câu hỏi');
    } catch (err) {
      if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
      throw err;
    }
    const id = `qb_${crypto.randomBytes(5).toString('hex')}`;
    const difficulty = oneOf(body, 'difficulty', ['EASY', 'MEDIUM', 'HARD'], { fallback: 'MEDIUM', label: 'độ khó' });
    const tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10)
      : [];
    const now = nowIso();
    db.prepare(
      `INSERT INTO question_bank_items (
         id, course_id, subject, question_type, prompt, options_json, answer_key_json,
         points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      course.id,
      course.subject || '',
      spec.question_type,
      spec.prompt,
      JSON.stringify(spec.options || []),
      JSON.stringify(spec.answer_key || {}),
      spec.points,
      spec.explanation || '',
      spec.correct_feedback || '',
      spec.wrong_feedback || '',
      difficulty,
      JSON.stringify(tags),
      user.id,
      now,
      now
    );
    return [201, questionBankDto(db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(id))];
  });

  route('PATCH', '/question-bank/:id', ({ db, user, body, params }) => {
    const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi trong ngân hàng.');
    const course = row.course_id ? getCourse(db, row.course_id) : null;
    if (!course || !canEditCourseDraft(db, user, course)) {
      fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền sửa câu hỏi này.');
    }
    let spec;
    try {
      spec = normalizeQuestionSpec(
        {
          question_type: body.question_type ?? row.question_type,
          prompt: body.prompt ?? row.prompt,
          options: body.options ?? safeJson(row.options_json, []),
          answer_key: body.answer_key ?? safeJson(row.answer_key_json, {}),
          points: body.points ?? row.points,
          explanation: body.explanation ?? row.explanation,
          correct_feedback: body.correct_feedback ?? row.correct_feedback,
          wrong_feedback: body.wrong_feedback ?? row.wrong_feedback,
        },
        'Ngân hàng câu hỏi'
      );
    } catch (err) {
      if (err instanceof QuizValidationError) fail(422, 'INVALID_QUIZ_SPEC', err.message);
      throw err;
    }
    const difficulty = body.difficulty
      ? oneOf(body, 'difficulty', ['EASY', 'MEDIUM', 'HARD'], { label: 'độ khó' })
      : row.difficulty;
    const tagsJson =
      'tags' in body
        ? JSON.stringify(
            Array.isArray(body.tags)
              ? body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10)
              : []
          )
        : row.tags_json || '[]';
    const now = nowIso();
    db.prepare(
      `UPDATE question_bank_items
       SET question_type = ?, prompt = ?, options_json = ?, answer_key_json = ?,
           points = ?, explanation = ?, correct_feedback = ?, wrong_feedback = ?, difficulty = ?, tags_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      spec.question_type,
      spec.prompt,
      JSON.stringify(spec.options || []),
      JSON.stringify(spec.answer_key || {}),
      spec.points,
      spec.explanation || '',
      spec.correct_feedback || '',
      spec.wrong_feedback || '',
      difficulty,
      tagsJson,
      now,
      row.id
    );
    return questionBankDto(db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(row.id));
  });

  route('DELETE', '/question-bank/:id', ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!row) fail(404, 'QUESTION_NOT_FOUND', 'Không tìm thấy câu hỏi trong ngân hàng.');
    const course = row.course_id ? getCourse(db, row.course_id) : null;
    if (!course || !canEditCourseDraft(db, user, course)) {
      fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền xóa câu hỏi này.');
    }
    db.prepare('UPDATE question_bank_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
    return { deleted_id: row.id };
  });

  // ==================== 4. MODE B — CLASS TEACHING CONTENT STUDIO ====================

  const requireClassStudio = (db, user, classId) => {
    const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
    const role = classRole(db, user, cls);
    if (!role || role === 'STUDENT') fail(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền truy cập trình soạn nội dung lớp học này.');
    if (!cls.course_id) fail(422, 'CLASS_NO_COURSE', 'Lớp học chưa được liên kết với khóa học gốc.');
    const course = getCourse(db, cls.course_id);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học liên kết.');
    return { cls, course };
  };

  route('GET', '/studio/classes/:classId', ({ db, user, params }) => {
    const { cls, course } = requireClassStudio(db, user, params.classId);
    const rawOutline = outline(db, course.id, { publishedOnly: true });
    const customsByLesson = Object.fromEntries(
      db
        .prepare('SELECT * FROM class_lesson_customs WHERE subject_class_id = ?')
        .all(cls.id)
        .map((r) => [r.lesson_id, r])
    );

    const enrichedOutline = rawOutline.map((ch) => ({
      ...ch,
      lessons: ch.lessons.map((l) => {
        const custom = customsByLesson[l.id];
        const customBlocksCnt = db
          .prepare('SELECT COUNT(*) AS n FROM class_lesson_blocks WHERE subject_class_id = ? AND lesson_id = ?')
          .get(cls.id, l.id).n;
        const customMarkersCnt = db
          .prepare('SELECT COUNT(*) AS n FROM video_quiz_markers WHERE lesson_id = ? AND class_id = ?')
          .get(l.id, cls.id).n;
        return {
          ...l,
          class_publish_status: custom?.publish_status || (customBlocksCnt > 0 || customMarkersCnt > 0 ? 'DRAFT' : 'INHERITED_ONLY'),
          custom_blocks_count: customBlocksCnt,
          custom_markers_count: customMarkersCnt,
          has_class_note: Boolean(custom?.instructor_note),
        };
      }),
    }));

    const resources = db
      .prepare(
        `SELECT r.*, u.full_name AS created_by_name
         FROM learning_resources r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.course_id = ? AND (r.class_id IS NULL OR r.class_id = ?) AND r.deleted_at IS NULL
         ORDER BY r.created_at DESC`
      )
      .all(course.id, cls.id)
      .map((r) => resourceDto(r, jwtSecret, user.id));

    return {
      mode: 'CLASS',
      class: {
        id: cls.id,
        code: cls.code,
        title: cls.title,
        status: cls.status,
      },
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        status: course.status,
      },
      outline: enrichedOutline,
      resources,
      capabilities: {
        can_edit_class_content: canEditClassContent(db, user, cls),
        can_publish_class_content: canPublishClassContent(db, user, cls),
        can_open_canonical_course: canEditCourseDraft(db, user, course),
      },
    };
  });

  route('GET', '/studio/classes/:classId/lessons/:lessonId', ({ db, user, params }) => {
    const { cls, course } = requireClassStudio(db, user, params.classId);
    const { lesson, chapter } = lessonContext(db, params.lessonId);
    if (course.id !== getCourse(db, chapter.course_id)?.id) {
      fail(403, 'LESSON_OUT_OF_SCOPE', 'Bài học không thuộc khóa học của lớp này.');
    }

    const inheritedBlocks = latestPublishedBlocks(db, lesson.id).map((b) => ({
      ...b,
      origin: 'INHERITED',
    }));
    const inheritedMarkers = latestPublishedMarkers(db, lesson.id).map((m) => ({
      ...m,
      origin: 'INHERITED',
    }));

    const customMeta = db
      .prepare('SELECT * FROM class_lesson_customs WHERE subject_class_id = ? AND lesson_id = ?')
      .get(cls.id, lesson.id);

    const customBlocks = db
      .prepare('SELECT * FROM class_lesson_blocks WHERE subject_class_id = ? AND lesson_id = ? ORDER BY sort_order')
      .all(cls.id, lesson.id)
      .map((b) => ({
        id: b.id,
        block_type: b.block_type,
        sort_order: b.sort_order,
        anchor_block_id: b.anchor_block_id || null,
        is_published: Boolean(b.is_published),
        origin: 'CLASS_CUSTOM',
        content: safeJson(b.content_json, {}),
      }));

    const customMarkers = draftLessonMarkers(db, lesson.id, cls.id);

    return {
      mode: 'CLASS',
      class: { id: cls.id, code: cls.code, title: cls.title },
      course: { id: course.id, code: course.code, title: course.title },
      chapter: { id: chapter.id, title: chapter.title },
      lesson: {
        id: lesson.id,
        title: lesson.title,
        description: lesson.description || '',
        objectives: lesson.objectives || '',
        duration_minutes: lesson.duration_minutes,
        published_version: lesson.published_version,
      },
      inherited_blocks: inheritedBlocks,
      inherited_markers: inheritedMarkers,
      custom: {
        instructor_note: customMeta?.instructor_note || '',
        custom_objectives: customMeta?.custom_objectives || '',
        publish_status: customMeta?.publish_status || 'DRAFT',
        revision: customMeta?.working_revision ?? 1,
        published_at: customMeta?.published_at || null,
      },
      custom_blocks: customBlocks,
      custom_markers: customMarkers,
      capabilities: {
        can_edit: canEditClassContent(db, user, cls),
        can_publish: canPublishClassContent(db, user, cls),
        can_open_canonical_course: canEditCourseDraft(db, user, course),
      },
    };
  });

  // Lưu nội dung bổ sung riêng cho Lớp học — KHÔNG SỬA bảng lessons / lesson_blocks của khóa học gốc
  route('PUT', '/studio/classes/:classId/lessons/:lessonId/content', ({ db, user, body, params }) => {
    const { cls, course } = requireClassStudio(db, user, params.classId);
    if (!canEditClassContent(db, user, cls)) {
      fail(403, 'CLASS_CONTENT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa nội dung riêng của lớp này.');
    }
    const { lesson, chapter } = lessonContext(db, params.lessonId);
    if (chapter.course_id !== course.id) fail(403, 'LESSON_OUT_OF_SCOPE', 'Bài học không thuộc khóa học của lớp.');

    const existingMeta = db
      .prepare('SELECT * FROM class_lesson_customs WHERE subject_class_id = ? AND lesson_id = ?')
      .get(cls.id, lesson.id);
    const currentRev = existingMeta ? Number(existingMeta.working_revision) : 1;
    if (body.base_revision !== undefined && Number(body.base_revision) !== currentRev) {
      fail(409, 'REVISION_CONFLICT', 'Nội dung lớp học vừa được người khác cập nhật. Vui lòng tải lại.', {
        server_revision: currentRev,
      });
    }

    const v = validateBlocks(body.custom_blocks || [], { db, courseId: course.id, classId: cls.id });
    if (!v.ok) fail(422, v.code, v.message, { block_index: v.block_index });

    const note = text(body, 'instructor_note', { max: 5000, label: 'ghi chú giảng dạy riêng cho lớp' });
    const customObj = text(body, 'custom_objectives', { max: 2000, label: 'mục tiêu bổ sung của lớp' });
    const nextRev = currentRev + 1;
    const now = nowIso();
    const keepPublished = existingMeta?.publish_status === 'PUBLISHED' && body.auto_publish === true;

    tx(db, () => {
      db.prepare(
        `INSERT INTO class_lesson_customs (
           id, subject_class_id, lesson_id, instructor_note, custom_objectives, publish_status, working_revision, updated_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject_class_id, lesson_id) DO UPDATE SET
           instructor_note = excluded.instructor_note,
           custom_objectives = excluded.custom_objectives,
           publish_status = excluded.publish_status,
           working_revision = excluded.working_revision,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      ).run(
        crypto.randomUUID(),
        cls.id,
        lesson.id,
        note,
        customObj,
        keepPublished ? 'PUBLISHED' : 'DRAFT',
        nextRev,
        user.id,
        now
      );

      db.prepare('DELETE FROM class_lesson_blocks WHERE subject_class_id = ? AND lesson_id = ?').run(cls.id, lesson.id);
      const ins = db.prepare(
        `INSERT INTO class_lesson_blocks (
           id, subject_class_id, lesson_id, anchor_block_id, block_type, schema_version, sort_order, is_published, content_json, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const b of v.blocks) {
        let bid = b.id;
        const clash = db.prepare('SELECT subject_class_id FROM class_lesson_blocks WHERE id = ?').get(bid);
        if (clash) bid = `cblk_${crypto.randomBytes(6).toString('hex')}`;
        ins.run(
          bid,
          cls.id,
          lesson.id,
          b.anchor_block_id || null,
          b.block_type,
          BLOCK_SCHEMA_VERSION,
          b.sort_order,
          keepPublished ? 1 : 0,
          JSON.stringify(b.content),
          user.id,
          now,
          now
        );
        b.id = bid;
      }
    });

    return {
      revision: nextRev,
      custom_blocks: v.blocks.map((b) => ({ ...b, origin: 'CLASS_CUSTOM' })),
    };
  });

  route('PUT', '/studio/classes/:classId/lessons/:lessonId/video-markers', ({ db, user, body, params }) => {
    const { cls, course } = requireClassStudio(db, user, params.classId);
    if (!canEditClassContent(db, user, cls)) {
      fail(403, 'CLASS_CONTENT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa mốc câu hỏi của lớp này.');
    }
    const { lesson, chapter } = lessonContext(db, params.lessonId);
    if (chapter.course_id !== course.id) fail(403, 'LESSON_OUT_OF_SCOPE', 'Bài học không thuộc khóa học của lớp.');

    const blockIdFilter = typeof body.block_id === 'string' && body.block_id.trim() ? body.block_id.trim() : null;
    const saved = validateAndPersistMarkers(db, {
      lessonId: lesson.id,
      classId: cls.id,
      courseId: course.id,
      markersInput: body.markers || [],
      blockIdFilter,
      userId: user.id,
    });
    db.prepare(
      `UPDATE class_lesson_customs SET publish_status = 'DRAFT', updated_by = ?, updated_at = ?
       WHERE subject_class_id = ? AND lesson_id = ?`
    ).run(user.id, nowIso(), cls.id, lesson.id);
    return { items: saved };
  });

  route('POST', '/studio/classes/:classId/lessons/:lessonId/publish', ({ db, user, params }) => {
    const { cls, course } = requireClassStudio(db, user, params.classId);
    if (!canPublishClassContent(db, user, cls)) {
      fail(403, 'CLASS_PUBLISH_FORBIDDEN', 'Chỉ giảng viên phụ trách lớp mới được xuất bản nội dung bổ sung của lớp.');
    }
    const { lesson, chapter } = lessonContext(db, params.lessonId);
    if (chapter.course_id !== course.id) fail(403, 'LESSON_OUT_OF_SCOPE', 'Bài học không thuộc khóa học của lớp.');

    const now = nowIso();
    tx(db, () => {
      db.prepare('UPDATE class_lesson_blocks SET is_published = 1, updated_at = ? WHERE subject_class_id = ? AND lesson_id = ?')
        .run(now, cls.id, lesson.id);

      const curMeta = db
        .prepare('SELECT instructor_note, custom_objectives FROM class_lesson_customs WHERE subject_class_id = ? AND lesson_id = ?')
        .get(cls.id, lesson.id);
      const snapBlocks = db
        .prepare('SELECT * FROM class_lesson_blocks WHERE subject_class_id = ? AND lesson_id = ? ORDER BY sort_order')
        .all(cls.id, lesson.id)
        .map((b) => ({
          id: b.id,
          block_type: b.block_type,
          sort_order: b.sort_order,
          anchor_block_id: b.anchor_block_id || null,
          origin: 'CLASS_CUSTOM',
          content: safeJson(b.content_json, {}),
        }))
        .filter((b) => !b.content?.display?.hidden);
      const snapMarkers = draftLessonMarkers(db, lesson.id, cls.id);
      const snapshotJson = JSON.stringify({
        instructor_note: curMeta?.instructor_note || '',
        custom_objectives: curMeta?.custom_objectives || '',
        blocks: snapBlocks,
        markers: snapMarkers,
      });

      db.prepare(
        `INSERT INTO class_lesson_customs (
           id, subject_class_id, lesson_id, instructor_note, custom_objectives, publish_status, working_revision, published_snapshot_json, published_at, updated_by, updated_at
         ) VALUES (?, ?, ?, '', '', 'PUBLISHED', 1, ?, ?, ?, ?)
         ON CONFLICT(subject_class_id, lesson_id) DO UPDATE SET
           publish_status = 'PUBLISHED',
           published_snapshot_json = excluded.published_snapshot_json,
           published_at = excluded.published_at,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      ).run(crypto.randomUUID(), cls.id, lesson.id, snapshotJson, now, user.id, now);
    });

    return { publish_status: 'PUBLISHED', published_at: now };
  });

  // ==================== 5. VIDEO UPLOAD (CHUNKED), CANCEL, PDF & RANGE STREAMING ====================

  route('POST', '/media/videos/init', ({ db, user, body }) => {
    const courseId = text(body, 'course_id', { required: true, max: 64, label: 'mã khóa học' });
    const classId = body.class_id ? text(body, 'class_id', { max: 64, label: 'mã lớp học' }) : null;
    const course = getCourse(db, courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');

    if (classId) {
      const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ? AND course_id = ?').get(classId, course.id);
      if (!cls || !canEditClassContent(db, user, cls)) {
        fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không có quyền tải video lên cho lớp học này.');
      }
    } else if (!canEditCourseDraft(db, user, course)) {
      fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không có quyền tải video lên cho khóa học này.');
    }

    const title = text(body, 'title', { required: true, max: 200, label: 'tiêu đề video' });
    const fileName = text(body, 'file_name', { required: true, max: 220, label: 'tên tệp video' });
    const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!VIDEO_EXT_MIME[ext]) {
      fail(
        422,
        'VIDEO_FORMAT_NOT_ALLOWED',
        `Định dạng video .${ext || '?'} không được hỗ trợ. Vui lòng chọn tệp .mp4, .webm, .m4v hoặc .mov.`
      );
    }
    const totalSize = intField(body, 'total_size_bytes', {
      required: true,
      min: 1,
      max: MAX_VIDEO_BYTES,
      label: 'dung lượng video',
    });

    const uploadId = `vup_${crypto.randomBytes(8).toString('hex')}`;
    const tmpDir = path.join(uploadsDir, '_tmp_videos');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tempPath = path.join(tmpDir, `${uploadId}.${ext}.part`);
    fs.writeFileSync(tempPath, Buffer.alloc(0));

    const now = nowIso();
    db.prepare(
      `INSERT INTO video_upload_sessions (
         id, course_id, class_id, title, file_name, mime_type, total_size_bytes,
         received_bytes, chunks_received, temp_path, status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'UPLOADING', ?, ?, ?)`
    ).run(uploadId, course.id, classId, title, safeFilename(fileName), VIDEO_EXT_MIME[ext], totalSize, tempPath, user.id, now, now);

    return [
      201,
      {
        upload_id: uploadId,
        chunk_max_bytes: 2 * 1024 * 1024,
        total_size_bytes: totalSize,
        status: 'UPLOADING',
      },
    ];
  });

  route('PUT', '/media/videos/:uploadId/chunk', ({ db, user, body, params }) => {
    const sess = db.prepare('SELECT * FROM video_upload_sessions WHERE id = ?').get(params.uploadId);
    if (!sess) fail(404, 'UPLOAD_NOT_FOUND', 'Không tìm thấy phiên tải lên video.');
    if (sess.created_by !== user.id) fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không phải người khởi tạo phiên tải lên này.');
    if (sess.status !== 'UPLOADING') fail(409, 'UPLOAD_NOT_ACTIVE', `Phiên tải lên đang ở trạng thái ${sess.status}.`);

    if (body.chunk_index !== undefined && body.chunk_index !== null) {
      const chunkIdx = Number(body.chunk_index);
      if (!Number.isInteger(chunkIdx) || chunkIdx < 0) {
        fail(422, 'VALIDATION_ERROR', 'Chỉ số mảnh tải lên (chunk_index) không hợp lệ.');
      }
      if (chunkIdx < Number(sess.chunks_received)) {
        return {
          upload_id: sess.id,
          received_bytes: sess.received_bytes,
          total_size_bytes: sess.total_size_bytes,
          progress_pct: Math.min(100, Math.round((sess.received_bytes / sess.total_size_bytes) * 100)),
          status: 'UPLOADING',
          deduplicated: true,
        };
      }
      if (chunkIdx > Number(sess.chunks_received)) {
        fail(409, 'CHUNK_OUT_OF_ORDER', `Mảnh tải lên không đúng thứ tự (kỳ vọng #${sess.chunks_received}, nhận #${chunkIdx}).`);
      }
    }

    if (typeof body.data_base64 !== 'string' || !body.data_base64) {
      fail(422, 'VALIDATION_ERROR', 'Thiếu dữ liệu mảnh tải lên (data_base64).');
    }
    const buf = Buffer.from(body.data_base64, 'base64');
    if (buf.length === 0 || buf.length > MAX_VIDEO_CHUNK_BYTES) {
      fail(422, 'VALIDATION_ERROR', 'Kích thước mảnh tải lên không hợp lệ.');
    }
    if (sess.received_bytes + buf.length > sess.total_size_bytes) {
      fail(422, 'UPLOAD_SIZE_EXCEEDED', 'Tổng dữ liệu gửi lên vượt quá dung lượng tệp đã khai báo.');
    }

    fs.appendFileSync(sess.temp_path, buf);
    const nextReceived = sess.received_bytes + buf.length;
    const nextChunks = sess.chunks_received + 1;
    db.prepare(
      'UPDATE video_upload_sessions SET received_bytes = ?, chunks_received = ?, updated_at = ? WHERE id = ?'
    ).run(nextReceived, nextChunks, nowIso(), sess.id);

    return {
      upload_id: sess.id,
      received_bytes: nextReceived,
      total_size_bytes: sess.total_size_bytes,
      progress_pct: Math.min(100, Math.round((nextReceived / sess.total_size_bytes) * 100)),
      status: 'UPLOADING',
    };
  });

  route('POST', '/media/videos/:uploadId/complete', ({ db, user, body, params, log }) => {
    const sess = db.prepare('SELECT * FROM video_upload_sessions WHERE id = ?').get(params.uploadId);
    if (!sess) fail(404, 'UPLOAD_NOT_FOUND', 'Không tìm thấy phiên tải lên video.');
    if (sess.created_by !== user.id) fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không phải người khởi tạo phiên tải lên này.');
    if (sess.status !== 'UPLOADING') fail(409, 'UPLOAD_NOT_ACTIVE', `Phiên tải lên đang ở trạng thái ${sess.status}.`);
    if (!fs.existsSync(sess.temp_path)) fail(410, 'TEMP_FILE_MISSING', 'Tệp tạm không còn tồn tại. Vui lòng tải lại.');

    const stat = fs.statSync(sess.temp_path);
    if (stat.size !== sess.total_size_bytes) {
      fail(
        422,
        'INCOMPLETE_UPLOAD',
        `Tệp tải lên chưa hoàn tất (đã nhận ${stat.size}/${sess.total_size_bytes} byte).`
      );
    }

    // Tính mã băm SHA-256 theo luồng nhỏ 1 MB để không tốn RAM với video lớn
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(sess.temp_path, 'r');
    try {
      const chunkBuf = Buffer.allocUnsafe(1024 * 1024);
      let pos = 0;
      while (pos < stat.size) {
        const bytesRead = fs.readSync(fd, chunkBuf, 0, chunkBuf.length, pos);
        if (bytesRead <= 0) break;
        hash.update(chunkBuf.subarray(0, bytesRead));
        pos += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }
    const checksum = hash.digest('hex');

    const ext = path.extname(sess.file_name).slice(1).toLowerCase() || 'mp4';
    const replaceId = typeof body.replace_resource_id === 'string' && body.replace_resource_id.trim()
      ? body.replace_resource_id.trim()
      : null;
    const existingRes = replaceId
      ? db
          .prepare('SELECT * FROM learning_resources WHERE id = ? AND course_id = ? AND deleted_at IS NULL')
          .get(replaceId, sess.course_id)
      : null;

    const resId = existingRes ? existingRes.id : `res_${crypto.randomBytes(6).toString('hex')}`;
    const relKey = path.join('videos', sess.course_id, `${resId}_${Date.now().toString(36)}.${ext}`).replace(/\\/g, '/');
    const finalPath = path.join(uploadsDir, relKey);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(sess.temp_path, finalPath);

    if (existingRes && existingRes.storage_provider === 'LOCAL_DISK' && existingRes.storage_key) {
      const oldFull = path.resolve(uploadsDir, existingRes.storage_key);
      if (oldFull.startsWith(path.resolve(uploadsDir)) && fs.existsSync(oldFull)) {
        try {
          fs.unlinkSync(oldFull);
        } catch {
          // Bỏ qua nếu hệ điều hành chưa nhả tệp cũ ngay lập tức
        }
      }
    }

    const durationSec = Number(body.duration_seconds);
    const cleanDuration = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 100) / 100 : null;
    const rawThumbInput =
      typeof body.thumbnail_data_url === 'string' && body.thumbnail_data_url
        ? body.thumbnail_data_url
        : typeof body.thumbnail_url === 'string'
          ? body.thumbnail_url
          : '';
    const thumbDataUrl = rawThumbInput.startsWith('data:image/') ? rawThumbInput.slice(0, 120_000) : null;
    const now = nowIso();

    tx(db, () => {
      if (existingRes) {
        db.prepare(
          `UPDATE learning_resources
           SET title = ?, storage_key = ?, file_name = ?, mime_type = ?, file_size_bytes = ?, checksum_sha256 = ?,
               duration_seconds = ?, thumbnail_url = COALESCE(?, thumbnail_url), processing_status = 'READY', updated_at = ?
           WHERE id = ?`
        ).run(sess.title, relKey, sess.file_name, sess.mime_type, stat.size, checksum, cleanDuration, thumbDataUrl, now, resId);
      } else {
        db.prepare(
          `INSERT INTO learning_resources (
             id, course_id, class_id, title, description, visibility, resource_type, storage_provider,
             storage_key, file_name, mime_type, file_size_bytes, checksum_sha256, duration_seconds,
             thumbnail_url, status, processing_status, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'ENROLLED', 'VIDEO', 'LOCAL_DISK', ?, ?, ?, ?, ?, ?, ?, 'READY', 'READY', ?, ?, ?)`
        ).run(
          resId,
          sess.course_id,
          sess.class_id,
          sess.title,
          text(body, 'description', { max: 1000, label: 'mô tả video' }),
          relKey,
          sess.file_name,
          sess.mime_type,
          stat.size,
          checksum,
          cleanDuration,
          thumbDataUrl,
          user.id,
          now,
          now
        );
      }
      db.prepare("UPDATE video_upload_sessions SET status = 'COMPLETED', updated_at = ? WHERE id = ?").run(now, sess.id);
    });

    log('INFO', `[studio] video uploaded ${resId} (${stat.size} bytes) by ${user.id}`);
    const row = db.prepare('SELECT * FROM learning_resources WHERE id = ?').get(resId);
    return [201, resourceDto(row, jwtSecret, user.id)];
  });

  // Hủy upload video giữa chừng & dọn sạch tệp tạm
  route('DELETE', '/media/videos/:uploadId', ({ db, user, params }) => {
    const sess = db.prepare('SELECT * FROM video_upload_sessions WHERE id = ?').get(params.uploadId);
    if (!sess) fail(404, 'UPLOAD_NOT_FOUND', 'Không tìm thấy phiên tải lên video.');
    if (sess.created_by !== user.id) fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không có quyền hủy phiên tải lên này.');
    if (sess.temp_path && fs.existsSync(sess.temp_path)) {
      try {
        fs.unlinkSync(sess.temp_path);
      } catch {
        // ignore
      }
    }
    db.prepare("UPDATE video_upload_sessions SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(nowIso(), sess.id);
    return { cancelled_id: sess.id, status: 'CANCELLED' };
  });

  // Tải lên tài liệu PDF (hỗ trợ xem trực tiếp trong bài giảng)
  route('POST', '/media/pdfs', ({ db, user, body }) => {
    const courseId = text(body, 'course_id', { required: true, max: 64, label: 'mã khóa học' });
    const classId = body.class_id ? text(body, 'class_id', { max: 64, label: 'mã lớp học' }) : null;
    const course = getCourse(db, courseId);
    if (!course) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    if (classId) {
      const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ? AND course_id = ?').get(classId, course.id);
      if (!cls || !canEditClassContent(db, user, cls)) fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không có quyền tải tài liệu lên lớp này.');
    } else if (!canEditCourseDraft(db, user, course)) {
      fail(403, 'UPLOAD_FORBIDDEN', 'Bạn không có quyền tải tài liệu lên khóa học này.');
    }

    const title = text(body, 'title', { required: true, max: 200, label: 'tên tài liệu PDF' });
    const fileName = text(body, 'file_name', { required: true, max: 200, label: 'tên tệp' });
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      fail(422, 'FILE_TYPE_NOT_ALLOWED', 'Vui lòng chọn tệp định dạng .pdf.');
    }
    if (typeof body.data_base64 !== 'string' || !body.data_base64) {
      fail(422, 'VALIDATION_ERROR', 'Thiếu dữ liệu tệp PDF.');
    }
    const buf = Buffer.from(body.data_base64, 'base64');
    if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      fail(422, 'INVALID_PDF', 'Tệp tải lên không đúng định dạng PDF hợp lệ.');
    }
    if (buf.length > MAX_PDF_BYTES) fail(413, 'FILE_TOO_LARGE', 'Tệp PDF vượt quá giới hạn 12 MB.');

    const resId = `res_${crypto.randomBytes(6).toString('hex')}`;
    const relKey = path.join('pdfs', course.id, `${resId}.pdf`).replace(/\\/g, '/');
    const full = path.join(uploadsDir, relKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);

    const now = nowIso();
    const checksum = crypto.createHash('sha256').update(buf).digest('hex');
    db.prepare(
      `INSERT INTO learning_resources (
         id, course_id, class_id, title, description, visibility, resource_type, storage_provider,
         storage_key, file_name, mime_type, file_size_bytes, checksum_sha256, status, processing_status,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'ENROLLED', 'PDF', 'LOCAL_DISK', ?, ?, 'application/pdf', ?, ?, 'READY', 'READY', ?, ?, ?)`
    ).run(
      resId,
      course.id,
      classId,
      title,
      text(body, 'description', { max: 1000, label: 'mô tả' }),
      relKey,
      safeFilename(fileName),
      buf.length,
      checksum,
      user.id,
      now,
      now
    );

    const row = db.prepare('SELECT * FROM learning_resources WHERE id = ?').get(resId);
    return [201, resourceDto(row, jwtSecret, user.id)];
  });

  // Kiểm tra link video (YouTube hoặc nguồn HTTPS trực tiếp được hệ thống phê duyệt)
  route('POST', '/media/video-link/validate', async ({ body }) => {
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    if (!raw) fail(422, 'EMPTY_URL', 'Vui lòng nhập đường dẫn video.');

    const yt = parseYouTubeUrl(raw);
    if (yt.ok) {
      let embeddable = null;
      let title = '';
      let authorName = '';
      let checkMessage = '';
      if (process.env.LMSPLUS_DISABLE_OEMBED !== '1') {
        try {
          const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(yt.watchUrl)}`, {
            signal: AbortSignal.timeout(4000),
          });
          if (r.ok) {
            const j = await r.json();
            embeddable = true;
            title = String(j.title || '').slice(0, 200);
            authorName = String(j.author_name || '').slice(0, 200);
            // Kiểm tra sâu trạng thái playableInEmbed trên trang /embed (phát hiện các MV VEVO/YG khóa nhúng ngoài dù oEmbed trả 200)
            try {
              const embRes = await fetch(`https://www.youtube.com/embed/${encodeURIComponent(yt.videoId)}`, {
                headers: { Referer: 'https://lmsplus.edu.vn/' },
                signal: AbortSignal.timeout(3500),
              });
              if (embRes.ok) {
                const html = await embRes.text();
                if (html.includes('"playableInEmbed":false') || html.includes('"status":"UNPLAYABLE"')) {
                  embeddable = false;
                  checkMessage =
                    'Chủ sở hữu bản quyền video đã tắt quyền phát nhúng ngoài YouTube. Học viên sẽ phải mở trên YouTube hoặc bạn nên chọn nguồn video khác.';
                }
              }
            } catch {
              // bỏ qua nếu không kiểm tra bổ sung được
            }
          } else if (r.status === 401 || r.status === 403) {
            embeddable = false;
            checkMessage = 'Chủ sở hữu video đã tắt chức năng nhúng hoặc video ở chế độ riêng tư.';
          } else if (r.status === 404 || r.status === 400) {
            embeddable = false;
            checkMessage = 'Video không tồn tại hoặc đã bị gỡ.';
          }
        } catch {
          checkMessage = 'Không kết nối được YouTube để xác minh trực tuyến; trình phát vẫn hoạt động bình thường.';
        }
      }
      return {
        source_type: 'YOUTUBE',
        video_id: yt.videoId,
        start_seconds: yt.startSeconds,
        embed_url: yt.embedUrl,
        watch_url: yt.watchUrl,
        thumbnail_url: yt.thumbnailUrl,
        embeddable,
        title,
        author_name: authorName,
        check_message: checkMessage,
      };
    }

    const direct = validateDirectVideoUrl(raw);
    if (direct.ok) {
      return {
        source_type: 'DIRECT_URL',
        direct_url: direct.url,
        host: direct.host,
        embeddable: true,
        title: path.basename(new URL(direct.url).pathname),
        check_message: '',
      };
    }

    fail(
      422,
      yt.error || 'VIDEO_SOURCE_NOT_ALLOWED',
      'Đường dẫn không phải YouTube hợp lệ và không thuộc nguồn video HTTPS được hệ thống phê duyệt.'
    );
  });

  // Streaming Video / PDF qua HTTP Range (206 Partial Content) — đóng fd ngay sau khi đọc mảnh
  route('GET', '/media/:resourceId/stream', ({ req, db, user, params, raw }) => {
    const r = db.prepare('SELECT * FROM learning_resources WHERE id = ?').get(params.resourceId);
    if (!r || r.deleted_at) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tệp phương tiện.');
    if (!canStreamResource(db, user, r)) {
      fail(403, 'RESOURCE_ACCESS_DENIED', 'Bạn không có quyền truy cập học liệu này.');
    }
    if (r.storage_provider !== 'LOCAL_DISK') {
      fail(422, 'NOT_LOCAL_MEDIA', 'Học liệu này là liên kết ngoài, không phát trực tiếp từ máy chủ.');
    }
    const full = path.resolve(uploadsDir, r.storage_key);
    if (!full.startsWith(path.resolve(uploadsDir)) || !fs.existsSync(full)) {
      fail(404, 'FILE_MISSING', 'Không tìm thấy tệp trên máy chủ.');
    }

    const stat = fs.statSync(full);
    const total = stat.size;
    const contentType = r.mime_type || 'application/octet-stream';
    if (req && req.method === 'HEAD') {
      raw(
        200,
        {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
          'X-Content-Type-Options': 'nosniff',
        },
        ''
      );
      return;
    }
    const rangeHeader = req && req.headers ? req.headers['range'] : undefined;

    if (rangeHeader && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
      const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (!m) {
        raw(416, { 'Content-Range': `bytes */${total}` }, '');
        return;
      }
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : Math.min(start + RANGE_CHUNK_BYTES - 1, total - 1);
      if (!m[1] && m[2]) {
        const suffixLen = parseInt(m[2], 10);
        start = Math.max(0, total - suffixLen);
        end = total - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start >= total || start > end) {
        raw(416, { 'Content-Range': `bytes */${total}` }, '');
        return;
      }
      end = Math.min(end, total - 1);
      const chunkLen = end - start + 1;
      const rangeHeaders = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(chunkLen),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      };
      if (chunkLen > 16 * 1024 * 1024 && res && typeof res.write === 'function') {
        res.writeHead(206, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
          ...rangeHeaders,
        });
        return new Promise((resolve, reject) => {
          const stream = fs.createReadStream(full, { start, end });
          stream.on('error', reject);
          res.on('close', () => {
            stream.destroy();
            resolve();
          });
          stream.on('end', resolve);
          stream.pipe(res);
        });
      }
      const buf = Buffer.allocUnsafe(chunkLen);
      const fd = fs.openSync(full, 'r');
      try {
        fs.readSync(fd, buf, 0, chunkLen, start);
      } finally {
        fs.closeSync(fd);
      }
      raw(206, rangeHeaders, buf);
      return;
    }

    // Yêu cầu không có Range header (ví dụ PDF, tải tệp đầy đủ hoặc kiểm thử trực tiếp)
    const fullHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(total),
      'Content-Disposition': `inline; filename="media"; filename*=UTF-8''${encodeURIComponent(r.file_name || 'media')}`,
      'X-Content-Type-Options': 'nosniff',
    };
    if (total > 16 * 1024 * 1024 && res && typeof res.write === 'function') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
        ...fullHeaders,
      });
      return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(full);
        stream.on('error', reject);
        res.on('close', () => {
          stream.destroy();
          resolve();
        });
        stream.on('end', resolve);
        stream.pipe(res);
      });
    }
    const buf = Buffer.allocUnsafe(total);
    const fd = fs.openSync(full, 'r');
    try {
      fs.readSync(fd, buf, 0, total, 0);
    } finally {
      fs.closeSync(fd);
    }
    raw(200, fullHeaders, buf);
  });

  // ==================== 6. BÁO CÁO KẾT QUẢ VIDEO & QUIZ THEO LỚP ====================

  route('GET', '/classes/:classId/lessons/:lessonId/quiz-analytics', ({ db, user, params }) => {
    const cls = db.prepare('SELECT * FROM subject_classes WHERE id = ?').get(params.classId);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
    const caps = classCapabilities(db, user, cls);
    if (!caps.can_view_roster) fail(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền xem thống kê kết quả của lớp này.');
    const lessonRow = db
      .prepare(
        `SELECT l.id, ch.course_id
         FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
         WHERE l.id = ?`
      )
      .get(params.lessonId);
    if (!lessonRow || lessonRow.course_id !== cls.course_id) {
      fail(404, 'LESSON_NOT_IN_CLASS', 'Bài học không thuộc khóa học của lớp này.');
    }

    const roster = db
      .prepare(
        `SELECT u.id, u.code, u.full_name
         FROM class_enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.subject_class_id = ? AND e.status = 'ACTIVE'
         ORDER BY u.code`
      )
      .all(cls.id);

    const publishedCustom = getPublishedClassCustom(db, cls.id, params.lessonId);
    const classPublishedMarkers = publishedCustom ? publishedCustom.markers : [];

    const pubMarkers = [
      ...latestPublishedMarkers(db, params.lessonId),
      ...classPublishedMarkers,
    ].filter((m) => m.behavior !== 'INFO_ONLY');

    const students = roster.map((st) => {
      const vp = db
        .prepare(
          `SELECT COALESCE(MAX(watch_pct), 0) AS max_pct, COALESCE(SUM(watched_seconds), 0) AS watched_sec
           FROM video_watch_progress
           WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?`
        )
        .get(st.id, cls.id, params.lessonId);
      const subs = db
        .prepare(
          `SELECT target_type, target_id, MAX(earned_points) AS best_pts, MAX(max_points) AS max_pts, MAX(is_correct) AS any_correct, COUNT(*) AS attempts
           FROM lesson_quiz_submissions
           WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?
           GROUP BY target_type, target_id`
        )
        .all(st.id, cls.id, params.lessonId);

      const markerSubs = subs.filter((s) => s.target_type === 'VIDEO_MARKER');
      const earned = subs.reduce((acc, s) => acc + Number(s.best_pts || 0), 0);
      const maxPts = subs.reduce((acc, s) => acc + Number(s.max_pts || 0), 0);
      const lp = db
        .prepare('SELECT status, completed_at FROM lesson_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?')
        .get(st.id, cls.id, params.lessonId);

      return {
        student_id: st.id,
        code: st.code,
        full_name: st.full_name,
        lesson_status: lp?.status || 'NOT_STARTED',
        video_watch_pct: Number(vp?.max_pct || 0),
        watched_seconds: Math.round(Number(vp?.watched_sec || 0)),
        markers_answered: markerSubs.length,
        markers_total: pubMarkers.length,
        earned_points: Math.round(earned * 100) / 100,
        max_points: Math.round(maxPts * 100) / 100,
      };
    });

    return {
      lesson_id: params.lessonId,
      markers_total: pubMarkers.length,
      students,
    };
  });
}

// ------------------------------------------------------------------ Learner Helpers (dùng trong learn.mjs)

export function buildStudentLessonPayload(db, { user, cls, lesson, chapterInfo, idx, list, jwtSecret }) {
  const baseBlocks = latestPublishedBlocks(db, lesson.id).map((b) => ({ ...b, origin: 'INHERITED' }));
  const publishedCustom = getPublishedClassCustom(db, cls.id, lesson.id);
  const customBlocks = publishedCustom ? publishedCustom.blocks : [];

  // Ghép các khối tùy chỉnh của lớp ngay sau anchor_block_id (hoặc cuối bài nếu không chỉ định)
  const byAnchor = new Map();
  const tailBlocks = [];
  for (const cb of customBlocks) {
    if (cb.anchor_block_id && baseBlocks.some((b) => b.id === cb.anchor_block_id)) {
      const arr = byAnchor.get(cb.anchor_block_id) || [];
      arr.push(cb);
      byAnchor.set(cb.anchor_block_id, arr);
    } else {
      tailBlocks.push(cb);
    }
  }
  const mergedBlocks = [];
  for (const bb of baseBlocks) {
    mergedBlocks.push(bb);
    const after = byAnchor.get(bb.id);
    if (after) mergedBlocks.push(...after);
  }
  mergedBlocks.push(...tailBlocks);

  // Tải lịch sử nộp bài của học viên cho bài học này
  const submissions = db
    .prepare(
      `SELECT * FROM lesson_quiz_submissions
       WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?
       ORDER BY attempt_number ASC`
    )
    .all(user.id, cls.id, lesson.id);

  const subsByTarget = new Map();
  for (const s of submissions) {
    const key = `${s.target_type}:${s.target_id}`;
    const arr = subsByTarget.get(key) || [];
    arr.push(s);
    subsByTarget.set(key, arr);
  }

  // Sanitize blocks cho học viên (ẩn toàn bộ đáp án chưa được phép xem!)
  const quizStates = {};
  const sanitizedBlocks = mergedBlocks.map((block) => {
    if (block.block_type === 'review_question' || block.block_type === 'inline_mcq') {
      return {
        ...block,
        content: {
          ...block.content,
          question: block.content.question,
          options: (block.content.options || []).map((o) => ({ id: o.id, text: o.text })),
        },
      };
    }
    if (block.block_type === 'quiz') {
      const c = block.content || {};
      const qSubs = subsByTarget.get(`QUIZ_BLOCK:${block.id}`) || [];
      const hasSubmitted = qSubs.length > 0;
      const latestSub = qSubs[qSubs.length - 1] || null;
      const maxAtt = Number(c.max_attempts ?? 3);
      const canRetry = maxAtt === 0 || qSubs.length < maxAtt;
      const revealAns = hasSubmitted && c.show_answer_after_submit !== false && (!canRetry || Boolean(latestSub?.is_correct));
      const revealExp = hasSubmitted && c.show_explanation !== false;

      const bestPts = qSubs.reduce((m, s) => Math.max(m, Number(s.earned_points || 0)), 0);
      const maxPts = latestSub ? Number(latestSub.max_points || 1) : (c.questions || []).reduce((s, q) => s + Number(q.points ?? 1), 0);
      const bestPct = maxPts > 0 ? Math.round((bestPts / maxPts) * 100) : 0;
      const passed = hasSubmitted && bestPct >= Number(c.pass_score_pct ?? 60);

      quizStates[block.id] = {
        attempts_used: qSubs.length,
        max_attempts: maxAtt,
        can_retry: canRetry,
        passed,
        best_score_pct: bestPct,
        earned_points: bestPts,
        max_points: maxPts,
        last_feedback: latestSub ? safeJson(latestSub.feedback_json, null) : null,
      };

      return {
        ...block,
        content: {
          quiz_kind: c.quiz_kind || 'QUICK_CHECK',
          title: c.title || 'Bài kiểm tra',
          description: c.description || '',
          pass_score_pct: Number(c.pass_score_pct ?? 60),
          max_attempts: maxAtt,
          is_required: Boolean(c.is_required),
          questions: (c.questions || []).map((q) =>
            stripQuestionForStudent(q, { revealAnswer: revealAns, revealExplanation: revealExp })
          ),
        },
      };
    }
    return block;
  });

  // Gom các mốc tương tác trên video (kế thừa từ khóa học + bổ sung riêng của lớp nếu đã xuất bản)
  const rawMarkers = [
    ...latestPublishedMarkers(db, lesson.id),
    ...(publishedCustom ? publishedCustom.markers : []),
  ].sort((a, b) => Number(a.timestamp_sec) - Number(b.timestamp_sec) || Number(a.sort_order) - Number(b.sort_order));

  const studentMarkers = rawMarkers.map((m) => {
    const mSubs = subsByTarget.get(`VIDEO_MARKER:${m.id}`) || [];
    const hasSubmitted = mSubs.length > 0;
    const latestSub = mSubs[mSubs.length - 1] || null;
    const maxAtt = Number(m.max_attempts ?? 2);
    const anyCorrect = mSubs.some((s) => Boolean(s.is_correct));
    const canRetry = m.behavior !== 'INFO_ONLY' && !anyCorrect && (maxAtt === 0 || mSubs.length < maxAtt);
    const revealAns = hasSubmitted && Boolean(m.show_answer_after_submit) && (anyCorrect || !canRetry);
    const revealExp = hasSubmitted && Boolean(m.show_explanation);
    const bestPoints = mSubs.reduce((mx, s) => Math.max(mx, Number(s.earned_points || 0)), 0);

    return {
      id: m.id,
      block_id: m.block_id,
      origin: m.origin || 'INHERITED',
      timestamp_sec: Number(m.timestamp_sec || 0),
      sort_order: Number(m.sort_order || 0),
      behavior: m.behavior,
      title: m.title || '',
      info_body: m.info_body || '',
      is_required: Boolean(m.is_required),
      allow_skip: Boolean(m.allow_skip),
      max_attempts: maxAtt,
      allow_review: Boolean(m.allow_review),
      question:
        m.behavior === 'INFO_ONLY' || !m.question
          ? null
          : stripQuestionForStudent(m.question, { revealAnswer: revealAns, revealExplanation: revealExp }),
      learner_state: {
        completed: m.behavior === 'INFO_ONLY' ? false : hasSubmitted,
        attempts_used: mSubs.length,
        is_correct: anyCorrect,
        best_points: bestPoints,
        can_retry: canRetry,
        last_response: latestSub ? safeJson(latestSub.response_json, null) : null,
        last_feedback: latestSub ? safeJson(latestSub.feedback_json, {}).feedback || '' : '',
      },
    };
  });

  // Tài nguyên đính kèm (FILE, VIDEO, PDF) kèm stream_url đã ký
  const resourceIds = Array.from(
    new Set(
      sanitizedBlocks
        .filter((b) => ['file', 'video', 'pdf'].includes(b.block_type) && b.content?.resource_id)
        .map((b) => b.content.resource_id)
    )
  );
  const resourceRows = resourceIds.length
    ? db
        .prepare(`SELECT * FROM learning_resources WHERE id IN (${resourceIds.map(() => '?').join(',')})`)
        .all(...resourceIds)
    : [];
  const resourcesMap = Object.fromEntries(
    resourceRows.map((r) => [r.id, resourceDto(r, jwtSecret, user.id)])
  );

  // Tiến độ xem từng khối video của học viên (Resume Playback)
  const vpRows = db
    .prepare('SELECT * FROM video_watch_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?')
    .all(user.id, cls.id, lesson.id);
  const videoProgress = Object.fromEntries(
    vpRows.map((vp) => [
      vp.block_id,
      {
        last_position_sec: Number(vp.last_position_sec || 0),
        max_watched_sec: Number(vp.max_watched_sec || 0),
        watched_seconds: Number(vp.watched_seconds || 0),
        duration_sec: Number(vp.duration_sec || 0),
        watch_pct: Number(vp.watch_pct || 0),
        is_completed: Boolean(vp.is_completed),
      },
    ])
  );

  const prog = db
    .prepare('SELECT status, completed_at FROM lesson_progress WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ?')
    .get(user.id, cls.id, lesson.id);

  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description || '',
    objectives: lesson.objectives || '',
    duration_minutes: lesson.duration_minutes,
    completion_rule: lesson.completion_rule || 'MANUAL',
    min_video_watch_pct: Number(lesson.min_video_watch_pct || 0),
    require_video_quizzes: Boolean(lesson.require_video_quizzes ?? 1),
    chapter: chapterInfo,
    class_custom_note: publishedCustom
      ? {
          instructor_note: publishedCustom.instructor_note || '',
          custom_objectives: publishedCustom.custom_objectives || '',
        }
      : null,
    blocks: sanitizedBlocks,
    video_markers: studentMarkers,
    video_progress: videoProgress,
    quiz_states: quizStates,
    resources: resourcesMap,
    progress_status: prog ? prog.status : 'IN_PROGRESS',
    position: { index: idx + 1, total: list.length },
    prev_lesson: idx > 0 ? { id: list[idx - 1].id, title: list[idx - 1].title } : null,
    next_lesson: idx < list.length - 1 ? { id: list[idx + 1].id, title: list[idx + 1].title } : null,
  };
}

export function findPublishedMarkerForStudent(db, lessonId, classId, markerId) {
  const publishedCustom = getPublishedClassCustom(db, classId, lessonId);
  const all = [
    ...latestPublishedMarkers(db, lessonId),
    ...(publishedCustom ? publishedCustom.markers : []),
  ];
  return all.find((m) => m.id === markerId) || null;
}

export function submitVideoMarkerAnswer(db, { user, cls, lesson, markerId, body }) {
  const rawKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? `${user.id}:${cls.id}:${body.idempotency_key.trim().slice(0, 80)}`
    : null;

  if (rawKey) {
    const dup = db
      .prepare('SELECT * FROM lesson_quiz_submissions WHERE idempotency_key = ? AND student_id = ?')
      .get(rawKey, user.id);
    if (dup) {
      const savedFb = safeJson(dup.feedback_json, {});
      return {
        deduplicated: true,
        submission_id: dup.id,
        attempt_number: dup.attempt_number,
        is_correct: Boolean(dup.is_correct),
        grading_status: dup.grading_status,
        earned_points: Number(dup.earned_points || 0),
        max_points: Number(dup.max_points || 1),
        ...savedFb,
      };
    }
  }

  const marker = findPublishedMarkerForStudent(db, lesson.id, cls.id, markerId);
  if (!marker) fail(404, 'MARKER_NOT_FOUND', 'Không tìm thấy câu hỏi tương tác tại mốc thời gian này.');
  if (marker.behavior === 'INFO_ONLY' || !marker.question) {
    return {
      deduplicated: false,
      is_correct: true,
      can_continue: true,
      can_retry: false,
      feedback: 'Đã ghi nhận xem ghi chú.',
    };
  }

  const prevSubs = db
    .prepare(
      `SELECT * FROM lesson_quiz_submissions
       WHERE student_id = ? AND subject_class_id = ? AND target_type = 'VIDEO_MARKER' AND target_id = ?
       ORDER BY attempt_number ASC`
    )
    .all(user.id, cls.id, marker.id);

  const maxAtt = Number(marker.max_attempts ?? 2);
  if (maxAtt > 0 && prevSubs.length >= maxAtt) {
    fail(409, 'MAX_ATTEMPTS_REACHED', `Bạn đã sử dụng hết số lần trả lời tối đa (${maxAtt} lần) cho câu hỏi này.`);
  }

  const grade = gradeQuestionResponse(marker.question, body.response || {});
  const attemptNumber = prevSubs.length + 1;
  const canRetry = !grade.is_correct && (maxAtt === 0 || attemptNumber < maxAtt);
  const canContinue = grade.is_correct || !marker.is_required || !canRetry || Boolean(marker.allow_skip);
  const revealAns = Boolean(marker.show_answer_after_submit) && (grade.is_correct || !canRetry);
  const revealExp = Boolean(marker.show_explanation);

  const extraPayload = {
    max_attempts: maxAtt,
    can_retry: canRetry,
    can_continue: canContinue,
    feedback: grade.feedback,
    ...(revealExp && marker.question.explanation ? { explanation: marker.question.explanation } : {}),
    ...(revealAns ? { correct_answer: publicCorrectAnswer(marker.question) } : {}),
  };

  const idemKey = rawKey || `auto:${user.id}:${cls.id}:vm:${marker.id}:${attemptNumber}:${crypto.randomBytes(4).toString('hex')}`;
  const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO lesson_quiz_submissions (
       id, idempotency_key, student_id, subject_class_id, lesson_id, target_type, target_id,
       attempt_number, response_json, grading_status, is_correct, earned_points, max_points, feedback_json, submitted_at
     ) VALUES (?, ?, ?, ?, ?, 'VIDEO_MARKER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    subId,
    idemKey,
    user.id,
    cls.id,
    lesson.id,
    marker.id,
    attemptNumber,
    JSON.stringify(grade.normalized_response),
    grade.grading_status,
    grade.is_correct ? 1 : 0,
    grade.earned_points,
    grade.max_points,
    JSON.stringify(extraPayload),
    nowIso()
  );

  return {
    deduplicated: false,
    submission_id: subId,
    attempt_number: attemptNumber,
    is_correct: grade.is_correct,
    grading_status: grade.grading_status,
    earned_points: grade.earned_points,
    max_points: grade.max_points,
    ...extraPayload,
  };
}

export function submitStandaloneQuizBlock(db, { user, cls, lesson, blockId, body }) {
  const rawKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? `${user.id}:${cls.id}:${body.idempotency_key.trim().slice(0, 80)}`
    : null;

  if (rawKey) {
    const dup = db
      .prepare('SELECT * FROM lesson_quiz_submissions WHERE idempotency_key = ? AND student_id = ?')
      .get(rawKey, user.id);
    if (dup) {
      return {
        deduplicated: true,
        submission_id: dup.id,
        attempt_number: dup.attempt_number,
        is_correct: Boolean(dup.is_correct),
        earned_points: Number(dup.earned_points || 0),
        max_points: Number(dup.max_points || 1),
        ...safeJson(dup.feedback_json, {}),
      };
    }
  }

  // Tìm khối quiz trong nội dung đã xuất bản của khóa học hoặc lớp học
  let block = latestPublishedBlocks(db, lesson.id).find((b) => b.id === blockId && b.block_type === 'quiz');
  if (!block) {
    const customRow = db
      .prepare(
        "SELECT * FROM class_lesson_blocks WHERE id = ? AND subject_class_id = ? AND lesson_id = ? AND is_published = 1 AND block_type = 'quiz'"
      )
      .get(blockId, cls.id, lesson.id);
    if (customRow) block = { id: customRow.id, block_type: 'quiz', content: safeJson(customRow.content_json, {}) };
  }
  if (!block) fail(404, 'QUIZ_NOT_FOUND', 'Không tìm thấy bài kiểm tra trong bài học này.');

  const c = block.content || {};
  const questions = Array.isArray(c.questions) ? c.questions : [];
  const prevSubs = db
    .prepare(
      `SELECT * FROM lesson_quiz_submissions
       WHERE student_id = ? AND subject_class_id = ? AND target_type = 'QUIZ_BLOCK' AND target_id = ?
       ORDER BY attempt_number ASC`
    )
    .all(user.id, cls.id, block.id);

  const maxAtt = Number(c.max_attempts ?? 3);
  if (maxAtt > 0 && prevSubs.length >= maxAtt) {
    fail(409, 'MAX_ATTEMPTS_REACHED', `Bạn đã dùng hết số lượt làm bài tối đa (${maxAtt} lượt).`);
  }

  const responsesMap = body.responses && typeof body.responses === 'object' ? body.responses : {};
  let earnedPoints = 0;
  let maxPoints = 0;
  const questionResults = questions.map((q) => {
    const g = gradeQuestionResponse(q, responsesMap[q.id] || {});
    earnedPoints += g.earned_points;
    maxPoints += g.max_points;
    return { q, g };
  });

  earnedPoints = Math.round(earnedPoints * 100) / 100;
  maxPoints = Math.round(maxPoints * 100) / 100;
  const scorePct = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 100;
  const passPct = Number(c.pass_score_pct ?? 60);
  const passed = scorePct >= passPct;
  const attemptNumber = prevSubs.length + 1;
  const canRetry = !passed && (maxAtt === 0 || attemptNumber < maxAtt);
  const revealAns = c.show_answer_after_submit !== false && (passed || !canRetry);
  const revealExp = c.show_explanation !== false;

  const extraPayload = {
    score_pct: scorePct,
    pass_score_pct: passPct,
    passed,
    max_attempts: maxAtt,
    can_retry: canRetry,
    items: questionResults.map(({ q, g }) => ({
      question_id: q.id,
      is_correct: g.is_correct,
      grading_status: g.grading_status,
      earned_points: g.earned_points,
      max_points: g.max_points,
      feedback: g.feedback,
      ...(revealExp && q.explanation ? { explanation: q.explanation } : {}),
      ...(revealAns ? { correct_answer: publicCorrectAnswer(q) } : {}),
    })),
  };

  const idemKey = rawKey || `auto:${user.id}:${cls.id}:qb:${block.id}:${attemptNumber}:${crypto.randomBytes(4).toString('hex')}`;
  const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO lesson_quiz_submissions (
       id, idempotency_key, student_id, subject_class_id, lesson_id, target_type, target_id,
       attempt_number, response_json, grading_status, is_correct, earned_points, max_points, feedback_json, submitted_at
     ) VALUES (?, ?, ?, ?, ?, 'QUIZ_BLOCK', ?, ?, ?, 'GRADED', ?, ?, ?, ?, ?)`
  ).run(
    subId,
    idemKey,
    user.id,
    cls.id,
    lesson.id,
    block.id,
    attemptNumber,
    JSON.stringify(responsesMap),
    passed ? 1 : 0,
    earnedPoints,
    maxPoints,
    JSON.stringify(extraPayload),
    nowIso()
  );

  return {
    deduplicated: false,
    submission_id: subId,
    attempt_number: attemptNumber,
    is_correct: passed,
    earned_points: earnedPoints,
    max_points: maxPoints,
    ...extraPayload,
  };
}
