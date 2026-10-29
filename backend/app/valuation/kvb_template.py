"""KVB offline valuation workbook preparation.

Karur Vysya Bank uses its supplied Excel layout.  The application deliberately
does not redraw that layout: it starts from the maintained bank master and
removes only the sample property's values before returning a fresh workbook.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.cell.cell import MergedCell

from .config import KVB_TEMPLATE


@dataclass(frozen=True)
class GeneratedKvbTemplate:
    """A cleaned KVB workbook ready for download."""

    content: bytes
    file_name: str = "KVB_Valuation_Template.xlsx"


def _clear(sheet, *coordinates: str) -> None:
    for coordinate in coordinates:
        cell = sheet[coordinate]
        if not isinstance(cell, MergedCell):
            cell.value = None


def _clear_ranges(sheet, ranges: tuple[tuple[int, int, tuple[str, ...]], ...]) -> None:
    for start_row, end_row, columns in ranges:
        for row in range(start_row, end_row + 1):
            for column in columns:
                cell = sheet[f"{column}{row}"]
                if not isinstance(cell, MergedCell):
                    cell.value = None


def generate_kvb_template(template_path: Path = KVB_TEMPLATE) -> GeneratedKvbTemplate:
    """Return the supplied KVB layout without a previous applicant's data.

    Structural labels, print settings, merges, borders, page setup and photo
    placeholders remain untouched.  Values that belonged to the supplied
    case—including hidden side calculations—are removed so no prior valuation
    figure is carried into a new assignment.
    """

    if not template_path.exists():
        raise FileNotFoundError("The KVB valuation master workbook is unavailable.")

    workbook = load_workbook(template_path, data_only=False)
    sheet = workbook.active

    # Report header and the general/property/site/document sections.
    _clear(sheet, "B7", "I7")
    _clear_ranges(sheet, (
        (10, 16, ("C",)),
        (18, 37, ("C",)),
        (19, 22, ("I",)),
        (39, 51, ("C",)),
        (53, 58, ("C", "E", "G", "I")),
        (60, 66, ("C",)),
        (66, 66, ("I",)),
        (68, 74, ("C",)),
    ))

    # Preserve the practical headings/units while clearing all sample areas,
    # rates, totals and the reference workbook's out-of-print calculations.
    _clear_ranges(sheet, (
        (77, 77, ("C", "F", "I")),
        (80, 84, ("C", "F", "I")),
        (87, 91, ("C", "G", "I", "K", "L", "M", "N", "O", "P", "Q")),
        (94, 96, ("C", "G", "I", "K", "L", "M", "N", "O", "P", "Q")),
        (98, 101, ("C", "E", "K", "L", "M", "N", "O", "P", "Q")),
        (103, 106, ("B",)),
    ))

    # Keep the repeated fields useful when an appraiser starts filling them,
    # but show blank cells until their source field has a value.
    sheet["C12"] = '=IF(C10="","",C10)'
    sheet["C30"] = '=IF(C29="","",C29)'
    sheet["C31"] = '=IF(C29="","",C29)'
    _clear(sheet, "C113")
    sheet["B110"] = "a) I have personally inspected the property on [date] in the presence of [owner / representative]."
    sheet["B111"] = "b) The information furnished in this valuation report is true and correct to the best of my knowledge and belief, and I have made an impartial and true valuation of the property."
    sheet["B112"] = "c) I have no direct or indirect interest in the property valued."
    sheet["A152"] = "Latitude and Longitude:"
    sheet["A115"] = None
    sheet["A115"].number_format = "General"
    # The source workbook is a completed case, so remove its photographs and
    # map image while retaining the pre-formatted photo/map spaces.
    sheet._images = []

    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return GeneratedKvbTemplate(content=stream.getvalue())
