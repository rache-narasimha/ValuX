"""Regression coverage for Phase 2 durable workflow authority."""

from __future__ import annotations

import base64
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta

import psycopg
from psycopg.rows import dict_row

from backend.app.auth.config import DATABASE_URL
from backend.app.business_time import tenant_today
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


def expect_error(callback, code: str) -> service.WorkflowError:
    database.execute("SAVEPOINT expected_workflow_error")
    try:
        callback()
    except service.WorkflowError as error:
        database.execute("ROLLBACK TO SAVEPOINT expected_workflow_error")
        database.execute("RELEASE SAVEPOINT expected_workflow_error")
        assert error.code == code, (error.code, str(error))
        return error
    database.execute("RELEASE SAVEPOINT expected_workflow_error")
    raise AssertionError(f"Expected WorkflowError with code {code}")


today = tenant_today()


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
    similar_input = {**valuation_input, "customerName": f"Valuation {suffix} A", "propertyBrief": f"Property for Valuation {suffix} A"}
    similar_error = expect_error(lambda: service.create_task(similar_input, father), "similar_task")
    assert similar_error.details["similarTask"]["id"] == valuation["id"]
    similar_input["allowSimilarTaskId"] = valuation["id"]
    similar_valuation = service.create_task(similar_input, father)
    assert similar_valuation["id"] != valuation["id"]
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
    png = base64.b64encode(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    ).decode("ascii")
    draft = report_service.save_draft(
        valuation["id"],
        {
            "reportKey": "valuation-general", "schemaVersion": "3", "revision": 0,
            "payload": {"values": {"test": suffix}, "photos": [{"name": "site.png", "data": f"data:image/png;base64,{png}"}], "map": None},
        },
        father,
    )
    valuation = report_service.register_artifact(
        valuation["id"], father, content=b"workflow valuation", filename="valuation.docx",
        artifact_type="valuation_docx", source="generated", payload=draft["payload"],
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    changed = report_service.save_draft(
        valuation["id"],
        {
            "reportKey": "valuation-general", "schemaVersion": "3", "revision": draft["revision"],
            "payload": {**draft["payload"], "values": {"test": f"{suffix}-changed"}},
        },
        father,
    )
    valuation = service.get_task(valuation["id"])
    assert valuation["reportFresh"] is False
    expect_error(
        lambda: service.complete(valuation["id"], {"version": valuation["version"], "note": "Outdated report."}, father),
        "stale_report",
    )
    valuation = report_service.register_artifact(
        valuation["id"], father, content=b"workflow valuation replacement", filename="valuation-replacement.docx",
        artifact_type="valuation_docx", source="generated", payload=changed["payload"],
    )["task"]
    assert valuation["reportFresh"] is True
    valuation = service.complete(valuation["id"], {"version": valuation["version"], "note": "Report verified."}, father)
    assert database.execute("SELECT COUNT(*) AS count FROM app.report_draft_files WHERE task_id = %s", (uuid.UUID(valuation["internalId"]),)).fetchone()["count"] == 0
    cleaned_payload = database.execute("SELECT payload FROM app.report_drafts WHERE task_id = %s", (uuid.UUID(valuation["internalId"]),)).fetchone()["payload"]
    assert cleaned_payload["photos"] == [] and cleaned_payload["map"] is None
    original_code = valuation["id"]
    original_file = valuation["latestDocx"]["id"]
    child_input = {**payload("revaluation", f"Revaluation {suffix}"), "linkedValuationId": original_code}
    assert service.eligible_valuations({"search": suffix})["items"][0]["id"] == original_code
    child = service.create_task(child_input, father)
    assert child["reportGroup"] == "revaluation" and child["reportKey"] == "valuation-general"
    assert child["linkedValuationId"] == original_code and child["linkedValuationArtifactId"] == original_file
    assert child["preparationSource"] == "online" and not child["revaluationManualEntry"]
    child_draft = report_service.get_draft(child["id"], father)
    assert child_draft["payload"]["values"] == changed["payload"]["values"]
    assert child_draft["payload"]["photos"] == [] and child_draft["payload"]["map"] is None
    assert child["payment"]["status"] == "Not Set"
    child = service.cancel(child["id"], {"version": child["version"], "reason": "Created by Mistake"}, father)
    original_with_history = service.get_task(original_code)
    assert original_with_history["revaluations"][0]["status"] == "Cancelled"
    # This fixture shares a transaction, so both events have the same NOW() timestamp.
    child_events = [
        item["details"]["revaluationEvent"] for item in original_with_history["activity"]
        if item["details"].get("revaluationTaskId") == child["id"]
    ]
    assert sorted(child_events) == ["cancelled", "created"]

    valuation = service.update_payment(
        valuation["id"],
        {"version": valuation["version"], "estimated": 5000, "agreed": 4500, "received": 4500, "dueDate": today.isoformat()},
        employee,
    )
    assert valuation["payment"]["status"] == "Received"
    partial = service.update_payment(
        similar_valuation["id"],
        {"version": similar_valuation["version"], "estimated": 5000, "agreed": 4000, "received": 2000},
        father,
    )
    cancelled_payment = service.create_task(payload("valuation-general", f"Payment cancellation {suffix}"), father)
    cancelled_payment = service.update_payment(
        cancelled_payment["id"], {"version": cancelled_payment["version"], "estimated": 5000, "received": 2000}, father,
    )
    service.cancel(cancelled_payment["id"], {"version": cancelled_payment["version"], "reason": "Created by Mistake"}, father)
    inactive_code = f"T{suffix.upper()}"
    database.execute(
        "INSERT INTO app.institutions (id, code, name, institution_type, color, active) VALUES (%s, %s, %s, 'Bank', '#087EA4', TRUE)",
        (uuid.uuid4(), inactive_code, f"Inactive payment test {suffix}"),
    )
    inactive_payment = service.create_task(
        {**payload("valuation-general", f"Inactive institution {suffix}"), "institutionCode": inactive_code}, father,
    )
    service.update_payment(
        inactive_payment["id"], {"version": inactive_payment["version"], "estimated": 5000, "received": 2000}, father,
    )
    database.execute("UPDATE app.institutions SET active = FALSE WHERE code = %s", (inactive_code,))
    pending = service.create_task(payload("valuation-general", f"Pending collection {suffix}"), father)
    service.update_payment(
        pending["id"], {"version": pending["version"], "estimated": 5000, "received": 0}, father,
    )
    overdue = service.create_task(payload("valuation-general", f"Overdue collection {suffix}"), father)
    overdue = service.update_payment(
        overdue["id"],
        {"version": overdue["version"], "estimated": 5000, "received": 2000,
         "dueDate": (today - timedelta(days=1)).isoformat()},
        father,
    )
    assert overdue["payment"]["status"] == "Overdue"
    for payment_filter, expected in [
        ("Partially Received,Received", {valuation["id"], partial["id"]}),
        ("Partially Received,Pending", {partial["id"], pending["id"]}),
    ]:
        options = {
            "search": suffix, "group": "valuation", "period": "daily",
            "periodReference": today.isoformat(), "payment": payment_filter,
        }
        results = service.list_tasks(options, father)
        assert {item["id"] for item in results["items"]} == expected
        assert results["total"] == len(expected)
        expect_error(lambda: service.list_tasks(options, employee), "forbidden")
    valuation = service.close(valuation["id"], {"version": valuation["version"], "note": "Settled."}, employee)
    assert valuation["status"] == "Closed"
    def age_closed(days):
        database.execute("UPDATE app.tasks SET closed_at=%s WHERE id=%s",
                         (datetime.combine(today - timedelta(days=days), time(12), UTC), uuid.UUID(valuation["internalId"])))

    age_closed(16)
    expect_error(lambda: service.reopen(valuation["id"], {"version": valuation["version"], "note": "Too late."}, father), "reopen_expired")
    age_closed(15)
    valuation = service.reopen(valuation["id"], {"version": valuation["version"], "note": "Correction required."}, father)
    assert report_service.artifact_file(original_code, original_file, father)["path"].is_file()
    assert valuation["status"] == "In Progress"
    assert valuation["reportGeneratedAt"] is None

    estimation = service.create_task(payload("estimation", f"Estimate {suffix}"), father)
    estimation_state = {
        "propertyType": "residential",
        "details": {"workMode": "online", "applicantName": f"Estimate {suffix}"},
        "components": [{"name": "Ground Floor", "formData": {"finalAmount": 100000}}],
    }
    estimation_draft = report_service.save_draft(
        estimation["id"],
        {"reportKey": "estimation", "schemaVersion": "3", "revision": 0, "payload": estimation_state},
        father,
    )
    estimation = report_service.register_artifact(
        estimation["id"], father, content=b"workflow estimation", filename="estimation.xlsx",
        artifact_type="estimation_xlsx", source="generated", payload=estimation_state,
        summary={
            "applicantName": f"Estimate {suffix}", "projectLocation": f"Property for Estimate {suffix}",
            "propertyType": "residential", "components": [{"id": "gf", "label": "Ground Floor", "estimatedCost": 100000, "source": "component"}],
            "totalEstimatedCost": 100000,
        },
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    changed_estimation_state = {**estimation_state, "details": {**estimation_state["details"], "place": "Changed"}}
    report_service.save_draft(
        estimation["id"],
        {
            "reportKey": "estimation", "schemaVersion": "3", "revision": estimation_draft["revision"],
            "payload": changed_estimation_state,
        },
        father,
    )
    estimation = service.get_task(estimation["id"])
    expect_error(
        lambda: service.complete(estimation["id"], {"version": estimation["version"], "note": "Outdated estimate."}, father),
        "stale_report",
    )
    estimation = report_service.register_artifact(
        estimation["id"], father, content=b"workflow estimation replacement", filename="estimation-replacement.xlsx",
        artifact_type="estimation_xlsx", source="generated", payload=changed_estimation_state,
        summary={
            "applicantName": f"Estimate {suffix}", "projectLocation": f"Property for Estimate {suffix}",
            "propertyType": "residential", "components": [{"id": "gf", "label": "Ground Floor", "estimatedCost": 100000, "source": "component"}],
            "totalEstimatedCost": 100000,
        },
    )["task"]
    estimation = service.complete(estimation["id"], {"version": estimation["version"], "note": "Estimate completed."}, father)

    candidates = service.eligible_estimations("completion", today.isoformat())
    assert any(item["id"] == estimation["id"] for item in candidates["items"])

    completion = service.create_task(payload("completion", f"Estimate {suffix}", linked=estimation["id"]), father)
    completion_state = {
        "linkedEstimationId": estimation["id"],
        "details": {"reportDate": today.isoformat(), "visitDate": today.isoformat(), "place": "Adoni", "noDeviation": "yes"},
        "components": [{"id": "gf", "label": "Ground Floor", "estimatedCost": 100000, "completionPercent": 100, "completedCost": 100000, "manualCompleted": False}],
        "bank": {"releases": []},
        "photos": [{"name": "completion.png", "data": f"data:image/png;base64,{png}"}],
    }
    completion_draft = report_service.save_draft(
        completion["id"],
        {"reportKey": "completion", "schemaVersion": "1", "revision": 0, "payload": completion_state},
        father,
    )
    completion = report_service.register_artifact(
        completion["id"], father, content=b"workflow completion", filename="completion.docx",
        artifact_type="completion_docx", source="generated", payload=completion_draft["payload"],
        summary={"reportType": "completion", "components": completion_state["components"]},
    )["task"]
    linked_reports = service.progress_reports_for(estimation["id"])
    assert [item["id"] for item in linked_reports] == [completion["id"]]
    assert linked_reports[0]["progressSummary"]["reportType"] == "completion"
    expect_error(lambda: service.progress_reports_for(valuation["id"]), "invalid_request")
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    progress = service.create_task(payload("progress", f"Estimate {suffix}", linked=estimation["id"]), father)
    retro_draft = {
        **completion_state, "preparationMethod": "offline", "photos": [],
        "components": [{**completion_state["components"][0], "completionPercent": 60}],
    }
    report_service.save_draft(
        progress["id"], {"reportKey": "progress", "schemaVersion": "1", "revision": 0, "payload": retro_draft}, father
    )
    progress = report_service.register_artifact(
        progress["id"], father, content=b"%PDF-1.4 retrospective progress", filename="progress.pdf",
        artifact_type="progress_pdf", source="uploaded", payload={"retrospective": True}, work_note="Checked the offline report.",
    )["task"]
    assert progress["retrospectiveReady"] and progress["ownPreparationSource"] == "retrospective"
    assert progress["preparationSource"] == "online" and progress["progressSummary"]["worksTotal"] == 60000
    progress = service.complete(progress["id"], {"version": progress["version"]}, father)
    database.execute("UPDATE app.tasks SET completed_at=NOW()-INTERVAL '100 days' WHERE id=%s", (uuid.UUID(progress["internalId"]),))
    expect_error(lambda: service.reopen(progress["id"], {"version": progress["version"], "note": "Review."}, employee), "forbidden")
    progress = service.reopen(progress["id"], {"version": progress["version"], "note": "Review after 100 days."}, father)
    assert progress["status"] == "In Progress"

    changed_completion_state = {
        **completion_state,
        "details": {**completion_state["details"], "visitDate": (today - timedelta(days=1)).isoformat()},
    }
    changed_completion_draft = report_service.save_draft(
        completion["id"],
        {"reportKey": "completion", "schemaVersion": "1", "revision": completion_draft["revision"], "payload": changed_completion_state},
        father,
    )
    completion = service.get_task(completion["id"])
    assert completion["reportFresh"] is False
    expect_error(
        lambda: service.complete(completion["id"], {"version": completion["version"], "note": "Outdated completion report."}, father),
        "stale_report",
    )
    report_service.save_draft(
        completion["id"], {"reportKey": "completion", "schemaVersion": "1", "revision": changed_completion_draft["revision"],
                           "payload": {**changed_completion_state, "preparationMethod": "offline", "uploadType": "template"}}, father,
    )
    def attach_filled_completion():
        return report_service.register_artifact(
            completion["id"], father, content=b"%PDF-1.4 filled completion", filename="completion.pdf",
            artifact_type="completion_pdf", source="uploaded",
            payload={"retrospective": True, "preparationSource": "template"}, work_note="Verified filled completion template.",
        )["task"]

    try:
        attach_filled_completion()
    except report_service.ReportDataError as error:
        assert error.code == "template_download_required"
    else:
        raise AssertionError("Filled template uploads must require a prior template download.")
    service.record_template_download(completion["id"], father, linked_report_inputs=changed_completion_state)
    completion = attach_filled_completion()
    assert completion["retrospectiveReady"] and completion["ownPreparationSource"] == "template"
    assert completion["preparationSource"] == "online"
    completion = service.complete(completion["id"], {"version": completion["version"]}, father)
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert database.execute("SELECT COUNT(*) AS count FROM app.report_draft_files WHERE task_id = %s", (uuid.UUID(completion["internalId"]),)).fetchone()["count"] == 0
    cleaned_completion = database.execute("SELECT payload FROM app.report_drafts WHERE task_id = %s", (uuid.UUID(completion["internalId"]),)).fetchone()["payload"]
    assert cleaned_completion["photos"] == []
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
