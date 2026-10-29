"""Durable report data and authenticated local-file storage."""

from __future__ import annotations

import base64
import hashlib
import re
import uuid
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from ..auth.database import connection
from ..valuation.config import OUTPUT_DIR
from ..workflow import service as workflow_service


STORAGE_ROOT = OUTPUT_DIR / "task_files"
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
ARTIFACT_TYPES = {
    "valuation_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "kvb_xlsx": ({".xlsx"}, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "valocity_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "valocity_pdf": ({".pdf"}, "application/pdf"),
    "estimation_xlsx": ({".xlsx"}, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "progress_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "completion_docx": ({".docx"}, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "preview_pdf": ({".pdf"}, "application/pdf"),
}


class ReportDataError(Exception):
    """Controlled report-data failure suitable for a JSON response."""

    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status = status
        self.code = code


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


def _write_file(task_id: Any, filename: str, content_type: str, content: bytes, actor_id: Any, database) -> tuple[uuid.UUID, str]:
    file_id = uuid.uuid4()
    storage_key = _storage_key(task_id, file_id, filename)
    path = _storage_path(storage_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)
    database.execute(
        """
        INSERT INTO app.stored_files (
            id, storage_backend, storage_key, original_filename, content_type,
            size_bytes, sha256, created_by_user_id
        ) VALUES (%s, 'local', %s, %s, %s, %s, %s, %s)
        """,
        (file_id, storage_key, filename, content_type, len(content), hashlib.sha256(content).hexdigest(), actor_id),
    )
    return file_id, storage_key


def _delete_physical(storage_keys: list[str]) -> None:
    for key in storage_keys:
        try:
            path = _storage_path(key)
            path.unlink(missing_ok=True)
            parent = path.parent
            while parent != STORAGE_ROOT and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
                parent = parent.parent
        except (OSError, ReportDataError):
            # Metadata remains authoritative even if a development file cannot
            # be removed immediately; a later maintenance pass can reconcile it.
            continue


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


def _persist_inline_images(value: Any, task: dict[str, Any], actor: dict[str, Any], database, created_keys: list[str]) -> Any:
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
    file_id, storage_key = _write_file(task["id"], filename, content_type, content, actor["id"], database)
    created_keys.append(storage_key)
    database.execute(
        "INSERT INTO app.report_draft_files (task_id, stored_file_id) VALUES (%s, %s)",
        (task["id"], file_id),
    )
    result["data"] = f"/api/tasks/{task['task_code']}/draft-files/{file_id}"
    result["storedFileId"] = str(file_id)
    result["contentType"] = content_type
    result["size"] = len(content)
    return result


def get_draft(task_code: str, session: dict[str, Any]) -> dict[str, Any] | None:
    actor = _actor(session)
    with connection() as database:
        task = _task(database, task_code)
        _require_editable(actor, task)
        row = database.execute("SELECT * FROM app.report_drafts WHERE task_id = %s", (task["id"],)).fetchone()
    if not row:
        return None
    return {
        "reportKey": row["report_key"],
        "schemaVersion": row["schema_version"],
        "payload": row["payload"],
        "revision": row["revision"],
        "updatedAt": row["updated_at"].isoformat(),
    }


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
    created_keys: list[str] = []
    remove_keys: list[str] = []
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
            referenced: set[uuid.UUID] = set()
            _collect_file_ids(normalized, referenced)
            existing_rows = database.execute(
                """
                SELECT rdf.stored_file_id, sf.storage_key
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
                remove_keys.extend(row["storage_key"] for row in rows)
                database.execute("DELETE FROM app.report_draft_files WHERE task_id = %s AND stored_file_id = ANY(%s)", (task["id"], list(removed)))
                database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = ANY(%s)", (list(removed),))
            new_revision = current_revision + 1
            database.execute(
                """
                INSERT INTO app.report_drafts (
                    task_id, report_key, schema_version, payload, revision,
                    updated_by_user_id
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (task_id) DO UPDATE SET
                    report_key = EXCLUDED.report_key,
                    schema_version = EXCLUDED.schema_version,
                    payload = EXCLUDED.payload,
                    revision = EXCLUDED.revision,
                    updated_by_user_id = EXCLUDED.updated_by_user_id,
                    updated_at = NOW()
                """,
                (task["id"], report_key, schema_version, Jsonb(normalized), new_revision, actor["id"]),
            )
        _delete_physical(remove_keys)
        return {"reportKey": report_key, "schemaVersion": schema_version, "payload": normalized, "revision": new_revision}
    except Exception:
        _delete_physical(created_keys)
        raise


def delete_draft(task_code: str, session: dict[str, Any]) -> None:
    actor = _actor(session)
    remove_keys: list[str] = []
    with connection() as database:
        task = _task(database, task_code, lock=True)
        _require_editable(actor, task)
        rows = database.execute(
            """
            SELECT sf.id, sf.storage_key
            FROM app.report_draft_files rdf
            JOIN app.stored_files sf ON sf.id = rdf.stored_file_id
            WHERE rdf.task_id = %s AND sf.removed_at IS NULL
            """,
            (task["id"],),
        ).fetchall()
        remove_keys = [row["storage_key"] for row in rows]
        database.execute("DELETE FROM app.report_draft_files WHERE task_id = %s", (task["id"],))
        if rows:
            database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = ANY(%s)", ([row["id"] for row in rows],))
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
    path = _storage_path(row["storage_key"])
    if not path.is_file():
        raise ReportDataError("The stored draft file is unavailable.", 404, "file_missing")
    return {"path": path, "contentType": row["content_type"], "filename": row["original_filename"]}


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
            content = _storage_path(row["storage_key"]).read_bytes()
            result["data"] = f"data:{row['content_type']};base64,{base64.b64encode(content).decode('ascii')}"
            return result

        return hydrate(deepcopy(payload))


def _compact_payload(value: Any) -> Any:
    if isinstance(value, list):
        return [_compact_payload(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _compact_payload(item) for key, item in value.items() if key != "data"}
    if "storedFileId" not in result and isinstance(value.get("data"), str) and value["data"].startswith("data:image/"):
        result["inlineImageSha256"] = hashlib.sha256(value["data"].encode("utf-8")).hexdigest()
    return result


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
    snapshot_id = uuid.uuid4()
    number = database.execute(
        "SELECT COALESCE(MAX(snapshot_number), 0) + 1 AS number FROM app.estimation_snapshots WHERE estimation_task_id = %s",
        (task["id"],),
    ).fetchone()["number"]
    applicant = _text(summary.get("applicantName")) or task["customer_name"]
    location = _text(summary.get("projectLocation")) or task["property_brief"]
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
            (uuid.uuid4(), snapshot_id, item_key, label, source, _decimal(component.get("estimatedCost")), index, Jsonb({"sourceId": _text(component.get("id"))})),
        )
    return snapshot_id


def _validate_artifact(task: dict[str, Any], artifact_type: str) -> None:
    if artifact_type == "preview_pdf":
        return
    allowed = {
        "estimation": {"estimation_xlsx"},
        "progress": {"progress_docx"},
        "completion": {"completion_docx"},
    }.get(task["report_group"], {"valuation_docx", "kvb_xlsx", "valocity_docx", "valocity_pdf"})
    if artifact_type not in allowed:
        raise ReportDataError("This report file type does not match the task.")
    if task["report_group"] == "valuation":
        if task["institution_code_snapshot"] == "KVB" and artifact_type != "kvb_xlsx":
            raise ReportDataError("Karur Vysya Bank valuations require the completed KVB Excel report.")
        if task["institution_code_snapshot"] == "KB" and artifact_type not in {"valocity_docx", "valocity_pdf"}:
            raise ReportDataError("Karnataka Bank valuations require a Valocity DOCX or PDF report.")
        if task["institution_code_snapshot"] not in {"KVB", "KB"} and artifact_type != "valuation_docx":
            raise ReportDataError("This valuation requires the generated DOCX report.")


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
) -> dict[str, Any]:
    actor = _actor(session)
    if artifact_type not in ARTIFACT_TYPES:
        raise ReportDataError("The report artifact type is invalid.")
    if source not in {"generated", "uploaded"}:
        raise ReportDataError("The report artifact source is invalid.")
    suffixes, default_content_type = ARTIFACT_TYPES[artifact_type]
    safe_name = _safe_name(filename, f"report{next(iter(suffixes))}")
    if Path(safe_name).suffix.lower() not in suffixes:
        raise ReportDataError("The report filename does not match its required format.")
    if not content:
        raise ReportDataError("The report file is empty.")
    created_keys: list[str] = []
    remove_keys: list[str] = []
    try:
        with connection() as database:
            task = _task(database, task_code, lock=True)
            _require_editable(actor, task)
            _validate_artifact(task, artifact_type)
            revision_id = None
            revision_payload = None
            if artifact_type != "preview_pdf":
                if payload is None:
                    draft = database.execute("SELECT payload FROM app.report_drafts WHERE task_id = %s", (task["id"],)).fetchone()
                    payload = draft["payload"] if draft else {}
                revision_payload = {"form": _compact_payload(payload or {})}
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
                        template_version, payload, created_by_user_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (revision_id, task["id"], revision_number, task["report_key"], schema_version, template_version, Jsonb(revision_payload), actor["id"]),
                )
            snapshot_id = None
            if current and artifact_type == "estimation_xlsx":
                if not summary:
                    raise ReportDataError("The estimation component summary is missing.")
                snapshot_id = _create_snapshot(database, task, revision_id, summary, actor["id"])
            file_id, storage_key = _write_file(task["id"], safe_name, default_content_type, content, actor["id"], database)
            created_keys.append(storage_key)
            artifact_id = uuid.uuid4()
            database.execute(
                """
                INSERT INTO app.task_artifacts (
                    id, task_id, stored_file_id, report_revision_id, artifact_type,
                    artifact_source, created_by_user_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (artifact_id, task["id"], file_id, revision_id, artifact_type, source, actor["id"]),
            )
            if current:
                previous = database.execute(
                    """
                    SELECT a.id, sf.id AS file_id, sf.storage_key
                    FROM app.tasks t
                    JOIN app.task_artifacts a ON a.id = t.latest_artifact_id
                    JOIN app.stored_files sf ON sf.id = a.stored_file_id
                    WHERE t.id = %s
                    """,
                    (task["id"],),
                ).fetchone()
                if previous:
                    database.execute("UPDATE app.task_artifacts SET superseded_at = NOW() WHERE id = %s", (previous["id"],))
                    if task.get("final_artifact_id") != previous["id"]:
                        database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = %s", (previous["file_id"],))
                        remove_keys.append(previous["storage_key"])
                database.execute(
                    "UPDATE app.tasks SET latest_artifact_id = %s, report_generated_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = %s",
                    (artifact_id, task["id"]),
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
    path = _storage_path(row["storage_key"])
    if not path.is_file():
        raise ReportDataError("The stored report file is unavailable.", 404, "file_missing")
    return {"path": path, "contentType": row["content_type"], "filename": row["original_filename"], "artifactType": row["artifact_type"]}


def remove_latest_artifact(task_code: str, session: dict[str, Any]) -> dict[str, Any]:
    actor = _actor(session)
    remove_keys: list[str] = []
    with connection() as database:
        task = _task(database, task_code, lock=True)
        _require_editable(actor, task)
        if not task.get("latest_artifact_id"):
            raise ReportDataError("There is no completed report attachment to remove.", 404, "not_found")
        if task.get("latest_artifact_id") == task.get("final_artifact_id"):
            raise ReportDataError("The retained final report cannot be removed. Reopen and generate or attach its replacement.", 409, "final_artifact")
        row = database.execute(
            """
            SELECT a.id, sf.id AS file_id, sf.storage_key
            FROM app.task_artifacts a
            JOIN app.stored_files sf ON sf.id = a.stored_file_id
            WHERE a.id = %s AND a.task_id = %s
            """,
            (task["latest_artifact_id"], task["id"]),
        ).fetchone()
        if not row:
            raise ReportDataError("The completed report attachment could not be found.", 404, "not_found")
        database.execute("UPDATE app.task_artifacts SET superseded_at = COALESCE(superseded_at, NOW()) WHERE id = %s", (row["id"],))
        database.execute("UPDATE app.stored_files SET removed_at = NOW() WHERE id = %s", (row["file_id"],))
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
        remove_keys.append(row["storage_key"])
    _delete_physical(remove_keys)
    return workflow_service.get_task(task_code)
