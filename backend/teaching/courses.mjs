/**
 * LMSPLUS Teaching Module — Khóa học, Chương, Bài học, Nội dung khối, Tài liệu, YouTube.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseYouTubeUrl } from '../../shared/youtube.mjs';
import { COURSE_STATUSES } from './schema.mjs';
import { ensureCourseTopicsBackfill } from './masterSchema.mjs';
import { validateBlocks, normalizeSnapshot, BLOCK_SCHEMA_VERSION } from './blocks.mjs';
import { validateUploadMagicBytes } from '../common/security.mjs';
import { createStorageAdapter } from '../storage/adapter.mjs';
import {
  canCreateCourse, canManageCourse, canEditCourseDraft, canViewCourse, courseScopeSql,
  isAdmin, isStaff, isInstructor, safeJson,
} from './scope.mjs';
import {
  fail, pageParams, nowIso, text, intField, oneOf, httpsUrlField, imageUrlField, tx, publicUser,
  mapAsync, someAsync,
} from './http.mjs';

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

// ------------------------------------------------------------------ helpers

export async function getCourse(db, id) {
  return await db.prepare('SELECT * FROM courses WHERE id = ?').get(id) || null;
}

async function requireCourse(db, id) {
  const c = await getCourse(db, id);
  if (!c) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
  return c;
}

const COURSE_AGG = `
  (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id AND ch.status <> 'ARCHIVED') AS chapters_count,
  (SELECT COUNT(*) FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
     WHERE ch.course_id = c.id AND ch.status <> 'ARCHIVED' AND l.publish_status <> 'ARCHIVED') AS lessons_count,
  (SELECT COUNT(*) FROM subject_classes sc WHERE sc.course_id = c.id AND sc.status NOT IN ('ARCHIVED','CANCELLED')) AS classes_count`;

function courseDto(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    thumbnail_url: row.thumbnail_url || '',
    subject: row.subject || '',
    objectives: row.objectives || '',
    target_audience: row.target_audience || '',
    prerequisites: row.prerequisites || '',
    intro: row.intro || '',
    status: row.status || 'PUBLISHED',
    instructor_id: row.instructor_id,
    instructor_name: row.instructor_name,
    department_id: row.department_id,
    chapters_count: row.chapters_count ?? 0,
    lessons_count: row.lessons_count ?? 0,
    classes_count: row.classes_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadCourseDto(db, id) {
  return courseDto(await db.prepare(`SELECT c.*, ${COURSE_AGG} FROM courses c WHERE c.id = ?`).get(id));
}

function readCourseFields(body, { partial }) {
  const out = {};
  const req = !partial;
  if (!partial || 'title' in body) out.title = text(body, 'title', { required: req || 'title' in body, min: 3, max: 200, label: 'tên khóa học' });
  if (!partial || 'code' in body) {
    const code = text(body, 'code', { required: req || 'code' in body, max: 40, label: 'mã khóa học' });
    if (code && !CODE_RE.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã khóa học chỉ gồm chữ, số, dấu chấm, gạch ngang (2–40 ký tự).', { field: 'code' });
    out.code = code ? code.toUpperCase() : code;
  }
  for (const [field, max, label] of [
    ['description', 2000, 'mô tả'],
    ['subject', 100, 'môn học'],
    ['objectives', 5000, 'mục tiêu học tập'],
    ['target_audience', 1000, 'đối tượng học'],
    ['prerequisites', 2000, 'kiến thức tiên quyết'],
    ['intro', 10000, 'nội dung giới thiệu'],
  ]) {
    if (!partial || field in body) out[field] = text(body, field, { max, label });
  }
  if (!partial || 'thumbnail_url' in body) out.thumbnail_url = imageUrlField(body, 'thumbnail_url', { label: 'ảnh bìa' });
  if ('status' in body) out.status = oneOf(body, 'status', COURSE_STATUSES, { label: 'trạng thái' });
  return out;
}

async function resolveInstructor(db, user, instructorId) {
  if (isAdmin(user) || isStaff(user)) {
    if (!instructorId) {
      if (isInstructor(user)) return await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      fail(422, 'VALIDATION_ERROR', 'Vui lòng chọn giảng viên phụ trách.', { field: 'instructor_id' });
    }
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(instructorId);
    if (!u || !JSON.parse(u.roles_json).includes('INSTRUCTOR')) {
      fail(422, 'VALIDATION_ERROR', 'Giảng viên phụ trách không hợp lệ.', { field: 'instructor_id' });
    }
    if (isStaff(user) && !isAdmin(user) && u.department_id !== user.department_id) {
      fail(403, 'OUT_OF_SCOPE', 'Giảng viên không thuộc đơn vị bạn quản lý.');
    }
    return u;
  }
  // Giảng viên luôn là người phụ trách khóa học mình tạo.
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

async function departmentName(db, deptId) {
  const r = await db.prepare('SELECT department_name FROM courses WHERE department_id = ? LIMIT 1').get(deptId);
  return r ? r.department_name : deptId || 'Chưa phân đơn vị';
}

async function assertUniqueCourseCode(db, code, exceptId = null) {
  const dup = await db.prepare('SELECT id FROM courses WHERE UPPER(code) = ? AND id <> ?').get(code, exceptId || '');
  if (dup) fail(409, 'COURSE_CODE_EXISTS', `Mã khóa học "${code}" đã tồn tại.`, { field: 'code' });
}

async function lessonHasLearnerData(db, lessonId) {
  const l = await db.prepare('SELECT published_version FROM lessons WHERE id = ?').get(lessonId);
  const progress = await db.prepare('SELECT 1 FROM lesson_progress WHERE lesson_id = ? LIMIT 1').get(lessonId);
  return Boolean(progress) || (l && Number(l.published_version) > 0);
}

async function outline(db, courseId, { publishedOnly = false } = {}) {
  const chapters = await db
    .prepare(
      `SELECT * FROM chapters WHERE course_id = ? ${publishedOnly ? "AND status = 'PUBLISHED'" : ''}
       ORDER BY sort_order, code`
    )
    .all(courseId);
  if (chapters.length === 0) return [];
  const chIds = chapters.map((c) => c.id);
  const inClause = chIds.map(() => '?').join(',');
  const allLessons = await db
    .prepare(
      `SELECT * FROM lessons WHERE chapter_id IN (${inClause}) ${publishedOnly ? "AND publish_status = 'PUBLISHED'" : ''}
       ORDER BY sort_order, code`
    )
    .all(...chIds);
  const byChapter = new Map();
  for (const l of allLessons) {
    const arr = byChapter.get(l.chapter_id) || [];
    arr.push({
      id: l.id,
      title: l.title,
      description: l.description || '',
      duration_minutes: l.duration_minutes,
      publish_status: l.publish_status,
      published_version: l.published_version,
      has_unpublished_changes:
        l.publish_status !== 'ARCHIVED' &&
        (Number(l.published_version) === 0 || (l.updated_at && l.published_at && l.updated_at > l.published_at)),
      completion_rule: l.completion_rule || 'MANUAL',
      sort_order: l.sort_order,
    });
    byChapter.set(l.chapter_id, arr);
  }
  return chapters.map((ch) => ({
    id: ch.id,
    topic_id: ch.topic_id || null,
    title: ch.title,
    description: ch.description || '',
    status: ch.status,
    sort_order: ch.sort_order,
    lessons: byChapter.get(ch.id) || [],
  }));
}

async function lessonContext(db, lessonId) {
  const lesson = await db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) fail(404, 'LESSON_NOT_FOUND', 'Không tìm thấy bài học.');
  const chapter = await db.prepare('SELECT * FROM chapters WHERE id = ?').get(lesson.chapter_id);
  if (!chapter || !chapter.course_id) fail(404, 'LESSON_NOT_FOUND', 'Bài học không thuộc khóa học nào.');
  const course = await requireCourse(db, chapter.course_id);
  return { lesson, chapter, course };
}

async function draftBlocks(db, lessonId) {
  return (await db
    .prepare('SELECT * FROM lesson_blocks WHERE lesson_id = ? ORDER BY sort_order')
    .all(lessonId))
    .map((b) => {
      let content = {};
      try {
        content = JSON.parse(b.content_json);
      } catch {
        content = {};
      }
      return { id: b.id, block_type: b.block_type, sort_order: b.sort_order, content };
    });
}

export async function latestPublishedBlocks(db, lessonId) {
  const v = await db
    .prepare('SELECT blocks_snapshot_json FROM lesson_versions WHERE lesson_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(lessonId);
  return v ? normalizeSnapshot(v.blocks_snapshot_json) : [];
}

async function touchCourse(db, courseId) {
  await db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(nowIso(), courseId);
}

// ------------------------------------------------------------------ YouTube oEmbed

async function checkYouTubeEmbeddable(watchUrl) {
  if (process.env.LMSPLUS_DISABLE_OEMBED === '1') {
    return { embeddable: null, check_message: 'Bỏ qua kiểm tra trực tuyến (môi trường kiểm thử).' };
  }
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (r.ok) {
      const j = await r.json();
      return { embeddable: true, title: String(j.title || '').slice(0, 200), author_name: String(j.author_name || '').slice(0, 200) };
    }
    if (r.status === 401 || r.status === 403) {
      return { embeddable: false, check_message: 'Chủ sở hữu video đã tắt chức năng nhúng hoặc video ở chế độ riêng tư.' };
    }
    if (r.status === 404 || r.status === 400) {
      return { embeddable: false, check_message: 'Video không tồn tại hoặc đã bị gỡ.' };
    }
    return { embeddable: null, check_message: `Không xác minh được video (YouTube trả về mã ${r.status}).` };
  } catch {
    return { embeddable: null, check_message: 'Không kết nối được YouTube để xác minh; video vẫn có thể hiển thị bình thường.' };
  }
}

// ------------------------------------------------------------------ routes

export function registerCourseRoutes(route, { uploadsDir, storage } = {}) {
  const store = storage || createStorageAdapter({ baseDir: uploadsDir });
  // ---------- Danh sách khóa học
  route('GET', '/courses', async ({ db, user, url }) => {
    const { page, size, offset } = pageParams(url, 12, 100);
    const scope = courseScopeSql(user);
    const where = [scope.sql];
    const params = [...scope.params];
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      where.push("(LOWER(c.title) LIKE LOWER(?) OR LOWER(c.code) LIKE LOWER(?))");
      params.push(`%${q}%`, `%${q}%`);
    }
    const subject = url.searchParams.get('subject');
    if (subject) {
      where.push('c.subject = ?');
      params.push(subject);
    }
    const status = url.searchParams.get('status');
    if (status && status !== 'ALL') {
      where.push('c.status = ?');
      params.push(status);
    } else if (!status) {
      where.push("c.status <> 'ARCHIVED'");
    }
    const sortMap = {
      updated_desc: 'c.updated_at DESC',
      updated_asc: 'c.updated_at ASC',
      title_asc: 'LOWER(c.title) ASC, c.title ASC',
    };
    const order = sortMap[url.searchParams.get('sort')] || sortMap.updated_desc;
    const whereSql = where.join(' AND ');
    const total = (await db.prepare(`SELECT COUNT(*) n FROM courses c WHERE ${whereSql}`).get(...params)).n;
    const rows = await db
      .prepare(`SELECT c.*, ${COURSE_AGG} FROM courses c WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, size, offset);
    const subjects = (await db
      .prepare(`SELECT DISTINCT c.subject FROM courses c WHERE ${scope.sql} AND c.subject IS NOT NULL AND c.subject <> '' ORDER BY c.subject`)
      .all(...scope.params))
      .map((r) => r.subject);
    return { items: rows.map(courseDto), page, page_size: size, total, subjects };
  });

  // ---------- Tạo khóa học
  route('POST', '/courses', async ({ db, user, body, log }) => {
    if (!canCreateCourse(user)) fail(403, 'COURSE_CREATE_FORBIDDEN', 'Bạn chưa được cấp quyền tạo khóa học.');
    const f = readCourseFields(body, { partial: false });
    const status = f.status || 'DRAFT';
    if (!['DRAFT', 'PUBLISHED'].includes(status)) fail(422, 'VALIDATION_ERROR', 'Khóa học mới chỉ có thể ở trạng thái Bản nháp hoặc Đã xuất bản.');
    await assertUniqueCourseCode(db, f.code);
    const instructor = await resolveInstructor(db, user, body.instructor_id);
    const deptId = instructor.department_id || user.department_id || 'chua_phan_don_vi';
    const id = `crs_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    await db.prepare(
      `INSERT INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
         chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status, is_assigned_to_student,
         updated_at, description, thumbnail_url, subject, objectives, target_audience, prerequisites, intro,
         status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'ASSIGNED_ONLY', 'NOT_ENROLLED', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, f.code, f.title, instructor.id, instructor.full_name, deptId, await departmentName(db, deptId), now,
      f.description, f.thumbnail_url, f.subject, f.objectives, f.target_audience, f.prerequisites, f.intro,
      status, user.id, now
    );
    await ensureCourseTopicsBackfill(db, id);
    log('INFO', `[teaching] course created ${f.code} by ${user.id}`);
    return [201, await loadCourseDto(db, id)];
  });

  // ---------- Chi tiết khóa học
  route('GET', '/courses/:id', async ({ db, user, params }) => {
    const course = await requireCourse(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem khóa học này.');
    const classes = await db
      .prepare(
        `SELECT sc.id, sc.code, sc.title, sc.status,
           (SELECT COUNT(*) FROM class_enrollments e WHERE e.subject_class_id = sc.id AND e.status = 'ACTIVE') AS student_count
         FROM subject_classes sc WHERE sc.course_id = ? ORDER BY sc.code`
      )
      .all(course.id);
    const resources = (await db
      .prepare('SELECT COUNT(*) n FROM learning_resources WHERE course_id = ? AND deleted_at IS NULL')
      .get(course.id)).n;
    const topics = await db
      .prepare("SELECT * FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, code")
      .all(course.id);
    const versionsCount = (await db.prepare('SELECT COUNT(*) n FROM course_versions WHERE course_id = ?').get(course.id)).n;
    return {
      ...await loadCourseDto(db, course.id),
      topics,
      versions_count: versionsCount,
      outline: await outline(db, course.id),
      classes,
      resources_count: resources,
      capabilities: {
        can_manage: canManageCourse(db, user, course),
        can_edit_draft: await canEditCourseDraft(db, user, course),
        can_duplicate: canCreateCourse(user),
      },
    };
  });

  // ---------- Cập nhật khóa học
  route('PATCH', '/courses/:id', async ({ db, user, body, params }) => {
    const course = await requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    const f = readCourseFields(body, { partial: true });
    if (f.code) await assertUniqueCourseCode(db, f.code, course.id);
    if ('instructor_id' in body && body.instructor_id && body.instructor_id !== course.instructor_id) {
      if (!isAdmin(user) && !isStaff(user)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Chỉ Giáo vụ hoặc Quản trị viên được đổi giảng viên phụ trách.');
      const instr = await resolveInstructor(db, user, body.instructor_id);
      f.instructor_id = instr.id;
      f.instructor_name = instr.full_name;
    }
    if (f.status === 'ARCHIVED') f.archived_at = nowIso();
    const keys = Object.keys(f);
    if (keys.length === 0) return await loadCourseDto(db, course.id);
    await db.prepare(`UPDATE courses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => f[k]), nowIso(), course.id);
    return await loadCourseDto(db, course.id);
  });

  // ---------- Đổi trạng thái (xuất bản / lưu trữ / ngừng hoạt động)
  route('POST', '/courses/:id/status', async ({ db, user, body, params, log }) => {
    const course = await requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền thay đổi trạng thái khóa học.');
    const status = oneOf(body, 'status', COURSE_STATUSES, { required: true, label: 'trạng thái' });
    await db.prepare('UPDATE courses SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'ARCHIVED' ? nowIso() : null, nowIso(), course.id);
    log('INFO', `[teaching] course ${course.code} status -> ${status} by ${user.id}`);
    return await loadCourseDto(db, course.id);
  });

  // ---------- Sao chép khóa học (tạo bản riêng, không ảnh hưởng lớp đang dùng bản gốc)
  route('POST', '/courses/:id/duplicate', async ({ db, user, body, params, log }) => {
    const src = await requireCourse(db, params.id);
    if (!canCreateCourse(user) || !await canViewCourse(db, user, src)) fail(403, 'COURSE_DUPLICATE_FORBIDDEN', 'Bạn không có quyền sao chép khóa học này.');
    let code = body.code ? String(body.code).trim().toUpperCase() : null;
    if (code && !CODE_RE.test(code)) fail(422, 'VALIDATION_ERROR', 'Mã khóa học không hợp lệ.', { field: 'code' });
    if (!code) {
      for (let n = 1; n < 100; n++) {
        const candidate = `${src.code}-BAN${n}`.slice(0, 40);
        if (!await db.prepare('SELECT 1 FROM courses WHERE UPPER(code) = ?').get(candidate)) {
          code = candidate;
          break;
        }
      }
    }
    await assertUniqueCourseCode(db, code);
    const title = text(body, 'title', { max: 200, label: 'tên khóa học' }) || `${src.title} (bản sao)`;
    const owner = isInstructor(user) ? await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) : { id: src.instructor_id, full_name: src.instructor_name };
    const newId = `crs_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
           chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status, is_assigned_to_student,
           updated_at, description, thumbnail_url, subject, objectives, target_audience, prerequisites, intro,
           status, created_by, created_at)
         SELECT ?, ?, ?, ?, ?, department_id, department_name, 0, 0, 0, enrollment_policy, 'NOT_ENROLLED', 0,
           ?, description, thumbnail_url, subject, objectives, target_audience, prerequisites, intro, 'DRAFT', ?, ?
         FROM courses WHERE id = ?`
      ).run(newId, code, title, owner.id, owner.full_name, now, user.id, now, src.id);

      const resMap = {};
      for (const r of await db.prepare('SELECT * FROM learning_resources WHERE course_id = ? AND class_id IS NULL AND deleted_at IS NULL').all(src.id)) {
        const rid = `res_${crypto.randomBytes(6).toString('hex')}`;
        resMap[r.id] = rid;
        await db.prepare(
          `INSERT INTO learning_resources (id, course_id, title, description, visibility, resource_type, storage_provider, storage_key, file_name,
             mime_type, file_size_bytes, checksum_sha256, duration_seconds, thumbnail_url, status, processing_status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', 'READY', ?, ?, ?)`
        ).run(rid, newId, r.title, r.description || null, r.visibility || 'ENROLLED', r.resource_type, r.storage_provider, r.storage_key, r.file_name, r.mime_type,
          r.file_size_bytes, r.checksum_sha256, r.duration_seconds ?? null, r.thumbnail_url ?? null, user.id, now, now);
      }

      const qbMap = {};
      for (const qb of await db.prepare('SELECT * FROM question_bank_items WHERE course_id = ? AND deleted_at IS NULL').all(src.id)) {
        const qbid = `qb_${crypto.randomBytes(5).toString('hex')}`;
        qbMap[qb.id] = qbid;
        await db.prepare(
          `INSERT INTO question_bank_items (id, course_id, subject, question_type, prompt, options_json, answer_key_json,
             points, explanation, correct_feedback, wrong_feedback, difficulty, tags_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(qbid, newId, qb.subject, qb.question_type, qb.prompt, qb.options_json, qb.answer_key_json,
          qb.points, qb.explanation, qb.correct_feedback, qb.wrong_feedback, qb.difficulty, qb.tags_json, user.id, now, now);
      }

      for (const ch of await db.prepare("SELECT * FROM chapters WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order").all(src.id)) {
        const chId = `ch_${crypto.randomBytes(5).toString('hex')}`;
        await db.prepare(
          `INSERT INTO chapters (id, subject_class_id, code, title, progress_pct, course_id, description, sort_order, status, updated_at)
           VALUES (?, '', ?, ?, 0, ?, ?, ?, ?, ?)`
        ).run(chId, ch.code, ch.title, newId, ch.description, ch.sort_order, ch.status, now);
        for (const l of await db.prepare("SELECT * FROM lessons WHERE chapter_id = ? AND publish_status <> 'ARCHIVED' ORDER BY sort_order").all(ch.id)) {
          const lId = `les_${crypto.randomBytes(5).toString('hex')}`;
          await db.prepare(
            `INSERT INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
               required_video_pct, require_quick_check, last_video_position_sec, total_video_seconds, quick_check_passed,
               working_draft_revision, published_version, description, objectives, sort_order, publish_status,
               updated_at, completion_rule, min_video_watch_pct, require_video_quizzes)
             VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, 0, 0, 0, ?, 0, 1, 0, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`
          ).run(lId, chId, l.code, l.title, l.duration_minutes, l.duration_minutes * 60, l.description, l.objectives,
            l.sort_order, now, l.completion_rule || 'MANUAL', l.min_video_watch_pct || 0, l.require_video_quizzes ?? 1);
          const blockMap = {};
          for (const b of await draftBlocks(db, l.id)) {
            const content = { ...b.content };
            if (['file', 'video', 'pdf'].includes(b.block_type) && content.resource_id) {
              content.resource_id = resMap[content.resource_id] || content.resource_id;
            }
            const newBlkId = `blk_${crypto.randomBytes(6).toString('hex')}`;
            blockMap[b.id] = newBlkId;
            await db.prepare(
              `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
               VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
            ).run(newBlkId, lId, BLOCK_SCHEMA_VERSION, b.block_type, b.sort_order, JSON.stringify(content));
          }
          for (const m of await db.prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec, sort_order').all(l.id)) {
            await db.prepare(
              `INSERT INTO video_quiz_markers (id, lesson_id, class_id, block_id, timestamp_sec, sort_order, behavior, title, info_body,
                 question_id, question_snapshot_json, is_required, allow_skip, max_attempts,
                 show_answer_after_submit, show_explanation, allow_review, created_by, created_at, updated_at)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              `vqm_${crypto.randomBytes(5).toString('hex')}`, lId, blockMap[m.block_id] || m.block_id,
              m.timestamp_sec, m.sort_order, m.behavior, m.title, m.info_body,
              m.question_id ? (qbMap[m.question_id] || null) : null, m.question_snapshot_json,
              m.is_required, m.allow_skip, m.max_attempts, m.show_answer_after_submit, m.show_explanation, m.allow_review,
              user.id, now, now
            );
          }
        }
      }
    });
    log('INFO', `[teaching] course ${src.code} duplicated -> ${code} by ${user.id}`);
    return [201, await loadCourseDto(db, newId)];
  });

  // ---------- Thống kê khóa học
  route('GET', '/courses/:id/stats', async ({ db, user, params }) => {
    const course = await requireCourse(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem khóa học này.');
    const published = await db
      .prepare(
        `SELECT l.id, l.title FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
         WHERE ch.course_id = ? AND ch.status = 'PUBLISHED' AND l.publish_status = 'PUBLISHED'
         ORDER BY ch.sort_order, l.sort_order`
      )
      .all(course.id);
    const classes = await db
      .prepare(
        `SELECT sc.id, sc.code, sc.title,
           (SELECT COUNT(*) FROM class_enrollments e WHERE e.subject_class_id = sc.id AND e.status = 'ACTIVE') AS students
         FROM subject_classes sc WHERE sc.course_id = ? AND sc.status NOT IN ('ARCHIVED','CANCELLED')`
      )
      .all(course.id);
    const lessonStats = await mapAsync(published, async (l) => {
      const done = (await db
        .prepare(
          `SELECT COUNT(*) n FROM lesson_progress p JOIN class_enrollments e
             ON e.subject_class_id = p.subject_class_id AND e.student_id = p.student_id AND e.status = 'ACTIVE'
           JOIN subject_classes sc ON sc.id = p.subject_class_id AND sc.course_id = ?
           WHERE p.lesson_id = ? AND p.status = 'COMPLETED'`
        )
        .get(course.id, l.id)).n;
      return { lesson_id: l.id, title: l.title, completed_count: done };
    });
    const totalStudents = classes.reduce((s, c) => s + c.students, 0);
    return { published_lessons: published.length, total_students: totalStudents, classes, lessons: lessonStats };
  });

  // ---------- Chương
  route('POST', '/courses/:id/chapters', async ({ db, user, body, params }) => {
    const course = await requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    const title = text(body, 'title', { required: true, max: 200, label: 'tên chương' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' });
    const status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED'], { fallback: 'PUBLISHED', label: 'trạng thái' });

    let topicId = text(body, 'topic_id', { max: 80, label: 'chủ đề' }) || null;
    if (topicId) {
      const tp = await db.prepare('SELECT id FROM course_topics WHERE id = ? AND course_id = ?').get(topicId, course.id);
      if (!tp) fail(400, 'INVALID_TOPIC', 'Chủ đề không thuộc môn học này.');
    } else {
      await ensureCourseTopicsBackfill(db, course.id);
      const firstTopic = await db
        .prepare("SELECT id FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED' ORDER BY sort_order, id LIMIT 1")
        .get(course.id);
      topicId = firstTopic?.id || null;
    }

    const max = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) m, COUNT(*) n FROM chapters WHERE course_id = ?').get(course.id);
    const id = `ch_${crypto.randomBytes(5).toString('hex')}`;
    await db.prepare(
      `INSERT INTO chapters (id, subject_class_id, code, title, progress_pct, course_id, topic_id, description, sort_order, status, updated_at)
       VALUES (?, '', ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(id, `Chương ${max.n + 1}`, title, course.id, topicId, description, max.m + 10, status, nowIso());
    await touchCourse(db, course.id);
    return [201, (await outline(db, course.id)).find((c) => c.id === id)];
  });

  const requireChapter = async (db, id) => {
    const ch = await db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
    if (!ch || !ch.course_id) fail(404, 'CHAPTER_NOT_FOUND', 'Không tìm thấy chương.');
    return { chapter: ch, course: await requireCourse(db, ch.course_id) };
  };

  route('PATCH', '/chapters/:id', async ({ db, user, body, params }) => {
    const { chapter, course } = await requireChapter(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    const f = {};
    if ('title' in body) f.title = text(body, 'title', { required: true, max: 200, label: 'tên chương' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' });
    if ('status' in body) f.status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'ARCHIVED'], { required: true, label: 'trạng thái' });
    const keys = Object.keys(f);
    if (keys.length) {
      await db.prepare(`UPDATE chapters SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => f[k]), nowIso(), chapter.id);
      await touchCourse(db, course.id);
    }
    return (await outline(db, course.id)).find((c) => c.id === chapter.id);
  });

  route('DELETE', '/chapters/:id', async ({ db, user, params }) => {
    const { chapter, course } = await requireChapter(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    const lessons = await db.prepare('SELECT id FROM lessons WHERE chapter_id = ?').all(chapter.id);
    if (await someAsync(lessons, async (l) => await lessonHasLearnerData(db, l.id))) {
      fail(409, 'CONTENT_IN_USE', 'Chương có bài học đã xuất bản hoặc đã có học viên học. Hãy chọn "Lưu trữ" để ẩn thay vì xóa.');
    }
    await db.prepare('DELETE FROM chapters WHERE id = ?').run(chapter.id);
    await touchCourse(db, course.id);
    return { deleted_id: chapter.id };
  });

  // ---------- Sắp xếp chương & bài học (kéo thả, có thể chuyển bài sang chương khác)
  route('PUT', '/courses/:id/outline', async ({ db, user, body, params }) => {
    const course = await requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    if (!Array.isArray(body.chapters)) fail(422, 'VALIDATION_ERROR', 'Dữ liệu sắp xếp không hợp lệ.');
    const ownChapters = new Set((await db.prepare('SELECT id FROM chapters WHERE course_id = ?').all(course.id)).map((r) => r.id));
    const ownLessons = new Set(
      (await db.prepare('SELECT l.id FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ch.course_id = ?').all(course.id)).map((r) => r.id)
    );
    const seenCh = new Set();
    const seenLes = new Set();
    for (const c of body.chapters) {
      if (!ownChapters.has(c.id) || seenCh.has(c.id)) fail(422, 'VALIDATION_ERROR', 'Danh sách chương không hợp lệ.');
      seenCh.add(c.id);
      for (const lid of c.lesson_ids || []) {
        if (!ownLessons.has(lid) || seenLes.has(lid)) fail(422, 'VALIDATION_ERROR', 'Danh sách bài học không hợp lệ.');
        seenLes.add(lid);
      }
    }
    if (seenCh.size !== ownChapters.size || seenLes.size !== ownLessons.size) {
      fail(422, 'VALIDATION_ERROR', 'Cần gửi đầy đủ tất cả chương và bài học của khóa học.');
    }
    await tx(db, async () => {
      for (const [ci, c] of (body.chapters).entries()) {
        await db.prepare('UPDATE chapters SET sort_order = ? WHERE id = ?').run((ci + 1) * 10, c.id);
        for (const [li, lid] of ((c.lesson_ids || [])).entries()) {
          await db.prepare('UPDATE lessons SET sort_order = ?, chapter_id = ? WHERE id = ?').run((li + 1) * 10, c.id, lid);
        }
      }
    });
    await touchCourse(db, course.id);
    return { outline: await outline(db, course.id) };
  });

  // ---------- Bài học
  route('POST', '/chapters/:id/lessons', async ({ db, user, body, params }) => {
    const { chapter, course } = await requireChapter(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa khóa học này.');
    const title = text(body, 'title', { required: true, max: 200, label: 'tên bài học' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả' });
    const objectives = text(body, 'objectives', { max: 2000, label: 'mục tiêu bài học' });
    const duration = intField(body, 'duration_minutes', { min: 1, max: 600, label: 'thời lượng (phút)' }) || 15;
    const rule = oneOf(body, 'completion_rule', ['MANUAL', 'REVIEW_CORRECT', 'VIDEO_AND_QUIZ'], { fallback: 'MANUAL', label: 'điều kiện hoàn thành' });
    const minWatchPct = intField(body, 'min_video_watch_pct', { min: 0, max: 100, label: 'tỷ lệ xem video tối thiểu' }) ?? 0;
    const reqVideoQuiz = body.require_video_quizzes === undefined ? 1 : (body.require_video_quizzes ? 1 : 0);
    const max = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) m, COUNT(*) n FROM lessons WHERE chapter_id = ?').get(chapter.id);
    const id = `les_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    await db.prepare(
      `INSERT INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
         required_video_pct, require_quick_check, last_video_position_sec, total_video_seconds, quick_check_passed,
         working_draft_revision, published_version, description, objectives, sort_order, publish_status, updated_at,
         completion_rule, min_video_watch_pct, require_video_quizzes)
       VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, 0, 0, 0, ?, 0, 1, 0, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`
    ).run(id, chapter.id, String(max.n + 1), title, duration, duration * 60, description, objectives, max.m + 10, now, rule, minWatchPct, reqVideoQuiz);
    await touchCourse(db, course.id);
    return [201, { id, chapter_id: chapter.id, title, publish_status: 'DRAFT' }];
  });

  route('GET', '/lessons/:id', async ({ db, user, params }) => {
    const { lesson, chapter, course } = await lessonContext(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem bài học này.');
    const classesUsing = (await db
      .prepare("SELECT COUNT(*) n FROM subject_classes WHERE course_id = ? AND status NOT IN ('ARCHIVED','CANCELLED')")
      .get(course.id)).n;
    const markerRows = (await db
      .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec ASC, sort_order ASC')
      .all(lesson.id))
      .map((r) => {
        const snap = safeJson(r.question_snapshot_json, {});
        return {
          id: r.id,
          lesson_id: r.lesson_id,
          class_id: null,
          origin: 'INHERITED',
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
      });
    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description || '',
      objectives: lesson.objectives || '',
      duration_minutes: lesson.duration_minutes,
      completion_rule: lesson.completion_rule || 'MANUAL',
      min_video_watch_pct: Number(lesson.min_video_watch_pct || 0),
      require_video_quizzes: Boolean(lesson.require_video_quizzes ?? 1),
      publish_status: lesson.publish_status,
      published_version: lesson.published_version,
      published_at: lesson.published_at,
      updated_at: lesson.updated_at,
      revision: lesson.working_draft_revision,
      chapter: { id: chapter.id, title: chapter.title },
      course: { id: course.id, code: course.code, title: course.title, status: course.status, classes_using: classesUsing },
      blocks: await draftBlocks(db, lesson.id),
      video_markers: markerRows,
      capabilities: {
        can_edit: await canEditCourseDraft(db, user, course),
        can_publish: canManageCourse(db, user, course),
      },
    };
  });

  route('PATCH', '/lessons/:id', async ({ db, user, body, params }) => {
    const { lesson, course } = await lessonContext(db, params.id);
    if (!await canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa bài học này.');
    if (lesson.publish_status === 'ARCHIVED') fail(409, 'LESSON_ARCHIVED', 'Bài học đã lưu trữ. Hãy khôi phục trước khi chỉnh sửa.');
    const f = {};
    if ('title' in body) f.title = text(body, 'title', { required: true, max: 200, label: 'tên bài học' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' });
    if ('objectives' in body) f.objectives = text(body, 'objectives', { max: 2000, label: 'mục tiêu' });
    if ('duration_minutes' in body) f.duration_minutes = intField(body, 'duration_minutes', { min: 1, max: 600, required: true, label: 'thời lượng (phút)' });
    if ('completion_rule' in body) f.completion_rule = oneOf(body, 'completion_rule', ['MANUAL', 'REVIEW_CORRECT', 'VIDEO_AND_QUIZ'], { required: true, label: 'điều kiện hoàn thành' });
    if ('min_video_watch_pct' in body) f.min_video_watch_pct = intField(body, 'min_video_watch_pct', { min: 0, max: 100, required: true, label: 'tỷ lệ xem video tối thiểu' });
    if ('require_video_quizzes' in body) f.require_video_quizzes = body.require_video_quizzes ? 1 : 0;
    const keys = Object.keys(f);
    if (keys.length) {
      await db.prepare(`UPDATE lessons SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => f[k]), nowIso(), lesson.id);
      await touchCourse(db, course.id);
    }
    return { id: lesson.id, ...f };
  });

  // ---------- Lưu bản nháp nội dung (kiểm soát phiên bản lạc quan)
  route('PUT', '/lessons/:id/content', async ({ db, user, body, params }) => {
    const { lesson, course } = await lessonContext(db, params.id);
    if (!await canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa nội dung bài học này.');
    if (lesson.publish_status === 'ARCHIVED') fail(409, 'LESSON_ARCHIVED', 'Bài học đã lưu trữ. Hãy khôi phục trước khi chỉnh sửa.');
    if (Number(body.base_revision) !== Number(lesson.working_draft_revision)) {
      fail(409, 'REVISION_CONFLICT', 'Nội dung đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.', {
        server_revision: lesson.working_draft_revision,
      });
    }
    const v = await validateBlocks(body.blocks, { db, courseId: course.id });
    if (!v.ok) fail(422, v.code, v.message, { block_index: v.block_index });
    const nextRev = Number(lesson.working_draft_revision) + 1;
    await tx(db, async () => {
      await db.prepare('DELETE FROM lesson_blocks WHERE lesson_id = ?').run(lesson.id);
      const ins = db.prepare(
        `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`
      );
      for (const b of v.blocks) {
        // id khối là khóa chính toàn cục → tránh trùng giữa các bài học
        const clash = await db.prepare('SELECT lesson_id FROM lesson_blocks WHERE id = ?').get(b.id);
        if (clash) b.id = `blk_${crypto.randomBytes(6).toString('hex')}`;
        await ins.run(b.id, lesson.id, BLOCK_SCHEMA_VERSION, b.block_type, b.sort_order, JSON.stringify(b.content));
      }
      // Dọn tự động các mốc câu hỏi tương tác của khối video đã bị xóa khỏi bản nháp
      const activeVideoIds = v.blocks
        .filter((b) => ['video', 'youtube'].includes(b.block_type))
        .map((b) => b.id);
      if (activeVideoIds.length > 0) {
        await db.prepare(
          `DELETE FROM video_quiz_markers
           WHERE lesson_id = ? AND class_id IS NULL
             AND block_id NOT IN (${activeVideoIds.map(() => '?').join(',')})`
        ).run(lesson.id, ...activeVideoIds);
      } else {
        await db.prepare('DELETE FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL').run(lesson.id);
      }
      await db.prepare('UPDATE lessons SET working_draft_revision = ?, updated_at = ? WHERE id = ?').run(nextRev, nowIso(), lesson.id);
    });
    await touchCourse(db, course.id);
    return { revision: nextRev, blocks: v.blocks };
  });

  route('POST', '/lessons/:id/publish', async ({ db, user, body, params, log }) => {
    const { lesson, course } = await lessonContext(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'PUBLISH_FORBIDDEN', 'Chỉ giảng viên phụ trách khóa học mới được xuất bản bài học.');
    if (lesson.publish_status === 'ARCHIVED') fail(409, 'LESSON_ARCHIVED', 'Bài học đã lưu trữ.');
    const blocks = await draftBlocks(db, lesson.id);
    if (blocks.length === 0) fail(422, 'EMPTY_LESSON', 'Bài học chưa có nội dung để xuất bản.');
    const markers = await db
      .prepare('SELECT * FROM video_quiz_markers WHERE lesson_id = ? AND class_id IS NULL ORDER BY timestamp_sec ASC, sort_order ASC')
      .all(lesson.id);
    const changeNote = text(body || {}, 'change_note', { max: 500, label: 'ghi chú phiên bản' });
    const nextVer = Number(lesson.published_version) + 1;
    const now = nowIso();
    await tx(db, async () => {
      await db.prepare(
        `INSERT INTO lesson_versions (id, lesson_id, version_number, blocks_snapshot_json, markers_snapshot_json, change_note, published_by, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), lesson.id, nextVer, JSON.stringify(blocks), JSON.stringify(markers), changeNote || null, user.full_name || user.id, now);
      await db.prepare("UPDATE lessons SET published_version = ?, publish_status = 'PUBLISHED', published_at = ?, updated_at = ? WHERE id = ?")
        .run(nextVer, now, now, lesson.id);
    });
    await touchCourse(db, course.id);
    log('INFO', `[teaching] lesson ${lesson.id} published v${nextVer} by ${user.id}`);
    return { id: lesson.id, published_version: nextVer, publish_status: 'PUBLISHED', published_at: now };
  });

  const setLessonStatus = (status) => async ({ db, user, params }) => {
    const { lesson, course } = await lessonContext(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền thay đổi bài học này.');
    let target = status;
    if (status === 'RESTORE') target = Number(lesson.published_version) > 0 ? 'PUBLISHED' : 'DRAFT';
    await db.prepare('UPDATE lessons SET publish_status = ? WHERE id = ?').run(target, lesson.id);
    await touchCourse(db, course.id);
    return { id: lesson.id, publish_status: target };
  };
  route('POST', '/lessons/:id/unpublish', setLessonStatus('DRAFT'));
  route('POST', '/lessons/:id/archive', setLessonStatus('ARCHIVED'));
  route('POST', '/lessons/:id/restore', setLessonStatus('RESTORE'));

  route('DELETE', '/lessons/:id', async ({ db, user, params }) => {
    const { lesson, course } = await lessonContext(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền xóa bài học này.');
    if (await lessonHasLearnerData(db, lesson.id)) {
      fail(409, 'CONTENT_IN_USE', 'Bài học đã từng xuất bản hoặc đã có học viên học. Hãy chọn "Lưu trữ" để ẩn thay vì xóa.');
    }
    await db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
    await touchCourse(db, course.id);
    return { deleted_id: lesson.id };
  });

  // ---------- YouTube
  route('POST', '/youtube/validate', async ({ body }) => {
    const parsed = parseYouTubeUrl(typeof body.url === 'string' ? body.url : '');
    if (!parsed.ok) fail(422, parsed.error, parsed.message);
    const check = await checkYouTubeEmbeddable(parsed.watchUrl);
    return {
      video_id: parsed.videoId,
      start_seconds: parsed.startSeconds,
      embed_url: parsed.embedUrl,
      watch_url: parsed.watchUrl,
      thumbnail_url: parsed.thumbnailUrl,
      embeddable: check.embeddable,
      title: check.title || '',
      author_name: check.author_name || '',
      check_message: check.check_message || '',
    };
  });

  // ---------- Tài liệu học tập
  route('GET', '/courses/:id/resources', async ({ db, user, params }) => {
    const course = await requireCourse(db, params.id);
    if (!await canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem tài liệu của khóa học này.');
    const rows = await db
      .prepare(
        `SELECT r.*, u.full_name AS created_by_name FROM learning_resources r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.course_id = ? AND r.class_id IS NULL AND r.deleted_at IS NULL ORDER BY r.created_at DESC`
      )
      .all(course.id);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description || '',
        visibility: r.visibility || 'ENROLLED',
        resource_type: r.resource_type,
        url: r.resource_type === 'LINK' ? r.storage_key : null,
        file_name: r.file_name,
        mime_type: r.mime_type,
        file_size_bytes: r.file_size_bytes,
        duration_seconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
        thumbnail_url: r.thumbnail_url || '',
        processing_status: r.processing_status || 'READY',
        created_by_name: r.created_by_name,
        created_at: r.created_at,
      })),
      can_edit: await canEditCourseDraft(db, user, course),
    };
  });

  route('POST', '/courses/:id/resources', async ({ db, user, body, params, log }) => {
    const course = await requireCourse(db, params.id);
    if (!await canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền thêm tài liệu cho khóa học này.');
    const title = text(body, 'title', { required: true, max: 200, label: 'tên tài liệu' });
    const type = oneOf(body, 'resource_type', ['LINK', 'FILE'], { required: true, label: 'loại tài liệu' });
    const id = `res_${crypto.randomBytes(6).toString('hex')}`;
    const now = nowIso();
    if (type === 'LINK') {
      const raw = text(body, 'url', { required: true, max: 2048, label: 'đường dẫn' });
      let u;
      try {
        u = new URL(raw);
      } catch {
        fail(422, 'VALIDATION_ERROR', 'Đường dẫn không hợp lệ.', { field: 'url' });
      }
      if (!['http:', 'https:'].includes(u.protocol)) fail(422, 'VALIDATION_ERROR', 'Chỉ hỗ trợ đường dẫn http/https.', { field: 'url' });
      await db.prepare(
        `INSERT INTO learning_resources (id, course_id, title, resource_type, storage_provider, storage_key, status,
           created_by, created_at, updated_at) VALUES (?, ?, ?, 'LINK', 'EXTERNAL_URL', ?, 'READY', ?, ?, ?)`
      ).run(id, course.id, title, u.toString(), user.id, now, now);
    } else {
      const fileName = text(body, 'file_name', { required: true, max: 200, label: 'tên tệp' });
      const ext = path.extname(fileName).slice(1).toLowerCase();
      if (!ALLOWED_EXT[ext]) fail(422, 'FILE_TYPE_NOT_ALLOWED', `Định dạng .${ext || '?'} không được hỗ trợ. Cho phép: ${Object.keys(ALLOWED_EXT).join(', ')}.`);
      if (typeof body.data_base64 !== 'string' || !body.data_base64) fail(422, 'VALIDATION_ERROR', 'Thiếu nội dung tệp.');
      const buf = Buffer.from(body.data_base64, 'base64');
      if (buf.length === 0) fail(422, 'VALIDATION_ERROR', 'Tệp rỗng.');
      if (buf.length > MAX_UPLOAD_BYTES) fail(413, 'FILE_TOO_LARGE', 'Tệp vượt quá 10 MB.');
      const magic = validateUploadMagicBytes(buf, ext);
      if (!magic.ok) fail(422, 'INVALID_FILE_CONTENT', magic.message);
      const storageKey = store.buildKey('documents', course.id, `${id}.${ext}`);
      const stored = await store.putBuffer(storageKey, buf, ALLOWED_EXT[ext]);
      const safeName = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
      await db.prepare(
        `INSERT INTO learning_resources (id, course_id, title, resource_type, storage_provider, storage_key, file_name,
           mime_type, file_size_bytes, checksum_sha256, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'FILE', ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?)`
      ).run(id, course.id, title, stored.storageProvider, stored.storageKey, safeName, ALLOWED_EXT[ext], stored.sizeBytes,
        stored.checksumSha256, user.id, now, now);
    }
    log('INFO', `[teaching] resource ${id} (${type}) added to ${course.code} by ${user.id}`);
    return [201, { id, title, resource_type: type }];
  });

  route('DELETE', '/resources/:id', async ({ db, user, params }) => {
    const r = await db.prepare('SELECT * FROM learning_resources WHERE id = ? AND deleted_at IS NULL').get(params.id);
    if (!r) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài liệu.');
    const course = await requireCourse(db, r.course_id);
    if (!await canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền xóa tài liệu này.');
    await db.prepare('UPDATE learning_resources SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), r.id);
    return { deleted_id: r.id };
  });

  route('GET', '/resources/:id/download', async ({ db, user, params, raw, res }) => {
    const r = await db.prepare('SELECT * FROM learning_resources WHERE id = ?').get(params.id);
    if (!r) fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài liệu.');
    if (r.deleted_at) fail(410, 'RESOURCE_REMOVED', 'Tài liệu đã bị gỡ khỏi khóa học.');
    const course = await requireCourse(db, r.course_id);
    const isCourseStaff = await canViewCourse(db, user, course);
    if (r.visibility === 'INSTRUCTOR_ONLY' && !isCourseStaff) {
      fail(403, 'RESOURCE_ACCESS_DENIED', 'Tài liệu này chỉ dành cho giảng viên.');
    }
    let allowed = isCourseStaff;
    if (!allowed && course.status === 'PUBLISHED') {
      if (r.class_id) {
        allowed = Boolean(
          await db.prepare(
            `SELECT 1 FROM class_enrollments e JOIN subject_classes sc ON sc.id = e.subject_class_id
             WHERE e.student_id = ? AND e.subject_class_id = ? AND e.status = 'ACTIVE'
               AND sc.status IN ('ACTIVE','UPCOMING','COMPLETED')`
          ).get(user.id, r.class_id)
        );
      } else {
        allowed = Boolean(
          await db.prepare(
            `SELECT 1 FROM class_enrollments e JOIN subject_classes sc ON sc.id = e.subject_class_id
             WHERE e.student_id = ? AND e.status = 'ACTIVE' AND sc.course_id = ?
               AND sc.status IN ('ACTIVE','UPCOMING','COMPLETED')`
          ).get(user.id, course.id)
        );
      }
    }
    if (!allowed) fail(403, 'RESOURCE_ACCESS_DENIED', 'Bạn không có quyền truy cập tài liệu này.');
    if (r.resource_type === 'LINK') return { url: r.storage_key, title: r.title };
    const provider = r.storage_provider || 'LOCAL_DISK';
    const stat = await store.statObject(r.storage_key, provider);
    if (!stat.exists) fail(404, 'FILE_MISSING', 'Không tìm thấy tệp trên máy chủ.');
    const dlHeaders = {
      'Content-Type': r.mime_type || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(r.file_name || 'tai-lieu')}`,
      'X-Content-Type-Options': 'nosniff',
    };
    await store.streamObjectToResponse({
      res,
      raw,
      status: 200,
      headers: dlHeaders,
      storageKey: r.storage_key,
      storageProvider: provider,
      size: stat.size,
    });
  });
}

export { outline, lessonContext, draftBlocks, publicUser };
