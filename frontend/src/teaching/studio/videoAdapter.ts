/**
 * LMSPLUS Lesson Studio — Player-Agnostic Video Controller (`VideoPlayerAdapter`).
 * Tách biệt hoàn toàn logic điều khiển phát video và Interactive Video Quiz khỏi công nghệ phát bên dưới:
 *  - `Html5VideoAdapter`: cho tệp video tải lên máy chủ (HTTP Range 206) và nguồn HTTPS trực tiếp
 *  - `YouTubeIframeAdapter`: cho video YouTube qua YouTube IFrame Player API (`youtube-nocookie.com`)
 */

import { MarkerSubmitResult, QuestionSpec } from '../api';

export interface VideoPlaybackState {
  ready: boolean;
  playing: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  error: string | null;
}

export interface VideoPlayerAdapter {
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  play(): Promise<void> | void;
  pause(): void;
  seek(seconds: number): void;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  subscribe(listener: (state: VideoPlaybackState) => void): () => void;
  destroy(): void;
}

export function formatTimestamp(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '00:00';
  const rounded = Math.floor(totalSec);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function parseTimestampInput(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : null;
  }
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const sec = Number(parts[1]);
    if (Number.isInteger(m) && m >= 0 && Number.isFinite(sec) && sec >= 0 && sec < 60) {
      return Math.round((m * 60 + sec) * 10) / 10;
    }
  } else if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const sec = Number(parts[2]);
    if (Number.isInteger(h) && h >= 0 && Number.isInteger(m) && m >= 0 && m < 60 && Number.isFinite(sec) && sec >= 0 && sec < 60) {
      return Math.round((h * 3600 + m * 60 + sec) * 10) / 10;
    }
  }
  return null;
}

// ------------------------------------------------------------------ 1. HTML5 Video Adapter

export class Html5VideoAdapter implements VideoPlayerAdapter {
  private el: HTMLVideoElement;
  private listeners = new Set<(state: VideoPlaybackState) => void>();
  private fallbackDuration: number;
  private errorMessage: string | null = null;
  private timer: number | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(el: HTMLVideoElement, fallbackDuration = 0) {
    this.el = el;
    this.fallbackDuration = fallbackDuration;

    const emit = () => this.notify();
    const onError = () => {
      this.errorMessage = 'Không thể phát nguồn video này. Vui lòng kiểm tra kết nối mạng hoặc quyền truy cập tệp.';
      this.notify();
    };

    const events: Array<[string, EventListener]> = [
      ['loadedmetadata', emit],
      ['durationchange', emit],
      ['timeupdate', emit],
      ['play', emit],
      ['playing', emit],
      ['pause', emit],
      ['ended', emit],
      ['ratechange', emit],
      ['volumechange', emit],
      ['seeked', emit],
      ['error', onError],
    ];

    events.forEach(([name, fn]) => {
      el.addEventListener(name, fn);
      this.cleanupFns.push(() => el.removeEventListener(name, fn));
    });

    this.timer = window.setInterval(() => {
      if (!this.el.paused && !this.el.ended) {
        this.notify();
      }
    }, 180);
  }

  private snapshot(): VideoPlaybackState {
    const rawDur = this.el.duration;
    const duration = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : this.fallbackDuration;
    return {
      ready: this.el.readyState >= 1 || duration > 0,
      playing: !this.el.paused && !this.el.ended,
      ended: this.el.ended,
      currentTime: Number.isFinite(this.el.currentTime) ? this.el.currentTime : 0,
      duration,
      playbackRate: this.el.playbackRate || 1,
      volume: this.el.volume ?? 1,
      muted: Boolean(this.el.muted),
      error: this.errorMessage,
    };
  }

  private notify() {
    const state = this.snapshot();
    this.listeners.forEach((fn) => fn(state));
  }

  getCurrentTime(): number {
    return Number.isFinite(this.el.currentTime) ? this.el.currentTime : 0;
  }

  getDuration(): number {
    const d = this.el.duration;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }

  isPlaying(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch {
      // Browser autoplay restriction or transient pause interruption
    }
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    const dur = this.getDuration();
    const clamped = Math.max(0, dur > 0 ? Math.min(seconds, dur) : seconds);
    try {
      this.el.currentTime = clamped;
      this.notify();
    } catch {
      // ignore before metadata loaded
    }
  }

  setPlaybackRate(rate: number): void {
    this.el.playbackRate = rate;
    this.notify();
  }

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.el.volume = v;
    if (v > 0 && this.el.muted) this.el.muted = false;
    this.notify();
  }

  setMuted(muted: boolean): void {
    this.el.muted = muted;
    this.notify();
  }

  subscribe(listener: (state: VideoPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.listeners.clear();
  }
}

// ------------------------------------------------------------------ 2. YouTube IFrame Player Adapter

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

function loadYouTubeIframeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Không tải được trình phát YouTube (hết thời gian chờ).'));
    }, 10000);

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      prevReady?.();
      resolve(window.YT);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        ytApiPromise = null;
        reject(new Error('Không kết nối được máy chủ YouTube.'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

export class YouTubeIframeAdapter implements VideoPlayerAdapter {
  private player: any = null;
  private ready = false;
  private playing = false;
  private ended = false;
  private rate = 1;
  private vol = 1;
  private muted = false;
  private fallbackDuration: number;
  private errorMessage: string | null = null;
  private listeners = new Set<(state: VideoPlaybackState) => void>();
  private timer: number | null = null;
  private destroyed = false;
  private lastNotifiedTime = -1;
  private lastNotifiedDuration = -1;

  constructor(containerEl: HTMLElement, videoId: string, startSeconds = 0, fallbackDuration = 0) {
    this.fallbackDuration = fallbackDuration;

    const applyIframePolicies = (iframe: HTMLIFrameElement | null | undefined) => {
      if (!iframe) return;
      iframe.title = 'Trình phát video bài giảng YouTube';
      iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.style.display = 'block';
    };

    const mountPlayer = (YT: any, attempt: 0 | 1) => {
      if (this.destroyed) return;
      try {
        this.player?.destroy?.();
      } catch {
        // ignore previous player teardown
      }
      this.player = null;
      this.ready = false;

      containerEl.innerHTML = '';
      const hostDiv = document.createElement('div');
      containerEl.appendChild(hostDiv);

      const start = Math.max(0, Math.floor(startSeconds || 0));
      const playerVars: Record<string, any> = {
        playsinline: 1,
        rel: 0,
        controls: 1,
        enablejsapi: 1,
      };
      if (start > 0) playerVars.start = start;
      if (attempt === 0 && typeof window !== 'undefined' && window.location?.origin) {
        playerVars.origin = window.location.origin;
      }

      this.player = new YT.Player(hostDiv, {
        host: attempt === 0 ? 'https://www.youtube.com' : 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        videoId,
        playerVars,
        events: {
          onReady: () => {
            if (this.destroyed) return;
            applyIframePolicies(this.player?.getIframe?.() || containerEl.querySelector('iframe'));
            this.ready = true;
            this.errorMessage = null;
            this.lastNotifiedTime = this.getCurrentTime();
            this.lastNotifiedDuration = this.getDuration();
            this.notify();
            if (attempt === 1) {
              try {
                this.player?.playVideo?.();
              } catch {
                // ignore autoplay guard
              }
            }
          },
          onStateChange: (ev: any) => {
            if (this.destroyed) return;
            const st = Number(ev?.data);
            this.playing = st === YT.PlayerState.PLAYING;
            this.ended = st === YT.PlayerState.ENDED;
            if (this.playing) this.errorMessage = null;
            this.lastNotifiedTime = this.getCurrentTime();
            this.lastNotifiedDuration = this.getDuration();
            this.notify();
          },
          onPlaybackRateChange: (ev: any) => {
            if (this.destroyed) return;
            this.rate = Number(ev?.data) || 1;
            this.notify();
          },
          onError: (ev: any) => {
            if (this.destroyed) return;
            const code = Number(ev?.data);
            // Thử lại tự động không kèm origin nếu trình duyệt/môi trường cục bộ bị YouTube chặn ở lượt đầu
            if (attempt === 0 && (code === 101 || code === 150 || code === 153)) {
              mountPlayer(YT, 1);
              return;
            }
            if (code === 101 || code === 150 || code === 153) {
              this.errorMessage =
                'Chủ sở hữu bản quyền video (ví dụ kênh âm nhạc/VEVO) đã tắt phát nhúng ngoài YouTube. Bạn có thể mở xem trên YouTube và trả lời các mốc câu hỏi ngay bên dưới.';
            } else {
              this.errorMessage = 'Không phát được video YouTube này ngay trong trang.';
            }
            this.playing = false;
            this.notify();
          },
        },
      });

      applyIframePolicies(this.player?.getIframe?.() || containerEl.querySelector('iframe'));
    };

    loadYouTubeIframeApi()
      .then((YT) => {
        if (this.destroyed) return;
        mountPlayer(YT, 0);

        this.timer = window.setInterval(() => {
          if (!this.ready || this.destroyed || !this.player) return;
          let rawState = -1;
          try {
            if (typeof this.player.getPlayerState === 'function') {
              rawState = Number(this.player.getPlayerState());
            }
          } catch {
            rawState = -1;
          }
          const nowPlaying = rawState === 1;
          const nowEnded = rawState === 0;
          const cur = this.getCurrentTime();
          const dur = this.getDuration();
          const changed =
            nowPlaying !== this.playing ||
            nowEnded !== this.ended ||
            Math.abs(cur - this.lastNotifiedTime) >= 0.1 ||
            Math.abs(dur - this.lastNotifiedDuration) >= 0.5;
          this.playing = nowPlaying;
          this.ended = nowEnded;
          if (nowPlaying || changed) {
            this.lastNotifiedTime = cur;
            this.lastNotifiedDuration = dur;
            this.notify();
          }
        }, 120);
      })
      .catch((err) => {
        if (this.destroyed) return;
        this.errorMessage = err instanceof Error ? err.message : 'Không tải được YouTube.';
        this.notify();
      });
  }

  private snapshot(): VideoPlaybackState {
    return {
      ready: this.ready,
      playing: this.playing,
      ended: this.ended,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      playbackRate: this.rate,
      volume: this.vol,
      muted: this.muted,
      error: this.errorMessage,
    };
  }

  private notify() {
    const st = this.snapshot();
    this.listeners.forEach((fn) => fn(st));
  }

  getCurrentTime(): number {
    try {
      const t = this.ready && this.player?.getCurrentTime ? Number(this.player.getCurrentTime()) : 0;
      return Number.isFinite(t) && t >= 0 ? t : 0;
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    try {
      const d = this.ready && this.player?.getDuration ? Number(this.player.getDuration()) : 0;
      return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
    } catch {
      return this.fallbackDuration;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    try {
      if (this.ready && this.player?.playVideo) this.player.playVideo();
    } catch {
      // ignore
    }
  }

  pause(): void {
    try {
      this.playing = false;
      if (this.ready && this.player?.pauseVideo) {
        this.player.pauseVideo();
      }
      this.notify();
    } catch {
      // ignore
    }
  }

  seek(seconds: number): void {
    try {
      if (this.ready && this.player?.seekTo) {
        this.player.seekTo(Math.max(0, seconds), true);
        this.notify();
      }
    } catch {
      // ignore
    }
  }

  setPlaybackRate(rate: number): void {
    try {
      this.rate = rate;
      if (this.ready && this.player?.setPlaybackRate) this.player.setPlaybackRate(rate);
      this.notify();
    } catch {
      // ignore
    }
  }

  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    this.vol = v;
    try {
      if (this.ready && this.player?.setVolume) {
        this.player.setVolume(Math.round(v * 100));
        if (v > 0 && this.muted && this.player?.unMute) {
          this.player.unMute();
          this.muted = false;
        }
      }
      this.notify();
    } catch {
      // ignore
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (this.ready && this.player) {
        if (muted && this.player.mute) this.player.mute();
        if (!muted && this.player.unMute) this.player.unMute();
      }
      this.notify();
    } catch {
      // ignore
    }
  }

  subscribe(listener: (state: VideoPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    try {
      if (this.player?.destroy) this.player.destroy();
    } catch {
      // ignore
    }
    this.player = null;
    this.listeners.clear();
  }
}

// ------------------------------------------------------------------ 3. Trích xuất thời lượng & ảnh thu nhỏ cục bộ khi giảng viên chọn tệp

export async function extractLocalVideoMetadata(
  file: File
): Promise<{ durationSeconds: number | null; thumbnailDataUrl: string | null }> {
  if (typeof document === 'undefined') return { durationSeconds: null, thumbnailDataUrl: null };
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let done = false;
    const finish = (durationSeconds: number | null, thumbnailDataUrl: string | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      resolve({ durationSeconds, thumbnailDataUrl });
    };

    const timeout = window.setTimeout(() => finish(null, null), 6000);

    video.onerror = () => {
      window.clearTimeout(timeout);
      finish(null, null);
    };

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : null;
      if (!dur) {
        window.clearTimeout(timeout);
        finish(null, null);
        return;
      }
      video.currentTime = Math.min(1.5, Math.max(0.1, dur * 0.1));
    };

    video.onseeked = () => {
      window.clearTimeout(timeout);
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : null;
      try {
        const w = Math.min(480, video.videoWidth || 480);
        const h = Math.round(w * ((video.videoHeight || 270) / (video.videoWidth || 480)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          finish(dur, canvas.toDataURL('image/jpeg', 0.72));
          return;
        }
      } catch {
        // ignore canvas capture failure
      }
      finish(dur, null);
    };

    video.src = objectUrl;
  });
}

// ------------------------------------------------------------------ 4. Chấm thử cục bộ trên RAM cho Chế độ Xem trước (Preview Mode — không ghi CSDL)

const normalizeCompare = (s: string, caseSensitive = false) => {
  const trimmed = String(s || '').trim().replace(/\s+/g, ' ');
  return caseSensitive ? trimmed : trimmed.toLowerCase();
};

export function gradeQuestionInMemory(
  question: QuestionSpec,
  response: Record<string, any>,
  opts: {
    attemptNumber: number;
    maxAttempts: number;
    isRequired: boolean;
    allowSkip: boolean;
    showAnswer: boolean;
    showExplanation: boolean;
  }
): MarkerSubmitResult {
  const qType = question.question_type;
  const maxPoints = Number(question.points ?? 1);
  const key = question.answer_key || {};
  let isCorrect = false;
  let feedback = '';

  if (qType === 'SINGLE_CHOICE' || qType === 'TRUE_FALSE') {
    const sel = String(response.selected_option_id ?? response.option_id ?? '').trim();
    const correctIds =
      key.correct_option_ids ||
      (question.options || []).filter((o) => o.is_correct).map((o) => o.id);
    isCorrect = Boolean(sel) && correctIds.includes(sel);
    const picked = (question.options || []).find((o) => o.id === sel);
    feedback =
      picked?.feedback ||
      (isCorrect
        ? question.correct_feedback || 'Chính xác! Bạn đã chọn đúng đáp án.'
        : question.wrong_feedback || 'Chưa chính xác. Hãy xem lại nội dung vừa học nhé.');
  } else if (qType === 'MULTIPLE_CHOICE') {
    const sel = Array.from(new Set((response.selected_option_ids || []).map(String))).sort();
    const cor = Array.from(
      new Set((key.correct_option_ids || (question.options || []).filter((o) => o.is_correct).map((o) => o.id)).map(String))
    ).sort();
    isCorrect = sel.length === cor.length && sel.every((v, idx) => v === cor[idx]);
    feedback = isCorrect
      ? question.correct_feedback || 'Chính xác! Bạn đã chọn đầy đủ các phương án đúng.'
      : question.wrong_feedback || 'Chưa đầy đủ hoặc có phương án chưa đúng.';
  } else if (qType === 'FILL_BLANK') {
    const candidate = normalizeCompare(response.text || '', Boolean(key.case_sensitive));
    const accepted = (key.accepted_texts || []).map((t) => normalizeCompare(t, Boolean(key.case_sensitive)));
    isCorrect = Boolean(candidate) && accepted.includes(candidate);
    feedback = isCorrect
      ? question.correct_feedback || 'Chính xác!'
      : question.wrong_feedback || 'Đáp án điền vào chưa khớp.';
  } else if (qType === 'SHORT_ANSWER') {
    const txt = String(response.text || '').trim();
    const lowered = normalizeCompare(txt, false);
    const kws = (key.keywords || []).map((k) => normalizeCompare(k, false)).filter(Boolean);
    isCorrect = Boolean(txt) && (kws.length === 0 || kws.every((k) => lowered.includes(k)));
    feedback = isCorrect
      ? question.correct_feedback || 'Đã ghi nhận câu trả lời có đầy đủ ý chính!'
      : question.wrong_feedback || 'Câu trả lời chưa nêu đủ các từ khóa trọng tâm.';
  }

  const canRetry = !isCorrect && (opts.maxAttempts === 0 || opts.attemptNumber < opts.maxAttempts);
  const canContinue = isCorrect || !opts.isRequired || !canRetry || opts.allowSkip;
  const revealAns = opts.showAnswer && (isCorrect || !canRetry);

  return {
    deduplicated: false,
    attempt_number: opts.attemptNumber,
    is_correct: isCorrect,
    grading_status: 'GRADED',
    earned_points: isCorrect ? maxPoints : 0,
    max_points: maxPoints,
    max_attempts: opts.maxAttempts,
    can_retry: canRetry,
    can_continue: canContinue,
    feedback,
    ...(opts.showExplanation && question.explanation ? { explanation: question.explanation } : {}),
    ...(revealAns ? { correct_answer: key } : {}),
  };
}
