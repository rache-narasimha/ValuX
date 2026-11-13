"""Regression coverage for durable Phase 3 drafts, files, and snapshots."""

from __future__ import annotations

import base64
import json
import uuid
from contextlib import contextmanager
from datetime import date, timedelta

import psycopg
from psycopg.types.json import Jsonb
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
employee_id = uuid.uuid4()
employee = {
    "user_id": employee_id,
    "display_name": f"Reports Employee {suffix}",
    "role": "employee",
    "login_id": f"reports-employee-{suffix}",
}
today = date.today()
database = psycopg.connect(DATABASE_URL, row_factory=dict_row)
original_report_connection = reports.connection
original_workflow_connection = workflow.connection


@contextmanager
def shared_connection(*_args, **_kwargs):
    yield database


def task_payload(report_key: str, customer: str, linked: str = "", institution_code: str = "CANARA", assignee: str = "") -> dict:
    return {
        "institutionCode": institution_code,
        "branch": "Adoni",
        "customerName": customer,
        "propertyBrief": f"Property for {customer}",
        "reportKey": report_key,
        "linkedEstimationId": linked,
        "assignee": assignee or father["display_name"],
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
database.execute(
    """
    INSERT INTO auth.users
        (id, user_id, display_name, role, status, password_hash, must_change_password)
    VALUES (%s, %s, %s, 'employee', 'active', 'reports-test-only', FALSE)
    """,
    (employee_id, employee["login_id"], employee["display_name"]),
)

stored_keys: list[str] = []
try:
    valuation = workflow.create_task(task_payload("valuation-general", f"Draft {suffix} S/o QA Parent"), father)
    assert reports.valuation_download_filename(valuation["id"], father, ".docx") == f"{valuation['id']}_Draft_{suffix}_S_o_QA_Parent_General_Valuation_Report.docx"
    assert reports.valuation_download_filename(valuation["id"], father, ".pdf").endswith("_General_Valuation_Report.pdf")
    expect_report_error(lambda: reports.valuation_download_filename(valuation["id"], employee, ".docx"), "forbidden")
    expect_report_error(
        lambda: reports.require_report_key(valuation["id"], father, "valuation-agricultural"),
        "report_mismatch",
    )
    png = base64.b64encode(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    ).decode("ascii")
    example_fill = {"active": True, "values": {"site.shape": {"before": "", "inserted": "Rectangular"}}}
    draft = reports.save_draft(
        valuation["id"],
        {
            "reportKey": "valuation-general",
            "schemaVersion": "3",
            "revision": 0,
            "payload": {
                "values": {
                    "applicant": "Durable",
                    "site.shape": "Rectangular",
                    "calculation.overrides": json.dumps({"valuation.present_market_value": "1234567", "valuation.distress_value": "0"}),
                },
                "exampleFill": example_fill,
                "photos": [{"name": "site.png", "data": f"data:image/png;base64,{png}"}],
            },
        },
        father,
    )
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert draft["revision"] == 1
    photo = draft["payload"]["photos"][0]
    assert photo["storedFileId"] and photo["data"].startswith(f"/api/tasks/{valuation['id']}/draft-files/")
    loaded = reports.get_draft(valuation["id"], father)
    assert loaded and loaded["payload"]["values"]["applicant"] == "Durable"
    assert loaded["payload"]["exampleFill"] == example_fill
    assert json.loads(loaded["payload"]["values"]["calculation.overrides"])["valuation.distress_value"] == "0"
    before_override = reports.report_input_fingerprint(loaded["payload"], "valuation-general")
    without_example_tracking = {key: value for key, value in loaded["payload"].items() if key != "exampleFill"}
    assert before_override == reports.report_input_fingerprint(without_example_tracking, "valuation-general")
    edited_payload = {**loaded["payload"], "values": {**loaded["payload"]["values"], "calculation.overrides": "{}"}}
    assert before_override != reports.report_input_fingerprint(edited_payload, "valuation-general"), "Manual adjustments must participate in preview freshness"
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

    download_filename = reports.valuation_download_filename(valuation["id"], father, ".docx")
    artifact = reports.register_artifact(
        valuation["id"], father, content=b"durable valuation", filename=download_filename,
        artifact_type="valuation_docx", source="generated", payload=loaded["payload"],
    )
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert artifact["task"]["latestDocx"]["url"] == artifact["download"]
    assert artifact["filename"] == download_filename
    assert reports.artifact_file(valuation["id"], artifact["artifactId"], father)["filename"] == download_filename
    assert artifact["task"]["reportGeneratedAt"]
    assert artifact["task"]["reportFresh"] is True
    valuation = reports.remove_latest_artifact(valuation["id"], father)
    assert valuation["latestDocx"] is None and valuation["reportGeneratedAt"] is None

    retrospective = workflow.create_task(
        task_payload("valuation-general", f"Historical valuation {suffix}"),
        father,
    )
    reports.save_draft(
        retrospective["id"],
        {
            "reportKey": "valuation-general", "schemaVersion": "3", "revision": 0,
            "payload": {"preparationMethod": "offline", "values": {"owner.details": f"Historical owner {suffix}"}, "photos": [], "map": None},
        },
        father,
    )
    expect_report_error(
        lambda: reports.register_artifact(
            retrospective["id"], father, content=b"generated PDF", filename="generated.pdf",
            artifact_type="valuation_pdf", source="generated", payload={},
        ),
        "invalid_request",
    )
    retrospective = reports.register_artifact(
        retrospective["id"], father, content=b"%PDF-1.4 historical", filename="historical.pdf",
        artifact_type="valuation_pdf", source="uploaded",
        payload={"retrospective": True, "mode": "plain"},
        work_note="Imported from the historical valuation register.",
    )["task"]
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = %s", (father_id,)).fetchall()]
    assert retrospective["retrospectiveReady"] is True
    assert retrospective["latestInstitutionArtifact"]["artifactType"] == "valuation_pdf"
    retrospective = workflow.complete(
        retrospective["id"], {"version": retrospective["version"], "note": ""}, father,
    )
    assert retrospective["status"] == "Completed"
    retained_inputs = reports.get_draft(retrospective["id"], employee)
    assert retained_inputs["readOnly"] is True
    assert retained_inputs["payload"]["values"]["owner.details"] == f"Historical owner {suffix}"
    assert retained_inputs["payload"]["preparationMethod"] == "offline"
    assert retained_inputs["preview"] is None
    expect_report_error(lambda: reports.save_draft(retrospective["id"], {
        "reportKey": "valuation-general", "revision": 0, "payload": retained_inputs["payload"],
    }, father), "invalid_transition")
    expect_report_error(lambda: reports.delete_draft(retrospective["id"], father), "invalid_transition")
    # A retained view must not read later/unrelated draft contents.
    database.execute("UPDATE app.report_drafts SET payload=%s WHERE task_id=(SELECT id FROM app.tasks WHERE task_code=%s)",
                     (Jsonb({"values": {"owner.details": "Unrelated draft"}}), retrospective["id"]))
    assert reports.get_draft(retrospective["id"], father)["payload"]["values"]["owner.details"] == f"Historical owner {suffix}"
    database.execute("UPDATE app.tasks SET status='Closed', final_artifact_id=latest_artifact_id WHERE task_code=%s", (retrospective["id"],))
    assert reports.get_draft(retrospective["id"], employee)["payload"]["values"]["owner.details"] == f"Historical owner {suffix}"
    assert any("Imported from the historical valuation register." in event["text"] for event in retrospective["activity"])
    assert any("offline report upload" in event["text"] for event in retrospective["activity"])

    kvb_offline_bypass = workflow.create_task(
        task_payload("valuation-general", f"KVB route guard {suffix}", institution_code="KVB"),
        father,
    )
    expect_report_error(
        lambda: reports.register_artifact(
            kvb_offline_bypass["id"], father, content=b"PK bypass", filename="bypass.docx",
            artifact_type="valuation_docx", source="uploaded",
            payload={"retrospective": True, "mode": "offline"},
            work_note="This standard offline route must not bypass the KVB workflow.",
        ),
        "invalid_request",
    )

    employee_offline = workflow.create_task(
        task_payload("valuation-general", f"Employee offline {suffix}", assignee=employee["display_name"]),
        father,
    )
    employee_offline_draft = reports.save_draft(
        employee_offline["id"],
        {
            "reportKey": "valuation-general", "schemaVersion": "3", "revision": 0,
            "payload": {"preparationMethod": "offline", "values": {"owner.details": f"Owner {suffix}"}, "photos": [], "map": None},
        },
        employee,
    )
    employee_offline = reports.register_artifact(
        employee_offline["id"], employee, content=b"PK offline employee report", filename="employee-offline.docx",
        artifact_type="valuation_docx", source="uploaded",
        payload={"retrospective": True, "mode": "offline"},
        work_note="Completed offline by the assigned employee.",
    )["task"]
    assert employee_offline_draft["payload"]["preparationMethod"] == "offline"
    assert employee_offline["retrospectiveReady"] is True
    assert employee_offline["reportFresh"] is True
    employee_offline = workflow.complete(
        employee_offline["id"], {"version": employee_offline["version"], "note": ""}, employee,
    )
    assert employee_offline["status"] == "Completed"

    employee_agricultural_offline = workflow.create_task(
        task_payload("valuation-agricultural", f"Employee agricultural offline {suffix}", assignee=employee["display_name"]),
        father,
    )
    reports.save_draft(
        employee_agricultural_offline["id"],
        {
            "reportKey": "valuation-agricultural", "schemaVersion": "2", "revision": 0,
            "payload": {"preparationMethod": "offline", "values": {"owner.details": f"Agricultural owner {suffix}"}, "photos": [], "map": None},
        },
        employee,
    )
    employee_agricultural_offline = reports.register_artifact(
        employee_agricultural_offline["id"], employee, content=b"%PDF-1.4 agricultural offline", filename="agricultural-offline.pdf",
        artifact_type="valuation_pdf", source="uploaded",
        payload={"retrospective": True, "mode": "offline"},
        work_note="Completed the agricultural valuation offline.",
    )["task"]
    assert employee_agricultural_offline["retrospectiveReady"] is True
    assert employee_agricultural_offline["reportFresh"] is True
    employee_agricultural_offline = workflow.complete(
        employee_agricultural_offline["id"], {"version": employee_agricultural_offline["version"], "note": ""}, employee,
    )
    assert employee_agricultural_offline["status"] == "Completed"

    agricultural = workflow.create_task(task_payload("valuation-agricultural", f"Agricultural {suffix}"), father)
    assert reports.valuation_download_filename(agricultural["id"], father, ".docx") == f"{agricultural['id']}_Agricultural_{suffix}_Agricultural_Valuation_Report.docx"
    agricultural_draft = reports.save_draft(
        agricultural["id"],
        {
            "reportKey": "valuation-agricultural", "schemaVersion": "1", "revision": 0,
            "payload": {"values": {"owner.name": f"Owner {suffix}", "calculation.overrides": json.dumps({"valuation.estimated_value_display": "1234567"})}, "photos": [], "map": None},
        },
        father,
    )
    agricultural_loaded = reports.get_draft(agricultural["id"], father)
    assert json.loads(agricultural_loaded["payload"]["values"]["calculation.overrides"])["valuation.estimated_value_display"] == "1234567"
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

    industrial = workflow.create_task(task_payload("estimation", f"Industrial Centre Line {suffix}"), father)
    industrial_state = {
        "propertyType": "industrial",
        "details": {"workMode": "offline", "measurementMethod": "centre_line", "uploadType": "retrospective"},
    }
    expect_report_error(lambda: reports.save_draft(
        industrial["id"],
        {"reportKey": "estimation", "schemaVersion": "3", "revision": 0,
         "payload": {**industrial_state, "details": {**industrial_state["details"], "workMode": "online"}}},
        father,
    ), "invalid_request")
    reports.save_draft(
        industrial["id"],
        {"reportKey": "estimation", "schemaVersion": "3", "revision": 0, "payload": industrial_state},
        father,
    )
    workflow.record_template_download(industrial["id"], father)
    expect_report_error(lambda: reports.register_artifact(
        industrial["id"], father, content=b"industrial preview", filename="preview.pdf",
        artifact_type="preview_pdf", source="generated", payload=industrial_state,
        current=False, preview_token="industrial-centre-line",
    ), "invalid_request")
    expect_report_error(lambda: reports.register_artifact(
        industrial["id"], father, content=b"filled industrial template", filename="estimate.xlsx",
        artifact_type="estimation_xlsx", source="uploaded",
        payload={"retrospective": True, "preparationSource": "template"},
    ), "invalid_request")
    industrial = reports.register_artifact(
        industrial["id"], father, content=b"%PDF-1.4 industrial estimate", filename="estimate.pdf",
        artifact_type="estimation_pdf", source="uploaded",
        payload={"retrospective": True, "preparationSource": "retrospective"},
        summary={"components": [{"label": "Production Hall", "estimatedCost": 125000}], "totalEstimatedCost": 125000},
        work_note="Industrial Centre Line report prepared offline.",
    )["task"]
    assert industrial["retrospectiveReady"] and industrial["estimationSummary"]["totalEstimatedCost"] == 125000

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
    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = ANY(%s)", ([father_id, employee_id],)).fetchall()]
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

    stored_keys = [row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id = ANY(%s)", ([father_id, employee_id],)).fetchall()]
    print("PASS: durable report drafts, local files, artifacts, and estimation snapshots")
finally:
    database.rollback()
    database.close()
    reports.connection = original_report_connection
    workflow.connection = original_workflow_connection
    reports._delete_physical(stored_keys)
