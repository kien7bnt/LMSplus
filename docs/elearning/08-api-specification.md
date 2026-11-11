# 08. ĐẶC TẢ GIAO TIẾP API (RESTFUL API SPECIFICATION)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Base Path:** `/api/v1/elearning`
> **Authentication:** `Bearer <LMSPLUS_JWT_ACCESS_TOKEN>`
> **Tài liệu liên quan:** [`06-database-design.md`](./06-database-design.md), [`09-permission-matrix.md`](./09-permission-matrix.md)

---

## 1. Chuẩn Giao tiếp Chung (API Standards & Envelope)

### 1.1. Định dạng Phản hồi Chuẩn (Standard Response Envelope)

```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "page_size": 20,
    "total_items": 142,
    "request_id": "req_01J9Z9F8G2H4J6K8L0"
  }
}
```

### 1.2. Định dạng Lỗi Chuẩn (Standard Error Response)

```json
{
  "success": false,
  "error": {
    "code": "LESSON_LOCKED_PREREQUISITE_NOT_MET",
    "message": "Bạn cần hoàn thành Bài 3.1 và đạt tối thiểu 80% bài kiểm tra nhanh trước khi mở bài học này.",
    "details": {
      "required_lesson_id": "les_301",
      "missing_conditions": ["VIDEO_WATCH_THRESHOLD", "QUICK_CHECK_SCORE"]
    }
  }
}
```

| HTTP Status | Mã lỗi chuẩn (`error.code`) | Ý nghĩa xử lý |
| :---: | :--- | :--- |
| `400` | `VALIDATION_ERROR` | Dữ liệu đầu vào hoặc `schema_version` của Block JSON không hợp lệ. |
| `401` | `UNAUTHENTICATED` | JWT hết hạn hoặc không hợp lệ (Frontend tự động gọi Refresh Token của LMSPLUS). |
| `403` | `INSUFFICIENT_SCOPE_PERMISSION` | Người dùng có Role hợp lệ nhưng không thuộc phạm vi Lớp môn học (`subject_class_id`) hoặc Trợ giảng chưa được cấp cờ quyền tương ứng. |
| `409` | `REVISION_CONFLICT` | Xung đột phiên bản khi lưu nháp Block Editor (`base_revision_number` nhỏ hơn `working_draft_revision` trong DB) hoặc trùng `idempotency_key`. |
| `422` | `BUSINESS_RULE_VIOLATION` | Vi phạm quy tắc nghiệp vụ (VD: Đã hết số lần nộp bài tập, mã QR điểm danh đã hết hạn xoay vòng 20s, trả lời diễn đàn vượt quá 2 cấp lồng nhau). |

---

## 2. Danh mục Endpoint theo Phân hệ Nghiệp vụ

### 2.1. Learning Portal & Tiến độ Học tập (`Student Learning & Progress APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `GET` | `/student/dashboard-summary` | Lấy toàn bộ dữ liệu Trang chủ học viên: Bài học gần nhất (`resume_lesson`), Lớp đang học, Lịch học hôm nay, Bài tập sắp đến hạn, Thông báo mới. | `STUDENT` |
| `GET` | `/catalog/courses` | Tìm kiếm & lọc khóa học theo mô hình kết hợp (`ASSIGNED_ONLY` mặc định chỉ hiện khi đã phân quyền; `REQUEST_APPROVAL` cho phép gửi yêu cầu; `SELF_ENROLL` chỉ mở khi Admin cấu hình). | `Authenticated` |
| `POST` | `/catalog/courses/:courseId/enrollment-requests` | Học viên gửi yêu cầu tham gia đối với khóa học có `enrollment_policy = REQUEST_APPROVAL`. | `STUDENT` |
| `POST` | `/enrollment-requests/:requestId/review` | Giáo vụ / Quản trị viên phê duyệt hoặc từ chối yêu cầu tham gia khóa học của học viên. | `ACADEMIC_STAFF`, `ADMIN` |
| `PATCH` | `/courses/:courseId/enrollment-policy` | Cấu hình phương thức tham gia (`ASSIGNED_ONLY`, `REQUEST_APPROVAL`, `SELF_ENROLL`). Chỉ `ADMIN` mới được phép bật `SELF_ENROLL`. | `ADMIN`, `ACADEMIC_STAFF` (trừ `SELF_ENROLL`) |
| `GET` | `/course-classes/:courseClassId/overview` | Xem tổng quan Lớp khóa học (Cohort), tiến độ toàn khóa và danh sách các Lớp môn học thành phần. | `EnrolledStudent` hoặc `ClassStaff` |
| `GET` | `/subject-classes/:subjectClassId/workspace` | Xem chi tiết Lớp môn học: Cấu trúc chương bài, trạng thái mở khóa từng bài, lịch học, bài tập, kiểm tra. | `EnrolledStudent` hoặc `ClassStaff` |
| `GET` | `/subject-classes/:scId/lessons/:lessonId/player` | Tải dữ liệu Không gian học bài (`LP-05`): Kiểm tra điều kiện mở khóa, trả về snapshot `blocks_snapshot_json` của phiên bản đã xuất bản, URL phát video HLS có chữ ký bảo mật (`Signed URL`), danh sách thuật ngữ Wiki trong bài và vị trí đang học dở. | `EnrolledStudent` + `LessonUnlockCheck` |
| `POST` | `/progress/heartbeat` | Ghi nhận sự kiện học tập theo cơ chế bất biến chống trùng (`idempotency_key`): vị trí giây video, các đoạn thời gian đã xem, vị trí block đang đọc, trả lời câu hỏi Quick Check. | `EnrolledStudent` |
| `POST` | `/subject-classes/:scId/lessons/:lessonId/complete` | Yêu cầu đánh dấu hoàn thành bài học (kiểm tra đối chiếu với bảng `completion_rules`). | `EnrolledStudent` |

#### Chi tiết Request & Response của `POST /api/v1/elearning/progress/heartbeat`

- **Request Body:**
```json
{
  "idempotency_key": "hb_stu901_les302_1731214800",
  "subject_class_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "lesson_id": "3f39a112-8b12-4c90-a512-918273645001",
  "event_type": "VIDEO_HEARTBEAT",
  "last_video_position_sec": 760,
  "watched_segment": [745, 760],
  "last_read_block_id": "blk_01J9Z8K4M2N6P8Q0R2S4T6V8W0"
}
```
- **Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "lesson_status": "IN_PROGRESS",
    "lesson_progress_pct": 68.5,
    "chapter_progress_pct": 52.0,
    "subject_class_progress_pct": 44.2,
    "newly_unlocked_lesson_ids": []
  }
}
```

---

### 2.2. Cấu trúc Chương trình & Notion-Style Block Editor (`Curriculum & Authoring APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `GET` | `/subjects/:subjectId/curriculum-tree` | Lấy toàn bộ cây chương trình `Topic → Chapter → Lesson` kèm điều kiện tiên quyết và trạng thái xuất bản. | `INSTRUCTOR`, `TA`, `ACADEMIC_STAFF` |
| `POST` | `/subjects/:subjectId/topics` | Tạo mới hoặc sắp xếp thứ tự Chủ đề (`Topic`). | `SubjectAuthor` |
| `POST` | `/topics/:topicId/chapters` | Tạo mới hoặc sắp xếp thứ tự Chương học (`Chapter`). | `SubjectAuthor` |
| `POST` | `/chapters/:chapterId/lessons` | Tạo mới Bài học (`Lesson`) và thiết lập `CompletionRules`. | `SubjectAuthor` |
| `GET` | `/lessons/:lessonId/editor-state` | Lấy danh sách `lesson_blocks` của bản nháp hiện tại, `working_draft_revision`, và lịch sử `lesson_versions`. | `LessonAuthor` hoặc `TA (can_manage_materials)` |
| `PATCH` | `/lessons/:lessonId/draft-blocks` | **Autosave Block Editor:** Cập nhật mảng các block thay đổi/thêm/xóa/kéo thả kèm `base_revision_number` để kiểm tra Optimistic Concurrency. | `LessonAuthor` hoặc `TA (can_manage_materials)` |
| `POST` | `/lessons/:lessonId/publish` | **Xuất bản bài giảng:** Đóng gói toàn bộ block hiện tại thành bản ghi bất biến trong `lesson_versions`, cập nhật `published_version_id` và tự động đồng bộ `lesson_term_links` (Wiki). | `INSTRUCTOR` (Chủ biên/Phụ trách môn) |
| `POST` | `/lessons/:lessonId/versions/:versionId/restore` | Khôi phục một phiên bản cũ trong lịch sử thành bản nháp hiện tại. | `INSTRUCTOR` |
| `POST` | `/lessons/:lessonId/code-sandbox/execute` | Chạy thử đoạn mã của khối `code_block` trong môi trường cô lập có giới hạn CPU/Memory/Time. | `Authenticated` (Rate limited: 10 req/phút) |

---

### 2.3. Hệ thống Wiki Thuật ngữ (`Wiki APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `GET` | `/wiki/terms` | Tìm kiếm thuật ngữ theo từ khóa, tên đồng nghĩa (`WikiAliases`), môn học (`subject_id`) và chữ cái. | `Authenticated` |
| `GET` | `/wiki/terms/:termId/popover` | API siêu nhẹ (được cache trên Redis) trả về định nghĩa tóm tắt để hiển thị Popover ngay khi học viên di chuột/bấm vào thuật ngữ trong bài giảng. | `Authenticated` |
| `POST` | `/wiki/terms` | Tạo mới thuật ngữ kèm danh sách tên đồng nghĩa và quan hệ thuật ngữ (`WikiRelations`). | `INSTRUCTOR`, `TA (can_manage_materials)` |
| `POST` | `/wiki/terms/:termId/approve` | Phê duyệt thuật ngữ từ `DRAFT / PENDING_REVIEW` sang `PUBLISHED`. | `INSTRUCTOR`, `ACADEMIC_STAFF` |

---

### 2.4. Bài tập, Chấm bài & Kiểm tra (`Assignments & Assessments APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `POST` | `/subject-classes/:scId/assignments` | Tạo bài tập gắn chương trình (`lesson_id` / `chapter_id`) hoặc ngoài chương trình; liên kết trực tiếp với bảng `assignments` của LMSPLUS. | `INSTRUCTOR`, `TA (can_manage_assignments)` |
| `POST` | `/assignments/:assignmentId/submissions` | Học viên nộp bài tập (kiểm tra thời hạn, chính sách nộp muộn và số lần nộp tối đa `max_attempts`). | `EnrolledStudent` |
| `GET` | `/assignments/:assignmentId/submissions` | Danh sách bài nộp của cả lớp phục vụ giao diện chấm bài tập trung (`SpeedGrader`). | `INSTRUCTOR`, `TA (can_grade)` |
| `POST` | `/submissions/:submissionId/grade` | Chấm điểm, viết nhận xét, trả bài (`GRADED` hoặc `RETURNED_FOR_REVISION`) và **đồng bộ điểm trong cùng một Transaction** sang bảng `grades` của LMSPLUS. | `INSTRUCTOR`, `TA (can_grade)` |

---

### 2.5. Diễn đàn Học thuật (`Academic Forum APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `GET` | `/forums/:forumId/topics` | Lấy danh sách chủ đề thảo luận (lọc theo bài học, loại chủ đề, trạng thái đã giải quyết). | `ForumScopeMember` |
| `POST` | `/forums/:forumId/topics` | Tạo chủ đề mới (`QA`, `DISCUSSION`, `GRADED_DISCUSSION`, `ANNOUNCEMENT`), tự động trích xuất `@mention` để đẩy thông báo. | `ForumScopeMember` |
| `POST` | `/topics/:topicId/replies` | Gửi phản hồi (kiểm tra `depth_level <= 2`). | `ForumScopeMember` |
| `POST` | `/topics/:topicId/moderate` | Thực hiện hành động kiểm duyệt (`PIN`, `LOCK`, `HIDE`, `ENDORSE`) và ghi bắt buộc vào `forum_moderation_logs`. | `INSTRUCTOR`, `TA (can_moderate_forum)` |

---

### 2.6. Điểm danh, Đơn xin nghỉ & Nhật ký Giảng dạy (`Attendance & Teaching Log APIs`)

| Method | Endpoint | Mô tả nghiệp vụ | Auth & Scope Guard |
| :---: | :--- | :--- | :--- |
| `POST` | `/sessions/:sessionId/attendance/qr-start` | Giảng viên/Trợ giảng khởi tạo phiên chiếu mã QR động xoay vòng mỗi 20 giây. | `INSTRUCTOR`, `TA (can_take_attendance)` |
| `POST` | `/sessions/:sessionId/attendance/qr-checkin` | Học viên gửi mã token quét từ QR để điểm danh tự động (`PRESENT` hoặc `LATE`). | `EnrolledStudent` |
| `PATCH` | `/sessions/:sessionId/attendance/manual` | Giảng viên cập nhật điểm danh thủ công kèm `change_reason` (lưu vào `attendance_audit_logs`). | `INSTRUCTOR`, `TA (can_take_attendance)` |
| `POST` | `/sessions/:sessionId/leave-requests` | Học viên gửi đơn xin nghỉ phép kèm tệp minh chứng (`AttendanceEvidence`). | `EnrolledStudent` |
| `POST` | `/leave-requests/:requestId/review` | Duyệt/Từ chối đơn xin nghỉ, tự động cập nhật trạng thái `EXCUSED_ABSENCE` và gán lịch học bù (`MakeUpSessions`) nếu có. | `INSTRUCTOR`, `ACADEMIC_STAFF` |
| `PUT` | `/sessions/:sessionId/teaching-log` | Lưu nháp hoặc cập nhật Nhật ký giảng dạy: giờ thực tế, giảng viên thực tế/dạy thay, trợ giảng, trạng thái từng bài dạy (`COMPLETED`, `PARTIAL`, `DEFERRED`). | `INSTRUCTOR`, `TA` |
| `POST` | `/sessions/:sessionId/teaching-log/confirm` | **Giảng viên ký xác nhận hoàn thành buổi dạy:** Trong vòng 24h sau khi kết thúc buổi học → chuyển sang `CONFIRMED`. Sau 24h (khi đang ở `OVERDUE_UNCONFIRMED`) vẫn cho phép xác nhận muộn → chuyển sang `CONFIRMED_LATE`, lưu `confirmed_at` thực tế và ghi vào `teaching_log_history`. | `INSTRUCTOR` (Giảng viên thực tế dạy), `ACADEMIC_STAFF`, `ADMIN` |
| `POST` | `/sessions/:sessionId/teaching-log/remind` | Giáo vụ hoặc Quản trị viên gửi thông báo nhắc nhở đối với các buổi học đang ở trạng thái `OVERDUE_UNCONFIRMED` (quá 24h chưa xác nhận). | `ACADEMIC_STAFF`, `ADMIN` |
