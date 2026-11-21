"""Durable report data and authenticated file storage."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import uuid
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from ..auth.database import connection
from ..estimation.presentation import industrial_centre_line
from ..valuation.config import OUTPUT_DIR
from ..valuation.config import AGRICULTURAL_TEMPLATE, APP_ROOT, TEMPLATE
from ..workflow import service as workflow_service
from . import object_storage


STORAGE_ROOT = OUTPUT_DIR / "task_files"
StorageReference = tuple[str, str]
LOGGER = logging.getLogger(__name__)
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
ARTIFACT_TYPES = {
    "valuation_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "valuation_pdf": ({".pdf"}, "application/pdf"),
    "kvb_xlsx": ({".xlsx"}, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "valocity_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "valocity_pdf": ({".pdf"}, "application/pdf"),
    "estimation_xlsx": ({".xlsx"}, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "estimation_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "estimation_pdf": ({".pdf"}, "application/pdf"),
    "progress_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "completion_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "progress_pdf": ({".pdf"}, "application/pdf"),
    "completion_pdf": ({".pdf"}, "application/pdf"),
    "preview_pdf": ({".pdf"}, "application/pdf"),
}


class ReportDataError(Exception):
    """Controlled report-data failure suitable for a JSON response."""

    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status = status
        self.code = code


def _current_template_version(report_key: str) -> str:
    media_layout = APP_ROOT / "backend/app/valuation/media.py"
    sources = {
        "valuation-general": [
            TEMPLATE, media_layout,
            *[APP_ROOT / f"backend/app/valuation/{name}.py" for name in ("reports", "ooxml", "calculations", "construction", "cover")],
        ],
        "valuation-agricultural": [AGRICULTURAL_TEMPLATE, media_layout],
        "estimation": [APP_ROOT / "resources/estimation/estimation_manifest.json", APP_ROOT / "backend/app/estimation/generator.py"],
        "progress": [APP_ROOT / "backend/app/progress/generator.py", media_layout],
        "completion": [APP_ROOT / "backend/app/progress/generator.py", media_layout],
    }.get(report_key, [])
    digest = hashlib.sha256()
    for path in sources:
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16] if sources else "1"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _actor(session: dict[str, Any]) -> dict[str, Any]:
    return {"id": session["user_id"], "name": session["display_name"], "role": session["role"]}


def _task(database, task_code: str, lock: bool = False):
    row = database.execute(
        f"SELECT * FROM app.tasks WHERE task_code = %s{' FOR UPDATE' if lock else ''}",
        (task_code,),
    ).fetchone()
    if not row:
        raise ReportDataError("Task not found.", 404, "not_found")
    return row


def _can_edit(actor: dict[str, Any], task: dict[str, Any]) -> bool:
    return actor["role"] == "father" or task.get("assignee_user_id") == actor["id"]


def _require_editable(actor: dict[str, Any], task: dict[str, Any]) -> None:
    if not _can_edit(actor, task):
        raise ReportDataError("This report is not editable by the current user.", 403, "forbidden")
    if task["status"] not in {"In Progress", "On Hold"}:
        raise ReportDataError("Report data can be changed only while the task is active.", 409, "invalid_transition")


def _safe_name(value: Any, fallback: str) -> str:
    name = Path(_text(value) or fallback).name
    name = re.sub(r"[^a-zA-Z0-9._ -]+", "_", name).strip(" .")
    return name or fallback


def _storage_key(task_id: Any, file_id: uuid.UUID, filename: str) -> str:
    return f"tasks/{task_id}/{file_id}/{filename}"


def _storage_path(storage_key: str) -> Path:
    relative = Path(storage_key)
    if relative.is_absolute() or ".." in relative.parts:
        raise ReportDataError("The stored file reference is invalid.", 500, "invalid_storage_key")
    root = STORAGE_ROOT.resolve()
    candidate = (root / relative).resolve()
    if root not in candidate.parents:
        raise ReportDataError("The stored file reference is invalid.", 500, "invalid_storage_key")
    return candidate


def _write_file(task_id: Any, filename: str, content_type: str, content: bytes, actor_id: Any, database, created_keys: list[StorageReference]) -> uuid.UUID:
    file_id = uuid.uuid4()
    storage_key = _storage_key(task_id, file_id, filename)
    backend = object_storage.configured_backend()
    created_keys.append((backend, storage_key))
    if backend == "object":
        try:
            object_storage.write(storage_key, content, content_type)
        except object_storage.StorageUnavailable as error:
            raise ReportDataError(str(error), 503, "storage_unavailable") from None
    else:
        path = _storage_path(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_bytes(content)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    database.execute(
        """
        INSERT INTO app.stored_files (
            id, storage_backend, storage_key, original_filename, content_type,
            size_bytes, sha256, created_by_user_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (file_id, backend, storage_key, filename, content_type, len(content), hashlib.sha256(content).hexdigest(), actor_id),
    )
    return file_id


def _delete_physical(storage_keys: list[StorageReference] | list[str]) -> None:
    for reference in storage_keys:
        backend, key = ("local", reference) if isinstance(reference, str) else reference
        try:
            if backend == "object":
                object_storage.delete(key)
                continue
            path = _storage_path(key)
            path.unlink(missing_ok=True)
            parent = path.parent
            while parent != STORAGE_ROOT and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
                parent = parent.parent
        except (OSError, ReportDataError, RuntimeError):
            # Metadata remains authoritative even if a file cannot
            # be removed immediately; a later maintenance pass can reconcile it.
            LOGGER.warning("Could not remove a retired %s report file.", backend)


def _file_location(row, missing_message: str) -> dict[str, Any]:
    if row["storage_backend"] == "object":
        try:
            content = object_storage.read(row["storage_key"], row["size_bytes"])
        except FileNotFoundError:
            raise ReportDataError(missing_message, 404, "file_missing") from None
        except object_storage.StorageUnavailable as error:
            raise ReportDataError(str(error), 503, "storage_unavailable") from None
        return {"path": Path(row["original_filename"]), "data": content}
    path = _storage_path(row["storage_key"])
    if not path.is_file():
        raise ReportDataError(missing_message, 404, "file_missing")
    return {"path": path}


def _decode_image(data: str) -> tuple[str, bytes]:
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)", data or "")
    if not match or match.group(1) not in IMAGE_TYPES:
        raise ReportDataError("Draft photographs must be JPEG, PNG, or WebP images.")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except ValueError as error:
        raise ReportDataError("A draft photograph could not be decoded.") from error
    if not content or len(content) > 20 * 1024 * 1024:
        raise ReportDataError("Each draft photograph must be smaller than 20 MB.")
    return match.group(1), content


def _collect_file_ids(value: Any, result: set[uuid.UUID]) -> None:
    if isinstance(value, dict):
        file_id = value.get("storedFileId")
        if file_id:
            try:
                result.add(uuid.UUID(str(file_id)))
            except ValueError as error:
                raise ReportDataError("A draft file reference is invalid.") from error
        for item in value.values():
            _collect_file_ids(item, result)
    elif isinstance(value, list):
        for item in value:
            _collect_file_ids(item, result)


def _persist_inline_images(value: Any, task: dict[str, Any], actor: dict[str, Any], database, created_keys: list[StorageReference]) -> Any:
    if isinstance(value, list):
        return [_persist_inline_images(item, task, actor, database, created_keys) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _persist_inline_images(item, task, actor, database, created_keys) for key, item in value.items()}
    data = result.get("data")
    if not isinstance(data, str) or not data.startswith("data:image/"):
        return result
    content_type, content = _decode_image(data)
    extension = IMAGE_TYPES[content_type]
    filename = _safe_name(result.get("name"), f"draft-image{extension}")
    if Path(filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        filename = f"{filename}{extension}"
    file_id = _write_file(task["id"], filename, content_type, content, actor["id"], database, created_keys)
    database.execute(
        "INSERT INTO app.report_draft_files (task_id, stored_file_id) VALUES (%s, %s)",
        (task["id"], file_id),
    )
    result["data"] = f"/api/tasks/{task['task_code']}/draft-files/{file_id}"
    result["storedFileId"] = str(file_id)
    result["contentType"] = content_type
    result["size"] = len(content)
    return result


def _retained_report_inputs(database, task):
    """Read the retained artifact's inputs without relaxing any write guard."""
    artifact_id = task.get("final_artifact_id") if task["status"] == "Closed" else task.get("latest_artifact_id")
    record = database.execute(
        """SELECT r.payload, r.schema_version, r.input_fingerprint, r.created_at,
                  d.payload AS draft_payload, d.input_fingerprint AS draft_fingerprint
           FROM app.task_artifacts a
           JOIN app.report_revisions r ON r.id=a.report_revision_id AND r.task_id=a.task_id
           LEFT JOIN app.report_drafts d ON d.task_id=a.task_id
           WHERE a.id=%s AND a.task_id=%s""", (artifact_id, task["id"]),
    ).fetchone()
    payload = {}
    if record:
        revision = record["payload"] or {}
        payload = revision.get("draft")
        if payload is None and record["input_fingerprint"] and record["input_fingerprint"] == record["draft_fingerprint"]:
            payload = record["draft_payload"]
        if payload is None:
            payload = revision.get("form") or {}
    payload = deepcopy(payload or {})
    if task["report_group"] in {"progress", "completion"} and "linkedEstimationId" not in payload:
        linked = payload.get("linkedEstimation") or {}
        payload["linkedEstimationId"] = linked.get("taskId") or ""
        for component in payload.get("components") or []:
            calculated = float(component.get("estimatedCost") or 0) * float(component.get("completionPercent") or 0) / 100
            component.setdefault("manualCompleted", abs(float(component.get("completedCost") or 0) - calculated) > .005)
    if task["report_group"] in {"valuation", "revaluation"}:
        payload.setdefault("preparationMethod", "offline" if task.get("preparation_source") in {"template", "retrospective"} else "online")
        values = payload.get("values") or {}
        payload.setdefault("floorCount", max([1, *[int(match.group(1)) for key in values if (match := re.match(r"building\.floors\.(\d+)\.", key))]]))
        payload.setdefault("documentCount", max([1, *[int(match.group(1)) for key in values if (match := re.match(r"documents\.(\d+)\.", key))]]))
    # Completed draft media is deliberately removed. The retained file contains it.
    payload["photos"] = []
    payload["map"] = None
    return {"reportKey": task["report_key"], "schemaVersion": record["schema_version"] if record else "1",
            "payload": payload, "revision": 0, "preview": None, "readOnly": True,
            "updatedAt": record["created_at"].isoformat() if record else None}


def revaluation_inputs(database, original):
    """Copy only retained valuation form data into a new draft."""
    retained = _retained_report_inputs(database, original)
    previous = retained["payload"]
    source = original.get("preparation_source")
    prefix = "final" if original["status"] == "Closed" else "latest"
    artifact_type = original.get(f"{prefix}_artifact_type")
    artifact_source = original.get(f"{prefix}_artifact_source")
    if previous.get("uploadType") in {"template", "retrospective"} and artifact_source == "uploaded":
        source = previous["uploadType"]
    elif artifact_source == "generated" and artifact_type == "valuation_docx":
        source = "online"
    bank_upload = artifact_type in {"kvb_xlsx", "valocity_docx", "valocity_pdf"}
    values = previous.get("values")
    values = values if isinstance(values, dict) else {}
    copied = {
        "values": values,
        "floorCount": previous.get("floorCount", 1),
        "documentCount": previous.get("documentCount", 1),
        "preparationMethod": "offline" if bank_upload or source in {"template", "retrospective"} else "online" if source == "online" else "",
        "uploadType": source if source in {"template", "retrospective"} else "",
        "photos": [],
        "map": None,
    }
    return {"payload": copied, "schemaVersion": retained["schemaVersion"], "source": source,
            "manual": artifact_source != "generated" or not bool(values)}


def query_draft(database, task_code: str, session: dict[str, Any]):
    actor = _actor(session)
    return database.execute(
        """
        SELECT t.*, d.task_id AS draft_task_id, d.report_key AS draft_report_key,
               d.schema_version, d.payload, d.revision,
               d.updated_at AS draft_updated_at, d.input_fingerprint, d.preview_fingerprint,
               d.preview_token, a.id AS preview_file_artifact_id, sf.removed_at AS preview_removed_at
        FROM app.tasks t
        LEFT JOIN app.report_drafts d ON d.task_id = t.id
          AND t.status IN ('In Progress', 'On Hold')
          AND (%s OR t.assignee_user_id = %s)
        LEFT JOIN app.task_artifacts a
          ON a.id = d.preview_artifact_id
         AND a.task_id = d.task_id
         AND a.artifact_type = 'preview_pdf'
        LEFT JOIN app.stored_files sf ON sf.id = a.stored_file_id
        WHERE t.task_code = %s
        """,
        (actor["role"] == "father", actor["id"], task_code),
    )


def draft_payload(database, row, task_code: str, session: dict[str, Any]) -> dict[str, Any] | None:
    if not row:
        raise ReportDataError("Task not found.", 404, "not_found")
    if row["status"] in {"Completed", "Closed"}:
        return _retained_report_inputs(database, row)
    _require_editable(_actor(session), row)
    if not row["draft_task_id"]:
        return None
    preview = None
    if (
        row.get("preview_file_artifact_id")
        and row.get("preview_removed_at") is None
        and row.get("preview_fingerprint")
        and row.get("preview_fingerprint") == row.get("input_fingerprint")
        and row.get("preview_token")
    ):
        preview = {
            "id": row["preview_token"],
            "url": f'/api/tasks/{task_code}/artifacts/{row["preview_file_artifact_id"]}/download',
            "fingerprint": row["preview_fingerprint"],
        }
    return {
        "reportKey": row["draft_report_key"],
        "schemaVersion": row["schema_version"],
        "payload": row["payload"],
        "revision": row["revision"],
        "updatedAt": row["draft_updated_at"].isoformat(),
        "preview": preview,
    }


def get_draft(task_code: str, session: dict[str, Any]) -> dict[str, Any] | None:
    with connection(autocommit=True) as database:
        row = query_draft(database, task_code, session).fetchone()
        return draft_payload(database, row, task_code, session)


def preview_input_fingerprint(task_code: str, session: dict[str, Any]) -> str:
    """Capture the draft identity before the potentially slow preview render."""
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(_actor(session), task)
        row = database.execute(
            "SELECT input_fingerprint FROM app.report_drafts WHERE task_id = %s",
            (task["id"],),
        ).fetchone()
    if not row or not row["input_fingerprint"]:
        raise ReportDataError("Save the current draft before previewing the report.", 409, "draft_required")
    return row["input_fingerprint"]


def cached_general_report(task_code, session, payload, *, preview=False, pdf=False):
    """Reuse a durable matching DOCX/PDF pair; preview never completes a task.

    Download promotes the exact preview DOCX once under the task lock. The
    existing draft, template, authorization and reopening guards still apply.
    """
    actor = _actor(session)
    remove_keys = []
    with connection() as database:
        task = _task(database, task_code, lock=True)
        _require_editable(actor, task)
        if task["report_key"] != "valuation-general":
            return None
        draft = database.execute("SELECT * FROM app.report_drafts WHERE task_id=%s", (task["id"],)).fetchone()
        if not draft:
            return None
        incoming = {**payload, "preparationRevision": draft["payload"].get("preparationRevision", 0)}
        fingerprint = report_input_fingerprint(incoming, task["report_key"], draft["schema_version"], _current_template_version(task["report_key"]))
        if fingerprint != draft["input_fingerprint"]:
            raise ReportDataError("Save the current form before preparing its report.", 409, "draft_required")
        if not preview and (not payload.get("preview_id") or payload["preview_id"] != draft["preview_token"]
                            or draft["preview_fingerprint"] != fingerprint):
            raise ReportDataError("Preview the latest report before downloading.", 409, "preview_required")
        if not preview and not pdf:
            _validate_artifact(task, "valuation_docx", "generated", payload)
        rows = database.execute(
            """SELECT a.id AS artifact_id,a.artifact_type,sf.* FROM app.task_artifacts a
               JOIN app.stored_files sf ON sf.id=a.stored_file_id AND sf.removed_at IS NULL
               WHERE a.task_id=%s AND a.input_fingerprint=%s AND a.artifact_source='generated'
                 AND a.artifact_type IN ('valuation_docx','preview_pdf') AND a.stale_at IS NULL
                 AND (%s::timestamptz IS NULL OR a.created_at >= %s)
               ORDER BY a.created_at DESC LIMIT 40""",
            (task["id"], fingerprint, task.get("reopened_at"), task.get("reopened_at")),
        ).fetchall()
        pair = {}
        for row in rows:
            if row["artifact_type"] in pair:
                continue
            try:
                _file_location(row, "The cached report is no longer available.")
            except ReportDataError as error:
                if error.code == "file_missing":
                    continue
                raise
            pair[row["artifact_type"]] = row
        required = {"valuation_docx", "preview_pdf"} if preview else {"preview_pdf" if pdf else "valuation_docx"}
        if not required.issubset(pair):
            return None
        document = pair.get("valuation_docx")
        if preview:
            token = str(draft["preview_token"] or "")
            if not token or draft["preview_fingerprint"] != fingerprint:
                # An older matching pair may be adopted after editing back to
                # the same values; it still receives a fresh validation token.
                import time
                token = str(time.time_ns())
            database.execute("UPDATE app.report_drafts SET preview_token=%s,preview_fingerprint=%s,preview_artifact_id=%s WHERE task_id=%s",
                             (token, fingerprint, pair["preview_pdf"]["artifact_id"], task["id"]))
            return {"ok": True, "preview": f'/api/tasks/{task_code}/artifacts/{pair["preview_pdf"]["artifact_id"]}/download',
                    "preview_id": token, "reused": True}
        selected = pair["preview_pdf"] if pdf else document
        if not pdf and task.get("latest_artifact_id") != document["artifact_id"]:
            workflow_service.set_preparation_source(database, task, actor, "online")
            previous = database.execute(
                """SELECT a.id,sf.id AS file_id,sf.storage_backend,sf.storage_key FROM app.task_artifacts a
                   JOIN app.stored_files sf ON sf.id=a.stored_file_id WHERE a.id=%s""",
                (task.get("latest_artifact_id"),),
            ).fetchone()
            if previous:
                database.execute("UPDATE app.task_artifacts SET superseded_at=NOW() WHERE id=%s", (previous["id"],))
                if task.get("final_artifact_id") != previous["id"] and not _revaluation_pins_artifact(database, previous["id"]):
                    database.execute("UPDATE app.stored_files SET removed_at=NOW() WHERE id=%s", (previous["file_id"],))
                    remove_keys.append((previous["storage_backend"], previous["storage_key"]))
            database.execute("UPDATE app.task_artifacts SET superseded_at=NULL WHERE id=%s", (document["artifact_id"],))
            database.execute("UPDATE app.tasks SET latest_artifact_id=%s,report_generated_at=NOW(),version=version+1,updated_at=NOW() WHERE id=%s",
                             (document["artifact_id"], task["id"]))
            database.execute(
                """INSERT INTO app.task_activities (id,task_id,event_type,actor_user_id,actor_name_snapshot,message,details)
                   VALUES (%s,%s,'report',%s,%s,'DOCX report generated successfully.',%s)""",
                (uuid.uuid4(), task["id"], actor["id"], actor["name"], Jsonb({"artifactId": str(document["artifact_id"]), "artifactType": "valuation_docx"})),
            )
        result = {"ok": True, "download": f'/api/tasks/{task_code}/artifacts/{selected["artifact_id"]}/download' + ("?download=1" if pdf else ""),
                  "filename": selected["original_filename"], "registered": not pdf, "reused": True}
    _delete_physical(remove_keys)
    result["task"] = workflow_service.get_task(task_code)
    return result


def online_estimation_draft(task_code: str, session: dict[str, Any], preview_token: str | None = None):
    """Capture the saved workbook inputs and their approved preview in one read."""
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(_actor(session), task)
        if task["report_key"] != "estimation":
            raise ReportDataError("This assignment is not an estimation.")
        draft = database.execute(
            """SELECT payload, schema_version, input_fingerprint, preview_token, preview_fingerprint
               FROM app.report_drafts WHERE task_id = %s""", (task["id"],),
        ).fetchone()
    if not draft or draft["payload"].get("details", {}).get("workMode") != "online":
        raise ReportDataError("Save the online estimation before preparing its workbook.", 409, "draft_required")
    if preview_token is None and draft["input_fingerprint"]:
        # A fresh preview can validate an existing draft under a new workbook
        # version. Keep the saved fingerprint to detect edits during rendering.
        return draft["payload"], draft["input_fingerprint"]
    fingerprint = report_input_fingerprint(draft["payload"], "estimation", draft["schema_version"], _current_template_version("estimation"))
    if draft["input_fingerprint"] != fingerprint or (preview_token is not None and (
        not preview_token or preview_token != draft["preview_token"] or draft["preview_fingerprint"] != fingerprint
    )):
        raise ReportDataError("Preview the current estimation before generating Excel.", 409, "preview_required")
    return draft["payload"], fingerprint


def require_current_preview(task_code: str, session: dict[str, Any], preview_token: str) -> None:
    """Require a preview that still belongs to the task's current saved inputs."""
    actor = _actor(session)
    token = _text(preview_token)
    if not token:
        raise ReportDataError("Preview the latest report before generating the DOCX.", 409, "preview_required")
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(actor, task)
        row = database.execute(
            """
            SELECT preview_token, preview_fingerprint, input_fingerprint
            FROM app.report_drafts
            WHERE task_id = %s
            """,
            (task["id"],),
        ).fetchone()
    if not row or row.get("preview_token") != token or row.get("preview_fingerprint") != row.get("input_fingerprint"):
        raise ReportDataError("The form changed after preview. Preview the latest report before generating the DOCX.", 409, "preview_required")


def require_report_key(task_code: str, session: dict[str, Any], expected_report_key: str) -> dict[str, Any]:
    actor = _actor(session)
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(actor, task)
    if task["report_key"] != expected_report_key:
        raise ReportDataError("This report page does not match the selected task.", 409, "report_mismatch")
    return task


def valuation_download_filename(task_code: str, session: dict[str, Any], suffix: str) -> str:
    """Name new generated downloads from the assignment, keeping storage IDs separate."""
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(_actor(session), task)
    report_type = {"valuation-general": "General", "valuation-agricultural": "Agricultural"}.get(task["report_key"])
    if not report_type or suffix not in {".docx", ".pdf"}:
        raise ReportDataError("Invalid valuation download format.")
    # Applicant names often contain S/o or W/o. Treat those slashes as name
    # punctuation rather than as a filesystem path that discards the prefix.
    applicant = re.sub(r"[^a-zA-Z0-9._-]+", "_", _text(task.get("customer_name")))[:90].strip("_.") or "Applicant"
    code = _safe_name(task["task_code"], "Task").replace(" ", "_")
    assessment = "Revaluation" if task["report_group"] == "revaluation" else "Valuation"
    return f"{code}_{applicant}_{report_type}_{assessment}_Report{suffix}"


def save_draft(task_code: str, values: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    actor = _actor(session)
    payload = values.get("payload")
    if not isinstance(payload, dict):
        raise ReportDataError("The report draft payload is missing.")
    report_key = _text(values.get("reportKey"))
    schema_version = _text(values.get("schemaVersion")) or "1"
    expected_revision = values.get("revision", 0)
    try:
        expected_revision = int(expected_revision or 0)
    except (TypeError, ValueError) as error:
        raise ReportDataError("The report draft revision is invalid.") from error
    created_keys: list[StorageReference] = []
    remove_keys: list[StorageReference] = []
    try:
        with connection() as database:
            task = _task(database, task_code, lock=True)
            _require_editable(actor, task)
            if report_key != task["report_key"]:
                raise ReportDataError("The report draft does not match this task.")
            current = database.execute("SELECT * FROM app.report_drafts WHERE task_id = %s FOR UPDATE", (task["id"],)).fetchone()
            current_revision = current["revision"] if current else 0
            if expected_revision != current_revision:
                raise ReportDataError("This report draft changed in another session. Reload it before saving again.", 409, "draft_conflict")
            normalized = _persist_inline_images(deepcopy(payload), task, actor, database, created_keys)
            details = normalized.get("details") or {}
            mode = details.get("workMode") if report_key == "estimation" else normalized.get("preparationMethod")
            upload_type = details.get("uploadType") if report_key == "estimation" else normalized.get("uploadType")
            if report_key == "estimation":
                if mode == "online" and industrial_centre_line(normalized):
                    raise ReportDataError("Choose Complete offline and upload for an industrial Centre Line estimate.")
                previous = ((current or {}).get("payload") or {}).get("details") or {}
                previous_mode = previous.get("workMode")
                method_switched = bool(previous_mode and mode != previous_mode)
                upload_switched = bool(mode == previous_mode == "offline" and upload_type != previous.get("uploadType")
                                       and (previous.get("uploadType") or task.get("report_generated_at")))
                # Keep this revision authoritative: restoring an old browser payload
                # after a method switch cannot restore its completion qualification.
                preparation_revision = int(previous.get("preparationRevision") or 0) + int(method_switched or upload_switched)
                details.pop("preparationRevision", None)
                if preparation_revision:
                    details["preparationRevision"] = preparation_revision
                if "details" in normalized:
                    normalized["details"] = details
            if report_key in {"valuation-general", "valuation-agricultural", "progress", "completion"}:
                previous = (current or {}).get("payload") or {}
                linked_report = report_key in {"progress", "completion"}
                if linked_report:
                    mode = mode or "online"
                    if mode not in {"online", "offline"}:
                        raise ReportDataError("Select a valid preparation method.")
                    normalized["preparationMethod"] = mode
                if linked_report and mode == "offline" and "uploadType" not in normalized:
                    upload_type = previous.get("uploadType") or "retrospective"
                if upload_type and upload_type not in {"template", "retrospective"}:
                    raise ReportDataError("Select a valid upload type.")
                if mode in {"online", "offline"}:
                    previous_mode = previous.get("preparationMethod") or ("online" if linked_report else "")
                    method_switched = mode != previous_mode and bool(previous_mode or task.get("report_generated_at"))
                    # Legacy linked offline drafts have no explicit type.
                    previous_type = previous.get("uploadType") or (
                        "retrospective" if linked_report and previous_mode == "offline" else ""
                    )
                    next_type = upload_type or ""
                    upload_switched = (mode == previous_mode == "offline" and next_type != previous_type
                                       and bool(previous_type or task.get("report_generated_at")))
                    revision = int(previous.get("preparationRevision") or 0) + int(method_switched or upload_switched)
                    normalized.pop("preparationRevision", None)
                    if revision or linked_report:
                        normalized["preparationRevision"] = revision
            selected_source = "online" if mode == "online" else upload_type if mode == "offline" else None
            preparation_changed = workflow_service.set_preparation_source(database, task, actor, selected_source)
            input_fingerprint = report_input_fingerprint(
                normalized, report_key, schema_version, _current_template_version(report_key)
            )
            referenced: set[uuid.UUID] = set()
            _collect_file_ids(normalized, referenced)
            existing_rows = database.execute(
                """
                SELECT rdf.stored_file_id, sf.storage_backend, sf.storage_key
                FROM app.report_draft_files rdf
                JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
                WHERE rdf.task_id = %s AND sf.removed_at IS NULL
                """,
                (task["id"],),
            ).fetchall()
            existing_ids = {row["stored_file_id"] for row in existing_rows}
            if not referenced.issubset(existing_ids):
                raise ReportDataError("A draft file reference does not belong to this task.", 403, "forbidden")
            removed = existing_ids - referenced
            if removed:
                rows = [row for row in existing_rows if row["stored_file_id"] in removed]
                remove_keys.extend((row["storage_backend"], row["storage_key"]) for row in rows)
                database.execute("DELETE FROM app.report_draft_files WHERE task_id = %s AND stored_file_id = ANY(%s)", (task["id"], list(removed)))
                database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = ANY(%s)", (list(removed),))
            new_revision = current_revision + 1
            database.execute(
                """
                INSERT INTO app.report_drafts (
                    task_id, report_key, schema_version, payload, revision,
                    updated_by_user_id, input_fingerprint
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (task_id) DO UPDATE SET
                    report_key = EXCLUDED.report_key,
                    schema_version = EXCLUDED.schema_version,
                    payload = EXCLUDED.payload,
                    revision = EXCLUDED.revision,
                    input_fingerprint = EXCLUDED.input_fingerprint,
                    preview_fingerprint = CASE
                        WHEN app.report_drafts.preview_fingerprint = EXCLUDED.input_fingerprint
                        THEN app.report_drafts.preview_fingerprint ELSE NULL END,
                    preview_token = CASE
                        WHEN app.report_drafts.preview_fingerprint = EXCLUDED.input_fingerprint
                        THEN app.report_drafts.preview_token ELSE NULL END,
                    preview_artifact_id = CASE
                        WHEN app.report_drafts.preview_fingerprint = EXCLUDED.input_fingerprint
                        THEN app.report_drafts.preview_artifact_id ELSE NULL END,
                    updated_by_user_id = EXCLUDED.updated_by_user_id,
                    updated_at = NOW()
                """,
                (task["id"], report_key, schema_version, Jsonb(normalized), new_revision, actor["id"], input_fingerprint),
            )
            tracked_artifact_type = None
            if task["report_key"] == "estimation":
                tracked_artifact_type = "estimation_xlsx"
            elif task["report_key"] == "progress":
                tracked_artifact_type = "progress_docx"
            elif task["report_key"] == "completion":
                tracked_artifact_type = "completion_docx"
            elif task["report_key"] in {"valuation-general", "valuation-agricultural"} and task["institution_code_snapshot"] not in {"KVB", "KB"}:
                tracked_artifact_type = "valuation_docx"
            if tracked_artifact_type:
                latest = database.execute(
                    """
                    SELECT a.id, r.input_fingerprint
                    FROM app.tasks t
                    JOIN app.task_artifacts a ON a.id = t.latest_artifact_id
                    LEFT JOIN app.report_revisions r ON r.id = a.report_revision_id
                    WHERE t.id = %s AND (a.artifact_type = %s OR a.artifact_type IN ('estimation_docx','estimation_pdf','valuation_pdf','progress_pdf','completion_pdf'))
                    """,
                    (task["id"], tracked_artifact_type),
                ).fetchone()
                if latest:
                    database.execute(
                        "UPDATE app.task_artifacts SET stale_at = CASE WHEN %s = %s THEN NULL ELSE COALESCE(stale_at, NOW()) END WHERE id = %s",
                        (latest.get("input_fingerprint"), input_fingerprint, latest["id"]),
                    )
        _delete_physical(remove_keys)
        return {
            "reportKey": report_key,
            "schemaVersion": schema_version,
            "payload": normalized,
            "revision": new_revision,
            "inputFingerprint": input_fingerprint,
            "preparationChanged": preparation_changed,
        }
    except Exception:
        _delete_physical(created_keys)
        raise


def delete_draft(task_code: str, session: dict[str, Any]) -> None:
    actor = _actor(session)
    remove_keys: list[StorageReference] = []
    with connection() as database:
        task = _task(database, task_code, lock=True)
        _require_editable(actor, task)
        rows = database.execute(
            """
            SELECT sf.id, sf.storage_backend, sf.storage_key
            FROM app.report_draft_files rdf
            JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
            WHERE rdf.task_id = %s AND sf.removed_at IS NULL
            """,
            (task["id"],),
        ).fetchall()
        remove_keys = [(row["storage_backend"], row["storage_key"]) for row in rows]
        database.execute("DELETE FROM app.report_draft_files WHERE task_id = %s", (task["id"],))
        if rows:
            database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = ANY(%s)", ([row["id"] for row in rows],))
        if task["report_key"] in {"valuation-general", "valuation-agricultural", "estimation", "progress", "completion"} and task.get("latest_artifact_id"):
            database.execute(
                "UPDATE app.task_artifacts SET stale_at = COALESCE(stale_at, NOW()) WHERE id = %s",
                (task["latest_artifact_id"],),
            )
        database.execute("DELETE FROM app.report_drafts WHERE task_id = %s", (task["id"],))
    _delete_physical(remove_keys)


def draft_file(task_code: str, file_id: str, session: dict[str, Any]) -> dict[str, Any]:
    actor = _actor(session)
    try:
        parsed_id = uuid.UUID(file_id)
    except ValueError as error:
        raise ReportDataError("Draft file not found.", 404, "not_found") from error
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(actor, task)
        row = database.execute(
            """
            SELECT sf.* FROM app.report_draft_files rdf
            JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
            WHERE rdf.task_id = %s AND sf.id = %s AND sf.removed_at IS NULL
            """,
            (task["id"], parsed_id),
        ).fetchone()
    if not row:
        raise ReportDataError("Draft file not found.", 404, "not_found")
    location = _file_location(row, "The stored draft file is unavailable.")
    return {**location, "contentType": row["content_type"], "filename": row["original_filename"]}


def hydrate_media(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    """Replace task-owned draft-file references with data URLs for generators."""
    actor = _actor(session)
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(actor, task)

        def hydrate(value: Any) -> Any:
            if isinstance(value, list):
                return [hydrate(item) for item in value]
            if not isinstance(value, dict):
                return value
            result = {key: hydrate(item) for key, item in value.items()}
            file_id = result.get("storedFileId")
            if not file_id:
                return result
            row = database.execute(
                """
                SELECT sf.* FROM app.report_draft_files rdf
                JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
                WHERE rdf.task_id = %s AND sf.id = %s AND sf.removed_at IS NULL
                """,
                (task["id"], file_id),
            ).fetchone()
            if not row:
                raise ReportDataError("A report photograph is no longer available.", 404, "file_missing")
            location = _file_location(row, "A report photograph is no longer available.")
            content = location["data"] if "data" in location else location["path"].read_bytes()
            result["data"] = f"data:{row['content_type']};base64,{base64.b64encode(content).decode('ascii')}"
            return result

        return hydrate(deepcopy(payload))


def validate_linked_assessment(task_code: str, payload: dict[str, Any], session: dict[str, Any]) -> None:
    """Reject an out-of-date online assessment before rendering."""
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(_actor(session), task)
        if task["report_group"] not in {"progress", "completion"} or task["report_group"] != payload.get("requestedReportType"):
            raise ReportDataError("This report page does not match the selected task.", 409, "report_mismatch")
        workflow_service.require_estimation_ready(database, task, payload, verify_components=True)


def _compact_payload(value: Any) -> Any:
    if isinstance(value, list):
        return [_compact_payload(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _compact_payload(item) for key, item in value.items() if key != "data"}
    if "storedFileId" not in result and isinstance(value.get("data"), str) and value["data"].startswith("data:image/"):
        result["inlineImageSha256"] = hashlib.sha256(value["data"].encode("utf-8")).hexdigest()
    return result


def report_input_fingerprint(
    payload: dict[str, Any] | None,
    report_key: str,
    schema_version: str = "1",
    template_version: str = "1",
) -> str:
    """Return a stable identity for inputs that affect the retained report."""
    source = payload if isinstance(payload, dict) else {}
    identity = {
        "reportKey": report_key,
        "schemaVersion": str(schema_version or "1"),
        "templateVersion": str(template_version or "1"),
    }
    if report_key == "estimation":
        details = deepcopy(source.get("details") if isinstance(source.get("details"), dict) else {})
        # These values describe generated/downloaded output and browser position;
        # they are not inputs used to construct the workbook itself.
        details.pop("finalReport", None)
        details.pop("offlineWorkbook", None)
        report_input = {
            **identity,
            "propertyType": source.get("propertyType"),
            "construction": source.get("construction"),
            "subtype": source.get("subtype"),
            "details": _compact_payload(details),
            "components": _compact_payload(source.get("components") if isinstance(source.get("components"), list) else []),
        }
    elif report_key in {"progress", "completion"}:
        report_input = {
            **identity,
            "linkedEstimationId": source.get("linkedEstimationId"),
            "details": _compact_payload(source.get("details") if isinstance(source.get("details"), dict) else {}),
            "components": _compact_payload(source.get("components") if isinstance(source.get("components"), list) else []),
            "bank": _compact_payload(source.get("bank") if isinstance(source.get("bank"), dict) else {}),
            "photos": _compact_payload(source.get("photos") if isinstance(source.get("photos"), list) else []),
        }
        if source.get("map"):
            report_input["map"] = _compact_payload(source["map"])
        if source.get("preparationMethod") == "offline" and source.get("uploadType") == "template":
            report_input["uploadType"] = "template"
        if source.get("preparationMethod") == "offline" or source.get("preparationRevision"):
            report_input["preparationMethod"] = source.get("preparationMethod")
            report_input["preparationRevision"] = source.get("preparationRevision") or 0
    else:
        report_input = {
            **identity,
            "values": _compact_payload(source.get("values") if isinstance(source.get("values"), dict) else {}),
            "photos": _compact_payload(source.get("photos") if isinstance(source.get("photos"), list) else []),
            "map": _compact_payload(source.get("map")),
        }
        # An offline attachment cannot remain qualified under a newly selected
        # upload type. Keep online/legacy fingerprints unchanged.
        if source.get("preparationMethod") == "offline" and _text(source.get("uploadType")):
            report_input["uploadType"] = _text(source["uploadType"])
        if source.get("preparationRevision"):
            report_input["preparationRevision"] = source["preparationRevision"]
    encoded = json.dumps(report_input, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _decimal(value: Any) -> Decimal:
    try:
        result = Decimal(str(value or 0))
    except (InvalidOperation, ValueError) as error:
        raise ReportDataError("An estimation component cost is invalid.") from error
    if not result.is_finite() or result < 0:
        raise ReportDataError("An estimation component cost is invalid.")
    return result.quantize(Decimal("0.01"))


def _create_snapshot(database, task: dict[str, Any], revision_id: uuid.UUID | None, summary: dict[str, Any], actor_id: Any) -> uuid.UUID:
    components = summary.get("components")
    if not isinstance(components, list) or not components:
        raise ReportDataError("The estimation report does not contain component costs.")
    if summary.get("identityVersion") == 2 and any(not _text(summary.get(key)) for key in ("applicantName", "workDescription", "workAddress")):
        raise ReportDataError("Complete Name of the Applicant, Name of the Work and Address of the Work before submitting.")
    snapshot_id = uuid.uuid4()
    number = database.execute(
        "SELECT COALESCE(MAX(snapshot_number), 0) + 1 AS number FROM app.estimation_snapshots WHERE estimation_task_id = %s",
        (task["id"],),
    ).fetchone()["number"]
    applicant = _text(summary.get("applicantName")) or task["customer_name"]
    location = _text(summary.get("workAddress")) if summary.get("identityVersion") == 2 else _text(summary.get("projectLocation")) or task["property_brief"]
    property_type = _text(summary.get("propertyType")) or "property"
    total = _decimal(summary.get("totalEstimatedCost"))
    database.execute(
        """
        INSERT INTO app.estimation_snapshots (
            id, estimation_task_id, source_revision_id, snapshot_number,
            applicant_name, applicant_address, project_location, work_description,
            property_type, construction_type, property_subtype,
            total_estimated_cost, created_by_user_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            snapshot_id, task["id"], revision_id, number, applicant,
            _text(summary.get("applicantAddress")), location, _text(summary.get("workDescription")),
            property_type, _text(summary.get("construction")), _text(summary.get("subtype")), total, actor_id,
        ),
    )
    for index, component in enumerate(components):
        label = _text(component.get("label"))
        if not label:
            raise ReportDataError("Every estimation component must have a name.")
        source = _text(component.get("source"))
        source = source if source in {"component", "common", "workbook"} else "component"
        item_key = f"{index + 1:04d}-{_text(component.get('id')) or 'item'}"
        database.execute(
            """
            INSERT INTO app.estimation_snapshot_items (
                id, snapshot_id, item_key, label, source_type,
                estimated_cost, display_order, details
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (uuid.uuid4(), snapshot_id, item_key, label, source, _decimal(component.get("estimatedCost")), index, Jsonb({"sourceId": _text(component.get("id")), "legacyLabel": _text(component.get("legacyLabel"))})),
        )
    return snapshot_id


def _validate_artifact(
    task: dict[str, Any],
    artifact_type: str,
    source: str = "generated",
    payload: dict[str, Any] | None = None,
) -> None:
    if artifact_type == "preview_pdf":
        return
    retrospective = bool(
        source == "uploaded"
        and isinstance(payload, dict)
        and payload.get("retrospective") is True
    )
    if (
        retrospective
        and task["report_key"] in {"valuation-general", "valuation-agricultural"}
        and artifact_type in {"valuation_docx", "valuation_pdf"}
        and not (
            task["report_key"] == "valuation-general"
            and task["institution_code_snapshot"] in {"KVB", "KB"}
        )
    ):
        return
    if task["report_group"] in {"progress", "completion"}:
        expected = task["report_group"]
        if (retrospective and artifact_type in {f"{expected}_docx", f"{expected}_pdf"}) or (
            source == "generated" and artifact_type == f"{expected}_docx"
        ):
            return
        raise ReportDataError("This report file type does not match the task.")
    allowed = {
        "estimation": {"estimation_xlsx", "estimation_docx", "estimation_pdf"},
    }.get(task["report_group"], {"valuation_docx", "kvb_xlsx", "valocity_docx", "valocity_pdf"})
    if artifact_type not in allowed:
        raise ReportDataError("This report file type does not match the task.")
    if task["report_key"] == "valuation-general":
        if task["institution_code_snapshot"] == "KVB" and artifact_type != "kvb_xlsx":
            raise ReportDataError("Karur Vysya Bank valuations require the completed KVB Excel report.")
        if task["institution_code_snapshot"] == "KB" and artifact_type not in {"valocity_docx", "valocity_pdf"}:
            raise ReportDataError("Karnataka Bank valuations require a Valocity DOCX or PDF report.")
        if task["institution_code_snapshot"] not in {"KVB", "KB"} and artifact_type != "valuation_docx":
            raise ReportDataError("This valuation requires the generated DOCX report.")
    elif task["report_key"] == "valuation-agricultural" and artifact_type != "valuation_docx":
        raise ReportDataError("Agricultural valuations require the generated DOCX report.")


def register_artifact(
    task_code: str,
    session: dict[str, Any],
    *,
    content: bytes,
    filename: str,
    artifact_type: str,
    source: str,
    payload: dict[str, Any] | None = None,
    summary: dict[str, Any] | None = None,
    schema_version: str = "1",
    template_version: str = "1",
    current: bool = True,
    preview_token: str = "",
    preview_input: str | None = None,
    estimation_preview: tuple[str, str] | None = None,
    work_note: str = "",
) -> dict[str, Any]:
    actor = _actor(session)
    if artifact_type not in ARTIFACT_TYPES:
        raise ReportDataError("The report artifact type is invalid.")
    if source not in {"generated", "uploaded"}:
        raise ReportDataError("The report artifact source is invalid.")
    retrospective = bool(
        source == "uploaded"
        and isinstance(payload, dict)
        and payload.get("retrospective") is True
    )
    suffixes, default_content_type = ARTIFACT_TYPES[artifact_type]
    safe_name = _safe_name(filename, f"report{next(iter(suffixes))}")
    if Path(safe_name).suffix.lower() not in suffixes:
        raise ReportDataError("The report filename does not match its required format.")
    if not content:
        raise ReportDataError("The report file is empty.")
    created_keys: list[StorageReference] = []
    remove_keys: list[StorageReference] = []
    try:
        with connection() as database:
            task = _task(database, task_code, lock=True)
            _require_editable(actor, task)
            _validate_artifact(task, artifact_type, source, payload)
            selected_source = (payload or {}).get("preparationSource") or ("retrospective" if retrospective else "online" if source == "generated" and artifact_type != "preview_pdf" else None)
            if selected_source is not None and selected_source not in {"online", "template", "retrospective"}:
                raise ReportDataError("Select a valid preparation method.", 400, "invalid_preparation_source")
            if selected_source == "template" and not task.get("template_downloaded_at"):
                raise ReportDataError("Download the template for this task before uploading a filled template.", 409, "template_download_required")
            workflow_service.set_preparation_source(database, task, actor, selected_source)
            template_version = _current_template_version(task["report_key"])
            draft_meta = None
            if task["report_key"] in {"valuation-general", "valuation-agricultural", "estimation", "progress", "completion"}:
                draft_meta = database.execute(
                    "SELECT schema_version, payload, input_fingerprint, preview_token, preview_fingerprint FROM app.report_drafts WHERE task_id = %s",
                    (task["id"],),
                ).fetchone()
                if draft_meta:
                    schema_version = draft_meta["schema_version"]
            if preview_input is not None:
                previous_preview = str((draft_meta or {}).get("preview_token") or "")
                if (
                    not draft_meta or draft_meta.get("input_fingerprint") != preview_input
                    or (previous_preview.isdecimal() and preview_token.isdecimal() and int(previous_preview) > int(preview_token))
                ):
                    raise ReportDataError("The preview was superseded. Open the latest preview.", 409, "preview_superseded")
            if estimation_preview is not None:
                token, fingerprint = estimation_preview
                if not draft_meta or draft_meta["preview_token"] != token or (
                    draft_meta["input_fingerprint"] != fingerprint or draft_meta["preview_fingerprint"] != fingerprint
                ):
                    raise ReportDataError("The estimation changed while Excel was being prepared. Preview it again.", 409, "preview_required")
            if task["report_key"] == "estimation" and industrial_centre_line((draft_meta or {}).get("payload") or {}):
                if source == "generated":
                    raise ReportDataError("Prepare the industrial Centre Line estimate offline and upload the completed report.")
                if selected_source == "template":
                    raise ReportDataError("Choose Retrospective report for an industrial Centre Line estimate.")
            if task["report_group"] in {"progress", "completion"} and retrospective:
                from ..progress.generator import retrospective_summary

                if not _text(work_note):
                    raise ReportDataError("Add a work note for the retrospective report.")
                draft = (draft_meta or {}).get("payload") or {}
                linked = database.execute(
                    "SELECT task_code FROM app.tasks WHERE id=%s", (task["linked_estimation_task_id"],)
                ).fetchone()
                if not linked or draft.get("linkedEstimationId") != linked["task_code"]:
                    raise ReportDataError("Reload the report to use its linked estimation.")
                if draft.get("preparationMethod") != "offline":
                    raise ReportDataError("Select Complete offline and upload before attaching the file.")
                if selected_source != (draft.get("uploadType") or "retrospective"):
                    raise ReportDataError("Save the selected upload type before attaching the file.")
                payload = {**draft, "retrospective": True, "preparationSource": selected_source, "photos": []}
                try:
                    summary = retrospective_summary(payload, task["report_group"], linked["task_code"])
                except ValueError as error:
                    raise ReportDataError(str(error)) from error
            elif task["report_group"] in {"progress", "completion"} and ((draft_meta or {}).get("payload") or {}).get("preparationMethod") == "offline":
                raise ReportDataError("Select Fill online before generating this report.")
            try:
                workflow_service.require_estimation_ready(database, task, payload, verify_components=True)
            except workflow_service.WorkflowError as error:
                raise ReportDataError(str(error), error.status, error.code) from error
            if retrospective and (
                not draft_meta
                or (((draft_meta.get("payload") or {}).get("details") or {}).get("workMode") if task["report_key"] == "estimation" else (draft_meta.get("payload") or {}).get("preparationMethod")) != "offline"
            ):
                raise ReportDataError("Select Complete offline and upload before attaching the report.", 409, "preparation_method_required")
            fingerprint_payload = draft_meta["payload"] if draft_meta and (
                task["report_key"] in {"estimation", "progress", "completion"} or retrospective
            ) else payload
            if draft_meta and (draft_revision := draft_meta["payload"].get("preparationRevision")):
                fingerprint_payload = {**(fingerprint_payload or {}), "preparationRevision": draft_revision}
            input_fingerprint = report_input_fingerprint(fingerprint_payload, task["report_key"], schema_version, template_version)
            revision_id = None
            revision_payload = None
            if artifact_type != "preview_pdf":
                if payload is None:
                    draft = database.execute("SELECT payload FROM app.report_drafts WHERE task_id = %s", (task["id"],)).fetchone()
                    payload = draft["payload"] if draft else {}
                revision_payload = {"form": _compact_payload(payload or {})}
                if draft_meta:
                    revision_payload["draft"] = _compact_payload(draft_meta["payload"])
                if summary:
                    revision_payload["summary"] = _compact_payload(summary)
                revision_id = uuid.uuid4()
                revision_number = database.execute(
                    "SELECT COALESCE(MAX(revision_number), 0) + 1 AS number FROM app.report_revisions WHERE task_id = %s",
                    (task["id"],),
                ).fetchone()["number"]
                database.execute(
                    """
                    INSERT INTO app.report_revisions (
                        id, task_id, revision_number, report_key, schema_version,
                        template_version, payload, created_by_user_id, input_fingerprint
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (revision_id, task["id"], revision_number, task["report_key"], schema_version, template_version, Jsonb(revision_payload), actor["id"], input_fingerprint),
                )
            snapshot_id = None
            if current and artifact_type in {"estimation_xlsx", "estimation_docx", "estimation_pdf"}:
                if not summary:
                    raise ReportDataError("The estimation component summary is missing.")
                snapshot_id = _create_snapshot(database, task, revision_id, summary, actor["id"])
            file_id = _write_file(task["id"], safe_name, default_content_type, content, actor["id"], database, created_keys)
            artifact_id = uuid.uuid4()
            database.execute(
                """
                INSERT INTO app.task_artifacts (
                    id, task_id, stored_file_id, report_revision_id, artifact_type,
                    artifact_source, created_by_user_id, input_fingerprint
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (artifact_id, task["id"], file_id, revision_id, artifact_type, source, actor["id"], input_fingerprint),
            )
            if artifact_type == "preview_pdf" and preview_token:
                previous_input = preview_input if task["report_key"] == "estimation" and preview_input is not None else input_fingerprint
                database.execute(
                    """
                    UPDATE app.report_drafts
                    SET input_fingerprint = %s,
                        preview_fingerprint = %s,
                        preview_token = %s,
                        preview_artifact_id = %s,
                        updated_at = NOW()
                    WHERE task_id = %s AND input_fingerprint = %s
                    """,
                    (input_fingerprint, input_fingerprint, preview_token, artifact_id, task["id"], previous_input),
                )
            if current:
                previous = database.execute(
                    """
                    SELECT a.id, sf.id AS file_id, sf.storage_backend, sf.storage_key
                    FROM app.tasks t
                    JOIN app.task_artifacts a ON a.id = t.latest_artifact_id
                    JOIN app.stored_files sf ON sf.id = a.stored_file_id
                    WHERE t.id = %s
                    """,
                    (task["id"],),
                ).fetchone()
                if previous:
                    database.execute("UPDATE app.task_artifacts SET superseded_at = NOW() WHERE id = %s", (previous["id"],))
                    if task.get("final_artifact_id") != previous["id"] and not _revaluation_pins_artifact(database, previous["id"]):
                        database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = %s", (previous["file_id"],))
                        remove_keys.append((previous["storage_backend"], previous["storage_key"]))
                database.execute(
                    "UPDATE app.tasks SET latest_artifact_id = %s, report_generated_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = %s",
                    (artifact_id, task["id"]),
                )
                if work_note:
                    database.execute(
                        """
                        INSERT INTO app.task_activities (
                            id, task_id, event_type, actor_user_id, actor_name_snapshot,
                            message, details
                        ) VALUES (%s, %s, 'note', %s, %s, %s, %s)
                        """,
                        (uuid.uuid4(), task["id"], actor["id"], actor["name"], work_note,
                         Jsonb({"retrospectiveUpload": True, "artifactId": str(artifact_id)})),
                    )
                message = "Completed report attached successfully." if source == "uploaded" else f"{Path(safe_name).suffix[1:].upper()} report generated successfully."
                database.execute(
                    """
                    INSERT INTO app.task_activities (
                        id, task_id, event_type, actor_user_id, actor_name_snapshot,
                        message, details
                    ) VALUES (%s, %s, 'report', %s, %s, %s, %s)
                    """,
                    (uuid.uuid4(), task["id"], actor["id"], actor["name"], message, Jsonb({"artifactId": str(artifact_id), "artifactType": artifact_type})),
                )
            result = {
                "artifactId": str(artifact_id),
                "download": f"/api/tasks/{task_code}/artifacts/{artifact_id}/download",
                "filename": safe_name,
                "snapshotId": str(snapshot_id) if snapshot_id else None,
            }
    except Exception:
        _delete_physical(created_keys)
        raise
    _delete_physical(remove_keys)
    result["task"] = workflow_service.get_task(task_code)
    return result


def artifact_file(task_code: str, artifact_id: str, session: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed_id = uuid.UUID(artifact_id)
    except ValueError as error:
        raise ReportDataError("Report file not found.", 404, "not_found") from error
    with connection() as database:
        task = _task(database, task_code)
        row = database.execute(
            """
            SELECT sf.*, a.artifact_type FROM app.task_artifacts a
            JOIN app.stored_files sf ON sf.id = a.stored_file_id
            WHERE a.id = %s AND a.task_id = %s AND sf.removed_at IS NULL
            """,
            (parsed_id, task["id"]),
        ).fetchone()
    if not row:
        raise ReportDataError("Report file not found.", 404, "not_found")
    location = _file_location(row, "The stored report file is unavailable.")
    return {**location, "contentType": row["content_type"], "filename": row["original_filename"], "artifactType": row["artifact_type"]}


def _revaluation_pins_artifact(database, artifact_id):
    return database.execute("SELECT 1 FROM app.tasks WHERE linked_valuation_artifact_id=%s LIMIT 1",
                            (artifact_id,)).fetchone() is not None


def remove_latest_artifact(task_code: str, session: dict[str, Any]) -> dict[str, Any]:
    actor = _actor(session)
    remove_keys: list[StorageReference] = []
    with connection() as database:
        task = _task(database, task_code, lock=True)
        _require_editable(actor, task)
        if not task.get("latest_artifact_id"):
            raise ReportDataError("There is no completed report attachment to remove.", 404, "not_found")
        if task.get("latest_artifact_id") == task.get("final_artifact_id"):
            raise ReportDataError("The retained final report cannot be removed. Reopen and generate or attach its replacement.", 409, "final_artifact")
        row = database.execute(
            """
            SELECT a.id, sf.id AS file_id, sf.storage_backend, sf.storage_key
            FROM app.task_artifacts a
            JOIN app.stored_files sf ON sf.id = a.stored_file_id
            WHERE a.id = %s AND a.task_id = %s
            """,
            (task["latest_artifact_id"], task["id"]),
        ).fetchone()
        if not row:
            raise ReportDataError("The completed report attachment could not be found.", 404, "not_found")
        database.execute("UPDATE app.task_artifacts SET superseded_at = COALESCE(superseded_at, NOW()) WHERE id = %s", (row["id"],))
        if not _revaluation_pins_artifact(database, row["id"]):
            database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = %s", (row["file_id"],))
            remove_keys.append((row["storage_backend"], row["storage_key"]))
        database.execute("UPDATE app.tasks SET latest_artifact_id = NULL, report_generated_at = NULL, version = version + 1, updated_at = NOW() WHERE id = %s", (task["id"],))
        database.execute(
            """
            INSERT INTO app.task_activities (
                id, task_id, event_type, actor_user_id, actor_name_snapshot,
                message, details
            ) VALUES (%s, %s, 'report', %s, %s, %s, '{}'::JSONB)
            """,
            (uuid.uuid4(), task["id"], actor["id"], actor["name"], "Completed report attachment removed."),
        )
    _delete_physical(remove_keys)
    return workflow_service.get_task(task_code)
