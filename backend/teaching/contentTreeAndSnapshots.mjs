/**
 * LMSPLUS Master LMS — Cây nội dung 4 cấp (Môn -> Chủ đề -> Chương -> Bài),
 * Quản lý Phiên bản Môn học bất biến (SNAPSHOT), Nâng cấp có kiểm soát & Wiki Môn học.
 */

import crypto from 'node:crypto';
import { fail, nowIso, text, intField, oneOf, tx } from './http.mjs';
import { canManageCourse, canEditCourseDraft, canViewCourse, courseScopeSql, isAdmin, safeJson } from './scope.mjs';
import {
  ensureCourseTopicsBackfill,
  buildCourseSnapshotPayload,
} from './masterSchema.mjs';
import { requireClassAccess, getClass } from './classes.mjs';

function requireCourse(db, id) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!c) fail(404, 'COURSE_NOT_FOUND', 'Không tìm thấy khóa/môn học.');
  return c;
}

function slugify(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || `trang-${crypto.randomBytes(3).toString('hex')}`;
}

export function buildCourseTree(db, courseId, { publishedOnly = false } = {}) {
  ensureCourseTopicsBackfill(db, courseId);
  const topics = db
    .prepare(
      `SELECT * FROM course_topics WHERE course_id = ? ${publishedOnly ? "AND status = 'PUBLISHED'" : "AND status <> 'ARCHIVED'"}
       ORDER BY sort_order ASC, code ASC, id ASC`
    )
    .all(courseId);
  const chapters = db
    .prepare(
      `SELECT * FROM chapters WHERE course_id = ? ${publishedOnly ? "AND status = 'PUBLISHED'" : "AND status <> 'ARCHIVED'"}
       ORDER BY sort_order ASC, code ASC, id ASC`
    )
    .all(courseId);
  const lessons = db
    .prepare(
      `SELECT l.* FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
       WHERE ch.course_id = ? ${publishedOnly ? "AND l.publish_status = 'PUBLISHED'" : "AND l.publish_status <> 'ARCHIVED'"}
       ORDER BY l.sort_order ASC, l.code ASC, l.id ASC`
    )
    .all(courseId);

  // Thống kê nhanh 3 ngân hàng & Wiki tại từng bài học lá
  const qCounts = Object.fromEntries(
    db.prepare('SELECT lesson_id, COUNT(*) n FROM question_bank_items WHERE course_id = ? AND lesson_id IS NOT NULL AND deleted_at IS NULL GROUP BY lesson_id')
      .all(courseId).map((r) => [r.lesson_id, r.n])
  );
  const aCounts = Object.fromEntries(
    db.prepare('SELECT lesson_id, COUNT(*) n FROM assignment_bank_items WHERE course_id = ? AND lesson_id IS NOT NULL AND deleted_at IS NULL GROUP BY lesson_id')
      .all(courseId).map((r) => [r.lesson_id, r.n])
  );
  const rCounts = Object.fromEntries(
    db.prepare('SELECT lesson_id, COUNT(*) n FROM learning_resources WHERE course_id = ? AND lesson_id IS NOT NULL AND deleted_at IS NULL GROUP BY lesson_id')
      .all(courseId).map((r) => [r.lesson_id, r.n])
  );
  const wCounts = Object.fromEntries(
    db.prepare('SELECT lesson_id, COUNT(*) n FROM course_wiki_pages WHERE course_id = ? AND lesson_id IS NOT NULL AND deleted_at IS NULL GROUP BY lesson_id')
      .all(courseId).map((r) => [r.lesson_id, r.n])
  );

  const lessonsByCh = {};
  for (const l of lessons) {
    (lessonsByCh[l.chapter_id] ||= []).push({
      id: l.id,
      chapter_id: l.chapter_id,
      code: l.code,
      title: l.title,
      description: l.description || '',
      duration_minutes: l.duration_minutes,
      sort_order: l.sort_order,
      publish_status: l.publish_status,
      published_version: l.published_version,
      completion_rule: l.completion_rule || 'MANUAL',
      questions_count: qCounts[l.id] || 0,
      assignments_count: aCounts[l.id] || 0,
      resources_count: rCounts[l.id] || 0,
      wiki_count: wCounts[l.id] || 0,
    });
  }

  const chaptersByTopic = {};
  for (const ch of chapters) {
    const chLessons = lessonsByCh[ch.id] || [];
    const chNode = {
      id: ch.id,
      topic_id: ch.topic_id,
      code: ch.code,
      title: ch.title,
      description: ch.description || '',
      status: ch.status,
      sort_order: ch.sort_order,
      lessons: chLessons,
      questions_count: chLessons.reduce((s, l) => s + l.questions_count, 0),
      assignments_count: chLessons.reduce((s, l) => s + l.assignments_count, 0),
      resources_count: chLessons.reduce((s, l) => s + l.resources_count, 0),
    };
    const tid = ch.topic_id || (topics[0]?.id || 'unassigned');
    (chaptersByTopic[tid] ||= []).push(chNode);
  }

  return topics.map((t) => {
    const tChaps = chaptersByTopic[t.id] || [];
    return {
      id: t.id,
      course_id: t.course_id,
      code: t.code,
      title: t.title,
      description: t.description || '',
      sort_order: t.sort_order,
      status: t.status,
      chapters: tChaps,
      questions_count: tChaps.reduce((s, c) => s + c.questions_count, 0),
      assignments_count: tChaps.reduce((s, c) => s + c.assignments_count, 0),
      resources_count: tChaps.reduce((s, c) => s + c.resources_count, 0),
    };
  });
}

function syncBankTreePaths(db, courseId) {
  const rows = db
    .prepare(
      `SELECT l.id AS lesson_id, ch.id AS chapter_id, ch.topic_id
       FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
       WHERE ch.course_id = ?`
    )
    .all(courseId);
  const upQ = db.prepare('UPDATE question_bank_items SET topic_id = ?, chapter_id = ? WHERE lesson_id = ?');
  const upA = db.prepare('UPDATE assignment_bank_items SET topic_id = ?, chapter_id = ? WHERE lesson_id = ?');
  const upR = db.prepare('UPDATE learning_resources SET topic_id = ?, chapter_id = ? WHERE lesson_id = ?');
  const upW = db.prepare('UPDATE course_wiki_pages SET topic_id = ?, chapter_id = ? WHERE lesson_id = ?');
  for (const r of rows) {
    upQ.run(r.topic_id || null, r.chapter_id, r.lesson_id);
    upA.run(r.topic_id || null, r.chapter_id, r.lesson_id);
    upR.run(r.topic_id || null, r.chapter_id, r.lesson_id);
    upW.run(r.topic_id || null, r.chapter_id, r.lesson_id);
  }
}

export function registerContentTreeAndSnapshotRoutes(route) {
  // =========================================================================
  // 1. CÂY NỘI DUNG 4 CẤP (MÔN HỌC -> CHỦ ĐỀ -> CHƯƠNG -> BÀI)
  // =========================================================================
  route('GET', '/courses/:id/tree', ({ db, user, params }) => {
    const course = requireCourse(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem môn học này.');
    const topics = buildCourseTree(db, course.id);
    const totalQuestions = topics.reduce((s, t) => s + t.questions_count, 0);
    const totalAssignments = topics.reduce((s, t) => s + t.assignments_count, 0);
    const totalResources = topics.reduce((s, t) => s + t.resources_count, 0);
    return {
      course: { id: course.id, code: course.code, title: course.title, status: course.status },
      topics,
      summary: {
        topics_count: topics.length,
        chapters_count: topics.reduce((s, t) => s + t.chapters.length, 0),
        lessons_count: topics.reduce((s, t) => s + t.chapters.reduce((sc, c) => sc + c.lessons.length, 0), 0),
        questions_count: totalQuestions,
        assignments_count: totalAssignments,
        resources_count: totalResources,
      },
      capabilities: {
        can_manage: canManageCourse(db, user, course),
        can_edit_draft: canEditCourseDraft(db, user, course),
      },
    };
  });

  route('POST', '/courses/:id/topics', ({ db, user, body, params }) => {
    const course = requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa cây nội dung môn học.');
    const title = text(body, 'title', { required: true, min: 2, max: 200, label: 'tên chủ đề' });
    const description = text(body, 'description', { max: 2000, label: 'mô tả chủ đề' }) || '';
    const status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED'], { fallback: 'PUBLISHED', label: 'trạng thái' });
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m, COUNT(*) n FROM course_topics WHERE course_id = ?').get(course.id);
    const code = text(body, 'code', { max: 40, label: 'mã chủ đề' }) || `CĐ-${String(max.n + 1).padStart(2, '0')}`;
    const id = `top_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO course_topics (id, course_id, code, title, description, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, course.id, code, title, description, max.m + 10, status, now, now);
    db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    return [201, { id, course_id: course.id, code, title, description, sort_order: max.m + 10, status, chapters: [] }];
  });

  route('PATCH', '/topics/:id', ({ db, user, body, params }) => {
    const topic = db.prepare('SELECT * FROM course_topics WHERE id = ?').get(params.id);
    if (!topic) fail(404, 'TOPIC_NOT_FOUND', 'Không tìm thấy chủ đề.');
    const course = requireCourse(db, topic.course_id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền chỉnh sửa chủ đề này.');
    const f = {};
    if ('title' in body) f.title = text(body, 'title', { required: true, min: 2, max: 200, label: 'tên chủ đề' });
    if ('code' in body) f.code = text(body, 'code', { required: true, max: 40, label: 'mã chủ đề' });
    if ('description' in body) f.description = text(body, 'description', { max: 2000, label: 'mô tả' }) || '';
    if ('status' in body) f.status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'ARCHIVED'], { required: true, label: 'trạng thái' });
    const keys = Object.keys(f);
    if (keys.length) {
      const now = nowIso();
      db.prepare(`UPDATE course_topics SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => f[k]), now, topic.id);
      db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    }
    return db.prepare('SELECT * FROM course_topics WHERE id = ?').get(topic.id);
  });

  route('DELETE', '/topics/:id', ({ db, user, params }) => {
    const topic = db.prepare('SELECT * FROM course_topics WHERE id = ?').get(params.id);
    if (!topic) fail(404, 'TOPIC_NOT_FOUND', 'Không tìm thấy chủ đề.');
    const course = requireCourse(db, topic.course_id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền xóa chủ đề này.');
    const chaps = db.prepare("SELECT id FROM chapters WHERE topic_id = ? AND status <> 'ARCHIVED'").all(topic.id);
    if (chaps.length > 0) {
      fail(409, 'CONTENT_IN_USE', `Chủ đề vẫn còn ${chaps.length} chương. Hãy di chuyển các chương sang chủ đề khác hoặc lưu trữ thay vì xóa.`);
    }
    db.prepare('DELETE FROM course_topics WHERE id = ?').run(topic.id);
    return { deleted_id: topic.id };
  });

  // Sắp xếp lại toàn cây 4 tầng (di chuyển Chương sang Chủ đề khác, Bài sang Chương khác) + tự cập nhật phân loại 3 Ngân hàng
  route('PUT', '/courses/:id/tree-reorder', ({ db, user, body, params }) => {
    const course = requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền sắp xếp cây nội dung.');
    if (!Array.isArray(body.topics)) fail(422, 'VALIDATION_ERROR', 'Dữ liệu cây nội dung không hợp lệ.');

    const ownTopics = new Set(db.prepare("SELECT id FROM course_topics WHERE course_id = ? AND status <> 'ARCHIVED'").all(course.id).map((r) => r.id));
    const ownChaps = new Set(db.prepare("SELECT id FROM chapters WHERE course_id = ? AND status <> 'ARCHIVED'").all(course.id).map((r) => r.id));
    const ownLessons = new Set(
      db.prepare("SELECT l.id FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ch.course_id = ? AND l.publish_status <> 'ARCHIVED'").all(course.id).map((r) => r.id)
    );

    const seenT = new Set(); const seenC = new Set(); const seenL = new Set();
    for (const t of body.topics) {
      if (!ownTopics.has(t.id) || seenT.has(t.id)) fail(422, 'VALIDATION_ERROR', 'Danh sách chủ đề không khớp với môn học.');
      seenT.add(t.id);
      for (const ch of t.chapters || []) {
        if (!ownChaps.has(ch.id) || seenC.has(ch.id)) fail(422, 'VALIDATION_ERROR', 'Danh sách chương không khớp với môn học.');
        seenC.add(ch.id);
        for (const lid of ch.lesson_ids || []) {
          if (!ownLessons.has(lid) || seenL.has(lid)) fail(422, 'VALIDATION_ERROR', 'Danh sách bài học không khớp với môn học.');
          seenL.add(lid);
        }
      }
    }
    if (seenT.size !== ownTopics.size || seenC.size !== ownChaps.size || seenL.size !== ownLessons.size) {
      fail(422, 'VALIDATION_ERROR', 'Cần gửi đầy đủ tất cả chủ đề, chương và bài học hiện hoạt của môn học.');
    }

    const now = nowIso();
    tx(db, () => {
      body.topics.forEach((t, ti) => {
        db.prepare('UPDATE course_topics SET sort_order = ?, updated_at = ? WHERE id = ?').run((ti + 1) * 10, now, t.id);
        (t.chapters || []).forEach((ch, ci) => {
          db.prepare('UPDATE chapters SET topic_id = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(t.id, (ci + 1) * 10, now, ch.id);
          (ch.lesson_ids || []).forEach((lid, li) => {
            db.prepare('UPDATE lessons SET chapter_id = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(ch.id, (li + 1) * 10, now, lid);
          });
        });
      });
      syncBankTreePaths(db, course.id);
      db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    });
    return { topics: buildCourseTree(db, course.id) };
  });

  route('GET', '/courses/:id/tree-impact', ({ db, user, params, url }) => {
    const course = requireCourse(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem thông tin tác động.');
    const nodeType = url.searchParams.get('node_type') || 'COURSE';
    const nodeId = url.searchParams.get('node_id') || course.id;
    const activeClasses = db
      .prepare("SELECT id, code, title, course_version_id, course_version_number FROM subject_classes WHERE course_id = ? AND status NOT IN ('ARCHIVED','CANCELLED')")
      .all(course.id);

    let whereLesson = 'ch.course_id = ?';
    const qParams = [course.id];
    if (nodeType === 'TOPIC') { whereLesson = 'ch.topic_id = ?'; qParams[0] = nodeId; }
    else if (nodeType === 'CHAPTER') { whereLesson = 'ch.id = ?'; qParams[0] = nodeId; }
    else if (nodeType === 'LESSON') { whereLesson = 'l.id = ?'; qParams[0] = nodeId; }

    const lessonIds = db
      .prepare(`SELECT l.id, l.publish_status FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id WHERE ${whereLesson}`)
      .all(...qParams);
    const lIn = lessonIds.length ? lessonIds.map(() => '?').join(',') : "''";
    const ids = lessonIds.map((l) => l.id);

    const questionsCount = ids.length ? db.prepare(`SELECT COUNT(*) n FROM question_bank_items WHERE lesson_id IN (${lIn}) AND deleted_at IS NULL`).get(...ids).n : 0;
    const assignmentsCount = ids.length ? db.prepare(`SELECT COUNT(*) n FROM assignment_bank_items WHERE lesson_id IN (${lIn}) AND deleted_at IS NULL`).get(...ids).n : 0;
    const resourcesCount = ids.length ? db.prepare(`SELECT COUNT(*) n FROM learning_resources WHERE lesson_id IN (${lIn}) AND deleted_at IS NULL`).get(...ids).n : 0;
    const progressCount = ids.length ? db.prepare(`SELECT COUNT(*) n FROM lesson_progress WHERE lesson_id IN (${lIn})`).get(...ids).n : 0;

    return {
      node_type: nodeType,
      node_id: nodeId,
      lessons_count: lessonIds.length,
      published_lessons_count: lessonIds.filter((l) => l.publish_status === 'PUBLISHED').length,
      active_classes_count: activeClasses.length,
      pinned_classes_count: activeClasses.filter((c) => Boolean(c.course_version_id)).length,
      questions_count: questionsCount,
      assignments_count: assignmentsCount,
      resources_count: resourcesCount,
      learner_progress_records: progressCount,
      can_hard_delete: progressCount === 0 && lessonIds.every((l) => l.publish_status !== 'PUBLISHED'),
    };
  });

  // =========================================================================
  // 2. PHIÊN BẢN MÔN HỌC BẤT BIẾN (SNAPSHOT v1 / v2) & NÂNG CẤP CÓ KIỂM SOÁT
  // =========================================================================
  route('GET', '/courses/:id/versions', ({ db, user, params }) => {
    const course = requireCourse(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem phiên bản môn học.');
    const versions = db
      .prepare('SELECT * FROM course_versions WHERE course_id = ? ORDER BY version_number DESC')
      .all(course.id);
    const classes = db
      .prepare("SELECT id, code, title, course_version_id, course_version_number, status FROM subject_classes WHERE course_id = ? AND status NOT IN ('ARCHIVED','CANCELLED') ORDER BY code")
      .all(course.id);
    const latestPublishedAt = versions[0]?.published_at || '';
    const hasDraftChangesSinceLatest = Boolean(!latestPublishedAt || (course.updated_at && course.updated_at > latestPublishedAt));

    return {
      course_id: course.id,
      has_unpublished_snapshot_changes: hasDraftChangesSinceLatest,
      items: versions.map((v) => {
        const snap = safeJson(v.snapshot_json, {});
        const classesUsing = classes.filter((c) => c.course_version_id === v.id);
        return {
          id: v.id,
          version_number: v.version_number,
          version_label: v.version_label,
          status: v.status,
          changelog_note: v.changelog_note || '',
          published_by: v.published_by,
          published_by_name: v.published_by_name || '',
          published_at: v.published_at,
          topics_count: Array.isArray(snap.topics) ? snap.topics.length : 0,
          chapters_count: Array.isArray(snap.chapters) ? snap.chapters.length : 0,
          lessons_count: Array.isArray(snap.lessons) ? snap.lessons.length : 0,
          classes_using: classesUsing,
        };
      }),
      classes_summary: classes,
    };
  });

  route('POST', '/courses/:id/versions', ({ db, user, body, params }) => {
    const course = requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'PUBLISH_FORBIDDEN', 'Chỉ giảng viên phụ trách hoặc quản trị viên mới được phát hành phiên bản môn học.');
    const snap = buildCourseSnapshotPayload(db, course.id);
    if (!snap || snap.lessons.length === 0) {
      fail(422, 'NO_PUBLISHED_LESSONS', 'Cần ít nhất 1 chương và 1 bài học đã xuất bản trước khi phát hành phiên bản môn học (Snapshot).');
    }
    const maxVer = db.prepare('SELECT COALESCE(MAX(version_number), 0) m FROM course_versions WHERE course_id = ?').get(course.id).m;
    const nextNum = maxVer + 1;
    const label = text(body || {}, 'version_label', { max: 64, label: 'nhãn phiên bản' }) || `v${nextNum}.0`;
    const changelog = text(body || {}, 'changelog_note', { max: 1000, label: 'ghi chú phát hành' }) || `Phát hành phiên bản ${label}`;
    const verId = `cv_${crypto.randomBytes(6).toString('hex')}`;
    const now = nowIso();

    db.prepare(
      `INSERT INTO course_versions (id, course_id, version_number, version_label, status, snapshot_json, changelog_note, published_by, published_by_name, published_at)
       VALUES (?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?)`
    ).run(verId, course.id, nextNum, label, JSON.stringify(snap), changelog, user.id, user.full_name, now);

    return [201, {
      id: verId,
      course_id: course.id,
      version_number: nextNum,
      version_label: label,
      changelog_note: changelog,
      published_by_name: user.full_name,
      published_at: now,
      lessons_count: snap.lessons.length,
      chapters_count: snap.chapters.length,
      topics_count: snap.topics.length,
    }];
  });

  route('GET', '/courses/:id/versions/:versionId', ({ db, user, params }) => {
    const course = requireCourse(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem phiên bản môn học.');
    const ver = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(params.versionId, course.id);
    if (!ver) fail(404, 'VERSION_NOT_FOUND', 'Không tìm thấy phiên bản môn học.');
    return {
      id: ver.id,
      course_id: ver.course_id,
      version_number: ver.version_number,
      version_label: ver.version_label,
      status: ver.status,
      changelog_note: ver.changelog_note || '',
      published_by_name: ver.published_by_name || '',
      published_at: ver.published_at,
      snapshot: safeJson(ver.snapshot_json, {}),
    };
  });

  // Tạo bản nháp làm việc tiếp từ một snapshot (giữ nguyên các lớp đang chạy snapshot v1)
  route('POST', '/courses/:id/versions/:versionId/clone-to-draft', ({ db, user, params }) => {
    const course = requireCourse(db, params.id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền khôi phục phiên bản về bản nháp.');
    const ver = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(params.versionId, course.id);
    if (!ver) fail(404, 'VERSION_NOT_FOUND', 'Không tìm thấy phiên bản.');
    const snap = safeJson(ver.snapshot_json, {});
    const now = nowIso();

    tx(db, () => {
      for (const l of snap.lessons || []) {
        const blocks = snap.blocks_by_lesson?.[l.id] || [];
        const existingLesson = db.prepare('SELECT id, working_draft_revision FROM lessons WHERE id = ?').get(l.id);
        if (!existingLesson) continue;
        db.prepare('DELETE FROM lesson_blocks WHERE lesson_id = ?').run(l.id);
        blocks.forEach((b, idx) => {
          db.prepare(
            `INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
             VALUES (?, ?, '1.2', ?, ?, 'ACTIVE', ?)`
          ).run(`blk_${crypto.randomBytes(6).toString('hex')}`, l.id, b.block_type, b.sort_order ?? (idx + 1) * 10, JSON.stringify(b.content || {}));
        });
        db.prepare('UPDATE lessons SET working_draft_revision = working_draft_revision + 1, updated_at = ? WHERE id = ?').run(now, l.id);
      }
      db.prepare('UPDATE courses SET updated_at = ? WHERE id = ?').run(now, course.id);
    });
    return { cloned_from_version_id: ver.id, version_label: ver.version_label, restored_lessons: (snap.lessons || []).length };
  });

  // Nâng cấp lớp môn học đang chạy lên phiên bản mới có xác nhận & lưu nhật ký
  route('POST', '/classes/:id/upgrade-version', ({ db, user, body, params }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_manage_class');
    if (!cls.course_id) fail(422, 'CLASS_NO_COURSE', 'Lớp môn học chưa liên kết môn học nào.');
    if (body.confirmed !== true) {
      fail(422, 'CONFIRMATION_REQUIRED', 'Vui lòng xác nhận nâng cấp phiên bản môn học cho lớp (có ảnh hưởng tới lộ trình bài học mới của học viên).');
    }
    const targetVerId = text(body, 'target_version_id', { required: true, max: 64, label: 'phiên bản đích' });
    const ver = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(targetVerId, cls.course_id);
    if (!ver) fail(404, 'VERSION_NOT_FOUND', 'Phiên bản môn học đích không tồn tại hoặc không thuộc môn học của lớp.');
    if (cls.course_version_id === ver.id) {
      fail(409, 'ALREADY_ON_VERSION', 'Lớp môn học đang sử dụng phiên bản này.');
    }
    const reason = text(body, 'upgrade_reason', { required: true, min: 3, max: 500, label: 'lý do nâng cấp phiên bản' });
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `INSERT INTO class_version_upgrade_logs (id, subject_class_id, from_version_id, to_version_id, upgrade_reason, upgraded_by, upgraded_by_name, upgraded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), cls.id, cls.course_version_id || null, ver.id, reason, user.id, user.full_name, now);
      db.prepare('UPDATE subject_classes SET course_version_id = ?, course_version_number = ?, updated_at = ? WHERE id = ?')
        .run(ver.id, ver.version_number, now, cls.id);
    });

    return {
      class_id: cls.id,
      previous_version_id: cls.course_version_id || null,
      course_version_id: ver.id,
      course_version_number: ver.version_number,
      version_label: ver.version_label,
      upgraded_at: now,
    };
  });

  // =========================================================================
  // 3. WIKI MÔN HỌC (SUBJECT WIKI)
  // =========================================================================
  route('GET', '/courses/:id/wiki', ({ db, user, params, url }) => {
    const course = requireCourse(db, params.id);
    if (!canViewCourse(db, user, course)) fail(403, 'COURSE_ACCESS_DENIED', 'Bạn không có quyền xem Wiki của môn học này.');
    const q = (url.searchParams.get('q') || '').trim();
    const lessonId = url.searchParams.get('lesson_id');
    const where = ['w.course_id = ?', 'w.deleted_at IS NULL'];
    const qParams = [course.id];
    if (q) { where.push('(w.title LIKE ? OR w.summary LIKE ? OR w.content_markdown LIKE ?)'); qParams.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (lessonId) { where.push('w.lesson_id = ?'); qParams.push(lessonId); }

    const rows = db
      .prepare(
        `SELECT w.*, t.title AS topic_title, ch.title AS chapter_title, l.title AS lesson_title
         FROM course_wiki_pages w
         LEFT JOIN course_topics t ON t.id = w.topic_id
         LEFT JOIN chapters ch ON ch.id = w.chapter_id
         LEFT JOIN lessons l ON l.id = w.lesson_id
         WHERE ${where.join(' AND ')}
         ORDER BY w.updated_at DESC`
      )
      .all(...qParams);
    return {
      items: rows.map((r) => ({
        ...r,
        tags: safeJson(r.tags_json, []),
        related_page_ids: safeJson(r.related_page_ids_json, []),
      })),
      can_edit: canEditCourseDraft(db, user, course),
    };
  });

  route('POST', '/courses/:id/wiki', ({ db, user, body, params }) => {
    const course = requireCourse(db, params.id);
    if (!canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền tạo trang Wiki cho môn học này.');
    const title = text(body, 'title', { required: true, min: 2, max: 200, label: 'tiêu đề trang Wiki' });
    const summary = text(body, 'summary', { max: 1000, label: 'tóm tắt' }) || '';
    const contentMarkdown = text(body, 'content_markdown', { required: true, max: 30000, label: 'nội dung Wiki' });
    const status = oneOf(body, 'status', ['DRAFT', 'PUBLISHED'], { fallback: 'PUBLISHED', label: 'trạng thái' });
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [];
    const relatedIds = Array.isArray(body.related_page_ids) ? body.related_page_ids.slice(0, 10) : [];

    let lessonId = body.lesson_id || null;
    let chapterId = body.chapter_id || null;
    let topicId = body.topic_id || null;
    if (lessonId) {
      const l = db.prepare('SELECT id, chapter_id FROM lessons WHERE id = ?').get(lessonId);
      if (!l) fail(422, 'VALIDATION_ERROR', 'Bài học đính kèm không tồn tại.');
      const ch = db.prepare('SELECT id, topic_id, course_id FROM chapters WHERE id = ?').get(l.chapter_id);
      if (!ch || ch.course_id !== course.id) fail(422, 'VALIDATION_ERROR', 'Bài học không thuộc môn học này.');
      chapterId = ch.id;
      topicId = ch.topic_id;
    } else if (chapterId) {
      const ch = db.prepare('SELECT id, topic_id, course_id FROM chapters WHERE id = ?').get(chapterId);
      if (!ch || ch.course_id !== course.id) fail(422, 'VALIDATION_ERROR', 'Chương không thuộc môn học này.');
      topicId = ch.topic_id;
    }

    let slug = slugify(body.slug || title);
    if (db.prepare('SELECT 1 FROM course_wiki_pages WHERE course_id = ? AND slug = ?').get(course.id, slug)) {
      slug = `${slug.slice(0, 120)}-${crypto.randomBytes(2).toString('hex')}`;
    }
    const pageId = `wiki_${crypto.randomBytes(5).toString('hex')}`;
    const now = nowIso();
    tx(db, () => {
      db.prepare(
        `INSERT INTO course_wiki_pages (
           id, course_id, topic_id, chapter_id, lesson_id, slug, title, summary, content_markdown,
           tags_json, related_page_ids_json, status, created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(pageId, course.id, topicId, chapterId, lessonId, slug, title, summary, contentMarkdown, JSON.stringify(tags), JSON.stringify(relatedIds), status, user.id, user.id, now, now);
      db.prepare(
        `INSERT INTO course_wiki_revisions (id, page_id, revision_number, title, content_markdown, change_note, edited_by, edited_by_name, created_at)
         VALUES (?, ?, 1, ?, ?, 'Khởi tạo trang Wiki', ?, ?, ?)`
      ).run(crypto.randomUUID(), pageId, title, contentMarkdown, user.id, user.full_name, now);
    });
    return [201, db.prepare('SELECT * FROM course_wiki_pages WHERE id = ?').get(pageId)];
  });

  route('GET', '/wiki/:pageId', ({ db, user, params }) => {
    const page = db.prepare('SELECT * FROM course_wiki_pages WHERE id = ? AND deleted_at IS NULL').get(params.pageId);
    if (!page) fail(404, 'WIKI_NOT_FOUND', 'Không tìm thấy trang Wiki.');
    const course = requireCourse(db, page.course_id);
    const isStaffViewer = canViewCourse(db, user, course);
    if (!isStaffViewer) {
      const enrolled = db
        .prepare(
          `SELECT 1 FROM class_enrollments e JOIN subject_classes sc ON sc.id = e.subject_class_id
           WHERE e.student_id = ? AND e.status = 'ACTIVE' AND sc.course_id = ? AND sc.status NOT IN ('DRAFT','ARCHIVED','CANCELLED')`
        )
        .get(user.id, course.id);
      if (!enrolled || page.status !== 'PUBLISHED') fail(403, 'WIKI_ACCESS_DENIED', 'Bạn không có quyền xem trang Wiki này.');
    }
    const revisions = db
      .prepare('SELECT * FROM course_wiki_revisions WHERE page_id = ? ORDER BY revision_number DESC LIMIT 30')
      .all(page.id);
    const relIds = safeJson(page.related_page_ids_json, []);
    const related = relIds.length
      ? db.prepare(`SELECT id, title, slug, summary FROM course_wiki_pages WHERE id IN (${relIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...relIds)
      : [];
    return {
      ...page,
      tags: safeJson(page.tags_json, []),
      related_page_ids: relIds,
      related_pages: related,
      revisions,
      can_edit: canEditCourseDraft(db, user, course),
    };
  });

  route('PATCH', '/wiki/:pageId', ({ db, user, body, params }) => {
    const page = db.prepare('SELECT * FROM course_wiki_pages WHERE id = ? AND deleted_at IS NULL').get(params.pageId);
    if (!page) fail(404, 'WIKI_NOT_FOUND', 'Không tìm thấy trang Wiki.');
    const course = requireCourse(db, page.course_id);
    if (!canEditCourseDraft(db, user, course)) fail(403, 'CONTENT_EDIT_FORBIDDEN', 'Bạn không có quyền chỉnh sửa Wiki.');

    const title = 'title' in body ? text(body, 'title', { required: true, min: 2, max: 200, label: 'tiêu đề' }) : page.title;
    const summary = 'summary' in body ? (text(body, 'summary', { max: 1000, label: 'tóm tắt' }) || '') : page.summary;
    const contentMarkdown = 'content_markdown' in body ? text(body, 'content_markdown', { required: true, max: 30000, label: 'nội dung' }) : page.content_markdown;
    const status = 'status' in body ? oneOf(body, 'status', ['DRAFT', 'PUBLISHED', 'ARCHIVED'], { required: true, label: 'trạng thái' }) : page.status;
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : safeJson(page.tags_json, []);
    const relIds = Array.isArray(body.related_page_ids) ? body.related_page_ids.slice(0, 10) : safeJson(page.related_page_ids_json, []);
    const changeNote = text(body, 'change_note', { max: 300, label: 'ghi chú sửa' }) || 'Cập nhật nội dung Wiki';
    const maxRev = db.prepare('SELECT COALESCE(MAX(revision_number), 0) m FROM course_wiki_revisions WHERE page_id = ?').get(page.id).m;
    const now = nowIso();

    tx(db, () => {
      db.prepare(
        `UPDATE course_wiki_pages SET title = ?, summary = ?, content_markdown = ?, tags_json = ?, related_page_ids_json = ?,
           status = ?, updated_by = ?, updated_at = ? WHERE id = ?`
      ).run(title, summary, contentMarkdown, JSON.stringify(tags), JSON.stringify(relIds), status, user.id, now, page.id);
      db.prepare(
        `INSERT INTO course_wiki_revisions (id, page_id, revision_number, title, content_markdown, change_note, edited_by, edited_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), page.id, maxRev + 1, title, contentMarkdown, changeNote, user.id, user.full_name, now);
    });
    return db.prepare('SELECT * FROM course_wiki_pages WHERE id = ?').get(page.id);
  });

  route('DELETE', '/wiki/:pageId', ({ db, user, params }) => {
    const page = db.prepare('SELECT * FROM course_wiki_pages WHERE id = ? AND deleted_at IS NULL').get(params.pageId);
    if (!page) fail(404, 'WIKI_NOT_FOUND', 'Không tìm thấy trang Wiki.');
    const course = requireCourse(db, page.course_id);
    if (!canManageCourse(db, user, course)) fail(403, 'COURSE_MANAGE_FORBIDDEN', 'Bạn không có quyền xóa trang Wiki.');
    db.prepare('UPDATE course_wiki_pages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), page.id);
    return { deleted_id: page.id };
  });

  // Học viên xem Wiki trong Lớp môn học của mình
  route('GET', '/learn/classes/:id/wiki', ({ db, user, params, url }) => {
    const cls = getClass(db, params.id);
    if (!cls) fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học.');
    const enrolled = db.prepare(`SELECT 1 FROM class_enrollments WHERE subject_class_id = ? AND student_id = ? AND status = 'ACTIVE'`).get(cls.id, user.id);
    if (!enrolled) fail(403, 'NOT_ENROLLED', 'Bạn chưa được ghi danh vào lớp học này.');
    if (!cls.course_id) return { items: [] };
    const q = (url.searchParams.get('q') || '').trim();
    const lessonId = url.searchParams.get('lesson_id');
    const where = ['w.course_id = ?', 'w.deleted_at IS NULL', "w.status = 'PUBLISHED'"];
    const qParams = [cls.course_id];
    if (q) { where.push('(w.title LIKE ? OR w.summary LIKE ? OR w.content_markdown LIKE ?)'); qParams.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (lessonId) { where.push('w.lesson_id = ?'); qParams.push(lessonId); }
    const rows = db
      .prepare(
        `SELECT w.*, t.title AS topic_title, ch.title AS chapter_title, l.title AS lesson_title
         FROM course_wiki_pages w
         LEFT JOIN course_topics t ON t.id = w.topic_id
         LEFT JOIN chapters ch ON ch.id = w.chapter_id
         LEFT JOIN lessons l ON l.id = w.lesson_id
         WHERE ${where.join(' AND ')} ORDER BY w.title ASC`
      )
      .all(...qParams);
    return {
      items: rows.map((r) => ({ ...r, tags: safeJson(r.tags_json, []), related_page_ids: safeJson(r.related_page_ids_json, []) })),
    };
  });
}
