"""Regression coverage for Phase 2 durable workflow authority."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import date, timedelta

import psycopg
from psycopg.rows import dict_row

from backend.app.auth.config import DATABASE_URL
from backend.app.reports import service as report_service
from backend.app.workflow import service


father_id = uuid.uuid4()
employee_id = uuid.uuid4()
suffix = uuid.uuid4().hex[:8]
father = {
    "user_id": father_id,
    "display_name": f"Workflow Father {suffix}",
    "role": "father",
    "login_id": f"wf-father-{suffix}",
}
employee = {
    "user_id": employee_id,
    "display_name": f"Workflow Employee {suffix}",
    "role": "employee",
    "login_id": f"wf-employee-{suffix}",
}


def expect_error(callback, code: str) -> None:
    database.execute("SAVEPOINT expected_workflow_error")
    try:
        callback()
    except service.WorkflowError as error:
        database.execute("ROLLBACK TO SAVEPOINT expected_workflow_error")
        database.execute("RELEASE SAVEPOINT expected_workflow_error")
        assert error.code == code, (error.code, str(error))
        return
    database.execute("RELEASE SAVEPOINT expected_workflow_error")
    raise AssertionError(f"Expected WorkflowError with code {code}")


today = date.today()


def payload(report_key: str, customer: str, assignee: str = father["display_name"], linked: str = "") -> dict:
    return {
        "institutionCode": "CANARA",
        "branch": "Adoni",
        "customerName": customer,
        "propertyBrief": f"Property for {customer}",
        "reportKey": report_key,
        "linkedEstimationId": linked,
        "assignee": assignee,
        "priority": "Urgent",
        "assignedDate": today.isoformat(),
        "dueDate": (today + timedelta(days=1)).isoformat(),
        "initialNote": "Acknowledged for testing.",
    }


database = psycopg.connect(DATABASE_URL, row_factory=dict_row)
original_connection = service.connection
original_report_connection = report_service.connection


@contextmanager
def shared_connection(*_args, **_kwargs):
    yield database


service.connection = shared_connection
report_service.connection = shared_connection
stored_keys: list[str] = []
for user_id, login, name, role in (
    (father_id, father["login_id"], father["display_name"], "father"),
    (employee_id, employee["login_id"], employee["display_name"], "employee"),
):
    database.execute(
        """
        INSERT INTO auth.users
            (id, user_id, display_name, role, status, password_hash, must_change_password)
        VALUES (%s, %s, %s, %s, 'active', 'workflow-test-only', FALSE)
        """,
        (user_id, login, name, role),
    )

try:
    valuation_input = payload("valuation-general", f"Valuation {suffix}")
    valuation = service.create_task(valuation_input, father)
    assert valuation["status"] == "In Progress"
    assert valuation["version"] == 1
    expect_error(lambda: service.create_task(valuation_input, father), "duplicate")
    expect_error(
        lambda: service.create_task(payload("valuation-general", f"Employee unassigned {suffix}", assignee=""), employee),
        "forbidden",
    )

    expect_error(
        lambda: service.assign(
            valuation["id"],
            {"version": valuation["version"], "assignee": father["display_name"], "note": "Invalid employee reassignment."},
            employee,
        ),
        "forbidden",
    )

    valuation = service.put_on_hold(
        valuation["id"],
        {"version": valuation["version"], "reason": "Awaiting Documents", "note": "Documents are pending."},
        father,
    )
    assert valuation["status"] == "On Hold"
    expect_error(
        lambda: service.resume(valuation["id"], {"version": valuation["version"] - 1}, father),
        "version_conflict",
    )
    valuation = service.resume(valuation["id"], {"version": valuation["version"], "note": "Documents received."}, father)
    valuation = report_service.register_artifact(
        valuation["id"], father, content=b"workflow valuation", filename="valuation.docx",
        artifact_type="valuation_docx", source="generated", payload={"values": {"test": suffix}},
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    valuation = service.complete(valuation["id"], {"version": valuation["version"], "note": "Report verified."}, father)
    valuation = service.update_payment(
        valuation["id"],
        {"version": valuation["version"], "estimated": 5000, "agreed": 4500, "received": 4500, "dueDate": today.isoformat()},
        employee,
    )
    assert valuation["payment"]["status"] == "Received"
    valuation = service.close(valuation["id"], {"version": valuation["version"], "note": "Settled."}, employee)
    assert valuation["status"] == "Closed"
    valuation = service.reopen(valuation["id"], {"version": valuation["version"], "note": "Correction required."}, father)
    assert valuation["status"] == "In Progress"
    assert valuation["reportGeneratedAt"] is None

    estimation = service.create_task(payload("estimation", f"Estimate {suffix}"), father)
    estimation = report_service.register_artifact(
        estimation["id"], father, content=b"workflow estimation", filename="estimation.xlsx",
        artifact_type="estimation_xlsx", source="generated", payload={"details": {}},
        summary={
            "applicantName": f"Estimate {suffix}", "projectLocation": f"Property for Estimate {suffix}",
            "propertyType": "residential", "components": [{"id": "gf", "label": "Ground Floor", "estimatedCost": 100000, "source": "component"}],
            "totalEstimatedCost": 100000,
        },
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    estimation = service.complete(estimation["id"], {"version": estimation["version"], "note": "Estimate completed."}, father)

    candidates = service.eligible_estimations("completion", today.isoformat())
    assert any(item["id"] == estimation["id"] for item in candidates["items"])

    completion = service.create_task(payload("completion", f"Estimate {suffix}", linked=estimation["id"]), father)
    completion = report_service.register_artifact(
        completion["id"], father, content=b"workflow completion", filename="completion.docx",
        artifact_type="completion_docx", source="generated", payload={"components": []},
        summary={"reportType": "completion", "components": []},
    )["task"]
    linked_reports = service.progress_reports_for(estimation["id"])
    assert [item["id"] for item in linked_reports] == [completion["id"]]
    assert linked_reports[0]["progressSummary"]["reportType"] == "completion"
    expect_error(lambda: service.progress_reports_for(valuation["id"]), "invalid_request")
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    completion = service.complete(completion["id"], {"version": completion["version"], "note": "Construction complete."}, father)
    locked_estimation = service.get_task(estimation["id"])
    assert locked_estimation["completionLockedAt"]
    expect_error(
        lambda: service.create_task(payload("progress", f"Estimate {suffix}", linked=estimation["id"]), father),
        "estimation_locked",
    )
    completion = service.reopen(completion["id"], {"version": completion["version"], "note": "Correction only."}, father)
    expect_error(
        lambda: service.create_task(payload("progress", f"Estimate {suffix}", linked=estimation["id"]), father),
        "estimation_locked",
    )

    listed = service.list_tasks({"search": suffix, "limit": 10})
    assert listed["total"] >= 3
    assert service.list_tasks({"search": "valuation-general", "limit": 10})["total"] >= 1
    assert service.list_tasks({"search": "General Property Valuation", "limit": 10})["total"] >= 1
    assert service.list_tasks({"search": "Received", "limit": 10})["total"] >= 1
    expect_error(lambda: service.list_tasks({"limit": "many"}), "invalid_request")
    expect_error(lambda: service.list_tasks({"period": "sometimes"}), "invalid_request")
    expect_error(lambda: service.eligible_estimations("completion", today.isoformat(), limit="many"), "invalid_request")
    assert service.summary()["total"] >= 3
    print("PASS: Phase 2 workflow service authority and permanent completion lock")
finally:
    database.rollback()
    database.close()
    service.connection = original_connection
    report_service.connection = original_report_connection
    report_service._delete_physical(stored_keys)
