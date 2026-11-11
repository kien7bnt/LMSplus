# Page Blueprint: Course Detail & Enrollment (`course-detail`)
> **Inherits from:** [`../MASTER.md`](../MASTER.md)
> **Default Theme:** `airbnb-light`

---

## 1. Layout Architecture (Airbnb Listing Detail Pattern)

- **Max Container Width:** `1120px` centered (`padding: 0 24px` mobile, `0 40px` desktop).
- **Section 1 — Title & Trust Header:**
  - Course Title (`--text-h1`, `26px–32px`, `font-weight: 600`).
  - Metadata Row: `★ 4.96` · `342 đánh giá xác thực` · `Học viên yêu thích` badge · `Cập nhật tháng 11/2026` + Share & Save action buttons on the right.
- **Section 2 — Media Bento Showcase (`border-radius: 20px`, `overflow: hidden`, `gap: 8px`):**
  - Left `60%`: Interactive Course Trailer Video preview with custom play button (`64x64px` pill/circle).
  - Right `40%`: 2×2 grid of real project outcomes, syllabus snapshots, and certificate preview.
- **Section 3 — Asymmetric 2-Column Body (`gap: 48px`, `margin-top: 40px`):**
  - **Left Column (`62%` width):**
    1. **Instructor Summary Bar:** "Giảng dạy bởi **TS. Lê Hoàng Nam** · Principal Engineer" with `56x56px` avatar right-aligned, separated by `1px solid var(--border-subtle)`.
    2. **Course Highlights (3 Key Pillars):** Icon (`24x24px` left) + Title (`16px` bold) + 1-line description (`14px` `--text-secondary`). (No `icon-tile-stack` boxes!).
    3. **What You Will Build / Learn:** 2-column checklist with `65ch` max width per item.
    4. **Interactive Syllabus Accordion:** Chapter header with lesson count & total duration (`tabular-nums`), expandable lesson rows with free preview tags.
  - **Right Column (`34%` width) — Sticky Enrollment Card:**
    - `position: sticky; top: 104px; border-radius: 16px; padding: 24px; border: 1px solid var(--border-strong); box-shadow: var(--shadow-floating); background: var(--bg-surface);`
    - Price lockup (`1.490.000₫` bold `24px` + original price strikethrough).
    - Cohort / Access Selector box (`border: 1px solid var(--border-strong)`, `border-radius: 12px`, split into 2 cells like Airbnb Check-in/Check-out: `Gói học` & `Quyền truy cập`).
    - Primary CTA button (`100%` width, `height: 52px`, `--brand-primary`, `font-size: 16px`, `font-weight: 600`).
    - Price breakdown & 30-day guarantee note (`14px`, `--text-secondary`).
- **Mobile Adaptation (`< 768px`):**
  - Right-rail card collapses into a **Fixed Bottom Enrollment Bar** (`height: 80px`, `padding: 12px 24px`, `border-top: 1px solid var(--border-subtle)`) showing Price on left + "Đăng ký ngay" CTA on right.
