import React, { useState } from 'react';
import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, isValidYouTubeVideoId } from '../../../shared/youtube.mjs';
import {
  BlockDisplayConfig,
  LessonBlock,
  MarkerSubmitResult,
  QuestionSpec,
  QuizBlockState,
  QuizKind,
  QuizSubmitResult,
  Resource,
  StudentVideoMarker,
  VideoQuizMarker,
  VideoWatchProgress,
} from './api';
import { InteractiveVideoPlayer } from './studio/InteractiveVideoPlayer';
import { gradeQuestionInMemory } from './studio/videoAdapter';
import { Btn, SmartImage, Tone } from './ui';

/**
 * Trình phát YouTube an toàn (dành cho khối youtube tĩnh không gắn mốc câu hỏi tương tác).
 */
export const YouTubeEmbed: React.FC<{
  videoId: string;
  title?: string;
  startSeconds?: number;
  description?: string;
}> = ({ videoId, title, startSeconds = 0, description }) => {
  const [loaded, setLoaded] = useState(false);
  if (!isValidYouTubeVideoId(videoId)) {
    return <div className="t-notice t-notice--danger">Video không hợp lệ.</div>;
  }
  const watchUrl = buildYouTubeWatchUrl(videoId, startSeconds);
  return (
    <figure style={{ margin: 0 }}>
      {title && <strong style={{ display: 'block', marginBottom: 8 }}>{title}</strong>}
      <div className="t-video">
        {!loaded && (
          <button
            type="button"
            onClick={() => setLoaded(true)}
            aria-label={`Phát video ${title || ''}`}
            style={{
              position: 'absolute',
              inset: 0,
              border: 0,
              padding: 0,
              cursor: 'pointer',
              background: 'transparent',
            }}
          >
            <img
              src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 72,
                height: 52,
                borderRadius: 12,
                background: 'var(--primitive-obsidian-950)',
                color: 'var(--primitive-white)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              ▶
            </span>
          </button>
        )}
        {loaded && (
          <iframe
            src={`${buildYouTubeEmbedUrl(videoId, startSeconds)}&autoplay=1`}
            title={title || 'Video YouTube'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        )}
      </div>
      <figcaption className="t-video-caption">
        <span>{description}</span>
        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
          Mở trên YouTube ↗
        </a>
      </figcaption>
    </figure>
  );
};

export const CALLOUT_TITLES: Record<string, string> = {
  learning_objective: 'Mục tiêu',
  definition: 'Định nghĩa',
  remember: 'Ghi nhớ',
  note: 'Lưu ý',
  warning: 'Cảnh báo',
  exam_tip: 'Mẹo làm bài',
  summary: 'Tóm tắt',
};

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  PRE_LESSON: 'Khởi động đầu bài',
  MID_LESSON: 'Kiểm tra giữa bài',
  POST_LESSON: 'Tổng kết cuối bài',
  QUICK_CHECK: 'Câu hỏi kiểm tra nhanh',
  PRACTICE: 'Tự luyện tập',
};

export const SUBMISSION_TYPE_LABELS: Record<string, string> = {
  TEXT: 'Soạn văn bản trực tiếp',
  FILE: 'Nộp tệp đính kèm',
  BOTH: 'Văn bản hoặc tệp đính kèm',
  EXTERNAL: 'Nộp qua liên kết bài tập',
};

export interface RenderCtx {
  onDownload?: (resourceId: string) => void;
  resources?: Record<
    string,
    Partial<Resource> & { title: string; file_name: string | null; available: boolean; stream_url?: string | null }
  >;
  onCheck?: (blockId: string, optionId: string) => Promise<{ correct: boolean; feedback: string }>;
  answers?: Record<string, string>;
  onAnswer?: (blockId: string, optionId: string) => void;
  previewMode?: boolean;
  videoMarkers?: Array<StudentVideoMarker | VideoQuizMarker>;
  videoProgress?: Record<string, VideoWatchProgress>;
  quizStates?: Record<string, QuizBlockState>;
  onSaveVideoProgress?: (payload: {
    block_id: string;
    last_position_sec: number;
    watched_seconds: number;
    duration_sec: number;
  }) => Promise<unknown>;
  onSubmitVideoMarker?: (
    markerId: string,
    payload: { idempotency_key: string; response: Record<string, any> }
  ) => Promise<MarkerSubmitResult>;
  onSubmitQuizBlock?: (
    blockId: string,
    payload: { idempotency_key: string; responses: Record<string, Record<string, any>> }
  ) => Promise<QuizSubmitResult>;
}

const LegacyQuestion: React.FC<{ block: LessonBlock; ctx: RenderCtx }> = ({ block, ctx }) => {
  const [result, setResult] = useState<{ optionId: string; correct: boolean; feedback: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (optionId: string) => {
    ctx.onAnswer?.(block.id, optionId);
    if (ctx.onCheck && !ctx.previewMode) {
      setBusy(true);
      try {
        const r = await ctx.onCheck(block.id, optionId);
        setResult({ optionId, ...r });
      } finally {
        setBusy(false);
      }
    } else {
      const o = (block.content.options || []).find((x: any) => x.id === optionId);
      setResult({
        optionId,
        correct: Boolean(o?.is_correct),
        feedback: o?.feedback || (o?.is_correct ? 'Chính xác!' : 'Chưa đúng.'),
      });
    }
  };
  return (
    <div className="t-question">
      <strong>{block.content.question}</strong>
      {(block.content.options || []).map((o: any) => (
        <button
          key={o.id}
          type="button"
          className="t-option"
          disabled={busy}
          aria-pressed={result?.optionId === o.id}
          data-result={result && result.optionId === o.id ? (result.correct ? 'correct' : 'wrong') : undefined}
          onClick={() => choose(o.id)}
        >
          {o.text}
        </button>
      ))}
      {result && (
        <span
          role="status"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: result.correct ? 'var(--status-success)' : 'var(--status-danger)',
          }}
        >
          {result.correct ? '✓ ' : '✗ '}
          {result.feedback}
        </span>
      )}
    </div>
  );
};

const StandaloneQuizBlockView: React.FC<{ block: LessonBlock; ctx: RenderCtx }> = ({ block, ctx }) => {
  const c = block.content || {};
  const questions: QuestionSpec[] = Array.isArray(c.questions) ? c.questions : [];
  const initialState = ctx.quizStates?.[block.id];

  const [responses, setResponses] = useState<Record<string, Record<string, any>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(initialState?.attempts_used || 0);

  const maxAttempts = Number(c.max_attempts ?? 3);
  const passScorePct = Number(c.pass_score_pct ?? 60);
  const quizKind = (c.quiz_kind as QuizKind) || 'QUICK_CHECK';
  const hasPriorLock = Boolean(initialState && !initialState.can_retry && initialState.attempts_used > 0);
  const canRetry = result ? result.can_retry : initialState ? initialState.can_retry : true;
  const passed = result ? result.passed : Boolean(initialState?.passed);
  const quizLocked = Boolean((result && !result.can_retry) || (!result && hasPriorLock));

  const setQuestionResp = (qKey: string, val: Record<string, any>) => {
    setResponses((prev) => ({ ...prev, [qKey]: val }));
    if (result?.can_retry) setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const qKey = q.id || `q_${i + 1}`;
      const r = responses[qKey] || {};
      if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'TRUE_FALSE') {
        if (!r.selected_option_id) {
          setErrorMsg(`Vui lòng chọn đáp án cho câu ${i + 1}.`);
          return;
        }
      } else if (q.question_type === 'MULTIPLE_CHOICE') {
        if (!Array.isArray(r.selected_option_ids) || r.selected_option_ids.length === 0) {
          setErrorMsg(`Vui lòng chọn ít nhất một đáp án cho câu ${i + 1}.`);
          return;
        }
      } else if (!String(r.text || '').trim()) {
        setErrorMsg(`Vui lòng nhập câu trả lời cho câu ${i + 1}.`);
        return;
      }
    }

    const nextAtt = attemptsUsed + 1;

    if (ctx.previewMode || !ctx.onSubmitQuizBlock) {
      let earned = 0;
      let total = 0;
      const items = questions.map((q, idx) => {
        const qKey = q.id || `q_${idx + 1}`;
        const mem = gradeQuestionInMemory(q, responses[qKey] || {}, {
          attemptNumber: nextAtt,
          maxAttempts,
          isRequired: Boolean(c.is_required),
          allowSkip: !c.is_required,
          showAnswer: c.show_answer_after_submit !== false,
          showExplanation: c.show_explanation !== false,
        });
        earned += mem.earned_points || 0;
        total += mem.max_points || 1;
        return {
          question_id: qKey,
          is_correct: mem.is_correct,
          grading_status: 'GRADED',
          earned_points: mem.earned_points || 0,
          max_points: mem.max_points || 1,
          feedback: mem.feedback,
          explanation: mem.explanation,
          correct_answer: mem.correct_answer,
        };
      });
      const pct = total > 0 ? Math.round((earned / total) * 100) : 100;
      const isPassed = pct >= passScorePct;
      const allowMore = !isPassed && (maxAttempts === 0 || nextAtt < maxAttempts);
      setAttemptsUsed(nextAtt);
      setResult({
        deduplicated: false,
        submission_id: `preview_${nextAtt}`,
        attempt_number: nextAtt,
        is_correct: isPassed,
        earned_points: earned,
        max_points: total,
        score_pct: pct,
        pass_score_pct: passScorePct,
        passed: isPassed,
        max_attempts: maxAttempts,
        can_retry: allowMore,
        items,
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await ctx.onSubmitQuizBlock(block.id, {
        idempotency_key: `quiz:${block.id}:att:${nextAtt}`,
        responses,
      });
      setAttemptsUsed(res.attempt_number || nextAtt);
      setResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không nộp được bài kiểm tra. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="ls-standalone-quiz" onSubmit={handleSubmit}>
      <div className="ls-standalone-quiz__head">
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <Tone tone="info">{QUIZ_KIND_LABELS[quizKind] || 'Bài kiểm tra'}</Tone>
            {c.is_required && <Tone tone="warning">Bắt buộc đạt {passScorePct}%</Tone>}
            {passed && <Tone tone="success">✓ Đã đạt yêu cầu</Tone>}
            {!passed && quizLocked && <Tone tone="neutral">Đã hết lượt làm bài</Tone>}
          </div>
          <h3 style={{ margin: 0, fontSize: 18 }}>{c.title || 'Bài kiểm tra kiến thức'}</h3>
          {c.description && (
            <p className="t-sub" style={{ margin: '4px 0 0' }}>
              {c.description}
            </p>
          )}
        </div>
        <span className="t-sub tabular-nums">
          {questions.length} câu · Lượt làm: {attemptsUsed}/{maxAttempts === 0 ? '∞' : maxAttempts}
        </span>
      </div>

      {questions.map((q, qi) => {
        const qKey = q.id || `q_${qi + 1}`;
        const r = responses[qKey] || {};
        const itemRes = result?.items.find((it) => it.question_id === qKey);
        const locked = quizLocked;

        return (
          <div key={qKey} className="ls-quiz-qcard">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>
                Câu {qi + 1}. {q.prompt}
              </strong>
              <span className="t-sub tabular-nums">{q.points || 1} đ</span>
            </div>

            {(q.question_type === 'SINGLE_CHOICE' || q.question_type === 'TRUE_FALSE') && (
              <div className="ls-quiz-options">
                {(q.options || []).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="t-option"
                    disabled={submitting || locked}
                    aria-pressed={r.selected_option_id === opt.id}
                    onClick={() => setQuestionResp(qKey, { selected_option_id: opt.id })}
                  >
                    {opt.text}
                  </button>
                ))}
              </div>
            )}

            {q.question_type === 'MULTIPLE_CHOICE' && (
              <div className="ls-quiz-options">
                {(q.options || []).map((opt) => {
                  const selIds: string[] = Array.isArray(r.selected_option_ids) ? r.selected_option_ids : [];
                  const checked = selIds.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className="t-option"
                      disabled={submitting || locked}
                      aria-pressed={checked}
                      onClick={() =>
                        setQuestionResp(qKey, {
                          selected_option_ids: checked
                            ? selIds.filter((x) => x !== opt.id)
                            : [...selIds, opt.id],
                        })
                      }
                    >
                      {checked ? '☑ ' : '☐ '}
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            )}

            {q.question_type === 'FILL_BLANK' && (
              <input
                className="t-input"
                disabled={submitting || locked}
                value={r.text || ''}
                onChange={(e) => setQuestionResp(qKey, { text: e.target.value })}
                placeholder="Nhập câu trả lời…"
                aria-label={`Câu trả lời câu ${qi + 1}`}
              />
            )}

            {q.question_type === 'SHORT_ANSWER' && (
              <textarea
                className="t-input"
                rows={3}
                disabled={submitting || locked}
                value={r.text || ''}
                onChange={(e) => setQuestionResp(qKey, { text: e.target.value })}
                placeholder="Trình bày câu trả lời…"
                aria-label={`Tự luận câu ${qi + 1}`}
              />
            )}

            {itemRes && (
              <div className={`ls-quiz-feedback ${itemRes.is_correct ? 'is-correct' : 'is-wrong'}`}>
                <strong>{itemRes.is_correct ? '✓ Chính xác' : '✗ Chưa chính xác'}</strong>
                <span>{itemRes.feedback}</span>
                {itemRes.explanation && (
                  <span className="t-sub" style={{ display: 'block', marginTop: 4 }}>
                    Giải thích: {itemRes.explanation}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {errorMsg && (
        <p className="t-field__error" role="alert">
          {errorMsg}
        </p>
      )}

      {result && (
        <div className={`ls-quiz-feedback ${result.passed ? 'is-correct' : 'is-wrong'}`} role="status">
          <strong className="tabular-nums">
            Kết quả: {result.earned_points}/{result.max_points} điểm ({result.score_pct}%) —{' '}
            {result.passed ? 'Đạt yêu cầu!' : `Cần tối thiểu ${result.pass_score_pct}%`}
          </strong>
        </div>
      )}

      <div className="t-actions" style={{ justifyContent: 'flex-end' }}>
        {!quizLocked && canRetry && (
          <Btn type="submit" variant="primary" loading={submitting}>
            {result || attemptsUsed > 0 ? 'Làm lại bài kiểm tra' : 'Nộp bài kiểm tra'}
          </Btn>
        )}
      </div>
    </form>
  );
};

const renderCoreBlock = (block: LessonBlock, ctx: RenderCtx): React.ReactNode => {
  const c = block.content || {};
  switch (block.block_type) {
    case 'heading':
      return c.level === 3 ? <h3>{c.text}</h3> : <h2>{c.text}</h2>;
    case 'paragraph':
      return <p>{c.text}</p>;
    case 'youtube': {
      const blockMarkers = (ctx.videoMarkers || []).filter((m) => m.block_id === block.id);
      if (blockMarkers.length > 0 || ctx.onSaveVideoProgress || ctx.previewMode) {
        return (
          <InteractiveVideoPlayer
            blockId={block.id}
            sourceType="YOUTUBE"
            videoId={c.video_id}
            title={c.title}
            description={c.description}
            startSeconds={c.start_seconds || 0}
            markers={blockMarkers}
            initialProgress={ctx.videoProgress?.[block.id]}
            mode={ctx.previewMode ? 'PREVIEW' : 'LEARNER'}
            onSaveProgress={ctx.onSaveVideoProgress}
            onSubmitMarker={ctx.onSubmitVideoMarker}
          />
        );
      }
      return (
        <YouTubeEmbed
          videoId={c.video_id}
          title={c.title}
          description={c.description}
          startSeconds={c.start_seconds}
        />
      );
    }
    case 'video': {
      const sourceType = (c.source_type || 'YOUTUBE') as 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL';
      const res = c.resource_id ? ctx.resources?.[c.resource_id] : undefined;
      const streamUrl = c.stream_url || res?.stream_url || null;
      const blockMarkers = (ctx.videoMarkers || []).filter((m) => m.block_id === block.id);
      return (
        <InteractiveVideoPlayer
          blockId={block.id}
          sourceType={sourceType}
          streamUrl={streamUrl}
          videoId={c.video_id}
          directUrl={c.direct_url}
          thumbnailUrl={c.thumbnail_url || res?.thumbnail_url}
          title={c.title || res?.title}
          description={c.description}
          startSeconds={c.start_seconds || 0}
          fallbackDuration={Number(c.duration_seconds || res?.duration_seconds || 0)}
          allowSeekingAhead={c.allow_seeking_ahead !== false}
          markers={blockMarkers}
          initialProgress={ctx.videoProgress?.[block.id]}
          mode={ctx.previewMode ? 'PREVIEW' : 'LEARNER'}
          onSaveProgress={ctx.onSaveVideoProgress}
          onSubmitMarker={ctx.onSubmitVideoMarker}
        />
      );
    }
    case 'pdf': {
      const res = c.resource_id ? ctx.resources?.[c.resource_id] : undefined;
      const pdfUrl = c.stream_url || res?.stream_url || null;
      const allowDownload = c.allow_download !== false;
      const iframeSrc = pdfUrl && !allowDownload && !pdfUrl.includes('#') ? `${pdfUrl}#toolbar=0` : pdfUrl;
      return (
        <div className="ls-pdf-viewer">
          <div className="ls-pdf-viewer__head">
            <div>
              <strong>📕 {c.title || res?.title || 'Tài liệu PDF'}</strong>
              {c.description && <span className="t-sub" style={{ display: 'block' }}>{c.description}</span>}
            </div>
            {allowDownload && ctx.onDownload && c.resource_id && (
              <Btn small onClick={() => ctx.onDownload!(c.resource_id)}>
                Tải PDF xuống
              </Btn>
            )}
          </div>
          {iframeSrc ? (
            <iframe
              src={iframeSrc}
              title={c.title || res?.title || 'Tài liệu PDF'}
              className="ls-pdf-frame"
            />
          ) : (
            <div className="t-sub" style={{ padding: '16px' }}>
              Tài liệu PDF đã sẵn sàng trong kho học liệu khóa học.
            </div>
          )}
        </div>
      );
    }
    case 'image':
      return (
        <figure>
          <SmartImage
            src={c.url}
            alt={c.alt || ''}
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 'var(--radius-md)', display: 'block' }}
            fallback={
              <div className="t-img-fallback-box" role="img" aria-label={c.alt || 'Hình ảnh minh họa'}>
                <span>{c.alt ? `Hình minh họa: ${c.alt}` : 'Không tải được hình ảnh từ đường dẫn đã gắn.'}</span>
              </div>
            }
          />
          {c.caption && <figcaption>{c.caption}</figcaption>}
        </figure>
      );
    case 'file': {
      const r = ctx.resources?.[c.resource_id];
      const available = r ? r.available !== false : true;
      return (
        <div className="t-file">
          <span>
            📄 <strong>{c.title || r?.title || 'Tài liệu đính kèm'}</strong>
            {r?.file_name && <span className="t-sub" style={{ display: 'block' }}>{r.file_name}</span>}
            {c.description && <span className="t-sub" style={{ display: 'block' }}>{c.description}</span>}
          </span>
          {ctx.onDownload && available ? (
            <button type="button" className="t-btn t-btn--small" onClick={() => ctx.onDownload!(c.resource_id)}>
              Tải xuống
            </button>
          ) : (
            <span className="t-sub">{available ? 'Sẵn sàng tải xuống' : 'Tài liệu đã bị gỡ'}</span>
          )}
        </div>
      );
    }
    case 'table':
      return (
        <div className="t-table-wrap">
          <table className="t-table">
            {c.has_header && c.rows?.[0] && (
              <thead>
                <tr>
                  {c.rows[0].map((cell: string, i: number) => (
                    <th key={i}>{cell}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(c.has_header ? (c.rows || []).slice(1) : c.rows || []).map((row: string[], ri: number) => (
                <tr key={ri}>
                  {row.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'math':
      return (
        <div className="t-math" aria-label="Công thức toán học">
          {c.latex}
        </div>
      );
    case 'code':
    case 'code_block':
      return (
        <pre aria-label={`Mã nguồn ${c.language || ''}`}>
          <code>{c.code}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote>
          {c.text}
          {c.cite && <span className="t-sub" style={{ display: 'block', marginTop: 4 }}>— {c.cite}</span>}
        </blockquote>
      );
    case 'callout':
      return (
        <div className="t-callout">
          <strong>{c.title || CALLOUT_TITLES[c.variant] || 'Lưu ý'}</strong>
          <span style={{ whiteSpace: 'pre-wrap' }}>{c.text}</span>
        </div>
      );
    case 'link':
      return (
        <div className="ls-link-card">
          <div>
            🔗{' '}
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
              <strong>{c.label || c.url}</strong>
            </a>
            {c.description && (
              <span className="t-sub" style={{ display: 'block', marginTop: 4 }}>
                {c.description}
              </span>
            )}
          </div>
          <a
            className="t-btn t-btn--small"
            href={c.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            Mở liên kết ↗
          </a>
        </div>
      );
    case 'quiz':
      return <StandaloneQuizBlockView block={block} ctx={ctx} />;
    case 'review_question':
    case 'inline_mcq':
      return <LegacyQuestion block={block} ctx={ctx} />;
    case 'assignment':
    case 'assignment_link':
      return (
        <div className="ls-assignment-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>📝 Bài tập: {c.title}</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {c.max_score && (
                <Tone tone="info">
                  <span className="tabular-nums">Thang điểm {c.max_score}</span>
                </Tone>
              )}
              {c.submission_type && (
                <Tone tone="neutral">{SUBMISSION_TYPE_LABELS[c.submission_type] || c.submission_type}</Tone>
              )}
            </div>
          </div>
          {c.description && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{c.description}</p>}
          {c.instructions && (
            <div className="t-sub" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
              <strong>Hướng dẫn nộp bài:</strong> {c.instructions}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            {c.due_at ? (
              <span className="t-sub tabular-nums">Hạn nộp: {c.due_at}</span>
            ) : (
              <span className="t-sub">Nộp theo hướng dẫn của giảng viên phụ trách lớp</span>
            )}
            {c.url && (
              <a className="t-btn t-btn--small t-btn--primary" href={c.url} target="_blank" rel="noopener noreferrer nofollow">
                Mở trang nộp bài ↗
              </a>
            )}
          </div>
        </div>
      );
    case 'embed':
      return (
        <figure className="ls-embed-box">
          <div className="ls-embed-box__head">
            <strong>🧩 {c.title || 'Học liệu tương tác'}</strong>
            {c.provider && <Tone tone="info">{c.provider}</Tone>}
          </div>
          <iframe
            src={c.embed_url}
            title={c.title || 'Nội dung nhúng tương tác'}
            style={{ width: '100%', height: Number(c.height) || 420, border: 0, display: 'block' }}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
          {c.caption && <figcaption style={{ padding: '8px 16px' }}>{c.caption}</figcaption>}
        </figure>
      );
    case 'step_by_step_solution':
      return (
        <div className="t-callout">
          <strong>{c.problem}</strong>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {(c.steps || []).map((s: any, i: number) => (
              <li key={i}>
                <strong>{s.title}:</strong> {s.explanation}
              </li>
            ))}
          </ol>
        </div>
      );
    default:
      return null;
  }
};

export const BlockView: React.FC<{ block: LessonBlock; ctx?: RenderCtx }> = ({ block, ctx = {} }) => {
  const c = block.content || {};
  const displayCfg: BlockDisplayConfig | undefined =
    typeof c.display === 'object' && c.display !== null ? (c.display as BlockDisplayConfig) : undefined;

  if (displayCfg?.hidden) return null;

  const core = renderCoreBlock(block, ctx);
  if (!core) return null;

  const classCustomBadge =
    block.origin === 'CLASS_CUSTOM' ? (
      <div style={{ marginBottom: 8 }}>
        <Tone tone="info">Nội dung bổ sung riêng cho lớp</Tone>
      </div>
    ) : null;

  if (displayCfg?.collapsible) {
    return (
      <details
        className={`ls-collapsible-block ${displayCfg.highlight ? 'is-highlight' : ''}`}
        open={!displayCfg.default_collapsed}
      >
        <summary className="ls-collapsible-block__summary">
          <span>{c.title || c.text?.slice(0, 60) || 'Nhấn để mở rộng nội dung'}</span>
          {block.origin === 'CLASS_CUSTOM' && <Tone tone="info">Riêng cho lớp</Tone>}
        </summary>
        <div className="ls-collapsible-block__body">{core}</div>
      </details>
    );
  }

  if (displayCfg?.highlight || block.origin === 'CLASS_CUSTOM') {
    return (
      <div className={`ls-block-surface ${displayCfg?.highlight ? 'is-highlight' : ''}`}>
        {classCustomBadge}
        {core}
      </div>
    );
  }

  return <>{core}</>;
};

export const BlockList: React.FC<{ blocks: LessonBlock[]; ctx?: RenderCtx }> = ({ blocks, ctx }) => (
  <div className="t-reading">
    {blocks.map((b) => (
      <BlockView key={b.id} block={b} ctx={ctx} />
    ))}
  </div>
);
