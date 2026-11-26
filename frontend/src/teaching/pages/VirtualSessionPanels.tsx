import React, { useEffect, useState } from 'react';
import {
  teachingApi, VirtualAttendanceRow, VirtualAttendanceRules, VirtualAttendanceStatus,
  VirtualParticipantSession, VirtualProviderConfig, VirtualProviderType, VirtualSessionDetail,
} from '../api';
import { Badge, Btn, Card, EmptyState, Field, Modal, Tone, errMsg, fmtDateTime, fmtTime, label, useToast } from '../ui';

export function fmtDurationSec(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec || 0)));
  if (s === 0) return '0 phút';
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins === 0) return `${remSec} giây`;
  if (remSec === 0) return `${mins} phút`;
  return `${mins}p ${String(remSec).padStart(2, '0')}s`;
}

export function fmtElapsedSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const VIRTUAL_STATUS_OPTIONS: Array<{ value: VirtualAttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Có mặt đủ điều kiện (PRESENT)' },
  { value: 'LATE', label: 'Vào muộn (LATE)' },
  { value: 'PARTIAL', label: 'Chưa đủ thời lượng (PARTIAL)' },
  { value: 'ABSENT', label: 'Vắng mặt (ABSENT)' },
  { value: 'EXCUSED', label: 'Vắng có phép (EXCUSED)' },
  { value: 'MANUAL_REVIEW', label: 'Cần xác nhận (MANUAL_REVIEW)' },
];

// ------------------------------------------------------------------ Sub-components & Modals

export const ConfigureVirtualRoomModal: React.FC<{
  classId: string;
  sessionId: string;
  sessionTitle: string;
  currentRoom: VirtualSessionDetail['room'];
  onClose: () => void;
  onSaved: () => void;
}> = ({ classId, sessionId, sessionTitle, currentRoom, onClose, onSaved }) => {
  const toast = useToast();
  const [mode, setMode] = useState<'CREATE_NEW' | 'REUSE_EXISTING' | 'RECURRING_CLASS' | 'EXTERNAL_LINK'>(
    currentRoom?.provider === 'EXTERNAL' ? 'EXTERNAL_LINK' : 'CREATE_NEW'
  );
  const [provider, setProvider] = useState<VirtualProviderType>(currentRoom?.provider || 'ZOOM');
  const [roomName, setRoomName] = useState(currentRoom?.room_title || sessionTitle);
  const [joinUrl, setJoinUrl] = useState(currentRoom?.join_url || '');
  const [meetingCode, setMeetingCode] = useState(currentRoom?.external_meeting_id || '');
  const [passcode, setPasscode] = useState(currentRoom?.passcode || '');
  const [externalPlatformName, setExternalPlatformName] = useState(currentRoom?.external_platform_name || 'Microsoft Teams');
  const [existingRoomId, setExistingRoomId] = useState('');
  const [busy, setBusy] = useState(false);
  const [existingRooms, setExistingRooms] = useState<
    Array<{
      id: string;
      provider: VirtualProviderType;
      external_platform_name: string;
      room_title: string;
      external_meeting_id: string | null;
      join_url: string;
      is_recurring_room: boolean;
      supports_auto_sync: boolean;
      created_at: string;
    }>
  >([]);

  useEffect(() => {
    teachingApi
      .classVirtualRooms(classId)
      .then((r) => {
        setExistingRooms(r.items);
        if (r.items[0] && !existingRoomId) setExistingRoomId(r.items[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await teachingApi.createVirtualRoom(sessionId, {
        mode,
        provider: mode === 'EXTERNAL_LINK' ? 'EXTERNAL' : provider,
        room_name: roomName.trim() || sessionTitle,
        existing_room_id: mode === 'REUSE_EXISTING' ? existingRoomId : undefined,
        join_url: mode === 'EXTERNAL_LINK' ? joinUrl.trim() : undefined,
        meeting_code: mode === 'EXTERNAL_LINK' ? meetingCode.trim() : undefined,
        passcode: passcode.trim() || undefined,
        external_platform_name: mode === 'EXTERNAL_LINK' ? externalPlatformName.trim() : undefined,
        is_recurring: mode === 'RECURRING_CLASS',
      });
      toast({ tone: 'success', title: 'Đã thiết lập phòng học trực tuyến cho buổi học' });
      onSaved();
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể thiết lập phòng học', detail: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Thiết lập Phòng học trực tuyến"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={busy}>Lưu cấu hình phòng</Btn>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="t-form-grid">
        <Field label="Chế độ khởi tạo phòng họp" wide>
          <select
            className="t-input"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="CREATE_NEW">Tạo phòng họp mới tự động qua API (Zoom / Google Meet)</option>
            <option value="RECURRING_CLASS">Tạo phòng cố định dùng chung cho nhiều buổi của lớp</option>
            <option value="REUSE_EXISTING">Sử dụng lại phòng họp đã tạo của lớp</option>
            <option value="EXTERNAL_LINK">Nhập link phòng họp bên ngoài có sẵn (Thủ công)</option>
          </select>
        </Field>

        {mode === 'REUSE_EXISTING' ? (
          <Field label="Chọn phòng họp đã tạo của lớp" wide required>
            {existingRooms.length === 0 ? (
              <div className="t-notice">Lớp chưa có phòng họp nào được lưu trước đó. Hãy chọn Tạo phòng mới.</div>
            ) : (
              <select className="t-input" value={existingRoomId} onChange={(e) => setExistingRoomId(e.target.value)}>
                {existingRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{label('virtualProvider', r.provider)}] {r.room_title} — ID: {r.external_meeting_id || '—'}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : mode === 'EXTERNAL_LINK' ? (
          <>
            <div className="t-notice t-notice--warning t-field--wide">
              <strong>Lưu ý:</strong> Với link phòng học bên ngoài không kết nối API, hệ thống sẽ hiển thị rõ:{' '}
              <em>"Chưa hỗ trợ đồng bộ điểm danh tự động với nền tảng này"</em> và không giả lập dữ liệu tham gia.
            </div>
            <Field label="Tên phòng học" required>
              <input className="t-input" value={roomName} onChange={(e) => setRoomName(e.target.value)} required />
            </Field>
            <Field label="Nền tảng bên ngoài" required>
              <input
                className="t-input"
                value={externalPlatformName}
                onChange={(e) => setExternalPlatformName(e.target.value)}
                placeholder="vd: Microsoft Teams, Webex, Jitsi…"
              />
            </Field>
            <Field label="Meeting URL (Đường dẫn tham gia)" wide required>
              <input
                className="t-input"
                type="url"
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="https://teams.microsoft.com/l/meetup-join/..."
                required
              />
            </Field>
            <Field label="Mã phòng (Meeting ID)">
              <input className="t-input tabular-nums" value={meetingCode} onChange={(e) => setMeetingCode(e.target.value)} />
            </Field>
            <Field label="Mật khẩu phòng (nếu có)">
              <input className="t-input tabular-nums" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Nền tảng họp trực tuyến" required>
              <select className="t-input" value={provider} onChange={(e) => setProvider(e.target.value as VirtualProviderType)}>
                <option value="ZOOM">Zoom Meeting (Ưu tiên — REST API + Webhook)</option>
                <option value="GOOGLE_MEET">Google Meet (Spaces & Conference Records)</option>
              </select>
            </Field>
            <Field label="Tên phòng học trực tuyến" required>
              <input className="t-input" value={roomName} onChange={(e) => setRoomName(e.target.value)} required />
            </Field>
            <Field label="Mật khẩu phòng (Passcode tùy chọn)" wide hint="Để trống nếu muốn hệ thống tự sinh mật khẩu an toàn.">
              <input className="t-input tabular-nums" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Tự động sinh nếu để trống" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
};

export const MapUnknownParticipantModal: React.FC<{
  classId: string;
  sessionId: string;
  participant: VirtualParticipantSession;
  onClose: () => void;
  onMapped: () => void;
}> = ({ classId, sessionId, participant, onClose, onMapped }) => {
  const toast = useToast();
  const [students, setStudents] = useState<Array<{ id: string; code: string; full_name: string; email: string }>>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [reason, setReason] = useState('Giảng viên xác nhận danh tính người tham gia trùng tên/thiết bị cá nhân');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    teachingApi
      .students(classId, { status: 'ACTIVE' })
      .then((res) => {
        setStudents(res.items);
        if (res.items[0]) setSelectedStudentId(res.items[0].id);
      })
      .catch(() => {});
  }, [classId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return;
    setBusy(true);
    try {
      await teachingApi.mapUnknownParticipant(sessionId, {
        participant_session_id: participant.id,
        student_id: selectedStudentId,
        reason: reason.trim(),
      });
      toast({ tone: 'success', title: 'Đã xác nhận danh tính & tính lại điểm danh tự động' });
      onMapped();
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể gán học viên', detail: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Xác nhận danh tính người tham gia (UNKNOWN)"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={busy} disabled={!selectedStudentId}>
            Xác nhận gán học viên
          </Btn>
        </>
      }
    >
      <div className="t-notice" style={{ marginBottom: 16 }}>
        Người tham gia trong phòng: <strong>{participant.display_name}</strong>
        {participant.participant_email ? ` (${participant.participant_email})` : ' (Không có email)'} · Thời lượng:{' '}
        <strong className="tabular-nums">{fmtDurationSec(participant.duration_sec)}</strong>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Chọn học viên trong danh sách lớp" required>
          <select className="t-input" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.full_name} ({s.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ghi chú / Lý do xác nhận" required>
          <input className="t-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
      </form>
    </Modal>
  );
};

export const ParticipantSlicesModal: React.FC<{
  row: VirtualAttendanceRow;
  windowDurationMinutes: number;
  onClose: () => void;
}> = ({ row, windowDurationMinutes, onClose }) => (
  <Modal
    title={`Chi tiết các lần vào / ra: ${row.full_name} (${row.code})`}
    onClose={onClose}
    width={720}
    footer={<Btn onClick={onClose}>Đóng</Btn>}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="t-notice" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span className="tabular-nums">
          Tổng thời gian thực tế (đã hợp nhất chống trùng): <strong>{fmtDurationSec(row.total_duration_sec)}</strong> / {windowDurationMinutes} phút
        </span>
        <span className="tabular-nums">
          Tỷ lệ tham gia: <strong>{row.attendance_ratio_pct.toFixed(1)}%</strong> · <Badge kind="virtualAttendance" value={row.final_status} />
        </span>
      </div>

      <div>
        <strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
          1. Các phiên vào / rời phòng ghi nhận từ nền tảng ({row.raw_sessions.length} lần)
        </strong>
        {row.raw_sessions.length === 0 ? (
          <EmptyState title="Không có dữ liệu tham gia cho học viên này" />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th className="num">Lần</th>
                  <th>Vào phòng</th>
                  <th>Rời phòng</th>
                  <th className="num">Thời lượng</th>
                  <th>Thiết bị / Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {row.raw_sessions.map((s, idx) => (
                  <tr key={s.id}>
                    <td className="num tabular-nums">{idx + 1}</td>
                    <td className="tabular-nums">{fmtTime(s.join_at)}</td>
                    <td className="tabular-nums">{s.leave_at ? fmtTime(s.leave_at) : 'Đang trong phòng'}</td>
                    <td className="num tabular-nums">{fmtDurationSec(s.duration_sec)}</td>
                    <td>{s.device_info || s.display_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {row.merged_intervals.length > 0 && (
        <div>
          <strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
            2. Khoảng thời gian hợp lệ sau khi hợp nhất chồng lấn (Interval Union)
          </strong>
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th className="num">Khoảng</th>
                  <th>Bắt đầu tính</th>
                  <th>Kết thúc tính</th>
                  <th className="num">Thời lượng hợp lệ</th>
                </tr>
              </thead>
              <tbody>
                {row.merged_intervals.map((iv, i) => (
                  <tr key={i}>
                    <td className="num tabular-nums">#{i + 1}</td>
                    <td className="tabular-nums">{fmtTime(iv.start_at)}</td>
                    <td className="tabular-nums">{fmtTime(iv.end_at)}</td>
                    <td className="num tabular-nums"><strong>{fmtDurationSec(iv.durationSec)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  </Modal>
);

export const AdjustAttendanceModal: React.FC<{
  sessionId: string;
  row: VirtualAttendanceRow;
  onClose: () => void;
  onAdjusted: () => void;
}> = ({ sessionId, row, onClose, onAdjusted }) => {
  const toast = useToast();
  const [status, setStatus] = useState<VirtualAttendanceStatus>(row.final_status);
  const [reason, setReason] = useState(row.adjustment_reason || '');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast({ tone: 'error', title: 'Vui lòng nhập lý do điều chỉnh điểm danh' });
      return;
    }
    setBusy(true);
    try {
      await teachingApi.adjustVirtualAttendance(sessionId, row.student_id, {
        status,
        reason: reason.trim(),
      });
      toast({ tone: 'success', title: `Đã cập nhật điểm danh cho ${row.full_name}` });
      onAdjusted();
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể điều chỉnh điểm danh', detail: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Điều chỉnh điểm danh: ${row.full_name} (${row.code})`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={busy} disabled={!reason.trim()}>
            Lưu điều chỉnh
          </Btn>
        </>
      }
    >
      <div className="t-notice" style={{ marginBottom: 16 }}>
        Kết quả tự động: <Badge kind="virtualAttendance" value={row.calculated_status} /> · Tổng thời gian:{' '}
        <strong className="tabular-nums">{fmtDurationSec(row.total_duration_sec)} ({row.attendance_ratio_pct.toFixed(1)}%)</strong>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Trạng thái điểm danh mới" required>
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as VirtualAttendanceStatus)}>
            {VIRTUAL_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Lý do điều chỉnh (bắt buộc lưu lịch sử kiểm toán)" required>
          <textarea
            className="t-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: Học viên báo mất điện khu vực, đã xin phép giảng viên qua nhóm lớp…"
            required
          />
        </Field>
      </form>
    </Modal>
  );
};

export const SimulateWebhookModal: React.FC<{
  classId: string;
  sessionId: string;
  onClose: () => void;
  onSimulated: () => void;
}> = ({ classId, sessionId, onClose, onSimulated }) => {
  const toast = useToast();
  const [students, setStudents] = useState<Array<{ id: string; code: string; full_name: string; email: string }>>([]);
  const [eventType, setEventType] = useState<'PARTICIPANT_JOINED' | 'PARTICIPANT_LEFT' | 'MEETING_STARTED' | 'MEETING_ENDED'>('PARTICIPANT_JOINED');
  const [pickedStudentId, setPickedStudentId] = useState('UNKNOWN_GUEST');
  const [customName, setCustomName] = useState('Khách iPhone (Chưa rõ tên)');
  const [customEmail, setCustomEmail] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(40);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    teachingApi
      .students(classId, { status: 'ACTIVE' })
      .then((r) => setStudents(r.items))
      .catch(() => {});
  }, [classId]);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const picked = students.find((s) => s.id === pickedStudentId);
      const now = Date.now();
      const joinAt = new Date(now - durationMinutes * 60000).toISOString();
      const leaveAt = new Date(now).toISOString();

      await teachingApi.simulateVirtualEvent(sessionId, {
        event_type: eventType,
        display_name: picked ? picked.full_name : customName,
        participant_email: picked ? picked.email : customEmail || undefined,
        join_at: joinAt,
        leave_at: eventType === 'PARTICIPANT_LEFT' ? leaveAt : undefined,
        device_info: picked ? 'Zoom Desktop Client' : 'Mobile Guest App',
      });
      toast({ tone: 'success', title: 'Đã gửi sự kiện Webhook & cập nhật trạng thái trực tiếp' });
      onSimulated();
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể mô phỏng sự kiện', detail: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Mô phỏng sự kiện Webhook từ Zoom / Google Meet"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Đóng</Btn>
          <Btn variant="primary" onClick={handleRun} loading={busy}>Phát sự kiện Webhook</Btn>
        </>
      }
    >
      <form onSubmit={handleRun} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Loại sự kiện Webhook">
          <select className="t-input" value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)}>
            <option value="PARTICIPANT_JOINED">meeting.participant_joined (Người tham gia vào phòng)</option>
            <option value="PARTICIPANT_LEFT">meeting.participant_left (Người tham gia rời phòng sau N phút)</option>
            <option value="MEETING_STARTED">meeting.started (Bắt đầu cuộc họp)</option>
            <option value="MEETING_ENDED">meeting.ended (Kết thúc cuộc họp & tính điểm danh)</option>
          </select>
        </Field>

        {(eventType === 'PARTICIPANT_JOINED' || eventType === 'PARTICIPANT_LEFT') && (
          <>
            <Field label="Chọn người tham gia">
              <select className="t-input" value={pickedStudentId} onChange={(e) => setPickedStudentId(e.target.value)}>
                <option value="UNKNOWN_GUEST">— Người tham gia chưa rõ danh tính (UNKNOWN) —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.full_name} ({s.email})
                  </option>
                ))}
              </select>
            </Field>
            {pickedStudentId === 'UNKNOWN_GUEST' && (
              <>
                <Field label="Tên hiển thị trong Zoom">
                  <input className="t-input" value={customName} onChange={(e) => setCustomName(e.target.value)} />
                </Field>
                <Field label="Email (để trống để kiểm thử trạng thái UNKNOWN)">
                  <input className="t-input" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} placeholder="Để trống nếu tham gia không đăng nhập" />
                </Field>
              </>
            )}
            {eventType === 'PARTICIPANT_LEFT' && (
              <Field label="Thời lượng đã tham gia trong phiên này (phút)">
                <input
                  className="t-input tabular-nums"
                  type="number"
                  min={1}
                  max={240}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 30))}
                />
              </Field>
            )}
          </>
        )}
      </form>
    </Modal>
  );
};

const PROVIDER_CONN_LABELS: Record<string, string> = {
  CONNECTED: 'Đã kết nối',
  CONFIGURED: 'Đã cấu hình',
  SANDBOX: 'Chế độ thử nghiệm',
  DISCONNECTED: 'Mất kết nối',
  NOT_CONFIGURED: 'Chưa cấu hình',
};

export const RulesAndProvidersPanel: React.FC<{
  sessionId: string;
  rules: VirtualAttendanceRules;
  providers: VirtualProviderConfig[];
  canManage: boolean;
  onSaved: () => void;
}> = ({ sessionId, rules, providers, canManage, onSaved }) => {
  const toast = useToast();
  const [lateGrace, setLateGrace] = useState(rules.late_grace_minutes);
  const [minDuration, setMinDuration] = useState(rules.min_duration_minutes);
  const [minPct, setMinPct] = useState(rules.min_attendance_pct);
  const [minValidSec, setMinValidSec] = useState(rules.min_valid_seconds);
  const [allowAdjust, setAllowAdjust] = useState(rules.allow_instructor_adjustment);
  const [applyToClass, setApplyToClass] = useState(true);
  const [savingRules, setSavingRules] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRules(true);
    try {
      await teachingApi.saveVirtualAttendanceRules(sessionId, {
        late_grace_minutes: lateGrace,
        min_duration_minutes: minDuration,
        min_attendance_pct: minPct,
        min_valid_seconds: minValidSec,
        allow_instructor_adjustment: allowAdjust,
        apply_to_class: applyToClass,
      });
      toast({ tone: 'success', title: 'Đã lưu quy tắc điểm danh & tính lại bảng điểm danh' });
      onSaved();
    } catch (err) {
      toast({ tone: 'error', title: 'Không lưu được quy tắc', detail: errMsg(err) });
    } finally {
      setSavingRules(false);
    }
  };

  const handleValidateProvider = async (p: VirtualProviderType) => {
    setTestingProvider(p);
    try {
      const res = await teachingApi.validateVirtualProvider(p);
      toast({
        tone: res.connected ? 'success' : 'error',
        title: `Kiểm tra kết nối ${label('virtualProvider', p)}: ${res.mode}`,
        detail: res.message,
      });
      onSaved();
    } catch (err) {
      toast({ tone: 'error', title: 'Lỗi kiểm tra kết nối', detail: errMsg(err) });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="t-grid-2">
      <Card title="Cấu hình quy tắc tự động điểm danh">
        <form onSubmit={handleSaveRules} className="t-form-grid">
          <Field label="Thời gian cho phép vào muộn (phút)" hint="Vào sau mốc này sẽ ghi nhận LATE">
            <input
              className="t-input tabular-nums"
              type="number"
              min={0}
              max={120}
              disabled={!canManage}
              value={lateGrace}
              onChange={(e) => setLateGrace(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Thời gian tham gia tối thiểu (phút)" hint="Dưới mức này sẽ ghi nhận PARTIAL">
            <input
              className="t-input tabular-nums"
              type="number"
              min={1}
              max={300}
              disabled={!canManage}
              value={minDuration}
              onChange={(e) => setMinDuration(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
          <Field label="Tỷ lệ thời gian tối thiểu (%)" hint="Tính trên thời lượng quy định của buổi học">
            <input
              className="t-input tabular-nums"
              type="number"
              min={1}
              max={100}
              disabled={!canManage}
              value={minPct}
              onChange={(e) => setMinPct(Math.min(100, Math.max(1, Number(e.target.value) || 75)))}
            />
          </Field>
          <Field label="Thời lượng phiên tối thiểu hợp lệ (giây)" hint="Loại bỏ trường hợp vào phòng vài giây rồi thoát">
            <input
              className="t-input tabular-nums"
              type="number"
              min={5}
              max={600}
              disabled={!canManage}
              value={minValidSec}
              onChange={(e) => setMinValidSec(Math.max(5, Number(e.target.value) || 60))}
            />
          </Field>

          <div className="t-field--wide" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={allowAdjust}
                onChange={(e) => setAllowAdjust(e.target.checked)}
              />
              <span>Cho phép giảng viên điều chỉnh kết quả điểm danh (bắt buộc nhập lý do)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={applyToClass}
                onChange={(e) => setApplyToClass(e.target.checked)}
              />
              <span>Áp dụng bộ quy tắc này làm mặc định cho toàn bộ lớp học</span>
            </label>
          </div>

          {canManage && (
            <div className="t-field--wide">
              <Btn type="submit" variant="primary" loading={savingRules}>
                Lưu quy tắc & Tính lại điểm danh
              </Btn>
            </div>
          )}
        </form>
      </Card>

      <Card title="Kết nối nền tảng họp trực tuyến (Provider Adapter)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {providers.map((p) => (
            <div
              key={p.provider}
              style={{
                padding: 16,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge kind="virtualProvider" value={p.provider} />
                  <strong>{p.display_name}</strong>
                </div>
                <Tone tone={p.connection_status === 'CONNECTED' ? 'success' : 'warning'}>
                  {PROVIDER_CONN_LABELS[p.connection_status] || p.connection_status}
                </Tone>
              </div>
              <span className="t-sub tabular-nums">
                Client ID: {p.client_id || 'Mặc định hệ thống'} · Webhook Secret: {p.has_webhook_secret ? p.masked_webhook_secret : 'Chưa cấu hình'}
              </span>
              <span className="t-sub">{p.status_message}</span>
              <div className="t-actions" style={{ marginTop: 4 }}>
                <Btn
                  small
                  variant="secondary"
                  loading={testingProvider === p.provider}
                  onClick={() => handleValidateProvider(p.provider)}
                >
                  Kiểm tra kết nối (Validate)
                </Btn>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

