import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { teachingApi } from '../api';
import {
  Badge, EmptyState, ErrorState, Loading, PageHeader, Pagination, SearchInput, SmartImage, fmtDate, useAsync, useDebounced,
} from '../ui';
import { CourseFormModal } from './CourseFormModal';

export const CourseListPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounced(q);
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('updated_desc');
  const [page, setPage] = useState(1);
  const me = useAsync(() => teachingApi.me(), []);
  const { data, error, loading, reload } = useAsync(
    () => teachingApi.courses({ q: dq, subject, status, sort, page, page_size: 12 }),
    [dq, subject, status, sort, page]
  );
  const showCreate = params.get('new') === '1';
  const closeCreate = () => {
    params.delete('new');
    setParams(params, { replace: true });
  };

  return (
    <div className="t-page">
      <PageHeader
        title="Khóa học"
        subtitle="Nội dung đào tạo: chương, bài học, video và tài liệu. Một khóa học có thể dùng cho nhiều lớp."
        actions={
          me.data?.can_create_course && (
            <button type="button" className="t-btn t-btn--primary" onClick={() => setParams({ new: '1' })}>
              + Tạo khóa học
            </button>
          )
        }
      />

      <div className="t-toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Tìm theo tên hoặc mã khóa học" />
        <select className="t-input" value={subject} onChange={(e) => { setSubject(e.target.value); setPage(1); }} aria-label="Lọc theo môn học">
          <option value="">Tất cả môn học</option>
          {(data?.subjects || []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="t-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Lọc theo trạng thái">
          <option value="">Đang sử dụng (trừ lưu trữ)</option>
          <option value="DRAFT">Bản nháp</option>
          <option value="PUBLISHED">Đã xuất bản</option>
          <option value="INACTIVE">Ngừng hoạt động</option>
          <option value="ARCHIVED">Đã lưu trữ</option>
          <option value="ALL">Tất cả</option>
        </select>
        <select className="t-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sắp xếp">
          <option value="updated_desc">Mới cập nhật</option>
          <option value="updated_asc">Cập nhật cũ nhất</option>
          <option value="title_asc">Tên A → Z</option>
        </select>
      </div>

      {loading && !data && <Loading rows={4} />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EmptyState
          title={dq || subject || status ? 'Không có khóa học phù hợp bộ lọc' : 'Bạn chưa có khóa học nào'}
          text={dq || subject || status ? 'Thử đổi từ khóa hoặc bộ lọc.' : 'Tạo khóa học đầu tiên để bắt đầu xây dựng nội dung giảng dạy.'}
          action={
            me.data?.can_create_course && !(dq || subject || status) ? (
              <button type="button" className="t-btn t-btn--primary" onClick={() => setParams({ new: '1' })}>
                + Tạo khóa học
              </button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="t-grid-cards" aria-busy={loading}>
            {data.items.map((c) => (
              <Link key={c.id} to={`/teaching/courses/${c.id}`} className="t-course-card">
                <div className="t-course-thumb">
                  <SmartImage src={c.thumbnail_url} alt="" fallback={<strong>{c.code}</strong>} />
                  <Badge kind="course" value={c.status} />
                </div>
                <div>
                  <h3>{c.title}</h3>
                  <div className="t-course-meta">
                    <span>{c.code}</span>
                    {c.subject && <span>{c.subject}</span>}
                    <span>{c.instructor_name}</span>
                  </div>
                  <div className="t-course-meta tabular-nums" style={{ marginTop: 4 }}>
                    <span>{c.chapters_count} chương</span>
                    <span>{c.lessons_count} bài học</span>
                    <span>{c.classes_count} lớp sử dụng</span>
                  </div>
                  {c.description && (
                    <p className="t-sub" style={{ margin: '8px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.description}
                    </p>
                  )}
                  <span className="t-sub">Cập nhật {fmtDate(c.updated_at)}</span>
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onChange={setPage} />
        </>
      )}

      {showCreate && me.data && (
        <CourseFormModal
          canPickInstructor={me.data.can_pick_instructor}
          onClose={closeCreate}
          onSaved={(c) => navigate(`/teaching/courses/${c.id}?section=content`)}
        />
      )}
    </div>
  );
};
