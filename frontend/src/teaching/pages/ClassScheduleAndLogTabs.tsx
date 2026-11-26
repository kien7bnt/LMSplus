import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClassAssignmentItem, ClassDetail, ClassExamItem, ClassQuizAnalytics, DeliveryMode, EnrollResult, EnrollmentSource,
  masterApi, saveBlob, SessionSummary, teachingApi, VirtualProviderType,
} from '../api';
import { attendanceLink, SessionRow, virtualSessionLink } from '../components/SessionRow';
import {
  Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, ProgressMeter, SearchInput, StatCard, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, fmtTime, fmtWeekday, label, todayVn, useAsync, useToast,
} from '../ui';
import { ClassLeaveRequestsPanel } from './LeaveRequestsPage';
import { BankQuestionAttachment, BankQuestionPicker, extractBankQuestionAttachments, mergeInstructionsWithQuestions } from '../components/BankQuestionPicker';

export const WEEKDAYS: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Thứ 2' },
  { day: 2, label: 'Thứ 3' },
  { day: 3, label: 'Thứ 4' },
  { day: 4, label: 'Thứ 5' },
  { day: 5, label: 'Thứ 6' },
  { day: 6, label: 'Thứ 7' },
  { day: 0, label: 'Chủ nhật' },
];

export const isoToDateInput = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
export const isoToTimeInput = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });


// ------------------------------------------------------------------ Tab 4: Lịch học & Buổi học

export const ScheduleTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
  const toast = useToast();
  const sessReq = useAsync(() => teachingApi.sessions(cls.id), [cls.id]);
  const existingRoomsReq = useAsync(() => teachingApi.classVirtualRooms(cls.id), [cls.id]);
  const [modalMode, setModalMode] = useState<null | 'single' | 'recurring' | SessionSummary>(null);
  const [cancelTarget, setCancelTarget] = useState<SessionSummary | null>(null);

  const [title, setTitle] = useState('');
  const [teachingContent, setTeachingContent] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(cls.delivery_mode || 'OFFLINE');
  const [virtualAction, setVirtualAction] = useState<'NONE' | 'KEEP' | 'CREATE_NEW' | 'RECURRING_CLASS' | 'REUSE_EXISTING' | 'EXTERNAL_LINK'>('NONE');
  const [provider, setProvider] = useState<VirtualProviderType>('ZOOM');
  const [roomName, setRoomName] = useState('');
  const [existingRoomId, setExistingRoomId] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalCode, setExternalCode] = useState('');
  const [externalPasscode, setExternalPasscode] = useState('');
  const [externalPlatformName, setExternalPlatformName] = useState('Microsoft Teams');

  const [date, setDate] = useState(todayVn());
  const [startDate, setStartDate] = useState(cls.start_date || todayVn());
  const [endDate, setEndDate] = useState(cls.end_date || todayVn(28));
  const [weekdays, setWeekdays] = useState<number[]>([1, 4]);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:30');
  const [room, setRoom] = useState(cls.room || '');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const openCreate = (mode: 'single' | 'recurring') => {
    setTitle('');
    setTeachingContent('');
    setDeliveryMode(cls.delivery_mode || 'OFFLINE');
    setVirtualAction(cls.delivery_mode === 'ONLINE' || cls.delivery_mode === 'HYBRID' ? 'CREATE_NEW' : 'NONE');
    setProvider('ZOOM');
    setRoomName(`${cls.code} — ${cls.title}`);
    setExistingRoomId(existingRoomsReq.data?.items[0]?.id || '');
    setExternalUrl('');
    setExternalCode('');
    setExternalPasscode('');
    setDate(todayVn());
    setStartDate(cls.start_date || todayVn());
    setEndDate(cls.end_date || todayVn(28));
    setStartTime('08:00');
    setEndTime('09:30');
    setRoom(cls.room || '');
    setFormErr(null);
    setModalMode(mode);
  };

  const openEdit = (s: SessionSummary) => {
    setTitle(s.title);
    setTeachingContent(s.teaching_content || '');
    setDeliveryMode(s.delivery_mode || cls.delivery_mode || 'OFFLINE');
    setVirtualAction(s.virtual_room ? 'KEEP' : 'NONE');
    setProvider(s.virtual_room?.provider || 'ZOOM');
    setRoomName(s.virtual_room?.room_title || s.title);
    setExistingRoomId(s.virtual_room?.id || existingRoomsReq.data?.items[0]?.id || '');
    setExternalUrl(s.virtual_room?.join_url || '');
    setExternalCode(s.virtual_room?.external_meeting_id || '');
    setExternalPasscode('');
    setDate(isoToDateInput(s.start_at));
    setStartTime(isoToTimeInput(s.start_at));
    setEndTime(isoToTimeInput(s.end_at));
    setRoom(s.room_or_link || '');
    setFormErr(null);
    setModalMode(s);
  };

  const buildVirtualRoomConfig = () => {
    if (deliveryMode === 'OFFLINE' || virtualAction === 'NONE' || virtualAction === 'KEEP') {
      return undefined;
    }
    return {
      mode: virtualAction,
      provider: virtualAction === 'EXTERNAL_LINK' ? ('EXTERNAL' as const) : provider,
      room_name: roomName.trim() || title.trim() || `${cls.code} — ${cls.title}`,
      existing_room_id: virtualAction === 'REUSE_EXISTING' ? existingRoomId : undefined,
      join_url: virtualAction === 'EXTERNAL_LINK' ? externalUrl.trim() : undefined,
      meeting_code: virtualAction === 'EXTERNAL_LINK' ? externalCode.trim() : undefined,
      passcode: externalPasscode.trim() || undefined,
      external_platform_name: virtualAction === 'EXTERNAL_LINK' ? externalPlatformName.trim() : undefined,
      is_recurring: virtualAction === 'RECURRING_CLASS',
    };
  };

  const submitSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    setBusy(true);
    try {
      const virtualConfig = buildVirtualRoomConfig();
      if (modalMode === 'single') {
        await teachingApi.createSessions(cls.id, {
          title: title.trim(),
          teaching_content: teachingContent.trim() || undefined,
          delivery_mode: deliveryMode,
          date,
          start_time: startTime,
          end_time: endTime,
          room_or_link: room.trim(),
          virtual_room_config: virtualConfig,
        });
        toast({ tone: 'success', title: 'Đã tạo buổi học mới' });
      } else if (modalMode === 'recurring') {
        const res = await teachingApi.createSessions(cls.id, {
          title: title.trim(),
          teaching_content: teachingContent.trim() || undefined,
          delivery_mode: deliveryMode,
          start_time: startTime,
          end_time: endTime,
          room_or_link: room.trim(),
          recurrence: { start_date: startDate, end_date: endDate, weekdays },
          virtual_room_config: virtualConfig,
        });
        toast({
          tone: 'success',
          title: `Đã tạo ${res.created_count} buổi học theo lịch tuần`,
          detail: res.skipped_dates.length ? `Bỏ qua ${res.skipped_dates.length} buổi trùng giờ.` : undefined,
        });
      } else if (modalMode) {
        const payload: Record<string, unknown> = {
          title: title.trim(),
          teaching_content: teachingContent.trim(),
          delivery_mode: deliveryMode,
          room_or_link: room.trim(),
        };
        if (!modalMode.attendance_saved_at) {
          payload.date = date;
          payload.start_time = startTime;
          payload.end_time = endTime;
        }
        await teachingApi.updateSession(modalMode.id, payload);
        if (virtualConfig) {
          await teachingApi.createVirtualRoom(modalMode.id, virtualConfig);
        }
        toast({ tone: 'success', title: 'Đã cập nhật buổi học' });
      }
      setModalMode(null);
      sessReq.reload();
      existingRoomsReq.reload();
      onChanged();
    } catch (err) {
      setFormErr(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Lịch các buổi học & Phòng học trực tuyến"
      actions={
        cls.capabilities.can_manage_sessions && (
          <>
            <Btn small onClick={() => openCreate('recurring')}>+ Tạo lịch lặp theo tuần</Btn>
            <Btn small variant="primary" onClick={() => openCreate('single')}>+ Tạo buổi học</Btn>
          </>
        )
      }
    >
      {sessReq.loading && <Loading rows={4} />}
      {sessReq.error && <ErrorState error={sessReq.error} onRetry={sessReq.reload} />}
      {!sessReq.loading && !sessReq.error && (
        (sessReq.data?.items.length || 0) === 0 ? (
          <EmptyState
            title="Lớp chưa có buổi học nào"
            text="Tạo từng buổi lẻ hoặc sinh tự động lịch học hàng tuần để bắt đầu giảng dạy và điểm danh."
          />
        ) : (
          <div>
            {(sessReq.data?.items || []).map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                showClass={false}
                showDate
                actions={
                  <>
                    <Badge kind="attendanceState" value={s.attendance_state} />
                    {s.session_status !== 'CANCELLED' && (
                      <>
                        <Link className="t-btn t-btn--small" to={virtualSessionLink(s)}>
                          {s.virtual_room ? 'Phòng trực tuyến' : 'Tạo phòng online'}
                        </Link>
                        <Link className={`t-btn t-btn--small ${s.attendance_state === 'NEEDS_ATTENDANCE' ? 't-btn--primary' : ''}`} to={attendanceLink(s)}>
                          Điểm danh
                        </Link>
                      </>
                    )}
                    {cls.capabilities.can_manage_sessions && s.session_status !== 'CANCELLED' && (
                      <>
                        <Btn small variant="ghost" onClick={() => openEdit(s)}>Sửa</Btn>
                        <Btn small variant="danger" onClick={() => setCancelTarget(s)}>Hủy buổi</Btn>
                      </>
                    )}
                    {cls.capabilities.can_manage_sessions && s.session_status === 'CANCELLED' && (
                      <Btn
                        small
                        onClick={async () => {
                          try {
                            await teachingApi.restoreSession(s.id);
                            toast({ tone: 'success', title: 'Đã khôi phục buổi học' });
                            sessReq.reload();
                            onChanged();
                          } catch (e) {
                            toast({ tone: 'error', title: 'Không khôi phục được', detail: errMsg(e) });
                          }
                        }}
                      >
                        Khôi phục
                      </Btn>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )
      )}

      {modalMode && (
        <Modal
          title={
            modalMode === 'single'
              ? 'Tạo buổi học'
              : modalMode === 'recurring'
              ? 'Tạo lịch buổi học lặp theo tuần'
              : 'Chỉnh sửa buổi học'
          }
          onClose={() => setModalMode(null)}
          width={640}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setModalMode(null)} disabled={busy}>Hủy</Btn>
              <Btn variant="primary" onClick={submitSession} loading={busy}>Lưu buổi học</Btn>
            </>
          }
        >
          <form onSubmit={submitSession} className="t-form-grid">
            <Field label="Lớp học">
              <input className="t-input" value={`${cls.code} — ${cls.title}`} disabled />
            </Field>
            <Field label="Môn học & Giảng viên phụ trách">
              <input
                className="t-input"
                value={`${cls.subject || 'Chưa gắn môn'} · ${cls.staff.map((st) => st.full_name).join(', ') || '—'}`}
                disabled
              />
            </Field>
            <Field label="Tên buổi học" wide hint="Nếu để trống khi tạo mới, hệ thống tự đặt theo ngày học.">
              <input className="t-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="vd: Buổi 12 — Ôn tập trực tuyến Phân số & Số thập phân" />
            </Field>
            <Field label="Nội dung giảng dạy" wide>
              <textarea
                className="t-input"
                rows={2}
                value={teachingContent}
                onChange={(e) => setTeachingContent(e.target.value)}
                placeholder="Tóm tắt mục tiêu, học liệu và hoạt động chính trong buổi học…"
              />
            </Field>
            {modalMode === 'recurring' ? (
              <>
                <Field label="Từ ngày" required>
                  <input className="t-input tabular-nums" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="Đến ngày" required>
                  <input className="t-input tabular-nums" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
                <Field label="Các ngày học trong tuần" required wide>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {WEEKDAYS.map((w) => {
                      const active = weekdays.includes(w.day);
                      return (
                        <Btn
                          key={w.day}
                          small
                          variant={active ? 'primary' : 'quiet'}
                          onClick={() =>
                            setWeekdays((prev) => (prev.includes(w.day) ? prev.filter((d) => d !== w.day) : [...prev, w.day]))
                          }
                        >
                          {w.label}
                        </Btn>
                      );
                    })}
                  </div>
                </Field>
              </>
            ) : (
              <Field
                label="Ngày học"
                required
                wide
                hint={typeof modalMode === 'object' && modalMode.attendance_saved_at ? 'Buổi học đã có điểm danh nên không đổi ngày/giờ.' : undefined}
              >
                <input
                  className="t-input tabular-nums"
                  type="date"
                  value={date}
                  disabled={typeof modalMode === 'object' && Boolean(modalMode.attendance_saved_at)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            )}
            <Field label="Giờ bắt đầu" required>
              <input
                className="t-input tabular-nums"
                type="time"
                value={startTime}
                disabled={typeof modalMode === 'object' && Boolean(modalMode.attendance_saved_at)}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label="Giờ kết thúc" required>
              <input
                className="t-input tabular-nums"
                type="time"
                value={endTime}
                disabled={typeof modalMode === 'object' && Boolean(modalMode.attendance_saved_at)}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>

            <Field label="Hình thức học" required>
              <select
                className="t-input"
                value={deliveryMode}
                onChange={(e) => {
                  const nextMode = e.target.value as DeliveryMode;
                  setDeliveryMode(nextMode);
                  if ((nextMode === 'ONLINE' || nextMode === 'HYBRID') && virtualAction === 'NONE') {
                    setVirtualAction(typeof modalMode === 'object' && modalMode.virtual_room ? 'KEEP' : 'CREATE_NEW');
                  }
                }}
              >
                <option value="OFFLINE">Trực tiếp (Offline)</option>
                <option value="ONLINE">Trực tuyến (Online)</option>
                <option value="HYBRID">Kết hợp (Hybrid)</option>
              </select>
            </Field>

            <Field label="Phòng học vật lý / Ghi chú địa điểm">
              <input className="t-input" value={room} maxLength={300} onChange={(e) => setRoom(e.target.value)} placeholder="vd: Phòng 5A1 - Dãy B" />
            </Field>

            {(deliveryMode === 'ONLINE' || deliveryMode === 'HYBRID') && (
              <>
                <Field
                  label="Tùy chọn phòng học trực tuyến"
                  wide
                  hint={
                    typeof modalMode === 'object' && modalMode.virtual_room
                      ? 'Khi chỉ sửa tên hoặc nội dung buổi học, hệ thống giữ nguyên phòng đã tạo (không tự tạo phòng mới).'
                      : undefined
                  }
                >
                  <select
                    className="t-input"
                    value={virtualAction}
                    onChange={(e) => setVirtualAction(e.target.value as typeof virtualAction)}
                  >
                    {typeof modalMode === 'object' && modalMode.virtual_room && (
                      <option value="KEEP">
                        Giữ nguyên phòng hiện tại ({label('virtualProvider', modalMode.virtual_room.provider)}: {modalMode.virtual_room.room_title})
                      </option>
                    )}
                    <option value="CREATE_NEW">Tạo phòng mới tự động (Zoom / Google Meet)</option>
                    <option value="RECURRING_CLASS">Sử dụng phòng cố định cho nhiều buổi của lớp</option>
                    <option value="REUSE_EXISTING">Sử dụng phòng đã tạo trước đó</option>
                    <option value="EXTERNAL_LINK">Nhập link phòng có sẵn bên ngoài</option>
                    <option value="NONE">Thiết lập phòng sau</option>
                  </select>
                </Field>

                {(virtualAction === 'CREATE_NEW' || virtualAction === 'RECURRING_CLASS') && (
                  <>
                    <Field label="Nền tảng họp trực tuyến" required>
                      <select
                        className="t-input"
                        value={provider}
                        onChange={(e) => setProvider(e.target.value as VirtualProviderType)}
                      >
                        <option value="ZOOM">Tạo phòng Zoom (REST API + Webhooks)</option>
                        <option value="GOOGLE_MEET">Tạo phòng Google Meet (Spaces API)</option>
                      </select>
                    </Field>
                    <Field label="Tên phòng trực tuyến">
                      <input
                        className="t-input"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder={`${cls.code} — ${title || 'Buổi học trực tuyến'}`}
                      />
                    </Field>
                  </>
                )}

                {virtualAction === 'REUSE_EXISTING' && (
                  <Field label="Chọn phòng đã tạo của lớp" wide required>
                    <select className="t-input" value={existingRoomId} onChange={(e) => setExistingRoomId(e.target.value)}>
                      {(existingRoomsReq.data?.items || []).map((r) => (
                        <option key={r.id} value={r.id}>
                          [{label('virtualProvider', r.provider)}] {r.room_title} ({r.external_meeting_id || r.join_url})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {virtualAction === 'EXTERNAL_LINK' && (
                  <>
                    <div className="t-notice t-notice--warning t-field--wide">
                      <strong>Chưa hỗ trợ đồng bộ điểm danh tự động với nền tảng này:</strong> Khi gắn link phòng bên ngoài không qua API, hệ thống sẽ không tự động đếm người tham gia hoặc tự động chốt điểm danh.
                    </div>
                    <Field label="Nền tảng">
                      <input
                        className="t-input"
                        value={externalPlatformName}
                        onChange={(e) => setExternalPlatformName(e.target.value)}
                        placeholder="Microsoft Teams / Webex"
                      />
                    </Field>
                    <Field label="Mã phòng (Meeting ID)">
                      <input className="t-input tabular-nums" value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
                    </Field>
                    <Field label="Meeting URL" wide required>
                      <input
                        className="t-input"
                        type="url"
                        value={externalUrl}
                        onChange={(e) => setExternalUrl(e.target.value)}
                        placeholder="https://teams.microsoft.com/..."
                      />
                    </Field>
                    <Field label="Mật khẩu phòng (nếu cần)" wide>
                      <input className="t-input tabular-nums" value={externalPasscode} onChange={(e) => setExternalPasscode(e.target.value)} />
                    </Field>
                  </>
                )}
              </>
            )}

            {formErr && <p className="t-field__error t-field--wide" role="alert">{formErr}</p>}
          </form>
        </Modal>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Hủy buổi học này?"
          message={`Buổi "${cancelTarget.title}" (${fmtDate(cancelTarget.start_at)}) sẽ chuyển sang Đã hủy và không tính vào mẫu số chuyên cần của lớp.`}
          confirmLabel="Xác nhận hủy buổi"
          danger
          reasonLabel="Lý do hủy buổi học"
          reasonRequired
          onCancel={() => setCancelTarget(null)}
          onConfirm={async (reason) => {
            await teachingApi.cancelSession(cancelTarget.id, reason);
            setCancelTarget(null);
            toast({ tone: 'success', title: 'Đã hủy buổi học' });
            sessReq.reload();
            onChanged();
          }}
        />
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ Tab 5 & 7: Điểm danh & Kết quả học tập

export const AttendanceAndResultsTab: React.FC<{ cls: ClassDetail; mode: 'attendance' | 'results' }> = ({ cls, mode }) => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);

  const statsReq = useAsync(() => teachingApi.stats(cls.id), [cls.id]);
  const rosterReq = useAsync(
    () => (mode === 'results' ? teachingApi.students(cls.id, { status: 'ACTIVE' }) : Promise.resolve(null)),
    [cls.id, mode]
  );
  const sessReq = useAsync(
    () => (mode === 'attendance' ? teachingApi.sessions(cls.id) : Promise.resolve(null)),
    [cls.id, mode]
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const f = await teachingApi.exportStats(cls.id);
      saveBlob(f);
      toast({ tone: 'success', title: 'Đã tải tệp CSV thống kê chuyên cần' });
    } catch (e) {
      toast({ tone: 'error', title: 'Không xuất được CSV', detail: errMsg(e) });
    } finally {
      setExporting(false);
    }
  };

  if (statsReq.loading || rosterReq.loading || sessReq.loading) return <Loading rows={4} />;
  if (statsReq.error || !statsReq.data) return <ErrorState error={statsReq.error} onRetry={statsReq.reload} />;

  const stats = statsReq.data;

  if (mode === 'results') {
    const students = (rosterReq.data?.items || []).filter((s) =>
      !q.trim() ? true : `${s.code} ${s.full_name}`.toLowerCase().includes(q.trim().toLowerCase())
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="t-stats">
          <StatCard label="Sĩ số đang học" value={rosterReq.data?.items.length || 0} />
          <StatCard label="Tỷ lệ chuyên cần chung" value={fmtPct(stats.class_totals.rate)} hint={stats.policy.formula_text} />
          <StatCard
            label="Tiến độ bài học trung bình"
            value={cls.progress ? fmtPct(cls.progress.avg_completion_pct) : '—'}
            hint={cls.progress ? `${cls.progress.published_lessons} bài đã xuất bản` : 'Chưa gắn khóa học'}
          />
        </div>

        <Card
          title="Tổng hợp tiến độ & chuyên cần theo học viên"
          padded={false}
          actions={
            <Btn small onClick={handleExport} loading={exporting}>
              Xuất CSV chuyên cần
            </Btn>
          }
        >
          <div className="t-toolbar" style={{ padding: '0 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <SearchInput value={q} onChange={setQ} placeholder="Tìm theo họ tên hoặc mã học viên…" />
          </div>
          {students.length === 0 ? (
            <EmptyState title="Không tìm thấy học viên phù hợp" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th className="num">STT</th>
                    <th>Mã số</th>
                    <th>Họ và tên</th>
                    <th>Tiến độ bài học</th>
                    <th className="num">Có mặt</th>
                    <th className="num">Đi muộn</th>
                    <th className="num">Có phép</th>
                    <th className="num">Vắng</th>
                    <th className="num">Tỷ lệ chuyên cần</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st, idx) => {
                    const warn = st.attendance.rate !== null && st.attendance.rate < stats.policy.warning_threshold_pct;
                    return (
                      <tr key={st.id}>
                        <td className="num">{idx + 1}</td>
                        <td className="tabular-nums">{st.code}</td>
                        <td><strong>{st.full_name}</strong></td>
                        <td>
                          {st.progress.total > 0 ? (
                            <ProgressMeter value={st.progress.completed} total={st.progress.total} label={st.full_name} />
                          ) : (
                            <span className="t-sub">—</span>
                          )}
                        </td>
                        <td className="num">{st.attendance.present}</td>
                        <td className="num">{st.attendance.late}</td>
                        <td className="num">{st.attendance.excused}</td>
                        <td className="num">{st.attendance.absent}</td>
                        <td className="num">
                          {warn ? <Tone tone="danger">{fmtPct(st.attendance.rate)}</Tone> : fmtPct(st.attendance.rate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-stats">
        <StatCard label="Buổi đã diễn ra" value={`${stats.sessions_with_attendance}/${stats.sessions_held}`} hint={stats.cancelled_sessions ? `${stats.cancelled_sessions} buổi đã hủy (không tính)` : 'Chưa có buổi hủy'} />
        <StatCard label="Lượt có mặt / đi muộn" value={`${stats.class_totals.PRESENT} / ${stats.class_totals.LATE}`} tone="success" />
        <StatCard label="Lượt vắng có phép / không phép" value={`${stats.class_totals.EXCUSED_ABSENCE} / ${stats.class_totals.UNEXCUSED_ABSENCE}`} tone={stats.class_totals.UNEXCUSED_ABSENCE > 0 ? 'warning' : 'default'} />
        <StatCard label="Tỷ lệ chuyên cần toàn lớp" value={fmtPct(stats.class_totals.rate)} hint={stats.policy.formula_text} />
      </div>

      <Card
        title="Điểm danh theo từng buổi học"
        actions={
          <>
            <Btn small onClick={handleExport} loading={exporting}>Xuất CSV chuyên cần</Btn>
            <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/classes/${cls.id}/attendance`}>
              Mở bảng điểm danh nhanh
            </Link>
          </>
        }
      >
        {(sessReq.data?.items.length || 0) === 0 ? (
          <EmptyState title="Chưa có buổi học nào để điểm danh" />
        ) : (
          (sessReq.data?.items || []).map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              showClass={false}
              showDate
              actions={
                <>
                  <Badge kind="attendanceState" value={s.attendance_state} />
                  {s.session_status !== 'CANCELLED' && (
                    <>
                      <Link className="t-btn t-btn--small" to={virtualSessionLink(s)}>
                        Phòng trực tuyến
                      </Link>
                      <Link className={`t-btn t-btn--small ${s.attendance_state === 'NEEDS_ATTENDANCE' ? 't-btn--primary' : ''}`} to={attendanceLink(s)}>
                        {s.attendance_state === 'NEEDS_ATTENDANCE' ? 'Điểm danh ngay' : 'Mở bảng điểm danh'}
                      </Link>
                    </>
                  )}
                </>
              }
            />
          ))
        )}
      </Card>
    </div>
  );
};

// ------------------------------------------------------------------ Tab 8: Nhật ký giảng dạy (24 giờ)

export const TeachingLogTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
  const toast = useToast();
  const sessReq = useAsync(() => teachingApi.sessions(cls.id), [cls.id]);
  const logReq = useAsync(() => teachingApi.teachingLog(cls.id), [cls.id]);
  const [confirming, setConfirming] = useState<SessionSummary | null>(null);

  const pastSessions = (sessReq.data?.items || []).filter(
    (s) => s.session_status !== 'CANCELLED' && Date.parse(s.end_at) <= Date.now()
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card
        title="Xác nhận nhật ký buổi dạy (quy định 24 giờ)"
        actions={<span className="t-sub">Xác nhận sau 24 giờ kể từ lúc kết thúc buổi học cần ghi rõ lý do.</span>}
      >
        {pastSessions.length === 0 ? (
          <EmptyState title="Chưa có buổi học nào đã kết thúc" />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Buổi học</th>
                  <th>Thời gian</th>
                  <th>Điểm danh</th>
                  <th>Trạng thái nhật ký</th>
                  {cls.capabilities.can_confirm_teaching_log && <th className="actions">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {pastSessions.map((s) => {
                  const overdue = Date.now() > Date.parse(s.confirmation_deadline_at);
                  const unconfirmed = s.confirmation_status === 'AWAITING_CONFIRMATION' || s.confirmation_status === 'OVERDUE_UNCONFIRMED';
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.title}</strong></td>
                      <td className="tabular-nums">{fmtWeekday(s.start_at)}, {fmtDate(s.start_at)} · {fmtTime(s.start_at)}–{fmtTime(s.end_at)}</td>
                      <td><Badge kind="attendanceState" value={s.attendance_state} /></td>
                      <td>
                        <Badge kind="log" value={unconfirmed && overdue ? 'OVERDUE_UNCONFIRMED' : s.confirmation_status} />
                      </td>
                      {cls.capabilities.can_confirm_teaching_log && (
                        <td className="actions">
                          {unconfirmed ? (
                            <Btn
                              small
                              variant="primary"
                              onClick={() => setConfirming(s)}
                            >
                              Xác nhận buổi dạy
                            </Btn>
                          ) : (
                            <span className="t-sub tabular-nums">{fmtDateTime(s.confirmed_at)}</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Lịch sử ghi nhận nhật ký">
        {logReq.loading && <Loading rows={3} />}
        {logReq.error && <ErrorState error={logReq.error} onRetry={logReq.reload} />}
        {!logReq.loading && !logReq.error && (logReq.data?.items.length || 0) === 0 && (
          <EmptyState title="Chưa có bản ghi nhật ký nào" />
        )}
        {!logReq.loading && !logReq.error && (logReq.data?.items.length || 0) > 0 && (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Người thực hiện</th>
                  <th>Trạng thái mới</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {(logReq.data?.items || []).map((item) => (
                  <tr key={item.id}>
                    <td className="tabular-nums">{fmtDateTime(item.changed_at)}</td>
                    <td>{item.changed_by}</td>
                    <td><Badge kind="log" value={item.new_status} /></td>
                    <td>{item.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirming && (
        <ConfirmDialog
          title="Xác nhận hoàn thành buổi giảng dạy"
          message={`Xác nhận đã thực hiện buổi học "${confirming.title}" ngày ${fmtDate(confirming.start_at)}.`}
          confirmLabel="Xác nhận nhật ký"
          reasonLabel={
            Date.now() > Date.parse(confirming.confirmation_deadline_at)
              ? 'Lý do xác nhận muộn sau 24 giờ'
              : 'Ghi chú nội dung buổi dạy (không bắt buộc)'
          }
          reasonRequired={Date.now() > Date.parse(confirming.confirmation_deadline_at)}
          onCancel={() => setConfirming(null)}
          onConfirm={async (note) => {
            await teachingApi.confirmLog(confirming.id, note);
            setConfirming(null);
            toast({ tone: 'success', title: 'Đã xác nhận nhật ký giảng dạy' });
            sessReq.reload();
            logReq.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
};
