import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ClassDetail, ClassQuizAnalytics, DeliveryMode, EnrollResult, saveBlob, SessionSummary, teachingApi, VirtualProviderType,
} from '../api';
import { attendanceLink, SessionRow, virtualSessionLink } from '../components/SessionRow';
import {
  Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  ProgressMeter, SearchInput, StatCard, Tabs, Tone,
  displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, fmtTime, fmtWeekday, label, todayVn, useAsync, useToast,
} from '../ui';
import { ClassFormModal } from './ClassListPage';

type ClassTab = 'overview' | 'students' | 'content' | 'schedule' | 'attendance' | 'assignments' | 'results' | 'log';

const WEEKDAYS: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Thứ 2' },
  { day: 2, label: 'Thứ 3' },
  { day: 3, label: 'Thứ 4' },
  { day: 4, label: 'Thứ 5' },
  { day: 5, label: 'Thứ 6' },
  { day: 6, label: 'Thứ 7' },
  { day: 0, label: 'Chủ nhật' },
];

const isoToDateInput = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const isoToTimeInput = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ Tab 2: Học viên & Đội ngũ giảng dạy

const StudentsTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DROPPED' | 'ALL'>('ACTIVE');
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

  const items = (rosterReq.data?.items || []).filter((s) =>
    !q.trim() ? true : `${s.code} ${s.full_name} ${s.email}`.toLowerCase().includes(q.trim().toLowerCase())
  );

  const handleAddSingle = async () => {
    if (!pickedStudentId) return;
    setBusy(true);
    try {
      const r = await teachingApi.addStudents(cls.id, [pickedStudentId]);
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
      const r = await teachingApi.importStudents(cls.id, importText);
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

      {addingOpen && (
        <Modal
          title="Thêm hoặc nhập danh sách học viên"
          onClose={() => setAddingOpen(false)}
          width={640}
          footer={<Btn onClick={() => setAddingOpen(false)}>Đóng</Btn>}
        >
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
            label="Hoặc dán danh sách mã học viên / email (mỗi dòng hoặc cách nhau bởi dấu phẩy)"
            hint="Ví dụ: HS50101, HS50102 hoặc minhanh.hs@lmsplus.edu.vn"
          >
            <textarea
              className="t-input"
              rows={5}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="HS50201&#10;HS50202&#10;minhanh.hs@lmsplus.edu.vn"
            />
          </Field>
          <div>
            <Btn variant="secondary" onClick={handleBulkImport} loading={busy} disabled={!importText.trim()}>
              Nhập danh sách
            </Btn>
          </div>

          {lastImportResult && (
            <div className="t-notice">
              <div>Đã thêm mới: <strong>{lastImportResult.added.length}</strong> · Kích hoạt lại: <strong>{lastImportResult.reactivated.length}</strong> · Đã có sẵn: <strong>{lastImportResult.already_enrolled.length}</strong></div>
              {lastImportResult.not_found.length > 0 && (
                <div style={{ marginTop: 4, color: 'var(--status-danger)' }}>
                  Không tìm thấy: {lastImportResult.not_found.join(', ')}
                </div>
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

const CourseContentSection: React.FC<{ cls: ClassDetail; onOpenEditClass: () => void; mode: 'content' | 'assignments' }> = ({
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
                🎬 Lesson Studio riêng của lớp
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
                            📊 Kết quả lớp
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
              🎬 Tùy biến giáo án lớp (Studio)
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
                    📊 Kết quả Video & Quiz
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

// ------------------------------------------------------------------ Tab 4: Lịch học & Buổi học

const ScheduleTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
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

const AttendanceAndResultsTab: React.FC<{ cls: ClassDetail; mode: 'attendance' | 'results' }> = ({ cls, mode }) => {
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

const TeachingLogTab: React.FC<{ cls: ClassDetail; onChanged: () => void }> = ({ cls, onChanged }) => {
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

// ------------------------------------------------------------------ Main ClassDetailPage

export const ClassDetailPage: React.FC = () => {
  const { classId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const activeTab = ((sp.get('tab') as ClassTab) || 'overview');
  const [editing, setEditing] = useState(false);

  const meReq = useAsync(() => teachingApi.me(), []);
  const clsReq = useAsync(() => teachingApi.klass(classId), [classId]);

  if (clsReq.loading) return <Loading label="Đang tải lớp học…" rows={5} />;
  if (clsReq.error || !clsReq.data) return <ErrorState error={clsReq.error} onRetry={clsReq.reload} />;

  const cls = clsReq.data;
  const setTab = (t: string) => {
    const next = new URLSearchParams(sp);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setSp(next, { replace: true });
  };

  return (
    <div className="t-page">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/teaching/classes">Lớp học</Link>
            <span>/</span>
            <span>Lớp {cls.code}</span>
          </>
        }
        title={displayClassTitle(cls)}
        subtitle={
          <>
            <Badge kind="class" value={cls.status} /> · {label('delivery', cls.delivery_mode)}
            {cls.room ? ` · ${cls.room}` : ''}
            {cls.schedule_text ? ` · ${cls.schedule_text}` : ''}
          </>
        }
        actions={
          <>
            {cls.capabilities.can_manage_class && (
              <Btn onClick={() => setEditing(true)}>Chỉnh sửa lớp</Btn>
            )}
            <Link className="t-btn t-btn--primary" to={`/teaching/classes/${cls.id}/attendance`}>
              Điểm danh nhanh
            </Link>
          </>
        }
      />

      <div className="t-stats">
        <StatCard
          label="Học viên đang học"
          value={cls.max_students ? `${cls.student_count}/${cls.max_students}` : cls.student_count}
          hint="Xem danh sách tại mục Học viên"
        />
        <StatCard
          label="Tiến độ buổi học"
          value={`${cls.sessions_done}/${cls.sessions_total}`}
          tone={cls.sessions_unmarked > 0 ? 'warning' : 'default'}
          hint={cls.sessions_unmarked > 0 ? `${cls.sessions_unmarked} buổi chưa điểm danh` : 'Tất cả buổi đã qua đều đã điểm danh'}
        />
        <StatCard
          label="Tỷ lệ chuyên cần"
          value={fmtPct(cls.attendance_rate)}
          tone={cls.attendance_rate !== null && cls.attendance_rate < 80 ? 'warning' : 'success'}
        />
        <StatCard
          label="Hoàn thành bài học"
          value={cls.progress ? fmtPct(cls.progress.avg_completion_pct) : '—'}
          hint={cls.course ? cls.course.title : 'Chưa gắn khóa học'}
        />
      </div>

      <Tabs
        active={activeTab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Tổng quan' },
          { id: 'students', label: 'Học viên', badge: cls.student_count },
          { id: 'content', label: 'Nội dung học tập' },
          { id: 'schedule', label: 'Lịch học', badge: cls.sessions_total },
          { id: 'attendance', label: 'Điểm danh', badge: cls.sessions_unmarked || undefined },
          { id: 'assignments', label: 'Bài tập & kiểm tra' },
          { id: 'results', label: 'Kết quả học tập' },
          { id: 'log', label: 'Nhật ký giảng dạy', badge: cls.logs_unconfirmed.length || undefined },
        ]}
      />

      {activeTab === 'overview' && (
        <div className="t-grid-2">
          <Card title="Thông tin tổ chức lớp">
            <dl className="t-dl">
              <dt>Mã lớp</dt>
              <dd style={{ fontWeight: 600 }} className="tabular-nums">{cls.code}</dd>
              <dt>Môn / Chuyên đề</dt>
              <dd>{cls.subject || '—'}</dd>
              <dt>Khóa học gắn kèm</dt>
              <dd>
                {cls.course ? (
                  <Link className="t-row-link" to={`/teaching/courses/${cls.course.id}`}>{cls.course.title}</Link>
                ) : (
                  'Chưa liên kết'
                )}
              </dd>
              <dt>Thời gian mở lớp</dt>
              <dd className="tabular-nums">
                {fmtDate(cls.start_date)} – {fmtDate(cls.end_date)}
              </dd>
              <dt>Giảng dạy</dt>
              <dd>
                {cls.staff.map((s) => `${s.full_name} (${label('staffRole', s.staff_role)})`).join(', ') || '—'}
              </dd>
            </dl>
            {cls.description && (
              <p style={{ marginTop: 16, marginBottom: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                {cls.description}
              </p>
            )}
          </Card>

          <Card title="Việc cần xử lý & Buổi học sắp tới">
            {cls.sessions_need_attendance.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Buổi học chưa điểm danh</strong>
                {cls.sessions_need_attendance.map((s) => (
                  <SessionRow key={s.id} s={s} showClass={false} showDate />
                ))}
              </div>
            )}
            {cls.upcoming_sessions.length > 0 ? (
              <div>
                <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Buổi học sắp diễn ra</strong>
                {cls.upcoming_sessions.map((s) => (
                  <SessionRow key={s.id} s={s} showClass={false} showDate />
                ))}
              </div>
            ) : (
              cls.sessions_need_attendance.length === 0 && (
                <EmptyState title="Không có công việc tồn đọng" text="Lớp đã hoàn tất điểm danh các buổi trước và chưa có lịch buổi mới." />
              )
            )}
          </Card>
        </div>
      )}

      {activeTab === 'students' && <StudentsTab cls={cls} onChanged={clsReq.reload} />}
      {activeTab === 'content' && <CourseContentSection cls={cls} onOpenEditClass={() => setEditing(true)} mode="content" />}
      {activeTab === 'schedule' && <ScheduleTab cls={cls} onChanged={clsReq.reload} />}
      {activeTab === 'attendance' && <AttendanceAndResultsTab cls={cls} mode="attendance" />}
      {activeTab === 'assignments' && <CourseContentSection cls={cls} onOpenEditClass={() => setEditing(true)} mode="assignments" />}
      {activeTab === 'results' && <AttendanceAndResultsTab cls={cls} mode="results" />}
      {activeTab === 'log' && <TeachingLogTab cls={cls} onChanged={clsReq.reload} />}

      {editing && (
        <ClassFormModal
          initial={cls}
          canPickInstructor={Boolean(meReq.data?.can_pick_instructor)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            clsReq.reload();
          }}
        />
      )}
    </div>
  );
};
