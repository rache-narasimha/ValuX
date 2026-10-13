"""HTTP routing, static-file delivery, previews, and report downloads."""

import json
import mimetypes
import re
import shutil
import subprocess
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

from .config import AGRICULTURAL_TEMPLATE, ASSETS_DIR, OUTPUT_DIR, PAGES_DIR, SOFFICE
from .reports import generate_agricultural_docx, generate_docx
from .schemas import agricultural_schema_payload, schema_payload

class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
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
            content_type = "application/pdf" if file_path.suffix.lower() == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            self.send_header("Content-Type", content_type)
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
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'inline; filename="{file_path.name}"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/templates/agricultural-master.docx":
            if not AGRICULTURAL_TEMPLATE.exists():
                self.send_error(404)
                return
            data = AGRICULTURAL_TEMPLATE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Disposition", 'attachment; filename="Agricultural_Valuation_Master_Template.docx"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        pages = {
            "/": PAGES_DIR / "index.html",
            "/tasks": PAGES_DIR / "tasks.html",
            "/tasks/": PAGES_DIR / "tasks.html",
            "/tasks/new": PAGES_DIR / "new-task.html",
            "/tasks/new/": PAGES_DIR / "new-task.html",
            "/tasks/detail": PAGES_DIR / "task.html",
            "/tasks/detail/": PAGES_DIR / "task.html",
            "/valuation/general": PAGES_DIR / "general.html",
            "/valuation/general/": PAGES_DIR / "general.html",
            "/valuation/agricultural": PAGES_DIR / "agricultural.html",
            "/valuation/agricultural/": PAGES_DIR / "agricultural.html",
        }
        file_path = pages.get(path)
        if file_path is None and path.startswith("/assets/"):
            file_path = ASSETS_DIR / path.removeprefix("/assets/")
        if file_path is None:
            self.send_error(404)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        request_path = urlparse(self.path).path
        general_paths = {"/api/generate", "/api/preview"}
        agricultural_paths = {"/api/agricultural/generate", "/api/agricultural/preview"}
        if request_path not in general_paths | agricultural_paths:
            self.send_error(404)
            return
        try:
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
            base_name = f"{prefix}-preview-{preview_id}" if is_preview else f"{prefix}-report"
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
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)
