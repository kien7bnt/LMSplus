# MASTER AUDIT — ĐÁNH GIÁ TOÀN DIỆN HỆ THỐNG LMSPLUS

> **Ngày kiểm toán:** 2026-11-25  
> **Thư mục dự án:** `D:\LMS elearning` (`main` @ `187b4b3`)  
> **Phạm vi:** Backend Node ESM (`backend/server_fallback.mjs`, `backend/teaching/*`, `backend/db/client.mjs`), Python FastAPI kế thừa (`backend/main.py`, `backend/app/*`), Serverless (`api/index.mjs`, `vercel.json`), Database SQLite & PostgreSQL 18 (`database/migrations/*`), Frontend React/TypeScript/Vite (`frontend/src/*`, `theme/*`, `design-system/*`).

---

## 1. Tổng quan Kiến trúc & Hiện trạng Baseline

| Thành phần | Hiện trạng thực tế | Mức độ hoàn thiện |
|---|---|---|
| **Runtime API & Serverless** | Hệ thống chạy thực tế bằng **Node.js 24 ESM** (`backend/server_fallback.mjs` + 16 module `backend/teaching/*.mjs`), gắn vào Vercel qua `api/index.mjs` + `vercel.json`. Dev local chạy song song Vite proxy (`frontend/vite.config.ts`) tới `127.0.0.1:8000` (tự fallback vào `server_fallback.mjs` nếu port 8000 tắt). | Đang vận hành, nhưng còn tồn tại `backend/main.py` (`FastAPI`) không đồng bộ ở chế độ legacy. |
| **Database Layer** | Đã chuyển đổi sang **PostgreSQL 18** (`pg.Pool`) thông qua adapter hai chế độ `backend/db/client.mjs` (Postgres 18 chính, `node:sqlite` fallback cho test cô lập). Schema live nằm tại `database/migrations/010_postgres18_live_schema.sql` (80 bảng, 43 index, 4,706 dòng dữ liệu đã migrate từ SQLite). | Tồn tại 2 nhánh migration không tương thích (`000`–`009` vs `010`), script rollback `2-migrate-db.bat` bị lệch, thiếu script backup/restore. |
| **Frontend UI & Modules** | React 18 + TypeScript + Vite (`frontend/src/` gồm 48 file). Đã có các phân hệ: Auth, Teaching Dashboard, Khung CT, Khóa học, Lớp khóa học, Lớp môn học, Lesson Studio (15 block + Video Quiz), Strict Video Player, Bài tập/Kiểm tra, Điểm danh/QR/Virtual Classroom, TKB, Giờ dạy, Diễn đàn, Wiki, Thông báo, Xin nghỉ. | Chạy được E2E nhiều luồng chính, nhưng có **4 file quá lớn >1,500–4,290 dòng**, 77 cast `any`, ~4,400 dòng code legacy chết, 2 API client & 2 bộ UI kit tách rời, một số lỗ hổng UI/nghiệp vụ P0–P1. |
| **Baseline Test trước Refactor** | `npm test` (`123/123` SQLite + adapter), 6 suite trên PostgreSQL 18 Docker (`119/119`), `vite build` (`tsc && vite build`, 74 modules), `impeccable_audit.mjs` (`0 issues` trên 44 file), `verify_system_and_sql.mjs` (`0 errors`). Production URL `https://lmsplus-seven.vercel.app/health` trả HTTP 200 (`PostgreSQL 18`). | Nền tảng test có sẵn tốt, cần bổ sung Unit/E2E/Security/Load test và dọn lỗi nền tảng. |

---

## 2. Phân loại Vấn đề theo Mức độ Nghiêm trọng (P0 / P1 / P2 / P3)

### 2.1. P0 — Nghiêm trọng (Chặn Production / Bảo mật / Mất dữ liệu / Gãy luồng lõi)

| Mã | Nhóm | Vị trí code | Mô tả & Nguyên nhân |
|---|---|---|---|
| **P0-1** | Bảo mật | `backend/server_fallback.mjs:682-686`, `backend/app/api/v1/elearning_router.py:667-671` | Endpoint `POST /api/v1/elearning/testing/reset-seed` **mở công khai, không JWT, không kiểm tra quyền hay `NODE_ENV`**. Trên PG18, gọi `TRUNCATE TABLE ... CASCADE` xóa sạch toàn bộ 80 bảng. |
| **P0-2** | Bảo mật | `backend/server_fallback.mjs:54`, `backend/teaching/routes.mjs:28`, `learn.mjs:109`, `virtualClassroom.mjs:1158`, `virtualProviders.mjs:23,160-161,509-510`, `sql_repository.py:30` | Hardcode fallback secret (`'lmsplus-production-grade-hmac-secret-2026'`, webhook secrets) ngay cả khi `NODE_ENV=production`. Không fail-closed nếu thiếu biến môi trường mật khẩu/secret trong Production. |
| **P0-3** | Bảo mật | `backend/server_fallback.mjs:690-713`, `backend/app/api/v1/elearning_router.py:102-128` | `POST /api/v1/elearning/auth/token` phát JWT không cần mật khẩu theo `role`. Bản Node chỉ kiểm tra `NODE_ENV === 'production'` (dễ hở ở staging/preview), bản Python **không khóa ở bất kỳ môi trường nào**. |
| **P0-4** | Bảo mật Webhook | `backend/teaching/virtualClassroom.mjs:971-985, 1120-1137`, `virtualProviders.mjs:452-490` | Webhook Google Meet **không xác thực chữ ký / token**, vẫn ghi `signature_verified = 1`, cho phép kẻ tấn công giả lập tham gia/rời phòng học. Zoom `endpoint.url_validation` bỏ qua verify signature nếu thiếu header `x-zm-signature`, biến thành HMAC oracle. |
| **P0-5** | Bảo mật XSS | `backend/teaching/leaveAndForums.mjs:237`, `frontend/src/teaching/pages/LeaveRequestsPage.tsx:138-141, 204-207`, `assessmentsAndAssignments.mjs:1049,1349`, `studio.mjs:1556` | Stored XSS qua `evidence_url` (cho phép `javascript:...` render vào `<a href>` lấy cắp JWT trong `localStorage`); `submission_link` / `attachments` thiếu kiểm tra URL scheme; thumbnail video cho phép `data:image/svg+xml`. |
| **P0-6** | Phân quyền & Scope | `backend/server_fallback.mjs:871-991, 997-1512, 1616-1796` | Legacy routes hở nghiêm trọng: `simulate-overdue-24h` không kiểm tra role; `leave-requests/:id/decision` chỉ chặn `STUDENT`; `workspace/bootstrap` lộ toàn bộ `leave_requests`, `sessions`, `all_courses`; `/progress/heartbeat` & `/complete` tin tưởng client và ghi đè trạng thái chung toàn lớp; `/crud/*` thiếu ownership/dept scope và hardcode `'dept_se'`. |
| **P0-7** | Split-brain & Kiến trúc | `backend/main.py`, `backend/app/*`, `frontend/vite.config.ts:19-61` | Python FastAPI không có bất kỳ route `/api/v1/teaching/*` nào, thiếu PostgreSQL 18 và `/auth/login`. Nếu chạy port `:8000` bằng Python, toàn bộ app hiện tại hỏng với `404`. |
| **P0-8** | Lưu trữ File Serverless | `backend/server_fallback.mjs:556-561`, `studio.mjs`, `courses.mjs`, `banks.mjs` | Khi chạy serverless (`IS_SERVERLESS`), file upload (video chunks, PDF, tài liệu) ghi vào `/tmp` (bị xóa giữa các cold start/instance), thiếu **Storage Adapter** (Local vs S3/R2/Cloud Blob). |
| **P0-9** | Nghiệp vụ & Dữ liệu lõi | `frontend/src/teaching/studio/LessonStudioPage.tsx:1052, 2771`, `StudentAssessmentPages.tsx:463-471`, `assessmentsAndAssignments.mjs`, `scope.mjs:10-15` | (1) Lesson Studio xóa trắng thumbnail `data:image/...` của video upload thành `""`; (2) Modal nộp bài tập của học viên thiếu upload file cho loại `FILE`/`MIXED`; (3) Thiếu hoàn toàn thực thể **Tổ chức / Khoa / Bộ môn** & quyền riêng **`HEAD_OF_DEPARTMENT` (Trưởng bộ môn)** trong RBAC hiện tại; (4) Thiếu **Rubric chấm điểm** ở cấp lớp & luồng **Phúc khảo (Grade Appeals)**. |

---

### 2.2. P1 — Cao (Lỗi runtime / Sai scope bộ phận / Thiếu bảo vệ dữ liệu & UX quan trọng)

| Mã | Nhóm | Vị trí code | Mô tả & Nguyên nhân |
|---|---|---|---|
| **P1-1** | Xác thực Mật khẩu | `backend/server_fallback.mjs:58-63, 360, 740-749`, `AuthPage.tsx:16-23, 259-287` | `hashPassword` dùng HMAC-SHA256 không salt gắn với `JWT_SECRET` (đổi `JWT_SECRET` sẽ hỏng toàn bộ password hash!), so sánh chuỗi không dùng `timingSafeEqual`. `AuthPage` hiển thị danh sách tài khoản mẫu & nhắc mật khẩu mặc định `'123456'` công khai kể cả khi production. |
| **P1-2** | Session & Token | `backend/server_fallback.mjs:77-112, 565-578, 1361-1391`, `studio.mjs:59-73`, `elearningClient.ts:60-99` | Thiếu refresh token & thu hồi token (đổi role hoặc xóa user không vô hiệu JWT cũ); `verifyJwtToken` không kiểm tra `header.alg === 'HS256'` và dùng `!==`; `verifyMediaStreamToken` bỏ sót `Number.isNaN(Number(decoded.exp))` (làm token thiếu `exp` không bao giờ hết hạn). |
| **P1-3** | CORS, Security Headers & Rate Limit | `server_fallback.mjs:600-604`, `routes.mjs:82-86`, `vercel.json`, `attendance.mjs:23-39` | `Access-Control-Allow-Origin: *`, quảng bá `X-LMSPLUS-Role` trong `Allow-Headers`; thiếu security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `CSP`); hoàn toàn không có rate limiting trên `/auth/login`, `/auth/register`, upload, webhook. |
| **P1-4** | Phân quyền Quản trị | `backend/teaching/virtualClassroom.mjs:1160-1195, 1249` | Bất kỳ `INSTRUCTOR` nào đều xem và ghi đè được cấu hình OAuth / Webhook / Secret Zoom & Google Meet toàn hệ thống (`PUT /virtual-providers/:provider`), thay vì chỉ `ADMIN`. |
| **P1-5** | Rò rỉ Scope Khoa/Bộ môn | `curriculaAndCohorts.mjs:23,180,240,404,486,809,856`, `trainingPrep.mjs:36-45,924,1299`, `timetableEngine.mjs:31-40,376-456,484,865,1023,1167,1178,1241`, `teachingHours.mjs:210,236,285,523,545,655,925`, `contentTreeAndSnapshots.mjs:623`, `studio.mjs:342` | Giáo vụ không có `department_id` vượt qua kiểm tra phạm vi (`if (deptId && user.department_id)`); nhiều route đơn lẻ/chuyển lớp/xếp TKB/duyệt giờ dạy/hủy khóa bỏ sót lọc `department_id`; `studio.mjs:342` cho phép nhúng câu hỏi từ ngân hàng môn học khác; `contentTreeAndSnapshots.mjs:623` cho học viên lớp `DRAFT`/`CANCELLED` đọc Wiki. |
| **P1-6** | Upload & Validation | `courses.mjs:879-942`, `banks.mjs:585`, `studio.mjs:1395-1560` | Upload tài liệu & video chỉ kiểm tra phần mở rộng file (thiếu kiểm tra magic bytes tối thiểu cho video/ZIP/ảnh); kiểm tra path traversal thiếu `path.sep` (`startsWith(base)` thay vì `base + path.sep`); `replace_resource_id` thiếu check `resource_type = 'VIDEO'`. |
| **P1-7** | Lỗi SQL & Dialect | `backend/teaching/trainingPrep.mjs:1192-1209`, `courses.mjs:269` | `PUT /curricula/:id/session-plans/:courseId` liệt kê **13 cột nhưng truyền 12 giá trị** (lỗi SQL chắc chắn); `courses.mjs:269` dùng `COLLATE NOCASE` (lỗi trên PostgreSQL 18 khi `sort=title_asc`). |
| **P1-8** | Bug Frontend & State | `StudentAssessmentPages.tsx:106-123`, `TeachingHoursPage.tsx:666`, `AdminAccountsPage.tsx:2-4`, `BanksPage.tsx`, `ClassDetailPage.tsx`, `LeaveRequestsPage.tsx`, `ForumPanel.tsx` | Timer thi reset `setInterval` mỗi giây do phụ thuộc `res` mới; `InstructorQuotasPanel` không đồng bộ khi đổi tháng; `AdminAccountsPage` phụ thuộc API legacy `workspace/bootstrap`; nhiều thao tác xóa/duyệt/hủy thiếu `ConfirmDialog` và `try/catch`; Dashboard dùng công thức phần trăm giả định (`100 - len * 15`); thiếu UI cấu hình `minutes_per_period` (đang hardcode 45p/0.75h ở 4 nơi); Import/Export thiếu Preview, thông báo lỗi từng dòng & CSV ngân hàng; Frontend guard quá thô cho `TEACHING_ASSISTANT`. |

---

### 2.3. P2 — Trung bình (Kiến trúc, Migration, UI/UX Token & Design System)

| Mã | Nhóm | Vị trí code | Mô tả |
|---|---|---|---|
| **P2-1** | Migration & Data Safety | `database/migrations/000..009` vs `010`, `2-migrate-db.bat`, `scripts/migrate-sqlite-to-pg.mjs` | Hai nhánh schema không đồng bộ; rollback `DOWN` gọi `009..001` sai với `010`; thiếu script `pg_dump` backup / restore trước `--truncate`; thiếu nhiều FK trên `sessions`, `chapters`, `leave_requests`, `teaching_forums`; `ON DELETE CASCADE` xóa `user`/`lesson` gây mất dữ liệu kiểm toán/timesheets; TLS Postgres dùng `rejectUnauthorized: false` mặc định. |
| **P2-2** | Transaction | `backend/server_fallback.mjs` (0 `tx`), `virtualClassroom.mjs:1996`, `classes.mjs:596`, `teachingHours.mjs:236`, `courses.mjs:857`, `banks.mjs:569`, `contentTreeAndSnapshots.mjs:180,198`, `trainingPrep.mjs:431,985` | Các thao tác ghi nhiều bảng chưa bọc trong `tx(db, ...)`, nguy cơ dữ liệu nửa vời khi lỗi giữa chừng. |
| **P2-3** | Tách module lớn & Technical Debt | Backend: `virtualClassroom.mjs` (2,584L), `studio.mjs` (2,477L), `server_fallback.mjs` (1,888L). Frontend: `LessonStudioPage.tsx` (4,290L), `index.css` (5,255L), `teaching/api.ts` (2,890L), `ClassDetailPage.tsx` (2,654L), 77 `any` | File quá tải, trộn lẫn transport/validation/domain/presentation; hai client API (`elearningClient.ts` & `teaching/api.ts`) và hai UI kit (`Primitives.tsx` & `ui.tsx`) trùng lặp. |
| **P2-4** | UI/UX & Design Tokens | `frontend/src/index.css` vs `theme/tokens.css`, `StudentPages.tsx:371`, `VirtualSessionPage.tsx:1765`, `App.tsx`, `LessonStudioPage.tsx:115,119` | `index.css` trùng lặp và lệch scale/màu so với `theme/tokens.css`, chứa 16 giá trị màu cứng & `--accent-teal` không tồn tại; thiếu `@tailwind base`; một số nút chạm `< 44px` (`36px`, `28px`) và `button:active` ghi đè `transform` của `.ls-marker-pin`; `VirtualSessionPage` lộ enum thô `connection_status`; thiếu Dashboard chuyên biệt theo vai trò, sidebar nhóm 7 phân khu & Cinema-dark mặc định cho trình học video; thiếu editor cho `step_by_step_solution`. |

---

### 2.4. P3 — Thấp (Dọn dẹp & Tối ưu phụ)

| Mã | Nhóm | Vị trí code | Mô tả |
|---|---|---|---|
| **P3-1** | Dead code | `CrudManagementView.tsx` (1,569L), `LessonPlayerView.tsx` (781L), `TeachingLogAndAttendanceView.tsx` (725L), `BlockEditorView.tsx` (488L), `LessonEditorPage.tsx` (397L), `BlockEditor.tsx` (433L) | Hơn 4,390 dòng UI legacy không còn route nào sử dụng nhưng vẫn nằm trong source tree; `verify_system_and_sql.mjs` đang check tồn tại 3 file cũ đó (`:123-125`). |
| **P3-2** | Lỗi phụ & Logging | `backend/server_fallback.mjs:1850`, `api/index.mjs:59`, `LessonStudioPage` / `TimetablePage:69` | `(await ensureInitialized()).then(...)` ở dòng `1850` lỗi khi chạy CLI trực tiếp; log HTTP in cả `?st=` query token; UI hardcode `'cp_cs1'` / `'rm_5a1'` làm fallback ID. |

---

## 3. Kết luận Kiểm toán

- Hệ thống đã có nền tảng nghiệp vụ E-learning sâu (78+ endpoint `/api/v1/teaching/*`, 80 bảng PostgreSQL 18, 123 test tự động) **nhưng chưa đủ điều kiện triển khai Production an toàn** do còn các lỗ hổng P0 về **tính bảo mật (`reset-seed` công khai, fallback secret, Google Meet webhook không verify, XSS `evidence_url`)**, **lệch scope & thiếu `Trưởng bộ môn`**, **chưa có Storage Adapter cho môi trường serverless**, và **một số khoảng trống nghiệp vụ/UX quan trọng**.
- Kế hoạch 5 Phase tiếp theo trong [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) sẽ khắc phục tuần tự từ nền tảng bảo mật → kiến trúc & lưu trữ → UI/UX đồng bộ → hoàn thiện nghiệp vụ → hiệu năng, kiểm thử toàn diện & Production Checklist.
