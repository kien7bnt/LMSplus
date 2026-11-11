import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerBehavior, QuestionBankItem, VideoQuizMarker } from '../api';
import { Btn, Field, Modal, Tone } from '../ui';
import { InteractiveVideoPlayer } from './InteractiveVideoPlayer';
import { QUESTION_TYPE_LABELS, QuestionBankModal, QuestionForm, createDefaultQuestionSpec } from './QuestionEditorFields';
import { VideoPlayerAdapter, formatTimestamp, parseTimestampInput } from './videoAdapter';

export const MARKER_BEHAVIOR_LABELS: Record<MarkerBehavior, string> = {
  PAUSE_AND_ASK: 'Tạm dừng & hỏi bài',
  PAUSE_OPTIONAL: 'Tạm dừng (tùy chọn)',
  INFO_ONLY: 'Ghi chú kiến thức',
};

export interface VideoQuizTimelineEditorProps {
  blockId: string;
  sourceType: 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL';
  streamUrl?: string | null;
  videoId?: string;
  directUrl?: string;
  thumbnailUrl?: string;
  videoTitle?: string;
  startSeconds?: number;
  fallbackDuration?: number;
  allowSeekingAhead?: boolean;
  courseId: string;
  canEdit: boolean;
  studioMode: 'COURSE' | 'CLASS';
  markers: VideoQuizMarker[];
  inheritedMarkers?: VideoQuizMarker[];
  onChangeMarkers: (nextMarkers: VideoQuizMarker[]) => void;
  onSaveMarkersNow?: (nextMarkers: VideoQuizMarker[]) => Promise<void>;
  savingMarkers?: boolean;
}

export const VideoQuizTimelineEditor: React.FC<VideoQuizTimelineEditorProps> = ({
  blockId,
  sourceType,
  streamUrl,
  videoId,
  directUrl,
  thumbnailUrl,
  videoTitle,
  startSeconds = 0,
  fallbackDuration = 0,
  allowSeekingAhead = true,
  courseId,
  canEdit,
  studioMode,
  markers,
  inheritedMarkers = [],
  onChangeMarkers,
  onSaveMarkersNow,
  savingMarkers = false,
}) => {
  const adapterRef = useRef<VideoPlayerAdapter | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [liveDuration, setLiveDuration] = useState<number>(fallbackDuration || 0);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(markers[0]?.id || null);
  const [manualTimeText, setManualTimeText] = useState<string>('');
  const [selectedTimeText, setSelectedTimeText] = useState<string>('');
  const [timeInputError, setTimeInputError] = useState<string | null>(null);
  const [bankPickerOpen, setBankPickerOpen] = useState<boolean>(false);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);

  const sortedMarkers = useMemo(
    () =>
      [...markers].sort(
        (a, b) => Number(a.timestamp_sec || 0) - Number(b.timestamp_sec || 0) || Number(a.sort_order || 0) - Number(b.sort_order || 0)
      ),
    [markers]
  );

  const sortedInherited = useMemo(
    () =>
      [...inheritedMarkers].sort(
        (a, b) => Number(a.timestamp_sec || 0) - Number(b.timestamp_sec || 0)
      ),
    [inheritedMarkers]
  );

  const maxMarkerSec = useMemo(() => {
    const all = [...sortedMarkers, ...sortedInherited].map((m) => Number(m.timestamp_sec || 0));
    return all.length > 0 ? Math.max(...all) : 0;
  }, [sortedMarkers, sortedInherited]);

  const timelineDuration = Math.max(30, liveDuration || fallbackDuration || 0, maxMarkerSec + 30);

  const selectedMarker = useMemo(
    () => sortedMarkers.find((m) => m.id === selectedMarkerId) || null,
    [sortedMarkers, selectedMarkerId]
  );

  useEffect(() => {
    if (selectedMarker) {
      setSelectedTimeText(formatTimestamp(selectedMarker.timestamp_sec));
      setTimeInputError(null);
    }
  }, [selectedMarker?.id, selectedMarker?.timestamp_sec]);

  useEffect(() => {
    if (selectedMarkerId && !markers.some((m) => m.id === selectedMarkerId)) {
      setSelectedMarkerId(markers[0]?.id || null);
    }
  }, [markers, selectedMarkerId]);

  const updateMarker = (id: string, patch: Partial<VideoQuizMarker>) => {
    const next = markers.map((m) => (m.id === id ? { ...m, ...patch } : m));
    onChangeMarkers(next);
  };

  const createMarkerAt = (sec: number, fromBank?: QuestionBankItem) => {
    adapterRef.current?.pause();
    const clampedSec = Math.max(0, Math.round(sec * 10) / 10);
    const id = `vqm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const questionSpec = fromBank
      ? {
          id: fromBank.id,
          question_id: fromBank.id,
          question_type: fromBank.question_type,
          prompt: fromBank.prompt,
          options: fromBank.options ? fromBank.options.map((o) => ({ ...o })) : [],
          answer_key: fromBank.answer_key ? { ...fromBank.answer_key } : {},
          points: fromBank.points ?? 1,
          explanation: fromBank.explanation || '',
          correct_feedback: fromBank.correct_feedback || '',
          wrong_feedback: fromBank.wrong_feedback || '',
        }
      : createDefaultQuestionSpec('SINGLE_CHOICE');

    const newMarker: VideoQuizMarker = {
      id,
      block_id: blockId,
      origin: studioMode === 'CLASS' ? 'CLASS_CUSTOM' : 'INHERITED',
      timestamp_sec: clampedSec,
      sort_order: markers.length,
      behavior: 'PAUSE_AND_ASK',
      title: fromBank ? 'Câu hỏi kiểm tra nhanh' : `Câu hỏi tại ${formatTimestamp(clampedSec)}`,
      info_body: '',
      question_id: fromBank ? fromBank.id : null,
      question: questionSpec,
      is_required: true,
      allow_skip: false,
      max_attempts: 2,
      show_answer_after_submit: true,
      show_explanation: true,
      allow_review: true,
      save_to_bank: false,
    };

    const next = [...markers, newMarker];
    onChangeMarkers(next);
    setSelectedMarkerId(id);
    adapterRef.current?.seek(clampedSec);
  };

  const handleAddAtCurrentTime = () => {
    const nowSec = adapterRef.current ? adapterRef.current.getCurrentTime() : currentTime;
    createMarkerAt(nowSec);
  };

  const handleAddAtManualTime = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTimestampInput(manualTimeText);
    if (parsed === null) {
      setTimeInputError('Nhập đúng định dạng mm:ss (ví dụ 01:30) hoặc số giây.');
      return;
    }
    if (liveDuration > 0 && parsed > liveDuration) {
      setTimeInputError(`Thời điểm vượt quá độ dài video (${formatTimestamp(liveDuration)}).`);
      return;
    }
    setTimeInputError(null);
    setManualTimeText('');
    createMarkerAt(parsed);
  };

  // Pointer drag along visual timeline bar
  useEffect(() => {
    if (!draggingMarkerId || !canEdit) return undefined;

    const onMove = (ev: PointerEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const maxAllowed = liveDuration > 0 ? liveDuration : timelineDuration;
      const sec = Math.min(maxAllowed, Math.round(ratio * timelineDuration));
      updateMarker(draggingMarkerId, { timestamp_sec: sec });
    };

    const onUp = () => {
      setDraggingMarkerId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingMarkerId, canEdit, liveDuration, timelineDuration, markers]);

  const hasValidVideoSource =
    (sourceType === 'UPLOAD' && Boolean(streamUrl)) ||
    (sourceType === 'YOUTUBE' && Boolean(videoId)) ||
    (sourceType === 'DIRECT_URL' && Boolean(directUrl));

  const combinedPreviewMarkers = useMemo(
    () => [...sortedInherited, ...sortedMarkers],
    [sortedInherited, sortedMarkers]
  );

  return (
    <div className="ls-timeline-editor">
      <div className="ls-timeline-editor__head">
        <div>
          <h4 style={{ margin: 0, fontSize: 15 }}>
            Dòng thời gian & Câu hỏi tương tác trên video
          </h4>
          <span className="t-sub">
            Tua video tới vị trí mong muốn rồi bấm thêm câu hỏi, hoặc kéo trực tiếp các mốc trên thanh thời gian.
          </span>
        </div>
        <div className="t-actions">
          <Btn
            small
            variant="secondary"
            disabled={!hasValidVideoSource}
            onClick={() => {
              adapterRef.current?.pause();
              setPreviewOpen(true);
            }}
          >
            ▶ Xem trước tương tác
          </Btn>
          {canEdit && onSaveMarkersNow && (
            <Btn
              small
              variant="primary"
              loading={savingMarkers}
              onClick={() => onSaveMarkersNow(markers)}
            >
              Lưu các mốc câu hỏi
            </Btn>
          )}
        </div>
      </div>

      {hasValidVideoSource ? (
        <InteractiveVideoPlayer
          blockId={blockId}
          sourceType={sourceType}
          streamUrl={streamUrl}
          videoId={videoId}
          directUrl={directUrl}
          thumbnailUrl={thumbnailUrl}
          title={videoTitle}
          startSeconds={startSeconds}
          fallbackDuration={fallbackDuration}
          allowSeekingAhead
          markers={combinedPreviewMarkers}
          mode="AUTHOR"
          onAdapterReady={(ad) => {
            adapterRef.current = ad;
          }}
          onTimeUpdate={(ct, dur) => {
            setCurrentTime(ct);
            if (dur > 0) setLiveDuration(dur);
          }}
        />
      ) : (
        <div className="t-notice">
          Hãy tải tệp video lên hoặc gắn liên kết video hợp lệ ở phía trên để kích hoạt trình xem và đặt mốc thời gian trực quan.
        </div>
      )}

      {/* Visual Interactive Timeline Bar */}
      <div className="ls-timeline-box">
        <div className="ls-timeline-scale tabular-nums">
          <span>00:00</span>
          <span>Vị trí con trỏ: {formatTimestamp(currentTime)}</span>
          <span>{formatTimestamp(timelineDuration)}</span>
        </div>

        <div
          ref={timelineRef}
          className="ls-timeline-track"
          onClick={(e) => {
            if (!timelineRef.current) return;
            const rect = timelineRef.current.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            const sec = Math.round(ratio * timelineDuration);
            setCurrentTime(sec);
            adapterRef.current?.seek(sec);
          }}
        >
          <div className="ls-timeline-rail" />
          <div
            className="ls-timeline-playhead"
            style={{
              left: `${Math.min(100, Math.max(0, (currentTime / timelineDuration) * 100))}%`,
            }}
          />

          {/* Inherited Course Markers (Read-only in Class Studio Mode B) */}
          {sortedInherited.map((im) => {
            const leftPct = Math.min(99, Math.max(1, (im.timestamp_sec / timelineDuration) * 100));
            return (
              <button
                key={`inh_${im.id}`}
                type="button"
                className="ls-timeline-marker is-inherited"
                style={{ left: `clamp(26px, ${leftPct}%, calc(100% - 26px))` }}
                title={`[Kế thừa khóa học] ${formatTimestamp(im.timestamp_sec)} — ${im.title || im.question?.prompt || ''}`}
                aria-label={`Mốc kế thừa tại ${formatTimestamp(im.timestamp_sec)}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  adapterRef.current?.seek(im.timestamp_sec);
                }}
              >
                <span className="tabular-nums">{formatTimestamp(im.timestamp_sec)}</span>
              </button>
            );
          })}

          {/* Editable Markers */}
          {sortedMarkers.map((m) => {
            const leftPct = Math.min(99, Math.max(1, (m.timestamp_sec / timelineDuration) * 100));
            const isSelected = m.id === selectedMarkerId;
            return (
              <button
                key={m.id}
                type="button"
                className={`ls-timeline-marker ${isSelected ? 'is-selected' : ''} ${
                  m.behavior === 'INFO_ONLY' ? 'is-info' : ''
                }`}
                style={{ left: `clamp(26px, ${leftPct}%, calc(100% - 26px))` }}
                title={`${formatTimestamp(m.timestamp_sec)} — ${m.title || m.question?.prompt || 'Mốc tương tác'} (Kéo để đổi thời điểm)`}
                aria-label={`Chỉnh mốc tại ${formatTimestamp(m.timestamp_sec)}`}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setSelectedMarkerId(m.id);
                  if (canEdit) setDraggingMarkerId(m.id);
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelectedMarkerId(m.id);
                  adapterRef.current?.seek(m.timestamp_sec);
                }}
              >
                <span className="tabular-nums">{formatTimestamp(m.timestamp_sec)}</span>
              </button>
            );
          })}
        </div>

        {canEdit && (
          <div className="ls-timeline-actions">
            <Btn variant="primary" small onClick={handleAddAtCurrentTime}>
              + Thêm câu hỏi tại <span className="tabular-nums">{formatTimestamp(currentTime)}</span>
            </Btn>
            <Btn small variant="secondary" onClick={() => setBankPickerOpen(true)}>
              + Chọn từ Ngân hàng câu hỏi
            </Btn>
            <form onSubmit={handleAddAtManualTime} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="t-input tabular-nums"
                style={{ width: 112 }}
                value={manualTimeText}
                onChange={(e) => setManualTimeText(e.target.value)}
                placeholder="mm:ss"
                aria-label="Nhập thời điểm mm:ss để đặt mốc"
              />
              <Btn type="submit" small variant="quiet" disabled={!manualTimeText.trim()}>
                Đặt mốc
              </Btn>
            </form>
          </div>
        )}

        {timeInputError && (
          <p className="t-field__error" role="alert">
            {timeInputError}
          </p>
        )}
      </div>

      {/* Inherited Markers Summary in Mode B */}
      {studioMode === 'CLASS' && sortedInherited.length > 0 && (
        <div className="ls-inherited-markers-box">
          <strong style={{ fontSize: 13 }}>
            Mốc câu hỏi kế thừa từ khóa học gốc (<span className="tabular-nums">{sortedInherited.length}</span> mốc — giữ nguyên cho mọi lớp):
          </strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {sortedInherited.map((im) => (
              <button
                key={im.id}
                type="button"
                className="t-btn t-btn--small t-btn--quiet"
                onClick={() => adapterRef.current?.seek(im.timestamp_sec)}
              >
                <span className="tabular-nums">{formatTimestamp(im.timestamp_sec)}</span> · {im.title || im.question?.prompt?.slice(0, 32) || 'Câu hỏi'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Editable Marker List + Active Marker Editor */}
      {sortedMarkers.length === 0 ? (
        <div className="t-sub" style={{ padding: '4px 0' }}>
          {studioMode === 'CLASS'
            ? 'Lớp học này chưa có mốc câu hỏi bổ sung riêng trên video. Bạn có thể bấm "+ Thêm câu hỏi" để chèn câu hỏi riêng cho học viên của lớp.'
            : 'Chưa có mốc câu hỏi tương tác nào trên video này. Bấm "+ Thêm câu hỏi" để học viên vừa xem vừa tương tác.'}
        </div>
      ) : (
        <div className="ls-marker-split">
          <div className="ls-marker-list" role="listbox" aria-label="Danh sách mốc tương tác">
            {sortedMarkers.map((m, idx) => {
              const active = m.id === selectedMarkerId;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`ls-marker-item ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedMarkerId(m.id);
                    adapterRef.current?.seek(m.timestamp_sec);
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                    <strong className="tabular-nums">
                      #{idx + 1} · {formatTimestamp(m.timestamp_sec)}
                    </strong>
                    <Tone tone={m.behavior === 'INFO_ONLY' ? 'info' : m.is_required ? 'warning' : 'neutral'}>
                      {MARKER_BEHAVIOR_LABELS[m.behavior]}
                    </Tone>
                  </div>
                  <span className="ls-marker-item__prompt">
                    {m.behavior === 'INFO_ONLY'
                      ? m.title || m.info_body || 'Ghi chú kiến thức'
                      : m.question?.prompt || m.title || 'Câu hỏi chưa có nội dung'}
                  </span>
                  {m.behavior !== 'INFO_ONLY' && m.question && (
                    <span className="t-sub">
                      {QUESTION_TYPE_LABELS[m.question.question_type]}
                      {m.question_id ? ' · Ngân hàng câu hỏi' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedMarker && (
            <div className="ls-marker-detail">
              <div className="ls-marker-detail__head">
                <strong>
                  Thiết lập mốc tại <span className="tabular-nums">{formatTimestamp(selectedMarker.timestamp_sec)}</span>
                </strong>
                {canEdit && (
                  <Btn
                    small
                    variant="danger"
                    onClick={() => {
                      const remaining = markers.filter((x) => x.id !== selectedMarker.id);
                      onChangeMarkers(remaining);
                      setSelectedMarkerId(remaining[0]?.id || null);
                    }}
                  >
                    Xóa mốc này
                  </Btn>
                )}
              </div>

              <div className="t-form-grid">
                <Field label="Thời điểm xuất hiện (mm:ss)">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="t-input tabular-nums"
                      style={{ flex: '1 1 120px', minWidth: 0 }}
                      disabled={!canEdit}
                      value={selectedTimeText}
                      onChange={(e) => setSelectedTimeText(e.target.value)}
                      onBlur={() => {
                        const parsed = parseTimestampInput(selectedTimeText);
                        if (parsed !== null) {
                          const clamped = liveDuration > 0 ? Math.min(parsed, liveDuration) : parsed;
                          updateMarker(selectedMarker.id, { timestamp_sec: clamped });
                          setSelectedTimeText(formatTimestamp(clamped));
                        } else {
                          setSelectedTimeText(formatTimestamp(selectedMarker.timestamp_sec));
                        }
                      }}
                    />
                    {canEdit && (
                      <Btn
                        small
                        variant="quiet"
                        onClick={() => {
                          const nowSec = Math.round((adapterRef.current?.getCurrentTime() ?? currentTime) * 10) / 10;
                          updateMarker(selectedMarker.id, { timestamp_sec: nowSec });
                          setSelectedTimeText(formatTimestamp(nowSec));
                        }}
                      >
                        Lấy {formatTimestamp(currentTime)}
                      </Btn>
                    )}
                  </div>
                </Field>

                <Field label="Hành vi khi video chạm mốc">
                  <select
                    className="t-input"
                    disabled={!canEdit}
                    value={selectedMarker.behavior}
                    onChange={(e) => {
                      const nextBehavior = e.target.value as MarkerBehavior;
                      updateMarker(selectedMarker.id, {
                        behavior: nextBehavior,
                        question:
                          nextBehavior === 'INFO_ONLY'
                            ? null
                            : selectedMarker.question || createDefaultQuestionSpec('SINGLE_CHOICE'),
                      });
                    }}
                  >
                    <option value="PAUSE_AND_ASK">Tạm dừng video & yêu cầu trả lời</option>
                    <option value="PAUSE_OPTIONAL">Tạm dừng video & cho phép bỏ qua</option>
                    <option value="INFO_ONLY">Chỉ hiển thị ghi chú kiến thức</option>
                  </select>
                </Field>
              </div>

              <Field label="Tiêu đề ngắn của mốc">
                <input
                  className="t-input"
                  disabled={!canEdit}
                  value={selectedMarker.title || ''}
                  onChange={(e) => updateMarker(selectedMarker.id, { title: e.target.value })}
                  placeholder="Ví dụ: Kiểm tra nhanh quy đồng mẫu số"
                />
              </Field>

              {selectedMarker.behavior === 'INFO_ONLY' ? (
                <Field label="Nội dung ghi chú hiển thị cho học viên" required>
                  <textarea
                    className="t-input"
                    rows={3}
                    disabled={!canEdit}
                    value={selectedMarker.info_body || ''}
                    onChange={(e) => updateMarker(selectedMarker.id, { info_body: e.target.value })}
                    placeholder="Nhập công thức cần nhớ hoặc lưu ý quan trọng tại thời điểm này…"
                  />
                </Field>
              ) : (
                <>
                  <QuestionForm
                    value={selectedMarker.question || createDefaultQuestionSpec('SINGLE_CHOICE')}
                    disabled={!canEdit}
                    onChange={(nextQ) => updateMarker(selectedMarker.id, { question: nextQ })}
                  />

                  <div className="t-form-grid" style={{ marginTop: 8 }}>
                    <Field label="Số lần trả lời tối đa (0 = không giới hạn)">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="t-input tabular-nums"
                        disabled={!canEdit}
                        value={selectedMarker.max_attempts ?? 2}
                        onChange={(e) =>
                          updateMarker(selectedMarker.id, { max_attempts: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </Field>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label className="ls-check-row">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={Boolean(selectedMarker.is_required)}
                          onChange={(e) => updateMarker(selectedMarker.id, { is_required: e.target.checked })}
                        />
                        <span>Bắt buộc trả lời để tiếp tục & hoàn thành bài</span>
                      </label>
                      <label className="ls-check-row">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={Boolean(selectedMarker.show_answer_after_submit)}
                          onChange={(e) =>
                            updateMarker(selectedMarker.id, { show_answer_after_submit: e.target.checked })
                          }
                        />
                        <span>Hiện đáp án đúng sau khi nộp</span>
                      </label>
                      <label className="ls-check-row">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={Boolean(selectedMarker.allow_review)}
                          onChange={(e) => updateMarker(selectedMarker.id, { allow_review: e.target.checked })}
                        />
                        <span>Cho phép học viên bấm lại mốc để ôn tập</span>
                      </label>
                      {studioMode === 'COURSE' && !selectedMarker.question_id && (
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(selectedMarker.save_to_bank)}
                            onChange={(e) => updateMarker(selectedMarker.id, { save_to_bank: e.target.checked })}
                          />
                          <span>Lưu câu hỏi này vào Ngân hàng câu hỏi của khóa học</span>
                        </label>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {bankPickerOpen && (
        <QuestionBankModal
          courseId={courseId}
          canEdit={canEdit}
          onClose={() => setBankPickerOpen(false)}
          onPickQuestion={(item) => {
            const nowSec = adapterRef.current ? adapterRef.current.getCurrentTime() : currentTime;
            createMarkerAt(nowSec, item);
          }}
        />
      )}

      {previewOpen && (
        <Modal
          title="Xem trước trải nghiệm Video tương tác của học viên"
          onClose={() => setPreviewOpen(false)}
          width={920}
          footer={<Btn onClick={() => setPreviewOpen(false)}>Đóng chế độ xem trước</Btn>}
        >
          <div className="t-notice" style={{ marginBottom: 12 }}>
            Chế độ xem trước mô phỏng 100% cơ chế tự động dừng video, chặn tua qua mốc bắt buộc và chấm điểm phản hồi ngay, <strong>không ghi dữ liệu thử nghiệm vào cơ sở dữ liệu</strong>.
          </div>
          <InteractiveVideoPlayer
            blockId={blockId}
            sourceType={sourceType}
            streamUrl={streamUrl}
            videoId={videoId}
            directUrl={directUrl}
            thumbnailUrl={thumbnailUrl}
            title={videoTitle}
            startSeconds={startSeconds}
            fallbackDuration={fallbackDuration}
            allowSeekingAhead={allowSeekingAhead}
            markers={combinedPreviewMarkers}
            mode="PREVIEW"
          />
        </Modal>
      )}
    </div>
  );
};
