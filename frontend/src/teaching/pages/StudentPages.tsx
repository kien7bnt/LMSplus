import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LearnLesson, WikiPageItem, masterApi, saveBlob, teachingApi } from '../api';
import { BlockList } from '../BlockRenderer';
import {
  Badge, Btn, Card, EmptyState, ErrorState, Loading, Modal, PageHeader, ProgressMeter, SmartImage, StatCard, Tabs, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, fmtTime, fmtWeekday, label, useAsync, useToast,
} from '../ui';
import { StudentAssignmentsPage, StudentExamsPage } from './StudentAssessmentPages';
import { StudentLeaveRequestsPage } from './LeaveRequestsPage';
import { StudentWikiPanel } from './WikiPanel';
import { ForumWorkspace } from './ForumPanel';
import { WikiAnnotatedText, WikiReaderProvider } from '../WikiText';

// ------------------------------------------------------------------ /learn — Trang chủ học viên

export const StudentHomePage: React.FC = () => {
  const toast = useToast();
  const overviewReq = useAsync(() => masterApi.getStudentOverview(), []);
  const classesReq = useAsync(() => teachingApi.learnClasses(), []);
  const [code, setCode] = useState('');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [view, setView] = useState<'overview' | 'classes'>('overview');
  const [feedTab, setFeedTab] = useState<'schedule' | 'tasks' | 'grades' | 'forum'>('schedule');
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [joinResult, setJoinResult] = useState<{
    sessionTitle: string;
    join_url: string;
    provider: string;
    meeting_code: string | null;
    passcode: string | null;
    lms_join_token: string | null;
  } | null>(null);

  const handleJoinOnline = async (sessionId: string, sessionTitle: string) => {
    setJoiningSessionId(sessionId);
    try {
      const res = await teachingApi.joinVirtualRoom(sessionId);
      setJoinResult({
        sessionTitle,
        join_url: res.join_url,
        provider: res.provider,
        meeting_code: res.external_meeting_id,
        passcode: res.passcode,
        lms_join_token: res.lms_join_token,
      });
      toast({
        tone: 'success',
        title: 'Đã ghi nhận tham gia lớp học trực tuyến',
        detail: `Hệ thống đã gắn mã định danh điểm danh tự động cho tài khoản của bạn.`,
      });
      if (res.join_url && typeof window !== 'undefined') {
        window.open(res.join_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể vào phòng trực tuyến', detail: errMsg(err) });
    } finally {
      setJoiningSessionId(null);
    }
  };

  const submitCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.replace(/\s+/g, '');
    if (trimmed.length !== 6) {
      toast({ tone: 'error', title: 'Mã điểm danh gồm 6 chữ số' });
      return;
    }
    setCheckingIn(true);
    try {
      const res = await teachingApi.checkIn(trimmed);
      setCode('');
      setCheckInOpen(false);
      toast({
        tone: 'success',
        title: res.already_checked_in ? 'Bạn đã điểm danh buổi này rồi' : `Điểm danh thành công: ${label('attendance', res.status)}`,
        detail: res.session_title,
      });
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể điểm danh', detail: errMsg(err) });
    } finally {
      setCheckingIn(false);
    }
  };

  const ov = overviewReq.data;
  const tasksTotal = (ov?.pending_assignments_count || 0) + (ov?.pending_exams_count || 0);
  const progressPct = ov ? Math.min(100, Math.max(0, Math.round(ov.overall_progress_pct || 0))) : 0;
  const attPct = ov && ov.attendance_summary.rate !== null ? Math.min(100, Math.max(0, Math.round(ov.attendance_summary.rate))) : 100;
  const taskClearPct = ov ? Math.max(15, 100 - tasksTotal * 15) : 100;

  return (
    <div className="t-page bento-page">
      <div className="bento-context">
        <div className="bento-context__left">
          <div className="bento-context__title-row">
            <h1>Không gian học tập</h1>
            <span className="bento-live-pill">
              <span className="bento-live-dot" aria-hidden="true" />
              Đang học
            </span>
          </div>
          <span className="bento-muted">
            Theo dõi nhanh tiến độ, lịch học và các đầu việc đến hạn.
          </span>
        </div>

        <div className="bento-context__right">
          <div className="bento-segmented" role="tablist" aria-label="Chế độ xem học tập">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'overview'}
              className={`bento-seg-btn ${view === 'overview' ? 'is-active' : ''}`}
              onClick={() => setView('overview')}
            >
              Tổng quan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'classes'}
              className={`bento-seg-btn ${view === 'classes' ? 'is-active' : ''}`}
              onClick={() => setView('classes')}
            >
              Môn học ({classesReq.data?.items.length ?? ov?.total_classes ?? 0})
            </button>
          </div>

          <button type="button" className="bento-pill-action" onClick={() => setCheckInOpen(true)}>
            Điểm danh 6 số
          </button>

          {ov?.continue_learning && (
            <Link
              className="bento-pill-action bento-pill-action--primary"
              to={`/learn/classes/${ov.continue_learning.class_id}/lessons/${ov.continue_learning.lesson_id}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>
              Tiếp tục học
            </Link>
          )}
        </div>
      </div>

      {ov && view === 'overview' && (
        <>
          <div className="bento-top-grid">
            <section className="bento-card" aria-label="Tiến độ học tập tổng thể">
              <div className="bento-card__head">
                <span className="bento-card__label">TIẾN ĐỘ HỌC TẬP</span>
                <span className="t-badge tabular-nums">{ov.completed_lessons}/{ov.total_lessons} bài</span>
              </div>
              <div>
                <div className="bento-hero__num">{fmtPct(ov.overall_progress_pct)}</div>
                <p className="bento-muted" style={{ margin: '6px 0 0' }}>
                  {ov.continue_learning ? `Đang học: ${ov.continue_learning.lesson_title}` : 'Hoàn thành đều đặn các bài giảng mỗi ngày'}
                </p>
              </div>
              <div className="bento-pill-actions">
                <Link className="bento-pill-action" to="/learn/exams">Kiểm tra</Link>
                <Link className="bento-pill-action" to="/learn/assignments">Bài tập</Link>
                <Link className="bento-pill-action" to="/learn/leave-requests">Xin nghỉ</Link>
              </div>
            </section>

            <div className="bento-kpi-trio">
              <button type="button" className="bento-kpi-trigger" onClick={() => setView('classes')}>
                <div className="bento-card bento-kpi-card">
                  <div className="bento-card__head">
                    <div className="bento-kpi-title">
                      <span className="bento-icon-circle bento-icon-circle--learning" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                        </svg>
                      </span>
                      <span className="bento-muted">Môn học</span>
                    </div>
                  </div>
                  <div>
                    <div className="bento-kpi__num">{ov.total_classes}</div>
                    <div className="bento-muted" style={{ marginTop: 4 }}>Đơn nghỉ chờ: {ov.pending_leave_requests}</div>
                  </div>
                </div>
              </button>

              <button type="button" className="bento-kpi-trigger" onClick={() => setFeedTab('tasks')}>
                <div className="bento-card bento-kpi-card">
                  <div className="bento-card__head">
                    <div className="bento-kpi-title">
                      <span className="bento-icon-circle bento-icon-circle--streak" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                          <path d="M9 14h6" />
                        </svg>
                      </span>
                      <span className="bento-muted">Việc cần làm</span>
                    </div>
                  </div>
                  <div>
                    <div className="bento-kpi__num" style={{ color: tasksTotal > 0 ? 'var(--status-warning)' : undefined }}>
                      {tasksTotal}
                    </div>
                    <div className="bento-muted" style={{ marginTop: 4 }}>
                      {ov.pending_assignments_count} bài tập · {ov.pending_exams_count} đề thi
                    </div>
                  </div>
                </div>
              </button>

              <div className="bento-card bento-kpi-card">
                <div className="bento-card__head">
                  <div className="bento-kpi-title">
                    <span className="bento-icon-circle bento-icon-circle--brand" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </span>
                    <span className="bento-muted">Chuyên cần</span>
                  </div>
                </div>
                <div>
                  <div className="bento-kpi__num">{fmtPct(ov.attendance_summary.rate)}</div>
                  <div className="bento-muted" style={{ marginTop: 4 }}>
                    {ov.attendance_summary.present} có mặt · {ov.attendance_summary.absent} vắng
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bento-split">
            <section className="bento-card" aria-label="Hoạt động học tập">
              <div className="bento-card__head">
                <div className="bento-segmented" role="tablist" aria-label="Chọn mục học tập">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'schedule'}
                    className={`bento-seg-btn ${feedTab === 'schedule' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('schedule')}
                  >
                    Lịch học ({ov.upcoming_sessions.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'tasks'}
                    className={`bento-seg-btn ${feedTab === 'tasks' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('tasks')}
                  >
                    Cần làm ({tasksTotal})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'grades'}
                    className={`bento-seg-btn ${feedTab === 'grades' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('grades')}
                  >
                    Điểm mới ({ov.recent_grades.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'forum'}
                    className={`bento-seg-btn ${feedTab === 'forum' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('forum')}
                  >
                    Thảo luận ({ov.recent_forum_activity.length})
                  </button>
                </div>
                <Link className="t-btn t-btn--small t-btn--ghost" to="/learn/schedule">Xem lịch →</Link>
              </div>

              {feedTab === 'schedule' && (
                ov.upcoming_sessions.length === 0 ? (
                  <EmptyState title="Không có buổi học nào sắp tới" />
                ) : (
                  <div className="bento-row-list">
                    {ov.upcoming_sessions.slice(0, 3).map((s) => (
                      <div key={s.session_id} className="bento-row">
                        <div>
                          <Link className="t-row-link" to={`/learn/classes/${s.class_id}`}>{s.session_title}</Link>
                          <span className="t-sub">{s.class_code} · {s.room_or_link || label('delivery', s.delivery_mode)}</span>
                        </div>
                        <span className="t-sub tabular-nums" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.scheduled_start_at)}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {feedTab === 'tasks' && (
                ov.pending_exams.length === 0 && ov.pending_assignments.length === 0 ? (
                  <EmptyState title="Bạn đã hoàn tất các bài kiểm tra & bài tập đến hạn" />
                ) : (
                  <div className="bento-row-list">
                    {ov.pending_exams.slice(0, 2).map((ex) => (
                      <div key={ex.id} className="bento-row">
                        <div>
                          <Tone tone="warning">Kiểm tra</Tone>{' '}
                          <Link className="t-row-link" to={`/learn/classes/${ex.class_id}?tab=exams`}>{ex.title}</Link>
                          <span className="t-sub tabular-nums">{ex.class_code} · {ex.time_limit_minutes} phút</span>
                        </div>
                        <span className="t-sub tabular-nums">{ex.close_at ? fmtDate(ex.close_at) : 'Đang mở'}</span>
                      </div>
                    ))}
                    {ov.pending_assignments.slice(0, 2).map((asg) => (
                      <div key={asg.id} className="bento-row">
                        <div>
                          <Tone tone="info">Bài tập</Tone>{' '}
                          <Link className="t-row-link" to={`/learn/classes/${asg.class_id}?tab=assignments`}>{asg.title}</Link>
                          <span className="t-sub tabular-nums">{asg.class_code} · Tối đa {asg.max_score}đ</span>
                        </div>
                        <span className="t-sub tabular-nums">{asg.due_at ? fmtDate(asg.due_at) : 'Không hạn'}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              {feedTab === 'grades' && (
                ov.recent_grades.length === 0 ? (
                  <EmptyState title="Chưa có điểm mới" />
                ) : (
                  <div className="bento-row-list">
                    {ov.recent_grades.slice(0, 3).map((g) => (
                      <div key={g.id} className="bento-row">
                        <div>
                          <Link className="t-row-link" to={`/learn/classes/${g.class_id}?tab=grades`}>{g.title}</Link>
                          <span className="t-sub">{g.class_code}</span>
                        </div>
                        <strong className="tabular-nums">{g.score}/{g.max_score}</strong>
                      </div>
                    ))}
                  </div>
                )
              )}

              {feedTab === 'forum' && (
                ov.recent_forum_activity.length === 0 ? (
                  <EmptyState title="Chưa có thảo luận mới" />
                ) : (
                  <div className="bento-row-list">
                    {ov.recent_forum_activity.slice(0, 3).map((f) => (
                      <div key={f.id} className="bento-row">
                        <div>
                          <strong>{f.title}</strong>
                          <span className="t-sub">{f.forum_title} · {f.author_name}</span>
                        </div>
                        <span className="t-sub tabular-nums">{f.reply_count} trả lời</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>

            <section className="bento-card bento-card--dark" aria-label="Mục tiêu học kỳ">
              <div className="bento-card__head">
                <h2>Mục tiêu học kỳ</h2>
                <button
                  type="button"
                  className="bento-pill-action bento-pill-action--light"
                  style={{ minHeight: 36, padding: '0 12px', fontSize: 12 }}
                  onClick={() => setView('classes')}
                >
                  Xem môn học →
                </button>
              </div>

              <div className="bento-goal-list">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Hoàn thành bài giảng</strong>
                    <span className="bento-muted tabular-nums">{ov.completed_lessons}/{ov.total_lessons} ({progressPct}%)</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent-learning)' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Chuyên cần</strong>
                    <span className="bento-muted tabular-nums">{fmtPct(ov.attendance_summary.rate)}</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${attPct}%`, backgroundColor: 'var(--brand-primary)' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Bài tập & Kiểm tra</strong>
                    <span className="bento-muted tabular-nums">{tasksTotal} đang chờ</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${taskClearPct}%`, backgroundColor: 'var(--accent-streak)' }} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {view === 'classes' && classesReq.loading && <Loading rows={4} />}
      {view === 'classes' && classesReq.error && <ErrorState error={classesReq.error} onRetry={classesReq.reload} />}

      {(view === 'classes' || (!ov && !classesReq.loading)) && !classesReq.loading && !classesReq.error && (
        (classesReq.data?.items.length || 0) === 0 ? (
          <Card>
            <EmptyState
              title="Bạn chưa được xếp vào môn học nào"
              text="Khi giáo vụ hoặc giảng viên thêm bạn vào môn học, giáo trình và lịch học sẽ xuất hiện tại đây."
            />
          </Card>
        ) : (
          <div className="t-grid-cards">
            {(classesReq.data?.items || []).map((cls) => (
              <article
                key={cls.id}
                className="t-course-card"
                style={{ cursor: 'default', justifyContent: 'space-between', gap: 12 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="t-course-thumb">
                    <SmartImage src={cls.course?.thumbnail_url} alt="" fallback={<strong>{cls.code}</strong>} />
                    <span className="t-badge">{cls.subject || cls.code}</span>
                  </div>
                  <div>
                    <h3>{displayClassTitle(cls)}</h3>
                    <span className="t-sub">Giảng viên: {cls.instructor_name || 'Đang cập nhật'}</span>
                  </div>
                  {cls.progress.total > 0 ? (
                    <ProgressMeter value={cls.progress.completed} total={cls.progress.total} label={`Tiến độ ${cls.title}`} />
                  ) : (
                    <span className="t-sub">Giáo trình đang được giảng viên cập nhật</span>
                  )}
                  {cls.next_session && (
                    <div className="bento-row" style={{ fontSize: 13, alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', flexWrap: 'wrap' }}>
                        <strong>{cls.next_session.session_title}</strong>
                        {cls.next_session.virtual_room && (
                          <Badge kind="virtualProvider" value={cls.next_session.virtual_room.provider} />
                        )}
                      </div>
                      <span className="t-sub tabular-nums">{fmtDateTime(cls.next_session.scheduled_start_at)}</span>
                      {cls.next_session.virtual_room && (
                        <Btn
                          small
                          variant="primary"
                          loading={joiningSessionId === cls.next_session.session_id}
                          onClick={() => handleJoinOnline(cls.next_session!.session_id, cls.next_session!.session_title)}
                        >
                          Vào phòng trực tuyến
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
                <div className="t-actions" style={{ paddingTop: 4 }}>
                  {cls.resume_lesson_id ? (
                    <Link className="t-btn t-btn--primary" style={{ flex: 1 }} to={`/learn/classes/${cls.id}/lessons/${cls.resume_lesson_id}`}>
                      {cls.progress.completed > 0 ? 'Tiếp tục học' : 'Bắt đầu học'}
                    </Link>
                  ) : null}
                  <Link className="t-btn" style={{ flex: cls.resume_lesson_id ? undefined : 1 }} to={`/learn/classes/${cls.id}`}>
                    Chi tiết
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {checkInOpen && (
        <Modal
          title="Điểm danh nhanh tại lớp"
          onClose={() => setCheckInOpen(false)}
          width={440}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setCheckInOpen(false)}>Đóng</Btn>
              <Btn type="submit" form="student-checkin-form" variant="primary" loading={checkingIn} disabled={code.length !== 6}>
                Xác nhận có mặt
              </Btn>
            </>
          }
        >
          <form id="student-checkin-form" onSubmit={submitCheckIn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              Nhập mã điểm danh 6 chữ số giảng viên cung cấp trên lớp:
            </span>
            <input
              className="t-input tabular-nums"
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 22, letterSpacing: '0.2em', textAlign: 'center' }}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              aria-label="Mã điểm danh 6 chữ số"
              autoFocus
            />
          </form>
        </Modal>
      )}

      {joinResult && (
        <Modal
          title={`Vào phòng trực tuyến: ${joinResult.sessionTitle}`}
          onClose={() => setJoinResult(null)}
          width={520}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setJoinResult(null)}>Đóng</Btn>
              <a
                href={joinResult.join_url}
                target="_blank"
                rel="noopener noreferrer"
                className="t-btn t-btn--primary"
              >
                Mở phòng họp ({label('virtualProvider', joinResult.provider)})
              </a>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="t-notice">
              Hệ thống đã ghi nhận lượt tham gia của bạn và gắn mã định danh điểm danh tự động.
            </div>
            <dl className="t-dl">
              <dt>Nền tảng</dt>
              <dd><Badge kind="virtualProvider" value={joinResult.provider} /></dd>
              <dt>Mã phòng (Meeting ID)</dt>
              <dd className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{joinResult.meeting_code || '—'}</dd>
              <dt>Mật khẩu (Passcode)</dt>
              <dd className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{joinResult.passcode || 'Không yêu cầu'}</dd>
              <dt>Link tham gia</dt>
              <dd style={{ wordBreak: 'break-all' }}>
                <a href={joinResult.join_url} target="_blank" rel="noopener noreferrer" className="t-row-link">
                  {joinResult.join_url}
                </a>
              </dd>
            </dl>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ /learn/classes/:classId

type StudentClassTab = 'lessons' | 'attendance' | 'exams' | 'assignments' | 'grades' | 'leave' | 'wiki' | 'forum';
const VALID_STUDENT_TABS = new Set<StudentClassTab>(['lessons', 'attendance', 'exams', 'assignments', 'grades', 'leave', 'wiki', 'forum']);

export const StudentClassPage: React.FC = () => {
  const { classId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const rawTab = sp.get('tab') as StudentClassTab | null;
  const tab: StudentClassTab = rawTab && VALID_STUDENT_TABS.has(rawTab) ? rawTab : 'lessons';
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);

  const detailReq = useAsync(() => teachingApi.learnClass(classId), [classId]);
  const attReq = useAsync(
    () => (tab === 'attendance' ? teachingApi.myAttendance(classId) : Promise.resolve(null)),
    [classId, tab]
  );
  const gradesReq = useAsync(
    () => (tab === 'grades' ? masterApi.getStudentClassGrades(classId) : Promise.resolve(null)),
    [classId, tab]
  );

  if (detailReq.loading) return <Loading rows={5} />;
  if (detailReq.error || !detailReq.data) return <ErrorState error={detailReq.error} onRetry={detailReq.reload} />;

  const d = detailReq.data;

  const handleJoinClassSession = async (sessionId: string) => {
    setJoiningSessionId(sessionId);
    try {
      const res = await teachingApi.joinVirtualRoom(sessionId);
      toast({
        tone: 'success',
        title: `Đã kết nối phòng học (${label('virtualProvider', res.provider)})`,
        detail: `Đường dẫn: ${res.join_url}`,
      });
      if (res.join_url && typeof window !== 'undefined') {
        window.open(res.join_url, '_blank', 'noopener,noreferrer');
      }
      detailReq.reload();
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể tham gia phòng học', detail: errMsg(err) });
    } finally {
      setJoiningSessionId(null);
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={<><Link to="/learn">Lớp của tôi</Link><span>/</span><span>Lớp {d.class.code}</span></>}
        title={displayClassTitle({ ...d.class, course: d.course })}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{d.class.schedule_text || 'Lịch học theo thông báo lớp'}</span>
            {d.class.room ? <span>· {d.class.room}</span> : null}
            {d.class.cohort ? <span>· Lớp khóa: {d.class.cohort.code}</span> : null}
            {d.class.course_version ? <Tone tone="info">{d.class.course_version.version_label}</Tone> : null}
            {d.class.enrollment_source ? <Badge kind="enrollmentSource" value={d.class.enrollment_source} /> : null}
          </span>
        }
      />

      {d.upcoming_sessions && d.upcoming_sessions.length > 0 && (
        <Card title="Buổi học sắp tới & Phòng học trực tuyến">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {d.upcoming_sessions.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{s.title}</strong>
                    {s.virtual_room && <Badge kind="virtualProvider" value={s.virtual_room.provider} />}
                    {s.live_status && <Badge kind="liveStatus" value={s.live_status} />}
                  </div>
                  <span className="t-sub tabular-nums">
                    {fmtWeekday(s.start_at)}, {fmtDate(s.start_at)} · {fmtTime(s.start_at)}–{fmtTime(s.end_at)}
                    {s.virtual_room?.external_meeting_id ? ` · Mã phòng: ${s.virtual_room.external_meeting_id}` : s.room_or_link ? ` · ${s.room_or_link}` : ''}
                  </span>
                </div>
                {s.virtual_room && (
                  <Btn
                    variant="primary"
                    small
                    loading={joiningSessionId === s.id}
                    onClick={() => handleJoinClassSession(s.id)}
                  >
                    Tham gia lớp học trực tuyến
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {d.progress.total > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <strong>Tiến độ hoàn thành khóa học</strong>
              <span className="t-sub tabular-nums">Đã hoàn thành {d.progress.completed}/{d.progress.total} bài học</span>
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 320 }}>
              <ProgressMeter value={d.progress.completed} total={d.progress.total} label="Tiến độ khóa học" />
            </div>
          </div>
        </Card>
      )}

      <Tabs
        active={tab}
        onChange={(next) => {
          const p = new URLSearchParams(sp);
          if (next === 'lessons') p.delete('tab');
          else p.set('tab', next);
          setSp(p, { replace: true });
        }}
        tabs={[
          { id: 'lessons', label: 'Chương trình bài học', badge: d.progress.total || undefined },
          { id: 'attendance', label: 'Chuyên cần' },
          { id: 'exams', label: 'Kiểm tra' },
          { id: 'assignments', label: 'Bài tập' },
          { id: 'grades', label: 'Bảng điểm' },
          { id: 'leave', label: 'Xin nghỉ phép' },
          { id: 'wiki', label: 'Wiki' },
          { id: 'forum', label: 'Diễn đàn' },
        ]}
      />

      {tab === 'lessons' && (
        !d.content_available || d.chapters.length === 0 ? (
          <Card>
            <EmptyState
              title="Nội dung bài học đang được chuẩn bị"
              text="Giảng viên sẽ sớm xuất bản các chương và bài giảng video cho lớp học này."
            />
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {d.chapters.map((ch, ci) => (
              <div key={ch.id} className="t-chapter">
                <div className="t-chapter__head">
                  <h3>Chương {ci + 1}. {ch.title}</h3>
                  <span className="t-sub tabular-nums">{ch.lessons.length} bài học</span>
                </div>
                {ch.lessons.map((l, li) => (
                  <div key={l.id} className="t-lesson-row">
                    <div className="t-lesson-row__title">
                      <Link to={`/learn/classes/${classId}/lessons/${l.id}`}>
                        Bài {ci + 1}.{li + 1}. {l.title}
                      </Link>
                      <span className="t-sub tabular-nums">{l.duration_minutes} phút</span>
                    </div>
                    {l.progress_status === 'COMPLETED' ? (
                      <Tone tone="success">Đã hoàn thành</Tone>
                    ) : l.progress_status === 'IN_PROGRESS' ? (
                      <Tone tone="info">Đang học</Tone>
                    ) : (
                      <Tone tone="neutral">Chưa học</Tone>
                    )}
                    <Link className="t-btn t-btn--small t-btn--primary" to={`/learn/classes/${classId}/lessons/${l.id}`}>
                      {l.progress_status === 'COMPLETED' ? 'Ôn lại' : 'Vào học'}
                    </Link>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'attendance' && (
        attReq.loading ? (
          <Loading rows={4} />
        ) : attReq.error || !attReq.data ? (
          <ErrorState error={attReq.error} onRetry={attReq.reload} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="t-stats">
              <StatCard label="Tỷ lệ chuyên cần" value={fmtPct(attReq.data.rate)} hint={attReq.data.policy.formula_text} tone="success" />
              <StatCard label="Có mặt" value={attReq.data.counts.PRESENT || 0} />
              <StatCard label="Đi muộn" value={attReq.data.counts.LATE || 0} />
              <StatCard label="Vắng có phép / không phép" value={`${attReq.data.counts.EXCUSED_ABSENCE || 0} / ${attReq.data.counts.UNEXCUSED_ABSENCE || 0}`} />
            </div>

            <Card title="Chi tiết từng buổi học" padded={false}>
              {attReq.data.items.length === 0 ? (
                <EmptyState title="Chưa có lịch buổi học" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Buổi học</th>
                        <th>Ngày & Giờ</th>
                        <th>Trạng thái điểm danh</th>
                        <th>Giờ ghi nhận</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attReq.data.items.map((item) => (
                        <tr key={item.session_id}>
                          <td><strong>{item.session_title}</strong></td>
                          <td className="tabular-nums">{fmtWeekday(item.scheduled_start_at)}, {fmtDate(item.scheduled_start_at)} · {fmtTime(item.scheduled_start_at)}</td>
                          <td>
                            {item.session_status === 'CANCELLED' ? (
                              <Badge kind="attendanceState" value="CANCELLED" />
                            ) : item.attendance_status ? (
                              <Badge kind="attendance" value={item.attendance_status} />
                            ) : (
                              <Badge kind="attendance" value="NOT_MARKED" />
                            )}
                          </td>
                          <td className="tabular-nums">{item.check_in_at ? fmtTime(item.check_in_at) : '—'}</td>
                          <td>{item.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )
      )}

      {tab === 'exams' && <StudentExamsPage classId={classId} />}
      {tab === 'assignments' && <StudentAssignmentsPage classId={classId} />}
      {tab === 'grades' && (
        gradesReq.loading ? (
          <Loading rows={4} />
        ) : gradesReq.error || !gradesReq.data ? (
          <ErrorState error={gradesReq.error} onRetry={gradesReq.reload} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="t-stats">
              <StatCard
                label="Điểm trung bình lớp (Hệ 10)"
                value={gradesReq.data.average_scale_10 !== null ? gradesReq.data.average_scale_10.toFixed(2) : '—'}
                tone="success"
              />
              <StatCard label="Đầu điểm đã ghi nhận" value={gradesReq.data.gradebook_entries.length} />
            </div>
            <Card title="Chi tiết điểm thành phần" padded={false}>
              {gradesReq.data.gradebook_entries.length === 0 ? (
                <EmptyState title="Chưa có điểm nào được công bố" text="Điểm kiểm tra và bài tập của bạn sẽ hiển thị tại đây ngay khi có kết quả." />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Đầu điểm</th>
                        <th>Loại</th>
                        <th className="num">Điểm đạt</th>
                        <th className="num">Hệ số</th>
                        <th>Cập nhật</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradesReq.data.gradebook_entries.map((entry) => (
                        <tr key={entry.id}>
                          <td><strong>{entry.title}</strong></td>
                          <td>{entry.source_type === 'EXAM' ? 'Kiểm tra' : 'Bài tập'}</td>
                          <td className="num tabular-nums"><strong>{entry.score}/{entry.max_score}</strong></td>
                          <td className="num tabular-nums">{entry.weight}</td>
                          <td className="tabular-nums">{fmtDateTime(entry.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )
      )}
      {tab === 'leave' && <StudentLeaveRequestsPage fixedClassId={classId} />}
      {tab === 'wiki' && <StudentWikiPanel classId={classId} />}
      {tab === 'forum' && <ForumWorkspace mode="student_class" targetId={classId} />}
    </div>
  );
};

// ------------------------------------------------------------------ /learn/classes/:classId/lessons/:lessonId

export const StudentLessonPage: React.FC = () => {
  const { classId = '', lessonId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [lesson, setLesson] = useState<LearnLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'wiki' | 'forum' | 'hidden'>('wiki');

  const outlineReq = useAsync(() => teachingApi.learnClass(classId), [classId]);
  const classWikiReq = useAsync(() => masterApi.listStudentClassWiki(classId), [classId]);

  const effectiveWikiPages = useMemo<WikiPageItem[]>(() => {
    const byId = new Map<string, WikiPageItem>();
    (classWikiReq.data?.items || []).forEach((w) => byId.set(w.id, w));
    (lesson?.wiki_pages || []).forEach((w) => byId.set(w.id, w));
    return Array.from(byId.values());
  }, [lesson?.wiki_pages, classWikiReq.data?.items]);

  const loadLesson = async () => {
    setLoading(true);
    setError(null);
    setAnswers({});
    try {
      const data = await teachingApi.learnLesson(classId, lessonId);
      setLesson(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, lessonId]);

  if (loading) return <Loading label="Đang mở bài học…" rows={5} />;
  if (error || !lesson) return <ErrorState error={error} onRetry={loadLesson} />;

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await teachingApi.completeLesson(classId, lesson.id, answers);
      setLesson((prev) => (prev ? { ...prev, progress_status: 'COMPLETED' } : prev));
      outlineReq.reload();
      toast({
        tone: 'success',
        title: 'Đã hoàn thành bài học!',
        detail: res.next_lesson ? `Bài tiếp theo: ${res.next_lesson.title}` : 'Bạn đã hoàn thành bài học cuối cùng trong danh sách.',
      });
    } catch (e) {
      toast({ tone: 'error', title: 'Chưa đủ điều kiện hoàn thành', detail: errMsg(e) });
    } finally {
      setCompleting(false);
    }
  };

  const handleDownload = async (resourceId: string) => {
    try {
      const f = await teachingApi.downloadResource(resourceId);
      saveBlob(f);
    } catch (e) {
      toast({ tone: 'error', title: 'Không tải được tài liệu', detail: errMsg(e) });
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/learn">Lớp của tôi</Link>
            <span>/</span>
            <Link to={`/learn/classes/${classId}`}>{outlineReq.data?.class.code || 'Lớp học'}</Link>
            <span>/</span>
            <span>{lesson.chapter.title}</span>
          </>
        }
        title={lesson.title}
        subtitle={
          <>
            <span className="tabular-nums">Bài {lesson.position.index}/{lesson.position.total} · {lesson.duration_minutes} phút</span>{' '}
            · {lesson.progress_status === 'COMPLETED' ? <Tone tone="success">Đã hoàn thành</Tone> : <Tone tone="info">Đang học</Tone>}
            {lesson.course_version ? <> · <Tone tone="neutral">{lesson.course_version.version_label}</Tone></> : null}
          </>
        }
        actions={
          <div className="t-actions">
            <Btn small onClick={() => setLeftOpen((v) => !v)}>
              {leftOpen ? 'Thu gọn mục lục' : 'Hiện mục lục'}
            </Btn>
            <Btn small variant={rightTab === 'wiki' ? 'primary' : 'ghost'} onClick={() => setRightTab((t) => (t === 'wiki' ? 'hidden' : 'wiki'))}>
              Wiki bài học
            </Btn>
            <Btn small variant={rightTab === 'forum' ? 'primary' : 'ghost'} onClick={() => setRightTab((t) => (t === 'forum' ? 'hidden' : 'forum'))}>
              Hỏi đáp bài học
            </Btn>
          </div>
        }
      />

      <div
        className={`m-player-shell ${!leftOpen ? 'is-left-collapsed' : ''}`}
        style={
          rightTab === 'hidden'
            ? { gridTemplateColumns: leftOpen ? '280px minmax(0, 1fr)' : 'minmax(0, 1fr)' }
            : undefined
        }
      >
        {leftOpen && (
          <aside className="m-player-sidebar" aria-label="Mục lục khóa học">
            <strong style={{ display: 'block', fontSize: 15, marginBottom: 12 }}>Mục lục khóa học</strong>
            {outlineReq.error ? (
              <ErrorState error={outlineReq.error} onRetry={outlineReq.reload} />
            ) : (
              <nav className="t-learn-outline" aria-label="Danh sách bài học">
                {(outlineReq.data?.chapters || []).map((ch, ci) => (
                  <div key={ch.id} style={{ marginBottom: 12 }}>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', padding: '4px 12px' }}>
                      Chương {ci + 1}. {ch.title}
                    </strong>
                    {ch.lessons.map((l, li) => (
                      <Link
                        key={l.id}
                        to={`/learn/classes/${classId}/lessons/${l.id}`}
                        aria-current={l.id === lesson.id ? 'page' : undefined}
                      >
                        <span>{ci + 1}.{li + 1}. {l.title}</span>
                        <span aria-label={l.progress_status === 'COMPLETED' ? 'Đã hoàn thành' : undefined}>
                          {l.progress_status === 'COMPLETED' ? '✓' : ''}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
            )}
          </aside>
        )}

        <div className="m-player-center">
          <Card>
            <WikiReaderProvider wikiPages={effectiveWikiPages}>
              {lesson.class_custom_note?.instructor_note && (
                <div className="t-callout m-measure" style={{ marginBottom: 16 }}>
                  <strong>Dặn dò từ giảng viên lớp học</strong>
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    <WikiAnnotatedText text={lesson.class_custom_note.instructor_note} wikiPages={effectiveWikiPages} />
                  </span>
                </div>
              )}

              {(lesson.class_custom_note?.custom_objectives || lesson.objectives) && (
                <div className="t-callout m-measure" style={{ marginBottom: 24 }}>
                  <strong>Mục tiêu bài học</strong>
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    <WikiAnnotatedText
                      text={[lesson.objectives, lesson.class_custom_note?.custom_objectives].filter(Boolean).join('\n\n')}
                      wikiPages={effectiveWikiPages}
                    />
                  </span>
                </div>
              )}

              {lesson.blocks.length === 0 ? (
                <EmptyState title="Bài học chưa có nội dung chi tiết" />
              ) : (
                <BlockList
                  blocks={lesson.blocks}
                  ctx={{
                    resources: lesson.resources,
                    wikiPages: effectiveWikiPages,
                    onDownload: handleDownload,
                answers,
                onAnswer: (blockId, optionId) => setAnswers((prev) => ({ ...prev, [blockId]: optionId })),
                onCheck: (blockId, optionId) => teachingApi.checkAnswer(classId, lesson.id, blockId, optionId),
                videoMarkers: lesson.video_markers,
                videoProgress: lesson.video_progress,
                quizStates: lesson.quiz_states,
                onSaveVideoProgress: async (payload) => {
                  const res = await teachingApi.saveVideoProgress(classId, lesson.id, payload);
                  setLesson((prev) =>
                    prev
                      ? {
                          ...prev,
                          video_progress: {
                            ...(prev.video_progress || {}),
                            [payload.block_id]: res,
                          },
                        }
                      : prev
                  );
                  return res;
                },
                onSubmitVideoMarker: async (markerId, payload) => {
                  const res = await teachingApi.submitVideoMarker(classId, lesson.id, markerId, payload);
                  setLesson((prev) =>
                    prev
                      ? {
                          ...prev,
                          video_markers: (prev.video_markers || []).map((m) =>
                            m.id === markerId
                              ? {
                                  ...m,
                                  learner_state: {
                                    ...m.learner_state,
                                    completed: res.can_continue,
                                    attempts_used: res.attempt_number || m.learner_state.attempts_used + 1,
                                    is_correct: res.is_correct,
                                    can_retry: res.can_retry,
                                    last_feedback: res.feedback,
                                  },
                                }
                              : m
                          ),
                        }
                      : prev
                  );
                  return res;
                },
                onSubmitQuizBlock: async (blockId, payload) => {
                  const res = await teachingApi.submitLessonQuiz(classId, lesson.id, blockId, payload);
                  setLesson((prev) =>
                    prev
                      ? {
                          ...prev,
                          quiz_states: {
                            ...(prev.quiz_states || {}),
                            [blockId]: {
                              attempts_used: res.attempt_number,
                              max_attempts: res.max_attempts,
                              can_retry: res.can_retry,
                              passed: res.passed,
                              best_score_pct: res.score_pct,
                              earned_points: res.earned_points,
                              max_points: res.max_points,
                              last_feedback: null,
                            },
                          },
                        }
                      : prev
                  );
                  return res;
                },
                }}
              />
              )}
            </WikiReaderProvider>

          {(lesson.completion_rule === 'VIDEO_AND_QUIZ' ||
            Boolean(lesson.require_video_quizzes) ||
            (lesson.min_video_watch_pct || 0) > 0) &&
            lesson.progress_status !== 'COMPLETED' && (
              <div className="t-notice" style={{ marginTop: 24 }}>
                <strong>Điều kiện hoàn thành bài học:</strong>{' '}
                {(lesson.min_video_watch_pct || 0) > 0 && (
                  <span>
                    Xem tối thiểu <strong className="tabular-nums">{lesson.min_video_watch_pct}%</strong> thời lượng video bài giảng.{' '}
                  </span>
                )}
                {(lesson.require_video_quizzes || lesson.completion_rule === 'VIDEO_AND_QUIZ') && (
                  <span>Trả lời hoàn tất các mốc câu hỏi tương tác bắt buộc trên video.</span>
                )}
              </div>
            )}

          <div className="t-lesson-nav" style={{ marginTop: 32 }}>
            <div>
              {lesson.prev_lesson && (
                <Btn onClick={() => navigate(`/learn/classes/${classId}/lessons/${lesson.prev_lesson!.id}`)}>
                  ‹ Bài trước
                </Btn>
              )}
            </div>
            <div className="t-actions">
              {lesson.progress_status !== 'COMPLETED' && (
                <Btn variant="primary" onClick={handleComplete} loading={completing}>
                  Hoàn thành bài học
                </Btn>
              )}
              {lesson.next_lesson && (
                <Btn
                  variant={lesson.progress_status === 'COMPLETED' ? 'primary' : 'secondary'}
                  onClick={() => navigate(`/learn/classes/${classId}/lessons/${lesson.next_lesson!.id}`)}
                >
                  Bài tiếp theo ›
                </Btn>
              )}
            </div>
          </div>
          </Card>
        </div>

        {rightTab !== 'hidden' && (
          <aside className="m-player-sidebar" aria-label="Ngữ cảnh bài học">
            {rightTab === 'wiki' ? (
              <StudentWikiPanel classId={classId} lessonId={lesson.id} />
            ) : (
              <ForumWorkspace mode="student_class" targetId={classId} lessonIdFilter={lesson.id} compact />
            )}
          </aside>
        )}
      </div>
    </div>
  );
};
