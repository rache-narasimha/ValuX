"""Authenticated HTTP adapter for durable report drafts and files."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

from ..auth import routes as auth_routes
from ..auth.service import AuthError
from . import service


def _error(handler, error: Exception) -> None:
    if isinstance(error, (service.ReportDataError, AuthError)):
        handler.send_json({"ok": False, "error": str(error), "code": error.code}, error.status)
        return
    handler.log_error("Report data request failed: %s", type(error).__name__)
    handler.send_json({"ok": False, "error": "The report data service encountered an unexpected error."}, 500)


def handle_get(handler, path: str) -> bool:
    reference_match = re.fullmatch(r"/api/valuation/estimations/([^/]+)", path)
    if path == "/api/valuation/estimations" or reference_match:
        try:
            from .valuation_reference import estimation_reference, estimation_references
            session = auth_routes.require_full_session(handler)
            query = parse_qs(urlparse(handler.path).query)
            if reference_match:
                result = estimation_reference(unquote(reference_match.group(1)), (query.get("snapshotId") or [""])[-1], session)
            else:
                result = estimation_references(session, search=(query.get("search") or [""])[-1], offset=(query.get("offset") or [0])[-1])
            handler.send_json({"ok": True, **result})
        except (ValueError, service.ReportDataError, AuthError) as error:
            if isinstance(error, ValueError):
                error = service.ReportDataError("Invalid estimation search.")
            _error(handler, error)
        return True
    draft_match = re.fullmatch(r"/api/tasks/([^/]+)/draft", path)
    file_match = re.fullmatch(r"/api/tasks/([^/]+)/draft-files/([^/]+)", path)
    artifact_match = re.fullmatch(r"/api/tasks/([^/]+)/artifacts/([^/]+)/download", path)
    if not (draft_match or file_match or artifact_match):
        return False
    try:
        session = auth_routes.require_full_session(handler)
        if draft_match:
            draft = service.get_draft(unquote(draft_match.group(1)), session)
            handler.send_json({"ok": True, "draft": draft})
            return True
        if file_match:
            record = service.draft_file(unquote(file_match.group(1)), file_match.group(2), session)
            handler.send_file(record["path"], cache="private, no-store", data=record.get("data"))
            return True
        record = service.artifact_file(unquote(artifact_match.group(1)), artifact_match.group(2), session)
        force_download = (parse_qs(urlparse(handler.path).query).get("download") or [""])[-1] == "1"
        disposition = "inline" if record["artifactType"] == "preview_pdf" and not force_download else "attachment"
        handler.send_file(
            record["path"],
            cache="private, no-store",
            data=record.get("data"),
            headers=[
                ("Content-Disposition", f'{disposition}; filename="{record["filename"]}"'),
            ],
        )
        return True
    except Exception as error:
        _error(handler, error)
        return True


def handle_post(handler, path: str) -> bool:
    match = re.fullmatch(r"/api/tasks/([^/]+)/draft", path)
    if not match:
        return False
    try:
        session = auth_routes.require_full_session(handler)
        auth_routes.verify_csrf(handler)
        payload = auth_routes.read_payload(handler, 64 * 1024 * 1024)
        draft = service.save_draft(unquote(match.group(1)), payload, session)
        handler.send_json({"ok": True, "draft": draft})
        return True
    except Exception as error:
        _error(handler, error)
        return True


def handle_delete(handler, path: str) -> bool:
    draft_match = re.fullmatch(r"/api/tasks/([^/]+)/draft", path)
    artifact_match = re.fullmatch(r"/api/tasks/([^/]+)/artifacts/latest", path)
    if not (draft_match or artifact_match):
        return False
    try:
        session = auth_routes.require_full_session(handler)
        auth_routes.verify_csrf(handler)
        if draft_match:
            service.delete_draft(unquote(draft_match.group(1)), session)
            handler.send_json({"ok": True})
        else:
            task = service.remove_latest_artifact(unquote(artifact_match.group(1)), session)
            handler.send_json({"ok": True, "task": task})
        return True
    except Exception as error:
        _error(handler, error)
        return True
