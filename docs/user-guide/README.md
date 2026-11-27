# Hướng dẫn Sử dụng Hệ thống LMSPLUS (LMS E-Learning)

Bộ tài liệu hướng dẫn chi tiết từng module chức năng trên nền tảng **LMSPLUS** dành cho **Quản trị viên**, **Giáo vụ**, **Trưởng bộ môn**, **Giảng viên / Trợ giảng** và **Học viên**, kèm ảnh chụp màn hình thực tế từ hệ thống.

---

## 1. Tổng quan Kiến trúc Nghiệp vụ LMSPLUS

LMSPLUS vận hành theo mô hình liên kết **3 cấp** giúp tái sử dụng học liệu và giữ toàn vẹn dữ liệu giảng dạy khi thay đổi giáo trình:

1. **Môn học & Giáo trình** (`/teaching/courses`) + **Khung chương trình** (`/teaching/curricula`):
   - Định nghĩa chuẩn đầu ra, đầu điểm, đề cương, bài giảng trong **Lesson Studio** và học phí / giai đoạn / môn tiên quyết.
   - Khi ban hành, hệ thống đóng băng thành các **Phiên bản (Snapshot)**.
2. **Lớp khóa học** (`/teaching/cohorts`):
   - Mở khóa học theo niên khóa/học kỳ từ Khung chương trình *Đã ban hành*, quản lý quân số tập trung và tự động khởi tạo các **Lớp môn học** tương ứng.
3. **Lớp môn học** (`/teaching/classes`):
   - Không gian giảng dạy trực tiếp theo từng lớp: ghim **Snapshot phiên bản giáo trình**, quản lý buổi học, điểm danh, phòng học trực tuyến, kiểm tra, bài tập Rubric, bảng điểm, nhật ký giảng dạy và diễn đàn.

---

## 2. Tài khoản Trải nghiệm & Phân quyền RBAC

Hệ thống phân quyền theo 7 vai trò chuẩn (`ROLE_DISPLAY_LABELS`):

| Vai trò | Mã vai trò | Phạm vi & Quyền hạn chính |
| --- | --- | --- |
| **Quản trị tối cao / Quản trị viên** | `SUPER_ADMIN`, `ADMIN` | Toàn quyền cấu hình Khoa/Bộ môn, Tài khoản, Khung CT, Môn học, Lớp, Định mức và Duyệt tài chính. |
| **Giáo vụ** | `ACADEMIC_STAFF` | Quản lý Khung chương trình, Lớp khóa học, Lớp môn học, Xếp thời khóa biểu, Cơ sở/Phòng, Duyệt đơn nghỉ và Bảng công. |
| **Trưởng bộ môn** | `HEAD_OF_DEPARTMENT` | Điều hành phạm vi Bộ môn được phân công, phê duyệt ban hành Môn học / Khung CT, duyệt phúc khảo điểm và theo dõi lịch dạy. |
| **Giảng viên** | `INSTRUCTOR` | Giảng dạy các lớp được phân công, soạn Lesson Studio (Chế độ A/B), điểm danh, xác nhận nhật ký, mở phòng trực tuyến, chấm bài/thi, duyệt đơn nghỉ lớp phụ trách. |
| **Trợ giảng** | `TEACHING_ASSISTANT` | Hỗ trợ vận hành lớp được phân công (học liệu, điểm danh, lớp trực tuyến) theo phân quyền lớp. |
| **Học viên** | `STUDENT` | Truy cập Cổng Học viên (`/learn`): học bài giảng & Video Quiz, tự điểm danh 6 số, làm bài kiểm tra, nộp bài tập, phúc khảo và gửi đơn xin nghỉ. |

### Tài khoản mẫu (Môi trường phát triển / Staging)

| Vai trò | Email đăng nhập | Mật khẩu mặc định |
| --- | --- | --- |
| Quản trị viên | `admin@lmsplus.edu.vn` (`AD00001`) | `123456` |
| Giáo vụ | `giaovu@lmsplus.edu.vn` | `123456` |
| Giảng viên | `thuha.gv@lmsplus.edu.vn` (`GV5001`) / `vankhoa.gv@lmsplus.edu.vn` | `123456` |
| Trợ giảng | `minhquan.tg@lmsplus.edu.vn` | `123456` |
| Học viên | `minhanh.hs@lmsplus.edu.vn` (`HS50101`) | `123456` |

---

## 3. Mục lục Hướng dẫn Chi tiết theo Module

| Chương | Module & Chức năng | Đối tượng chính |
| --- | --- | --- |
| **[01 — Đăng nhập & Khung giao diện chung](./01-dang-nhap-va-giao-dien-chung.md)** | Đăng nhập / Đăng ký, Global Top Header, Tìm kiếm nhanh `Ctrl + K`, Sidebar & Breadcrumb, Thông báo, Trung tâm hỗ trợ & Chuyển 3 giao diện Theme | Mọi vai trò |
| **[02 — Quản trị & Tổ chức Đào tạo](./02-to-chuc-dao-tao.md)** | Khoa & Bộ môn, Tài khoản & Phân quyền RBAC, Môn học & Giáo trình (10 tab + Snapshot), Khung chương trình (7 tab), Lớp khóa học & Wizard 5 bước | Quản trị viên, Giáo vụ, Trưởng bộ môn |
| **[03 — Lesson Studio & Ngân hàng Học liệu](./03-lesson-studio-va-hoc-lieu.md)** | Trình soạn giáo án Lesson Studio (Chế độ A/B), Video Upload & YouTube, Video Quiz Timeline, Ngân hàng Câu hỏi / Bài tập Rubric / Tài nguyên 4 cấp | Giảng viên, Quản trị viên, Giáo vụ |
| **[04 — Tổng quan, Lớp Môn học, Điểm danh & Phòng Trực tuyến](./04-lop-mon-hoc-va-giang-day.md)** | Dashboard Bento, Lịch dạy tuần/tháng, 12 tab Lớp môn học, Điểm danh 1 màn hình & Mã 6 số động, Phòng Zoom/Meet (bao gồm cảnh báo Sandbox 3.001 & sửa link), Nhật ký 24h | Giảng viên, Trợ giảng, Giáo vụ |
| **[05 — Điều phối Thời khóa biểu, Duyệt đơn nghỉ & Giờ dạy](./05-dieu-phoi-va-van-hanh.md)** | Bảng xếp lịch kéo-thả & kiểm toán 6 ràng buộc, Cơ sở/Phòng/Ngày lễ/Lịch bận GV, Duyệt đơn xin nghỉ, Thống kê & Chốt bảng giờ giảng chuyển Tài chính | Giáo vụ, Trưởng bộ môn, Quản trị viên, Giảng viên |
| **[06 — Cổng Học viên (Learner Portal)](./06-cong-hoc-vien.md)** | Không gian học tập, Học bài giảng & Video Strict/Quiz, Lịch học của tôi, Bài kiểm tra & Phúc khảo, Bài tập Rubric, Đơn xin nghỉ & Điểm danh 6 số | Học viên |
