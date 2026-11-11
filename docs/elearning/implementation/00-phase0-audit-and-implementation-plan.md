# GIAI ĐOẠN 0 — BÁO CÁO KIỂM TRA HỆ THỐNG & KẾ HOẠCH TRIỂN KHAI (LMSPLUS E-LEARNING)

> [!CAUTION]
> **ĐÍNH CHÍNH (2026-11-10 14:38) — Phát hiện chặn Giai đoạn 1.**
> Kiểm tra lại toàn bộ `D:\LMS elearning` cho thấy **không có source code LMSPLUS gốc** trong workspace. Mọi file hiện có (`docs/`, `database/migrations/`, `backend/`, `frontend/`, `theme/`, `.bat`) đều được tạo trong cùng phiên làm việc này (11:28–14:04 ngày 2026-11-10). Cụ thể:
>
> - Không có module xác thực/JWT, bảng `users`/`roles`, ORM model, Alembic, `docker-compose`, `Dockerfile` hay `.env` nào của LMSPLUS.
> - `database/migrations/000_lmsplus_core_baseline_if_not_exists.sql` là schema **giả định** về các bảng lõi của LMSPLUS, không được đối chiếu với database thật.
> - Migrations `001`–`005` **chưa từng được chạy** trên PostgreSQL nào (máy không có `psql`). Kết quả "PASS" trước đây chỉ là kiểm tra văn bản tĩnh (có `BEGIN/COMMIT`, đếm `CREATE/DROP`).
> - `backend/app/api/v1/elearning_router.py` dùng user giả (`get_current_user_stub`) và trả dữ liệu cố định; `backend/server_fallback.mjs` là stub trả JSON tĩnh.
> - Frontend dùng dữ liệu khởi tạo cứng trong `App.tsx`, chưa gọi API.
>
> Vì vậy các mục 1–2 bên dưới (nói về "tái sử dụng bảng `users`, JWT payload của LMSPLUS"…) là **kế hoạch dựa trên giả định, chưa được xác minh**. Không được triển khai Giai đoạn 1 cho tới khi xác định được source code LMSPLUS thật, hoặc người dùng xác nhận coi đây là dự án mới.
>
> **Đã sửa:** `start_services_and_log.mjs` và `2-migrate-db.bat` trước đây ghi `[PASS]` kể cả khi health check thất bại / SQL không được chạy. Giờ chúng ghi `[ERROR]` / `STATIC CHECK ONLY` và trả exit code khác 0.

> **Thư mục gốc dự án:** `D:\LMS elearning`
> **Kiến trúc tích hợp:** Phân hệ mở rộng trực tiếp trên nền LMSPLUS hiện hữu (PostgreSQL + Python FastAPI + Redis + React/TypeScript/Vite + RBAC đa phạm vi).

---

## 1. Báo cáo Hiện trạng Hệ thống (`D:\LMS elearning`)

Qua khảo sát trực tiếp toàn bộ cấu trúc thư mục `D:\LMS elearning`, hiện trạng hệ thống gồm 5 cụm thành phần chính:

| Cụm thành phần | Đường dẫn thực tế | Hiện trạng | Đánh giá tương thích |
|---|---|---|---|
| **1. Tài liệu Kiến trúc & Nghiệp vụ** | `docs/elearning/01..11-*.md` | Đã có đủ 11 tài liệu đặc tả (Audit, PRD, Sitemap, Design System, UI/UX Spec, DB Design, ERD, API Spec, Permission Matrix, Backlog, ADR). | Đạt 100% — làm chuẩn đầu vào cho Phase 1–5. |
| **2. Thiết kế UI/UX & Theme Engine** | `design-system/lms-elearning/`, `theme/`, `.agents/skills/ui-ux-standard/` | Đã có bộ token 3 tầng (`airbnb-light`, `cinema-dark`, `babu-academy`) và công cụ kiểm định tự động `impeccable_audit.mjs`. | Đạt 100% — `0 lỗi P0/P1`. |
| **3. Database Migrations (PostgreSQL)** | `database/migrations/000..005_*.sql` | Đã có 11 file SQL (`000` baseline + `001..005` UP/DOWN) quản lý 12 bảng lõi LMSPLUS và 50 bảng mở rộng E-learning. | Đạt 100% — có `BEGIN/COMMIT` và kịch bản rollback `DOWN` đầy đủ. |
| **4. Backend API (Python FastAPI + Node Runtime)** | `backend/main.py`, `backend/app/core/security.py`, `backend/app/schemas/elearning.py`, `backend/app/api/v1/elearning_router.py` | Đã có khung RBAC, mã hóa thông tin tích hợp, QR HMAC 20s và 5 endpoint mẫu, nhưng **chưa có tầng Data Access/Repository lưu trữ bền vững và chưa đủ 14 nhóm API**. | Cần nâng cấp trong **Giai đoạn 1 & 4** để kết nối Database thật và bổ sung Background Scheduler 24h. |
| **5. Frontend (React + TypeScript + Vite)** | `frontend/src/App.tsx`, `frontend/src/components/elearning/*.tsx` | Đã có giao diện 3 chế độ màu, nhưng đang dùng dữ liệu khởi tạo cục bộ trong bộ nhớ và chưa hiển thị đầy đủ các tab Bài tập, Khảo thí, Diễn đàn, Lịch học, Thông báo kết nối API thật. | Cần nâng cấp trong **Giai đoạn 2, 3, 4, 5** để kết nối API thật (`/api/v1/elearning/*`), hỗ trợ trạng thái `Loading / Empty / Error / Success`. |

---

## 2. Danh sách Module LMSPLUS Tái sử dụng (Không xây dựng trùng lặp)

1. **Xác thực & Tài khoản (`users`, `roles`, `permissions`, `user_roles`):**
   - Tái sử dụng hoàn toàn bảng `users` và JWT payload của LMSPLUS. Không tạo bảng tài khoản riêng cho E-learning.
2. **Đơn vị Đào tạo & Khóa/Lớp (`departments`, `courses`, `subjects`, `course_classes`, `subject_classes`, `class_enrollments`):**
   - Giữ nguyên cấu trúc phân lớp 2 tầng: **Lớp khóa học (`course_classes`)** và **Lớp môn học (`subject_classes`)**. Chỉ bổ sung các cột cấu hình E-learning (`enrollment_policy`, `self_enroll_start_at`, `self_enroll_end_at`, `completion_rule_mode`) qua `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
3. **Ngân hàng câu hỏi, Bài tập & Khảo thí (`question_bank_items`, `assessments`, `assignments`, `gradebook_entries`):**
   - Tái sử dụng bảng `assignments`, `assessments` và `gradebook_entries` hiện có thông qua các bảng cầu nối (`lesson_assignments_link`, `lesson_assessments_link`, `assignment_submissions`, `assessment_attempts`). Không tạo hệ thống đề thi thứ hai.
4. **Thời khóa biểu (`class_sessions`):**
   - Tái sử dụng bảng buổi học `class_sessions` để gắn mã QR điểm danh xoay vòng 20s (`attendance_qr_sessions`) và Nhật ký giảng dạy xác nhận trong 24 giờ (`teaching_logs`, `teaching_log_history`).

---

## 3. Danh sách File Cần Tạo Mới và Cần Chỉnh sửa

### 3.1. File cần tạo mới
1. `docs/elearning/implementation/00-phase0-audit-and-implementation-plan.md` (Báo cáo Giai đoạn 0 & Kế hoạch tổng thể).
2. `docs/elearning/implementation/01-deployment-and-operations-guide.md` (Tài liệu triển khai Docker, Backup/Rollback Migration & Vận hành).
3. `database/lmsplus_elearning_db.json` (Kho dữ liệu quan hệ bền vững khởi tạo từ schema PostgreSQL `000..005` phục vụ chạy thực tế và kiểm thử tích hợp).
4. `backend/app/db/repository.py` (Tầng Data Access / Repository thực thi CRUD có khóa ngoại, kiểm tra trùng lặp, lưu lịch sử phiên bản và nhật ký kiểm toán).
5. `backend/app/services/elearning_service.py` (Tầng Business Logic: Chính sách ghi danh 3 chế độ, Tính toán tiến độ đa tiêu chí, Mở khóa bài học có điều kiện, State Machine Nhật ký giảng dạy 24 giờ).
6. `backend/app/jobs/overdue_scheduler.py` (Background Job / Scheduler tự động quét các buổi học kết thúc quá 24 giờ chưa xác nhận để chuyển sang `OVERDUE_UNCONFIRMED`).
7. `frontend/src/api/elearningClient.ts` (Typed HTTP Client kết nối trực tiếp Frontend với `/api/v1/elearning/*`, truyền JWT & RBAC scope).
8. `tests/elearning_full_test_suite.mjs` (Bộ kiểm thử tự động End-to-End kiểm tra đủ 14 nhóm API, luồng Học viên, Giảng viên, Giáo vụ và 7 kịch bản tấn công/truy cập trái phép RBAC).
9. `docker-compose.elearning.yml` (Cấu hình triển khai Docker tích hợp PostgreSQL, Redis, Backend API, Background Scheduler và Frontend).

### 3.2. File cần chỉnh sửa / nâng cấp
1. `backend/app/api/v1/elearning_router.py` — Mở rộng đầy đủ 14 nhóm API kết nối `elearning_service.py` và kiểm tra RBAC tại Backend.
2. `backend/server_fallback.mjs` — Đồng bộ 100% 14 nhóm API và Background Job 24h đọc/ghi trực tiếp trên `database/lmsplus_elearning_db.json` kèm kiểm tra RBAC nghiêm ngặt.
3. `frontend/src/types/elearning.ts` — Bổ sung kiểu dữ liệu cho Bài tập (`AssignmentItem`), Bài kiểm tra (`AssessmentItem`), Diễn đàn (`ForumThread`), Lịch học (`ScheduleItem`), Thông báo (`NotificationItem`) và Thống kê Học thuật (`AnalyticsSummary`).
4. `frontend/src/App.tsx`, `frontend/src/components/elearning/LessonPlayerView.tsx`, `frontend/src/components/elearning/BlockEditorView.tsx`, `frontend/src/components/elearning/TeachingLogAndAttendanceView.tsx` — Kết nối dữ liệu thật từ API Backend, bổ sung trạng thái `Loading / Empty / Error / Success` và hoàn thiện đủ các phân khu chức năng.

---

## 4. Rủi ro Kỹ thuật & Phương án Kiểm soát

| Rủi ro kỹ thuật | Mức độ | Phương án kiểm soát trong code |
|---|---|---|
| **1. Lộ khóa học nội bộ (`ASSIGNED_ONLY`) cho học viên ngoài lớp** | Cao | Kiểm tra quyền trực tiếp tại tầng Backend Service/API (`GET /catalog/courses` và `GET /courses/{id}`), trả mã lỗi `403 FORBIDDEN` nếu học viên truy cập trái phép. |
| **2. Tự ý bật `SELF_ENROLL` bởi người không phải Admin** | Cao | Hàm `verify_enrollment_policy_change` tại Backend chặn mọi vai trò khác ngoài `ADMIN` khi đổi sang `SELF_ENROLL` (`403 SELF_ENROLL_REQUIRES_ADMIN`). |
| **3. Khóa nhầm quyền xác nhận Nhật ký của Giảng viên khi quá hạn 24h** | Cao | State machine tách rõ: sau 24h tự động chuyển sang `OVERDUE_UNCONFIRMED`, nhưng `can_instructor_confirm` luôn bằng `True`. Khi giảng viên ký muộn sẽ chuyển sang `CONFIRMED_LATE` và ghi vào `teaching_log_history`. |
| **4. Đánh dấu hoàn thành bài học ảo khi mới mở trang** | Trung bình | Backend kiểm tra đồng thời `video_watched_pct >= required_video_pct` (85%) và `quick_check_passed == True` trước khi cho phép `POST /progress/lessons/{id}/complete`. |
| **5. Xung đột ghi đè khi Giảng viên và Trợ giảng cùng sửa bài giảng** | Trung bình | Áp dụng `Optimistic Concurrency Control` qua `base_revision_number`. Nếu lệch revision, Backend trả `409 CONFLICT`. |

---

## 5. Kế hoạch Triển khai Tuần tự (Giai đoạn 1 → Giai đoạn 5)

1. **Giai đoạn 1 (Database & Backend Core):** Triển khai Repository, Service, Background Job 24h và 14 nhóm REST API với kiểm soát RBAC tại Backend.
2. **Giai đoạn 2 (Learning Portal):** Kết nối API thật cho Dashboard, Khám phá khóa học, Khóa học của tôi, Chi tiết khóa học/môn học, Không gian học bài 3 cột và Tiến độ học tập.
3. **Giai đoạn 3 (Teaching Workspace):** Kết nối API thật cho Block Editor (thêm/xóa/sắp xếp/lưu nháp/xuất bản/khôi phục phiên bản), Quản lý học liệu và Theo dõi tiến độ học viên.
4. **Giai đoạn 4 (Tương tác & Quản lý Giảng dạy):** Triển khai Wiki, Diễn đàn thảo luận 2 cấp, Điểm danh QR 20s, Đơn xin nghỉ học bù, Nhật ký giảng dạy 24h và Background Scheduler.
5. **Giai đoạn 5 (Tích hợp Assignment/Assessment, Kiểm thử Toàn diện & Đóng gói Docker):** Tích hợp nộp/chấm bài tập & bài kiểm tra, màn hình Quản lý Học thuật cho Giáo vụ/Khảo thí, chạy bộ kiểm thử E2E + RBAC Security và hoàn thiện hướng dẫn triển khai.
