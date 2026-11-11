# Page Blueprint: Student Learning Dashboard (`student-dashboard`)
> **Inherits from:** [`../MASTER.md`](../MASTER.md)
> **Default Theme:** `airbnb-light` / User preference

---

## 1. Layout Architecture

- **Max Container Width:** `1280px` centered (`padding: 32px 40px`).
- **Section 1 — Personal Greeting & Streak Pill:**
  - Left: Greeting (`Chào buổi sáng, Minh Anh`) + Subtitle (`Bạn còn 1 bài giảng nữa để hoàn thành mục tiêu tuần này`).
  - Right: Streak & XP Pill (`border-radius: 9999px`, `padding: 8px 16px`, `border: 1px solid var(--border-strong)`, `--accent-streak` flame icon + `12 ngày liên tiếp` in `tabular-nums`).
- **Section 2 — "Học tiếp" (Continue Learning Hero Card):**
  - Horizontal split card (`border-radius: 20px`, `border: 1px solid var(--border-subtle)`, `padding: 24px`, `background: var(--bg-surface)`, `box-shadow: var(--shadow-card)`).
  - Shows exact lesson timestamp left off (`Bài 08: Kiến trúc Micro-frontend • Còn 11 phút`), progress bar (`height: 8px`, `border-radius: 9999px`, fill `var(--accent-learning)`), and direct `Tiếp tục học` CTA.
- **Section 3 — Learning Analytics & Skill Mastery:**
  - Uses clean bar/activity charts with explicit text labels and `tabular-nums` (never relying on color hue alone).
  - Avoids `hero-metric` slop (no giant 64px numbers floating in 4 identical boxes). Groups metrics meaningfully inside a cohesive Activity Summary module.
