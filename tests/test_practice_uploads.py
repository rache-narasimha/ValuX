"""Practice offline HTTP workflow and isolation; no live business-data writes."""

import io
import json
from pathlib import Path
from urllib import error, request

from docx import Document

from backend.app.auth.database import connection
from backend.app.auth.service import create_session, revoke_session
from backend.app.valuation.config import OUTPUT_DIR


def counts():
    with connection() as database:
        return database.execute("SELECT (SELECT COUNT(*) FROM app.tasks) AS tasks,(SELECT COUNT(*) FROM app.task_artifacts) AS artifacts,(SELECT COUNT(*) FROM app.task_activities) AS activities").fetchone()


def main():
    with connection() as database:
        users = database.execute("SELECT id FROM auth.users WHERE status='active' AND role IN ('father','employee') ORDER BY created_at LIMIT 2").fetchall()
    assert len(users) == 2, "Two existing active accounts are needed for the ownership check"
    tokens = [create_session(user["id"], "full", None, "127.0.0.1", "Practice isolation regression") for user in users]
    created = []
    before = counts()

    def call(path, data=None, headers=None, *, expected=200, token=tokens[0], method=None):
        base = {"Cookie": f"valux_session={token}; valux_csrf=" + "x" * 40, "X-CSRF-Token": "x" * 40}
        req = request.Request("http://localhost:4173" + path, data=data, headers={**base, **(headers or {})}, method=method)
        try:
            response = request.urlopen(req, timeout=30)
        except error.HTTPError as failure:
            response = failure
        body = response.read()
        assert response.status == expected, (path, response.status, body[:150])
        return json.loads(body) if response.headers.get_content_type() == "application/json" else body

    try:
        document = Document(); document.add_paragraph("Practice report — no assignment")
        stream = io.BytesIO(); document.save(stream); content = stream.getvalue()
        for report_type in ("valuation-general", "valuation-agricultural", "progress", "completion"):
            progress = report_type in {"progress", "completion"}
            if progress:
                template = {"requestedReportType": report_type, "institution": {"code": "CANARA", "name": "Canara Bank", "branch": "Adoni"},
                            "linkedEstimation": {"applicantName": "Practice Applicant", "workDescription": "Practice building"},
                            "components": [{"id": "ground", "label": "Ground Floor", "estimatedCost": 100000}]}
                data = call("/api/progress/template", json.dumps(template).encode(), {"X-Practice-Mode": "1", "Content-Type": "application/json"})
            else:
                data = call("/templates/" + ("general" if report_type.endswith("general") else "agricultural") + "-master.docx")
            assert data.startswith(b"PK")
            path = "/api/progress/retrospective/upload" if progress else "/api/valuation/retrospective/upload"
            headers = {"X-Practice-Mode": "1", "X-Report-Type": report_type, "X-Upload-Type": "template", "X-File-Name": "Practice Report.docx", "X-Work-Note": "Offline Practice verification", "X-Retrospective-Mode": "offline"}
            result = call(path, content, headers, expected=201)
            assert result["registered"] is False and result["task"] is None
            created.append(OUTPUT_DIR / Path(result["download"]).name)
            assert call(result["download"]) == content
            call(result["download"], token=tokens[1], expected=404)
            call(result["download"], token=tokens[1], method="HEAD", expected=404)
            call(path, content, {**headers, "X-Task-Code": "SHOULD-NOT-WRITE"}, expected=400)
            call(path, content, {**headers, "X-CSRF-Token": "wrong"}, expected=403)
            call(path, b"not a Word file", headers, expected=400)
            call(path, content, {**headers, "X-Work-Note": ""}, expected=400)
        assert counts() == before, "Practice must not create tasks, artifacts or work-history events"
        print("PASS: all offline Practice templates/uploads, CSRF, mixed-context rejection, file ownership and zero business-data writes")
    finally:
        for path in created:
            path.unlink(missing_ok=True)
        for token in tokens:
            revoke_session(token, "127.0.0.1")


if __name__ == "__main__":
    main()
