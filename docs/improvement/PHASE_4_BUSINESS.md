# BÁO CÁO NGHIỆM THU PHASE 4 — HOÀN THIỆN NGHIỆP VỤ, RUBRIC, PHÚC KHẢO & CSV/JSON

> **Trạng thái Phase 4:** Hoàn thành toàn diện luồng nghiệp vụ LMSPLUS trên cả SQLite và PostgreSQL 18.7: Migration `012` (84 bảng), quản trị Khoa/Bộ môn & phê duyệt học thuật cho Trưởng bộ môn, Rubric chấm bài tập, Học viên nộp tệp bài tập chuẩn storage adapter + RBAC, quy trình Phúc khảo điểm, sửa dứt điểm Lesson Studio & đồng hồ thi, đồng bộ định mức phút/tiết, enum đơn nghỉ & import CSV/JSON có preview từng dòng.

---

## A. Kết quả khảo sát

1. **Tổ chức Bộ môn & Trưởng bộ môn:** Backend đã có API `departments` & `HEAD_OF_DEPARTMENT` từ Phase 1–2, nhưng Frontend chưa có trang quản trị sơ đồ Khoa/Bộ môn (`/admin/departments`) để bổ nhiệm Trưởng đơn vị và duyệt hồ sơ học thuật tập trung theo bộ môn.
2. **Lesson Studio & Trình làm bài:** `LessonStudioPage.tsx` (lines 794, 2513) xóa mất `thumbnail_url` dạng `data:image/` an toàn khi chọn/tải video, thiếu editor cho khối `step_by_step_solution` dù `blocks.mjs` & `BlockRenderer.tsx` hỗ trợ; `StudentAssessmentPages.tsx` resets bộ đếm `setInterval` mỗi giây do dependency thay đổi theo `res`/`runner` và thiếu giao diện nộp tệp thật cho bài tập `FILE`/`MIXED`.
3. **Rubric & Phúc khảo điểm:** Bảng `class_assignments` và `class_assignment_submissions` chưa tách cột Rubric/điểm tiêu chí trên PG18; chưa có bảng/API `grade_appeals` và luồng Giảng viên/Trưởng bộ môn duyệt phúc khảo tự đồng bộ lại Gradebook.
4. **Cấu hình nghiệp vụ & Dữ liệu CSV/JSON:** `curriculaAndCohorts.mjs` hardcode `* 0.75` (45 phút) bỏ qua `courses.minutes_per_period` khi thêm môn vào Khung CT; `TeachingHoursPage.tsx` (`InstructorQuotasPanel`) không sync state khi đổi tháng & hardcode 45; `LeaveRequestsPage.tsx` gửi `'ILLNESS'`/`'WORK'` lệch với enum backend `'SICK'`/`'OFFICIAL_DUTY'`; một số màn hình/engine còn fallback `'cp_cs1'`; `Gradebook` backend trả `student_code`/`student_name` trong khi UI đọc `code`/`full_name`; import CSV học viên chia dấu phẩy cả dòng tiêu đề và cột họ tên.

---

## B. Danh sách vấn đề đã xử lý

1. Phát hành **Migration `012_rubrics_appeals_storage_up.sql` & `_down.sql`**: bổ sung `class_assignments.rubric_json`, `class_assignment_submissions.rubric_scores_json`, bảng `grade_appeals` (+ 2 index) và đồng bộ ràng buộc `learning_resources_storage_provider_check` cho `S3`/`R2`/`VERCEL_BLOB` trên PostgreSQL 18.
2. Tạo màn hình **`DepartmentsPage.tsx`** (`/admin/departments`), gắn vào Sidebar & Router (`App.tsx`), tích hợp CRUD Khoa/Bộ môn, bổ nhiệm Trưởng đơn vị và duyệt Đề cương/Khung CT chờ phê duyệt; gắn UI `deleteCurriculum` (`CurriculumPages.tsx`), `updateCohort` (`CohortPages.tsx`), `createCampus` (`TimetablePage.tsx`).
3. Sửa **`LessonStudioPage.tsx`** & **`studioHelpers.ts`**: bảo toàn `thumbnail_url` hợp lệ (`https://`, `/api/`, `data:image/`), bổ sung `step_by_step_solution` vào bảng khối và form chỉnh sửa từng bước lời giải.
4. Sửa **`StudentAssessmentPages.tsx`** & **`assessmentsAndAssignments.mjs`**: ổn định `setInterval` bằng `submitAttemptRef` + dependency `[runner?.attemptId, hasSubmitted]`; thêm `POST /learn/assignments/:id/upload` (kiểm tra extension + magic bytes, tối đa 15MB qua `StorageAdapter`) & `GET /assignment-files/:assignmentId/:fileName` (RBAC cô lập theo học viên sở hữu / giảng viên lớp / Trưởng bộ môn); hoàn thiện **Rubric Builder + Rubric Grading** & **Grade Appeals (Phúc khảo)** đồng bộ Sổ điểm trong `tx()`, đồng thời bổ sung `code`/`full_name` trong Gradebook DTO.
5. Sửa cấu hình quy đổi `minutes_per_period` trong `curriculaAndCohorts.mjs` & `TeachingHoursPage.tsx`, đồng bộ `LeaveReasonCategory` (`SICK`, `OFFICIAL_DUTY`, `ACADEMIC_CONFLICT`) giữa `apiTypes.ts`, `ui.tsx`, `LeaveRequestsPage.tsx` và `leaveAndForums.mjs`; loại bỏ fallback cứng `'cp_cs1'` ở frontend & backend (`resolveDefaultCampusId`); nâng cấp import CSV/JSON cho danh sách học viên (`ClassRosterAndContentTabs.tsx` + `classes.mjs`) và Ngân hàng câu hỏi (`BanksPage.tsx`) kèm preview & báo lỗi chi tiết theo từng dòng.

---

## C. Phương án thực hiện

1. Lưu trữ Schema tăng dần qua `012_rubrics_appeals_storage_up.sql` + đồng bộ bảng/cột vào `masterSchema.mjs` (SQLite) & `backup-restore-pg.mjs`.
2. Chuẩn hóa helper `normalizeRubricArray`, `normalizeRubricScores`, `resolveAppealAccess` (hỗ trợ Giảng viên lớp, Giáo vụ & Trưởng bộ môn qua `canApproveDepartmentAcademic`) và `resolveDefaultCampusId` ở backend.
3. Gắn đầy đủ luồng end-to-end trong `tests/phase4_business_test_suite.mjs` (`6` kịch bản cốt lõi) chạy trên cả SQLite và PostgreSQL 18.7 Docker.

---

## D. Danh sách file đã thay đổi / thêm mới

- **Migration & Script:** `database/migrations/012_rubrics_appeals_storage_up.sql`, `database/migrations/012_rubrics_appeals_storage_down.sql`, `scripts/backup-restore-pg.mjs`, `package.json`.
- **Backend:** `backend/teaching/routes.mjs`, `backend/teaching/masterSchema.mjs`, `backend/teaching/assessmentsAndAssignments.mjs`, `backend/teaching/curriculaAndCohorts.mjs`, `backend/teaching/leaveAndForums.mjs`, `backend/teaching/classes.mjs`, `backend/teaching/trainingPrep.mjs`, `backend/teaching/timetableEngine.mjs`.
- **Frontend:** `frontend/src/App.tsx`, `frontend/src/teaching/ui.tsx`, `frontend/src/teaching/apiTypes.ts`, `frontend/src/teaching/api.ts`, `frontend/src/teaching/pages/DepartmentsPage.tsx` (mới), `frontend/src/teaching/pages/CurriculumPages.tsx`, `frontend/src/teaching/pages/CohortPages.tsx`, `frontend/src/teaching/pages/ClassAssessmentTabs.tsx`, `frontend/src/teaching/pages/ClassRosterAndContentTabs.tsx`, `frontend/src/teaching/pages/StudentAssessmentPages.tsx`, `frontend/src/teaching/pages/BanksPage.tsx`, `frontend/src/teaching/pages/TimetablePage.tsx`, `frontend/src/teaching/pages/CurriculumBlueprintPanels.tsx`, `frontend/src/teaching/pages/TeachingHoursPage.tsx`, `frontend/src/teaching/pages/LeaveRequestsPage.tsx`, `frontend/src/teaching/studio/studioHelpers.ts`, `frontend/src/teaching/studio/LessonStudioPage.tsx`.
- **Tests:** `tests/phase4_business_test_suite.mjs` (mới).

---

## E. Migration / Schema liên quan

- Đã chạy `npm run db:schema` thành công lên PostgreSQL 18.7 (`84 bảng, 2 incremental migration`: `011` và `012`), bảo toàn dữ liệu hiện hữu và có script rollback `012_rubrics_appeals_storage_down.sql`.

---

## F. Kết quả kiểm thử sau chỉnh sửa cuối cùng

| Kiểm thử | Kết quả quan sát thực tế |
|---|---|
| `npm test` (10 suites trên SQLite) | **145/145 PASS (`0` failed)**: postgres_adapter `4/4`, security `12/12`, phase2_architecture `4/4`, phase4_business `6/6`, elearning_full `30/30`, teaching `48/48`, lesson_studio `11/11`, master_lms `8/8`, training_lifecycle `7/7`, virtual_classroom `15/15` |
| `npm run db:schema` trên PG18.7 Docker | **PASS (`84 bảng, 2 incremental migration`)** |
| 9 integration suites trên PostgreSQL 18.7 Docker (`lmsplus_test`) | **141/141 PASS (`0` failed)**: security `12/12`, phase2 `4/4`, phase4 `6/6`, elearning_full `30/30`, teaching `48/48`, lesson_studio `11/11`, master_lms `8/8`, training_lifecycle `7/7`, virtual_classroom `15/15` |
| `npm --prefix frontend run build` (`tsc && vite build`) | **PASS (`81 modules transformed`, build trong `3.59s`)** |
| `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs` | **Scanned 46 file(s) \| Total Issues: 0** |
| `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | **PASS (`ALL CHECKS PASSED (0 errors)`)** |

---

## G. Rủi ro còn lại

1. Gói build JS đơn file hiện đạt `954.10 kB` (`dist/assets/index-cCfAWu9n.js`), cần bật `React.lazy` & `manualChunks` ở Phase 5.
2. Tối ưu truy vấn N+1, bổ sung composite index & cache tầng dịch vụ, che secret `?st=` trong HTTP log, graceful shutdown và đo kiểm tải thực tế 50 / 100 / 200 người dùng đồng thời ở Phase 5.
