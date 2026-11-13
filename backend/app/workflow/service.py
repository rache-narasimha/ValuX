"""Authoritative workflow rules backed by PostgreSQL."""

from __future__ import annotations

import re
from copy import deepcopy
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher
from typing import Any

from psycopg import IntegrityError
from psycopg.types.json import Jsonb

from ..auth.database import connection
from ..business_time import TENANT_TIME_ZONE, TENANT_TIME_ZONE_NAME, tenant_date, tenant_today


STATUSES = ("Unassigned", "In Progress", "On Hold", "Completed", "Closed", "Cancelled")
HOLD_REASONS = ("Awaiting Documents", "Scheduled Site Visit", "Awaiting Review", "Returned for Correction", "Custom")
CANCELLATION_REASONS = ("Created by Mistake", "Wrong Details", "Custom")
CLOSED_REOPEN_WINDOW_DAYS = 15
SIMILAR_TASK_WINDOW_MINUTES = 30
PRIORITY_DUE_DAYS = {
    "Urgent": (0, 1),
    "High": (1, 2),
    "Normal": (2, 4),
}
REPORTS = {
    "valuation-general": ("valuation", "VAL", "General Property Valuation"),
    "valuation-agricultural": ("valuation", "VAL", "Agricultural Land Valuation"),
    "estimation": ("estimation", "EST", "Detailed Building Estimate"),
    "progress": ("progress", "PRG", "Construction Progress Report"),
    "completion": ("completion", "CMP", "Completion Report"),
}


class WorkflowError(Exception):
    """Controlled business failure suitable for a JSON API response."""

    def __init__(self, message: str, status: int = 400, code: str = "invalid_request", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details or {}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _required(value: Any, message: str) -> str:
    result = _text(value)
    if not result:
        raise WorkflowError(message)
    return result


def _date(value: Any, message: str) -> date:
    try:
        return date.fromisoformat(_required(value, message))
    except ValueError as error:
        raise WorkflowError(message) from error


def _money(value: Any) -> Decimal | None:
    if value is None or _text(value) == "":
        return None
    try:
        amount = Decimal(_text(value).replace(",", ""))
    except (InvalidOperation, ValueError) as error:
        raise WorkflowError("Payment amounts must be valid positive numbers or left blank.") from error
    if not amount.is_finite() or amount < 0:
        raise WorkflowError("Payment amounts must be valid positive numbers or left blank.")
    return amount.quantize(Decimal("0.01"))


def _bounded_integer(value: Any, default: int, minimum: int, maximum: int, message: str) -> int:
    try:
        parsed = int(value if value not in (None, "") else default)
    except (TypeError, ValueError) as error:
        raise WorkflowError(message) from error
    return min(maximum, max(minimum, parsed))


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _number(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _actor(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": session["user_id"],
        "name": session["display_name"],
        "role": session["role"],
        "login": session["login_id"],
    }


def _identity(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", _text(value).upper())).strip()


def _customer_token(value: Any) -> str:
    ignored = {"MR", "MRS", "SMT", "SHRI", "SRI", "KUMAR", "SO", "DO", "WO"}
    words = [word for word in re.sub(r"[^A-Z0-9 ]", " ", _text(value).upper()).split() if len(word) >= 3 and word not in ignored]
    return (words[0] if words else "CUSTOMER")[:12]


def _duplicate_key(report_key: str, institution_code: str, assigned_date: date, branch: str, customer: str, property_brief: str) -> str:
    return "|".join((report_key, institution_code, assigned_date.isoformat(), _identity(branch), _identity(customer), _identity(property_brief)))


def _similarity(left: Any, right: Any) -> float:
    return SequenceMatcher(None, _identity(left), _identity(right)).ratio()


def _task_reference(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["task_code"],
        "reportKey": row["report_key"],
        "customerName": row["customer_name"],
        "propertyBrief": row["property_brief"],
        "institutionCode": row["institution_code_snapshot"],
        "institutionName": row["institution_name_snapshot"],
        "branch": row["branch"],
        "assignedDate": _iso(row["assigned_date"]),
        "status": row["status"],
        "url": f'/tasks/detail?id={row["task_code"]}',
    }


def _similar_recent_task(database, report_key: str, institution_id, assigned_date: date, branch: str, customer: str, property_brief: str):
    rows = database.execute(
        """
        SELECT * FROM app.tasks
        WHERE report_key = %s
          AND institution_id = %s
          AND assigned_date = %s
          AND status <> 'Cancelled'
          AND created_at >= NOW() - (%s * INTERVAL '1 minute')
        ORDER BY created_at DESC
        LIMIT 12
        """,
        (report_key, institution_id, assigned_date, SIMILAR_TASK_WINDOW_MINUTES),
    ).fetchall()
    for row in rows:
        customer_score = _similarity(customer, row["customer_name"])
        property_score = _similarity(property_brief, row["property_brief"])
        branch_score = _similarity(branch, row["branch"])
        if customer_score >= 0.84 and property_score >= 0.72 and branch_score >= 0.72 and (customer_score + property_score + branch_score) / 3 >= 0.82:
            return row
    return None


def _payment_values(row: dict[str, Any]) -> dict[str, Any]:
    estimated = row.get("estimated_fee")
    agreed = row.get("agreed_fee")
    received = row.get("received_amount") or Decimal("0")
    basis = agreed if agreed is not None else estimated
    outstanding = max(Decimal("0"), basis - received) if basis is not None else None
    due = row.get("payment_due_date")
    overdue = bool(due and due < tenant_today() and outstanding is not None and outstanding > 0)
    if basis is None:
        status = "Not Set"
    elif outstanding == 0:
        status = "Received"
    elif overdue:
        status = "Overdue"
    elif received <= 0:
        status = "Pending"
    else:
        status = "Partially Received"
    standard_maximum = tenant_date(row["completed_at"]) + timedelta(days=7) if row.get("completed_at") else None
    return {
        "estimated": _number(estimated),
        "agreed": _number(agreed),
        "received": _number(received) or 0,
        "dueDate": _iso(due),
        "status": status,
        "basis": _number(basis),
        "basisSource": "Agreed fee" if agreed is not None else "Estimated fee" if estimated is not None else "",
        "outstanding": _number(outstanding),
        "overdue": overdue,
        "outsideStandard": bool(due and standard_maximum and due > standard_maximum),
        "updatedAt": _iso(row.get("payment_updated_at")),
        "version": row.get("payment_version") or 1,
    }


def _task_payload(row: dict[str, Any], activities: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    group, _code, label = REPORTS[row["report_key"]]
    if row.get("report_group") == "revaluation":
        group = "revaluation"
        label = label.replace("Valuation", "Re-Valuation")
    payment = _payment_values(row)
    # Estimation freshness is persisted in task_artifacts.stale_at whenever its
    # canonical draft fingerprint changes. Comparing old stored fingerprints
    # here would permanently reject XLSX artifacts created before that rule.
    fingerprint_tracked = row["report_key"] in {"valuation-general", "valuation-agricultural", "progress", "completion"}
    fingerprint_current = (
        not fingerprint_tracked
        or row.get("latest_revision_input_fingerprint") is None
        or row.get("draft_input_fingerprint") is None
        or row.get("latest_revision_input_fingerprint") == row.get("draft_input_fingerprint")
    )
    task = {
        "internalId": str(row["id"]),
        "id": row["task_code"],
        "version": row["version"],
        "reportKey": row["report_key"],
        "reportGroup": group,
        "reportLabel": label,
        "reportName": f'{row["customer_name"]} – {label}',
        "institutionId": str(row["institution_id"]),
        "institutionType": row["institution_type_snapshot"],
        "institutionCode": row["institution_code_snapshot"],
        "institutionName": row["institution_name_snapshot"],
        "branch": row["branch"],
        "customerName": row["customer_name"],
        "propertyBrief": row["property_brief"],
        "assigneeId": str(row["assignee_user_id"]) if row.get("assignee_user_id") else "",
        "assignee": row.get("assignee_name_snapshot") or "",
        "priority": row["priority"],
        "status": row["status"],
        "holdReason": row.get("hold_reason") or "",
        "cancellationReason": row.get("cancellation_reason") or "",
        "assignedDate": _iso(row["assigned_date"]),
        "dueDate": _iso(row["due_date"]),
        "linkedValuationId": row.get("linked_valuation_task_code") or "",
        "linkedValuationArtifactId": str(row["linked_valuation_artifact_id"]) if row.get("linked_valuation_artifact_id") else "",
        "revaluationManualEntry": bool(row.get("revaluation_manual_entry")),
        "linkedEstimationId": row.get("linked_estimation_task_code") or "",
        "linkedEstimationInternalId": str(row["linked_estimation_task_id"]) if row.get("linked_estimation_task_id") else "",
        "reportGeneratedAt": _iso(row.get("report_generated_at")),
        "reportFresh": bool(
            row.get("latest_artifact_id")
            and row.get("latest_artifact_stale_at") is None
            and fingerprint_current
        ),
        "completedAt": _iso(row.get("completed_at")),
        "closedAt": _iso(row.get("closed_at")),
        "reopenedAt": _iso(row.get("reopened_at")),
        "preparationSource": (row.get("effective_preparation_source") if row["report_group"] in {"progress", "completion"}
                              else row.get("preparation_source")) or "",
        "templateDownloadedAt": _iso(row.get("template_downloaded_at")),
        "estimationCorrectionPending": bool(row.get("estimation_correction_pending")),
        "estimationReviewRequired": bool(row.get("estimation_review_required")),
        "completionLockedAt": _iso(row.get("completion_blocked_at")),
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
        "payment": payment,
        "latestDocx": None,
        "finalDocx": None,
        "latestXlsx": None,
        "finalXlsx": None,
        "latestInstitutionArtifact": None,
        "finalInstitutionArtifact": None,
        "estimationSummary": _snapshot_payload(row),
        "linkedEstimationSnapshotId": str(row["snapshot_id"]) if row.get("snapshot_id") else "",
        "progressSummary": (row.get("latest_revision_payload") or {}).get("summary"),
        "retrospectiveReady": _retrospective_attachment(row),
        "ownPreparationSource": row.get("preparation_source") or "",
        "activity": activities or [],
    }
    latest = _artifact_payload(row, "latest")
    final = _artifact_payload(row, "final")
    if latest:
        if row.get("latest_artifact_type") in {"valuation_docx", "progress_docx", "completion_docx", "estimation_docx"}:
            task["latestDocx"] = latest
        elif row.get("latest_artifact_type") in {"estimation_xlsx", "kvb_xlsx"}:
            task["latestXlsx"] = latest
        else:
            task["latestInstitutionArtifact"] = latest
    if final:
        if row.get("final_artifact_type") in {"valuation_docx", "progress_docx", "completion_docx", "estimation_docx"}:
            task["finalDocx"] = final
        elif row.get("final_artifact_type") in {"estimation_xlsx", "kvb_xlsx"}:
            task["finalXlsx"] = final
        else:
            task["finalInstitutionArtifact"] = final
    return task


def _artifact_payload(row: dict[str, Any], prefix: str) -> dict[str, Any] | None:
    artifact_id = row.get(f"{prefix}_artifact_id")
    if not artifact_id:
        return None
    source = row.get(f"{prefix}_artifact_source") or "generated"
    artifact_type = row.get(f"{prefix}_artifact_type") or ""
    if source == "uploaded":
        label = "Uploaded Excel" if artifact_type in {"estimation_xlsx", "kvb_xlsx"} else "Attached report"
    else:
        label = "Generated Excel" if artifact_type == "estimation_xlsx" else "Generated report"
    return {
        "id": str(artifact_id),
        "url": f'/api/tasks/{row["task_code"]}/artifacts/{artifact_id}/download',
        "filename": row.get(f"{prefix}_file_name") or "Report file",
        "generatedAt": _iso(row.get(f"{prefix}_artifact_created_at")),
        "source": label,
        "storageId": str(artifact_id),
        "size": row.get(f"{prefix}_file_size"),
        "artifactType": artifact_type,
        "artifactSource": source,
    }


def _snapshot_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    if not row.get("snapshot_id"):
        return None
    components = row.get("snapshot_items") or []
    return {
        "snapshotId": str(row["snapshot_id"]),
        "version": 1,
        "identityVersion": row.get("snapshot_identity_version") or 1,
        "workAddress": row.get("snapshot_project_location") if row.get("snapshot_identity_version") == 2 else "",
        "applicantName": row.get("snapshot_applicant_name") or "",
        "applicantAddress": row.get("snapshot_applicant_address") or "",
        "projectLocation": row.get("snapshot_project_location") or "",
        "workDescription": row.get("snapshot_work_description") or "",
        "propertyType": row.get("snapshot_property_type") or "",
        "propertyTypeLabel": row.get("snapshot_property_type") or "",
        "construction": row.get("snapshot_construction_type") or "",
        "subtype": row.get("snapshot_property_subtype") or "",
        "components": [
            {
                "id": item.get("sourceId") or item["itemKey"],
                "label": item["label"],
                "estimatedCost": float(item["estimatedCost"]),
                "source": item["source"],
            }
            for item in components
        ],
        "totalEstimatedCost": float(row.get("snapshot_total_estimated_cost") or 0),
    }


TASK_SELECT = """
    SELECT t.*, linked.task_code AS linked_estimation_task_code,
           original.task_code AS linked_valuation_task_code,
           CASE WHEN t.report_group IN ('progress', 'completion') THEN linked.preparation_source ELSE t.preparation_source END AS effective_preparation_source,
           p.estimated_fee, p.agreed_fee, p.received_amount,
           p.due_date AS payment_due_date, p.updated_at AS payment_updated_at,
           p.version AS payment_version,
           la.id AS latest_artifact_id, la.artifact_type AS latest_artifact_type,
           la.artifact_source AS latest_artifact_source,
           la.created_at AS latest_artifact_created_at,
           la.stale_at AS latest_artifact_stale_at,
           lf.original_filename AS latest_file_name, lf.size_bytes AS latest_file_size,
           lr.payload AS latest_revision_payload,
           lr.input_fingerprint AS latest_revision_input_fingerprint,
           rd.input_fingerprint AS draft_input_fingerprint,
           fa.id AS final_artifact_id, fa.artifact_type AS final_artifact_type,
           fa.artifact_source AS final_artifact_source,
           fa.created_at AS final_artifact_created_at,
           ff.original_filename AS final_file_name, ff.size_bytes AS final_file_size,
           selected_snapshot.id AS snapshot_id,
           selected_snapshot.applicant_name AS snapshot_applicant_name,
           selected_snapshot.applicant_address AS snapshot_applicant_address,
           selected_snapshot.project_location AS snapshot_project_location,
           selected_snapshot.work_description AS snapshot_work_description,
           selected_snapshot.property_type AS snapshot_property_type,
           selected_snapshot.construction_type AS snapshot_construction_type,
           selected_snapshot.property_subtype AS snapshot_property_subtype,
           selected_snapshot.total_estimated_cost AS snapshot_total_estimated_cost,
           selected_revision.payload -> 'summary' -> 'identityVersion' AS snapshot_identity_version,
           snapshot_rows.items AS snapshot_items
    FROM app.tasks t
    LEFT JOIN app.tasks linked ON linked.id = t.linked_estimation_task_id
    LEFT JOIN app.tasks original ON original.id = t.linked_valuation_task_id
    LEFT JOIN app.task_payments p ON p.task_id = t.id
    LEFT JOIN app.task_artifacts la ON la.id = t.latest_artifact_id
    LEFT JOIN app.stored_files lf ON lf.id = la.stored_file_id AND lf.removed_at IS NULL
    LEFT JOIN app.report_revisions lr ON lr.id = la.report_revision_id
    LEFT JOIN app.report_drafts rd ON rd.task_id = t.id
    LEFT JOIN app.task_artifacts fa ON fa.id = t.final_artifact_id
    LEFT JOIN app.stored_files ff ON ff.id = fa.stored_file_id AND ff.removed_at IS NULL
    LEFT JOIN LATERAL (
        SELECT s.*
        FROM app.estimation_snapshots s
        WHERE s.id = t.linked_estimation_snapshot_id
           OR (t.report_group = 'estimation' AND s.estimation_task_id = t.id)
        ORDER BY (s.id = t.linked_estimation_snapshot_id) DESC, s.snapshot_number DESC
        LIMIT 1
    ) selected_snapshot ON TRUE
    LEFT JOIN app.report_revisions selected_revision ON selected_revision.id = selected_snapshot.source_revision_id
    LEFT JOIN LATERAL (
        SELECT COALESCE(
            jsonb_agg(jsonb_build_object(
                'itemKey', i.item_key,
                'sourceId', i.details ->> 'sourceId',
                'label', i.label,
                'source', i.source_type,
                'estimatedCost', i.estimated_cost
            ) ORDER BY i.display_order),
            '[]'::jsonb
        ) AS items
        FROM app.estimation_snapshot_items i
        WHERE i.snapshot_id = selected_snapshot.id
    ) snapshot_rows ON TRUE
"""


def _activity_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "type": row["event_type"],
        "author": row["actor_name_snapshot"],
        "text": row["message"],
        "details": row["details"],
        "createdAt": _iso(row["created_at"]),
    }


def _activities(database, task_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = database.execute(
        "SELECT * FROM app.task_activities WHERE task_id = %s ORDER BY created_at ASC, id ASC",
        (task_id,),
    ).fetchall()
    return [_activity_payload(row) for row in rows]


def _activity(database, task_id: uuid.UUID, actor: dict[str, Any], event_type: str, message: str, details: dict[str, Any] | None = None, *, notification: str | None = None) -> None:
    activity_id = uuid.uuid4()
    database.execute(
        """
        INSERT INTO app.task_activities
            (id, task_id, event_type, actor_user_id, actor_name_snapshot, message, details)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (activity_id, task_id, event_type, actor["id"], actor["name"], message, Jsonb(details or {})),
    )
    if notification:
        from .notifications import record

        record(database, task_id, activity_id, actor["id"], notification)


def _revaluation_activity(database, task, actor, action):
    original_id = task.get("linked_valuation_task_id")
    if original_id:
        code = task["task_code"]
        artifact = task.get("linked_valuation_artifact_id")
        _activity(database, original_id, actor, "status", f"Revaluation {code} {action}.",
                  {"revaluationTaskId": code, "revaluationEvent": action,
                   "sourceArtifactId": str(artifact) if artifact else None})


def _task_row(database, task_code: str, lock: bool = False) -> dict[str, Any]:
    suffix = " FOR UPDATE OF t" if lock else ""
    row = database.execute(f"{TASK_SELECT} WHERE t.task_code = %s{suffix}", (task_code,)).fetchone()
    if not row:
        raise WorkflowError("Task not found.", 404, "not_found")
    return row


def _check_version(row: dict[str, Any], supplied: Any) -> None:
    try:
        version = int(supplied)
    except (TypeError, ValueError) as error:
        raise WorkflowError("Refresh the task before making this change.", 409, "version_required") from error
    if version != row["version"]:
        raise WorkflowError("This task changed in another session. Refresh it before trying again.", 409, "version_conflict")


def _can_change(actor: dict[str, Any], row: dict[str, Any]) -> bool:
    return actor["role"] == "father" or row.get("assignee_user_id") == actor["id"]


def _update_task(database, task_id: uuid.UUID, assignments: str, values: tuple[Any, ...]) -> None:
    database.execute(
        f"UPDATE app.tasks SET {assignments}, version = version + 1, updated_at = NOW() WHERE id = %s",
        (*values, task_id),
    )


def _retrospective_attachment(row):
    return row.get("latest_artifact_source") == "uploaded" and (
        row.get("latest_artifact_type") in {"valuation_docx", "valuation_pdf"}
        or row.get("preparation_source") in {"template", "retrospective"}
        and row.get("latest_artifact_type") in {
            "estimation_xlsx", "estimation_docx", "estimation_pdf",
            "progress_docx", "progress_pdf", "completion_docx", "completion_pdf",
        }
    )


def set_preparation_source(database, task, actor, source):
    """Record an explicit method; absence of legacy metadata remains unknown."""
    if source not in {"online", "template", "retrospective"}:
        return False
    if task["report_group"] not in {"estimation", "valuation", "progress", "completion", "revaluation"}:
        return False
    if task.get("preparation_source") == source:
        return False
    previous = task.get("preparation_source")
    _update_task(database, task["id"], "preparation_source = %s", (source,))
    _activity(database, task["id"], actor, "note", "Preparation method selected: " +
              {"online": "Online", "template": "Filled template", "retrospective": "Retrospective"}[source] + ".",
              {"previousPreparationSource": previous, "preparationSource": source})
    task["preparation_source"] = source
    return True


def record_template_download(task_code, session, *, linked_report_inputs=None):
    actor = _actor(session)
    with connection() as database:
        task = _task_row(database, task_code, lock=True)
        if not _can_change(actor, task) or task["status"] not in {"In Progress", "On Hold"}:
            raise WorkflowError("The template can be downloaded only for an editable active task.", 403, "forbidden")
        if linked_report_inputs is not None:
            require_estimation_ready(database, task, linked_report_inputs, verify_components=True)
        _update_task(database, task["id"], "template_downloaded_at = NOW()", ())
        _activity(database, task["id"], actor, "note", "Report template downloaded.", {"templateDownloaded": True})


def require_estimation_ready(database, task, payload=None, *, verify_components=False):
    if task["report_group"] not in {"progress", "completion"}:
        return
    parent = database.execute("SELECT status FROM app.tasks WHERE id = %s", (task["linked_estimation_task_id"],)).fetchone()
    if task.get("estimation_correction_pending") or not parent or parent["status"] not in {"Completed", "Closed"}:
        raise WorkflowError("Finalize the revised estimation before preparing or completing this linked report.", 409, "estimation_pending")
    if task.get("estimation_review_required"):
        reviewed = (payload or {}).get("details", {}).get("estimationRevisionReviewed")
        if reviewed != str(task.get("linked_estimation_snapshot_id") or ""):
            raise WorkflowError("Review the revised estimation components and confirm the correction before generating this report.", 409, "estimation_review_required")
    if verify_components or task.get("estimation_review_required"):
        expected = database.execute("SELECT details,item_key,label,estimated_cost FROM app.estimation_snapshot_items WHERE snapshot_id=%s ORDER BY display_order", (task["linked_estimation_snapshot_id"],)).fetchall()
        supplied = {str(item.get("id")): item for item in (payload or {}).get("components", [])}
        matches = len(supplied) == len(expected)
        for item in expected:
            key = str((item["details"] or {}).get("sourceId") or item["item_key"])
            try:
                amount = Decimal(str(supplied.get(key, {}).get("estimatedCost", -1)))
                matches = matches and amount.is_finite() and amount.quantize(Decimal("0.01")) == item["estimated_cost"]
            except (InvalidOperation, ValueError, TypeError):
                matches = False
        if not matches:
            raise WorkflowError("Reload this report to use the revised estimation component totals.", 409, "estimation_components_changed")


def _refresh_linked_reports(database, estimation, actor):
    """Advance existing dependants to a new revision, retaining observations for review."""
    if not database.execute("SELECT 1 FROM app.tasks WHERE linked_estimation_task_id=%s AND estimation_correction_pending AND status<>'Cancelled' LIMIT 1", (estimation["id"],)).fetchone():
        return
    snapshot = database.execute("SELECT id FROM app.estimation_snapshots WHERE estimation_task_id = %s ORDER BY snapshot_number DESC LIMIT 1", (estimation["id"],)).fetchone()
    if not snapshot:
        raise WorkflowError("The revised estimation has no retained component totals.")
    items = database.execute("SELECT * FROM app.estimation_snapshot_items WHERE snapshot_id = %s ORDER BY display_order", (snapshot["id"],)).fetchall()
    children = database.execute("SELECT * FROM app.tasks WHERE linked_estimation_task_id = %s AND status <> 'Cancelled' AND estimation_correction_pending FOR UPDATE", (estimation["id"],)).fetchall()
    for child in children:
        draft = database.execute("SELECT * FROM app.report_drafts WHERE task_id = %s FOR UPDATE", (child["id"],)).fetchone()
        content = deepcopy(draft["payload"] if draft else {})
        if not content.get("components"):
            draft_photos = content.get("photos") or []
            prior = database.execute("SELECT payload FROM app.report_revisions WHERE task_id = %s ORDER BY revision_number DESC LIMIT 1", (child["id"],)).fetchone()
            if prior:
                content = deepcopy((prior["payload"] or {}).get("form") or content)
                # Historical report media is not an active draft upload.
                content["photos"] = draft_photos
        old = content.get("components") or []
        matched_old = set()
        revised = []
        for item in items:
            source = item["details"] or {}
            candidates = [index for index, candidate in enumerate(old) if index not in matched_old and str(candidate.get("id")) == str(source.get("sourceId") or item["item_key"])]
            if not candidates:
                labels = {item["label"].strip().casefold(), str(source.get("legacyLabel") or "").strip().casefold()}
                candidates = [index for index, candidate in enumerate(old) if index not in matched_old and str(candidate.get("label", "")).strip().casefold() in labels]
            previous = old[candidates[0]] if len(candidates) == 1 else {}
            if previous:
                matched_old.add(candidates[0])
            amount = float(item["estimated_cost"])
            percent = previous.get("completionPercent", "")
            manual = bool(previous.get("manualCompleted"))
            if "manualCompleted" not in previous and previous.get("completedCost") not in (None, ""):
                # Older revision payloads omitted the override flag. Preserve an
                # observed amount that differs from the percentage calculation.
                old_calculated = float(previous.get("estimatedCost") or 0) * float(percent or 0) / 100
                manual = abs(float(previous["completedCost"]) - old_calculated) > 0.005
            revised.append({**previous, "id": (item["details"] or {}).get("sourceId") or item["item_key"],
                            "label": item["label"], "estimatedCost": amount,
                            "completionPercent": percent,
                            "completedCost": previous.get("completedCost", "") if manual else amount * float(percent or 0) / 100,
                            "manualCompleted": manual,
                            "estimationReviewReason": "Review previous manual completion amount" if manual else "New component" if not previous else ""})
        details = content.setdefault("details", {})
        details.pop("estimationRevisionReviewed", None)
        details["estimationRemovedComponents"] = [item.get("label") for index, item in enumerate(old) if index not in matched_old]
        content["linkedEstimationId"] = estimation["task_code"]
        content["components"] = revised
        content["estimationSnapshotId"] = str(snapshot["id"])
        database.execute("UPDATE app.tasks SET linked_estimation_snapshot_id = %s, estimation_correction_pending = FALSE, estimation_review_required = TRUE, version = version + 1, updated_at = NOW() WHERE id = %s", (snapshot["id"], child["id"]))
        database.execute("INSERT INTO app.report_drafts (task_id, report_key, schema_version, payload, revision, updated_by_user_id) VALUES (%s,%s,'1',%s,1,%s) ON CONFLICT (task_id) DO UPDATE SET payload=EXCLUDED.payload, revision=app.report_drafts.revision+1, input_fingerprint=NULL, preview_fingerprint=NULL, preview_token=NULL, preview_artifact_id=NULL, updated_at=NOW(), updated_by_user_id=EXCLUDED.updated_by_user_id", (child["id"], child["report_key"], Jsonb(content), actor["id"]))
        _activity(database, child["id"], actor, "note", "Revised estimation synchronized. Review component changes and generate a fresh report.", {"estimationTask": estimation["task_code"], "snapshotId": str(snapshot["id"])})


def employees() -> list[dict[str, Any]]:
    with connection() as database:
        rows = database.execute(
            "SELECT id, user_id, display_name, role FROM auth.users WHERE status = 'active' ORDER BY CASE role WHEN 'father' THEN 0 ELSE 1 END, display_name"
        ).fetchall()
    return [{"id": row["user_id"], "databaseId": str(row["id"]), "name": row["display_name"], "role": row["role"]} for row in rows]


def get_task(task_code: str) -> dict[str, Any]:
    with connection() as database:
        row = _task_row(database, task_code)
        result = _task_payload(row, _activities(database, row["id"]))
        if row["report_group"] == "estimation":
            result["linkedReports"] = [{"id": child["task_code"], "status": child["status"], "label": child["report_key"]} for child in database.execute("SELECT task_code,status,report_key FROM app.tasks WHERE linked_estimation_task_id=%s AND status<>'Cancelled' ORDER BY created_at", (row["id"],)).fetchall()]
        if row["report_group"] == "valuation":
            result["revaluations"] = [
                {"id": child["task_code"], "status": child["status"], "assignedDate": _iso(child["assigned_date"])}
                for child in database.execute(
                    "SELECT task_code,status,assigned_date FROM app.tasks WHERE linked_valuation_task_id=%s ORDER BY created_at DESC,id",
                    (row["id"],),
                ).fetchall()
            ]
        return result


def list_tasks(options: dict[str, Any], session: dict[str, Any] | None = None) -> dict[str, Any]:
    limit = _bounded_integer(options.get("limit"), 20, 1, 100, "Use a valid task page size.")
    offset = _bounded_integer(options.get("offset"), 0, 0, 10_000_000, "Use a valid task page offset.")
    conditions: list[str] = []
    params: list[Any] = []
    mappings = {
        "group": ("t.report_group = %s", options.get("group")),
        "status": ("t.status = %s", options.get("status")),
        "assignee": ("t.assignee_name_snapshot = %s", options.get("assignee")),
        "holdReason": ("t.hold_reason = %s", options.get("holdReason")),
        "institution": ("t.institution_code_snapshot = %s", options.get("institution")),
    }
    for key, (clause, value) in mappings.items():
        if value and not (key == "group" and value == "all"):
            conditions.append(clause)
            params.append(value)
    valuation_type = _text(options.get("valuationType"))
    if valuation_type:
        if options.get("group") not in {"valuation", "revaluation"} or valuation_type not in {"general", "agricultural"}:
            raise WorkflowError("Select a valid valuation type for Valuation or Re-Valuation tasks.")
        conditions.append("t.report_key = %s")
        params.append(f"valuation-{valuation_type}")
    preparation = _text(options.get("preparationSource"))
    if preparation:
        if not session or session.get("role") != "father":
            raise WorkflowError("Only the CEO can filter by preparation method.", 403, "forbidden")
        if preparation not in {"online", "template", "retrospective", "unknown"}:
            raise WorkflowError("Select a valid preparation method.")
        expression = "CASE WHEN t.report_group IN ('progress', 'completion') THEN linked.preparation_source ELSE t.preparation_source END"
        conditions.append(f"({expression}) IS NULL" if preparation == "unknown" else f"({expression}) = %s")
        if preparation != "unknown":
            params.append(preparation)
    payment_case = f"""CASE
        WHEN COALESCE(p.agreed_fee, p.estimated_fee) IS NULL THEN 'Not Set'
        WHEN COALESCE(p.received_amount, 0) >= COALESCE(p.agreed_fee, p.estimated_fee) THEN 'Received'
        WHEN p.due_date < (CURRENT_TIMESTAMP AT TIME ZONE '{TENANT_TIME_ZONE_NAME}')::date AND COALESCE(p.received_amount, 0) < COALESCE(p.agreed_fee, p.estimated_fee) THEN 'Overdue'
        WHEN COALESCE(p.received_amount, 0) = 0 THEN 'Pending'
        ELSE 'Partially Received' END"""
    report_label_case = """CASE t.report_key
        WHEN 'valuation-general' THEN 'General Property Valuation'
        WHEN 'valuation-agricultural' THEN 'Agricultural Land Valuation'
        WHEN 'estimation' THEN 'Detailed Building Estimate'
        WHEN 'progress' THEN 'Construction Progress Report'
        WHEN 'completion' THEN 'Completion Report'
        ELSE t.report_key END"""
    search = _text(options.get("search"))
    if search:
        conditions.append(f"CONCAT_WS(' ', t.task_code, t.report_key, t.report_group, ({report_label_case}), t.customer_name, t.property_brief, t.assignee_name_snapshot, t.institution_name_snapshot, t.institution_code_snapshot, t.branch, t.status, t.hold_reason, ({payment_case})) ILIKE %s")
        params.append(f"%{search}%")
    period = _text(options.get("period"))
    date_basis = _text(options.get("dateBasis")) or "assigned"
    status_dates = {"Completed": "completed_at", "Closed": "closed_at"}
    status_date = status_dates.get(_text(options.get("status")))
    if date_basis not in {"assigned", "status"} or (date_basis == "status" and not status_date):
        raise WorkflowError("Select a valid date basis for this task status.")
    if period:
        reference = _date(options.get("periodReference") or tenant_today().isoformat(), "Select a valid period date.")
        if period == "daily":
            start, end = reference, reference + timedelta(days=1)
        elif period == "weekly":
            start, end = reference - timedelta(days=reference.weekday()), reference - timedelta(days=reference.weekday()) + timedelta(days=7)
        elif period == "yearly":
            start, end = date(reference.year, 1, 1), date(reference.year + 1, 1, 1)
        elif period == "monthly":
            start = date(reference.year, reference.month, 1)
            end = date(reference.year + (reference.month == 12), 1 if reference.month == 12 else reference.month + 1, 1)
        else:
            raise WorkflowError("Select a valid task-list period.")
        if date_basis == "status":
            conditions.append(f"t.{status_date} >= %s AND t.{status_date} < %s")
            params.extend(datetime.combine(day, time.min, tzinfo=TENANT_TIME_ZONE) for day in (start, end))
        else:
            conditions.append("t.assigned_date >= %s AND t.assigned_date < %s")
            params.extend((start, end))
    payment_filter = _text(options.get("payment"))
    if payment_filter in {"Partially Received,Received", "Partially Received,Pending"}:
        if not session or session.get("role") != "father":
            raise WorkflowError("Only the CEO can filter by payment collection.", 403, "forbidden")
        conditions.extend((
            "t.status <> 'Cancelled'",
            "EXISTS (SELECT 1 FROM app.institutions i WHERE i.active AND i.code = t.institution_code_snapshot)",
            f"({payment_case}) = ANY(%s)",
        ))
        params.append(payment_filter.split(","))
    elif payment_filter:
        conditions.append(f"({payment_case}) = %s")
        params.append(payment_filter)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    order = "CASE WHEN t.status = 'On Hold' AND t.hold_reason = 'Awaiting Review' THEN 0 ELSE 1 END, " if options.get("status") == "On Hold" else ""
    with connection() as database:
        total = database.execute(f"SELECT COUNT(*) AS count FROM app.tasks t LEFT JOIN app.tasks linked ON linked.id = t.linked_estimation_task_id LEFT JOIN app.task_payments p ON p.task_id = t.id{where}", tuple(params)).fetchone()["count"]
        rows = database.execute(
            f"{TASK_SELECT}{where} ORDER BY {order}t.updated_at DESC, t.task_code DESC LIMIT %s OFFSET %s",
            (*params, limit, offset),
        ).fetchall()
    return {"total": total, "items": [_task_payload(row) for row in rows], "hasMore": offset + limit < total}


def summary(group: str = "all") -> dict[str, int]:
    params: tuple[Any, ...] = ()
    where = ""
    if group and group != "all":
        where = " WHERE report_group = %s"
        params = (group,)
    with connection() as database:
        rows = database.execute(f"SELECT status, COUNT(*) AS count FROM app.tasks{where} GROUP BY status", params).fetchall()
        review = database.execute(f"SELECT COUNT(*) AS count FROM app.tasks{where}{' AND' if where else ' WHERE'} status = 'On Hold' AND hold_reason = 'Awaiting Review'", params).fetchone()["count"]
    counts = {row["status"]: row["count"] for row in rows}
    return {
        "total": sum(counts.values()),
        "unassigned": counts.get("Unassigned", 0),
        "inProgress": counts.get("In Progress", 0),
        "onHold": counts.get("On Hold", 0),
        "awaitingReview": review,
        "completed": counts.get("Completed", 0),
        "closed": counts.get("Closed", 0),
        "cancelled": counts.get("Cancelled", 0),
    }


def create_task(payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    actor = _actor(session)
    report_key = _required(payload.get("reportKey"), "Select a supported report type.")
    revaluation = report_key == "revaluation"
    if not revaluation and report_key not in REPORTS:
        raise WorkflowError("Select a supported report type.")
    report_group, report_code = ("revaluation", "REVAL") if revaluation else REPORTS[report_key][:2]
    institution_code = _required(payload.get("institutionCode"), "Select a valid bank or NBFC.").upper()
    branch = _required(payload.get("branch"), "Enter the assigning branch.")
    customer = _required(payload.get("customerName"), "Enter the applicant or customer name.")
    property_brief = _required(payload.get("propertyBrief"), "Enter the property description.")
    priority = _required(payload.get("priority"), "Select a valid priority.")
    if priority not in PRIORITY_DUE_DAYS:
        raise WorkflowError("Select a valid priority.")
    assigned_date = _date(payload.get("assignedDate"), "Select a valid assigned date.")
    due_date = _date(payload.get("dueDate"), "Select a valid due date.")
    if due_date < assigned_date:
        raise WorkflowError("Due date cannot be earlier than the assigned date.")
    assignee_value = _text(payload.get("assignee"))
    note = _text(payload.get("initialNote"))
    if actor["role"] == "employee" and not assignee_value:
        raise WorkflowError("Employees must assign a new task before creating it.", 403, "forbidden")
    if assignee_value and not note:
        raise WorkflowError("Add an acknowledgement or routing work note for the assignment.")

    with connection() as database:
        institution = database.execute("SELECT * FROM app.institutions WHERE code = %s AND (active = TRUE OR %s) FOR SHARE",
                                       (institution_code, revaluation)).fetchone()
        if not institution:
            raise WorkflowError("The selected institution is inactive or no longer available.")
        assignee = None
        if assignee_value:
            assignee = database.execute(
                "SELECT id, user_id, display_name FROM auth.users WHERE status = 'active' AND (display_name = %s OR user_id = %s)",
                (assignee_value, assignee_value.lower()),
            ).fetchone()
            if not assignee:
                raise WorkflowError("Select a valid employee.")
        original = None
        original_artifact = None
        seed = None
        if revaluation:
            from ..reports.service import revaluation_inputs

            original_code = _required(payload.get("linkedValuationId"), "Select a Completed or Closed valuation.")
            original = _task_row(database, original_code, lock=True)
            if original["report_group"] != "valuation" or original["status"] not in {"Completed", "Closed"}:
                raise WorkflowError("Select a Completed or Closed valuation.")
            if original["institution_id"] != institution["id"]:
                raise WorkflowError("The revaluation institution must match the linked valuation.")
            report_key = original["report_key"]
            branch, customer, property_brief = (original[key] for key in ("branch", "customer_name", "property_brief"))
            original_artifact = original.get("final_artifact_id") if original["status"] == "Closed" else original.get("latest_artifact_id")
            seed = revaluation_inputs(database, original)

        linked = None
        linked_snapshot = None
        linked_code = _text(payload.get("linkedEstimationId"))
        if report_group in {"progress", "completion"}:
            if not linked_code:
                raise WorkflowError("Select a finalized estimation report.")
            linked = database.execute("SELECT * FROM app.tasks WHERE task_code = %s FOR UPDATE", (linked_code,)).fetchone()
            if not linked or linked["report_group"] != "estimation" or linked["status"] not in {"Completed", "Closed"} or not linked["report_generated_at"]:
                raise WorkflowError("Select a finalized estimation report.")
            if linked["institution_id"] != institution["id"]:
                raise WorkflowError("The progress/completion institution must match the linked estimation report.")
            if linked["completion_blocked_at"]:
                raise WorkflowError("This estimation already has a Completion task that reached Completed and cannot be reused.", 409, "estimation_locked")
            linked_snapshot = database.execute(
                "SELECT * FROM app.estimation_snapshots WHERE estimation_task_id = %s ORDER BY snapshot_number DESC LIMIT 1",
                (linked["id"],),
            ).fetchone()
            if not linked_snapshot:
                raise WorkflowError("Select a finalized estimation report with retained component costs.")
        duplicate_key = _duplicate_key(report_key, institution_code, assigned_date, branch, customer, property_brief) if report_group in {"valuation", "estimation"} else None
        if duplicate_key:
            exact = database.execute(
                "SELECT * FROM app.tasks WHERE duplicate_key = %s AND status <> 'Cancelled' ORDER BY created_at DESC LIMIT 1",
                (duplicate_key,),
            ).fetchone()
            if exact:
                raise WorkflowError(
                    "An active task already represents this assignment. Open the existing task instead of creating a duplicate.",
                    409,
                    "duplicate",
                    {"existingTask": _task_reference(exact)},
                )
            similar = _similar_recent_task(database, report_key, institution["id"], assigned_date, branch, customer, property_brief)
            acknowledged = _text(payload.get("allowSimilarTaskId"))
            if similar and acknowledged != similar["task_code"]:
                raise WorkflowError(
                    "A recently created task has very similar assignment details. Review it before creating another task.",
                    409,
                    "similar_task",
                    {"similarTask": _task_reference(similar)},
                )
        base = "-".join((institution_code, _customer_token(customer), report_code, assigned_date.strftime("%d%m%y")))
        database.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (base,))
        suffix_count = database.execute(
            "SELECT COUNT(*) AS count FROM app.tasks WHERE task_code = %s OR LEFT(task_code, LENGTH(%s) + 1) = %s",
            (base, base, f"{base}-"),
        ).fetchone()["count"]
        task_code = base if suffix_count == 0 else f"{base}-{suffix_count + 1:02d}"
        task_id = uuid.uuid4()
        status = "In Progress" if assignee else "Unassigned"
        try:
            database.execute(
                """
                INSERT INTO app.tasks (
                    id, task_code, report_key, report_group, institution_id,
                    institution_code_snapshot, institution_name_snapshot, institution_type_snapshot,
                    branch, customer_name, property_brief, assignee_user_id, assignee_name_snapshot,
                    created_by_user_id, priority, status, assigned_date, due_date,
                    linked_estimation_task_id, linked_estimation_snapshot_id,
                    duplicate_key, linked_valuation_task_id, linked_valuation_artifact_id,
                    revaluation_manual_entry, preparation_source
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    task_id, task_code, report_key, report_group, institution["id"], institution["code"], institution["name"], institution["institution_type"],
                    branch, customer, property_brief, assignee["id"] if assignee else None, assignee["display_name"] if assignee else None,
                    actor["id"], priority, status, assigned_date, due_date,
                    linked["id"] if linked else None, linked_snapshot["id"] if linked_snapshot else None,
                    duplicate_key, original["id"] if original else None, original_artifact,
                    seed["manual"] if seed else False, seed["source"] if seed else None,
                ),
            )
        except IntegrityError as error:
            if "tasks_active_duplicate_key_unique" in str(error):
                raise WorkflowError("An active task already represents this assignment. Open the existing task instead of creating a duplicate.", 409, "duplicate") from error
            if "tasks_active_progress_date_unique" in str(error):
                raise WorkflowError("A Progress task already exists for this estimation and assigned date.", 409, "duplicate") from error
            if "tasks_active_completion_unique" in str(error):
                raise WorkflowError("A Completion task already exists for this estimation.", 409, "duplicate") from error
            raise
        database.execute("INSERT INTO app.task_payments (task_id) VALUES (%s)", (task_id,))
        if seed:
            database.execute(
                """INSERT INTO app.report_drafts (task_id, report_key, schema_version, payload, revision, updated_by_user_id)
                   VALUES (%s, %s, %s, %s, 1, %s)""",
                (task_id, report_key, seed["schemaVersion"], Jsonb(seed["payload"]), actor["id"]),
            )
            _revaluation_activity(database, {"linked_valuation_task_id": original["id"],
                                            "task_code": task_code, "linked_valuation_artifact_id": original_artifact},
                                  actor, "created")
        _activity(database, task_id, actor, "created", f'Assignment created and routed to {assignee["display_name"]}.' if assignee else "Assignment created without an assignee.", notification="assigned" if assignee else "unassigned")
        if note:
            _activity(database, task_id, actor, "note", note)
        row = _task_row(database, task_code)
        return _task_payload(row, _activities(database, task_id))


def _mutate(task_code: str, payload: dict[str, Any], session: dict[str, Any], action) -> dict[str, Any]:
    actor = _actor(session)
    with connection() as database:
        # Estimation correction locks the parent before its dependants. Use the
        # same order for child actions, including Completion's permanent lock.
        link = database.execute("SELECT linked_estimation_task_id FROM app.tasks WHERE task_code=%s", (task_code,)).fetchone()
        if link and link["linked_estimation_task_id"]:
            database.execute("SELECT id FROM app.tasks WHERE id=%s FOR UPDATE", (link["linked_estimation_task_id"],)).fetchone()
        row = _task_row(database, task_code, lock=True)
        _check_version(row, payload.get("version"))
        action(database, row, actor, payload)
        updated = _task_row(database, task_code)
        if row.get("linked_valuation_task_id") and updated["status"] != row["status"]:
            event = {"Completed": "completed", "Closed": "closed", "Cancelled": "cancelled"}.get(updated["status"])
            if updated["status"] == "In Progress" and row["status"] in {"Completed", "Closed"}:
                event = "reopened"
            if event:
                _revaluation_activity(database, updated, actor, event)
        return _task_payload(updated, _activities(database, updated["id"]))


def add_note(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        note = _required(values.get("note"), "Enter a work note.")
        if row["status"] == "Cancelled":
            raise WorkflowError("Work notes cannot be added to this task.", 409, "invalid_transition")
        _activity(database, row["id"], actor, "note", note)
        _update_task(database, row["id"], "status = status", ())
    return _mutate(task_code, payload, session, action)


def assign(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        target_value = _required(values.get("assignee"), "Select an employee.")
        note = _required(values.get("note"), "Add a work note for the assignment or transfer.")
        if row["status"] not in {"Unassigned", "In Progress", "On Hold"}:
            raise WorkflowError("This task cannot be assigned in its current state.", 409, "invalid_transition")
        target = database.execute("SELECT id, user_id, display_name FROM auth.users WHERE status = 'active' AND (display_name = %s OR user_id = %s)", (target_value, target_value.lower())).fetchone()
        if not target:
            raise WorkflowError("Select a valid employee.")
        if actor["role"] == "employee" and row.get("assignee_user_id") != actor["id"] and target["id"] != actor["id"]:
            raise WorkflowError("An employee must assign another employee's task to themselves before editing it.", 403, "forbidden")
        if row.get("assignee_user_id") == target["id"]:
            raise WorkflowError("Select a different employee for the transfer.")
        previous = row.get("assignee_name_snapshot")
        _update_task(database, row["id"], "assignee_user_id = %s, assignee_name_snapshot = %s, status = 'In Progress', hold_reason = NULL", (target["id"], target["display_name"]))
        _activity(database, row["id"], actor, "assignment", f"Task transferred from {previous} to {target['display_name']}." if previous else f"Task assigned to {target['display_name']} and started.", notification="assigned")
        _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def put_on_hold(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        reason = _required(values.get("reason"), "Select a valid on-hold reason.")
        note = _required(values.get("note"), "Add a work note for this status change.")
        if reason not in HOLD_REASONS:
            raise WorkflowError("Select a valid on-hold reason.")
        if not _can_change(actor, row):
            raise WorkflowError("You do not have permission to put this task on hold.", 403, "forbidden")
        if not row.get("assignee_user_id") or row["status"] not in {"In Progress", "On Hold"}:
            raise WorkflowError("Only active assigned work can be placed on hold.", 409, "invalid_transition")
        previous = row.get("hold_reason")
        _update_task(database, row["id"], "status = 'On Hold', hold_reason = %s", (reason,))
        _activity(database, row["id"], actor, "status", f"On-hold reason changed from {previous} to {reason}." if previous else f"Task placed on hold: {reason}.", notification="hold" if row["status"] != "On Hold" else None)
        _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def resume(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        if not _can_change(actor, row):
            raise WorkflowError("You do not have permission to resume this task.", 403, "forbidden")
        if row["status"] != "On Hold":
            raise WorkflowError("Only an on-hold task can be resumed.", 409, "invalid_transition")
        reason = row.get("hold_reason")
        _update_task(database, row["id"], "status = 'In Progress', hold_reason = NULL", ())
        _activity(database, row["id"], actor, "status", f"Task resumed from On Hold{f' ({reason})' if reason else ''}.")
        note = _text(values.get("note"))
        if note:
            _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def mark_report_generated(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        if not _can_change(actor, row) or row["status"] not in {"In Progress", "On Hold"}:
            raise WorkflowError("This report is not editable by the current user.", 403, "forbidden")
        if not row.get("latest_artifact_id") or not row.get("report_generated_at"):
            raise WorkflowError("The generated or attached report file was not retained against this task.", 409, "artifact_missing")
        if row.get("latest_artifact_stale_at"):
            raise WorkflowError("The retained report is outdated. Preview and generate it again before continuing.", 409, "stale_report")
        _update_task(database, row["id"], "status = status", ())
    return _mutate(task_code, payload, session, action)


def mark_report_removed(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, _values):
        if not _can_change(actor, row) or row["status"] not in {"In Progress", "On Hold"}:
            raise WorkflowError("This report attachment can be changed only while the task is active.", 403, "forbidden")
        raise WorkflowError("Remove the retained report through the task artifact endpoint.", 409, "artifact_endpoint_required")
    return _mutate(task_code, payload, session, action)


def complete(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    media_storage_keys: list[str] = []

    def action(database, row, actor, values):
        retrospective = _retrospective_attachment(row)
        note = _text(values.get("note"))
        if not retrospective and not note:
            raise WorkflowError("Add a completion work note.")
        if not _can_change(actor, row):
            raise WorkflowError("You do not have permission to complete this task.", 403, "forbidden")
        if row["status"] != "In Progress" or not row.get("report_generated_at") or not row.get("latest_artifact_id"):
            raise WorkflowError("Generate or attach the report successfully before completing the task.", 409, "invalid_transition")
        if row.get("reopened_at") and row["report_generated_at"] < row["reopened_at"]:
            raise WorkflowError("Generate or attach a new report after reopening before completing the task again.", 409, "stale_report")
        standard_valuation = row["report_key"] == "valuation-agricultural" or (
            row["report_key"] == "valuation-general"
            and row["institution_code_snapshot"] not in {"KVB", "KB"}
        )
        if row["report_key"] == "estimation" and row.get("latest_artifact_stale_at"):
            raise WorkflowError("The retained report is outdated because the form changed. Generate or attach it again before completing the task.", 409, "stale_report")
        if row["report_key"] in {"progress", "completion"}:
            if row.get("latest_artifact_stale_at") or (
                row.get("latest_revision_input_fingerprint")
                and row.get("draft_input_fingerprint")
                and row["latest_revision_input_fingerprint"] != row["draft_input_fingerprint"]
            ):
                raise WorkflowError("The retained report is outdated because the form changed. Preview and generate it again before completing the task.", 409, "stale_report")
        if standard_valuation:
            if row.get("latest_artifact_stale_at") or (
                row.get("latest_revision_input_fingerprint")
                and row.get("draft_input_fingerprint")
                and row["latest_revision_input_fingerprint"] != row["draft_input_fingerprint"]
            ):
                raise WorkflowError("The retained report is outdated because the form changed. Preview and generate it again before completing the task.", 409, "stale_report")
        if row["report_group"] in {"progress", "completion"}:
            draft = database.execute("SELECT payload FROM app.report_drafts WHERE task_id=%s", (row["id"],)).fetchone()
            require_estimation_ready(database, row, draft["payload"] if draft else {})
        now = datetime.now(UTC)
        _update_task(database, row["id"], "status = 'Completed', completed_at = %s, closed_at = NULL, estimation_review_required=FALSE", (now,))
        if row["report_group"] == "estimation":
            _refresh_linked_reports(database, row, actor)
        database.execute("UPDATE app.task_payments SET due_date = COALESCE(due_date, %s), version = version + 1, updated_at = NOW() WHERE task_id = %s", (tenant_today() + timedelta(days=7), row["id"]))
        if row["report_group"] == "completion":
            linked = database.execute("SELECT * FROM app.tasks WHERE id = %s FOR UPDATE", (row["linked_estimation_task_id"],)).fetchone()
            if linked["completion_blocked_at"] and linked["completion_blocked_by_task_id"] != row["id"]:
                raise WorkflowError("The linked estimation is already permanently blocked by another completed Completion task.", 409, "estimation_locked")
            database.execute("UPDATE app.tasks SET completion_blocked_at = COALESCE(completion_blocked_at, %s), completion_blocked_by_task_id = COALESCE(completion_blocked_by_task_id, %s), version = version + 1, updated_at = NOW() WHERE id = %s", (now, row["id"], linked["id"]))
        completion_message = "Task marked Completed using the work note recorded with the offline report upload." if retrospective else "Task marked Completed after report generation."
        _activity(database, row["id"], actor, "status", completion_message, notification="completed")
        if note:
            _activity(database, row["id"], actor, "note", note)
        if row["report_key"] in {"valuation-general", "valuation-agricultural", "progress", "completion"}:
            media_rows = database.execute(
                """
                SELECT sf.id, sf.storage_key
                FROM app.report_draft_files rdf
                JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
                WHERE rdf.task_id = %s AND sf.removed_at IS NULL
                """,
                (row["id"],),
            ).fetchall()
            if media_rows:
                media_storage_keys.extend(item["storage_key"] for item in media_rows)
                file_ids = [item["id"] for item in media_rows]
                database.execute("DELETE FROM app.report_draft_files WHERE task_id = %s", (row["id"],))
                database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = ANY(%s)", (file_ids,))
            draft = database.execute("SELECT payload FROM app.report_drafts WHERE task_id = %s FOR UPDATE", (row["id"],)).fetchone()
            if draft:
                cleaned = dict(draft["payload"] or {})
                cleaned["photos"] = []
                if row["report_key"] in {"valuation-general", "valuation-agricultural"}:
                    cleaned["map"] = None
                database.execute(
                    """
                    UPDATE app.report_drafts
                    SET payload = %s, input_fingerprint = NULL,
                        preview_fingerprint = NULL, preview_token = NULL,
                        preview_artifact_id = NULL, updated_at = NOW()
                    WHERE task_id = %s
                    """,
                    (Jsonb(cleaned), row["id"]),
                )

    result = _mutate(task_code, payload, session, action)
    if media_storage_keys:
        from ..reports import service as report_service

        report_service._delete_physical(media_storage_keys)
    return result


def update_payment(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        if row["status"] in {"Closed", "Cancelled"}:
            raise WorkflowError(f"Payment cannot be updated for a {row['status'].lower()} task.", 409, "invalid_transition")
        estimated = _money(values.get("estimated"))
        agreed = _money(values.get("agreed"))
        received = _money(values.get("received")) or Decimal("0")
        basis = agreed if agreed is not None else estimated
        if basis is not None and received > basis:
            raise WorkflowError("Amount received cannot exceed the agreed or estimated fee.")
        due_date = _date(values.get("dueDate"), "Select a valid payment due date.") if _text(values.get("dueDate")) else row.get("payment_due_date")
        payment_changed = (estimated, agreed, received, due_date) != (
            row.get("estimated_fee"), row.get("agreed_fee"), row.get("received_amount") or Decimal("0"), row.get("payment_due_date"))
        database.execute("UPDATE app.task_payments SET estimated_fee = %s, agreed_fee = %s, received_amount = %s, due_date = %s, updated_by_user_id = %s, version = version + 1, updated_at = NOW() WHERE task_id = %s", (estimated, agreed, received, due_date, actor["id"], row["id"]))
        _update_task(database, row["id"], "status = status", ())
        refreshed = _task_row(database, row["task_code"])
        payment = _payment_values(refreshed)
        outstanding = "N/A" if payment["outstanding"] is None else f"₹{payment['outstanding']:,.2f}"
        _activity(database, row["id"], actor, "payment", f"Payment updated: {payment['status']}; outstanding {outstanding}.", notification="payment" if payment_changed else None)
        note = _text(values.get("note"))
        if note:
            _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def close(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        payment = _payment_values(row)
        if row["status"] != "Completed" or payment["status"] != "Received" or payment["outstanding"] != 0:
            raise WorkflowError("Complete the report and settle the full agreed or estimated fee before closing the request.", 409, "invalid_transition")
        if not row.get("latest_artifact_id"):
            raise WorkflowError("The retained final report is missing.", 409, "artifact_missing")
        _update_task(database, row["id"], "status = 'Closed', closed_at = NOW(), final_artifact_id = latest_artifact_id", ())
        _activity(database, row["id"], actor, "status", "Request closed after payment settlement.", notification="closed")
        note = _text(values.get("note"))
        if note:
            _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def cancel(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        if actor["role"] != "father":
            raise WorkflowError("Only the CEO can cancel this task.", 403, "forbidden")
        reason = _required(values.get("reason"), "Select a valid cancellation reason.")
        note = _text(values.get("note"))
        if reason not in CANCELLATION_REASONS:
            raise WorkflowError("Select a valid cancellation reason.")
        if reason == "Custom" and not note:
            raise WorkflowError("For Custom, explain the cancellation in the work note.")
        if row["status"] in {"Closed", "Cancelled"}:
            raise WorkflowError("This task can no longer be cancelled.", 409, "invalid_transition")
        _update_task(database, row["id"], "status = 'Cancelled', hold_reason = NULL, cancellation_reason = %s", (reason,))
        _activity(database, row["id"], actor, "cancelled", f"Task cancelled. Reason: {reason}.")
        if note:
            _activity(database, row["id"], actor, "note", note)
    return _mutate(task_code, payload, session, action)


def reopen(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    def action(database, row, actor, values):
        if actor["role"] != "father":
            raise WorkflowError("Only the CEO can reopen a completed or closed task.", 403, "forbidden")
        note = _required(values.get("note"), "Add a work note explaining why the completed or closed task is being reopened.")
        if row["status"] not in {"Completed", "Closed"}:
            raise WorkflowError("Only a completed or closed task can be reopened.", 409, "invalid_transition")
        if row["status"] == "Closed":
            closed_at = row.get("closed_at")
            if not closed_at or tenant_today() > tenant_date(closed_at) + timedelta(days=CLOSED_REOPEN_WINDOW_DAYS):
                raise WorkflowError(f"Closed tasks can be reopened within {CLOSED_REOPEN_WINDOW_DAYS} calendar days of closure.", 409, "reopen_expired")
        previous = row["status"]
        if row.get("latest_artifact_id"):
            database.execute("UPDATE app.task_artifacts SET superseded_at = COALESCE(superseded_at, NOW()) WHERE id = %s", (row["latest_artifact_id"],))
        _update_task(database, row["id"], "status = 'In Progress', completed_at = NULL, closed_at = NULL, reopened_at = NOW(), report_generated_at = NULL, latest_artifact_id = NULL", ())
        _activity(database, row["id"], actor, "status", f"{previous} request reopened and returned to In Progress.")
        _activity(database, row["id"], actor, "note", note)
        if row["report_group"] == "estimation":
            children = database.execute("SELECT * FROM app.tasks WHERE linked_estimation_task_id = %s AND status <> 'Cancelled' ORDER BY id FOR UPDATE", (row["id"],)).fetchall()
            for child in children:
                if child.get("latest_artifact_id"):
                    database.execute("UPDATE app.task_artifacts SET stale_at=COALESCE(stale_at,NOW()), superseded_at=COALESCE(superseded_at,NOW()) WHERE id=%s", (child["latest_artifact_id"],))
                terminal = child["status"] in {"Completed", "Closed"}
                database.execute("UPDATE app.tasks SET status=CASE WHEN status IN ('Completed','Closed') THEN 'In Progress' ELSE status END, completed_at=NULL, closed_at=NULL, reopened_at=CASE WHEN %s THEN NOW() ELSE reopened_at END, report_generated_at=NULL, latest_artifact_id=NULL, estimation_correction_pending=TRUE, estimation_review_required=TRUE, version=version+1, updated_at=NOW() WHERE id=%s", (terminal, child["id"]))
                database.execute("UPDATE app.report_drafts SET preview_fingerprint=NULL, preview_token=NULL, preview_artifact_id=NULL, revision=revision+1 WHERE task_id=%s", (child["id"],))
                _activity(database, child["id"], actor, "status", "Linked estimation reopened; this report requires correction. " + note, {"estimationTask": row["task_code"], "previousStatus": child["status"]})
    return _mutate(task_code, payload, session, action)


def eligible_valuations(options):
    limit = _bounded_integer(options.get("limit"), 20, 1, 100, "Use a valid page size.")
    offset = _bounded_integer(options.get("offset"), 0, 0, 10_000_000, "Use a valid page offset.")
    conditions = ["t.report_group = 'valuation'", "t.status IN ('Completed', 'Closed')"]
    params = []
    for option, column in (("institution", "institution_code_snapshot"), ("status", "status")):
        if options.get(option):
            conditions.append(f"t.{column} = %s")
            params.append(options[option])
    if _text(options.get("search")):
        conditions.append("CONCAT_WS(' ',t.task_code,t.customer_name,t.property_brief,t.branch,t.institution_name_snapshot,t.institution_code_snapshot) ILIKE %s")
        params.append(f"%{_text(options['search'])}%")
    where = " AND ".join(conditions)
    with connection() as database:
        total = database.execute(f"SELECT count(*) AS count FROM app.tasks t WHERE {where}", tuple(params)).fetchone()["count"]
        rows = database.execute(f"{TASK_SELECT} WHERE {where} ORDER BY COALESCE(t.closed_at,t.completed_at) DESC NULLS LAST,t.task_code LIMIT %s OFFSET %s",
                                (*params, limit, offset)).fetchall()
    return {"items": [_task_payload(row) for row in rows], "total": total, "hasMore": offset + limit < total}


def eligible_estimations(
    report_key: str,
    assigned_date_value: str,
    search: str = "",
    offset: int = 0,
    limit: int = 20,
    institution: str = "",
    status: str = "",
) -> dict[str, Any]:
    if report_key not in {"progress", "completion"}:
        raise WorkflowError("Select Progress or Completion report type.")
    assigned_date = _date(assigned_date_value, "Select a valid assigned date.")
    limit = _bounded_integer(limit, 20, 1, 50, "Use a valid estimation page size.")
    offset = _bounded_integer(offset, 0, 0, 10_000_000, "Use a valid estimation page offset.")
    conditions = [
        "t.report_group = 'estimation'", "t.status IN ('Completed', 'Closed')",
        "t.report_generated_at IS NOT NULL", "t.latest_artifact_id IS NOT NULL",
        "t.completion_blocked_at IS NULL",
        "EXISTS (SELECT 1 FROM app.estimation_snapshots s WHERE s.estimation_task_id = t.id)",
    ]
    params: list[Any] = []
    if report_key == "completion":
        conditions.append("NOT EXISTS (SELECT 1 FROM app.tasks c WHERE c.linked_estimation_task_id = t.id AND c.report_group = 'completion' AND c.status <> 'Cancelled')")
    else:
        conditions.append("NOT EXISTS (SELECT 1 FROM app.tasks p WHERE p.linked_estimation_task_id = t.id AND p.report_group = 'progress' AND p.assigned_date = %s AND p.status <> 'Cancelled')")
        params.append(assigned_date)
    if _text(search):
        conditions.append("CONCAT_WS(' ', t.task_code, t.customer_name, t.property_brief, t.institution_code_snapshot, t.institution_name_snapshot, t.branch) ILIKE %s")
        params.append(f"%{_text(search)}%")
    if _text(institution):
        conditions.append("t.institution_code_snapshot = %s")
        params.append(_text(institution).upper())
    if _text(status):
        if _text(status) not in {"Completed", "Closed"}:
            raise WorkflowError("Select a valid estimation status filter.")
        conditions.append("t.status = %s")
        params.append(_text(status))
    where = " AND ".join(conditions)
    with connection() as database:
        total = database.execute(f"SELECT COUNT(*) AS count FROM app.tasks t WHERE {where}", tuple(params)).fetchone()["count"]
        rows = database.execute(
            f"""
            {TASK_SELECT}
            WHERE {where}
            ORDER BY t.report_generated_at DESC, t.updated_at DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        ).fetchall()
    return {"total": total, "items": [_task_payload(row) for row in rows], "hasMore": offset + limit < total}


def progress_reports_for(estimation_task_code: str) -> list[dict[str, Any]]:
    """Return retained linked report summaries without loading unrelated tasks."""
    with connection() as database:
        estimation = _task_row(database, estimation_task_code)
        if estimation["report_group"] != "estimation":
            raise WorkflowError("The linked task is not an estimation report.")
        rows = database.execute(
            f"""
            {TASK_SELECT}
            WHERE t.linked_estimation_task_id = %s
              AND t.report_group IN ('progress', 'completion')
              AND t.latest_artifact_id IS NOT NULL
            ORDER BY t.report_generated_at ASC, t.updated_at ASC, t.id ASC
            """,
            (estimation["id"],),
        ).fetchall()
    return [_task_payload(row) for row in rows]
