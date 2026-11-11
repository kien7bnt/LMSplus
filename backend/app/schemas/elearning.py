"""
LMSPLUS E-Learning Extension — Pydantic Schemas & Domain Contracts
Covers:
1. Notion-style Block Editor JSON Schema v1.0
2. Hybrid Course Discovery & Enrollment Policy (ASSIGNED_ONLY, REQUEST_APPROVAL, SELF_ENROLL)
3. Idempotent Progress Heartbeat
4. 24-Hour Teaching Log Confirmation & Overdue Handling
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


class EnrollmentPolicy(str, Enum):
    ASSIGNED_ONLY = "ASSIGNED_ONLY"         # Default: Formal training programs assigned by Academic Staff
    REQUEST_APPROVAL = "REQUEST_APPROVAL"   # General skills / electives: Student requests, staff approves
    SELF_ENROLL = "SELF_ENROLL"             # Off by default: Only Admin can enable


class BlockType(str, Enum):
    # 1. Text Blocks
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST = "list"
    QUOTE = "quote"
    DIVIDER = "divider"
    ACCORDION = "accordion"
    TABS = "tabs"
    # 2. Pedagogical Callouts
    CALLOUT = "callout"
    # 3. Academic Blocks
    LATEX_MATH = "latex_math"
    TABLE = "table"
    STEP_BY_STEP_SOLUTION = "step_by_step_solution"
    # 4. Interactive Blocks
    INLINE_MCQ = "inline_mcq"
    TRUE_FALSE = "true_false"
    FORM_POLL = "form_poll"
    QUICK_CHECK = "quick_check"
    # 5. Multimedia Blocks
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DIAGRAM_MERMAID = "diagram_mermaid"
    ATTACHMENT = "attachment"
    # 6. Coding Blocks
    CODE_BLOCK = "code_block"


class CalloutVariant(str, Enum):
    LEARNING_OBJECTIVE = "learning_objective"
    DEFINITION = "definition"
    REMEMBER = "remember"
    NOTE = "note"
    WARNING = "warning"
    EXAM_TIP = "exam_tip"
    SUMMARY = "summary"


class LessonBlockSchema(BaseModel):
    id: UUID
    lesson_id: UUID
    parent_block_id: Optional[UUID] = None
    shared_block_id: Optional[UUID] = None
    block_type: BlockType
    schema_version: Literal["1.0"] = "1.0"
    sort_order: int = Field(default=1000, ge=0)
    status: Literal["ACTIVE", "HIDDEN", "DRAFT_ONLY"] = "ACTIVE"
    content_json: Dict[str, Any]

    @field_validator("content_json")
    @classmethod
    def validate_callout_variant(cls, v: Dict[str, Any], info) -> Dict[str, Any]:
        if info.data.get("block_type") == BlockType.CALLOUT:
            variant = v.get("variant")
            valid_variants = {item.value for item in CalloutVariant}
            if variant not in valid_variants:
                raise ValueError(f"Callout block must specify a valid variant in {valid_variants}")
        return v


class DraftBlocksAutosaveRequest(BaseModel):
    base_revision_number: int = Field(..., ge=1, description="Used for optimistic concurrency check")
    blocks: List[LessonBlockSchema]


class ProgressHeartbeatRequest(BaseModel):
    idempotency_key: str = Field(..., min_length=8, max_length=128)
    subject_class_id: UUID
    lesson_id: UUID
    event_type: Literal[
        "VIDEO_HEARTBEAT",
        "BLOCK_READ",
        "ATTACHMENT_OPENED",
        "QUICK_CHECK_ANSWERED",
    ]
    last_video_position_sec: int = Field(default=0, ge=0)
    watched_segment: Optional[List[int]] = None
    last_read_block_id: Optional[UUID] = None
    quick_check_score_pct: Optional[float] = Field(default=None, ge=0, le=100)


class TeachingSessionOperationalStatus(str, Enum):
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"
    OVERDUE_UNCONFIRMED = "OVERDUE_UNCONFIRMED"
    CONFIRMED = "CONFIRMED"
    CONFIRMED_LATE = "CONFIRMED_LATE"
    CANCELLED = "CANCELLED"
    MAKEUP_SESSION = "MAKEUP_SESSION"


class LessonDeliveryItem(BaseModel):
    lesson_id: UUID
    delivery_status: Literal["COMPLETED", "PARTIAL", "DEFERRED"]
    stopped_at_block_id: Optional[UUID] = None
    progress_note: Optional[str] = None


class TeachingLogConfirmRequest(BaseModel):
    actual_instructor_id: UUID
    is_substitute_teaching: bool = False
    substituting_reason: Optional[str] = None
    assistant_user_ids: List[UUID] = Field(default_factory=list)
    actual_start_at: datetime
    actual_end_at: datetime
    lessons_delivered: List[LessonDeliveryItem]
    general_notes: Optional[str] = None
    handover_notes_for_next_session: Optional[str] = None
    late_confirmation_reason: Optional[str] = None


def evaluate_teaching_log_confirmation_state(
    scheduled_end_at: datetime,
    confirmed_at: Optional[datetime],
    now: Optional[datetime] = None,
) -> dict:
    """
    Enforces Business Rule #3 (TW-14, TW-15 — 24-Hour Confirmation Window):
    - Instructor has 24 hours after `scheduled_end_at` to confirm the teaching log.
    - After 24 hours without confirmation, status transitions to `OVERDUE_UNCONFIRMED`.
    - Overdue status does NOT lock confirmation: Instructor can still confirm late
      (`CONFIRMED_LATE`, `is_late_confirmation = True`), preserving all timestamps.
    """
    current_time = now or datetime.now(timezone.utc)
    deadline_at = scheduled_end_at + timedelta(hours=24)

    if confirmed_at is None:
        is_overdue = current_time > deadline_at
        return {
            "operational_status": (
                TeachingSessionOperationalStatus.OVERDUE_UNCONFIRMED.value
                if is_overdue
                else TeachingSessionOperationalStatus.AWAITING_CONFIRMATION.value
            ),
            "confirmation_deadline_at": deadline_at,
            "is_overdue": is_overdue,
            "can_instructor_confirm": True,  # Never locked when overdue
        }

    is_late = confirmed_at > deadline_at
    return {
        "operational_status": (
            TeachingSessionOperationalStatus.CONFIRMED_LATE.value
            if is_late
            else TeachingSessionOperationalStatus.CONFIRMED.value
        ),
        "confirmation_deadline_at": deadline_at,
        "confirmed_at": confirmed_at,
        "is_late_confirmation": is_late,
        "can_instructor_confirm": False,
    }
