# Báo cáo Khảo sát Tái sử dụng & Tài liệu Triển khai Hệ thống Giảng dạy LMSPLUS

## 1. Báo cáo Khảo sát & Tái sử dụng Hệ thống (Phase 0 Audit)

Trước khi triển khai, toàn bộ workspace `D:\LMS elearning` đã được kiểm tra trực tiếp:

### 1.1. Các thành phần hiện hữu được kế thừa trực tiếp (Không tạo trùng lặp)
- **Xác thực & Người dùng (`users`, `/api/v1/elearning/auth/*`):** Kế thừa nguyên vẹn hệ thống tài khoản, mật khẩu băm PBKDF2/SHA-256, phiên đăng nhập JWT HMAC-SHA256 và màn hình `AuthPage.tsx` (không tạo bảng người dùng mới hay cổng đăng nhập riêng).
- **Cơ sở dữ liệu & Dữ liệu hiện hữu (`database/lmsplus_elearning.sqlite` & PostgreSQL `000`–`005`):**
  - Giữ nguyên toàn bộ dữ liệu hiện có của khóa học & lớp học mẫu (`Toán lớp 5 — lớp 5A1`, giảng viên `thuha.gv@lmsplus.edu.vn`, học viên `HS50101`..`HS50124`).
  - Bật `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000` trên SQLite.
- **Hệ thống Thiết kế (`theme/tokens.css`, `frontend/src/index.css`):** Tái sử dụng 100% bộ biến CSS ngữ nghĩa 3 chế độ (`airbnb-light`, `cinema-dark`, `babu-academy`), bộ phông chữ `Plus Jakarta Sans` + `Source Serif 4` + `JetBrains Mono` và lưới không gian `4px`.

### 1.2. Phân định Kiến trúc Khóa học (Course) và Lớp học (Class)
- **Khóa học (`courses`):** Đơn vị nội dung đào tạo có thể tái sử dụng, bao gồm thông tin môn học, mục tiêu, chương (`chapters`), bài học (`lessons`), khối nội dung đa phương tiện & video YouTube (`lesson_blocks`), lịch sử phiên bản xuất bản (`lesson_versions`), và kho tài liệu (`learning_resources`).
- **Lớp học (`subject_classes`):** Đơn vị tổ chức giảng dạy thực tế theo học kỳ/nhóm học viên, có danh sách học viên (`class_enrollments`), phân công giảng viên/trợ giảng (`teaching_staff_assignments`), lịch buổi học (`sessions`), dữ liệu điểm danh (`attendance_records`, `attendance_audit_logs`, `attendance_qr_sessions`), và nhật ký giảng dạy 24 giờ.
- **Quan hệ `1 Khóa học -> N Lớp học`:** Cột `subject_classes.course_id` cho phép nhiều lớp học cùng sử dụng chung một khóa học (ví dụ lớp `5A1` và `5A2` cùng học chung giáo trình Toán 5), hoặc tạo lớp trước rồi liên kết khóa học sau. Khi cần tùy biến nội dung riêng cho một lớp, giảng viên sử dụng chức năng **Sao chép khóa học** (`POST /api/v1/teaching/courses/:id/duplicate`).

### 1.3. Mở rộng Schema An toàn (Additive Migration)
- **Runtime SQLite:** `backend/teaching/schema.mjs` (`ensureTeachingSchema`) chỉ dùng `CREATE TABLE IF NOT EXISTS` và `ALTER TABLE ... ADD COLUMN` an toàn, không xóa dữ liệu cũ.
- **PostgreSQL Migration:** `database/migrations/006_teaching_workspace_extensions_up.sql` và `006_teaching_workspace_extensions_down.sql`.

---

## 2. Phân quyền RBAC & Phạm vi Dữ liệu (Data Scope)

Được kiểm soát chặt chẽ tại tầng Backend (`backend/teaching/scope.mjs`) trên mọi API:

| Vai trò | Phạm vi Khóa học | Phạm vi Lớp học & Học viên | Điểm danh & Nhật ký |
| :--- | :--- | :--- | :--- |
| **Giảng viên (`INSTRUCTOR`)** | Tạo, chỉnh sửa, sắp xếp, xuất bản, lưu trữ khóa học do mình phụ trách; xem khóa học cùng đơn vị để sao chép | Xem & quản lý lớp được phân công; tạo/sửa/hủy buổi học; xem danh sách & tiến độ học viên (thêm/xóa học viên theo cờ cấu hình `INSTRUCTOR_CAN_MANAGE_ROSTER`, mặc định do Giáo vụ quản lý) | Điểm danh hàng loạt, mở mã tự điểm danh 6 số, sửa điểm danh (quá 24h bắt buộc nhập lý do), xác nhận nhật ký buổi dạy |
| **Trợ giảng (`TEACHING_ASSISTANT`)** | Soạn bản nháp bài học nếu được cấp quyền `can_manage_materials` (không tự xuất bản/xóa khóa học) | Chỉ truy cập lớp được phân công | Điểm danh buổi học nếu được cấp quyền `can_take_attendance` |
| **Giáo vụ (`ACADEMIC_STAFF`)** | Xem/quản lý khóa học thuộc đơn vị (`department_id`) | Tạo lớp, phân công giảng viên/trợ giảng, thêm/nhập CSV/rút học viên thuộc đơn vị | Xem thống kê, xuất CSV, **Chốt sổ điểm danh** (`lock`) và **Mở khóa điểm danh** (`unlock` kèm lý do) |
| **Học viên (`STUDENT`)** | Chỉ xem nội dung bài học đã xuất bản (`PUBLISHED`) của lớp mình đang theo học (`ACTIVE`) | Xem lớp của tôi, lịch học cá nhân | Tự điểm danh bằng mã 6 chữ số khi giảng viên mở phiên; xem lịch sử chuyên cần cá nhân |
| **Quản trị viên (`ADMIN`)** | Toàn hệ thống | Toàn hệ thống + Quản lý tài khoản (`/admin/accounts`) | Toàn quyền kiểm tra, chốt/mở khóa, xuất báo cáo |

---

## 3. Tích hợp Video YouTube An toàn & Trung thực

- **Xử lý & Xác thực URL (`shared/youtube.mjs` & `POST /api/v1/teaching/youtube/validate`):**
  - Chỉ chấp nhận tên miền hợp lệ (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `www.youtube-nocookie.com`).
  - Hỗ trợ `watch?v=...`, `youtu.be/...`, `embed/...`, `shorts/...` và tham số thời điểm bắt đầu (`t=90s`, `t=1m30s`, `start=90`).
  - Kiểm tra định dạng Video ID đúng 11 ký tự (`^[A-Za-z0-9_-]{11}$`), không bao giờ lưu hay render nguyên văn mã `<iframe>` thô do người dùng dán vào (chống XSS).
  - Dựng URL nhúng chuẩn quyền riêng tư: `https://www.youtube-nocookie.com/embed/{VIDEO_ID}?rel=0`.
- **Xử lý Video chặn nhúng (Embed Disabled / Private):**
  - Kiểm tra qua YouTube oEmbed khi giảng viên bấm **Kiểm tra**. Nếu chủ sở hữu tắt quyền nhúng hoặc mạng ngoại tuyến, hệ thống thông báo trung thực ngay trên trình soạn thảo và luôn hiển thị liên kết dự phòng **`Mở trên YouTube ↗`** bên dưới khung `16:9` cho học viên.

---

## 4. Điểm danh Nhanh, Mã 6 Số Luân phiên & Công thức Chuyên cần

1. **Điểm danh hàng loạt tốc độ cao (`/teaching/classes/:classId/attendance`):**
   - Toàn bộ thao tác bấm chọn trạng thái (`Có mặt`, `Đi muộn`, `Có phép`, `Vắng`), nút **`Đánh dấu tất cả có mặt`**, **`Điền có mặt cho ô trống`**, **`Đánh dấu tất cả vắng`** và nhập ghi chú cập nhật tức thì trên bộ nhớ trình duyệt (không gọi API lẻ từng dòng).
   - Khi bấm **Lưu điểm danh**, toàn bộ danh sách được gửi trong **1 request `PUT /api/v1/teaching/sessions/:id/attendance`** duy nhất kèm `idempotency_key` chống ghi trùng và chạy trong 1 SQLite transaction.
   - Cảnh báo rời trang (`beforeunload`) và cảnh báo đổi buổi học khi có thay đổi chưa lưu.
2. **Kiểm toán & Khóa sổ sau 24 giờ:**
   - Mọi thay đổi trạng thái hoặc ghi chú đều lưu vết vào `attendance_audit_logs`.
   - Sau 24 giờ kể từ giờ kết thúc buổi học, giảng viên bắt buộc nhập lý do chỉnh sửa (`change_reason`).
   - Khi Giáo vụ đã **Chốt điểm danh**, bảng điểm danh chuyển sang chỉ đọc cho tới khi Giáo vụ/Admin mở khóa kèm lý do.
3. **Tự điểm danh bằng mã 6 chữ số luân phiên (`POST /sessions/:id/attendance/qr` & `POST /attendance/check-in`):**
   - Mã 6 số sinh bằng HMAC-SHA256 từ `secret_seed` riêng của buổi học, tự động luân phiên mỗi 30 giây (chấp nhận bước hiện tại và bước liền trước để tránh lệch nhịp mạng), kiểm tra học viên có thuộc danh sách lớp đang học hay không, tự động phân loại `PRESENT` / `LATE` theo ngưỡng phút đi muộn và giới hạn tốc độ thử sai chống dò mã.
4. **Công thức tính tỷ lệ chuyên cần minh bạch:**
   - Hiển thị trực tiếp trên giao diện thống kê và cổng học viên: `(Có mặt + Đi muộn) / (Có mặt + Đi muộn + Vắng có phép + Vắng không phép) × 100%`.
   - Các buổi học ở trạng thái `CANCELLED` được loại khỏi mẫu số thống kê.
   - Xuất báo cáo CSV có BOM UTF-8 (mở trực tiếp bằng Microsoft Excel tiếng Việt không lỗi font) và chống CSV Formula Injection.

---

## 5. Sơ đồ Đường dẫn Giao diện (Frontend Routes)

- **Cổng Giảng dạy & Giáo vụ:**
  - `/teaching` — Tổng quan giảng dạy, việc cần xử lý, buổi học hôm nay, cảnh báo chuyên cần.
  - `/teaching/courses` — Danh sách khóa học, tìm kiếm, lọc, tạo khóa học 2 bước.
  - `/teaching/courses/:courseId` — Chi tiết khóa học (Tổng quan, Chương & bài học kéo-thả, Tài liệu tải lên/liên kết, Lớp sử dụng, Thống kê).
  - `/teaching/lessons/:lessonId` — Trình soạn thảo bài học theo khối (Block Editor), nhúng nhiều video YouTube, xem trước như học viên, xuất bản phiên bản.
  - `/teaching/classes` — Danh sách lớp học, lọc theo trạng thái/khóa học, tạo/sửa lớp.
  - `/teaching/classes/:classId` — Chi tiết lớp học với 8 tab: *Tổng quan, Học viên, Nội dung học tập, Lịch học, Điểm danh, Bài tập & kiểm tra, Kết quả học tập, Nhật ký giảng dạy*.
  - `/teaching/classes/:classId/attendance` — Bảng điểm danh nhanh, mã tự điểm danh 6 số, lịch sử chỉnh sửa, chốt/mở khóa điểm danh.
  - `/teaching/schedule` — Lịch giảng dạy theo lưới tuần và danh sách.
- **Cổng Học viên:**
  - `/learn` — Lớp của tôi, tiếp tục bài học gần nhất, nhập mã 6 số điểm danh tại lớp.
  - `/learn/classes/:classId` — Đề cương bài học và bảng chuyên cần cá nhân.
  - `/learn/classes/:classId/lessons/:lessonId` — Không gian học bài (video YouTube, tài liệu tải xuống, câu hỏi ôn tập tương tác, hoàn thành bài học).
  - `/learn/schedule` — Lịch học theo tuần/danh sách.
- **Quản trị Hệ thống:**
  - `/admin/accounts` — Quản lý tài khoản người dùng.

---

## 6. Tài khoản Dùng thử & Lệnh Kiểm thử Tự động

Tất cả tài khoản mẫu sử dụng mật khẩu **`123456`**:
- Giảng viên (Lớp 5A1): `thuha.gv@lmsplus.edu.vn`
- Giảng viên (Lớp 5A2): `vankhoa.gv@lmsplus.edu.vn`
- Trợ giảng: `minhquan.tg@lmsplus.edu.vn`
- Giáo vụ: `giaovu@lmsplus.edu.vn`
- Học viên: `minhanh.hs@lmsplus.edu.vn`
- Quản trị viên: `admin@lmsplus.edu.vn`

### Lệnh chạy kiểm thử & kiểm định chất lượng
```powershell
# 1. Kiểm tra kiểu tĩnh TypeScript
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend

# 2. Kiểm định chuẩn giao diện Impeccable x Airbnb DLS
node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs frontend/src

# 3. Đóng gói bản build Production của Frontend
node frontend/node_modules/vite/bin/vite.js build frontend

# 4. Chạy bộ kiểm thử tích hợp E-Learning nền tảng (30 kịch bản)
node tests/elearning_full_test_suite.mjs

# 5. Chạy bộ kiểm thử tích hợp Hệ thống Giảng dạy, YouTube & Điểm danh (47 kịch bản)
node tests/teaching_test_suite.mjs
```
