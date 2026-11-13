"""Create a simple, typed XLSX export from an approved browser table view."""

from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo


MAX_COLUMNS = 30
MAX_ROWS = 10_000
ALLOWED_TYPES = {"text", "integer", "number", "currency", "date", "percentage"}


@dataclass(frozen=True)
class ExportedWorkbook:
    content: bytes
    file_name: str


def _clean_text(value, limit=500):
    text = str(value or "").strip()
    return text[:limit]


def _safe_file_name(value):
    stem = re.sub(r"[^a-z0-9._ -]+", "_", _clean_text(value, 120), flags=re.IGNORECASE).strip(" ._")
    if stem.lower().endswith(".xlsx"):
        stem = stem[:-5].rstrip(" ._")
    return f"{stem or 'ValuX_Export'}.xlsx"


def _safe_sheet_name(value):
    name = re.sub(r"[\\/*?:\[\]]+", " ", _clean_text(value, 31)).strip()
    return name[:31] or "Export"


def _literal_text(value, limit=500):
    text = _clean_text(value, limit)
    return f"'{text}" if text[:1] in {"=", "+", "-", "@"} else text


def _typed_value(value, kind):
    if value is None or value == "":
        return None
    if kind in {"integer", "number", "currency", "percentage"}:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not valid numeric export values.")
        try:
            number = float(value)
            return int(number) if kind == "integer" else number
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid {kind} export value: {value}") from error
    if kind == "date":
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError as error:
            raise ValueError(f"Invalid date export value: {value}") from error
    # Prevent user-entered identifiers or descriptions from becoming formulas.
    return _literal_text(value)


def generate_table_export(payload):
    if not isinstance(payload, dict):
        raise ValueError("The export request is missing.")
    title = _literal_text(payload.get("title"), 120)
    if not title:
        raise ValueError("The export title is required.")
    columns = payload.get("columns")
    rows = payload.get("rows")
    if not isinstance(columns, list) or not columns or len(columns) > MAX_COLUMNS:
        raise ValueError(f"Provide between 1 and {MAX_COLUMNS} export columns.")
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise ValueError(f"The export is limited to {MAX_ROWS:,} rows.")

    normalized_columns = []
    seen_keys = set()
    for column in columns:
        if not isinstance(column, dict):
            raise ValueError("Every export column must have a key and label.")
        key = _clean_text(column.get("key"), 80)
        label = _literal_text(column.get("label"), 120)
        kind = _clean_text(column.get("type") or "text", 20).lower()
        if not key or not label or key in seen_keys or kind not in ALLOWED_TYPES:
            raise ValueError("Export columns contain an invalid or duplicate definition.")
        seen_keys.add(key)
        normalized_columns.append((key, label, kind))

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = _safe_sheet_name(payload.get("sheetName") or title)
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A4"
    last_column = get_column_letter(len(normalized_columns))
    sheet.merge_cells(f"A1:{last_column}1")
    title_cell = sheet["A1"]
    title_cell.value = title
    title_cell.font = Font(name="Aptos Display", size=16, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill("solid", fgColor="9E4B31")
    title_cell.alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 28
    subtitle = _literal_text(payload.get("subtitle"), 240)
    if subtitle:
        sheet.merge_cells(f"A2:{last_column}2")
        sheet["A2"] = subtitle
        sheet["A2"].font = Font(name="Aptos", size=9, color="6D5A52")
        sheet["A2"].alignment = Alignment(wrap_text=True, vertical="center")
        sheet.row_dimensions[2].height = 24

    thin = Side(style="thin", color="E5D1C7")
    for column_index, (_, label, _) in enumerate(normalized_columns, start=1):
        cell = sheet.cell(row=3, column=column_index, value=label)
        cell.font = Font(name="Aptos", size=10, bold=True, color="4B2016")
        cell.fill = PatternFill("solid", fgColor="FFF0E7")
        cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    sheet.row_dimensions[3].height = 28

    for row_index, row in enumerate(rows, start=4):
        if not isinstance(row, dict):
            raise ValueError("Every exported row must be an object.")
        for column_index, (key, _, kind) in enumerate(normalized_columns, start=1):
            cell = sheet.cell(row=row_index, column=column_index, value=_typed_value(row.get(key), kind))
            cell.font = Font(name="Aptos", size=10, color="3E302B")
            cell.border = Border(bottom=Side(style="hair", color="E8DDD7"))
            cell.alignment = Alignment(vertical="top", wrap_text=kind == "text")
            if kind == "currency":
                cell.number_format = '₹#,##0.00'
            elif kind == "integer":
                cell.number_format = '#,##0'
            elif kind == "number":
                cell.number_format = '#,##0.00'
            elif kind == "percentage":
                cell.number_format = '0.0%'
            elif kind == "date":
                cell.number_format = 'dd-mmm-yyyy'

    table_range = f"A3:{last_column}{len(rows) + 3}"
    if rows:
        table = Table(displayName="ValuXExport", ref=table_range)
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleMedium2", showFirstColumn=False, showLastColumn=False,
            showRowStripes=True, showColumnStripes=False,
        )
        sheet.add_table(table)
    else:
        sheet.auto_filter.ref = table_range

    for column_index, (_, label, kind) in enumerate(normalized_columns, start=1):
        values = [label] + [_clean_text(row.get(normalized_columns[column_index - 1][0]), 120) for row in rows[:500]]
        width = max(len(value) for value in values) + 2
        if kind in {"currency", "integer", "number", "percentage", "date"}:
            width = max(width, 14)
        sheet.column_dimensions[get_column_letter(column_index)].width = min(max(width, 11), 38)

    sheet.print_title_rows = "1:3"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_margins.left = 0.3
    sheet.page_margins.right = 0.3
    sheet.page_margins.top = 0.45
    sheet.page_margins.bottom = 0.45

    stream = BytesIO()
    workbook.save(stream)
    return ExportedWorkbook(stream.getvalue(), _safe_file_name(payload.get("fileName") or title))
