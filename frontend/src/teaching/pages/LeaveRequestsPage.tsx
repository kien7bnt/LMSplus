/**
 * Luồng Đơn xin nghỉ phép hoàn chỉnh:
 * - Học viên: Gửi đơn theo lớp/buổi học + xem trạng thái + hủy đơn đang chờ duyệt.
 * - Giảng viên / Giáo vụ: Xem danh sách theo Data Scope, duyệt / từ chối có ghi chú,
 *   và đồng bộ Vắng có phép (không ghi đè nếu đã điểm danh Có mặt / Đi muộn).
 */
import React, { useEffect, useState } from 'react';
import {
  LearnClass,
  LeaveReasonCategory,
  LeaveRequestItem,
  masterApi,
  teachingApi,
} from '../api';
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
  errMsg,
  fmtDateTime,
  useAsync,
  useToast,
} from '../ui';

export const StaffLeaveRequestsPage: React.FC = () => (
  <div className="t-page">
    <PageHeader
      title="Xét duyệt đơn xin nghỉ phép"
      subtitle="Đơn được duyệt sẽ tự động cập nhật trạng thái Vắng có phép cho buổi học nếu học viên chưa có điểm danh Có mặt hoặc Đi muộn."
    />
    <ClassLeaveRequestsPanel />
  </div>
);

export const ClassLeaveRequestsPanel: React.FC<{ classId?: string }> = ({ classId }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const [statusFilter, setStatusFilter] = useState('');
  const list = useAsync(() => masterApi.listStaffLeaveRequests({ class_id: classId, status: statusFilter }), [classId, statusFilter]);
  const [reviewing, setReviewing] = useState<{ item: LeaveRequestItem; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewing) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await masterApi.reviewLeaveRequest(reviewing.item.id, {
        decision: reviewing.decision,
        review_note: reviewNote.trim(),
      });
      const syncMsg =
        res.attendance_sync === 'SYNCED_EXCUSED'
          ? 'Đã đồng bộ điểm danh: Vắng có phép.'
          : res.attendance_sync === 'PRESERVED_PRESENT_OR_LATE'
            ? 'Giữ nguyên trạng thái Có mặt / Đi muộn đã điểm danh trước đó.'
            : 'Không có buổi học cụ thể để đồng bộ.';
      push(
        reviewing.decision === 'APPROVED' ? 'Đã duyệt đơn xin nghỉ phép' : 'Đã từ chối đơn xin nghỉ phép',
        syncMsg,
        'success'
      );
      setReviewing(null);
      setReviewNote('');
      list.reload();
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Danh sách đơn xin nghỉ phép"
      actions={
        <select
          className="t-input t-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Lọc trạng thái đơn xin nghỉ"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="PENDING">Chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Từ chối</option>
          <option value="CANCELLED">Đã hủy</option>
        </select>
      }
    >
      {list.loading && <Loading rows={4} />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title="Không có đơn xin nghỉ nào" text="Khi học viên gửi đơn xin nghỉ, yêu cầu sẽ hiển thị tại đây để xét duyệt." />
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Lớp & Buổi học</th>
                <th>Lý do nghỉ</th>
                <th>Trạng thái</th>
                <th>Xử lý</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.student_name}</strong>
                    <div className="t-muted t-small"><code>{item.student_code}</code></div>
                  </td>
                  <td>
                    <div><code>{item.class_code}</code> · {item.class_title}</div>
                    {item.session_title && (
                      <div className="t-small t-muted">
                        {item.session_title} ({fmtDateTime(item.scheduled_start_at)})
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge kind="leaveReason" value={item.reason_category} />
                    <div style={{ marginTop: 4 }}>{item.reason}</div>
                    {item.makeup_class_requested && <div className="t-small t-muted">Đề xuất học bù: {item.makeup_class_requested}</div>}
                    {item.evidence_url && (
                      <a href={item.evidence_url} target="_blank" rel="noopener noreferrer" className="t-small t-row-link">
                        Xem minh chứng
                      </a>
                    )}
                  </td>
                  <td><Badge kind="leaveStatus" value={item.status} /></td>
                  <td className="t-small">
                    {item.reviewed_by_name ? (
                      <>
                        <div>{item.reviewed_by_name}</div>
                        <div className="t-muted">{fmtDateTime(item.reviewed_at)}</div>
                        {item.review_note && <div>Ghi chú: {item.review_note}</div>}
                      </>
                    ) : 'Chờ xử lý'}
                  </td>
                  <td className="t-right">
                    {item.status === 'PENDING' && (
                      <div className="t-actions">
                        <Btn
                          small
                          variant="primary"
                          onClick={() => { setReviewing({ item, decision: 'APPROVED' }); setReviewNote(''); setErr(null); }}
                        >
                          Duyệt
                        </Btn>
                        <Btn
                          small
                          variant="danger"
                          onClick={() => { setReviewing({ item, decision: 'REJECTED' }); setReviewNote(''); setErr(null); }}
                        >
                          Từ chối
                        </Btn>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewing && (
        <Modal
          title={reviewing.decision === 'APPROVED' ? 'Duyệt đơn xin nghỉ phép' : 'Từ chối đơn xin nghỉ phép'}
          onClose={() => setReviewing(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setReviewing(null)} disabled={busy}>Hủy</Btn>
              <Btn variant={reviewing.decision === 'APPROVED' ? 'primary' : 'danger'} type="submit" form="leave-review-form" loading={busy}>
                {reviewing.decision === 'APPROVED' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}
              </Btn>
            </>
          }
        >
          <form id="leave-review-form" onSubmit={submitReview}>
            <p>
              Học viên: <strong>{reviewing.item.student_name}</strong> ({reviewing.item.student_code})
              {reviewing.item.session_title ? ` · Buổi: ${reviewing.item.session_title}` : ''}
            </p>
            <Field label={reviewing.decision === 'REJECTED' ? 'Lý do từ chối' : 'Ghi chú phản hồi (không bắt buộc)'} required={reviewing.decision === 'REJECTED'} wide>
              <textarea
                className="t-input"
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                required={reviewing.decision === 'REJECTED'}
              />
            </Field>
            {err && <p className="t-field__error" role="alert">{err}</p>}
          </form>
        </Modal>
      )}
    </Card>
  );
};

export const StudentLeaveRequestsPage: React.FC<{ fixedClassId?: string }> = ({ fixedClassId }) => {
  const toast = useToast();
  const push = (title: string, detail = '', tone: 'success' | 'error' | 'info' = 'info') => toast({ title, detail: detail || undefined, tone });
  const list = useAsync(() => masterApi.listStudentLeaveRequests(), []);
  const classesRes = useAsync(() => teachingApi.learnClasses(), []);
  const [creating, setCreating] = useState(false);

  const visibleItems = (list.data?.items || []).filter((x) => !fixedClassId || x.class_id === fixedClassId);

  const content = (
    <Card
      title="Đơn xin nghỉ phép của tôi"
      actions={
        <Btn small variant="primary" onClick={() => setCreating(true)}>
          + Gửi đơn xin nghỉ
        </Btn>
      }
    >
      {list.loading && <Loading rows={3} />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && visibleItems.length === 0 && (
        <EmptyState
          title="Chưa có đơn xin nghỉ phép nào"
          text="Khi có lý do bất khả kháng không thể dự buổi học, hãy gửi đơn trước giờ học để giảng viên xem xét."
          action={<Btn variant="primary" onClick={() => setCreating(true)}>Gửi đơn xin nghỉ</Btn>}
        />
      )}
      {visibleItems.length > 0 && (
        <div className="t-list">
          {visibleItems.map((r) => (
            <div key={r.id} className="t-list-item">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{r.class_code} · {r.class_title}</strong>
                  <Badge kind="leaveStatus" value={r.status} />
                  <Badge kind="leaveReason" value={r.reason_category} />
                </div>
                {r.session_title && (
                  <div className="t-small t-muted">Buổi: {r.session_title} ({fmtDateTime(r.scheduled_start_at)})</div>
                )}
                <div style={{ marginTop: 4 }}>{r.reason}</div>
                {r.review_note && <div className="t-small t-muted">Phản hồi giảng viên: {r.review_note}</div>}
              </div>
              {r.status === 'PENDING' && (
                <Btn
                  small
                  variant="ghost"
                  onClick={async () => {
                    await masterApi.cancelStudentLeaveRequest(r.id);
                    push('Đã hủy đơn xin nghỉ phép', '', 'info');
                    list.reload();
                  }}
                >
                  Hủy đơn
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <StudentCreateLeaveModal
          classes={classesRes.data?.items || []}
          initialClassId={fixedClassId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            push('Đã gửi đơn xin nghỉ phép', 'Đơn đang chờ giảng viên/giáo vụ duyệt.', 'success');
            list.reload();
          }}
        />
      )}
    </Card>
  );

  if (fixedClassId) return content;

  return (
    <div className="t-page">
      <PageHeader
        title="Xin nghỉ phép & Theo dõi đơn"
        subtitle="Gửi đơn xin nghỉ phép theo lớp môn học và theo dõi kết quả phản hồi của giảng viên."
      />
      {content}
    </div>
  );
};

const StudentCreateLeaveModal: React.FC<{
  classes: LearnClass[];
  initialClassId?: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ classes, initialClassId, onClose, onCreated }) => {
  const [classId, setClassId] = useState(initialClassId || classes[0]?.id || '');
  const [sessionId, setSessionId] = useState('');
  const [reasonCategory, setReasonCategory] = useState<LeaveReasonCategory>('ILLNESS');
  const [reason, setReason] = useState('');
  const [makeupNote, setMakeupNote] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedClassId = classId || classes[0]?.id || '';
  const classDetail = useAsync(() => (selectedClassId ? teachingApi.learnClass(selectedClassId) : Promise.resolve(null)), [selectedClassId]);
  const upcoming = classDetail.data?.upcoming_sessions || [];

  useEffect(() => {
    setSessionId('');
  }, [selectedClassId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId) {
      setErr('Vui lòng chọn lớp học.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await masterApi.createStudentLeaveRequest({
        class_id: selectedClassId,
        session_id: sessionId || null,
        reason_category: reasonCategory,
        reason: reason.trim(),
        makeup_class_requested: makeupNote.trim(),
        evidence_url: evidenceUrl.trim() || undefined,
      });
      onCreated();
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Gửi đơn xin nghỉ phép"
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="student-leave-form" loading={busy} disabled={classes.length === 0}>
            Gửi đơn
          </Btn>
        </>
      }
    >
      <form id="student-leave-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Lớp môn học" required wide>
          <select className="t-input" value={selectedClassId} onChange={(e) => setClassId(e.target.value)} disabled={Boolean(initialClassId)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>[{c.code}] {c.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Buổi học xin nghỉ (nếu chọn cụ thể)" wide>
          <select className="t-input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">-- Không gắn buổi cụ thể / Nghỉ theo lý do chung --</option>
            {upcoming.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} — {fmtDateTime(s.start_at)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nhóm lý do">
          <select className="t-input" value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as LeaveReasonCategory)}>
            <option value="ILLNESS">Ốm đau / Y tế</option>
            <option value="FAMILY">Việc gia đình</option>
            <option value="WORK">Công tác / Làm việc</option>
            <option value="ACADEMIC_CONFLICT">Trùng lịch học / thi</option>
            <option value="OTHER">Lý do khác</option>
          </select>
        </Field>
        <Field label="Link minh chứng (nếu có)">
          <input type="url" className="t-input" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://..." />
        </Field>
        <Field label="Lý do chi tiết" required wide>
          <textarea className="t-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <Field label="Đề xuất học bù (nếu có)" wide>
          <input className="t-input" value={makeupNote} onChange={(e) => setMakeupNote(e.target.value)} placeholder="VD: Xin học bù cùng lớp K26-T5B vào thứ Sáu" />
        </Field>
        {err && <p className="t-field__error t-field--wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
};
