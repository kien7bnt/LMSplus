import React from 'react';
import { Link } from 'react-router-dom';
import { IconKeyboard } from '../teaching/components/Icons';
import { Btn, Modal } from '../teaching/ui';
import { UserRole } from '../types/elearning';

export const HelpCenterModal: React.FC<{
  open: boolean;
  onClose: () => void;
  roles: UserRole[];
}> = ({ open, onClose, roles }) => {
  if (!open) return null;

  const isStudentOnly = roles.includes('STUDENT') && roles.every((r) => r === 'STUDENT');
  const isGovernance = roles.some((r) => ['ADMIN', 'SUPER_ADMIN', 'ACADEMIC_STAFF', 'HEAD_OF_DEPARTMENT'].includes(r));

  return (
    <Modal
      title="Trung tâm hỗ trợ LMSPLUS"
      onClose={onClose}
      width={600}
      footer={
        <Btn variant="primary" onClick={onClose}>
          Đã hiểu
        </Btn>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="saas-help-card">
          <h3 style={{ margin: '0 0 8px', fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconKeyboard size={16} /> Phím tắt điều hướng nhanh
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>Mở tìm kiếm nhanh mọi trang & chức năng</span>
              <kbd className="saas-kbd">Ctrl + K</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>Di chuyển nhanh & chọn kết quả tìm kiếm</span>
              <kbd className="saas-kbd">↑ ↓ · Enter</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>Đóng hộp thoại, menu hoặc ngăn kéo</span>
              <kbd className="saas-kbd">Esc</kbd>
            </div>
          </div>
        </section>

        <section className="saas-help-card">
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
            {isStudentOnly ? 'Hướng dẫn học tập cho Học viên' : 'Luồng nghiệp vụ chuẩn trên LMSPLUS'}
          </h3>
          {isStudentOnly ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Mở <strong>Không gian học tập</strong> để xem tiến độ video Strict, lớp đang theo học và phòng trực tuyến.</li>
              <li>Nộp bài tập (văn bản, liên kết hoặc tệp đính kèm) theo tiêu chí Rubric và gửi yêu cầu phúc khảo nếu cần.</li>
              <li>Theo dõi <strong>Lịch học của tôi</strong> và gửi <strong>Đơn xin nghỉ phép</strong> trước giờ vào lớp.</li>
            </ul>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><strong>Mô hình liên kết 3 cấp:</strong> Khung chương trình → Lớp khóa học → Lớp môn học (giáo án ghim theo Snapshot phiên bản).</li>
              <li><strong>Giảng dạy & Điểm danh:</strong> Điểm danh theo buổi (hoặc QR/phòng trực tuyến), xác nhận nhật ký giảng dạy trong hạn 24 giờ.</li>
              <li><strong>Đánh giá & Định mức:</strong> Chấm bài theo Rubric, xử lý phúc khảo đồng bộ Sổ điểm và theo dõi 45 phút/tiết.</li>
            </ul>
          )}
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {isStudentOnly ? (
            <>
              <Link className="t-btn t-btn--small" to="/learn" onClick={onClose}>Không gian học tập</Link>
              <Link className="t-btn t-btn--small" to="/learn/assignments" onClick={onClose}>Bài tập được giao</Link>
              <Link className="t-btn t-btn--small" to="/learn/exams" onClick={onClose}>Bài kiểm tra</Link>
            </>
          ) : (
            <>
              <Link className="t-btn t-btn--small" to="/teaching/courses" onClick={onClose}>Môn học & Giáo trình</Link>
              <Link className="t-btn t-btn--small" to="/teaching/classes" onClick={onClose}>Lớp môn học</Link>
              <Link className="t-btn t-btn--small" to="/teaching/banks" onClick={onClose}>Ngân hàng học liệu</Link>
              {isGovernance && (
                <Link className="t-btn t-btn--small" to="/admin/departments" onClick={onClose}>Khoa & Bộ môn</Link>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
