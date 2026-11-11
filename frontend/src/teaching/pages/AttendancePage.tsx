import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AttendanceHistoryItem, AttendanceRow, AttendanceSheet, AttendanceStatus, QrState, SessionSummary, teachingApi,
} from '../api';
import {
  Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SearchInput, StatCard, Tone,
  errMsg, fmtDate, fmtDateTime, fmtTime, fmtWeekday, label, todayVn, useToast, useUnsavedWarning,
} from '../ui';

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; shortLabel: string }> = [
  { value: 'PRESENT', shortLabel: 'Có mặt' },
  { value: 'LATE', shortLabel: 'Đi muộn' },
  { value: 'EXCUSED_ABSENCE', shortLabel: 'Có phép' },
  { value: 'UNEXCUSED_ABSENCE', shortLabel: 'Vắng' },
];

type DraftEntry = { status: AttendanceStatus | null; note: string };

function pickInitialSession(sessions: SessionSummary[], requestedId: string | null): string | null {
  if (requestedId && sessions.some((s) => s.id === requestedId)) return requestedId;
  const active = sessions.filter((s) => s.session_status !== 'CANCELLED');
  if (active.length === 0) return sessions[0]?.id || null;
  const today = todayVn();
  const todaySession = active.find((s) => s.start_at.startsWith(today));
  if (todaySession) return todaySession.id;
  const needs = [...active].reverse().find((s) => s.attendance_state === 'NEEDS_ATTENDANCE');
  if (needs) return needs.id;
  const pastSaved = [...active].reverse().find((s) => s.attendance_state === 'SAVED' || s.attendance_state === 'LOCKED');
  return pastSaved?.id || active[0].id;
}

// ------------------------------------------------------------------ Modal Mã điểm danh 6 chữ số luân phiên

const CheckInCodeModal: React.FC<{
  sessionId: string;
  onClose: () => void;
  onRefreshSheet: () => void;
}> = ({ sessionId, onClose, onRefreshSheet }) => {
  const toast = useToast();
  const [state, setState] = useState<QrState | null>(null);
  const [duration, setDuration] = useState(15);
  const [lateAfter, setLateAfter] = useState(10);
  const [busy, setBusy] = useState(false);

  const fetchQr = useCallback(async () => {
    try {
      const r = await teachingApi.qr(sessionId);
      setState(r);
    } catch {
      // ignore transient poll error
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchQr();
    const timer = window.setInterval(fetchQr, 4000);
    return () => window.clearInterval(timer);
  }, [fetchQr]);

  const startCode = async () => {
    setBusy(true);
    try {
      await teachingApi.openQr(sessionId, { duration_minutes: duration, late_threshold_minutes: lateAfter });
      await fetchQr();
      toast({ tone: 'success', title: 'Đã mở phiên tự điểm danh bằng mã 6 số' });
    } catch (e) {
      toast({ tone: 'error', title: 'Không mở được mã điểm danh', detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const stopCode = async () => {
    setBusy(true);
    try {
      const r = await teachingApi.closeQr(sessionId);
      setState(r);
      onRefreshSheet();
      toast({ tone: 'info', title: 'Đã đóng phiên tự điểm danh' });
    } catch (e) {
      toast({ tone: 'error', title: 'Không đóng được mã điểm danh', detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Mã tự điểm danh dành cho học viên"
      onClose={() => {
        onRefreshSheet();
        onClose();
      }}
      width={520}
      footer={
        <>
          {state?.active && (
            <Btn variant="danger" onClick={stopCode} loading={busy}>
              Đóng phiên điểm danh
            </Btn>
          )}
          <Btn
            onClick={() => {
              onRefreshSheet();
              onClose();
            }}
          >
            Hoàn tất & Làm mới bảng
          </Btn>
        </>
      }
    >
      {state?.active ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Chiếu mã 6 chữ số bên dưới lên màn hình lớp học. Học viên đăng nhập vào mục <strong>Lớp của tôi</strong> và nhập mã để ghi nhận có mặt:
          </p>
          <div className="t-code-display" aria-live="polite">
            {state.code || '------'}
          </div>
          <div className="t-notice" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span className="tabular-nums">
              Mã tự đổi sau mỗi <strong>{state.rotation_interval_sec || 30} giây</strong> · Hết hạn lúc {fmtTime(state.valid_until)}
            </span>
            <span className="tabular-nums">
              Đã tự điểm danh: <strong>{state.checked_in_count || 0}</strong> học viên
            </span>
          </div>
        </div>
      ) : (
        <div className="t-form-grid">
          <p className="t-field--wide" style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Mở mã 6 chữ số có hiệu lực ngắn hạn và tự động đổi mã định kỳ để hạn chế điểm danh hộ.
          </p>
          <Field label="Thời gian mở mã (phút)">
            <input className="t-input tabular-nums" type="number" min={1} max={180} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 15))} />
          </Field>
          <Field label="Tính đi muộn sau (phút)" hint="Tính từ giờ bắt đầu buổi học">
            <input className="t-input tabular-nums" type="number" min={0} max={180} value={lateAfter} onChange={(e) => setLateAfter(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <div className="t-field--wide">
            <Btn variant="primary" onClick={startCode} loading={busy}>
              Phát mã tự điểm danh
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
};

// ------------------------------------------------------------------ Main AttendancePage

export const AttendancePage: React.FC = () => {
  const { classId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(sp.get('session'));
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NOT_MARKED' | AttendanceStatus>('ALL');
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<AttendanceHistoryItem[]>([]);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    setError(null);
    try {
      const res = await teachingApi.sessions(classId);
      setSessions(res.items);
      const chosen = pickInitialSession(res.items, sp.get('session'));
      setSelectedSessionId(chosen);
      if (chosen && chosen !== sp.get('session')) {
        const next = new URLSearchParams(sp);
        next.set('session', chosen);
        setSp(next, { replace: true });
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoadingSessions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const loadSheet = useCallback(async (sessionId: string) => {
    setLoadingSheet(true);
    setError(null);
    try {
      const data = await teachingApi.attendance(sessionId);
      setSheet(data);
      const init: Record<string, DraftEntry> = {};
      data.items.forEach((row) => {
        init[row.student_id] = { status: row.status, note: row.note || '' };
      });
      setDrafts(init);
    } catch (e) {
      setError(e);
    } finally {
      setLoadingSheet(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSessionId) void loadSheet(selectedSessionId);
  }, [selectedSessionId, loadSheet]);

  const changedIds = useMemo(() => {
    if (!sheet) return new Set<string>();
    const set = new Set<string>();
    sheet.items.forEach((r) => {
      const d = drafts[r.student_id];
      if (!d) return;
      if (d.status !== r.status || (d.note || '') !== (r.note || '')) set.add(r.student_id);
    });
    return set;
  }, [sheet, drafts]);

  const dirty = changedIds.size > 0;
  useUnsavedWarning(dirty);

  const liveCounts = useMemo(() => {
    const c = { total: sheet?.items.length || 0, PRESENT: 0, LATE: 0, EXCUSED_ABSENCE: 0, UNEXCUSED_ABSENCE: 0, NOT_MARKED: 0 };
    if (!sheet) return c;
    sheet.items.forEach((r) => {
      const st = drafts[r.student_id]?.status ?? r.status;
      if (!st) c.NOT_MARKED += 1;
      else c[st] += 1;
    });
    return c;
  }, [sheet, drafts]);

  const filteredRows: AttendanceRow[] = useMemo(() => {
    if (!sheet) return [];
    const kw = q.trim().toLowerCase();
    return sheet.items.filter((r) => {
      const st = drafts[r.student_id]?.status ?? r.status;
      if (statusFilter === 'NOT_MARKED' && st !== null) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'NOT_MARKED' && st !== statusFilter) return false;
      if (kw && !`${r.code} ${r.full_name}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [sheet, drafts, q, statusFilter]);

  const setRowStatus = (studentId: string, status: AttendanceStatus) => {
    setDrafts((prev) => ({
      ...prev,
      [studentId]: { status, note: prev[studentId]?.note || '' },
    }));
  };

  const setRowNote = (studentId: string, note: string) => {
    setDrafts((prev) => ({
      ...prev,
      [studentId]: { status: prev[studentId]?.status ?? null, note },
    }));
  };

  const markBulk = (status: AttendanceStatus, onlyUnmarked = false) => {
    if (!sheet) return;
    const targetIds = new Set(filteredRows.map((r) => r.student_id));
    setDrafts((prev) => {
      const next = { ...prev };
      sheet.items.forEach((r) => {
        if (!targetIds.has(r.student_id)) return;
        const cur = next[r.student_id] || { status: r.status, note: r.note || '' };
        if (onlyUnmarked && cur.status !== null) return;
        next[r.student_id] = { ...cur, status };
      });
      return next;
    });
  };

  const executeSave = async (changeReason?: string) => {
    if (!sheet || !selectedSessionId) return;
    const records = sheet.items
      .map((r) => {
        const d = drafts[r.student_id];
        return d?.status ? { student_id: r.student_id, status: d.status, note: d.note || '' } : null;
      })
      .filter((x): x is { student_id: string; status: AttendanceStatus; note: string } => x !== null);

    if (records.length === 0) {
      toast({ tone: 'error', title: 'Chưa chọn trạng thái điểm danh', detail: 'Hãy chọn trạng thái cho ít nhất một học viên hoặc bấm "Đánh dấu tất cả có mặt".' });
      return;
    }

    setSaving(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `att_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const res = await teachingApi.saveAttendance(selectedSessionId, {
        records,
        idempotency_key: idempotencyKey,
        change_reason: changeReason,
      });
      toast({
        tone: 'success',
        title: 'Đã lưu bảng điểm danh',
        detail: `Ghi mới ${res.created}, cập nhật ${res.changed}, giữ nguyên ${res.unchanged} học viên.`,
      });
      await loadSheet(selectedSessionId);
      const refreshedSessions = await teachingApi.sessions(classId);
      setSessions(refreshedSessions.items);
    } catch (e) {
      toast({ tone: 'error', title: 'Không lưu được điểm danh', detail: errMsg(e) });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (!sheet) return;
    if (sheet.capabilities.reason_required) {
      setReasonModalOpen(true);
      return;
    }
    void executeSave();
  };

  const handleSwitchSession = (nextId: string) => {
    if (nextId === selectedSessionId) return;
    if (dirty && !window.confirm('Bạn có thay đổi điểm danh chưa lưu. Chuyển sang buổi học khác và hủy các thay đổi này?')) {
      return;
    }
    setSelectedSessionId(nextId);
    const next = new URLSearchParams(sp);
    next.set('session', nextId);
    setSp(next, { replace: true });
  };

  const openHistory = async () => {
    if (!selectedSessionId) return;
    setHistoryOpen(true);
    try {
      const h = await teachingApi.attendanceHistory(selectedSessionId);
      setHistoryItems(h.items);
    } catch (e) {
      toast({ tone: 'error', title: 'Không tải được lịch sử chỉnh sửa', detail: errMsg(e) });
    }
  };

  if (loadingSessions) return <Loading label="Đang tải danh sách buổi học…" rows={4} />;
  if (error && !sheet) return <ErrorState error={error} onRetry={loadSessions} />;

  if (sessions.length === 0) {
    return (
      <div className="t-page">
        <PageHeader
          breadcrumb={<><Link to="/teaching/classes">Lớp học</Link><span>/</span><Link to={`/teaching/classes/${classId}`}>Chi tiết lớp</Link></>}
          title="Điểm danh lớp học"
        />
        <Card>
          <EmptyState
            title="Lớp học chưa có buổi học nào"
            text="Hãy thêm buổi học trong mục Lịch học của lớp trước khi thực hiện điểm danh."
            action={<Link className="t-btn t-btn--primary" to={`/teaching/classes/${classId}?tab=schedule`}>Tạo buổi học</Link>}
          />
        </Card>
      </div>
    );
  }

  const canEdit = Boolean(sheet?.capabilities.can_edit);
  const instructorNames = sheet?.class.staff.map((s) => s.full_name).join(', ') || '—';

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/teaching/classes">Lớp học</Link>
            <span>/</span>
            <Link to={`/teaching/classes/${classId}`}>{sheet?.class.code || 'Lớp học'}</Link>
            <span>/</span>
            <span>Điểm danh</span>
          </>
        }
        title={sheet ? `Điểm danh: ${sheet.class.title}` : 'Điểm danh buổi học'}
        subtitle={
          sheet && (
            <>
              {sheet.class.subject ? `${sheet.class.subject} · ` : ''}
              Giảng dạy: {instructorNames} · {label('delivery', sheet.class.delivery_mode)}
              {sheet.session.room_or_link ? ` (${sheet.session.room_or_link})` : ''}
            </>
          )
        }
        actions={
          <>
            {sheet && (
              <Btn small variant="ghost" onClick={openHistory}>
                Lịch sử chỉnh sửa
              </Btn>
            )}
            {sheet?.capabilities.can_use_qr && (
              <Btn variant="secondary" onClick={() => setQrOpen(true)}>
                Mã tự điểm danh (6 số)
              </Btn>
            )}
            {sheet?.capabilities.can_lock && (
              <Btn
                small
                onClick={async () => {
                  if (!selectedSessionId) return;
                  try {
                    await teachingApi.lockAttendance(selectedSessionId);
                    toast({ tone: 'success', title: 'Đã chốt sổ điểm danh buổi học' });
                    await loadSheet(selectedSessionId);
                  } catch (e) {
                    toast({ tone: 'error', title: 'Không chốt được điểm danh', detail: errMsg(e) });
                  }
                }}
              >
                Chốt điểm danh
              </Btn>
            )}
            {sheet?.capabilities.can_unlock && (
              <Btn small onClick={() => setUnlockModalOpen(true)}>
                Mở khóa điểm danh
              </Btn>
            )}
            {canEdit && (
              <Btn variant="primary" onClick={handleSaveClick} loading={saving}>
                Lưu điểm danh{dirty ? ` (${changedIds.size})` : ''}
              </Btn>
            )}
          </>
        }
      />

      {/* Bộ chọn buổi học + thông tin buổi */}
      <Card>
        <div className="t-toolbar" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', flex: '1 1 360px' }}>
            <label htmlFor="session-picker" style={{ fontWeight: 700, fontSize: 14 }}>
              Chọn buổi học:
            </label>
            <select
              id="session-picker"
              className="t-input tabular-nums"
              style={{ flex: '1 1 220px', minWidth: 0, maxWidth: '100%' }}
              value={selectedSessionId || ''}
              onChange={(e) => handleSwitchSession(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmtDate(s.start_at)} ({fmtTime(s.start_at)}–{fmtTime(s.end_at)}) · {s.title} — {label('attendanceState', s.attendance_state)}
                </option>
              ))}
            </select>
          </div>
          {sheet && (
            <div className="t-actions">
              {sheet.session.attendance_locked_at ? (
                <Badge kind="attendanceState" value="LOCKED" />
              ) : sheet.session.attendance_saved_at ? (
                <Badge kind="attendanceState" value="SAVED" />
              ) : (
                <Badge kind="attendanceState" value="NEEDS_ATTENDANCE" />
              )}
              {sheet.session.attendance_saved_at && (
                <span className="t-sub tabular-nums">Lưu gần nhất: {fmtDateTime(sheet.session.attendance_saved_at)}</span>
              )}
            </div>
          )}
        </div>
        {sheet && (
          <div style={{ marginTop: 12, fontSize: 14, color: 'var(--text-secondary)' }} className="tabular-nums">
            {fmtWeekday(sheet.session.start_at)}, ngày {fmtDate(sheet.session.start_at)} · Khung giờ {fmtTime(sheet.session.start_at)} – {fmtTime(sheet.session.end_at)}
            {sheet.capabilities.reason_required && canEdit && (
              <> · <Tone tone="warning">Đã qua 24 giờ sau buổi học — khi lưu cần nhập lý do cập nhật</Tone></>
            )}
          </div>
        )}
        {sheet?.capabilities.not_open_reason && (
          <div className="t-notice t-notice--warning" style={{ marginTop: 12 }}>
            {sheet.capabilities.not_open_reason}
          </div>
        )}
      </Card>

      {loadingSheet && <Loading label="Đang tải danh sách học viên…" rows={6} />}

      {!loadingSheet && sheet && (
        <>
          <div className="t-stats">
            <StatCard label="Tổng sĩ số" value={liveCounts.total} />
            <StatCard label="Có mặt" value={liveCounts.PRESENT} tone="success" />
            <StatCard label="Đi muộn" value={liveCounts.LATE} tone={liveCounts.LATE > 0 ? 'warning' : 'default'} />
            <StatCard label="Vắng có phép" value={liveCounts.EXCUSED_ABSENCE} />
            <StatCard label="Vắng không phép" value={liveCounts.UNEXCUSED_ABSENCE} tone={liveCounts.UNEXCUSED_ABSENCE > 0 ? 'danger' : 'default'} />
            <StatCard label="Chưa điểm danh" value={liveCounts.NOT_MARKED} tone={liveCounts.NOT_MARKED > 0 ? 'warning' : 'default'} />
          </div>

          <Card padded={false}>
            <div className="t-toolbar" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', justifyContent: 'space-between' }}>
              <div className="t-actions" style={{ flex: '1 1 380px' }}>
                <SearchInput value={q} onChange={setQ} placeholder="Tìm nhanh theo tên hoặc mã số…" />
                <select
                  className="t-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'NOT_MARKED' | AttendanceStatus)}
                  aria-label="Lọc trạng thái điểm danh"
                >
                  <option value="ALL">Tất cả học viên ({liveCounts.total})</option>
                  <option value="NOT_MARKED">Chưa điểm danh ({liveCounts.NOT_MARKED})</option>
                  <option value="PRESENT">Có mặt ({liveCounts.PRESENT})</option>
                  <option value="LATE">Đi muộn ({liveCounts.LATE})</option>
                  <option value="EXCUSED_ABSENCE">Vắng có phép ({liveCounts.EXCUSED_ABSENCE})</option>
                  <option value="UNEXCUSED_ABSENCE">Vắng không phép ({liveCounts.UNEXCUSED_ABSENCE})</option>
                </select>
              </div>
              {canEdit && (
                <div className="t-actions">
                  <Btn small variant="secondary" onClick={() => markBulk('PRESENT')}>
                    Đánh dấu tất cả có mặt
                  </Btn>
                  <Btn small variant="quiet" onClick={() => markBulk('PRESENT', true)} disabled={liveCounts.NOT_MARKED === 0}>
                    Điền có mặt cho ô trống
                  </Btn>
                  <Btn small variant="danger" onClick={() => markBulk('UNEXCUSED_ABSENCE')}>
                    Đánh dấu tất cả vắng
                  </Btn>
                </div>
              )}
            </div>

            {filteredRows.length === 0 ? (
              <EmptyState title="Không có học viên nào khớp bộ lọc" text="Thử xóa từ khóa tìm kiếm hoặc chuyển bộ lọc về Tất cả học viên." />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th className="num">STT</th>
                      <th>Mã số</th>
                      <th>Họ và tên</th>
                      <th>Trạng thái điểm danh</th>
                      <th>Ghi nhận</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const cur = drafts[row.student_id] || { status: row.status, note: row.note || '' };
                      const changed = changedIds.has(row.student_id);
                      return (
                        <tr key={row.student_id} className="t-att-row" data-changed={changed}>
                          <td className="num">{row.index}</td>
                          <td className="tabular-nums">{row.code}</td>
                          <td>
                            <strong>{row.full_name}</strong>
                          </td>
                          <td>
                            <div className="t-seg" role="group" aria-label={`Điểm danh ${row.full_name}`}>
                              {STATUS_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  disabled={!canEdit}
                                  data-status={opt.value}
                                  aria-pressed={cur.status === opt.value}
                                  onClick={() => setRowStatus(row.student_id, opt.value)}
                                >
                                  {opt.shortLabel}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="tabular-nums">
                            {row.check_in_at ? (
                              <span className="t-sub">
                                {fmtTime(row.check_in_at)}
                                {row.check_in_method === 'QR_CODE' ? ' · Tự nhập mã' : ''}
                              </span>
                            ) : (
                              <span className="t-sub">—</span>
                            )}
                          </td>
                          <td>
                            <input
                              className="t-input"
                              style={{ minWidth: 180 }}
                              value={cur.note}
                              maxLength={300}
                              disabled={!canEdit}
                              placeholder="Ghi chú (nếu có)…"
                              aria-label={`Ghi chú cho ${row.full_name}`}
                              onChange={(e) => setRowNote(row.student_id, e.target.value)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && (
              <div className="t-sticky-bar">
                <span style={{ fontSize: 14 }} className="tabular-nums">
                  {dirty ? (
                    <>Đang có <strong>{changedIds.size}</strong> dòng thay đổi chưa lưu.</>
                  ) : (
                    <>Đã đồng bộ với máy chủ · Có mặt <strong>{liveCounts.PRESENT}</strong>/{liveCounts.total}.</>
                  )}
                </span>
                <div className="t-actions">
                  {dirty && (
                    <Btn
                      variant="ghost"
                      disabled={saving}
                      onClick={() => {
                        const reset: Record<string, DraftEntry> = {};
                        sheet.items.forEach((r) => {
                          reset[r.student_id] = { status: r.status, note: r.note || '' };
                        });
                        setDrafts(reset);
                      }}
                    >
                      Hoàn tác thay đổi
                    </Btn>
                  )}
                  <Btn variant="primary" onClick={handleSaveClick} loading={saving}>
                    Lưu điểm danh
                  </Btn>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {reasonModalOpen && (
        <ConfirmDialog
          title="Cập nhật điểm danh sau 24 giờ"
          message="Buổi học đã kết thúc quá 24 giờ. Vui lòng nhập lý do chỉnh sửa để lưu vào lịch sử kiểm toán."
          confirmLabel="Lưu cập nhật"
          reasonLabel="Lý do chỉnh sửa điểm danh"
          reasonRequired
          onCancel={() => setReasonModalOpen(false)}
          onConfirm={async (reason) => {
            await executeSave(reason);
            setReasonModalOpen(false);
          }}
        />
      )}

      {unlockModalOpen && selectedSessionId && (
        <ConfirmDialog
          title="Mở khóa bảng điểm danh?"
          message="Sau khi mở khóa, giảng viên của lớp có thể chỉnh sửa lại dữ liệu điểm danh của buổi học này."
          confirmLabel="Mở khóa"
          reasonLabel="Lý do mở khóa"
          reasonRequired
          onCancel={() => setUnlockModalOpen(false)}
          onConfirm={async (reason) => {
            await teachingApi.unlockAttendance(selectedSessionId, reason);
            setUnlockModalOpen(false);
            toast({ tone: 'success', title: 'Đã mở khóa bảng điểm danh' });
            await loadSheet(selectedSessionId);
          }}
        />
      )}

      {qrOpen && selectedSessionId && (
        <CheckInCodeModal
          sessionId={selectedSessionId}
          onClose={() => setQrOpen(false)}
          onRefreshSheet={() => {
            void loadSheet(selectedSessionId);
          }}
        />
      )}

      {historyOpen && (
        <Modal title="Lịch sử chỉnh sửa điểm danh" onClose={() => setHistoryOpen(false)} width={720} footer={<Btn onClick={() => setHistoryOpen(false)}>Đóng</Btn>}>
          {historyItems.length === 0 ? (
            <EmptyState title="Chưa có lịch sử thay đổi" text="Các lần chỉnh sửa lại trạng thái điểm danh của học viên sẽ được ghi nhận tại đây." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Học viên</th>
                    <th>Thay đổi</th>
                    <th>Người sửa</th>
                    <th>Lý do / Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {historyItems.map((h) => (
                    <tr key={h.id}>
                      <td className="tabular-nums">{fmtDateTime(h.changed_at)}</td>
                      <td>
                        <strong>{h.student_name}</strong>
                        <span className="t-sub tabular-nums">{h.student_code}</span>
                      </td>
                      <td>
                        {h.previous_status ? label('attendance', h.previous_status) : 'Chưa điểm danh'} →{' '}
                        <strong>{label('attendance', h.new_status)}</strong>
                      </td>
                      <td>{h.changed_by_name || 'Hệ thống'}</td>
                      <td>{h.change_reason || h.new_note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
