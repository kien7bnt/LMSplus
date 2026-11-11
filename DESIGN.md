# LMS E-Learning UI/UX Design Standard
> **Framework Stack:** `UI/UX Pro Max` (Design Intelligence & 10-Pillar Priority) × `Impeccable` (Anti-AI-Slop & Craft Vocabulary) × `Airbnb DLS` (Warm Content-First Marketplace & Learning Experience) × `3-Tier Multi-Theme Engine`

---

## 1. Triết lý cốt lõi (Core Philosophy)

Bộ quy chuẩn này kết hợp 4 trụ cột thiết kế hiện đại để đảm bảo mọi giao diện của hệ thống **LMS E-Learning** đều đạt chuẩn sản phẩm quốc tế, có hồn (human-crafted), giàu cảm xúc và tuyệt đối không mang dáng dấp "AI-generated template" (AI Slop):

1. **Airbnb DLS (Belonging, Warmth & Content-First):**
   - Giao diện đóng vai trò là "khung tranh" tôn vinh nội dung khóa học, giảng viên (Host/Instructor) và trải nghiệm học viên.
   - Ưu tiên khoảng trắng hào phóng (generous whitespace), lưới 4px/8px nghiêm ngặt, hình ảnh/video tỷ lệ chuẩn (`16:9` cho bài giảng, `4:3` hoặc `16:10` cho thẻ khám phá), bo góc mềm mại (`12px`–`24px`) và thanh tìm kiếm dạng viên thuốc (`Pill Search Bar`).
2. **Impeccable Craft (Zero AI-Slop Discipline):**
   - Loại bỏ hoàn toàn các dấu hiệu thiết kế công nghiệp của LLM: cấm gradient tím-xanh (`purple-gradient`), chữ tô màu gradient (`gradient-text`), viền trái 2px màu mè (`side-tab`), lạm dụng kính mờ (`glassmorphism`), bóng phát sáng neon trong Dark Mode (`dark-glow`), hay lạm dụng hiệu ứng nảy (`bounce-easing`).
3. **UI/UX Pro Max (10-Priority Engineering Checklist):**
   - Mọi màn hình trước khi code phải đối chiếu với `design-system/lms-elearning/MASTER.md` và vượt qua 10 tầng kiểm định từ Accessibility (WCAG AA), Touch Target (`>= 44x44px`), CLS (`< 0.1`), đến Cognitive Load trong quá trình học.
4. **3-Tier Adaptive Theme Architecture:**
   - Mọi màu sắc, độ nổi (elevation), viền và chữ đều đi qua hệ thống **Primitive → Semantic → Component Tokens**, hỗ trợ chuyển đổi mượt mà giữa **Daylight Mode** (Khám phá khóa học), **Cinema Focus Dark Mode** (Học video ban đêm không mỏi mắt) và các **Brand Presets**.

---

## 2. Quy tắc "Impeccable" Chống AI-Slop (Deterministic Anti-Patterns)

Mọi lập trình viên và AI Agent **BẮT BUỘC** tuân thủ bảng kiểm soát lỗi P0–P2 dưới đây:

| Mã quy tắc (Rule ID) | Mức độ | Hành vi bị cấm (❌ AI Slop) | Chuẩn bắt buộc (✅ Impeccable + Airbnb) |
| :--- | :---: | :--- | :--- |
| `no-purple-gradient` | **P0** | Dùng `bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500` cho nền hoặc banner. | Dùng nền đơn sắc sạch (`--bg-canvas`, `--bg-surface-subtle`) hoặc gradient thương hiệu cực nhẹ từ token `--brand-gradient`. |
| `no-gradient-text` | **P0** | Dùng `bg-clip-text text-transparent` trên tiêu đề khóa học hoặc Hero heading. | Dùng màu chữ mực in sắc nét `--text-primary` (`#222222` ở Light, `#F5F5F7` ở Dark) kết hợp font-weight & tracking chuẩn. |
| `no-overused-font` | **P1** | Dùng `Arial`, `Roboto` hoặc `Inter` mặc định không cấu hình optical sizing / tracking. | Dùng **`Plus Jakarta Sans`** (hoặc `Airbnb Cereal VF`) cho UI/Heading, **`Source Serif 4`** cho nội dung bài đọc dài, **`JetBrains Mono`** cho code/số liệu. |
| `no-side-tab` | **P1** | Thẻ cảnh báo / ghi chú có `border-left: 4px solid` kiểu cũ. | Dùng khung bo tròn `12px` (`--radius-md`), nền semantic nhạt (`--status-info-bg`), viền `1px` đồng nhất và icon tinh tế. |
| `no-dark-glow` | **P0** | Đổ bóng phát sáng màu cyan/tím (`box-shadow: 0 0 25px rgba(139,92,246,0.5)`) trong Dark Mode. | Trong Dark Mode, phân tách độ sâu bằng **Surface Luminance** (bề mặt cao hơn sẽ sáng hơn nhẹ) + viền `1px solid rgba(255,255,255,0.08)`. |
| `no-icon-tile-stack` | **P1** | Lưới 3 cột gồm ô vuông bo góc chứa icon màu + tiêu đề + đoạn văn nhàm chán. | Dùng bố cục bất đối xứng (Bento Grid có trọng tâm), minh họa thực tế, hoặc danh sách có phân cấp thị giác rõ ràng. |
| `no-flat-hierarchy` | **P1** | Tiêu đề `h1`/`h2` có kích thước gần bằng chữ thường (< 1.2x body). | Tuân thủ thang tỷ lệ chữ (Type Scale) tối thiểu `1.25x` (Major Third), có sự tương phản rõ giữa Display, Title, Body và Caption. |
| `no-gray-on-color` | **P0** | Đặt chữ xám (`#717171`) trực tiếp lên nền có màu sắc hoặc ảnh bìa khóa học. | Dùng màu chữ tương phản cao hoặc lớp phủ tonal (`scrim` gradient đen mờ 40-60% ở đáy ảnh) đảm bảo tỷ lệ tương phản `>= 4.5:1`. |
| `no-bounce-easing` | **P2** | Hiệu ứng chuyển động đàn hồi quá đà gây rối mắt khi học tập. | Dùng đường cong vật lý tự nhiên của Airbnb: `cubic-bezier(0.2, 0, 0, 1)` cho chuyển dịch và `cubic-bezier(0.16, 1, 0.3, 1)` cho modal/drawer. |

---

## 3. Hệ thống Design Tokens & Multi-Theme (Airbnb + LMS Themes)

Không bao giờ viết mã màu Hex cứng (`#ff385c`, `#222222`) trực tiếp trong component. Luôn gọi qua **Semantic CSS Variables** (định nghĩa tại `theme/tokens.css`).

### 3.1. Bảng màu Ngữ nghĩa (Semantic Color Architecture)

| Token Name | Airbnb Daylight (Light) | Cinema Focus (Dark) | Vai trò sử dụng trong LMS |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#FFFFFF` (Pure White) | `#121214` (Warm Obsidian) | Nền chính của trang Khám phá, Chi tiết khóa học. |
| `--bg-surface` | `#FFFFFF` (Pure White) | `#1A1A1E` (Elevated Slate) | Nền của Card khóa học, Sticky Pricing Box, Modal. |
| `--bg-surface-subtle` | `#F7F7F7` (Airbnb Hof Tint) | `#222228` (Muted Charcoal) | Nền khối phụ, thanh tìm kiếm chưa active, vùng lọc. |
| `--bg-surface-hover` | `#F0F0F0` | `#2A2A32` | Trạng thái hover của danh mục bài học, hàng dữ liệu. |
| `--text-primary` | `#222222` (Airbnb Hof) | `#F5F5F7` (Crisp Alabaster) | Tiêu đề khóa học, tên bài giảng, giá tiền, nội dung chính. |
| `--text-secondary` | `#717171` (Airbnb Foggy) | `#A1A1AA` (Warm Zinc) | Tên giảng viên, thời lượng, mô tả phụ, metadata. |
| `--text-muted` | `#8A8A8A` | `#71717A` | Placeholder, nhãn phụ, trạng thái vô hiệu hóa (kèm opacity). |
| `--border-subtle` | `#EBEBEB` (Airbnb Hairline) | `rgba(255,255,255,0.08)` | Đường kẻ phân cách chương học, viền card mặc định. |
| `--border-strong` | `#DDDDDD` | `rgba(255,255,255,0.16)` | Viền nút bấm thứ cấp, ô nhập liệu (input), thanh pill search. |
| `--brand-primary` | `#FF385C` (Airbnb Rausch) | `#FF385C` / `#FF5A5F` | CTA chính ("Đăng ký học", nút Search tròn, tim yêu thích). |
| `--brand-primary-hover` | `#E00B41` (Deep Rausch) | `#FF5A5F` | Trạng thái hover/active của CTA chính. |
| `--accent-learning` | `#00A699` (Airbnb Babu) | `#00C2B3` (Luminous Babu) | Tiến độ hoàn thành bài học (Progress bar), huy hiệu Đã học xong. |
| `--accent-streak` | `#FC642D` (Airbnb Arches) | `#FF7E47` | Chuỗi ngày học liên tiếp (Streak), khóa học Bestseller/Hot. |

> **Biến thể Theme mở rộng (`data-theme`):**
> - `data-theme="airbnb-light"` (Mặc định): Sáng sủa, truyền cảm hứng khám phá khóa học.
> - `data-theme="cinema-dark"` (Chế độ học tập/Video Player): Tối ưu độ tương phản dịu mắt khi xem video bài giảng và làm bài tập code.
> - `data-theme="babu-academy"` (Preset Giáo dục Chuyên sâu): Đổi `--brand-primary` sang sắc xanh ngọc lục bảo `#008489` / `#00A699` mang cảm giác học thuật, tin cậy.

---

## 4. Hệ thống Chữ viết (Typography & Readability)

Áp dụng quy tắc `/impeccable typeset` và `ui-ux-pro-max`:

1. **Font Families:**
   - `--font-sans`: `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` (mang cấu trúc hình học ấm áp, hiện đại tương đồng với *Airbnb Cereal VF*).
   - `--font-serif`: `'Source Serif 4', Georgia, serif` (dùng cho chế độ đọc tài liệu/bài viết chuyên sâu).
   - `--font-mono`: `'JetBrains Mono', monospace` (dùng cho thời lượng video `12:45`, mã giảm giá, khối code bài giảng).
2. **Thang tỷ lệ chữ (Fluid Type Scale):**
   - **Display Hero (`--text-display`):** `clamp(2rem, 3.5vw, 3rem)` (`32px–48px`), `font-weight: 700`, `line-height: 1.12`, `letter-spacing: -0.025em`.
   - **Page Title / H1 (`--text-h1`):** `clamp(1.625rem, 2.5vw, 2.25rem)` (`26px–36px`), `font-weight: 600`, `line-height: 1.2`, `letter-spacing: -0.02em`.
   - **Section Heading / H2 (`--text-h2`):** `clamp(1.375rem, 2vw, 1.625rem)` (`22px–26px`), `font-weight: 600`, `line-height: 1.28`, `letter-spacing: -0.015em`.
   - **Card / Module Title / H3 (`--text-h3`):** `1.125rem` (`18px`), `font-weight: 600`, `line-height: 1.35`, `letter-spacing: -0.01em`.
   - **Course Card Title (`--text-card-title`):** `0.9375rem` (`15px`), `font-weight: 600`, `line-height: 1.35`, màu `--text-primary` (Đặc trưng của Airbnb Listing Card).
   - **Body Standard (`--text-body`):** `1rem` (`16px`), `font-weight: 400`, `line-height: 1.6`, giới hạn độ rộng dòng **`60ch–75ch`** (tuyệt đối không vượt quá `80ch`).
   - **Body Compact / UI (`--text-sm`):** `0.875rem` (`14px`), `font-weight: 400` hoặc `500`, `line-height: 1.45`.
   - **Caption / Micro Metadata (`--text-xs`):** `0.75rem` (`12px`), `font-weight: 600`, `letter-spacing: 0.04em` (khi viết hoa nhãn `BESTSELLER`, `CHƯƠNG 1`).
3. **Số liệu (Numeric Discipline):**
   - Bắt buộc bật `font-variant-numeric: tabular-nums` cho: Giá khóa học, Điểm đánh giá (`★ 4.92`), Phần trăm tiến độ (`78%`), Thời gian đếm ngược bài thi và Thời lượng bài giảng (`08:24`).

---

## 5. Lưới không gian, Bo góc & Độ nổi (Spatial Grid, Radius & Elevation)

### 5.1. Hệ lưới 4px / 8px (Spatial Rhythm)
- Mọi giá trị `padding`, `margin`, `gap` phải là bội số của `4px` (`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px`).
- **Grid Container:**
  - Trang Khám phá (Catalog): `max-width: 1440px`, padding ngang `24px` (Mobile) → `40px` (Tablet) → `80px` (Desktop).
  - Trang Chi tiết khóa học (Course Detail): `max-width: 1120px` (chuẩn Airbnb Listing Detail), chia bố cục **2 cột bất đối xứng**: Cột nội dung trái `62%` + Cột Sticky Enrollment Card phải `34%` (cách nhau `gap: 48px`).
  - Trang Học tập (Course Player): Full-viewport `100vw / 100dvh` với chế độ thu gọn Sidebar (`360px` danh sách bài học).

### 5.2. Chuẩn Bo góc (Airbnb Border Radius Tokens)
- `--radius-xs`: `6px` (Badge nhỏ, tag kỹ năng).
- `--radius-sm`: `8px` (Nút bấm tiêu chuẩn, ô input, tiến độ).
- `--radius-md`: `12px` (Khối thông báo, thẻ bài học trong danh sách, ảnh thu nhỏ).
- `--radius-lg`: `16px` (Course Card trên lưới khám phá, Sticky Enrollment Box).
- `--radius-xl`: `24px` (Modal, Khung Video Player nổi, Bento Hero).
- `--radius-pill`: `9999px` (Thanh tìm kiếm Airbnb Pill Search, nút lọc Category, Avatar tròn).

### 5.3. Độ nổi 3 Tầng (Airbnb Elevation Shadows)
Không dùng bóng đen đậm đặc. Dùng bóng nhiều lớp khuếch tán mềm kết hợp viền `1px`:
- `--shadow-card`: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.05)` (trạng thái nghỉ của thanh Search và Sticky Card).
- `--shadow-card-hover`: `0 6px 20px rgba(0,0,0,0.10)` (khi di chuột vào thẻ hoặc nút nổi).
- `--shadow-floating`: `0 8px 28px rgba(0,0,0,0.14)` (Dropdown menu, Popover bộ lọc,Sticky Booking Card).

---

## 6. Chuẩn hóa Component đặc trưng cho LMS (Airbnb × LMS Patterns)

### 6.1. Thanh tìm kiếm Viên thuốc (Airbnb Discovery Pill Bar)
- Thiết kế dạng viên thuốc (`border-radius: 9999px`), chiều cao `64px`, nền `--bg-surface`, viền `1px solid var(--border-strong)`, đổ bóng `--shadow-card`.
- Chia thành 3–4 phân vùng ngăn cách bởi vạch kẻ dọc `1px solid var(--border-subtle)` cao `32px`:
  1. **Chủ đề / Kỹ năng** (*"Bạn muốn học gì?"*)
  2. **Cấp độ** (*"Cơ bản → Chuyên sâu"*)
  3. **Hình thức / Thời lượng** (*"Video tự học, Live cohort, Có chứng chỉ"*)
  4. **Nút Tìm kiếm tròn (`48x48px`)** nền `--brand-primary` (`#FF385C`) đặt sát mép phải, chứa icon kính lúp nét `2.5px` màu trắng.

### 6.2. Thanh Danh mục Ngang (Horizontal Category Rail)
- Đặt ngay dưới Header với hiệu ứng dính (`sticky`), chiều cao `78px`.
- Mỗi mục gồm **Icon nét mảnh (`24x24px`, stroke `1.75px`)** phía trên và **Nhãn chữ (`12px`, weight `600`)** phía dưới.
- Trạng thái chưa chọn: màu `--text-secondary`, `opacity: 0.75`.
- Trạng thái đang chọn (Active): màu `--text-primary`, `opacity: 1`, có thanh gạch chân `2px solid var(--text-primary)` ở đáy.

### 6.3. Thẻ Khóa học (Airbnb-Style Course Listing Card)
- **Nguyên tắc:** Không bọc khung viền hay đổ bóng bao quanh toàn bộ thẻ trên nền trắng (Zero-chrome card). Bản thân bức ảnh bìa bo góc `16px` (`--radius-lg`) đã tạo nên hình khối của thẻ!
- **Cấu trúc thẻ:**
  1. **Media Container (`aspect-ratio: 16 / 10` hoặc `4 / 3`, `border-radius: 16px`, `overflow: hidden`):**
     - Ảnh chất lượng cao (WebP/AVIF), zoom cực nhẹ `scale(1.03)` trong `300ms cubic-bezier(0.2, 0, 0, 1)` khi hover.
     - Góc trên trái: Badge trạng thái (`Được yêu thích nhất` / `Mới ra mắt`) nền trắng đục `rgba(255,255,255,0.92)`, chữ `#222222` `12px` đậm, bo tròn viên thuốc.
     - Góc trên phải: Nút Wishlist (Trái tim) kích thước vùng chạm `40x40px`, SVG có viền trắng và nền đen bán trong suốt `rgba(0,0,0,0.35)` để nổi bật trên mọi bức ảnh.
     - Góc dưới phải: Nhãn thời lượng video (`18h 30m`) kiểu `tabular-nums`.
  2. **Thông tin văn bản (Cách ảnh `12px`, khoảng cách giữa các dòng `4px`):**
     - **Dòng 1 (Flex justify-between):** Tiêu đề khóa học (`15px`, weight `600`, `--text-primary`, tối đa 1–2 dòng `line-clamp`) + Điểm đánh giá bên phải (`★ 4.95 (128)` màu `--text-primary`, `14px`).
     - **Dòng 2:** Tên giảng viên & Cấp độ (`14px`, `--text-secondary`, ví dụ: *TS. Nguyễn Minh • Trung cấp*).
     - **Dòng 3 (Cách trên `4px`):** Giá khóa học (`15px`, weight `600`, `--text-primary`) kèm giá gốc gạch ngang (`--text-secondary`) hoặc thanh tiến độ (`--accent-learning`) nếu học viên đã sở hữu.

### 6.4. Khung Đăng ký Dính (Sticky Right-Rail Enrollment Card)
- Trong trang chi tiết khóa học, cột phải chứa khung đăng ký có `position: sticky; top: 104px`, `border-radius: 16px`, `padding: 24px`, `border: 1px solid var(--border-strong)`, `box-shadow: var(--shadow-floating)`.
- Bao gồm: Video trailer xem thử, Giá khóa học rõ ràng, Nút CTA chính chiều cao `48px` (`--brand-primary`), Cam kết hoàn tiền / Quyền lợi khóa học dạng bảng ô hoặc danh sách kiểm gọn gàng.

---

## 7. Quy trình Kiểm định 10 Bước (UI/UX Pro Max × Impeccable Workflow)

Trước khi bàn giao bất kỳ giao diện nào, phải chạy qua quy trình 4 bước:
1. **Tham chiếu Blueprint:** Đọc `design-system/lms-elearning/MASTER.md` và file trang tương ứng trong `design-system/lms-elearning/pages/`.
2. **Áp dụng Token:** Sử dụng biến từ `theme/tokens.css` (hoặc class trong `theme/tailwind.preset.js`).
3. **Chạy công cụ kiểm tra tự động:**
   ```bash
   node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs <path-to-file-or-dir>
   ```
4. **Rà soát 10 hạng mục ưu tiên:**
   - [ ] **1. Accessibility (P0):** Độ tương phản chữ `>= 4.5:1`, đầy đủ `:focus-visible`, `aria-label` cho nút chỉ có icon (như nút tim, nút phát video).
   - [ ] **2. Touch & Interaction (P0):** Mọi nút bấm/tab có vùng chạm tối thiểu `44x44px`, đủ 5 trạng thái (`default`, `hover`, `active`, `focus-visible`, `disabled/loading`).
   - [ ] **3. Performance & CLS (P1):** Mọi thẻ `<img>` và `<video>` đều khóa `aspect-ratio` để `CLS = 0`.
   - [ ] **4. Anti-Slop Aesthetics (P0):** Không gradient tím, không chữ gradient, không dark-glow, không side-tab 4px.
   - [ ] **5. Responsive & Mobile-First (P1):** Không tràn ngang (`overflow-x`), thanh hành động mua khóa học chuyển thành Bottom Sticky Bar trên Mobile (`< 768px`).
   - [ ] **6. Typography & Numeric (P1):** Dòng văn bản `<= 75ch`, bật `tabular-nums` cho mọi con số.
   - [ ] **7. Purposeful Motion (P2):** Thời lượng chuyển cảnh `150ms–300ms`, tôn trọng `@media (prefers-reduced-motion: reduce)`.
   - [ ] **8. Forms & Quiz Feedback (P1):** Nhãn (`<label>`) luôn hiển thị rõ, thông báo lỗi/đúng-sai ngay tại câu hỏi với giải thích trực quan.
   - [ ] **9. Navigation & Wayfinding (P1):** Học viên luôn biết mình đang ở Bài mấy / Chương mấy và quay lại trang trước chỉ với 1 cú nhấp.
   - [ ] **10. Data & Progress Visualization (P2):** Biểu đồ tiến độ học tập dùng màu ngữ nghĩa (`--accent-learning`, `--accent-streak`) kèm nhãn số liệu rõ ràng, không phụ thuộc duy nhất vào màu sắc.
