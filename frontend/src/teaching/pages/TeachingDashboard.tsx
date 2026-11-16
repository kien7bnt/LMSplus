import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { SessionSummary, masterApi, teachingApi } from '../api';
import { Badge, Card, EmptyState, ErrorState, Loading, fmtDate, fmtDateTime, fmtPct, fmtTime, useAsync } from '../ui';
import { SessionRow, attendanceLink } from '../components/SessionRow';

type DashView = 'overview' | 'pending' | 'alerts';
type FeedTab = 'today' | 'attendance' | 'logs' | 'upcoming';

const CompactDashRow: React.FC<{ s: SessionSummary; mode: FeedTab }> = ({ s, mode }) => (
  <div className="bento-session-row">
    <div className="bento-session-row__time">
      <strong>{fmtTime(s.start_at)} – {fmtTime(s.end_at)}</strong>
      <span>{fmtDate(s.start_at)}</span>
    </div>
    <div className="bento-session-row__main">
      <Link className="bento-session-row__title" to={`/teaching/classes/${s.class_id}`}>
        {s.class_code} · {s.title}
      </Link>
      <span className="bento-muted">
        {s.virtual_room ? s.virtual_room.room_title : s.room_or_link || 'Chưa có phòng học'}
        {s.marked_count > 0 ? ` · ${s.marked_count} đã điểm danh` : ''}
      </span>
    </div>
    <div className="bento-session-row__actions">
      {mode === 'logs' ? (
        <>
          <Badge kind="log" value={s.confirmation_status} />
          <Link className="bento-pill-action bento-pill-action--primary" to={`/teaching/classes/${s.class_id}?tab=log`}>
            Xác nhận
          </Link>
        </>
      ) : mode === 'upcoming' ? (
        <Link className="bento-pill-action" to={`/teaching/classes/${s.class_id}`}>
          Chi tiết
        </Link>
      ) : (
        <>
          <Badge kind="attendanceState" value={s.attendance_state} />
          {s.session_status !== 'CANCELLED' && s.attendance_state !== 'NOT_STARTED' && (
            <Link
              className={`bento-pill-action ${s.attendance_state === 'NEEDS_ATTENDANCE' ? 'bento-pill-action--primary' : ''}`}
              to={attendanceLink(s)}
            >
              {s.attendance_state === 'NEEDS_ATTENDANCE' ? 'Điểm danh' : 'Xem'}
            </Link>
          )}
        </>
      )}
    </div>
  </div>
);

export const TeachingDashboard: React.FC = () => {
  const { data, error, loading, reload } = useAsync(() => teachingApi.dashboard(), []);
  const me = useAsync(() => teachingApi.me(), []);
  const pendingLeaves = useAsync(() => masterApi.listStaffLeaveRequests({ status: 'PENDING' }), []);
  const [view, setView] = useState<DashView>('overview');
  const [feedTab, setFeedTab] = useState<FeedTab>('today');

  const leaveItems = pendingLeaves.data?.items || [];
  const pendingLeavesCount = leaveItems.length || data?.leave_requests_pending || 0;

  const todayDone = data
    ? Math.max(0, data.today_sessions.length - data.sessions_need_attendance.filter((s) => data.today_sessions.some((t) => t.id === s.id)).length)
    : 0;
  const todayTotal = data?.today_sessions.length || 0;
  const attPct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 100;
  const logPct = data ? Math.max(12, Math.min(100, 100 - data.logs_unconfirmed.length * 15)) : 100;
  const studentAlertPct = data && data.counts.students > 0
    ? Math.max(8, Math.round(((data.counts.students - data.low_attendance.length) / data.counts.students) * 100))
    : 100;

  return (
    <div className="t-page bento-page">
      <div className="bento-context">
        <div className="bento-context__left">
          <h1>Tổng quan giảng dạy</h1>
          <span className="bento-muted">
            Hôm nay, {fmtDate(new Date().toISOString())}
          </span>
        </div>

        <div className="bento-context__right">
          <div className="bento-segmented" role="tablist" aria-label="Chế độ xem tổng quan">
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
              aria-selected={view === 'pending'}
              className={`bento-seg-btn ${view === 'pending' ? 'is-active' : ''}`}
              onClick={() => setView('pending')}
            >
              Chờ xử lý ({(data?.sessions_need_attendance.length || 0) + (data?.logs_unconfirmed.length || 0) + pendingLeavesCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'alerts'}
              className={`bento-seg-btn ${view === 'alerts' ? 'is-active' : ''}`}
              onClick={() => setView('alerts')}
            >
              Cảnh báo ({data?.low_attendance.length || 0})
            </button>
          </div>

          {me.data?.can_create_class && (
            <Link className="bento-pill-action bento-pill-action--primary" to="/teaching/classes?new=1">
              + Tạo lớp học
            </Link>
          )}
        </div>
      </div>

      {loading && !data && <Loading rows={4} />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {data && view === 'overview' && (
        <>
          <div className="bento-top-grid">
            <section className="bento-card" aria-label="Tóm tắt lịch dạy hôm nay">
              <div className="bento-card__head">
                <span className="bento-card__label">LỊCH DẠY HÔM NAY</span>
                <span className="t-badge tabular-nums">{data.counts.classes} lớp học</span>
              </div>
              <div>
                <div className="bento-hero__num">{data.counts.sessions_today} buổi</div>
                <p className="bento-muted" style={{ margin: '6px 0 0' }}>
                  Phụ trách <strong style={{ color: 'var(--text-primary)' }}>{data.counts.students}</strong> học viên · {data.counts.courses} giáo trình
                </p>
              </div>
              <div className="bento-pill-actions">
                <Link className="bento-pill-action" to="/teaching/schedule">Lịch dạy</Link>
                <Link className="bento-pill-action" to="/teaching/banks">Học liệu</Link>
                <Link className="bento-pill-action" to="/teaching/leave-requests">
                  Đơn nghỉ ({pendingLeavesCount})
                </Link>
              </div>
            </section>

            <div className="bento-kpi-trio">
              <Link className="bento-kpi-trigger" to="/teaching/classes">
                <div className="bento-card bento-kpi-card">
                  <div className="bento-card__head">
                    <div className="bento-kpi-title">
                      <span className="bento-icon-circle bento-icon-circle--learning" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                        </svg>
                      </span>
                      <span className="bento-muted">Lớp học</span>
                    </div>
                    <span className="bento-muted" aria-hidden="true">↗</span>
                  </div>
                  <div>
                    <div className="bento-kpi__num">{data.counts.classes}</div>
                    <div className="bento-muted" style={{ marginTop: 4 }}>{data.counts.courses} giáo trình gốc</div>
                  </div>
                </div>
              </Link>

              <button
                type="button"
                className="bento-kpi-trigger"
                onClick={() => setFeedTab('attendance')}
              >
                <div className="bento-card bento-kpi-card">
                  <div className="bento-card__head">
                    <div className="bento-kpi-title">
                      <span className="bento-icon-circle bento-icon-circle--streak" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="m9 12 2 2 4-4" />
                        </svg>
                      </span>
                      <span className="bento-muted">Chờ điểm danh</span>
                    </div>
                  </div>
                  <div>
                    <div className="bento-kpi__num" style={{ color: data.sessions_need_attendance.length ? 'var(--status-warning)' : undefined }}>
                      {data.sessions_need_attendance.length}
                    </div>
                    <div className="bento-muted" style={{ marginTop: 4 }}>Trong 30 ngày gần nhất</div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="bento-kpi-trigger"
                onClick={() => setFeedTab('logs')}
              >
                <div className="bento-card bento-kpi-card">
                  <div className="bento-card__head">
                    <div className="bento-kpi-title">
                      <span className="bento-icon-circle bento-icon-circle--brand" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 8v4" />
                          <path d="M12 16h.01" />
                        </svg>
                      </span>
                      <span className="bento-muted">Chờ xác nhận</span>
                    </div>
                  </div>
                  <div>
                    <div className="bento-kpi__num" style={{ color: data.logs_unconfirmed.length ? 'var(--brand-primary)' : undefined }}>
                      {data.logs_unconfirmed.length}
                    </div>
                    <div className="bento-muted" style={{ marginTop: 4 }}>Bài cần chấm: {data.assignments_to_grade ?? 0}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="bento-split">
            <section className="bento-card" aria-label="Hoạt động giảng dạy gần nhất">
              <div className="bento-card__head">
                <div className="bento-segmented" role="tablist" aria-label="Chọn danh sách nhanh">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'today'}
                    className={`bento-seg-btn ${feedTab === 'today' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('today')}
                  >
                    Hôm nay ({data.today_sessions.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'attendance'}
                    className={`bento-seg-btn ${feedTab === 'attendance' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('attendance')}
                  >
                    Điểm danh ({data.sessions_need_attendance.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'logs'}
                    className={`bento-seg-btn ${feedTab === 'logs' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('logs')}
                  >
                    Nhật ký ({data.logs_unconfirmed.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={feedTab === 'upcoming'}
                    className={`bento-seg-btn ${feedTab === 'upcoming' ? 'is-active' : ''}`}
                    onClick={() => setFeedTab('upcoming')}
                  >
                    Sắp tới ({data.upcoming_sessions.length})
                  </button>
                </div>
                <Link className="t-btn t-btn--small t-btn--ghost" to="/teaching/schedule">
                  Xem tất cả →
                </Link>
              </div>

              <div className="bento-row-list">
                {feedTab === 'today' && (
                  data.today_sessions.length === 0 ? (
                    <EmptyState title="Hôm nay không có buổi dạy" />
                  ) : (
                    data.today_sessions.slice(0, 3).map((s) => <CompactDashRow key={s.id} s={s} mode="today" />)
                  )
                )}
                {feedTab === 'attendance' && (
                  data.sessions_need_attendance.length === 0 ? (
                    <EmptyState title="Không có buổi đang chờ điểm danh" />
                  ) : (
                    data.sessions_need_attendance.slice(0, 3).map((s) => <CompactDashRow key={s.id} s={s} mode="attendance" />)
                  )
                )}
                {feedTab === 'logs' && (
                  data.logs_unconfirmed.length === 0 ? (
                    <EmptyState title="Không còn nhật ký cần xác nhận" />
                  ) : (
                    data.logs_unconfirmed.slice(0, 3).map((s) => <CompactDashRow key={s.id} s={s} mode="logs" />)
                  )
                )}
                {feedTab === 'upcoming' && (
                  data.upcoming_sessions.length === 0 ? (
                    <EmptyState title="Chưa có lịch sắp tới" />
                  ) : (
                    data.upcoming_sessions.slice(0, 3).map((s) => <CompactDashRow key={s.id} s={s} mode="upcoming" />)
                  )
                )}
              </div>
            </section>

            <section className="bento-card" aria-label="Tiêu điểm vận hành">
              <div className="bento-card__head">
                <div>
                  <h2>Tiêu điểm vận hành</h2>
                  <span className="bento-muted">Tổng hợp trạng thái trong kỳ</span>
                </div>
                <Link className="bento-pill-action" to="/teaching/classes">
                  Lớp học →
                </Link>
              </div>

              <div className="bento-goal-list">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Điểm danh hôm nay</strong>
                    <span className="bento-muted tabular-nums">{todayDone}/{todayTotal || 1} ({attPct}%)</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${Math.max(4, attPct)}%`, backgroundColor: 'var(--accent-learning)' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Xác nhận nhật ký</strong>
                    <span className="bento-muted tabular-nums">{data.logs_unconfirmed.length} chờ xử lý</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${logPct}%`, backgroundColor: 'var(--brand-primary)' }} />
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <strong>Chuyên cần ổn định</strong>
                    <span className="bento-muted tabular-nums">{data.low_attendance.length} cần lưu ý</span>
                  </div>
                  <div className="bento-goal-track">
                    <div className="bento-goal-fill" style={{ width: `${studentAlertPct}%`, backgroundColor: 'var(--accent-streak)' }} />
                  </div>
                </div>
              </div>

              <div className="bento-pill-actions">
                <Link className="bento-pill-action" to="/teaching/cohorts">Khóa học</Link>
                {me.data?.can_create_course && (
                  <Link className="bento-pill-action bento-pill-action--primary" to="/teaching/courses?new=1">+ Giáo trình</Link>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {data && view === 'pending' && (
        <div className="t-grid-2">
          <Card title={`Cần điểm danh (${data.sessions_need_attendance.length})`}>
            {data.sessions_need_attendance.length === 0 ? (
              <EmptyState title="Không có buổi nào chờ điểm danh" />
            ) : (
              data.sessions_need_attendance.map((s) => <SessionRow key={s.id} s={s} showDate />)
            )}
          </Card>

          <Card
            title={`Đơn xin nghỉ chờ duyệt (${pendingLeavesCount})`}
            actions={<Link className="t-btn t-btn--small t-btn--ghost" to="/teaching/leave-requests">Mở trang Đơn nghỉ →</Link>}
          >
            {pendingLeaves.loading ? (
              <Loading rows={2} />
            ) : leaveItems.length === 0 ? (
              <EmptyState title="Không có đơn xin nghỉ chờ duyệt" />
            ) : (
              <div className="bento-row-list">
                {leaveItems.slice(0, 6).map((reqItem) => (
                  <div key={String(reqItem.id)} className="bento-row">
                    <div>
                      <strong>{reqItem.student_name}</strong> ({reqItem.class_code})
                      <span className="t-sub">
                        {reqItem.session_title ? `${reqItem.session_title} · ` : ''}
                        {reqItem.scheduled_start_at ? `${fmtDateTime(reqItem.scheduled_start_at)} · ` : ''}
                        {reqItem.reason}
                      </span>
                    </div>
                    <Link className="t-btn t-btn--small" to={`/teaching/classes/${reqItem.class_id}?tab=leave`}>
                      Xử lý
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {data && view === 'alerts' && (
        <Card title="Học viên có tỷ lệ chuyên cần dưới ngưỡng">
          <p className="t-sub" style={{ marginTop: -8, marginBottom: 12 }}>
            Ngưỡng cảnh báo hiện tại: dưới {data.attendance_policy.warning_threshold_pct}%.
          </p>
          {data.low_attendance.length === 0 ? (
            <EmptyState title="Không có học viên cần lưu ý" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Môn học</th>
                    <th className="num">Chuyên cần</th>
                  </tr>
                </thead>
                <tbody>
                  {data.low_attendance.map((s) => (
                    <tr key={`${s.class_id}-${s.student_id}`}>
                      <td>
                        {s.full_name}
                        <span className="t-sub">{s.code}</span>
                      </td>
                      <td>
                        <Link className="t-row-link" to={`/teaching/classes/${s.class_id}?tab=results`}>
                          {s.class_code}
                        </Link>
                      </td>
                      <td className="num" style={{ color: 'var(--status-danger)', fontWeight: 700 }}>
                        {fmtPct(s.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
