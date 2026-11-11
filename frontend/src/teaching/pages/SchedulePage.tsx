import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SessionSummary, teachingApi } from '../api';
import { Badge, Btn, Card, EmptyState, ErrorState, Loading, PageHeader, fmtTime, todayVn, useAsync } from '../ui';
import { SessionRow, attendanceLink } from '../components/SessionRow';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00+07:00`);
  return new Date(d.getTime() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
};
const mondayOf = (date: string) => {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit' });

/** Lịch dạy (giảng viên) hoặc lịch học (học viên) theo tuần / theo ngày. */
export const SchedulePage: React.FC<{ studentMode?: boolean }> = ({ studentMode = false }) => {
  const today = todayVn();
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [view, setView] = useState<'week' | 'list'>('week');
  const [classId, setClassId] = useState('');
  const weekEnd = addDays(weekStart, 6);
  const { data, error, loading, reload } = useAsync(
    () => teachingApi.schedule({ from: weekStart, to: weekEnd, class_id: classId || undefined }),
    [weekStart, classId]
  );
  const classListReq = useAsync(
    () => (studentMode ? Promise.resolve(null) : teachingApi.classes({ page_size: 100 })),
    [studentMode]
  );
  const classes = useMemo(() => {
    const m = new Map<string, string>();
    (classListReq.data?.items || []).forEach((c) => m.set(c.id, c.code));
    (data?.items || []).forEach((s) => m.set(s.class_id, s.class_code));
    return [...m.entries()];
  }, [classListReq.data, data]);
  const byDay = useMemo(() => {
    const m: Record<string, SessionSummary[]> = {};
    (data?.items || []).forEach((s) => {
      const parsed = new Date(s.start_at);
      const d = Number.isNaN(parsed.getTime())
        ? s.start_at.slice(0, 10)
        : parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
      (m[d] ||= []).push(s);
    });
    return m;
  }, [data]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="t-page">
      <PageHeader
        title={studentMode ? 'Lịch học' : 'Lịch giảng dạy'}
        subtitle={`Tuần ${dayLabel(weekStart)} – ${dayLabel(weekEnd)}`}
        actions={
          <>
            <Btn onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Tuần trước</Btn>
            <Btn onClick={() => setWeekStart(mondayOf(today))}>Tuần này</Btn>
            <Btn onClick={() => setWeekStart(addDays(weekStart, 7))}>Tuần sau ›</Btn>
          </>
        }
      />
      <div className="t-toolbar">
        <div className="t-seg" role="group" aria-label="Kiểu hiển thị">
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>
            Theo tuần
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            Danh sách
          </button>
        </div>
        {!studentMode && (
          <select className="t-input" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>
            {classes.map(([id, code]) => (
              <option key={id} value={id}>
                Lớp {code}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="Không có buổi học trong tuần này" />}

      {data && data.items.length > 0 && view === 'week' && (
        <div className="t-week">
          {days.map((d) => (
            <div key={d} className="t-day" data-today={d === today}>
              <h3>{dayLabel(d)}</h3>
              {(byDay[d] || []).map((s) => {
                const content = (
                  <>
                    <strong className="tabular-nums">
                      {fmtTime(s.start_at)}–{fmtTime(s.end_at)}
                    </strong>
                    <span>Lớp {s.class_code}</span>
                    <span className="t-sub">{s.room_or_link}</span>
                    {!studentMode && <Badge kind="attendanceState" value={s.attendance_state} />}
                  </>
                );
                return studentMode || s.session_status === 'CANCELLED' ? (
                  <div key={s.id} className="t-day-event" data-cancelled={s.session_status === 'CANCELLED'}>
                    {content}
                  </div>
                ) : (
                  <Link key={s.id} className="t-day-event" to={attendanceLink(s)}>
                    {content}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {data && data.items.length > 0 && view === 'list' && (
        <Card>
          {data.items.map((s) => (
            <SessionRow key={s.id} s={s} showDate classLink={!studentMode} actions={studentMode ? <span /> : undefined} />
          ))}
        </Card>
      )}
    </div>
  );
};
