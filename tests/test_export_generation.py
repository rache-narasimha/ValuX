"""Regression checks for filter-aware business table exports."""

from datetime import datetime
from io import BytesIO
from zipfile import BadZipFile

from openpyxl import load_workbook

from backend.app.exports import generate_table_export


def main():
    exported = generate_table_export({
        "title": "ValuX assignments",
        "subtitle": "Status: Completed",
        "sheetName": "Assignments",
        "fileName": "completed assignments.xlsx",
        "columns": [
            {"key": "task", "label": "Task ID"},
            {"key": "date", "label": "Assigned date", "type": "date"},
            {"key": "count", "label": "Count", "type": "integer"},
            {"key": "amount", "label": "Outstanding (Rs.)", "type": "currency"},
            {"key": "notes", "label": "Notes"},
        ],
        "rows": [{"task": "KVB-AMARNATH-VAL-211026", "date": "2026-10-21", "count": 12, "amount": 5500, "notes": "=unsafe"}],
    })
    assert exported.file_name == "completed assignments.xlsx"
    workbook = load_workbook(BytesIO(exported.content), data_only=False)
    sheet = workbook["Assignments"]
    assert sheet["A1"].value == "ValuX assignments"
    assert sheet["A3"].value == "Task ID"
    assert sheet["A4"].value == "KVB-AMARNATH-VAL-211026"
    exported_date = sheet["B4"].value
    assert (exported_date.date() if isinstance(exported_date, datetime) else exported_date).isoformat() == "2026-10-21"
    assert sheet["C4"].value == 12
    assert sheet["C4"].number_format == "#,##0"
    assert sheet["D4"].value == 5500
    assert sheet["E4"].value == "'=unsafe"
    assert sheet.freeze_panes == "A4"
    assert sheet.page_setup.orientation == "landscape"
    assert str(sheet.page_setup.paperSize) == str(sheet.PAPERSIZE_A4)
    assert sheet.page_setup.fitToWidth == 1
    assert sheet.print_title_rows == "$1:$3"
    assert len(sheet.tables) == 1
    workbook.close()

    try:
        generate_table_export({"title": "Invalid", "columns": [], "rows": []})
    except ValueError:
        pass
    else:
        raise AssertionError("Empty export columns must be rejected")

    try:
        load_workbook(BytesIO(b"not-a-workbook"))
    except BadZipFile:
        pass

    print("PASS: business table XLSX exports preserve typed values and safe text")


if __name__ == "__main__":
    main()
