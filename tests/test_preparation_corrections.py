"""Regression coverage for preparation sources, download prerequisites and linked estimation corrections."""

from __future__ import annotations

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

stored_keys = []
def latest(task):
    return workflow.get_task(task["id"])

def version(task):
    return latest(task)["version"]

def fails(call, code):
    database.execute("SAVEPOINT expected_failure")
    try:
        call()
    except (reports.ReportDataError, workflow.WorkflowError) as error:
        database.execute("ROLLBACK TO SAVEPOINT expected_failure")
        database.execute("RELEASE SAVEPOINT expected_failure")
        assert error.code == code, (error.code, str(error))
    else:
        raise AssertionError("Expected " + code)

try:
    unknown = workflow.create_task(task_payload("valuation-general", f"Unknown source {suffix}"), father)
    assert unknown["preparationSource"] == ""
    assert workflow.list_tasks({"search":suffix,"preparationSource":"unknown"}, father)["total"] == 1
    parent = workflow.create_task(task_payload("estimation", f"Preparation cascade {suffix}"), father)
    draft = reports.save_draft(parent["id"], {"reportKey":"estimation", "revision":0, "payload":{"details":{"workMode":"offline", "uploadType":"template", "applicantName":"QA Applicant", "projectLocation":"Adoni"}, "components":[]}}, father)
    summary = {"applicantName":"QA Applicant", "projectLocation":"Adoni", "components":[{"id":"ground", "label":"Ground Floor", "estimatedCost":1000}], "totalEstimatedCost":1000}
    def upload(source, totals=summary):
        return reports.register_artifact(parent["id"], father, content=b"%PDF-1.4 test", filename="existing-estimate.pdf", artifact_type="estimation_pdf", source="uploaded", payload={"retrospective":True,"preparationSource":source}, summary=totals, work_note="Reviewed the estimation and its component totals.")
    fails(lambda: upload("template"), "template_download_required")
    fails(lambda: upload("unrecognized"), "invalid_preparation_source")
    workflow.record_template_download(parent["id"], father)
    assert latest(parent)["templateDownloadedAt"]
    upload("template")
    assert latest(parent)["retrospectiveReady"]
    parent = workflow.complete(parent["id"], {"version":version(parent),"note":""},father)
    parent = workflow.update_payment(parent["id"], {"version":version(parent),"estimated":500,"agreed":500,"received":500}, father)
    parent = workflow.close(parent["id"], {"version":version(parent)}, father)
    assert parent["finalInstitutionArtifact"]["artifactType"] == "estimation_pdf"
    children=[]
    for key,percent in [("progress",50),("completion",100)]:
        child=workflow.create_task(task_payload(key,f"Child {key} {suffix}",parent["id"]),father)
        data={"linkedEstimationId":parent["id"],"details":{"reportDate":"2026-11-04"},"components":[{"id":"ground","label":"Ground Floor","estimatedCost":1000,"completionPercent":percent,"completedCost":percent*10,"manualCompleted":key=="completion"}],"photos":[]}
        reports.save_draft(child["id"],{"reportKey":key,"revision":0,"payload":data},father)
        reports.register_artifact(child["id"],father,content=b"test document",filename="report.docx",artifact_type=key+"_docx",source="generated",payload=data)
        child=workflow.complete(child["id"],{"version":version(child),"note":"Reviewed generated report."},father)
        child=workflow.update_payment(child["id"],{"version":version(child),"estimated":500,"agreed":500,"received":500},father)
        child=workflow.close(child["id"],{"version":version(child)},father)
        database.execute("UPDATE app.tasks SET closed_at=NOW()-INTERVAL '20 days',completed_at=NOW()-INTERVAL '20 days' WHERE task_code=%s",(child["id"],))
        children.append(child)
    assert len(workflow.list_tasks({"search":suffix,"preparationSource":"template","limit":100},father)["items"])==3
    fails(lambda:workflow.list_tasks({"preparationSource":"template"},employee),"forbidden")
    parent=workflow.reopen(parent["id"],{"version":version(parent),"note":"Correct the parent estimate and every linked report."},father)
    for child in children:
        fresh=latest(child)
        assert fresh["status"]=="In Progress" and fresh["estimationCorrectionPending"]
        assert fresh["payment"]["received"]==500
        fails(lambda: reports.register_artifact(child["id"],father,content=b"test",filename="report.docx",artifact_type=child["reportKey"]+"_docx",source="generated",payload={}),"estimation_pending")
    draft=reports.get_draft(parent["id"],father)
    values=draft["payload"]; values["details"]["uploadType"]="retrospective"
    reports.save_draft(parent["id"],{"reportKey":"estimation","revision":draft["revision"],"payload":values},father)
    assert all(latest(child)["preparationSource"]=="retrospective" for child in children)
    revised={**summary,"identityVersion":2,"applicantName":"QA Applicant, Adoni","workDescription":"Proposed construction of an Office Building","workAddress":"Plot No. 52, Adoni","components":[{"id":"ground","label":"Office Building GF","estimatedCost":2000},{"id":"first","label":"First Floor","estimatedCost":4000}],"totalEstimatedCost":6000}
    upload("retrospective",revised)
    parent=workflow.complete(parent["id"],{"version":version(parent),"note":""},father)
    for child in children:
        fresh=latest(child); assert not fresh["estimationCorrectionPending"] and fresh["estimationReviewRequired"]
        loaded=reports.get_draft(child["id"],father)
        form=loaded["payload"]; ground=form["components"][0]
        assert ground["estimatedCost"]==2000
        assert ground["label"]=="Office Building GF"
        assert "Ground Floor" not in form["details"]["estimationRemovedComponents"]
        assert fresh["estimationSummary"]["identityVersion"]==2
        assert fresh["estimationSummary"]["workAddress"]=="Plot No. 52, Adoni"
        if child["reportKey"]=="progress": assert ground["completionPercent"]==50 and ground["completedCost"]==1000
        else: assert ground["manualCompleted"] and ground["completedCost"]==1000 and ground["estimationReviewReason"]
        assert form["components"][1]["completionPercent"]==""
        fails(lambda:reports.register_artifact(child["id"],father,content=b"test",filename="report.docx",artifact_type=child["reportKey"]+"_docx",source="generated",payload=form),"estimation_review_required")
        form["details"]["estimationRevisionReviewed"]=fresh["linkedEstimationSnapshotId"]
        form["components"][1]["completionPercent"]=25
        reports.register_artifact(child["id"],father,content=b"reviewed",filename="report.docx",artifact_type=child["reportKey"]+"_docx",source="generated",payload=form)
    assert workflow.list_tasks({"search":suffix,"group":"progress","preparationSource":"retrospective"},father)["total"]==1
    assert workflow.list_tasks({"search":suffix,"group":"completion","preparationSource":"template"},father)["total"]==0
    assert latest(parent)["completionLockedAt"], "Revisions must not permit duplicate new Completion work"
    online = {"values":{"report.valuation_date":"2026-11-04"}, "photos":[], "map":None}
    assert reports.report_input_fingerprint(online, "valuation-general") == reports.report_input_fingerprint({**online,"preparationMethod":"online","uploadType":"template"}, "valuation-general")
    valuation_form = {"values":{},"preparationMethod":"offline","uploadType":"retrospective"}
    saved = reports.save_draft(unknown["id"], {"reportKey":"valuation-general","revision":0,"payload":valuation_form}, father)
    reports.register_artifact(unknown["id"], father, content=b"%PDF-1.4 test", filename="valuation.pdf", artifact_type="valuation_pdf", source="uploaded", payload={"retrospective":True,"preparationSource":"retrospective"}, work_note="Reviewed the historical valuation.")
    assert latest(unknown)["reportFresh"]
    valuation_form["uploadType"] = "template"
    reports.save_draft(unknown["id"], {"reportKey":"valuation-general","revision":saved["revision"],"payload":valuation_form}, father)
    assert not latest(unknown)["reportFresh"], "Changing upload type must require a new retained attachment"
    fails(lambda:workflow.complete(unknown["id"],{"version":version(unknown)},father),"stale_report")
    valuation_form["uploadType"] = "retrospective"
    current_draft = reports.get_draft(unknown["id"], father)
    reports.save_draft(unknown["id"], {"reportKey":"valuation-general","revision":current_draft["revision"],"payload":valuation_form}, father)
    original = workflow.complete(unknown["id"], {"version":version(unknown)}, father)
    revaluation = workflow.create_task({**task_payload("revaluation", f"File-only revaluation {suffix}"),
                                        "linkedValuationId":original["id"]}, father)
    assert revaluation["revaluationManualEntry"]
    copy = reports.get_draft(revaluation["id"], father)["payload"]
    assert copy["values"] == {} and copy["photos"] == [] and copy["map"] is None
    assert copy["preparationMethod"] == "offline" and copy["uploadType"] == "retrospective"
    assert reports.artifact_file(original["id"], revaluation["linkedValuationArtifactId"], father)["path"].is_file()
    switch_task = workflow.create_task(task_payload("estimation", f"Distinct format roundtrip {suffix}"), father)
    original_state = {"details":{"workMode":"online"},"components":[]}
    switched = reports.save_draft(switch_task["id"], {"reportKey":"estimation","revision":0,"payload":original_state}, father)
    reports.register_artifact(switch_task["id"], father, content=b"test xlsx", filename="switch.xlsx", artifact_type="estimation_xlsx", source="generated", payload=switched["payload"], summary={"components":[{"id":"ground","label":"Ground Floor","estimatedCost":1000}],"totalEstimatedCost":1000})
    assert latest(switch_task)["reportFresh"]
    switched = reports.save_draft(switch_task["id"], {"reportKey":"estimation","revision":switched["revision"],"payload":{"details":{"workMode":"offline","uploadType":"retrospective"},"components":[]}}, father)
    assert not latest(switch_task)["reportFresh"]
    # Restoring the original payload must not restore its old qualification.
    switched = reports.save_draft(switch_task["id"], {"reportKey":"estimation","revision":switched["revision"],"payload":original_state}, father)
    assert switched["payload"]["details"]["preparationRevision"] == 2
    assert not latest(switch_task)["reportFresh"]
    reports.register_artifact(switch_task["id"], father, content=b"fresh xlsx", filename="fresh.xlsx", artifact_type="estimation_xlsx", source="generated", payload=switched["payload"], summary={"components":[{"id":"ground","label":"Ground Floor","estimatedCost":1000}],"totalEstimatedCost":1000})
    assert latest(switch_task)["reportFresh"]
    print("PASS: preparation sources, download gate, CEO filters, linked corrections and method round-trip freshness")
finally:
    stored_keys=[row["storage_key"] for row in database.execute("SELECT storage_key FROM app.stored_files WHERE created_by_user_id=%s",(father_id,)).fetchall()]
    database.rollback();database.close()
    reports.connection=original_report_connection;workflow.connection=original_workflow_connection
    reports._delete_physical(stored_keys)
