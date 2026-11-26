# BÁO CÁO NGHIỆM THU PHASE 3 — NÂNG CẤP UI/UX, DESIGN TOKENS & NAVIGATION

> **Trạng thái Phase 3:** Hoàn thành hợp nhất Single Source of Truth Design Tokens từ `theme/tokens.css`, chuẩn hóa 0 mã hex rải rác trong CSS giao diện chính, triển khai Sidebar 7 nhóm nghiệp vụ phân quyền + Breadcrumbs + Mobile Drawer, Dashboard theo vai trò, Cinema-dark mặc định cho trình phát video, đạt 44×44px touch targets và 0 lỗi từ `impeccable_audit.mjs`.

---

## A. Kết quả khảo sát

1. **Design Tokens trùng lặp & mã màu rời rạc:** `frontend/src/index.css` định nghĩa lặp lại các token Tier 1/2/3 song song với `theme/tokens.css`, đồng thời chứa các fallback hex cứng (`#00A699`...) và thiếu trạng thái ép chuẩn cho vùng chạm / focus.
2. **Điều hướng & Phân quyền vai trò:** `frontend/src/App.tsx` sử dụng topbar dài, thiếu phân nhóm nghiệp vụ, chưa có Sidebar thu gọn trên desktop / Drawer trên mobile và thiếu thanh Breadcrumbs định vị ngữ cảnh màn hình.
3. **Dashboard & Dữ liệu giả:** `TeachingDashboard.tsx` và `StudentPages.tsx` tồn tại phép ước lượng tiến độ giả (`100 - ... * 15`), tiêu đề cố định chưa phản ánh vai trò (`Trưởng bộ môn`, `Giáo vụ đào tạo`, `Quản trị`, `Giảng viên`) và chưa nạp số liệu tổng hợp bộ môn thật.
4. **Chuẩn Impeccable / Touch Target / Trạng thái tương tác:** Nút xóa inline `.ls-inline-clear`, nút sửa/xóa chủ đề trong `CourseDetailPage.tsx` và một số nút chọn bài ở `StudentPages.tsx` có kích thước dưới `44×44px`; `VirtualSessionPanels.tsx` để lộ raw enum kỹ thuật (`connection_status`); một số thao tác xóa tại `BanksPage.tsx`, `ClassAssessmentTabs.tsx`, `TimetablePage.tsx`, `WikiPanel.tsx` chưa đi qua `ConfirmDialog` thống nhất.

---

## B. Danh sách vấn đề đã xử lý

1. Hợp nhất Single Source of Truth từ `theme/tokens.css` vào `frontend/src/main.tsx` và loại bỏ toàn bộ khối token trùng + **0** mã màu hex rải rác còn lại trong `frontend/src/index.css`.
2. Xây dựng hệ thống điều hướng **Role-Scoped Grouped Sidebar** (7 nhóm: `Tổng quan`, `Tổ chức đào tạo`, `Quản lý giảng dạy`, `Quản lý học tập`, `Đánh giá & Khảo thí`, `Báo cáo & Phân tích`, `Quản trị hệ thống`), tự thu gọn mặc định trong Lesson Studio, có Mobile Drawer và Dynamic Breadcrumbs bar.
3. Gỡ bỏ heuristic giả ở `TeachingDashboard.tsx` & `StudentPages.tsx`, hiển thị tiêu đề theo đúng vai trò và nạp `teachingApi.getDepartmentSummary` trực tiếp cho `HEAD_OF_DEPARTMENT` / `ACADEMIC_STAFF`.
4. Bổ sung sân khấu học tập tối ưu **Cinema-dark** (`🌙 Rạp chiếu`, mặc định bật cho bài học video) trên `StudentPages.tsx`, nâng vùng chạm tối thiểu `44×44px`, việt hóa `PROVIDER_CONN_LABELS` trong `VirtualSessionPanels.tsx`, sửa quy tắc nhấn nút (`.ls-marker-pin` không bị lệch vị trí khi nhấn) và bổ sung `ConfirmDialog` kèm bắt lỗi cho thao tác xóa tại `BanksPage.tsx`, `ClassAssessmentTabs.tsx`, `TimetablePage.tsx` và `WikiPanel.tsx`.

---

## C. Phương án thực hiện

1. Nạp `../../theme/tokens.css` trước `./index.css` trong `frontend/src/main.tsx` để giữ duy nhất một nguồn chân lý cho Light, Dark và Cinema-dark themes.
2. Cập nhật `frontend/src/index.css`: bỏ khối định nghĩa `:root` / `[data-theme]` trùng lặp, quy đổi toàn bộ biến phụ và màu ngữ nghĩa sang CSS variables chuẩn (`0` literal `#...` còn lại), chuẩn hóa `.ls-inline-clear` `min-width: 44px; min-height: 44px`, và bổ sung layout `.app-shell-body`, `.app-sidebar`, `.app-breadcrumb-bar`, `.m-cinema-player-stage`.
3. Nâng cấp `frontend/src/App.tsx`: ánh xạ route hiện có thành cấu trúc menu phân nhóm lọc theo danh sách `roles` thực tế của người dùng, hỗ trợ toggle thu/mở sidebar desktop & drawer mobile với `aria-expanded` và phím `Esc`.
4. Rà soát và hoàn thiện `TeachingDashboard.tsx`, `StudentPages.tsx`, `CourseDetailPage.tsx`, `VirtualSessionPanels.tsx`, `BanksPage.tsx`, `ClassAssessmentTabs.tsx`, `TimetablePage.tsx`, `WikiPanel.tsx` bảo đảm 0 vi phạm Impeccable / Airbnb DLS.

---

## D. Danh sách file đã thay đổi

- `frontend/src/main.tsx`
- `frontend/src/index.css`
- `frontend/src/App.tsx`
- `frontend/src/teaching/pages/TeachingDashboard.tsx`
- `frontend/src/teaching/pages/StudentPages.tsx`
- `frontend/src/teaching/pages/CourseDetailPage.tsx`
- `frontend/src/teaching/pages/VirtualSessionPanels.tsx`
- `frontend/src/teaching/pages/BanksPage.tsx`
- `frontend/src/teaching/pages/ClassAssessmentTabs.tsx`
- `frontend/src/teaching/pages/TimetablePage.tsx`
- `frontend/src/teaching/pages/WikiPanel.tsx`

---

## E. Migration / Schema liên quan

- Phase 3 tập trung nâng cấp giao diện, điều hướng, design token và UX tương tác — không thay đổi schema cơ sở dữ liệu.

---

## F. Kết quả kiểm thử sau chỉnh sửa cuối cùng

| Kiểm thử | Kết quả quan sát thực tế |
|---|---|
| `npm --prefix frontend run build` (`tsc && vite build`) | **PASS (`80 modules transformed`, build trong `3.36s`, JS `915.70 kB`, CSS `101.94 kB`)** |
| `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs` | **Scanned 45 file(s) | Total Issues: 0 (P0 Critical: 0, P1 High: 0)** |
| `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | **PASS (`ALL CHECKS PASSED (0 errors)`)** |
| `npm test` (9 suites trên SQLite) | **139/139 PASS (`0` failed)**: postgres_adapter `4/4`, security `12/12`, phase2_architecture `4/4`, elearning_full `30/30`, teaching `48/48`, lesson_studio `11/11`, master_lms `8/8`, training_lifecycle `7/7`, virtual_classroom `15/15` |
| Đếm literal mã màu Hex còn sót trong `frontend/src/index.css` | **`0`** |

---

## G. Rủi ro còn lại

1. Kích thước bundle chính `dist/assets/index-BYl4YRJG.js` (`915.70 kB`, gzip `247.75 kB`) vượt ngưỡng `500 kB` của Vite — sẽ tách chunk bằng `React.lazy` và `manualChunks` ở Phase 5.
2. Các màn hình thao tác nghiệp vụ còn thiếu ở frontend (Quản trị Khoa/Bộ môn `DepartmentsPage`, upload tệp bài tập sinh viên, Rubric chấm điểm, Phúc khảo điểm, cấu hình `minutes_per_period`) sẽ hoàn thiện đầy đủ trong Phase 4.

---

## H. Kế hoạch chuyển tiếp Phase 4

- Phát hành Migration `012` (bổ sung Rubric cho bài tập, bảng Phúc khảo điểm `grade_appeals`, đồng bộ constraint `learning_resources.storage_provider` trên PostgreSQL 18).
- Bổ sung giao diện quản trị `DepartmentsPage` (`/admin/departments`), sửa triệt để Lesson Studio (`step_by_step_solution` + bảo toàn `thumbnail_url` an toàn), sửa bug đồng hồ đếm ngược bài thi & bổ sung upload tệp bài tập học viên.
- Chuẩn hóa cấu hình `minutes_per_period` (mặc định 45 phút, không hardcode), luồng Rubric + Phúc khảo + duyệt giảng dạy cho Trưởng bộ môn, đồng bộ bộ lọc quý/tháng quỹ giờ giảng, chuẩn hóa enum đơn nghỉ (`SICK`) và nâng cấp preview + danh sách lỗi từng dòng khi nhập CSV/JSON.
