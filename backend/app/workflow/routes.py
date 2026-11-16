"""HTTP adapter for durable workflow and institution APIs."""

from __future__ import annotations

import json
import re
from urllib.parse import parse_qs, unquote, urlparse

from ..auth import routes as auth_routes
from ..auth.database import connection
from ..auth.service import AuthError
from ..business_time import TENANT_TIME_ZONE_NAME
from ..reference import service as reference_service
from ..reports import service as report_service
from . import notifications, service


TASK_ACTIONS = {
    "notes": service.add_note,
    "assign": service.assign,
    "hold": service.put_on_hold,
    "resume": service.resume,
    "report-generated": service.mark_report_generated,
    "report-removed": service.mark_report_removed,
    "complete": service.complete,
    "payment": service.update_payment,
    "close": service.close,
    "cancel": service.cancel,
    "reopen": service.reopen,
}

GET_ROUTES = {
    "/api/notifications", "/api/tasks", "/api/tasks/summary", "/api/employees",
    "/api/institutions", "/api/valuations/eligible", "/api/estimations/eligible",
}


def page_context_script(session: dict, raw_path: str, *, load_valuation_draft: bool = False) -> bytes:
    """Send the initial page data together after the browser session is verified."""
    parsed = urlparse(raw_path)
    values = parse_qs(parsed.query)
    task_code = (values.get("task") or values.get("id") or [""])[-1]
    browser_values = parse_qs(parsed.query, keep_blank_values=True)
    draft_code = browser_values.get("task", [""])[0]
    practice = browser_values.get("practice", [""])[0] == "1"
    include_draft = load_valuation_draft and bool(draft_code) and draft_code == task_code and not practice
    task_queries = dashboard = draft = None
    with connection(autocommit=True) as database:
        with database.pipeline():
            summary = service.query_summary(database)
            institutions = reference_service.query_institutions(database, session["role"] == "father")
            employees = service.query_employees(database)
            if task_code:
                task_queries = service.query_task_detail(database, task_code)
            if parsed.path == "/":
                dashboard = service.query_task_page(database, service.DASHBOARD_PAGE_SIZE, 0)
            if include_draft:
                draft = report_service.query_draft(database, draft_code, session)
        context = {
            "summary": service.summary_payload(summary.fetchall()),
            "institutions": reference_service.institution_payloads(institutions.fetchall()),
            "employees": service.employee_payloads(employees.fetchall()),
            "task": None,
            "linkedTask": None,
            "timeZone": TENANT_TIME_ZONE_NAME,
        }
        if task_queries is not None:
            try:
                context["task"] = service.task_detail_payload(task_queries)
            except service.WorkflowError as error:
                if error.status != 404:
                    raise
        if dashboard is not None:
            context["dashboardPage"] = service.task_page_payload(
                dashboard.fetchall(), context["summary"]["total"], service.DASHBOARD_PAGE_SIZE
            )
        if draft is not None:
            try:
                context["reportDraft"] = {
                    "taskCode": draft_code,
                    "draft": report_service.draft_payload(database, draft.fetchone(), draft_code, session),
                }
            except report_service.ReportDataError:
                # Keep the existing draft API and its error handling for this form.
                pass

    task = context["task"]
    if task and task.get("linkedEstimationId"):
        try:
            linked_task = service.get_task(task["linkedEstimationId"])
        except service.WorkflowError as error:
            if error.status != 404:
                raise
        else:
            if task.get("estimationSummary"):
                linked_task["estimationSummary"] = task["estimationSummary"]
                linked_task["linkedEstimationSnapshotId"] = task.get("linkedEstimationSnapshotId", "")
            context["linkedTask"] = linked_task
    safe_json = json.dumps(context, separators=(",", ":")).replace("<", "\\u003c")
    return f"<script>window.__VALUX_BUSINESS_CONTEXT__={safe_json};</script>".encode("utf-8")


def _query(handler) -> dict[str, str]:
    parsed = parse_qs(urlparse(handler.path).query)
    return {key: values[-1] for key, values in parsed.items() if values}


def _error(handler, error: Exception) -> None:
    if isinstance(error, (service.WorkflowError, AuthError)):
        response = {"ok": False, "error": str(error), "code": error.code}
        if isinstance(error, service.WorkflowError):
            response.update(error.details)
        handler.send_json(response, error.status)
        return
    handler.log_error("Workflow request failed: %s", type(error).__name__)
    handler.send_json({"ok": False, "error": "The workflow service encountered an unexpected error."}, 500)


def handle_get(handler, path: str) -> bool:
    task_match = re.fullmatch(r"/api/tasks/([^/]+)", path)
    progress_match = re.fullmatch(r"/api/estimations/([^/]+)/progress-reports", path)
    if path not in GET_ROUTES and not (task_match or progress_match):
        return False
    try:
        session = auth_routes.require_full_session(handler, refresh=path != "/api/notifications")
        options = _query(handler)
        if path == "/api/notifications":
            handler.send_json({"ok": True, **notifications.list_for(session, options)})
            return True
        if path == "/api/tasks":
            handler.send_json({"ok": True, **service.list_tasks(options, session)})
            return True
        if path == "/api/tasks/summary":
            handler.send_json({"ok": True, "summary": service.summary(options.get("group", "all"))})
            return True
        if task_match:
            handler.send_json({"ok": True, "task": service.get_task(unquote(task_match.group(1)))})
            return True
        if path == "/api/employees":
            handler.send_json({"ok": True, "employees": service.employees()})
            return True
        if path == "/api/institutions":
            include_inactive = options.get("includeInactive") == "true" and session["role"] == "father"
            handler.send_json({"ok": True, "institutions": reference_service.list_institutions(include_inactive)})
            return True
        if path == "/api/valuations/eligible":
            handler.send_json({"ok": True, **service.eligible_valuations(options)})
            return True
        if path == "/api/estimations/eligible":
            result = service.eligible_estimations(
                options.get("reportKey", ""), options.get("assignedDate", ""),
                options.get("search", ""), options.get("offset", "0"), options.get("limit", "20"),
                options.get("institution", ""), options.get("status", ""),
            )
            handler.send_json({"ok": True, **result})
            return True
        if progress_match:
            items = service.progress_reports_for(unquote(progress_match.group(1)))
            handler.send_json({"ok": True, "items": items})
            return True
        return False
    except Exception as error:
        _error(handler, error)
        return True


def handle_post(handler, path: str) -> bool:
    if path not in {"/api/tasks", "/api/notifications/read"} and not path.startswith(("/api/tasks/", "/api/institutions")):
        return False
    try:
        session = auth_routes.require_full_session(handler)
        auth_routes.verify_csrf(handler)
        payload = auth_routes.read_payload(handler, 256 * 1024)
        if path == "/api/notifications/read":
            notifications.mark_read(session, payload)
            handler.send_json({"ok": True})
            return True
        if path == "/api/tasks":
            handler.send_json({"ok": True, "task": service.create_task(payload, session)}, 201)
            return True
        task_match = re.fullmatch(r"/api/tasks/([^/]+)/([^/]+)", path)
        if task_match:
            action = TASK_ACTIONS.get(task_match.group(2))
            if not action:
                return False
            task = action(unquote(task_match.group(1)), payload, session)
            handler.send_json({"ok": True, "task": task})
            return True
        if path == "/api/institutions":
            handler.send_json({"ok": True, "institution": reference_service.upsert(payload, session)})
            return True
        activation_match = re.fullmatch(r"/api/institutions/([^/]+)/activation", path)
        if activation_match:
            institution = reference_service.set_active(unquote(activation_match.group(1)), bool(payload.get("active")), session)
            handler.send_json({"ok": True, "institution": institution})
            return True
        if path == "/api/institutions/reset":
            handler.send_json({"ok": True, "institutions": reference_service.reset(session)})
            return True
        return False
    except Exception as error:
        _error(handler, error)
        return True
