import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AssessmentComponentItem,
  AssessmentSourceType,
  CourseDetail,
  RoomType,
  SessionPlanItem,
  masterApi,
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
  Tone,
  errMsg,
  fmtDateTime,
  fmtMoney,
  label,
  useAsync,
  useToast,
} from '../ui';

const ROOM_OPTIONS: RoomType[] = ['THEORY_ROOM', 'COMPUTER_LAB', 'ONLINE'];
const SOURCE_OPTIONS: AssessmentSourceType[] = ['ATTENDANCE', 'ASSIGNMENT', 'EXAM', 'EXAM_MATRIX', 'MANUAL'];

// ============================================================================
// 1.1.1, 1.1.2 & 1.1.3 — HỒ SƠ ĐÀO TẠO MÔN HỌC (CLO, TIÊN QUYẾT, THỜI LƯỢNG, ĐẦU ĐIỂM)
// ============================================================================

export const CourseTrainingProfileSection: React.FC<{ courseId: string; onChanged?: () => void }> = ({ courseId, onChanged }) => {
  const toast = useToast();
  const req = useAsync(() => masterApi.getCourseTrainingProfile(courseId), [courseId]);

  const [deptName, setDeptName] = useState('');
  const [outcomes, setOutcomes] = useState<Array<{ code: string; text: string }>>([]);
  const [newOutcome, setNewOutcome] = useState('');
  const [tuitionFee, setTuitionFee] = useState(0);
  const [theoryPeriods, setTheoryPeriods] = useState(15);
  const [practicePeriods, setPracticePeriods] = useState(15);
  const [selfStudyPeriods, setSelfStudyPeriods] = useState(15);
  const [minsPerPeriod, setMinsPerPeriod] = useState(45);
  const [roomType, setRoomType] = useState<RoomType>('THEORY_ROOM');
  const [gradingScale, setGradingScale] = useState(10);
  const [passScore, setPassScore] = useState(5);
  const [minAttendancePct, setMinAttendancePct] = useState(70);
  const [requireMandatoryAsg, setRequireMandatoryAsg] = useState(true);
  const [examExtraNote, setExamExtraNote] = useState('');

  const [prereqIds, setPrereqIds] = useState<string[]>([]);
  const [components, setComponents] = useState<AssessmentComponentItem[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrereq, setSavingPrereq] = useState(false);
  const [savingAssess, setSavingAssess] = useState(false);

  useEffect(() => {
    if (!req.data) return;
    const c = req.data.course;
    setDeptName(c.department_name || '');
    setOutcomes(c.outcomes || []);
    setTuitionFee(c.reference_tuition_fee || 0);
    setTheoryPeriods(c.theory_periods ?? 15);
    setPracticePeriods(c.practice_periods ?? 15);
    setSelfStudyPeriods(c.self_study_periods ?? 15);
    setMinsPerPeriod(c.minutes_per_period || 45);
    setRoomType(c.required_room_type || 'THEORY_ROOM');
    setGradingScale(c.grading_scale || 10);
    setPassScore(c.pass_score ?? 5);
    setMinAttendancePct(c.exam_conditions?.min_attendance_pct ?? 70);
    setRequireMandatoryAsg(c.exam_conditions?.require_all_mandatory_assignments ?? true);
    setExamExtraNote(c.exam_conditions?.extra_note || '');
    setPrereqIds(req.data.prerequisites.map((p) => p.prerequisite_course_id));
    setComponents(
      req.data.assessment_components.length > 0
        ? req.data.assessment_components
        : [
            { code: 'CC', title: 'Chuyên cần', weight_pct: 10, source_type: 'ATTENDANCE', is_mandatory: true },
            { code: 'BT', title: 'Bài tập thực hành', weight_pct: 30, source_type: 'ASSIGNMENT', is_mandatory: true },
            { code: 'GK', title: 'Kiểm tra giữa môn', weight_pct: 20, source_type: 'EXAM', is_mandatory: true },
            { code: 'CK', title: 'Dự án / Thi cuối môn', weight_pct: 40, source_type: 'EXAM_MATRIX', is_mandatory: true },
          ]
    );
  }, [req.data]);

  if (req.loading && !req.data) return <Loading rows={5} />;
  if (req.error || !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;

  const canManage = req.data.capabilities.can_manage;
  const totalClassPeriods = Number(theoryPeriods || 0) + Number(practicePeriods || 0);
  const totalAllPeriods = totalClassPeriods + Number(selfStudyPeriods || 0);
  const totalHours = Math.round(((totalClassPeriods * Number(minsPerPeriod || 45)) / 60) * 10) / 10;
  const weightSum = Math.round(components.reduce((s, x) => s + Number(x.weight_pct || 0), 0) * 100) / 100;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const r = await masterApi.saveCourseTrainingProfile(courseId, {
        department_name: deptName.trim(),
        outcomes,
        reference_tuition_fee: tuitionFee,
        theory_periods: theoryPeriods,
        practice_periods: practicePeriods,
        self_study_periods: selfStudyPeriods,
        minutes_per_period: minsPerPeriod,
        required_room_type: roomType,
        grading_scale: gradingScale,
        pass_score: passScore,
        exam_conditions: {
          min_attendance_pct: minAttendancePct,
          require_all_mandatory_assignments: requireMandatoryAsg,
          extra_note: examExtraNote,
        },
      });
      toast({
        tone: 'success',
        title: 'Đã lưu hồ sơ đào tạo môn học',
        detail: `Phiên bản hiện tại: ${r.version_code} (${label('lifecycleStatus', r.lifecycle_status)})`,
      });
      req.reload();
      onChanged?.();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu hồ sơ đào tạo', detail: errMsg(ex) });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePrereqs = async () => {
    setSavingPrereq(true);
    try {
      await masterApi.saveCoursePrerequisites(courseId, prereqIds);
      toast({ tone: 'success', title: 'Đã cập nhật môn tiên quyết' });
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu môn tiên quyết', detail: errMsg(ex) });
    } finally {
      setSavingPrereq(false);
    }
  };

  const saveAssessment = async () => {
    setSavingAssess(true);
    try {
      await masterApi.saveCourseAssessmentComponents(courseId, components);
      toast({ tone: 'success', title: 'Đã lưu cấu hình đầu điểm & trọng số (100%)' });
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Lỗi trọng số đánh giá', detail: errMsg(ex) });
    } finally {
      setSavingAssess(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="t-stats">
        <div className="t-stat">
          <span className="t-stat__label">Phiên bản & Trạng thái</span>
          <strong className="t-stat__value tabular-nums" style={{ fontSize: 18 }}>{req.data.course.version_code}</strong>
          <span className="t-stat__hint"><Badge kind="lifecycleStatus" value={req.data.course.lifecycle_status} /></span>
        </div>
        <div className="t-stat">
          <span className="t-stat__label">Thời lượng lên lớp</span>
          <strong className="t-stat__value tabular-nums">{totalClassPeriods} tiết</strong>
          <span className="t-stat__hint tabular-nums">{totalHours} giờ ({theoryPeriods} LT · {practicePeriods} TH) + {selfStudyPeriods} tự học</span>
        </div>
        <div className="t-stat">
          <span className="t-stat__label">Phòng học chuẩn</span>
          <strong className="t-stat__value" style={{ fontSize: 18 }}>{label('roomType', roomType)}</strong>
          <span className="t-stat__hint">Áp dụng khi xếp TKB</span>
        </div>
        <div className="t-stat">
          <span className="t-stat__label">Học phí tham khảo</span>
          <strong className="t-stat__value tabular-nums" style={{ fontSize: 18 }}>{fmtMoney(tuitionFee)}</strong>
          <span className="t-stat__hint">Cộng tự động vào Khung CT</span>
        </div>
      </div>

      {/* 1.1.1 & 1.1.2: Chuẩn đầu ra (CLO), Thời lượng, Loại phòng & Điều kiện dự thi */}
      <Card title="Chuẩn đầu ra (CLO), Thời lượng & Điều kiện đạt môn">
        <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="t-form-grid">
            <Field label="Tổ / Bộ môn quản lý">
              <input className="t-input" value={deptName} onChange={(e) => setDeptName(e.target.value)} disabled={!canManage} placeholder="VD: Bộ môn Công nghệ phần mềm" />
            </Field>
            <Field label="Học phí tham khảo (VNĐ)" hint="Dùng để tính tổng học phí mặc định của Khung chương trình">
              <input className="t-input tabular-nums" type="number" min={0} step={50000} value={tuitionFee} onChange={(e) => setTuitionFee(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Số tiết Lý thuyết">
              <input className="t-input tabular-nums" type="number" min={0} max={500} value={theoryPeriods} onChange={(e) => setTheoryPeriods(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Số tiết Thực hành">
              <input className="t-input tabular-nums" type="number" min={0} max={500} value={practicePeriods} onChange={(e) => setPracticePeriods(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Số tiết Tự học">
              <input className="t-input tabular-nums" type="number" min={0} max={500} value={selfStudyPeriods} onChange={(e) => setSelfStudyPeriods(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Số phút / 1 tiết chuẩn" hint={`Tổng quy đổi toàn môn: ${totalAllPeriods} tiết`}>
              <input className="t-input tabular-nums" type="number" min={15} max={120} value={minsPerPeriod} onChange={(e) => setMinsPerPeriod(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Loại phòng học yêu cầu">
              <select className="t-input" value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)} disabled={!canManage}>
                {ROOM_OPTIONS.map((rt) => (
                  <option key={rt} value={rt}>{label('roomType', rt)}</option>
                ))}
              </select>
            </Field>
            <Field label="Thang điểm & Điểm đạt môn">
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="t-input tabular-nums" aria-label="Thang điểm môn học" value={gradingScale} onChange={(e) => setGradingScale(Number(e.target.value))} disabled={!canManage}>
                  <option value={10}>Thang 10</option>
                  <option value={4}>Thang 4</option>
                  <option value={100}>Thang 100</option>
                </select>
                <input
                  className="t-input tabular-nums"
                  type="number"
                  step="0.1"
                  min={0}
                  max={gradingScale}
                  aria-label="Điểm đạt môn"
                  value={passScore}
                  onChange={(e) => setPassScore(Number(e.target.value))}
                  disabled={!canManage}
                />
              </div>
            </Field>
            <Field label="Chuyên cần tối thiểu dự thi (%)">
              <input className="t-input tabular-nums" type="number" min={0} max={100} value={minAttendancePct} onChange={(e) => setMinAttendancePct(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Điều kiện bài tập bắt buộc">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: canManage ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={requireMandatoryAsg} onChange={(e) => setRequireMandatoryAsg(e.target.checked)} disabled={!canManage} />
                <span>Phải nộp đủ 100% bài tập bắt buộc trước khi thi cuối môn</span>
              </label>
            </Field>
            <Field label="Ghi chú điều kiện dự thi bổ sung" wide>
              <input className="t-input" value={examExtraNote} onChange={(e) => setExamExtraNote(e.target.value)} disabled={!canManage} placeholder="VD: Không vi phạm quy chế phòng Lab..." />
            </Field>
          </div>

          {/* Danh sách Chuẩn đầu ra CLO */}
          <div style={{ padding: 16, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Chuẩn đầu ra của môn học (CLO — "Sau môn này học viên có thể…")</strong>
            <p className="t-sub" style={{ margin: '0 0 12px' }}>Ví dụ: Viết được hàm tái sử dụng, xử lý ngoại lệ an toàn, đọc ghi dữ liệu file.</p>
            {outcomes.length === 0 ? (
              <p className="t-sub">Chưa khai báo chuẩn đầu ra nào.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {outcomes.map((o, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="t-badge t-badge--info tabular-nums">{o.code || `CLO${idx + 1}`}</span>
                    <input
                      className="t-input"
                      style={{ flex: 1 }}
                      aria-label={`Nội dung chuẩn đầu ra ${idx + 1}`}
                      value={o.text}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...outcomes];
                        next[idx] = { ...o, text: e.target.value };
                        setOutcomes(next);
                      }}
                    />
                    {canManage && (
                      <Btn small variant="ghost" onClick={() => setOutcomes(outcomes.filter((_, i) => i !== idx))}>
                        Xóa
                      </Btn>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canManage && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="t-input"
                  style={{ flex: '1 1 280px' }}
                  aria-label="Chuẩn đầu ra mới"
                  placeholder="Nhập chuẩn đầu ra mới (VD: Xây dựng được truy vấn SQL đa bảng)…"
                  value={newOutcome}
                  onChange={(e) => setNewOutcome(e.target.value)}
                />
                <Btn
                  onClick={() => {
                    if (!newOutcome.trim()) return;
                    setOutcomes([...outcomes, { code: `CLO${outcomes.length + 1}`, text: newOutcome.trim() }]);
                    setNewOutcome('');
                  }}
                >
                  + Thêm CLO
                </Btn>
              </div>
            )}
          </div>

          {canManage && (
            <div>
              <Btn type="submit" variant="primary" loading={savingProfile}>
                Lưu thông số đào tạo & CLO
              </Btn>
            </div>
          )}
        </form>
      </Card>

      {/* 1.1.1: Môn tiên quyết (Chống vòng lặp DAG) */}
      <Card
        title="Môn tiên quyết (Kiểm tra tự động chống vòng lặp phụ thuộc)"
        actions={canManage && <Btn small variant="primary" loading={savingPrereq} onClick={savePrereqs}>Lưu môn tiên quyết</Btn>}
      >
        <p className="t-sub" style={{ marginTop: 0 }}>
          Chọn các môn học viên bắt buộc phải hoàn thành trước khi học môn này. Khi xếp vào Khung chương trình, hệ thống sẽ tự động cảnh báo nếu môn tiên quyết thiếu hoặc xếp sau môn này.
        </p>
        {req.data.candidate_courses.length === 0 ? (
          <EmptyState title="Chưa có môn học khác trong hệ thống để chọn làm tiên quyết" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {req.data.candidate_courses.map((cand) => {
              const checked = prereqIds.includes(cand.id);
              return (
                <label
                  key={cand.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    minHeight: 44,
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${checked ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                    backgroundColor: checked ? 'var(--brand-tint)' : 'var(--bg-surface)',
                    cursor: canManage ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canManage}
                    onChange={(e) =>
                      setPrereqIds((prev) => (e.target.checked ? [...prev, cand.id] : prev.filter((x) => x !== cand.id)))
                    }
                  />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 13 }}>{cand.code} — {cand.title}</strong>
                    <span className="t-sub" style={{ margin: 0 }}>{label('lifecycleStatus', cand.lifecycle_status)}</span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Card>

      {/* 1.1.3: Đầu điểm & Trọng số (Tổng = 100%) */}
      <Card
        title="Cấu trúc Đầu điểm & Trọng số đánh giá (Tổng bắt buộc = 100%)"
        actions={
          <div className="t-actions">
            <Tone tone={Math.abs(weightSum - 100) < 0.01 ? 'success' : 'danger'}>
              Tổng trọng số: {weightSum}%
            </Tone>
            {canManage && (
              <>
                <Btn
                  small
                  onClick={() =>
                    setComponents([
                      ...components,
                      { code: `D${components.length + 1}`, title: 'Đầu điểm mới', weight_pct: 10, source_type: 'MANUAL', is_mandatory: true },
                    ])
                  }
                >
                  + Thêm đầu điểm
                </Btn>
                <Btn small variant="primary" loading={savingAssess} onClick={saveAssessment}>
                  Lưu bảng đầu điểm
                </Btn>
              </>
            )}
          </div>
        }
        padded={false}
      >
        <div className="t-table-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên đầu điểm</th>
                <th className="num">Trọng số (%)</th>
                <th>Nguồn lấy điểm</th>
                <th>Bắt buộc</th>
                {canManage && <th className="actions">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {components.map((comp, idx) => (
                <tr key={idx}>
                  <td style={{ width: 96 }}>
                    <input
                      className="t-input tabular-nums"
                      aria-label={`Mã đầu điểm ${idx + 1}`}
                      value={comp.code}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx] = { ...comp, code: e.target.value.toUpperCase() };
                        setComponents(next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="t-input"
                      aria-label={`Tên đầu điểm ${idx + 1}`}
                      value={comp.title}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx] = { ...comp, title: e.target.value };
                        setComponents(next);
                      }}
                    />
                  </td>
                  <td className="num" style={{ width: 130 }}>
                    <input
                      className="t-input tabular-nums"
                      type="number"
                      min={1}
                      max={100}
                      aria-label={`Trọng số đầu điểm ${idx + 1}`}
                      value={comp.weight_pct}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx] = { ...comp, weight_pct: Number(e.target.value) };
                        setComponents(next);
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="t-input"
                      aria-label={`Nguồn điểm ${idx + 1}`}
                      value={comp.source_type}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx] = { ...comp, source_type: e.target.value as AssessmentSourceType };
                        setComponents(next);
                      }}
                    >
                      {SOURCE_OPTIONS.map((st) => (
                        <option key={st} value={st}>{label('assessmentSource', st)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Đầu điểm bắt buộc ${idx + 1}`}
                      checked={comp.is_mandatory}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx] = { ...comp, is_mandatory: e.target.checked };
                        setComponents(next);
                      }}
                    />
                  </td>
                  {canManage && (
                    <td className="actions">
                      <Btn small variant="ghost" disabled={components.length <= 1} onClick={() => setComponents(components.filter((_, i) => i !== idx))}>
                        Xóa
                      </Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ============================================================================
// 1.1.5 & 1.2.4 — ĐỀ CƯƠNG MÔN HỌC HỢP NHẤT & CHIA BUỔI HỌC MẪU
// ============================================================================

export const CourseSyllabusAndSessionPlanSection: React.FC<{ courseId: string; canManage: boolean }> = ({ courseId, canManage }) => {
  const toast = useToast();
  const sylReq = useAsync(() => masterApi.getCourseSyllabus(courseId), [courseId]);
  const profReq = useAsync(() => masterApi.getCourseTrainingProfile(courseId), [courseId]);

  const [plans, setPlans] = useState<SessionPlanItem[]>([]);
  const [savingPlans, setSavingPlans] = useState(false);

  const [quickModal, setQuickModal] = useState<null | {
    kind: 'QUESTION' | 'ASSIGNMENT' | 'RESOURCE';
    lessonId: string;
    lessonTitle: string;
  }>(null);

  // Quick-add states
  const [qPrompt, setQPrompt] = useState('');
  const [qOptA, setQOptA] = useState('');
  const [qOptB, setQOptB] = useState('');
  const [qCorrect, setQCorrect] = useState<'A' | 'B'>('A');
  const [aTitle, setATitle] = useState('');
  const [aInstructions, setAInstructions] = useState('');
  const [aRelDays, setARelDays] = useState(7);
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rUsage, setRUsage] = useState<'MANDATORY' | 'REFERENCE'>('MANDATORY');
  const [rTagText, setRTagText] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  useEffect(() => {
    if (profReq.data) setPlans(profReq.data.session_plan || []);
  }, [profReq.data]);

  if ((sylReq.loading && !sylReq.data) || (profReq.loading && !profReq.data)) return <Loading rows={5} />;
  if (sylReq.error || !sylReq.data) return <ErrorState error={sylReq.error} onRetry={sylReq.reload} />;

  const allLessons = profReq.data?.lessons || [];

  const toggleResourceUsage = async (resId: string, current: 'MANDATORY' | 'REFERENCE') => {
    const next = current === 'MANDATORY' ? 'REFERENCE' : 'MANDATORY';
    try {
      await masterApi.updateResourceUsage(resId, { usage_type: next });
      toast({ tone: 'success', title: `Đã chuyển tài liệu sang "${label('resourceUsage', next)}"` });
      sylReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không đổi được phân loại tài liệu', detail: errMsg(ex) });
    }
  };

  const submitQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickModal) return;
    setQuickBusy(true);
    try {
      if (quickModal.kind === 'QUESTION') {
        await masterApi.createQuestionBankItem({
          lesson_id: quickModal.lessonId,
          question_type: 'SINGLE_CHOICE',
          difficulty: 'MEDIUM',
          points: 1,
          prompt: qPrompt.trim(),
          options: [
            { id: 'A', text: qOptA.trim() },
            { id: 'B', text: qOptB.trim() },
          ],
          answer_key: { choice: qCorrect },
        });
        toast({ tone: 'success', title: 'Đã tạo nhanh câu hỏi & lưu vào Ngân hàng câu hỏi' });
      } else if (quickModal.kind === 'ASSIGNMENT') {
        await masterApi.createAssignmentBankItem({
          lesson_id: quickModal.lessonId,
          title: aTitle.trim(),
          instructions: aInstructions.trim() || 'Thực hiện theo yêu cầu bài học.',
          submission_type: 'MIXED',
          max_score: 10,
          relative_due_days: aRelDays,
          is_mandatory: true,
        });
        toast({ tone: 'success', title: 'Đã tạo bài tập & lưu vào Ngân hàng bài tập' });
      } else {
        await masterApi.createResourceBankItem({
          lesson_id: quickModal.lessonId,
          title: rTitle.trim(),
          url: rUrl.trim(),
          resource_type: 'LINK',
          usage_type: rUsage,
          tags: rTagText.split(',').map((t) => t.trim()).filter(Boolean),
        });
        toast({ tone: 'success', title: `Đã thêm tài liệu (${label('resourceUsage', rUsage)}) vào Ngân hàng` });
      }
      setQuickModal(null);
      setQPrompt('');
      setQOptA('');
      setQOptB('');
      setATitle('');
      setAInstructions('');
      setRTitle('');
      setRUrl('');
      setRTagText('');
      sylReq.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể thêm học liệu nhanh', detail: errMsg(ex) });
    } finally {
      setQuickBusy(false);
    }
  };

  const autoSplitSessions = async () => {
    setSavingPlans(true);
    try {
      const r = await masterApi.autoGenerateCourseSessionPlan(courseId);
      setPlans(r.items);
      toast({ tone: 'success', title: `Đã chia tự động ${r.items.length} buổi (mặc định 1 buổi = 1 bài học)` });
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể chia buổi tự động', detail: errMsg(ex) });
    } finally {
      setSavingPlans(false);
    }
  };

  const savePlans = async () => {
    setSavingPlans(true);
    try {
      const r = await masterApi.saveCourseSessionPlan(courseId, plans);
      setPlans(r.items);
      toast({ tone: 'success', title: 'Đã lưu phân bổ buổi học mẫu của môn' });
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu phân bổ buổi', detail: errMsg(ex) });
    } finally {
      setSavingPlans(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1.1.5 Đề cương môn học hợp nhất */}
      <Card
        title="Đề cương môn học (Cây Chủ đề – Chương – Bài & Ngân hàng gắn kết)"
        actions={
          <Link className="t-btn t-btn--small" to={`/teaching/banks?course_id=${courseId}`}>
            Mở toàn bộ 3 Ngân hàng cây
          </Link>
        }
      >
        <p className="t-sub" style={{ marginTop: 0 }}>
          Mỗi bài học kết nối trực tiếp với Câu hỏi, Bài tập (có hạn nộp tương đối theo buổi học) và Tài liệu (phân loại preset <strong>Bắt buộc</strong> cho chính quy hoặc <strong>Tham khảo</strong> để đọc thêm).
        </p>
        {sylReq.data.tree.length === 0 ? (
          <EmptyState title="Đề cương chưa có chủ đề/chương nào" text="Hãy tạo chương và bài học ở mục Chương & bài học trước." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sylReq.data.tree.map((tp) => (
              <div key={tp.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Tone tone="info">{tp.code}</Tone>
                  <strong style={{ fontSize: 16 }}>{tp.title}</strong>
                </div>
                {tp.chapters.map((ch) => (
                  <div key={ch.id} style={{ marginLeft: 8, marginBottom: 14 }}>
                    <strong style={{ display: 'block', fontSize: 14, marginBottom: 8, color: 'var(--text-secondary)' }}>
                      {ch.code ? `${ch.code} · ` : ''}{ch.title}
                    </strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {ch.lessons.map((les) => (
                        <div
                          key={les.id}
                          style={{
                            padding: 14,
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'var(--bg-surface-subtle)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                              <strong>{les.title}</strong>
                              <span className="t-sub tabular-nums" style={{ marginLeft: 8 }}>
                                {les.duration_minutes} phút · <Badge kind="lesson" value={les.publish_status} />
                              </span>
                            </div>
                            {canManage && (
                              <div className="t-actions">
                                <Btn small onClick={() => setQuickModal({ kind: 'QUESTION', lessonId: les.id, lessonTitle: les.title })}>+ Câu hỏi</Btn>
                                <Btn small onClick={() => setQuickModal({ kind: 'ASSIGNMENT', lessonId: les.id, lessonTitle: les.title })}>+ Bài tập</Btn>
                                <Btn small variant="primary" onClick={() => setQuickModal({ kind: 'RESOURCE', lessonId: les.id, lessonTitle: les.title })}>+ Tài liệu</Btn>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
                            <div>
                              <span className="t-sub" style={{ fontWeight: 600 }}>Câu hỏi ngân hàng ({les.questions.length})</span>
                              {les.questions.slice(0, 4).map((q) => (
                                <div key={q.id} style={{ fontSize: 13, marginTop: 4 }}>
                                  • {q.prompt} <span className="t-sub">({label('questionType', q.question_type)})</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <span className="t-sub" style={{ fontWeight: 600 }}>Bài tập mẫu ({les.assignments.length})</span>
                              {les.assignments.map((a) => (
                                <div key={a.id} style={{ fontSize: 13, marginTop: 4 }}>
                                  • {a.title}{' '}
                                  <span className="t-sub tabular-nums">
                                    ({a.relative_due_days != null ? `Hạn +${a.relative_due_days} ngày sau buổi học` : 'Không giới hạn'})
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <span className="t-sub" style={{ fontWeight: 600 }}>Tài liệu ({les.resources.length})</span>
                              {les.resources.map((r) => (
                                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, marginTop: 4 }}>
                                  <span>• {r.title}</span>
                                  <Badge kind="resourceUsage" value={r.usage_type} />
                                  {r.tags?.map((tg) => (
                                    <span key={tg} className="t-badge t-badge--neutral">{tg}</span>
                                  ))}
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="t-btn t-btn--small t-btn--ghost"
                                      onClick={() => toggleResourceUsage(r.id, r.usage_type)}
                                    >
                                      Đổi loại
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 1.2.4 Chia buổi học chuẩn của môn */}
      <Card
        title="Gợi ý phân bổ buổi học của môn (Mặc định 1 buổi = 1 bài, cho phép gộp/chỉnh)"
        actions={
          canManage && (
            <div className="t-actions">
              <Btn small loading={savingPlans} onClick={autoSplitSessions}>
                ⚡ Chia sẵn 1 buổi = 1 bài
              </Btn>
              <Btn
                small
                onClick={() =>
                  setPlans([
                    ...plans,
                    {
                      id: `tmp_${Date.now()}`,
                      session_order: plans.length + 1,
                      title: `Buổi ${plans.length + 1}`,
                      duration_minutes: 90,
                      periods_count: 2,
                      delivery_mode: 'OFFLINE',
                      required_room_type: profReq.data?.course.required_room_type || 'THEORY_ROOM',
                      lesson_ids: allLessons[0] ? [allLessons[0].id] : [],
                      lessons: [],
                      note: '',
                    },
                  ])
                }
              >
                + Thêm buổi
              </Btn>
              <Btn small variant="primary" loading={savingPlans} onClick={savePlans}>
                Lưu chia buổi
              </Btn>
            </div>
          )
        }
        padded={false}
      >
        {plans.length === 0 ? (
          <EmptyState
            title="Chưa có kịch bản chia buổi cho môn học"
            text="Nhấn 'Chia sẵn 1 buổi = 1 bài' để hệ thống tự rải các bài học thành buổi học gợi ý cho Thời khóa biểu."
          />
        ) : (
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Thứ tự</th>
                  <th>Tên buổi học</th>
                  <th className="num">Số tiết</th>
                  <th className="num">Phút</th>
                  <th>Bài học gắn trong buổi (có thể chọn nhiều bài)</th>
                  {canManage && <th className="actions">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {plans.map((sp, idx) => (
                  <tr key={sp.id || idx}>
                    <td className="tabular-nums">Buổi {idx + 1}</td>
                    <td>
                      <input
                        className="t-input"
                        aria-label={`Tên buổi học ${idx + 1}`}
                        value={sp.title}
                        disabled={!canManage}
                        onChange={(e) => {
                          const next = [...plans];
                          next[idx] = { ...sp, title: e.target.value };
                          setPlans(next);
                        }}
                      />
                    </td>
                    <td className="num" style={{ width: 96 }}>
                      <input
                        className="t-input tabular-nums"
                        type="number"
                        step="0.5"
                        min={0.5}
                        aria-label={`Số tiết buổi ${idx + 1}`}
                        value={sp.periods_count}
                        disabled={!canManage}
                        onChange={(e) => {
                          const p = Number(e.target.value);
                          const next = [...plans];
                          next[idx] = { ...sp, periods_count: p, duration_minutes: Math.round(p * 45) };
                          setPlans(next);
                        }}
                      />
                    </td>
                    <td className="num tabular-nums" style={{ width: 100 }}>{sp.duration_minutes}p</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {allLessons.map((les) => {
                          const active = (sp.lesson_ids || []).includes(les.id);
                          return (
                            <label
                              key={les.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 8px',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${active ? 'var(--accent-learning)' : 'var(--border-subtle)'}`,
                                backgroundColor: active ? 'var(--accent-learning-tint)' : 'var(--bg-surface)',
                                fontSize: 12,
                                cursor: canManage ? 'pointer' : 'default',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                disabled={!canManage}
                                onChange={(e) => {
                                  const nextIds = e.target.checked
                                    ? [...(sp.lesson_ids || []), les.id]
                                    : (sp.lesson_ids || []).filter((x) => x !== les.id);
                                  const next = [...plans];
                                  next[idx] = { ...sp, lesson_ids: nextIds };
                                  setPlans(next);
                                }}
                              />
                              <span>{les.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                    {canManage && (
                      <td className="actions">
                        <Btn small variant="ghost" onClick={() => setPlans(plans.filter((_, i) => i !== idx))}>
                          Xóa
                        </Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {quickModal && (
        <Modal
          title={
            quickModal.kind === 'QUESTION'
              ? `Thêm nhanh Câu hỏi — ${quickModal.lessonTitle}`
              : quickModal.kind === 'ASSIGNMENT'
                ? `Thêm nhanh Bài tập — ${quickModal.lessonTitle}`
                : `Thêm nhanh Tài liệu — ${quickModal.lessonTitle}`
          }
          onClose={() => setQuickModal(null)}
          footer={
            <>
              <Btn onClick={() => setQuickModal(null)}>Hủy</Btn>
              <Btn variant="primary" loading={quickBusy} onClick={submitQuickAdd}>
                Lưu vào Ngân hàng & Đề cương
              </Btn>
            </>
          }
        >
          <form onSubmit={submitQuickAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {quickModal.kind === 'QUESTION' && (
              <>
                <Field label="Nội dung câu hỏi" required>
                  <textarea className="t-input" rows={3} value={qPrompt} onChange={(e) => setQPrompt(e.target.value)} required />
                </Field>
                <Field label="Phương án A" required>
                  <input className="t-input" value={qOptA} onChange={(e) => setQOptA(e.target.value)} required />
                </Field>
                <Field label="Phương án B" required>
                  <input className="t-input" value={qOptB} onChange={(e) => setQOptB(e.target.value)} required />
                </Field>
                <Field label="Đáp án đúng">
                  <select className="t-input" value={qCorrect} onChange={(e) => setQCorrect(e.target.value as 'A' | 'B')}>
                    <option value="A">Phương án A</option>
                    <option value="B">Phương án B</option>
                  </select>
                </Field>
              </>
            )}

            {quickModal.kind === 'ASSIGNMENT' && (
              <>
                <Field label="Tên bài tập" required>
                  <input className="t-input" value={aTitle} onChange={(e) => setATitle(e.target.value)} required />
                </Field>
                <Field label="Hướng dẫn thực hiện">
                  <textarea className="t-input" rows={3} value={aInstructions} onChange={(e) => setAInstructions(e.target.value)} />
                </Field>
                <Field label="Hạn nộp tương đối (số ngày sau buổi học bài này)" hint="Khi công bố TKB, hệ thống tự quy đổi sang ngày hạn nộp cụ thể">
                  <input className="t-input tabular-nums" type="number" min={1} max={60} value={aRelDays} onChange={(e) => setARelDays(Number(e.target.value))} />
                </Field>
              </>
            )}

            {quickModal.kind === 'RESOURCE' && (
              <>
                <Field label="Tên tài liệu" required>
                  <input className="t-input" value={rTitle} onChange={(e) => setRTitle(e.target.value)} required />
                </Field>
                <Field label="Đường dẫn tài liệu (URL)" required>
                  <input className="t-input" value={rUrl} onChange={(e) => setRUrl(e.target.value)} placeholder="https://…" required />
                </Field>
                <Field label="Loại tài liệu">
                  <select className="t-input" value={rUsage} onChange={(e) => setRUsage(e.target.value as 'MANDATORY' | 'REFERENCE')}>
                    <option value="MANDATORY">Bắt buộc (Học tập chính quy)</option>
                    <option value="REFERENCE">Tham khảo (Đọc thêm)</option>
                  </select>
                </Field>
                <Field label="Tag tùy chọn (ngăn cách bằng dấu phẩy)">
                  <input className="t-input" value={rTagText} onChange={(e) => setRTagText(e.target.value)} placeholder="VD: Slide bài giảng, Sách gối đầu giường" />
                </Field>
              </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
};

// ============================================================================
// 1.2.6 — QUY TRÌNH PHÊ DUYỆT BAN HÀNH, SO SÁNH 2 PHIÊN BẢN & ĐẨY SANG LỚP ĐANG HỌC
// ============================================================================

export const CourseLifecycleAndDiffPanel: React.FC<{ course: CourseDetail; onChanged: () => void }> = ({ course, onChanged }) => {
  const toast = useToast();
  const profReq = useAsync(() => masterApi.getCourseTrainingProfile(course.id), [course.id]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('CURRENT');
  const cmpReq = useAsync(
    () => masterApi.compareCourseVersions(course.id, { from_id: fromId || undefined, to_id: toId }),
    [course.id, fromId, toId]
  );

  const [busyAction, setBusyAction] = useState(false);
  const [pushModalClass, setPushModalClass] = useState<{ id: string; code: string; title: string } | null>(null);
  const [targetVerId, setTargetVerId] = useState('');
  const [pushReason, setPushReason] = useState('Cập nhật học liệu và bài tập mới từ phiên bản ban hành');
  const [pushing, setPushing] = useState(false);

  if (profReq.loading && !profReq.data) return <Loading rows={3} />;
  if (!profReq.data) return null;

  const { lifecycle_status, version_code } = profReq.data.course;
  const { can_manage, can_approve } = profReq.data.capabilities;
  const versions = profReq.data.versions || [];

  const runLifecycle = async (action: 'SUBMIT_REVIEW' | 'APPROVE_PUBLISH' | 'RETURN_DRAFT' | 'DEPRECATE' | 'START_NEW_VERSION') => {
    setBusyAction(true);
    try {
      const r = await masterApi.transitionCourseLifecycle(course.id, { action });
      toast({
        tone: 'success',
        title: `Đã chuyển trạng thái: ${label('lifecycleStatus', r.lifecycle_status)}`,
        detail: r.version_label || r.version_code,
      });
      profReq.reload();
      cmpReq.reload();
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể chuyển trạng thái', detail: errMsg(ex) });
    } finally {
      setBusyAction(false);
    }
  };

  const confirmPushToClass = async () => {
    if (!pushModalClass || !targetVerId) return;
    setPushing(true);
    try {
      const r = await masterApi.upgradeClassVersion(pushModalClass.id, {
        target_version_id: targetVerId,
        upgrade_reason: pushReason,
        confirmed: true,
      });
      toast({ tone: 'success', title: `Đã đẩy phiên bản ${r.version_label} sang lớp ${pushModalClass.code}` });
      setPushModalClass(null);
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể nâng cấp phiên bản cho lớp', detail: errMsg(ex) });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card
        title="Quy trình Phiên bản & Ban hành (Đang biên soạn → Chờ duyệt → Đã ban hành → Ngừng áp dụng)"
        actions={<Badge kind="lifecycleStatus" value={lifecycle_status} />}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong className="tabular-nums">Mã phiên bản hiện hành: {version_code}</strong>
            <p className="t-sub" style={{ margin: '4px 0 0' }}>
              Sửa môn đã ban hành sẽ tạo phiên bản mới: lớp đang học giữ phiên bản cũ, lớp mở sau dùng phiên bản mới (có tùy chọn đẩy sang lớp đang học).
            </p>
          </div>
          <div className="t-actions">
            {can_manage && lifecycle_status === 'DRAFT' && (
              <Btn variant="primary" loading={busyAction} onClick={() => runLifecycle('SUBMIT_REVIEW')}>
                Gửi duyệt ban hành
              </Btn>
            )}
            {can_approve && (lifecycle_status === 'PENDING_APPROVAL' || lifecycle_status === 'DRAFT') && (
              <Btn variant="primary" loading={busyAction} onClick={() => runLifecycle('APPROVE_PUBLISH')}>
                ✓ Phê duyệt & Ban hành ({version_code})
              </Btn>
            )}
            {can_approve && lifecycle_status === 'PENDING_APPROVAL' && (
              <Btn loading={busyAction} onClick={() => runLifecycle('RETURN_DRAFT')}>
                Trả về biên soạn
              </Btn>
            )}
            {can_manage && lifecycle_status === 'PUBLISHED' && (
              <Btn variant="secondary" loading={busyAction} onClick={() => runLifecycle('START_NEW_VERSION')}>
                + Mở phiên bản biên soạn mới
              </Btn>
            )}
            {can_approve && lifecycle_status === 'PUBLISHED' && (
              <Btn variant="danger" loading={busyAction} onClick={() => runLifecycle('DEPRECATE')}>
                Ngừng áp dụng
              </Btn>
            )}
          </div>
        </div>
      </Card>

      {/* So sánh 2 phiên bản */}
      <Card title="So sánh thay đổi giữa 2 phiên bản (Bài thêm/bớt/sửa · Thời lượng · Học phí · Đánh giá)">
        <div className="t-toolbar" style={{ marginBottom: 16 }}>
          <Field label="Phiên bản gốc">
            <select className="t-input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">-- Bản trước gần nhất --</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{v.version_label} ({fmtDateTime(v.published_at)})</option>
              ))}
            </select>
          </Field>
          <Field label="Đối chiếu với">
            <select className="t-input" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="CURRENT">Bản hiện tại ({version_code})</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{v.version_label}</option>
              ))}
            </select>
          </Field>
        </div>

        {!cmpReq.data?.diff ? (
          <p className="t-sub">Cần ít nhất 1 phiên bản đã ban hành để so sánh sự khác biệt.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Bài học thay đổi</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                + Thêm mới: <strong>{cmpReq.data.diff.lessons_added.length}</strong> · − Lược bỏ: <strong>{cmpReq.data.diff.lessons_removed.length}</strong> · ✎ Chỉnh sửa: <strong>{cmpReq.data.diff.lessons_modified.length}</strong>
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Thời lượng (LT / TH / Tự học)</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                {cmpReq.data.diff.duration_before.theory}/{cmpReq.data.diff.duration_before.practice}/{cmpReq.data.diff.duration_before.self_study} tiết →{' '}
                <strong>{cmpReq.data.diff.duration_after.theory}/{cmpReq.data.diff.duration_after.practice}/{cmpReq.data.diff.duration_after.self_study} tiết</strong>
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Học phí tham khảo & Đầu điểm</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                {fmtMoney(cmpReq.data.diff.tuition_before)} → <strong>{fmtMoney(cmpReq.data.diff.tuition_after)}</strong> ({cmpReq.data.diff.assessment_after.length} đầu điểm)
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Tùy chọn đẩy phiên bản mới sang lớp đang học */}
      {can_manage && course.classes.length > 0 && versions.length > 0 && (
        <Card title="Tùy chọn đẩy phiên bản mới sang lớp đang học" padded={false}>
          <div className="t-table-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Lớp môn học</th>
                  <th>Trạng thái</th>
                  <th className="num">Học viên</th>
                  <th className="actions">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {course.classes.map((cls) => (
                  <tr key={cls.id}>
                    <td>
                      <strong>{cls.code}</strong>
                      <span className="t-sub">{cls.title}</span>
                    </td>
                    <td><Badge kind="class" value={cls.status} /></td>
                    <td className="num tabular-nums">{cls.student_count}</td>
                    <td className="actions">
                      <Btn
                        small
                        onClick={() => {
                          setTargetVerId(versions[0]?.id || '');
                          setPushModalClass({ id: cls.id, code: cls.code, title: cls.title });
                        }}
                      >
                        Đẩy phiên bản mới sang lớp
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pushModalClass && (
        <Modal
          title={`Đẩy phiên bản môn học sang lớp ${pushModalClass.code}`}
          onClose={() => setPushModalClass(null)}
          footer={
            <>
              <Btn onClick={() => setPushModalClass(null)}>Hủy</Btn>
              <Btn variant="primary" loading={pushing} onClick={confirmPushToClass}>
                Xác nhận nâng cấp cho lớp
              </Btn>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Chọn phiên bản ban hành đích" required>
              <select className="t-input" value={targetVerId} onChange={(e) => setTargetVerId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{v.version_label} — {v.changelog_note}</option>
                ))}
              </select>
            </Field>
            <Field label="Lý do nâng cấp (lưu lịch sử kiểm toán)" required>
              <input className="t-input" value={pushReason} onChange={(e) => setPushReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
};
