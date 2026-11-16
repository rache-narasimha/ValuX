"""Institution directory operations with CEO-only mutations."""

from __future__ import annotations

import re
import uuid
from typing import Any

from psycopg import IntegrityError

from ..auth.database import connection
from ..workflow.service import WorkflowError


DEFAULTS = (
    ("APGB", "Andhra Pradesh Grameena Bank", "Bank", "#007a3d"),
    ("BOB", "Bank of Baroda", "Bank", "#f58220"),
    ("BOI", "Bank of India", "Bank", "#0072bc"),
    ("BOM", "Bank of Maharashtra", "Bank", "#0b5ca8"),
    ("CANARA", "Canara Bank", "Bank", "#007f5f"),
    ("CBOI", "Central Bank of India", "Bank", "#005baa"),
    ("CUB", "City Union Bank", "Bank", "#7b1b2b"),
    ("KB", "Karnataka Bank", "Bank", "#7a263a"),
    ("KVB", "Karur Vysya Bank", "Bank", "#7a1f5c"),
    ("PNB", "Punjab National Bank", "Bank", "#a20f2d"),
    ("UBI", "Union Bank of India", "Bank", "#d71920"),
    ("PUB", "Priyadarshini Urban Co-operative Bank Ltd., Adoni", "Bank", "#6b4f2a"),
    ("AMF", "Adoni Mutual Funds", "Bank", "#476b58"),
    ("HDBFS", "HDB Financial Services Limited", "NBFC", "#ed1c24"),
    ("TYGER", "Tyger Capital", "NBFC", "#e57a18"),
    ("UGRO", "UGRO Capital Limited", "NBFC", "#652d90"),
)


def _payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "type": row["institution_type"],
        "code": row["code"],
        "name": row["name"],
        "color": row["color"],
        "active": row["active"],
        "updatedAt": row["updated_at"].isoformat(),
    }


def query_institutions(database, include_inactive: bool = False):
    where = "" if include_inactive else " WHERE active = TRUE"
    return database.execute(f"SELECT * FROM app.institutions{where} ORDER BY institution_type, name")


def institution_payloads(rows) -> list[dict[str, Any]]:
    return [_payload(row) for row in rows]


def list_institutions(include_inactive: bool = False) -> list[dict[str, Any]]:
    with connection(autocommit=True) as database:
        return institution_payloads(query_institutions(database, include_inactive).fetchall())


def _require_father(session: dict[str, Any]) -> None:
    if session["role"] != "father":
        raise WorkflowError("Only the CEO can maintain institution settings.", 403, "forbidden")


def upsert(payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    _require_father(session)
    code = str(payload.get("code") or "").strip().upper()
    original = str(payload.get("originalCode") or code).strip().upper()
    name = str(payload.get("name") or "").strip()
    institution_type = str(payload.get("type") or "").strip()
    color = str(payload.get("color") or "").strip()
    active = payload.get("active") is not False
    if not code or not name:
        raise WorkflowError("Institution code and name are required.")
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{1,15}", code):
        raise WorkflowError("Use 2–16 uppercase letters, numbers, hyphens or underscores for the institution code.")
    if institution_type not in {"Bank", "NBFC"}:
        raise WorkflowError("Select Bank or NBFC.")
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise WorkflowError("Select a valid institution colour.")
    with connection() as database:
        current = database.execute("SELECT * FROM app.institutions WHERE code = %s FOR UPDATE", (original,)).fetchone()
        try:
            if current:
                database.execute(
                    "UPDATE app.institutions SET code = %s, name = %s, institution_type = %s, color = %s, active = %s, updated_by_user_id = %s, updated_at = NOW() WHERE id = %s",
                    (code, name, institution_type, color, active, session["user_id"], current["id"]),
                )
                institution_id = current["id"]
            else:
                institution_id = uuid.uuid4()
                database.execute(
                    "INSERT INTO app.institutions (id, code, name, institution_type, color, active, created_by_user_id, updated_by_user_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (institution_id, code, name, institution_type, color, active, session["user_id"], session["user_id"]),
                )
        except IntegrityError as error:
            raise WorkflowError("That institution code is already in use.", 409, "duplicate") from error
        row = database.execute("SELECT * FROM app.institutions WHERE id = %s", (institution_id,)).fetchone()
        return _payload(row)


def set_active(code: str, active: bool, session: dict[str, Any]) -> dict[str, Any]:
    _require_father(session)
    with connection() as database:
        row = database.execute(
            "UPDATE app.institutions SET active = %s, updated_by_user_id = %s, updated_at = NOW() WHERE code = %s RETURNING *",
            (bool(active), session["user_id"], code.upper()),
        ).fetchone()
        if not row:
            raise WorkflowError("Institution not found.", 404, "not_found")
        return _payload(row)


def reset(session: dict[str, Any]) -> list[dict[str, Any]]:
    _require_father(session)
    with connection() as database:
        for code, name, institution_type, color in DEFAULTS:
            database.execute(
                """
                INSERT INTO app.institutions (id, code, name, institution_type, color, active, created_by_user_id, updated_by_user_id)
                VALUES (%s, %s, %s, %s, %s, TRUE, %s, %s)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name, institution_type = EXCLUDED.institution_type,
                    color = EXCLUDED.color, active = TRUE,
                    updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
                """,
                (uuid.uuid4(), code, name, institution_type, color, session["user_id"], session["user_id"]),
            )
        codes = tuple(item[0] for item in DEFAULTS)
        database.execute("UPDATE app.institutions SET active = FALSE, updated_by_user_id = %s, updated_at = NOW() WHERE code <> ALL(%s)", (session["user_id"], list(codes)))
    return list_institutions(True)
