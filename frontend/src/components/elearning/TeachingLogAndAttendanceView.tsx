import React, { useState } from 'react';
import {
  TAPermissionFlags,
  TeachingSessionLogRecord,
  UserRole,
} from '../../types/elearning';
import {
  Badge,
  Button,
  ScopePermissionGuard,
  SurfacePanel,
} from '../ui/Primitives';

interface TeachingLogAndAttendanceViewProps {
  currentRole: UserRole;
  taFlags: TAPermissionFlags;
  onNotify?: (msg: string, detail?: string) => void;
}

interface AuditHistoryEntry {
  id: string;
  session_code: string;
  previous_status: string;
  new_status: string;
  changed_by: string;
  changed_at: string;
  note: string;
}

interface LeaveRequestItem {
  id: string;
  student_code: string;
  student_name: string;
  reason: string;
  makeup_class_requested: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const INITIAL_SESSIONS: TeachingSessionLogRecord[] = [
  {
    session_id: 'ses_101',
    subject_class_code: 'SE302.01',
    subject_title: 'Thiết kế Hệ thống Phân tán',
    session_title: 'Buổi 08: Đồng thuận Raft & Thực hành Log Replication',
    scheduled_start_at: '2026-11-10 07:00',
    scheduled_end_at: '2026-11-10 09:30',
    confirmation_deadline_at: '2026-11-11 09:30', // +24h after scheduled_end_at
    actual_start_at: '2026-11-10 07:02',
    actual_end_at: '2026-11-10 09:35',
    scheduled_instructor_name: 'TS. Lê Hoàng Nam',
    actual_instructor_name: 'TS. Lê Hoàng Nam',
    is_substitute_teaching: false,
    ta_names: ['ThS. Trần Minh Quân'],
    confirmation_status: 'AWAITING_CONFIRMATION',
    confirmed_at: null,
    is_late_confirmation: false,
    reminder_sent_count: 0,
    lessons_delivery: [
      {
        lesson_id: 'les_301',
        lesson_title: 'Bài 3.1: Tổng quan bài toán Đồng thuận & FLP',
        delivery_status: 'COMPLETED',
        progress_note: 'Đã giảng xong 100% lý thuyết và bài tập ví dụ.',
      },
      {
        lesson_id: 'les_302',
        lesson_title: 'Bài 3.2: Thuật toán Raft — Bầu chọn Leader & Quorum',
        delivery_status: 'PARTIAL',
        progress_note: 'Đã dạy xong Leader Election, phần Log Compaction chuyển sang đầu buổi 09.',
      },
    ],
  },
  {
    session_id: 'ses_098',
    subject_class_code: 'SE302.01',
    subject_title: 'Thiết kế Hệ thống Phân tán',
    session_title: 'Buổi 07: Kiến trúc Microservices & Event-Driven Saga',
    scheduled_start_at: '2026-11-08 07:00',
    scheduled_end_at: '2026-11-08 09:30',
    confirmation_deadline_at: '2026-11-09 09:30', // Expired > 24h ago
    actual_start_at: '2026-11-08 07:00',
    actual_end_at: '2026-11-08 09:30',
    scheduled_instructor_name: 'TS. Lê Hoàng Nam',
    actual_instructor_name: 'TS. Phạm Quốc Bảo (Dạy thay)',
    is_substitute_teaching: true,
    ta_names: ['ThS. Trần Minh Quân'],
    confirmation_status: 'OVERDUE_UNCONFIRMED',
    confirmed_at: null,
    is_late_confirmation: false,
    reminder_sent_count: 1,
    lessons_delivery: [
      {
        lesson_id: 'les_204',
        lesson_title: 'Bài 2.4: Mẫu thiết kế Saga (Choreography vs Orchestration)',
        delivery_status: 'COMPLETED',
        progress_note: 'Hoàn thành 100% nội dung và hướng dẫn bài Lab.',
      },
    ],
  },
];

const INITIAL_AUDIT_HISTORY: AuditHistoryEntry[] = [
  {
    id: 'hist_01',
    session_code: 'Buổi 07 (SE302.01)',
    previous_status: 'AWAITING_CONFIRMATION',
    new_status: 'OVERDUE_UNCONFIRMED',
    changed_by: 'Hệ thống kiểm tra tự động (24h)',
    changed_at: '2026-11-09 09:30:01',
    note: 'Tự động chuyển trạng thái quá hạn sau 24 giờ kể từ thời điểm kết thúc buổi học (Không khóa quyền xác nhận của Giảng viên).',
  },
];

const INITIAL_LEAVE_REQUESTS: LeaveRequestItem[] = [
  {
    id: 'lv_01',
    student_code: 'SV2026018',
    student_name: 'Nguyễn Minh Anh',
    reason: 'Tham dự kỳ thi Olympic Tin học Sinh viên toàn quốc (Có giấy triệu tập Khoa)',
    makeup_class_requested: 'Xin học bù cùng Lớp SE302.02 (Sáng Thứ Sáu)',
    status: 'PENDING',
  },
  {
    id: 'lv_02',
    student_code: 'SV2026042',
    student_name: 'Lê Hoàng Bách',
    reason: 'Khám sức khỏe định kỳ theo lịch trường',
    makeup_class_requested: 'Xem lại bản ghi Video bài giảng + Làm bài kiểm tra nhanh bù',
    status: 'APPROVED',
  },
];

export const TeachingLogAndAttendanceView: React.FC<TeachingLogAndAttendanceViewProps> = ({
  currentRole,
  taFlags,
  onNotify,
}) => {
  const [sessions, setSessions] = useState<TeachingSessionLogRecord[]>(INITIAL_SESSIONS);
  const [auditLogs, setAuditLogs] = useState<AuditHistoryEntry[]>(INITIAL_AUDIT_HISTORY);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>(INITIAL_LEAVE_REQUESTS);
  const [lateReasonMap, setLateReasonMap] = useState<Record<string, string>>({});
  const [qrWindowIndex, setQrWindowIndex] = useState<number>(849210);

  const STATUS_NAMES: Record<string, string> = {
    AWAITING_CONFIRMATION: 'Chờ xác nhận (Trong hạn 24 giờ)',
    OVERDUE_UNCONFIRMED: 'Quá hạn 24 giờ chưa xác nhận',
    CONFIRMED: 'Đã xác nhận đúng hạn',
    CONFIRMED_LATE: 'Đã xác nhận bổ sung (Sau 24 giờ)',
  };

  const handleSimulate24hExpiry = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.session_id === sessionId
          ? { ...s, confirmation_status: 'OVERDUE_UNCONFIRMED' }
          : s
      )
    );
    const target = sessions.find((s) => s.session_id === sessionId);
    setAuditLogs((prev) => [
      {
        id: `hist_${Date.now()}`,
        session_code: target ? `${target.session_title.slice(0, 7)} (${target.subject_class_code})` : sessionId,
        previous_status: 'AWAITING_CONFIRMATION',
        new_status: 'OVERDUE_UNCONFIRMED',
        changed_by: 'Hệ thống tự động (24 giờ)',
        changed_at: new Date().toLocaleString('vi-VN'),
        note: 'Quá 24 giờ sau khi buổi học kết thúc -> Chuyển sang trạng thái Quá hạn (Giảng viên vẫn có quyền ký xác nhận bổ sung).',
      },
      ...prev,
    ]);
    onNotify?.(
      'Đã mô phỏng trôi qua 24 giờ sau khi kết thúc buổi học!',
      'Trạng thái đã chuyển sang Quá hạn xác nhận nhưng quyền ký xác nhận của Giảng viên vẫn mở.'
    );
  };

  const handleConfirmSession = (sessionId: string) => {
    const nowFormatted = new Date().toLocaleString('vi-VN');
    const target = sessions.find((s) => s.session_id === sessionId);
    if (!target) return;

    const isOverdue = target.confirmation_status === 'OVERDUE_UNCONFIRMED';
    const nextStatus = isOverdue ? 'CONFIRMED_LATE' : 'CONFIRMED';
    const reasonText = isOverdue
      ? lateReasonMap[sessionId] || 'Giảng viên xác nhận bổ sung sau hạn 24 giờ do bận coi thi.'
      : 'Giảng viên ký xác nhận đúng thời hạn 24 giờ.';

    setSessions((prev) =>
      prev.map((s) => {
        if (s.session_id !== sessionId) return s;
        return {
          ...s,
          confirmation_status: nextStatus,
          confirmed_at: nowFormatted,
          is_late_confirmation: isOverdue,
          late_confirmation_reason: isOverdue ? reasonText : undefined,
        };
      })
    );

    setAuditLogs((prev) => [
      {
        id: `hist_${Date.now()}`,
        session_code: `${target.session_title.slice(0, 7)} (${target.subject_class_code})`,
        previous_status: target.confirmation_status,
        new_status: nextStatus,
        changed_by: target.actual_instructor_name,
        changed_at: nowFormatted,
        note: `Kết thúc buổi học: ${target.scheduled_end_at} | Xác nhận thực tế: ${nowFormatted} | Ghi chú: ${reasonText}`,
      },
      ...prev,
    ]);

    onNotify?.(
      isOverdue
        ? 'Đã ký xác nhận buổi dạy bổ sung!'
        : 'Đã ký xác nhận buổi dạy đúng hạn!',
      `Đã lưu nhật ký: thời điểm kết thúc (${target.scheduled_end_at}) & thời điểm xác nhận thực tế (${nowFormatted}).`
    );
  };

  const handleSendReminder = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.session_id === sessionId
          ? { ...s, reminder_sent_count: s.reminder_sent_count + 1 }
          : s
      )
    );
    onNotify?.(
      'Đã gửi thông báo nhắc nhở Giảng viên xác nhận nhật ký buổi dạy!',
      'Giáo vụ / Quản trị viên đã ghi nhận lần nhắc nhở vào lịch sử vận hành.'
    );
  };

  const handleLeaveDecision = (id: string, status: 'APPROVED' | 'REJECTED') => {
    setLeaveRequests((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
    onNotify?.(
      status === 'APPROVED'
        ? 'Đã phê duyệt đơn xin nghỉ & xếp lịch học bù!'
        : 'Đã từ chối đơn xin nghỉ phép.',
      'Trạng thái chuyên cần của học viên đã được đồng bộ tự động.'
    );
  };

  const approvedLeaveCount = leaveRequests.filter((l) => l.status === 'APPROVED').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* SECTION 1: 24-HOUR TEACHING LOG & SESSION CONFIRMATION */}
      <SurfacePanel>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 'var(--space-5)',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--brand-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Sổ Đầu Bài Điện Tử • Quy tắc Xác nhận Trong 24 Giờ
            </div>
            <h2 style={{ fontSize: 'var(--text-h2)', margin: '4px 0 6px 0' }}>
              Quản lý Nhật ký &amp; Trạng thái Xác nhận Buổi dạy
            </h2>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
              Tách biệt hoàn toàn giờ dạy của Giảng viên với điểm danh của Học viên. Quá <strong>24 giờ</strong> sau khi kết thúc buổi học, hệ thống tự động gắn nhãn <strong>Quá hạn chưa xác nhận</strong> nhưng <strong>không khóa quyền xác nhận bổ sung</strong> của Giảng viên.
            </p>
          </div>

          {/* Visual 4-Step State Machine Pill Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              fontSize: '12px',
            }}
          >
            <Badge tone="warning">1. Trong hạn 24h</Badge>
            <span>→</span>
            <Badge tone="danger">2. Quá hạn (&gt;24h)</Badge>
            <span>→</span>
            <Badge tone="learning">3. Xác nhận bổ sung (Lưu lịch sử)</Badge>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {sessions.map((ses) => {
            const isOverdue = ses.confirmation_status === 'OVERDUE_UNCONFIRMED';
            const isConfirmed =
              ses.confirmation_status === 'CONFIRMED' ||
              ses.confirmation_status === 'CONFIRMED_LATE';

            return (
              <div
                key={ses.session_id}
                style={{
                  padding: 'var(--space-5)',
                  borderRadius: 'var(--radius-md)',
                  border: isOverdue
                    ? '1.5px solid var(--status-danger)'
                    : isConfirmed
                    ? '1.5px solid var(--accent-learning)'
                    : '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '12px',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        marginBottom: '6px',
                      }}
                    >
                      <Badge tone="neutral">{ses.subject_class_code}</Badge>
                      {ses.confirmation_status === 'AWAITING_CONFIRMATION' && (
                        <Badge tone="warning">⏳ Chờ xác nhận (Còn trong hạn 24h)</Badge>
                      )}
                      {ses.confirmation_status === 'OVERDUE_UNCONFIRMED' && (
                        <Badge tone="danger">
                          ⚠️ Quá hạn 24h chưa xác nhận (Vẫn mở quyền ký bổ sung)
                        </Badge>
                      )}
                      {ses.confirmation_status === 'CONFIRMED' && (
                        <Badge tone="success">✔ Đã xác nhận đúng hạn (&le; 24h)</Badge>
                      )}
                      {ses.confirmation_status === 'CONFIRMED_LATE' && (
                        <Badge tone="learning">
                          ✔ Đã xác nhận bổ sung (Đã lưu lịch sử)
                        </Badge>
                      )}
                    </div>
                    <h3 style={{ fontSize: '18px', margin: 0 }}>{ses.session_title}</h3>
                  </div>

                  {/* Timestamp Metrics Box */}
                  <div
                    className="tabular-nums"
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <div>
                      Kết thúc buổi học:{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>{ses.scheduled_end_at}</strong>
                    </div>
                    <div>
                      Hạn xác nhận (+24 giờ):{' '}
                      <strong style={{ color: isOverdue ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                        {ses.confirmation_deadline_at}
                      </strong>
                    </div>
                    {ses.confirmed_at && (
                      <div style={{ color: 'var(--accent-learning)', fontWeight: 700 }}>
                        Thời điểm xác nhận: {ses.confirmed_at}
                      </div>
                    )}
                  </div>
                </div>

                {/* Instructor, Substitute & TA info */}
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    marginBottom: '14px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '16px',
                  }}
                >
                  <span>
                    Giảng viên đứng lớp:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{ses.actual_instructor_name}</strong>
                    {ses.is_substitute_teaching && (
                      <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>
                        {' '}
                        (Dạy thay cho {ses.scheduled_instructor_name})
                      </span>
                    )}
                  </span>
                  <span>• Trợ giảng hỗ trợ: <strong>{ses.ta_names.join(', ')}</strong></span>
                </div>

                {/* Lessons Delivered */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginBottom: '16px',
                  }}
                >
                  {ses.lessons_delivery.map((ld) => (
                    <div
                      key={ld.lesson_id}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '13px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <span>
                        <strong style={{ color: 'var(--text-primary)' }}>{ld.lesson_title}</strong> —{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>{ld.progress_note}</span>
                      </span>
                      <Badge tone={ld.delivery_status === 'COMPLETED' ? 'success' : 'warning'}>
                        {ld.delivery_status === 'COMPLETED' ? '✔ Đã dạy xong 100%' : '⏳ Dạy một phần (Chuyển tiếp)'}
                      </Badge>
                    </div>
                  ))}
                </div>

                {/* Confirmed Reason Display */}
                {isConfirmed && ses.late_confirmation_reason && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--accent-learning-tint)',
                      border: '1px solid var(--accent-learning)',
                      fontSize: '13px',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <strong>Ghi chú xác nhận lưu trong hồ sơ:</strong> {ses.late_confirmation_reason}
                  </div>
                )}

                {/* Action Zone based on Role & Overdue State */}
                {!isConfirmed && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                      paddingTop: '14px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {isOverdue ? (
                      <input
                        type="text"
                        aria-label="Lý do xác nhận nhật ký muộn"
                        placeholder="Nhập lý do xác nhận bổ sung (lưu vào lịch sử buổi dạy)..."
                        value={lateReasonMap[ses.session_id] || ''}
                        onChange={(e) =>
                          setLateReasonMap((prev) => ({ ...prev, [ses.session_id]: e.target.value }))
                        }
                        style={{
                          flex: '1 1 220px',
                          minWidth: 0,
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Giảng viên có <strong>24 giờ</strong> kể từ lúc kết thúc buổi học để ký xác nhận.
                        </span>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => handleSimulate24hExpiry(ses.session_id)}
                        >
                          ⚡ Mô phỏng quá hạn 24h
                        </Button>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* Academic Staff or Admin can send overdue reminders */}
                      <ScopePermissionGuard
                        currentRole={currentRole}
                        allowedRoles={['ACADEMIC_STAFF', 'ADMIN']}
                      >
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => handleSendReminder(ses.session_id)}
                        >
                          🔔 Nhắc nhở Giảng viên (Đã gửi: {ses.reminder_sent_count})
                        </Button>
                      </ScopePermissionGuard>

                      {/* Instructor (or Admin) can ALWAYS confirm, even when OVERDUE_UNCONFIRMED */}
                      <ScopePermissionGuard
                        currentRole={currentRole}
                        allowedRoles={['INSTRUCTOR', 'ADMIN']}
                        fallback={
                          <Badge tone="neutral">
                            🔒 Đăng nhập tài khoản Giảng viên để Ký xác nhận buổi dạy
                          </Badge>
                        }
                      >
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => handleConfirmSession(ses.session_id)}
                        >
                          {isOverdue
                            ? '✔ Ký xác nhận bổ sung'
                            : '✔ Ký xác nhận buổi dạy'}
                        </Button>
                      </ScopePermissionGuard>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* TEACHING LOG HISTORY AUDIT TABLE */}
        <div
          style={{
            marginTop: 'var(--space-6)',
            paddingTop: 'var(--space-5)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ fontSize: '15px', margin: 0 }}>
              📜 Lịch sử Xác nhận Sổ Đầu Bài Điện Tử
            </h3>
            <Badge tone="neutral">{auditLogs.length} bản ghi lịch sử</Badge>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {auditLogs.map((entry) => (
              <div
                key={entry.id}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <strong>{entry.session_code}:</strong>{' '}
                  <Badge tone="neutral">{STATUS_NAMES[entry.previous_status] || entry.previous_status}</Badge> →{' '}
                  <Badge tone="learning">{STATUS_NAMES[entry.new_status] || entry.new_status}</Badge> •{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{entry.note}</span>
                </div>
                <span className="tabular-nums" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {entry.changed_by} • {entry.changed_at}
                </span>
              </div>
            ))}
          </div>
        </div>
      </SurfacePanel>

      {/* SECTION 2: DYNAMIC ROTATING QR ATTENDANCE & LEAVE REQUESTS */}
      <div className="responsive-grid-2">
        <SurfacePanel>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-learning)', textTransform: 'uppercase' }}>
            Điểm danh Thông minh • Mã QR Xoay vòng 20 Giây
          </div>
          <h2 style={{ fontSize: '18px', margin: '4px 0 8px 0' }}>
            Điểm danh Lớp SE302.01 (Có mặt: <span className="tabular-nums">36/40</span> • Phép:{' '}
            <span className="tabular-nums">{approvedLeaveCount}</span>)
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
            Mã QR chứa chữ ký bảo mật tự động đổi mới mỗi 20 giây để chống chụp ảnh điểm danh hộ.
          </p>

          <ScopePermissionGuard
            currentRole={currentRole}
            allowedRoles={['INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN']}
            taFlags={taFlags}
            requiredTaFlag="can_take_attendance"
            fallback={
              <Badge tone="danger">
                🔒 Học viên chỉ quét mã QR; Giảng viên hoặc Trợ giảng phụ trách mới có quyền phát mã điểm danh
              </Badge>
            }
          >
            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-strong)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  MÃ PHIÊN ĐIỂM DANH ĐANG HIỆU LỰC (CHU KỲ 20 GIÂY)
                </div>
                <strong
                  className="tabular-nums"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--accent-learning)' }}
                >
                  SE302-QR-{qrWindowIndex}
                </strong>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQrWindowIndex((w) => w + 1);
                  onNotify?.('Đã sinh mã QR điểm danh chu kỳ 20 giây mới!', 'Mã QR cũ đã tự động hết hiệu lực.');
                }}
              >
                ↻ Tạo mã QR mới (20s)
              </Button>
            </div>
          </ScopePermissionGuard>
        </SurfacePanel>

        <SurfacePanel>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary)', textTransform: 'uppercase' }}>
            Chuyên cần &amp; Học vụ • Xét duyệt Nghỉ phép &amp; Học bù
          </div>
          <h2 style={{ fontSize: '18px', margin: '4px 0 8px 0' }}>
            Đơn xin nghỉ phép &amp; Học bù của Học viên
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            {leaveRequests.map((req) => (
              <div
                key={req.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '13px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <strong>
                    {req.student_name} ({req.student_code})
                  </strong>
                  <Badge
                    tone={
                      req.status === 'APPROVED'
                        ? 'success'
                        : req.status === 'REJECTED'
                        ? 'danger'
                        : 'warning'
                    }
                  >
                    {req.status === 'APPROVED'
                      ? '✔ Đã duyệt phép'
                      : req.status === 'REJECTED'
                      ? '✖ Từ chối'
                      : '⏳ Chờ duyệt'}
                  </Badge>
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '4px' }}>
                  Lý do: {req.reason}
                </div>
                <div style={{ color: 'var(--accent-learning)', fontSize: '12px', fontWeight: 600 }}>
                  Phương án học bù: {req.makeup_class_requested}
                </div>

                {req.status === 'PENDING' && (
                  <ScopePermissionGuard
                    currentRole={currentRole}
                    allowedRoles={['INSTRUCTOR', 'TEACHING_ASSISTANT', 'ACADEMIC_STAFF', 'ADMIN']}
                    taFlags={taFlags}
                    requiredTaFlag="can_take_attendance"
                  >
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <Button
                        size="sm"
                        variant="learning"
                        onClick={() => handleLeaveDecision(req.id, 'APPROVED')}
                      >
                        ✔ Duyệt phép &amp; Học bù
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => handleLeaveDecision(req.id, 'REJECTED')}
                      >
                        Từ chối
                      </Button>
                    </div>
                  </ScopePermissionGuard>
                )}
              </div>
            ))}
          </div>
        </SurfacePanel>
      </div>
    </div>
  );
};
