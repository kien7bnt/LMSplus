---
name: ui-ux-standard
description: >-
  Use this skill whenever the user asks to design, build, style, refactor, critique, audit, or polish any frontend UI/UX component, page, or theme in the LMS E-Learning project. Combines UI/UX Pro Max (10-priority checklist & MASTER.md blueprint), Impeccable (anti-AI-slop rules & /impeccable commands), Airbnb Design Language System (DLS), and the 3-tier Multi-Theme Token System.
---

# UI/UX Pro Max × Impeccable × Airbnb DLS × Theme Skill

This skill enforces a production-grade UI/UX workflow for **LMS E-Learning**, combining:
1. **UI/UX Pro Max:** Design-system-first architecture (`design-system/lms-elearning/MASTER.md`) and the 10-Pillar Priority Checklist.
2. **Impeccable:** Deterministic anti-"AI slop" rules and action commands (`critique`, `audit`, `polish`, `typeset`, `colorize`, `animate`, `distill`, `bolder`, `quieter`).
3. **Airbnb DLS:** Warm, human-centric, content-first marketplace & learning experience (`#FF385C` Rausch, `#00A699` Babu, `#222222` Hof, 4px/8px grid, Pill Search, Zero-chrome Course Cards).
4. **3-Tier Multi-Theme Engine:** Semantic tokens supporting `airbnb-light`, `cinema-dark` (for distraction-free video study), and `babu-academy`.

---

## 1. Execution Workflow (4 Mandatory Phases)

### Phase 1: Blueprint Resolution (`UI/UX Pro Max`)
1. Read [`design-system/lms-elearning/MASTER.md`](../../../design-system/lms-elearning/MASTER.md).
2. Check if a route-specific override exists in `design-system/lms-elearning/pages/`:
   - Catalog / Search: [`course-discovery.md`](../../../design-system/lms-elearning/pages/course-discovery.md)
   - Course Landing / Enrollment: [`course-detail.md`](../../../design-system/lms-elearning/pages/course-detail.md)
   - Video Lecture / Quiz Player: [`learning-player.md`](../../../design-system/lms-elearning/pages/learning-player.md)
   - Learner Home / Analytics: [`student-dashboard.md`](../../../design-system/lms-elearning/pages/student-dashboard.md)

### Phase 2: Theme & Token Binding
1. Import or reference CSS custom properties from [`theme/tokens.css`](../../../theme/tokens.css) or Tailwind classes from [`theme/tailwind.preset.js`](../../../theme/tailwind.preset.js).
2. **Never hardcode raw Hex colors** inside components. Always use semantic tokens (`var(--bg-canvas)`, `var(--bg-surface)`, `var(--text-primary)`, `var(--brand-primary)`, `var(--accent-learning)`).

### Phase 3: Impeccable Craft & Anti-Slop Enforcement
Consult [`references/impeccable-anti-slop.md`](./references/impeccable-anti-slop.md) when writing markup and styles. Ensure zero occurrences of:
- `purple-gradient` (`from-indigo-* via-purple-*`)
- `gradient-text` (`bg-clip-text text-transparent`)
- `side-tab` (`border-l-4` alert boxes)
- `dark-glow` (neon colored box-shadows in dark mode)
- `icon-tile-stack` (3 identical rounded-square icon boxes in a row)
- `flat-type-hierarchy` (headings `< 1.25x` body size)
- `gray-on-color` (low-contrast muted text on colored/image backgrounds)

### Phase 4: Automated Audit & 10-Pillar Verification
1. Run the deterministic audit script against all created/modified frontend files:
   ```powershell
   node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs <target-path>
   ```
2. Verify all items in [`references/ui-ux-promax-checklist.md`](./references/ui-ux-promax-checklist.md).

---

## 2. Supported `/impeccable` Command Playbooks

When the user invokes any of the following commands (or asks for the equivalent action), execute the corresponding playbook:

- **`/impeccable critique <target>`**: Score the UI from 0–100 across Visual Hierarchy, Airbnb DLS Fidelity, Anti-Slop Purity, and LMS Usability. List specific P0–P3 defects.
- **`/impeccable audit <target>`**: Run [`scripts/impeccable_audit.mjs`](./scripts/impeccable_audit.mjs) and inspect WCAG AA contrast, `44x44px` touch targets, `tabular-nums`, `aspect-ratio` CLS locks, and semantic token usage.
- **`/impeccable polish <target>`**: Refine micro-interactions, optical alignment, card image hover transitions (`scale(1.03)` over `300ms cubic-bezier(0.2, 0, 0, 1)`), hairline borders (`1px solid var(--border-subtle)`), and focus rings.
- **`/impeccable typeset <target>`**: Enforce the `Plus Jakarta Sans` + `Source Serif 4` + `JetBrains Mono` hierarchy, cap reading measure at `65ch–75ch`, fix orphan headings (`text-wrap: balance`), and enable `tabular-nums`.
- **`/impeccable colorize <target>`**: Replace hardcoded colors or AI-slop gradients with the 3-tier Airbnb/LMS semantic tokens (`--brand-primary`, `--accent-learning`, `--accent-streak`) and verify both `airbnb-light` and `cinema-dark` themes.
- **`/impeccable distill <target>`**: Strip unnecessary borders, nested card wrappers ("cards-in-cards"), and redundant badges so the course imagery and typography breathe.
