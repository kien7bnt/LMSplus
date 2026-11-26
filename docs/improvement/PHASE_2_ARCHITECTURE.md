# BÁO CÁO NGHIỆM THU PHASE 2 — TÁI CẤU TRÚC KIẾN TRÚC & STORAGE ADAPTER

> **Trạng thái Phase 2:** Hoàn thành tái cấu trúc Backend Storage Adapter, bổ sung module Tổ chức & Quản lý Tài khoản chuẩn RBAC, thống nhất giao dịch CSDL (`tx()`), hợp nhất UI Kit & API Types Frontend, giảm `any` xuống `0` và dọn sạch 7 file legacy không còn sử dụng.

---

## A. Kết quả khảo sát

1. **Backend:** File tải lên (`POST /courses/:id/resources`, `POST /banks/resources`, `POST /media/videos/*`, `POST /media/pdfs`) ghi trực tiếp qua `fs.*` rời rạc từng file, dùng đường dẫn gốc chưa phân nhóm theo loại học liệu (`videos/`, `pdfs/`, `documents/`), thiếu interface adapter cho S3 / Cloudflare R2 / Vercel Blob khi chạy Serverless; một số tuyến cập nhật liên quan nhiều bảng (`topics`, `training-profile`, `blueprint`, `virtual-attendance/sync`) còn thiếu `tx()`. Ngoài ra chưa có API quản trị `departments` và `users` thay thế API legacy `workspace/bootstrap` cho `AdminAccountsPage`.
2. **Frontend:** Tồn tại đồng thời 7 file legacy không còn được import (`CrudManagementView.tsx`, `LessonPlayerView.tsx`, `TeachingLogAndAttendanceView.tsx`, `BlockEditorView.tsx`, `LessonEditorPage.tsx`, `BlockEditor.tsx` và bộ `Primitives.tsx` song song với `teaching/ui.tsx`); 4 file lớn (`LessonStudioPage.tsx` 4,289 dòng, `api.ts` 2,988 dòng, `ClassDetailPage.tsx` 2,653 dòng, `VirtualSessionPage.tsx` 1,787 dòng); và **82 vị trí dùng `any`**.

---

## B. Danh sách vấn đề đã xử lý

1. Thiếu lớp trừu tượng lưu trữ tệp `StorageAdapter` hỗ trợ cả `LOCAL_DISK` và Cloud Object Storage (`S3` / `R2` / `VERCEL_BLOB`), kèm rò rỉ header `'Access-Control-Allow-Origin': '*'` ở nhánh stream > 16MB tại `backend/teaching/studio.mjs`.
2. Chưa có domain module cho `departments` (Tổ chức / Khoa / Bộ môn) và `users` (`backend/organization/departments.mjs`, `backend/users/usersService.mjs`); lỗi test-mode `TRUNCATE TABLE` trên PostgreSQL 18 làm xóa mất dữ liệu seed `departments`.
3. Thiếu `tx()` bao quanh thao tác đa bảng ở `contentTreeAndSnapshots.mjs` (`topics`), `trainingPrep.mjs` (`training-profile`, `blueprint`) và `virtualClassroom.mjs` (`virtual-attendance/sync`), cũng như `learning_resources_storage_provider_check` trong `schema.mjs` mới chỉ cho phép 2 giá trị cũ.
4. `AdminAccountsPage.tsx` vẫn gọi API legacy `workspace/bootstrap` và `/crud/users`; codebase frontend tồn tại 82 `any`, 7 file legacy/trùng lặp, và 4 file lớn cần tách theo trách nhiệm.

---

## C. Phương án thực hiện

1. Xây dựng **`backend/storage/adapter.mjs`** (`createStorageAdapter`) hỗ trợ phân thư mục chuẩn (`documents/`, `pdfs/`, `videos/`, `images/`, `assignments/`, `attachments/`, `_tmp_videos/`), kiểm tra `safeResolveUnder`, checksum SHA-256, stream HTTP Range qua `res.__securityHeaders`, và hỗ trợ HTTP Object Storage (`S3`, `R2`, `VERCEL_BLOB`) qua biến môi trường `LMSPLUS_STORAGE_PROVIDER` / `LMSPLUS_STORAGE_BASE_URL` / `LMSPLUS_STORAGE_TOKEN` / `LMSPLUS_STORAGE_BUCKET` (có thể inject `fetchImpl` khi kiểm thử).
2. Xây dựng **`backend/organization/departments.mjs`** (CRUD cây tổ chức, kiểm tra vòng lặp `parent_id`, API `/departments/:id/summary` cho `HEAD_OF_DEPARTMENT` / `ACADEMIC_STAFF`) và **`backend/users/usersService.mjs`** (`GET/POST/PATCH/DELETE /users` có kiểm tra phạm vi đơn vị, băm `scrypt`, tự động tăng `token_version` + thu hồi Refresh Token khi đổi vai trò/khóa tài khoản, soft-deactivate bảo toàn khóa ngoại).
3. Di dời `ThemeSwitcher` về `frontend/src/teaching/ui.tsx`, nâng cấp `AuthPage.tsx` và `App.tsx` dùng chung 1 UI Kit duy nhất, xóa bỏ 7 file legacy không còn sử dụng và cập nhật `verify_system_and_sql.mjs`.
4. Chuyển `AdminAccountsPage.tsx` sang `teachingApi.listUsers` / `listDepartments` / `createUser` / `updateUser` / `deleteUser`; loại bỏ toàn bộ `82` kiểu `any` bằng `LessonBlockContent`, `FacilitiesOverview`, `YTPlayerInstance`, `RawForumDto`, `ExamAttemptDetail`; và tách module theo trách nhiệm:
   - `teaching/api.ts` (2,988 → **967** dòng) + `teaching/apiTypes.ts` (**2,100** dòng).
   - `ClassDetailPage.tsx` (2,653 → **333** dòng) + `ClassRosterAndContentTabs.tsx` (746 dòng) + `ClassScheduleAndLogTabs.tsx` (795 dòng) + `ClassAssessmentTabs.tsx` (815 dòng).
   - `VirtualSessionPage.tsx` (1,787 → **1,065** dòng) + `VirtualSessionPanels.tsx` (733 dòng).
   - `LessonStudioPage.tsx` (4,289 → **4,032** dòng) + `studioHelpers.ts` (265 dòng).

---

## D. Danh sách file đã thay đổi / thêm mới / gỡ bỏ

- **Thêm mới Backend & Test:** `backend/storage/adapter.mjs`, `backend/organization/departments.mjs`, `backend/users/usersService.mjs`, `tests/phase2_architecture_test_suite.mjs`.
- **Cập nhật Backend:** `backend/server_fallback.mjs`, `backend/teaching/routes.mjs`, `backend/teaching/courses.mjs`, `backend/teaching/banks.mjs`, `backend/teaching/studio.mjs`, `backend/teaching/schema.mjs`, `backend/teaching/contentTreeAndSnapshots.mjs`, `backend/teaching/trainingPrep.mjs`, `backend/teaching/virtualClassroom.mjs`, `backend/main.py`, `package.json`, `.agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs`.
- **Thêm mới Frontend (tách module):** `frontend/src/teaching/apiTypes.ts`, `frontend/src/teaching/pages/ClassRosterAndContentTabs.tsx`, `frontend/src/teaching/pages/ClassScheduleAndLogTabs.tsx`, `frontend/src/teaching/pages/ClassAssessmentTabs.tsx`, `frontend/src/teaching/pages/VirtualSessionPanels.tsx`, `frontend/src/teaching/studio/studioHelpers.ts`.
- **Cập nhật Frontend:** `frontend/src/App.tsx`, `frontend/src/types/elearning.ts`, `frontend/src/components/elearning/AuthPage.tsx`, `frontend/src/teaching/ui.tsx`, `frontend/src/teaching/api.ts`, `frontend/src/teaching/BlockRenderer.tsx`, `frontend/src/teaching/pages/AdminAccountsPage.tsx`, `frontend/src/teaching/pages/ClassDetailPage.tsx`, `frontend/src/teaching/pages/VirtualSessionPage.tsx`, `frontend/src/teaching/pages/TimetablePage.tsx`, `frontend/src/teaching/pages/TeachingHoursPage.tsx`, `frontend/src/teaching/pages/StudentAssessmentPages.tsx`, `frontend/src/teaching/studio/LessonStudioPage.tsx`, `frontend/src/teaching/studio/InteractiveVideoPlayer.tsx`, `frontend/src/teaching/studio/videoAdapter.ts`.
- **Gỡ bỏ (Dead/Duplicate Code):** `frontend/src/components/ui/Primitives.tsx`, `frontend/src/components/elearning/CrudManagementView.tsx`, `frontend/src/components/elearning/LessonPlayerView.tsx`, `frontend/src/components/elearning/TeachingLogAndAttendanceView.tsx`, `frontend/src/components/elearning/BlockEditorView.tsx`, `frontend/src/teaching/pages/LessonEditorPage.tsx`, `frontend/src/teaching/BlockEditor.tsx`.

---

## E. Migration / Schema liên quan

- Đã bổ sung seeding idempotent cho 3 đơn vị nền tảng (`org_root`, `khoi_5`, `dept_se`) ngay sau bước `TRUNCATE` test database ở `server_fallback.mjs` và trong `seedTeachingData`.
- Mở rộng ràng buộc SQLite `learning_resources.storage_provider` trong `schema.mjs` sang `('EXTERNAL_URL','LOCAL_DISK','S3','R2','VERCEL_BLOB')` (migration `012` trên PostgreSQL 18 sẽ cập nhật ràng buộc tương ứng cùng các bảng Rubric / Phúc khảo ở Phase 4).

---

## F. Kết quả kiểm thử sau chỉnh sửa cuối cùng

| Kiểm thử | Kết quả quan sát thực tế |
|---|---|
| `npm test` (9 suites trên SQLite) | **139/139 PASS (`0` failed)**: postgres_adapter `4/4`, security `12/12`, phase2_architecture `4/4`, elearning_full `30/30`, teaching `48/48`, lesson_studio `11/11`, master_lms `8/8`, training_lifecycle `7/7`, virtual_classroom `15/15` |
| 8 integration suites trên PostgreSQL 18.7 Docker | **135/135 PASS (`0` failed)** |
| `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | **PASS (`0` errors)** |
| `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs` | **Scanned 45 file(s) | Total Issues: 0** |
| `npm --prefix frontend run build` (`tsc && vite build`) | **PASS (`79 modules transformed`, build xong trong `4.92s`)** |
| Quét `:\s*any\b|\bas\s+any\b|any[]|<any>` trên `frontend/src` | **`TOTAL_ANY_HITS: 0`** |

---

## G. Rủi ro còn lại

1. Gói JS bundle `vite build` đạt `907.55 kB` (`dist/assets/index-Ci5K80lo.js`) do chưa bật `React.lazy` & `manualChunks` — sẽ xử lý ở Phase 5.
2. `LessonStudioPage.tsx` tuy đã tách helper `studioHelpers.ts` vẫn còn ~4,032 dòng phần JSX inspector các loại block; có thể tách thêm panel con ở các vòng bảo trì tiếp theo mà không ảnh hưởng API.

---

## H. Kế hoạch chuyển tiếp Phase 3

- Hợp nhất Single Source of Truth Design Tokens từ `theme/tokens.css`, loại bỏ trùng/lệch màu cứng trong `frontend/src/index.css`.
- Nâng cấp Dashboard thật theo 4 vai trò (`Học viên`, `Giảng viên`, `Trưởng bộ môn`, `Quản trị đào tạo`), điều hướng Sidebar 7 nhóm nghiệp vụ + Breadcrumbs, tối ưu touch target `>= 44px`, Cinema-dark mặc định cho trình học video và hoàn thiện các xác nhận thao tác xóa.
