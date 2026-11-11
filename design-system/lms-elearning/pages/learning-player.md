# Page Blueprint: Distraction-Free Learning Player (`learning-player`)
> **Inherits from:** [`../MASTER.md`](../MASTER.md)
> **Default Theme:** `cinema-dark` (Warm Obsidian `#121214` to reduce eye fatigue during study)

---

## 1. Layout Architecture

- **Full-Viewport App Shell (`100vw × 100dvh`):**
  1. **Compact Learning Topbar (`56px` height):**
     - Left: Back to Course button (`44x44px` hit target) + Course Title (`15px`, `font-weight: 600`).
     - Right: Circular/Linear Progress Indicator (`--accent-learning` `#00C2B3`, e.g., `14/24 bài hoàn thành • 58%`) + "Chế độ Rạp chiếu (Focus)" toggle + Theme toggle.
  2. **Main Split Workspace (`calc(100dvh - 56px)`):**
     - **Left/Center Stage (`flex: 1`, scrollable):**
       - `16:9` Video / Interactive Lab container (`background: #09090B`, `border-radius: 16px` in standard mode, `0px` in theater mode).
       - Below Player: Tab bar (`Tổng quan bài học`, `Tài liệu & Code`, `Ghi chú theo mốc thời gian (04:12)`, `Thảo luận Q&A`).
       - Reading content area strictly constrained to `max-width: 70ch`, `line-height: 1.65`.
     - **Right Curriculum Sidebar (`380px` width, collapsible on desktop, bottom-sheet on mobile):**
       - Border left `1px solid var(--border-subtle)`, background `var(--bg-surface)`.
       - Active lesson highlighted with `background: var(--bg-surface-hover)` and a subtle `var(--accent-learning)` play badge (never a harsh neon border).
       - Checkboxes for completed lessons must have `44x44px` touch targets and smooth SVG checkmark transitions.
