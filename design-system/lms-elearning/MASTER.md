# MASTER DESIGN SYSTEM — LMS E-Learning (`lms-elearning`)
> **Generated & Governed by:** `UI/UX Pro Max` × `Impeccable` × `Airbnb DLS` × `Multi-Theme Engine`
> **Hierarchy Rule:** This file is the Single Source of Truth for all pages. Page-specific files in `design-system/lms-elearning/pages/*.md` extend or override specific layout rules for their respective routes.

---

## 1. Product Profile & Aesthetic Direction

- **Domain:** Next-Generation Learning Management System (LMS) & Creator Marketplace (Video Courses, Live Cohorts, Interactive Coding/Quizzes, Certifications).
- **Primary Aesthetic Archetype:** **Airbnb DLS (Warm Marketplace & Human Belonging)** blended with **Impeccable Editorial Clarity**.
- **Why this works for LMS:**
  - Students choosing a course face the same trust & discovery friction as travelers booking a stay: they care about **Who is the Instructor (Host)?**, **What does the experience look like (Preview)?**, **What do past learners say (Verified Reviews)?**, and **Is the learning environment comfortable for hours of study?**
  - **Discovery Mode (`airbnb-light`):** Crisp white canvas (`#FFFFFF`), warm secondary surfaces (`#F7F7F7`), deep charcoal ink (`#222222`), and high-energy Rausch Coral (`#FF385C`) for primary enrollment actions.
  - **Learning / Cinema Mode (`cinema-dark`):** Restful warm obsidian surfaces (`#121214` / `#1A1A1E`) with Babu Teal (`#00C2B3`) progress feedback to prevent eye strain during long video lectures or coding exercises.

---

## 2. Master Token Matrix

### 2.1. Color Palette (3-Tier Semantic Tokens)

| Semantic Token | Light (`airbnb-light`) | Dark (`cinema-dark`) | Babu Theme (`babu-academy`) | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#FFFFFF` | `#121214` | `#FFFFFF` | Root page background |
| `--bg-surface` | `#FFFFFF` | `#1A1A1E` | `#FFFFFF` | Elevated cards, modals, sticky panels |
| `--bg-surface-subtle` | `#F7F7F7` | `#222228` | `#F4F9F9` | Filter pills, secondary blocks, code blocks |
| `--bg-surface-hover` | `#F0F0F0` | `#2A2A32` | `#E8F3F2` | Hover state for interactive rows/items |
| `--text-primary` | `#222222` | `#F5F5F7` | `#1D2B2A` | Headings, course titles, prices, primary copy |
| `--text-secondary` | `#717171` | `#A1A1AA` | `#5E7170` | Instructor names, metadata, subtitles |
| `--text-muted` | `#8A8A8A` | `#71717A` | `#849695` | Placeholders, disabled text, captions |
| `--border-subtle` | `#EBEBEB` | `rgba(255,255,255,0.08)` | `#E2ECEB` | Hairline dividers, syllabus row borders |
| `--border-strong` | `#DDDDDD` | `rgba(255,255,255,0.16)` | `#C8D9D7` | Input borders, search pill border, secondary buttons |
| `--brand-primary` | `#FF385C` | `#FF385C` | `#008489` | Primary CTA ("Enroll Now", Search button) |
| `--brand-primary-hover` | `#E00B41` | `#FF5A5F` | `#006C70` | Primary CTA hover state |
| `--accent-learning` | `#00A699` | `#00C2B3` | `#00A699` | Progress bars, completed badges, correct quiz state |
| `--accent-streak` | `#FC642D` | `#FF7E47` | `#FC642D` | Streak flames, "Bestseller" / "Live Soon" accent |
| `--status-success` | `#008A05` | `#2ECC71` | `#008A05` | Passed exam, certificate verified |
| `--status-warning` | `#E07912` | `#F39C12` | `#E07912` | Deadline approaching, quiz time low |
| `--status-danger` | `#C13515` | `#FF5A5F` | `#C13515` | Form error, failed quiz attempt |

### 2.2. Typography Scale & Pairing

- **Primary UI & Headings (`--font-sans`):** `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif`
- **Long-form Reading / Lesson Notes (`--font-serif`):** `'Source Serif 4', Georgia, serif`
- **Code, Timestamps & Metrics (`--font-mono`):** `'JetBrains Mono', monospace`

| Role | Token | Size (Fluid / Fixed) | Weight | Line Height | Tracking |
| :--- | :--- | :--- | :---: | :---: | :---: |
| Display Hero | `--text-display` | `clamp(2rem, 3.5vw, 3rem)` | `700` | `1.12` | `-0.025em` |
| Page Heading (H1) | `--text-h1` | `clamp(1.625rem, 2.5vw, 2.25rem)` | `600` | `1.20` | `-0.020em` |
| Section Heading (H2) | `--text-h2` | `clamp(1.375rem, 2vw, 1.625rem)` | `600` | `1.28` | `-0.015em` |
| Subsection / Module (H3) | `--text-h3` | `1.125rem` (`18px`) | `600` | `1.35` | `-0.010em` |
| Listing Card Title | `--text-card-title` | `0.9375rem` (`15px`) | `600` | `1.35` | `-0.005em` |
| Body Standard | `--text-body` | `1rem` (`16px`) | `400` | `1.60` | `0` |
| Body Secondary / UI | `--text-sm` | `0.875rem` (`14px`) | `400` / `500` | `1.45` | `0` |
| Micro Badge / Overline | `--text-xs` | `0.75rem` (`12px`) | `600` | `1.30` | `0.04em` |

### 2.3. Spacing, Grid & Radii (4px Base Unit)

- **Spacing Scale:** `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `40px`, `48px`, `64px`, `80px`.
- **Border Radii:**
  - `--radius-xs`: `6px`
  - `--radius-sm`: `8px`
  - `--radius-md`: `12px`
  - `--radius-lg`: `16px` (Standard Course Card image & Sticky Pricing Box)
  - `--radius-xl`: `24px` (Modals, Video theatre frame)
  - `--radius-pill`: `9999px` (Search Pill, Category filter chips, Avatars)
- **Motion Easing:**
  - `--ease-standard`: `cubic-bezier(0.2, 0, 0, 1)` (`200ms`)
  - `--ease-out-expo`: `cubic-bezier(0.16, 1, 0.3, 1)` (`300ms` for drawers/modals)

---

## 3. Core Component Blueprints

### 3.1. Navigation Header & Airbnb Pill Search
- **Height:** `80px` desktop, `64px` mobile. Sticky top with `1px solid var(--border-subtle)` and `backdrop-filter: blur(12px)` only on scroll (`background: color-mix(in srgb, var(--bg-canvas) 92%, transparent)`).
- **Center Pill Search:** `height: 48px` (compact) or `64px` (expanded hero), `border-radius: 9999px`, `border: 1px solid var(--border-strong)`, `box-shadow: var(--shadow-card)`. Hovering elevates shadow to `--shadow-card-hover`.

### 3.2. Course Listing Card (Airbnb Zero-Chrome Pattern)
- **Outer Wrapper:** Transparent background, `border: none`, `box-shadow: none`, `display: flex`, `flex-direction: column`, `gap: 12px`, `cursor: pointer`.
- **Thumbnail Frame:** `aspect-ratio: 16 / 10`, `border-radius: 16px`, `overflow: hidden`, `position: relative`, `background: var(--bg-surface-subtle)`.
- **Meta Layout:**
  - Row 1: Course Title (`15px`, `font-weight: 600`, `--text-primary`, `line-clamp: 1`) + Rating (`★ 4.94`, `14px`, `tabular-nums`, `--text-primary`).
  - Row 2: Instructor & Level (`14px`, `--text-secondary`).
  - Row 3: Duration & Lesson count (`14px`, `--text-secondary`, `tabular-nums`).
  - Row 4: Price (`15px`, `font-weight: 600`, `--text-primary`) + unit (`/ trọn đời` or `/ lộ trình`).

### 3.3. Interactive Buttons & Touch Targets
- **Minimum Touch Target:** `44px × 44px` on all devices.
- **Primary CTA (`.btn-primary`):** Background `var(--brand-primary)`, text `#FFFFFF`, `height: 48px`, `padding: 0 24px`, `border-radius: 8px` (or `9999px` for pill actions), `font-weight: 600`, active state `scale(0.98)`.
- **Secondary Action (`.btn-secondary`):** Background `var(--bg-surface)`, text `var(--text-primary)`, `border: 1px solid var(--text-primary)` (Airbnb high-contrast outline button), `height: 48px`, hover background `var(--bg-surface-subtle)`.

---

## 4. Page-Specific Overrides Index

Check the following files when building specific views:
1. [`pages/course-discovery.md`](./pages/course-discovery.md) — Catalog, Hero Pill Search, Horizontal Category Rail, 4-Column Responsive Course Grid.
2. [`pages/course-detail.md`](./pages/course-detail.md) — Bento Media Header, 62/34 Split Layout, Sticky Right-Rail Enrollment Card, Curriculum Accordion, Verified Reviews.
3. [`pages/learning-player.md`](./pages/learning-player.md) — Cinema Dark Mode Default, 16:9 Theater Video Player, Collapsible Curriculum Drawer, Interactive Quiz & Notes.
4. [`pages/student-dashboard.md`](./pages/student-dashboard.md) — Continue Learning Rail, Streak & Mastery Bento, Accessible Progress Charts.
