import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LearnLesson, masterApi, saveBlob, teachingApi } from '../api';
import { BlockList } from '../BlockRenderer';
import {
  Badge, Btn, Card, EmptyState, ErrorState, Loading, Modal, PageHeader, ProgressMeter, SmartImage, StatCard, Tabs, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, fmtTime, fmtWeekday, label, useAsync, useToast,
} from '../ui';
import { StudentAssignmentsPage, StudentExamsPage } from './StudentAssessmentPages';
import { StudentLeaveRequestsPage } from './LeaveRequestsPage';
import { StudentWikiPanel } from './WikiPanel';
import { ForumWorkspace } from './ForumPanel';

// ------------------------------------------------------------------ /learn — Trang chủ học viên

export const StudentHomePage: React.FC = () => {
  const toast = useToast();
  const overviewReq = useAsync(() => masterApi.getStudentOverview(), []);
  const classesReq = useAsync(() => teachingApi.learnClasses(), []);
  const [code, setCode] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
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

  return (
    <div className="t-page">
      <PageHeader
        title="Không gian học tập của tôi"
        subtitle="Theo dõi tổng quan học tập 10 mục, lớp đang học, lịch thi, bài tập, điểm số và chuyên cần."
        actions={
          <div className="t-actions">
            {ov?.continue_learning && (
              <Link
                className="t-btn t-btn--primary"
                to={`/learn/classes/${ov.continue_learning.class_id}/lessons/${ov.continue_learning.lesson_id}`}
              >
                ▶ Tiếp tục học: {ov.continue_learning.lesson_title}
              </Link>
            )}
            <Link className="t-btn" to="/learn/exams">Kiểm tra</Link>
            <Link className="t-btn" to="/learn/assignments">Bài tập</Link>
            <Link className="t-btn" to="/learn/leave-requests">Xin nghỉ phép</Link>
          </div>
        }
      />

      {ov && (
        <>
          <div className="t-stats">
            <StatCard label="Lớp đang học" value={ov.total_classes} />
            <StatCard
              label="Tiến độ bài học"
              value={fmtPct(ov.overall_progress_pct)}
              hint={`${ov.completed_lessons}/${ov.total_lessons} bài đã hoàn thành`}
              tone="success"
            />
            <StatCard
              label="Bài tập cần làm"
              value={ov.pending_assignments_count}
              tone={ov.pending_assignments_count > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Bài kiểm tra chờ thi"
              value={ov.pending_exams_count}
              tone={ov.pending_exams_count > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Tỷ lệ chuyên cần"
              value={fmtPct(ov.attendance_summary.rate)}
              hint={`${ov.attendance_summary.present} có mặt · ${ov.attendance_summary.absent} vắng`}
            />
            <StatCard label="Đơn nghỉ chờ duyệt" value={ov.pending_leave_requests} />
          </div>

          <div className="t-grid-2">
            <Card
              title="Lịch học sắp tới"
              actions={<Link className="t-btn t-btn--small t-btn--ghost" to="/learn/schedule">Xem tất cả</Link>}
            >
              {ov.upcoming_sessions.length === 0 ? (
                <EmptyState title="Không có buổi học nào sắp tới" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ov.upcoming_sessions.slice(0, 4).map((s) => (
                    <div key={s.session_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                      <div>
                        <Link className="t-row-link" to={`/learn/classes/${s.class_id}`}>{s.session_title}</Link>
                        <span className="t-sub">{s.class_code} · {s.room_or_link || label('delivery', s.delivery_mode)}</span>
                      </div>
                      <span className="t-sub tabular-nums" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.scheduled_start_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Bài kiểm tra & Bài tập cần hoàn thành"
              actions={
                <div className="t-actions">
                  <Link className="t-btn t-btn--small t-btn--ghost" to="/learn/exams">Thi</Link>
                  <Link className="t-btn t-btn--small t-btn--ghost" to="/learn/assignments">Bài tập</Link>
                </div>
              }
            >
              {ov.pending_exams.length === 0 && ov.pending_assignments.length === 0 ? (
                <EmptyState title="Bạn đã hoàn tất các bài kiểm tra & bài tập đến hạn" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ov.pending_exams.slice(0, 3).map((ex) => (
                    <div key={ex.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <Tone tone="warning">Kiểm tra</Tone>{' '}
                        <Link className="t-row-link" to={`/learn/classes/${ex.class_id}?tab=exams`}>{ex.title}</Link>
                        <span className="t-sub tabular-nums">{ex.class_code} · {ex.time_limit_minutes} phút</span>
                      </div>
                      <span className="t-sub tabular-nums">{ex.close_at ? fmtDate(ex.close_at) : 'Đang mở'}</span>
                    </div>
                  ))}
                  {ov.pending_assignments.slice(0, 3).map((asg) => (
                    <div key={asg.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <Tone tone="info">Bài tập</Tone>{' '}
                        <Link className="t-row-link" to={`/learn/classes/${asg.class_id}?tab=assignments`}>{asg.title}</Link>
                        <span className="t-sub tabular-nums">{asg.class_code} · Tối đa {asg.max_score}đ</span>
                      </div>
                      <span className="t-sub tabular-nums">{asg.due_at ? fmtDate(asg.due_at) : 'Không hạn'}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Điểm số mới công bố">
              {ov.recent_grades.length === 0 ? (
                <EmptyState title="Chưa có điểm mới" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ov.recent_grades.slice(0, 4).map((g) => (
                    <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                      <div>
                        <Link className="t-row-link" to={`/learn/classes/${g.class_id}?tab=grades`}>{g.title}</Link>
                        <span className="t-sub">{g.class_code}</span>
                      </div>
                      <strong className="tabular-nums">{g.score}/{g.max_score}</strong>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Hoạt động diễn đàn gần đây">
              {ov.recent_forum_activity.length === 0 ? (
                <EmptyState title="Chưa có thảo luận mới" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ov.recent_forum_activity.slice(0, 4).map((f) => (
                    <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
                      <div>
                        <strong>{f.title}</strong>
                        <span className="t-sub">{f.forum_title} · {f.author_name}</span>
                      </div>
                      <span className="t-sub tabular-nums">{f.reply_count} trả lời</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Card title="Điểm danh nhanh tại lớp">
        <form onSubmit={submitCheckIn} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)', flex: '1 1 280px' }}>
            Khi giảng viên mở mã điểm danh trên lớp, nhập mã 6 chữ số tại đây:
          </span>
          <input
            className="t-input tabular-nums"
            style={{ width: 180, fontFamily: 'var(--font-mono)', fontSize: 18, letterSpacing: '0.15em', textAlign: 'center' }}
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="Mã điểm danh 6 chữ số"
          />
          <Btn type="submit" variant="primary" loading={checkingIn} disabled={code.length !== 6}>
            Xác nhận có mặt
          </Btn>
        </form>
      </Card>

      {classesReq.loading && <Loading rows={4} />}
      {classesReq.error && <ErrorState error={classesReq.error} onRetry={classesReq.reload} />}

      {!classesReq.loading && !classesReq.error && (
        (classesReq.data?.items.length || 0) === 0 ? (
          <Card>
            <EmptyState
              title="Bạn chưa được xếp vào lớp học nào"
              text="Khi giáo vụ hoặc giảng viên thêm bạn vào lớp, khóa học và lịch học sẽ xuất hiện tại đây."
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
                    <div className="t-notice" style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong>Buổi học tới: {cls.next_session.session_title}</strong>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {cls.next_session.virtual_room && (
                            <Badge kind="virtualProvider" value={cls.next_session.virtual_room.provider} />
                          )}
                          {cls.next_session.live_status && (
                            <Badge kind="liveStatus" value={cls.next_session.live_status} />
                          )}
                        </div>
                      </div>
                      <span className="tabular-nums">
                        {fmtDateTime(cls.next_session.scheduled_start_at)}
                        {cls.next_session.room_or_link ? ` · ${cls.next_session.room_or_link}` : ''}
                      </span>
                      {cls.next_session.virtual_room && (
                        <div>
                          <Btn
                            small
                            variant="primary"
                            loading={joiningSessionId === cls.next_session.session_id}
                            onClick={() => handleJoinOnline(cls.next_session!.session_id, cls.next_session!.session_title)}
                          >
                            Tham gia lớp học trực tuyến
                          </Btn>
                        </div>
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
                    Chi tiết lớp
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )
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
            {lesson.class_custom_note?.instructor_note && (
              <div className="t-callout m-measure" style={{ marginBottom: 16 }}>
                <strong>Dặn dò từ giảng viên lớp học</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>{lesson.class_custom_note.instructor_note}</span>
              </div>
            )}

            {(lesson.class_custom_note?.custom_objectives || lesson.objectives) && (
              <div className="t-callout m-measure" style={{ marginBottom: 24 }}>
                <strong>Mục tiêu bài học</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>
                  {[lesson.objectives, lesson.class_custom_note?.custom_objectives].filter(Boolean).join('\n\n')}
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
