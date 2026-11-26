import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SessionSummary, TimetableSessionItem, masterApi, teachingApi } from '../api';
import { SessionRow, attendanceLink, virtualSessionLink } from '../components/SessionRow';
import { IconCalendar } from '../components/Icons';
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  errMsg,
  fmtDate,
  fmtTime,
  label,
  todayVn,
  useAsync,
  useToast,
} from '../ui';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00+07:00`);
  return new Date(d.getTime() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
};
const mondayOf = (date: string) => {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};
const monthBounds = (anchor: string) => {
  const ym = anchor.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${ym}-01`, last: `${ym}-${String(lastDay).padStart(2, '0')}`, ym };
};
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00+07:00`).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

/** Lịch học (học viên) & Xem lịch đa chiều (2.1.3: Theo Lớp, Giảng viên, Phòng, Cơ sở — Tuần, Tháng, Danh sách). */
export const SchedulePage: React.FC<{ studentMode?: boolean }> = ({ studentMode = false }) => {
  const toast = useToast();
  const today = todayVn();
  const [anchorDate, setAnchorDate] = useState(mondayOf(today));
  const [view, setView] = useState<'week' | 'month' | 'list'>('week');
  const [perspective, setPerspective] = useState<'CLASS' | 'INSTRUCTOR' | 'ROOM' | 'CAMPUS'>('CLASS');

  // Bộ lọc đa chiều (2.1.3)
  const [cohortId, setCohortId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [classId, setClassId] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [shiftCode, setShiftCode] = useState('');
  const [sessionStatusFilter, setSessionStatusFilter] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === 'month') {
      const b = monthBounds(anchorDate);
      return { from: b.first, to: b.last };
    }
    const ws = mondayOf(anchorDate);
    return { from: ws, to: addDays(ws, 6) };
  }, [anchorDate, view]);

  // Học viên dùng API /schedule gọn nhẹ; Giảng viên / Giáo vụ dùng /timetable/grid đa chiều
  const studentReq = useAsync(
    () => (studentMode ? teachingApi.schedule({ from: range.from, to: range.to }) : Promise.resolve(null)),
    [studentMode, range.from, range.to]
  );

  const staffGridReq = useAsync(
    () =>
      studentMode
        ? Promise.resolve(null)
        : masterApi.getTimetableGrid({
            from: range.from,
            to: range.to,
            cohort_id: cohortId || undefined,
            course_id: courseId || undefined,
            class_id: classId || undefined,
            instructor_id: instructorId || undefined,
            classroom_id: classroomId || undefined,
            campus_id: campusId || undefined,
            shift_code: shiftCode || undefined,
          }),
    [studentMode, range.from, range.to, cohortId, courseId, classId, instructorId, classroomId, campusId, shiftCode]
  );

  const facilitiesReq = useAsync(() => (studentMode ? Promise.resolve(null) : masterApi.getFacilitiesOverview()), [studentMode]);
  const cohortsReq = useAsync(() => (studentMode ? Promise.resolve(null) : masterApi.listCohorts({ page_size: 100 })), [studentMode]);
  const coursesReq = useAsync(() => (studentMode ? Promise.resolve(null) : teachingApi.courses({ page_size: 100 })), [studentMode]);
  const classesReq = useAsync(() => (studentMode ? Promise.resolve(null) : teachingApi.classes({ page_size: 150 })), [studentMode]);

  const handleStudentJoin = async (s: SessionSummary) => {
    setJoiningId(s.id);
    try {
      const res = await teachingApi.joinVirtualRoom(s.id);
      toast({
        tone: 'success',
        title: `Đã tham gia lớp học trực tuyến (${label('virtualProvider', res.provider)})`,
        detail: res.join_url,
      });
      if (res.join_url && typeof window !== 'undefined') {
        window.open(res.join_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể tham gia phòng học', detail: errMsg(err) });
    } finally {
      setJoiningId(null);
    }
  };

  const days = useMemo(() => {
    if (view === 'month') {
      const b = monthBounds(anchorDate);
      const count = Number(b.last.slice(8, 10));
      return Array.from({ length: count }, (_, i) => `${b.ym}-${String(i + 1).padStart(2, '0')}`);
    }
    const ws = mondayOf(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [anchorDate, view]);

  // Chế độ Học viên
  if (studentMode) {
    const data = studentReq.data;
    const byDay: Record<string, SessionSummary[]> = {};
    (data?.items || []).forEach((s) => {
      const parsed = new Date(s.start_at);
      const d = Number.isNaN(parsed.getTime())
        ? s.start_at.slice(0, 10)
        : parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
      (byDay[d] ||= []).push(s);
    });

    return (
      <div className="t-page">
        <PageHeader
          title="Lịch học của tôi"
          subtitle={`${dayLabel(range.from)} – ${dayLabel(range.to)}`}
          actions={
            <>
              <Btn onClick={() => setAnchorDate(addDays(anchorDate, view === 'month' ? -30 : -7))}>‹ Trước</Btn>
              <Btn onClick={() => setAnchorDate(mondayOf(today))}>Hôm nay</Btn>
              <Btn onClick={() => setAnchorDate(addDays(anchorDate, view === 'month' ? 30 : 7))}>Sau ›</Btn>
            </>
          }
        />
        <div className="t-toolbar">
          <div className="t-seg" role="group" aria-label="Kiểu hiển thị">
            <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Tuần</button>
            <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Tháng</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Danh sách</button>
          </div>
        </div>

        {studentReq.loading && !data && <Loading />}
        {studentReq.error && <ErrorState error={studentReq.error} onRetry={studentReq.reload} />}
        {data && data.items.length === 0 && <EmptyState title="Không có buổi học trong khoảng thời gian này" />}

        {data && data.items.length > 0 && (view === 'week' || view === 'month') && (
          <div className="t-week">
            {days.map((d) => (
              <div key={d} className="t-day" data-today={d === today}>
                <h3>{dayLabel(d)}</h3>
                {(byDay[d] || []).map((s) => (
                  <div key={s.id} className="t-day-event" data-cancelled={s.session_status === 'CANCELLED'}>
                    <strong className="tabular-nums">{fmtTime(s.start_at)}–{fmtTime(s.end_at)}</strong>
                    <span>Lớp {s.class_code} · {s.title}</span>
                    <span className="t-sub">{s.virtual_room ? s.virtual_room.room_title : s.room_or_link}</span>
                    {s.virtual_room && s.session_status !== 'CANCELLED' && (
                      <div style={{ marginTop: 8 }}>
                        <Btn small variant="primary" loading={joiningId === s.id} onClick={() => handleStudentJoin(s)}>
                          Tham gia trực tuyến
                        </Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {data && data.items.length > 0 && view === 'list' && (
          <Card>
            {data.items.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                showDate
                classLink={false}
                actions={
                  s.virtual_room && s.session_status !== 'CANCELLED' ? (
                    <Btn small variant="primary" loading={joiningId === s.id} onClick={() => handleStudentJoin(s)}>
                      Tham gia lớp học trực tuyến
                    </Btn>
                  ) : (
                    <span />
                  )
                }
              />
            ))}
          </Card>
        )}
      </div>
    );
  }

  // Chế độ Giảng viên / Giáo vụ / Quản trị (2.1.3 Đa chiều)
  const rawItems = staffGridReq.data?.items || [];
  const filteredItems = sessionStatusFilter
    ? rawItems.filter((i) => i.session_status === sessionStatusFilter)
    : rawItems;

  const byDayStaff = useMemo(() => {
    const m: Record<string, TimetableSessionItem[]> = {};
    for (const s of filteredItems) {
      (m[s.date] ||= []).push(s);
    }
    return m;
  }, [filteredItems]);

  return (
    <div className="t-page">
      <PageHeader
        title="Lịch giảng dạy"
        subtitle={`Khoảng xem đa chiều: ${dayLabel(range.from)} – ${dayLabel(range.to)} (${filteredItems.length} buổi)`}
        actions={
          <div className="t-actions">
            <Btn onClick={() => setAnchorDate(addDays(anchorDate, view === 'month' ? -30 : -7))}>‹ Trước</Btn>
            <Btn onClick={() => setAnchorDate(mondayOf(today))}>Hôm nay</Btn>
            <Btn onClick={() => setAnchorDate(addDays(anchorDate, view === 'month' ? 30 : 7))}>Sau ›</Btn>
            <Link className="t-btn t-btn--primary" to="/teaching/timetable">
              <IconCalendar size={15} /> Điều phối thời khóa biểu
            </Link>
          </div>
        }
      />

      {/* Góc nhìn & Dạng hiển thị */}
      <div className="t-toolbar">
        <div className="t-seg" role="group" aria-label="Góc nhìn lịch">
          <button type="button" aria-pressed={perspective === 'CLASS'} onClick={() => setPerspective('CLASS')}>Theo Lớp</button>
          <button type="button" aria-pressed={perspective === 'INSTRUCTOR'} onClick={() => setPerspective('INSTRUCTOR')}>Theo Giảng viên</button>
          <button type="button" aria-pressed={perspective === 'ROOM'} onClick={() => setPerspective('ROOM')}>Theo Phòng</button>
          <button type="button" aria-pressed={perspective === 'CAMPUS'} onClick={() => setPerspective('CAMPUS')}>Theo Cơ sở</button>
        </div>

        <div className="t-seg" role="group" aria-label="Kiểu lịch">
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Tuần</button>
          <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Tháng</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Danh sách</button>
        </div>
      </div>

      {/* Bộ lọc chi tiết 2.1.3 */}
      <div className="t-toolbar">
        {perspective === 'CLASS' && (
          <select className="t-input" aria-label="Chọn lớp môn học" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Tất cả lớp môn học</option>
            {(classesReq.data?.items || []).map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        )}
        {perspective === 'INSTRUCTOR' && (
          <select className="t-input" aria-label="Chọn giảng viên" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">Tất cả giảng viên</option>
            {(facilitiesReq.data?.instructors || []).map((ins) => (
              <option key={ins.id} value={ins.id}>{ins.full_name} ({ins.code})</option>
            ))}
          </select>
        )}
        {perspective === 'ROOM' && (
          <select className="t-input" aria-label="Chọn phòng học" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            <option value="">Tất cả phòng học</option>
            {(facilitiesReq.data?.classrooms || []).map((rm) => (
              <option key={rm.id} value={rm.id}>{rm.code} — {rm.name}</option>
            ))}
          </select>
        )}
        {perspective === 'CAMPUS' && (
          <select className="t-input" aria-label="Chọn cơ sở" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
            <option value="">Tất cả cơ sở</option>
            {(facilitiesReq.data?.campuses || []).map((cp) => (
              <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>
            ))}
          </select>
        )}

        <select className="t-input" aria-label="Lọc theo khóa học" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
          <option value="">Tất cả khóa học</option>
          {(cohortsReq.data?.items || []).map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.code} — {ch.title}</option>
          ))}
        </select>

        <select className="t-input" aria-label="Lọc theo môn học" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Tất cả môn học</option>
          {(coursesReq.data?.items || []).map((cr) => (
            <option key={cr.id} value={cr.id}>{cr.code} — {cr.title}</option>
          ))}
        </select>

        <select className="t-input" aria-label="Lọc theo ca học" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
          <option value="">Tất cả ca học</option>
          {(facilitiesReq.data?.shifts || []).map((sh) => (
            <option key={sh.code} value={sh.code}>{sh.title}</option>
          ))}
        </select>

        <select className="t-input" aria-label="Lọc trạng thái buổi" value={sessionStatusFilter} onChange={(e) => setSessionStatusFilter(e.target.value)}>
          <option value="">Mọi trạng thái buổi</option>
          <option value="SCHEDULED">Đã lên lịch</option>
          <option value="COMPLETED">Đã kết thúc</option>
          <option value="CANCELLED">Đã báo nghỉ / Hủy</option>
        </select>
      </div>

      {staffGridReq.loading && !staffGridReq.data && <Loading />}
      {staffGridReq.error && <ErrorState error={staffGridReq.error} onRetry={staffGridReq.reload} />}
      {staffGridReq.data && filteredItems.length === 0 && (
        <EmptyState title="Không có buổi học nào khớp bộ lọc hiện tại" />
      )}

      {filteredItems.length > 0 && (view === 'week' || view === 'month') && (
        <div className="t-week">
          {days
            .filter((d) => view === 'week' || (byDayStaff[d] && byDayStaff[d].length > 0))
            .map((d) => (
              <div key={d} className="t-day" data-today={d === today}>
                <h3>{dayLabel(d)}</h3>
                {(byDayStaff[d] || []).map((s) => (
                  <Link
                    key={s.id}
                    className="t-day-event"
                    data-cancelled={s.session_status === 'CANCELLED'}
                    to={`/teaching/classes/${s.class_id}/attendance?session=${s.id}`}
                  >
                    <strong className="tabular-nums">{s.start_time}–{s.end_time}</strong>
                    <span>Lớp {s.class_code} · {s.title}</span>
                    <span className="t-sub">
                      {s.classroom_code || s.classroom_name || 'Chưa gán phòng'}
                      {s.campus_code ? ` (${s.campus_code})` : ''} · GV: {s.instructor_name || '—'}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      <Badge kind="scheduleState" value={s.schedule_state} />
                      <Badge kind="sessionStatus" value={s.session_status} />
                      {s.session_kind === 'MAKEUP' && <Badge kind="sessionKind" value="MAKEUP" />}
                    </div>
                  </Link>
                ))}
              </div>
            ))}
        </div>
      )}

      {filteredItems.length > 0 && view === 'list' && (
        <Card padded={false}>
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Ngày & Giờ</th>
                  <th>Lớp môn & Buổi học</th>
                  <th>Giảng viên</th>
                  <th>Phòng / Cơ sở</th>
                  <th>Trạng thái</th>
                  <th className="actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((s) => (
                  <tr key={s.id}>
                    <td className="tabular-nums t-nowrap">
                      <strong>{fmtDate(s.date)}</strong>
                      <span className="t-sub">{s.start_time} – {s.end_time} ({s.planned_periods} tiết)</span>
                    </td>
                    <td>
                      <strong>{s.class_code}</strong> — {s.title}
                      {s.session_kind === 'MAKEUP' && <span style={{ marginLeft: 6 }}><Badge kind="sessionKind" value="MAKEUP" /></span>}
                    </td>
                    <td>
                      {s.instructor_name || '—'}
                      {s.is_substitute && <span className="t-sub">Dạy thay</span>}
                    </td>
                    <td>
                      {s.classroom_code || s.classroom_name || '—'}
                      {s.campus_name && <span className="t-sub">{s.campus_name}</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Badge kind="scheduleState" value={s.schedule_state} />
                        <Badge kind="sessionStatus" value={s.session_status} />
                      </div>
                    </td>
                    <td className="actions">
                      <Link className="t-btn t-btn--small" to={`/teaching/classes/${s.class_id}/attendance?session=${s.id}`}>
                        Điểm danh
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
