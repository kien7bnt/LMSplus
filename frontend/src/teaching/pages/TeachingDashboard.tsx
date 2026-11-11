import React from 'react';
import { Link } from 'react-router-dom';
import { teachingApi } from '../api';
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader, StatCard, fmtDate, fmtPct, useAsync } from '../ui';
import { SessionRow } from '../components/SessionRow';

export const TeachingDashboard: React.FC = () => {
  const { data, error, loading, reload } = useAsync(() => teachingApi.dashboard(), []);
  const me = useAsync(() => teachingApi.me(), []);

  return (
    <div className="t-page">
      <PageHeader
        title="Tổng quan giảng dạy"
        subtitle={`Hôm nay, ${fmtDate(new Date().toISOString())}. Các việc cần xử lý được sắp theo mức độ ưu tiên.`}
        actions={
          <>
            {me.data?.can_create_course && (
              <Link className="t-btn" to="/teaching/courses?new=1">
                + Tạo khóa học
              </Link>
            )}
            {me.data?.can_create_class && (
              <Link className="t-btn t-btn--primary" to="/teaching/classes?new=1">
                + Tạo lớp học
              </Link>
            )}
          </>
        }
      />

      {loading && !data && <Loading rows={4} />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {data && (
        <>
          <div className="t-stats">
            <StatCard label="Khóa học đang quản lý" value={data.counts.courses} />
            <StatCard label="Lớp đang giảng dạy" value={data.counts.classes} />
            <StatCard label="Tổng số học viên" value={data.counts.students} />
            <StatCard label="Buổi học hôm nay" value={data.counts.sessions_today} />
            <StatCard
              label="Buổi chưa điểm danh"
              value={data.sessions_need_attendance.length}
              tone={data.sessions_need_attendance.length ? 'warning' : 'default'}
              hint="Trong 30 ngày gần nhất"
            />
            <StatCard
              label="Nhật ký chưa xác nhận"
              value={data.logs_unconfirmed.length}
              tone={data.logs_unconfirmed.some((s) => s.confirmation_status === 'OVERDUE_UNCONFIRMED') ? 'danger' : data.logs_unconfirmed.length ? 'warning' : 'default'}
            />
          </div>

          <div className="t-grid-2">
            <Card title="Buổi học hôm nay" actions={<Link className="t-btn t-btn--small t-btn--ghost" to="/teaching/schedule">Xem lịch tuần</Link>}>
              {data.today_sessions.length === 0 ? (
                <EmptyState title="Hôm nay không có buổi học" />
              ) : (
                data.today_sessions.map((s) => <SessionRow key={s.id} s={s} />)
              )}
            </Card>

            <Card title="Cần điểm danh">
              {data.sessions_need_attendance.length === 0 ? (
                <EmptyState title="Không có buổi nào đang chờ điểm danh" text="Tất cả buổi học đã diễn ra đều đã được điểm danh." />
              ) : (
                data.sessions_need_attendance.map((s) => <SessionRow key={s.id} s={s} showDate />)
              )}
            </Card>

            <Card title="Nhật ký giảng dạy chưa xác nhận">
              {data.logs_unconfirmed.length === 0 ? (
                <EmptyState title="Không còn nhật ký cần xác nhận" />
              ) : (
                data.logs_unconfirmed.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    showDate
                    actions={
                      <>
                        <Badge kind="log" value={s.confirmation_status} />
                        <Link className="t-btn t-btn--small" to={`/teaching/classes/${s.class_id}?tab=log`}>
                          Xác nhận
                        </Link>
                      </>
                    }
                  />
                ))
              )}
            </Card>

            <Card title="Buổi học sắp tới">
              {data.upcoming_sessions.length === 0 ? (
                <EmptyState title="Chưa có lịch học sắp tới" />
              ) : (
                data.upcoming_sessions.map((s) => <SessionRow key={s.id} s={s} showDate actions={<span />} />)
              )}
            </Card>
          </div>

          <div className="t-grid-2">
            <Card title="Cảnh báo chuyên cần">
              <p className="t-sub" style={{ marginTop: -8, marginBottom: 12 }}>
                Học viên có tỷ lệ chuyên cần dưới {data.attendance_policy.warning_threshold_pct}%.
              </p>
              {data.low_attendance.length === 0 ? (
                <EmptyState title="Không có học viên cần lưu ý" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Học viên</th>
                        <th>Lớp</th>
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
            <Card title="Bài tập cần chấm">
              <EmptyState
                title="Chưa kết nối module bài tập"
                text="Hệ thống hiện chưa có dịch vụ chấm bài tập đang chạy, nên mục này chưa hiển thị số liệu. Bạn vẫn có thể chèn bài tập liên quan vào nội dung bài học."
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
