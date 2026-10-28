"""HTTP routing, static-file delivery, previews, and report downloads."""

import json
import mimetypes
import re
import shutil
import subprocess
import time
from io import BytesIO
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from openpyxl import load_workbook

from ..auth import routes as auth_routes
from ..auth.service import AuthError
from ..estimation import extract_estimation_summary, generate_estimation_workbook
from ..progress import generate_progress_report
from ..valuation.config import AGRICULTURAL_TEMPLATE, ASSETS_DIR, OUTPUT_DIR, PAGES_DIR, SOFFICE
from ..valuation.reports import generate_agricultural_docx, generate_docx
from ..valuation.schemas import agricultural_schema_payload, schema_payload


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
            if path == "/templates/agricultural-master.docx":
                if not AGRICULTURAL_TEMPLATE.exists():
                    self.send_error(404)
                    return
                self.send_file(
                    AGRICULTURAL_TEMPLATE,
                    headers=[("Content-Disposition", 'attachment; filename="Agricultural_Valuation_Master_Template.docx"')],
                )
                return
            pages = {
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
            data = file_path.read_bytes().replace(
                b"</head>", auth_routes.authentication_context_script(session) + b"</head>", 1
            )
            self.send_file(file_path, data=data)
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
        if request_path == "/api/estimation/upload":
            self.handle_estimation_upload()
            return
        if request_path in {"/api/estimation/workbook", "/api/estimation/preview"}:
            self.handle_estimation_generation(request_path)
            return
        if request_path in {"/api/progress/generate", "/api/progress/preview"}:
            self.handle_progress_generation(request_path)
            return
        general_paths = {"/api/generate", "/api/preview"}
        agricultural_paths = {"/api/agricultural/generate", "/api/agricultural/preview"}
        if request_path not in general_paths | agricultural_paths:
            self.send_error(404)
            return
        try:
            auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 60 * 1024 * 1024:
                raise ValueError("Upload is too large. Please reduce the photo file sizes.")
            payload = json.loads(self.rfile.read(size))
            values = payload.get("values", {})
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            is_agricultural = request_path in agricultural_paths
            is_preview = request_path.endswith("/preview")
            prefix = "agricultural-valuation" if is_agricultural else "valuation"
            preview_id = str(time.time_ns()) if is_preview else str(payload.get("preview_id", ""))
            if preview_id and not re.fullmatch(r"\d+", preview_id):
                raise ValueError("Invalid preview identifier")
            generation_id = str(time.time_ns())
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
                generator(values, docx_path, payload.get("photos", []), payload.get("map"))
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
                if is_preview:
                    self.send_json({"ok": True, "preview": f"/previews/{pdf_name}?v={time.time_ns()}", "preview_id": preview_id})
                else:
                    self.send_json({"ok": True, "download": f"/downloads/{pdf_name}"})
            else:
                self.send_json({"ok": True, "download": f"/downloads/{docx_name}"})
        except AuthError as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def handle_estimation_generation(self, request_path):
        try:
            auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 20 * 1024 * 1024:
                raise ValueError("The estimation form payload is too large.")
            payload = json.loads(self.rfile.read(size))
            state = payload.get("state")
            if not isinstance(state, dict):
                raise ValueError("The estimation form state is missing.")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            is_preview = request_path.endswith("/preview")
            mode = "offline" if payload.get("mode") == "offline" else "completed"
            generated = generate_estimation_workbook(state, mode=mode)
            generation_id = str(time.time_ns())
            if is_preview:
                xlsx_path = OUTPUT_DIR / f"estimation-preview-{generation_id}.xlsx"
                pdf_path = xlsx_path.with_suffix(".pdf")
                xlsx_path.write_bytes(generated.content)
                try:
                    subprocess.run(
                        [str(SOFFICE), "--headless", "--convert-to", "pdf", "--outdir", str(OUTPUT_DIR), str(xlsx_path)],
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=90,
                    )
                finally:
                    xlsx_path.unlink(missing_ok=True)
                if not pdf_path.exists():
                    raise RuntimeError("Workbook preview conversion did not produce a PDF.")
                self.send_json({"ok": True, "preview": f"/previews/{pdf_path.name}?v={generation_id}"})
                return

            report_url = ""
            if mode == "completed":
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
                ],
            )
        except AuthError as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def handle_estimation_upload(self):
        try:
            auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0:
                raise ValueError("Select a completed Excel workbook to attach.")
            if size > 25 * 1024 * 1024:
                raise ValueError("The Excel upload is larger than the 25 MB limit.")
            file_name = safe_xlsx_name(self.headers.get("X-File-Name"))
            content = self.rfile.read(size)
            if len(content) < 4 or content[:2] != b"PK":
                raise ValueError("The selected file is not a valid Excel workbook package.")
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=False)
            workbook.close()
            estimation_summary = extract_estimation_summary(content)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            stored_name = f"estimation-upload-{time.time_ns()}-{file_name}"
            stored_path = OUTPUT_DIR / stored_name
            stored_path.write_bytes(content)
            self.send_json(
                {
                    "ok": True,
                    "fileName": file_name,
                    "savedName": stored_name,
                    "size": len(content),
                    "download": f"/downloads/{stored_name}",
                    "estimationSummary": estimation_summary,
                },
                201,
            )
        except AuthError as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)

    def handle_progress_generation(self, request_path):
        try:
            auth_routes.require_full_session(self)
            size = int(self.headers.get("Content-Length", "0"))
            if size > 60 * 1024 * 1024:
                raise ValueError("Upload is too large. Please reduce the photograph file sizes.")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("The progress/completion report data is missing.")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            is_preview = request_path.endswith("/preview")
            generation_id = str(time.time_ns())
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
                self.send_json({"ok": True, "preview": f"/previews/{pdf_path.name}?v={generation_id}", "reportType": generated.report_type})
                return
            self.send_json({
                "ok": True,
                "download": f"/downloads/{docx_path.name}",
                "filename": generated.file_name,
                "reportType": generated.report_type,
                "summary": generated.summary,
            })
        except AuthError as exc:
            self.send_json({"ok": False, "error": str(exc), "code": exc.code}, exc.status)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)
