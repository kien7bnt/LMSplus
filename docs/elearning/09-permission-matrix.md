# 09. MA TRẬN PHÂN QUYỀN & KIỂM SOÁT PHẠM VI (RBAC + SCOPE PERMISSION MATRIX)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`01-current-system-audit.md`](./01-current-system-audit.md), [`08-api-specification.md`](./08-api-specification.md)

---

## 1. Kiến trúc Phân quyền 2 Tầng (`Two-Layer Authorization Architecture`)

Để đáp ứng yêu cầu tại **Phần V**: *"Không chỉ kiểm tra role mà còn kiểm tra phạm vi truy cập của người dùng"*, mọi request tới phân hệ E-Learning đều phải đi qua 2 lớp kiểm tra liên tiếp:

1. **Tầng 1 — Role-Based Access Control (RBAC hiện có của LMSPLUS):**
   - Xác định vai trò gốc của người dùng từ JWT/Database:
     - `STUDENT` (Học viên)
     - `TEACHING_ASSISTANT` (Trợ giảng — TA)
     - `INSTRUCTOR` (Giảng viên)
     - `ACADEMIC_STAFF` (Giáo vụ)
     - `ADMIN` (Quản trị viên hệ thống)
2. **Tầng 2 — Scope & Object-Level Access Control (ABAC / Context Scope):**
   - Kiểm tra người dùng có mối quan hệ hợp lệ với đối tượng đang truy cập hay không:
     - **Học viên (`STUDENT`):** Phải có bản ghi ghi danh đang hoạt động (`ACTIVE`) trong `course_class_id` hoặc `subject_class_id`, đồng thời bài học phải thỏa mãn `lesson_unlock_conditions`.
     - **Giảng viên (`INSTRUCTOR`):** Phải được phân công làm Chủ nhiệm môn (`subject_author`) hoặc Giảng viên đứng lớp/dạy thay trong `teaching_staff_assignments` của `subject_class_id`.
     - **Trợ giảng (`TEACHING_ASSISTANT`):** Phải được gán vào `subject_class_id` trong bảng `teaching_staff_assignments` **VÀ** có cờ quyền chi tiết (`permissions_json`) bật `true` cho nghiệp vụ tương ứng.
     - **Giáo vụ (`ACADEMIC_STAFF`):** Chỉ quản lý và hỗ trợ các Khóa học / Lớp học thuộc Khoa, Viện hoặc Trung tâm (`department_id` / `program_id`) được phân giao.

---

## 2. Ma trận Phân quyền Chi tiết theo Nghiệp vụ

Ký hiệu trong bảng:
- `✅ Toàn quyền (Trong phạm vi được giao)`
- `🔒 Có điều kiện / Giới hạn theo cờ quyền (Flag-Scoped)`
- `👁️ Chỉ xem (Read-Only trong phạm vi)`
- `❌ Không có quyền`

| Nhóm Module | Hành động / Nghiệp vụ cụ thể | Học viên (`STUDENT`) | Trợ giảng (`TA`) | Giảng viên (`INSTRUCTOR`) | Giáo vụ (`ACADEMIC_STAFF`) | Quản trị viên (`ADMIN`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **1. Khóa học & Lớp học** | Xem danh sách khóa học (`ASSIGNED_ONLY` / `REQUEST_APPROVAL` / `SELF_ENROLL`) | ✅ (Theo `enrollment_policy` & phân lớp) | ✅ | ✅ | ✅ | ✅ |
| | Gửi yêu cầu tham gia khóa học (`REQUEST_APPROVAL`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| | Duyệt yêu cầu tham gia khóa học (`REQUEST_APPROVAL`) | ❌ | ❌ | 👁️ | ✅ (Khoa phụ trách) | ✅ |
| | Bật chế độ tự đăng ký (`SELF_ENROLL`) cho khóa học | ❌ | ❌ | ❌ | ❌ | ✅ (Chỉ Admin) |
| | Cấu hình thông tin Lớp môn học (`SubjectClass`) | ❌ | 👁️ | ✅ (Lớp phụ trách) | ✅ (Khoa phụ trách) | ✅ |
| | Phân công & Cấp cờ quyền chi tiết cho Trợ giảng | ❌ | ❌ | ✅ (Lớp phụ trách) | ✅ (Khoa phụ trách) | ✅ |
| **2. Chương trình & Bài giảng** | Tạo/Sửa cấu trúc `Topic → Chapter → Lesson` | ❌ | ❌ | ✅ (Giảng viên biên soạn) | 👁️ | ✅ |
| | Soạn thảo nội dung nháp trong Block Editor (`TW-05`) | ❌ | 🔒 (`can_manage_materials`) | ✅ | 👁️ | ✅ |
| | **Xuất bản bài giảng (`Publish LessonVersion`)** | ❌ | ❌ | ✅ | ❌ | ✅ |
| | Xem bài giảng đã xuất bản & Tải tài liệu cho phép | ✅ (Khi bài đã mở khóa) | ✅ | ✅ | ✅ | ✅ |
| **3. Wiki Thuật ngữ** | Tra cứu thuật ngữ đã duyệt (`PUBLISHED`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Đề xuất / Biên tập bản nháp thuật ngữ (`DRAFT`) | ❌ | 🔒 (`can_manage_materials`) | ✅ | 👁️ | ✅ |
| | Phê duyệt xuất bản thuật ngữ Wiki | ❌ | ❌ | ✅ | ✅ | ✅ |
| **4. Bài tập & Kiểm tra** | Tạo / Giao bài tập mới cho lớp môn học | ❌ | 🔒 (`can_manage_assignments`) | ✅ | 👁️ | ✅ |
| | Nộp bài tập / Làm bài kiểm tra trực tuyến | ✅ (Lớp đã ghi danh) | ❌ | ❌ (Có chế độ Xem thử) | ❌ | ❌ |
| | Chấm điểm, Nhận xét & Yêu cầu nộp lại bài tập | ❌ | 🔒 (`can_grade`) | ✅ | 👁️ (Giám sát tiến độ chấm) | ✅ |
| | Cấu hình đề kiểm tra & Quy tắc tính điểm | ❌ | ❌ | ✅ | ✅ (Hỗ trợ kỳ thi chung) | ✅ |
| **5. Diễn đàn Học tập** | Đăng câu hỏi, thảo luận, bình luận (tối đa 2 cấp) | ✅ (Phạm vi Lớp/Môn) | ✅ | ✅ | ✅ | ✅ |
| | Đăng Thông báo chính thức (`ANNOUNCEMENT`) | ❌ | 🔒 (`can_moderate_forum`) | ✅ | ✅ | ✅ |
| | Ghim, Khóa, Ẩn bài vi phạm, Xác nhận câu trả lời đúng | ❌ | 🔒 (`can_moderate_forum` - Chỉ trong lớp) | ✅ (Lớp & Toàn môn) | ✅ | ✅ |
| | Chấm điểm chủ đề thảo luận (`Graded Discussion`) | ❌ | 🔒 (`can_grade`) | ✅ | 👁️ | ✅ |
| **6. Điểm danh & Xin nghỉ** | Bật mã QR Điểm danh động / Điểm danh thủ công | ❌ | 🔒 (`can_take_attendance`) | ✅ | ✅ (Khi hỗ trợ lớp) | ✅ |
| | Quét QR Điểm danh & Gửi đơn xin nghỉ phép | ✅ | ❌ | ❌ | ❌ | ❌ |
| | Phê duyệt đơn xin nghỉ phép & Xếp lịch học bù | ❌ | 👁️ (Xem & Đề xuất) | ✅ | ✅ | ✅ |
| | Chỉnh sửa điểm danh sau buổi học (Bắt buộc ghi Audit) | ❌ | ❌ | ✅ | ✅ | ✅ |
| **7. Nhật ký Giảng dạy** | Nhập dự thảo Nhật ký giảng dạy (`TeachingLog`) | ❌ | 🔒 (Nhập nháp hỗ trợ) | ✅ | ✅ | ✅ |
| | **Ký xác nhận buổi dạy (Đúng hạn <=24h hoặc Xác nhận muộn >24h)**| ❌ | ❌ | ✅ (Không khóa quyền khi quá hạn `OVERDUE_UNCONFIRMED`) | 🔒 (Xử lý ngoại lệ có log) | ✅ |
| | Theo dõi, nhắc nhở & xử lý các buổi quá hạn (`> 24h`) | ❌ | ❌ | 👁️ (Của chính mình) | ✅ (Toàn khoa/trung tâm) | ✅ |

---

## 3. Cơ chế Thực thi Phân quyền ở Tầng Backend (Implementation Pattern)

Tại tầng Backend Python, quyền truy cập được kiểm tra thông qua Dependency / Decorator kết hợp Redis Cache (TTL 5 phút, tự động xóa cache khi thay đổi phân công giảng dạy):

```python
# Minh họa cấu trúc kiểm tra Scope + Flag Permission tại Backend Python
async def verify_subject_class_access(
    user: CurrentUser,
    subject_class_id: UUID,
    required_ta_flag: Optional[str] = None,
    allow_student: bool = False,
) -> AccessContext:
    if user.has_role("ADMIN"):
        return AccessContext(granted=True, role="ADMIN")

    if user.has_role("ACADEMIC_STAFF"):
        if await repo.is_class_in_staff_department(user.id, subject_class_id):
            return AccessContext(granted=True, role="ACADEMIC_STAFF")

    staff_assignment = await repo.get_staff_assignment(user.id, subject_class_id)
    if staff_assignment and staff_assignment.is_active:
        if staff_assignment.staff_role in ("PRIMARY_INSTRUCTOR", "CO_INSTRUCTOR"):
            return AccessContext(granted=True, role="INSTRUCTOR")
        if staff_assignment.staff_role == "TEACHING_ASSISTANT":
            if required_ta_flag is None or staff_assignment.permissions_json.get(required_ta_flag) is True:
                return AccessContext(granted=True, role="TEACHING_ASSISTANT")
            raise ForbiddenError("INSUFFICIENT_TA_PERMISSION_FLAG")

    if allow_student and user.has_role("STUDENT"):
        if await repo.is_student_enrolled_active(user.id, subject_class_id):
            return AccessContext(granted=True, role="STUDENT")

    raise ForbiddenError("INSUFFICIENT_SCOPE_PERMISSION")
```
