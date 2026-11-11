# Page Blueprint: Course Discovery & Catalog (`course-discovery`)
> **Inherits from:** [`../MASTER.md`](../MASTER.md)
> **Default Theme:** `airbnb-light` (Supports instant switch to `cinema-dark` or `babu-academy`)

---

## 1. Layout Architecture

- **Max Container Width:** `1440px` centered, horizontal padding `24px` (Mobile), `40px` (Tablet), `80px` (Desktop).
- **Vertical Structure:**
  1. **Sticky Top Navigation (`80px`):** Brand logo left, Airbnb Pill Search Bar center (`max-width: 850px` when expanded), User Profile & Theme Switcher pill right.
  2. **Sticky Category Filter Rail (`78px`):** Horizontally scrollable icon+label tabs (`AI & Data`, `Product Design`, `Fullstack Eng`, `Business Strategy`, `Cloud & DevOps`, `Creative Arts`, `IELTS & Languages`) + right-side "Bộ lọc nâng cao" (`Filter` button with `1px solid var(--border-strong)`).
  3. **Featured Learning Path Banner (Optional Bento):** 2-column asymmetric card (`border-radius: 24px`, `background: var(--bg-surface-subtle)`), never using generic purple gradients.
  4. **Primary Course Grid:**
     - Mobile (`< 640px`): `1 column`, `gap: 32px`
     - Tablet (`640px–1023px`): `2 columns`, `gap: 24px`
     - Laptop (`1024px–1279px`): `3 columns`, `gap: 24px`
     - Desktop (`>= 1280px`): `4 columns`, `column-gap: 24px`, `row-gap: 40px`

---

## 2. Specific Component Rules

- **Airbnb Pill Search Bar Segments:**
  - Segment 1 (`Chủ đề`): Text input / quick suggestions.
  - Segment 2 (`Cấp độ`): Beginner / Intermediate / Advanced.
  - Segment 3 (`Hình thức`): Self-paced Video / Live Cohort / Mentor 1-1.
  - Action Button: `48x48px` circle (`--brand-primary`), icon `20x20px` white.
- **Course Card Image Discipline:**
  - Every card thumbnail **must** declare `aspect-ratio: 16 / 10` and `border-radius: 16px`.
  - Do not place more than 1 badge on the top-left of the thumbnail (`Học viên yêu thích` or `Mới cập nhật`).
  - Wishlist heart button on top-right must have `44x44px` hit area and `aria-label="Lưu khóa học vào danh sách yêu thích"`.
