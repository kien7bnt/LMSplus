# Báo cáo Khảo sát & Triển khai Tổng thể LMSPLUS

**Ngày hoàn tất:** 2026-11-14  
**Phạm vi:** Củng cố kiến trúc 3 cấp (`LINKED`), phiên bản môn học bất biến (`SNAPSHOT`), tiến độ video chống tua (`STRICT`), cây nội dung 4 cấp và 3 ngân hàng học liệu ràng buộc nút lá, hệ thống kiểm tra/bài tập/bảng điểm, đơn xin nghỉ phép đồng bộ điểm danh, diễn đàn môn học/lớp, thông báo và giao diện người dùng đầy đủ kết nối API thật.

---

## 1. Ba quyết định nghiệp vụ đã khóa & triển khai

1. **Quan hệ 3 cấp `LINKED` (`curricula` -> `program_cohorts` -> `subject_classes`):**
   - Cấp 1 (`curricula`, `curriculum_subjects`): Khung chương trình chứa danh sách môn học theo thứ tự học kỳ và tính chất bắt buộc.
   - Cấp 2 (`program_cohorts`, `cohort_enrollments`): Lớp khóa học gắn với một Khung chương trình; thống kê sĩ số hoạt động theo `DISTINCT student_id` (`active_students_count` / `statistics.distinct_active_students`, ví dụ lớp `coh_k5_5a1` có đúng 24 học viên khi liên kết 2 lớp môn Toán & Tiếng Việt).
   - Cấp 3 (`subject_classes.cohort_id`, `class_enrollments.enrollment_source`): Sinh lớp môn tự động từ khung (`POST /cohorts/:id/generate-classes`), đồng bộ danh sách học viên theo nguồn `COHORT_SYNCED` đồng thời bảo toàn các bản ghi bổ sung riêng ở cấp lớp môn (`MAKEUP`, `RETAKE`, `SUPPLEMENTAL`, `ACADEMIC_ASSIGNED`) khi đồng bộ lại, rút hoặc chuyển lớp khóa.

2. **Quản lý phiên bản môn học `SNAPSHOT` bất biến (`course_versions`):**
   - Lớp đang vận hành được ghim vào `course_version_id` xác định (`v1`, `v2`, ...); chỉnh sửa bản nháp hoặc phát hành `v2` của môn học không tự động làm biến đổi nội dung lớp đang chạy `v1`.
   - Việc nâng cấp phiên bản lớp thực hiện tường minh qua `POST /classes/:id/upgrade-version` (bắt buộc `confirmed: true` và lý do nâng cấp; thiếu xác nhận trả `422 CONFIRMATION_REQUIRED`), kèm ghi nhận kiểm toán và cô lập tiến độ học viên theo `content_version_key`.

3. **Tiến độ video `STRICT` chống tua:**
   - Tổng thời lượng xem hợp lệ tính theo hợp các đoạn đã xem (*Interval Union* `[start_sec, end_sec]`), tua lùi xem lại không làm giảm phần trăm hoàn thành.
   - Chặn vượt biên độ cho phép (*frontier seek-ahead*) và tốc độ `> 2.0x` (`422 STRICT_VIDEO_TAMPER_REJECTED`), bỏ qua phân đoạn khi tab bị ẩn (`is_visible: false`), hỗ trợ đồng bộ hàng đợi offline idempotent theo `idempotency_key` (`events[]`), và cung cấp báo cáo phân tích video giảng viên (`GET /classes/:id/video-analytics`).

---

## 2. Cơ sở dữ liệu & Migration `008`

- **Migration PostgreSQL:**
  - [008_master_lms_architecture_up.sql](file:///d:/LMS%20elearning/database/migrations/008_master_lms_architecture_up.sql) (`CREATE TABLE`: 18 bảng, bọc trong transaction).
  - [008_master_lms_architecture_down.sql](file:///d:/LMS%20elearning/database/migrations/008_master_lms_architecture_down.sql) (`DROP TABLE`: 18 bảng rollback tương ứng).
  - Toàn bộ hệ thống migration `000` -> `008` quản lý 88 bảng (`UP`) và 76 bảng rollback (`DOWN`).
- **Schema SQLite runtime & Seed:** [backend/teaching/masterSchema.mjs](file:///d:/LMS%20elearning/backend/teaching/masterSchema.mjs) và [backend/teaching/schema.mjs](file:///d:/LMS%20elearning/backend/teaching/schema.mjs), khởi tạo/đồng bộ an toàn qua `initSchemaAndSeed` trong [backend/server_fallback.mjs](file:///d:/LMS%20elearning/backend/server_fallback.mjs).

---

## 3. Các module Backend (`/api/v1/teaching/*`)

Triển khai và hợp nhất trong `backend/teaching/`:
- [curriculaAndCohorts.mjs](file:///d:/LMS%20elearning/backend/teaching/curriculaAndCohorts.mjs): CRUD Khung chương trình (`/curricula`, `DRAFT`/`ACTIVE`), gắn môn khung, CRUD Lớp khóa học (`/cohorts`), sinh lớp môn (`201`), đồng bộ roster (`POST /cohorts/:id/sync-roster`), rút học viên (`/withdraw`) và chuyển lớp khóa (`/transfer`).
- [contentTreeAndSnapshots.mjs](file:///d:/LMS%20elearning/backend/teaching/contentTreeAndSnapshots.mjs): Cây nội dung 4 cấp (`GET /courses/:id/tree`, `/topics`), Snapshot bất biến (`POST /courses/:id/versions`, `POST /classes/:id/upgrade-version`).
- [banks.mjs](file:///d:/LMS%20elearning/backend/teaching/banks.mjs): 3 ngân hàng học liệu (Câu hỏi `/banks/questions`, Bài tập `/banks/assignments`, Tài nguyên `/banks/resources`) bắt buộc gắn nút lá `LESSON` (`400 LEAF_LESSON_REQUIRED` nếu thiếu), kèm `import`/`export` JSON.
- [strictVideo.mjs](file:///d:/LMS%20elearning/backend/teaching/strictVideo.mjs): Cơ chế Interval Union, kiểm soát tamper (`422 STRICT_VIDEO_TAMPER_REJECTED`), tab ẩn, offline queue idempotent và thống kê giảng viên.
- [assessmentsAndAssignments.mjs](file:///d:/LMS%20elearning/backend/teaching/assessmentsAndAssignments.mjs) & [quizEngine.mjs](file:///d:/LMS%20elearning/backend/teaching/quizEngine.mjs): Tạo và phát hành bài kiểm tra hỗn hợp (trắc nghiệm từ ngân hàng `question_bank_ids` / `bank_question_ids` + `SHORT_ANSWER` chấm tay), lượt làm bài (`POST /learn/exams/:id/start` -> `201`), lưu nháp, nộp bài (`PENDING_MANUAL`), chấm tay (`/exam-attempts/:attemptId/grade`), bài tập thực hành (`/classes/:id/assignments`, `/learn/assignments/:id/draft`, `/submit`, `/grade`) và bảng điểm thống nhất (`/classes/:id/gradebook`, `/learn/classes/:id/grades`).
- [leaveAndForums.mjs](file:///d:/LMS%20elearning/backend/teaching/leaveAndForums.mjs) & [attendance.mjs](file:///d:/LMS%20elearning/backend/teaching/attendance.mjs): Đơn xin nghỉ phép (`/learn/leave-requests`, `SICK`/`FAMILY`/`OFFICIAL_DUTY`/`OTHER`, đồng bộ `EXCUSED_ABSENCE` nhưng tuyệt đối không ghi đè `PRESENT`/`LATE`, hỗ trợ hủy đơn `/cancel`), diễn đàn môn học & diễn đàn lớp riêng tư (cách ly chéo lớp `403`, kiểm duyệt `PIN`/`UNPIN`/`LOCK`/`UNLOCK`/`HIDE`/`UNHIDE`/`ENDORSE`, báo cáo `/forum-reports/*/resolve`), thông báo (`/notifications`), và tổng quan học viên (`/learn/overview`).
- Các module cốt lõi liên quan: [routes.mjs](file:///d:/LMS%20elearning/backend/teaching/routes.mjs), [courses.mjs](file:///d:/LMS%20elearning/backend/teaching/courses.mjs), [classes.mjs](file:///d:/LMS%20elearning/backend/teaching/classes.mjs), [blocks.mjs](file:///d:/LMS%20elearning/backend/teaching/blocks.mjs), [learn.mjs](file:///d:/LMS%20elearning/backend/teaching/learn.mjs), [studio.mjs](file:///d:/LMS%20elearning/backend/teaching/studio.mjs), [scope.mjs](file:///d:/LMS%20elearning/backend/teaching/scope.mjs), [http.mjs](file:///d:/LMS%20elearning/backend/teaching/http.mjs), [virtualClassroom.mjs](file:///d:/LMS%20elearning/backend/teaching/virtualClassroom.mjs), [virtualProviders.mjs](file:///d:/LMS%20elearning/backend/teaching/virtualProviders.mjs).

### Sửa lỗi phát hiện trong quá trình kiểm thử tích hợp
1. `rateFromCounts(counts, policy)` trong [attendance.mjs](file:///d:/LMS%20elearning/backend/teaching/attendance.mjs) được bổ sung giá trị mặc định `DEFAULT_POLICY` và truyền `getAttendancePolicy(db)` tại `/learn/overview` trong [leaveAndForums.mjs](file:///d:/LMS%20elearning/backend/teaching/leaveAndForums.mjs) để tránh `TypeError` khi đọc `late_counts_as_present`.
2. `POST /learn/leave-requests` trong [leaveAndForums.mjs](file:///d:/LMS%20elearning/backend/teaching/leaveAndForums.mjs) đặt `fallback: ''` cho `makeup_class_requested` để tránh lỗi `NOT NULL constraint failed` khi học viên không nhập nguyện vọng học bù.
3. `resolveExamQuestionsInput` trong [assessmentsAndAssignments.mjs](file:///d:/LMS%20elearning/backend/teaching/assessmentsAndAssignments.mjs) hỗ trợ đồng thời cả `question_bank_ids` và `bank_question_ids`.

---

## 4. Giao diện Frontend (`frontend/src/`)

- **Điều hướng & thông báo:** [App.tsx](file:///d:/LMS%20elearning/frontend/src/App.tsx) (bổ sung chuông thông báo header `.m-notif-popover`, tuyến đường Khung chương trình, Lớp khóa học, Ngân hàng học liệu, Bài kiểm tra/Bài tập/Điểm danh/Nghỉ phép).
- **API Client:** [frontend/src/teaching/api.ts](file:///d:/LMS%20elearning/frontend/src/teaching/api.ts) (chuẩn hóa payload kiểm duyệt diễn đàn `moderateForumThread`, `moderateForumReply` sang `action`, và `resolveForumReport` sang `status` + `hide_target`).
- **Khung CT, Lớp khóa học & Ngân hàng học liệu:** [CurriculumPages.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/CurriculumPages.tsx), [CohortPages.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/CohortPages.tsx), [BanksPage.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/BanksPage.tsx).
- **Môn học, Lớp học & Studio:** [CourseDetailPage.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/CourseDetailPage.tsx), [ClassDetailPage.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/ClassDetailPage.tsx) (đồng bộ câu hỏi `SHORT_ANSWER` với backend `quizEngine`, tab Kiểm tra/Bài tập/Bảng điểm/Xin nghỉ/Diễn đàn/Nâng cấp Snapshot/Thống kê video STRICT), [LessonStudioPage.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/studio/LessonStudioPage.tsx), [InteractiveVideoPlayer.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/studio/InteractiveVideoPlayer.tsx), [BlockRenderer.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/BlockRenderer.tsx).
- **Học viên & Vận hành:** [StudentPages.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/StudentPages.tsx), [StudentAssessmentPages.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/StudentAssessmentPages.tsx), [LeaveRequestsPage.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/LeaveRequestsPage.tsx), [ForumPanel.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/ForumPanel.tsx), [WikiPanel.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/WikiPanel.tsx), [TeachingDashboard.tsx](file:///d:/LMS%20elearning/frontend/src/teaching/pages/TeachingDashboard.tsx).

---

## 5. Kết quả kiểm thử, kiểm định & build

Toàn bộ lệnh được chạy trực tiếp sau chỉnh sửa cuối cùng và đều trả về mã thoát `0`:

| Hạng mục | Lệnh thực thi | Kết quả |
|---|---|---|
| Kiểm thử tích hợp Master LMS | `node tests/master_lms_test_suite.mjs` | **TOTAL: 8 \| PASSED: 8 \| FAILED: 0** |
| Kiểm thử hồi quy E-learning | `node tests/elearning_full_test_suite.mjs` | **TOTAL: 30 \| PASSED: 30 \| FAILED: 0** |
| Kiểm thử hồi quy Giảng dạy | `node tests/teaching_test_suite.mjs` | **TOTAL: 48 \| PASSED: 48 \| FAILED: 0** |
| Kiểm thử Lesson Studio & Video Quiz | `node tests/lesson_studio_test_suite.mjs` | **TOTAL: 11 \| PASSED: 11 \| FAILED: 0** |
| Kiểm thử Lớp học trực tuyến | `node tests/virtual_classroom_test_suite.mjs` | **TOTAL: 15 \| PASSED: 15 \| FAILED: 0** |
| Kiểm định Kiến trúc & SQL | `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` | **ALL CHECKS PASSED (0 errors)** · 88 UP \| 76 DOWN |
| Kiểm định UI/UX Impeccable | `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs ./frontend/src` | **Scanned 36 file(s) \| Total Issues: 0 (P0: 0, P1: 0) — PASS** |
| Build Frontend Production | `npm run build` (`tsc && vite build`) | **66 modules transformed**, built in **2.73s** (`dist/assets/index-C_r7wmbJ.css` 60.15 kB, `dist/assets/index-DraSSTFT.js` 694.91 kB) |
| Đồng bộ Schema & Seed DB | `node -e "import('./backend/server_fallback.mjs').then(m => m.initSchemaAndSeed(false))"` | Exit code **0** |
