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
import { IconChart, IconVideo } from '../components/Icons';

// ------------------------------------------------------------------ Tab 2: Học viên & Đội ngũ giảng dạy

export const StudentsTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DROPPED' | 'ALL'>('ACTIVE');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | EnrollmentSource>('ALL');
  const [enrollSource, setEnrollSource] = useState<EnrollmentSource>('ACADEMIC_ASSIGNED');
  const [addingOpen, setAddingOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [pickedStudentId, setPickedStudentId] = useState('');
  const [lastImportResult, setLastImportResult] = useState<EnrollResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; name: string } | null>(null);

  const [staffOpen, setStaffOpen] = useState(false);
  const [staffRole, setStaffRole] = useState<'CO_INSTRUCTOR' | 'TEACHING_ASSISTANT'>('TEACHING_ASSISTANT');
  const [staffUserId, setStaffUserId] = useState('');
  const [staffCanMaterials, setStaffCanMaterials] = useState(true);
  const [staffCanAttendance, setStaffCanAttendance] = useState(true);

  const rosterReq = useAsync(() => teachingApi.students(cls.id, { status }), [cls.id, status]);
  const videoAnalyticsReq = useAsync(() => masterApi.getClassVideoAnalytics(cls.id), [cls.id]);
  const candidateStudentsReq = useAsync(
    () => (addingOpen ? teachingApi.users('STUDENT') : Promise.resolve({ items: [] })),
    [addingOpen]
  );
  const candidateStaffReq = useAsync(
    () =>
      staffOpen
        ? teachingApi.users(staffRole === 'TEACHING_ASSISTANT' ? 'TEACHING_ASSISTANT' : 'INSTRUCTOR')
        : Promise.resolve({ items: [] }),
    [staffOpen, staffRole]
  );

  const items = (rosterReq.data?.items || []).filter((s) => {
    const matchSource = sourceFilter === 'ALL' || (s.enrollment_source || 'ACADEMIC_ASSIGNED') === sourceFilter;
    const matchQ = !q.trim() ? true : `${s.code} ${s.full_name} ${s.email}`.toLowerCase().includes(q.trim().toLowerCase());
    return matchSource && matchQ;
  });

  const handleAddSingle = async () => {
    if (!pickedStudentId) return;
    setBusy(true);
    try {
      const r = await teachingApi.addStudents(cls.id, [pickedStudentId], enrollSource);
      setLastImportResult(r);
      setPickedStudentId('');
      toast({ tone: 'success', title: 'Đã cập nhật danh sách học viên' });
      rosterReq.reload();
      onChanged();
    } catch (e) {
      toast({ tone: 'error', title: 'Không thêm được học viên', detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkImport = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const r = await teachingApi.importStudents(cls.id, importText, enrollSource);
      setLastImportResult(r);
      setImportText('');
      toast({
        tone: 'success',
        title: `Đã thêm ${r.added.length + r.reactivated.length} học viên`,
        detail: r.not_found.length ? `Không tìm thấy ${r.not_found.length} mã/email.` : undefined,
      });
      rosterReq.reload();
      onChanged();
    } catch (e) {
      toast({ tone: 'error', title: 'Không nhập được danh sách', detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {!cls.capabilities.can_manage_roster && (
        <div className="t-notice">
          Danh sách học viên của lớp được đồng bộ và quản lý bởi bộ phận Giáo vụ. Bạn có thể tra cứu, xem chuyên cần và theo dõi tiến độ từng học viên.
        </div>
      )}

      <Card
        title="Danh sách học viên"
        padded={false}
        actions={
          cls.capabilities.can_manage_roster && (
            <Btn variant="primary" small onClick={() => { setAddingOpen(true); setLastImportResult(null); }}>
              + Thêm / Nhập học viên
            </Btn>
          )
        }
      >
        <div className="t-toolbar" style={{ padding: '0 24px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <SearchInput value={q} onChange={setQ} placeholder="Tìm theo họ tên, mã số, email…" />
          <select className="t-input" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'ALL' | EnrollmentSource)} aria-label="Nguồn ghi danh">
            <option value="ALL">Tất cả nguồn</option>
            <option value="COHORT_SYNCED">Đồng bộ từ Lớp khóa học</option>
            <option value="ACADEMIC_ASSIGNED">Giáo vụ phân công</option>
            <option value="MAKEUP">Học bù</option>
            <option value="RETAKE">Học lại</option>
            <option value="SUPPLEMENTAL">Bổ sung riêng</option>
          </select>
          <select className="t-input" value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DROPPED' | 'ALL')} aria-label="Trạng thái ghi danh">
            <option value="ACTIVE">Đang theo học</option>
            <option value="DROPPED">Đã rút lớp</option>
            <option value="ALL">Tất cả</option>
          </select>
        </div>

        {rosterReq.loading && <Loading rows={4} />}
        {rosterReq.error && <ErrorState error={rosterReq.error} onRetry={rosterReq.reload} />}
        {!rosterReq.loading && !rosterReq.error && (
          items.length === 0 ? (
            <EmptyState title="Chưa có học viên trong danh sách lọc" text="Thử đổi bộ lọc hoặc thêm học viên mới vào lớp." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th className="num">STT</th>
                    <th>Mã số</th>
                    <th>Họ và tên</th>
                    <th>Nguồn ghi danh</th>
                    <th>Email</th>
                    <th className="num">Có mặt / Vắng</th>
                    <th className="num">Chuyên cần</th>
                    <th>Tiến độ bài học</th>
                    {cls.capabilities.can_manage_roster && <th className="actions">Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((st, idx) => (
                    <tr key={st.id}>
                      <td className="num">{idx + 1}</td>
                      <td className="tabular-nums">{st.code}</td>
                      <td>
                        <strong>{st.full_name}</strong>
                        {st.status === 'DROPPED' && (
                          <span className="t-sub">
                            <Tone tone="muted">Đã rút lớp ({fmtDate(st.dropped_at)})</Tone>
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge kind="enrollmentSource" value={st.enrollment_source || 'ACADEMIC_ASSIGNED'} />
                      </td>
                      <td>{st.email}</td>
                      <td className="num">
                        {st.attendance.present + st.attendance.late} / {st.attendance.absent + st.attendance.excused}
                      </td>
                      <td className="num">
                        {st.attendance.rate !== null && st.attendance.rate < 80 ? (
                          <Tone tone="danger">{fmtPct(st.attendance.rate)}</Tone>
                        ) : (
                          fmtPct(st.attendance.rate)
                        )}
                      </td>
                      <td>
                        {st.progress.total > 0 ? (
                          <ProgressMeter value={st.progress.completed} total={st.progress.total} label={`Tiến độ ${st.full_name}`} />
                        ) : (
                          <span className="t-sub">Chưa có bài xuất bản</span>
                        )}
                      </td>
                      {cls.capabilities.can_manage_roster && (
                        <td className="actions">
                          {st.status === 'ACTIVE' && (
                            <Btn small variant="danger" onClick={() => setDropTarget({ id: st.id, name: st.full_name })}>
                              Rút khỏi lớp
                            </Btn>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>

      <Card
        title="Đội ngũ giảng dạy & Trợ giảng"
        actions={
          cls.capabilities.can_manage_staff && (
            <Btn small onClick={() => setStaffOpen(true)}>
              + Phân công giảng dạy / trợ giảng
            </Btn>
          )
        }
      >
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Vai trò trong lớp</th>
                <th>Quyền được cấp</th>
                {cls.capabilities.can_manage_staff && <th className="actions">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {cls.staff.map((m) => (
                <tr key={m.assignment_id}>
                  <td>
                    <strong>{m.full_name}</strong>
                    <span className="t-sub tabular-nums">{m.code}</span>
                  </td>
                  <td>{m.email}</td>
                  <td>
                    <Badge kind="staffRole" value={m.staff_role} />
                  </td>
                  <td>
                    <span className="t-sub">
                      {[
                        m.permissions.can_take_attendance ? 'Điểm danh buổi học' : null,
                        m.permissions.can_manage_materials ? 'Soạn nháp học liệu' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Xem thông tin lớp'}
                    </span>
                  </td>
                  {cls.capabilities.can_manage_staff && (
                    <td className="actions">
                      {m.staff_role !== 'PRIMARY_INSTRUCTOR' && (
                        <Btn
                          small
                          variant="quiet"
                          onClick={async () => {
                            try {
                              await teachingApi.removeStaff(cls.id, m.assignment_id);
                              toast({ tone: 'success', title: `Đã gỡ phân công ${m.full_name}` });
                              onChanged();
                            } catch (e) {
                              toast({ tone: 'error', title: 'Không gỡ được phân công', detail: errMsg(e) });
                            }
                          }}
                        >
                          Gỡ
                        </Btn>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Tiến độ xem Video (STRICT)"
        actions={
          <Btn small variant="ghost" onClick={() => videoAnalyticsReq.reload()}>
            Làm mới
          </Btn>
        }
      >
        {videoAnalyticsReq.loading && <Loading rows={3} />}
        {videoAnalyticsReq.error && <ErrorState error={videoAnalyticsReq.error} onRetry={videoAnalyticsReq.reload} />}
        {videoAnalyticsReq.data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="t-stats">
              <StatCard label="Bản ghi theo dõi" value={videoAnalyticsReq.data.summary.records_count} />
              <StatCard label="Video hoàn thành" value={videoAnalyticsReq.data.summary.completed_count} tone="success" />
              <StatCard label="Trung bình đã xem" value={fmtPct(videoAnalyticsReq.data.summary.avg_watch_pct)} />
              <StatCard
                label="Cảnh báo tua / ẩn tab"
                value={videoAnalyticsReq.data.summary.total_tamper_rejected}
                tone={videoAnalyticsReq.data.summary.total_tamper_rejected > 0 ? 'warning' : 'default'}
              />
            </div>
            {videoAnalyticsReq.data.items.length === 0 ? (
              <EmptyState title="Chưa có dữ liệu xem video STRICT" text="Khi học viên xem video bài giảng trong lớp, các khoảng thời gian thực xem sẽ được ghi nhận tại đây." />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Học viên</th>
                      <th>Bài học</th>
                      <th className="num">Thực xem / Thời lượng</th>
                      <th className="num">Tỷ lệ %</th>
                      <th className="num">Chặn tua</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videoAnalyticsReq.data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.student_name}</strong>
                          <span className="t-sub tabular-nums">{row.student_code}</span>
                        </td>
                        <td>{row.lesson_title}</td>
                        <td className="num tabular-nums">
                          {Math.round(row.unique_watched_sec)}s / {Math.round(row.duration_sec)}s
                        </td>
                        <td className="num tabular-nums">{fmtPct(row.watch_pct)}</td>
                        <td className="num tabular-nums">
                          {row.tamper_attempts_count > 0 ? <Tone tone="warning">{row.tamper_attempts_count}</Tone> : '0'}
                        </td>
                        <td>
                          {row.is_completed ? <Tone tone="success">Đạt ngưỡng</Tone> : <Tone tone="info">Đang xem</Tone>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      {addingOpen && (
        <Modal
          title="Thêm hoặc nhập danh sách học viên"
          onClose={() => setAddingOpen(false)}
          width={640}
          footer={<Btn onClick={() => setAddingOpen(false)}>Đóng</Btn>}
        >
          <Field
            label="Nguồn ghi danh vào lớp môn học"
            hint="Học bù / Học lại / Bổ sung sẽ được giữ nguyên khi đồng bộ danh sách từ Lớp khóa học"
          >
            <select
              className="t-input"
              value={enrollSource}
              onChange={(e) => setEnrollSource(e.target.value as EnrollmentSource)}
            >
              <option value="ACADEMIC_ASSIGNED">Giáo vụ phân công</option>
              <option value="MAKEUP">Học viên học bù</option>
              <option value="RETAKE">Học viên học lại</option>
              <option value="SUPPLEMENTAL">Bổ sung riêng vào lớp môn</option>
            </select>
          </Field>
          <Field label="Chọn nhanh từ danh sách học viên hệ thống">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="t-input"
                style={{ flex: '1 1 240px', minWidth: 0 }}
                value={pickedStudentId}
                onChange={(e) => setPickedStudentId(e.target.value)}
              >
                <option value="">— Chọn học viên —</option>
                {(candidateStudentsReq.data?.items || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.full_name} ({u.email})
                  </option>
                ))}
              </select>
              <Btn variant="primary" onClick={handleAddSingle} loading={busy} disabled={!pickedStudentId}>
                Thêm
              </Btn>
            </div>
          </Field>

          <Field
            label="Hoặc tải tệp CSV / dán danh sách mã học viên hoặc email (mỗi dòng 1 dòng hoặc cách nhau bởi dấu phẩy)"
            hint="Hỗ trợ CSV cột code/email hoặc mỗi dòng một mã học viên / email (VD: HS50101, minhanh.hs@lmsplus.edu.vn)"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="t-btn t-btn--small" style={{ cursor: 'pointer', minHeight: 44 }}>
                  Tải tệp CSV / TXT
                  <input
                    type="file"
                    accept=".csv,.txt"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const txt = await f.text();
                      setImportText(txt);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                {importText.trim() && (() => {
                  const existingKeys = new Set((rosterReq.data?.items || []).flatMap((u) => [u.code?.toLowerCase(), u.email?.toLowerCase()].filter(Boolean)));
                  const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                  const firstCols = lines[0] ? lines[0].split(/[,\t;]+/).map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase()) : [];
                  const codeCol = firstCols.findIndex((h) => ['code', 'student_code', 'ma', 'ma_hv'].includes(h));
                  const emailCol = firstCols.findIndex((h) => ['email'].includes(h));
                  const rawTokens =
                    lines.length > 1 && (codeCol >= 0 || emailCol >= 0)
                      ? lines.slice(1).map((l) => {
                          const cols = l.split(/[,\t;]+/).map((c) => c.trim().replace(/^"|"$/g, ''));
                          return (codeCol >= 0 ? cols[codeCol] : '') || (emailCol >= 0 ? cols[emailCol] : '');
                        }).filter(Boolean)
                      : importText.split(/[\r\n,;\t]+/).map((p) => p.trim().replace(/^"|"$/g, '')).filter((s) => s && !/^(code|student_code|email|ma_hv|stt)$/i.test(s));
                  const seen = new Set<string>();
                  let dups = 0;
                  let alreadyActive = 0;
                  const ready: string[] = [];
                  for (const tk of rawTokens) {
                    const low = tk.toLowerCase();
                    if (seen.has(low)) { dups++; continue; }
                    seen.add(low);
                    if (existingKeys.has(low)) alreadyActive++;
                    else ready.push(tk);
                  }
                  return (
                    <span className="t-small t-muted tabular-nums">
                      Xem trước: <strong>{ready.length}</strong> hợp lệ sẵn sàng · <strong>{alreadyActive}</strong> đã có trong lớp · <strong>{dups}</strong> trùng dòng
                    </span>
                  );
                })()}
              </div>
              <textarea
                className="t-input"
                rows={5}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'code,full_name\nHS50201,Nguyễn An\nHS50202,Trần Bình'}
              />
            </div>
          </Field>
          <div>
            <Btn variant="secondary" onClick={handleBulkImport} loading={busy} disabled={!importText.trim()}>
              Nhập danh sách
            </Btn>
          </div>

          {lastImportResult && (
            <div className="m-semantic-notice">
              <div>Đã thêm mới: <strong>{lastImportResult.added.length}</strong> · Kích hoạt lại: <strong>{lastImportResult.reactivated.length}</strong> · Đã có sẵn: <strong>{lastImportResult.already_enrolled.length}</strong></div>
              {lastImportResult.not_found.length > 0 && (
                <ul className="t-small" style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--status-danger)' }}>
                  {lastImportResult.not_found.map((nf, idx) => (
                    <li key={idx}>Dòng không khớp tài khoản: <code>{nf}</code></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal>
      )}

      {staffOpen && (
        <Modal
          title="Phân công giảng viên / trợ giảng"
          onClose={() => setStaffOpen(false)}
          width={520}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setStaffOpen(false)}>Hủy</Btn>
              <Btn
                variant="primary"
                disabled={!staffUserId}
                onClick={async () => {
                  try {
                    await teachingApi.addStaff(cls.id, {
                      user_id: staffUserId,
                      staff_role: staffRole,
                      permissions: {
                        can_manage_materials: staffCanMaterials,
                        can_take_attendance: staffCanAttendance,
                      },
                    });
                    toast({ tone: 'success', title: 'Đã phân công thành viên giảng dạy' });
                    setStaffOpen(false);
                    setStaffUserId('');
                    onChanged();
                  } catch (e) {
                    toast({ tone: 'error', title: 'Không thể phân công', detail: errMsg(e) });
                  }
                }}
              >
                Lưu phân công
              </Btn>
            </>
          }
        >
          <Field label="Vai trò phân công">
            <select className="t-input" value={staffRole} onChange={(e) => { setStaffRole(e.target.value as 'CO_INSTRUCTOR' | 'TEACHING_ASSISTANT'); setStaffUserId(''); }}>
              <option value="TEACHING_ASSISTANT">Trợ giảng</option>
              <option value="CO_INSTRUCTOR">Đồng giảng dạy</option>
            </select>
          </Field>
          <Field label="Chọn nhân sự" required>
            <select className="t-input" value={staffUserId} onChange={(e) => setStaffUserId(e.target.value)}>
              <option value="">— Chọn tài khoản —</option>
              {(candidateStaffReq.data?.items || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.code} · {u.email})
                </option>
              ))}
            </select>
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={staffCanAttendance} onChange={(e) => setStaffCanAttendance(e.target.checked)} />
            Cho phép điểm danh buổi học của lớp
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={staffCanMaterials} onChange={(e) => setStaffCanMaterials(e.target.checked)} />
            Cho phép soạn nháp nội dung bài học & tài liệu
          </label>
        </Modal>
      )}

      {dropTarget && (
        <ConfirmDialog
          title="Rút học viên khỏi lớp?"
          message={`Học viên ${dropTarget.name} sẽ chuyển sang trạng thái đã rút lớp. Lịch sử điểm danh và tiến độ cũ vẫn được bảo toàn.`}
          confirmLabel="Xác nhận rút lớp"
          danger
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            await teachingApi.dropStudent(cls.id, dropTarget.id);
            setDropTarget(null);
            toast({ tone: 'success', title: 'Đã cập nhật trạng thái học viên' });
            rosterReq.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
};

// ------------------------------------------------------------------ Tab 3 & 6: Nội dung học tập & Bài tập

export const CourseContentSection: React.FC<{ cls: ClassDetail; onOpenEditClass: () => void; mode: 'content' | 'assignments' }> = ({
  cls,
  onOpenEditClass,
  mode,
}) => {
  const toast = useToast();
  const courseReq = useAsync(
    () => (cls.course ? teachingApi.course(cls.course.id) : Promise.resolve(null)),
    [cls.course?.id]
  );
  const [analyticsTarget, setAnalyticsTarget] = useState<{ id: string; title: string } | null>(null);
  const [analyticsData, setAnalyticsData] = useState<ClassQuizAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const openLessonAnalytics = async (lessonId: string, lessonTitle: string) => {
    setAnalyticsTarget({ id: lessonId, title: lessonTitle });
    setAnalyticsLoading(true);
    setAnalyticsData(null);
    try {
      const res = await teachingApi.classLessonQuizAnalytics(cls.id, lessonId);
      setAnalyticsData(res);
    } catch (err) {
      toast({ tone: 'error', title: 'Không tải được thống kê Video & Quiz', detail: errMsg(err) });
      setAnalyticsTarget(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  if (!cls.course) {
    return (
      <Card title={mode === 'content' ? 'Nội dung học tập của lớp' : 'Bài tập và kiểm tra'}>
        <EmptyState
          title="Lớp học chưa được gắn khóa học"
          text="Liên kết lớp với một khóa học để học viên truy cập bài giảng, video tương tác, tài liệu và câu hỏi ôn tập."
          action={
            cls.capabilities.can_manage_class && (
              <Btn variant="primary" onClick={onOpenEditClass}>
                Liên kết khóa học cho lớp
              </Btn>
            )
          }
        />
      </Card>
    );
  }

  if (courseReq.loading) return <Loading rows={4} />;
  if (courseReq.error || !courseReq.data) return <ErrorState error={courseReq.error} onRetry={courseReq.reload} />;

  const course = courseReq.data;

  const analyticsModalNode = analyticsTarget && (
    <Modal
      title={`Thống kê Video & Quiz tương tác: ${analyticsTarget.title}`}
      onClose={() => setAnalyticsTarget(null)}
      width={820}
      footer={<Btn onClick={() => setAnalyticsTarget(null)}>Đóng</Btn>}
    >
      {analyticsLoading ? (
        <Loading rows={3} />
      ) : !analyticsData || analyticsData.students.length === 0 ? (
        <EmptyState title="Lớp chưa có học viên hoặc dữ liệu làm bài" />
      ) : (
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Trạng thái bài</th>
                <th>Thời lượng xem video</th>
                <th className="num">Mốc câu hỏi đã làm</th>
                <th className="num">Điểm tương tác</th>
              </tr>
            </thead>
            <tbody>
              {analyticsData.students.map((st) => (
                <tr key={st.student_id}>
                  <td>
                    <strong>{st.full_name}</strong>
                    <span className="t-sub tabular-nums" style={{ display: 'block' }}>{st.code}</span>
                  </td>
                  <td>
                    {st.lesson_status === 'COMPLETED' ? (
                      <Tone tone="success">Đã hoàn thành</Tone>
                    ) : st.lesson_status === 'IN_PROGRESS' ? (
                      <Tone tone="info">Đang học</Tone>
                    ) : (
                      <Tone tone="neutral">Chưa mở</Tone>
                    )}
                  </td>
                  <td>
                    <ProgressMeter value={st.video_watch_pct} label={`Xem video ${st.full_name}`} />
                  </td>
                  <td className="num tabular-nums">
                    {st.markers_answered}/{st.markers_total}
                  </td>
                  <td className="num tabular-nums">
                    {st.max_points > 0 ? `${st.earned_points}/${st.max_points}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );

  if (mode === 'assignments') {
    const publishedLessons = course.outline.flatMap((ch, ci) =>
      ch.lessons.map((l, li) => ({ ...l, chapterTitle: `Chương ${ci + 1}: ${ch.title}`, code: `${ci + 1}.${li + 1}` }))
    );
    const reviewGateLessons = publishedLessons.filter(
      (l) => l.completion_rule === 'REVIEW_CORRECT' || l.completion_rule === 'VIDEO_AND_QUIZ'
    );
    return (
      <>
        <Card
          title="Video Quiz tương tác, Bài kiểm tra & Bài tập theo bài học"
          actions={
            <div className="t-actions">
              <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/classes/${cls.id}/studio`}>
                <IconVideo size={14} /> Lesson Studio riêng của lớp
              </Link>
              <Link className="t-btn t-btn--small" to={`/teaching/courses/${course.id}/studio`}>
                Studio khóa học gốc
              </Link>
            </div>
          }
        >
          <div className="t-notice" style={{ marginBottom: 16 }}>
            Giảng viên có thể gắn <strong>Câu hỏi theo giây trên Video</strong>, <strong>Quiz độc lập</strong> và <strong>Bài tập thực hành</strong> cho riêng lớp{' '}
            <strong>{cls.code}</strong> mà không làm ảnh hưởng các lớp khác đang dùng chung khóa <strong>{course.title}</strong>.
          </div>
          {publishedLessons.length === 0 ? (
            <EmptyState title="Khóa học chưa có bài học nào" text="Hãy tạo chương và bài học để thêm câu hỏi tương tác hoặc bài tập." />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Bài học</th>
                    <th>Chương</th>
                    <th>Yêu cầu hoàn thành</th>
                    <th className="center">Trạng thái</th>
                    <th className="actions">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {publishedLessons.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>Bài {l.code}. {l.title}</strong>
                      </td>
                      <td>{l.chapterTitle}</td>
                      <td>
                        {l.completion_rule === 'VIDEO_AND_QUIZ' ? (
                          <Tone tone="warning">Xem Video & trả lời Quiz</Tone>
                        ) : l.completion_rule === 'REVIEW_CORRECT' ? (
                          <Tone tone="info">Bắt buộc trả lời đúng câu hỏi ôn tập</Tone>
                        ) : (
                          <span className="t-sub">Tự xác nhận hoàn thành</span>
                        )}
                      </td>
                      <td className="center"><Badge kind="lesson" value={l.publish_status} /></td>
                      <td className="actions">
                        <div className="t-actions">
                          <Btn small variant="quiet" onClick={() => openLessonAnalytics(l.id, l.title)}>
                            <IconChart size={14} /> Kết quả lớp
                          </Btn>
                          <Link className="t-btn t-btn--small" to={`/teaching/classes/${cls.id}/studio?lesson=${l.id}`}>
                            Tùy biến lớp
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reviewGateLessons.length > 0 && (
            <p className="t-sub" style={{ marginTop: 12 }}>
              Có <strong className="tabular-nums">{reviewGateLessons.length}</strong> bài học yêu cầu hoàn thành điều kiện kiểm tra trước khi ghi nhận xong bài.
            </p>
          )}
        </Card>
        {analyticsModalNode}
      </>
    );
  }

  return (
    <>
      <Card
        title={`Giáo trình sử dụng: ${course.title}`}
        actions={
          <>
            <Badge kind="course" value={course.status} />
            {cls.capabilities.can_manage_class && (
              <Btn small variant="ghost" onClick={onOpenEditClass}>
                Đổi khóa học liên kết
              </Btn>
            )}
            <Link className="t-btn t-btn--small t-btn--primary" to={`/teaching/classes/${cls.id}/studio`}>
              <IconVideo size={14} /> Tùy biến giáo án lớp (Studio)
            </Link>
            <Link className="t-btn t-btn--small" to={`/teaching/courses/${course.id}/studio`}>
              Studio khóa học gốc
            </Link>
          </>
        }
      >
        {course.status !== 'PUBLISHED' && (
          <div className="t-notice t-notice--warning" style={{ marginBottom: 16 }}>
            Khóa học này chưa ở trạng thái <strong>Đã xuất bản</strong>. Học viên của lớp sẽ chưa xem được bài giảng cho tới khi khóa học và bài học được xuất bản.
          </div>
        )}
        {course.outline.length === 0 ? (
          <EmptyState title="Khóa học chưa có chương bài nào" text="Mở Lesson Studio để xây dựng chương trình, tải video bài giảng và gắn câu hỏi theo giây." />
        ) : (
          course.outline.map((ch, ci) => (
            <div key={ch.id} className="t-chapter">
              <div className="t-chapter__head">
                <h3>Chương {ci + 1}. {ch.title}</h3>
                <Badge kind="lesson" value={ch.status} />
              </div>
              {ch.lessons.map((l, li) => (
                <div key={l.id} className="t-lesson-row">
                  <div className="t-lesson-row__title">
                    <Link to={`/teaching/classes/${cls.id}/studio?lesson=${l.id}`}>Bài {ci + 1}.{li + 1}. {l.title}</Link>
                    <span className="t-sub tabular-nums">{l.duration_minutes} phút</span>
                  </div>
                  <Badge kind="lesson" value={l.publish_status} />
                  <Btn small variant="ghost" onClick={() => openLessonAnalytics(l.id, l.title)}>
                    <IconChart size={14} /> Kết quả Video & Quiz
                  </Btn>
                  <Link className="t-btn t-btn--small" to={`/teaching/classes/${cls.id}/studio?lesson=${l.id}`}>
                    Tùy biến lớp
                  </Link>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>
      {analyticsModalNode}
    </>
  );
};
