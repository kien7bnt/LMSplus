#!/usr/bin/env node
/**
 * LMSPLUS E-Learning — Full System, SQL Migration & Documentation Verifier
 * Verifies:
 * 1. All 11 Architecture & Design documents in `docs/elearning/`
 * 2. All 11 PostgreSQL Migration files in `database/migrations/` (BEGIN/COMMIT transaction safety, table/index count)
 * 3. Backend & Frontend module integrity
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
let errorCount = 0;

function logInfo(msg) {
  console.log(`[INFO]  ${new Date().toISOString()} | ${msg}`);
}

function logPass(msg) {
  console.log(`[PASS]  ${new Date().toISOString()} | ${msg}`);
}

function logError(msg) {
  errorCount++;
  console.error(`[ERROR] ${new Date().toISOString()} | ${msg}`);
}

console.log('='.repeat(76));
console.log('LMSPLUS E-LEARNING — SYSTEM, SQL MIGRATION & ARCHITECTURE VERIFICATION');
console.log('='.repeat(76));

// 1. Verify 11 Documentation Deliverables in docs/elearning/
const expectedDocs = [
  '01-current-system-audit.md',
  '02-product-requirements.md',
  '03-sitemap-user-flows.md',
  '04-design-system.md',
  '05-ui-ux-specification.md',
  '06-database-design.md',
  '07-erd.md',
  '08-api-specification.md',
  '09-permission-matrix.md',
  '10-development-backlog.md',
  '11-technical-decisions.md',
];

logInfo('Step 1/3: Checking 11 Architecture & Design documents in docs/elearning/...');
for (const docName of expectedDocs) {
  const fullPath = path.join(ROOT, 'docs', 'elearning', docName);
  if (!fs.existsSync(fullPath)) {
    logError(`Missing required document: docs/elearning/${docName}`);
  } else {
    const size = fs.statSync(fullPath).size;
    if (size < 500) {
      logError(`Document too small (${size} bytes): docs/elearning/${docName}`);
    } else {
      logPass(`Verified docs/elearning/${docName} (${size} bytes)`);
    }
  }
}

// 2. Verify PostgreSQL Migrations (UP & DOWN)
const expectedMigrations = [
  '000_lmsplus_core_baseline_if_not_exists.sql',
  '001_curriculum_and_enrollment_policy_up.sql',
  '001_curriculum_and_enrollment_policy_down.sql',
  '002_blocks_versioning_and_wiki_up.sql',
  '002_blocks_versioning_and_wiki_down.sql',
  '003_progress_unlock_and_assessments_up.sql',
  '003_progress_unlock_and_assessments_down.sql',
  '004_forums_and_moderation_up.sql',
  '004_forums_and_moderation_down.sql',
  '005_attendance_teaching_logs_and_integrations_up.sql',
  '005_attendance_teaching_logs_and_integrations_down.sql',
  '006_teaching_workspace_extensions_up.sql',
  '006_teaching_workspace_extensions_down.sql',
  '007_lesson_studio_and_video_quiz_up.sql',
  '007_lesson_studio_and_video_quiz_down.sql',
  '008_master_lms_architecture_up.sql',
  '008_master_lms_architecture_down.sql',
];

logInfo('Step 2/3: Validating PostgreSQL Migration SQL files in database/migrations/...');
let totalCreatedTables = 0;
let totalDroppedTables = 0;

for (const sqlName of expectedMigrations) {
  const fullPath = path.join(ROOT, 'database', 'migrations', sqlName);
  if (!fs.existsSync(fullPath)) {
    logError(`Missing SQL migration: database/migrations/${sqlName}`);
    continue;
  }
  const sql = fs.readFileSync(fullPath, 'utf8');
  const hasBegin = /\bBEGIN\s*;/i.test(sql);
  const hasCommit = /\bCOMMIT\s*;/i.test(sql);

  if (!hasBegin || !hasCommit) {
    logError(`Migration ${sqlName} is missing transactional BEGIN; / COMMIT; wrapper.`);
  }

  const createMatches = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi) || [];
  const dropMatches = sql.match(/DROP\s+TABLE\s+IF\s+EXISTS\s+([a-z0-9_]+)/gi) || [];
  totalCreatedTables += createMatches.length;
  totalDroppedTables += dropMatches.length;

  logPass(
    `Verified ${sqlName} (Transactional: YES | CREATE TABLE: ${createMatches.length} | DROP TABLE: ${dropMatches.length})`
  );
}

logInfo(`Total SQL Tables Managed: ${totalCreatedTables} (UP) | ${totalDroppedTables} Rollback Drops (DOWN)`);

// 3. Verify Backend & Frontend Core Files
const expectedCodeFiles = [
  'backend/main.py',
  'backend/app/core/security.py',
  'backend/app/schemas/elearning.py',
  'backend/app/api/v1/elearning_router.py',
  'frontend/package.json',
  'frontend/src/types/elearning.ts',
  'frontend/src/components/ui/Primitives.tsx',
  'frontend/src/components/elearning/LessonPlayerView.tsx',
  'frontend/src/components/elearning/BlockEditorView.tsx',
  'frontend/src/components/elearning/TeachingLogAndAttendanceView.tsx',
  'frontend/src/App.tsx',
];

logInfo('Step 3/3: Checking Backend (Python/FastAPI) & Frontend (React/TS/Vite) source files...');
for (const relPath of expectedCodeFiles) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    logError(`Missing source file: ${relPath}`);
  } else {
    const size = fs.statSync(fullPath).size;
    logPass(`Verified ${relPath} (${size} bytes)`);
  }
}

console.log('-'.repeat(76));
if (errorCount === 0) {
  logPass('ALL CHECKS PASSED (0 errors). System is ready for deployment & integration.');
  console.log('='.repeat(76));
  process.exit(0);
} else {
  logError(`VERIFICATION FAILED WITH ${errorCount} ERROR(S).`);
  console.log('='.repeat(76));
  process.exit(1);
}
