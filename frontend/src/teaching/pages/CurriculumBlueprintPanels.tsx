import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CurriculumItem,
  CurriculumServiceFeeItem,
  CurriculumStageItem,
  CurriculumStructureSubject,
  DeliveryMode,
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
  todayVn,
  useAsync,
  useToast,
} from '../ui';

const WEEKDAY_LABELS = [
  { v: 1, l: 'T2' },
  { v: 2, l: 'T3' },
  { v: 3, l: 'T4' },
  { v: 4, l: 'T5' },
  { v: 5, l: 'T6' },
  { v: 6, l: 'T7' },
  { v: 0, l: 'CN' },
];

// ============================================================================
// 1.2 KHUNG CHƯƠNG TRÌNH — HỌC PHÍ, GIAI ĐOẠN, CHIA BUỔI, TỐT NGHIỆP & BAN HÀNH
// ============================================================================

export const CurriculumBlueprintWorkspace: React.FC<{
  curriculumId: string;
  section: 'overview' | 'structure' | 'sessions' | 'lifecycle';
  onChanged: () => void;
  onOpenAddSubject?: () => void;
}> = ({ curriculumId, section, onChanged, onOpenAddSubject }) => {
  const toast = useToast();
  const req = useAsync(() => masterApi.getCurriculumBlueprint(curriculumId), [curriculumId]);

  const [programType, setProgramType] = useState<'INSTRUCTOR_LED' | 'SELF_PACED'>('INSTRUCTOR_LED');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('HYBRID');
  const [durationMonths, setDurationMonths] = useState(6);
  const [durationText, setDurationText] = useState('6 tháng');
  const [targetAudience, setTargetAudience] = useState('');
  const [entryReq, setEntryReq] = useState('');
  const [isOverridden, setIsOverridden] = useState(false);
  const [manualTuition, setManualTuition] = useState(0);

  // Điều kiện tốt nghiệp (1.2.5)
  const [passAllMandatory, setPassAllMandatory] = useState(true);
  const [minElectives, setMinElectives] = useState(0);
  const [minAvgScore, setMinAvgScore] = useState(5);
  const [minAttendancePct, setMinAttendancePct] = useState(80);
  const [extraReqsText, setExtraReqsText] = useState('');
  const [certCode, setCertCode] = useState('CERT-STD-2026');

  const [fees, setFees] = useState<CurriculumServiceFeeItem[]>([]);
  const [stages, setStages] = useState<Array<{ id?: string; code: string; title: string; stage_type: 'SEMESTER' | 'PHASE' | 'CUSTOM' }>>([]);
  const [subjects, setSubjects] = useState<CurriculumStructureSubject[]>([]);

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [coursePlans, setCoursePlans] = useState<SessionPlanItem[]>([]);

  const [fromVerId, setFromVerId] = useState('');
  const [toVerId, setToVerId] = useState('CURRENT');
  const cmpReq = useAsync(
    () => (section === 'lifecycle' ? masterApi.compareCurriculumVersions(curriculumId, { from_id: fromVerId || undefined, to_id: toVerId }) : Promise.resolve(null)),
    [curriculumId, section, fromVerId, toVerId]
  );

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req.data) return;
    const c = req.data.curriculum;
    setProgramType(c.program_type || 'INSTRUCTOR_LED');
    setDeliveryMode(c.delivery_mode || 'HYBRID');
    setDurationMonths(c.standard_duration_months || 6);
    setDurationText(c.standard_duration_text || '6 tháng');
    setTargetAudience(c.target_audience || '');
    setEntryReq(c.entry_requirements || '');
    setIsOverridden(Boolean(c.is_tuition_overridden));
    setManualTuition(c.final_tuition_fee || req.data.totals.auto_tuition_fee || 0);

    const g = c.graduation_criteria || {
      pass_all_mandatory: true,
      min_electives_passed: 0,
      min_avg_score: 5,
      min_attendance_pct: 80,
      extra_requirements: [],
      certificate_template_code: 'CERT-STD-2026',
    };
    setPassAllMandatory(g.pass_all_mandatory ?? true);
    setMinElectives(g.min_electives_passed ?? 0);
    setMinAvgScore(g.min_avg_score ?? 5);
    setMinAttendancePct(g.min_attendance_pct ?? 80);
    setExtraReqsText((g.extra_requirements || []).join('\n'));
    setCertCode(g.certificate_template_code || 'CERT-STD-2026');

    setFees(req.data.service_fees || []);
    setStages(
      (req.data.stages || []).map((st: CurriculumStageItem) => ({
        id: st.id,
        code: st.code,
        title: st.title,
        stage_type: st.stage_type,
      }))
    );
    setSubjects(req.data.subjects || []);

    const firstCourseId = selectedCourseId || req.data.subjects[0]?.course_id || '';
    setSelectedCourseId(firstCourseId);
    if (firstCourseId) {
      setCoursePlans(req.data.session_plans_by_course?.[firstCourseId] || []);
    }
  }, [req.data]);

  useEffect(() => {
    if (req.data && selectedCourseId) {
      setCoursePlans(req.data.session_plans_by_course?.[selectedCourseId] || []);
    }
  }, [selectedCourseId, req.data]);

  if (req.loading && !req.data) return <Loading rows={5} />;
  if (req.error || !req.data) return <ErrorState error={req.error} onRetry={req.reload} />;

  const data = req.data;
  const canManage = data.capabilities.can_manage;

  const saveOverviewAndGraduation = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await masterApi.saveCurriculumServiceFees(curriculumId, fees);
      await masterApi.saveCurriculumBlueprint(curriculumId, {
        program_type: programType,
        delivery_mode: deliveryMode,
        standard_duration_months: durationMonths,
        standard_duration_text: durationText,
        target_audience: targetAudience,
        entry_requirements: entryReq,
        is_tuition_overridden: isOverridden,
        final_tuition_fee: manualTuition,
        graduation_criteria: {
          pass_all_mandatory: passAllMandatory,
          min_electives_passed: minElectives,
          min_avg_score: minAvgScore,
          min_attendance_pct: minAttendancePct,
          extra_requirements: extraReqsText.split('\n').map((s) => s.trim()).filter(Boolean),
          certificate_template_code: certCode,
        },
      });
      toast({ tone: 'success', title: 'Đã lưu thông tin khung, học phí & điều kiện tốt nghiệp' });
      req.reload();
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu cấu hình khung', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const saveStagesAndStructure = async () => {
    setBusy(true);
    try {
      const stageRes = await masterApi.saveCurriculumStages(curriculumId, stages);
      const validStageIds = new Set(stageRes.stages.map((s) => s.id));
      await masterApi.saveCurriculumStructure(
        curriculumId,
        subjects.map((sub, idx) => ({
          id: sub.id,
          stage_id: sub.stage_id && validStageIds.has(sub.stage_id) ? sub.stage_id : stageRes.stages[0]?.id || null,
          semester_order: sub.semester_order || 1,
          sort_order: (idx + 1) * 10,
          planned_periods: sub.planned_periods,
          is_mandatory: sub.is_mandatory,
          prerequisite_course_ids: sub.prerequisite_course_ids || [],
          note: sub.note,
        }))
      );
      toast({ tone: 'success', title: 'Đã lưu cấu trúc giai đoạn & thứ tự môn học' });
      req.reload();
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu cấu trúc môn', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const autoSplitCourseInCurriculum = async () => {
    if (!selectedCourseId) return;
    setBusy(true);
    try {
      const r = await masterApi.autoGenerateCurriculumSessionPlan(curriculumId, selectedCourseId);
      setCoursePlans(r.items);
      toast({ tone: 'success', title: `Đã chia tự động ${r.items.length} buổi (1 buổi = 1 bài học)` });
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể chia buổi tự động', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const saveCoursePlansInCurriculum = async () => {
    if (!selectedCourseId) return;
    setBusy(true);
    try {
      const r = await masterApi.saveCurriculumSessionPlan(curriculumId, selectedCourseId, coursePlans);
      setCoursePlans(r.items);
      toast({ tone: 'success', title: 'Đã lưu phân bổ buổi học trong Khung chương trình' });
      req.reload();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể lưu chia buổi', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  const runLifecycle = async (action: 'SUBMIT_REVIEW' | 'APPROVE_PUBLISH' | 'RETURN_DRAFT' | 'DEPRECATE' | 'START_NEW_VERSION') => {
    setBusy(true);
    try {
      const r = await masterApi.transitionCurriculumLifecycle(curriculumId, { action });
      toast({
        tone: 'success',
        title: `Trạng thái Khung chương trình: ${label('lifecycleStatus', r.lifecycle_status)}`,
        detail: r.version_label || r.version,
      });
      req.reload();
      cmpReq.reload();
      onChanged();
    } catch (ex) {
      toast({ tone: 'error', title: 'Không thể chuyển trạng thái khung', detail: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };

  if (section === 'overview') {
    return (
      <form onSubmit={saveOverviewAndGraduation} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="t-stats">
          <div className="t-stat">
            <span className="t-stat__label">Loại khung & Hình thức</span>
            <strong className="t-stat__value" style={{ fontSize: 17 }}>{label('programType', programType)}</strong>
            <span className="t-stat__hint">{label('delivery', deliveryMode)} · {durationText}</span>
          </div>
          <div className="t-stat">
            <span className="t-stat__label">Tổng thời lượng toàn khung</span>
            <strong className="t-stat__value tabular-nums">{data.totals.total_periods} tiết</strong>
            <span className="t-stat__hint tabular-nums">{data.totals.total_hours} giờ ({data.totals.mandatory_count} bắt buộc · {data.totals.elective_count} tự chọn)</span>
          </div>
          <div className="t-stat">
            <span className="t-stat__label">Học phí tự động cộng</span>
            <strong className="t-stat__value tabular-nums" style={{ fontSize: 18 }}>{fmtMoney(data.totals.auto_tuition_fee)}</strong>
            <span className="t-stat__hint tabular-nums">Môn: {fmtMoney(data.totals.subjects_tuition)} + Dịch vụ: {fmtMoney(data.totals.services_tuition)}</span>
          </div>
          <div className="t-stat">
            <span className="t-stat__label">Học phí áp dụng tuyển sinh</span>
            <strong className="t-stat__value tabular-nums" style={{ fontSize: 18 }}>{fmtMoney(isOverridden ? manualTuition : data.totals.auto_tuition_fee)}</strong>
            <span className="t-stat__hint"><Badge kind="lifecycleStatus" value={data.curriculum.lifecycle_status} /></span>
          </div>
        </div>

        {/* 1.2.1 Thông tin chung */}
        <Card title="Thông tin chung & Đối tượng đầu vào">
          <div className="t-form-grid">
            <Field label="Loại khung chương trình (EL-Q4)">
              <select className="t-input" value={programType} onChange={(e) => setProgramType(e.target.value as 'INSTRUCTOR_LED' | 'SELF_PACED')} disabled={!canManage}>
                <option value="INSTRUCTOR_LED">Có lớp & Có giảng viên hướng dẫn</option>
                <option value="SELF_PACED">Tự học trực tuyến (Self-paced EL-Q4)</option>
              </select>
            </Field>
            <Field label="Hình thức tổ chức">
              <select className="t-input" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)} disabled={!canManage}>
                <option value="OFFLINE">Trực tiếp tại cơ sở</option>
                <option value="ONLINE">Trực tuyến 100%</option>
                <option value="HYBRID">Kết hợp (Hybrid)</option>
              </select>
            </Field>
            <Field label="Số tháng đào tạo chuẩn">
              <input className="t-input tabular-nums" type="number" step="0.5" min={0.5} max={60} value={durationMonths} onChange={(e) => setDurationMonths(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Nhãn thời gian đào tạo chuẩn">
              <input className="t-input" value={durationText} onChange={(e) => setDurationText(e.target.value)} disabled={!canManage} placeholder="VD: 6 tháng (3 buổi/tuần)" />
            </Field>
            <Field label="Đối tượng đầu vào" wide>
              <input className="t-input" value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} disabled={!canManage} placeholder="VD: Sinh viên năm 1-4, người đi làm trái ngành..." />
            </Field>
            <Field label="Điều kiện đầu vào" wide>
              <textarea className="t-input" rows={2} value={entryReq} onChange={(e) => setEntryReq(e.target.value)} disabled={!canManage} placeholder="VD: Vượt qua bài kiểm tra tư duy logic đầu vào hoặc có máy tính cá nhân..." />
            </Field>
          </div>
        </Card>

        {/* 1.2.2 Dịch vụ kèm theo & Học phí */}
        <Card
          title="Dịch vụ kèm theo & Học phí trọn gói"
          actions={
            canManage && (
              <Btn
                small
                onClick={() =>
                  setFees([
                    ...fees,
                    { code: `PHI-${fees.length + 1}`, title: 'Phí học liệu & tài khoản Lab', amount: 300000, is_mandatory: true },
                  ])
                }
              >
                + Thêm khoản phí dịch vụ
              </Btn>
            )
          }
        >
          {fees.length === 0 ? (
            <p className="t-sub">Chưa có phí dịch vụ kèm theo (VD: Phí học liệu, phí đồng phục, lệ phí cấp chứng chỉ).</p>
          ) : (
            <div className="t-table-wrap" style={{ marginBottom: 16 }}>
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Mã phí</th>
                    <th>Tên dịch vụ / khoản phí kèm theo</th>
                    <th className="num">Mức phí (VNĐ)</th>
                    <th>Tính vào học phí chuẩn</th>
                    {canManage && <th className="actions">Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {fees.map((f, idx) => (
                    <tr key={idx}>
                      <td style={{ width: 120 }}>
                        <input
                          className="t-input tabular-nums"
                          aria-label={`Mã phí ${idx + 1}`}
                          value={f.code}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...fees];
                            next[idx] = { ...f, code: e.target.value.toUpperCase() };
                            setFees(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="t-input"
                          aria-label={`Tên dịch vụ ${idx + 1}`}
                          value={f.title}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...fees];
                            next[idx] = { ...f, title: e.target.value };
                            setFees(next);
                          }}
                        />
                      </td>
                      <td className="num" style={{ width: 180 }}>
                        <input
                          className="t-input tabular-nums"
                          type="number"
                          min={0}
                          step={50000}
                          aria-label={`Số tiền phí ${idx + 1}`}
                          value={f.amount}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...fees];
                            next[idx] = { ...f, amount: Number(e.target.value) };
                            setFees(next);
                          }}
                        />
                      </td>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44 }}>
                          <input
                            type="checkbox"
                            checked={f.is_mandatory}
                            disabled={!canManage}
                            onChange={(e) => {
                              const next = [...fees];
                              next[idx] = { ...f, is_mandatory: e.target.checked };
                              setFees(next);
                            }}
                          />
                          <span>{f.is_mandatory ? 'Bắt buộc' : 'Tùy chọn'}</span>
                        </label>
                      </td>
                      {canManage && (
                        <td className="actions">
                          <Btn small variant="ghost" onClick={() => setFees(fees.filter((_, i) => i !== idx))}>Xóa</Btn>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="t-form-grid">
            <Field label="Chế độ tính học phí toàn khung">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: canManage ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={isOverridden} onChange={(e) => setIsOverridden(e.target.checked)} disabled={!canManage} />
                <span>Chỉnh sửa học phí trọn gói thủ công (thay cho tổng tự động {fmtMoney(data.totals.auto_tuition_fee)})</span>
              </label>
            </Field>
            {isOverridden && (
              <Field label="Học phí áp dụng sau điều chỉnh (VNĐ)">
                <input className="t-input tabular-nums" type="number" min={0} step={100000} value={manualTuition} onChange={(e) => setManualTuition(Number(e.target.value))} disabled={!canManage} />
              </Field>
            )}
          </div>
        </Card>

        {/* 1.2.5 Điều kiện tốt nghiệp & Mẫu chứng chỉ */}
        <Card title="Điều kiện tốt nghiệp & Mẫu chứng nhận hoàn thành">
          <div className="t-form-grid">
            <Field label="Môn bắt buộc">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                <input type="checkbox" checked={passAllMandatory} onChange={(e) => setPassAllMandatory(e.target.checked)} disabled={!canManage} />
                <span>Phải đạt 100% các môn học bắt buộc trong khung</span>
              </label>
            </Field>
            <Field label="Số môn tự chọn tối thiểu cần đạt">
              <input className="t-input tabular-nums" type="number" min={0} max={20} value={minElectives} onChange={(e) => setMinElectives(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Điểm trung bình tích lũy tối thiểu (thang 10)">
              <input className="t-input tabular-nums" type="number" step="0.1" min={0} max={10} value={minAvgScore} onChange={(e) => setMinAvgScore(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Chuyên cần tối thiểu toàn khóa (%)">
              <input className="t-input tabular-nums" type="number" min={0} max={100} value={minAttendancePct} onChange={(e) => setMinAttendancePct(Number(e.target.value))} disabled={!canManage} />
            </Field>
            <Field label="Mẫu chứng nhận / chứng chỉ hoàn thành (Biểu mẫu)" wide>
              <select className="t-input" value={certCode} onChange={(e) => setCertCode(e.target.value)} disabled={!canManage}>
                {data.certificate_templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.code}>{tpl.code} — {tpl.title} ({tpl.issuer_name})</option>
                ))}
              </select>
            </Field>
            <Field label="Điều kiện bổ sung (mỗi dòng 1 điều kiện — VD: Đạt dự án cuối khóa)" wide>
              <textarea className="t-input" rows={3} value={extraReqsText} onChange={(e) => setExtraReqsText(e.target.value)} disabled={!canManage} placeholder="VD: Bảo vệ thành công đồ án tốt nghiệp Fullstack >= 7.0" />
            </Field>
          </div>

          {canManage && (
            <div style={{ marginTop: 16 }}>
              <Btn type="submit" variant="primary" loading={busy}>
                Lưu toàn bộ cấu hình Khung chương trình
              </Btn>
            </div>
          )}
        </Card>
      </form>
    );
  }

  if (section === 'structure') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {data.prerequisite_warnings.length > 0 && (
          <div className="m-semantic-notice" data-tone="warning" role="alert">
            <div>
              <strong>Cảnh báo thứ tự môn tiên quyết trong Khung ({data.prerequisite_warnings.length}):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {data.prerequisite_warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <Card
          title="Nhóm / Giai đoạn học tập (Học kỳ hoặc Đại cương – Chuyên ngành – Thực tập)"
          actions={
            canManage && (
              <div className="t-actions">
                <Btn
                  small
                  onClick={() =>
                    setStages([
                      ...stages,
                      { code: `GD${stages.length + 1}`, title: `Giai đoạn ${stages.length + 1}`, stage_type: 'PHASE' },
                    ])
                  }
                >
                  + Thêm giai đoạn
                </Btn>
                <Btn small variant="primary" loading={busy} onClick={saveStagesAndStructure}>
                  Lưu giai đoạn & thứ tự môn
                </Btn>
              </div>
            )
          }
        >
          {stages.length === 0 ? (
            <p className="t-sub">Chưa chia giai đoạn. Nhấn "+ Thêm giai đoạn" để chia theo Học kỳ hoặc Đại cương – Chuyên ngành – Thực tập.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {stages.map((st, idx) => {
                const summary = data.stages.find((x) => x.id === st.id);
                return (
                  <div key={st.id || idx} style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <input
                        className="t-input tabular-nums"
                        style={{ width: 84 }}
                        aria-label={`Mã giai đoạn ${idx + 1}`}
                        value={st.code}
                        disabled={!canManage}
                        onChange={(e) => {
                          const next = [...stages];
                          next[idx] = { ...st, code: e.target.value.toUpperCase() };
                          setStages(next);
                        }}
                      />
                      <select
                        className="t-input"
                        aria-label={`Loại giai đoạn ${idx + 1}`}
                        value={st.stage_type}
                        disabled={!canManage}
                        onChange={(e) => {
                          const next = [...stages];
                          next[idx] = { ...st, stage_type: e.target.value as 'SEMESTER' | 'PHASE' | 'CUSTOM' };
                          setStages(next);
                        }}
                      >
                        <option value="PHASE">Giai đoạn</option>
                        <option value="SEMESTER">Học kỳ</option>
                        <option value="CUSTOM">Tùy chỉnh</option>
                      </select>
                      {canManage && (
                        <Btn small variant="ghost" onClick={() => setStages(stages.filter((_, i) => i !== idx))}>×</Btn>
                      )}
                    </div>
                    <input
                      className="t-input"
                      aria-label={`Tên giai đoạn ${idx + 1}`}
                      value={st.title}
                      disabled={!canManage}
                      onChange={(e) => {
                        const next = [...stages];
                        next[idx] = { ...st, title: e.target.value };
                        setStages(next);
                      }}
                    />
                    {summary && (
                      <span className="t-sub tabular-nums" style={{ display: 'block', marginTop: 8 }}>
                        Tổng nhóm: {summary.subjects_count} môn · {summary.total_periods} tiết ({summary.total_hours} giờ)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Cấu trúc môn học, Thứ tự học & Tiên quyết trong Khung"
          actions={
            canManage && (
              <div className="t-actions">
                {onOpenAddSubject && <Btn small onClick={onOpenAddSubject}>+ Thêm môn vào khung</Btn>}
                <Btn small variant="primary" loading={busy} onClick={saveStagesAndStructure}>Lưu thứ tự & tiên quyết</Btn>
              </div>
            )
          }
          padded={false}
        >
          {subjects.length === 0 ? (
            <EmptyState title="Chưa có môn học nào trong khung" />
          ) : (
            <div className="t-table-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Thứ tự</th>
                    <th>Giai đoạn / Học kỳ</th>
                    <th>Môn học</th>
                    <th className="num">Số tiết</th>
                    <th className="num">Học phí môn</th>
                    <th>Loại</th>
                    <th>Môn tiên quyết trong khung</th>
                    {canManage && <th className="actions">Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((sub, idx) => (
                    <tr key={sub.id}>
                      <td className="tabular-nums">#{idx + 1}</td>
                      <td>
                        <select
                          className="t-input"
                          aria-label={`Giai đoạn của ${sub.course_code}`}
                          value={sub.stage_id || ''}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...subjects];
                            next[idx] = { ...sub, stage_id: e.target.value || null };
                            setSubjects(next);
                          }}
                        >
                          <option value="">-- Chưa gắn giai đoạn --</option>
                          {data.stages.map((st) => (
                            <option key={st.id} value={st.id}>{st.code} · {st.title}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Link className="t-row-link" to={`/teaching/courses/${sub.course_id}`}>
                          <strong>{sub.course_code} — {sub.course_title}</strong>
                        </Link>
                        <span className="t-sub">{label('roomType', sub.required_room_type)}</span>
                      </td>
                      <td className="num" style={{ width: 105 }}>
                        <input
                          className="t-input tabular-nums"
                          type="number"
                          min={1}
                          aria-label={`Số tiết ${sub.course_code}`}
                          value={sub.planned_periods}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...subjects];
                            next[idx] = { ...sub, planned_periods: Number(e.target.value) };
                            setSubjects(next);
                          }}
                        />
                      </td>
                      <td className="num tabular-nums">{fmtMoney(sub.reference_tuition_fee)}</td>
                      <td>
                        <select
                          className="t-input"
                          aria-label={`Tính chất môn ${sub.course_code}`}
                          value={sub.is_mandatory ? '1' : '0'}
                          disabled={!canManage}
                          onChange={(e) => {
                            const next = [...subjects];
                            next[idx] = { ...sub, is_mandatory: e.target.value === '1' };
                            setSubjects(next);
                          }}
                        >
                          <option value="1">Bắt buộc</option>
                          <option value="0">Tự chọn</option>
                        </select>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {subjects
                            .filter((other) => other.course_id !== sub.course_id)
                            .map((other) => {
                              const checked = (sub.prerequisite_course_ids || []).includes(other.course_id);
                              return (
                                <label
                                  key={other.course_id}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '2px 8px',
                                    borderRadius: 'var(--radius-pill)',
                                    border: `1px solid ${checked ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                                    backgroundColor: checked ? 'var(--brand-tint)' : 'var(--bg-surface)',
                                    fontSize: 12,
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!canManage}
                                    onChange={(e) => {
                                      const nextIds = e.target.checked
                                        ? [...(sub.prerequisite_course_ids || []), other.course_id]
                                        : (sub.prerequisite_course_ids || []).filter((x) => x !== other.course_id);
                                      const next = [...subjects];
                                      next[idx] = { ...sub, prerequisite_course_ids: nextIds };
                                      setSubjects(next);
                                    }}
                                  />
                                  <span>{other.course_code}</span>
                                </label>
                              );
                            })}
                        </div>
                      </td>
                      {canManage && (
                        <td className="actions">
                          <div className="t-actions">
                            <Btn
                              small
                              variant="ghost"
                              disabled={idx === 0}
                              onClick={() => {
                                const next = [...subjects];
                                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                setSubjects(next);
                              }}
                            >
                              ↑
                            </Btn>
                            <Btn
                              small
                              variant="ghost"
                              disabled={idx === subjects.length - 1}
                              onClick={() => {
                                const next = [...subjects];
                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                setSubjects(next);
                              }}
                            >
                              ↓
                            </Btn>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (section === 'sessions') {
    return (
      <Card
        title="Chia buổi học theo từng môn trong Khung (Mặc định 1 buổi = 1 bài học)"
        actions={
          canManage && selectedCourseId && (
            <div className="t-actions">
              <Btn small loading={busy} onClick={autoSplitCourseInCurriculum}>⚡ Chia sẵn 1 buổi = 1 bài</Btn>
              <Btn small variant="primary" loading={busy} onClick={saveCoursePlansInCurriculum}>Lưu chia buổi</Btn>
            </div>
          )
        }
      >
        {subjects.length === 0 ? (
          <EmptyState title="Khung chương trình chưa có môn học nào để chia buổi" />
        ) : (
          <>
            <div className="t-toolbar" style={{ marginBottom: 16 }}>
              <Field label="Chọn môn học trong khung">
                <select className="t-input" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                  {subjects.map((s) => (
                    <option key={s.course_id} value={s.course_id}>{s.course_code} — {s.course_title}</option>
                  ))}
                </select>
              </Field>
            </div>

            {coursePlans.length === 0 ? (
              <EmptyState
                title="Môn học này chưa có cấu hình chia buổi riêng trong khung"
                text="Nhấn 'Chia sẵn 1 buổi = 1 bài' để sinh tự động từ đề cương môn học, sau đó có thể gộp/tách và chỉnh thời lượng."
              />
            ) : (
              <div className="t-table-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Buổi</th>
                      <th>Nội dung buổi học</th>
                      <th className="num">Số tiết</th>
                      <th className="num">Thời lượng (phút)</th>
                      <th>Bài học liên kết</th>
                      {canManage && <th className="actions">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {coursePlans.map((sp, idx) => (
                      <tr key={sp.id || idx}>
                        <td className="tabular-nums">Buổi {idx + 1}</td>
                        <td>
                          <input
                            className="t-input"
                            aria-label={`Tên buổi ${idx + 1}`}
                            value={sp.title}
                            disabled={!canManage}
                            onChange={(e) => {
                              const next = [...coursePlans];
                              next[idx] = { ...sp, title: e.target.value };
                              setCoursePlans(next);
                            }}
                          />
                        </td>
                        <td className="num" style={{ width: 110 }}>
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
                              const next = [...coursePlans];
                              next[idx] = { ...sp, periods_count: p, duration_minutes: Math.round(p * 45) };
                              setCoursePlans(next);
                            }}
                          />
                        </td>
                        <td className="num tabular-nums">{sp.duration_minutes} phút</td>
                        <td>
                          {(sp.lessons || []).length > 0
                            ? sp.lessons.map((l) => l.title).join(' + ')
                            : `${(sp.lesson_ids || []).length} bài học`}
                        </td>
                        {canManage && (
                          <td className="actions">
                            <div className="t-actions">
                              {idx > 0 && (
                                <Btn
                                  small
                                  variant="ghost"
                                  onClick={() => {
                                    const prev = coursePlans[idx - 1];
                                    const mergedIds = [...new Set([...(prev.lesson_ids || []), ...(sp.lesson_ids || [])])];
                                    const next = [...coursePlans];
                                    next[idx - 1] = {
                                      ...prev,
                                      title: `${prev.title} & ${sp.title}`,
                                      periods_count: Number(prev.periods_count) + Number(sp.periods_count),
                                      duration_minutes: Number(prev.duration_minutes) + Number(sp.duration_minutes),
                                      lesson_ids: mergedIds,
                                    };
                                    next.splice(idx, 1);
                                    setCoursePlans(next);
                                  }}
                                >
                                  Gộp lên buổi trên
                                </Btn>
                              )}
                              <Btn small variant="ghost" onClick={() => setCoursePlans(coursePlans.filter((_, i) => i !== idx))}>
                                Xóa
                              </Btn>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    );
  }

  // section === 'lifecycle'
  const lc = data.curriculum.lifecycle_status;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card
        title="Phiên bản & Ban hành Khung chương trình (Chỉ Khung Đã ban hành mới mở được lớp)"
        actions={<Badge kind="lifecycleStatus" value={lc} />}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong className="tabular-nums">Phiên bản hiện tại: {data.curriculum.version}</strong>
            <p className="t-sub" style={{ margin: '4px 0 0' }}>
              Khi sửa Khung đã ban hành, hệ thống tạo phiên bản mới: các khóa đang học giữ nguyên bản cũ, khóa mở mới áp dụng bản mới.
            </p>
          </div>
          {canManage && (
            <div className="t-actions">
              {lc === 'DRAFT' && (
                <Btn variant="primary" loading={busy} onClick={() => runLifecycle('SUBMIT_REVIEW')}>
                  Gửi duyệt ban hành
                </Btn>
              )}
              {(lc === 'PENDING_APPROVAL' || lc === 'DRAFT') && (
                <Btn variant="primary" loading={busy} onClick={() => runLifecycle('APPROVE_PUBLISH')}>
                  ✓ Ban hành chính thức ({data.curriculum.version})
                </Btn>
              )}
              {lc === 'PENDING_APPROVAL' && (
                <Btn loading={busy} onClick={() => runLifecycle('RETURN_DRAFT')}>
                  Trả về biên soạn
                </Btn>
              )}
              {lc === 'PUBLISHED' && (
                <>
                  <Btn variant="secondary" loading={busy} onClick={() => runLifecycle('START_NEW_VERSION')}>
                    + Mở phiên bản mới
                  </Btn>
                  <Btn variant="danger" loading={busy} onClick={() => runLifecycle('DEPRECATE')}>
                    Ngừng áp dụng
                  </Btn>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="So sánh hai phiên bản Khung chương trình">
        <div className="t-toolbar" style={{ marginBottom: 16 }}>
          <Field label="Phiên bản trước">
            <select className="t-input" value={fromVerId} onChange={(e) => setFromVerId(e.target.value)}>
              <option value="">-- Bản ban hành gần nhất --</option>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>{v.version_label} ({fmtDateTime(v.published_at)})</option>
              ))}
            </select>
          </Field>
          <Field label="Đối chiếu với">
            <select className="t-input" value={toVerId} onChange={(e) => setToVerId(e.target.value)}>
              <option value="CURRENT">Bản hiện tại ({data.curriculum.version})</option>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>{v.version_label}</option>
              ))}
            </select>
          </Field>
        </div>

        {!cmpReq.data?.diff ? (
          <p className="t-sub">Cần ít nhất 1 phiên bản đã ban hành để đối chiếu thay đổi.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Môn học thêm / bớt / sửa</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                + Thêm: <strong>{cmpReq.data.diff.subjects_added.length}</strong> · − Bớt: <strong>{cmpReq.data.diff.subjects_removed.length}</strong> · ✎ Đổi tiết: <strong>{cmpReq.data.diff.subjects_changed.length}</strong>
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Tổng thời lượng</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                {cmpReq.data.diff.periods_before} tiết → <strong>{cmpReq.data.diff.periods_after} tiết</strong>
              </p>
            </div>
            <div style={{ padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong>Học phí & Tốt nghiệp</strong>
              <p className="t-sub tabular-nums" style={{ margin: '6px 0 0' }}>
                {fmtMoney(cmpReq.data.diff.tuition_before)} → <strong>{fmtMoney(cmpReq.data.diff.tuition_after)}</strong>
                {cmpReq.data.diff.graduation_changed ? ' · Có đổi chuẩn tốt nghiệp' : ''}
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

// ============================================================================
// 1.3.1 WIZARD KHỞI TẠO KHÓA HỌC 5 BƯỚC TỪ KHUNG CHƯƠNG TRÌNH ĐÃ BAN HÀNH
// ============================================================================

export const CohortInitializeWizardModal: React.FC<{
  defaultCurriculumId?: string;
  onClose: () => void;
  onInitialized: (cohortId: string, title: string) => void;
}> = ({ defaultCurriculumId = '', onClose, onInitialized }) => {
  const toast = useToast();
  const curriculaReq = useAsync(() => masterApi.listCurricula({ status: 'ACTIVE', page_size: 100 }), []);
  const facilitiesReq = useAsync(() => masterApi.getFacilitiesOverview(), []);

  const publishedCurricula = (curriculaReq.data?.items || []).filter(
    (c: CurriculumItem) => c.status === 'ACTIVE' && (c.lifecycle_status || 'PUBLISHED') === 'PUBLISHED'
  );

  const [curriculumId, setCurriculumId] = useState(defaultCurriculumId);
  const effectiveCurrId = curriculumId || publishedCurricula[0]?.id || '';
  const bpReq = useAsync(
    () => (effectiveCurrId ? masterApi.getCurriculumBlueprint(effectiveCurrId) : Promise.resolve(null)),
    [effectiveCurrId]
  );

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(todayVn(7));
  const [endDate, setEndDate] = useState(todayVn(180));
  const [maxStudents, setMaxStudents] = useState(30);
  const [campusId, setCampusId] = useState('cp_cs1');
  const [recurrenceMode, setRecurrenceMode] = useState<'WEEKLY' | 'MONTHLY' | 'UNSCHEDULED'>('WEEKLY');
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [monthDaysText, setMonthDaysText] = useState('5, 15, 25');
  const [startTime, setStartTime] = useState('18:30');
  const [endTime, setEndTime] = useState('20:30');
  const [instructorOverrides, setInstructorOverrides] = useState<Record<string, string>>({});
  const [roomTypeOverrides, setRoomTypeOverrides] = useState<Record<string, RoomType>>({});
  const [studentCodesText, setStudentCodesText] = useState('');
  const [publishNow, setPublishNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveCurrId) {
      setErr('Cần có ít nhất 1 Khung chương trình ở trạng thái "Đã ban hành" để mở lớp.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const classConfigs: Record<string, Record<string, unknown>> = {};
      for (const s of bpReq.data?.subjects || []) {
        classConfigs[s.course_id] = {
          instructor_id: instructorOverrides[s.course_id] || undefined,
          required_room_type: roomTypeOverrides[s.course_id] || s.required_room_type || 'THEORY_ROOM',
        };
      }

      const quickSchedule =
        recurrenceMode === 'UNSCHEDULED'
          ? { enabled: false }
          : {
              enabled: true,
              recurrence_mode: recurrenceMode,
              weekdays,
              month_days: monthDaysText.split(',').map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= 31),
              start_time: startTime,
              end_time: endTime,
            };

      const res = await masterApi.initializeCohortWizard({
        curriculum_id: effectiveCurrId,
        code: code.trim(),
        title: title.trim(),
        start_date: startDate,
        end_date: endDate || undefined,
        max_students: maxStudents,
        campus_id: campusId,
        publish_schedule: publishNow,
        quick_schedule: quickSchedule,
        class_configs: classConfigs,
        student_identifiers: studentCodesText
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });

      toast({
        tone: 'success',
        title: `Đã khởi tạo Khóa học ${res.code} (${res.classes.length} lớp môn · ${res.sessions_created} buổi)`,
        detail: publishNow
          ? `Đã công bố TKB & quy đổi hạn nộp cho ${res.assignments_due_resolved} bài tập.`
          : 'Các buổi học đã sinh ở Bản nháp/Khay chờ xếp lịch để điều phối thêm trên Thời khóa biểu.',
      });
      onInitialized(res.cohort_id, res.title);
    } catch (ex) {
      setErr(errMsg(ex));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Khởi tạo Khóa học 5 bước từ Khung chương trình Đã ban hành"
      onClose={onClose}
      width={820}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Hủy</Btn>
          <Btn variant="primary" type="submit" form="cohort-wiz-form" loading={busy}>
            🚀 Mở Khóa học & Sinh Lớp môn
          </Btn>
        </>
      }
    >
      {publishedCurricula.length === 0 && !curriculaReq.loading ? (
        <EmptyState
          title="Chưa có Khung chương trình Đã ban hành"
          text="Chỉ Khung chương trình ở trạng thái 'Đã ban hành' mới được mở khóa học. Vui lòng ban hành Khung chương trình trước."
        />
      ) : (
        <form id="cohort-wiz-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="t-form-grid">
            <Field label="Bước 1: Chọn Khung chương trình Đã ban hành" required wide>
              <select className="t-input" value={effectiveCurrId} onChange={(e) => setCurriculumId(e.target.value)}>
                {publishedCurricula.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title} ({c.version} · {c.subjects_count} môn · {fmtMoney(c.final_tuition_fee || 0)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mã khóa học" required hint="VD: FS-K02-2026">
              <input className="t-input" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} />
            </Field>
            <Field label="Sĩ số tối đa">
              <input className="t-input tabular-nums" type="number" min={5} max={500} value={maxStudents} onChange={(e) => setMaxStudents(Number(e.target.value))} />
            </Field>
            <Field label="Tên khóa học / Lớp khóa học" required wide>
              <input className="t-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="VD: Khóa Lập trình Fullstack K02 — Tối 2-4-6" />
            </Field>
            <Field label="Ngày khai giảng">
              <input className="t-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ngày bế giảng dự kiến">
              <input className="t-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Cơ sở đào tạo mặc định" wide>
              <select className="t-input" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
                {(facilitiesReq.data?.campuses || []).map((cp) => (
                  <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Bước 2 & 3: Preview Lớp môn tự sinh + Phân công GV & Loại phòng */}
          {bpReq.data && bpReq.data.subjects.length > 0 && (
            <div style={{ padding: 14, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>
                Bước 2 & 3: Tự động tạo {bpReq.data.subjects.length} Lớp môn học, sao chép Snapshot học liệu/bài tập/đầu điểm & gợi ý số buổi
              </strong>
              <div className="t-table-wrap" style={{ marginTop: 8 }}>
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Môn học</th>
                      <th className="num">Số buổi gợi ý</th>
                      <th>Giảng viên chính</th>
                      <th>Loại phòng yêu cầu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bpReq.data.subjects.map((s) => {
                      const planCount = bpReq.data?.session_plans_by_course?.[s.course_id]?.length || 0;
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.course_code}</strong> — {s.course_title}
                          </td>
                          <td className="num tabular-nums">{planCount || 'Tự động theo bài'}</td>
                          <td>
                            <select
                              className="t-input"
                              aria-label={`Giảng viên cho ${s.course_code}`}
                              value={instructorOverrides[s.course_id] || ''}
                              onChange={(e) => setInstructorOverrides({ ...instructorOverrides, [s.course_id]: e.target.value })}
                            >
                              <option value="">-- Mặc định GV phụ trách môn --</option>
                              {(facilitiesReq.data?.instructors || []).map((ins) => (
                                <option key={ins.id} value={ins.id}>{ins.full_name} ({ins.code})</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="t-input"
                              aria-label={`Loại phòng cho ${s.course_code}`}
                              value={roomTypeOverrides[s.course_id] || s.required_room_type || 'THEORY_ROOM'}
                              onChange={(e) => setRoomTypeOverrides({ ...roomTypeOverrides, [s.course_id]: e.target.value as RoomType })}
                            >
                              <option value="THEORY_ROOM">Phòng lý thuyết</option>
                              <option value="COMPUTER_LAB">Phòng máy</option>
                              <option value="ONLINE">Trực tuyến</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bước 4 & 5: Xếp thời gian nhanh + Quy đổi hạn nộp tương đối */}
          <div style={{ padding: 14, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>
              Bước 4 & 5: Lên Thời khóa biểu nhanh (tự né ngày nghỉ lễ) & Chốt hạn nộp bài tập
            </strong>
            <div className="t-form-grid">
              <Field label="Chế độ rải lịch buổi học" wide>
                <select className="t-input" value={recurrenceMode} onChange={(e) => setRecurrenceMode(e.target.value as 'WEEKLY' | 'MONTHLY' | 'UNSCHEDULED')}>
                  <option value="WEEKLY">Lặp nhanh theo Tuần (chọn các Thứ cố định)</option>
                  <option value="MONTHLY">Lặp nhanh theo Tháng (chọn các ngày trong tháng)</option>
                  <option value="UNSCHEDULED">Đưa vào Khay chờ xếp lịch để kéo thả trên bảng Thời khóa biểu</option>
                </select>
              </Field>

              {recurrenceMode === 'WEEKLY' && (
                <Field label="Các ngày học trong tuần" wide>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {WEEKDAY_LABELS.map((w) => {
                      const active = weekdays.includes(w.v);
                      return (
                        <button
                          key={w.v}
                          type="button"
                          className={`t-btn t-btn--small ${active ? 't-btn--primary' : ''}`}
                          onClick={() =>
                            setWeekdays((prev) => (prev.includes(w.v) ? prev.filter((x) => x !== w.v) : [...prev, w.v]))
                          }
                        >
                          {w.l}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}

              {recurrenceMode === 'MONTHLY' && (
                <Field label="Các ngày trong tháng (phân cách bằng dấu phẩy)" wide>
                  <input className="t-input tabular-nums" value={monthDaysText} onChange={(e) => setMonthDaysText(e.target.value)} placeholder="VD: 5, 15, 25" />
                </Field>
              )}

              {recurrenceMode !== 'UNSCHEDULED' && (
                <>
                  <Field label="Giờ bắt đầu ca học">
                    <input className="t-input tabular-nums" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </Field>
                  <Field label="Giờ kết thúc ca học">
                    <input className="t-input tabular-nums" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </Field>
                </>
              )}

              <Field label="Ghi danh học viên ban đầu (tùy chọn — nhập mã hoặc email, cách nhau dấu phẩy/xuống dòng)" wide>
                <textarea className="t-input" rows={2} value={studentCodesText} onChange={(e) => setStudentCodesText(e.target.value)} placeholder="VD: HS50101, HS50102..." />
              </Field>

              {recurrenceMode !== 'UNSCHEDULED' && (
                <Field label="Công bố Thời khóa biểu ngay" wide>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: 'pointer' }}>
                    <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                    <span>Công bố ngay cho Giảng viên/Học viên và tự động quy đổi hạn nộp tương đối của bài tập ra ngày cụ thể</span>
                  </label>
                </Field>
              )}
            </div>
          </div>

          {err && <p className="t-field__error" role="alert">{err}</p>}
        </form>
      )}
    </Modal>
  );
};
