# UI/UX Pro Max — 10-Priority Verification Checklist for LMS E-Learning

Before marking any UI task complete, verify compliance across these 10 ordered priority tiers:

## Priority 1: Accessibility (CRITICAL — P0)
- [ ] Normal text contrast ratio `>= 4.5:1`; large headings/UI components `>= 3.0:1` in both `airbnb-light` and `cinema-dark`.
- [ ] All icon-only buttons (Wishlist heart, Play/Pause, Volume, Close modal, Collapse sidebar) have descriptive `aria-label`.
- [ ] Visible `:focus-visible` ring (`2px solid var(--text-primary)` with `2px` offset) preserved on all interactive elements (never `outline: none` without replacement).
- [ ] Semantic HTML landmarks used (`<header>`, `<nav>`, `<main>`, `<aside>`, `<article>`, `<section>`).

## Priority 2: Touch Targets & Micro-States (CRITICAL — P0)
- [ ] Every clickable/tappable element has a minimum hit area of **`44px × 44px`**.
- [ ] Minimum `8px` gap between adjacent interactive controls (e.g., video player controls, pagination, filter pills).
- [ ] Every interactive component implements all 5 states: `default`, `hover`, `active` (`scale(0.98)`), `focus-visible`, and `disabled` / `loading` (skeleton or spinner).

## Priority 3: Performance & Layout Stability (HIGH — P1)
- [ ] Every course thumbnail (`16:10` or `4:3`), instructor avatar (`1:1`), and video player (`16:9`) explicitly sets `aspect-ratio` to guarantee **CLS < 0.1**.
- [ ] Below-the-fold course images include `loading="lazy"` and `decoding="async"`.
- [ ] Skeleton placeholders match the exact dimensions and border-radius (`16px`) of loaded course cards.

## Priority 4: Style & Icon Consistency (HIGH — P1)
- [ ] Zero raw emojis used as structural UI icons (only allowed intentionally inside user-generated reactions or specific gamification badges if requested).
- [ ] SVG icons share a unified stroke width (`1.75px` or `2px`), `stroke-linecap="round"`, `stroke-linejoin="round"`.
- [ ] Course cards follow Airbnb's Zero-Chrome rule on catalog grids.

## Priority 5: Responsive & Adaptive Ergonomics (HIGH — P1)
- [ ] Zero horizontal overflow (`overflow-x: hidden` not masking accidental overflow) from `320px` mobile up to `1920px` desktop.
- [ ] Course Detail right-rail enrollment card converts to a sticky bottom bar on viewports `< 768px`.
- [ ] Category rail scrolls horizontally with smooth touch momentum and hides ugly scrollbars (`scrollbar-width: none`).

## Priority 6: Typography, Measure & Numeric Discipline (MEDIUM — P1)
- [ ] Base body size `16px` (`1rem`), course card title `15px` (`0.9375rem`, weight `600`).
- [ ] Reading measure for lesson notes, descriptions, and Q&A capped at **`60ch–75ch`**.
- [ ] `font-variant-numeric: tabular-nums` applied to all prices, ratings, durations, countdowns, and progress percentages.

## Priority 7: Purposeful Motion (MEDIUM — P2)
- [ ] Micro-interactions complete within `150ms–300ms` using `cubic-bezier(0.2, 0, 0, 1)`.
- [ ] Global `@media (prefers-reduced-motion: reduce)` rule disables non-essential motion and smooth scrolling.

## Priority 8: Forms, Search & Quiz Feedback (MEDIUM — P1)
- [ ] Inputs always keep visible labels (or Airbnb stacked label inside pill/box: `11px` bold uppercase/label on top, `14px` value below).
- [ ] Quiz options show immediate, accessible state feedback (Correct = `--accent-learning` border + icon + explanation block; Incorrect = `--status-danger` border + constructive hint).

## Priority 9: Navigation & Learning Wayfinding (HIGH — P1)
- [ ] Breadcrumbs or clear Back action always visible in Course Detail and Learning Player.
- [ ] Active category tab and active lesson row clearly indicated by both typography weight and structural indicator (`2px` bottom bar or active badge).

## Priority 10: Data, Progress & Streak Clarity (LOW — P2)
- [ ] Progress bars pair visual fill (`--accent-learning`) with explicit text (`14/20 bài học • 70%`).
- [ ] Dashboard charts avoid decorative gradients and include clear axis/tooltip labels.
