"""Inspect uploaded XLSX files without unbounded work in the HTTP process.

Processing budgets apply to automatic extraction, not the existing upload size
or the user's ability to supply reviewed estimation totals manually.
"""

from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from threading import BoundedSemaphore
from zipfile import BadZipFile, ZipFile


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_AUTO_ENTRIES = 10_000
MAX_AUTO_XML_BYTES = 128 * 1024 * 1024
MAX_AUTO_XML_PART_BYTES = 64 * 1024 * 1024
MAX_WORKER_OUTPUT_BYTES = 1024 * 1024
WORKER_TIMEOUT_SECONDS = 20
WORKER_MEMORY_BYTES = 384 * 1024 * 1024
APP_ROOT = Path(__file__).resolve().parents[3]


def _memory_budget() -> int:
    for name in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            available = int(Path(name).read_text().strip())
        except (OSError, ValueError):
            continue
        return min(WORKER_MEMORY_BYTES, max(256 * 1024 * 1024, available // 3))
    return WORKER_MEMORY_BYTES


_WORKERS = BoundedSemaphore(2 if _memory_budget() == WORKER_MEMORY_BYTES else 1)


class WorkbookUploadError(ValueError):
    """The attachment cannot safely be read as an XLSX workbook."""


def _within_processing_budget(content: bytes) -> bool:
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise WorkbookUploadError("Select an Excel workbook up to 25 MB.")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if "xl/workbook.xml" not in archive.namelist():
                raise WorkbookUploadError("The selected file is not a readable Excel workbook.")
            xml = [entry for entry in entries if entry.filename.endswith((".xml", ".rels"))]
            return (len(entries) <= MAX_AUTO_ENTRIES
                    and sum(entry.file_size for entry in xml) <= MAX_AUTO_XML_BYTES
                    and all(entry.file_size <= MAX_AUTO_XML_PART_BYTES for entry in xml))
    except (BadZipFile, NotImplementedError, RuntimeError) as error:
        raise WorkbookUploadError("The selected file is not a readable Excel workbook.") from error


def _run_worker(content: bytes, operation: str) -> dict:
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise WorkbookUploadError("Select an Excel workbook up to 25 MB.")
    if not content.startswith(b"PK"):
        raise WorkbookUploadError("The selected file is not a readable Excel workbook.")
    # Ordinary workbooks release a slot promptly. Long-running extraction can
    # never create an unbounded number of parsing processes.
    wait = WORKER_TIMEOUT_SECONDS if operation == "validate" else 5
    if not _WORKERS.acquire(timeout=wait):
        return {"status": "skipped"}
    try:
        environment = {
            key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH")
            if key in os.environ
        }
        environment.update(PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
        try:
            result = subprocess.run(
                [sys.executable, "-m", "backend.app.reports.workbook_uploads", operation],
                input=content, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=APP_ROOT, env=environment, timeout=WORKER_TIMEOUT_SECONDS,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return {"status": "skipped"}
        if result.returncode or len(result.stdout) > MAX_WORKER_OUTPUT_BYTES:
            return {"status": "skipped"}
        try:
            value = json.loads(result.stdout)
        except (ValueError, UnicodeError):
            return {"status": "skipped"}
        if not isinstance(value, dict):
            return {"status": "skipped"}
        if value.get("status") == "invalid":
            raise WorkbookUploadError(
                "The workbook contains unreadable or unsupported XML. "
                "Open and save it as an Excel workbook, then attach it again."
            )
        return value
    finally:
        _WORKERS.release()


def extract_uploaded_estimation_summary(content: bytes) -> dict | None:
    """A resource limit leaves the existing manual-entry path available."""
    result = _run_worker(content, "extract")
    summary = result.get("summary") if result.get("status") == "ok" else None
    return summary if isinstance(summary, dict) else None


def inspect_uploaded_workbook(content: bytes) -> None:
    """Check XML when totals were reviewed manually, without extracting them again."""
    _run_worker(content, "inspect")


def validate_uploaded_workbook(content: bytes) -> None:
    """Keep institution XLSX validation outside the HTTP worker process."""
    if _run_worker(content, "validate").get("status") != "ok":
        raise WorkbookUploadError(
            "The workbook could not be checked safely. "
            "Open and save it in Excel, then attach it again."
        )


def _worker(operation: str) -> dict:
    import resource

    memory = _memory_budget()
    resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    from defusedxml.common import DefusedXmlException
    from defusedxml.ElementTree import ParseError, iterparse
    from openpyxl import load_workbook
    from openpyxl.utils.exceptions import InvalidFileException

    content = sys.stdin.buffer.read(MAX_UPLOAD_BYTES + 1)
    if not _within_processing_budget(content):
        return {"status": "skipped"}
    try:
        # Validate XML with DTDs/entities disabled before lxml/openpyxl sees any
        # part, including relationship files. Nothing is extracted to disk.
        with ZipFile(BytesIO(content)) as archive:
            for entry in archive.infolist():
                if entry.filename.endswith((".xml", ".rels")):
                    with archive.open(entry) as stream:
                        for _event, element in iterparse(stream, forbid_dtd=True):
                            element.clear()
        if operation == "inspect":
            return {"status": "ok"}
        if operation == "extract":
            from ..estimation.summary import extract_estimation_summary

            summary = extract_estimation_summary(content)
            if summary and len(summary.get("components", [])) > 1000:
                return {"status": "skipped"}
            result = {"status": "ok", "summary": summary}
            if len(json.dumps(result).encode()) > MAX_WORKER_OUTPUT_BYTES:
                return {"status": "skipped"}
            return result
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
        workbook.close()
        return {"status": "ok"}
    except (DefusedXmlException, ParseError, BadZipFile, InvalidFileException, ValueError, KeyError):
        return {"status": "invalid"}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in {"extract", "inspect", "validate"}:
            raise SystemExit(2)
        response = _worker(sys.argv[1])
    except WorkbookUploadError:
        response = {"status": "invalid"}
    except (MemoryError, OSError):
        response = {"status": "skipped"}
    print(json.dumps(response))
