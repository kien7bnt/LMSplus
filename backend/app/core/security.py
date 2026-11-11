"""
LMSPLUS E-Learning Extension — Security, Scoped RBAC, Rotating QR & Credential Encryption
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from uuid import UUID


@dataclass
class CurrentUser:
    id: UUID
    email: str
    full_name: str
    roles: List[str] = field(default_factory=list)
    department_id: Optional[UUID] = None

    def has_role(self, role_code: str) -> bool:
        return role_code in self.roles


@dataclass
class AccessContext:
    granted: bool
    effective_role: str
    subject_class_id: Optional[UUID] = None
    ta_permissions: Dict[str, bool] = field(default_factory=dict)


class PermissionDeniedError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def verify_enrollment_policy_change(
    user: CurrentUser,
    new_policy: str,
) -> None:
    """
    Enforces Business Rule #2 (LP-02):
    - ASSIGNED_ONLY is the default.
    - REQUEST_APPROVAL can be configured by Academic Staff or Admin.
    - SELF_ENROLL can ONLY be enabled by an Administrator (ADMIN).
    """
    if new_policy not in ("ASSIGNED_ONLY", "REQUEST_APPROVAL", "SELF_ENROLL"):
        raise ValueError(f"Invalid enrollment_policy: {new_policy}")

    if new_policy == "SELF_ENROLL" and not user.has_role("ADMIN"):
        raise PermissionDeniedError(
            code="SELF_ENROLL_REQUIRES_ADMIN",
            message="Chỉ Quản trị viên (ADMIN) mới có quyền cấu hình tự đăng ký (SELF_ENROLL).",
        )

    if not (user.has_role("ADMIN") or user.has_role("ACADEMIC_STAFF")):
        raise PermissionDeniedError(
            code="INSUFFICIENT_ROLE",
            message="Chỉ Giáo vụ hoặc Quản trị viên mới được phép thay đổi phương thức tham gia khóa học.",
        )


def verify_subject_class_scope(
    user: CurrentUser,
    subject_class_id: UUID,
    staff_assignment: Optional[dict],
    is_enrolled_student: bool,
    is_in_academic_department: bool,
    required_ta_flag: Optional[str] = None,
    allow_student: bool = False,
) -> AccessContext:
    """
    Two-Layer Authorization (RBAC + Object Scope):
    Verifies both role and membership/assignment within a specific SubjectClass.
    """
    if user.has_role("ADMIN"):
        return AccessContext(granted=True, effective_role="ADMIN", subject_class_id=subject_class_id)

    if user.has_role("ACADEMIC_STAFF") and is_in_academic_department:
        return AccessContext(
            granted=True,
            effective_role="ACADEMIC_STAFF",
            subject_class_id=subject_class_id,
        )

    if staff_assignment and staff_assignment.get("is_active"):
        staff_role = staff_assignment.get("staff_role")
        if staff_role in ("PRIMARY_INSTRUCTOR", "CO_INSTRUCTOR"):
            return AccessContext(
                granted=True,
                effective_role="INSTRUCTOR",
                subject_class_id=subject_class_id,
            )

        if staff_role == "TEACHING_ASSISTANT":
            perms: Dict[str, bool] = staff_assignment.get("permissions_json") or {}
            if required_ta_flag is None or perms.get(required_ta_flag) is True:
                return AccessContext(
                    granted=True,
                    effective_role="TEACHING_ASSISTANT",
                    subject_class_id=subject_class_id,
                    ta_permissions=perms,
                )
            raise PermissionDeniedError(
                code="INSUFFICIENT_TA_PERMISSION_FLAG",
                message=f"Trợ giảng chưa được cấp quyền '{required_ta_flag}' tại lớp môn học này.",
            )

    if allow_student and user.has_role("STUDENT") and is_enrolled_student:
        return AccessContext(
            granted=True,
            effective_role="STUDENT",
            subject_class_id=subject_class_id,
        )

    raise PermissionDeniedError(
        code="INSUFFICIENT_SCOPE_PERMISSION",
        message="Bạn không có quyền truy cập vào phạm vi lớp môn học này.",
    )


def generate_rotating_qr_token(
    secret_seed: str,
    class_session_id: UUID,
    rotation_interval_sec: int = 20,
    timestamp: Optional[int] = None,
) -> str:
    """
    Generates a short-lived HMAC-SHA256 QR token rotating every `rotation_interval_sec` seconds.
    """
    now = int(timestamp if timestamp is not None else time.time())
    window_index = now // rotation_interval_sec
    message = f"{class_session_id}:{window_index}".encode("utf-8")
    digest = hmac.new(secret_seed.encode("utf-8"), message, hashlib.sha256).hexdigest()[:24]
    return f"{window_index}.{digest}"


def verify_rotating_qr_token(
    token: str,
    secret_seed: str,
    class_session_id: UUID,
    rotation_interval_sec: int = 20,
    now_timestamp: Optional[int] = None,
) -> bool:
    """
    Validates the rotating QR token allowing current window or -1 window for network latency.
    """
    try:
        window_str, provided_sig = token.split(".", 1)
        token_window = int(window_str)
    except ValueError:
        return False

    now = int(now_timestamp if now_timestamp is not None else time.time())
    current_window = now // rotation_interval_sec
    if token_window not in (current_window, current_window - 1):
        return False

    expected_token = generate_rotating_qr_token(
        secret_seed=secret_seed,
        class_session_id=class_session_id,
        rotation_interval_sec=rotation_interval_sec,
        timestamp=token_window * rotation_interval_sec,
    )
    return hmac.compare_digest(token, expected_token)


def encrypt_integration_credentials(plaintext_dict: dict, master_key_hex: str) -> bytes:
    """
    Envelope encryption placeholder using HMAC-authenticated payload so API keys
    are never persisted in plaintext inside PostgreSQL.
    In production, bind to `cryptography.hazmat.primitives.ciphers.aead.AESGCM`.
    """
    raw_bytes = json.dumps(plaintext_dict, sort_keys=True).encode("utf-8")
    key_bytes = bytes.fromhex(master_key_hex) if len(master_key_hex) == 64 else hashlib.sha256(master_key_hex.encode()).digest()
    nonce = os.urandom(12)
    keystream = hashlib.pbkdf2_hmac("sha256", key_bytes, nonce, 1000, dklen=len(raw_bytes))
    ciphertext = bytes(a ^ b for a, b in zip(raw_bytes, keystream))
    mac = hmac.new(key_bytes, nonce + ciphertext, hashlib.sha256).digest()
    return base64.b64encode(nonce + mac + ciphertext)
