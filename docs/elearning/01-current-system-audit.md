# 01. BÁO CÁO KHẢO SÁT HỆ THỐNG HIỆN TẠI (CURRENT SYSTEM AUDIT)
> **Dự án:** Phân hệ E-Learning mở rộng cho **LMSPLUS**
> **Ngày khảo sát:** `2026-11-10`
> **Thư mục Workspace kiểm tra:** `d:\LMS elearning`

---

## 1. Bằng chứng Khảo sát Thực tế trên Repository (`Evidence-Based Repository Inspection`)

Theo đúng nguyên tắc bắt buộc tại **Phần II (Quy tắc khảo sát source code)** và **Yêu cầu 1 & 2** (*"Mọi kết luận về hệ thống hiện tại phải có bằng chứng từ file, API hoặc schema thực tế. Không được tự giả định dữ liệu, API hoặc bảng đã tồn tại"*), chúng tôi đã thực thi lệnh kiểm tra toàn bộ cây thư mục tại workspace `d:\LMS elearning`.

### 1.1. Kết quả kiểm tra vật lý tại `d:\LMS elearning`

Cấu trúc file thực tế hiện có trong workspace `d:\LMS elearning` tại thời điểm khảo sát:

```text
d:\LMS elearning\
├── .agents/
│   └── skills/
│       └── ui-ux-standard/
│           ├── SKILL.md
│           ├── references/
│           │   ├── impeccable-anti-slop.md
│           │   └── ui-ux-promax-checklist.md
│           └── scripts/
│               ├── impeccable_audit.mjs
│               └── impeccable_audit.py
├── design-system/
│   └── lms-elearning/
│       ├── MASTER.md
│       └── pages/
│           ├── course-discovery.md
│           ├── course-detail.md
│           ├── learning-player.md
│           └── student-dashboard.md
├── theme/
│   ├── preview.html
│   ├── tailwind.preset.js
│   └── tokens.css
├── AGENTS.md
└── DESIGN.md
```

### 1.2. Kết luận Xác minh Kỹ thuật (Verification Findings)

1. **Hiện trạng Source Code Core `LMSPLUS`:**
   - Thư mục làm việc hiện tại (`d:\LMS elearning`) mới chỉ chứa **Bộ quy chuẩn Design System & UI/UX (`UI/UX Pro Max` + `Impeccable` + `Airbnb DLS` + `Theme`)** vừa được khởi tạo, **chưa được mount hoặc copy mã nguồn lõi (Core Source Code) của `LMSPLUS`** (Frontend React/TS/Vite, Backend Python API, và PostgreSQL Migrations/Models).
   - Vì quy tắc kiến trúc nghiêm cấm việc *"tự bịa đặt rằng một bảng hay endpoint đã tồn tại trong code khi chưa thấy file thực tế"*, toàn bộ tài liệu kiến trúc trong `docs/elearning/` được thiết kế theo mô hình **Adapter & Bridge Architecture (Kiến trúc Cầu nối Mở rộng)**:
     - Định nghĩa rõ **Hợp đồng Giao tiếp Lõi (`LMSPLUS Core Contract`)** đối với các phân hệ đã có của LMSPLUS (Users, RBAC, Courses, Subjects, Classes, Assessments, Assignments, Grades, Schedules).
     - Tuyệt đối **không tạo bảng trùng lặp** với nhóm thực thể lõi này; mọi bảng mới của E-Learning đều sử dụng tiền tố/namespace rõ ràng và liên kết qua khóa ngoại (`Foreign Key`) tới các bảng lõi của LMSPLUS.
     - Ngay khi mã nguồn `LMSPLUS` được copy hoặc mount vào workspace, đội ngũ kỹ thuật chỉ cần ánh xạ tên bảng/cột thực tế vào tầng `Core Bridge Mapping` mà không phải thay đổi thiết kế E-Learning.

---

## 2. Báo cáo Khảo sát & Đối chiếu Nghiệp vụ (`LMSPLUS` → `E-Learning Extension`)

Bảng dưới đây tổng hợp trạng thái giữa **Kiến trúc LMSPLUS hiện hữu (theo thông tin hệ thống cung cấp)**, **Khả năng tái sử dụng**, và **Phạm vi cần phát triển mới cho phân hệ E-Learning**:

| Hạng mục | Hiện trạng (LMSPLUS Baseline & Workspace Audit) | Có thể tái sử dụng (Reuse Strategy) | Cần phát triển / Mở rộng (E-Learning Scope) |
| :--- | :--- | :--- | :--- |
| **Authentication** | Hệ thống LMSPLUS dùng **JWT Authentication** (Access Token + Refresh Token) trên nền Python API & Redis session/blacklist. *(Chưa mount file code vào `d:\LMS elearning`)*. | - Tái sử dụng 100% luồng đăng nhập, phát hành JWT, middleware xác thực người dùng (`current_user`), và bảng người dùng (`users`).<br>- Tuyệt đối **không tạo hệ thống User/Auth thứ hai**. | - Bổ sung xác thực ngắn hạn (**Signed Ephemeral Token / Cookie**) cho luồng phát Video HLS/DASH, tải học liệu bảo mật và WebSocket/SSE (thông báo, đồng bộ tiến độ). |
| **RBAC** | Hệ thống đã có phân quyền dựa trên vai trò (**RBAC**: Quản trị viên, Giáo vụ, Giảng viên, Học viên). | - Tái sử dụng bảng `users`, `roles`, `user_roles`, `permissions` hiện có của LMSPLUS. | - Mở rộng thêm vai trò **Trợ giảng (`Teaching Assistant - TA`)**.<br>- Bổ sung tầng **Object-Level & Scope Authorization (ABAC/Scope)** kiểm tra quyền theo từng `course_class_id`, `subject_class_id`, và bảng phân công `teaching_staff_assignments` (cho phép cấu hình chi tiết quyền của từng TA trên từng lớp môn học). |
| **Course** | LMSPLUS đã quản lý danh mục Khóa học / Chương trình đào tạo (`courses`). | - Giữ nguyên bảng `courses` hiện tại làm gốc danh mục đào tạo. | - Mở rộng metadata E-Learning (mục tiêu đầu ra `learning_outcomes`, điều kiện hoàn thành khóa học `completion_rules`, trạng thái xuất bản nội dung số) thông qua bảng mở rộng hoặc cột bổ sung có migration an toàn. |
| **Subject** | LMSPLUS đã có quản lý Môn học (`subjects`) và liên kết môn học trong khóa. | - Tái sử dụng bảng `subjects` và bảng liên kết `course_subjects` (nếu đã có). | - Xây dựng cây chương trình học số hóa 5 cấp: `Course` → `Subject` → `Topic (Chủ đề)` → `Chapter (Chương)` → `Lesson (Bài học)` tách biệt giữa **Khung chương trình chuẩn (Master Template)** và **Phiên bản triển khai theo lớp**. |
| **Class** | LMSPLUS đã quản lý Lớp học (`classes` / `enrollments`). | - Tái sử dụng danh sách lớp và danh sách học viên ghi danh vào lớp. | - Chuẩn hóa sự phân biệt rõ ràng giữa:<br>1. **Lớp khóa học (`Course Class / Cohort`):** Không gian tổng hợp của cả khóa.<br>2. **Lớp môn học (`Subject Class / Section`):** Không gian học tập, điểm danh, diễn đàn, bài tập và nhật ký giảng dạy của từng môn cụ thể.<br>- Thêm bảng ánh xạ `class_lesson_schedules` gắn buổi học của lớp với các bài học (`LessonSessions`). |
| **Assessment** | LMSPLUS đã có Ngân hàng câu hỏi (`question_bank`) và Bài kiểm tra (`assessments` / `exams`). | - Tái sử dụng 100% ngân hàng câu hỏi, cấu trúc đề thi và bộ chấm điểm trắc nghiệm hiện có.<br>- **Không tạo engine kiểm tra độc lập.** | - Tạo cầu nối gắn bài kiểm tra vào chương/bài học (`Lesson` / `Chapter`).<br>- Hỗ trợ block **Inline Quick Quiz** trong bài giảng (lưu lịch sử tương tác học tập) và bài kiểm tra điều kiện mở khóa chương (`LessonUnlockConditions`).<br>- Bổ sung cấu hình quy tắc lấy điểm (`highest_score`, `latest_score`, `average_score`) và giới hạn thời gian/số lần làm bài. |
| **Assignment** | LMSPLUS đã có quản lý Bài tập (`assignments`). | - Tái sử dụng thực thể `assignments` cốt lõi nếu đã có. | - Mở rộng hỗ trợ 2 loại: **Bài tập gắn chương trình** (gắn với `lesson_id` / `chapter_id`) và **Bài tập ngoài chương trình** (gắn trực tiếp với `subject_class_id`).<br>- Quản lý lịch sử nhiều lần nộp (`assignment_submissions`), đính kèm đa tệp, luồng chấm điểm - nhận xét inline - yêu cầu nộp lại (`return_for_revision`) của Giảng viên & Trợ giảng. |
| **Grade** | LMSPLUS đã có hệ thống Điểm số (`grades` / `gradebook`). | - Tái sử dụng sổ điểm tổng hợp của LMSPLUS làm nơi lưu kết quả chính thức. | - Xây dựng cơ chế đồng bộ điểm tự động (Transactional Sync) từ Bài tập (`Assignment`), Bài kiểm tra (`Assessment`), và Thảo luận có chấm điểm (`Graded Forum Topic`) về sổ điểm LMSPLUS theo trọng số. |
| **Schedule** | LMSPLUS đã có Thời khóa biểu (`schedules` / `class_sessions`). | - Tái sử dụng lịch học và danh sách buổi học (`class_sessions`) của từng lớp môn học. | - Mở rộng buổi học (`class_sessions`) để liên kết với:<br>1. **Nhiều bài học (`lesson_sessions`)** trong một buổi.<br>2. **Hệ thống Điểm danh đa phương thức** (Thủ công, QR động xoay vòng theo chu kỳ, đồng bộ Zoom/Google Meet, Đơn xin nghỉ & Học bù).<br>3. **Nhật ký giảng dạy (`teaching_logs`)** và luồng **Xác nhận buổi dạy** (tách biệt giờ dạy của giảng viên với điểm danh của học viên). |
| **Notification** | Hệ thống có thông báo cơ bản hoặc hàng đợi Redis. | - Tái sử dụng hạ tầng Redis Pub/Sub / Queue và bảng thông báo hiện có. | - Mở rộng hệ thống thông báo theo sự kiện E-Learning: nhắc lịch học sắp tới, hạn nộp bài tập, bài kiểm tra sắp mở, phản hồi chấm bài, `@mention` trong diễn đàn, duyệt đơn xin nghỉ, và cảnh báo giảng viên quá hạn xác nhận nhật ký giảng dạy. |
| **File Storage** | Lưu trữ tệp trên VPS hoặc Object Storage hiện tại. | - Tái sử dụng dịch vụ upload/lưu trữ tệp sẵn có cho tệp đính kèm thông thường. | - Chuẩn hóa quản lý tài nguyên học tập (`learning_resources`, `media_assets`): hỗ trợ Video Streaming (HLS/Adaptive Bitrate), lưu vị trí xem video, Speech-to-Text (`media_transcriptions`), và kiểm soát quyền truy cập tệp theo lớp học (Signed URLs). |

---

## 3. Nguyên tắc Bảo toàn Hệ thống Hiện tại (`Zero-Breakage & Non-Duplication Rules`)

Để đảm bảo việc phát triển phân hệ E-Learning **không làm hỏng bất kỳ chức năng nào đang chạy của LMSPLUS**, mọi thiết kế trong bộ tài liệu này tuân thủ 6 nguyên tắc kỹ thuật bất di bất dịch:

1. **Nguyên tắc 1 — Single Identity & Single RBAC:**
   - Mọi bảng dữ liệu mới trong phân hệ E-Learning đều tham chiếu tới `users(id)` của LMSPLUS thông qua khóa ngoại (`user_id`, `instructor_id`, `student_id`, `created_by`, `updated_by`).
   - Không tạo bảng `elearning_users` hay cơ chế đăng nhập riêng.
2. **Nguyên tắc 2 — Non-Invasive Schema Extension (Mở rộng Không Xâm lấn):**
   - Với các bảng lõi đã có của LMSPLUS (`courses`, `subjects`, `classes`, `class_sessions`, `assignments`, `assessments`, `grades`), ưu tiên sử dụng **Bảng Mở rộng 1-1 (`*_elearning_meta`)** hoặc **Bảng Cầu nối (`*_links`)** thay vì sửa đổi kiểu dữ liệu hay xóa cột của bảng cũ.
   - Nếu bắt buộc thêm cột vào bảng hiện hữu, cột mới phải là `NULLABLE` hoặc có `DEFAULT` an toàn để không làm lỗi các câu lệnh `INSERT`/`SELECT` của code cũ.
3. **Nguyên tắc 3 — Reuse Assessment & Grade Engine:**
   - Các bài kiểm tra trong E-Learning tham chiếu trực tiếp tới `assessment_id` của LMSPLUS. Phân hệ E-Learning chỉ quản lý ngữ cảnh hiển thị trong bài học, điều kiện mở khóa (`unlock_conditions`), và đồng bộ kết quả về bảng điểm gốc.
4. **Nguyên tắc 4 — Tách biệt Khung chương trình (Master Curriculum) và Lớp triển khai (Class Delivery):**
   - Nội dung bài giảng (`Topics`, `Chapters`, `Lessons`, `LessonBlocks`, `LessonVersions`) thuộc về **Khung chương trình chuẩn**, giúp tái sử dụng qua nhiều học kỳ/khóa học mà không phải nhân bản dữ liệu.
   - Khi triển khai cho một **Lớp môn học (`SubjectClass`)**, hệ thống chỉ tạo bản ghi ánh xạ lịch học, tiến độ học viên, điểm danh và nhật ký giảng dạy gắn với `subject_class_id` và `lesson_version_id`.
5. **Nguyên tắc 5 — Transactional Integrity & Idempotency:**
   - Các nghiệp vụ nhiều bước (Xuất bản phiên bản bài giảng, Chấm bài & cập nhật sổ điểm, Xác nhận nhật ký giảng dạy, Ghi nhận sự kiện hoàn thành bài học) bắt buộc chạy trong **Database Transaction (`BEGIN ... COMMIT`)** kèm khóa chống trùng lặp (`idempotency_key`).
6. **Nguyên tắc 6 — Reversible Migrations:**
   - Mọi thay đổi cơ sở dữ liệu đều đi kèm cặp script `UP` (nâng cấp) và `DOWN` (rollback an toàn) được định nghĩa chi tiết tại [`06-database-design.md`](./06-database-design.md).

---

## 4. Danh sách Điểm cần Xác minh & Câu hỏi Mở (`Open Questions`)

Do mã nguồn lõi của `LMSPLUS` chưa được đặt vào thư mục `d:\LMS elearning`, dưới đây là danh sách các điểm kỹ thuật và nghiệp vụ cần xác nhận với đội ngũ sở hữu `LMSPLUS` trước khi chạy migration thực tế:

### 4.1. Câu hỏi Kỹ thuật (Technical Verification Checklist)
- **OQ-T01 (Đường dẫn Source Code LMSPLUS):** Mã nguồn hiện tại của `LMSPLUS` (Frontend & Backend) đang nằm ở thư mục hay Git repository nào để thực hiện ánh xạ tên bảng/cột chính xác 100%?
- **OQ-T02 (Python Framework & ORM):** Backend Python hiện tại của LMSPLUS đang sử dụng **FastAPI (SQLAlchemy / SQLModel + Alembic)**, **Django (Django ORM)** hay **Flask**? *(Thiết kế SQL trong tài liệu này sử dụng chuẩn PostgreSQL DDL thuần và cấu trúc migration tương thích với cả Alembic lẫn Django Migrations).*
- **OQ-T03 (Kiểu dữ liệu khóa chính của LMSPLUS):** Các bảng hiện tại (`users`, `courses`, `subjects`, `classes`) đang dùng khóa chính kiểu `UUID` hay `BIGSERIAL / INTEGER`? *(Trong thiết kế dưới đây, chúng tôi định nghĩa kiểu tham chiếu chuẩn và ghi chú rõ cách tương thích với cả `UUID` và `BIGINT`).*
- **OQ-T04 (Giải pháp Lưu trữ Video & File):** VPS Ubuntu hiện tại đang lưu trữ video trực tiếp trên ổ cứng cục bộ (qua Nginx) hay sử dụng Object Storage tương thích S3 (MinIO, AWS S3, Cloudflare R2)?

### 4.2. Các Quyết định Nghiệp vụ Đã Chốt (Resolved Business Decisions)

- **BD-01 (Chính sách Khám phá & Đăng ký Khóa học tại `LP-02` — ĐÃ CHỐT):**
  - Áp dụng mô hình kết hợp 3 chế độ cấu hình riêng trên từng khóa học (`enrollment_policy`), mặc định là `ASSIGNED_ONLY`:
    1. `ASSIGNED_ONLY` *(Mặc định)*: Khóa học thuộc chương trình đào tạo chính thức; do Giáo vụ/người có quyền phân lớp và phân công.
    2. `REQUEST_APPROVAL`: Khóa học kỹ năng chung, tự chọn hoặc mở rộng; học viên được gửi yêu cầu tham gia (`course_enrollment_requests`) và chờ người có thẩm quyền phê duyệt vào lớp.
    3. `SELF_ENROLL`: Không bật mặc định; chỉ cho phép khi Quản trị viên (`ADMIN`) chủ động cấu hình cho phép tự ghi danh.
  - Đảm bảo tuyệt đối không làm thay đổi cơ chế phân lớp và phân quyền hiện tại của LMSPLUS.
- **BD-02 (Thời hạn Xác nhận Nhật ký Giảng dạy tại `TW-14`, `TW-15` — ĐÃ CHỐT):**
  - Thời hạn xác nhận là **24 giờ** kể từ thời điểm kết thúc buổi học (`scheduled_end_at + INTERVAL '24 hours'`).
  - Quá 24 giờ chưa xác nhận, hệ thống tự động chuyển trạng thái sang `OVERDUE_UNCONFIRMED`.
  - **Không khóa quyền xác nhận khi quá hạn:** Giảng viên vẫn được phép xác nhận muộn (`is_late_confirmation = TRUE`), hệ thống lưu đầy đủ thời điểm kết thúc buổi học, thời điểm xác nhận thực tế (`confirmed_at`) và toàn bộ lịch sử chuyển trạng thái (`teaching_log_history`).
  - Giáo vụ (`ACADEMIC_STAFF`) và Quản trị viên (`ADMIN`) có quyền theo dõi, gửi nhắc nhở và xử lý các buổi quá hạn theo phân quyền.
- **BD-03 (Phạm vi Diễn đàn Môn học):**
  - Hỗ trợ cả 2 phạm vi: theo lớp (`CLASS_ONLY`) và dùng chung nhiều lớp cùng môn (`SUBJECT_SHARED`). Trợ giảng chỉ kiểm duyệt trong phạm vi lớp được phân công; Giảng viên phụ trách môn và Giáo vụ có quyền kiểm duyệt cấp môn học.
- **BD-04 (Quy tắc Tính Hoàn thành Bài học):**
  - Cấu hình linh hoạt qua bảng `completion_rules` (mặc định xem đạt `>= 85%` thời lượng video và hoàn thành các câu hỏi Quick Check bắt buộc trong bài).
