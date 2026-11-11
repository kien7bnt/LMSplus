import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractImageUrlCandidates } from '../../../../shared/imageUrl.mjs';
import { buildYouTubeWatchUrl } from '../../../../shared/youtube.mjs';
import {
  MarkerBehavior,
  MarkerSubmitResult,
  QuestionSpec,
  QuestionType,
  StudentVideoMarker,
  VideoQuizMarker,
  VideoWatchProgress,
} from '../api';
import { Btn, Tone } from '../ui';
import {
  Html5VideoAdapter,
  VideoPlaybackState,
  VideoPlayerAdapter,
  YouTubeIframeAdapter,
  formatTimestamp,
  gradeQuestionInMemory,
} from './videoAdapter';

export type UnifiedVideoMarker = {
  id: string;
  block_id: string;
  origin?: 'INHERITED' | 'CLASS_CUSTOM';
  timestamp_sec: number;
  sort_order?: number;
  behavior: MarkerBehavior;
  title: string;
  info_body?: string;
  is_required: boolean;
  allow_skip: boolean;
  max_attempts: number;
  allow_review: boolean;
  show_answer_after_submit?: boolean;
  show_explanation?: boolean;
  question: {
    id?: string;
    question_id?: string | null;
    question_type: QuestionType;
    prompt: string;
    points?: number;
    options?: Array<{ id: string; text: string; is_correct?: boolean; feedback?: string }>;
    answer_key?: QuestionSpec['answer_key'];
    explanation?: string;
    correct_feedback?: string;
    wrong_feedback?: string;
  } | null;
  learner_state?: StudentVideoMarker['learner_state'];
};

export interface InteractiveVideoPlayerProps {
  blockId: string;
  sourceType: 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL';
  streamUrl?: string | null;
  videoId?: string;
  directUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  startSeconds?: number;
  fallbackDuration?: number;
  allowSeekingAhead?: boolean;
  markers?: Array<StudentVideoMarker | VideoQuizMarker>;
  initialProgress?: VideoWatchProgress;
  mode: 'LEARNER' | 'PREVIEW' | 'AUTHOR';
  onSaveProgress?: (payload: {
    block_id: string;
    last_position_sec: number;
    watched_seconds: number;
    duration_sec: number;
  }) => Promise<unknown>;
  onSubmitMarker?: (
    markerId: string,
    payload: { idempotency_key: string; response: Record<string, any> }
  ) => Promise<MarkerSubmitResult>;
  onAdapterReady?: (adapter: VideoPlayerAdapter | null) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

const INITIAL_PLAYBACK_STATE: VideoPlaybackState = {
  ready: false,
  playing: false,
  ended: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
  muted: false,
  error: null,
};

type LocalMarkerRuntime = {
  completed: boolean;
  attemptsUsed: number;
  isCorrect: boolean;
  canRetry: boolean;
  lastFeedback: string;
  explanation?: string;
};

export const InteractiveVideoPlayer: React.FC<InteractiveVideoPlayerProps> = ({
  blockId,
  sourceType,
  streamUrl,
  videoId,
  directUrl,
  thumbnailUrl,
  title,
  description,
  startSeconds = 0,
  fallbackDuration = 0,
  allowSeekingAhead = true,
  markers = [],
  initialProgress,
  mode,
  onSaveProgress,
  onSubmitMarker,
  onAdapterReady,
  onTimeUpdate,
}) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<VideoPlayerAdapter | null>(null);

  const [pb, setPb] = useState<VideoPlaybackState>({
    ...INITIAL_PLAYBACK_STATE,
    duration: fallbackDuration || initialProgress?.duration_sec || 0,
  });
  const [resolvedHtml5Src, setResolvedHtml5Src] = useState<string>(() => {
    if (sourceType === 'UPLOAD') return streamUrl || '';
    if (sourceType === 'DIRECT_URL') return directUrl || '';
    return '';
  });
  const triedFallbackOriginRef = useRef(false);

  // Resume state
  const resumedOnceRef = useRef(false);
  const [resumeBannerSec, setResumeBannerSec] = useState<number | null>(
    mode === 'LEARNER' && (initialProgress?.last_position_sec || 0) >= 5
      ? Math.floor(initialProgress!.last_position_sec)
      : null
  );

  // Watch progress accumulators
  const watchedSecondsRef = useRef<number>(initialProgress?.watched_seconds || 0);
  const maxAllowedPosRef = useRef<number>(
    Math.max(startSeconds || 0, initialProgress?.max_watched_sec || 0, initialProgress?.last_position_sec || 0)
  );
  const lastTickTimeRef = useRef<number>(startSeconds || 0);
  const lastSavedAtMsRef = useRef<number>(0);

  // Normalize markers sorted by timestamp & sort_order
  const unifiedMarkers = useMemo<UnifiedVideoMarker[]>(() => {
    const list = (markers || []).map((m): UnifiedVideoMarker => {
      const sm = m as StudentVideoMarker;
      const vm = m as VideoQuizMarker;
      return {
        id: m.id,
        block_id: m.block_id,
        origin: m.origin,
        timestamp_sec: Number(m.timestamp_sec || 0),
        sort_order: Number(m.sort_order ?? 0),
        behavior: m.behavior || 'PAUSE_AND_ASK',
        title: m.title || '',
        info_body: m.info_body || '',
        is_required: Boolean(m.is_required),
        allow_skip: Boolean(m.allow_skip),
        max_attempts: Number(m.max_attempts ?? 2),
        allow_review: m.allow_review !== false,
        show_answer_after_submit: vm.show_answer_after_submit !== false,
        show_explanation: vm.show_explanation !== false,
        question: m.question ? { ...m.question } : null,
        learner_state: sm.learner_state,
      };
    });
    return list.sort((a, b) => a.timestamp_sec - b.timestamp_sec || (a.sort_order || 0) - (b.sort_order || 0));
  }, [markers]);

  // Runtime completion map + session-handled set (tracks markers already paused in the current playback pass)
  const [runtimeMap, setRuntimeMap] = useState<Record<string, LocalMarkerRuntime>>({});
  const handledInSessionRef = useRef<Set<string>>(new Set());
  const prevCheckTimeRef = useRef<number>(startSeconds || 0);

  useEffect(() => {
    const next: Record<string, LocalMarkerRuntime> = {};
    const resumePos = mode === 'LEARNER' ? Number(initialProgress?.last_position_sec || 0) : 0;
    handledInSessionRef.current.clear();
    unifiedMarkers.forEach((m) => {
      if (mode === 'LEARNER' && m.learner_state) {
        const done = Boolean(m.learner_state.completed);
        next[m.id] = {
          completed: done,
          attemptsUsed: Number(m.learner_state.attempts_used || 0),
          isCorrect: Boolean(m.learner_state.is_correct),
          canRetry: Boolean(m.learner_state.can_retry),
          lastFeedback: m.learner_state.last_feedback || '',
        };
        // Chỉ bỏ qua tự động khi khôi phục giữa chừng qua mốc đã hoàn thành; nếu phát lại từ đầu vẫn dừng tại mốc
        if (done && resumePos >= 3 && resumePos > Number(m.timestamp_sec || 0) + 1.5) {
          handledInSessionRef.current.add(m.id);
        }
      } else {
        next[m.id] = {
          completed: false,
          attemptsUsed: 0,
          isCorrect: false,
          canRetry: true,
          lastFeedback: '',
        };
      }
    });
    setRuntimeMap(next);
  }, [unifiedMarkers, mode, initialProgress?.last_position_sec]);

  // Active marker overlay & queue for closely spaced markers
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [reviewingOnly, setReviewingOnly] = useState(false);
  const markerQueueRef = useRef<string[]>([]);

  // Quiz form input states inside overlay
  const [singleChoiceId, setSingleChoiceId] = useState<string>('');
  const [multiChoiceIds, setMultiChoiceIds] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<MarkerSubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seekNotice, setSeekNotice] = useState<string | null>(null);

  useEffect(() => {
    triedFallbackOriginRef.current = false;
    if (sourceType === 'UPLOAD') setResolvedHtml5Src(streamUrl || '');
    else if (sourceType === 'DIRECT_URL') setResolvedHtml5Src(directUrl || '');
    else setResolvedHtml5Src('');
  }, [sourceType, streamUrl, directUrl]);

  const effectiveDuration = pb.duration > 0 ? pb.duration : fallbackDuration || initialProgress?.duration_sec || 0;

  const getEffectiveMarkerTime = useCallback(
    (rawSec: number) => {
      if (effectiveDuration > 0 && rawSec > effectiveDuration) {
        return Math.max(0, Math.round((effectiveDuration - 0.5) * 10) / 10);
      }
      return Math.max(0, rawSec);
    },
    [effectiveDuration]
  );

  const resetOverlayInputs = useCallback((marker: UnifiedVideoMarker | undefined) => {
    setSingleChoiceId('');
    setMultiChoiceIds([]);
    setTextAnswer('');
    setSubmitResult(null);
    setSubmitError(null);
    if (marker?.learner_state?.last_response) {
      const lr = marker.learner_state.last_response;
      if (lr.selected_option_id) setSingleChoiceId(String(lr.selected_option_id));
      if (Array.isArray(lr.selected_option_ids)) setMultiChoiceIds(lr.selected_option_ids.map(String));
      if (typeof lr.text === 'string') setTextAnswer(lr.text);
    }
  }, []);

  const openMarkerOverlay = useCallback(
    (markerId: string, isReview = false) => {
      const m = unifiedMarkers.find((x) => x.id === markerId);
      if (!m) return;
      adapterRef.current?.pause();
      setActiveMarkerId(markerId);
      setReviewingOnly(isReview);
      resetOverlayInputs(m);
    },
    [unifiedMarkers, resetOverlayInputs]
  );

  const flushSaveProgress = useCallback(
    (currentTime: number, duration: number, force = false) => {
      if (mode !== 'LEARNER' || !onSaveProgress) return;
      const now = Date.now();
      if (!force && now - lastSavedAtMsRef.current < 5000) return;
      lastSavedAtMsRef.current = now;
      const dur = Math.max(1, Math.round(duration || fallbackDuration || 0));
      void onSaveProgress({
        block_id: blockId,
        last_position_sec: Math.max(0, Math.round(currentTime * 10) / 10),
        watched_seconds: Math.round(watchedSecondsRef.current),
        duration_sec: dur,
      }).catch(() => {
        // non-blocking background heartbeat
      });
    },
    [mode, onSaveProgress, blockId, fallbackDuration]
  );

  // Mount / destroy VideoPlayerAdapter cleanly
  useEffect(() => {
    let adapter: VideoPlayerAdapter | null = null;

    if ((sourceType === 'UPLOAD' || sourceType === 'DIRECT_URL') && videoElRef.current && resolvedHtml5Src) {
      adapter = new Html5VideoAdapter(videoElRef.current, fallbackDuration);
    } else if (sourceType === 'YOUTUBE' && ytHostRef.current && videoId) {
      adapter = new YouTubeIframeAdapter(ytHostRef.current, videoId, startSeconds, fallbackDuration);
    }

    adapterRef.current = adapter;
    onAdapterReady?.(adapter);

    if (!adapter) return () => onAdapterReady?.(null);

    const unsubscribe = adapter.subscribe((state) => {
      // Automatic standalone origin fallback for relative /api/v1/... stream URLs on local dev
      if (
        state.error &&
        sourceType === 'UPLOAD' &&
        !triedFallbackOriginRef.current &&
        resolvedHtml5Src.startsWith('/api/') &&
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        window.location.port !== '8000'
      ) {
        triedFallbackOriginRef.current = true;
        setResolvedHtml5Src(`http://127.0.0.1:8000${resolvedHtml5Src}`);
        return;
      }

      setPb(state);
      const dur = state.duration > 0 ? state.duration : fallbackDuration;
      onTimeUpdate?.(state.currentTime, dur);

      // Auto-seek to learner's saved position once metadata is ready
      if (
        mode === 'LEARNER' &&
        state.ready &&
        !resumedOnceRef.current &&
        (initialProgress?.last_position_sec || 0) >= 3
      ) {
        resumedOnceRef.current = true;
        const target = dur > 2
          ? Math.min(initialProgress!.last_position_sec, Math.max(0, dur - 2))
          : initialProgress!.last_position_sec;
        lastTickTimeRef.current = target;
        adapter?.seek(target);
        return;
      }

      // Accumulate real watched seconds when playing normally (delta between 0 and 1.5s)
      const prevTime = lastTickTimeRef.current;
      const delta = state.currentTime - prevTime;
      if (state.playing && delta > 0 && delta <= 1.6) {
        watchedSecondsRef.current += delta;
        if (state.currentTime > maxAllowedPosRef.current) {
          maxAllowedPosRef.current = state.currentTime;
        }
      }
      lastTickTimeRef.current = state.currentTime;

      if (mode === 'LEARNER') {
        if (state.playing) flushSaveProgress(state.currentTime, dur, false);
        else if (state.ended) flushSaveProgress(state.currentTime, dur, true);
      }
    });

    return () => {
      unsubscribe();
      adapter?.destroy();
      adapterRef.current = null;
      onAdapterReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, resolvedHtml5Src, videoId, fallbackDuration]);

  // Khóa cứng trạng thái tạm dừng nếu trình phát YouTube/HTML5 tự chuyển từ BUFFERING sang PLAYING khi đang mở câu hỏi
  useEffect(() => {
    if (activeMarkerId && pb.playing) {
      adapterRef.current?.pause();
    }
  }, [activeMarkerId, pb.playing]);

  // Deterministic Marker Detection Engine (LEARNER & PREVIEW modes)
  useEffect(() => {
    if (mode === 'AUTHOR' || activeMarkerId || !pb.ready) return;
    if (unifiedMarkers.length === 0) return;

    const current = pb.currentTime;
    const prev = prevCheckTimeRef.current;

    // Nếu người học tua ngược lại trước mốc, cho phép mốc đó tự động dừng lại khi phát tới
    if (current < prev - 1.2) {
      unifiedMarkers.forEach((m) => {
        const mTime = getEffectiveMarkerTime(m.timestamp_sec);
        if (mTime > current + 0.4) {
          handledInSessionRef.current.delete(m.id);
        }
      });
    }

    // 1. Chặn tua vượt qua mốc PAUSE_AND_ASK bắt buộc chưa hoàn thành (kể cả khi kéo trực tiếp thanh tua của YouTube)
    const blockingRequired = unifiedMarkers.find((m) => {
      const mTime = getEffectiveMarkerTime(m.timestamp_sec);
      const rt = runtimeMap[m.id];
      const answeredDone = Boolean(rt?.completed && !rt?.canRetry) || handledInSessionRef.current.has(m.id);
      return (
        !answeredDone &&
        m.behavior === 'PAUSE_AND_ASK' &&
        (m.is_required || !allowSeekingAhead) &&
        current > mTime + 1.5
      );
    });

    if (blockingRequired) {
      const clampTime = getEffectiveMarkerTime(blockingRequired.timestamp_sec);
      prevCheckTimeRef.current = clampTime;
      adapterRef.current?.pause();
      adapterRef.current?.seek(clampTime);
      setSeekNotice('Hãy hoàn thành câu hỏi tương tác tại mốc này trước khi tua tiếp.');
      openMarkerOverlay(blockingRequired.id, false);
      return;
    }

    // 2. Phát hiện chạm hoặc vượt mốc thời gian trong lúc phát (hỗ trợ mọi tốc độ 0.75x–2x)
    const progressedForward = current > prev && current - prev <= 3.5;
    if (!pb.playing && !pb.ended && !progressedForward) {
      prevCheckTimeRef.current = current;
      return;
    }

    const dueMarkers = unifiedMarkers.filter((m) => {
      if (handledInSessionRef.current.has(m.id)) return false;
      const rt = runtimeMap[m.id];
      const alreadyLocked = Boolean(rt?.completed && !rt?.canRetry && m.behavior !== 'INFO_ONLY');
      if (alreadyLocked && m.allow_review === false) return false;
      const mTime = getEffectiveMarkerTime(m.timestamp_sec);
      const crossed = prev <= mTime && current >= mTime - 0.15;
      const inWindow = current >= mTime - 0.15 && current <= mTime + 1.8;
      return crossed || inWindow;
    });

    prevCheckTimeRef.current = current;

    if (dueMarkers.length > 0) {
      const [first, ...rest] = dueMarkers;
      markerQueueRef.current = rest.map((x) => x.id);
      const firstRt = runtimeMap[first.id];
      const openAsReview = Boolean(firstRt?.completed && !firstRt?.canRetry && first.behavior !== 'INFO_ONLY');
      openMarkerOverlay(first.id, openAsReview);
    }
  }, [
    mode,
    pb.currentTime,
    pb.playing,
    pb.ended,
    pb.ready,
    activeMarkerId,
    unifiedMarkers,
    runtimeMap,
    allowSeekingAhead,
    getEffectiveMarkerTime,
    openMarkerOverlay,
  ]);

  const activeMarker = useMemo(
    () => unifiedMarkers.find((m) => m.id === activeMarkerId) || null,
    [unifiedMarkers, activeMarkerId]
  );

  const handleContinuePlayback = () => {
    if (activeMarker) {
      handledInSessionRef.current.add(activeMarker.id);
    }
    setSeekNotice(null);
    setReviewingOnly(false);

    // Pop next queued marker if multiple markers share nearly the same timestamp
    const nextQueuedId = markerQueueRef.current.shift();
    if (nextQueuedId) {
      const nextRt = runtimeMap[nextQueuedId];
      openMarkerOverlay(nextQueuedId, Boolean(nextRt?.completed && !nextRt?.canRetry));
      return;
    }

    setActiveMarkerId(null);
    if (!pb.error) {
      adapterRef.current?.play();
    }
  };

  const handleSkipMarker = () => {
    if (!activeMarker) return;
    handledInSessionRef.current.add(activeMarker.id);
    setSeekNotice(null);
    const nextQueuedId = markerQueueRef.current.shift();
    if (nextQueuedId) {
      openMarkerOverlay(nextQueuedId, false);
      return;
    }
    setActiveMarkerId(null);
    if (!pb.error) {
      adapterRef.current?.play();
    }
  };

  const handleSubmitQuizOverlay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMarker || !activeMarker.question) return;

    const q = activeMarker.question;
    let responsePayload: Record<string, any> = {};

    if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'TRUE_FALSE') {
      if (!singleChoiceId) {
        setSubmitError('Vui lòng chọn một đáp án.');
        return;
      }
      responsePayload = { selected_option_id: singleChoiceId };
    } else if (q.question_type === 'MULTIPLE_CHOICE') {
      if (multiChoiceIds.length === 0) {
        setSubmitError('Vui lòng chọn ít nhất một phương án.');
        return;
      }
      responsePayload = { selected_option_ids: multiChoiceIds };
    } else {
      if (!textAnswer.trim()) {
        setSubmitError('Vui lòng nhập câu trả lời của bạn.');
        return;
      }
      responsePayload = { text: textAnswer.trim() };
    }

    setSubmitError(null);
    const prevRt = runtimeMap[activeMarker.id] || {
      completed: false,
      attemptsUsed: 0,
      isCorrect: false,
      canRetry: true,
      lastFeedback: '',
    };
    const nextAttemptNumber = prevRt.attemptsUsed + 1;

    if (mode === 'PREVIEW' || !onSubmitMarker) {
      const memRes = gradeQuestionInMemory(q as QuestionSpec, responsePayload, {
        attemptNumber: nextAttemptNumber,
        maxAttempts: activeMarker.max_attempts,
        isRequired: activeMarker.is_required,
        allowSkip: activeMarker.allow_skip,
        showAnswer: activeMarker.show_answer_after_submit !== false,
        showExplanation: activeMarker.show_explanation !== false,
      });
      setSubmitResult(memRes);
      setRuntimeMap((prev) => ({
        ...prev,
        [activeMarker.id]: {
          completed: memRes.can_continue,
          attemptsUsed: nextAttemptNumber,
          isCorrect: memRes.is_correct,
          canRetry: memRes.can_retry,
          lastFeedback: memRes.feedback,
          explanation: memRes.explanation,
        },
      }));
      return;
    }

    setSubmitting(true);
    try {
      const idemKey = `${blockId}:${activeMarker.id}:att:${nextAttemptNumber}`;
      const res = await onSubmitMarker(activeMarker.id, {
        idempotency_key: idemKey,
        response: responsePayload,
      });
      setSubmitResult(res);
      setRuntimeMap((prev) => ({
        ...prev,
        [activeMarker.id]: {
          completed: res.can_continue,
          attemptsUsed: res.attempt_number || nextAttemptNumber,
          isCorrect: res.is_correct,
          canRetry: res.can_retry,
          lastFeedback: res.feedback,
          explanation: res.explanation,
        },
      }));
    } catch (err: any) {
      setSubmitError(err?.message || 'Không gửi được câu trả lời. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleScrub = (targetSeconds: number) => {
    if (!adapterRef.current) return;
    setSeekNotice(null);

    if (mode !== 'AUTHOR') {
      // Check if scrubbing past an unanswered required PAUSE_AND_ASK marker
      const firstBlocking = unifiedMarkers.find((m) => {
        const mTime = getEffectiveMarkerTime(m.timestamp_sec);
        const rt = runtimeMap[m.id];
        const done = Boolean(rt?.completed) || handledInSessionRef.current.has(m.id);
        return (
          !done &&
          m.behavior === 'PAUSE_AND_ASK' &&
          (m.is_required || !allowSeekingAhead) &&
          targetSeconds > mTime + 0.5
        );
      });

      if (firstBlocking) {
        const clamp = getEffectiveMarkerTime(firstBlocking.timestamp_sec);
        adapterRef.current.seek(clamp);
        setSeekNotice('Cần trả lời câu hỏi tại mốc này trước khi tua qua.');
        openMarkerOverlay(firstBlocking.id, false);
        return;
      }

      if (!allowSeekingAhead && targetSeconds > maxAllowedPosRef.current + 2) {
        adapterRef.current.seek(maxAllowedPosRef.current);
        setSeekNotice('Giảng viên đã bật chế độ xem tuần tự cho video này.');
        return;
      }
    }

    if (targetSeconds < pb.currentTime - 0.5) {
      unifiedMarkers.forEach((m) => {
        const mTime = getEffectiveMarkerTime(m.timestamp_sec);
        if (mTime >= targetSeconds - 0.2) {
          handledInSessionRef.current.delete(m.id);
        }
      });
    }
    prevCheckTimeRef.current = targetSeconds;
    adapterRef.current.seek(targetSeconds);
  };

  const togglePlay = () => {
    if (activeMarkerId) return;
    if (pb.playing) {
      adapterRef.current?.pause();
      flushSaveProgress(pb.currentTime, effectiveDuration, true);
    } else {
      if (pb.ended) {
        handledInSessionRef.current.clear();
        prevCheckTimeRef.current = 0;
        adapterRef.current?.seek(0);
      }
      adapterRef.current?.play();
    }
  };

  const progressPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (pb.currentTime / effectiveDuration) * 100)) : 0;

  const activeRt = activeMarker ? runtimeMap[activeMarker.id] : undefined;

  return (
    <div className="ls-player-wrap">
      {title && (
        <div className="ls-player-head">
          <strong>{title}</strong>
          {unifiedMarkers.length > 0 && (
            <Tone tone="info">
              <span className="tabular-nums">{unifiedMarkers.length} mốc tương tác</span>
            </Tone>
          )}
        </div>
      )}

      {resumeBannerSec !== null && mode === 'LEARNER' && (
        <div className="ls-resume-bar">
          <span className="tabular-nums">
            Đã khôi phục vị trí xem gần nhất tại <strong>{formatTimestamp(resumeBannerSec)}</strong>
          </span>
          <div className="t-actions">
            <Btn
              small
              variant="ghost"
              onClick={() => {
                setResumeBannerSec(null);
                handledInSessionRef.current.clear();
                prevCheckTimeRef.current = 0;
                adapterRef.current?.seek(0);
              }}
            >
              Xem lại từ đầu
            </Btn>
            <Btn small variant="quiet" onClick={() => setResumeBannerSec(null)}>
              Đóng
            </Btn>
          </div>
        </div>
      )}

      <div className="ls-player-stage">
        {(sourceType === 'UPLOAD' || sourceType === 'DIRECT_URL') && (
          <video
            ref={videoElRef}
            src={resolvedHtml5Src || undefined}
            poster={extractImageUrlCandidates(thumbnailUrl)[0] || undefined}
            preload="metadata"
            playsInline
            onClick={togglePlay}
            className="ls-player-video"
          />
        )}

        {sourceType === 'YOUTUBE' && (
          <div ref={ytHostRef} className="ls-player-yt-host" />
        )}

        {pb.error && (
          <div className="ls-player-error" role="alert">
            {(thumbnailUrl || (sourceType === 'YOUTUBE' && videoId)) && (
              <img
                src={
                  extractImageUrlCandidates(thumbnailUrl)[0] ||
                  (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '')
                }
                alt=""
                referrerPolicy="no-referrer"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.22,
                  pointerEvents: 'none',
                }}
              />
            )}
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                maxWidth: '60ch',
              }}
            >
              <strong>Không phát được video ngay trong khung</strong>
              <p style={{ margin: 0 }}>{pb.error}</p>
              <div className="t-actions" style={{ justifyContent: 'center' }}>
                {sourceType === 'YOUTUBE' && videoId && (
                  <a
                    className="t-btn t-btn--primary"
                    href={buildYouTubeWatchUrl(videoId, startSeconds)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      const fallbackDur = Math.max(180, effectiveDuration || 0);
                      watchedSecondsRef.current = Math.max(watchedSecondsRef.current, fallbackDur);
                      flushSaveProgress(fallbackDur, fallbackDur, true);
                    }}
                  >
                    Mở trực tiếp trên YouTube ↗
                  </a>
                )}
                {sourceType === 'DIRECT_URL' && directUrl && (
                  <a
                    className="t-btn t-btn--primary"
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      const fallbackDur = Math.max(180, effectiveDuration || 0);
                      watchedSecondsRef.current = Math.max(watchedSecondsRef.current, fallbackDur);
                      flushSaveProgress(fallbackDur, fallbackDur, true);
                    }}
                  >
                    Mở liên kết nguồn ↗
                  </a>
                )}
              </div>

              {mode !== 'AUTHOR' && unifiedMarkers.length > 0 && (
                <div className="t-actions" style={{ justifyContent: 'center', marginTop: 4 }}>
                  {unifiedMarkers.map((m, idx) => {
                    const done = Boolean(runtimeMap[m.id]?.completed);
                    return (
                      <Btn
                        key={m.id}
                        small
                        variant={done ? 'secondary' : 'primary'}
                        onClick={() => openMarkerOverlay(m.id, done && m.allow_review !== false)}
                      >
                        {done ? '✓ ' : ''}Câu hỏi {idx + 1} ({formatTimestamp(m.timestamp_sec)})
                      </Btn>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Interactive Timestamp Video Quiz Overlay */}
        {activeMarker && mode !== 'AUTHOR' && (
          <div className="ls-quiz-overlay" role="dialog" aria-modal="true" aria-label="Câu hỏi tương tác trong video">
            <div className="ls-quiz-card">
              <div className="ls-quiz-card__head">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Tone tone={activeMarker.behavior === 'INFO_ONLY' ? 'info' : 'warning'}>
                    <span className="tabular-nums">Mốc {formatTimestamp(getEffectiveMarkerTime(activeMarker.timestamp_sec))}</span>
                  </Tone>
                  {activeMarker.origin === 'CLASS_CUSTOM' && <Tone tone="info">Bổ sung riêng cho lớp</Tone>}
                  {activeMarker.behavior !== 'INFO_ONLY' && activeMarker.is_required && (
                    <Tone tone="danger">Bắt buộc trả lời</Tone>
                  )}
                  {reviewingOnly && <Tone tone="success">Xem lại câu hỏi</Tone>}
                </div>
                {activeMarker.max_attempts > 0 && activeMarker.behavior !== 'INFO_ONLY' && (
                  <span className="t-sub tabular-nums">
                    Lượt làm: {activeRt?.attemptsUsed || 0}/{activeMarker.max_attempts}
                  </span>
                )}
              </div>

              {activeMarker.title && <h3 style={{ margin: '4px 0 0', fontSize: 17 }}>{activeMarker.title}</h3>}

              {activeMarker.behavior === 'INFO_ONLY' || !activeMarker.question ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {activeMarker.info_body || 'Ghi chú trọng tâm từ giảng viên tại thời điểm này.'}
                  </p>
                  <div className="t-actions" style={{ justifyContent: 'flex-end' }}>
                    <Btn variant="primary" onClick={handleContinuePlayback}>
                      Đã hiểu & Tiếp tục xem ▶
                    </Btn>
                  </div>
                </div>
              ) : (() => {
                const markerExhausted = Boolean(activeRt && !activeRt.canRetry && activeRt.completed);
                const quizLocked = Boolean(submitResult && !submitResult.can_retry) || markerExhausted || reviewingOnly;
                return (
                <form onSubmit={handleSubmitQuizOverlay} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 15, lineHeight: 1.5 }}>
                    {activeMarker.question.prompt}
                  </p>

                  {(activeMarker.question.question_type === 'SINGLE_CHOICE' ||
                    activeMarker.question.question_type === 'TRUE_FALSE') && (
                    <div className="ls-quiz-options" role="radiogroup" aria-label="Danh sách phương án">
                      {(activeMarker.question.options || []).map((opt) => {
                        const selected = singleChoiceId === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className="t-option"
                            aria-pressed={selected}
                            disabled={submitting || quizLocked}
                            onClick={() => {
                              setSingleChoiceId(opt.id);
                              if (submitResult?.can_retry) setSubmitResult(null);
                            }}
                          >
                            {opt.text}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeMarker.question.question_type === 'MULTIPLE_CHOICE' && (
                    <div className="ls-quiz-options" role="group" aria-label="Chọn nhiều đáp án">
                      {(activeMarker.question.options || []).map((opt) => {
                        const selected = multiChoiceIds.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className="t-option"
                            aria-pressed={selected}
                            disabled={submitting || quizLocked}
                            onClick={() => {
                              setMultiChoiceIds((prev) =>
                                prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
                              );
                              if (submitResult?.can_retry) setSubmitResult(null);
                            }}
                          >
                            {selected ? '☑ ' : '☐ '}
                            {opt.text}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeMarker.question.question_type === 'FILL_BLANK' && (
                    <input
                      className="t-input"
                      value={textAnswer}
                      disabled={submitting || quizLocked}
                      onChange={(e) => {
                        setTextAnswer(e.target.value);
                        if (submitResult?.can_retry) setSubmitResult(null);
                      }}
                      placeholder="Nhập đáp án ngắn gọn…"
                      aria-label="Đáp án điền vào chỗ trống"
                    />
                  )}

                  {activeMarker.question.question_type === 'SHORT_ANSWER' && (
                    <textarea
                      className="t-input"
                      rows={3}
                      value={textAnswer}
                      disabled={submitting || quizLocked}
                      onChange={(e) => {
                        setTextAnswer(e.target.value);
                        if (submitResult?.can_retry) setSubmitResult(null);
                      }}
                      placeholder="Trình bày câu trả lời của bạn…"
                      aria-label="Câu trả lời tự luận ngắn"
                    />
                  )}

                  {submitError && (
                    <p className="t-field__error" role="alert">
                      {submitError}
                    </p>
                  )}

                  {(submitResult || ((reviewingOnly || markerExhausted) && activeRt?.lastFeedback)) && (
                    <div
                      className={`ls-quiz-feedback ${
                        (submitResult ? submitResult.is_correct : activeRt?.isCorrect) ? 'is-correct' : 'is-wrong'
                      }`}
                      role="status"
                    >
                      <strong>
                        {(submitResult ? submitResult.is_correct : activeRt?.isCorrect)
                          ? '✓ Chính xác!'
                          : '✗ Chưa chính xác'}
                      </strong>
                      <span>{submitResult ? submitResult.feedback : activeRt?.lastFeedback}</span>
                      {(submitResult?.explanation || activeMarker.question.explanation) && (
                        <span className="t-sub" style={{ marginTop: 4, display: 'block' }}>
                          Giải thích: {submitResult?.explanation || activeMarker.question.explanation}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="t-actions" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                    <div>
                      {(reviewingOnly ||
                        activeMarker.behavior === 'PAUSE_OPTIONAL' ||
                        (!activeMarker.is_required && activeMarker.allow_skip)) &&
                        !submitResult?.can_continue &&
                        !markerExhausted && (
                          <Btn variant="ghost" onClick={handleSkipMarker}>
                            {reviewingOnly ? 'Đóng xem lại' : 'Bỏ qua & xem tiếp'}
                          </Btn>
                        )}
                    </div>
                    <div className="t-actions">
                      {!reviewingOnly && !markerExhausted && (!submitResult || submitResult.can_retry) && (
                        <Btn type="submit" variant="primary" loading={submitting}>
                          {submitResult?.can_retry ? 'Thử lại đáp án khác' : 'Kiểm tra đáp án'}
                        </Btn>
                      )}
                      {(reviewingOnly || submitResult?.can_continue || markerExhausted) && (
                        <Btn variant="primary" onClick={handleContinuePlayback}>
                          {pb.error ? 'Đóng câu hỏi' : 'Tiếp tục phát video ▶'}
                        </Btn>
                      )}
                    </div>
                  </div>
                </form>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Accessible Transport & Interactive Marker Timeline */}
      <div className="ls-transport">
        <div
          className="ls-scrub-track"
          onClick={(e) => {
            if (effectiveDuration <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            handleScrub(ratio * effectiveDuration);
          }}
          role="slider"
          tabIndex={0}
          aria-label="Thanh tiến trình video"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDuration)}
          aria-valuenow={Math.round(pb.currentTime)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              handleScrub(pb.currentTime + 5);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              handleScrub(Math.max(0, pb.currentTime - 5));
            }
          }}
        >
          <div className="ls-scrub-bar">
            <div className="ls-scrub-fill" style={{ width: `${progressPct}%` }} />
          </div>

          {effectiveDuration > 0 &&
            unifiedMarkers.map((m) => {
              const mTime = getEffectiveMarkerTime(m.timestamp_sec);
              const leftPct = Math.min(99, Math.max(1, (mTime / effectiveDuration) * 100));
              const rt = runtimeMap[m.id];
              const isDone = Boolean(rt?.completed);
              const canClickReview =
                mode !== 'AUTHOR' &&
                (Boolean(pb.error) || (isDone ? m.allow_review !== false : !m.is_required || allowSeekingAhead));
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`ls-marker-pin ${isDone ? 'is-done' : ''} ${
                    m.behavior === 'INFO_ONLY' ? 'is-info' : ''
                  }`}
                  style={{ left: `clamp(22px, ${leftPct}%, calc(100% - 22px))` }}
                  title={`${formatTimestamp(mTime)} — ${m.title || m.question?.prompt || 'Mốc tương tác'}`}
                  aria-label={`Mốc tương tác tại ${formatTimestamp(mTime)}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (mode === 'AUTHOR') {
                      adapterRef.current?.seek(mTime);
                      return;
                    }
                    if (pb.error) {
                      openMarkerOverlay(m.id, isDone && m.allow_review !== false);
                      return;
                    }
                    if (isDone && m.allow_review !== false) {
                      adapterRef.current?.seek(mTime);
                      openMarkerOverlay(m.id, true);
                    } else if (canClickReview) {
                      handleScrub(mTime);
                    }
                  }}
                >
                  <span className="ls-marker-pin__dot" />
                </button>
              );
            })}
        </div>

        <div className="ls-transport-controls">
          <div className="t-actions">
            <button
              type="button"
              className="t-icon-btn"
              onClick={togglePlay}
              aria-label={pb.playing ? 'Tạm dừng video' : 'Phát video'}
            >
              {pb.playing ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className="t-icon-btn"
              onClick={() => handleScrub(Math.max(0, pb.currentTime - 10))}
              aria-label="Lùi lại 10 giây"
              title="Lùi 10 giây"
            >
              ↺
            </button>
            <span className="ls-time-readout tabular-nums">
              {formatTimestamp(pb.currentTime)} / {formatTimestamp(effectiveDuration)}
            </span>
          </div>

          <div className="t-actions">
            <select
              className="t-input ls-speed-select tabular-nums"
              aria-label="Tốc độ phát"
              value={String(pb.playbackRate)}
              onChange={(e) => adapterRef.current?.setPlaybackRate(Number(e.target.value))}
            >
              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                <option key={r} value={String(r)}>
                  {r}x
                </option>
              ))}
            </select>
            <button
              type="button"
              className="t-icon-btn"
              onClick={() => adapterRef.current?.setMuted(!pb.muted)}
              aria-label={pb.muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            >
              {pb.muted ? '🔇' : '🔊'}
            </button>
            {sourceType === 'YOUTUBE' && videoId && (
              <a
                className="t-btn t-btn--small t-btn--ghost"
                href={buildYouTubeWatchUrl(videoId, Math.floor(pb.currentTime || startSeconds))}
                target="_blank"
                rel="noopener noreferrer"
              >
                YouTube ↗
              </a>
            )}
          </div>
        </div>

        {seekNotice && (
          <div className="ls-seek-notice" role="status">
            {seekNotice}
          </div>
        )}
      </div>

      {description && <p className="ls-player-caption">{description}</p>}
    </div>
  );
};
