# 04. HỆ THỐNG THIẾT KẾ THỐNG NHẤT (UNIFIED DESIGN SYSTEM SPECIFICATION)
> **Dự án:** Phân hệ E-Learning tích hợp LMSPLUS
> **Chuẩn áp dụng:** `UI/UX Pro Max` × `Impeccable` × `Airbnb DLS` × `3-Tier Multi-Theme`
> **File thực thi trong repo:** [`theme/tokens.css`](../../theme/tokens.css), [`theme/tailwind.preset.js`](../../theme/tailwind.preset.js), [`DESIGN.md`](../../DESIGN.md)

---

## 1. Định hướng Thẩm mỹ & Nguyên tắc Cốt lõi

Hệ thống Design System của phân hệ E-Learning tuân thủ triết lý **"Nội dung học thuật là trung tâm — Không gian tối giản, ấm áp và chuẩn xác"**:

1. **Không lạm dụng hiệu ứng trang trí (Zero AI-Slop):**
   - Cấm hoàn toàn gradient tím-xanh (`purple-gradient`), chữ tô màu chuyển sắc (`gradient-text`), bóng phát sáng neon trong chế độ tối (`dark-glow`), viền trái 4px màu mè (`side-tab`) và các hiệu ứng đàn hồi lò xo gây mất tập trung (`bounce-easing`).
2. **Tối ưu cho Thời gian Học tập Dài (Long-Session Ergonomics):**
   - Hỗ trợ đồng bộ **Daylight Mode (`airbnb-light`)** cho các màn hình quản trị/khám phá và **Cinema Focus Mode (`cinema-dark`)** cho Không gian học bài (`LP-05`) giúp giảm mỏi mắt khi học video và đọc tài liệu ban đêm.
3. **Nhất quán Toán học (Mathematical Precision):**
   - Lưới không gian `4px / 8px`, thang tỷ lệ chữ rõ ràng (`>= 1.25x`), bắt buộc `font-variant-numeric: tabular-nums` cho mọi con số (điểm số, thời lượng video, phần trăm tiến độ, đồng hồ đếm ngược bài thi).

---

## 2. Hệ thống Token Nền tảng (Foundational Tokens)

### 2.1. Typography (Hệ thống Chữ viết)

| Vai trò | Biến CSS | Font Family | Kích thước | Độ đậm | Line Height | Phạm vi sử dụng |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **Display** | `--text-display` | `Plus Jakarta Sans` | `clamp(2rem, 3.5vw, 3rem)` | `700` | `1.12` | Tiêu đề lớn trang tổng quan |
| **Heading 1** | `--text-h1` | `Plus Jakarta Sans` | `clamp(1.625rem, 2.5vw, 2.25rem)` | `600` | `1.20` | Tiêu đề trang, tên khóa học, H1 trong Block Editor |
| **Heading 2** | `--text-h2` | `Plus Jakarta Sans` | `clamp(1.375rem, 2vw, 1.625rem)` | `600` | `1.28` | Tiêu đề phân mục, tên chương, H2 trong Block Editor |
| **Heading 3** | `--text-h3` | `Plus Jakarta Sans` | `1.125rem` (`18px`) | `600` | `1.35` | Tiêu đề khối, H3 trong Block Editor |
| **Card Title** | `--text-card-title` | `Plus Jakarta Sans` | `0.9375rem` (`15px`) | `600` | `1.35` | Tên khóa học/lớp học trên thẻ Card |
| **Body Reading** | `--text-body` | `Plus Jakarta Sans` / `Source Serif 4` | `1rem` (`16px`) | `400` | `1.65` | Nội dung bài giảng (giới hạn `max-width: 70ch`) |
| **UI Secondary** | `--text-sm` | `Plus Jakarta Sans` | `0.875rem` (`14px`) | `400`/`500` | `1.45` | Bảng dữ liệu, nhãn form, metadata |
| **Caption / Badge**| `--text-xs` | `Plus Jakarta Sans` | `0.75rem` (`12px`) | `600` | `1.30` | Badge trạng thái, nhãn phụ |
| **Code & Time** | `--font-mono` | `JetBrains Mono` | `0.875rem` (`14px`) | `500` | `1.50` | Code block, thời lượng `12:45`, mã QR |

### 2.2. Color Palette (Bảng màu Ngữ nghĩa Đa Chế độ)

| Nhóm | Token CSS | Light Mode (`airbnb-light`) | Dark Mode (`cinema-dark`) | Mục đích sử dụng |
| :--- | :--- | :--- | :--- | :--- |
| **Bề mặt (Surface)** | `--bg-canvas` | `#FFFFFF` | `#121214` | Nền trang chính |
| | `--bg-surface` | `#FFFFFF` | `#1A1A1E` | Nền Card, Modal, Drawer, Bảng |
| | `--bg-surface-subtle` | `#F7F7F7` | `#222228` | Nền vùng lọc, Sidebar phụ, Callout trung tính |
| | `--bg-surface-hover` | `#F0F0F0` | `#2A2A32` | Trạng thái di chuột trên danh sách bài học/hàng bảng |
| **Văn bản (Ink)** | `--text-primary` | `#222222` | `#F5F5F7` | Văn bản chính (Đạt chuẩn tương phản WCAG AAA/AA) |
| | `--text-secondary` | `#717171` | `#A1A1AA` | Văn bản phụ, thông tin giảng viên, thời gian |
| | `--text-muted` | `#8A8A8A` | `#71717A` | Placeholder, văn bản vô hiệu hóa |
| **Đường viền (Border)**| `--border-subtle` | `#EBEBEB` | `rgba(255,255,255,0.08)` | Viền chia hàng bảng, chia chương học |
| | `--border-strong` | `#DDDDDD` | `rgba(255,255,255,0.16)` | Viền ô Input, Dropdown, Card có khung |
| **Nhấn & Trạng thái** | `--brand-primary` | `#FF385C` (Rausch) | `#FF385C` | Nút hành động chính ("Tiếp tục học", "Xuất bản", "Nộp bài") |
| | `--accent-learning` | `#00A699` (Babu) | `#00C2B3` | Thanh tiến độ học tập, trạng thái "Đã hoàn thành" |
| | `--accent-streak` | `#FC642D` (Arches) | `#FF7E47` | Cảnh báo hạn nộp gần, chuỗi ngày học, nhãn quan trọng |
| | `--status-success` | `#008A05` | `#2ECC71` | Đạt yêu cầu, có mặt (`PRESENT`), câu trả lời đúng |
| | `--status-warning` | `#E07912` | `#F39C12` | Đi muộn (`LATE`), dạy một phần (`PARTIAL`), sắp hết hạn |
| | `--status-danger` | `#C13515` | `#FF5A5F` | Vắng không phép (`UNEXCUSED`), quá hạn xác nhận, lỗi |

### 2.3. Spacing & Border Radius

- **Spacing Scale (Hệ 4px/8px):**
  - `--space-1` (`4px`), `--space-2` (`8px`), `--space-3` (`12px`), `--space-4` (`16px`), `--space-5` (`20px`), `--space-6` (`24px`), `--space-8` (`32px`), `--space-10` (`40px`), `--space-12` (`48px`), `--space-16` (`64px`).
- **Border Radius:**
  - `--radius-xs` (`6px` — Badge, Tag)
  - `--radius-sm` (`8px` — Button, Input, Dropdown)
  - `--radius-md` (`12px` — Callout Block, Lesson Row, Table Wrapper)
  - `--radius-lg` (`16px` — Course Card, Dashboard Panel)
  - `--radius-xl` (`24px` — Modal, Video Container)
  - `--radius-pill` (`9999px` — Search Pill, Filter Chip, Avatar)

---

## 3. Đặc tả 13 Component Tiêu chuẩn (Standard Component Inventory)

Mọi component React trong thư mục `src/components/ui/` của phân hệ E-Learning phải tuân thủ đặc tả kỹ thuật dưới đây:

| STT | Component | Biến thể (Variants) & Kích thước | Quy tắc Tương tác & Accessibility |
| :---: | :--- | :--- | :--- |
| **1** | **Button** | - Variants: `primary` (`--brand-primary`), `secondary` (viền `1px solid var(--text-primary)`), `subtle` (`--bg-surface-subtle`), `ghost`, `danger`.<br>- Sizes: `sm` (`36px`), `md` (`44px` chuẩn vùng chạm), `lg` (`48px`). | - Có trạng thái `isLoading` (hiển thị spinner đồng màu chữ và khóa click đúp).<br>- Khi nhấn (`:active`) thu nhẹ `scale(0.98)` trong `150ms`.<br>- Nút chỉ có icon bắt buộc truyền `aria-label`. |
| **2** | **Input / Textarea** | - Types: `text`, `search`, `number`, `datetime-local`, `textarea`.<br>- States: `default`, `focus`, `error`, `disabled`, `readOnly`. | - Luôn đi kèm `<label>` hiển thị rõ phía trên (`14px`, weight `500`), không dùng placeholder thay cho label.<br>- Khi có lỗi, hiển thị viền `--status-danger` và dòng thông báo lỗi ngay bên dưới kèm `aria-describedby`. |
| **3** | **Dropdown / Select** | - Single Select, Multi-Select (có tag), Searchable Combobox (dùng cho chọn Môn học, Giảng viên, Thuật ngữ Wiki). | - Hỗ trợ điều hướng bàn phím đầy đủ (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).<br>- Bo góc `--radius-sm` (`8px`), menu nổi dùng `--shadow-floating`. |
| **4** | **Modal** | - Sizes: `sm` (`440px` — Xác nhận xóa/khóa), `md` (`640px` — Form giao bài tập/xin nghỉ), `lg` (`880px` — Xem trước bài giảng, So sánh xung đột phiên bản). | - Khóa cuộn nền (`scroll-lock`), bẫy tiêu điểm bàn phím (`Focus Trap`), đóng bằng phím `Esc` hoặc nút `X` (`44x44px`).<br>- Header và Footer cố định, phần Body cuộn độc lập. |
| **5** | **Drawer (Slide-over)** | - Positions: `right` (`420px–560px` — Chi tiết chấm bài nhanh, Thảo luận gắn bài học, Lịch sử chỉnh sửa Block), `left` (`320px` — Cây chương trình học trên Mobile/Tablet). | - Chuyển động trượt mượt với `cubic-bezier(0.16, 1, 0.3, 1)` trong `280ms`. |
| **6** | **Tabs** | - `underline` (Thanh tab có gạch chân `2px solid var(--text-primary)` dùng trong Chi tiết khóa học & Không gian học bài).<br>- `segmented` (Dạng viên thuốc dùng cho bộ lọc trạng thái). | - Tuân thủ chuẩn `role="tablist"`, `role="tab"`, `aria-selected`.<br>- Trên màn hình nhỏ, tự động cuộn ngang mượt mà không bị gãy dòng. |
| **7** | **Table (Data Grid)** | - Dùng cho Danh sách điểm danh, Danh sách nộp bài, Nhật ký giảng dạy, Theo dõi tiến độ học viên. | - Header dính (`sticky`), các cột số liệu (Điểm, Tỷ lệ %, Thời gian) căn phải và bật `tabular-nums`.<br>- Hỗ trợ chọn nhiều hàng (`Checkbox` vùng chạm `44x44px`), sắp xếp cột và cố định cột tên học viên khi cuộn ngang trên mobile. |
| **8** | **Card** | - `catalog-zero-chrome` (Thẻ khóa học chuẩn Airbnb: ảnh bo góc `16px` + chữ bên dưới, không viền ngoài).<br>- `surface-panel` (Khối thông tin trên Dashboard/Workspace: nền `--bg-surface`, viền `1px solid var(--border-subtle)`, bo góc `16px`, padding `24px`). | - Tuyệt đối không lồng Card có viền bên trong một Card có viền khác (`no-cards-in-cards`). |
| **9** | **Badge** | - Semantic Variants: `neutral`, `success` (Đã hoàn thành / Có mặt), `warning` (Đi muộn / Sắp hết hạn / Bản nháp), `danger` (Vắng không phép / Quá hạn), `info` (Học bù / Đang diễn ra). | - Luôn kết hợp **Màu nền dịu + Chữ đậm + Chấm tròn/Icon nhỏ** để người mù màu vẫn phân biệt được trạng thái. |
| **10** | **Toast** | - Vị trí: `bottom-right` trên Desktop, `top-center` trên Mobile.<br>- Tự động ẩn sau `4000ms` đối với thông báo thành công (`Đã lưu nháp`, `Điểm danh thành công`), giữ nguyên cho đến khi người dùng đóng đối với thông báo lỗi. | - Có nút hành động hoàn tác (`Undo`) khi xóa block hoặc ẩn bình luận diễn đàn. |
| **11** | **Skeleton** | - Khung xương tải dữ liệu khớp chính xác kích thước thật của Course Card, Lesson Player, và Bảng dữ liệu. | - Sử dụng hiệu ứng chuyển sắc xám nhẹ nhàng (`shimmer` dịu), đảm bảo `CLS = 0` khi dữ liệu thực tải xong. |
| **12** | **Pagination** | - Hỗ trợ 2 chế độ: Phân trang đánh số (`Page 1 of 12` + chọn số dòng `20/50/100`) cho bảng quản trị của Giảng viên/Giáo vụ; và Nút `"Xem thêm"` cho danh sách thảo luận/khóa học. | - Các nút chuyển trang có kích thước tối thiểu `40x40px`, hiển thị tổng số bản ghi rõ ràng. |
| **13** | **Empty / Error / Loading States** | - **Empty State:** Icon minh họa nét mảnh đơn sắc + Tiêu đề rõ nguyên nhân + Mô tả ngắn + Nút hành động gợi ý (VD: *"Chưa có bài học nào trong chương này" → [+ Tạo bài học đầu tiên]*).<br>- **Error State:** Hiển thị mã lỗi thân thiện, nút `"Thử lại"` và cơ chế lưu tạm dữ liệu đang nhập để không làm mất công sức của người dùng. | - Không bao giờ để màn hình trắng trơn khi danh sách rỗng hoặc khi API gặp sự cố. |
