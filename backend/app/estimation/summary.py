"""Read the final abstract/component costs from a completed estimation workbook."""

from io import BytesIO
import re
from typing import Any

from openpyxl import load_workbook

from .generator import COMMON_EXTERNAL_WORKS, expected_estimation_sheet_names


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value or "").replace(",", "").strip())
    except ValueError:
        return None


def _component_key(value: Any) -> str:
    text = _text(value).replace("—", "-").replace("–", "-").lower()
    return re.sub(r"\s+", " ", text).strip()


def expected_estimation_components(state: dict[str, Any] | None) -> list[str]:
    """Return the component/floor labels the configured offline workbook requires."""
    source = state if isinstance(state, dict) else {}
    expected: list[str] = []
    for component in source.get("components") if isinstance(source.get("components"), list) else []:
        name = _text(component.get("name"))
        sheets = component.get("sheets") if isinstance(component.get("sheets"), list) else []
        if sheets:
            expected.extend(f"{name} - {_text(sheet.get('label'))}" for sheet in sheets if name and _text(sheet.get("label")))
        elif name:
            expected.append(name)
    details = source.get("details") if isinstance(source.get("details"), dict) else {}
    custom = details.get("customComponentEstimates") if isinstance(details.get("customComponentEstimates"), list) else []
    expected.extend(_text(item.get("description")) for item in custom if _text(item.get("description")))
    return expected


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
            if not label or label.upper() == "COMMON EXTERNAL WORKS AND PROJECT CHARGES":
                continue
            if label.lower().startswith("cost of construction of "):
                label = label[len("Cost of construction of "):]
            components.append({"id": f"workbook-{len(components) + 1}", "label": label, "estimatedCost": amount, "source": "workbook"})
        total = _number(sheet.cell(total_row, 12).value)
        if components:
            known = [item["estimatedCost"] for item in components if item["estimatedCost"] is not None]
            return {"components": components, "totalEstimatedCost": total if total is not None else sum(known)}
    return None


def _detail_sheet_rows(workbook):
    components = []
    for sheet in workbook.worksheets:
        if sheet.title.lower() == "abstract":
            continue
        amount = None
        found_estimated_cost = False
        for row in range(1, min(sheet.max_row, 40) + 1):
            row_text = " | ".join(_text(sheet.cell(row, column).value).lower() for column in range(1, min(sheet.max_column, 12) + 1))
            if "estimated cost (rs.)" in row_text:
                found_estimated_cost = True
                amount = _number(sheet.cell(row, 12).value)
                break
        if found_estimated_cost:
            components.append({"id": f"workbook-{len(components) + 1}", "label": sheet.title, "estimatedCost": amount, "source": "workbook"})
    known = [item["estimatedCost"] for item in components if item["estimatedCost"] is not None]
    return {"components": components, "totalEstimatedCost": sum(known)} if components else None


def extract_estimation_summary(content: bytes) -> dict[str, Any] | None:
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        summary = _abstract_rows(workbook) or _detail_sheet_rows(workbook)
        if summary is not None:
            summary["worksheetNames"] = list(workbook.sheetnames)
        return summary
    finally:
        workbook.close()


def validate_estimation_summary(state: dict[str, Any] | None, extracted: dict[str, Any] | None) -> dict[str, Any]:
    """Require the configured worksheets/components and reject unrelated additions."""
    expected = expected_estimation_components(state)
    if not expected:
        raise ValueError("The estimation task does not contain a configured component list to validate this upload.")
    expected_sheets = list(expected_estimation_sheet_names(state or {}))
    actual_sheets = extracted.get("worksheetNames") if isinstance(extracted, dict) else None
    actual_sheets = actual_sheets if isinstance(actual_sheets, list) else []
    expected_sheet_keys = {_component_key(name): name for name in expected_sheets}
    actual_sheet_keys = {_component_key(name): name for name in actual_sheets}
    missing_sheets = [name for key, name in expected_sheet_keys.items() if key not in actual_sheet_keys]
    unexpected_sheets = [name for key, name in actual_sheet_keys.items() if key not in expected_sheet_keys]

    components = extracted.get("components") if isinstance(extracted, dict) else None
    components = components if isinstance(components, list) else []
    by_label: dict[str, list[dict[str, Any]]] = {}
    for component in components:
        by_label.setdefault(_component_key(component.get("label")), []).append(component)

    missing: list[str] = []
    blank: list[str] = []
    matched_ids: set[int] = set()
    for label in expected:
        candidates = by_label.get(_component_key(label)) or []
        if not candidates:
            missing.append(label)
            continue
        matched = candidates.pop(0)
        matched_ids.add(id(matched))
        if _number(matched.get("estimatedCost")) is None:
            blank.append(label)

    details = (state or {}).get("details") if isinstance((state or {}).get("details"), dict) else {}
    allowed_additional_labels: set[str] = set()
    if any(_component_key(name) == "abstract" for name in expected_sheets):
        allowed_additional_labels.update(_component_key(label) for label in COMMON_EXTERNAL_WORKS)
        custom_common = details.get("customCommonExternalWorks") if isinstance(details.get("customCommonExternalWorks"), list) else []
        allowed_additional_labels.update(
            _component_key(item.get("description")) for item in custom_common if _text(item.get("description"))
        )
    unexpected_components = [
        _text(component.get("label"))
        for component in components
        if id(component) not in matched_ids
        and _component_key(component.get("label")) not in allowed_additional_labels
    ]

    messages = []
    if missing_sheets:
        messages.append(f"Missing worksheets: {', '.join(missing_sheets)}.")
    if unexpected_sheets:
        messages.append(f"Unexpected worksheets: {', '.join(unexpected_sheets)}. Remove worksheets that are not part of the configured estimate.")
    if missing:
        messages.append(f"Missing components: {', '.join(missing)}.")
    if unexpected_components:
        messages.append(f"Unexpected components: {', '.join(unexpected_components)}. The uploaded workbook must match the configured component list.")
    if blank:
        messages.append(f"Final value missing for: {', '.join(blank)}.")
    if messages:
        raise ValueError(" ".join(messages))

    numeric_components = [
        {**component, "estimatedCost": _number(component.get("estimatedCost"))}
        for component in components
        if _number(component.get("estimatedCost")) is not None
    ]
    if not numeric_components:
        raise ValueError("The uploaded workbook does not contain any readable component final values.")
    return {
        "components": numeric_components,
        "totalEstimatedCost": _number((extracted or {}).get("totalEstimatedCost"))
        if _number((extracted or {}).get("totalEstimatedCost")) is not None
        else sum(item["estimatedCost"] for item in numeric_components),
    }
