import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AcademicHolidayItem,
  CampusItem,
  ClassroomItem,
  FacilitiesOverview,
  InstructorAvailabilityItem,
  RoomType,
  ShiftPresetItem,
  TimetableAuditReport,
  TimetableSessionItem,
  TimetableSlotHint,
  UnscheduledSessionItem,
  masterApi,
  teachingApi,
} from '../api';
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Tabs,
  Tone,
  errMsg,
  fmtDate,
  label,
  todayVn,
  useAsync,
  useToast,
} from '../ui';
import { IconCheck, IconSparkles, IconX } from '../components/Icons';

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00+07:00`);
  return new Date(d.getTime() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
};

const mondayOf = (date: string) => {
  const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};

const dayShort = (date: string) =>
  new Date(`${date}T12:00:00+07:00`).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

const WEEKDAYS = [
  { v: 1, l: 'Thứ 2' },
  { v: 2, l: 'Thứ 3' },
  { v: 3, l: 'Thứ 4' },
  { v: 4, l: 'Thứ 5' },
  { v: 5, l: 'Thứ 6' },
  { v: 6, l: 'Thứ 7' },
  { v: 0, l: 'Chủ nhật' },
];

export const TimetablePage: React.FC = () => {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const today = todayVn();
  const tab: 'board' | 'facilities' = sp.get('tab') === 'facilities' ? 'facilities' : 'board';
  const setTab = (nextTab: 'board' | 'facilities') => {
    const next = new URLSearchParams(sp);
    if (nextTab === 'board') next.delete('tab');
    else next.set('tab', nextTab);
    setSp(next, { replace: true });
  };
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const [cohortId, setCohortId] = useState('');
  const [classId, setClassId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [classroomId, setClassroomId] = useState('');

  const facilitiesReq = useAsync(() => masterApi.getFacilitiesOverview(), []);
  const cohortsReq = useAsync(() => masterApi.listCohorts({ page_size: 100 }), []);
  const classesReq = useAsync(() => teachingApi.classes({ page_size: 150 }), []);
  const gridReq = useAsync(
    () =>
      masterApi.getTimetableGrid({
        from: weekStart,
        to: weekEnd,
        cohort_id: cohortId || undefined,
        class_id: classId || undefined,
        campus_id: campusId || undefined,
        classroom_id: classroomId || undefined,
      }),
    [weekStart, weekEnd, cohortId, classId, campusId, classroomId]
  );

  // Drag & Drop slot hints (2.1.1.2 — ô hợp lệ tô xanh, ô xung đột tô đỏ kèm lý do)
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [slotHints, setSlotHints] = useState<Record<string, TimetableSlotHint>>({});
  const [auditReport, setAuditReport] = useState<TimetableAuditReport | null>(null);

  // Modals cho các phương pháp xếp lịch & điều chỉnh
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [autoSchedOpen, setAutoSchedOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<TimetableSessionItem | null>(null);
  const [busy, setBusy] = useState(false);

  const shifts = facilitiesReq.data?.shifts || [
    { id: 'sh1', code: 'CA1', title: 'Ca 1 Sáng', start_time: '07:30', end_time: '09:00', periods_count: 2 },
    { id: 'sh2', code: 'CA2', title: 'Ca 2 Sáng', start_time: '09:15', end_time: '10:45', periods_count: 2 },
    { id: 'sh3', code: 'CA3', title: 'Ca Chiều', start_time: '14:00', end_time: '15:30', periods_count: 2 },
    { id: 'sh4', code: 'CA4', title: 'Ca Tối', start_time: '18:30', end_time: '20:30', periods_count: 2.5 },
  ];

  const roomsInCampus = useMemo(
    () => (facilitiesReq.data?.classrooms || []).filter((r) => !campusId || r.campus_id === campusId),
    [facilitiesReq.data, campusId]
  );

  const startDragSession = async (sessionId: string) => {
    setDraggingSessionId(sessionId);
    try {
      const r = await masterApi.getTimetableSlotHints({
        session_id: sessionId,
        dates: days,
        campus_id: campusId || facilitiesReq.data?.campuses?.[0]?.id || undefined,
        classroom_id: classroomId || roomsInCampus[0]?.id || null,
      });
      const map: Record<string, TimetableSlotHint> = {};
      for (const s of r.slots) {
        map[`${s.date}__${s.shift_code}`] = s;
      }
      setSlotHints(map);
    } catch {
      setSlotHints({});
    }
  };

  const endDragSession = () => {
    setDraggingSessionId(null);
    setSlotHints({});
  };

  const handleDropOnSlot = async (date: string, shiftCode: string, startTime: string, endTime: string) => {
    if (!draggingSessionId) return;
    const sid = draggingSessionId;
    const hint = slotHints[`${date}__${shiftCode}`];
    endDragSession();

    if (hint && !hint.valid) {
      toast({
        tone: 'error',
        title: 'Ô lịch bị trùng hoặc không hợp lệ',
        detail: hint.conflicts.map((c) => c.message).join(' · '),
      });
      return;
    }

    try {
      await masterApi.moveTimetableSession(sid, {
        date,
        shift_code: shiftCode,
        start_time: startTime,
        end_time: endTime,
        campus_id: campusId || facilitiesReq.data?.campuses?.[0]?.id || undefined,
        classroom_id: classroomId || roomsInCampus[0]?.id || null,
      });
      toast({ tone: 'success', title: `Đã xếp buổi học vào ${dayShort(date)} (${startTime}–${endTime})` });
      gridReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể xếp vào ô này', detail: errMsg(ex) });
    }
  };

  const runAudit = async () => {
    setBusy(true);
    try {
      const rep = await masterApi.auditTimetable({ cohort_id: cohortId || undefined, class_id: classId || undefined });
      setAuditReport(rep);
      toast({
        tone: rep.total_conflicts === 0 ? 'success' : 'info',
        title: rep.total_conflicts === 0 ? 'Không có xung đột thời khóa biểu' : `Phát hiện ${rep.total_conflicts} xung đột cần kiểm tra`,
      });
    } catch (ex) {
      toast({ tone: 'error', title: 'Không kiểm tra được TKB', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const runPublish = async () => {
    const targetClasses = classId
      ? [classId]
      : cohortId
        ? undefined
        : Array.from(new Set((gridReq.data?.items || []).map((i) => i.class_id)));
    setBusy(true);
    try {
      const res = await masterApi.publishTimetable({
        cohort_id: cohortId || undefined,
        class_ids: targetClasses && targetClasses.length ? targetClasses : undefined,
      });
      toast({
        tone: 'success',
        title: `Đã công bố ${res.published_sessions} buổi học chính thức`,
        detail: `Quy đổi hạn nộp ${res.assignments_due_resolved} bài tập · Gửi ${res.notifications_sent} thông báo cho GV & HV.`,
      });
      gridReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Chưa thể công bố Thời khóa biểu', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  // Nhóm các buổi theo Ngày + Ca (hoặc khớp khung giờ gần nhất)
  const cellSessions = useMemo(() => {
    const map: Record<string, TimetableSessionItem[]> = {};
    for (const s of gridReq.data?.items || []) {
      const matchedShift =
        shifts.find((sh) => sh.start_time === s.start_time) ||
        shifts.find((sh) => s.start_time >= sh.start_time && s.start_time < sh.end_time) ||
        shifts[0];
      const key = `${s.date}__${matchedShift?.code || 'CA1'}`;
      (map[key] ||= []).push(s);
    }
    return map;
  }, [gridReq.data, shifts]);

  return (
    <div className="t-page">
      <PageHeader
        title="Điều phối thời khóa biểu"
        subtitle="Kéo thả buổi học (tô xanh ô hợp lệ, tô đỏ ô xung đột), Tạo mẫu lặp né lễ, Xếp tự động bản nháp, Kiểm tra đủ giờ & Công bố."
        actions={
          tab === 'board' && (
            <div className="t-actions">
              <Btn onClick={() => setRecurrenceOpen(true)}>Tạo mẫu lặp</Btn>
              <Btn onClick={() => setAutoSchedOpen(true)}><IconSparkles size={15} /> Xếp tự động (Nháp)</Btn>
              <Btn onClick={() => setCopyOpen(true)}>Sao chép lịch</Btn>
              <Btn loading={busy} onClick={runAudit}><IconCheck size={15} /> Kiểm tra đủ giờ & xung đột</Btn>
              <Btn variant="primary" loading={busy} onClick={runPublish}>Công bố TKB</Btn>
            </div>
          )
        }
      />

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as 'board' | 'facilities')}
        tabs={[
          { id: 'board', label: 'Bảng xếp thời khóa biểu', badge: gridReq.data?.unscheduled_items.length || undefined },
          { id: 'facilities', label: 'Cơ sở, Phòng học, Ngày nghỉ & Lịch bận GV' },
        ]}
      />

      {tab === 'board' && (
        <>
          <div className="t-toolbar">
            <Btn small onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Tuần trước</Btn>
            <Btn small onClick={() => setWeekStart(mondayOf(today))}>Tuần này</Btn>
            <Btn small onClick={() => setWeekStart(addDays(weekStart, 7))}>Tuần sau ›</Btn>

            <select className="t-input" aria-label="Lọc cơ sở đào tạo" value={campusId} onChange={(e) => { setCampusId(e.target.value); setClassroomId(''); }}>
              <option value="">Tất cả cơ sở</option>
              {(facilitiesReq.data?.campuses || []).map((cp) => (
                <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>
              ))}
            </select>

            <select className="t-input" aria-label="Chọn phòng học đích khi kéo thả" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
              <option value="">Tất cả phòng (hoặc chọn phòng đích)</option>
              {roomsInCampus.map((rm) => (
                <option key={rm.id} value={rm.id}>
                  {rm.code} ({label('roomType', rm.room_type)} · {rm.capacity} chỗ)
                </option>
              ))}
            </select>

            <select className="t-input" aria-label="Lọc khóa học" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              <option value="">Tất cả khóa học</option>
              {(cohortsReq.data?.items || []).map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.code} — {ch.title}</option>
              ))}
            </select>

            <select className="t-input" aria-label="Lọc lớp môn học" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Tất cả lớp môn học</option>
              {(classesReq.data?.items || []).map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.code} — {cl.title}</option>
              ))}
            </select>
          </div>

          {auditReport && (
            <Card
              title={`Kết quả kiểm tra Thời khóa biểu (${auditReport.checked_classes} lớp · ${auditReport.total_conflicts} xung đột)`}
              actions={<Btn small variant="ghost" onClick={() => setAuditReport(null)}>Đóng báo cáo</Btn>}
            >
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Lớp môn học</th>
                      <th className="num">Tiến độ số tiết</th>
                      <th className="num">Buổi chưa xếp</th>
                      <th>Trạng thái đủ giờ</th>
                      <th>Xung đột chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditReport.classes.map((cl) => (
                      <tr key={cl.class_id}>
                        <td><strong>{cl.class_code}</strong> — {cl.class_title}</td>
                        <td className="num tabular-nums">{cl.scheduled_periods} / {cl.planned_periods} tiết</td>
                        <td className="num tabular-nums">{cl.unscheduled_sessions}</td>
                        <td>
                          <Tone tone={cl.is_hours_sufficient ? 'success' : 'warning'}>
                            {cl.is_hours_sufficient ? 'Đủ thời lượng' : 'Chưa đủ tiết'}
                          </Tone>
                        </td>
                        <td>
                          {cl.conflicts.length === 0 ? (
                            <Tone tone="success">Hợp lệ 100%</Tone>
                          ) : (
                            cl.conflicts.map((cf, i) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--status-danger)' }}>
                                • {cf.date}: {cf.message}
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {gridReq.loading && !gridReq.data && <Loading rows={5} />}
          {gridReq.error && <ErrorState error={gridReq.error} onRetry={gridReq.reload} />}

          {gridReq.data && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
              {/* Khay buổi học chờ xếp lịch (UNSCHEDULED) */}
              <Card title={`Khay chờ xếp (${gridReq.data.unscheduled_items.length})`}>
                <p className="t-sub" style={{ marginTop: 0 }}>
                  Kéo buổi học thả sang lưới bên phải. Ô xanh là hợp lệ, ô đỏ báo lý do xung đột.
                </p>
                {gridReq.data.unscheduled_items.length === 0 ? (
                  <p className="t-sub">Tất cả buổi học trong bộ lọc đã có khung giờ.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 560, overflowY: 'auto' }}>
                    {gridReq.data.unscheduled_items.map((u: UnscheduledSessionItem) => (
                      <div
                        key={u.id}
                        draggable
                        onDragStart={() => startDragSession(u.id)}
                        onDragEnd={endDragSession}
                        style={{
                          padding: 10,
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          cursor: 'grab',
                        }}
                      >
                        <strong style={{ display: 'block', fontSize: 13 }}>{u.class_code}</strong>
                        <span style={{ display: 'block', fontSize: 13 }}>{u.title}</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          <Badge kind="roomType" value={u.required_room_type} />
                          <span className="t-sub tabular-nums" style={{ margin: 0 }}>{u.planned_periods} tiết</span>
                        </div>
                        {u.instructor_name && <span className="t-sub">GV: {u.instructor_name}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Lưới Thời khóa biểu theo Tuần × Ca học */}
              <Card title={`Lưới Thời khóa biểu tuần ${dayShort(weekStart)} – ${dayShort(weekEnd)}`} padded={false}>
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th style={{ width: 130 }}>Ca học</th>
                        {days.map((d) => (
                          <th key={d} className="tabular-nums">{dayShort(d)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.map((sh) => (
                        <tr key={sh.code}>
                          <td style={{ verticalAlign: 'top' }}>
                            <strong>{sh.code}</strong>
                            <span className="t-sub tabular-nums">{sh.start_time}–{sh.end_time}</span>
                          </td>
                          {days.map((d) => {
                            const key = `${d}__${sh.code}`;
                            const items = cellSessions[key] || [];
                            const hint = draggingSessionId ? slotHints[key] : undefined;
                            const cellBg = hint
                              ? hint.valid
                                ? 'var(--accent-learning-tint)'
                                : 'var(--brand-tint)'
                              : 'transparent';
                            const cellBorder = hint
                              ? hint.valid
                                ? '2px dashed var(--accent-learning)'
                                : '2px dashed var(--status-danger)'
                              : '1px solid var(--border-subtle)';

                            return (
                              <td
                                key={d}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => handleDropOnSlot(d, sh.code, sh.start_time, sh.end_time)}
                                style={{
                                  verticalAlign: 'top',
                                  minWidth: 145,
                                  height: 110,
                                  backgroundColor: cellBg,
                                  border: cellBorder,
                                  transition: 'background-color 150ms cubic-bezier(0.2, 0, 0, 1)',
                                }}
                              >
                                {hint && !hint.valid && (
                                  <div style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <IconX size={12} /> {hint.conflicts[0]?.message}
                                  </div>
                                )}
                                {hint && hint.valid && items.length === 0 && (
                                  <div style={{ fontSize: 11, color: 'var(--accent-learning)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <IconCheck size={12} /> Ô hợp lệ — Thả vào đây
                                  </div>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {items.map((ses) => (
                                    <div
                                      key={ses.id}
                                      draggable={ses.session_status !== 'CANCELLED'}
                                      onDragStart={() => startDragSession(ses.id)}
                                      onDragEnd={endDragSession}
                                      onClick={() => setAdjustTarget(ses)}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === 'Enter') setAdjustTarget(ses); }}
                                      style={{
                                        padding: 8,
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border-strong)',
                                        backgroundColor: 'var(--bg-surface)',
                                        opacity: ses.session_status === 'CANCELLED' ? 0.55 : 1,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, alignItems: 'center' }}>
                                        <strong style={{ fontSize: 12 }}>{ses.class_code}</strong>
                                        <Badge kind="scheduleState" value={ses.schedule_state} />
                                      </div>
                                      <div style={{ fontSize: 12, marginTop: 2 }}>{ses.title}</div>
                                      <div className="t-sub tabular-nums" style={{ margin: '2px 0 0', fontSize: 11 }}>
                                        {ses.start_time}–{ses.end_time} · {ses.classroom_code || ses.classroom_name || 'Chưa gán phòng'}
                                      </div>
                                      <div className="t-sub" style={{ margin: 0, fontSize: 11 }}>
                                        GV: {ses.instructor_name || '—'}
                                        {ses.is_substitute ? ' (Dạy thay)' : ''}
                                        {ses.session_kind === 'MAKEUP' ? ' · [Dạy bù]' : ''}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {tab === 'facilities' && facilitiesReq.data && (
        <FacilitiesAndAvailabilityPanel data={facilitiesReq.data} onChanged={facilitiesReq.reload} />
      )}

      {recurrenceOpen && (
        <RecurrenceScheduleModal
          classes={classesReq.data?.items || []}
          facilities={facilitiesReq.data}
          onClose={() => setRecurrenceOpen(false)}
          onDone={() => {
            setRecurrenceOpen(false);
            gridReq.reload();
          }}
        />
      )}

      {autoSchedOpen && (
        <AutoScheduleModal
          cohorts={cohortsReq.data?.items || []}
          campuses={facilitiesReq.data?.campuses || []}
          defaultWeekStart={weekStart}
          onClose={() => setAutoSchedOpen(false)}
          onDone={() => {
            setAutoSchedOpen(false);
            gridReq.reload();
          }}
        />
      )}

      {copyOpen && (
        <CopyTimetableModal
          classes={classesReq.data?.items || []}
          defaultWeekStart={weekStart}
          onClose={() => setCopyOpen(false)}
          onDone={() => {
            setCopyOpen(false);
            gridReq.reload();
          }}
        />
      )}

      {adjustTarget && (
        <AdjustSessionModal
          session={adjustTarget}
          facilities={facilitiesReq.data}
          onClose={() => setAdjustTarget(null)}
          onDone={() => {
            setAdjustTarget(null);
            gridReq.reload();
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// CÁC HỘP THOẠI PHƯƠNG PHÁP XẾP LỊCH & ĐIỀU CHỈNH TRONG QUÁ TRÌNH HỌC
// ============================================================================

const RecurrenceScheduleModal: React.FC<{
  classes: Array<{ id: string; code: string; title: string }>;
  facilities?: FacilitiesOverview | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ classes, facilities, onClose, onDone }) => {
  const toast = useToast();
  const [subjectClassId, setSubjectClassId] = useState(classes[0]?.id || '');
  const [startDate, setStartDate] = useState(todayVn(1));
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [shiftCode, setShiftCode] = useState('CA4');
  const [campusId, setCampusId] = useState(facilities?.campuses?.[0]?.id || '');
  const [classroomId, setClassroomId] = useState('');
  const effectiveCampus = campusId || facilities?.campuses?.[0]?.id || '';
  const filteredRooms = (facilities?.classrooms || []).filter((r: ClassroomItem) => !effectiveCampus || r.campus_id === effectiveCampus);
  const effectiveRoom = classroomId || filteredRooms[0]?.id || '';
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await masterApi.generateTimetableRecurrence({
        class_id: subjectClassId,
        start_date: startDate,
        weekdays,
        shift_code: shiftCode,
        campus_id: effectiveCampus || undefined,
        classroom_id: effectiveRoom || undefined,
      });
      toast({
        tone: 'success',
        title: `Đã rải ${r.scheduled_count} buổi học theo mẫu lặp`,
        detail: r.skipped_holidays.length ? `Đã tự động bỏ qua ${r.skipped_holidays.length} ngày nghỉ lễ.` : undefined,
      });
      onDone();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể tạo lịch lặp', detail: errMsg(ex) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo mẫu lặp (Tự động rải buổi & bỏ qua ngày nghỉ lễ)"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="rec-form" loading={busy}>Rải buổi học</Btn>
        </>
      }
    >
      <form id="rec-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Lớp môn học" required wide>
          <select className="t-input" value={subjectClassId} onChange={(e) => setSubjectClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Ngày bắt đầu">
          <input className="t-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Ca học">
          <select className="t-input" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
            {(facilities?.shifts || []).map((sh: ShiftPresetItem) => (
              <option key={sh.code} value={sh.code}>{sh.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Các ngày học trong tuần" wide>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((w) => (
              <button
                key={w.v}
                type="button"
                className={`t-btn t-btn--small ${weekdays.includes(w.v) ? 't-btn--primary' : ''}`}
                onClick={() => setWeekdays((p) => (p.includes(w.v) ? p.filter((x) => x !== w.v) : [...p, w.v]))}
              >
                {w.l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cơ sở">
          <select className="t-input" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
            {(facilities?.campuses || []).map((cp: CampusItem) => (
              <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Phòng học">
          <select className="t-input" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            {(facilities?.classrooms || [])
              .filter((r: ClassroomItem) => r.campus_id === campusId)
              .map((r: ClassroomItem) => (
                <option key={r.id} value={r.id}>{r.code} ({label('roomType', r.room_type)} · {r.capacity} chỗ)</option>
              ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
};

const AutoScheduleModal: React.FC<{
  cohorts: Array<{ id: string; code: string; title: string }>;
  campuses: Array<{ id: string; code: string; name: string }>;
  defaultWeekStart: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ cohorts, campuses, defaultWeekStart, onClose, onDone }) => {
  const toast = useToast();
  const [cohortId, setCohortId] = useState(cohorts[0]?.id || '');
  const [startDate, setStartDate] = useState(defaultWeekStart);
  const [endDate, setEndDate] = useState(addDays(defaultWeekStart, 28));
  const [campusId, setCampusId] = useState(campuses[0]?.id || '');
  const effectiveCampus = campusId || campuses[0]?.id || '';
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await masterApi.autoScheduleTimetable({
        cohort_id: cohortId,
        start_date: startDate,
        end_date: endDate,
        campus_id: effectiveCampus || undefined,
      });
      toast({
        tone: 'success',
        title: `Đã sinh bản nháp tự động cho ${r.draft_placed_count} buổi học`,
        detail: r.unplaced_items.length ? `Còn ${r.unplaced_items.length} buổi chưa tìm được ô trống phù hợp.` : 'Hãy kiểm tra trên lưới rồi nhấn Công bố TKB.',
      });
      onDone();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể xếp tự động', detail: errMsg(ex) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Xếp tự động sinh bản nháp (Ưu tiên phòng khó & sĩ số đông)"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="auto-sched-form" loading={busy}>Sinh bản nháp TKB</Btn>
        </>
      }
    >
      <form id="auto-sched-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Chọn Khóa học cần xếp" required wide>
          <select className="t-input" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Từ ngày">
          <input className="t-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Đến ngày">
          <input className="t-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Cơ sở đào tạo" wide>
          <select className="t-input" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
            {campuses.map((cp) => (
              <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
};

const CopyTimetableModal: React.FC<{
  classes: Array<{ id: string; code: string; title: string }>;
  defaultWeekStart: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ classes, defaultWeekStart, onClose, onDone }) => {
  const toast = useToast();
  const [mode, setMode] = useState<'COPY_WEEK' | 'COPY_FROM_CLASS'>('COPY_WEEK');
  const [classId, setClassId] = useState(classes[0]?.id || '');
  const [sourceClassId, setSourceClassId] = useState(classes[0]?.id || '');
  const [targetClassId, setTargetClassId] = useState(classes[1]?.id || classes[0]?.id || '');
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [weeksCount, setWeeksCount] = useState(2);
  const [targetStartDate, setTargetStartDate] = useState(todayVn(7));
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload =
        mode === 'COPY_WEEK'
          ? { mode, class_id: classId, source_week_start: weekStart, weeks_count: weeksCount }
          : { mode, source_class_id: sourceClassId, target_class_id: targetClassId, target_start_date: targetStartDate };
      const r = await masterApi.copyTimetable(payload);
      toast({ tone: 'success', title: `Đã sao chép ${r.copied_count} buổi học (bỏ qua ${r.skipped_count} ô trùng/nghỉ lễ)` });
      onDone();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể sao chép lịch', detail: errMsg(ex) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Sao chép lịch tuần / Sao chép từ lớp khác"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="copy-tkb-form" loading={busy}>Sao chép lịch</Btn>
        </>
      }
    >
      <form id="copy-tkb-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Chế độ sao chép" wide>
          <select className="t-input" value={mode} onChange={(e) => setMode(e.target.value as 'COPY_WEEK' | 'COPY_FROM_CLASS')}>
            <option value="COPY_WEEK">Sao chép lịch tuần sang các tuần tiếp theo</option>
            <option value="COPY_FROM_CLASS">Sao chép cấu trúc lịch từ lớp khác cùng chương trình</option>
          </select>
        </Field>
        {mode === 'COPY_WEEK' ? (
          <>
            <Field label="Lớp môn học" wide>
              <select className="t-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Tuần nguồn (Thứ Hai)">
              <input className="t-input" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </Field>
            <Field label="Số tuần nhân bản tiếp theo">
              <input className="t-input tabular-nums" type="number" min={1} max={12} value={weeksCount} onChange={(e) => setWeeksCount(Number(e.target.value))} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Lớp nguồn">
              <select className="t-input" value={sourceClassId} onChange={(e) => setSourceClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Lớp đích">
              <select className="t-input" value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Ngày bắt đầu áp dụng cho lớp đích" wide>
              <input className="t-input" type="date" value={targetStartDate} onChange={(e) => setTargetStartDate(e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
};

const AdjustSessionModal: React.FC<{
  session: TimetableSessionItem;
  facilities?: FacilitiesOverview | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ session, facilities, onClose, onDone }) => {
  const toast = useToast();
  const [action, setAction] = useState<'RESCHEDULE' | 'CANCEL_AND_MAKEUP' | 'CHANGE_STAFF_OR_ROOM'>('RESCHEDULE');
  const [reason, setReason] = useState('Điều chỉnh kế hoạch giảng dạy thực tế');
  const [newDate, setNewDate] = useState(session.date);
  const [newStart, setNewStart] = useState(session.start_time);
  const [newEnd, setNewEnd] = useState(session.end_time);
  const [makeupDate, setMakeupDate] = useState(addDays(session.date, 7));
  const [classroomId, setClassroomId] = useState(session.classroom_id || '');
  const [subInstructorId, setSubInstructorId] = useState(session.instructor_id || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await masterApi.adjustTimetableSession(session.id, {
        action,
        reason,
        new_date: newDate,
        new_start_time: newStart,
        new_end_time: newEnd,
        makeup_date: action === 'CANCEL_AND_MAKEUP' ? makeupDate : undefined,
        makeup_start_time: newStart,
        makeup_end_time: newEnd,
        classroom_id: classroomId || undefined,
        substitute_instructor_id: subInstructorId || undefined,
      });
      toast({ tone: 'success', title: 'Đã điều chỉnh buổi học thành công' });
      onDone();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể điều chỉnh buổi học', detail: errMsg(ex) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Điều chỉnh buổi học — ${session.class_code}: ${session.title}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Đóng</Btn>
          <Btn variant="primary" type="submit" form="adj-ses-form" loading={busy}>Áp dụng điều chỉnh</Btn>
        </>
      }
    >
      <form id="adj-ses-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Nghiệp vụ điều chỉnh" wide>
          <select className="t-input" value={action} onChange={(e) => setAction(e.target.value as 'RESCHEDULE' | 'CANCEL_AND_MAKEUP' | 'CHANGE_STAFF_OR_ROOM')}>
            <option value="RESCHEDULE">Dời buổi học sang ngày/giờ khác</option>
            <option value="CANCEL_AND_MAKEUP">Báo nghỉ buổi này & Lên lịch buổi Dạy bù</option>
            <option value="CHANGE_STAFF_OR_ROOM">Đổi Giảng viên dạy thay / Đổi phòng học</option>
          </select>
        </Field>

        {action === 'RESCHEDULE' && (
          <>
            <Field label="Ngày học mới">
              <input className="t-input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
            <Field label="Khung giờ mới">
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="t-input tabular-nums" type="time" aria-label="Giờ bắt đầu mới" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
                <input className="t-input tabular-nums" type="time" aria-label="Giờ kết thúc mới" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </Field>
          </>
        )}

        {action === 'CANCEL_AND_MAKEUP' && (
          <Field label="Ngày dạy bù (để trống nếu chỉ báo nghỉ)" wide>
            <input className="t-input" type="date" value={makeupDate} onChange={(e) => setMakeupDate(e.target.value)} />
          </Field>
        )}

        <Field label="Phòng học">
          <select className="t-input" value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            <option value="">-- Giữ phòng hiện tại --</option>
            {(facilities?.classrooms || []).map((r: ClassroomItem) => (
              <option key={r.id} value={r.id}>{r.code} — {r.name} ({r.capacity} chỗ)</option>
            ))}
          </select>
        </Field>

        <Field label="Giảng viên thực dạy / Dạy thay">
          <select className="t-input" value={subInstructorId} onChange={(e) => setSubInstructorId(e.target.value)}>
            <option value="">-- Giữ giảng viên hiện tại --</option>
            {(facilities?.instructors || []).map((ins) => (
              <option key={ins.id} value={ins.id}>{ins.full_name} ({ins.code})</option>
            ))}
          </select>
        </Field>

        <Field label="Lý do điều chỉnh" required wide>
          <input className="t-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
};

// ============================================================================
// TAB 2: QUẢN LÝ CƠ SỞ, PHÒNG HỌC, LỊCH NGHỈ LỄ & LỊCH BẬN GIẢNG VIÊN
// ============================================================================

const FacilitiesAndAvailabilityPanel: React.FC<{ data: FacilitiesOverview; onChanged: () => void }> = ({ data, onChanged }) => {
  const toast = useToast();
  const canManage = data.capabilities?.can_manage_facilities;
  const [confirmRemove, setConfirmRemove] = useState<{ title: string; onConfirm: () => Promise<void> } | null>(null);

  // Thêm cơ sở mới
  const [cpCode, setCpCode] = useState('');
  const [cpName, setCpName] = useState('');
  const [cpAddr, setCpAddr] = useState('');

  // Thêm phòng học
  const [rmCampus, setRmCampus] = useState(data.campuses[0]?.id || '');
  const effectiveRmCampus = rmCampus || data.campuses[0]?.id || '';
  const [rmCode, setRmCode] = useState('');
  const [rmName, setRmName] = useState('');
  const [rmType, setRmType] = useState<RoomType>('THEORY_ROOM');
  const [rmCap, setRmCap] = useState(35);

  // Thêm lịch nghỉ chung
  const [holTitle, setHolTitle] = useState('');
  const [holStart, setHolStart] = useState(todayVn(10));
  const [holEnd, setHolEnd] = useState(todayVn(10));

  // Thêm lịch bận GV
  const [avInstructor, setAvInstructor] = useState(data.instructors[0]?.id || '');
  const [avWeekday, setAvWeekday] = useState(0);
  const [avStart, setAvStart] = useState('18:00');
  const [avEnd, setAvEnd] = useState('21:00');
  const [avNote, setAvNote] = useState('');

  const addCampus = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await masterApi.createCampus({ code: cpCode.trim(), name: cpName.trim(), address: cpAddr.trim() || undefined });
      setCpCode('');
      setCpName('');
      setCpAddr('');
      toast({ tone: 'success', title: 'Đã thêm cơ sở đào tạo mới' });
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thêm được cơ sở', detail: errMsg(ex) });
    }
  };

  const addRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveRmCampus) {
      toast({ tone: 'error', title: 'Vui lòng tạo ít nhất 1 cơ sở trước khi thêm phòng' });
      return;
    }
    try {
      await masterApi.createClassroom({ campus_id: effectiveRmCampus, code: rmCode, name: rmName, room_type: rmType, capacity: rmCap });
      setRmCode('');
      setRmName('');
      toast({ tone: 'success', title: 'Đã thêm phòng học mới' });
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thêm được phòng', detail: errMsg(ex) });
    }
  };

  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await masterApi.createHoliday({ title: holTitle, start_date: holStart, end_date: holEnd, is_recurring_yearly: false });
      setHolTitle('');
      toast({ tone: 'success', title: 'Đã thêm lịch nghỉ trung tâm' });
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thêm được ngày nghỉ', detail: errMsg(ex) });
    }
  };

  const addAvail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await masterApi.createInstructorAvailability({
        instructor_id: avInstructor || undefined,
        rule_type: 'WEEKLY',
        weekday: avWeekday,
        start_time: avStart,
        end_time: avEnd,
        status: 'BUSY',
        note: avNote,
      });
      setAvNote('');
      toast({ tone: 'success', title: 'Đã đăng ký khung giờ bận giảng viên' });
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không lưu được lịch bận', detail: errMsg(ex) });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Danh mục Cơ sở & Phòng học (Kiểm tra loại phòng, sức chứa & thời gian di chuyển liên cơ sở)">
        <div className="t-table-wrap" style={{ marginBottom: canManage ? 16 : 0 }}>
          <table className="t-table">
            <thead>
              <tr>
                <th>Cơ sở</th>
                <th>Mã phòng</th>
                <th>Tên phòng học</th>
                <th>Loại phòng</th>
                <th className="num">Sức chứa</th>
                <th>Thiết bị</th>
              </tr>
            </thead>
            <tbody>
              {data.classrooms.map((r: ClassroomItem) => (
                <tr key={r.id}>
                  <td>{r.campus_code} — {r.campus_name}</td>
                  <td><code>{r.code}</code></td>
                  <td><strong>{r.name}</strong></td>
                  <td><Badge kind="roomType" value={r.room_type} /></td>
                  <td className="num tabular-nums">{r.capacity} chỗ</td>
                  <td className="t-sub">{r.equipment_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <form onSubmit={addRoom} className="t-form-grid">
              <Field label="Cơ sở">
                <select className="t-input" value={effectiveRmCampus} onChange={(e) => setRmCampus(e.target.value)}>
                  {data.campuses.map((c: CampusItem) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mã phòng" required>
                <input className="t-input" value={rmCode} onChange={(e) => setRmCode(e.target.value)} placeholder="VD: LAB-302" required />
              </Field>
              <Field label="Tên phòng" required>
                <input className="t-input" value={rmName} onChange={(e) => setRmName(e.target.value)} placeholder="VD: Phòng thực hành AI" required />
              </Field>
              <Field label="Loại phòng & Sức chứa">
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="t-input" aria-label="Loại phòng mới" value={rmType} onChange={(e) => setRmType(e.target.value as RoomType)}>
                    <option value="THEORY_ROOM">Phòng lý thuyết</option>
                    <option value="COMPUTER_LAB">Phòng máy</option>
                    <option value="ONLINE">Trực tuyến</option>
                  </select>
                  <input className="t-input tabular-nums" type="number" min={5} style={{ width: 95 }} aria-label="Sức chứa phòng" value={rmCap} onChange={(e) => setRmCap(Number(e.target.value))} />
                  <Btn type="submit" variant="primary">+ Thêm phòng</Btn>
                </div>
              </Field>
            </form>

            <form onSubmit={addCampus} className="t-form-grid" style={{ paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
              <Field label="Mã cơ sở mới" required>
                <input className="t-input" value={cpCode} onChange={(e) => setCpCode(e.target.value)} placeholder="VD: CS3-TX" required />
              </Field>
              <Field label="Tên cơ sở mới" required>
                <input className="t-input" value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="VD: Cơ sở 3 — Thanh Xuân" required />
              </Field>
              <Field label="Địa chỉ cơ sở" wide>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="t-input" style={{ flex: 1 }} value={cpAddr} onChange={(e) => setCpAddr(e.target.value)} placeholder="Số nhà, quận/huyện…" />
                  <Btn type="submit">+ Thêm cơ sở</Btn>
                </div>
              </Field>
            </form>
          </div>
        )}
      </Card>

      <Card title="Lịch nghỉ chung của Trung tâm (Lễ, Tết, Kỷ niệm — Tự động chặn & né lịch)">
        <div className="t-table-wrap" style={{ marginBottom: canManage ? 16 : 0 }}>
          <table className="t-table">
            <thead>
              <tr>
                <th>Kỳ nghỉ lễ / Sự kiện</th>
                <th>Từ ngày</th>
                <th>Đến ngày</th>
                {canManage && <th className="actions">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {data.holidays.map((h: AcademicHolidayItem) => (
                <tr key={h.id}>
                  <td><strong>{h.title}</strong></td>
                  <td className="tabular-nums">{fmtDate(h.start_date)}</td>
                  <td className="tabular-nums">{fmtDate(h.end_date)}</td>
                  {canManage && (
                    <td className="actions">
                      <Btn
                        small
                        variant="ghost"
                        onClick={() =>
                          setConfirmRemove({
                            title: `Xóa kỳ nghỉ "${h.title}"?`,
                            onConfirm: async () => {
                              try {
                                await masterApi.deleteHoliday(h.id);
                                setConfirmRemove(null);
                                toast({ tone: 'success', title: 'Đã xóa lịch nghỉ lễ' });
                                onChanged();
                              } catch (ex) {
                                toast({ tone: 'error', title: 'Không xóa được lịch nghỉ', detail: errMsg(ex) });
                              }
                            },
                          })
                        }
                      >
                        Xóa
                      </Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage && (
          <form onSubmit={addHoliday} className="t-form-grid">
            <Field label="Tên kỳ nghỉ lễ" required wide>
              <input className="t-input" value={holTitle} onChange={(e) => setHolTitle(e.target.value)} placeholder="VD: Nghỉ lễ Quốc khánh 2/9" required />
            </Field>
            <Field label="Từ ngày">
              <input className="t-input" type="date" value={holStart} onChange={(e) => setHolStart(e.target.value)} />
            </Field>
            <Field label="Đến ngày">
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="t-input" type="date" aria-label="Ngày kết thúc nghỉ" value={holEnd} onChange={(e) => setHolEnd(e.target.value)} />
                <Btn type="submit" variant="primary">+ Thêm lịch nghỉ</Btn>
              </div>
            </Field>
          </form>
        )}
      </Card>

      <Card title="Lịch bận / Lịch rảnh Giảng viên">
        <div className="t-table-wrap" style={{ marginBottom: 16 }}>
          <table className="t-table">
            <thead>
              <tr>
                <th>Giảng viên</th>
                <th>Thứ / Ngày</th>
                <th>Khung giờ bận</th>
                <th>Lý do</th>
                <th className="actions">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.availabilities.map((av: InstructorAvailabilityItem) => (
                <tr key={av.id}>
                  <td><strong>{av.instructor_name}</strong> ({av.instructor_code})</td>
                  <td>{av.rule_type === 'WEEKLY' ? WEEKDAYS.find((w) => w.v === av.weekday)?.l : fmtDate(av.specific_date)}</td>
                  <td className="tabular-nums">{av.start_time} – {av.end_time}</td>
                  <td>{av.note || '—'}</td>
                  <td className="actions">
                    <Btn
                      small
                      variant="ghost"
                      onClick={() =>
                        setConfirmRemove({
                          title: 'Xóa lịch bận giảng viên?',
                          onConfirm: async () => {
                            try {
                              await masterApi.deleteInstructorAvailability(av.id);
                              setConfirmRemove(null);
                              toast({ tone: 'success', title: 'Đã xóa khung giờ bận' });
                              onChanged();
                            } catch (ex) {
                              toast({ tone: 'error', title: 'Không xóa được khung giờ bận', detail: errMsg(ex) });
                            }
                          },
                        })
                      }
                    >
                      Xóa
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addAvail} className="t-form-grid">
          {canManage && (
            <Field label="Giảng viên">
              <select className="t-input" value={avInstructor} onChange={(e) => setAvInstructor(e.target.value)}>
                {data.instructors.map((ins) => (
                  <option key={ins.id} value={ins.id}>{ins.full_name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Thứ cố định hàng tuần">
            <select className="t-input" value={avWeekday} onChange={(e) => setAvWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((w) => (
                <option key={w.v} value={w.v}>{w.l}</option>
              ))}
            </select>
          </Field>
          <Field label="Khung giờ bận">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="t-input tabular-nums" type="time" aria-label="Bận từ giờ" value={avStart} onChange={(e) => setAvStart(e.target.value)} />
              <input className="t-input tabular-nums" type="time" aria-label="Bận đến giờ" value={avEnd} onChange={(e) => setAvEnd(e.target.value)} />
            </div>
          </Field>
          <Field label="Ghi chú">
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="t-input" aria-label="Ghi chú bận" value={avNote} onChange={(e) => setAvNote(e.target.value)} placeholder="VD: Họp chuyên môn" />
              <Btn type="submit" variant="primary">+ Đăng ký bận</Btn>
            </div>
          </Field>
        </form>
      </Card>

      {confirmRemove && (
        <ConfirmDialog
          title={confirmRemove.title}
          message="Thao tác này sẽ xóa cấu hình khỏi cơ sở dữ liệu xếp lịch."
          confirmLabel="Xóa"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={confirmRemove.onConfirm}
        />
      )}
    </div>
  );
};
