# PRODUCTION CHECKLIST — DANH SÁCH KIỂM TRA TRIỂN KHAI PRODUCTION LMSPLUS

> **Mục đích:** Xác nhận mức độ sẵn sàng vận hành Production của nền tảng LMSPLUS (Node.js ESM + PostgreSQL 18 + React/Vite/Vercel) và các thao tác bắt buộc người vận hành cần hoàn tất trước khi cấp traffic thật.  
> **Trạng thái Git hiện tại:** Chưa tự động `git commit`, `git push` hoặc `vercel deploy --prod` theo nguyên tắc an toàn.

---

## 1. Bảo mật & Biến môi trường (Bắt buộc trước Go-Live)

- [x] **Fail-closed Secret Check (Code Ready):** `backend/common/security.mjs` (`resolveJwtSecret()`) tự động từ chối khởi động khi chạy ở môi trường production mà thiếu `LMSPLUS_JWT_SECRET`, khóa ngắn dưới 32 ký tự hoặc trùng secret mẫu.
- [ ] **Thiết lập Secrets thật trên Production Environment:**
  - Đặt `NODE_ENV=production`
  - Tạo `LMSPLUS_JWT_SECRET` ngẫu nhiên độ dài >= 64 ký tự (`openssl rand -base64 48`)
  - Đặt `LMSPLUS_ALLOWED_ORIGINS` khớp chính xác domain production (VD: `https://lmsplus.example.edu.vn`), **không** để `*`
  - Bắt buộc giữ `LMSPLUS_ALLOW_RESET_SEED=0` và `LMSPLUS_ENABLE_TEST_ENDPOINTS=0`
  - Đặt `LMSPLUS_ZOOM_WEBHOOK_SECRET` và `LMSPLUS_MEET_WEBHOOK_SECRET` nếu sử dụng lớp học trực tuyến đồng bộ webhook
- [x] **Mật khẩu & Tài khoản mẫu:** Hệ thống sử dụng `scrypt$` ngẫu nhiên + `timingSafeEqual`; tự động ẩn danh sách tài khoản demo và bỏ mật khẩu mặc định ở bản production.
- [ ] **Đổi mật khẩu tài khoản quản trị hạt giống (`seed`) ngay lần đăng nhập đầu tiên** nếu cơ sở dữ liệu ban đầu được nạp từ dữ liệu mẫu (`lmsplus_elearning_seed.json`).
- [x] **RBAC & Data Scope:** Tách biệt quyền `HEAD_OF_DEPARTMENT`, `INSTRUCTOR`, `TEACHING_ASSISTANT`, `ACADEMIC_STAFF`, `ADMIN`, `SUPER_ADMIN`, `STUDENT`; tất cả endpoint đều kiểm tra ở backend, cô lập tệp bài tập sinh viên và phòng họp ảo theo lớp/đơn vị.
- [x] **Security Headers:** Đã cấu hình `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection` trong `vercel.json` và backend response headers.

---

## 2. Cơ sở dữ liệu PostgreSQL 18 & Migration

- [x] **Schema chuẩn hóa:** Tổng cộng **84 bảng** và **3 incremental migration** (`011_security_departments_and_lms_v2_up.sql`, `012_rubrics_appeals_storage_up.sql`, `013_performance_indexes_up.sql`) kèm file `_down.sql` có `BEGIN/COMMIT`.
- [x] **Vercel Serverless Packaging Sync:** `vercel.json` (`includeFiles`) đã bao gồm đủ `010`, `011`, `012` và `013`.
- [ ] **Cấu hình `DATABASE_URL` Production (Neon / Supabase / Managed PG 18):**
  - Đặt `LMSPLUS_DB_CLIENT=postgres`, `DATABASE_URL=...`, `PGSSLMODE=verify-full` (hoặc `require` tùy nhà cung cấp TLS)
  - Đặt `DB_POOL_MAX=25` (hoặc cân chỉnh theo giới hạn connection của gói DB / PgBouncer)
- [ ] **Sao lưu trước khi chạy Migration lên DB thật:**
  ```bash
  node scripts/backup-restore-pg.mjs backup
  node scripts/backup-restore-pg.mjs verify --file <duong_dan_file_backup>
  ```
- [ ] **Áp dụng Schema an toàn (không truncate dữ liệu thật):**
  ```bash
  npm run db:schema
  ```

---

## 3. Lưu trữ Tệp & Tích hợp Bên ngoài

- [x] **Storage Adapter Ready:** `backend/storage/adapter.mjs` đã hỗ trợ chuẩn đọc/ghi cho `LOCAL`, `S3`, `R2` và `VERCEL_BLOB`, kèm kiểm tra extension + magic bytes tối đa 15 MB cho bài tập.
- [ ] **Cấu hình lưu trữ bền vững trên Production/Serverless:** Không dùng `LOCAL` trên Vercel (filesystem `/tmp` bị xóa sau khi container ngủ). Cần chọn:
  - `LMSPLUS_STORAGE_PROVIDER=VERCEL_BLOB` + `BLOB_READ_WRITE_TOKEN`, hoặc
  - `LMSPLUS_STORAGE_PROVIDER=S3` / `R2` + `LMSPLUS_S3_ENDPOINT`, `LMSPLUS_S3_BUCKET`, `LMSPLUS_S3_PUBLIC_BASE_URL` (và access token tương ứng)
- [x] **Tích hợp Dữ liệu (API, CSV, JSON):** Hỗ trợ import/export học viên CSV (có xử lý chuỗi ngoặc kép/tiêu đề thông minh) và import Ngân hàng câu hỏi JSON/CSV có preview & báo lỗi từng dòng.

---

## 4. Hiệu năng, Cache & Quan sát Vận hành

- [x] **Frontend Bundle Splitting:** Entry chunk **`29.04 kB`** (gzip `8.82 kB`), `0` cảnh báo > 500 kB, 0 lỗi `impeccable_audit.mjs`.
- [x] **API Batching & Cache:** Đã khử N+1 ở `outline()`, `sessionsDtoBatch()`, `/dashboard`, `/schedule`, `/facilities/overview` và bật `appCache` (`LMSPLUS_CACHE_TTL_MS=15000`, `LMSPLUS_CACHE_MAX_ENTRIES=2000`) với invalidation tức thì khi ghi.
- [x] **Log Redaction & Graceful Shutdown:** `sanitizeUrlForLog` che `?st=`, `?token=`, `?access_token=`, `?refresh_token=`, `?api_key=`; `keepAliveTimeout=65000`; hỗ trợ `HOST` (đặt `HOST=0.0.0.0` trong Docker/VM container) và đóng pool an toàn khi nhận `SIGTERM`/`SIGINT`.
- [x] **Load Test đạt ngưỡng Production vừa/trung bình:** `1,750/1,750` request thành công ở 50/100/200 concurrent (`p95 <= 623.56 ms`, throughput `283–348.6 req/s` trên 1 node Node.js + PG 18 Docker).

---

## 5. Quy trình Kiểm tra Trước & Sau Go-Live

1. **Chạy kiểm định cục bộ lần cuối trước khi commit/deploy:**
   - `npm --prefix frontend run build`
   - `npm test`
   - `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs`
   - `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs`
2. **Sau khi deploy Vercel / Server Production:**
   - Gọi `GET /health` xác nhận `"status":"ok"` và `"engine":"postgres"`.
   - Kiểm tra `POST /api/v1/elearning/testing/reset-seed` và `POST /api/v1/elearning/auth/token` trả `404`/`403` trên Production.
   - Đăng nhập thử với 1 tài khoản `ADMIN`, 1 `HEAD_OF_DEPARTMENT` (duyệt đề cương đúng bộ môn & kiểm tra chặn chéo bộ môn), 1 `INSTRUCTOR` (điểm danh, xác nhận nhật ký, chấm Rubric) và 1 `STUDENT` (học video Strict, nộp tệp bài tập, gửi phúc khảo).
3. **Quyết định Phát hành (Go / No-Go):**
   - **Codebase & Architecture/Security/UI/Performance:** **READY (Đủ điều kiện)**.
   - **Infrastructure Gate (Người vận hành thực hiện khi cấp quyền deploy):** Nạp đủ Secret Production (`LMSPLUS_JWT_SECRET`, `DATABASE_URL` + `PGSSLMODE`, `LMSPLUS_ALLOWED_ORIGINS`, Cloud Storage token), sao lưu DB, chạy `npm run db:schema`, sau đó mới commit/push/deploy.
