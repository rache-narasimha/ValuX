"""HTTP routing, static-file delivery, previews, and report downloads."""

import json
import base64
import mimetypes
import re
import shutil
import subprocess
import time
from datetime import date
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile
from io import BytesIO
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from ..auth import routes as auth_routes
from ..auth.service import AuthError
from ..estimation import extract_estimation_summary, generate_estimation_workbook
from ..estimation.generator import online_estimation_summary
from ..estimation.summary import WorkbookTotalsMismatch, verify_generated_estimation
from ..exports import generate_table_export
from ..progress import generate_progress_report
from ..progress.generator import generate_progress_template
from ..reports import routes as report_routes
from ..reports import service as report_service
from ..valuation.config import AGRICULTURAL_TEMPLATE, ASSETS_DIR, OUTPUT_DIR, PAGES_DIR, SOFFICE, TEMPLATE
from ..valuation.kvb_template import generate_kvb_template
from ..valuation.reports import generate_agricultural_docx, generate_docx, generate_offline_template
from ..valuation.schemas import agricultural_schema_payload, schema_payload, validate_report_values
from ..workflow import routes as workflow_routes
from ..workflow import service as workflow_service


XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def report_content_type(file_path):
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".xlsx":
        return XLSX_CONTENT_TYPE
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def safe_xlsx_name(value):
    name = Path(unquote(str(value or "completed-estimation.xlsx"))).name
    name = re.sub(r"[^a-z0-9._ -]+", "_", name, flags=re.IGNORECASE)
    return name if name.lower().endswith(".xlsx") else "completed-estimation.xlsx"


def safe_upload_name(value, allowed_suffixes, fallback):
    name = Path(unquote(str(value or fallback))).name
    name = re.sub(r"[^a-z0-9._ -]+", "_", name, flags=re.IGNORECASE).strip(" .")
    return name if Path(name).suffix.lower() in allowed_suffixes else fallback


def estimation_summary(state, extracted=None):
    """Combine validated workbook costs with the task-linked form identity."""
    state = state if isinstance(state, dict) else {}
    details = state.get("details") if isinstance(state.get("details"), dict) else {}
    extracted = extracted if isinstance(extracted, dict) else {}
    components = extracted.get("components") or []
    return {
        "version": 1,
        "propertyType": str(state.get("propertyType") or "property"),
        "propertyTypeLabel": str(state.get("propertyType") or "property"),
        "construction": str(state.get("construction") or ""),
        "subtype": str(state.get("subtype") or ""),
        "estimateDate": str(details.get("estimateDate") or ""),
        "identityVersion": 2 if details.get("identityVersion") == 2 or "workAddress" in details else 1,
        "applicantName": str(details.get("applicantName") or ""),
        "applicantAddress": str(details.get("applicantAddress") or ""),
        "workAddress": str(details.get("workAddress") or ""),
        "projectLocation": str(details.get("workAddress") if "workAddress" in details else details.get("projectLocation") or ""),
        "workDescription": str(details.get("workDescription") or ""),
        "components": components,
        "totalEstimatedCost": extracted.get("totalEstimatedCost", sum(float(item.get("estimatedCost") or 0) for item in components)),
    }


def task_code_from(handler, payload=None):
    return str((payload or {}).get("taskCode") or handler.headers.get("X-Task-Code") or "").strip()


def validate_online_estimation(state):
    details = state.get("details")
    if not isinstance(details, dict) or details.get("workMode") != "online":
        raise ValueError("Select Fill online before preparing a completed estimate.")
    fields = {"estimateDate": "Date of Estimation", "place": "Place", "applicantName": "Name of the Applicant",
              "workAddress": "Address of the Work", "workDescription": "Name of the Work"}
    for key, label in fields.items():
        if not isinstance(details.get(key), str) or not details[key].strip():
            raise ValueError(f"Enter {label} before preparing the estimate.")
    try:
        date.fromisoformat(details["estimateDate"])
    except ValueError:
        raise ValueError("Enter a valid Date of Estimation.") from None
    if state.get("propertyType") not in {"residential", "commercial", "industrial"} or not all(
        isinstance(state.get(key), str) and state[key].strip() for key in ("construction", "subtype")
    ):
        raise ValueError("Complete the property configuration before preparing the estimate.")
    if not isinstance(state.get("components"), list) or not state["components"]:
        raise ValueError("Add at least one property component.")
    for component in state["components"]:
        if not isinstance(component, dict) or not isinstance(component.get("sheets", []), list):
            raise ValueError("Review the estimation component configuration.")
        if any(not isinstance(sheet, dict) for sheet in component.get("sheets", [])):
            raise ValueError("Review the estimation floor configuration.")


class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200, headers=None):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        for name, value in headers or []:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, file_path, cache="no-store", data=None, headers=None):
        content = file_path.read_bytes() if data is None else data
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", cache)
        for name, value in headers or []:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_redirect(self, location, status=303):
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_internal_error(self, error, message):
        """Log operational details server-side without exposing them to the browser."""
        self.log_error("%s: %s", message, type(error).__name__)
        self.send_json({"ok": False, "error": message}, 500)

    def do_HEAD(self):
        """Support lightweight availability checks for retained report files."""
        path = urlparse(self.path).path
        if not path.startswith("/downloads/"):
            self.send_error(404)
            return
        try:
            auth_routes.require_full_session(self)
        except AuthError:
            self.send_error(401)
            return
        file_path = OUTPUT_DIR / Path(path).name
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", report_content_type(file_path))
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if auth_routes.handle_get(self, path):
                return
            if path.startswith("/assets/"):
                file_path = ASSETS_DIR / path.removeprefix("/assets/")
                if not file_path.exists() or not file_path.is_file():
                    self.send_error(404)
                    return
                self.send_file(file_path, cache="no-store")
                return

            if report_routes.handle_get(self, path):
                return
            if workflow_routes.handle_get(self, path):
                return

            session = auth_routes.require_full_session(
                self, role="father" if path.startswith("/settings/") else None
            )
            if path == "/api/schema":
                self.send_json(schema_payload())
                return
            if path == "/api/agricultural/schema":
                self.send_json(agricultural_schema_payload())
                return
            if path.startswith("/downloads/"):
                file_path = OUTPUT_DIR / Path(path).name
                if not file_path.exists():
                    self.send_error(404)
                    return
                data = file_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", report_content_type(file_path))
                self.send_header("Content-Disposition", f'attachment; filename="{file_path.name}"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith("/previews/"):
                file_path = OUTPUT_DIR / Path(path).name
                if not file_path.exists() or file_path.suffix.lower() != ".pdf":
                    self.send_error(404)
                    return
                self.send_file(
                    file_path,
                    headers=[("Content-Disposition", f'inline; filename="{file_path.name}"')],
                )
                return
            if path in {"/templates/general-master.docx", "/templates/agricultural-master.docx"}:
                kind = "agricultural" if "agricultural" in path else "general"
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                template_path = OUTPUT_DIR / f"{kind}-offline-template-{time.time_ns()}.docx"
                template_task = (parse_qs(urlparse(self.path).query).get("task") or [""])[-1]
                report_key = f"valuation-{kind}"
                template_context = report_service.require_report_key(template_task, session, report_key) if template_task else {}
                revaluation = template_context.get("report_group") == "revaluation"
                generate_offline_template(report_key, template_path, revaluation=revaluation)
                if template_task:
                    workflow_service.record_template_download(template_task, session)
                self.send_file(
                    template_path,
                    headers=[("Content-Disposition", f'attachment; filename="{kind.title()}_{"Revaluation" if revaluation else "Valuation"}_Offline_Template.docx"')],
                )
                return
            if path == "/templates/kvb-valuation.xlsx":
                try:
                    generated = generate_kvb_template()
                except FileNotFoundError:
                    self.send_error(404)
                    return
                except Exception as exc:
                    self.send_internal_error(exc, "The KVB valuation template could not be prepared. Please try again.")
                    return
                self.send_file(
                    Path(generated.file_name),
                    data=generated.content,
                    headers=[("Content-Disposition", f'attachment; filename="{generated.file_name}"')],
                )
                return
            pages = {
                "/account": PAGES_DIR / "account.html",
                "/account/": PAGES_DIR / "account.html",
                "/": PAGES_DIR / "index.html",
                "/tasks": PAGES_DIR / "tasks.html",
                "/tasks/": PAGES_DIR / "tasks.html",
                "/tasks/new": PAGES_DIR / "new-task.html",
                "/tasks/new/": PAGES_DIR / "new-task.html",
                "/tasks/detail": PAGES_DIR / "task.html",
                "/tasks/detail/": PAGES_DIR / "task.html",
                "/practice": PAGES_DIR / "practice.html",
                "/practice/": PAGES_DIR / "practice.html",
                "/settings/institutions": PAGES_DIR / "institutions.html",
                "/settings/institutions/": PAGES_DIR / "institutions.html",
                "/valuation/general": PAGES_DIR / "general.html",
                "/valuation/general/": PAGES_DIR / "general.html",
                "/valuation/agricultural": PAGES_DIR / "agricultural.html",
                "/valuation/agricultural/": PAGES_DIR / "agricultural.html",
                "/estimation": PAGES_DIR / "estimation.html",
                "/estimation/": PAGES_DIR / "estimation.html",
                "/progress-completion": PAGES_DIR / "progress-completion.html",
                "/progress-completion/": PAGES_DIR / "progress-completion.html",
            }
            file_path = pages.get(path)
            if file_path is None:
                self.send_error(404)
                return
            page_context = workflow_routes.page_context_script(session, self.path)
            data = file_path.read_bytes().replace(
                b"</head>", auth_routes.authentication_context_script(session) + page_context + b"</head>", 1
            )
            self.send_file(file_path, data=data)
        except (workflow_service.WorkflowError, report_service.ReportDataError) as error:
            self.send_json({"ok": False, "error": str(error), "code": error.code}, error.status)
        except AuthError as error:
            if path.startswith("/api/") or path.startswith(("/downloads/", "/previews/", "/templates/")):
                self.send_json({"ok": False, "error": str(error), "code": error.code}, error.status)
            elif error.status == 403:
                self.send_redirect("/?notice=access-denied")
            else:
                destination = self.path if self.path.startswith("/") else "/"
                self.send_redirect(f"/auth?next={quote(destination, safe='')}")

    def do_POST(self):
        request_path = urlparse(self.path).path
        if auth_routes.handle_post(self, request_path):
            return
        if report_routes.handle_post(self, request_path):
            return
        if workflow_routes.handle_post(self, request_path):
            return
        if request_path in {"/api/estimation/upload", "/api/estimation/upload/analyze"}:
            self.handle_estimation_upload()
            return
        if request_path == "/api/valuation/kvb/upload":
            self.handle_institution_valuation_upload("kvb")
            return
        if request_path == "/api/valuation/karnataka/upload":
            self.handle_institution_valuation_upload("karnataka")
            return
        if request_path in {"/api/valuation/retrospective/upload", "/api/progress/retrospective/upload"}:
            self.handle_retrospective_report_upload(progress=request_path.startswith("/api/progress/"))
            return
        if request_path in {"/api/estimation/workbook", "/api/estimation/preview", "/api/estimation/totals"}:
            self.handle_estimation_generation(request_path)
            return
        if request_path in {"/api/progress/generate", "/api/progress/preview", "/api/progress/template"}:
            self.handle_progress_generation(request_path)
            return
        if request_path == "/api/exports/workbook":
            self.handle_table_export()
            return
        general_paths = {"/api/generate", "/api/preview"}
        agricultural_paths = {"/api/agricultural/generate", "/api/agricultural/preview"}
        if request_path not in general_paths | agricultural_paths:
            self.send_error(404)
            return
        try:
            session = auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 60 * 1024 * 1024:
                raise ValueError("Upload is too large. Please reduce the photo file sizes.")
            payload = json.loads(self.rfile.read(size))
            task_code = task_code_from(self, payload)
            if task_code:
                auth_routes.verify_csrf(self)
                payload = report_service.hydrate_media(task_code, payload, session)
            values = payload.get("values", {})
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            is_agricultural = request_path in agricultural_paths
            is_preview = request_path.endswith("/preview")
            expected_report_key = "valuation-agricultural" if is_agricultural else "valuation-general"
            validate_report_values(expected_report_key, values)
            revaluation = False
            if task_code:
                report_task = report_service.require_report_key(task_code, session, expected_report_key)
                revaluation = report_task["report_group"] == "revaluation"
                if not is_preview:
                    report_service.require_current_preview(task_code, session, payload.get("preview_id", ""))
            prefix = "agricultural-valuation" if is_agricultural else "valuation"
            preview_id = str(time.time_ns()) if is_preview else str(payload.get("preview_id", ""))
            if preview_id and not re.fullmatch(r"\d+", preview_id):
                raise ValueError("Invalid preview identifier")
            generation_id = str(time.time_ns())
            preview_input = report_service.preview_input_fingerprint(task_code, session) if task_code and is_preview else None
            base_name = f"{prefix}-preview-{preview_id}" if is_preview else f"{prefix}-report-{generation_id}"
            docx_name = f"{base_name}.docx"
            docx_path = OUTPUT_DIR / docx_name
            generator = generate_agricultural_docx if is_agricultural else generate_docx
            requested_format = "pdf" if is_preview else payload.get("format", "docx")
            preview_docx = OUTPUT_DIR / f"{prefix}-preview-{preview_id}.docx" if preview_id else None
            preview_pdf = OUTPUT_DIR / f"{prefix}-preview-{preview_id}.pdf" if preview_id else None
            reuse_preview = not is_preview and preview_docx is not None and preview_docx.exists()
            if reuse_preview:
                shutil.copyfile(preview_docx, docx_path)
            else:
                generator(values, docx_path, payload.get("photos", []), payload.get("map"), revaluation=revaluation)
            if requested_format == "pdf":
                pdf_name = f"{base_name}.pdf"
                pdf_path = OUTPUT_DIR / pdf_name
                if pdf_path.exists():
                    pdf_path.unlink()
                if reuse_preview and preview_pdf is not None and preview_pdf.exists():
                    shutil.copyfile(preview_pdf, pdf_path)
                else:
                    subprocess.run([str(SOFFICE), "--headless", "--convert-to", "pdf", "--outdir", str(OUTPUT_DIR), str(docx_path)],
                                   check=True, capture_output=True, text=True, timeout=60)
                if not pdf_path.exists():
                    raise RuntimeError("PDF conversion did not produce an output file")
                artifact = None
                if task_code:
                    artifact = report_service.register_artifact(
                        task_code, session, content=pdf_path.read_bytes(), filename=pdf_name if is_preview else report_service.valuation_download_filename(task_code, session, ".pdf"),
                        artifact_type="preview_pdf", source="generated", payload=payload, current=False,
                        preview_token=preview_id if is_preview else "", preview_input=preview_input,
                    )
                if is_preview:
                    self.send_json({"ok": True, "preview": artifact["download"] if artifact else f"/previews/{pdf_name}?v={time.time_ns()}", "preview_id": preview_id})
                else:
                    download = f'{artifact["download"]}?download=1' if artifact else f"/downloads/{pdf_name}"
                    self.send_json({"ok": True, "download": download, "filename": artifact["filename"] if artifact else pdf_name, "registered": False})
            else:
                artifact = None
                if task_code:
                    artifact = report_service.register_artifact(
                        task_code, session, content=docx_path.read_bytes(), filename=report_service.valuation_download_filename(task_code, session, ".docx"),
                        artifact_type="valuation_docx", source="generated", payload=payload,
                    )
                self.send_json({
                    "ok": True,
                    "download": artifact["download"] if artifact else f"/downloads/{docx_name}",
                    "filename": artifact["filename"] if artifact else docx_name,
                    "registered": bool(artifact),
                    "task": artifact.get("task") if artifact else None,
                })
        except (AuthError, report_service.ReportDataError, workflow_service.WorkflowError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The valuation report could not be prepared. Please try again.")

    def do_DELETE(self):
        request_path = urlparse(self.path).path
        if report_routes.handle_delete(self, request_path):
            return
        if request_path == "/api/valuation/kvb/upload":
            self.handle_institution_valuation_removal("kvb")
            return
        if request_path == "/api/valuation/karnataka/upload":
            self.handle_institution_valuation_removal("karnataka")
            return
        self.send_error(404)

    def handle_estimation_generation(self, request_path):
        try:
            session = auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 20 * 1024 * 1024:
                raise ValueError("The estimation form payload is too large.")
            payload = json.loads(self.rfile.read(size))
            task_code = task_code_from(self, payload)
            if task_code:
                auth_routes.verify_csrf(self)
            state = payload.get("state")
            if not isinstance(state, dict):
                raise ValueError("The estimation form state is missing.")
            is_preview = request_path.endswith("/preview")
            mode = "offline" if payload.get("mode") == "offline" else "completed"
            preview_id = str(payload.get("preview_id") or "")
            preview_input = None
            totals_only = request_path.endswith("/totals")
            if task_code and mode == "completed":
                state, preview_input = report_service.online_estimation_draft(
                    task_code, session, None if is_preview else preview_id,
                )
            if mode == "completed":
                validate_online_estimation(state)
            if totals_only:
                if mode != "completed":
                    raise ValueError("Select Fill online to calculate estimation totals.")
                self.send_json({"ok": True, "summary": online_estimation_summary(state)})
                return
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            generation_id = str(time.time_ns())
            generated = generate_estimation_workbook(state, mode=mode)
            if is_preview:
                pdf_name = f"estimation-preview-{generation_id}.pdf"
                with TemporaryDirectory(prefix="valux-estimation-preview-") as temporary:
                    root = Path(temporary)
                    xlsx_path = generated.save(root / Path(pdf_name).with_suffix(".xlsx"))
                    subprocess.run(
                        [str(SOFFICE), f"-env:UserInstallation={(root / 'profile').as_uri()}",
                         "--headless", "--convert-to", "pdf", "--outdir", str(root), str(xlsx_path)],
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=90,
                    )
                    pdf = (root / pdf_name).read_bytes()
                artifact = None
                if task_code and mode == "completed":
                    artifact = report_service.register_artifact(
                        task_code, session, content=pdf, filename=pdf_name,
                        artifact_type="preview_pdf", source="generated", payload=state, current=False,
                        preview_token=generation_id, preview_input=preview_input,
                    )
                else:
                    (OUTPUT_DIR / pdf_name).write_bytes(pdf)
                self.send_json({"ok": True, "preview": artifact["download"] if artifact else f"/previews/{pdf_name}?v={generation_id}",
                                "preview_id": generation_id, "summary": generated.summary})
                return

            if mode == "offline" and task_code:
                workflow_service.record_template_download(task_code, session)
            report_url = ""
            registered = False
            if mode == "completed":
                try:
                    verify_generated_estimation(generated, SOFFICE)
                except WorkbookTotalsMismatch as error:
                    raise report_service.ReportDataError(str(error), 409, "estimation_workbook_mismatch") from error
                if task_code:
                    artifact = report_service.register_artifact(
                        task_code, session, content=generated.content, filename=generated.file_name,
                        artifact_type="estimation_xlsx", source="generated", payload=state,
                        summary=generated.summary,
                        estimation_preview=(preview_id, preview_input),
                    )
                    report_url = artifact["download"]
                    registered = True
                else:
                    stored_path = OUTPUT_DIR / f"estimation-report-{generation_id}.xlsx"
                    stored_path.write_bytes(generated.content)
                    report_url = f"/downloads/{stored_path.name}"
            self.send_file(
                Path(generated.file_name),
                data=generated.content,
                headers=[
                    ("Content-Disposition", f'attachment; filename="{generated.file_name}"'),
                    ("X-Estimation-Sheets", quote("|".join(generated.sheet_names), safe="")),
                    ("X-Report-Url", report_url),
                    ("X-Task-Registered", "true" if registered else "false"),
                ],
            )
        except (AuthError, report_service.ReportDataError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The estimation workbook could not be prepared. Please try again.")

    def handle_estimation_upload(self):
        try:
            session = auth_routes.require_full_session(self)
            task_code = task_code_from(self)
            if task_code:
                auth_routes.verify_csrf(self)
                report_service.require_report_key(task_code, session, "estimation")
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 36 * 1024 * 1024:
                raise ValueError("Select a completed report up to 25 MB.")
            raw = self.rfile.read(size)
            metadata = {}
            if "application/json" in self.headers.get("Content-Type", ""):
                metadata = json.loads(raw)
                content = base64.b64decode(metadata.get("content", ""), validate=True)
                requested_name = metadata.get("fileName")
            else:
                content = raw
                requested_name = self.headers.get("X-File-Name")
            if Path(str(requested_name or "")).suffix.lower() not in {".xlsx", ".docx", ".pdf"}:
                raise ValueError("Attach an XLSX, DOCX or PDF report.")
            file_name = safe_upload_name(requested_name, {".xlsx", ".docx", ".pdf"}, "completed-estimation.xlsx")
            suffix = Path(file_name).suffix.lower()
            if len(content) > 25 * 1024 * 1024:
                raise ValueError("The report is larger than 25 MB.")
            if suffix == ".pdf":
                if not content.startswith(b"%PDF-"):
                    raise ValueError("Select a readable PDF report.")
            else:
                with ZipFile(BytesIO(content)) as archive:
                    expected = "xl/workbook.xml" if suffix == ".xlsx" else "word/document.xml"
                    if expected not in archive.namelist():
                        raise ValueError("The selected report package is invalid.")
            extracted = None
            if suffix == ".xlsx":
                try:
                    extracted = extract_estimation_summary(content)
                except Exception:
                    extracted = None
            if urlparse(self.path).path.endswith("/analyze"):
                self.send_json({"ok": True, "components": (extracted or {}).get("components", []), "totalEstimatedCost": (extracted or {}).get("totalEstimatedCost")})
                return
            upload_type = metadata.get("uploadType") or self.headers.get("X-Upload-Type")
            if upload_type not in {"template", "retrospective"}:
                raise ValueError("Select Filled template or Retrospective report.")
            note = str(metadata.get("workNote") or unquote(self.headers.get("X-Work-Note", ""))).strip()
            if task_code and not note:
                raise ValueError("Add the upload work note.")
            draft = report_service.get_draft(task_code, session) if task_code else None
            state = (draft or {}).get("payload") or {}
            supplied = metadata.get("summary")
            reviewed = supplied if isinstance(supplied, dict) else extracted
            components = (reviewed or {}).get("components")
            if not isinstance(components, list) or not components:
                raise ValueError("Enter or review at least one component total before submitting.")
            for item in components:
                if not isinstance(item, dict) or not str(item.get("label") or "").strip():
                    raise ValueError("Enter a name for every component.")
                if item.get("estimatedCost") is None or not str(item["estimatedCost"]).strip():
                    raise ValueError("Enter an amount for every component. Zero is valid.")
                # Use the same numeric validation as the retained snapshot.
                item["estimatedCost"] = float(report_service._decimal(item.get("estimatedCost")))
            summary = estimation_summary(state, reviewed)
            summary["totalEstimatedCost"] = sum(item["estimatedCost"] for item in summary["components"])
            artifact = None
            if task_code:
                artifact = report_service.register_artifact(task_code, session, content=content, filename=file_name,
                    artifact_type={".xlsx": "estimation_xlsx", ".docx": "estimation_docx", ".pdf": "estimation_pdf"}[suffix],
                    source="uploaded", payload={"retrospective": True, "preparationSource": upload_type}, summary=summary, work_note=note)
                download = artifact["download"]
            else:
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                stored = OUTPUT_DIR / f"estimation-upload-{time.time_ns()}-{file_name}"
                stored.write_bytes(content)
                download = f"/downloads/{stored.name}"
            self.send_json({"ok": True, "fileName": file_name, "savedName": artifact["artifactId"] if artifact else stored.name,
                "size": len(content), "download": download, "estimationSummary": summary,
                "registered": bool(artifact), "task": artifact["task"] if artifact else None}, 201)
        except (ValueError, json.JSONDecodeError, BadZipFile) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except (AuthError, report_service.ReportDataError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except Exception as exc:
            self.send_internal_error(exc, "The estimation report could not be attached.")

    def handle_institution_valuation_upload(self, institution):
        """Retain the offline artifact required by an institution-specific valuation."""
        try:
            session = auth_routes.require_full_session(self)
            task_code = task_code_from(self)
            if task_code:
                auth_routes.verify_csrf(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0:
                raise ValueError("Select the completed report file to attach.")
            if size > 25 * 1024 * 1024:
                raise ValueError("The report file is larger than the 25 MB limit.")
            content = self.rfile.read(size)
            if institution == "kvb":
                file_name = safe_upload_name(self.headers.get("X-File-Name"), {".xlsx"}, "completed-kvb-valuation.xlsx")
                if len(content) < 4 or content[:2] != b"PK":
                    raise ValueError("Select a completed KVB Excel workbook (.xlsx).")
                workbook = load_workbook(BytesIO(content), read_only=True, data_only=False)
                workbook.close()
                prefix = "kvb-valuation-upload"
            else:
                file_name = safe_upload_name(self.headers.get("X-File-Name"), {".docx", ".pdf"}, "completed-valocity-report.pdf")
                suffix = Path(file_name).suffix.lower()
                if suffix == ".pdf" and not content.startswith(b"%PDF-"):
                    raise ValueError("The selected file is not a valid PDF report.")
                if suffix == ".docx":
                    if len(content) < 4 or content[:2] != b"PK":
                        raise ValueError("The selected file is not a valid DOCX report.")
                    with ZipFile(BytesIO(content)) as archive:
                        if "word/document.xml" not in archive.namelist():
                            raise ValueError("The selected file is not a valid DOCX report.")
                prefix = "karnataka-valuation-upload"
            artifact = None
            if task_code:
                suffix = Path(file_name).suffix.lower()
                artifact_type = "kvb_xlsx" if institution == "kvb" else "valocity_docx" if suffix == ".docx" else "valocity_pdf"
                artifact = report_service.register_artifact(
                    task_code, session, content=content, filename=file_name,
                    artifact_type=artifact_type, source="uploaded",
                )
                stored_name = artifact["artifactId"]
                download = artifact["download"]
            else:
                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                stored_name = f"{prefix}-{time.time_ns()}-{file_name}"
                (OUTPUT_DIR / stored_name).write_bytes(content)
                download = f"/downloads/{stored_name}"
            self.send_json({
                "ok": True,
                "fileName": file_name,
                "savedName": stored_name,
                "size": len(content),
                "download": download,
                "registered": bool(artifact),
                "task": artifact.get("task") if artifact else None,
            }, 201)
        except (AuthError, report_service.ReportDataError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (BadZipFile, InvalidFileException):
            self.send_json({"ok": False, "error": "The selected file could not be read as the required report format."}, 400)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The completed valuation report could not be attached. Please try again.")

    def handle_retrospective_report_upload(self, *, progress=False):
        """Attach an offline-completed valuation or assessment report."""
        try:
            session = auth_routes.require_full_session(self)
            auth_routes.verify_csrf(self)
            if session.get("role") not in {"father", "employee"}:
                raise report_service.ReportDataError("Your account cannot attach completed valuation reports.", 403, "forbidden")
            task_code = task_code_from(self)
            if not task_code:
                task_type = "Progress or Completion" if progress else "valuation"
                raise ValueError(f"Open an active {task_type} task before attaching a completed report.")
            note = unquote(str(self.headers.get("X-Work-Note", ""))).strip()
            if not note:
                raise ValueError("Add the work note that explains the completed report.")
            mode = str(self.headers.get("X-Retrospective-Mode", "plain")).strip()
            if mode not in {"offline", "template", "plain"}:
                raise ValueError("Select a valid offline preparation method.")
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 25 * 1024 * 1024:
                raise ValueError("Select a DOCX or PDF report up to 25 MB.")
            content = self.rfile.read(size)
            file_name = safe_upload_name(self.headers.get("X-File-Name"), {".docx", ".pdf"}, "completed-valuation-report.pdf")
            suffix = Path(file_name).suffix.lower()
            if suffix == ".pdf" and not content.startswith(b"%PDF-"):
                raise ValueError("The selected file is not a valid PDF report.")
            if suffix == ".docx":
                if len(content) < 4 or content[:2] != b"PK":
                    raise ValueError("The selected file is not a valid DOCX report.")
                with ZipFile(BytesIO(content)) as archive:
                    if "word/document.xml" not in archive.namelist():
                        raise ValueError("The selected file is not a valid DOCX report.")
            group = "valuation"
            if progress:
                group = workflow_service.get_task(task_code)["reportGroup"]
                if group not in {"progress", "completion"}:
                    raise ValueError("Open an active Progress or Completion task before attaching a report.")
            artifact = report_service.register_artifact(
                task_code,
                session,
                content=content,
                filename=file_name,
                artifact_type=f"{group}_{suffix[1:]}",
                source="uploaded",
                payload={"retrospective": True, "mode": "offline", "preparationSource": self.headers.get("X-Upload-Type") or "retrospective"},
                work_note=note,
            )
            self.send_json({
                "ok": True,
                "fileName": artifact["filename"],
                "download": artifact["download"],
                "registered": True,
                "task": artifact["task"],
            }, 201)
        except (AuthError, report_service.ReportDataError, workflow_service.WorkflowError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (BadZipFile, ValueError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The completed report could not be attached. Please try again.")

    def handle_institution_valuation_removal(self, institution):
        """Remove only a validated institution-upload artifact from the local output store."""
        try:
            session = auth_routes.require_full_session(self)
            task_code = task_code_from(self)
            if task_code:
                auth_routes.verify_csrf(self)
                task = report_service.remove_latest_artifact(task_code, session)
                self.send_json({"ok": True, "task": task})
                return
            stored_name = Path(unquote(str(self.headers.get("X-Stored-Name", "")))).name
            prefix = "kvb-valuation-upload-" if institution == "kvb" else "karnataka-valuation-upload-"
            allowed_suffixes = {".xlsx"} if institution == "kvb" else {".docx", ".pdf"}
            if not stored_name.startswith(prefix) or Path(stored_name).suffix.lower() not in allowed_suffixes:
                raise ValueError("The completed report attachment reference is invalid.")
            stored_path = OUTPUT_DIR / stored_name
            if stored_path.exists():
                if not stored_path.is_file():
                    raise ValueError("The completed report attachment could not be removed.")
                stored_path.unlink()
            self.send_json({"ok": True})
        except (AuthError, report_service.ReportDataError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except ValueError as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The completed valuation report attachment could not be removed. Please try again.")

    def handle_progress_generation(self, request_path):
        try:
            session = auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 60 * 1024 * 1024:
                raise ValueError("Upload is too large. Please reduce the photograph file sizes.")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("The progress/completion report data is missing.")
            task_code = task_code_from(self, payload)
            if request_path.endswith("/template"):
                auth_routes.verify_csrf(self)
                report_type = payload.get("requestedReportType")
                if not task_code or report_type not in {"progress", "completion"}:
                    raise ValueError("Open an active Progress or Completion task to download its template.")
                task = report_service.require_report_key(task_code, session, report_type)
                payload["institution"] = {
                    "code": task["institution_code_snapshot"],
                    "name": task["institution_name_snapshot"],
                    "branch": task["branch"],
                }
                content = generate_progress_template(payload, report_type)
                workflow_service.record_template_download(task_code, session, linked_report_inputs=payload)
                filename = f"{report_type.title()}_Offline_Template.docx"
                self.send_file(Path(filename), data=content, headers=[("Content-Disposition", f'attachment; filename="{filename}"')])
                return
            if task_code:
                auth_routes.verify_csrf(self)
                report_service.validate_linked_assessment(task_code, payload, session)
                payload = report_service.hydrate_media(task_code, payload, session)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            is_preview = request_path.endswith("/preview")
            generation_id = str(time.time_ns())
            preview_id = generation_id if is_preview else str(payload.get("preview_id") or "")
            preview_input = report_service.preview_input_fingerprint(task_code, session) if task_code and is_preview else None
            if preview_id and not re.fullmatch(r"\d+", preview_id):
                raise ValueError("Invalid preview identifier")
            if task_code and not is_preview:
                report_service.require_current_preview(task_code, session, preview_id)
            prefix = "progress-completion-preview" if is_preview else "progress-completion-report"
            docx_path = OUTPUT_DIR / f"{prefix}-{generation_id}.docx"
            generated = generate_progress_report(payload, docx_path)
            if is_preview:
                pdf_path = docx_path.with_suffix(".pdf")
                subprocess.run(
                    [str(SOFFICE), "--headless", "--convert-to", "pdf", "--outdir", str(OUTPUT_DIR), str(docx_path)],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=90,
                )
                if not pdf_path.exists():
                    raise RuntimeError("Progress report preview conversion did not produce a PDF.")
                artifact = None
                if task_code:
                    artifact = report_service.register_artifact(
                        task_code, session, content=pdf_path.read_bytes(), filename=pdf_path.name,
                        artifact_type="preview_pdf", source="generated", payload=payload, current=False,
                        preview_token=preview_id, preview_input=preview_input,
                    )
                self.send_json({"ok": True, "preview": artifact["download"] if artifact else f"/previews/{pdf_path.name}?v={generation_id}", "preview_id": preview_id, "reportType": generated.report_type})
                return
            artifact = None
            if task_code:
                artifact = report_service.register_artifact(
                    task_code, session, content=generated.content, filename=generated.file_name,
                    artifact_type="completion_docx" if generated.report_type == "completion" else "progress_docx",
                    source="generated", payload=payload, summary=generated.summary,
                )
            self.send_json({
                "ok": True,
                "download": artifact["download"] if artifact else f"/downloads/{docx_path.name}",
                "filename": generated.file_name,
                "reportType": generated.report_type,
                "summary": generated.summary,
                "registered": bool(artifact),
                "task": artifact.get("task") if artifact else None,
            })
        except (AuthError, report_service.ReportDataError, workflow_service.WorkflowError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The progress or completion report could not be prepared. Please try again.")

    def handle_table_export(self):
        try:
            auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 5 * 1024 * 1024:
                raise ValueError("The export request is empty or too large.")
            payload = json.loads(self.rfile.read(size))
            exported = generate_table_export(payload)
            self.send_file(
                Path(exported.file_name),
                data=exported.content,
                headers=[("Content-Disposition", f'attachment; filename="{exported.file_name}"')],
            )
        except (AuthError, report_service.ReportDataError) as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_internal_error(exc, "The Excel export could not be created. Please try again.")
