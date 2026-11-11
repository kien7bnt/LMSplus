import React, { useEffect, useState } from 'react';
import { normalizeImageUrl } from '../../../../shared/imageUrl.mjs';
import { Course, CourseStatus, teachingApi } from '../api';
import { Btn, Field, ImageUrlInput, Modal, errMsg, useToast } from '../ui';
import { ApiHttpError } from '../../api/elearningClient';

type FormState = {
  code: string;
  title: string;
  subject: string;
  description: string;
  thumbnail_url: string;
  objectives: string;
  target_audience: string;
  prerequisites: string;
  intro: string;
  status: CourseStatus;
  instructor_id: string;
};

const fromCourse = (c?: Partial<Course>): FormState => ({
  code: c?.code || '',
  title: c?.title || '',
  subject: c?.subject || '',
  description: c?.description || '',
  thumbnail_url: c?.thumbnail_url || '',
  objectives: c?.objectives || '',
  target_audience: c?.target_audience || '',
  prerequisites: c?.prerequisites || '',
  intro: c?.intro || '',
  status: (c?.status as CourseStatus) || 'DRAFT',
  instructor_id: c?.instructor_id || '',
});

/** Biểu mẫu tạo / sửa khóa học — 2 bước: thông tin cơ bản → mục tiêu & giới thiệu. */
export const CourseFormModal: React.FC<{
  course?: Course;
  canPickInstructor: boolean;
  onClose: () => void;
  onSaved: (c: Course) => void;
}> = ({ course, canPickInstructor, onClose, onSaved }) => {
  const editing = Boolean(course);
  const [step, setStep] = useState(1);
  const [f, setF] = useState<FormState>(fromCourse(course));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [instructors, setInstructors] = useState<Array<{ id: string; full_name: string; code: string }>>([]);
  const toast = useToast();

  useEffect(() => {
    if (canPickInstructor) teachingApi.users('INSTRUCTOR').then((r) => setInstructors(r.items)).catch(() => setInstructors([]));
  }, [canPickInstructor]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = 'Tên khóa học cần tối thiểu 3 ký tự.';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(f.code.trim())) e.code = 'Mã gồm 2–40 ký tự: chữ, số, dấu chấm, gạch ngang.';
    if (f.thumbnail_url.trim()) {
      const imgCheck = normalizeImageUrl(f.thumbnail_url);
      if (!imgCheck.ok) e.thumbnail_url = imgCheck.message;
    }
    if (canPickInstructor && !editing && !f.instructor_id) e.instructor_id = 'Vui lòng chọn giảng viên phụ trách.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = { ...f };
      if (payload.thumbnail_url.trim()) {
        const imgCheck = normalizeImageUrl(payload.thumbnail_url);
        if (imgCheck.ok) payload.thumbnail_url = imgCheck.url;
      }
      if (!canPickInstructor || !payload.instructor_id) delete payload.instructor_id;
      if (editing) delete payload.status;
      const saved = editing
        ? await teachingApi.updateCourse(course!.id, payload)
        : await teachingApi.createCourse(payload);
      toast({ tone: 'success', title: editing ? 'Đã lưu thay đổi khóa học' : 'Đã tạo khóa học', detail: `${saved.code} · ${saved.title}` });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiHttpError && typeof e.detail.field === 'string') {
        const fieldName = e.detail.field as string;
        const msg =
          fieldName === 'thumbnail_url' && f.thumbnail_url.startsWith('data:image/')
            ? 'Máy chủ Backend cần nhấn phím [R] trong cửa sổ chạy hệ thống để nhận tính năng tải ảnh từ máy, hoặc bạn có thể dán đường dẫn ảnh https://'
            : e.message;
        setErrors({ [fieldName]: msg });
        setStep(['objectives', 'target_audience', 'prerequisites', 'intro'].includes(fieldName) ? 2 : 1);
      } else {
        toast({ tone: 'error', title: 'Không lưu được khóa học', detail: errMsg(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Chỉnh sửa thông tin khóa học' : 'Tạo khóa học mới'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="t-sub" style={{ marginRight: 'auto' }}>Bước {step}/2</span>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Hủy
          </Btn>
          {step === 2 && <Btn onClick={() => setStep(1)}>‹ Quay lại</Btn>}
          {step === 1 ? (
            <Btn variant="primary" onClick={() => validateStep1() && setStep(2)}>
              Tiếp tục ›
            </Btn>
          ) : (
            <Btn variant="primary" onClick={save} loading={busy}>
              {editing ? 'Lưu thay đổi' : 'Tạo khóa học'}
            </Btn>
          )}
        </>
      }
    >
      {step === 1 ? (
        <div className="t-form-grid">
          <Field label="Tên khóa học" required error={errors.title} wide>
            <input className="t-input" value={f.title} onChange={set('title')} maxLength={200} placeholder="vd: Toán 5 nâng cao" />
          </Field>
          <Field label="Mã khóa học" required error={errors.code} hint="Dùng để tìm kiếm và liên kết lớp học">
            <input className="t-input" value={f.code} onChange={set('code')} maxLength={40} placeholder="vd: TOAN5-NC" style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Môn học / lĩnh vực" error={errors.subject}>
            <input className="t-input" value={f.subject} onChange={set('subject')} maxLength={100} placeholder="vd: Toán" />
          </Field>
          {canPickInstructor && (
            <Field label="Giảng viên phụ trách" required={!editing} error={errors.instructor_id}>
              <select className="t-input" value={f.instructor_id} onChange={set('instructor_id')}>
                <option value="">— Chọn giảng viên —</option>
                {instructors.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.code})
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!editing && (
            <Field label="Trạng thái ban đầu" hint="Bản nháp: chỉ giảng viên thấy. Có thể xuất bản sau.">
              <select className="t-input" value={f.status} onChange={set('status')}>
                <option value="DRAFT">Bản nháp</option>
                <option value="PUBLISHED">Xuất bản ngay</option>
              </select>
            </Field>
          )}
          <Field label="Mô tả ngắn" error={errors.description} wide>
            <textarea className="t-input" rows={3} value={f.description} onChange={set('description')} maxLength={2000} />
          </Field>
          <Field
            label="Ảnh bìa khóa học"
            error={errors.thumbnail_url}
            wide
            hint="Hỗ trợ dán link từ Google/Bing Images, Google Drive, Dropbox, link ảnh trực tiếp hoặc chọn ảnh từ máy (tỷ lệ 16:10)"
          >
            <ImageUrlInput
              value={f.thumbnail_url}
              onChange={(nextUrl) => {
                setF((p) => ({ ...p, thumbnail_url: nextUrl }));
                if (errors.thumbnail_url) setErrors((prev) => ({ ...prev, thumbnail_url: '' }));
              }}
              variant="cover"
              ariaLabel="Ảnh bìa khóa học"
            />
          </Field>
        </div>
      ) : (
        <div className="t-form-grid">
          <Field label="Mục tiêu học tập" error={errors.objectives} wide>
            <textarea className="t-input" rows={3} value={f.objectives} onChange={set('objectives')} maxLength={5000} placeholder="Sau khóa học, học viên có thể…" />
          </Field>
          <Field label="Đối tượng học" error={errors.target_audience}>
            <input className="t-input" value={f.target_audience} onChange={set('target_audience')} maxLength={1000} />
          </Field>
          <Field label="Kiến thức tiên quyết" error={errors.prerequisites}>
            <input className="t-input" value={f.prerequisites} onChange={set('prerequisites')} maxLength={2000} />
          </Field>
          <Field label="Nội dung giới thiệu" error={errors.intro} wide>
            <textarea className="t-input" rows={5} value={f.intro} onChange={set('intro')} maxLength={10000} />
          </Field>
        </div>
      )}
    </Modal>
  );
};
