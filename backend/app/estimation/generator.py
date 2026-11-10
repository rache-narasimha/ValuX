"""Generate estimation workbooks from the approved XLSX masters.

The browser prototype remains the source of the form-state contract.  This
module is deliberately independent of the prototype's JavaScript spreadsheet
runtime: production generation uses only Python and openpyxl, and copies the
already-approved worksheets instead of attempting to redraw them.
"""

from __future__ import annotations

import json
import math
import re
from copy import copy
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, localcontext
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Sequence

from openpyxl import load_workbook
from openpyxl.formula import Tokenizer
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.utils import range_boundaries
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.worksheet import Worksheet
from openpyxl.worksheet.views import Selection

from .presentation import abstract_description, applicant_text, compact_abstract, component_labels, component_work, industrial_centre_line, modern_identity, work_text


RESOURCE_DIRECTORY = Path(__file__).resolve().parents[3] / "resources" / "estimation"
MASTER_PATH = RESOURCE_DIRECTORY / "estimation_detail_masters.xlsx"
MANIFEST_PATH = RESOURCE_DIRECTORY / "estimation_manifest.json"

COMMON_EXTERNAL_WORKS = (
    "Water Supply and Sanitary Works",
    "Electrical Works",
    "Site Clearance and Land Development",
    "External Pavements and Internal Roads",
    "Fire-Fighting System",
    "Rainwater Harvesting",
    "Boundary Wall and Gates",
    "Plan Approval and Permission Charges",
    "Tools and Plant Charges",
    "Supervision Charges",
    "Contingencies and Miscellaneous Works",
)

INVALID_SHEET_CHARACTERS = re.compile(r"[\\/?*\[\]:]")
NON_FILE_CHARACTERS = re.compile(r"[^a-z0-9_-]+", re.IGNORECASE)
NON_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")
ROOM_SCHEDULE_ANCHORS = {
    "ceiling-inside": ("ceiling", "three_factor_fgh"),
    "plaster-gross": ("plaster", "three_factor_fgi"),
    "plaster-space-6": ("plaster", "three_factor_fgi"),
}
DETAIL_CELL_REFERENCE = re.compile(r"(\$?[A-Z]+\$?)([1-9][0-9]*)")

PALE_GREEN = "E2F0D9"
PALE_BLUE = "DDEBF7"
YELLOW = "FFF200"
WHITE = "FFFFFF"
BLACK = "000000"
INPUT_BLUE = "0070C0"

THIN = Side(style="thin", color=BLACK)
MEDIUM = Side(style="medium", color=BLACK)
THIN_ALL = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MEDIUM_ALL = Border(left=MEDIUM, right=MEDIUM, top=MEDIUM, bottom=MEDIUM)


@dataclass(frozen=True)
class GeneratedEstimationWorkbook:
    """An XLSX result ready to save, upload, or return from an HTTP route."""

    content: bytes
    file_name: str
    sheet_names: tuple[str, ...]

    def save(self, destination: str | Path) -> Path:
        target = Path(destination)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.content)
        return target


@dataclass
class DetailSpec:
    name: str
    component_name: str
    template_key: str
    form_data: MutableMapping[str, Any]
    work_description: str = ""
    first_sheet: bool = True
    floor_label: str = ""
    abstract_label: str = ""
    floor_multiplier: int = 1


@dataclass
class DetailResult:
    sheet_name: str
    total_row: int
    estimated_row: int
    words_row: int
    last_row: int
    compact_abstract_words_row: int | None = None

    @property
    def estimated_cell(self) -> str:
        return f"L{self.estimated_row}"


def _load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _numeric(value: Any) -> float | int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def _displayed_price(quantity: float, rate: float) -> float:
    with localcontext() as context:
        context.prec = 640
        cents = Decimal("0.01")
        displayed_quantity = Decimal(str(quantity)).quantize(cents, rounding=ROUND_HALF_UP)
        displayed_rate = Decimal(str(rate)).quantize(cents, rounding=ROUND_HALF_UP)
        return float((displayed_quantity * displayed_rate).quantize(cents, rounding=ROUND_HALF_UP))


def _normalised_text(value: Any) -> str:
    return NON_ALPHANUMERIC.sub("", str(value or "").lower())


def _clean_sheet_name(value: Any, used: set[str]) -> str:
    base = INVALID_SHEET_CHARACTERS.sub(" ", str(value or "Estimate"))
    base = re.sub(r"\s+", " ", base).strip()[:31].strip() or "Estimate"
    name = base
    counter = 2
    while name.lower() in used:
        suffix = f" ({counter})"
        counter += 1
        name = f"{base[: 31 - len(suffix)]}{suffix}"
    used.add(name.lower())
    return name


def _spreadsheet_name(value: Any) -> str:
    name = NON_FILE_CHARACTERS.sub("_", str(value or "Estimation_Report"))
    return name.strip("_") or "Estimation_Report"


def _component_sheet_entries(state: Mapping[str, Any]) -> list[tuple[Mapping[str, Any], Mapping[str, Any] | None, MutableMapping[str, Any]]]:
    entries = []
    for component in state.get("components") or []:
        sheets = component.get("sheets") or []
        if sheets:
            for sheet in sorted(sheets, key=lambda item: float(item.get("level") or 0)):
                entries.append((component, sheet, sheet.get("formData") or {}))
        else:
            entries.append((component, None, component.get("formData") or {}))
    return entries


def _template_key(state: Mapping[str, Any], component: Mapping[str, Any], sheet: Mapping[str, Any] | None) -> str | None:
    kind = component.get("kind")
    property_type = state.get("propertyType")
    sheet_key = (sheet or {}).get("key")
    level = float((sheet or {}).get("level") or 0)
    centre_line = (state.get("details") or {}).get("measurementMethod") == "centre_line"
    suffix = "_centre_line" if centre_line else ""
    above_foundation = bool(sheet and sheet.get("layoutVersion") == 2 and any(
        float(other.get("level") or 0) < level for other in component.get("sheets") or []
    ))

    if kind == "storage_shed":
        return "storage_shed"
    if kind == "heavy_machinery_hall":
        return "heavy_machinery_hall"
    if kind == "normal_machinery_hall":
        return "normal_machinery_hall"
    if kind == "shed_hall":
        return "commercial_shed_hall"
    if property_type == "industrial" and kind in {"rcc_building", "office_amenity", "utility_structure"}:
        if above_foundation:
            return "rcc_upper"
        if sheet_key == "cellar":
            return "industrial_cellar"
        if sheet_key == "stilt":
            return "industrial_stilt"
        return "rcc_upper" if level > 1 else "rcc_ground"
    if property_type == "commercial" and kind == "rcc_building":
        if above_foundation:
            return f"commercial_rcc_upper{suffix}"
        if sheet_key == "cellar":
            return f"commercial_rcc_cellar{suffix}"
        if sheet_key == "stilt":
            return f"commercial_rcc_stilt{suffix}"
        return f"commercial_rcc_upper{suffix}" if level > 1 else f"commercial_rcc_ground{suffix}"
    if kind == "residential_building":
        if above_foundation:
            return f"residential_upper{suffix}"
        if sheet_key == "cellar":
            return f"residential_cellar{suffix}"
        if sheet_key == "stilt":
            return f"residential_stilt{suffix}"
        return f"residential_upper{suffix}" if level > 1 else f"residential_ground{suffix}"
    return None


def _detail_specs(state: Mapping[str, Any], manifest: Mapping[str, Any]) -> list[DetailSpec]:
    used_names: set[str] = set()
    specs: list[DetailSpec] = []
    for record in component_labels(state):
        component, sheet = record["component"], record["sheet"]
        form_data = (sheet or component).get("formData") or {}
        key = _template_key(state, component, sheet)
        if not key or key not in manifest["templates"]:
            continue
        component_name = record["label"]
        typical = sheet and len(sheet.get("typicalFloorKeys") or []) > 1
        name = _clean_sheet_name(component_name if modern_identity(state.get("details") or {}) else sheet.get("label") if typical else component_name, used_names)
        multiplier = len(sheet["typicalFloorKeys"]) if typical and sheet.get("typicalBasis") == "per-floor" else 1
        specs.append(DetailSpec(
            name, component_name, key, form_data, component_work(component), record["first"],
            (sheet or {}).get("label", ""), abstract_description(state, component, sheet, component_name), multiplier,
        ))
    if not specs:
        raise ValueError("Select at least one supported component before preparing a workbook.")
    return specs


def _uses_separate_abstract(state: Mapping[str, Any]) -> bool:
    return not compact_abstract(state)


def expected_estimation_sheet_names(state: Mapping[str, Any]) -> tuple[str, ...]:
    """Return the canonical worksheet topology for a configured estimation."""
    specs = _detail_specs(state, _load_manifest())
    detail_names = tuple(spec.name for spec in specs)
    return ("Abstract", *detail_names) if _uses_separate_abstract(state) else detail_names


def _find_label_row(ws: Worksheet, label: str, column: int = 1) -> int:
    for row in range(1, ws.max_row + 1):
        if str(ws.cell(row, column).value or "").strip() == label:
            return row
    raise ValueError(f"{ws.title}: required row {label!r} was not found")


def _detail_result(ws: Worksheet) -> DetailResult:
    total = _find_label_row(ws, "TOTAL CALCULATED COST")
    estimated = _find_label_row(ws, "ESTIMATED COST (Rs.)")
    words = estimated + 1
    date_rows = [row for row in range(words + 1, ws.max_row + 1) if str(ws.cell(row, 1).value or "").startswith("Date :")]
    return DetailResult(ws.title, total, estimated, words, date_rows[-1] if date_rows else words)


def _copy_template_sheets(workbook, specs: Sequence[DetailSpec], manifest: Mapping[str, Any], separate_abstract: bool) -> dict[str, Worksheet]:
    pending: list[tuple[DetailSpec, Worksheet]] = []
    for index, spec in enumerate(specs, 1):
        source = workbook[manifest["templates"][spec.template_key]]
        copied = workbook.copy_worksheet(source)
        copied.title = f"__output_{index:03d}"
        copied.freeze_panes = source.freeze_panes
        copied.sheet_view.showGridLines = source.sheet_view.showGridLines
        pending.append((spec, copied))
    for sheet_name in list(workbook.sheetnames):
        if sheet_name == "Abstract" and separate_abstract:
            continue
        if not sheet_name.startswith("__output_"):
            del workbook[sheet_name]
    copies: dict[str, Worksheet] = {}
    for spec, copied in pending:
        copied.title = spec.name
        copies[spec.name] = copied
    if separate_abstract:
        workbook._sheets = [workbook["Abstract"], *(copies[spec.name] for spec in specs)]
    else:
        workbook._sheets = [copies[spec.name] for spec in specs]
    return copies


def _direct_quantity(inputs: Mapping[str, Any]) -> float | int | None:
    direct = _numeric(inputs.get("directQuantity"))
    return direct if direct is not None else _numeric(inputs.get("setupQuantity"))


def _set_numeric_inputs(ws: Worksheet, row: int, values: Mapping[str, Any] | None) -> None:
    if not values:
        return
    columns = {"no": "F", "length": "G", "breadth": "H", "depth": "I", "quantity": "J", "rate": "K", "amount": "L"}
    for field, column in columns.items():
        value = _numeric(values.get(field))
        if value is not None:
            ws[f"{column}{row}"] = value
    quantity = _direct_quantity(values)
    if quantity is not None:
        ws.cell(row, 10).value = quantity


def _copy_standard_inputs(
    ws: Worksheet, spec: DetailSpec, manifest: Mapping[str, Any], result: DetailResult
) -> tuple[dict[tuple[int, str], int], dict[int, int]]:
    rows = spec.form_data.get("rows") or {}
    schema_items = manifest["worksheets"][spec.template_key]["items"]
    last_data_row = result.total_row - 1
    starts = []
    for row in range(17, last_data_row + 1):
        serial = _numeric(ws.cell(row, 1).value)
        if serial is not None:
            starts.append((row, serial))

    search_from = 17
    row_map: dict[tuple[int, str], int] = {}
    item_starts: dict[int, int] = {}
    for item_index, item in enumerate(schema_items):
        start = None
        if item.get("sno") is not None:
            start = next((row for row, serial in starts if row >= search_from and serial == item["sno"]), None)
        if start is None:
            expected = _normalised_text(item.get("label"))
            if any(line.get("id") == "truss-lean" for line in item.get("rows") or []):
                expected = _normalised_text("Angular Trusses Lean to Roof Type")
            for row in range(search_from, last_data_row + 1):
                candidate = _normalised_text(ws.cell(row, 2).value)
                if candidate and (candidate in expected or expected in candidate):
                    start = row
                    break
        if start is None:
            continue
        item_starts[item_index] = start
        next_start = next((row for row, _ in starts if row > start), last_data_row + 1)
        cursor = start
        input_rows = [line for line in item.get("rows") or [] if line.get("calculation") != "heading"]
        for line in input_rows:
            target = None
            expected = _normalised_text(line.get("label"))
            for row in range(cursor, next_start):
                candidate = _normalised_text(ws.cell(row, 2).value)
                if line.get("id") == "waterproofing-roof":
                    # The specification heading also contains “over roof slab”.
                    if candidate == expected:
                        target = row
                        break
                    continue
                if candidate and (candidate in expected or expected in candidate):
                    target = row
                    break
            if target is None and (len(input_rows) == 1 or line.get("id") == "plaster-gross"):
                target = start
            if target is None and line.get("calculation") in {"subtotal", "percentage", "derived", "derived_expression"} and cursor < next_start:
                target = cursor
            if target is None:
                continue
            row_map[(item_index, str(line.get("id")))] = target
            _set_numeric_inputs(ws, target, rows.get(line.get("id")))
            cursor = target + 1
        search_from = start + 1
    return row_map, item_starts


def _configured_line(line: Mapping[str, Any], inputs: Mapping[str, Any], storage: bool) -> dict[str, Any]:
    identifier = str(line.get("id") or "")
    result = dict(line)
    factor = _numeric(inputs.get("factor"))
    if storage and identifier == "brick-net":
        factor = 1
    if factor is not None and line.get("calculation") == "percentage":
        result["percentage"] = factor
    if identifier in {"galvalume-roofing", "heavy-foundation"} and _numeric(inputs.get("quantity")) is not None:
        result.update(calculation="manual_quantity_rate", rate=True)
    return result


def _storage_hidden(line: Mapping[str, Any]) -> bool:
    identifier = str(line.get("id") or "")
    return identifier == "truss-a" or identifier.endswith("-short")


def _custom_additions(spec: DetailSpec, manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    additions = []
    form_data = spec.form_data
    items = manifest["worksheets"][spec.template_key]["items"]
    for index, item in enumerate(items):
        item_key = f"standard-{index}"
        for custom in (form_data.get("customItems") or {}).get(item_key, []):
            custom_id = custom.get("id")
            lines = []
            source_lines = item.get("rows") or []
            single_measurement = sum(line.get("calculation") != "heading" for line in source_lines) == 1
            for line in source_lines:
                line = dict(line)
                if line.get("label") == item.get("label") or (single_measurement and line.get("calculation") != "heading"):
                    line["label"] = (custom.get("shortDescription") or "").strip() or "Custom item"
                line["id"] = f"{custom_id}:{line.get('id')}"
                line["values"] = (form_data.get("rows") or {}).get(line["id"], {})
                lines.append(line)
            additions.append({
                "description": custom.get("detailedDescription") or custom.get("shortDescription") or f"Custom: {item.get('label')}",
                "lines": lines,
            })
        if (form_data.get("omittedItems") or {}).get(item_key):
            continue
        for line in item.get("rows") or []:
            base_id = line.get("id")
            user_rows = (form_data.get("customRows") or {}).get(base_id, [])
            setup_rows = ((form_data.get("dimensionSetup") or {}).get("additions") or {}).get(base_id, [])
            # Shared room measurements belong in the corresponding plastering item.
            if base_id in ROOM_SCHEDULE_ANCHORS:
                setup_rows = []
            for custom in [*user_rows, *setup_rows]:
                custom_line = dict(line)
                custom_line.update({
                    "id": custom.get("id"),
                    "label": custom.get("label") or f"Custom: {line.get('label')}",
                    "values": (form_data.get("rows") or {}).get(custom.get("id"), {}),
                })
                source = "Measurement" if custom in setup_rows else "Custom measurement"
                additions.append({"description": f"{source} under {item.get('label')}", "lines": [custom_line]})
                additions[-1]["originItemIndex"] = index
                additions[-1]["originLineId"] = line.get("id")
    return additions


def _prepared_calculation_items(spec: DetailSpec, manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    data = spec.form_data
    prepared = []
    for index, base in enumerate(manifest["worksheets"][spec.template_key]["items"]):
        item_key = f"standard-{index}"
        if not (data.get("omittedItems") or {}).get(item_key):
            prepared.append({**base, "itemKey": item_key})
        for custom in (data.get("customItems") or {}).get(item_key, []):
            prepared.append({
                **base,
                "itemKey": custom.get("id"),
                "instanceKey": custom.get("id"),
            })
    return prepared


def _calculation_rows(item: Mapping[str, Any], data: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows = []
    instance_key = item.get("instanceKey")

    def scoped(identifier: Any) -> str:
        return f"{instance_key}:{identifier}" if instance_key else str(identifier)

    for base in item.get("rows") or []:
        base_id = scoped(base.get("id"))
        if data.get("storageWorksheet") and _storage_hidden(base):
            continue
        inputs = (data.get("rows") or {}).get(base_id, {})
        if not inputs.get("setupOmitted"):
            effective = _configured_line(base, inputs, bool(data.get("storageWorksheet")))
            rows.append({
                **effective,
                "instanceId": base_id,
                "baseId": base_id,
                "sourceId": scoped(base.get("sourceId")) if base.get("sourceId") else None,
                "itemKey": item.get("itemKey"),
            })
        user_rows = (data.get("customRows") or {}).get(base_id, [])
        setup_rows = ((data.get("dimensionSetup") or {}).get("additions") or {}).get(base_id, [])
        for custom in [*user_rows, *setup_rows]:
            rows.append({
                **base,
                "id": custom.get("id"),
                "instanceId": custom.get("id"),
                "baseId": base_id,
                "sourceId": scoped(base.get("sourceId")) if base.get("sourceId") else None,
                "itemKey": item.get("itemKey"),
            })
    return rows


def _calculated_sheet_amount(spec: DetailSpec, manifest: Mapping[str, Any]) -> float:
    """Mirror the browser calculation model for words and Abstract totals."""

    data = {**spec.form_data, "storageWorksheet": spec.template_key == "storage_shed"}
    items = _prepared_calculation_items(spec, manifest)
    prepared = [(item, _calculation_rows(item, data)) for item in items]
    rows = [row for _, item_rows in prepared for row in item_rows]
    values = {str(row.get("instanceId")): {"quantity": None, "amount": None} for row in rows}

    def direct(row: Mapping[str, Any]) -> Mapping[str, Any]:
        return (data.get("rows") or {}).get(row.get("instanceId"), {})

    def product(parts: Sequence[Any]) -> float | None:
        numbers = [_numeric(part) for part in parts]
        if any(number is None for number in numbers):
            return None
        result = 1.0
        for number in numbers:
            result *= float(number)
        return result

    def group_rows(entry: Mapping[str, Any], group: Any) -> list[Mapping[str, Any]]:
        return [candidate for candidate in rows if candidate.get("itemKey") == entry.get("itemKey") and candidate.get("group") == group]

    def group_values(entry: Mapping[str, Any], group: Any) -> list[float]:
        return [
            float(values[str(candidate.get("instanceId"))]["quantity"])
            for candidate in group_rows(entry, group)
            if values[str(candidate.get("instanceId"))]["quantity"] is not None
        ]

    for row in rows:
        inputs = direct(row)
        calculation = row.get("calculation")
        quantity = None
        if calculation == "standard_4_factor":
            quantity = product((inputs.get("no"), inputs.get("length"), inputs.get("breadth"), inputs.get("depth")))
        elif calculation == "three_factor_fgh":
            quantity = product((inputs.get("no"), inputs.get("length"), inputs.get("breadth")))
        elif calculation == "three_factor_fgi":
            quantity = product((inputs.get("no"), inputs.get("length"), inputs.get("depth")))
        elif calculation == "count_rate":
            quantity = _numeric(inputs.get("no"))
        elif calculation == "manual_quantity_rate":
            quantity = _numeric(inputs.get("quantity"))
        elif calculation == "lump_sum":
            values[str(row.get("instanceId"))]["amount"] = _numeric(inputs.get("amount"))
        values[str(row.get("instanceId"))]["quantity"] = quantity

    for _ in range(8):
        for row in rows:
            inputs = direct(row)
            calculation = row.get("calculation")
            key = str(row.get("instanceId"))
            quantity = values[key]["quantity"]
            if calculation in {"derived", "derived_expression"}:
                entered = _numeric(inputs.get("quantity"))
                source = values.get(str(row.get("sourceId")), {}).get("quantity")
                factor = _numeric(inputs.get("factor"))
                if factor is None:
                    factor = 10 if calculation == "derived_expression" else float(row.get("multiplier") or 0)
                quantity = entered if entered is not None else (None if source is None else float(source) * factor)
            elif calculation == "subtotal":
                sources = group_values(row, row.get("sourceGroup"))
                quantity = sum(sources) if sources else None
            elif calculation == "percentage":
                source_groups = row.get("includeSourceGroups") or [row.get("sourceGroup")]
                sources = [value for group in source_groups for value in group_values(row, group)]
                quantity = sum(sources) * float(row.get("percentage") or 0) if sources else None
            direct_quantity = _direct_quantity(inputs)
            if direct_quantity is not None and calculation not in {"heading", "lump_sum"}:
                quantity = direct_quantity
            values[key]["quantity"] = quantity

    for row in rows:
        if row.get("rate"):
            rate = _numeric(direct(row).get("rate"))
            value = values[str(row.get("instanceId"))]
            quantity = value["quantity"]
            value["amount"] = None if quantity is None or rate is None else _displayed_price(quantity, rate)

    total = 0.0
    for item, item_rows in prepared:
        calculated = sum(float(values[str(row.get("instanceId"))]["amount"] or 0) for row in item_rows)
        override = _numeric((data.get("itemOverrides") or {}).get(item.get("itemKey")))
        total += float(override) if override is not None else calculated
    sheet_override = _numeric(data.get("sheetTotalOverride"))
    return float(sheet_override) if sheet_override is not None else total * spec.floor_multiplier


def _effective_final_amount(spec: DetailSpec, manifest: Mapping[str, Any]) -> float | int:
    final_amount = _numeric(spec.form_data.get("finalAmount"))
    if final_amount is not None and not spec.form_data.get("omittedItems"):
        return final_amount
    return _calculated_sheet_amount(spec, manifest)


def _alignment_with(cell, **changes: Any):
    alignment = copy(cell.alignment)
    for name, value in changes.items():
        setattr(alignment, name, value)
    return alignment


def _merge_description(ws: Worksheet, row: int, value: Any, start_column: str = "B", end_column: str = "E") -> None:
    ws.merge_cells(f"{start_column}{row}:{end_column}{row}")
    ws[f"{start_column}{row}"] = value


def _style_table_row(ws: Worksheet, row: int, description: str, *, fill: str = WHITE, bold: bool = False) -> None:
    _merge_description(ws, row, description)
    for column in range(1, 13):
        cell = ws.cell(row, column)
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.font = Font(name="Arial", size=10, bold=bold, color=BLACK)
        cell.border = THIN_ALL
        cell.alignment = _alignment_with(
            cell,
            vertical="center",
            wrap_text=column in range(2, 6),
            horizontal="right" if column >= 6 else ("center" if column == 1 else None),
        )
    ws.row_dimensions[row].height = min(126, max(28 if bold else 21, math.ceil(len(str(description or "")) / 72) * 18))
    for column in range(6, 11):
        ws.cell(row, column).number_format = "0.00"
    for column in (11, 12):
        ws.cell(row, column).number_format = "#,##0.00"


def _insert_rows_preserving_merges(ws: Worksheet, index: int, amount: int) -> None:
    affected = []
    for merged in list(ws.merged_cells.ranges):
        min_col, min_row, max_col, max_row = range_boundaries(str(merged))
        if min_row >= index:
            affected.append((str(merged), min_col, min_row, max_col, max_row))
    for address, *_ in affected:
        ws.unmerge_cells(address)
    dimensions = {row: copy(dimension) for row, dimension in ws.row_dimensions.items() if row >= index}
    for row in dimensions:
        del ws.row_dimensions[row]
    ws.insert_rows(index, amount)
    for row, dimension in sorted(dimensions.items(), reverse=True):
        dimension.index = row + amount
        ws.row_dimensions[row + amount] = dimension
    for _, min_col, min_row, max_col, max_row in affected:
        ws.merge_cells(
            start_row=min_row + amount,
            start_column=min_col,
            end_row=max_row + amount,
            end_column=max_col,
        )


def _append_custom_additions(
    ws: Worksheet, result: DetailResult, additions: Sequence[Mapping[str, Any]]
) -> dict[tuple[int, str], list[int]]:
    if not additions:
        return {}
    row_count = 1 + sum(1 + len(addition.get("lines") or []) for addition in additions)
    insertion = result.total_row
    _insert_rows_preserving_merges(ws, insertion, row_count)

    section_row = insertion
    ws.merge_cells(start_row=section_row, start_column=1, end_row=section_row, end_column=12)
    ws.cell(section_row, 1).value = "CUSTOM ITEMS / MEASUREMENTS"
    for column in range(1, 13):
        cell = ws.cell(section_row, column)
        cell.fill = PatternFill("solid", fgColor=PALE_BLUE)
        cell.font = Font(name="Arial", size=10, bold=True, color=BLACK)
        cell.border = MEDIUM_ALL
    ws.row_dimensions[section_row].height = 24

    cursor = section_row + 1
    custom_group_rows: dict[tuple[int, str], list[int]] = {}
    for addition in additions:
        _style_table_row(ws, cursor, str(addition.get("description") or "Custom item"), fill=PALE_GREEN, bold=True)
        cursor += 1
        by_id: dict[str, int] = {}
        by_group: dict[str, list[int]] = {}
        for line in addition.get("lines") or []:
            calculation = line.get("calculation")
            if calculation == "heading":
                _style_table_row(ws, cursor, str(line.get("label") or ""), fill=PALE_BLUE, bold=True)
                cursor += 1
                continue

            row = cursor
            cursor += 1
            if calculation == "lump_sum":
                _style_table_row(ws, row, str(line.get("label") or ""), bold=True)
                for column in range(6, 11):
                    ws.cell(row, column).value = "-"
                ws.cell(row, 11).value = "LS"
                ws.cell(row, 12).font = Font(name="Arial", size=10, color=INPUT_BLUE)
            else:
                _style_table_row(ws, row, str(line.get("label") or ""), bold=True)
                quantity_formula = _custom_quantity_formula(line, row, by_id, by_group)
                if quantity_formula:
                    ws.cell(row, 10).value = quantity_formula
                if line.get("rate"):
                    ws.cell(row, 12).value = f'=IF(AND(ISNUMBER(J{row}),ISNUMBER(K{row})),J{row}*K{row},"")'
            line_id = str(line.get("id") or "")
            by_id[line_id] = row
            group = line.get("group")
            if group:
                by_group.setdefault(str(group), []).append(row)
                if addition.get("originItemIndex") is not None:
                    custom_group_rows.setdefault((int(addition["originItemIndex"]), str(group)), []).append(row)
            _set_numeric_inputs(ws, row, line.get("values") or {})

    result.total_row += row_count
    result.estimated_row += row_count
    result.words_row += row_count
    result.last_row += row_count
    return custom_group_rows


def _repair_standard_aggregate_formulas(
    ws: Worksheet,
    spec: DetailSpec,
    manifest: Mapping[str, Any],
    row_map: Mapping[tuple[int, str], int],
    custom_group_rows: Mapping[tuple[int, str], list[int]],
) -> None:
    for item_index, item in enumerate(manifest["worksheets"][spec.template_key]["items"]):
        storage = spec.template_key == "storage_shed"
        inputs = spec.form_data.get("rows") or {}
        has_custom = any(index == item_index for index, _ in custom_group_rows)
        grouped: dict[str, list[int]] = {}
        for base in item.get("rows") or []:
            identifier = str(base.get("id"))
            target = row_map.get((item_index, identifier))
            if target is None or (storage and _storage_hidden(base)):
                continue
            line = _configured_line(base, inputs.get(identifier, {}), storage)
            group = line.get("group")
            if group:
                grouped.setdefault(str(group), []).append(target)
                grouped[str(group)].extend(custom_group_rows.get((item_index, str(group)), []))
                grouped[str(group)] = list(dict.fromkeys(grouped[str(group)]))
            calculation = line.get("calculation")
            factor_changed = line.get("percentage") != base.get("percentage")
            if calculation not in {"subtotal", "percentage"} or not (has_custom or factor_changed):
                continue
            groups = line.get("includeSourceGroups") or [line.get("sourceGroup")]
            sources = [source for group_name in groups if group_name for source in grouped.get(str(group_name), [])]
            if not sources:
                continue
            references = ",".join(f"J{source}" for source in sources)
            if calculation == "subtotal":
                ws.cell(target, 10).value = f'=IF(COUNT({references})=0,"",SUM({references}))'
            else:
                ws.cell(target, 10).value = f'=IF(COUNT({references})=0,"",SUM({references})*{line.get("percentage")})'


def _apply_dimension_formulas(
    ws: Worksheet, spec: DetailSpec, manifest: Mapping[str, Any], row_map: Mapping[tuple[int, str], int],
) -> None:
    """Use the worksheet's mapped quantities for adjustable factors and shed measurements."""
    storage = spec.template_key == "storage_shed"
    rows = spec.form_data.get("rows") or {}
    by_id = {identifier: target for (_, identifier), target in row_map.items()}
    for index, item in enumerate(manifest["worksheets"][spec.template_key]["items"]):
        for line in item.get("rows") or []:
            identifier = line["id"]
            target = row_map.get((index, identifier))
            if target is None:
                continue
            description = ws.cell(target, 2)
            if storage:
                if _storage_hidden(line):
                    ws.row_dimensions[target].hidden = True
                    continue
                if identifier.endswith("-long"):
                    description.value = {
                        "brick-long": "Measured brickwork run",
                        "concrete-lintel-long": "Measured lintel run",
                    }.get(identifier, "All-round building")
                if identifier == "truss-lean":
                    ws.cell(target, 1).value = 14
                if identifier == "rsj-columns":
                    description.value = "RSJ columns (ISLB 200)"
                if identifier == "flooring":
                    description.value = str(description.value).replace("0.3m thick", "0.15 m thick")
                if identifier == "filling-basement":
                    label = ws.cell(target - 1, 2)
                    label.value = str(label.value).replace("gravel", "sand")
            inputs = rows.get(identifier, {})
            if inputs.get("setupOmitted"):
                for column in range(6, 13):
                    ws.cell(target, column).value = None
                if identifier != "plaster-gross":
                    ws.row_dimensions[target].hidden = True
                continue
            if inputs.get("setupLabel"):
                description.value = str(inputs["setupLabel"])
                description.data_type = "s"
            factor = _numeric(inputs.get("factor"))
            configured = _configured_line(line, inputs, storage)
            if configured.get("percentage") != line.get("percentage"):
                percent = configured["percentage"]
                if identifier == "ceiling-beams":
                    description.value = f"Add {percent * 100:g}% for beams"
                elif percent == 1:
                    description.value = "Total measured quantity"
                else:
                    description.value = f"Net with {(1 - percent) * 100:g}% deduction for openings"
            if line.get("calculation") in {"derived", "derived_expression"} and factor is not None:
                slab_depth = _numeric(inputs.get("slabDepth"))
                steel_rate = _numeric(inputs.get("steelRate"))
                slab_steel = identifier == "steel-roof-slab"
                if slab_steel and slab_depth is not None and steel_rate is not None and slab_depth * steel_rate == factor:
                    description.value = f"{line['label']} @ {steel_rate:g} kg/m³, {slab_depth:g} m thick"
                    multiplier = f"{slab_depth}*{steel_rate}"
                else:
                    description.value = f"{line['label']} @ {factor:g} {'kg/m²' if slab_steel else 'kg/m³'}"
                    multiplier = str(factor)
                source = by_id.get(line.get("sourceId"))
                if source is not None and _numeric(inputs.get("quantity")) is None:
                    ws.cell(target, 10).value = f'=IF(ISNUMBER(J{source}),J{source}*{multiplier},"")'
            if configured["calculation"] != line["calculation"] and configured["calculation"] == "manual_quantity_rate":
                ws.cell(target, 11).value = _numeric(inputs.get("rate"))
                ws.cell(target, 12).value = f'=IF(COUNT(J{target},K{target})<2,"",J{target}*K{target})'
            direct = _direct_quantity(inputs)
            if direct is not None and line.get("calculation") != "lump_sum":
                ws.cell(target, 10).value = direct


def _custom_quantity_formula(line: Mapping[str, Any], row: int, by_id: Mapping[str, int], by_group: Mapping[str, list[int]]) -> str | None:
    calculation = line.get("calculation")
    if calculation == "standard_4_factor":
        return f'=IF(COUNT(F{row},G{row},H{row},I{row})<4,"",F{row}*G{row}*H{row}*I{row})'
    if calculation == "three_factor_fgh":
        return f'=IF(COUNT(F{row},G{row},H{row})<3,"",F{row}*G{row}*H{row})'
    if calculation == "three_factor_fgi":
        return f'=IF(COUNT(F{row},G{row},I{row})<3,"",F{row}*G{row}*I{row})'
    if calculation == "count_rate":
        return f'=IF(ISNUMBER(F{row}),F{row},"")'
    if calculation == "manual_quantity_rate":
        return None
    if calculation in {"derived", "derived_expression"}:
        source = by_id.get(str(line.get("sourceId") or ""))
        if not source:
            return None
        factor = "0.125*80" if calculation == "derived_expression" else str(line.get("multiplier"))
        return f'=IF(ISNUMBER(J{source}),J{source}*{factor},"")'
    groups = line.get("includeSourceGroups") or [line.get("sourceGroup")]
    sources = [source for group in groups if group for source in by_group.get(str(group), [])]
    if not sources:
        return None
    references = ",".join(f"J{source}" for source in sources)
    if calculation == "subtotal":
        return f'=IF(COUNT({references})=0,"",SUM({references}))'
    if calculation == "percentage":
        return f'=IF(COUNT({references})=0,"",SUM({references})*{line.get("percentage")})'
    return None


def _formula_amount_rows(ws: Worksheet, before_row: int) -> list[int]:
    rows = []
    for row in range(17, before_row):
        value = ws.cell(row, 12).value
        if (value is not None and value != "") or str(ws.cell(row, 11).value or "").upper() == "LS":
            rows.append(row)
    return rows


def _use_displayed_prices(ws: Worksheet, result: DetailResult) -> None:
    for row in _formula_amount_rows(ws, result.total_row):
        cell = ws.cell(row, 12)
        if cell.data_type != "f":
            continue
        # Keep template blank guards, using the Qty override for count-rate rows when present.
        quantity, count, rate = f"J{row}", f"F{row}", f"K{row}"
        formula = cell.value
        if f"{count}*{rate}" in formula:
            if _numeric(ws[quantity].value) is not None:
                formula = formula.replace(f"ISNUMBER({count})", f"ISNUMBER({quantity})")
                formula = formula.replace(f"{count}*{rate}", f"{quantity}*{rate}")
            else:
                quantity = count
        cell.value = formula.replace(f"{quantity}*{rate}", f"ROUND(ROUND({quantity},2)*ROUND({rate},2),2)")


def _remap_detail_formula(formula: str, row_map: Mapping[int, int]) -> str:
    """Update local A1 references without touching quoted report text."""
    tokens = Tokenizer(formula)
    for token in tokens.items:
        if token.subtype != "RANGE":
            continue
        refs = [DETAIL_CELL_REFERENCE.fullmatch(part) for part in token.value.split(":")]
        if not all(refs) or len(refs) > 2:
            continue
        start, end = int(refs[0][2]), int(refs[-1][2])
        retained = [row_map[row] for row in range(start, end + 1) if row in row_map]
        if not retained:
            # An empty cell keeps COUNT, SUM and ISNUMBER guards working when
            # their source item is removed.
            token.value = "$XFD$1"
        elif len(refs) == 1:
            token.value = f"{refs[0][1]}{retained[0]}"
        else:
            token.value = f"{refs[0][1]}{retained[0]}:{refs[1][1]}{retained[-1]}"
    return tokens.render()


def _insert_scheduled_rooms(
    ws: Worksheet,
    spec: DetailSpec,
    result: DetailResult,
    row_map: dict[tuple[int, str], int],
    item_starts: dict[int, int],
    anchor_id: str,
) -> dict[tuple[int, str], list[int]]:
    setup = spec.form_data.get("dimensionSetup") or {}
    rooms = (setup.get("additions") or {}).get(anchor_id, [])
    if not rooms:
        return {}
    anchor = next(((index, row) for (index, key), row in row_map.items() if key == anchor_id), None)
    if anchor is None:
        return {}
    index, anchor_row = anchor
    if (spec.form_data.get("omittedItems") or {}).get(f"standard-{index}"):
        return {}
    first = anchor_row + 1
    amount = len(rooms)
    positions = {row: row + amount if row >= first else row for row in range(1, ws.max_row + 1)}
    for cells in ws.iter_rows():
        for cell in cells:
            if cell.data_type == "f":
                cell.value = _remap_detail_formula(cell.value, positions)
    _insert_rows_preserving_merges(ws, first, amount)
    for key, row in row_map.items():
        row_map[key] = positions[row]
    for key, row in item_starts.items():
        item_starts[key] = positions[row]
    result.total_row = positions[result.total_row]
    result.estimated_row = positions[result.estimated_row]
    result.words_row = positions[result.words_row]
    result.last_row = positions[result.last_row]

    group, calculation = ROOM_SCHEDULE_ANCHORS[anchor_id]
    inputs = spec.form_data.get("rows") or {}
    for row, room in enumerate(rooms, first):
        _style_table_row(ws, row, str(room["label"]))
        ws.cell(row, 2).data_type = "s"
        ws.cell(row, 10).value = _custom_quantity_formula({"calculation": calculation}, row, {}, {})
        _set_numeric_inputs(ws, row, inputs.get(room["id"], {}))
    return {(index, group): list(range(first, first + amount))}


def _remove_standard_items(
    ws: Worksheet,
    spec: DetailSpec,
    result: DetailResult,
    item_starts: Mapping[int, int],
    standard_end: int,
) -> None:
    omitted = spec.form_data.get("omittedItems") or {}
    if not omitted:
        return
    # Include template-only numbered blocks in the boundary list so omitting
    # the item above one never removes that separate block.
    boundaries = sorted({*item_starts.values(), standard_end, *(
        row for row in range(17, standard_end) if _numeric(ws.cell(row, 1).value) is not None
    )})
    ends = dict(zip(boundaries, boundaries[1:]))
    blocks = sorted(
        (start, ends[start]) for index, start in item_starts.items()
        if omitted.get(f"standard-{index}")
    )
    if not blocks:
        return
    removed = {row for start, end in blocks for row in range(start, end)}
    retained = [row for row in range(1, ws.max_row + 1) if row not in removed]
    row_map = {old: new for new, old in enumerate(retained, 1)}
    first_changed = blocks[0][0]

    for row in ws.iter_rows():
        for cell in row:
            if cell.row in row_map and cell.data_type == "f":
                cell.value = _remap_detail_formula(cell.value, row_map)

    merges = [merge for merge in ws.merged_cells.ranges if merge.max_row >= first_changed]
    for merge in merges:
        ws.unmerge_cells(str(merge))
    dimensions = {row: dimension for row, dimension in ws.row_dimensions.items() if row >= first_changed}
    for row in dimensions:
        del ws.row_dimensions[row]
    for start, end in reversed(blocks):
        ws.delete_rows(start, end - start)
    for row, dimension in dimensions.items():
        if row in row_map:
            dimension.index = row_map[row]
            ws.row_dimensions[row_map[row]] = dimension
    for merge in merges:
        surviving = [row_map[row] for row in range(merge.min_row, merge.max_row + 1) if row in row_map]
        if surviving:
            ws.merge_cells(start_row=surviving[0], end_row=surviving[-1],
                           start_column=merge.min_col, end_column=merge.max_col)

    serial = 0
    for row in range(17, row_map[standard_end]):
        cell = ws.cell(row, 1)
        if _numeric(cell.value) is not None and not ws.row_dimensions[row].hidden:
            serial += 1
            cell.value = serial
    result.total_row = row_map[result.total_row]
    result.estimated_row = row_map[result.estimated_row]
    result.words_row = row_map[result.words_row]
    result.last_row = row_map[result.last_row]


def _group_detail_amounts(ws: Worksheet, result: DetailResult, multiplier: int) -> None:
    ws["L16"].value = f"Group amount (Rs.) × {multiplier}"
    for row in _formula_amount_rows(ws, result.total_row):
        cell = ws.cell(row, 12)
        if cell.data_type == "f":
            # A blank rate leaves the amount blank rather than producing a spreadsheet error.
            formula = cell.value[1:]
            cell.value = f'=IF(ISNUMBER({formula}),({formula})*{multiplier},"")'
        elif _numeric(cell.value) is not None:
            cell.value = f"={cell.value}*{multiplier}"


def _repair_detail_totals(ws: Worksheet, result: DetailResult) -> None:
    amount_rows = _formula_amount_rows(ws, result.total_row)
    references = ",".join(f"L{row}" for row in amount_rows)
    ws.cell(result.total_row, 12).value = f'=IF(COUNT({references})=0,"",SUM({references}))' if references else '=""'
    ws.cell(result.estimated_row, 12).value = f'=IF(COUNT(L{result.total_row})=0,"",L{result.total_row})'
    ws["L14"] = f'=IF(COUNT(L{result.estimated_row})=0,"",L{result.estimated_row})'
    ws.cell(result.words_row, 12).value = f'=IF(COUNT(L{result.estimated_row})=0,"",L{result.estimated_row})'


def _amount_in_words(value: Any) -> str:
    amount = _numeric(value)
    if amount is None:
        return ""
    remaining = round(float(amount))
    if remaining == 0:
        return "Zero"
    parts = []
    for divisor, label in ((10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand")):
        if remaining >= divisor:
            parts.extend((_words_under_thousand(remaining // divisor), label))
            remaining %= divisor
    if remaining:
        parts.append(_words_under_thousand(remaining))
    return " ".join(part for part in parts if part)


def _words_under_thousand(value: int) -> str:
    ones = ("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen")
    tens = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")
    parts = []
    if value >= 100:
        parts.extend((ones[value // 100], "Hundred"))
        value %= 100
    if value >= 20:
        parts.append(tens[value // 10])
        value %= 10
    if value:
        parts.append(ones[value])
    return " ".join(parts)


def _abstract_items(details: Mapping[str, Any], key: str, fallback: str) -> list[dict[str, Any]]:
    items = []
    for item in details.get(key) or []:
        description = str(item.get("description") or fallback).strip()
        amount = _numeric(item.get("amount"))
        if description or amount is not None:
            items.append({"description": description, "amount": amount})
    return items


def _clear_rows_and_merges(ws: Worksheet, start_row: int) -> None:
    for merged in list(ws.merged_cells.ranges):
        if range_boundaries(str(merged))[1] >= start_row:
            ws.unmerge_cells(str(merged))
    if ws.max_row >= start_row:
        ws.delete_rows(start_row, ws.max_row - start_row + 1)
    for row in [number for number in ws.row_dimensions if number >= start_row]:
        del ws.row_dimensions[row]


def _style_abstract_row(ws: Worksheet, row: int, *, bold: bool = False, input_amount: bool = False) -> None:
    for column in range(1, 13):
        cell = ws.cell(row, column)
        cell.font = Font(name="Arial", size=10, bold=bold, color=INPUT_BLUE if input_amount and column == 12 else BLACK)
        cell.border = THIN_ALL
        cell.alignment = _alignment_with(
            cell,
            vertical="center",
            horizontal="right" if column == 12 else ("center" if column == 1 else None),
        )
    ws.cell(row, 12).number_format = "#,##0.00"
    ws.row_dimensions[row].height = 25 if bold else 23


def _add_abstract_direct_row(ws: Worksheet, row: int, serial: int, description: str, amount: Any, *, bold: bool = False, input_amount: bool = False) -> None:
    ws.cell(row, 1).value = serial
    _merge_description(ws, row, description, "B", "K")
    ws.cell(row, 12).value = amount
    _style_abstract_row(ws, row, bold=bold, input_amount=input_amount)


def _report_text(state: Mapping[str, Any]) -> tuple[str, str, str, str]:
    details = state.get("details") or {}
    return f"Name of the Work : {work_text(details)}", f"Name of the Applicant : {applicant_text(details)}", details.get("place") or "[Enter place]", details.get("estimateDate") or "[Enter date]"


def _plinth_area(value):
    if value is None or str(value).strip() == "":
        return None
    number = _numeric(value)
    if number is None or number < 0:
        raise ValueError("Plinth Area must be a valid non-negative area in sft.")
    return float(number)


def _area_text(value):
    return f"{value:,.2f}" if value is not None else "[Enter area]"


def _apply_detail_report_text(ws: Worksheet, state: Mapping[str, Any], result: DetailResult, spec: DetailSpec) -> None:
    work, applicant, place, date = _report_text(state)
    ws["A8"] = f"Name of the Work : {work_text(state.get('details') or {}, spec.work_description)}" if modern_identity(state.get("details") or {}) else work
    ws["A11"] = applicant
    if modern_identity(state.get("details") or {}) or "plinthArea" in spec.form_data:
        ws["A14"] = f"Plinth Area : {_area_text(_plinth_area(spec.form_data.get('plinthArea')))} sft."
    # Detail footers are replaced by one signature block on the Abstract.
    _clear_rows_and_merges(ws, result.words_row + 1)
    result.last_row = result.words_row
    if not spec.first_sheet:
        # Preserve formula row addresses while removing the repeated header
        # from both the visible worksheet and its print area.
        for row in ws.iter_rows(min_row=1, max_row=13):
            for cell in row:
                if cell.value is not None:
                    cell.value = None
        for row in range(1, 14):
            ws.row_dimensions[row].hidden = True
        plinth = str(ws["A14"].value or "Plinth Area : [Enter area]")
        ws["A14"] = f"{spec.floor_label.upper()} ({plinth})"
        ws.row_dimensions[14].height = 38


def _build_separate_abstract(
    ws: Worksheet,
    state: Mapping[str, Any],
    specs: Sequence[DetailSpec],
    results: Mapping[str, DetailResult],
    manifest: Mapping[str, Any],
    completed: bool,
) -> tuple[int, int]:
    _clear_rows_and_merges(ws, 16)
    details = state.get("details") or {}
    custom_components = _abstract_items(details, "customComponentEstimates", "Custom Component Estimate")
    custom_common = _abstract_items(details, "customCommonExternalWorks", "Custom External Work / Project Charge")
    common_values = details.get("commonExternalWorks") or {}
    row = 16
    amount_rows = []
    known_total = 0.0
    known = False

    for index, spec in enumerate(specs, 1):
        result = results[spec.name]
        formula = f'=IF(COUNT(\'{spec.name.replace(chr(39), chr(39) * 2)}\'!{result.estimated_cell})=0,"",\'{spec.name.replace(chr(39), chr(39) * 2)}\'!{result.estimated_cell})'
        _add_abstract_direct_row(ws, row, index, spec.abstract_label, formula, bold=True)
        if completed:
            final_amount = _effective_final_amount(spec, manifest)
            known_total += float(final_amount)
            known = True
        amount_rows.append(row)
        row += 1
    for custom in custom_components:
        _add_abstract_direct_row(ws, row, len(amount_rows) + 1, custom["description"], custom["amount"], input_amount=True)
        if completed and custom["amount"] is not None:
            known_total += float(custom["amount"])
            known = True
        amount_rows.append(row)
        row += 1

    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=12)
    ws.cell(row, 1).value = "COMMON EXTERNAL WORKS AND PROJECT CHARGES"
    for column in range(1, 13):
        cell = ws.cell(row, column)
        cell.fill = PatternFill("solid", fgColor=PALE_BLUE)
        cell.font = Font(name="Arial", size=10, bold=True, color=BLACK)
        cell.border = MEDIUM_ALL
    row += 1
    for label in COMMON_EXTERNAL_WORKS:
        value = _numeric(common_values.get(label)) if completed else None
        _add_abstract_direct_row(ws, row, len(amount_rows) + 1, label, value, input_amount=True)
        if completed and value is not None:
            known_total += float(value)
            known = True
        amount_rows.append(row)
        row += 1
    for custom in custom_common:
        _add_abstract_direct_row(ws, row, len(amount_rows) + 1, custom["description"], custom["amount"], input_amount=True)
        if completed and custom["amount"] is not None:
            known_total += float(custom["amount"])
            known = True
        amount_rows.append(row)
        row += 1

    total_row = row + 1
    ws.merge_cells(start_row=total_row, start_column=1, end_row=total_row, end_column=11)
    ws.cell(total_row, 1).value = "TOTAL ESTIMATED PROJECT COST"
    references = ",".join(f"L{number}" for number in amount_rows)
    ws.cell(total_row, 12).value = f'=IF(COUNT({references})=0,"",SUM({references}))'
    _style_total_or_words_row(ws, total_row, YELLOW, right_label=True)
    words_row = total_row + 1
    ws.merge_cells(start_row=words_row, start_column=1, end_row=words_row, end_column=11)
    words = f"(Rupees {_amount_in_words(known_total)} only)" if known else "(Rupees [amount in words to be generated by the application] only)"
    ws.cell(words_row, 1).value = words
    ws.cell(words_row, 12).value = f'=IF(COUNT(L{total_row})=0,"",L{total_row})'
    _style_total_or_words_row(ws, words_row, YELLOW)

    place_row = words_row + 2
    date_row = place_row + 1
    _write_footer(ws, place_row, date_row, state)
    _apply_outer_border(ws, 1, words_row)
    ws.freeze_panes = None
    work, applicant, _, _ = _report_text(state)
    ws["A8"] = work
    ws["A11"] = applicant
    # Areas belong to their component/floor sheets, never the overall Abstract.
    ws["A14"] = None
    return words_row, date_row


def _style_total_or_words_row(ws: Worksheet, row: int, fill: str, *, right_label: bool = False) -> None:
    for column in range(1, 13):
        cell = ws.cell(row, column)
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.font = Font(name="Arial", size=11, bold=True, color=BLACK)
        cell.border = MEDIUM_ALL
        cell.alignment = _alignment_with(
            cell,
            vertical="center",
            horizontal="right" if (right_label or column == 12) else "center",
            wrap_text=True,
        )
    ws.cell(row, 12).number_format = "#,##0.00"


def _write_footer(ws: Worksheet, place_row: int, date_row: int, state: Mapping[str, Any]) -> None:
    _, _, place, date = _report_text(state)
    ws.merge_cells(start_row=place_row, start_column=1, end_row=place_row, end_column=4)
    ws.merge_cells(start_row=place_row, start_column=8, end_row=place_row, end_column=12)
    ws.merge_cells(start_row=date_row, start_column=1, end_row=date_row, end_column=4)
    ws.cell(place_row, 1).value = f"Place : {place}"
    ws.cell(place_row, 8).value = "SIGNATURE OF VALUER"
    ws.cell(date_row, 1).value = f"Date : {date}"
    for row in (place_row, date_row):
        for column in range(1, 13):
            ws.cell(row, column).font = Font(name="Arial", size=11, bold=True, color=BLACK)
        ws.row_dimensions[row].height = 24
    ws.cell(place_row, 8).alignment = _alignment_with(ws.cell(place_row, 8), horizontal="center")


def _apply_outer_border(ws: Worksheet, first_row: int, last_row: int) -> None:
    for row in range(first_row, last_row + 1):
        left = ws.cell(row, 1)
        right = ws.cell(row, 12)
        left_border = copy(left.border)
        right_border = copy(right.border)
        left_border.left = MEDIUM
        right_border.right = MEDIUM
        left.border = left_border
        right.border = right_border


def _apply_a4_print_layout(ws: Worksheet) -> None:
    """Keep every estimation sheet together horizontally when printed or previewed.

    The approved layout intentionally uses all twelve columns.  Without an
    explicit print setup, spreadsheet applications split the description and
    amount columns across separate portrait pages.  Fit-to-one-page-wide keeps
    the table's proportions intact while allowing as many vertical A4 pages as
    the selected component needs.
    """

    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.scale = None
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.25
    ws.page_margins.right = 0.25
    ws.page_margins.top = 0.35
    ws.page_margins.bottom = 0.35
    ws.page_margins.header = 0.15
    ws.page_margins.footer = 0.15
    ws.print_options.horizontalCentered = True
    first_row = 14 if ws.row_dimensions[1].hidden else 1
    ws.print_area = f"A{first_row}:L{ws.max_row}"
    ws.sheet_view.pane = None
    ws.sheet_view.selection = [Selection(activeCell=f"A{first_row}", sqref=f"A{first_row}")]
    ws.sheet_view.topLeftCell = f"A{first_row}"


def _append_compact_abstract(
    ws: Worksheet,
    state: Mapping[str, Any],
    specs: Sequence[DetailSpec],
    results: Mapping[str, DetailResult],
    detail_result: DetailResult,
    manifest: Mapping[str, Any],
    completed: bool,
) -> None:
    for merged in list(ws.merged_cells.ranges):
        if range_boundaries(str(merged))[1] > detail_result.words_row:
            ws.unmerge_cells(str(merged))
    for row in range(detail_result.words_row + 1, ws.max_row + 1):
        for column in range(1, 13):
            ws.cell(row, column).value = None
    for row in [number for number in ws.row_dimensions if number > detail_result.words_row]:
        del ws.row_dimensions[row]

    details = state.get("details") or {}
    custom_components = _abstract_items(details, "customComponentEstimates", "Custom Component Estimate")
    row = detail_result.words_row + 2
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=12)
    ws.cell(row, 1).value = "A B S T R A C T"
    for column in range(1, 13):
        cell = ws.cell(row, column)
        cell.fill = PatternFill("solid", fgColor=PALE_BLUE)
        cell.font = Font(name="Arial", size=12, bold=True, color=BLACK)
        cell.border = MEDIUM_ALL
        cell.alignment = _alignment_with(cell, horizontal="center")
    row += 1
    amount_rows = []
    known_total = 0.0
    known = False
    for index, spec in enumerate(specs, 1):
        result = results[spec.name]
        formula = f'=IF(COUNT(\'{spec.name.replace(chr(39), chr(39) * 2)}\'!{result.estimated_cell})=0,"",\'{spec.name.replace(chr(39), chr(39) * 2)}\'!{result.estimated_cell})'
        _add_abstract_direct_row(ws, row, index, spec.abstract_label, formula)
        if completed:
            final_amount = _effective_final_amount(spec, manifest)
            known_total += float(final_amount)
            known = True
        amount_rows.append(row)
        row += 1
    for custom in custom_components:
        _add_abstract_direct_row(ws, row, len(amount_rows) + 1, custom["description"], custom["amount"], input_amount=True)
        if completed and custom["amount"] is not None:
            known_total += float(custom["amount"])
            known = True
        amount_rows.append(row)
        row += 1
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=11)
    ws.cell(row, 1).value = "TOTAL ESTIMATED PROJECT COST"
    references = ",".join(f"L{number}" for number in amount_rows)
    ws.cell(row, 12).value = f'=IF(COUNT({references})=0,"",SUM({references}))'
    _style_total_or_words_row(ws, row, YELLOW, right_label=True)
    words_row = row + 1
    ws.merge_cells(start_row=words_row, start_column=1, end_row=words_row, end_column=11)
    words = f"(Rupees {_amount_in_words(known_total)} only)" if known else "(Rupees [amount in words to be generated by the application] only)"
    ws.cell(words_row, 1).value = words
    ws.cell(words_row, 12).value = f'=IF(COUNT(L{row})=0,"",L{row})'
    _style_total_or_words_row(ws, words_row, YELLOW)
    place_row = words_row + 2
    date_row = place_row + 1
    _write_footer(ws, place_row, date_row, state)
    _apply_outer_border(ws, 1, words_row)
    detail_result.compact_abstract_words_row = words_row
    detail_result.last_row = date_row


def generate_estimation_workbook(
    state: Mapping[str, Any],
    *,
    mode: str = "completed",
    output_path: str | Path | None = None,
) -> GeneratedEstimationWorkbook:
    """Generate the configured estimation workbook.

    ``mode="completed"`` populates online-form values. ``mode="offline"``
    returns the configured, editable blank workbook.  Both modes use the same
    canonical sheets and preserve the selected component/floor topology.
    """

    if mode not in {"completed", "offline"}:
        raise ValueError("mode must be 'completed' or 'offline'")
    if industrial_centre_line(state):
        raise ValueError("Prepare the industrial Centre Line estimate offline and upload the completed report.")
    manifest = _load_manifest()
    specs = _detail_specs(state, manifest)
    separate_abstract = _uses_separate_abstract(state)
    workbook = load_workbook(MASTER_PATH)
    sheets = _copy_template_sheets(workbook, specs, manifest, separate_abstract)
    results = {name: _detail_result(sheet) for name, sheet in sheets.items()}

    for spec in specs:
        ws = sheets[spec.name]
        result = results[spec.name]
        if mode == "completed" or spec.template_key == "storage_shed":
            if mode == "completed":
                if spec.form_data.get("dimensionsRequired") and not (spec.form_data.get("dimensionSetup") or spec.form_data.get("manualMeasurements")):
                    raise ValueError(f"Apply dimensions and defaults for {spec.component_name}.")
                output_spec = spec
            else:
                output_spec = DetailSpec(spec.name, spec.component_name, spec.template_key, {})
            row_map, item_starts = _copy_standard_inputs(ws, output_spec, manifest, result)
            custom_group_rows = {}
            for anchor in ROOM_SCHEDULE_ANCHORS:
                custom_group_rows.update(_insert_scheduled_rooms(ws, output_spec, result, row_map, item_starts, anchor))
            standard_end = result.total_row
            additions = _custom_additions(spec, manifest) if mode == "completed" else []
            for group, rows in _append_custom_additions(ws, result, additions).items():
                custom_group_rows.setdefault(group, []).extend(rows)
            _repair_standard_aggregate_formulas(ws, output_spec, manifest, row_map, custom_group_rows)
            _apply_dimension_formulas(ws, output_spec, manifest, row_map)
            if mode == "completed":
                _use_displayed_prices(ws, result)
                _remove_standard_items(ws, spec, result, item_starts, standard_end)
            if mode == "completed" and spec.floor_multiplier > 1:
                _group_detail_amounts(ws, result, spec.floor_multiplier)
        _repair_detail_totals(ws, result)
        explicit_final_amount = _numeric(spec.form_data.get("finalAmount")) if mode == "completed" else None
        if mode == "completed" and spec.form_data.get("omittedItems"):
            if spec.form_data.get("itemOverrides") or _numeric(spec.form_data.get("sheetTotalOverride")) is not None:
                ws[result.estimated_cell] = _effective_final_amount(spec, manifest)
        elif explicit_final_amount is not None and (spec.floor_multiplier == 1 or spec.form_data.get("itemOverrides") or _numeric(spec.form_data.get("sheetTotalOverride")) is not None):
            ws[result.estimated_cell] = explicit_final_amount
        elif mode == "completed" and _numeric(spec.form_data.get("sheetTotalOverride")) is not None:
            ws[result.estimated_cell] = _numeric(spec.form_data["sheetTotalOverride"])
        if mode == "completed":
            effective_final_amount = _effective_final_amount(spec, manifest)
            ws.cell(result.words_row, 1).value = f"(Rupees {_amount_in_words(effective_final_amount)} only)"
        else:
            ws.cell(result.words_row, 1).value = "(Rupees [amount in words to be generated by the application] only)"
        _apply_detail_report_text(ws, state, result, spec)

    if separate_abstract:
        _build_separate_abstract(workbook["Abstract"], state, specs, results, manifest, mode == "completed")
    else:
        last_spec = specs[-1]
        _append_compact_abstract(
            sheets[last_spec.name], state, specs, results, results[last_spec.name], manifest, mode == "completed"
        )

    if workbook.calculation is None:
        workbook.calculation = CalcProperties()
    calculation = workbook.calculation
    calculation.fullCalcOnLoad = True
    calculation.forceFullCalc = True
    calculation.calcMode = "auto"
    for worksheet in workbook.worksheets:
        for row in worksheet.iter_rows(min_row=14, min_col=6, max_col=12):
            for cell in row:
                if cell.data_type == "f" or (cell.data_type == "n" and cell.value is not None):
                    cell.number_format = "#,##0.00"
        _apply_a4_print_layout(worksheet)
    workbook.active = 0

    output = BytesIO()
    workbook.save(output)
    details = state.get("details") or {}
    file_name = f"{_spreadsheet_name(details.get('applicantName') or state.get('propertyType'))}_Estimation_Report.xlsx"
    generated = GeneratedEstimationWorkbook(output.getvalue(), file_name, tuple(workbook.sheetnames))
    if output_path is not None:
        generated.save(output_path)
    return generated
