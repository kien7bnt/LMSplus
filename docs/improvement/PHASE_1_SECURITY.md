# BÁO CÁO NGHIỆM THU PHASE 1 — BẢO MẬT, PHÂN QUYỀN & AN TOÀN DỮ LIỆU

> **Tài liệu chi tiết lỗ hổng:** [`docs/audit/PHASE_1_SECURITY_AUDIT.md`](../audit/PHASE_1_SECURITY_AUDIT.md)  
> **Tài liệu Migration & Backup:** [`docs/improvement/DATABASE_MIGRATION.md`](./DATABASE_MIGRATION.md)  
> **Trạng thái Phase 1:** Đã hoàn thành triển khai và vượt qua kiểm thử trên SQLite, PostgreSQL 18.7 Docker và Vite Frontend Build.

---

## A. Kết quả khảo sát

Khảo sát toàn bộ nhánh backend Node.js ESM (`backend/server_fallback.mjs`, `backend/teaching/*.mjs`, `backend/db/client.mjs`), nhánh kế thừa FastAPI (`backend/main.py`, `backend/app/api/v1/elearning_router.py`, `backend/app/db/sql_repository.py`), cấu hình Vercel/Docker (`.env.example`, `vercel.json`, `2-migrate-db.bat`, `scripts/migrate-sqlite-to-pg.mjs`) và phần xác thực/render link phía frontend (`elearningClient.ts`, `AuthPage.tsx`, `AdminAccountsPage.tsx`, `ui.tsx`, `LeaveRequestsPage.tsx`) ghi nhận các nhóm rủi ro cốt lõi đã tổng hợp trong [`MASTER_AUDIT.md`](./MASTER_AUDIT.md) và [`PHASE_1_SECURITY_AUDIT.md`](../audit/PHASE_1_SECURITY_AUDIT.md):
- Endpoint hủy dữ liệu `/testing/reset-seed` và cấp JWT `/auth/token` không được bảo vệ đúng mức.
- Tồn tại secret mặc định cứng trong source và fallback cho webhook.
- Thuật toán băm mật khẩu phụ thuộc `JWT_SECRET`, thiếu refresh token rotation, thiếu cơ chế thu hồi token (`token_version`).
- Google Meet webhook thiếu kiểm tra chữ ký; Stored XSS qua `evidence_url` / SVG thumbnail; thiếu magic-byte validation khi upload.
- Chưa có bảng `departments` và phân quyền `HEAD_OF_DEPARTMENT` trong hệ thống RBAC hiện có; nhiều route cho phép giáo vụ có `department_id = NULL` hoặc truy vấn đơn lẻ vượt phạm vi bộ môn; phát hiện 2 lỗi SQL nghiêm trọng (`COLLATE NOCASE` và thiếu placeholder `INSERT session_plan_items`).

---

## B. Danh sách vấn đề

Xem đầy đủ 13 nhóm vấn đề P0/P1 đã phân loại và gắn mã `SEC-01` đến `SEC-13` tại [`docs/audit/PHASE_1_SECURITY_AUDIT.md`](../audit/PHASE_1_SECURITY_AUDIT.md).

---

## C. Phương án thực hiện

1. Tách module bảo mật dùng chung `backend/common/security.mjs` xử lý: fail-closed env secret resolution, `scrypt$` salt ngẫu nhiên + `timingSafeEqual`, strict `HS256` JWT + refresh token rotation + media token `exp` validation, allowlist CORS + security headers, rate limiter, sanitization URL/thumbnail, `safeResolveUnder`, và kiểm tra magic bytes upload.
2. Tạo Migration `011_security_departments_and_lms_v2` (UP & DOWN có transaction) bổ sung bảng `schema_migrations`, `departments` (cùng 3 bản ghi tổ chức nền tảng idempotent), `auth_refresh_tokens`, và cột `token_version`, `is_active`, `failed_login_count`, `locked_until` vào bảng `users`.
3. Cập nhật RBAC trong `backend/teaching/scope.mjs` (không tạo RBAC song song) để tách rõ quyền `SUPER_ADMIN` và `HEAD_OF_DEPARTMENT` (phê duyệt đề cương/khung chương trình/giờ dạy trong phạm vi bộ môn, không tự đồng nhất với quyền Admin xóa hệ thống hay chốt tài chính) và vá kiểm tra scope trên toàn bộ router giảng dạy + legacy endpoints.
4. Viết công cụ `scripts/backup-restore-pg.mjs` kèm SHA-256 verification và kiểm tra migration/rollback.
5. Cập nhật frontend hỗ trợ refresh token tự động, logout thu hồi phiên, ẩn tài khoản mẫu ở bản production, loại bỏ `'123456'` mặc định và lọc an toàn link ngoài qua `safeHref()`.

---

## D. Danh sách file đã thay đổi / thêm mới

- **Mới:** `backend/common/security.mjs`, `database/migrations/011_security_departments_and_lms_v2_up.sql`, `database/migrations/011_security_departments_and_lms_v2_down.sql`, `scripts/backup-restore-pg.mjs`, `tests/security_audit_test_suite.mjs`, `frontend/src/vite-env.d.ts`, `docs/audit/PHASE_1_SECURITY_AUDIT.md`, `docs/improvement/PHASE_1_SECURITY.md`, `docs/improvement/DATABASE_MIGRATION.md`.
- **Cập nhật Backend & Hạ tầng:** `.env.example`, `package.json`, `vercel.json`, `2-migrate-db.bat`, `scripts/migrate-sqlite-to-pg.mjs`, `backend/db/client.mjs`, `backend/server_fallback.mjs`, `backend/teaching/routes.mjs`, `backend/teaching/learn.mjs`, `backend/teaching/scope.mjs`, `backend/teaching/schema.mjs`, `backend/teaching/virtualProviders.mjs`, `backend/teaching/virtualClassroom.mjs`, `backend/teaching/courses.mjs`, `backend/teaching/banks.mjs`, `backend/teaching/studio.mjs`, `backend/teaching/leaveAndForums.mjs`, `backend/teaching/assessmentsAndAssignments.mjs`, `backend/teaching/curriculaAndCohorts.mjs`, `backend/teaching/trainingPrep.mjs`, `backend/teaching/timetableEngine.mjs`, `backend/teaching/teachingHours.mjs`, `backend/teaching/contentTreeAndSnapshots.mjs`, `backend/main.py`, `backend/app/db/sql_repository.py`, `backend/app/api/v1/elearning_router.py`.
- **Cập nhật Frontend & Tests:** `frontend/src/types/elearning.ts`, `frontend/src/api/elearningClient.ts`, `frontend/src/components/elearning/AuthPage.tsx`, `frontend/src/components/elearning/BlockEditorView.tsx`, `frontend/src/teaching/pages/AdminAccountsPage.tsx`, `frontend/src/teaching/ui.tsx`, `frontend/src/teaching/pages/LeaveRequestsPage.tsx`, `tests/lesson_studio_test_suite.mjs`.

---

## E. Migration đã thực hiện

- Áp dụng **Migration `011_security_departments_and_lms_v2_up.sql`** vào cơ sở dữ liệu PostgreSQL 18.7 cục bộ qua `npm run db:schema`:
  - Kết quả thực tế: `[PG] Đã kết nối: PostgreSQL 18.7 on x86_64-pc-linux-musl...`
  - `[PG] Đã áp dụng schema PostgreSQL 18 (83 bảng, 1 incremental migration).`
  - Bảo toàn toàn bộ dữ liệu gốc (không truncate).

---

## F. Kết quả kiểm thử

| Kiểm thử | Môi trường | Kết quả quan sát thực tế |
|---|---|---|
| `npm test` (8 suites: adapter, security, elearning, teaching, studio, master_lms, training_lifecycle, virtual_classroom) | Node.js + SQLite | **135/135 PASS (`0` failed)** |
| 7 suites tích hợp qua PostgreSQL 18.7 (`lmsplus_test` thực tế) | Node.js + PG 18.7 Docker | **131/131 PASS (`0` failed)** |
| `node scripts/backup-restore-pg.mjs` (`backup` → `verify` → `restore --dry-run`) | PG 18.7 (`lmsplus`) | **PASS**: 83 bảng, 4,710 bản ghi, kiểm tra SHA-256 `53a9062f357e...` |
| `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | Repository files | **PASS**: `0 errors` |
| `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs` | 48 tệp Frontend | **PASS**: `Total Issues: 0 (P0 Critical: 0, P1 High: 0)` |
| `npm --prefix frontend run build` (`tsc && vite build`) | Frontend TypeScript & Vite 5.4 | **PASS**: `74 modules transformed`, build xong trong `7.07s` |
| `py -m py_compile ...` | Windows Host | **Chưa chạy được**: môi trường host thiếu `Python311\python.exe` (đã rà soát tĩnh mã nguồn Python) |

---

## G. Rủi ro còn lại

1. File upload hiện tại vẫn lưu trên ổ đĩa local / `/tmp` khi chạy serverless — sẽ được thay thế bằng **Storage Adapter** ở Phase 2.
2. Hai luồng `backend/main.py` (Python FastAPI) và `backend/server_fallback.mjs` vẫn song song tồn tại trong repo; runtime Python chưa kiểm thử được trên máy host hiện tại.
3. Màn hình quản trị chuyên sâu cho `departments` & `HEAD_OF_DEPARTMENT` chưa có giao diện CRUD trên frontend (mới có DB, RBAC & API scope) — sẽ hoàn thiện ở Phase 2 & Phase 4.

---

## H. Việc cần làm tiếp ở Phase 2

1. Xây dựng `backend/storage/adapter.mjs` (hỗ trợ Local Disk phân thư mục tài nguyên và S3/R2/Vercel Blob HTTP Adapter cho Production).
2. Tái cấu trúc chia module sạch cho `server_fallback.mjs`, `studio.mjs`, `virtualClassroom.mjs`, bọc transaction `tx()` đồng bộ cho toàn bộ multi-write routes, và bổ sung API CRUD `departments` + `users`.
3. Hợp nhất tầng API/UI Frontend, tách `LessonStudioPage.tsx` và `ClassDetailPage.tsx`, giảm mạnh `any` và dọn các file view legacy không còn sử dụng.
