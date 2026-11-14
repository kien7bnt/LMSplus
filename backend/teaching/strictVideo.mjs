/**
 * LMSPLUS STRICT Video Progress Engine (Interval Union + Anti-Tamper + Idempotent Offline Sync).
 *
 * Bảo đảm quy tắc STRICT:
 *  - Chỉ công nhận khoảng thời gian [start, end] thực sự đã xem qua Interval Union (không cộng dồn tua đi tua lại).
 *  - Chặn tua vượt vùng chưa xem & từ chối request giả mạo (422 STRICT_VIDEO_TAMPER_REJECTED).
 *  - Không ghi nhận thời lượng khi tab bị ẩn (is_visible === false).
 *  - Tua lùi xem lại không bao giờ làm giảm % đã xem.
 *  - Cô lập tiến độ theo content_version_key để nâng cấp Snapshot môn học không xóa lịch sử cũ.
 */

import crypto from 'node:crypto';
import { fail, nowIso, text, tx } from './http.mjs';
import { safeJson } from './scope.mjs';
import { requireClassAccess } from './classes.mjs';
import { getClassContentVersionKey } from './masterSchema.mjs';

const GAP_MERGE_SEC = 0.5;
const FRONTIER_TOLERANCE_SEC = 5;

export function normalizeInterval(raw, durationSec = 0) {
  const sRaw = Array.isArray(raw) ? raw[0] : (raw?.start_sec ?? raw?.start ?? 0);
  const eRaw = Array.isArray(raw) ? raw[1] : (raw?.end_sec ?? raw?.end ?? 0);
  const s = Number(sRaw);
  const e = Number(eRaw);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) return null;
  const maxDur = durationSec > 0 ? durationSec : 86400 * 10;
  const cs = Math.round(Math.max(0, Math.min(s, maxDur)) * 10) / 10;
  const ce = Math.round(Math.max(cs, Math.min(e, maxDur)) * 10) / 10;
  if (ce <= cs) return null;
  return [cs, ce];
}

/**
 * Hợp nhất các đoạn video đã xem (Interval Union) và tính tổng thời lượng thực xem không trùng lặp.
 */
export function mergeWatchedIntervals(intervals, durationSec = 0) {
  const clean = [];
  for (const item of intervals || []) {
    const n = normalizeInterval(item, durationSec);
    if (n) clean.push(n);
  }
  clean.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];
  for (const [s, e] of clean) {
    if (merged.length === 0) {
      merged.push([s, e]);
      continue;
    }
    const last = merged[merged.length - 1];
    if (s <= last[1] + GAP_MERGE_SEC) {
      last[1] = Math.round(Math.max(last[1], e) * 10) / 10;
    } else {
      merged.push([s, e]);
    }
  }

  let uniqueWatchedSec = 0;
  let maxEndSec = 0;
  for (const [s, e] of merged) {
    uniqueWatchedSec += e - s;
    if (e > maxEndSec) maxEndSec = e;
  }
  uniqueWatchedSec = Math.round(uniqueWatchedSec * 10) / 10;
  maxEndSec = Math.round(maxEndSec * 10) / 10;

  let maxContiguousWatchedSec = 0;
  if (merged.length > 0 && merged[0][0] <= 2) {
    maxContiguousWatchedSec = merged[0][1];
  }

  return {
    intervals: merged,
    uniqueWatchedSec,
    maxContiguousWatchedSec,
    maxEndSec,
  };
}

function logVideoEvent(db, payload) {
  const key = payload.idempotency_key || `vwe_${crypto.randomUUID()}`;
  db.prepare(
    `INSERT OR IGNORE INTO video_watch_events (
       id, idempotency_key, student_id, subject_class_id, lesson_id, block_id,
       content_version_key, event_type, segment_start_sec, segment_end_sec,
       playback_rate, is_visible, device_session_id, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    key,
    payload.student_id,
    payload.subject_class_id,
    payload.lesson_id,
    payload.block_id,
    payload.content_version_key,
    payload.event_type,
    payload.segment_start_sec ?? null,
    payload.segment_end_sec ?? null,
    payload.playback_rate ?? 1,
    payload.is_visible === false ? 0 : 1,
    payload.device_session_id || null,
    payload.recorded_at || nowIso()
  );
}

export function recordStrictVideoProgress(db, { user, cls, lesson, vBlock, body }) {
  const blockId = vBlock.id;
  const contentVersionKey = getClassContentVersionKey(cls);
  const existing = db
    .prepare(
      `SELECT * FROM video_watch_progress
       WHERE student_id = ? AND subject_class_id = ? AND lesson_id = ? AND block_id = ? AND content_version_key = ?`
    )
    .get(user.id, cls.id, lesson.id, blockId, contentVersionKey);

  const rejectTamper = (reason) => {
    logVideoEvent(db, {
      idempotency_key: `tamper:${user.id}:${cls.id}:${lesson.id}:${blockId}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
      student_id: user.id,
      subject_class_id: cls.id,
      lesson_id: lesson.id,
      block_id: blockId,
      content_version_key: contentVersionKey,
      event_type: 'TAMPER_REJECTED',
      segment_start_sec: Number(body.last_position_sec ?? 0) || 0,
      playback_rate: Number(body.playback_rate ?? 1) || 1,
      device_session_id: typeof body.device_session_id === 'string' ? body.device_session_id : null,
    });
    fail(422, 'STRICT_VIDEO_TAMPER_REJECTED', reason);
  };

  if (body.force_complete === true || body.is_completed === true) {
    rejectTamper('Không chấp nhận đánh dấu hoàn thành video trực tiếp từ trình duyệt (chế độ STRICT).');
  }

  const playbackRate = body.playback_rate !== undefined ? Number(body.playback_rate) : 1;
  if (!Number.isFinite(playbackRate) || playbackRate < 0 || playbackRate > 2.0) {
    rejectTamper('Tốc độ phát video vượt quá giới hạn cho phép (tối đa 2.0x).');
  }

  const lastPosIn = Number(body.last_position_sec ?? 0);
  const watchedIn = body.watched_seconds !== undefined ? Number(body.watched_seconds) : null;
  const durIn = Number(body.duration_sec ?? vBlock.content?.duration_seconds ?? 0);
  if (
    !Number.isFinite(lastPosIn) || lastPosIn < 0 ||
    (watchedIn !== null && (!Number.isFinite(watchedIn) || watchedIn < 0)) ||
    !Number.isFinite(durIn) || durIn < 0
  ) {
    fail(422, 'INVALID_VIDEO_PROGRESS', 'Dữ liệu tiến độ video không hợp lệ.');
  }

  const durationSec = durIn > 0 ? Math.round(durIn * 10) / 10 : Number(existing?.duration_sec || 0);
  if (durationSec > 0 && lastPosIn > durationSec + 5) {
    rejectTamper('Vị trí phát video vượt quá tổng thời lượng video.');
  }

  const existingIntervals = safeJson(existing?.watched_intervals_json, []);
  const existingState = mergeWatchedIntervals(existingIntervals, durationSec);
  const baseFrontier = Math.max(
    Number(existing?.max_watched_sec || 0),
    Number(existing?.max_contiguous_watched_sec || 0),
    existingState.maxEndSec
  );

  const rawSegments = Array.isArray(body.segments) ? [...body.segments] : [];
  const rawEvents = Array.isArray(body.events) ? body.events : [];
  const acceptedSegments = [];
  let runningFrontier = baseFrontier;

  // Thu thập từ mảng events idempotent (hỗ trợ đồng bộ offline hàng đợi)
  for (const ev of rawEvents) {
    if (!ev || typeof ev !== 'object') continue;
    const evKey = typeof ev.idempotency_key === 'string' && ev.idempotency_key.trim()
      ? `${user.id}:${cls.id}:${blockId}:${ev.idempotency_key.trim().slice(0, 80)}`
      : null;
    if (evKey) {
      const seen = db.prepare('SELECT 1 FROM video_watch_events WHERE idempotency_key = ?').get(evKey);
      if (seen) continue;
    }
    const rate = ev.playback_rate !== undefined ? Number(ev.playback_rate) : playbackRate;
    if (!Number.isFinite(rate) || rate < 0 || rate > 2.0) {
      rejectTamper('Phát hiện tốc độ phát bất thường trong hàng đợi đồng bộ.');
    }
    if (ev.is_visible === false) {
      logVideoEvent(db, {
        idempotency_key: evKey || undefined,
        student_id: user.id,
        subject_class_id: cls.id,
        lesson_id: lesson.id,
        block_id: blockId,
        content_version_key: contentVersionKey,
        event_type: 'TAB_HIDDEN_IGNORED',
        segment_start_sec: Number(ev.start_sec ?? ev.segment_start_sec ?? 0),
        segment_end_sec: Number(ev.end_sec ?? ev.segment_end_sec ?? 0),
        playback_rate: rate,
        is_visible: false,
        device_session_id: ev.device_session_id || body.device_session_id || null,
      });
      continue;
    }
    const s = Number(ev.start_sec ?? ev.segment_start_sec);
    const e = Number(ev.end_sec ?? ev.segment_end_sec);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      rawSegments.push({ start_sec: s, end_sec: e, is_visible: true, _event_key: evKey, _rate: rate });
    }
  }

  // Sắp xếp đoạn tăng dần theo start_sec để các đoạn nối tiếp nhau trong cùng 1 batch cộng frontier tuần tự
  rawSegments.sort((a, b) => Number(Array.isArray(a) ? a[0] : (a.start_sec ?? a.start ?? 0)) - Number(Array.isArray(b) ? b[0] : (b.start_sec ?? b.start ?? 0)));

  for (const seg of rawSegments) {
    if (seg && typeof seg === 'object' && !Array.isArray(seg) && seg.is_visible === false) continue;
    const norm = normalizeInterval(seg, durationSec);
    if (!norm) {
      const s = Array.isArray(seg) ? Number(seg[0]) : Number(seg?.start_sec ?? seg?.start);
      const e = Array.isArray(seg) ? Number(seg[1]) : Number(seg?.end_sec ?? seg?.end);
      if (Number.isFinite(s) && Number.isFinite(e) && (s < 0 || e < s || (durationSec > 0 && e > durationSec + 2))) {
        rejectTamper('Khoảng thời gian xem video không hợp lệ.');
      }
      continue;
    }
    const [s, e] = norm;
    if (s > runningFrontier + FRONTIER_TOLERANCE_SEC) {
      rejectTamper(`Không thể ghi nhận đoạn [${s}s - ${e}s] khi chưa xem đến mốc ${Math.round(runningFrontier)}s (chế độ STRICT).`);
    }
    acceptedSegments.push([s, e]);
    runningFrontier = Math.max(runningFrontier, e);

    logVideoEvent(db, {
      idempotency_key: seg?._event_key || undefined,
      student_id: user.id,
      subject_class_id: cls.id,
      lesson_id: lesson.id,
      block_id: blockId,
      content_version_key: contentVersionKey,
      event_type: 'SEGMENT',
      segment_start_sec: s,
      segment_end_sec: e,
      playback_rate: seg?._rate || playbackRate,
      is_visible: true,
      device_session_id: typeof body.device_session_id === 'string' ? body.device_session_id : null,
    });
  }

  // Tương thích payload cũ { last_position_sec, watched_seconds, duration_sec } khi không gửi mảng segments/events
  const hasExplicitIntervals = rawSegments.length > 0 || rawEvents.length > 0;
  if (!hasExplicitIntervals) {
    if (body.is_visible === false) {
      // Tab ẩn: chỉ lưu vị trí an toàn, không tăng thời lượng xem
    } else if (watchedIn !== null) {
      if (lastPosIn > baseFrontier + 20 && watchedIn < lastPosIn * 0.5) {
        rejectTamper('Phát hiện tua vượt vùng chưa xem (vị trí không khớp thời lượng thực xem).');
      }
      const boundedTarget = durationSec > 0 ? Math.min(durationSec, Math.max(watchedIn, Math.min(lastPosIn, baseFrontier + 60))) : watchedIn;
      if (boundedTarget > 0) {
        acceptedSegments.push([0, boundedTarget]);
        runningFrontier = Math.max(runningFrontier, boundedTarget);
      }
    }
  }

  const mergedState = mergeWatchedIntervals([...existingState.intervals, ...acceptedSegments], durationSec);
  const maxWatched = Math.max(baseFrontier, mergedState.maxEndSec, mergedState.uniqueWatchedSec);
  const totalUnique = mergedState.uniqueWatchedSec;
  const effectiveFrontier = Math.max(runningFrontier, maxWatched);

  if (rawSegments.length === 0 && rawEvents.length === 0 && lastPosIn > baseFrontier + 25 && (watchedIn === null || watchedIn < lastPosIn * 0.5)) {
    rejectTamper('Không được phép tua vượt vùng video chưa xem.');
  }
  if (lastPosIn > effectiveFrontier + FRONTIER_TOLERANCE_SEC) {
    rejectTamper('Không được phép đặt vị trí phát vượt vùng video đã xem (chế độ STRICT).');
  }
  const safeLastPos = Math.min(lastPosIn, effectiveFrontier + 2);

  let watchPct = Number(existing?.watch_pct || 0);
  if (durationSec > 0) {
    const strictPct = Math.min(100, Math.round((totalUnique / durationSec) * 100));
    watchPct = Math.max(watchPct, strictPct);
  }
  const configuredMinPct = Number(lesson.min_video_watch_pct || 0);
  const threshold = configuredMinPct > 0 ? configuredMinPct : 85;
  const isCompleted = watchPct >= threshold ? 1 : Number(existing?.is_completed || 0);
  const now = nowIso();

  tx(db, () => {
    db.prepare(
      `INSERT INTO video_watch_progress (
         id, student_id, subject_class_id, lesson_id, block_id, content_version_key,
         watched_intervals_json, unique_watched_sec, max_contiguous_watched_sec,
         last_position_sec, max_watched_sec, watched_seconds, duration_sec, watch_pct, is_completed, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, subject_class_id, lesson_id, block_id, content_version_key) DO UPDATE SET
         watched_intervals_json = excluded.watched_intervals_json,
         unique_watched_sec = excluded.unique_watched_sec,
         max_contiguous_watched_sec = excluded.max_contiguous_watched_sec,
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
      contentVersionKey,
      JSON.stringify(mergedState.intervals),
      totalUnique,
      mergedState.maxContiguousWatchedSec,
      Math.round(safeLastPos * 10) / 10,
      Math.round(maxWatched * 10) / 10,
      Math.round(totalUnique * 10) / 10,
      durationSec,
      watchPct,
      isCompleted,
      now
    );
  });

  return {
    block_id: blockId,
    content_version_key: contentVersionKey,
    last_position_sec: Math.round(safeLastPos * 10) / 10,
    max_watched_sec: Math.round(maxWatched * 10) / 10,
    max_contiguous_watched_sec: mergedState.maxContiguousWatchedSec,
    unique_watched_sec: totalUnique,
    watched_seconds: Math.round(totalUnique * 10) / 10,
    watched_intervals: mergedState.intervals,
    duration_sec: durationSec,
    watch_pct: watchPct,
    required_pct: threshold,
    is_completed: Boolean(isCompleted),
  };
}

export function registerStrictVideoRoutes(route) {
  route('GET', '/classes/:id/video-analytics', ({ db, user, params, url }) => {
    const { cls } = requireClassAccess(db, user, params.id, 'can_view_roster');
    const contentVersionKey = getClassContentVersionKey(cls);
    const lessonIdFilter = text({ lesson_id: url.searchParams.get('lesson_id') || '' }, 'lesson_id', { max: 64 }) || null;
    const blockIdFilter = text({ block_id: url.searchParams.get('block_id') || '' }, 'block_id', { max: 64 }) || null;
    const studentIdFilter = text({ student_id: url.searchParams.get('student_id') || '' }, 'student_id', { max: 64 }) || null;

    const where = ['vp.subject_class_id = ?', 'vp.content_version_key = ?'];
    const qParams = [cls.id, contentVersionKey];
    if (lessonIdFilter) { where.push('vp.lesson_id = ?'); qParams.push(lessonIdFilter); }
    if (blockIdFilter) { where.push('vp.block_id = ?'); qParams.push(blockIdFilter); }
    if (studentIdFilter) { where.push('vp.student_id = ?'); qParams.push(studentIdFilter); }

    const rows = db
      .prepare(
        `SELECT vp.*, u.code AS student_code, u.full_name AS student_name, l.title AS lesson_title,
                l.min_video_watch_pct
         FROM video_watch_progress vp
         JOIN users u ON u.id = vp.student_id
         JOIN lessons l ON l.id = vp.lesson_id
         WHERE ${where.join(' AND ')}
         ORDER BY vp.updated_at DESC`
      )
      .all(...qParams);

    const tamperRows = db
      .prepare(
        `SELECT student_id, lesson_id, block_id, COUNT(*) AS n
         FROM video_watch_events
         WHERE subject_class_id = ? AND event_type = 'TAMPER_REJECTED'
         GROUP BY student_id, lesson_id, block_id`
      )
      .all(cls.id);
    const tamperMap = Object.fromEntries(tamperRows.map((t) => [`${t.student_id}|${t.lesson_id}|${t.block_id}`, t.n]));

    const items = rows.map((r) => ({
      id: r.id,
      student_id: r.student_id,
      student_code: r.student_code,
      student_name: r.student_name,
      lesson_id: r.lesson_id,
      lesson_title: r.lesson_title,
      block_id: r.block_id,
      content_version_key: r.content_version_key,
      watched_intervals: safeJson(r.watched_intervals_json, []),
      unique_watched_sec: Number(r.unique_watched_sec || r.watched_seconds || 0),
      max_contiguous_watched_sec: Number(r.max_contiguous_watched_sec || r.max_watched_sec || 0),
      last_position_sec: Number(r.last_position_sec || 0),
      duration_sec: Number(r.duration_sec || 0),
      watch_pct: Number(r.watch_pct || 0),
      required_pct: Number(r.min_video_watch_pct || 0) || 85,
      is_completed: Boolean(r.is_completed),
      tamper_attempts_count: tamperMap[`${r.student_id}|${r.lesson_id}|${r.block_id}`] || 0,
      updated_at: r.updated_at,
    }));

    const completedCount = items.filter((i) => i.is_completed).length;
    const avgPct = items.length ? Math.round((items.reduce((s, i) => s + i.watch_pct, 0) / items.length) * 10) / 10 : 0;

    return {
      class_id: cls.id,
      content_version_key: contentVersionKey,
      summary: {
        records_count: items.length,
        completed_count: completedCount,
        avg_watch_pct: avgPct,
        total_tamper_rejected: tamperRows.reduce((s, t) => s + Number(t.n || 0), 0),
      },
      items,
    };
  });
}
