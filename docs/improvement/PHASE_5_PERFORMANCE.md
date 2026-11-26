# BÁO CÁO NGHIỆM THU PHASE 5 — TỐI ƯU HIỆU NĂNG, PHÂN MẢNH BUNDLE, CHỈ MỤC & PRODUCTION HARDENING

> **Trạng thái Phase 5:** Hoàn thành tối ưu Frontend code-splitting (entry bundle giảm từ `954.10 kB` xuống `29.04 kB`, không còn cảnh báo chunk > 500 kB), phát hành **Migration `013`** bổ sung `7` composite index cho PostgreSQL 18 (`84 bảng, 3 incremental migration`), khử truy vấn N+1 tại `outline()` & `sessions`, triển khai scoped read cache `appCache`, che secret `?st=`/`?token=`/`?api_key=` trong HTTP log, bổ sung graceful shutdown `SIGTERM`/`SIGINT`, và vượt qua kiểm tải thực tế **50 / 100 / 200 concurrent requests** trên **PostgreSQL 18.7 Docker** với **0 lỗi** (`1,750/1,750` requests `2xx`).

---

## A. Kết quả khảo sát

1. **Frontend Bundle đơn khối quá lớn:** Cuối Phase 4, gói JS đầu vào của Vite đạt **`954.10 kB`** (`index-cCfAWu9n.js`), khiến người dùng học viên/giảng viên phải tải cả mã Lesson Studio, quản trị Ngân hàng câu hỏi và Thời khóa biểu ngay lần mở đầu tiên.
2. **Truy vấn N+1 & đọc lặp trên Backend:**
   - `courses.mjs` (`outline()`) thực hiện 1 truy vấn `SELECT` bảng `lessons` cho từng chương thay vì gom lô (`IN (...)`).
   - `classes.mjs` (`sessionsDto` và các endpoint `/classes/:id`, `/schedule`, `/dashboard`) truy vấn điểm danh và phòng học ảo tuần tự theo từng buổi học, kể cả buổi `OFFLINE` không có `virtual_room_id`.
   - Danh mục ít thay đổi (`GET /departments`, `GET /facilities/overview`, `getAttendancePolicy`) truy vấn lặp lại mỗi request dù thiếu lớp cache theo phạm vi dữ liệu.
3. **Thiếu Composite Index & Hardening vận hành:**
   - Các truy vấn nóng trên `lessons`, `sessions`, `class_enrollments`, `attendance_records`, `lesson_progress`, `class_exam_attempts`, `class_assignment_submissions` chưa có composite index theo đúng thứ tự điều kiện lọc/sắp xếp.
   - Nhật ký HTTP có nguy cơ ghi plaintext query string chứa media stream token `?st=` hoặc `?api_key=`.
   - Máy chủ Node HTTP thiếu `keepAliveTimeout` tối ưu sau reverse proxy, chưa cấu hình `HOST` độc lập, thiếu drain kết nối `SIGTERM`/`SIGINT` khi tắt/khởi động lại container, và `vercel.json` `includeFiles` chưa liệt kê file migration `012`/`013`.

---

## B. Danh sách vấn đề đã xử lý

1. Kích hoạt Route-level Code Splitting bằng `React.lazy` + `<Suspense>` trong `frontend/src/App.tsx` kết hợp `manualChunks` trong `frontend/vite.config.ts` (`vendor-react`, `vendor`, `chunk-studio`, `chunk-teaching-core`).
2. Phát hành **Migration `013_performance_indexes_up.sql` & `_down.sql`** với **7 composite index**, đồng bộ vào `backend/teaching/masterSchema.mjs` (SQLite), `scripts/backup-restore-pg.mjs`, `2-migrate-db.bat`, `docs/improvement/DATABASE_MIGRATION.md`, và `vercel.json` (`includeFiles`).
3. Xây dựng **`backend/common/cache.mjs`** (`createScopedCache`, `appCache`) dạng bounded LRU + TTL, phân tách tuyệt đối khóa cache theo `${db.targetLabel}|${namespace}|${scopeKey}` và xóa tức thì theo tiền tố (`invalidatePrefix`) khi phát sinh thao tác ghi.
4. Khử N+1 và song song hóa truy vấn bằng `Promise.all` trong `courses.mjs` (`outline()` gom lô 1 truy vấn `lessons`), `classes.mjs` (`classCounters`, `classDto`, `sessionsDtoBatch`, `/classes/:id`, `/schedule`, `/dashboard`), `departments.mjs`, `timetableEngine.mjs` và `attendance.mjs` (`getAttendancePolicy` TTL `30s`).
5. Bổ sung `sanitizeUrlForLog` che tham số nhạy cảm (`st`, `token`, `access_token`, `refresh_token`, `api_key`), cấu hình `HOST` (mặc định `127.0.0.1`), `keepAliveTimeout = 65000`, xử lý `SIGTERM`/`SIGINT` graceful shutdown (`server.close()` + `db.close()`), tăng mặc định `DB_POOL_MAX` lên `25` trong `backend/db/client.mjs`, đồng bộ biến môi trường S3/R2/Vercel Blob trong `backend/storage/adapter.mjs` & `.env.example`.

---

## C. Phương án thực hiện

1. Tách các màn hình nặng (`LessonStudioPage`, `BanksPage`, `TimetablePage`, `ClassDetailPage`, `CourseDetailPage`, `StudentPages`, `DepartmentsPage`, v.v.) sang `React.lazy` kèm trạng thái chờ tải `LoadingFallback` thân thiện, giữ entry chunk chỉ chứa shell điều hướng + auth thiết yếu.
2. Cô lập hoàn toàn rủi ro rò rỉ dữ liệu liên đơn vị/RBAC trong cache bằng cách bắt buộc đưa `db.targetLabel`, tên miền `namespace`, và `scopeKey` (role/department/user) vào khóa cache; mọi mutation (`POST`/`PUT`/`PATCH`/`DELETE`) gọi `appCache.invalidatePrefix(db, ...)` ngay sau khi ghi DB.
3. Tạo bộ kiểm thử tự động `tests/phase5_performance_test_suite.mjs` (5 kịch bản: cache isolation + LRU eviction, `sanitizeUrlForLog`, `resolveStorageConfig`, batching + invalidation, chuẩn transaction Migration `013`) và kịch bản đo tải đồng thời thực tế `scratch/load_test_pg18.mjs` trên PostgreSQL 18.7 Docker.

---

## D. Danh sách file đã thay đổi / thêm mới

- **Frontend Code-Splitting:** `frontend/src/App.tsx`, `frontend/vite.config.ts`
- **Cache, DB, Storage & Runtime Hardening:** `backend/common/cache.mjs` (mới), `backend/server_fallback.mjs`, `backend/db/client.mjs`, `backend/storage/adapter.mjs`, `vercel.json`, `.env.example`
- **Backend Query Batching & Cache Invalidation:** `backend/teaching/courses.mjs`, `backend/teaching/classes.mjs`, `backend/organization/departments.mjs`, `backend/teaching/timetableEngine.mjs`, `backend/teaching/attendance.mjs`, `backend/teaching/masterSchema.mjs`
- **Migration & Docs:** `database/migrations/013_performance_indexes_up.sql` (mới), `database/migrations/013_performance_indexes_down.sql` (mới), `scripts/backup-restore-pg.mjs`, `2-migrate-db.bat`, `docs/improvement/DATABASE_MIGRATION.md`, `docs/improvement/PHASE_5_PERFORMANCE.md`, `docs/improvement/TEST_REPORT.md`, `docs/improvement/PRODUCTION_CHECKLIST.md`
- **Tests:** `tests/phase5_performance_test_suite.mjs` (mới), `package.json`

---

## E. Migration / Schema liên quan

Áp dụng thành công **`013_performance_indexes_up.sql`** vào PostgreSQL 18.7 (`84 bảng, 3 incremental migration`: `011`, `012`, `013`), có transaction `BEGIN/COMMIT` và file rollback `013_performance_indexes_down.sql`:

| Chỉ mục | Bảng & Cột | Mục đích tối ưu |
|---|---|---|
| `idx_lessons_chapter_sort` | `lessons(chapter_id, publish_status, sort_order)` | Tải gom lô `outline()` và lọc bài xuất bản theo chương |
| `idx_sessions_class_sched_status` | `sessions(subject_class_id, session_status, scheduled_start_at)` | Dashboard lịch dạy, danh sách buổi học & thống kê trạng thái |
| `idx_class_enrollments_student_status` | `class_enrollments(student_id, status, subject_class_id)` | Không gian học tập `learn/overview` của học viên |
| `idx_attendance_records_session_status` | `attendance_records(class_session_id, attendance_status)` | Đếm sĩ số/chuyên cần gom lô `sessionsDtoBatch` |
| `idx_lesson_progress_class_student` | `lesson_progress(subject_class_id, student_id, status)` | Tính tiến độ học tập theo lớp & học viên |
| `idx_class_exam_attempts_student` | `class_exam_attempts(exam_id, student_id, attempt_number)` | Lịch sử lượt làm bài & đếm lượt tối đa |
| `idx_class_assign_subs_student` | `class_assignment_submissions(class_assignment_id, student_id, status, attempt_number)` | Danh sách nộp bài & chấm điểm Rubric |

---

## F. Kết quả kiểm thử & Đo kiểm hiệu năng (Observed)

### 1. Tối ưu Frontend Bundle (`npm --prefix frontend run build`)

| Chỉ số | Cuối Phase 4 | Sau Phase 5 | Mức cải thiện |
|---|---|---|---|
| Entry JS bundle | `954.10 kB` (`index-cCfAWu9n.js`) | **`29.04 kB`** (`index-B-cj661k.js`, gzip `8.82 kB`) | **Giảm 97.0%** |
| Chunk lớn nhất (lazy on-demand) | `954.10 kB` (monolith) | `189.93 kB` (`chunk-studio`, gzip `53.03 kB`) | Dưới ngưỡng `500 kB` |
| `vendor-react` | N/A | `152.12 kB` (gzip `49.02 kB`) | Cache dài hạn trình duyệt |
| `ClassDetailPage` / `CourseDetailPage` | Nằm trong monolith | `79.20 kB` / `62.28 kB` (lazy) | Chỉ tải khi mở lớp/khóa |
| Cảnh báo `> 500 kB` từ Vite | Có (1 cảnh báo) | **`0` cảnh báo** (`82 modules`, CSS `101.94 kB`) | Đạt chuẩn Production |

### 2. Đo kiểm tải đồng thời thực tế trên PostgreSQL 18.7 Docker

- **Cấu hình thực thi:** `backend/server_fallback.mjs` kết nối PostgreSQL 18.7 (`lmsplus`, 32 users, `DB_POOL_MAX=25`, `LMSPLUS_CACHE_TTL_MS=15000`), bắn hỗn hợp 7 endpoint thật (`/health`, `/teaching/dashboard`, `/teaching/classes`, `/teaching/departments`, `/teaching/facilities/overview`, `/teaching/learn/overview`, `/teaching/courses/crs_toan5`) với token thật của Admin, Giảng viên và Học viên (`load_test_pg18.mjs`):

| Mức đồng thời (`Concurrency`) | Tổng Request (`5 rounds`) | Thành công (`2xx`) | Lỗi | Wall Time | Throughput | `avg` | `p50` | `p95` | `p99` | `max` |
|---|---|---|---|---|---|---|---|---|---|---|
| **50 concurrent** | 250 | **250** | **0** | 883 ms | **283.0 req/s** | 98.4 ms | 97.29 ms | 225.50 ms | 257.04 ms | 260.34 ms |
| **100 concurrent** | 500 | **500** | **0** | 1,434 ms | **348.6 req/s** | 160.67 ms | 168.95 ms | 306.61 ms | 315.15 ms | 319.38 ms |
| **200 concurrent** | 1,000 | **1,000** | **0** | 2,944 ms | **339.7 req/s** | 328.40 ms | 364.47 ms | 623.56 ms | 643.58 ms | 645.05 ms |
| **Tổng cộng** | **1,750** | **1,750** | **0** | — | — | — | — | — | — | — |

- **Graceful Shutdown Check:** Gửi `SIGTERM` sau bài test 200 concurrent, tiến trình backend đóng HTTP server + connection pool PostgreSQL 18 và thoát sạch (`[SHUTDOWN] Server exited cleanly after SIGTERM: null`) trong thời hạn chờ `< 4s` mà không cần `SIGKILL`.

### 3. Bộ kiểm thử hồi quy & audit tự động

- **`npm test` (11 suites trên SQLite):** **150/150 PASS (`0` failed)** (bao gồm `phase5_performance_test_suite.mjs` `5/5`).
- **10 integration suites trên PostgreSQL 18.7 (`lmsplus_test`):** **146/146 PASS (`0` failed)**.
- **`impeccable_audit.mjs`:** **Scanned 46 file(s) | Total Issues: 0**.
- **`verify_system_and_sql.mjs`:** **ALL CHECKS PASSED (0 errors)**.

---

## G. Rủi ro còn lại & Lưu ý mở rộng

1. **In-memory cache trên môi trường multi-instance / Serverless:** `appCache` là bounded LRU cục bộ trong tiến trình (`TTL` mặc định `15s`). Khi chạy nhiều Lambda instance độc lập trên Vercel, ghi dữ liệu ở instance A xóa cache tức thời trên instance A, còn instance B tự làm mới tối đa sau `15s` (hoặc cấu hình `LMSPLUS_CACHE_TTL_MS=0` nếu yêu cầu nhất quán tuyệt đối tức thì giữa nhiều node không qua Redis pub/sub).
2. **Nhánh Python kế thừa (`backend/main.py`):** Chưa chạy thực thi trên máy host hiện tại do thiếu runtime Python; các endpoint/hệ thống đang phục vụ người dùng thực tế qua Vite + Vercel `api/index.mjs` là nhánh Node.js ESM (`backend/server_fallback.mjs`).
3. **Storage & Provider thực tế trên Cloud:** Đã căn chỉnh adapter và biến môi trường cho `S3`/`R2`/`VERCEL_BLOB`, nhưng chưa thực hiện upload thật lên bucket/blob cloud do chưa có secret cloud trong môi trường local.

---

## H. Bước tiếp theo

- Xem bảng tổng hợp toàn bộ kết quả kiểm thử ở [`docs/improvement/TEST_REPORT.md`](./TEST_REPORT.md).
- Rà soát điều kiện hạ tầng, secret và thủ tục Go-Live tại [`docs/improvement/PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) trước khi người dùng xác nhận commit, push và deploy Production.
