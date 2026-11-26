import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBreadcrumbTrail } from '../../layout/BreadcrumbContext';
import { masterApi, teachingApi } from '../api';
import { Btn, Badge, Card, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, StatCard, Tabs, Tone, displayClassTitle, errMsg, fmtDate, fmtDateTime, fmtPct, label, useAsync, useToast } from '../ui';
import { SessionRow } from '../components/SessionRow';
import { ClassFormModal } from './ClassListPage';
import { ClassLeaveRequestsPanel } from './LeaveRequestsPage';
import { ForumWorkspace } from './ForumPanel';
import { CourseContentSection, StudentsTab } from './ClassRosterAndContentTabs';
import { AttendanceAndResultsTab, ScheduleTab, TeachingLogTab } from './ClassScheduleAndLogTabs';
import { ClassAssignmentsTab, ClassExamsTab, ClassGradebookTab } from './ClassAssessmentTabs';

type ClassTab =
  | 'overview'
  | 'students'
  | 'content'
  | 'schedule'
  | 'attendance'
  | 'exams'
  | 'assignments'
  | 'gradebook'
  | 'results'
  | 'log'
  | 'leave'
  | 'forum';


// ------------------------------------------------------------------ Main ClassDetailPage

export const ClassDetailPage: React.FC = () => {
  const { classId = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const activeTab = ((sp.get('tab') as ClassTab) || 'overview');
  const [editing, setEditing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [targetVersionId, setTargetVersionId] = useState('');
  const [upgradeReason, setUpgradeReason] = useState('');
  const [upgradeConfirmed, setUpgradeConfirmed] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const meReq = useAsync(() => teachingApi.me(), []);
  const clsReq = useAsync(() => teachingApi.klass(classId), [classId]);
  useBreadcrumbTrail(clsReq.data ? [{ label: `Lớp ${clsReq.data.code}` }] : []);
  const versionsReq = useAsync(
    () => (upgradeOpen && clsReq.data?.course?.id ? masterApi.listCourseVersions(clsReq.data.course.id) : Promise.resolve(null)),
    [upgradeOpen, clsReq.data?.course?.id]
  );

  if (clsReq.loading) return <Loading label="Đang tải lớp học…" rows={5} />;
  if (clsReq.error || !clsReq.data) return <ErrorState error={clsReq.error} onRetry={clsReq.reload} />;

  const cls = clsReq.data;
  const setTab = (t: string) => {
    const next = new URLSearchParams(sp);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    setSp(next, { replace: true });
  };

  const handleUpgradeSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetVersionId || !upgradeConfirmed) return;
    setUpgrading(true);
    try {
      const res = await masterApi.upgradeClassVersion(cls.id, {
        target_version_id: targetVersionId,
        upgrade_reason: upgradeReason.trim() || 'Nâng cấp giáo trình theo phê duyệt đào tạo',
        confirmed: true,
      });
      toast({
        tone: 'success',
        title: `Đã nâng cấp lớp sang Snapshot ${res.version_label}`,
        detail: 'Hành động đã được ghi nhật ký kiểm toán; tiến độ học tập cũ được bảo lưu riêng theo phiên bản.',
      });
      setUpgradeOpen(false);
      setTargetVersionId('');
      setUpgradeReason('');
      setUpgradeConfirmed(false);
      clsReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không nâng cấp được phiên bản', detail: errMsg(ex) });
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <div className="t-page">
      <PageHeader
        title={displayClassTitle(cls)}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge kind="class" value={cls.status} />
            <span>· {label('delivery', cls.delivery_mode)}</span>
            {cls.room ? <span>· {cls.room}</span> : null}
            {cls.schedule_text ? <span>· {cls.schedule_text}</span> : null}
            {cls.cohort && (
              <Link className="t-row-link" to={`/teaching/cohorts/${cls.cohort.id}`}>
                Lớp khóa học: {cls.cohort.code}
              </Link>
            )}
            {cls.course_version && (
              <Tone tone="info">Phiên bản ghim: {cls.course_version.version_label}</Tone>
            )}
          </span>
        }
        actions={
          <>
            {cls.capabilities.can_manage_class && cls.course && (
              <Btn onClick={() => setUpgradeOpen(true)}>Nâng cấp phiên bản</Btn>
            )}
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
          { id: 'content', label: 'Nội dung' },
          { id: 'schedule', label: 'Lịch học', badge: cls.sessions_total },
          { id: 'attendance', label: 'Điểm danh', badge: cls.sessions_unmarked || undefined },
          { id: 'exams', label: 'Kiểm tra' },
          { id: 'assignments', label: 'Bài tập' },
          { id: 'gradebook', label: 'Bảng điểm' },
          { id: 'results', label: 'Kết quả' },
          { id: 'log', label: 'Nhật ký', badge: cls.logs_unconfirmed.length || undefined },
          { id: 'leave', label: 'Đơn nghỉ' },
          { id: 'forum', label: 'Diễn đàn' },
        ]}
      />

      {activeTab === 'overview' && (
        <div className="t-grid-2">
          <Card title="Thông tin tổ chức lớp">
            <dl className="t-dl">
              <dt>Mã lớp</dt>
              <dd style={{ fontWeight: 600 }} className="tabular-nums">{cls.code}</dd>
              <dt>Lớp khóa học</dt>
              <dd>
                {cls.cohort ? (
                  <Link className="t-row-link" to={`/teaching/cohorts/${cls.cohort.id}`}>
                    {cls.cohort.code} — {cls.cohort.title}
                  </Link>
                ) : (
                  'Mở độc lập (Không thuộc khóa niên chế)'
                )}
              </dd>
              <dt>Môn / Chuyên đề</dt>
              <dd>{cls.subject || '—'}</dd>
              <dt>Môn học & Giáo trình</dt>
              <dd>
                {cls.course ? (
                  <Link className="t-row-link" to={`/teaching/courses/${cls.course.id}`}>{cls.course.title}</Link>
                ) : (
                  'Chưa liên kết'
                )}
              </dd>
              <dt>Snapshot nội dung đang ghim</dt>
              <dd>
                {cls.course_version ? (
                  <Tone tone="info">{cls.course_version.version_label} (#{cls.course_version.version_number})</Tone>
                ) : (
                  'Theo bản phát hành mới nhất'
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
      {activeTab === 'exams' && <ClassExamsTab cls={cls} />}
      {activeTab === 'assignments' && <ClassAssignmentsTab cls={cls} onOpenEditClass={() => setEditing(true)} />}
      {activeTab === 'gradebook' && <ClassGradebookTab cls={cls} />}
      {activeTab === 'results' && <AttendanceAndResultsTab cls={cls} mode="results" />}
      {activeTab === 'log' && <TeachingLogTab cls={cls} onChanged={clsReq.reload} />}
      {activeTab === 'leave' && <ClassLeaveRequestsPanel classId={cls.id} />}
      {activeTab === 'forum' && <ForumWorkspace mode="class" targetId={cls.id} />}

      {upgradeOpen && (
        <Modal
          title="Nâng cấp phiên bản Snapshot giáo trình cho lớp"
          onClose={() => setUpgradeOpen(false)}
          width={620}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setUpgradeOpen(false)} disabled={upgrading}>Hủy</Btn>
              <Btn
                variant="primary"
                type="submit"
                form="upgrade-snapshot-form"
                loading={upgrading}
                disabled={!targetVersionId || !upgradeConfirmed || !upgradeReason.trim()}
              >
                Xác nhận nâng cấp
              </Btn>
            </>
          }
        >
          <div className="m-semantic-notice" data-tone="warning" style={{ marginBottom: 14 }}>
            <div>
              <strong>Kiểm soát nâng cấp Snapshot:</strong> Lớp hiện đang ghim{' '}
              <strong>{cls.course_version?.version_label || 'bản chưa ghim'}</strong>. Tiến độ xem video & bài làm ở phiên bản cũ sẽ được cô lập theo khóa phiên bản cũ để tránh sai lệch lịch sử.
            </div>
          </div>
          {versionsReq.loading && <Loading rows={2} />}
          {versionsReq.error && <ErrorState error={versionsReq.error} onRetry={versionsReq.reload} />}
          {versionsReq.data && (
            <form id="upgrade-snapshot-form" className="t-form-grid" onSubmit={handleUpgradeSnapshot}>
              <Field label="Chọn Snapshot đích" required wide>
                <select className="t-input" required value={targetVersionId} onChange={(e) => setTargetVersionId(e.target.value)}>
                  <option value="">-- Chọn phiên bản Snapshot --</option>
                  {versionsReq.data.items.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.id === cls.course_version_id}>
                      {v.version_label} (#{v.version_number}) — {fmtDate(v.published_at)} {v.id === cls.course_version_id ? '(Đang dùng)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lý do nâng cấp (ghi Audit Log)" required wide>
                <input
                  className="t-input"
                  required
                  value={upgradeReason}
                  onChange={(e) => setUpgradeReason(e.target.value)}
                  placeholder="VD: Bổ sung chương ôn tập chuẩn bị thi giữa kỳ"
                />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" checked={upgradeConfirmed} onChange={(e) => setUpgradeConfirmed(e.target.checked)} />
                  Tôi hiểu thay đổi này chuyển lớp sang Snapshot mới và tách biệt tiến độ theo phiên bản.
                </label>
              </div>
            </form>
          )}
        </Modal>
      )}

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

