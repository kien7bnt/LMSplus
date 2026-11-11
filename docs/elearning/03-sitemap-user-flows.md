# 03. KIẾN TRÚC THÔNG TIN, SITEMAP & LUỒNG NGƯỜI DÙNG (SITEMAP & USER FLOWS)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`02-product-requirements.md`](./02-product-requirements.md), [`05-ui-ux-specification.md`](./05-ui-ux-specification.md)

---

## 1. Sơ đồ Kiến trúc Thông tin Tổng thể (Master Sitemap)

Hệ thống định tuyến (React Router) được tổ chức thành 3 phân khu không gian làm việc rõ ràng, tích hợp vào App Shell của LMSPLUS:

- `/learn/*` — **Learning Portal** (Không gian Học viên)
- `/teach/*` — **Teaching Workspace** (Không gian Giảng viên & Trợ giảng theo quyền được cấp)
- `/academic-ops/*` — **Academic Affairs Workspace** (Không gian Giáo vụ giám sát & hỗ trợ đào tạo)

```mermaid
flowchart TD
    Root["LMSPLUS E-Learning Root"] --> LP["A. Learning Portal (/learn)"]
    Root --> TW["B. Teaching Workspace (/teach)"]
    Root --> AO["C. Giáo vụ & Trợ giảng (/academic-ops & Scoped /teach)"]

    subgraph LP_Nodes["Learning Portal (12 Màn hình Học viên)"]
        LP01["1. Trang chủ học tập (/learn/dashboard)"]
        LP02["2. Khám phá khóa học (/learn/explore)"]
        LP03["3. Khóa học của tôi (/learn/my-courses)"]
        LP04["4. Chi tiết khóa học & Lớp môn học (/learn/courses/:courseId & /learn/classes/:subjectClassId)"]
        LP05["5. Không gian học bài (/learn/classes/:subjectClassId/lessons/:lessonId)"]
        LP06["6. Wiki thuật ngữ (/learn/wiki)"]
        LP07["7. Diễn đàn học tập (/learn/forums & /learn/classes/:subjectClassId/forum)"]
        LP08["8. Bài tập (/learn/assignments)"]
        LP09["9. Kiểm tra (/learn/assessments)"]
        LP10["10. Tiến độ học tập (/learn/progress)"]
        LP11["11. Lịch học & Điểm danh (/learn/schedule)"]
        LP12["12. Thông báo (/learn/notifications)"]
    end

    subgraph TW_Nodes["Teaching Workspace (16 Màn hình Giảng viên)"]
        TW01["1. Dashboard giảng dạy (/teach/dashboard)"]
        TW02["2. Quản lý khóa học (/teach/courses)"]
        TW03["3. Quản lý lớp môn học (/teach/subject-classes/:subjectClassId)"]
        TW04["4. Quản lý cấu trúc chương trình (/teach/subjects/:subjectId/curriculum)"]
        TW05["5. Trình soạn bài giảng Block Editor (/teach/lessons/:lessonId/editor)"]
        TW06["6. Quản lý học liệu & Shared Blocks (/teach/resources)"]
        TW07["7. Quản lý Wiki thuật ngữ (/teach/wiki)"]
        TW08["8. Giao bài tập (/teach/assignments)"]
        TW09["9. Chấm bài SpeedGrader (/teach/grading/:assignmentId)"]
        TW10["10. Quản lý kiểm tra (/teach/assessments)"]
        TW11["11. Diễn đàn môn học & Kiểm duyệt (/teach/forums)"]
        TW12["12. Điểm danh & QR Động (/teach/sessions/:sessionId/attendance)"]
        TW13["13. Quản lý đơn xin nghỉ & Học bù (/teach/leave-requests)"]
        TW14["14. Nhật ký giảng dạy (/teach/sessions/:sessionId/teaching-log)"]
        TW15["15. Xác nhận buổi dạy (/teach/session-confirmations)"]
        TW16["16. Theo dõi tiến độ học viên (/teach/subject-classes/:subjectClassId/analytics)"]
    end

    LP --> LP_Nodes
    TW --> TW_Nodes
```

---

## 2. Bảng Định tuyến Chi tiết (React Route Specification)

| Phân khu | Mã màn | Tên màn hình | Đường dẫn React Router (`path`) | Layout sử dụng | Quyền truy cập (`Scope Guard`) |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Learning** | LP-01 | Trang chủ học tập | `/learn/dashboard` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-02 | Khám phá khóa học | `/learn/explore` | `PortalAppShell` | `STUDENT` (Lọc theo `enrollment_policy`) |
| **Learning** | LP-03 | Khóa học của tôi | `/learn/my-courses` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-04A | Chi tiết Lớp khóa học | `/learn/course-classes/:courseClassId` | `PortalAppShell` | `EnrolledStudentGuard` |
| **Learning** | LP-04B | Chi tiết Lớp môn học | `/learn/subject-classes/:subjectClassId` | `PortalAppShell` | `EnrolledStudentGuard` |
| **Learning** | LP-05 | **Không gian học bài** | `/learn/subject-classes/:subjectClassId/lessons/:lessonId` | `FocusPlayerLayout` | `EnrolledStudentGuard` + `LessonUnlockGuard` |
| **Learning** | LP-06 | Wiki thuật ngữ | `/learn/wiki` | `PortalAppShell` | `STUDENT`, `INSTRUCTOR`, `TA` |
| **Learning** | LP-07 | Diễn đàn học tập | `/learn/forums/:forumId` | `PortalAppShell` | `ForumScopeGuard` |
| **Learning** | LP-08 | Bài tập của tôi | `/learn/assignments` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-09 | Bài kiểm tra | `/learn/assessments` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-10 | Tiến độ học tập | `/learn/progress` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-11 | Lịch học & Xin nghỉ | `/learn/schedule` | `PortalAppShell` | `STUDENT` |
| **Learning** | LP-12 | Thông báo | `/learn/notifications` | `PortalAppShell` | `AuthenticatedGuard` |
| **Teaching** | TW-01 | Dashboard giảng dạy | `/teach/dashboard` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA`, `ACADEMIC_STAFF` |
| **Teaching** | TW-02 | Quản lý khóa học | `/teach/courses` | `WorkspaceAppShell` | `INSTRUCTOR`, `ACADEMIC_STAFF`, `ADMIN` |
| **Teaching** | TW-03 | Quản lý lớp môn học | `/teach/subject-classes/:subjectClassId` | `WorkspaceAppShell` | `AssignedClassStaffGuard` |
| **Teaching** | TW-04 | Cấu trúc chương trình | `/teach/subjects/:subjectId/curriculum` | `WorkspaceAppShell` | `SubjectAuthorGuard` |
| **Teaching** | TW-05 | **Trình soạn bài giảng** | `/teach/lessons/:lessonId/editor` | `EditorFullLayout` | `LessonAuthorGuard` |
| **Teaching** | TW-06 | Quản lý học liệu | `/teach/resources` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (can_manage_materials)` |
| **Teaching** | TW-07 | Quản lý Wiki | `/teach/wiki` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (can_manage_materials)` |
| **Teaching** | TW-08 | Giao bài tập | `/teach/assignments` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (can_manage_assignments)` |
| **Teaching** | TW-09 | Chấm bài tập | `/teach/assignments/:assignmentId/grading` | `GraderSplitLayout` | `INSTRUCTOR`, `TA (can_grade)` |
| **Teaching** | TW-10 | Quản lý kiểm tra | `/teach/assessments` | `WorkspaceAppShell` | `INSTRUCTOR`, `ACADEMIC_STAFF` |
| **Teaching** | TW-11 | Diễn đàn môn học | `/teach/forums` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (can_moderate_forum)` |
| **Teaching** | TW-12 | Điểm danh lớp học | `/teach/sessions/:sessionId/attendance` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (can_take_attendance)` |
| **Teaching** | TW-13 | Quản lý đơn xin nghỉ | `/teach/leave-requests` | `WorkspaceAppShell` | `INSTRUCTOR`, `ACADEMIC_STAFF`, `TA` |
| **Teaching** | TW-14 | Nhật ký giảng dạy | `/teach/sessions/:sessionId/teaching-log` | `WorkspaceAppShell` | `INSTRUCTOR`, `TA (view/draft)` |
| **Teaching** | TW-15 | Xác nhận buổi dạy | `/teach/session-confirmations` | `WorkspaceAppShell` | `INSTRUCTOR` (Ký xác nhận), `ACADEMIC_STAFF` (Giám sát) |
| **Teaching** | TW-16 | Tiến độ học viên | `/teach/subject-classes/:subjectClassId/progress` | `WorkspaceAppShell` | `AssignedClassStaffGuard` |

---

## 3. Các Luồng Người Dùng Trọng Tâm (Core End-to-End User Flows)

### 3.1. Luồng 1: Học viên "Tiếp tục học" & Ghi nhận Tiến độ Bài học (`Resume & Unlock Flow`)

```mermaid
sequenceDiagram
    actor S as Học viên
    participant UI as Learning Portal (React)
    participant API as E-Learning API (Python)
    participant R as Redis Cache
    participant DB as PostgreSQL

    S->>UI: Truy cập Trang chủ học tập (/learn/dashboard)
    UI->>API: GET /api/v1/elearning/student/resume-state
    API->>R: Đọc vị trí học gần nhất (user_id)
    alt Cache Miss
        API->>DB: SELECT từ lesson_progress ORDER BY last_accessed_at DESC LIMIT 1
    end
    API-->>UI: Trả về {subject_class_id, lesson_id, last_video_sec, last_block_id, progress_pct}
    S->>UI: Nhấn nút "Tiếp tục học" (CTA nổi bật)
    UI->>API: GET /api/v1/elearning/classes/{scId}/lessons/{lessonId}
    API->>DB: Kiểm tra Enrolment + LessonUnlockConditions
    API-->>UI: Trả về Lesson JSON Blocks + Signed Video URL + Trạng thái hoàn thành
    UI->>UI: Tự động seek video tới last_video_sec / cuộn tới last_block_id

    loop Mỗi 15 giây khi xem video hoặc đọc bài
        UI->>API: POST /api/v1/elearning/progress/heartbeat (idempotency_key)
        API->>R: Lưu buffer tiến độ & chống trùng sự kiện
        API->>DB: UPSERT lesson_progress & INSERT learning_events (khi qua mốc mới)
    end

    alt Đạt tiêu chí CompletionRules (VD: >= 85% video + Đúng Quick Check)
        API->>DB: TRANSACTION: Đánh dấu Lesson COMPLETED -> Cập nhật CourseProgress -> Mở khóa Lesson kế tiếp
        API-->>UI: Trả về sự kiện LESSON_COMPLETED & UNLOCKED_NEXT_LESSON
    end
```

---

### 3.2. Luồng 2: Giảng viên Soạn bài giảng với Notion-Style Block Editor (`Draft → Autosave → Publish`)

```mermaid
flowchart TD
    A["Giảng viên mở bài học trong Trình soạn thảo (/teach/lessons/:id/editor)"] --> B{"Đã có bản nháp (WORKING_DRAFT)?"}
    B -- "Chưa có" --> C["Khởi tạo bản nháp mới từ phiên bản PUBLISHED hiện hành"]
    B -- "Đã có" --> D["Tải danh sách LessonBlocks của bản nháp + version_etag"]
    C --> D

    D --> E["Giảng viên kéo thả, thêm/sửa/xóa Block (Text, Callout, LaTeX, Quiz, Video, Code)"]
    E --> F["Lưu cục bộ vào IndexedDB (Chống mất dữ liệu khi F5/rớt mạng)"]
    F --> G["Debounce 2000ms -> Gọi PATCH /lessons/:id/draft-blocks kèm base_revision_number"]

    G --> H{"Kiểm tra xung đột phiên bản (Optimistic Concurrency)?"}
    H -- "Khớp base_revision_number" --> I["Lưu JSONB (schema_version: 1.0) vào DB & tăng revision_number"]
    H -- "Lệch phiên bản (Có tab/người khác vừa sửa)" --> J["Hiển thị Modal So sánh Xung đột (Giữ bản của tôi / Hợp nhất / Tải lại bản mới)"]

    I --> K["Giảng viên bật chế độ Preview để kiểm tra giao diện Học viên"]
    K --> L["Giảng viên nhấn 'Xuất bản bài giảng' (Publish)"]
    L --> M["TRANSACTION: Tạo bản ghi bất biến trong lesson_versions -> Cập nhật published_version_id -> Ghi Audit Log"]
```

---

### 3.3. Luồng 3: Điểm danh Đa phương thức, Đơn xin nghỉ & Học bù (`Attendance & Leave Flow`)

```mermaid
flowchart TD
    Start["Trước hoặc trong Buổi học (ClassSession)"] --> Branch{"Tình huống của Học viên"}

    Branch -- "Tham gia trực tiếp tại lớp" --> QR1["Giảng viên bật màn chiếu QR Điểm danh động"]
    QR1 --> QR2["Hệ thống sinh mã QR chứa HMAC Token đổi mới mỗi 20 giây"]
    QR2 --> QR3["Học viên quét QR trên điện thoại -> Gửi POST /attendance/qr-checkin"]
    QR3 --> QR4{"Token hợp lệ & trong khung giờ?"}
    QR4 -- "Hợp lệ, đúng giờ" --> Present["Ghi nhận trạng thái: PRESENT (Có mặt)"]
    QR4 -- "Hợp lệ, sau giờ bắt đầu > 15p" --> Late["Ghi nhận trạng thái: LATE (Đi muộn)"]

    Branch -- "Học trực tuyến qua Zoom / Google Meet" --> ZM1["Webhook / Cron đồng bộ log join/leave từ Zoom/Meet"]
    ZM1 --> ZM2["Tính tổng phút hiện diện so với cấu hình tối thiểu"]
    ZM2 --> Present

    Branch -- "Xin nghỉ học có lý do" --> LR1["Học viên gửi Đơn xin nghỉ (LeaveRequest) + File minh chứng"]
    LR1 --> LR2["Giảng viên / Giáo vụ xem xét & phê duyệt"]
    LR2 -- "Được duyệt" --> Excused["Cập nhật điểm danh: EXCUSED_ABSENCE (Vắng có phép)"]
    Excused --> MakeUp["Giáo vụ/Giảng viên gắn học viên vào Buổi học bù (MakeUpSession)"]
    MakeUp --> MakeUpDone["Sau khi tham gia buổi bù -> Cập nhật trạng thái: MAKEUP_COMPLETED (Học bù)"]
    LR2 -- "Từ chối / Không nộp đơn" --> Unexcused["Cập nhật điểm danh: UNEXCUSED_ABSENCE (Vắng không phép)"]
```

---

### 3.4. Luồng 4: Nhật ký Giảng dạy & Xác nhận Buổi dạy (`Teaching Log & Confirmation Flow`)

> **Nguyên tắc nghiệp vụ quan trọng:** Tình trạng điểm danh của học viên (`AttendanceRecords`) và việc ghi nhận giờ dạy thực tế của giảng viên (`TeachingLogs`) là **hai luồng dữ liệu độc lập** nhưng cùng gắn với một `ClassSession`.

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED: Lịch học được khởi tạo từ Thời khóa biểu
    SCHEDULED --> IN_PROGRESS: Đến giờ bắt đầu buổi dạy / Giảng viên mở lớp
    IN_PROGRESS --> AWAITING_CONFIRMATION: Kết thúc khung giờ buổi học

    AWAITING_CONFIRMATION --> CONFIRMED: Giảng viên điền Nhật ký giảng dạy (Giờ thực tế, Bài đã dạy xong/dạy một phần, Ghi chú) & Ký xác nhận
    AWAITING_CONFIRMATION --> OVERDUE_UNCONFIRMED: Quá 24h sau khi kết thúc buổi học mà Giảng viên chưa xác nhận

    OVERDUE_UNCONFIRMED --> CONFIRMED: Giảng viên bổ sung Nhật ký & Xác nhận muộn (Ghi nhận lý do vào TeachingLogHistory)
    SCHEDULED --> CANCELLED_MAKEUP_REQUIRED: Báo nghỉ / Hoãn buổi dạy -> Sinh yêu cầu xếp buổi dạy bù
```
