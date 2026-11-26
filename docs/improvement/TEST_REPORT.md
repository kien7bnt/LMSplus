# TEST REPORT — BÁO CÁO TỔNG HỢP KIỂM THỬ TOÀN DIỆN LMSPLUS

> **Ngày cập nhật:** 2026-11-25  
> **Phạm vi kiểm thử:** Full-stack Node.js ESM (`backend/server_fallback.mjs` + `backend/teaching/*` + `backend/organization/*` + `backend/storage/*`), React/TypeScript/Vite Frontend, SQLite 3, PostgreSQL 18.7 Docker, UI/UX Impeccable Audit, SQL Compatibility Audit, và Load Test đồng thời 50 / 100 / 200 concurrent users.

---

## 1. Bảng Tổng kết Kết quả Kiểm thử

| Hạng mục kiểm thử | Lệnh / Script thực thi | Môi trường | Kết quả thực tế | Trạng thái |
|---|---|---|---|---|
| **Full Regression Suites (SQLite)** | `npm test` (11 suites) | Node.js v24 + SQLite | **150 / 150 PASSED (0 failed)** | **PASS** |
| **PG18 Integration Suites** | 10 integration suites (`scratch/run_pg_tests.mjs`) | Node.js v24 + PostgreSQL 18.7 (`lmsplus_test`) | **146 / 146 PASSED (0 failed)** | **PASS** |
| **PG18 Schema & Migrations** | `npm run db:schema` | PostgreSQL 18.7 Docker (`lmsplus`) | **84 bảng, 3 incremental migration** (`011`, `012`, `013`) | **PASS** |
| **PG18 Load Test (50 / 100 / 200)** | `node scratch/load_test_pg18.mjs` | HTTP thật + PostgreSQL 18.7 (`DB_POOL_MAX=25`) | **1,750 / 1,750 requests `2xx` (0 lỗi)** | **PASS** |
| **Graceful Shutdown (`SIGTERM`)** | `load_test_pg18.mjs` cleanup | HTTP Server + PG18 Pool | Thoát sạch trước timeout (`code/signal = null`, không cần `SIGKILL`) | **PASS** |
| **Frontend Build & Typecheck** | `npm --prefix frontend run build` | TypeScript + Vite 5.4.21 | **82 modules**, entry **29.04 kB** (gzip **8.82 kB**), `0` cảnh báo >500 kB | **PASS** |
| **UI/UX Impeccable Audit** | `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs` | 46 tệp Frontend | **0 lỗi** (P0 Critical: 0, P1 High: 0, 0 hardcoded hex CSS) | **PASS** |
| **SQL & Migration Compatibility** | `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | SQLite + PG18 schemas | **ALL CHECKS PASSED (0 errors)** | **PASS** |
| **Backup & SHA-256 Verify (Phase 1)** | `node scripts/backup-restore-pg.mjs` (chạy tại Phase 1) | PostgreSQL 18.7 (`lmsplus`) | **83 bảng / 4,710 bản ghi** tại mốc Phase 1 (`012` đã cập nhật `SCHEMA_ORDER` thêm `grade_appeals`) | **PASS (Phase 1)** |
| **Python Legacy Runtime (`backend/main.py`)** | `backend/main.py` / `pytest` | Windows Host | **Chưa thực thi** (máy host chưa cài runtime Python; chỉ rà soát tĩnh ở Phase 1) | **N/A (Missing Python)** |

---

## 2. Chi tiết từng Suite Kiểm thử (SQLite & PostgreSQL 18.7)

| STT | File kiểm thử | Phạm vi kiểm chứng chính | SQLite (`npm test`) | PostgreSQL 18.7 (`lmsplus_test`) |
|---|---|---|---|---|
| 1 | `tests/postgres_adapter_test.mjs` | Parser `? -> $N`, schema PG18 `010` (80 bảng / 43 index nền tảng), `resolveDbMode` | **4 / 4** | *(kiểm tra adapter/schema tĩnh)* |
| 2 | `tests/security_audit_test_suite.mjs` | Fail-closed secrets, `scrypt$`, JWT `alg=none`/refresh/logout, RBAC `HEAD_OF_DEPARTMENT` vs `ADMIN`/`ACADEMIC_STAFF`, rate limit, webhook HMAC, XSS & magic bytes | **12 / 12** | **12 / 12** |
| 3 | `tests/phase2_architecture_test_suite.mjs` | CRUD `departments`, quản lý `users`, `StorageAdapter` (Local & S3/R2/Vercel Blob config), rollback transaction `tx()` | **4 / 4** | **4 / 4** |
| 4 | `tests/phase4_business_test_suite.mjs` | Rubric chấm bài tập & giới hạn điểm, upload tệp + RBAC isolation, Phúc khảo điểm `grade_appeals` đồng bộ Sổ điểm, `minutes_per_period`, `resolveDefaultCampusId`, `SICK` leave & CSV import | **6 / 6** | **6 / 6** |
| 5 | `tests/phase5_performance_test_suite.mjs` | Scoped LRU/TTL cache + invalidation, `sanitizeUrlForLog` che `?st=`/`?api_key=`, tương thích env Storage, gom lô `/dashboard` & `outline()`, Transaction & 7 index Migration `013` | **5 / 5** | **5 / 5** |
| 6 | `tests/elearning_full_test_suite.mjs` | Auth, Khung CT → Môn → Lớp (`ASSIGNED_ONLY` / `REQUEST_APPROVAL` / `SELF_ENROLL`), tiến độ video Strict, điểm danh, nhật ký 24h | **30 / 30** | **30 / 30** |
| 7 | `tests/teaching_test_suite.mjs` | Teaching workspace, Đề cương, Khóa/Lớp, Thời khóa biểu, Định mức giờ giảng, Ngân hàng câu hỏi, Đơn nghỉ, Diễn đàn | **48 / 48** | **48 / 48** |
| 8 | `tests/lesson_studio_test_suite.mjs` | Khối nội dung bài giảng, bản nháp/xuất bản, `step_by_step_solution`, YouTube & stream token `exp`, thumbnail an toàn | **11 / 11** | **11 / 11** |
| 9 | `tests/master_lms_test_suite.mjs` | Blueprint đào tạo, Phân công giảng dạy, Kỳ thi/Bài tập, Wiki thuật ngữ, Báo cáo tổng hợp | **8 / 8** | **8 / 8** |
| 10 | `tests/training_lifecycle_test_suite.mjs` | Vòng đời đào tạo theo Khóa/Học kỳ/Lớp, Cơ sở/Phòng học, Tự xếp lịch & Đổi lịch dạy | **7 / 7** | **7 / 7** |
| 11 | `tests/virtual_classroom_test_suite.mjs` | Lớp học trực tuyến Zoom / Google Meet, webhook chữ ký, liên kết phòng học ảo & điểm danh tự động | **15 / 15** | **15 / 15** |
| — | **TỔNG CỘNG** | — | **150 / 150** | **146 / 146** |

---

## 3. Chi tiết Đo kiểm Tải Đồng thời (PostgreSQL 18.7 Docker)

Chạy bằng `scratch/load_test_pg18.mjs` trên `http://127.0.0.1:18923` (`backend/server_fallback.mjs` + PostgreSQL 18.7 `lmsplus`), trải đều 7 endpoint đọc nghiệp vụ với JWT thật của 3 vai trò (`ADMIN`, `INSTRUCTOR`, `STUDENT`):

| Đợt tải | Requests | OK (`2xx`) | Err | Wall ms | Req/giây (`rps`) | `avg` | `p50` | `p95` | `p99` | `max` |
|---|---|---|---|---|---|---|---|---|---|---|
| **50 concurrent** (`5 rounds`) | 250 | 250 | 0 | 883 ms | 283.0 | 98.40 ms | 97.29 ms | 225.50 ms | 257.04 ms | 260.34 ms |
| **100 concurrent** (`5 rounds`) | 500 | 500 | 0 | 1,434 ms | 348.6 | 160.67 ms | 168.95 ms | 306.61 ms | 315.15 ms | 319.38 ms |
| **200 concurrent** (`5 rounds`) | 1,000 | 1,000 | 0 | 2,944 ms | 339.7 | 328.40 ms | 364.47 ms | 623.56 ms | 643.58 ms | 645.05 ms |

---

## 4. Hạng mục ngoài phạm vi thực thi trực tiếp (Cần lưu ý khi nghiệm thu)

1. **Runtime Python (`backend/main.py`):** Môi trường kiểm thử Windows không có `python`/`py`; các bản vá bảo mật Phase 1 trong `backend/main.py`, `elearning_router.py`, `sql_repository.py` chỉ được kiểm tra tĩnh qua đọc mã nguồn, chưa chạy unit test Python.
2. **Tích hợp Cloud ngoài thực tế:** Kết nối upload S3/R2/Vercel Blob, OAuth/Webhook trực tiếp từ Zoom/Google Meet production và quy trình deploy thực tế lên Vercel Cloud chưa được chạy trong môi trường local do không có thông tin xác thực cloud và chính sách không tự động deploy khi chưa có lệnh từ người dùng.
