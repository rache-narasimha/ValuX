"""Transactional checks for business-data uniqueness and integrity rules."""

import uuid

from psycopg.errors import CheckViolation, UniqueViolation

from backend.app.auth.database import connection


def task_values(
    task_id,
    task_code,
    institution,
    user,
    *,
    report_key="valuation-general",
    report_group="valuation",
    assigned_date="2026-10-20",
    linked_estimation_task_id=None,
    duplicate_key=None,
):
    return (
        task_id,
        task_code,
        report_key,
        report_group,
        institution["id"],
        institution["code"],
        institution["name"],
        institution["institution_type"],
        "Adoni",
        "Database Foundation Test",
        "Disposable transactional test property",
        user["id"],
        user["display_name"],
        user["id"],
        "Normal",
        "In Progress",
        assigned_date,
        assigned_date,
        linked_estimation_task_id,
        duplicate_key,
    )


INSERT_TASK = """
    INSERT INTO app.tasks (
        id, task_code, report_key, report_group, institution_id,
        institution_code_snapshot, institution_name_snapshot,
        institution_type_snapshot, branch, customer_name, property_brief,
        assignee_user_id, assignee_name_snapshot, created_by_user_id,
        priority, status, assigned_date, due_date,
        linked_estimation_task_id, duplicate_key
    )
    VALUES (
        %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s, %s,
        %s, %s
    )
"""


with connection() as database:
    user = database.execute(
        "SELECT id, display_name FROM auth.users ORDER BY created_at LIMIT 1"
    ).fetchone()
    institution = database.execute(
        """
        SELECT id, code, name, institution_type
        FROM app.institutions
        WHERE code = 'BOB'
        """
    ).fetchone()
    assert user and institution

    suffix = uuid.uuid4().hex[:12].upper()
    valuation_id = uuid.uuid4()
    database.execute(
        INSERT_TASK,
        task_values(
            valuation_id,
            f"DB-VAL-{suffix}",
            institution,
            user,
            duplicate_key=f"valuation|{suffix}",
        ),
    )

    try:
        with database.transaction():
            database.execute(
                INSERT_TASK,
                task_values(
                    uuid.uuid4(),
                    f"DB-VAL-{suffix}-02",
                    institution,
                    user,
                    duplicate_key=f"valuation|{suffix}",
                ),
            )
    except UniqueViolation:
        pass
    else:
        raise AssertionError("Active valuation duplicate key was accepted")

    estimation_id = uuid.uuid4()
    database.execute(
        INSERT_TASK,
        task_values(
            estimation_id,
            f"DB-EST-{suffix}",
            institution,
            user,
            report_key="estimation",
            report_group="estimation",
        ),
    )

    progress_id = uuid.uuid4()
    database.execute(
        INSERT_TASK,
        task_values(
            progress_id,
            f"DB-PRG-{suffix}",
            institution,
            user,
            report_key="progress",
            report_group="progress",
            linked_estimation_task_id=estimation_id,
        ),
    )
    try:
        with database.transaction():
            database.execute(
                INSERT_TASK,
                task_values(
                    uuid.uuid4(),
                    f"DB-PRG-{suffix}-02",
                    institution,
                    user,
                    report_key="progress",
                    report_group="progress",
                    linked_estimation_task_id=estimation_id,
                ),
            )
    except UniqueViolation:
        pass
    else:
        raise AssertionError("Duplicate Progress task date was accepted")

    completion_id = uuid.uuid4()
    database.execute(
        INSERT_TASK,
        task_values(
            completion_id,
            f"DB-CMP-{suffix}",
            institution,
            user,
            report_key="completion",
            report_group="completion",
            assigned_date="2026-10-21",
            linked_estimation_task_id=estimation_id,
        ),
    )
    try:
        with database.transaction():
            database.execute(
                INSERT_TASK,
                task_values(
                    uuid.uuid4(),
                    f"DB-CMP-{suffix}-02",
                    institution,
                    user,
                    report_key="completion",
                    report_group="completion",
                    assigned_date="2026-10-22",
                    linked_estimation_task_id=estimation_id,
                ),
            )
    except UniqueViolation:
        pass
    else:
        raise AssertionError("Second active Completion task was accepted")

    database.execute(
        """
        UPDATE app.tasks
        SET completion_blocked_at = NOW(),
            completion_blocked_by_task_id = %s
        WHERE id = %s
        """,
        (completion_id, estimation_id),
    )
    lock = database.execute(
        """
        SELECT completion_blocked_at, completion_blocked_by_task_id
        FROM app.tasks
        WHERE id = %s
        """,
        (estimation_id,),
    ).fetchone()
    assert lock["completion_blocked_at"] is not None
    assert lock["completion_blocked_by_task_id"] == completion_id

    try:
        with database.transaction():
            database.execute(
                """
                INSERT INTO app.task_payments (
                    task_id, estimated_fee, received_amount, updated_by_user_id
                )
                VALUES (%s, 1000, 1001, %s)
                """,
                (valuation_id, user["id"]),
            )
    except CheckViolation:
        pass
    else:
        raise AssertionError("Payment received above its billing basis was accepted")

    database.rollback()

print("PASS: durable business-data uniqueness and integrity constraints")
