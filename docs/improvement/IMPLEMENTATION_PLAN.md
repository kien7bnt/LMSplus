# IMPLEMENTATION PLAN — KẾ HOẠCH NÂNG CẤP 5 PHASE LMSPLUS

> **Nguyên tắc bất biến:**
> - Bảo toàn 100% 80+ bảng dữ liệu hiện có, mọi thay đổi DB đi qua migration thuận–nghịch (`UP` / `DOWN`).
> - Giữ nguyên quyết định nghiệp vụ: Khung chương trình → Khóa học ↔ Lớp môn học (`linked`), Phiên bản môn học (`snapshot`), Chống tua video (`strict`), `45 phút/tiết` mặc định cho phép cấu hình theo môn, `Trưởng bộ môn` tách permission trong RBAC hiện tại (không tạo RBAC song song).
> - Không tự ý reset/truncate dữ liệu thật, không `git commit` / `push` / deploy production khi chưa được cho phép.

---

## Tổng quan 5 Phase

### Phase 1 — Audit Bảo mật, Phân quyền & An toàn Dữ liệu
- **Tài liệu:** `docs/audit/PHASE_1_SECURITY_AUDIT.md`, `docs/improvement/PHASE_1_SECURITY.md`, `docs/improvement/DATABASE_MIGRATION.md`.
- **Hành động trọng tâm:**
  1. Khóa cứng `testing/reset-seed` và `auth/token` (chỉ bật khi non-production **và** có cờ môi trường/test cho phép; reject 404 trong production; yêu cầu quyền Admin/non-prod guard).
  2. Loại bỏ fallback secret ở môi trường production (fail-closed khi thiếu hoặc dùng placeholder cho `LMSPLUS_JWT_SECRET`); tách khóa/thuật toán băm mật khẩu sang `scrypt` có salt ngẫu nhiên + `crypto.timingSafeEqual`, vẫn tương thích kiểm tra mật khẩu cũ hoặc nâng cấp hash khi đăng nhập (progressive upgrade).
  3. Refresh token (`auth/refresh`), `auth/logout`, `token_version` / thu hồi token trong bảng `users` (qua migration `011`), kiểm tra trạng thái user & `token_version` trong `resolveUser`, vá bug `exp=NaN` của `verifyMediaStreamToken`.
  4. CORS cấu hình từ env (`LMSPLUS_ALLOWED_ORIGINS` với safe local fallback ở dev), bỏ quảng bá `X-LMSPLUS-Role`, bổ sung Security Headers (`nosniff`, `SAMEORIGIN`, `Referrer-Policy`, `CSP`), thêm rate limiting cho `/auth/login`, `/auth/register`, upload, webhook.
  5. Bắt buộc xác thực Google Meet webhook (token/HMAC) và Zoom `endpoint.url_validation` (`x-zm-signature`), chặn URL nguy hiểm (`javascript:`, `data:image/svg+xml`) ở backend & frontend (`evidence_url`, `submission_link`, `attachments`, thumbnail video).
  6. Bổ sung **Tổ chức / Khoa / Bộ môn** (`departments`) và quyền **`HEAD_OF_DEPARTMENT` (`Trưởng bộ môn`)** tách permission trong `scope.mjs` (phê duyệt đề cương/khung CT trong bộ môn, quản lý giảng viên bộ môn, không mặc định full Admin); vá toàn bộ lỗ hổng nullable `user.department_id` & single-record/transfer/provider scope (`virtualProviders` chỉ `ADMIN`, `trainingPrep`, `timetableEngine`, `teachingHours`, `curriculaAndCohorts`, legacy routes).
  7. Vá 2 lỗi SQL nghiêm trọng (`trainingPrep.mjs:1192-1209`, `courses.mjs:269 COLLATE NOCASE`), lỗi CLI startup `server_fallback.mjs:1850`, thêm magic-byte validation upload, `path.sep` check, tách demo accounts khỏi UI khi production, và tạo script **Backup / Restore PostgreSQL 18 + Verify Migration**.

### Phase 2 — Tái cấu trúc Kiến trúc Backend, Frontend & Storage Adapter
- **Tài liệu:** `docs/improvement/PHASE_2_ARCHITECTURE.md`.
- **Hành động trọng tâm:**
  1. **Storage Adapter (`backend/storage/adapter.mjs`)**: Hỗ trợ thống nhất Local Disk (`development`) và S3/R2/Vercel Blob HTTP Adapter (`production`), tổ chức thư mục theo loại tài nguyên (`videos/`, `documents/`, `images/`, `assignments/`, `attachments/`), kích thước, MIME, signed access URL.
  2. **Backend Domain Modularity & Transactions**: Chuẩn hóa `backend/common/` + domain helpers (`auth`, `users`, `organization`, `security`, `storage`), chia nhỏ router/domain oversized (`studio`, `virtualClassroom`, `server_fallback`), bọc toàn bộ multi-write routes vào `tx(db, ...)`, đồng bộ chuẩn response & deprecation cảnh báo cho `backend/main.py` hoặc đánh dấu legacy rõ ràng tránh split-brain.
  3. **Frontend Modularity & Type Safety**: Hợp nhất 1 API base & token engine (dịch chuyển `AdminAccountsPage` sang API mới), hợp nhất `Primitives.tsx` + `teaching/ui.tsx`, hợp nhất `BlockType`, giảm mạnh `any` (`77` → tối thiểu gần `0`), tách các god component (`LessonStudioPage`, `ClassDetailPage`, `VirtualSessionPage`, `BanksPage`) theo responsibility module sạch sẽ, loại bỏ/cập nhật dead code có kiểm chứng `verify_system_and_sql.mjs`.

### Phase 3 — Nâng cấp UI/UX Toàn hệ thống (UI/UX Pro Max × Impeccable × Airbnb DLS)
- **Tài liệu:** `docs/improvement/PHASE_3_UI_UX.md`.
- **Hành động trọng tâm:**
  1. Hợp nhất Single Source of Truth Design Tokens (`theme/tokens.css` làm gốc duy nhất, xóa token trùng/lệch & 16 hardcoded colors/missing `--accent-teal` trong `frontend/src/index.css`).
  2. Nâng cấp **Dashboard theo vai trò** (`Học viên`, `Giảng viên`, `Trưởng bộ môn`, `Quản trị đào tạo / Admin`), xóa sạch các thanh phần trăm giả định heuristic (`100 - len * 15`), thay bằng số liệu thực từ DB/API.
  3. Tối ưu **Điều hướng Sidebar 7 nhóm nghiệp vụ + Breadcrumb đồng bộ** theo quyền người dùng (`Tổng quan`, `Tổ chức đào tạo`, `Quản lý giảng dạy`, `Quản lý học tập`, `Đánh giá và khảo thí`, `Báo cáo và phân tích`, `Quản trị hệ thống`), responsive desktop-first cho quản trị & mobile-friendly cho học viên, chế độ `cinema-dark` mượt cho Student Lesson Player.
  4. Vá touch targets `< 44px`, bug `button:active` làm nhảy marker timeline, thay raw enum `connection_status` bằng nhãn tiếng Việt, bổ sung `ConfirmDialog` + `try/catch` thống nhất cho mọi thao tác phá hủy, chuẩn hóa Loading/Empty/Error states & WCAG 2.2 AA (`impeccable_audit.mjs` đạt `0 issues`).

### Phase 4 — Hoàn thiện Nghiệp vụ LMS & Liên thông Đầu–Cuối
- **Tài liệu:** `docs/improvement/PHASE_4_BUSINESS.md`.
- **Hành động trọng tâm:**
  1. **Tổ chức đào tạo & Trưởng bộ môn (`departments` + `HEAD_OF_DEPARTMENT`)**: Quản lý Đơn vị/Khoa/Bộ môn, gán giảng viên vào bộ môn, quy trình Trưởng bộ môn duyệt đề cương/khung chương trình & xem báo cáo bộ môn.
  2. **Lesson Studio & Video Learning**: Sửa mất thumbnail video `data:image/`, thêm editor khối `step_by_step_solution`, đảm bảo trạng thái lưu (`Saved/Dirty/Saving/Error/Conflict`) & xử lý lỗi tamper nhẹ nhàng cho mạng chậm khi học Strict Video.
  3. **Bài tập, Rubric & Phúc khảo (Grade Appeals)**: Hỗ trợ upload file khi học viên nộp bài (`FILE`/`MIXED`), xây dựng Rubric chấm điểm gắn từ ngân hàng sang lớp môn học, bổ sung luồng **Phúc khảo điểm** (học viên gửi khiếu nại → giảng viên/trưởng bộ môn/giáo vụ xem xét & ghi audit log), sửa timer thi `StudentAssessmentPages` không reset interval mỗi giây.
  4. **Thời khóa biểu (`45 phút/tiết` cấu hình theo môn)**: Bổ sung UI xem/sửa `minutes_per_period` trên môn học, bỏ hardcode `45`/`0.75` ở frontend/backend, dùng `campuses[0]` động thay cho `'cp_cs1'`, gắn UI cho các endpoint chưa nối (`createCampus`, `deleteCurriculum`, `updateCohort`, `updateVirtualRoom`, v.v.).
  5. **Import / Export chuẩn API, CSV & JSON**: Bổ sung **Preview + kiểm tra định dạng + báo lỗi chi tiết theo từng dòng + chống trùng lặp + rollback giao dịch** cho Import học viên (CSV/JSON/text) và Import ngân hàng câu hỏi/bài tập (CSV/JSON), nối UI Export JSON/CSV đầy đủ.

### Phase 5 — Hiệu năng, Kiểm thử Toàn diện & Production Readiness
- **Tài liệu:** `docs/improvement/PHASE_5_PERFORMANCE.md`, `docs/improvement/TEST_REPORT.md`, `docs/improvement/PRODUCTION_CHECKLIST.md`.
- **Hành động trọng tâm:**
  1. **Frontend Performance**: Route-based lazy loading & code splitting (`React.lazy` + `Suspense`), tách chunk vendor (`vite build` cảnh báo `905 kB` JS bundle → chia chunk gọn dưới ngưỡng tối ưu), memoization bảng lớn.
  2. **Backend & DB Performance**: Loại bỏ N+1 queries ở bootstrap/class/curriculum loaders, bổ sung composite indexes qua migration, thêm cache có invalidation an toàn (in-memory/Redis adapter), Graceful Shutdown (`SIGTERM`/`SIGINT`), structured logging không chứa token nhạy cảm.
  3. **Bộ Kiểm thử Đầy đủ**: Unit tests, Integration tests, Security tests (IDOR, Privilege Escalation, XSS, CSRF/CORS, Webhook spoofing, Rate limit, Upload traversal), E2E flow tests và **Load Test thực tế (50 / 100 / 200 concurrent users)** đo hiệu năng thật (không suy diễn).
  4. **Production Checklist**: Cập nhật `.env.example`, `docker-compose.yml`, hướng dẫn backup/restore/migration, security gates.
