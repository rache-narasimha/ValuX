"""Regression coverage for durable Phase 3 drafts, files, and snapshots."""

from __future__ import annotations

import base64
import uuid
from contextlib import contextmanager
from datetime import date, timedelta

import psycopg
from psycopg.rows import dict_row

from backend.app.auth.config import DATABASE_URL
from backend.app.reports import service as reports
from backend.app.workflow import service as workflow


suffix = uuid.uuid4().hex[:8]
father_id = uuid.uuid4()
father = {
    "user_id": father_id,
    "display_name": f"Reports Father {suffix}",
    "role": "father",
    "login_id": f"reports-father-{suffix}",
}
today = date.today()
database = psycopg.connect(DATABASE_URL, row_factory=dict_row)
original_report_connection = reports.connection
original_workflow_connection = workflow.connection


@contextmanager
def shared_connection(*_args, **_kwargs):
    yield database


def task_payload(report_key: str, customer: str, linked: str = "") -> dict:
    return {
        "institutionCode": "CANARA",
        "branch": "Adoni",
        "customerName": customer,
        "propertyBrief": f"Property for {customer}",
        "reportKey": report_key,
        "linkedEstimationId": linked,
        "assignee": father["display_name"],
        "priority": "Urgent",
        "assignedDate": today.isoformat(),
        "dueDate": (today + timedelta(days=1)).isoformat(),
        "initialNote": "Acknowledged for report data testing.",
    }


def expect_report_error(callback, code: str) -> None:
    database.execute("SAVEPOINT expected_report_error")
    try:
        callback()
    except reports.ReportDataError as error:
        database.execute("ROLLBACK TO SAVEPOINT expected_report_error")
        database.execute("RELEASE SAVEPOINT expected_report_error")
        assert error.code == code, (error.code, str(error))
        return
    database.execute("RELEASE SAVEPOINT expected_report_error")
    raise AssertionError(f"Expected ReportDataError with code {code}")


reports.connection = shared_connection
workflow.connection = shared_connection
database.execute(
    """
    INSERT INTO auth.users
        (id, user_id, display_name, role, status, password_hash, must_change_password)
    VALUES (%s, %s, %s, 'father', 'active', 'reports-test-only', FALSE)
    """,
    (father_id, father["login_id"], father["display_name"]),
)

stored_keys: list[str] = []
try:
    valuation = workflow.create_task(task_payload("valuation-general", f"Draft {suffix}"), father)
    png = base64.b64encode(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    ).decode("ascii")
    draft = reports.save_draft(
        valuation["id"],
        {
            "reportKey": "valuation-general",
            "schemaVersion": "3",
            "revision": 0,
            "payload": {"values": {"applicant": "Durable"}, "photos": [{"name": "site.png", "data": f"data:image/png;base64,{png}"}]},
        },
        father,
    )
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert draft["revision"] == 1
    photo = draft["payload"]["photos"][0]
    assert photo["storedFileId"] and photo["data"].startswith(f"/api/tasks/{valuation['id']}/draft-files/")
    loaded = reports.get_draft(valuation["id"], father)
    assert loaded and loaded["payload"]["values"]["applicant"] == "Durable"
    hydrated = reports.hydrate_media(valuation["id"], loaded["payload"], father)
    assert hydrated["photos"][0]["data"].startswith("data:image/png;base64,")
    expect_report_error(
        lambda: reports.save_draft(
            valuation["id"],
            {"reportKey": "valuation-general", "schemaVersion": "3", "revision": 0, "payload": loaded["payload"]},
            father,
        ),
        "draft_conflict",
    )

    artifact = reports.register_artifact(
        valuation["id"], father, content=b"durable valuation", filename="valuation.docx",
        artifact_type="valuation_docx", source="generated", payload=loaded["payload"],
    )
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert artifact["task"]["latestDocx"]["url"] == artifact["download"]
    assert artifact["task"]["reportGeneratedAt"]
    valuation = reports.remove_latest_artifact(valuation["id"], father)
    assert valuation["latestDocx"] is None and valuation["reportGeneratedAt"] is None

    estimation = workflow.create_task(task_payload("estimation", f"Estimate {suffix}"), father)
    summary = {
        "applicantName": f"Estimate {suffix}",
        "projectLocation": f"Property for Estimate {suffix}",
        "propertyType": "residential",
        "construction": "rcc",
        "components": [
            {"id": "ground", "label": "Ground Floor", "estimatedCost": 125000, "source": "component"},
            {"id": "external", "label": "External works", "estimatedCost": 5000, "source": "common"},
        ],
        "totalEstimatedCost": 130000,
    }
    estimation = reports.register_artifact(
        estimation["id"], father, content=b"durable estimate", filename="estimate.xlsx",
        artifact_type="estimation_xlsx", source="generated", payload={"details": {}}, summary=summary,
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert estimation["latestXlsx"] and estimation["estimationSummary"]["totalEstimatedCost"] == 130000
    estimation = workflow.complete(estimation["id"], {"version": estimation["version"], "note": "Estimate verified."}, father)
    progress = workflow.create_task(task_payload("progress", f"Estimate {suffix}", linked=estimation["id"]), father)
    assert progress["linkedEstimationSnapshotId"] == estimation["estimationSummary"]["snapshotId"]
    assert progress["estimationSummary"]["components"][0]["label"] == "Ground Floor"

    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    print("PASS: durable report drafts, local files, artifacts, and estimation snapshots")
finally:
    database.rollback()
    database.close()
    reports.connection = original_report_connection
    workflow.connection = original_workflow_connection
    reports._delete_physical(stored_keys)
