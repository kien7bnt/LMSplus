#!/usr/bin/env python3
"""
Impeccable × UI/UX Pro Max × Airbnb DLS — Deterministic Audit Scanner
Scans HTML, CSS, JSX, TSX, and Vue files for AI-slop patterns, token violations,
and accessibility issues in the LMS E-Learning repository.
"""

import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

RULES: List[Tuple[str, str, str, re.Pattern, str]] = [
    (
        "P0",
        "no-purple-gradient",
        "AI-Slop Purple/Indigo/Violet Gradient detected",
        re.compile(
            r"(from-(?:purple|indigo|violet|fuchsia)-\d+|via-(?:purple|indigo|violet)-\d+|"
            r"linear-gradient\([^)]*(?:#8b5cf6|#6366f1|#a855f7|purple|indigo|violet)[^)]*\))",
            re.IGNORECASE,
        ),
        "Replace with clean semantic surfaces (var(--bg-canvas), var(--bg-surface-subtle)) or var(--brand-primary).",
    ),
    (
        "P0",
        "no-gradient-text",
        "Clipped gradient text (bg-clip-text + text-transparent) detected",
        re.compile(
            r"(bg-clip-text|background-clip:\s*text)",
            re.IGNORECASE,
        ),
        "Use solid high-contrast ink color var(--text-primary) (#222222 in light, #F5F5F7 in dark).",
    ),
    (
        "P0",
        "no-dark-glow",
        "Neon glowing box-shadow (dark-glow) detected",
        re.compile(
            r"box-shadow:\s*0(?:px)?\s+0(?:px)?\s+(?:1[6-9]|[2-9]\d|\d{3,})px\s+rgba\(\s*(?:56|139|168|99|236)",
            re.IGNORECASE,
        ),
        "Use Airbnb multi-layer ambient shadow tokens (var(--shadow-card), var(--shadow-floating)) and 1px hairline borders.",
    ),
    (
        "P1",
        "no-side-tab",
        "4px colored side-tab border (border-l-4 / border-left: 4px) detected",
        re.compile(
            r"(\bborder-l-[48]\b|border-left:\s*[3-8]px\s+solid)",
            re.IGNORECASE,
        ),
        "Use a full 1px solid var(--border-subtle) container with border-radius: 12px (var(--radius-md)).",
    ),
    (
        "P1",
        "no-overused-font",
        "Generic default font family (Arial / Roboto) detected",
        re.compile(
            r"font-family:\s*['\"]?(?:Arial|Roboto|Comic Sans)",
            re.IGNORECASE,
        ),
        "Use var(--font-sans) ('Plus Jakarta Sans'), var(--font-serif) ('Source Serif 4'), or var(--font-mono) ('JetBrains Mono').",
    ),
    (
        "P2",
        "no-bounce-easing",
        "Cartoonish bounce/overshoot cubic-bezier easing detected",
        re.compile(
            r"cubic-bezier\(\s*0\.\d+\s*,\s*-\d+\.\d+\s*,\s*0\.\d+\s*,\s*1\.[3-9]\d*\s*\)",
            re.IGNORECASE,
        ),
        "Use Airbnb physical easing: var(--ease-standard) cubic-bezier(0.2, 0, 0, 1) or var(--ease-out-expo) cubic-bezier(0.16, 1, 0.3, 1).",
    ),
    (
        "P1",
        "no-focus-removal",
        "Focus ring removed (outline: none / outline-none) without focus-visible replacement",
        re.compile(
            r"(outline:\s*none\s*;|\boutline-none\b)(?!.*focus-visible)",
            re.IGNORECASE,
        ),
        "Preserve accessibility: pair with :focus-visible outline using var(--text-primary) or var(--brand-primary).",
    ),
]

SUPPORTED_EXTENSIONS = {".html", ".css", ".scss", ".jsx", ".tsx", ".vue"}
IGNORE_DIRS = {"node_modules", ".git", ".next", "dist", "build", ".agents"}


def scan_file(filepath: Path) -> List[Tuple[int, str, str, str, str]]:
    findings = []
    try:
        content = filepath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return findings

    lines = content.splitlines()
    for idx, line in enumerate(lines, start=1):
        # Allow explicit ignore comment on the line
        if "impeccable-ignore" in line:
            continue
        for severity, rule_id, message, pattern, fix in RULES:
            if pattern.search(line):
                findings.append((idx, severity, rule_id, message, fix))
    return findings


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    files_to_scan: List[Path] = []

    if target.is_file():
        files_to_scan.append(target)
    else:
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            for f in files:
                p = Path(root) / f
                if p.suffix.lower() in SUPPORTED_EXTENSIONS:
                    files_to_scan.append(p)

    total_issues = 0
    p0_count = 0
    p1_count = 0

    print("=" * 72)
    print("IMPECCABLE × UI/UX PRO MAX × AIRBNB DLS — AUDIT REPORT")
    print("=" * 72)

    for fpath in files_to_scan:
        issues = scan_file(fpath)
        if issues:
            print(f"\n[FILE] {fpath}")
            for line_no, sev, rule_id, msg, fix in issues:
                total_issues += 1
                if sev == "P0":
                    p0_count += 1
                elif sev == "P1":
                    p1_count += 1
                print(f"  Line {line_no:4d} | [{sev}] {rule_id}: {msg}")
                print(f"            └─ Fix: {fix}")

    print("\n" + "-" * 72)
    print(
        f"Scanned {len(files_to_scan)} file(s) | Total Issues: {total_issues} "
        f"(P0 Critical: {p0_count}, P1 High: {p1_count})"
    )
    if total_issues == 0:
        print("STATUS: PASS — 100% Impeccable & Airbnb DLS Compliant!")
        print("=" * 72)
        return 0
    else:
        print("STATUS: ACTION REQUIRED — Resolve P0/P1 issues before delivery.")
        print("=" * 72)
        return 1 if (p0_count > 0 or p1_count > 0) else 0


if __name__ == "__main__":
    sys.exit(main())
