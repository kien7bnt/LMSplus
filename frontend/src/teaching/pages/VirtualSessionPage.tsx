import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBreadcrumbTrail } from '../../layout/BreadcrumbContext';
import {
  saveBlob,
  teachingApi,
  VirtualAttendanceHistory,
  VirtualAttendanceRow,
  VirtualAttendanceRules,
  VirtualAttendanceStatus,
  VirtualParticipantSession,
  VirtualProviderConfig,
  VirtualProviderType,
  VirtualSessionDetail,
} from '../api';
import { attendanceLink } from '../components/SessionRow';
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  SearchInput,
  StatCard,
  Tabs,
  Tone,
  errMsg,
  fmtDate,
  fmtDateTime,
  fmtTime,
  fmtWeekday,
  label,
  useToast,
} from '../ui';

type VirtualTab = 'live' | 'attendance' | 'rules' | 'audit';
import {
  AdjustAttendanceModal, ConfigureVirtualRoomModal, fmtDurationSec, fmtElapsedSec,
  MapUnknownParticipantModal, ParticipantSlicesModal, RulesAndProvidersPanel, SimulateWebhookModal,
} from './VirtualSessionPanels';

const LiveElapsedDuration: React.FC<{
  liveStatus: string;
  startedAt?: string | null;
  endedAt?: string | null;
  parens?: boolean;
}> = ({ liveStatus, startedAt, endedAt, parens = true }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (liveStatus !== 'LIVE' || !startedAt) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveStatus, startedAt]);

  const elapsedSeconds = useMemo(() => {
    if (!startedAt) return 0;
    if (liveStatus === 'LIVE') {
      return Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000));
    }
    if (liveStatus === 'ENDED' && endedAt) {
      return Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
    }
    return 0;
  }, [liveStatus, startedAt, endedAt, nowMs]);

  const formatted = fmtElapsedSec(elapsedSeconds);
  return <>{parens ? `(${formatted})` : formatted}</>;
};

export const VirtualSessionPage: React.FC = () => {
  const { classId = '', sessionId = '' } = useParams();
  const toast = useToast();

  const [data, setData] = useState<VirtualSessionDetail | null>(null);
  const [providers, setProviders] = useState<VirtualProviderConfig[]>([]);
  const [history, setHistory] = useState<VirtualAttendanceHistory>({
    adjustments: [],
    sync_jobs: [],
    webhook_events: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [activeTab, setActiveTab] = useState<VirtualTab>('live');
  const [showPasscode, setShowPasscode] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  // Filters
  const [liveQuery, setLiveQuery] = useState('');
  const [liveFilter, setLiveFilter] = useState<'ALL' | 'IN_ROOM' | 'MATCHED' | 'UNKNOWN'>('ALL');
  const [attQuery, setAttQuery] = useState('');
  const [attStatusFilter, setAttStatusFilter] = useState<'ALL' | VirtualAttendanceStatus>('ALL');

  // Modals
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [simulateModalOpen, setSimulateModalOpen] = useState(false);
  const [mapUnknownTarget, setMapUnknownTarget] = useState<VirtualParticipantSession | null>(null);
  const [sliceDetailTarget, setSliceDetailTarget] = useState<VirtualAttendanceRow | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<VirtualAttendanceRow | null>(null);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [sessionRes, providersRes, historyRes] = await Promise.all([
          teachingApi.virtualSession(sessionId),
          teachingApi.virtualProviders().catch(() => ({ items: [] as VirtualProviderConfig[] })),
          teachingApi
            .virtualAttendanceHistory(sessionId)
            .catch(() => ({ adjustments: [], sync_jobs: [], webhook_events: [] } as VirtualAttendanceHistory)),
        ]);
        setData(sessionRes);
        setProviders(providersRes.items);
        setHistory(historyRes);
      } catch (e) {
        setError(e);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const room = data?.room || null;
  const session = data?.session;
  const stats = data?.live_stats;
  const canManage = Boolean(data?.capabilities.can_manage_room || data?.capabilities.can_sync_attendance);

  useBreadcrumbTrail(
    session
      ? [
          { label: `Lớp ${session.class_code}`, to: `/teaching/classes/${classId}` },
          { label: 'Lịch học', to: `/teaching/classes/${classId}?tab=schedule` },
        ]
      : classId
        ? [{ label: 'Chi tiết lớp', to: `/teaching/classes/${classId}` }]
        : []
  );

  const handleCopyJoinUrl = async () => {
    if (!room?.join_url) return;
    try {
      await navigator.clipboard.writeText(room.join_url);
      toast({ tone: 'success', title: 'Đã sao chép đường dẫn tham gia phòng học' });
    } catch {
      toast({ tone: 'info', title: 'Đường dẫn phòng học', detail: room.join_url });
    }
  };

  const handleJoinRoom = async () => {
    setBusyAction(true);
    try {
      const res = await teachingApi.joinVirtualRoom(sessionId);
      toast({
        tone: 'success',
        title: `Đã cấp quyền vào phòng (${label('virtualProvider', res.provider)})`,
        detail: `Đường dẫn: ${res.join_url}`,
      });
      if (res.join_url && typeof window !== 'undefined') {
        window.open(res.join_url, '_blank', 'noopener,noreferrer');
      }
      await loadData(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Không thể tham gia phòng học', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const handleStartHost = async () => {
    setBusyAction(true);
    try {
      const res = await teachingApi.startVirtualRoomHost(sessionId);
      toast({
        tone: 'success',
        title: 'Đã bắt đầu buổi học trực tuyến với quyền Host',
        detail: `Trạng thái phòng học đã chuyển sang Đang diễn ra.`,
      });
      if (res.host_start_url && typeof window !== 'undefined') {
        window.open(res.host_start_url, '_blank', 'noopener,noreferrer');
      }
      await loadData(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Không thể bắt đầu buổi học', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const handleEndSession = async () => {
    setBusyAction(true);
    try {
      const res = await teachingApi.endVirtualRoom(sessionId);
      setData(res);
      toast({
        tone: 'success',
        title: 'Đã kết thúc buổi học & tổng hợp điểm danh',
        detail: `Trạng thái đồng bộ: ${label('syncStatus', res.session.attendance_sync_status)}`,
      });
      setActiveTab('attendance');
      await loadData(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Không kết thúc được buổi học', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSyncNow = async () => {
    setBusyAction(true);
    try {
      const res = await teachingApi.syncVirtualAttendance(sessionId);
      setData(res);
      toast({
        tone: res.room && !res.room.supports_auto_sync ? 'info' : 'success',
        title:
          res.room && !res.room.supports_auto_sync
            ? 'Nền tảng không hỗ trợ đồng bộ tự động'
            : 'Đã đồng bộ dữ liệu tham gia & tính điểm danh',
        detail: res.room?.sync_notice || `Trạng thái: ${label('syncStatus', res.session.attendance_sync_status)}`,
      });
      await loadData(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Đồng bộ thất bại', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmFinal = async () => {
    setBusyAction(true);
    try {
      const res = await teachingApi.confirmVirtualAttendance(sessionId, { resolve_unmatched_as_absent: true });
      setData(res);
      toast({
        tone: 'success',
        title: 'Đã chốt điểm danh buổi học trực tuyến',
        detail: `Đã đồng bộ ${res.attendance_rows.length} bản ghi sang sổ điểm danh chính thức của lớp.`,
      });
      await loadData(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Không thể chốt điểm danh', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const handleExportCsv = async () => {
    setBusyAction(true);
    try {
      const blob = await teachingApi.exportVirtualAttendance(sessionId);
      saveBlob(blob);
      toast({ tone: 'success', title: 'Đã xuất báo cáo điểm danh (Excel CSV)' });
    } catch (e) {
      toast({ tone: 'error', title: 'Không xuất được báo cáo', detail: errMsg(e) });
    } finally {
      setBusyAction(false);
    }
  };

  const filteredParticipantSessions = useMemo(() => {
    const list = data?.participant_sessions || [];
    const kw = liveQuery.trim().toLowerCase();
    return list.filter((p) => {
      if (liveFilter === 'IN_ROOM' && !p.is_currently_in_room) return false;
      if (liveFilter === 'MATCHED' && !p.matched_student_id) return false;
      if (liveFilter === 'UNKNOWN' && p.matched_student_id) return false;
      if (
        kw &&
        !`${p.display_name} ${p.participant_email || ''} ${p.matched_student_name || ''} ${p.matched_student_code || ''}`
          .toLowerCase()
          .includes(kw)
      ) {
        return false;
      }
      return true;
    });
  }, [data?.participant_sessions, liveQuery, liveFilter]);

  const filteredAttendanceRows = useMemo(() => {
    const list = data?.attendance_rows || [];
    const kw = attQuery.trim().toLowerCase();
    return list.filter((r) => {
      if (attStatusFilter !== 'ALL' && r.final_status !== attStatusFilter) return false;
      if (kw && !`${r.code} ${r.full_name} ${r.email}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [data?.attendance_rows, attQuery, attStatusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      PRESENT: 0,
      LATE: 0,
      PARTIAL: 0,
      ABSENT: 0,
      EXCUSED: 0,
      MANUAL_REVIEW: 0,
      UNKNOWN: data?.unknown_participants.length || 0,
    };
    (data?.attendance_rows || []).forEach((r) => {
      counts[r.final_status] = (counts[r.final_status] || 0) + 1;
    });
    return counts;
  }, [data?.attendance_rows, data?.unknown_participants.length]);

  if (loading) return <Loading label="Đang tải phòng học trực tuyến & dữ liệu điểm danh…" rows={6} />;
  if (error || !data || !session || !stats) {
    return <ErrorState error={error} onRetry={() => loadData(false)} />;
  }

  return (
    <div className="t-page">
      <PageHeader
        title={session.title}
        subtitle={
          <>
            Lớp <strong>{session.class_code}</strong> ({session.class_title})
            {session.subject ? ` · Môn: ${session.subject}` : ''}
            {' · '}Giảng viên: <strong>{session.instructor_name || '—'}</strong>
          </>
        }
        actions={
          <>
            <Link className="t-btn t-btn--small" to={attendanceLink({ class_id: session.class_id, id: session.id })}>
              Bảng điểm danh lớp
            </Link>
            {canManage && (
              <Btn small variant="secondary" onClick={() => setRoomModalOpen(true)}>
                {room ? 'Chỉnh sửa link & cấu hình' : '+ Thiết lập phòng họp'}
              </Btn>
            )}
            {room && (
              <Btn small variant="ghost" onClick={handleCopyJoinUrl}>
                Sao chép link
              </Btn>
            )}
            {room && (
              <Btn small variant="secondary" onClick={handleJoinRoom} loading={busyAction}>
                Tham gia phòng
              </Btn>
            )}
            {canManage && room && session.live_status !== 'LIVE' && (
              <Btn variant="primary" onClick={handleStartHost} loading={busyAction}>
                Bắt đầu buổi học (Host)
              </Btn>
            )}
            {canManage && session.live_status === 'LIVE' && (
              <Btn variant="danger" onClick={handleEndSession} loading={busyAction}>
                Kết thúc buổi học
              </Btn>
            )}
          </>
        }
      />

      {/* Cảnh báo rõ ràng khi nền tảng bên ngoài không hỗ trợ đồng bộ tự động */}
      {room && !room.supports_auto_sync && (
        <div className="t-notice t-notice--warning" role="status">
          <strong>Chưa hỗ trợ đồng bộ điểm danh tự động với nền tảng này</strong>
          <div style={{ marginTop: 4 }}>
            Phòng học đang sử dụng liên kết thủ công bên ngoài ({room.external_platform_name || label('virtualProvider', room.provider)}).
            Hệ thống không giả lập số lượng người tham gia hoặc kết quả điểm danh tự động. Vui lòng sử dụng bảng điểm danh thủ công hoặc mã 6 số.
          </div>
        </div>
      )}

      {/* Card thông tin buổi học & phòng trực tuyến */}
      <div className="t-grid-2">
        <Card
          title="Thông tin buổi học"
          actions={
            <div className="t-actions">
              <Badge kind="delivery" value={session.delivery_mode} />
              <Badge kind="liveStatus" value={session.live_status} />
              <Badge kind="syncStatus" value={session.attendance_sync_status} />
            </div>
          }
        >
          <dl className="t-dl">
            <dt>Lớp / Môn học</dt>
            <dd>
              <strong>{session.class_code}</strong> · {session.subject || session.class_title}
            </dd>
            <dt>Giảng viên phụ trách</dt>
            <dd>{session.instructor_name || '—'}</dd>
            <dt>Thời gian lịch học</dt>
            <dd className="tabular-nums">
              {fmtWeekday(session.start_at)}, {fmtDate(session.start_at)} ·{' '}
              <strong>
                {fmtTime(session.start_at)}–{fmtTime(session.end_at)}
              </strong>
            </dd>
            <dt>Thời gian thực tế</dt>
            <dd className="tabular-nums">
              {session.live_started_at ? (
                <>
                  Bắt đầu {fmtTime(session.live_started_at)}
                  {session.live_ended_at ? ` · Kết thúc ${fmtTime(session.live_ended_at)}` : ' · Đang diễn ra'}
                  {' '}<LiveElapsedDuration liveStatus={session.live_status} startedAt={session.live_started_at} endedAt={session.live_ended_at} />
                </>
              ) : (
                'Chưa bắt đầu'
              )}
            </dd>
            {session.teaching_content && (
              <>
                <dt>Nội dung giảng dạy</dt>
                <dd>{session.teaching_content}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card
          title="Thông tin phòng trực tuyến"
          actions={
            room ? (
              <div className="t-actions">
                <Badge kind="virtualProvider" value={room.provider} />
                {room.is_recurring_room && <Tone tone="info">Phòng cố định nhiều buổi</Tone>}
              </div>
            ) : undefined
          }
        >
          {!room ? (
            <EmptyState
              title="Buổi học chưa gắn phòng trực tuyến"
              text="Tạo phòng Zoom, Google Meet tự động hoặc gắn link phòng họp có sẵn để học viên tham gia và đồng bộ điểm danh."
              action={
                canManage && (
                  <Btn variant="primary" onClick={() => setRoomModalOpen(true)}>
                    + Tạo / Gắn phòng trực tuyến
                  </Btn>
                )
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <dl className="t-dl">
                <dt>Tên phòng</dt>
                <dd><strong>{room.room_title}</strong></dd>
                <dt>Nền tảng</dt>
                <dd>
                  {label('virtualProvider', room.provider)}
                  {room.external_platform_name ? ` (${room.external_platform_name})` : ''}
                </dd>
                <dt>Mã phòng (Meeting ID)</dt>
                <dd className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {room.external_meeting_id || room.raw_meeting_id || '—'}
                </dd>
                <dt>Mật khẩu (Passcode)</dt>
                <dd className="tabular-nums" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {room.passcode ? (
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {showPasscode ? room.passcode : '••••••'}
                      </span>
                      <Btn small variant="quiet" onClick={() => setShowPasscode((v) => !v)}>
                        {showPasscode ? 'Ẩn' : 'Hiện'}
                      </Btn>
                    </>
                  ) : (
                    'Không yêu cầu'
                  )}
                </dd>
                <dt>Link tham gia</dt>
                <dd style={{ wordBreak: 'break-all' }}>
                  <a href={room.join_url} target="_blank" rel="noopener noreferrer" className="t-row-link">
                    {room.join_url}
                  </a>
                </dd>
              </dl>

              <div className="t-actions" style={{ paddingTop: 4 }}>
                <Btn small variant="secondary" onClick={handleCopyJoinUrl}>
                  Sao chép link
                </Btn>
                <Btn small variant="primary" onClick={handleJoinRoom} loading={busyAction}>
                  Tham gia phòng
                </Btn>
                {canManage && (
                  <Btn small variant="secondary" onClick={() => setRoomModalOpen(true)}>
                    Chỉnh sửa link &amp; phòng
                  </Btn>
                )}
                {canManage && room.has_host_start_url && session.live_status !== 'LIVE' && (
                  <Btn small variant="secondary" onClick={handleStartHost} loading={busyAction}>
                    Bắt đầu với quyền Host
                  </Btn>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 5 Thẻ Thống kê trực tiếp */}
      <div className="t-stats">
        <StatCard
          label="Sĩ số lớp"
          value={stats.roster_size}
          hint="Học viên đang theo học"
        />
        <StatCard
          label="Đang trong phòng"
          value={!room || !room.supports_auto_sync || stats.current_in_room === null ? '—' : stats.current_in_room}
          tone={(stats.current_in_room || 0) > 0 ? 'success' : 'default'}
          hint={!room?.supports_auto_sync ? 'Không hỗ trợ đồng bộ' : session.live_status === 'LIVE' ? 'Cập nhật theo webhook' : 'Phòng đã nghỉ'}
        />
        <StatCard
          label="Đã từng tham gia"
          value={!room || !room.supports_auto_sync || stats.total_unique_joined === null ? '—' : stats.total_unique_joined}
          hint={`${data.participant_sessions.length} lượt vào/rời phòng`}
        />
        <StatCard
          label="Đã đối chiếu học viên"
          value={!room || !room.supports_auto_sync || stats.matched_students_count === null ? '—' : `${stats.matched_students_count}/${stats.roster_size}`}
          tone={(stats.matched_students_count || 0) > 0 ? 'success' : 'default'}
          hint="Email / Tài khoản / Token LMS"
        />
        <StatCard
          label="Chưa xác định (UNKNOWN)"
          value={!room || !room.supports_auto_sync || stats.unknown_participants_count === null ? '—' : stats.unknown_participants_count}
          tone={(stats.unknown_participants_count || 0) > 0 ? 'warning' : 'default'}
          hint={(stats.unknown_participants_count || 0) > 0 ? 'Cần giảng viên xác nhận thủ công' : 'Tất cả đã rõ danh tính'}
        />
      </div>

      <Tabs
        active={activeTab}
        onChange={(id) => setActiveTab(id as VirtualTab)}
        tabs={[
          {
            id: 'live',
            label: 'Theo dõi trực tiếp & Lượt vào/ra',
            badge: data.participant_sessions.length || undefined,
          },
          {
            id: 'attendance',
            label: 'Bảng điểm danh tự động',
            badge:
              (stats.unknown_participants_count || 0) > 0
                ? `${stats.unknown_participants_count} cần duyệt`
                : data.attendance_rows.length,
          },
          {
            id: 'rules',
            label: 'Quy tắc điểm danh & Kết nối Provider',
          },
          {
            id: 'audit',
            label: 'Lịch sử điều chỉnh & Webhook Log',
            badge: history.adjustments.length || undefined,
          },
        ]}
      />

      {/* TAB 1: THEO DÕI TRỰC TIẾP & PHIÊN VÀO/RA */}
      {activeTab === 'live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {data.unknown_participants.length > 0 && (
            <Card
              title={`Người tham gia chưa xác định danh tính (${data.unknown_participants.length})`}
              actions={<Badge kind="virtualAttendance" value="UNKNOWN" />}
            >
              <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)', maxWidth: '75ch' }}>
                Hệ thống <strong>không tự động ghép học viên chỉ dựa trên tên hiển thị</strong> để tránh điểm danh nhầm.
                Vui lòng đối chiếu và gán thủ công cho học viên tương ứng trong lớp:
              </p>
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Tên hiển thị trong phòng</th>
                      <th>Email / Định danh</th>
                      <th>Giờ vào</th>
                      <th>Giờ rời</th>
                      <th className="num">Thời lượng</th>
                      <th className="actions">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unknown_participants.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.display_name}</strong>
                          <span className="t-sub">{u.device_info || u.source}</span>
                        </td>
                        <td>{u.participant_email || 'Không có email xác thực'}</td>
                        <td className="tabular-nums">{fmtTime(u.join_at)}</td>
                        <td className="tabular-nums">{u.leave_at ? fmtTime(u.leave_at) : <Tone tone="success">Đang trong phòng</Tone>}</td>
                        <td className="num tabular-nums">{fmtDurationSec(u.duration_sec)}</td>
                        <td className="actions">
                          {canManage && (
                            <Btn small variant="primary" onClick={() => setMapUnknownTarget(u)}>
                              Gán học viên
                            </Btn>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card
            title="Danh sách người đã vào và rời phòng trực tuyến"
            padded={false}
            actions={
              <div className="t-actions">
                <Btn small variant="ghost" onClick={() => loadData(false)}>
                  Làm mới trạng thái
                </Btn>
                {canManage && room?.supports_auto_sync && (
                  <>
                    <Btn small variant="secondary" onClick={() => setSimulateModalOpen(true)}>
                      + Mô phỏng sự kiện phòng họp
                    </Btn>
                    <Btn small variant="primary" onClick={handleSyncNow} loading={busyAction}>
                      Đồng bộ lại dữ liệu
                    </Btn>
                  </>
                )}
              </div>
            }
          >
            <div className="t-toolbar" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', justifyContent: 'space-between' }}>
              <div className="t-actions" style={{ flex: '1 1 360px' }}>
                <SearchInput value={liveQuery} onChange={setLiveQuery} placeholder="Tìm theo tên hiển thị, email, mã học viên…" />
                <select
                  className="t-input"
                  value={liveFilter}
                  onChange={(e) => setLiveFilter(e.target.value as 'ALL' | 'IN_ROOM' | 'MATCHED' | 'UNKNOWN')}
                  aria-label="Lọc danh sách phiên tham gia"
                >
                  <option value="ALL">Tất cả lượt vào/ra ({data.participant_sessions.length})</option>
                  <option value="IN_ROOM">Đang trong phòng ({stats.current_in_room || 0})</option>
                  <option value="MATCHED">Đã đối chiếu học viên</option>
                  <option value="UNKNOWN">Chưa xác định danh tính ({data.unknown_participants.length})</option>
                </select>
              </div>
              <div className="t-actions">
                <span className="t-sub tabular-nums">
                  Thời lượng buổi học đã diễn ra:{' '}
                  <strong>
                    <LiveElapsedDuration
                      liveStatus={session.live_status}
                      startedAt={session.live_started_at}
                      endedAt={session.live_ended_at}
                      parens={false}
                    />
                  </strong>
                </span>
              </div>
            </div>

            {filteredParticipantSessions.length === 0 ? (
              <EmptyState
                title="Chưa có lượt vào/ra nào khớp bộ lọc"
                text={
                  room?.supports_auto_sync
                    ? 'Khi học viên vào hoặc rời phòng Zoom / Google Meet, các phiên tham gia sẽ hiển thị trực tiếp tại đây.'
                    : 'Nền tảng liên kết ngoài không gửi dữ liệu người tham gia tự động.'
                }
              />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th className="num">Lần</th>
                      <th>Người tham gia trong phòng</th>
                      <th>Học viên đối chiếu</th>
                      <th>Phương thức khớp</th>
                      <th>Thời điểm vào</th>
                      <th>Thời điểm rời</th>
                      <th className="num">Thời lượng phiên</th>
                      <th>Trạng thái tạm thời</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParticipantSessions.map((p, idx) => {
                      const attRow = p.matched_student_id
                        ? data.attendance_rows.find((r) => r.student_id === p.matched_student_id)
                        : null;
                      return (
                        <tr key={p.id}>
                          <td className="num tabular-nums">{idx + 1}</td>
                          <td>
                            <strong>{p.display_name}</strong>
                            <span className="t-sub">{p.participant_email || 'Ẩn email'} · {p.device_info || p.source}</span>
                          </td>
                          <td>
                            {p.matched_student_id ? (
                              <>
                                <strong>{p.matched_student_name}</strong>
                                <span className="t-sub tabular-nums">{p.matched_student_code}</span>
                              </>
                            ) : (
                              <div className="t-actions">
                                <Badge kind="virtualAttendance" value="UNKNOWN" />
                                {canManage && (
                                  <Btn small variant="quiet" onClick={() => setMapUnknownTarget(p)}>
                                    Gán học viên
                                  </Btn>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="t-sub">
                              {p.identity_match_method === 'VERIFIED_EMAIL'
                                ? 'Email xác thực'
                                : p.identity_match_method === 'LMS_JOIN_TOKEN'
                                ? 'Token LMSPLUS'
                                : p.identity_match_method === 'REGISTRATION_ID'
                                ? 'Mã số học viên'
                                : p.identity_match_method === 'LINKED_PROVIDER_ACCOUNT'
                                ? 'Tài khoản liên kết'
                                : p.identity_match_method === 'INSTRUCTOR_MANUAL_MAP'
                                ? 'Giảng viên gán'
                                : 'Chưa đối chiếu'}
                            </span>
                          </td>
                          <td className="tabular-nums">{fmtTime(p.join_at)}</td>
                          <td className="tabular-nums">
                            {p.is_currently_in_room || !p.leave_at ? (
                              <Tone tone="success">Đang tham gia</Tone>
                            ) : (
                              fmtTime(p.leave_at)
                            )}
                          </td>
                          <td className="num tabular-nums">{fmtDurationSec(p.duration_sec)}</td>
                          <td>
                            {attRow ? (
                              <Badge kind="virtualAttendance" value={attRow.final_status} />
                            ) : (
                              <Badge kind="virtualAttendance" value="UNKNOWN" />
                            )}
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
      )}

      {/* TAB 2: BẢNG ĐIỂM DANH TỰ ĐỘNG SAU BUỔI HỌC */}
      {activeTab === 'attendance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="t-notice" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <strong>Quy tắc hợp nhất thời gian & tự động điểm danh:</strong>{' '}
              Các khoảng vào/ra trùng lặp trên nhiều thiết bị được hợp nhất (Interval Union) để không cộng trùng thời gian.
              Thời lượng tính điểm danh của buổi học: <strong className="tabular-nums">{data.rules.window_duration_minutes} phút</strong>
              {' '}· Tối thiểu đạt PRESENT: <strong className="tabular-nums">{data.rules.min_attendance_pct}%</strong> (tối thiểu{' '}
              <strong className="tabular-nums">{data.rules.min_duration_minutes} phút</strong>, trễ tối đa{' '}
              <strong className="tabular-nums">{data.rules.late_grace_minutes} phút</strong>).
            </div>
            <div className="t-actions">
              <Badge kind="syncStatus" value={session.attendance_sync_status} />
            </div>
          </div>

          <Card
            title="Bảng điểm danh tự động của lớp"
            padded={false}
            actions={
              <div className="t-actions">
                {canManage && room?.supports_auto_sync && (
                  <Btn small variant="secondary" onClick={handleSyncNow} loading={busyAction}>
                    Đồng bộ lại từ nền tảng
                  </Btn>
                )}
                <Btn small variant="secondary" onClick={handleExportCsv} loading={busyAction}>
                  Xuất báo cáo Excel (CSV)
                </Btn>
                {canManage && (
                  <Btn small variant="primary" onClick={handleConfirmFinal} loading={busyAction}>
                    Xác nhận & Chốt điểm danh
                  </Btn>
                )}
              </div>
            }
          >
            <div className="t-toolbar" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', justifyContent: 'space-between' }}>
              <div className="t-actions" style={{ flex: '1 1 380px' }}>
                <SearchInput value={attQuery} onChange={setAttQuery} placeholder="Tìm theo mã SV, họ tên, email…" />
                <select
                  className="t-input"
                  value={attStatusFilter}
                  onChange={(e) => setAttStatusFilter(e.target.value as 'ALL' | VirtualAttendanceStatus)}
                  aria-label="Lọc theo trạng thái điểm danh"
                >
                  <option value="ALL">Tất cả học viên ({data.attendance_rows.length})</option>
                  <option value="PRESENT">Đủ điều kiện - PRESENT ({statusCounts.PRESENT})</option>
                  <option value="LATE">Vào muộn - LATE ({statusCounts.LATE})</option>
                  <option value="PARTIAL">Chưa đủ giờ - PARTIAL ({statusCounts.PARTIAL})</option>
                  <option value="ABSENT">Vắng mặt - ABSENT ({statusCounts.ABSENT})</option>
                  <option value="EXCUSED">Có phép - EXCUSED ({statusCounts.EXCUSED})</option>
                  <option value="MANUAL_REVIEW">Cần xem xét - MANUAL_REVIEW ({statusCounts.MANUAL_REVIEW})</option>
                </select>
              </div>
              <div className="t-actions tabular-nums" style={{ fontSize: 13 }}>
                <Tone tone="success">PRESENT: {statusCounts.PRESENT}</Tone> ·{' '}
                <Tone tone="warning">LATE: {statusCounts.LATE}</Tone> ·{' '}
                <Tone tone="info">PARTIAL: {statusCounts.PARTIAL}</Tone> ·{' '}
                <Tone tone="danger">ABSENT: {statusCounts.ABSENT}</Tone>
              </div>
            </div>

            {filteredAttendanceRows.length === 0 ? (
              <EmptyState title="Không tìm thấy học viên phù hợp với bộ lọc" />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th className="num">STT</th>
                      <th>Mã SV</th>
                      <th>Họ tên</th>
                      <th>Thời gian vào</th>
                      <th>Thời gian ra</th>
                      <th className="num">Tổng thời gian</th>
                      <th className="num">Tỷ lệ</th>
                      <th>Trạng thái</th>
                      <th className="actions">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttendanceRows.map((row) => (
                      <tr key={row.student_id}>
                        <td className="num tabular-nums">{row.index}</td>
                        <td className="tabular-nums">{row.code}</td>
                        <td>
                          <strong>{row.full_name}</strong>
                          <span className="t-sub">{row.email}</span>
                          {row.adjustment_reason && (
                            <span className="t-sub">
                              <Tone tone="info">Đã điều chỉnh ({row.adjusted_by_name}): {row.adjustment_reason}</Tone>
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums">{row.first_join_at ? fmtTime(row.first_join_at) : '—'}</td>
                        <td className="tabular-nums">{row.last_leave_at ? fmtTime(row.last_leave_at) : row.first_join_at ? 'Đang tham gia' : '—'}</td>
                        <td className="num tabular-nums">
                          <strong>{fmtDurationSec(row.total_duration_sec)}</strong>
                          <span className="t-sub">{row.raw_sessions_count} lần vào/ra</span>
                        </td>
                        <td className="num tabular-nums">
                          <strong>{row.attendance_ratio_pct.toFixed(1)}%</strong>
                        </td>
                        <td>
                          <Badge kind="virtualAttendance" value={row.final_status} />
                          {row.is_manually_adjusted && row.final_status !== row.calculated_status && (
                            <span className="t-sub">Tự động: {row.calculated_status}</span>
                          )}
                        </td>
                        <td className="actions">
                          <div className="t-actions">
                            <Btn small variant="quiet" onClick={() => setSliceDetailTarget(row)}>
                              Chi tiết ({row.raw_sessions_count})
                            </Btn>
                            {canManage && data.rules.allow_instructor_adjustment && (
                              <Btn small variant="secondary" onClick={() => setAdjustTarget(row)}>
                                Điều chỉnh
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 3: QUY TẮC ĐIỂM DANH & KẾT NỐI PROVIDER */}
      {activeTab === 'rules' && (
        <RulesAndProvidersPanel
          sessionId={sessionId}
          rules={data.rules}
          providers={providers}
          canManage={canManage}
          onSaved={() => loadData(true)}
        />
      )}

      {/* TAB 4: LỊCH SỬ ĐIỀU CHỈNH & NHẬT KÝ ĐỒNG BỘ */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card title="Lịch sử điều chỉnh kết quả điểm danh & đối chiếu danh tính">
            {history.adjustments.length === 0 ? (
              <EmptyState
                title="Chưa có lịch sử điều chỉnh thủ công"
                text="Mọi thao tác điều chỉnh trạng thái điểm danh hoặc gán người tham gia UNKNOWN đều được lưu kiểm toán tại đây."
              />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Thời điểm</th>
                      <th>Học viên</th>
                      <th>Trạng thái trước</th>
                      <th>Trạng thái mới</th>
                      <th>Người thực hiện</th>
                      <th>Lý do điều chỉnh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.adjustments.map((adj) => (
                      <tr key={adj.id}>
                        <td className="tabular-nums">{fmtDateTime(adj.created_at)}</td>
                        <td>
                          <strong>{adj.student_name || 'Người tham gia'}</strong>
                          <span className="t-sub tabular-nums">{adj.student_code || adj.action_type}</span>
                        </td>
                        <td>{adj.previous_status ? <Badge kind="virtualAttendance" value={adj.previous_status} /> : '—'}</td>
                        <td><Badge kind="virtualAttendance" value={adj.new_status} /></td>
                        <td>{adj.actor_name}</td>
                        <td>{adj.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="t-grid-2">
            <Card title="Nhật ký tiến trình đồng bộ (Sync Jobs)">
              {history.sync_jobs.length === 0 ? (
                <EmptyState title="Chưa có tiến trình đồng bộ nào" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Nguồn kích hoạt</th>
                        <th>Trạng thái</th>
                        <th>Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.sync_jobs.map((job) => (
                        <tr key={job.id}>
                          <td className="tabular-nums">{fmtDateTime(job.started_at)}</td>
                          <td>{job.trigger_source}</td>
                          <td>
                            <Tone tone={job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'danger' : 'info'}>
                              {label('syncStatus', job.status)}
                            </Tone>
                          </td>
                          <td>
                            <span className="t-sub tabular-nums">
                              Khớp {job.matched_students || 0} HV · Chưa khớp: {job.unknown_participants || 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Sự kiện Webhook gốc từ Provider">
              {history.webhook_events.length === 0 ? (
                <EmptyState title="Chưa nhận sự kiện Webhook nào" />
              ) : (
                <div className="t-table-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Provider</th>
                        <th>Sự kiện</th>
                        <th>Chữ ký HMAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.webhook_events.map((ev) => (
                        <tr key={ev.id}>
                          <td className="tabular-nums">{fmtDateTime(ev.received_at)}</td>
                          <td><Badge kind="virtualProvider" value={ev.provider} /></td>
                          <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ev.event_type}</code></td>
                          <td>
                            {ev.signature_verified ? (
                              <Tone tone="success">Hợp lệ ({label('syncStatus', ev.processing_status)})</Tone>
                            ) : (
                              <Tone tone="danger">Không hợp lệ</Tone>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* MODAL 1: THIẾT LẬP / ĐỔI PHÒNG HỌP TRỰC TUYẾN */}
      {roomModalOpen && (
        <ConfigureVirtualRoomModal
          classId={classId}
          sessionId={sessionId}
          sessionTitle={session.title}
          currentRoom={room}
          onClose={() => setRoomModalOpen(false)}
          onSaved={() => {
            setRoomModalOpen(false);
            void loadData(true);
          }}
        />
      )}

      {/* MODAL 2: MÔ PHỎNG SỰ KIỆN WEBHOOK PHÒNG HỌC */}
      {simulateModalOpen && (
        <SimulateWebhookModal
          classId={classId}
          sessionId={sessionId}
          onClose={() => setSimulateModalOpen(false)}
          onSimulated={() => {
            setSimulateModalOpen(false);
            void loadData(true);
          }}
        />
      )}

      {/* MODAL 3: GÁN HỌC VIÊN CHO NGƯỜI THAM GIA UNKNOWN */}
      {mapUnknownTarget && (
        <MapUnknownParticipantModal
          classId={classId}
          sessionId={sessionId}
          participant={mapUnknownTarget}
          onClose={() => setMapUnknownTarget(null)}
          onMapped={() => {
            setMapUnknownTarget(null);
            void loadData(true);
          }}
        />
      )}

      {/* MODAL 4: XEM CHI TIẾT CÁC LẦN VÀO / RA & HỢP NHẤT KHOẢNG THỜI GIAN */}
      {sliceDetailTarget && (
        <ParticipantSlicesModal
          row={sliceDetailTarget}
          windowDurationMinutes={data.rules.window_duration_minutes}
          onClose={() => setSliceDetailTarget(null)}
        />
      )}

      {/* MODAL 5: ĐIỀU CHỈNH TRẠNG THÁI ĐIỂM DANH CÓ LƯU LÝ DO */}
      {adjustTarget && (
        <AdjustAttendanceModal
          sessionId={sessionId}
          row={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onAdjusted={() => {
            setAdjustTarget(null);
            void loadData(true);
          }}
        />
      )}
    </div>
  );
};
