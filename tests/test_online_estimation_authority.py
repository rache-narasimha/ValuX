"""Exercise browser totals, server totals and recalculated workbook amounts."""

from dataclasses import replace
from io import BytesIO
from datetime import date
import base64
import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from openpyxl import load_workbook
from PIL import Image

from backend.app.estimation.generator import _load_manifest, generate_estimation_workbook, online_estimation_summary
from backend.app.estimation.summary import WorkbookTotalsMismatch, verify_generated_estimation
from backend.app.valuation.config import SOFFICE
from tests.test_estimation_generation import controlled_industrial_state


def fixtures():
    industrial = controlled_industrial_state()
    industrial["details"].update(workAddress="Adoni", workMode="online",
                                 commonExternalWorks={"Electrical Works": "3.145"})
    industrial["components"][0]["id"] = "building"
    ground = industrial["components"][0]["sheets"][0]
    ground["id"] = "ground"
    ground["formData"]["finalAmount"] = 999999
    ground["formData"]["rows"]["pcc-total"] = {"directQuantity": 42.0696, "rate": 3561.89}
    ground["formData"]["itemOverrides"] = {"standard-0": "0"}
    ground["formData"]["omittedItems"] = {"standard-0": True}
    ground["formData"]["customRows"] = {
        "concrete-plinth-long": [{"id": "extra-plinth", "label": "Additional plinth"}],
    }
    ground["formData"]["rows"]["extra-plinth"] = {"no": 1, "length": 2, "breadth": 1, "depth": 1}

    commercial = {
        "propertyType": "commercial", "construction": "rcc", "subtype": "warehouse",
        "details": {"workAddress": "Adoni", "workMode": "online", "measurementMethod": "centre_line",
                    "customComponentEstimates": [{"id": "extra", "description": "Utility room", "amount": "10.005"}]},
        "components": [{"id": "building", "name": "Commercial Building", "kind": "rcc_building", "sheets": [
            {"id": "stilt", "key": "stilt", "label": "Stilt", "level": 0, "layoutVersion": 2,
             "formData": {"sheetTotalOverride": "0", "finalAmount": 9999}},
            {"id": "typical", "key": "ground", "label": "Typical GF, FF & SF", "level": 1, "layoutVersion": 2,
             "typicalFloorKeys": ["ground", "first", "second"], "typicalBasis": "per-floor",
             "formData": {"rows": {
                 "concrete-columns": {"directQuantity": 12.5, "rate": "100.005"},
                 "steel-columns": {"factor": 150}, "steel-total": {"rate": "1"},
                 "whitewashing": {"amount": "250.005"},
             }}},
        ]}],
    }
    typical = commercial["components"][0]["sheets"][1]["formData"]
    items = _load_manifest()["worksheets"]["commercial_rcc_upper_centre_line"]["items"]
    washing = next(index for index, item in enumerate(items) if any(line["id"] == "whitewashing" for line in item["rows"]))
    typical["itemOverrides"] = {f"standard-{washing}": "12.005"}
    commercial["details"]["commonExternalWorks"] = {"Electrical Works": "0"}
    residential = {
        "propertyType": "residential", "construction": "rcc", "subtype": "individual",
        "details": {"workAddress": "Adoni", "workMode": "online", "commonExternalWorks": {"Electrical Works": 999}},
        "components": [{"id": "house", "name": "House", "kind": "residential_building", "sheets": [
            {"id": "gf", "key": "ground", "label": "Ground Floor", "level": 1,
             "formData": {"sheetTotalOverride": "3535.005", "rows": {
                 "pcc-total": {"directQuantity": 1, "rate": 3},
                 "concrete-roof-slab": {
                     "no": 1, "length": 12, "breadth": 9, "rate": 10,
                     "depth": "Shared slab · Blank axes use outside dimensions",
                 },
             }}},
        ]}],
    }
    storage = {
        "propertyType": "industrial", "construction": "shed", "subtype": "industrial_unit",
        "details": {"workAddress": "Adoni", "workMode": "online"},
        "components": [{"id": "shed", "name": "Storage Shed", "kind": "storage_shed", "formData": {
            "rows": {"galvalume-roofing": {"quantity": 12.345, "rate": "9.995"}},
        }}],
    }
    rows = storage["components"][0]["formData"]["rows"]
    for item in _load_manifest()["worksheets"]["storage_shed"]["items"]:
        for line in item["rows"]:
            inputs = rows.setdefault(line["id"], {})
            if line["calculation"] in {"standard_4_factor", "three_factor_fgh", "three_factor_fgi", "count_rate"}:
                inputs.update(no=2, length=3.29, breadth=2.11, depth=1.18)
            if line.get("rate"):
                inputs.setdefault("rate", 23.675)
    return [industrial, commercial, storage, residential]


def http_flow():
    """Run only against a disposable database and output volume."""
    from backend.app.auth.config import CSRF_COOKIE, SESSION_COOKIE
    from backend.app.auth.database import connection
    from backend.app.auth.service import create_session

    user_id = uuid.uuid4()
    name = "Estimation authority QA"
    with connection() as db:
        db.execute(
            """INSERT INTO auth.users (id, user_id, display_name, role, status, password_hash, must_change_password)
               VALUES (%s, %s, %s, 'father', 'active', 'fixture-only', FALSE)""",
            (user_id, f"qa-{user_id.hex[:12]}", name),
        )
    session = create_session(user_id, "full", None, "127.0.0.1", "estimation authority QA")
    csrf = uuid.uuid4().hex

    def request(path, payload=None, status=200, binary=False):
        headers = {"Cookie": f"{SESSION_COOKIE}={session}; {CSRF_COOKIE}={csrf}",
                   "X-CSRF-Token": csrf, "Content-Type": "application/json"}
        data = None if payload is None else json.dumps(payload).encode()
        try:
            with urlopen(Request(f"http://127.0.0.1:4173{path}", data=data, headers=headers), timeout=95) as response:
                assert response.status == status
                content = response.read()
                return content if binary else json.loads(content)
        except HTTPError as error:
            body = json.loads(error.read())
            assert error.code == status, (path, error.code, body)
            return body

    today = date.today().isoformat()
    task = request("/api/tasks", {
        "institutionCode": "CANARA", "branch": "Adoni", "customerName": name,
        "propertyBrief": "Synthetic estimate", "reportKey": "estimation", "assignee": name,
        "priority": "Normal", "assignedDate": today, "dueDate": today, "initialNote": "Synthetic verification task.",
    }, status=201)["task"]
    code = task["id"]
    draft = fixtures()[-1]
    draft["details"].update(applicantName=name, estimateDate=today, place="Adoni", workDescription="Test work")
    saved = request(f"/api/tasks/{code}/draft", {"reportKey": "estimation", "schemaVersion": "3", "revision": 0, "payload": draft})["draft"]
    from backend.app.reports.service import report_input_fingerprint

    previous_fingerprint = report_input_fingerprint(saved["payload"], "estimation", "3", "older-workbook-version")
    with connection() as db:
        db.execute(
            """
            UPDATE app.report_drafts SET input_fingerprint = %s
            WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = %s)
            """,
            (previous_fingerprint, code),
        )
    body = {"taskCode": code, "state": {}, "mode": "completed", "summary": {"totalEstimatedCost": 999999}}
    assert request("/api/estimation/workbook", body, status=409)["code"] == "preview_required"
    preview = request("/api/estimation/preview", body)
    body["preview_id"] = preview["preview_id"]
    assert preview["summary"]["totalEstimatedCost"] == 4000
    assert request("/api/estimation/totals", body)["summary"] == preview["summary"]
    refreshed = request(f"/api/tasks/{code}/draft")["draft"]
    assert refreshed["revision"] == saved["revision"] and refreshed["payload"] == saved["payload"]
    draft["components"][0]["sheets"][0]["formData"]["sheetTotalOverride"] = "4500.005"
    request(f"/api/tasks/{code}/draft", {
        "reportKey": "estimation", "schemaVersion": "3", "revision": saved["revision"], "payload": draft,
    })
    assert request("/api/estimation/workbook", body, status=409)["code"] == "preview_required"
    assert request(f"/api/tasks/{code}")["task"]["estimationSummary"] is None
    preview = request("/api/estimation/preview", body)
    body["preview_id"] = preview["preview_id"]
    content = request("/api/estimation/workbook", body, binary=True)
    workbook = load_workbook(BytesIO(content))
    try:
        sheet, cell, _ = generate_estimation_workbook(draft).checks[1]
        assert workbook[sheet][cell].value == 5000
    finally:
        workbook.close()
    task = request(f"/api/tasks/{code}")["task"]
    assert task["estimationSummary"]["components"][0]["id"] == "measure-house-gf"
    assert task["estimationSummary"]["totalEstimatedCost"] == 5000
    assert task["reportFresh"]
    print("PASS: saved inputs, current preview, Excel download and PostgreSQL snapshot agree")

    completed = request(f"/api/tasks/{code}/complete", {"version": task["version"], "note": "Fixture estimate complete."})["task"]
    components = completed["estimationSummary"]["components"]
    png = BytesIO()
    Image.new("RGB", (32, 32), "white").save(png, format="PNG")
    photo = {"name": "site.png", "data": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()}
    for report_type, percent in (("progress", 50), ("completion", 100)):
        linked_task = request("/api/tasks", {
            "institutionCode": "CANARA", "branch": "Adoni", "customerName": name,
            "propertyBrief": "Synthetic assessment", "reportKey": report_type, "assignee": name,
            "linkedEstimationId": code, "priority": "Normal", "assignedDate": today, "dueDate": today,
            "initialNote": "Synthetic assessment task.",
        }, status=201)["task"]
        linked_code = linked_task["id"]
        assessment = {
            "taskCode": linked_code, "requestedReportType": report_type, "linkedEstimationId": code,
            "linkedEstimation": {"taskId": code, "applicantName": name, "workDescription": "Test work"},
            "institution": {"code": "CANARA", "name": "Canara Bank", "branch": "Adoni"},
            "details": {"reportDate": today, "visitDate": today, "noDeviation": "yes", "place": "Adoni"},
            "preparationMethod": "online",
            "components": [
                {**item, "completionPercent": percent, "completedCost": round(item["estimatedCost"] * percent / 100, 2)}
                for item in components
            ], "photos": [photo], "map": photo,
        }
        saved_assessment = request(f"/api/tasks/{linked_code}/draft", {
            "reportKey": report_type, "schemaVersion": "1", "revision": 0, "payload": assessment,
        })["draft"]["payload"]
        assessment["photos"] = saved_assessment["photos"]
        assessment["map"] = saved_assessment["map"]
        invalid = {**assessment, "components": [{**assessment["components"][0], "estimatedCost": 6000}]}
        assert request("/api/progress/preview", invalid, status=409)["code"] == "estimation_components_changed"
        approved = request("/api/progress/preview", assessment)
        assert approved["reportType"] == report_type
        assessment["preview_id"] = approved["preview_id"]
        invalid["preview_id"] = approved["preview_id"]
        assert request("/api/progress/generate", invalid, status=409)["code"] == "estimation_components_changed"
        generated = request("/api/progress/generate", assessment)
        assert generated["summary"]["components"][0]["estimatedCost"] == 5000
        assert request(generated["download"], binary=True).startswith(b"PK")
    print("PASS: online Progress and Completion reject altered costs and generate from pinned component totals")


if __name__ == "__main__":
    cases = fixtures()
    if "--fixtures" in sys.argv:
        print(json.dumps(cases))
    elif "--isolated-http" in sys.argv:
        http_flow()
    else:
        browser = json.load(sys.stdin) if "--compare-browser" in sys.argv else None
        for index, case in enumerate(cases):
            generated = generate_estimation_workbook(case)
            assert generated.summary == online_estimation_summary(case)
            expected = {item["id"]: item["estimatedCost"] for item in generated.summary["components"]}
            if browser is not None:
                assert {item["id"]: item["estimatedCost"] for item in browser[index]} == expected
            verify_generated_estimation(generated, SOFFICE)
        assert cases[0]["components"][0]["sheets"][0]["formData"]["finalAmount"] == 999999
        assert expected == {"measure-house-gf": 4000}
        workbook = load_workbook(BytesIO(generated.content))
        sheet, coordinate, _ = generated.checks[-1]
        workbook[sheet][coordinate] = 999999
        altered = BytesIO()
        workbook.save(altered)
        workbook.close()
        try:
            verify_generated_estimation(replace(generated, content=altered.getvalue()), SOFFICE)
        except WorkbookTotalsMismatch:
            pass
        else:
            raise AssertionError("A workbook with a wrong Abstract total qualified.")
        print("PASS: authoritative workbook totals, explicit overrides, and mismatch rejection"
              + (" with browser parity" if browser is not None else ""))
