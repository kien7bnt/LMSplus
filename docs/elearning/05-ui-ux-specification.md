# 05. ĐẶC TẢ GIAO DIỆN CHI TIẾT & BLOCK EDITOR (UI/UX SPECIFICATION)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Tài liệu liên quan:** [`03-sitemap-user-flows.md`](./03-sitemap-user-flows.md), [`04-design-system.md`](./04-design-system.md)

---

## 1. Kiến trúc Khung Giao diện (Application Layouts)

Phân hệ E-Learning cung cấp 3 Layout gốc có khả năng chuyển đổi sang Component React trực tiếp:

1. **`PortalAppShell` (Dành cho Học viên — `/learn/*`):**
   - **Top Header (`72px`):** Logo LMSPLUS, Thanh tìm kiếm thông minh dạng viên thuốc (`Airbnb Pill Search`), Chuyển đổi nhanh Khóa/Môn đang học, Chuông thông báo (có badge số chưa đọc), Chuyển đổi chế độ Sáng/Tối (`airbnb-light` / `cinema-dark`), Menu tài khoản.
   - **Left Collapsible Navigation (`240px` khi mở / `68px` khi thu gọn, chuyển thành Bottom Bar 5 mục trên Mobile):** Trang chủ, Khóa học của tôi, Lịch học, Bài tập & Kiểm tra, Diễn đàn, Wiki, Tiến độ.
2. **`FocusPlayerLayout` (Dành riêng cho Không gian học bài `LP-05`):**
   - Tối giản toàn bộ thanh điều hướng ngoài để tập trung 100% vào bài giảng. Mặc định ưu tiên hỗ trợ chế độ `cinema-dark` dịu mắt khi học video.
3. **`WorkspaceAppShell` (Dành cho Giảng viên, Trợ giảng & Giáo vụ — `/teach/*`):**
   - **Left Sidebar theo Ngữ cảnh (`260px`):** Bộ chọn Lớp môn học nhanh ở đầu Sidebar, theo sau là các nhóm chức năng được hiển thị động dựa trên quyền RBAC + Scope của người dùng.

---

## 2. Thiết kế Chi tiết Learning Portal — Học viên (12 Màn hình)

### 2.1. `LP-01` — Trang chủ Học tập (`/learn/dashboard`)

```text
+--------------------------------------------------------------------------------------------------+
| [LMSPLUS]   ( Tìm kiếm bài học, thuật ngữ Wiki, thảo luận... [Q] )       [Theme] [Bell:3] [Avatar]|
+------------------+-------------------------------------------------------------------------------+
| [Trang chủ]      | Xin chào, Nguyễn Minh Anh 👋                        🔥 Chuỗi 14 ngày học liên tiếp |
|  Khóa học của tôi| Bạn có 1 buổi học chiều nay lúc 14:00 và 1 bài tập sắp đến hạn nộp.            |
|  Khám phá        |                                                                               |
|  Lịch học        | +---------------------------------------------------------------------------+ |
|  Bài tập         | | TIẾP TỤC HỌC GẦN NHẤT (Môn: Thiết kế Hệ thống Phân tán - Lớp SE302.01)   | |
|  Kiểm tra        | | Chương 3 • Bài 3.2: Cơ chế Consensus Raft & Replication Log              | |
|  Diễn đàn        | | [================>·······] 68% hoàn thành • Dừng ở phút 12:40 / 18:30     | |
|  Wiki thuật ngữ  | |                                           [ ▶ Tiếp tục học bài này -> ]   | |
|  Tiến độ         | +---------------------------------------------------------------------------+ |
|                  |                                                                               |
|                  | +-----------------------------------+ +-------------------------------------+ |
|                  | | LỊCH HỌC SẮP TỚI (Hôm nay)        | | BÀI TẬP & KIỂM TRA CẦN HOÀN THÀNH   | |
|                  | | • 14:00 - 16:00 | Lớp SE302.01    | | • [Bài tập] Thiết kế Shard Key      | |
|                  | |   Phòng P.402 / Zoom              | |   Hạn nộp: 23:59 Hôm nay (Còn 9h)   | |
|                  | |   [Vào Zoom] [Quét QR Điểm danh]  | | • [Kiểm tra] Quiz Chương 3 (30 phút)| |
|                  | +-----------------------------------+ +-------------------------------------+ |
|                  |                                                                               |
|                  | KHÓA HỌC & LỚP MÔN HỌC CỦA TÔI (4)                     [Xem tất cả ->]        |
|                  | [Card 1: SE302.01 - 68%]  [Card 2: AI101.02 - 45%]  [Card 3: DB201.01 - 90%]  |
|                  |                                                                               |
|                  | +-----------------------------------+ +-------------------------------------+ |
|                  | | HOẠT ĐỘNG MỚI TỪ GIẢNG VIÊN       | | THÔNG BÁO MỚI                       | |
|                  | | • TS. Lê Nam vừa trả bài tập #2   | | • Đơn xin nghỉ ngày 08/11 đã duyệt  | |
|                  | | • ThS. Hà My đã ghim 1 thảo luận  | | • Lịch học bù môn AI101 ngày 14/11  | |
|                  | +-----------------------------------+ +-------------------------------------+ |
+------------------+-------------------------------------------------------------------------------+
```

- **Quy tắc UX bắt buộc:**
  - Khối **"Tiếp tục học"** luôn nằm ở vị trí đầu tiên trên vùng nội dung chính (`Above the fold`). Nút `[ ▶ Tiếp tục học bài này ]` dùng màu `--brand-primary` (`#FF385C`), chiều cao `48px`, khi bấm điều hướng thẳng tới `/learn/subject-classes/:scId/lessons/:lessonId?resume=true`.
  - Nếu học viên mới chưa học bài nào, khối này tự động chuyển thành **"Bắt đầu bài học đầu tiên của bạn"** trỏ tới bài 1.1 của lớp môn học đang diễn ra.

---

### 2.2. `LP-02` — Khám phá Khóa học (`/learn/explore`) & `LP-03` — Khóa học của tôi (`/learn/my-courses`)

- **Thanh tìm kiếm & Bộ lọc (`LP-02`):**
  - Tìm kiếm theo tên khóa học, mã môn học, tên giảng viên.
  - Bộ lọc: `Chương trình đào tạo`, `Môn học`, `Trạng thái đăng ký` (`Đã ghi danh`, `Chờ duyệt yêu cầu`, `Mở đăng ký`).
- **Quy tắc Hiển thị & Nút Hành động theo Cấu hình `enrollment_policy` của từng Khóa học:**
  1. **`ASSIGNED_ONLY` (Mặc định — Khóa học chương trình đào tạo chính thức):**
     - Chỉ hiển thị các khóa học mà học viên đã được Giáo vụ/người có quyền phân lớp hoặc nằm trong chương trình đào tạo của học viên. Khóa học ngoài phạm vi bị ẩn hoàn toàn.
     - Nút trên thẻ: `[ Vào học ]` (nếu đã phân lớp) hoặc nhãn trạng thái `Theo phân lớp của Giáo vụ`.
  2. **`REQUEST_APPROVAL` (Khóa học kỹ năng chung / tự chọn / mở rộng):**
     - Hiển thị trong danh mục khám phá. Học viên chưa thuộc lớp sẽ thấy nút `[ Gửi yêu cầu tham gia ]`.
     - Khi gửi yêu cầu, mở Modal ngắn nhập lý do/nhóm lớp mong muốn; trạng thái trên thẻ chuyển thành Badge vàng `⏳ Đang chờ phê duyệt`.
  3. **`SELF_ENROLL` (Chỉ khi Quản trị viên chủ động bật tự đăng ký):**
     - Hiển thị nút `[ Đăng ký tham gia ngay ]`, ghi danh học viên vào lớp mặc định được cấu hình sẵn mà không làm thay đổi cơ chế phân lớp chính khóa của LMSPLUS.
- **Thẻ khóa học (`CourseCard` chuẩn Airbnb Zero-Chrome):**
  - Ảnh đại diện tỷ lệ `16:10`, bo góc `16px`, góc phải dưới hiển thị tổng số Chương & Bài học (`8 chương • 32 bài`).
  - Bên dưới ảnh: Tên khóa học (`15px`, đậm `600`), Tên giảng viên phụ trách (`14px`, `--text-secondary`), Thanh tiến độ (`--accent-learning` `#00A699`) kèm phần trăm hoàn thành (`tabular-nums`).

---

### 2.3. `LP-04` — Chi tiết Khóa học & Lớp Môn học

Thiết kế phân tách rõ ràng giữa **Lớp khóa học (Course Class)** và **Lớp môn học (Subject Class)** bằng hệ thống Breadcrumb và Chuyển ngữ cảnh rõ ràng:

1. **Chế độ xem `Lớp khóa học (Course Class View)` — Không gian tổng hợp của cả khóa đào tạo:**
   - Hiển thị: Tên khóa đào tạo, Mô tả tổng quan, Mục tiêu đầu ra của khóa (`Course Learning Outcomes`), Tiến độ tổng thể toàn khóa, và **Danh sách các Lớp môn học (`Subject Classes`)** cấu thành nên khóa học đó (kèm trạng thái từng môn: `Đã hoàn thành`, `Đang học`, `Chưa mở`).
2. **Chế độ xem `Lớp môn học (Subject Class View)` — Không gian học tập của từng môn cụ thể:**
   - **Header Môn học:** Tên môn học + Mã lớp môn (`SE302.01`), Giảng viên chính & Trợ giảng, Tiến độ môn học (`68%`), Nút `"Tiếp tục học Bài 3.2"`.
   - **6 Tab chức năng của Lớp môn học:**
     - `Chương trình học (Syllabus & Lessons)`: Cây danh sách Chủ đề (`Topic`) → Chương (`Chapter`) → Bài học (`Lesson`) kèm thời lượng, trạng thái hoàn thành và điều kiện mở khóa.
     - `Mục tiêu & Giới thiệu`: Mô tả môn học, chuẩn đầu ra (`CLO`), tài liệu giáo trình chính.
     - `Lịch học & Điểm danh`: Danh sách các buổi học (`ClassSession`) của lớp, lịch sử điểm danh của học viên và nút gửi đơn xin nghỉ.
     - `Bài tập (Assignments)`: Các bài tập gắn bài học và bài tập chung của lớp môn.
     - `Kiểm tra (Assessments)`: Các bài kiểm tra định kỳ/giữa kỳ/cuối chương.
     - `Thảo luận (Forum)`: Diễn đàn hỏi đáp của lớp môn học.

---

### 2.4. `LP-05` — Không gian Học bài (`Lesson Player` — Màn hình Quan trọng nhất)

Thiết kế lấy cảm hứng từ **Coursera** kết hợp trình hiển thị nội dung **Notion Blocks**:

```text
+---------------------------------------------------------------------------------------------------+
| [<- Về môn SE302.01]  Chương 3: Đồng thuận Phân tán > Bài 3.2: Thuật toán Raft   [🌙 Cinema] [72%]|
+--------------------------+---------------------------------------------+--------------------------+
| CẤU TRÚC CHƯƠNG BÀI      | KHU VỰC HỌC TẬP TRUNG TÂM (CENTER STAGE)    | KHÔNG GIAN PHỤ (DRAWER)  |
| [Thu gọn <<]             |                                             | [Ghi chú] [Tài liệu]     |
|                          | +-----------------------------------------+ | [Hỏi đáp] [Wiki (4)]     |
| CHƯƠNG 3 (2/4 hoàn thành)| |                                         | | ------------------------ |
| [████████░░░░] 50%       | |       VIDEO PLAYER (16:9 HLS)           | | GHI CHÚ THEO MỐC VIDEO   |
|                          | |   (Tự động phát tiếp tại 12:40)         | | [+ Lưu ghi chú tại 12:40]|
| ✔ 3.1 Bài toán Byzantine | |                                         | |                          |
|   Video • 14:20          | | [▶] 12:40 / 18:30  [1.25x] [CC] [1080p] | | • [04:15] Leader election|
|                          | +-----------------------------------------+ |   cần đa số phiếu (N/2+1)|
| ● 3.2 Thuật toán Raft    |                                             |                          |
|   Đang học • 18:30       | --- NỘI DUNG BÀI HỌC (NOTION BLOCKS) ---    | • [09:50] Phân biệt rõ   |
|                          | [Callout: Mục tiêu bài học]                 |   Term và Log Index.     |
| 🔒 3.3 Thực hành Log     | • Hiểu 3 trạng thái: Leader, Follower...    |                          |
|   Mở khóa khi: Hoàn thành|                                             | TÀI LIỆU ĐÍNH KÈM (2)    |
|   Bài 3.2 & Đạt Quiz >=80| [Khối văn bản + Thuật ngữ Wiki gạch chân]   | • [PDF] Raft_Paper_VN.pdf|
|                          | [Khối Công thức LaTeX & Ví dụ từng bước]    | • [ZIP] raft-lab-src.zip |
| 🔒 3.4 Kiểm tra Chương 3 | [Khối Câu hỏi Kiểm tra nhanh - Quick Check] |                          |
|   Quiz • 20 phút         |                                             |                          |
|                          | +-----------------------------------------+ |                          |
|                          | | [<- Bài 3.1]   [✔ Đánh dấu Hoàn thành]  | |                          |
|                          | |                        [Bài 3.3 ->]     | |                          |
|                          | +-----------------------------------------+ |                          |
+--------------------------+---------------------------------------------+--------------------------+
```

- **Đặc tả hành vi kỹ thuật của `LP-05`:**
  1. **Lưu & Khôi phục vị trí tự động (`Auto-Resume`):**
     - Với Video: Gửi heartbeat mỗi `15s` (và tại sự kiện `onPause`, `beforeunload`) lưu `last_video_position_sec` và mảng khoảng thời gian đã xem `watched_segments`. Khi mở lại bài, tự động seek đến đúng giây gần nhất.
     - Với Bài đọc dài (Block Content): Dùng `IntersectionObserver` theo dõi `block_id` đang hiển thị ở vùng nhìn trung tâm và lưu `last_read_block_id`.
  2. **Hiển thị Điều kiện Mở khóa (`Unlock Condition Banner`):**
     - Nếu học viên bấm vào một bài đang có biểu tượng khóa (`🔒`), hệ thống hiển thị rõ popover/banner giải thích điều kiện còn thiếu (VD: *"Cần xem tối thiểu 85% video Bài 3.2 và trả lời đúng tối thiểu 4/5 câu hỏi Quick Check"*).
  3. **Responsive trên Tablet & Mobile (`< 1024px`):**
     - Khung Video cố định (`sticky top`) ở đầu màn hình tỷ lệ `16:9`.
     - Bên dưới Video là thanh Tabs ngang: `Nội dung bài đọc` | `Danh sách bài học (Chương 3)` | `Ghi chú` | `Tài liệu` | `Thảo luận`.
     - Thanh điều hướng `[ <- Bài trước ]` và `[ Bài tiếp theo -> ]` gắn cố định ở đáy màn hình (`height: 60px`, vùng chạm chuẩn `44x44px`).

---

### 2.5. Các Màn hình Học viên từ `LP-06` đến `LP-12`

- **`LP-06` — Wiki Thuật ngữ (`/learn/wiki`):**
  - Thanh tìm kiếm tức thì (hỗ trợ tìm theo cả tên chính thức và `WikiAliases`), bộ lọc theo Môn học, Danh mục và bảng chữ cái `A–Z`.
  - Mỗi thẻ thuật ngữ hiển thị: Tên thuật ngữ, Tên tiếng Anh/viết tắt, Định nghĩa theo ngữ cảnh môn học, Công thức/Ví dụ, các thuật ngữ liên quan (`WikiRelations`), và danh sách các bài học có xuất hiện thuật ngữ đó (`LessonTermLinks`).
- **`LP-07` — Diễn đàn Học tập (`/learn/forums`):**
  - Bộ lọc phạm vi: `Diễn đàn Lớp của tôi (Class Scope)` và `Diễn đàn Chung Toàn Môn (Subject Scope)`.
  - Giao diện 2 cột trên Desktop: Cột trái danh sách chủ đề (có nhãn `Ghim`, `Đã giải quyết`, `Có chấm điểm`), cột phải chi tiết chủ đề và cây phản hồi **giới hạn tối đa 2 cấp lồng nhau** (`Topic` → `Reply cấp 1` → `Reply cấp 2`).
- **`LP-08` — Bài tập (`/learn/assignments`):**
  - Phân nhóm: `Cần nộp`, `Đã nộp / Chờ chấm`, `Cần nộp lại (Returned)`, `Đã có điểm`.
  - Phân biệt nhãn rõ ràng giữa **Bài tập gắn chương trình** (có link dẫn thẳng tới Bài học tương ứng) và **Bài tập ngoài chương trình**.
- **`LP-09` — Kiểm tra (`/learn/assessments`):**
  - Hiển thị thông tin trước khi làm bài: Thời gian mở/đóng đề, Thời lượng làm bài (`30 phút`), Số lần làm cho phép (`2/3 lần`), Quy tắc lấy điểm (`Điểm cao nhất`).
  - Trong khi làm bài: Đồng hồ đếm ngược cố định góc trên phải (`tabular-nums`), bảng câu hỏi đánh dấu câu đã làm/đặt cờ xem lại, tự động nộp bài khi hết giờ.
- **`LP-10` — Tiến độ Học tập (`/learn/progress`):**
  - Tổng hợp tỷ lệ hoàn thành chương trình, điểm chuyên cần, điểm bài tập và điểm kiểm tra theo từng lớp môn học.
- **`LP-11` — Lịch học & Xin nghỉ (`/learn/schedule`):**
  - Lịch học trực quan, cho phép bấm vào một buổi học sắp tới để nộp **Đơn xin nghỉ (`LeaveRequest`)** kèm tệp minh chứng, hoặc bấm **Quét QR Điểm danh** đối với buổi học đang diễn ra.
- **`LP-12` — Thông báo (`/learn/notifications`):**
  - Danh sách thông báo thời gian thực, hỗ trợ lọc `Chưa đọc` và bấm vào để mở đúng màn hình đích.

---

## 3. Thiết kế Chi tiết Teaching Workspace — Giảng viên & Trợ giảng (16 Màn hình)

### 3.1. `TW-05` — Trình soạn Bài giảng (`Notion-Style Block Editor`)

Trình soạn thảo được xây dựng trên kiến trúc **Tiptap / ProseMirror** (React), lưu trữ hoàn toàn dưới dạng **Structured JSON có `schema_version`** (tuyệt đối không lưu HTML thuần làm nguồn dữ liệu gốc).

#### A. Bố cục Giao diện Trình soạn thảo (`EditorFullLayout`)

```text
+---------------------------------------------------------------------------------------------------+
| [<- Cây chương trình]  Bài 3.2: Thuật toán Đồng thuận Raft   [Đã lưu nháp 11:42] [Xem thử] [Xuất bản]|
+-----------------------------------------------------------------------+---------------------------+
| VÙNG SOẠN THẢO TRUNG TÂM (NOTION BLOCK CANVAS - MAX WIDTH 760PX)      | THANH CÔNG CỤ PHỤ (RIGHT) |
|                                                                       | [Cấu hình] [Lịch sử]      |
|  ⋮⋮ [+]  H1  Thuật toán Đồng thuận Raft trong Hệ phân tán             | [Shared Blocks] [Wiki]    |
|                                                                       | ------------------------- |
|  ⋮⋮ [+]  [CALLOUT: MỤC TIÊU BÀI HỌC (learning_objective)]             | LỊCH SỬ PHIÊN BẢN         |
|          • Nắm vững cơ chế bầu chọn Leader (Leader Election)          | ● Bản nháp hiện tại       |
|          • Phân tích quá trình sao chép nhật ký (Log Replication)     |   Sửa bởi: TS. Lê Nam     |
|                                                                       |   Vừa xong                |
|  ⋮⋮ [+]  [VĂN BẢN + LIÊN KẾT THUẬT NGỮ WIKI]                          |                           |
|          Trong thuật toán [Raft](term_id:842), thời gian được chia    | ○ Phiên bản v2 (Đang phát)|
|          thành các nhiệm kỳ gọi là [Term](term_id:845)...             |   Xuất bản: 08/11 15:20   |
|                                                                       |   [Xem] [Khôi phục]       |
|  ⋮⋮ [+]  [VÍ DỤ CÓ LỜI GIẢI TỪNG BƯỚC (step_by_step_solution)]        |                           |
|          Đề bài: Giả sử cụm có 5 node (N=5), tính quorum tối thiểu... | ○ Phiên bản v1            |
|          ├─ Bước 1: Áp dụng công thức Q = floor(N/2) + 1              |   Xuất bản: 01/11 09:00   |
|          └─ Bước 2: Thay N=5 => Q = 3 nodes.                          |                           |
|                                                                       | ĐIỀU KIỆN HOÀN THÀNH BÀI  |
|  ⋮⋮ [+]  [CÂU HỎI KIỂM TRA NHANH (inline_mcq)]                        | [x] Xem >= 85% Video      |
|          Câu hỏi: Khi nào một Candidate trở thành Leader?             | [x] Hoàn thành Quick Quiz |
|          (•) Khi nhận được phiếu bầu từ đa số node trong cụm          | [ ] Nộp bài tập gắn kèm   |
|          ( ) Khi có ID lớn nhất                                       |                           |
|                                                                       |                           |
|  Gõ '/' để chèn Block (Văn bản, Callout, LaTeX, Quiz, Video, Code...) |                           |
+-----------------------------------------------------------------------+---------------------------+
```

#### B. Đặc tả 6 Nhóm Block & JSON Schema Chuẩn (`schema_version: "1.0"`)

Mỗi block trong bảng `lesson_blocks` đều tuân thủ cấu trúc phong bì JSON thống nhất:

```json
{
  "id": "blk_01J9Z8K4M2N6P8Q0R2S4T6V8W0",
  "lesson_id": "les_948201",
  "schema_version": "1.0",
  "block_type": "callout",
  "sort_order": 2000,
  "status": "ACTIVE",
  "shared_block_id": null,
  "content": {
    "variant": "learning_objective",
    "title": "Mục tiêu bài học",
    "body_rich_text": [
      {
        "type": "text",
        "text": "Hiểu cơ chế bầu chọn Leader trong ",
        "marks": []
      },
      {
        "type": "wiki_term",
        "text": "Thuật toán Raft",
        "attrs": { "term_id": "wt_1024", "sense_id": "ws_2048" }
      }
    ]
  }
}
```

Bảng quy định chi tiết `block_type` và cấu trúc `content` cho từng nhóm:

| Nhóm Block | Mã `block_type` | Các biến thể (`variant`) & Trường dữ liệu trong `content` |
| :--- | :--- | :--- |
| **1. Văn bản (Text)** | `heading`<br>`paragraph`<br>`list`<br>`quote`<br>`divider`<br>`accordion`<br>`tabs` | - `heading`: `{ level: 1 | 2 | 3, rich_text: [...] }`<br>- `paragraph`: `{ rich_text: [...] }` (hỗ trợ inline `wiki_term`, `code`, `bold`, `italic`, `link`)<br>- `list`: `{ style: "bullet" | "ordered" | "checklist", items: [...] }`<br>- `accordion`: `{ items: [{ id, title, children_blocks: [...] }] }`<br>- `tabs`: `{ tabs: [{ id, label, children_blocks: [...] }] }` |
| **2. Callout Sư phạm** | `callout` | - `variant`: `"learning_objective"` (Mục tiêu bài học), `"definition"` (Định nghĩa), `"remember"` (Ghi nhớ), `"note"` (Lưu ý), `"warning"` (Cảnh báo), `"exam_tip"` (Mẹo thi), `"summary"` (Tóm tắt).<br>- Thiết kế UI: Bo góc `12px` (`--radius-md`), viền `1px solid` toàn khung kèm icon ngữ nghĩa, tuyệt đối không dùng `border-left: 4px` đơn điệu. |
| **3. Học thuật (Academic)** | `latex_math`<br>`table`<br>`step_by_step_solution` | - `latex_math`: `{ expression: "\\sum_{i=1}^{n} x_i", display_mode: true }`<br>- `table`: `{ has_header_row: true, columns: [...], rows: [[...]] }`<br>- `step_by_step_solution`: `{ problem_statement: [...], steps: [{ step_number, title, explanation, latex_hint }], final_answer: [...] }` (Học viên có thể bấm mở từng bước giải để tự rèn luyện tư duy). |
| **4. Tương tác (Interactive)**| `inline_mcq`<br>`true_false`<br>`form_poll`<br>`quick_check` | - `inline_mcq` / `true_false` / `quick_check`: `{ question_prompt: [...], options: [{ id, text, is_correct, feedback }], explanation: [...], required_for_completion: true, max_attempts: 3 }` |
| **5. Multimedia** | `image`<br>`video`<br>`audio`<br>`diagram_mermaid`<br>`attachment` | - `{ resource_id: "res_...", caption: "...", aspect_ratio: "16/9", transcript_id: "tr_...", allow_download: false }` |
| **6. Lập trình (Coding)** | `code_block` | - `{ language: "python" | "typescript" | "sql" | "cpp", code: "...", show_line_numbers: true, copyable: true, sandbox: { enabled: true, runtime: "python-3.11-wasm", test_cases: [...], time_limit_ms: 3000 } }` (Chạy thử trong WebWorker/WASM hoặc контейner cô lập an toàn). |

---

### 3.2. Các Màn hình Quản lý Giảng dạy Trọng tâm Khác (`TW-01` → `TW-16`)

1. **`TW-01` Dashboard Giảng dạy:**
   - Khối ưu tiên số 1: **"Cần hành động ngay"** gồm các buổi dạy đã kết thúc nhưng chưa xác nhận nhật ký (`AWAITING_CONFIRMATION` / `OVERDUE_UNCONFIRMED`), đơn xin nghỉ của học viên sắp tới giờ học, và bài tập đã quá hạn chấm.
2. **`TW-04` Quản lý Cấu trúc Chương trình:**
   - Giao diện cây kéo-thả (`Topic` → `Chapter` → `Lesson`), cho phép cấu hình `LessonPrerequisites` (bài học tiên quyết) và gắn bài học vào các buổi học dự kiến (`LessonSessions`).
3. **`TW-09` Chấm bài (`SpeedGrader Split View`):**
   - Cột trái (`65%`): Trình xem trực tiếp tệp PDF/Docx/Code/Ảnh hoặc câu trả lời của học viên, cho phép chuyển đổi xem giữa các lần nộp (`Lần nộp #1`, `Lần nộp #2`).
   - Cột phải (`35%`): Ô nhập điểm (`tabular-nums`), bảng Rubric chấm theo tiêu chí, ô viết nhận xét, đính kèm tệp sửa bài, và 2 nút hành động: **`[ Lưu & Trả điểm ]`** hoặc **`[ Yêu cầu Học viên Nộp lại ]`**.
4. **`TW-12` Điểm danh & QR Động + `TW-13` Đơn xin nghỉ:**
   - Bảng điểm danh lớp học với 6 trạng thái chuẩn: `Có mặt (PRESENT)`, `Đi muộn (LATE)`, `Về sớm (EARLY_LEAVE)`, `Vắng có phép (EXCUSED_ABSENCE)`, `Vắng không phép (UNEXCUSED_ABSENCE)`, `Học bù (MAKEUP)`.
   - Chế độ **Trình chiếu QR Điểm danh**: Mở toàn màn hình mã QR tự động đổi mới mỗi 20 giây kèm bộ đếm số học viên đã quét thành công theo thời gian thực (`34/40 học viên đã có mặt`).
5. **`TW-14` Nhật ký Giảng dạy & `TW-15` Xác nhận Buổi dạy (Quy tắc 24 Giờ):**
   - Biểu mẫu chuẩn hóa cho mỗi buổi học (`ClassSession`):
     - Thời gian: Hiển thị rõ `Giờ kết thúc theo lịch (scheduled_end_at)`, `Hạn xác nhận (24h sau khi kết thúc)`, và ô nhập `Giờ bắt đầu thực tế` — `Giờ kết thúc thực tế`.
     - Nhân sự đứng lớp: `Giảng viên thực tế` (mặc định là giảng viên phân công, hoặc chọn `Giảng viên dạy thay`), `Trợ giảng tham gia`.
     - Tiến độ bài giảng trong buổi: Liệt kê các bài học gắn với buổi đó để giảng viên đánh dấu từng bài là **`Đã dạy xong (COMPLETED)`**, **`Mới dạy một phần (PARTIAL - ghi rõ dừng ở mục nào)`**, hoặc **`Chưa kịp dạy (DEFERRED)`**.
   - **Hành vi Giao diện theo Trạng thái Thời hạn 24 Giờ:**
     - **Trong vòng 24 giờ sau khi kết thúc buổi học (`AWAITING_CONFIRMATION`):** Hiển thị đồng hồ đếm ngược thời gian còn lại để xác nhận (VD: `Còn 08h 15p để xác nhận đúng hạn`) và nút chính `[ ✔ Ký xác nhận buổi dạy ]`.
     - **Sau 24 giờ chưa xác nhận (`OVERDUE_UNCONFIRMED`):** Hệ thống tự động gắn nhãn đỏ `Quá hạn xác nhận (> 24h)`. **Nút xác nhận KHÔNG bị khóa** — Giảng viên vẫn bấm được `[ ✔ Xác nhận nhật ký (Quá hạn) ]` kèm ô ghi chú ngắn giải trình lý do xác nhận muộn; hệ thống lưu lại cả `scheduled_end_at`, `confirmed_at` thực tế và lịch sử chuyển trạng thái.
     - **Giao diện cho Giáo vụ / Quản trị viên:** Có bộ lọc riêng `Buổi dạy quá hạn xác nhận`, nút `[ 🔔 Gửi nhắc nhở Giảng viên ]` (gửi qua Notification/Email) và nút `[ Xử lý / Ghi chú Giáo vụ ]`.

---

## 4. Giao diện theo Phân quyền (Permission-Based UI Rendering)

Giao diện React sử dụng component `<ScopePermissionGuard>` kết hợp dữ liệu quyền trả về từ API `/api/v1/elearning/me/scopes` để hiển thị chính xác theo vai trò:

| Thành phần UI / Thao tác | Học viên (`STUDENT`) | Trợ giảng (`TA` - Theo cờ quyền) | Giảng viên (`INSTRUCTOR`) | Giáo vụ (`ACADEMIC_STAFF`) |
| :--- | :---: | :---: | :---: | :---: |
| Xem bài giảng đã xuất bản (`PUBLISHED`) | ✅ (Trong lớp đã ghi danh) | ✅ | ✅ | ✅ |
| Xem bài giảng nháp (`DRAFT`) & Lịch sử sửa | ❌ Ẩn hoàn toàn | 🔸 Chỉ khi có quyền `can_manage_materials` | ✅ | ✅ (Chế độ xem giám sát) |
| Nút `[Xuất bản bài giảng]` | ❌ | ❌ Khóa/Ẩn | ✅ | ❌ |
| Nút `[Chấm bài & Nhận xét]` | ❌ | 🔸 Chỉ khi có quyền `can_grade` | ✅ | ❌ (Chỉ xem kết quả) |
| Nút `[Điểm danh & Bật QR]` | ❌ (Chỉ có nút Quét QR) | 🔸 Chỉ khi có quyền `can_take_attendance` | ✅ | ✅ (Hỗ trợ điểm danh/duyệt nghỉ) |
| Nút `[Ký Xác nhận Buổi dạy]` | ❌ | ❌ (Chỉ được nhập nháp nhật ký nếu được giao) | ✅ (Giảng viên thực tế dạy) | 🔸 Duyệt ngoại lệ / Nhắc nhở quá hạn |
