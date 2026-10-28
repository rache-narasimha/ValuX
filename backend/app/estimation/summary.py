"""Read the final abstract/component costs from a completed estimation workbook."""

from io import BytesIO
from typing import Any

from openpyxl import load_workbook


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value or "").replace(",", "").strip())
    except ValueError:
        return None


def _abstract_rows(workbook):
    for sheet in workbook.worksheets:
        header_row = None
        total_row = None
        for row in range(1, sheet.max_row + 1):
            values = [_text(sheet.cell(row, column).value).lower() for column in range(1, min(sheet.max_column, 12) + 1)]
            joined = " | ".join(values)
            if "description of component / work" in joined:
                header_row = row
            if header_row and "total estimated project cost" in joined:
                total_row = row
                break
        if not header_row or not total_row:
            continue
        components = []
        for row in range(header_row + 1, total_row):
            label = _text(sheet.cell(row, 2).value)
            amount = _number(sheet.cell(row, 12).value)
            if not label or amount is None or label.upper() == "COMMON EXTERNAL WORKS AND PROJECT CHARGES":
                continue
            if label.lower().startswith("cost of construction of "):
                label = label[len("Cost of construction of "):]
            components.append({"id": f"workbook-{len(components) + 1}", "label": label, "estimatedCost": amount, "source": "workbook"})
        total = _number(sheet.cell(total_row, 12).value)
        if components:
            return {"components": components, "totalEstimatedCost": total if total is not None else sum(item["estimatedCost"] for item in components)}
    return None


def _detail_sheet_rows(workbook):
    components = []
    for sheet in workbook.worksheets:
        if sheet.title.lower() == "abstract":
            continue
        amount = None
        for row in range(1, min(sheet.max_row, 40) + 1):
            row_text = " | ".join(_text(sheet.cell(row, column).value).lower() for column in range(1, min(sheet.max_column, 12) + 1))
            if "estimated cost (rs.)" in row_text:
                amount = _number(sheet.cell(row, 12).value)
                break
        if amount is not None:
            components.append({"id": f"workbook-{len(components) + 1}", "label": sheet.title, "estimatedCost": amount, "source": "workbook"})
    return {"components": components, "totalEstimatedCost": sum(item["estimatedCost"] for item in components)} if components else None


def extract_estimation_summary(content: bytes) -> dict[str, Any] | None:
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        return _abstract_rows(workbook) or _detail_sheet_rows(workbook)
    finally:
        workbook.close()
