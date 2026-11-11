# 11. QUYẾT ĐỊNH KIẾN TRÚC KỸ THUẬT (ARCHITECTURE DECISION RECORDS — ADRs)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`05-ui-ux-specification.md`](./05-ui-ux-specification.md), [`06-database-design.md`](./06-database-design.md), [`08-api-specification.md`](./08-api-specification.md)

---

## ADR-01: Sử dụng Tiptap/ProseMirror với Định dạng JSON có `schema_version` cho Block Editor thay vì Lưu HTML Thuần

- **Bối cảnh:** Trình soạn bài giảng (`TW-05`) yêu cầu hỗ trợ kéo-thả từng khối nội dung (Văn bản, Callout sư phạm, Công thức LaTeX, Ví dụ giải từng bước, Quiz tương tác chấm điểm ngay, Nhúng thuật ngữ Wiki theo `term_id`, và Code Sandbox).
- **Quyết định:**
  1. Trên Frontend (React + TypeScript): Sử dụng **Tiptap (xây trên nền ProseMirror)** với các Custom Node Extensions cho từng loại Block học thuật.
  2. Trên Database (PostgreSQL): Lưu trữ mỗi block trong bảng `lesson_blocks` (và snapshot trong `lesson_versions`) dưới dạng cột `JSONB` kèm trường bắt buộc `schema_version` (hiện tại là `"1.0"`).
- **Lý do Kỹ thuật & Nghiệp vụ:**
  - Nếu lưu HTML thuần, việc nhúng câu hỏi trắc nghiệm tương tác (`inline_mcq`), lời giải từng bước (`step_by_step_solution`), hay liên kết động tới `term_id` của Wiki sẽ dễ bị lỗi XSS, khó nâng cấp giao diện (ví dụ khi đổi sang chế độ `cinema-dark` hoặc ứng dụng Mobile App sau này).
  - Định dạng JSON có `schema_version` cho phép viết hàm nâng cấp cấu trúc dữ liệu (Schema Upcaster) khi phát triển thêm tính năng mới mà không làm hỏng các bài giảng cũ.

---

## ADR-02: Tách biệt Khung Chương trình Chuẩn (`Master Curriculum`) và Phiên bản Xuất bản (`LessonVersions`) khỏi Lớp Triển khai (`SubjectClass`)

- **Bối cảnh:** Trong một trường học hoặc trung tâm đào tạo sử dụng LMSPLUS, một môn học (ví dụ: *Lập trình Python*) có thể được mở thành 15 lớp môn học (`SubjectClass`) khác nhau trong cùng một học kỳ và lặp lại qua nhiều năm. Đồng thời, khi giảng viên đang chỉnh sửa bài giảng cho học kỳ tới, học viên đang học học kỳ hiện tại không được nhìn thấy nội dung đang sửa dở.
- **Quyết định:**
  1. Cây `Topic → Chapter → Lesson → LessonBlocks` thuộc về cấp Môn học (`Subject`), đóng vai trò là bản thiết kế gốc.
  2. Khi Giảng viên nhấn **Xuất bản (`Publish`)**, hệ thống đóng băng toàn bộ danh sách block thành một bản ghi bất biến (`Immutable Snapshot`) trong bảng `lesson_versions` và trỏ `lessons.published_version_id` vào đó.
  3. Tiến độ học tập (`lesson_progress`), lịch dạy bài học (`lesson_sessions`), điểm danh (`attendance_records`) và nhật ký giảng dạy (`teaching_logs`) luôn gắn với `subject_class_id`.
- **Lý do Kỹ thuật & Nghiệp vụ:**
  - Tránh nhân bản hàng vạn dòng `lesson_blocks` mỗi khi mở lớp mới.
  - Đảm bảo tính toàn vẹn lịch sử học tập và cho phép giảng viên thoải mái soạn bản nháp mới (`WORKING_DRAFT`) mà không gây gián đoạn việc học của học viên.

---

## ADR-03: Cơ chế Ghi nhận Tiến độ Xem Video Bất biến (Idempotent Heartbeat) kết hợp Redis Buffer

- **Bối cảnh:** Màn hình Không gian học bài (`LP-05`) cần lưu chính xác vị trí giây video, các đoạn video học viên đã thực sự xem (chống tua nhanh qua bài) và vị trí đọc bài, đồng thời phải tránh tính trùng sự kiện khi mạng di động của học viên bị chập chờn và gửi lặp request.
- **Quyết định:**
  1. Mỗi gói tin heartbeat từ trình duyệt đều mang một khóa `idempotency_key = sha256(student_id + lesson_id + session_nonce + bucket_timestamp_15s)`.
  2. Tầng API Python kiểm tra nhanh `SETNX` trên Redis và gộp các khoảng thời gian đã xem (`watched_segments_json`, ví dụ `[[0, 120], [120, 180]]` → `[[0, 180]]`).
  3. Chỉ ghi xuống PostgreSQL (`lesson_progress` và `learning_events`) khi chuyển trạng thái hoàn thành, khi học viên đóng/tạm dừng bài học, hoặc định kỳ mỗi 60 giây.
- **Lý do Kỹ thuật:**
  - Giảm hơn 75% tải ghi (`WRITE IOPS`) lên PostgreSQL trên VPS Ubuntu khi có nhiều lớp học trực tuyến cùng giờ cao điểm.
  - Đảm bảo tính chính xác tuyệt đối của tiêu chí hoàn thành bài học (`CompletionRules`).

---

## ADR-04: Điểm danh bằng Mã QR Động Xoay vòng theo Chu kỳ (TOTP/HMAC Rotating QR)

- **Bối cảnh:** Nếu dùng mã QR tĩnh cho một buổi học, học viên có mặt tại lớp có thể chụp ảnh màn hình mã QR gửi qua nhóm chat cho học viên ở nhà quét điểm danh hộ.
- **Quyết định:**
  - Khi Giảng viên bật chế độ chiếu QR (`attendance_qr_sessions`), hệ thống sinh một `secret_seed` ngẫu nhiên cho buổi học đó.
  - Cứ mỗi `20 giây` (`rotation_interval_sec = 20`), giao diện chiếu QR tự động sinh mã mới chứa chữ ký `HMAC-SHA256(secret_seed, class_session_id, time_window_index)`.
  - Backend chỉ chấp nhận token thuộc cửa sổ thời gian hiện tại hoặc cửa sổ liền trước (`±1 window` để bù độ trễ mạng).
- **Lý do Kỹ thuật & Nghiệp vụ:**
  - Vô hiệu hóa hiệu quả hành vi chụp ảnh mã QR gửi từ xa mà không đòi hỏi thiết bị phần cứng đắt tiền.
  - Vẫn cho phép Giảng viên chỉnh sửa thủ công trong các trường hợp học viên hỏng camera điện thoại, nhưng bắt buộc ghi lý do vào `attendance_audit_logs`.

---

## ADR-05: Tách biệt Nhật ký Giảng dạy của Giảng viên (`TeachingLogs`) và Điểm danh Học viên (`AttendanceRecords`)

- **Bối cảnh:** Trong thực tế vận hành đào tạo, có những trường hợp:
  - Giảng viên chính có việc đột xuất và nhờ **Giảng viên dạy thay (`actual_instructor_id != scheduled_instructor_id`)**, hoặc buổi học có thêm **Trợ giảng** hỗ trợ.
  - Một buổi học theo kế hoạch dạy 2 bài (`Bài 3.1` và `Bài 3.2`), nhưng trên lớp giảng viên giải đáp câu hỏi sâu nên mới dạy xong `Bài 3.1` (`COMPLETED`) và chỉ dạy được một nửa `Bài 3.2` (`PARTIAL`).
  - Giảng viên điểm danh học viên đầu giờ nhưng quên chốt nhật ký giảng dạy cuối giờ.
- **Quyết định:**
  - Thiết kế thực thể `teaching_logs` và `teaching_log_lessons` hoàn toàn độc lập với `attendance_records`.
  - Bổ sung máy trạng thái `teaching_session_status` kèm tiến trình nền (Cron/Celery Worker chạy mỗi giờ) tự động chuyển các buổi học đã kết thúc quá 24 giờ mà chưa được giảng viên ký xác nhận sang trạng thái `OVERDUE_UNCONFIRMED` để cảnh báo trên Dashboard Giảng viên và Giáo vụ.

---

## ADR-06: Bảo mật Thông tin Xác thực Tích hợp Bên ngoài bằng Mã hóa Phong bì (Envelope Encryption AES-256-GCM)

- **Bối cảnh:** Hệ thống cần kết nối với Zoom API, Google Meet API, Object Storage (S3/MinIO) và dịch vụ Speech-to-Text. Yêu cầu bắt buộc là **không lưu API Key/Secret dưới dạng plaintext trong database**.
- **Quyết định:**
  - Trước khi lưu vào cột `encrypted_credentials_ciphertext` (`BYTEA`) của bảng `external_integration_configs`, ứng dụng Python sử dụng khóa `MASTER_ENCRYPTION_KEY` (nạp từ biến môi trường bảo mật trên Docker/VPS, không bao giờ commit vào Git) để mã hóa chuỗi JSON chứa secret bằng thuật toán **AES-256-GCM** (có `nonce` 96-bit và `auth_tag` chống giả mạo).
  - Lưu kèm `encryption_key_id` để hỗ trợ xoay vòng khóa bảo mật định kỳ (`Key Rotation`) mà không gây gián đoạn dịch vụ.
