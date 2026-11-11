# Lesson Studio & Interactive Timestamp Video Quiz — Kiến trúc & Triển khai Thực tế

> **Phạm vi triển khai:** Tích hợp trực tiếp vào hệ thống **LMSPLUS** hiện hữu (`d:\LMS elearning`) theo chuẩn `AGENTS.md`, dùng chung một **Lesson Studio 3 khung** cho cả **Mode A (Giáo án Khóa học chuẩn)** và **Mode B (Tùy biến Giáo án theo Lớp học)**.

---

## 1. Kết quả Khảo sát & Tái sử dụng Hệ thống Hiện tại

| Tầng | Đã có trước khi triển khai | Mở rộng / Bổ sung cho Lesson Studio |
|---|---|---|
| **Database & Migration** | `courses`, `chapters`, `lessons`, `lesson_blocks`, `lesson_versions`, `learning_resources`, `subject_classes`, `class_staff_assignments`, `student_lesson_progress` (`000`–`006`) | Migration `007_lesson_studio_and_video_quiz_up.sql` & `down.sql` mở rộng `lessons`/`learning_resources` và tạo 7 bảng mới: `video_upload_sessions`, `question_bank_items`, `video_quiz_markers`, `class_lesson_customs`, `class_lesson_blocks`, `video_watch_progress`, `lesson_quiz_submissions`. |
| **Backend API** | `/api/v1/teaching/*` (`courses.mjs`, `classes.mjs`, `attendance.mjs`, `learn.mjs`, `blocks.mjs` v1.0) | Bổ sung `quizEngine.mjs`, `studio.mjs`, nâng cấp `blocks.mjs` lên schema `1.2` (đủ 15 loại khối + `display` config), nâng cấp `learn.mjs` và `server_fallback.mjs` hỗ trợ tải video theo mảnh (chunked upload), hủy tải lên xóa `.part`, phát `HTTP Range 206 Partial Content` kèm chữ ký `?st=...`. |
| **Frontend UI** | `CourseDetailPage`, `ClassDetailPage`, `StudentPages`, `BlockRenderer`, 3-Tier Theme System (`tokens.css`) | Xây dựng bộ component `frontend/src/teaching/studio/`: `videoAdapter.ts`, `InteractiveVideoPlayer.tsx`, `QuestionEditorFields.tsx`, `VideoQuizTimelineEditor.tsx`, `LessonStudioPage.tsx`; tích hợp điều hướng từ Khóa học, Lớp học và Không gian Học viên. |

---

## 2. Hai Chế độ Biên soạn Dùng chung Một Lesson Studio

1. **Mode A — Course Authoring (`/teaching/courses/:courseId/studio` & `/teaching/lessons/:lessonId`):**
   - Quản lý cây chương & bài học chuẩn (tạo, đổi tên inline, kéo-thả/di chuyển thứ tự, nhân bản sâu chương/bài học, lưu trữ/xóa an toàn).
   - Soạn thảo đầy đủ 15 loại khối, Ngân hàng câu hỏi của khóa học, mốc câu hỏi theo giây trên video, lưu nháp có `base_revision` chống ghi đè (`409 REVISION_CONFLICT`), xuất bản snapshot bất biến vào `lesson_versions` và khôi phục phiên bản cũ về nháp.
   - **Chính sách đa lớp rõ ràng:** Khi `classes_using.length > 1`, hộp thoại Xuất bản hiển thị danh sách tất cả các lớp đang dùng khóa học và cung cấp 3 lựa chọn rõ ràng: (1) Xuất bản cập nhật cho toàn bộ các lớp, (2) Sao chép thành khóa học độc lập, hoặc (3) Chuyển sang Lesson Studio riêng của từng lớp (Mode B).

2. **Mode B — Class Teaching Content (`/teaching/classes/:classId/studio`):**
   - Kế thừa toàn bộ các khối và mốc câu hỏi đã xuất bản của khóa học gốc (`origin: 'INHERITED'`, chỉ đọc để bảo toàn tính toàn vẹn chương trình chuẩn).
   - Cho phép giảng viên lớp / trợ giảng có quyền soạn học liệu bổ sung ghi chú dặn dò, mục tiêu riêng, khối học liệu riêng (`class_lesson_blocks`, có thể neo vị trí ngay sau bất kỳ khối kế thừa nào qua `anchor_block_id`) và **gắn thêm mốc câu hỏi tương tác riêng của lớp lên cả video gốc lẫn video riêng của lớp** (`video_quiz_markers.class_id = :classId`).
   - Cô lập tuyệt đối giữa các lớp (ví dụ: tùy biến tại lớp `5A1` hoàn toàn không xuất hiện ở lớp `5A2` hay khóa học gốc).

---

## 3. Tải Video Dung lượng lớn, Phát HTTP Range & Player-Agnostic Controller

- **Lưu trữ đúng chuẩn:** Tệp video và PDF được ghi trên ổ đĩa (`uploads/videos/...`, `uploads/pdfs/...`), CSDL chỉ lưu đường dẫn tương đối, kích thước, MIME, thời lượng và trạng thái xử lý (`UPLOADING` → `READY`).
- **Tải lên theo mảnh & Hủy sạch tệp tạm:**
  - `POST /api/v1/teaching/media/videos/init` → `PUT .../chunk` → `POST .../complete`.
  - Khi giảng viên bấm **Hủy tải lên**, `AbortController` ngắt luồng ngay và gọi `DELETE /api/v1/teaching/media/videos/:uploadId` xóa sạch tệp `.part` trên máy chủ.
- **HTTP Range Streaming (`206 Partial Content`):**
  - `GET /api/v1/teaching/media/stream/:resourceId?st=<signed_token>` kiểm tra chữ ký HMAC ngắn hạn gắn với đúng `userId + resourceId`, trả về `Accept-Ranges: bytes` và `206 Partial Content` giúp tua video tức thì trên `<video>`.
- **Kiến trúc `VideoPlayerAdapter` tách rời công nghệ phát:**
  - `Html5VideoAdapter` (cho tệp tải lên & nguồn HTTPS trực tiếp) và `YouTubeIframeAdapter` (cho YouTube `youtube-nocookie.com`) cùng tuân thủ giao diện `getCurrentTime()`, `getDuration()`, `play()`, `pause()`, `seek()`, `setPlaybackRate()`, `subscribe()`.

---

## 4. Interactive Timestamp Video Quiz & Bảo mật Chấm điểm

- **Hỗ trợ đủ 5 loại câu hỏi:** `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `TRUE_FALSE`, `FILL_BLANK`, `SHORT_ANSWER` (cùng chế độ `INFO_ONLY` hiển thị ghi chú kiến thức không chấm điểm).
- **Xử lý trọn vẹn các tình huống biên khi học viên xem video:**
  1. Tự động tạm dừng chính xác tại `timestamp_sec` và mở lớp phủ câu hỏi ngay trên khung 16:9.
  2. Chặn tua vượt qua mốc câu hỏi bắt buộc (`PAUSE_AND_ASK` + `is_required`) chưa hoàn thành: tự kéo vị trí phát về đúng mốc câu hỏi và mở câu hỏi.
  3. Nhiều mốc đặt sát nhau: xếp hàng đợi tuần tự (`markerQueueRef`) không bỏ sót mốc nào.
  4. Mốc vượt thời lượng thực tế của video: tự kẹp an toàn về `duration - 0.5s`.
  5. Học viên tua xem lại từ `00:00`: không bật lặp gây phiền các mốc đã hoàn thành trong phiên, nhưng cho phép bấm trực tiếp vào ghim mốc trên thanh tiến trình để ôn lại khi `allow_review = true`.
  6. Lưu vị trí xem dở (`video_watch_progress.last_position_sec`) để tự động khôi phục khi mở lại bài học.
  7. Chống gửi trùng đáp án bằng `idempotency_key` duy nhất trên bảng `lesson_quiz_submissions`.
  8. **Không lộ đáp án:** `stripQuestionForStudent` xóa sạch `answer_key`, `is_correct` và lời giải trước khi trả JSON cho học viên; chế độ Xem trước của giảng viên chấm hoàn toàn trên bộ nhớ trình duyệt (`gradeQuestionInMemory`), không ghi rác vào CSDL.

---

## 5. Kiểm thử & Kiểm định Đã Chạy Thực tế

- `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend` → **0 lỗi**
- `node frontend/node_modules/vite/bin/vite.js build frontend` → **Build thành công**
- `node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs .` → **0 lỗi (0 P0, 0 P1 trên toàn bộ 32 file giao diện)**
- `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` → **PASS (70 bảng UP / 58 bảng DOWN)**
- `node tests/elearning_full_test_suite.mjs` → **30 / 30 PASS**
- `node tests/teaching_test_suite.mjs` → **47 / 47 PASS**
- `node tests/lesson_studio_test_suite.mjs` → **10 / 10 PASS**
