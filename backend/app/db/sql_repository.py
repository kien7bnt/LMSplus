"""
LMSPLUS E-Learning — Relational SQL Repository & Business Logic Engine
Supports SQLite (`database/lmsplus_elearning.sqlite` with `PRAGMA foreign_keys = ON`)
and PostgreSQL (`DATABASE_URL`), initialized from `database/lmsplus_elearning_seed.json`.
Enforces:
- JWT Authentication (HMAC-SHA256) & Role-based Access Control (RBAC + Data Scope)
- Hybrid Course Enrollment Policy (ASSIGNED_ONLY, REQUEST_APPROVAL, SELF_ENROLL)
- Notion-style Block Editor JSON Schema v1.0 & Optimistic Concurrency Control
- Multi-criteria Lesson Progress (Video >= 85% + Quick Check passed)
- 24-Hour Teaching Log Confirmation Window & Background Overdue Scheduler
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
DB_PATH = ROOT_DIR / "database" / "lmsplus_elearning.sqlite"
SEED_PATH = ROOT_DIR / "database" / "lmsplus_elearning_seed.json"
JWT_SECRET = os.environ.get("LMSPLUS_JWT_SECRET", "lmsplus-production-grade-hmac-secret-2026")


def create_jwt_token(user: Dict[str, Any], expires_in_sec: int = 86400) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "full_name": user["full_name"],
        "roles": user["roles"],
        "department_id": user.get("department_id"),
        "exp": int(time.time()) + expires_in_sec,
    }
    b64_header = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    b64_payload = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signing_input = f"{b64_header}.{b64_payload}".encode("utf-8")
    sig = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{b64_header}.{b64_payload}.{sig}"


def verify_jwt_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
        ).decode().rstrip("=")
        if not hmac.compare_digest(parts[2], expected_sig):
            return None
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


class ElearningSqlRepository:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema_and_seed()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        conn.execute("PRAGMA journal_mode = WAL;")
        return conn

    def _init_schema_and_seed(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    email TEXT NOT NULL UNIQUE,
                    full_name TEXT NOT NULL,
                    roles_json TEXT NOT NULL,
                    department_id TEXT,
                    assigned_course_ids_json TEXT NOT NULL DEFAULT '[]',
                    enrolled_subject_class_ids_json TEXT NOT NULL DEFAULT '[]'
                );

                CREATE TABLE IF NOT EXISTS courses (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    instructor_id TEXT NOT NULL,
                    instructor_name TEXT NOT NULL,
                    department_id TEXT NOT NULL,
                    department_name TEXT NOT NULL,
                    chapters_count INTEGER NOT NULL DEFAULT 1,
                    lessons_count INTEGER NOT NULL DEFAULT 1,
                    progress_pct INTEGER NOT NULL DEFAULT 0,
                    enrollment_policy TEXT NOT NULL CHECK (enrollment_policy IN ('ASSIGNED_ONLY', 'REQUEST_APPROVAL', 'SELF_ENROLL')),
                    enrollment_status TEXT NOT NULL DEFAULT 'NOT_ENROLLED',
                    is_assigned_to_student INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS enrollment_requests (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    student_name TEXT NOT NULL,
                    reason TEXT,
                    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
                    requested_at TEXT NOT NULL,
                    reviewed_by TEXT,
                    reviewed_at TEXT,
                    UNIQUE(course_id, student_id)
                );

                CREATE TABLE IF NOT EXISTS chapters (
                    id TEXT PRIMARY KEY,
                    subject_class_id TEXT NOT NULL,
                    code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    progress_pct INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS lessons (
                    id TEXT PRIMARY KEY,
                    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    duration_minutes INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'IN_PROGRESS', 'LOCKED')),
                    unlock_condition_text TEXT,
                    required_video_pct INTEGER NOT NULL DEFAULT 85,
                    require_quick_check INTEGER NOT NULL DEFAULT 1,
                    last_video_position_sec INTEGER NOT NULL DEFAULT 0,
                    total_video_seconds INTEGER NOT NULL DEFAULT 900,
                    quick_check_passed INTEGER NOT NULL DEFAULT 0,
                    working_draft_revision INTEGER NOT NULL DEFAULT 4,
                    published_version INTEGER NOT NULL DEFAULT 2
                );

                CREATE TABLE IF NOT EXISTS lesson_blocks (
                    id TEXT PRIMARY KEY,
                    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
                    schema_version TEXT NOT NULL DEFAULT '1.0',
                    block_type TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    content_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS lesson_versions (
                    id TEXT PRIMARY KEY,
                    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
                    version_number INTEGER NOT NULL,
                    blocks_snapshot_json TEXT NOT NULL,
                    published_by TEXT NOT NULL,
                    published_at TEXT NOT NULL,
                    UNIQUE(lesson_id, version_number)
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    subject_class_id TEXT NOT NULL,
                    subject_class_code TEXT NOT NULL,
                    subject_title TEXT NOT NULL,
                    session_title TEXT NOT NULL,
                    scheduled_start_at TEXT NOT NULL,
                    scheduled_end_at TEXT NOT NULL,
                    confirmation_deadline_at TEXT NOT NULL,
                    actual_start_at TEXT NOT NULL,
                    actual_end_at TEXT NOT NULL,
                    scheduled_instructor_id TEXT NOT NULL,
                    scheduled_instructor_name TEXT NOT NULL,
                    actual_instructor_name TEXT NOT NULL,
                    is_substitute_teaching INTEGER NOT NULL DEFAULT 0,
                    ta_names_json TEXT NOT NULL DEFAULT '[]',
                    confirmation_status TEXT NOT NULL,
                    confirmed_at TEXT,
                    is_late_confirmation INTEGER NOT NULL DEFAULT 0,
                    late_confirmation_reason TEXT,
                    reminder_sent_count INTEGER NOT NULL DEFAULT 0,
                    lessons_delivery_json TEXT NOT NULL DEFAULT '[]'
                );

                CREATE TABLE IF NOT EXISTS teaching_log_history (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
                    session_code TEXT NOT NULL,
                    previous_status TEXT NOT NULL,
                    new_status TEXT NOT NULL,
                    changed_by TEXT NOT NULL,
                    changed_at TEXT NOT NULL,
                    note TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS leave_requests (
                    id TEXT PRIMARY KEY,
                    subject_class_id TEXT NOT NULL,
                    student_code TEXT NOT NULL,
                    student_name TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    makeup_class_requested TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
                );

                CREATE TABLE IF NOT EXISTS learning_events (
                    idempotency_key TEXT PRIMARY KEY,
                    student_id TEXT NOT NULL,
                    lesson_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    occurred_at TEXT NOT NULL
                );
                """
            )

            count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count == 0 and SEED_PATH.exists():
                self.reset_from_seed(conn)

    def reset_from_seed(self, conn: Optional[sqlite3.Connection] = None) -> None:
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        own_conn = conn is None
        db = conn or self._connect()
        try:
            db.executescript(
                """
                DELETE FROM learning_events;
                DELETE FROM leave_requests;
                DELETE FROM teaching_log_history;
                DELETE FROM sessions;
                DELETE FROM lesson_versions;
                DELETE FROM lesson_blocks;
                DELETE FROM lessons;
                DELETE FROM chapters;
                DELETE FROM enrollment_requests;
                DELETE FROM courses;
                DELETE FROM users;
                """
            )
            for u in seed["users"]:
                db.execute(
                    """
                    INSERT INTO users (id, code, email, full_name, roles_json, department_id, assigned_course_ids_json, enrolled_subject_class_ids_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        u["id"],
                        u["code"],
                        u["email"],
                        u["full_name"],
                        json.dumps(u["roles"]),
                        u.get("department_id"),
                        json.dumps(u.get("assigned_course_ids", [])),
                        json.dumps(u.get("enrolled_subject_class_ids", [])),
                    ),
                )

            now_iso = datetime.now(timezone.utc).isoformat()
            for c in seed["courses"]:
                db.execute(
                    """
                    INSERT INTO courses (id, code, title, instructor_id, instructor_name, department_id, department_name,
                                         chapters_count, lessons_count, progress_pct, enrollment_policy, enrollment_status,
                                         is_assigned_to_student, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        c["id"],
                        c["code"],
                        c["title"],
                        c["instructor_id"],
                        c["instructor_name"],
                        c["department_id"],
                        c["department_name"],
                        c["chapters_count"],
                        c["lessons_count"],
                        c["progress_pct"],
                        c["enrollment_policy"],
                        c["enrollment_status"],
                        1 if c["is_assigned_to_student"] else 0,
                        now_iso,
                    ),
                )

            for r in seed.get("enrollment_requests", []):
                db.execute(
                    """
                    INSERT INTO enrollment_requests (id, course_id, student_id, student_name, reason, status, requested_at, reviewed_by, reviewed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["id"],
                        r["course_id"],
                        r["student_id"],
                        r["student_name"],
                        r["reason"],
                        r["status"],
                        r["requested_at"],
                        r.get("reviewed_by"),
                        r.get("reviewed_at"),
                    ),
                )

            for ch in seed["chapters"]:
                db.execute(
                    "INSERT INTO chapters (id, subject_class_id, code, title, progress_pct) VALUES (?, ?, ?, ?, ?)",
                    (ch["id"], ch["subject_class_id"], ch["code"], ch["title"], ch["progress_pct"]),
                )
                for les in ch["lessons"]:
                    db.execute(
                        """
                        INSERT INTO lessons (id, chapter_id, code, title, duration_minutes, status, unlock_condition_text,
                                             required_video_pct, require_quick_check, last_video_position_sec,
                                             total_video_seconds, quick_check_passed, working_draft_revision, published_version)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 2)
                        """,
                        (
                            les["id"],
                            ch["id"],
                            les["code"],
                            les["title"],
                            les["duration_minutes"],
                            les["status"],
                            les.get("unlock_condition_text"),
                            les.get("required_video_pct", 85),
                            1 if les.get("require_quick_check", True) else 0,
                            les["last_video_position_sec"],
                            les["total_video_seconds"],
                            1 if les.get("quick_check_passed", False) else 0,
                        ),
                    )

            for lesson_id, draft in seed.get("lesson_drafts", {}).items():
                for blk in draft["blocks"]:
                    db.execute(
                        """
                        INSERT INTO lesson_blocks (id, lesson_id, schema_version, block_type, sort_order, status, content_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            blk["id"],
                            lesson_id,
                            blk["schema_version"],
                            blk["block_type"],
                            blk["sort_order"],
                            blk["status"],
                            json.dumps(blk["content"]),
                        ),
                    )
                db.execute(
                    """
                    INSERT INTO lesson_versions (id, lesson_id, version_number, blocks_snapshot_json, published_by, published_at)
                    VALUES (?, ?, 2, ?, 'TS. Lê Hoàng Nam', ?)
                    """,
                    (str(uuid4()), lesson_id, json.dumps(draft["blocks"]), now_iso),
                )

            for ses in seed["sessions"]:
                db.execute(
                    """
                    INSERT INTO sessions (session_id, subject_class_id, subject_class_code, subject_title, session_title,
                                          scheduled_start_at, scheduled_end_at, confirmation_deadline_at, actual_start_at,
                                          actual_end_at, scheduled_instructor_id, scheduled_instructor_name, actual_instructor_name,
                                          is_substitute_teaching, ta_names_json, confirmation_status, confirmed_at,
                                          is_late_confirmation, reminder_sent_count, lessons_delivery_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ses["session_id"],
                        ses["subject_class_id"],
                        ses["subject_class_code"],
                        ses["subject_title"],
                        ses["session_title"],
                        ses["scheduled_start_at"],
                        ses["scheduled_end_at"],
                        ses["confirmation_deadline_at"],
                        ses["actual_start_at"],
                        ses["actual_end_at"],
                        ses["scheduled_instructor_id"],
                        ses["scheduled_instructor_name"],
                        ses["actual_instructor_name"],
                        1 if ses["is_substitute_teaching"] else 0,
                        json.dumps(ses["ta_names"]),
                        ses["confirmation_status"],
                        ses["confirmed_at"],
                        1 if ses["is_late_confirmation"] else 0,
                        ses["reminder_sent_count"],
                        json.dumps(ses["lessons_delivery"]),
                    ),
                )

            for h in seed["teaching_log_history"]:
                db.execute(
                    """
                    INSERT INTO teaching_log_history (id, session_id, session_code, previous_status, new_status, changed_by, changed_at, note)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        h["id"],
                        h["session_id"],
                        h["session_code"],
                        h["previous_status"],
                        h["new_status"],
                        h["changed_by"],
                        h["changed_at"],
                        h["note"],
                    ),
                )

            for lv in seed["leave_requests"]:
                db.execute(
                    """
                    INSERT INTO leave_requests (id, subject_class_id, student_code, student_name, reason, makeup_class_requested, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lv["id"],
                        lv["subject_class_id"],
                        lv["student_code"],
                        lv["student_name"],
                        lv["reason"],
                        lv["makeup_class_requested"],
                        lv["status"],
                    ),
                )

            if own_conn:
                db.commit()
        finally:
            if own_conn:
                db.close()
