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
    preview = reports.register_artifact(
        valuation["id"], father, content=b"durable preview", filename="valuation-preview.pdf",
        artifact_type="preview_pdf", source="generated", payload=hydrated,
        current=False, preview_token="123456789",
    )
    restored_preview = reports.get_draft(valuation["id"], father)["preview"]
    assert restored_preview["id"] == "123456789"
    assert restored_preview["url"] == preview["download"]
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
    assert artifact["task"]["reportFresh"] is True
    valuation = reports.remove_latest_artifact(valuation["id"], father)
    assert valuation["latestDocx"] is None and valuation["reportGeneratedAt"] is None

    agricultural = workflow.create_task(task_payload("valuation-agricultural", f"Agricultural {suffix}"), father)
    agricultural_draft = reports.save_draft(
        agricultural["id"],
        {
            "reportKey": "valuation-agricultural", "schemaVersion": "1", "revision": 0,
            "payload": {"values": {"owner.name": f"Owner {suffix}"}, "photos": [], "map": None},
        },
        father,
    )
    agricultural = reports.register_artifact(
        agricultural["id"], father, content=b"agricultural valuation", filename="agricultural.docx",
        artifact_type="valuation_docx", source="generated", payload=agricultural_draft["payload"],
    )["task"]
    assert agricultural["reportFresh"] is True
    reports.save_draft(
        agricultural["id"],
        {
            "reportKey": "valuation-agricultural", "schemaVersion": "1", "revision": agricultural_draft["revision"],
            "payload": {**agricultural_draft["payload"], "values": {"owner.name": f"Changed {suffix}"}},
        },
        father,
    )
    assert workflow.get_task(agricultural["id"])["reportFresh"] is False

    estimation = workflow.create_task(task_payload("estimation", f"Estimate {suffix}"), father)
    estimation_state = {
        "propertyType": "residential",
        "construction": "rcc",
        "subtype": "individual",
        "details": {"workMode": "online", "applicantName": f"Estimate {suffix}"},
        "components": [{"id": "ground", "name": "Ground Floor", "kind": "residential_building", "formData": {"finalAmount": 125000}}],
    }
    estimation_draft = reports.save_draft(
        estimation["id"],
        {"reportKey": "estimation", "schemaVersion": "3", "revision": 0, "payload": estimation_state},
        father,
    )
    estimation_preview = reports.register_artifact(
        estimation["id"], father, content=b"estimation preview", filename="estimation-preview.pdf",
        artifact_type="preview_pdf", source="generated", payload=estimation_state,
        current=False, preview_token="987654321",
    )
    restored_estimation_preview = reports.get_draft(estimation["id"], father)["preview"]
    assert restored_estimation_preview["id"] == "987654321"
    assert restored_estimation_preview["url"] == estimation_preview["download"]
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
        artifact_type="estimation_xlsx", source="generated", payload=estimation_state, summary=summary,
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert estimation["latestXlsx"] and estimation["estimationSummary"]["totalEstimatedCost"] == 130000
    assert estimation["reportFresh"] is True
    output_state = {
        **estimation_state,
        "details": {
            **estimation_state["details"],
            "finalReport": {"fileName": "estimate.xlsx", "generatedAt": "2026-10-30T10:00:00Z"},
            "offlineWorkbook": {"fileName": "blank.xlsx", "generatedAt": "2026-10-30T09:00:00Z"},
        },
    }
    output_saved = reports.save_draft(
        estimation["id"],
        {
            "reportKey": "estimation", "schemaVersion": "3", "revision": estimation_draft["revision"],
            "payload": output_state,
        },
        father,
    )
    assert workflow.get_task(estimation["id"])["reportFresh"] is True
    changed_estimation_state = {**estimation_state, "details": {**estimation_state["details"], "place": "Changed place"}}
    reports.save_draft(
        estimation["id"],
        {
            "reportKey": "estimation", "schemaVersion": "3", "revision": output_saved["revision"],
            "payload": changed_estimation_state,
        },
        father,
    )
    assert workflow.get_task(estimation["id"])["reportFresh"] is False
    estimation = reports.register_artifact(
        estimation["id"], father, content=b"durable estimate replacement", filename="estimate-replacement.xlsx",
        artifact_type="estimation_xlsx", source="generated", payload=changed_estimation_state, summary=summary,
    )["task"]
    assert estimation["reportFresh"] is True
    estimation = workflow.complete(estimation["id"], {"version": estimation["version"], "note": "Estimate verified."}, father)
    progress = workflow.create_task(task_payload("progress", f"Estimate {suffix}", linked=estimation["id"]), father)
    assert progress["linkedEstimationSnapshotId"] == estimation["estimationSummary"]["snapshotId"]
    assert progress["estimationSummary"]["components"][0]["label"] == "Ground Floor"
    progress_state = {
        "linkedEstimationId": estimation["id"],
        "details": {"reportDate": today.isoformat(), "visitDate": today.isoformat(), "place": "Adoni", "noDeviation": "yes"},
        "components": [{"id": "ground", "label": "Ground Floor", "estimatedCost": 125000, "completionPercent": 50, "completedCost": 62500, "manualCompleted": False}],
        "bank": {"releases": []},
        "photos": [{"name": "progress.png", "data": f"data:image/png;base64,{png}"}],
    }
    progress_draft = reports.save_draft(
        progress["id"],
        {"reportKey": "progress", "schemaVersion": "1", "revision": 0, "payload": progress_state},
        father,
    )
    progress_preview = reports.register_artifact(
        progress["id"], father, content=b"progress preview", filename="progress-preview.pdf",
        artifact_type="preview_pdf", source="generated", payload=progress_draft["payload"],
        current=False, preview_token="246813579",
    )
    restored_progress_preview = reports.get_draft(progress["id"], father)["preview"]
    assert restored_progress_preview["id"] == "246813579"
    assert restored_progress_preview["url"] == progress_preview["download"]
    reports.require_current_preview(progress["id"], father, "246813579")
    progress = reports.register_artifact(
        progress["id"], father, content=b"progress report", filename="progress.docx",
        artifact_type="progress_docx", source="generated", payload=progress_draft["payload"],
        summary={"reportType": "progress", "components": []},
    )["task"]
    assert progress["reportFresh"] is True
    changed_progress_state = {
        **progress_state,
        "components": [{**progress_state["components"][0], "completionPercent": 60, "completedCost": 75000}],
    }
    reports.save_draft(
        progress["id"],
        {"reportKey": "progress", "schemaVersion": "1", "revision": progress_draft["revision"], "payload": changed_progress_state},
        father,
    )
    assert workflow.get_task(progress["id"])["reportFresh"] is False
    assert reports.get_draft(progress["id"], father)["preview"] is None
    expect_report_error(lambda: reports.require_current_preview(progress["id"], father, "246813579"), "preview_required")

    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    print("PASS: durable report drafts, local files, artifacts, and estimation snapshots")
finally:
    database.rollback()
    database.close()
    reports.connection = original_report_connection
    workflow.connection = original_workflow_connection
    reports._delete_physical(stored_keys)
