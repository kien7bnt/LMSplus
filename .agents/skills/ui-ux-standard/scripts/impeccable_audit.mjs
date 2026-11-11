#!/usr/bin/env node
/**
 * Impeccable × UI/UX Pro Max × Airbnb DLS — Deterministic Audit Scanner (Node.js)
 * Scans HTML, CSS, SCSS, JSX, TSX, and Vue files for AI-slop patterns, token violations,
 * and accessibility issues in the LMS E-Learning repository.
 */

import fs from 'node:fs';
import path from 'node:path';

const RULES = [
  {
    severity: 'P0',
    id: 'no-purple-gradient',
    message: 'AI-Slop Purple/Indigo/Violet Gradient detected',
    pattern: /(from-(?:purple|indigo|violet|fuchsia)-\d+|via-(?:purple|indigo|violet)-\d+|linear-gradient\([^)]*(?:#8b5cf6|#6366f1|#a855f7|purple|indigo|violet)[^)]*\))/i,
    fix: 'Replace with clean semantic surfaces (var(--bg-canvas), var(--bg-surface-subtle)) or var(--brand-primary).',
  },
  {
    severity: 'P0',
    id: 'no-gradient-text',
    message: 'Clipped gradient text (bg-clip-text + text-transparent) detected',
    pattern: /(bg-clip-text|background-clip:\s*text)/i,
    fix: 'Use solid high-contrast ink color var(--text-primary) (#222222 in light, #F5F5F7 in dark).',
  },
  {
    severity: 'P0',
    id: 'no-dark-glow',
    message: 'Neon glowing box-shadow (dark-glow) detected',
    pattern: /box-shadow:\s*0(?:px)?\s+0(?:px)?\s+(?:1[6-9]|[2-9]\d|\d{3,})px\s+rgba\(\s*(?:56|139|168|99|236)/i,
    fix: 'Use Airbnb multi-layer ambient shadow tokens (var(--shadow-card), var(--shadow-floating)) and 1px hairline borders.',
  },
  {
    severity: 'P1',
    id: 'no-side-tab',
    message: '4px colored side-tab border (border-l-4 / border-left: 4px) detected',
    pattern: /(\bborder-l-[48]\b|border-left:\s*[3-8]px\s+solid)/i,
    fix: 'Use a full 1px solid var(--border-subtle) container with border-radius: 12px (var(--radius-md)).',
  },
  {
    severity: 'P1',
    id: 'no-overused-font',
    message: 'Generic default font family (Arial / Roboto) detected',
    pattern: /font-family:\s*['"]?(?:Arial|Roboto|Comic Sans)/i,
    fix: "Use var(--font-sans) ('Plus Jakarta Sans'), var(--font-serif) ('Source Serif 4'), or var(--font-mono) ('JetBrains Mono').",
  },
  {
    severity: 'P2',
    id: 'no-bounce-easing',
    message: 'Cartoonish bounce/overshoot cubic-bezier easing detected',
    pattern: /cubic-bezier\(\s*0\.\d+\s*,\s*-\d+\.\d+\s*,\s*0\.\d+\s*,\s*1\.[3-9]\d*\s*\)/i,
    fix: 'Use Airbnb physical easing: var(--ease-standard) cubic-bezier(0.2, 0, 0, 1) or var(--ease-out-expo) cubic-bezier(0.16, 1, 0.3, 1).',
  },
  {
    severity: 'P1',
    id: 'no-focus-removal',
    message: 'Focus ring removed (outline: none / outline-none) without focus-visible replacement',
    pattern: /(outline:\s*none\s*;|\boutline-none\b)(?!.*focus-visible)/i,
    fix: 'Preserve accessibility: pair with :focus-visible outline using var(--border-focus) or var(--text-primary).',
  },
  {
    severity: 'P1',
    id: 'no-exposed-spec-codes',
    message: 'Internal spec code or debug badge exposed in UI text (LP-01, TW-05, Local State Fallback, SQL Seed)',
    pattern: /(\bLP-0[1-9]\b|\bTW-\d{2}\b|Local State Fallback|SQL Seed|UI\/UX Pro Max × Impeccable)/,
    fix: 'Use clean user-facing Vietnamese navigation labels and hide internal specification/debug codes.',
  },
  {
    severity: 'P1',
    id: 'no-exposed-db-keys',
    message: 'Internal database table name, JSON key, permission key, or raw enum exposed in UI copy',
    pattern: /(course_enrollment_requests|teaching_log_history|base_revision_number|lesson_unlock_rules|subject_class_id|\(STUDENT\)|\(INSTRUCTOR\)|\(ACADEMIC_STAFF\)|\(ADMIN\)|\(ASSIGNED_ONLY\)|\(REQUEST_APPROVAL\)|\(SELF_ENROLL\)|cờ\s+can_manage_materials|cờ\s+can_take_attendance)/,
    fix: 'Translate internal database/JSON/enum identifiers into natural Vietnamese domain terminology.',
  },
];

const SUPPORTED_EXTS = new Set(['.html', '.css', '.scss', '.jsx', '.tsx', '.vue']);
const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.agents']);

function collectFiles(targetPath, acc = []) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (SUPPORTED_EXTS.has(path.extname(targetPath).toLowerCase())) {
      acc.push(targetPath);
    }
    return acc;
  }
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        collectFiles(path.join(targetPath, entry.name), acc);
      }
    } else if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(path.join(targetPath, entry.name));
    }
  }
  return acc;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, idx) => {
    if (line.includes('impeccable-ignore')) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          line: idx + 1,
          severity: rule.severity,
          id: rule.id,
          message: rule.message,
          fix: rule.fix,
        });
      }
    }
  });
  return findings;
}

const target = process.argv[2] || '.';
const files = collectFiles(target);
let totalIssues = 0;
let p0Count = 0;
let p1Count = 0;

console.log('='.repeat(72));
console.log('IMPECCABLE x UI/UX PRO MAX x AIRBNB DLS — AUDIT REPORT');
console.log('='.repeat(72));

for (const file of files) {
  const issues = scanFile(file);
  if (issues.length > 0) {
    console.log(`\n[FILE] ${file}`);
    for (const issue of issues) {
      totalIssues++;
      if (issue.severity === 'P0') p0Count++;
      if (issue.severity === 'P1') p1Count++;
      console.log(`  Line ${String(issue.line).padStart(4, ' ')} | [${issue.severity}] ${issue.id}: ${issue.message}`);
      console.log(`            └─ Fix: ${issue.fix}`);
    }
  }
}

console.log('\n' + '-'.repeat(72));
console.log(`Scanned ${files.length} file(s) | Total Issues: ${totalIssues} (P0 Critical: ${p0Count}, P1 High: ${p1Count})`);

if (totalIssues === 0) {
  console.log('STATUS: PASS — 100% Impeccable & Airbnb DLS Compliant!');
  console.log('='.repeat(72));
  process.exit(0);
} else {
  console.log('STATUS: ACTION REQUIRED — Resolve P0/P1 issues before delivery.');
  console.log('='.repeat(72));
  process.exit(p0Count > 0 || p1Count > 0 ? 1 : 0);
}
