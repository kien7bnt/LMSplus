# 10. BÁO CÁO TÍCH HỢP & BACKLOG PHÁT TRIỂN (INTEGRATION REPORT & DEVELOPMENT BACKLOG)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`01-current-system-audit.md`](./01-current-system-audit.md), [`06-database-design.md`](./06-database-design.md)

---

## PHẦN A. BÁO CÁO TÍCH HỢP VỚI LMSPLUS HIỆN HỮU (INTEGRATION REPORT)

### 1. Phân loại Module Tái sử dụng — Mở rộng — Phát triển Mới

| Phân loại | Danh sách Module / Thành phần | Bảng dữ liệu Hiện tại sử dụng | Bảng dữ liệu Bổ sung Mới |
| :--- | :--- | :--- | :--- |
| **1. Tái sử dụng Nguyên trạng (Reuse 100%)** | - Xác thực người dùng (JWT Login/Refresh/Logout)<br>- Quản lý hồ sơ người dùng gốc (`Users`)<br>- Động cơ chấm thi trắc nghiệm & Ngân hàng câu hỏi gốc<br>- Sổ điểm chính thức (`Grades`) | `users`, `roles`, `user_roles`, `permissions`, `question_bank`, `grades` | Không tạo bảng trùng lặp. |
| **2. Mở rộng trên Nền tảng Sẵn có (Extend & Bridge)** | - Phân quyền RBAC → Mở rộng thành **RBAC + Scope/TA Flags**<br>- Danh mục Khóa học & Môn học → Mở rộng thành Cây chương trình 5 cấp<br>- Lớp học & Thời khóa biểu → Gắn Bài học, Điểm danh QR & Nhật ký giảng dạy<br>- Bài tập & Bài kiểm tra → Gắn vào Bài học & Hỗ trợ nộp nhiều lần | `courses`, `subjects`, `course_classes`, `subject_classes`, `class_sessions`, `assignments`, `assessments`, `notifications` | `course_subjects`, `teaching_staff_assignments`, `lesson_sessions`, `assignment_elearning_configs`, `assignment_submissions`, `assessment_elearning_links` |
| **3. Phát triển Mới Hoàn toàn (New E-Learning Modules)** | - **Notion-style Block Editor** & Quản lý phiên bản bài giảng<br>- **Coursera-style Lesson Player** & Động cơ Tiến độ/Mở khóa<br>- **Hệ thống Wiki Thuật ngữ** đa nghĩa theo môn<br>- **Diễn đàn Học thuật** (Lớp & Toàn môn, lồng 2 cấp, chấm điểm)<br>- **Điểm danh QR động**, Đơn xin nghỉ & Học bù<br>- **Nhật ký Giảng dạy** & Xác nhận buổi dạy<br>- **Tích hợp Zoom/Meet/HLS Video/Speech-to-Text** | Tham chiếu FK tới `users`, `subjects`, `subject_classes`, `class_sessions` | `topics`, `chapters`, `lessons`, `lesson_prerequisites`, `lesson_blocks`, `shared_blocks`, `lesson_versions`, `learning_resources`, `lesson_attachments`, `wiki_*`, `lesson_progress`, `course_progress`, `learning_events`, `completion_rules`, `lesson_unlock_conditions`, `forums`, `forum_*`, `attendance_*`, `leave_requests`, `make_up_sessions`, `teaching_*`, `external_integration_configs`, `online_meeting_sessions`, `video_recordings`, `media_transcriptions` |

---

### 2. Quản trị Rủi ro Migration & Phụ thuộc Liên Module

| Rủi ro Kỹ thuật | Mức độ | Giải pháp Giảm thiểu (Mitigation Strategy) |
| :--- | :---: | :--- |
| **Rủi ro 1:** Lệch kiểu khóa chính (`UUID` vs `BIGINT`) giữa bảng cũ của LMSPLUS và bảng mới của E-Learning. | **Cao** | Trước khi chạy Migration `M01`, kiểm tra kiểu cột `id` của `users`, `courses`, `subjects`, `classes` trong DB thực tế để đồng bộ kiểu FK. Không sửa kiểu cột PK của bảng cũ. |
| **Rủi ro 2:** Tải đồng thời cao khi hàng nghìn học viên cùng xem video và bắn `VIDEO_HEARTBEAT` mỗi 15 giây. | **Cao** | Ghi nhận tạm vào **Redis Hash/Stream** và chỉ flush (batch upsert) xuống PostgreSQL `lesson_progress` mỗi 60 giây hoặc khi người dùng tạm dừng/hoàn thành bài học. |
| **Rủi ro 3:** Xung đột dữ liệu khi Giảng viên và Trợ giảng cùng mở sửa một bài giảng trên Block Editor. | **Trung bình** | Áp dụng **Optimistic Concurrency Control** dựa trên `working_draft_revision` kết hợp lưu nháp cục bộ trên `IndexedDB` trình duyệt. |
| **Rủi ro 4:** Ảnh hưởng tới hệ thống tính điểm hiện tại khi đồng bộ điểm từ E-Learning. | **Trung bình** | Sử dụng Service Adapter gọi đúng hàm/stored-procedure cập nhật điểm hiện có của LMSPLUS bên trong cùng một Database Transaction. |

---

## PHẦN B. DEVELOPMENT BACKLOG (PHÂN CHIA THEO EPIC & ĐỘ ƯU TIÊN P0 / P1 / P2)

### EPIC 1: Nền tảng Core Bridge, Phân quyền Scope & Design System (`Priority: P0`)
- **Phụ thuộc:** Không (Chạy đầu tiên).

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-1.1** | **Thiết lập UI Shell & Design System:** Là Developer, tôi cần bộ Component chuẩn (13 UI Primitives) và Theme (`airbnb-light` / `cinema-dark`) để tái sử dụng trên toàn phân hệ. | - Tích hợp `theme/tokens.css` và `tailwind.preset.js`.<br>- Đủ 13 component (`Button`, `Input`, `Dropdown`, `Modal`, `Drawer`, `Tabs`, `Table`, `Card`, `Badge`, `Toast`, `Skeleton`, `Pagination`, `EmptyState`).<br>- Vượt qua 100% bài kiểm tra `impeccable_audit.mjs` (0 lỗi P0/P1). | **P0** |
| **US-1.2** | **Phân quyền RBAC + Scope & Trợ giảng:** Là Giảng viên/Giáo vụ, tôi muốn gán Trợ giảng vào từng Lớp môn học với các cờ quyền cụ thể để Trợ giảng chỉ thao tác đúng phạm vi được giao. | - Tạo bảng `teaching_staff_assignments`.<br>- Middleware chặn `403 INSUFFICIENT_SCOPE_PERMISSION` khi truy cập ngoài lớp học hoặc thiếu cờ quyền TA.<br>- UI tự động ẩn các nút chức năng mà TA không được cấp quyền. | **P0** |

---

### EPIC 2: Cấu trúc Chương trình học & Notion-Style Block Editor (`Priority: P0`)
- **Phụ thuộc:** `EPIC 1` (Migration `M01`, `M02`).

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-2.1** | **Quản lý Cây Chương trình 5 cấp:** Là Giảng viên, tôi muốn xây dựng cấu trúc `Course → Subject → Topic → Chapter → Lesson` và thiết lập bài học tiên quyết (`LessonPrerequisites`). | - Hỗ trợ kéo-thả sắp xếp thứ tự `Topic`, `Chapter`, `Lesson`.<br>- Không cho phép tạo vòng lặp điều kiện tiên quyết.<br>- Gắn được một hoặc nhiều bài học vào buổi học của lớp (`lesson_sessions`). | **P0** |
| **US-2.2** | **Trình soạn Bài giảng Block Editor (`TW-05`):** Là Giảng viên, tôi muốn soạn bài giảng với 6 nhóm Block (Văn bản, Callout, Học thuật LaTeX/Ví dụ giải từng bước, Quiz tương tác, Multimedia, Code) và lưu dưới dạng JSON có `schema_version`. | - Hỗ trợ kéo thả, thêm, xóa, nhân bản block và nhúng `SharedBlocks`.<br>- Lưu dữ liệu chuẩn JSON (`schema_version: "1.0"`).<br>- Autosave sau 2s kèm backup `IndexedDB` không mất dữ liệu khi F5.<br>- Phát hiện xung đột khi `base_revision_number` cũ hơn DB. | **P0** |
| **US-2.3** | **Xuất bản & Lịch sử Phiên bản (`LessonVersions`):** Là Giảng viên, tôi muốn xem trước (`Preview`), xuất bản bài giảng và khôi phục lại phiên bản cũ khi cần. | - Khi nhấn Xuất bản, tạo snapshot bất biến trong `lesson_versions` và cập nhật `published_version_id`.<br>- Học viên đang học chỉ nhìn thấy phiên bản `PUBLISHED`, không bị ảnh hưởng bởi bản `DRAFT` giảng viên đang sửa. | **P0** |

---

### EPIC 3: Learning Portal & Không gian Học bài Coursera-Style (`Priority: P0`)
- **Phụ thuộc:** `EPIC 2` (Migration `M03`).

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-3.1** | **Trang chủ Học viên & Nút "Tiếp tục học" (`LP-01`):** Là Học viên, tôi muốn thấy ngay bài học đang học dở ở đầu trang chủ và bấm 1 nút để quay lại đúng vị trí gần nhất. | - Hiển thị đầy đủ: Lời chào, Tiếp tục học, Khóa học của tôi, Tiến độ, Lịch học sắp tới, Bài tập cần hoàn thành, Kiểm tra sắp diễn ra, Hoạt động giảng viên, Thông báo.<br>- Nút "Tiếp tục học" mở đúng `lesson_id` và tua tới `last_video_position_sec` / `last_read_block_id`. | **P0** |
| **US-3.2** | **Không gian Học bài (`LP-05`) & Theo dõi Tiến độ:** Là Học viên, tôi muốn học video và bài đọc trên giao diện 3 vùng trực quan, tự động lưu tiến độ và mở khóa bài tiếp theo. | - Sidebar trái hiển thị cây chương bài + trạng thái khóa/mở khóa.<br>- Khu vực trung tâm hiển thị Video HLS + Block Renderer + nút Bài trước/Bài tiếp.<br>- Khu vực phụ hiển thị Tài liệu, Ghi chú mốc thời gian, Hỏi đáp, Wiki.<br>- Heartbeat chống tính trùng sự kiện qua `idempotency_key`.<br>- Responsive mượt mà trên Mobile/Tablet. | **P0** |
| **US-3.3** | **Khám phá & Chi tiết Khóa học (`LP-02`, `LP-03`, `LP-04`):** Là Học viên, tôi muốn xem rõ sự khác biệt giữa Lớp khóa học và Lớp môn học, và chỉ nhìn thấy các khóa học mình có quyền truy cập. | - Ẩn hoàn toàn các khóa học học viên không có quyền nếu hệ thống không bật đăng ký tự do.<br>- Phân tách rõ màn hình tổng hợp Lớp khóa học (`CourseClass`) và không gian riêng của Lớp môn học (`SubjectClass`). | **P0** |

---

### EPIC 4: Bài tập, Chấm bài SpeedGrader & Tích hợp Kiểm tra (`Priority: P1`)
- **Phụ thuộc:** `EPIC 1`, `EPIC 2`, `EPIC 3`.

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-4.1** | **Giao & Nộp Bài tập Nhiều lần (`LP-08`, `TW-08`):** Là Học viên, tôi muốn nộp bài tập gắn bài học hoặc ngoài chương trình và xem lại lịch sử các lần nộp của mình. | - Kiểm tra đúng hạn nộp, phạt nộp muộn (nếu cấu hình) và giới hạn `max_attempts`.<br>- Lưu trữ đầy đủ lịch sử từng lần nộp trong `assignment_submissions`. | **P1** |
| **US-4.2** | **Chấm bài, Trả bài & Đồng bộ Điểm (`TW-09`):** Là Giảng viên/Trợ giảng (có quyền `can_grade`), tôi muốn chấm điểm, viết nhận xét, trả bài và đồng bộ điểm vào sổ điểm LMSPLUS. | - Giao diện chấm bài 2 cột xem trực tiếp tệp đính kèm.<br>- Hỗ trợ trạng thái `RETURNED_FOR_REVISION` (yêu cầu nộp lại).<br>- Đồng bộ điểm sang bảng `grades` của LMSPLUS trong cùng Transaction. | **P1** |
| **US-4.3** | **Gắn Bài kiểm tra LMSPLUS vào Chương trình (`LP-09`, `TW-10`):** Là Giảng viên, tôi muốn gắn đề kiểm tra từ ngân hàng câu hỏi LMSPLUS vào chương/bài học với giới hạn thời gian và quy tắc lấy điểm. | - Tái sử dụng 100% engine `Assessment` của LMSPLUS.<br>- Áp dụng đúng quy tắc tính điểm (`HIGHEST`, `LATEST`, `AVERAGE`) và mở khóa chương tiếp theo khi đạt điểm qua môn. | **P1** |

---

### EPIC 5: Điểm danh QR Động, Đơn xin nghỉ, Học bù & Nhật ký Giảng dạy (`Priority: P1`)
- **Phụ thuộc:** `EPIC 1` (Migration `M05`).

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-5.1** | **Điểm danh Đa phương thức & QR Xoay vòng (`TW-12`):** Là Giảng viên, tôi muốn điểm danh thủ công, chiếu mã QR đổi mỗi 20 giây hoặc đồng bộ từ Zoom/Meet. | - Hỗ trợ đủ 6 trạng thái: `Có mặt`, `Đi muộn`, `Về sớm`, `Vắng có phép`, `Vắng không phép`, `Học bù`.<br>- Mã QR cũ quá chu kỳ không thể dùng để điểm danh hộ.<br>- Mọi chỉnh sửa điểm danh đều lưu vào `attendance_audit_logs`. | **P1** |
| **US-5.2** | **Đơn xin nghỉ & Xếp lịch Học bù (`LP-11`, `TW-13`):** Là Học viên, tôi muốn gửi đơn xin nghỉ kèm minh chứng; khi được duyệt sẽ chuyển sang `Vắng có phép` và được gán buổi học bù. | - Học viên tải được tệp minh chứng (`AttendanceEvidence`).<br>- Khi duyệt đơn, tự động cập nhật `attendance_records` và cho phép gán `MakeUpSessions`. | **P1** |
| **US-5.3** | **Nhật ký Giảng dạy & Xác nhận Buổi dạy (`TW-14`, `TW-15`):** Là Giảng viên, tôi muốn ghi nhật ký buổi dạy (giờ thực tế, dạy thay, trợ giảng, bài đã dạy xong/dạy một phần) và ký xác nhận buổi dạy. | - Tách biệt dữ liệu giờ dạy giảng viên (`teaching_logs`) với điểm danh học viên.<br>- Tự động gắn cờ `OVERDUE_UNCONFIRMED` nếu quá hạn chưa xác nhận.<br>- Lưu đầy đủ lịch sử thay đổi trong `teaching_log_history`. | **P1** |

---

### EPIC 6: Wiki Thuật ngữ, Diễn đàn Học thuật & Tích hợp Đa phương tiện (`Priority: P2`)
- **Phụ thuộc:** `EPIC 2`, `EPIC 3` (Migration `M02`, `M04`, `M05`).

| Mã US | Feature / User Story | Tiêu chí Nghiệm thu (Acceptance Criteria) | Ưu tiên |
| :---: | :--- | :--- | :---: |
| **US-6.1** | **Wiki Thuật ngữ & Inline Popover (`LP-06`, `TW-07`):** Là Học viên, tôi muốn xem định nghĩa thuật ngữ ngay trong bài giảng và tra cứu theo nhiều tên gọi/môn học. | - Liên kết chuẩn theo `term_id` trong `lesson_term_links`.<br>- Hỗ trợ `WikiAliases`, nhiều nghĩa theo `subject_id` và trạng thái `DRAFT / PUBLISHED`. | **P2** |
| **US-6.2** | **Diễn đàn Học tập & Kiểm duyệt (`LP-07`, `TW-11`):** Là Học viên & Giảng viên, tôi muốn trao đổi hỏi đáp theo bài học, hỗ trợ chấm điểm thảo luận và kiểm duyệt vi phạm. | - Hỗ trợ cả phạm vi theo lớp (`CLASS_ONLY`) và dùng chung nhiều lớp cùng môn (`SUBJECT_SHARED`).<br>- Giới hạn trả lời lồng tối đa 2 cấp (`depth_level IN (1, 2)`).<br>- Đầy đủ chức năng `@mention`, Ghim, Khóa, Báo cáo vi phạm, Nhật ký kiểm duyệt. | **P2** |
| **US-6.3** | **Tích hợp Zoom/Meet, Video HLS & Speech-to-Text (`Domain 9`):** Là Quản trị viên & Giảng viên, tôi muốn cấu hình tích hợp an toàn và sinh phụ đề tự động cho video bài giảng. | - Mã hóa toàn bộ API Key/Secret bằng AES-256-GCM trong `external_integration_configs` (không lưu plaintext).<br>- Hỗ trợ tìm kiếm nội dung bài giảng theo phụ đề `media_transcriptions`. | **P2** |
