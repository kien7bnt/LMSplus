# Impeccable Anti-Slop Catalog & Remediation Guide

This reference details the deterministic rules enforced by the **Impeccable** design engine (`pbakaus/impeccable`) adapted for **LMS E-Learning** with **Airbnb DLS**.

---

## P0 — Critical Blockers (Must Never Ship)

### 1. `purple-gradient` (AI Slop Gradient Obsession)
- **Symptom:** Backgrounds, hero banners, or buttons using `linear-gradient` with purple, indigo, violet, or neon cyan (`from-indigo-500 via-purple-500 to-pink-500`).
- **Why it fails:** Immediately signals an unedited LLM output and clashes with Airbnb's warm, photography-first aesthetic.
- **Remediation:**
  - ❌ `class="bg-gradient-to-r from-purple-600 to-indigo-600 text-white"`
  - ✅ Use clean `var(--bg-canvas)` (`#FFFFFF` / `#121214`), warm `var(--bg-surface-subtle)` (`#F7F7F7`), or the restrained Airbnb Rausch CTA token `var(--brand-primary)` (`#FF385C`).

### 2. `gradient-text` (Clipped Gradient Headings)
- **Symptom:** Using `background-clip: text; color: transparent` on `h1`/`h2` headings.
- **Why it fails:** Reduces legibility, breaks high-contrast accessibility modes, and looks dated.
- **Remediation:**
  - ❌ `<h1 class="bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">`
  - ✅ `<h1 style="color: var(--text-primary); letter-spacing: -0.025em;">`

### 3. `dark-glow` (Neon Halos in Dark Mode)
- **Symptom:** Colored glowing drop shadows (`box-shadow: 0 0 24px rgba(56, 189, 248, 0.4)`) in dark mode.
- **Why it fails:** Causes visual halation (astigmatism blur) when students watch lectures at night.
- **Remediation:**
  - ❌ `box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);`
  - ✅ Separate dark mode surfaces using **Surface Luminance** (`#121214` canvas → `#1A1A1E` card → `#222228` elevated element) plus a crisp hairline border `1px solid var(--border-subtle)` (`rgba(255,255,255,0.08)`).

### 4. `gray-on-color` & `low-contrast` (WCAG AA Failure)
- **Symptom:** Placing `#717171` or `#9CA3AF` gray text on colored banners or directly over course thumbnail images.
- **Remediation:**
  - Ensure body text contrast `>= 4.5:1` and large text `>= 3.0:1`.
  - When overlaying duration or badges on course thumbnails, use a solid pill (`background: rgba(255,255,255,0.92); color: #222222`) or dark scrim (`background: rgba(18,18,20,0.78); color: #FFFFFF`).

---

## P1 — Structural & Typography Anti-Patterns

### 5. `side-tab` (Left-Border Callout Slop)
- **Symptom:** `border-left: 4px solid #3b82f6` on course notes, hints, or alerts.
- **Remediation:**
  - Use a full `1px solid` semantic border with `border-radius: 12px` (`var(--radius-md)`), `padding: 16px`, and an inline SVG icon aligned with the first line of text.

### 6. `cards-in-cards` (Nested Box Clutter)
- **Symptom:** Putting a bordered course card inside another bordered container with gray background and drop shadow.
- **Remediation (Airbnb Zero-Chrome Law):**
  - On discovery grids, course cards have **no outer border, no outer background, and no outer box-shadow**. The `16px` rounded thumbnail image defines the upper boundary, and clean `15px` / `14px` typography sits directly on the canvas below it (`margin-top: 12px`).

### 7. `icon-tile-stack` (Generic 3-Column Feature Boxes)
- **Symptom:** Three identical cards side-by-side, each starting with a `48x48px` pastel square containing a generic icon, followed by a centered title and 2 lines of lorem-style copy.
- **Remediation:**
  - Use Airbnb's **Highlight Row Pattern** (horizontal list with crisp `24x24px` 1.75px-stroke outline icon on the left, bold `16px` title + `14px` muted subtitle on the right) or an **Asymmetric Bento Grid** showcasing actual course UI previews.

### 8. `flat-type-hierarchy` & `long-lines`
- **Symptom:** `h1`, `h2`, and `p` all sit between `16px` and `20px`; lesson text stretches across a `1200px` container.
- **Remediation:**
  - Enforce fluid display/heading scales (`--text-display`, `--text-h1`, `--text-h2`) and constrain lesson prose to `max-width: 68ch`.

---

## P2 — Interaction & Motion Anti-Patterns

### 9. `bounce-easing` & `layout-thrash-animation`
- **Symptom:** Animating `width`, `height`, `top`, `left`, or using cartoonish spring/overshoot curves (`cubic-bezier(0.68, -0.6, 0.32, 1.6)`).
- **Remediation:**
  - Animate only `transform` and `opacity` using `var(--ease-standard)` (`cubic-bezier(0.2, 0, 0, 1)`).
  - Always include `@media (prefers-reduced-motion: reduce)` fallback.
