"""Upload safety, reviewed totals, file bytes and uploader-only Practice access."""

import base64
import hashlib
import json
from pathlib import Path
import secrets
from urllib import error, request
from urllib.parse import quote

from backend.app.auth.database import connection
from backend.app.auth.service import create_session, revoke_session
from backend.app.valuation.config import OUTPUT_DIR
from tests.test_workbook_uploads import replace_part, workbook_bytes


def counts():
    with connection() as database:
        return database.execute("SELECT (SELECT COUNT(*) FROM app.tasks) AS tasks,(SELECT COUNT(*) FROM app.task_artifacts) AS artifacts,(SELECT COUNT(*) FROM app.task_activities) AS activities").fetchone()


def main():
    with connection() as database:
        users = database.execute("SELECT id FROM auth.users WHERE status='active' AND role IN ('father','employee') ORDER BY (role='father') DESC,created_at LIMIT 2").fetchall()
    assert len(users) == 2, "Two active accounts are needed to verify Practice ownership"
    tokens = [create_session(user["id"], "full", None, "127.0.0.1", "Workbook upload security regression") for user in users]
    created = []
    before = counts()

    def call(path, content=None, *, expected=200, headers=None, method=None, token=tokens[0]):
        base = {"Cookie": f"valux_session={token}; valux_csrf=" + "x" * 40,
                "X-CSRF-Token": "x" * 40, "X-Practice-Mode": "1"}
        req = request.Request("http://localhost:4173" + quote(path, safe="/%"), data=content,
                              headers={**base, **(headers or {})}, method=method)
        try:
            response = request.urlopen(req, timeout=45)
        except error.HTTPError as failure:
            response = failure
        data = response.read()
        assert response.status == expected, (path, response.status, data[:200])
        return json.loads(data) if response.headers.get_content_type() == "application/json" else data

    def payload(content, **extra):
        return json.dumps({"fileName": "Workbook security check.xlsx", "content": base64.b64encode(content).decode(), **extra}).encode()

    def check_download(record, content):
        created.append(OUTPUT_DIR / Path(record["download"]).name)
        assert call(record["download"]) == content
        assert call(record["download"], method="HEAD") == b""
        call(record["download"], token=tokens[1], expected=404)
        call(record["download"], token=tokens[1], method="HEAD", expected=404)
        if record["download"].endswith(".pdf"):
            preview = record["download"].replace("/downloads/", "/previews/", 1)
            assert call(preview) == content
            call(preview, token=tokens[1], expected=404)

    try:
        content = workbook_bytes()
        headers = {"Content-Type": "application/json"}
        result = call("/api/estimation/upload/analyze", payload(content), headers=headers)
        assert result["components"][0]["estimatedCost"] == 2744000
        assert result["components"][1]["estimatedCost"] == 0
        assert not result["extractionNotice"]
        call("/api/estimation/upload/analyze", payload(content), headers={**headers, "X-CSRF-Token": "wrong"}, expected=403)
        call("/api/estimation/upload/analyze", payload(content), headers={**headers, "X-Task-Code": "SHOULD-NOT-WRITE"}, expected=400)
        manual = {"components": [{"label": "Reviewed Ground Floor", "estimatedCost": 3000000}, {"label": "Utility", "estimatedCost": 0}]}
        # Large valid XML remains attachable with manual totals; only automatic
        # processing is skipped, without reducing the 25 MB upload limit.
        large_xml = b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + b" " * (65 * 1024 * 1024) + b"<sheetData/></worksheet>"
        expensive = replace_part(content, "xl/worksheets/sheet1.xml", large_xml)
        result = call("/api/estimation/upload/analyze", payload(expensive), headers=headers)
        assert result["components"] == [] and "attachment is kept" in result["extractionNotice"].lower()
        result = call("/api/estimation/upload", payload(expensive, uploadType="retrospective", workNote="Reviewed component totals", summary=manual), headers=headers, expected=201)
        assert result["estimationSummary"]["totalEstimatedCost"] == 3000000
        check_download(result, expensive)
        call("/downloads/%2e%2e/%2e%2e/.env", expected=404)
        result = call("/api/estimation/upload", payload(content, uploadType="retrospective", workNote="Reviewed component totals", summary=manual), headers=headers, expected=201)
        assert result["estimationSummary"]["totalEstimatedCost"] == 3000000
        check_download(result, content)
        assert hashlib.sha256(call(result["download"])).digest() == hashlib.sha256(content).digest()
        hostile = replace_part(content, "xl/worksheets/sheet1.xml", b'<!DOCTYPE worksheet [<!ENTITY sample "text">]><worksheet>&sample;</worksheet>')
        call("/api/estimation/upload/analyze", payload(hostile), headers=headers, expected=400)
        call("/api/estimation/upload", payload(hostile, uploadType="retrospective", workNote="Reviewed component totals", summary=manual), headers=headers, expected=400)
        kvb_headers = {"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "X-File-Name": "Workbook security check.xlsx"}
        call("/api/valuation/kvb/upload", hostile, headers=kvb_headers, expected=400)
        for institution, data, upload_headers in (
            ("kvb", content, kvb_headers),
            ("karnataka", b"%PDF-1.4\n%Synthetic Practice attachment\n", {"Content-Type": "application/pdf", "X-File-Name": "Practice Valocity report.pdf"}),
        ):
            route = f"/api/valuation/{institution}/upload"
            call(route, data, headers={**upload_headers, "X-CSRF-Token": "wrong"}, expected=403)
            record = call(route, data, headers=upload_headers, expected=201)
            check_download(record, data)
            removal = {"X-Stored-Name": record["savedName"]}
            call(route, method="DELETE", headers=removal, token=tokens[1], expected=404)
            call(route, method="DELETE", headers={**removal, "X-CSRF-Token": "wrong"}, expected=403)
            assert call(record["download"]) == data
            call(route, method="DELETE", headers=removal)
            call(record["download"], expected=404)
        # Unknown ownership is never guessed for retained legacy Practice bytes.
        for prefix in ("estimation-upload-", "kvb-valuation-upload-", "karnataka-valuation-upload-"):
            suffix = ".pdf" if prefix.startswith("karnataka") else ".xlsx"
            legacy = OUTPUT_DIR / (prefix + "security-check-" + secrets.token_hex(8) + suffix)
            legacy.write_bytes(content); created.append(legacy)
            for token in tokens:
                call("/downloads/" + legacy.name, token=token, expected=404)
                call("/downloads/" + legacy.name, token=token, method="HEAD", expected=404)
                call("/previews/" + legacy.name, token=token, expected=404)
            if prefix != "estimation-upload-":
                institution = "kvb" if prefix.startswith("kvb") else "karnataka"
                result = call(f"/api/valuation/{institution}/upload", method="DELETE", headers={"X-Stored-Name": legacy.name})
                assert result["expired"] and legacy.read_bytes() == content
        assert counts() == before, "Practice checks must not write live task/artifact/activity data"
        print("PASS: estimation and bank uploads, unchanged bytes/manual totals, unsafe XML rejection, uploader-only GET/HEAD/removal, CSRF and legacy-link expiry")
    finally:
        for path in created:
            path.unlink(missing_ok=True)
        for token in tokens:
            revoke_session(token, "127.0.0.1")


if __name__ == "__main__":
    main()
