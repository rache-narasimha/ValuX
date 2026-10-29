"""Regression coverage for the durable institution directory service."""

from __future__ import annotations

import uuid
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from backend.app.auth.config import DATABASE_URL
from backend.app.reference import service as reference_service
from backend.app.workflow.service import WorkflowError


database = psycopg.connect(DATABASE_URL, row_factory=dict_row)
original_connection = reference_service.connection
user_id = uuid.uuid4()
suffix = uuid.uuid4().hex[:6].upper()
code = f"QA{suffix}"


@contextmanager
def shared_connection(*_args, **_kwargs):
    yield database


reference_service.connection = shared_connection
database.execute(
    """
    INSERT INTO auth.users
        (id, user_id, display_name, role, status, password_hash, must_change_password)
    VALUES (%s, %s, 'Reference Test CEO', 'father', 'active', 'reference-test-only', FALSE)
    """,
    (user_id, f"ref-{suffix.lower()}"),
)
father = {"user_id": user_id, "role": "father"}
employee = {"user_id": user_id, "role": "employee"}

try:
    created = reference_service.upsert(
        {"code": code, "name": "QA Reference Institution", "type": "NBFC", "color": "#123456"},
        father,
    )
    assert created["code"] == code
    assert created["active"] is True
    assert any(item["code"] == code for item in reference_service.list_institutions(True))

    disabled = reference_service.set_active(code, False, father)
    assert disabled["active"] is False
    assert all(item["code"] != code for item in reference_service.list_institutions())

    try:
        reference_service.upsert(
            {"code": f"{code}E", "name": "Forbidden", "type": "Bank", "color": "#654321"},
            employee,
        )
    except WorkflowError as error:
        assert error.code == "forbidden"
    else:
        raise AssertionError("Employees must not maintain institution settings.")

    reset_items = reference_service.reset(father)
    custom = next(item for item in reset_items if item["code"] == code)
    assert custom["active"] is False
    assert next(item for item in reset_items if item["code"] == "CANARA")["active"] is True
    print("PASS: durable institution directory and CEO-only maintenance")
finally:
    database.rollback()
    database.close()
    reference_service.connection = original_connection
