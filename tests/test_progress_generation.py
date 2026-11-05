"""Regression checks for linked progress/completion DOCX generation."""

import base64
import copy
import sys
from io import BytesIO
from pathlib import Path

from docx import Document
from PIL import Image


APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = APP_ROOT / "outputs" / "test_artifacts"


def load_generator():
    sys.path.insert(0, str(APP_ROOT))
    from backend.app.progress import generate_progress_report
    return generate_progress_report


def photo(index):
    image = Image.new("RGB", (1000, 700), (230, 240 - index, 245))
    output = BytesIO()
    image.save(output, "JPEG", quality=88)
    return {"name": f"site-{index}.jpg", "data": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()}


def payload():
    return {
        "requestedReportType": "progress",
        "institution": {"code": "KB", "name": "Karnataka Bank", "branch": "Adoni"},
        "linkedEstimation": {
            "taskId": "KB-SAMPLE-EST-010126",
            "applicantName": "Sample Borrower",
            "applicantAddress": "Adoni",
            "projectLocation": "SKD Colony, Adoni",
            "workDescription": "Construction of residential building in Stilt, GF, FF and SF",
        },
        "details": {
            "referenceNumber": "PRG/2026/1", "reportDate": "2026-10-27", "visitDate": "2026-10-26",
            "officialName": "Sample Official", "officialDesignation": "Branch Manager", "place": "Adoni",
            "materialsAtSite": 200000, "noDeviation": "yes", "deviationRemarks": "",
        },
        "components": [
            {"label": "Stilt", "estimatedCost": 2283000, "completionPercent": 60, "completedCost": 1369800},
            {"label": "GF & FF", "estimatedCost": 8853000, "completionPercent": 60, "completedCost": 5311200},
            {"label": "SF", "estimatedCost": 4485000, "completionPercent": 60, "completedCost": 2691000},
        ],
        "bank": {
            "accountNumber": "TL-001", "limitSanctioned": 10000000, "balanceAsOn": "2026-10-27",
            "balanceOutstanding": 4500000, "marginPercent": 20,
            "releases": [{"date": "2026-09-15", "amount": 3000000}],
        },
        "photos": [photo(index) for index in range(1, 5)],
    }


def combined_text(document):
    return "\n".join([*(paragraph.text for paragraph in document.paragraphs), *(" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows)])


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generate = load_generator()
    progress_path = OUTPUT_DIR / "progress_report_karnataka_test.docx"
    progress = generate(payload(), progress_path)
    progress_document = Document(progress_path)
    text = combined_text(progress_document)
    assert progress.report_type == "progress"
    assert "Sample Borrower, SKD Colony, Adoni" in text
    assert "PROGRESS / COMPLETION REPORT FOR HOUSING LOAN" in text
    assert "Cost of balance work" in text
    assert "BRANCH SANCTION" in text
    assert "95,72,000" in text
    assert len(progress_document.inline_shapes) == 4
    assert progress.summary["totalValue"] == 9572000

    completion_payload = copy.deepcopy(payload())
    completion_payload["requestedReportType"] = "completion"
    completion_payload["institution"] = {"code": "CANARA", "name": "Canara Bank", "branch": "Adoni"}
    completion_payload["details"]["materialsAtSite"] = 0
    for component in completion_payload["components"]:
        component["completionPercent"] = 100
        component["completedCost"] = component["estimatedCost"]
    completion_path = OUTPUT_DIR / "completion_report_canara_test.docx"
    completion = generate(completion_payload, completion_path)
    completion_document = Document(completion_path)
    completion_text = combined_text(completion_document)
    assert completion.report_type == "completion"
    assert "PROGRESS / COMPLETION REPORT FOR HOUSING LOAN" in completion_text
    assert "BRANCH SANCTION" not in completion_text
    assert "Ref:" not in completion_text
    assert "FORMAT" not in completion_text
    assert "Nil" in completion_text

    missing_photos = copy.deepcopy(completion_payload)
    missing_photos["photos"] = []
    try:
        generate(missing_photos)
    except ValueError as error:
        assert "photograph" in str(error)
    else:
        raise AssertionError("Progress and Completion reports must require a site photograph")

    invalid = copy.deepcopy(completion_payload)
    invalid["requestedReportType"] = "progress"
    try:
        generate(invalid)
    except ValueError as error:
        assert "Completion report" in str(error)
    else:
        raise AssertionError("A 100% Progress report should be rejected as Completion work")

    future_bank_date = copy.deepcopy(payload())
    future_bank_date["bank"]["releases"][0]["date"] = "2999-01-01"
    assert generate(future_bank_date).report_type == "progress"
    print(f"PASS: {progress_path}")
    print(f"PASS: {completion_path}")


if __name__ == "__main__":
    main()
