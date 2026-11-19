import React, { useState } from 'react';
import {
  TeachingTimesheetItem,
  TeachingTimesheetLineItem,
  masterApi,
  saveBlob,
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
  StatCard,
  Tabs,
  Tone,
  errMsg,
  fmtDateTime,
  label,
  todayVn,
  useAsync,
  useToast,
} from '../ui';

export const TeachingHoursPage: React.FC = () => {
  const toast = useToast();
  const currentMonth = todayVn().slice(0, 7);
  const [periodMonth, setPeriodMonth] = useState(currentMonth);
  const [tab, setTab] = useState<'analytics' | 'timesheets' | 'quotas'>('analytics');

  const [instructorId, setInstructorId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [includeFuture, setIncludeFuture] = useState(false);

  const meReq = useAsync(() => teachingApi.me(), []);
  const coursesReq = useAsync(() => teachingApi.courses({ page_size: 100 }), []);
  const facilitiesReq = useAsync(() => masterApi.getFacilitiesOverview(), []);

  const isStaffOrAdmin = Boolean(
    meReq.data?.user.roles.some((r) => r === 'ADMIN' || r === 'ACADEMIC_STAFF')
  );

  const analyticsReq = useAsync(
    () =>
      masterApi.getTeachingHoursAnalytics({
        period_month: periodMonth,
        instructor_id: isStaffOrAdmin && instructorId ? instructorId : undefined,
        course_id: courseId || undefined,
        include_future: includeFuture ? 'true' : undefined,
      }),
    [periodMonth, instructorId, courseId, includeFuture, isStaffOrAdmin]
  );

  const timesheetsReq = useAsync(
    () => masterApi.listTeachingTimesheets({ period_month: periodMonth }),
    [periodMonth]
  );

  const quotasReq = useAsync(
    () => (tab === 'quotas' ? masterApi.listInstructorQuotas({ period_key: periodMonth }) : Promise.resolve(null)),
    [tab, periodMonth]
  );

  // Modals
  const [recordTarget, setRecordTarget] = useState<any | null>(null);
  const [reviewSheet, setReviewSheet] = useState<{ sheet: TeachingTimesheetItem; mode: 'CONFIRM' | 'DISPUTE' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [detailSheet, setDetailSheet] = useState<(TeachingTimesheetItem & { items: TeachingTimesheetLineItem[] }) | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGenerateTimesheets = async () => {
    setBusy(true);
    try {
      const r = await masterApi.generateTeachingTimesheets({ period_month: periodMonth });
      toast({
        tone: 'success',
        title: `Đã tổng hợp ${r.generated_count} bảng giờ giảng kỳ ${periodMonth}`,
        detail: r.skipped_locked_ids.length ? `Giữ nguyên ${r.skipped_locked_ids.length} bảng đã khóa sổ.` : 'Đã gửi thông báo để giảng viên kiểm tra xác nhận.',
      });
      timesheetsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể tổng hợp bảng giờ giảng', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const handleExportFinanceCsv = async () => {
    try {
      const res = await masterApi.exportFinanceTimesheetsCsv(periodMonth);
      saveBlob(res);
      toast({ tone: 'success', title: `Đã xuất tệp CSV chuyển Tài chính kỳ ${periodMonth}` });
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể xuất dữ liệu Tài chính', detail: errMsg(ex) });
    }
  };

  const submitTeacherReview = async () => {
    if (!reviewSheet) return;
    setBusy(true);
    try {
      await masterApi.teacherReviewTimesheet(reviewSheet.sheet.id, {
        decision: reviewSheet.mode,
        teacher_note: reviewNote.trim() || undefined,
      });
      toast({
        tone: 'success',
        title: reviewSheet.mode === 'CONFIRM' ? 'Đã xác nhận bảng giờ giảng' : 'Đã gửi phản hồi sai sót tới Giáo vụ',
      });
      setReviewSheet(null);
      setReviewNote('');
      timesheetsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể gửi phản hồi', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (id: string) => {
    setBusy(true);
    try {
      await masterApi.approveTimesheet(id, { review_note: `Duyệt bảng giờ giảng kỳ ${periodMonth}` });
      toast({ tone: 'success', title: 'Đã duyệt bảng giờ giảng' });
      timesheetsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Chưa thể duyệt bảng giờ giảng', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async (id: string) => {
    setBusy(true);
    try {
      const locked = await masterApi.lockTimesheet(id);
      toast({
        tone: 'success',
        title: 'Đã khóa sổ & chuyển Tài chính tính thù lao',
        detail: `Mã lô Tài chính: ${locked.finance_batch_code}`,
      });
      timesheetsReq.reload();
      analyticsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể khóa sổ', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await masterApi.getTeachingTimesheetDetail(id);
      setDetailSheet(d);
    } catch (ex) {
      toast({ tone: 'error', title: 'Không tải được chi tiết bảng công', detail: errMsg(ex) });
    }
  };

  const stats = analyticsReq.data;

  return (
    <div className="t-page">
      <PageHeader
        title="Thống kê Giờ dạy & Chốt công chuyển Tài chính"
        subtitle="Ghi nhận buổi dạy thực tế & dạy thay, đối chiếu định mức giờ giảng và chốt bảng giờ giảng cuối tháng 4 bước."
        actions={
          <div className="t-actions">
            <input
              className="t-input tabular-nums"
              type="month"
              aria-label="Chọn tháng thống kê"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
            />
            {isStaffOrAdmin && (
              <>
                <Btn loading={busy} onClick={handleGenerateTimesheets}>
                  ⚡ Tổng hợp bảng công tháng
                </Btn>
                <Btn variant="primary" onClick={handleExportFinanceCsv}>
                  📥 Xuất CSV Tài chính
                </Btn>
              </>
            )}
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as 'analytics' | 'timesheets' | 'quotas')}
        tabs={[
          { id: 'analytics', label: 'Thống kê & Ghi nhận buổi dạy' },
          { id: 'timesheets', label: 'Chốt bảng giờ giảng tháng (4 bước)', badge: timesheetsReq.data?.items.length || undefined },
          ...(isStaffOrAdmin ? [{ id: 'quotas', label: 'Định mức giờ giảng' }] : []),
        ]}
      />

      {tab === 'analytics' && (
        <>
          <div className="t-toolbar">
            {isStaffOrAdmin && (
              <select className="t-input" aria-label="Lọc giảng viên" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">Tất cả giảng viên trong phạm vi</option>
                {(facilitiesReq.data?.instructors || []).map((ins) => (
                  <option key={ins.id} value={ins.id}>{ins.full_name} ({ins.code})</option>
                ))}
              </select>
            )}
            <select className="t-input" aria-label="Lọc môn học" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Tất cả môn học</option>
              {(coursesReq.data?.items || []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
              ))}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
              <span>Tính cả các buổi sắp diễn ra trong tháng</span>
            </label>
          </div>

          {analyticsReq.loading && !stats && <Loading rows={5} />}
          {analyticsReq.error && <ErrorState error={analyticsReq.error} onRetry={analyticsReq.reload} />}

          {stats && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="t-stats">
                <StatCard
                  label="Số buổi đã mở / Đã xác nhận"
                  value={`${stats.totals.total_sessions} buổi`}
                  hint={`${stats.totals.confirmed_sessions} buổi đã xác nhận nhật ký`}
                />
                <StatCard
                  label="Tổng số tiết & giờ quy đổi"
                  value={`${stats.totals.total_periods} tiết (${stats.totals.total_hours}h)`}
                  hint={`LT: ${stats.totals.theory_periods} · TH: ${stats.totals.practice_periods} · Online: ${stats.totals.online_periods}`}
                />
                <StatCard
                  label="Dạy thay · Dạy bù · Buổi nghỉ"
                  value={`${stats.totals.substitute_sessions} thay · ${stats.totals.makeup_sessions} bù`}
                  hint={`${stats.totals.cancelled_sessions} buổi báo nghỉ`}
                />
                <StatCard
                  label="Giờ vượt định mức"
                  value={`${stats.totals.overtime_hours} giờ`}
                  tone={stats.totals.overtime_hours > 0 ? 'success' : 'default'}
                  hint="Tính trên định mức chuẩn từng GV"
                />
              </div>

              {/* Tổng hợp theo Giảng viên & Định mức */}
              <Card title="Tổng hợp giờ dạy theo Giảng viên & Đối chiếu định mức" padded={false}>
                {stats.by_instructor.length === 0 ? (
                  <EmptyState title="Chưa có dữ liệu giờ dạy trong kỳ này" />
                ) : (
                  <div className="t-table-wrap">
                    <table className="t-table">
                      <thead>
                        <tr>
                          <th>Giảng viên</th>
                          <th className="num">Buổi chính</th>
                          <th className="num">Dạy thay</th>
                          <th className="num">Dạy bù</th>
                          <th className="num">Buổi nghỉ</th>
                          <th className="num">LT / TH / Online (tiết)</th>
                          <th className="num">Tổng giờ</th>
                          <th className="num">Định mức</th>
                          <th className="num">Vượt định mức</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.by_instructor.map((row) => (
                          <tr key={row.instructor_id}>
                            <td><strong>{row.instructor_name}</strong></td>
                            <td className="num tabular-nums">{row.regular_sessions}</td>
                            <td className="num tabular-nums">{row.substitute_sessions}</td>
                            <td className="num tabular-nums">{row.makeup_sessions}</td>
                            <td className="num tabular-nums">{row.cancelled_sessions}</td>
                            <td className="num tabular-nums">{row.theory_periods} / {row.practice_periods} / {row.online_periods}</td>
                            <td className="num tabular-nums"><strong>{row.total_hours}h</strong> ({row.total_periods} tiết)</td>
                            <td className="num tabular-nums">{row.quota_hours}h</td>
                            <td className="num tabular-nums">
                              {row.overtime_hours > 0 ? (
                                <Tone tone="success">+{row.overtime_hours}h</Tone>
                              ) : (
                                '0h'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Phân rã theo Môn & Lớp môn học */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                <Card title="Chi tiết theo Môn học" padded={false}>
                  {stats.by_course.length === 0 ? (
                    <EmptyState title="Chưa có dữ liệu theo môn" />
                  ) : (
                    <div className="t-table-wrap">
                      <table className="t-table">
                        <thead>
                          <tr>
                            <th>Môn học</th>
                            <th className="num">Số buổi</th>
                            <th className="num">LT / TH / Online</th>
                            <th className="num">Tổng giờ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.by_course.map((c, idx) => (
                            <tr key={c.course_id || idx}>
                              <td><strong>{c.course_code}</strong> — {c.course_title}</td>
                              <td className="num tabular-nums">{c.sessions_count}</td>
                              <td className="num tabular-nums">{c.theory_periods}/{c.practice_periods}/{c.online_periods}</td>
                              <td className="num tabular-nums"><strong>{c.total_hours}h</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                <Card title="Chi tiết theo Lớp môn học" padded={false}>
                  {stats.by_class.length === 0 ? (
                    <EmptyState title="Chưa có dữ liệu theo lớp" />
                  ) : (
                    <div className="t-table-wrap">
                      <table className="t-table">
                        <thead>
                          <tr>
                            <th>Lớp môn học</th>
                            <th className="num">Số buổi</th>
                            <th className="num">Thay / Bù</th>
                            <th className="num">Tổng giờ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.by_class.map((cl) => (
                            <tr key={cl.class_id}>
                              <td><strong>{cl.class_code}</strong> — {cl.class_title}</td>
                              <td className="num tabular-nums">{cl.sessions_count}</td>
                              <td className="num tabular-nums">{cl.substitute_sessions} / {cl.makeup_sessions}</td>
                              <td className="num tabular-nums"><strong>{cl.total_hours}h</strong> ({cl.total_periods} tiết)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              {/* Sổ cái từng buổi dạy thực tế */}
              <Card title="Sổ ghi nhận từng buổi dạy thực tế (Tự mở khi đến giờ · Ghi nhận GV dạy thay)" padded={false}>
                {stats.sessions.length === 0 ? (
                  <EmptyState title="Chưa có buổi học nào trong khoảng lọc" />
                ) : (
                  <div className="t-table-wrap">
                    <table className="t-table">
                      <thead>
                        <tr>
                          <th>Thời gian thực tế</th>
                          <th>Lớp & Buổi học</th>
                          <th>Người dạy thực tế</th>
                          <th>Loại giờ</th>
                          <th className="num">Tiết / Giờ</th>
                          <th>Nhật ký</th>
                          <th className="actions">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.sessions.map((s) => (
                          <tr key={s.session_id}>
                            <td className="tabular-nums t-nowrap">
                              <strong>{fmtDateTime(s.actual_start_at)}</strong>
                            </td>
                            <td>
                              <strong>{s.class_code}</strong> — {s.session_title}
                              {s.session_kind === 'MAKEUP' && <span style={{ marginLeft: 6 }}><Badge kind="sessionKind" value="MAKEUP" /></span>}
                            </td>
                            <td>
                              <strong>{s.actual_instructor_name || '—'}</strong>
                              {s.is_substitute && (
                                <span className="t-sub">Dạy thay {s.scheduled_instructor_name}</span>
                              )}
                            </td>
                            <td><Badge kind="hourCategory" value={s.hour_category} /></td>
                            <td className="num tabular-nums">{s.periods} tiết ({s.hours}h)</td>
                            <td>
                              {s.timesheet_locked_id ? (
                                <Tone tone="success">🔒 Đã khóa sổ</Tone>
                              ) : (
                                <Badge kind="log" value={s.confirmation_status} />
                              )}
                            </td>
                            <td className="actions">
                              {!s.timesheet_locked_id && s.session_status !== 'CANCELLED' && (
                                <Btn small onClick={() => setRecordTarget(s)}>
                                  Cập nhật thực tế
                                </Btn>
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
          )}
        </>
      )}

      {/* TAB 2: QUY TRÌNH CHỐT BẢNG GIỜ GIẢNG 4 BƯỚC */}
      {tab === 'timesheets' && (
        <Card
          title={`Bảng chốt giờ giảng tháng ${periodMonth} (Tổng hợp → GV xác nhận → Giáo vụ/TBM duyệt → Khóa chuyển Tài chính)`}
          padded={false}
        >
          {timesheetsReq.loading && !timesheetsReq.data && <Loading rows={4} />}
          {timesheetsReq.data && timesheetsReq.data.items.length === 0 && (
            <EmptyState
              title={`Chưa có bảng tổng hợp giờ giảng cho kỳ ${periodMonth}`}
              text="Giáo vụ nhấn 'Tổng hợp bảng công tháng' để gom các buổi dạy đã xác nhận của từng giảng viên."
            />
          )}
          {timesheetsReq.data && timesheetsReq.data.items.length > 0 && (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Giảng viên</th>
                    <th className="num">Số buổi</th>
                    <th className="num">LT / TH / Online</th>
                    <th className="num">Tổng giờ / Định mức</th>
                    <th className="num">Vượt định mức</th>
                    <th>Trạng thái 4 bước</th>
                    <th>Phản hồi / Mã lô Tài chính</th>
                    <th className="actions">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {timesheetsReq.data.items.map((ts) => {
                    const isMine = meReq.data?.user.id === ts.instructor_id;
                    return (
                      <tr key={ts.id}>
                        <td><strong>{ts.instructor_name}</strong></td>
                        <td className="num tabular-nums">
                          {ts.total_sessions} ({ts.substitute_sessions} thay · {ts.makeup_sessions} bù)
                        </td>
                        <td className="num tabular-nums">{ts.theory_periods} / {ts.practice_periods} / {ts.online_periods}</td>
                        <td className="num tabular-nums">
                          <strong>{ts.total_hours}h</strong> / {ts.quota_hours}h ({ts.total_periods} tiết)
                        </td>
                        <td className="num tabular-nums">{ts.overtime_hours > 0 ? `+${ts.overtime_hours}h` : '0h'}</td>
                        <td><Badge kind="timesheetStatus" value={ts.status} /></td>
                        <td>
                          {ts.finance_batch_code && <code style={{ display: 'block' }}>{ts.finance_batch_code}</code>}
                          {ts.teacher_note && <span className="t-sub">GV: {ts.teacher_note}</span>}
                          {ts.review_note && <span className="t-sub">GVụ: {ts.review_note}</span>}
                        </td>
                        <td className="actions">
                          <div className="t-actions">
                            <Btn small variant="ghost" onClick={() => openDetail(ts.id)}>Chi tiết</Btn>
                            {(isMine || meReq.data?.user.roles.includes('ADMIN')) &&
                              (ts.status === 'PENDING_TEACHER' || ts.status === 'DISPUTED') && (
                                <>
                                  <Btn small variant="primary" onClick={() => { setReviewSheet({ sheet: ts, mode: 'CONFIRM' }); setReviewNote(''); }}>
                                    Xác nhận
                                  </Btn>
                                  <Btn small onClick={() => { setReviewSheet({ sheet: ts, mode: 'DISPUTE' }); setReviewNote(''); }}>
                                    Báo sai sót
                                  </Btn>
                                </>
                              )}
                            {isStaffOrAdmin && ts.status === 'TEACHER_CONFIRMED' && (
                              <Btn small variant="primary" loading={busy} onClick={() => handleApprove(ts.id)}>
                                Duyệt
                              </Btn>
                            )}
                            {isStaffOrAdmin && ts.status === 'APPROVED' && (
                              <Btn small variant="primary" loading={busy} onClick={() => handleLock(ts.id)}>
                                🔒 Khóa & Chuyển TC
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* TAB 3: ĐỊNH MỨC GIỜ GIẢNG */}
      {tab === 'quotas' && quotasReq.data && (
        <InstructorQuotasPanel periodKey={periodMonth} items={quotasReq.data.items} onSaved={() => { quotasReq.reload(); analyticsReq.reload(); }} />
      )}

      {recordTarget && (
        <RecordSessionModal
          session={recordTarget}
          instructors={facilitiesReq.data?.instructors || []}
          canAssignSubstitute={isStaffOrAdmin}
          onClose={() => setRecordTarget(null)}
          onSaved={() => {
            setRecordTarget(null);
            analyticsReq.reload();
          }}
        />
      )}

      {reviewSheet && (
        <Modal
          title={reviewSheet.mode === 'CONFIRM' ? 'Xác nhận bảng tổng hợp giờ giảng' : 'Phản hồi sai sót bảng giờ giảng'}
          onClose={() => setReviewSheet(null)}
          footer={
            <>
              <Btn onClick={() => setReviewSheet(null)}>Hủy</Btn>
              <Btn variant={reviewSheet.mode === 'CONFIRM' ? 'primary' : 'danger'} loading={busy} onClick={submitTeacherReview}>
                {reviewSheet.mode === 'CONFIRM' ? '✓ Đồng ý xác nhận' : 'Gửi phản hồi sai sót'}
              </Btn>
            </>
          }
        >
          <Field
            label={reviewSheet.mode === 'CONFIRM' ? 'Ghi chú xác nhận (tùy chọn)' : 'Mô tả chi tiết buổi/số tiết bị sai sót'}
            required={reviewSheet.mode === 'DISPUTE'}
          >
            <textarea className="t-input" rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          </Field>
        </Modal>
      )}

      {detailSheet && (
        <Modal
          title={`Chi tiết bảng giờ giảng — ${detailSheet.instructor_name} (${detailSheet.period_month})`}
          width={780}
          onClose={() => setDetailSheet(null)}
          footer={<Btn onClick={() => setDetailSheet(null)}>Đóng</Btn>}
        >
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Lớp & Buổi học</th>
                  <th>Vai trò</th>
                  <th>Loại giờ</th>
                  <th className="num">Tiết / Giờ</th>
                </tr>
              </thead>
              <tbody>
                {detailSheet.items.map((li) => (
                  <tr key={li.id}>
                    <td className="tabular-nums">{li.session_date}</td>
                    <td><strong>{li.class_code}</strong> — {li.session_title}</td>
                    <td>{li.role_kind === 'SUBSTITUTE' ? 'Dạy thay' : li.role_kind === 'MAKEUP' ? 'Dạy bù' : 'Giảng viên chính'}</td>
                    <td><Badge kind="hourCategory" value={li.hour_category} /></td>
                    <td className="num tabular-nums">{li.periods} tiết ({li.hours}h)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
};

const RecordSessionModal: React.FC<{
  session: any;
  instructors: Array<{ id: string; code: string; full_name: string }>;
  canAssignSubstitute: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ session, instructors, canAssignSubstitute, onClose, onSaved }) => {
  const toast = useToast();
  const [actualPeriods, setActualPeriods] = useState(session.periods || 2);
  const [hourCategory, setHourCategory] = useState<'THEORY' | 'PRACTICE' | 'ONLINE'>(session.hour_category || 'THEORY');
  const [actualInstructorId, setActualInstructorId] = useState(session.actual_instructor_id || '');
  const [subReason, setSubReason] = useState(session.substitute_reason || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await masterApi.recordSessionActualHours(session.session_id, {
        actual_periods: actualPeriods,
        hour_category: hourCategory,
        actual_instructor_id: canAssignSubstitute && actualInstructorId ? actualInstructorId : undefined,
        substitute_reason: subReason || undefined,
      });
      toast({ tone: 'success', title: 'Đã lưu thông tin thực dạy của buổi học' });
      onSaved();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể cập nhật buổi dạy', detail: errMsg(ex) });
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Ghi nhận thực dạy — ${session.class_code}: ${session.session_title}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="rec-hr-form" loading={busy}>Lưu ghi nhận</Btn>
        </>
      }
    >
      <form id="rec-hr-form" className="t-form-grid" onSubmit={submit}>
        <Field label="Số tiết thực dạy">
          <input className="t-input tabular-nums" type="number" step="0.5" min={0.5} max={12} value={actualPeriods} onChange={(e) => setActualPeriods(Number(e.target.value))} />
        </Field>
        <Field label="Loại giờ giảng">
          <select className="t-input" value={hourCategory} onChange={(e) => setHourCategory(e.target.value as any)}>
            <option value="THEORY">Lý thuyết</option>
            <option value="PRACTICE">Thực hành / Phòng máy</option>
            <option value="ONLINE">Trực tuyến</option>
          </select>
        </Field>
        {canAssignSubstitute && (
          <>
            <Field label="Người dạy thực tế (mặc định GV lớp môn; đổi nếu dạy thay)" wide>
              <select className="t-input" value={actualInstructorId} onChange={(e) => setActualInstructorId(e.target.value)}>
                {instructors.map((ins) => (
                  <option key={ins.id} value={ins.id}>{ins.full_name} ({ins.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Ghi chú dạy thay (nếu có)" wide>
              <input className="t-input" value={subReason} onChange={(e) => setSubReason(e.target.value)} placeholder="VD: Dạy thay theo phiếu điều động của Bộ môn" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
};

const InstructorQuotasPanel: React.FC<{
  periodKey: string;
  items: Array<{ instructor_id: string; instructor_code: string; instructor_name: string; standard_periods: number; standard_hours: number; note: string }>;
  onSaved: () => void;
}> = ({ periodKey, items, onSaved }) => {
  const toast = useToast();
  const [rows, setRows] = useState(items);

  return (
    <Card title={`Định mức giờ giảng chuẩn kỳ ${periodKey}`} padded={false}>
      <div className="t-table-wrap">
        <table className="t-table">
          <thead>
            <tr>
              <th>Giảng viên</th>
              <th className="num">Định mức tiết / tháng</th>
              <th className="num">Định mức giờ / tháng</th>
              <th className="actions">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.instructor_id}>
                <td><strong>{r.instructor_name}</strong> ({r.instructor_code})</td>
                <td className="num" style={{ width: 160 }}>
                  <input
                    className="t-input tabular-nums"
                    type="number"
                    min={0}
                    aria-label={`Định mức tiết ${r.instructor_name}`}
                    value={r.standard_periods}
                    onChange={(e) => {
                      const p = Number(e.target.value);
                      const next = [...rows];
                      next[idx] = { ...r, standard_periods: p, standard_hours: Math.round(((p * 45) / 60) * 10) / 10 };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="num" style={{ width: 160 }}>
                  <input
                    className="t-input tabular-nums"
                    type="number"
                    step="0.5"
                    min={0}
                    aria-label={`Định mức giờ ${r.instructor_name}`}
                    value={r.standard_hours}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...r, standard_hours: Number(e.target.value) };
                      setRows(next);
                    }}
                  />
                </td>
                <td className="actions">
                  <Btn
                    small
                    variant="primary"
                    onClick={async () => {
                      try {
                        await masterApi.saveInstructorQuota({
                          instructor_id: r.instructor_id,
                          period_key: periodKey,
                          standard_periods: r.standard_periods,
                          standard_hours: r.standard_hours,
                        });
                        toast({ tone: 'success', title: `Đã lưu định mức của ${r.instructor_name}` });
                        onSaved();
                      } catch (ex) {
                        toast({ tone: 'error', title: 'Không lưu được định mức', detail: errMsg(ex) });
                      }
                    }}
                  >
                    Lưu định mức
                  </Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
