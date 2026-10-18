"""Shared authentication types and persistence helpers.

This module owns the small primitives used by multiple authentication use-case
modules. It deliberately contains no login or activation workflow decisions.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Jsonb

from .database import connection


class AuthError(Exception):
    """Controlled authentication failure that can be returned by the API."""

    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status = status
        self.code = code


def now() -> datetime:
    """Return the current timezone-aware UTC timestamp."""
    return datetime.now(UTC)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """Expose only the user fields safe for browser responses."""
    return {
        "id": str(user["id"]),
        "userId": user["user_id"],
        "name": user["display_name"],
        "role": user["role"],
        "roleLabel": "Father / reviewer" if user["role"] == "father" else "Employee",
        "initials": "".join(
            part[0].upper() for part in user["display_name"].split() if part
        )[:2],
        "email": user.get("email"),
        "emailVerified": bool(user.get("email_verified_at")),
    }


def user_for_id(user_id):
    """Load one authentication user by database identifier."""
    with connection() as database:
        return database.execute(
            "SELECT * FROM auth.users WHERE id = %s", (user_id,)
        ).fetchone()


def audit(database, event_type: str, user_id=None, actor=None, ip=None, details=None):
    """Append an immutable event to the authentication audit trail."""
    database.execute(
        """
        INSERT INTO auth.audit_events (id, user_id, event_type, actor, ip_address, details)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (uuid.uuid4(), user_id, event_type, actor, ip, Jsonb(details or {})),
    )
