import React, { useState } from 'react';
import {
  CurriculumChapterNode,
  LessonBlock,
  WikiTermPopoverData,
} from '../../types/elearning';
import {
  Badge,
  Button,
  ProgressBar,
  SurfacePanel,
} from '../ui/Primitives';

interface LessonPlayerViewProps {
  subjectClassCode: string;
  subjectTitle: string;
  chapters: CurriculumChapterNode[];
  activeLessonId: string;
  onSelectLesson: (lessonId: string) => void;
  blocks: LessonBlock[];
  wikiDictionary: Record<string, WikiTermPopoverData>;
  onMarkComplete: (lessonId: string) => void;
  onNotify?: (msg: string, detail?: string) => void;
}

export const LessonPlayerView: React.FC<LessonPlayerViewProps> = ({
  subjectClassCode,
  subjectTitle,
  chapters,
  activeLessonId,
  onSelectLesson,
  blocks,
  wikiDictionary,
  onMarkComplete,
  onNotify,
}) => {
  const [activeSideTab, setActiveSideTab] = useState<'notes' | 'resources' | 'qa' | 'wiki'>('notes');
  const [selectedWikiTerm, setSelectedWikiTerm] = useState<WikiTermPopoverData | null>(null);
  const [selectedMcqOption, setSelectedMcqOption] = useState<string | null>(null);
  const [revealedSteps, setRevealedSteps] = useState<number>(1);
  const [videoPositionSec, setVideoPositionSec] = useState<number>(760); // Auto-resumed at 12:40
  const [notes, setNotes] = useState<Array<{ timeSec: number; text: string }>>([
    { timeSec: 255, text: 'Leader election yêu cầu đa số phiếu bầu (Quorum = floor(N/2) + 1).' },
    { timeSec: 590, text: 'Phân biệt rõ Term (nhiệm kỳ) và Log Index trong Raft.' },
  ]);
  const [newNoteText, setNewNoteText] = useState('');

  const allLessons = chapters.flatMap((c) => c.lessons);
  const currentLesson = allLessons.find((l) => l.id === activeLessonId) || allLessons[0];

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const videoPct = Math.min(
    100,
    Math.round((videoPositionSec / Math.max(1, currentLesson.total_video_seconds)) * 100)
  );
  const isVideoConditionMet = videoPct >= 85;
  const isQuizConditionMet = selectedMcqOption === 'opt_3';

  const handleAddTimestampNote = () => {
    if (!newNoteText.trim()) return;
    const stamp = videoPositionSec;
    setNotes((prev) => [...prev, { timeSec: stamp, text: newNoteText.trim() }]);
    setNewNoteText('');
    onNotify?.(
      `Đã lưu ghi chú gắn mốc thời gian ${formatSeconds(stamp)}!`,
      'Bấm vào nhãn thời gian bất kỳ để tua video về đúng thời điểm ghi chú.'
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      <div className="player-3col-layout">
        {/* 1. LEFT SIDEBAR: COURSERA-STYLE CURRICULUM & UNLOCK TREE */}
        <SurfacePanel style={{ padding: 'var(--space-4)' }}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              LỚP MÔN HỌC: {subjectClassCode}
            </div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '4px 0 10px 0' }}>{subjectTitle}</h2>
            <ProgressBar percent={chapters[0]?.progress_pct ?? 68} label="Tiến độ hoàn thành Chương 3" />
          </div>

          {chapters.map((chapter) => (
            <div
              key={chapter.id}
              style={{
                marginBottom: 'var(--space-4)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <strong style={{ fontSize: '13px' }}>
                  {chapter.code}: {chapter.title}
                </strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {chapter.lessons.map((lesson) => {
                  const isActive = lesson.id === currentLesson.id;
                  const isLocked = lesson.status === 'LOCKED';
                  return (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => onSelectLesson(lesson.id)}
                      style={{
                        width: '100%',
                        minHeight: '52px',
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: isActive
                          ? '1.5px solid var(--text-primary)'
                          : '1px solid var(--border-subtle)',
                        backgroundColor: isActive
                          ? 'var(--bg-surface-hover)'
                          : 'var(--bg-surface)',
                        color: isLocked ? 'var(--text-muted)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          width: '100%',
                          fontSize: '13px',
                          fontWeight: isActive ? 700 : 500,
                        }}
                      >
                        <span>
                          {lesson.status === 'COMPLETED' && '✔ '}
                          {lesson.status === 'IN_PROGRESS' && '● '}
                          {lesson.status === 'LOCKED' && '🔒 '}
                          {lesson.code} {lesson.title}
                        </span>
                        <span
                          className="tabular-nums"
                          style={{ fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}
                        >
                          {lesson.duration_minutes}p
                        </span>
                      </div>
                      {isLocked && lesson.unlock_condition_text && (
                        <span style={{ fontSize: '11px', color: 'var(--status-warning)', fontWeight: 600 }}>
                          🔒 ĐK mở khóa: {lesson.unlock_condition_text}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </SurfacePanel>

        {/* 2. CENTER STAGE: VIDEO PLAYER + NOTION BLOCK RENDERER */}
        <SurfacePanel>
          {currentLesson.status === 'LOCKED' ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              <Badge tone="warning">🔒 BÀI HỌC ĐANG KHÓA THEO TIẾN ĐỘ (CONDITIONAL UNLOCK)</Badge>
              <h2 style={{ fontSize: 'var(--text-h2)', marginTop: 'var(--space-3)' }}>
                {currentLesson.code}: {currentLesson.title}
              </h2>
              <p style={{ color: 'var(--text-secondary)', margin: '8px auto 24px auto' }}>
                Điều kiện mở khóa tự động: <strong>{currentLesson.unlock_condition_text}</strong>
              </p>
              <Button variant="primary" onClick={() => onSelectLesson('les_302')}>
                ← Quay lại hoàn thành Bài 3.2 để mở khóa
              </Button>
            </div>
          ) : (
            <>
              {/* Live Unlock Checklist Bar */}
              <div
                style={{
                  marginBottom: 'var(--space-4)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-strong)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                  Điều kiện hoàn thành Bài {currentLesson.code} &amp; mở khóa Bài 3.3:
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Badge tone={isVideoConditionMet ? 'success' : 'warning'}>
                    {isVideoConditionMet ? '✔' : '⏳'} 1. Video &ge; 85% (Hiện tại:{' '}
                    <span className="tabular-nums">{videoPct}%</span>)
                  </Badge>
                  <Badge tone={isQuizConditionMet ? 'success' : 'warning'}>
                    {isQuizConditionMet ? '✔' : '⏳'} 2. Trả lời đúng câu hỏi kiểm tra nhanh
                  </Badge>
                </div>
              </div>

              {/* 16:9 Video Player with Zero CLS & Auto-Resume */}
              <div
                style={{
                  aspectRatio: '16 / 9',
                  backgroundColor: 'var(--primitive-obsidian-950)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-6)',
                  color: 'var(--primitive-alabaster-50)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-6)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <Badge tone="learning">
                    HLS Adaptive 1080p • Tự động phát tiếp tại {formatSeconds(videoPositionSec)} ({videoPct}%)
                  </Badge>
                  <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--primitive-zinc-400)' }}>
                    ● Tiến độ được lưu tự động
                  </span>
                </div>

                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: '13px', color: 'var(--primitive-zinc-400)', marginBottom: '6px' }}>
                    {subjectClassCode} • Bài {currentLesson.code}
                  </div>
                  <h1 style={{ color: 'var(--primitive-alabaster-50)', fontSize: '22px', margin: 0 }}>
                    {currentLesson.title}
                  </h1>
                </div>

                {/* Video Scrubbing Bar */}
                <div>
                  <div
                    style={{
                      height: '8px',
                      backgroundColor: 'var(--primitive-obsidian-700)',
                      borderRadius: 'var(--radius-pill)',
                      overflow: 'hidden',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: `${videoPct}%`,
                        height: '100%',
                        backgroundColor: 'var(--accent-learning)',
                        transition: 'width 200ms var(--ease-standard)',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          setVideoPositionSec((s) => Math.min(currentLesson.total_video_seconds, s + 60))
                        }
                      >
                        ▶ Phát tiếp (+1 phút)
                      </Button>
                      <Button
                        size="sm"
                        variant="learning"
                        onClick={() => {
                          setVideoPositionSec(999);
                          onNotify?.(
                            'Đã tua video tới mốc 16:39 (Đạt 90% >= 85%)!',
                            'Điều kiện 1 (Xem >= 85% video) đã chuyển sang trạng thái Hoàn thành ✔.'
                          );
                        }}
                      >
                        ⏩ Tua nhanh tới 90% (16:39)
                      </Button>
                    </div>
                    <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                      {formatSeconds(videoPositionSec)} / {formatSeconds(currentLesson.total_video_seconds)} ({videoPct}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Inline Wiki Term Popover Banner (if clicked) */}
              {selectedWikiTerm && (
                <div
                  role="dialog"
                  aria-label="Định nghĩa thuật ngữ Wiki"
                  style={{
                    marginBottom: 'var(--space-5)',
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--accent-learning-tint)',
                    border: '1.5px solid var(--accent-learning)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-learning)' }}>
                      📖 WIKI THUẬT NGỮ NGỮ CẢNH ({selectedWikiTerm.subject_context})
                    </div>
                    <strong style={{ fontSize: '16px', display: 'block', marginTop: '2px' }}>
                      {selectedWikiTerm.canonical_name}{' '}
                      <span style={{ fontWeight: 400, fontSize: '13px', color: 'var(--text-secondary)' }}>
                        (Tên đồng nghĩa: {selectedWikiTerm.aliases.join(', ')})
                      </span>
                    </strong>
                    <p style={{ margin: '6px 0 0 0', fontSize: '14px' }}>
                      {selectedWikiTerm.short_definition}
                    </p>
                  </div>
                  <Button size="sm" variant="subtle" onClick={() => setSelectedWikiTerm(null)}>
                    Đóng ✕
                  </Button>
                </div>
              )}

              {/* NOTION-STYLE STRUCTURED BLOCK RENDERER (JSON Schema v1.0) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {blocks.map((block) => {
                  if (block.block_type === 'callout') {
                    return (
                      <div
                        key={block.id}
                        style={{
                          padding: 'var(--space-4)',
                          borderRadius: 'var(--radius-md)',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          border: '1px solid var(--border-strong)',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: 'var(--brand-primary)',
                            marginBottom: '4px',
                          }}
                        >
                          🎯 {block.content.title}
                        </div>
                        <p style={{ margin: 0, fontSize: '15px' }}>{block.content.text}</p>
                      </div>
                    );
                  }

                  if (block.block_type === 'paragraph') {
                    return (
                      <p
                        key={block.id}
                        style={{
                          margin: 0,
                          fontFamily: 'var(--font-serif)',
                          fontSize: '17px',
                          lineHeight: 1.75,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {block.content.text}{' '}
                        {block.content.linked_term_id && wikiDictionary[block.content.linked_term_id] && (
                          <button
                            type="button"
                            onClick={() => {
                              const term = wikiDictionary[block.content.linked_term_id];
                              setSelectedWikiTerm(term);
                              onNotify?.(
                                `Giải nghĩa: "${term.canonical_name}"`,
                                'Học viên tra cứu thuật ngữ ngay trong ngữ cảnh bài giảng mà không cần chuyển trang.'
                              );
                            }}
                            style={{
                              minHeight: '44px',
                              border: '1px solid var(--accent-learning)',
                              background: 'var(--accent-learning-tint)',
                              color: 'var(--accent-learning)',
                              fontFamily: 'var(--font-sans)',
                              fontSize: '14px',
                              fontWeight: 600,
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              marginLeft: '4px',
                            }}
                          >
                            📖 {wikiDictionary[block.content.linked_term_id].canonical_name} (Bấm xem Wiki)
                          </button>
                        )}
                      </p>
                    );
                  }

                  if (block.block_type === 'step_by_step_solution') {
                    const steps: Array<{ step_number: number; title: string; explanation: string }> =
                      block.content.steps || [];
                    return (
                      <div
                        key={block.id}
                        style={{
                          padding: 'var(--space-5)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface-subtle)',
                        }}
                      >
                        <Badge tone="neutral">🪜 Ví dụ có lời giải từng bước (Step-by-Step)</Badge>
                        <h3 style={{ fontSize: '16px', margin: '8px 0' }}>{block.content.problem}</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                          {steps.slice(0, revealedSteps).map((st) => (
                            <div
                              key={st.step_number}
                              style={{
                                padding: '12px 14px',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--bg-surface)',
                                border: '1px solid var(--border-subtle)',
                              }}
                            >
                              <strong>
                                Bước {st.step_number}: {st.title}
                              </strong>
                              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                {st.explanation}
                              </div>
                            </div>
                          ))}
                        </div>
                        {revealedSteps < steps.length && (
                          <Button
                            size="sm"
                            variant="secondary"
                            style={{ marginTop: '12px' }}
                            onClick={() => setRevealedSteps((n) => n + 1)}
                          >
                            👁️ Xem tiếp Bước {revealedSteps + 1}/{steps.length}
                          </Button>
                        )}
                      </div>
                    );
                  }

                  if (block.block_type === 'inline_mcq') {
                    const options: Array<{ id: string; text: string; is_correct: boolean; feedback: string }> =
                      block.content.options || [];
                    const chosen = options.find((o) => o.id === selectedMcqOption);
                    return (
                      <div
                        key={block.id}
                        style={{
                          padding: 'var(--space-5)',
                          borderRadius: 'var(--radius-md)',
                          border: '1.5px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                          <Badge tone="learning">❓ Câu hỏi kiểm tra nhanh</Badge>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Chọn đáp án đúng để mở khóa Bài 3.3
                          </span>
                        </div>
                        <h3 style={{ fontSize: '16px', margin: '0 0 12px 0' }}>{block.content.question}</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {options.map((opt) => {
                            const isSelected = selectedMcqOption === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setSelectedMcqOption(opt.id);
                                  if (opt.is_correct) {
                                    onNotify?.(
                                      'Bạn đã trả lời chính xác!',
                                      'Điều kiện 2 đã hoàn thành. Bạn có thể bấm nút Đánh dấu Hoàn thành bên dưới.'
                                    );
                                  }
                                }}
                                style={{
                                  minHeight: '48px',
                                  textAlign: 'left',
                                  padding: '10px 14px',
                                  borderRadius: 'var(--radius-sm)',
                                  border: isSelected
                                    ? '2px solid var(--accent-learning)'
                                    : '1px solid var(--border-strong)',
                                  backgroundColor: isSelected
                                    ? 'var(--accent-learning-tint)'
                                    : 'var(--bg-surface-subtle)',
                                  color: 'var(--text-primary)',
                                  fontFamily: 'var(--font-sans)',
                                  fontSize: '14px',
                                  fontWeight: isSelected ? 600 : 500,
                                  cursor: 'pointer',
                                }}
                              >
                                {opt.text}
                              </button>
                            );
                          })}
                        </div>
                        {chosen && (
                          <div
                            style={{
                              marginTop: '12px',
                              padding: '10px 14px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: chosen.is_correct
                                ? 'var(--accent-learning-tint)'
                                : 'var(--brand-tint)',
                              color: chosen.is_correct ? 'var(--status-success)' : 'var(--status-danger)',
                              fontSize: '14px',
                              fontWeight: 600,
                            }}
                          >
                            {chosen.is_correct ? '✔ Chính xác: ' : '✖ Chưa chính xác: '}
                            {chosen.feedback}
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (block.block_type === 'code_block') {
                    return (
                      <div
                        key={block.id}
                        style={{
                          borderRadius: 'var(--radius-md)',
                          backgroundColor: 'var(--primitive-obsidian-950)',
                          color: 'var(--primitive-alabaster-50)',
                          padding: 'var(--space-4)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13px',
                          border: '1px solid var(--border-strong)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '8px',
                            color: 'var(--primitive-zinc-400)',
                            fontSize: '12px',
                          }}
                        >
                          <span>💻 Mã nguồn {block.content.language}</span>
                        </div>
                        <pre style={{ margin: 0, overflowX: 'auto' }}>{block.content.code}</pre>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>

              {/* Bottom Lesson Navigation Bar */}
              <div
                style={{
                  marginTop: 'var(--space-8)',
                  paddingTop: 'var(--space-5)',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Tiêu chí mở khóa Bài 3.3: Xem &ge; 85% video &amp; Trả lời đúng câu hỏi kiểm tra nhanh
                </span>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    onMarkComplete(currentLesson.id);
                    onNotify?.(
                      'Chúc mừng! Đã hoàn thành Bài 3.2 và tự động mở khóa Bài 3.3!',
                      'Cây chương trình học bên trái đã cập nhật tiến độ Chương 3 lên 100%.'
                    );
                  }}
                >
                  ✔ Đánh dấu Hoàn thành &amp; Mở khóa Bài 3.3 →
                </Button>
              </div>
            </>
          )}
        </SurfacePanel>

        {/* 3. RIGHT AUXILIARY PANEL: TIMESTAMPED NOTES, ATTACHMENTS, DISCUSSION & WIKI */}
        <SurfacePanel style={{ padding: 'var(--space-4)' }}>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              marginBottom: 'var(--space-4)',
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: '8px',
              flexWrap: 'wrap',
            }}
          >
            {(['notes', 'resources', 'qa', 'wiki'] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveSideTab(tabKey)}
                style={{
                  minHeight: '44px',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-sm)',
                  border:
                    activeSideTab === tabKey
                      ? '1px solid var(--border-strong)'
                      : '1px solid transparent',
                  backgroundColor:
                    activeSideTab === tabKey ? 'var(--bg-surface-subtle)' : 'transparent',
                  color: activeSideTab === tabKey ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {tabKey === 'notes' && `📝 Ghi chú (${notes.length})`}
                {tabKey === 'resources' && '📎 Học liệu (2)'}
                {tabKey === 'qa' && '💬 Hỏi đáp'}
                {tabKey === 'wiki' && '📖 Wiki (2)'}
              </button>
            ))}
          </div>

          {activeSideTab === 'notes' && (
            <div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                <input
                  type="text"
                  aria-label="Nhập ghi chú tại mốc thời gian video hiện tại"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder={`Ghi chú tại ${formatSeconds(videoPositionSec)}...`}
                  style={{
                    flex: '1 1 160px',
                    minWidth: 0,
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '13px',
                  }}
                />
                <Button size="md" onClick={handleAddTimestampNote}>
                  + Lưu
                </Button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {notes.map((n, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setVideoPositionSec(n.timeSec);
                        onNotify?.(`Đã tua video về mốc ghi chú ${formatSeconds(n.timeSec)}.`);
                      }}
                      className="tabular-nums"
                      style={{
                        minHeight: '44px',
                        border: 'none',
                        background: 'var(--brand-tint)',
                        color: 'var(--brand-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '8px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginBottom: '8px',
                      }}
                    >
                      ▶ Tua tới {formatSeconds(n.timeSec)}
                    </button>
                    <div style={{ fontSize: '13px' }}>{n.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSideTab === 'resources' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                }}
              >
                <strong style={{ fontSize: '13px', display: 'block' }}>
                  📄 Slide_Chuong3_Raft_Consensus.pdf
                </strong>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  PDF • 4.2 MB • Cho phép tải về
                </span>
              </div>
              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                }}
              >
                <strong style={{ fontSize: '13px', display: 'block' }}>
                  📦 raft-cluster-lab-starter.zip
                </strong>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Code mẫu bài Lab • 1.8 MB
                </span>
              </div>
            </div>
          )}

          {activeSideTab === 'qa' && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              <p style={{ marginTop: 0 }}>
                Thảo luận gắn với <strong>Bài {currentLesson.code}</strong> (Giới hạn trả lời lồng tối đa 2 cấp):
              </p>
              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                  Hỏi: Nếu 2 Candidate cùng xin phiếu bầu ở 1 Term thì sao?
                </strong>
                <p style={{ margin: 0 }}>
                  ↳ <strong>TS. Lê Hoàng Nam (✔ Câu trả lời đã xác nhận):</strong> Hệ thống dùng Randomized Election Timeout (150ms–300ms) để phá vỡ thế chia phiếu (Split Vote).
                </p>
              </div>
            </div>
          )}

          {activeSideTab === 'wiki' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.values(wikiDictionary).map((term) => (
                <div
                  key={term.id}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  <strong style={{ fontSize: '13px', color: 'var(--accent-learning)' }}>
                    📖 {term.canonical_name}
                  </strong>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {term.short_definition}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfacePanel>
      </div>
    </div>
  );
};
