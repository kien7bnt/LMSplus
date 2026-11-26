# PHASE 1 SECURITY AUDIT — BÁO CÁO KIỂM TOÁN BẢO MẬT & PHÂN QUYỀN LMSPLUS

> **Ngày kiểm toán & khắc phục:** 2026-11-25  
> **Repository / Workspace:** `D:\LMS elearning` (`main` @ `187b4b3`)  
> **Trạng thái tổng thể:** Đã khắc phục toàn bộ lỗ hổng P0/P1 trên nhánh Node.js ESM + PostgreSQL 18 + Frontend; nhánh kế thừa Python FastAPI đã được khóa endpoint nguy hiểm theo mã nguồn (chưa chạy kiểm thử Python do máy chủ hiện tại chưa cài runtime Python).

---

## 1. Bảng Tổng hợp Lỗ hổng & Trạng thái Khắc phục

| Mã | Mức độ | Hạng mục | Vị trí code gốc | Nguyên nhân | Giải pháp đã áp dụng | Trạng thái |
|---|---|---|---|---|---|---|
| **SEC-01** | **P0** | Endpoint Reset DB công khai | `backend/server_fallback.mjs`, `backend/app/api/v1/elearning_router.py` | `POST /api/v1/elearning/testing/reset-seed` mở không cần JWT/quyền; gọi `TRUNCATE TABLE ... CASCADE` trên PostgreSQL 18 | Chặn mặc định (`404 ENDPOINT_DISABLED`), chỉ bật khi `!isProductionRuntime()` **và** `LMSPLUS_ALLOW_RESET_SEED=1`, đồng thời yêu cầu JWT `ADMIN`/`SUPER_ADMIN` | **Đã khắc phục** |
| **SEC-02** | **P0** | Hardcode JWT & Webhook Secret | `backend/server_fallback.mjs`, `backend/teaching/routes.mjs`, `learn.mjs`, `virtualClassroom.mjs`, `virtualProviders.mjs`, `sql_repository.py` | Giá trị mặc định `'lmsplus-production-grade-hmac-secret-2026'` và secret webhook gắn cứng | `resolveJwtSecret()` trong `backend/common/security.mjs` **fail-closed** (`[FATAL SECURITY]` ném lỗi khi chạy production mà thiếu/ngắn `<32` ký tự/dùng secret mẫu); bỏ fallback secret trong webhook | **Đã khắc phục** |
| **SEC-03** | **P0** | Phát JWT không cần mật khẩu | `backend/server_fallback.mjs`, `backend/app/api/v1/elearning_router.py` | `POST /api/v1/elearning/auth/token` cho phép xin token theo `role` ở cả staging/preview và mọi môi trường Python | Khóa mặc định ở production và dev chuẩn; chỉ cho phép khi non-production **và** bật `LMSPLUS_ENABLE_TEST_ENDPOINTS=1` hoặc có admin guard | **Đã khắc phục** |
| **SEC-04** | **P0** | Giả mạo Webhook Google Meet & Zoom Oracle | `backend/teaching/virtualProviders.mjs`, `virtualClassroom.mjs` | Google Meet webhook không kiểm tra chữ ký vẫn ghi `signature_verified = 1`; Zoom `endpoint.url_validation` trả hash dù thiếu chữ ký | Thêm `GoogleMeetProviderAdapter.verifyWebhookSignature` & `signWebhookPayload`; bắt buộc xác thực chữ ký cho mọi webhook và Zoom URL validation; ghi chính xác `signature_verified` | **Đã khắc phục** |
| **SEC-05** | **P0** | Stored XSS qua URL & Thumbnail SVG | `backend/teaching/leaveAndForums.mjs`, `assessmentsAndAssignments.mjs`, `studio.mjs`, `frontend/src/teaching/ui.tsx`, `LeaveRequestsPage.tsx` | Cho phép URL `javascript:` trong `evidence_url`, `submission_link`, `attachments` và ảnh `data:image/svg+xml` làm thumbnail video | Bổ sung `sanitizeExternalHttpUrl()` & `sanitizeThumbnailUrl()` ở backend; bổ sung `safeHref()` trên UI `ui.tsx` và `LeaveRequestsPage.tsx` | **Đã khắc phục** |
| **SEC-06** | **P0** | Vượt quyền & rò rỉ dữ liệu Legacy Routes | `backend/server_fallback.mjs` (`simulate-overdue-24h`, `leave-requests/:id/decision`, `workspace/bootstrap`, `/crud/*`, `/progress/*`) | Thiếu kiểm tra role/ownership/department scope; endpoint CRUD mặc định gắn `'dept_se'` | Bắt buộc JWT + role & department scope theo từng handler, thu gọn payload `workspace/bootstrap` theo quyền user | **Đã khắc phục** |
| **SEC-07** | **P0** | Thiếu phân tách quyền `HEAD_OF_DEPARTMENT` & lỗ hổng Scope Khoa/Bộ môn | `backend/teaching/scope.mjs`, `curriculaAndCohorts.mjs`, `trainingPrep.mjs`, `timetableEngine.mjs`, `teachingHours.mjs`, `contentTreeAndSnapshots.mjs` | Chưa có permission riêng cho Trưởng bộ môn; giáo vụ có `department_id = NULL` vượt qua hàm `sameDept`; một số route đơn lẻ bỏ sót kiểm tra đơn vị | Thêm bảng `departments` (Migration `011`), mở rộng RBAC hiện tại với `HEAD_OF_DEPARTMENT` & `SUPER_ADMIN` (`sameDept`, `assertDepartmentScope`, `canApproveDepartmentAcademic`), vá toàn bộ route chuyển lớp/khóa/lịch/giờ dạy/wiki/ngân hàng | **Đã khắc phục** |
| **SEC-08** | **P1** | Băm mật khẩu không salt & lộ tài khoản mẫu trên Production | `backend/common/security.mjs`, `backend/server_fallback.mjs`, `AuthPage.tsx`, `AdminAccountsPage.tsx` | Băm mật khẩu dùng HMAC gắn `JWT_SECRET`; hiển thị danh sách tài khoản mẫu và mật khẩu `'123456'` trên màn đăng nhập/quản trị | Chuyển sang random-salted `scrypt$` + `crypto.timingSafeEqual` với cơ chế nâng cấp dần khi đăng nhập; ẩn `DEMO_ACCOUNTS` khi `PROD`; bỏ giá trị `'123456'` định sẵn | **Đã khắc phục** |
| **SEC-09** | **P1** | Thiếu Refresh Token Rotation & Thu hồi JWT tức thì | `database/migrations/011`, `backend/server_fallback.mjs`, `frontend/src/api/elearningClient.ts` | Không có cơ chế vô hiệu hóa JWT khi logout/đổi mật khẩu/khóa tài khoản; `verifyMediaStreamToken` bỏ sót `NaN` của `exp` | Bổ sung `token_version`, `is_active`, `auth_refresh_tokens`; cài `/auth/refresh` (rotation), `/auth/logout`, `/auth/change-password`; kiểm tra `alg=HS256` & `Number.isNaN(exp)` | **Đã khắc phục** |
| **SEC-10** | **P1** | CORS `*`, thiếu Security Headers, thiếu Rate Limit & Brute-force Lockout | `backend/common/security.mjs`, `backend/server_fallback.mjs`, `routes.mjs`, `vercel.json`, `backend/main.py` | `Access-Control-Allow-Origin: *`, quảng bá `X-LMSPLUS-Role`, không chặn brute-force đăng nhập | Đổi CORS sang allowlist `LMSPLUS_ALLOWED_ORIGINS`, xóa `X-LMSPLUS-Role`, gắn `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `CSP`, rate limiter theo IP/route và khóa tạm `locked_until` | **Đã khắc phục** |
| **SEC-11** | **P1** | Lộ cấu hình nhà cung cấp họp trực tuyến cho Giảng viên | `backend/teaching/virtualClassroom.mjs` | Bất kỳ `INSTRUCTOR` nào cũng đọc/sửa được thông tin cấu hình `Zoom`/`Google Meet` hệ thống | Giới hạn `GET/PUT/POST /virtual-providers*` chỉ cho `ADMIN` / `SUPER_ADMIN` | **Đã khắc phục** |
| **SEC-12** | **P1** | Upload thiếu kiểm tra Magic Bytes & Path Traversal edge-case | `backend/common/security.mjs`, `courses.mjs`, `banks.mjs`, `studio.mjs` | Chỉ kiểm tra đuôi file; `startsWith(base)` không kèm `path.sep` | Bổ sung `validateUploadMagicBytes()` (PDF, PNG, JPG, GIF, WEBP, OOXML, MP4, WEBM, TXT) và `safeResolveUnder()` kiểm tra `+ path.sep` | **Đã khắc phục** |
| **SEC-13** | **P1** | Lỗi SQL runtime trên PostgreSQL 18 & sai tham số INSERT | `backend/teaching/courses.mjs`, `trainingPrep.mjs`, `backend/db/client.mjs` | `COLLATE NOCASE` lỗi trên PG18; `INSERT INTO session_plan_items` truyền 12 giá trị cho 13 cột; TLS bỏ qua xác thực chứng chỉ | Sửa sang `LOWER(c.title) ASC`; cân đối 13 placeholder; hỗ trợ `sslmode=verify-full` bật `rejectUnauthorized: true` | **Đã khắc phục** |

---

## 2. Kết quả Kiểm chứng Tự động (Observed)

- **Security & RBAC Test Suite (`tests/security_audit_test_suite.mjs`):** **12/12 PASS** trên cả SQLite và PostgreSQL 18.7 (`0` failures), kiểm chứng:
  1. Fail-closed secret check ở môi trường production.
  2. `scrypt$` random salt, `timingSafeEqual` và nâng cấp tự động hash cũ.
  3. Từ chối JWT `alg=none` và media token thiếu `exp` / `exp=NaN`.
  4. Chu trình Login → Refresh Token Rotation → Logout thu hồi JWT ngay lập tức.
  5. Khóa endpoint `/testing/reset-seed` khi `LMSPLUS_ALLOW_RESET_SEED=0`.
  6. Rate limiting trả trạng thái chặn kèm `retryAfterSec`.
  7. `HEAD_OF_DEPARTMENT` phê duyệt đề cương trong bộ môn (`200`), bị chặn chéo bộ môn (`403 OUT_OF_SCOPE`), bị chặn thao tác Admin/tài chính (`lock` -> `403`).
  8. `ACADEMIC_STAFF` có `department_id = NULL` không thể vượt phạm vi.
  9. Chặn `STUDENT` gọi `simulate-overdue-24h` và chặn role trái phép duyệt đơn nghỉ.
  10. Google Meet webhook yêu cầu chữ ký; Zoom URL validation từ chối giả mạo không xác thực.
  11. Chặn URL `javascript:`, thumbnail SVG và file giả mạo header magic bytes.
  12. `GET /courses?sort=title_asc` và `PUT /curricula/:id/session-plans/:courseId` chạy sạch trên cả SQLite và PG18.
- **Toàn bộ Test Suite hồi quy:** **135/135 PASS** trên SQLite (`8` file test) và **131/131 PASS** trên PostgreSQL 18.7 (`7` file test trên CSDL `lmsplus_test`).
- **Backup & Restore Integrity Check:** `scripts/backup-restore-pg.mjs` xác nhận sao lưu và kiểm tra SHA-256 thành công **83 bảng / 4,710 bản ghi**, dry-run restore sẵn sàng.
