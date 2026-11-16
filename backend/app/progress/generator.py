"""Generate linked construction progress/completion reports as A4 DOCX files."""

from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor

from ..business_time import tenant_today
from ..valuation.formatting import amount_in_words, display_date, indian_number, number_value
from ..valuation.media import insert_uploaded_media, require_online_media


VALUER_NAME = "K.Sivaprasad"
BLACK = "000000"


@dataclass(frozen=True)
class GeneratedProgressReport:
    content: bytes
    file_name: str
    report_type: str
    summary: dict[str, Any]


def _number(value: Any, label: str, *, allow_blank: bool = False) -> float | None:
    if allow_blank and str(value or "").strip() == "":
        return None
    parsed = number_value(value)
    if parsed is None or parsed < 0:
        raise ValueError(f"{label} must be a valid non-negative number.")
    return parsed


def _date(value: Any, label: str, *, required: bool = True) -> str:
    text = str(value or "").strip()
    if not text and not required:
        return ""
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{label} must be a valid date.") from exc
    return text


def _currency(value: Any, *, blank: bool = False) -> str:
    if blank and value is None:
        return ""
    amount = number_value(value)
    return "" if amount is None else f"Rs.{indian_number(amount)}/-"


def _safe_name(value: Any) -> str:
    text = "".join(character if character.isalnum() else "_" for character in str(value or "Report"))
    return "_".join(part for part in text.split("_") if part) or "Report"


def _set_cell_margins(cell, top=70, start=80, bottom=70, end=80):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, amount in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(amount))
        node.set(qn("w:type"), "dxa")


def _set_repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def _cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def _set_width(cell, inches: float):
    cell.width = Inches(inches)
    tc_pr = cell._tc.get_or_add_tcPr()
    width = tc_pr.first_child_found_in("w:tcW")
    width.set(qn("w:w"), str(int(inches * 1440)))
    width.set(qn("w:type"), "dxa")


def _set_column_widths(table, widths):
    for index, inches in enumerate(widths):
        table.columns[index].width = Inches(inches)
        table._tbl.tblGrid.gridCol_lst[index].set(qn("w:w"), str(int(inches * 1440)))
        for cell in table.columns[index].cells:
            _set_width(cell, inches)


def _cell_text(cell, text: Any, *, bold=False, size=9, align=WD_ALIGN_PARAGRAPH.LEFT):
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.alignment = align
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1
    run = paragraph.add_run(str(text or ""))
    run.bold = bold
    run.font.name = "Arial"
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor(0, 0, 0)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    _set_cell_margins(cell)
    return run


def _normalize_table(table):
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for row in table.rows:
        _cant_split(row)
        for cell in row.cells:
            _set_cell_margins(cell)


def _add_paragraph(document, text="", *, align=WD_ALIGN_PARAGRAPH.LEFT, size=10, bold=False,
                   underline=False, before=0, after=0, keep=False):
    paragraph = document.add_paragraph()
    paragraph.alignment = align
    paragraph.paragraph_format.space_before = Pt(before)
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.keep_together = keep
    run = paragraph.add_run(text)
    run.font.name = "Arial"
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor(0, 0, 0)
    run.bold = bold
    run.underline = underline
    return paragraph


def _add_title(document, report_type: str, is_karnataka: bool):
    if is_karnataka:
        _add_paragraph(document, "FORMAT", align=WD_ALIGN_PARAGRAPH.CENTER, size=11, underline=True)
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(0)
    for text, bold in (
        ("CONSTRUCTION/INVESTMENT ", False),
        ("PROGRESS", report_type == "progress"),
        (" / ", False),
        ("COMPLETION", report_type == "completion"),
        (" REPORT FOR HOUSING LOAN", False),
    ):
        run = paragraph.add_run(text)
        run.font.name = "Arial"
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0, 0, 0)
        run.underline = True
        run.bold = bold
    _add_paragraph(document, "(Should be obtained before each disbursal)", align=WD_ALIGN_PARAGRAPH.CENTER, size=10)


def _validate(payload: Mapping[str, Any], *, require_media: bool = True) -> dict[str, Any]:
    institution = dict(payload.get("institution") or {})
    linked = dict(payload.get("linkedEstimation") or {})
    details = dict(payload.get("details") or {})
    components = []
    raw_components = payload.get("components")
    if not isinstance(raw_components, list) or not raw_components:
        raise ValueError("The linked estimation report has no component estimates.")
    photos = payload.get("photos") or []
    map_image = payload.get("map")
    if require_media:
        require_online_media(photos, map_image)
    for index, raw in enumerate(raw_components, start=1):
        label = str((raw or {}).get("label") or "").strip()
        if not label:
            raise ValueError(f"Component {index} requires a description.")
        estimated = _number((raw or {}).get("estimatedCost"), f"Estimated cost for {label}")
        percent = _number((raw or {}).get("completionPercent"), f"Completion percentage for {label}")
        if percent > 100:
            raise ValueError(f"Completion percentage for {label} cannot exceed 100.")
        calculated = estimated * percent / 100
        completed = _number((raw or {}).get("completedCost", calculated), f"Completed cost for {label}")
        if completed > estimated + 0.005:
            raise ValueError(f"Completed cost for {label} cannot exceed its estimated cost.")
        balance = max(0.0, estimated - completed)
        components.append({
            "label": label,
            "estimatedCost": estimated,
            "completionPercent": percent,
            "completedCost": completed,
            "balanceCost": balance,
        })

    report_date = _date(details.get("reportDate"), "Report date")
    visit_date = _date(details.get("visitDate"), "Site-visit date")
    bank = dict(payload.get("bank") or {})
    institution_code = str(institution.get("code") or "").strip().upper()
    if institution_code == "KB":
        bank["balanceAsOn"] = _date(bank.get("balanceAsOn"), "Balance outstanding date", required=False)
        bank["date"] = _date(bank.get("date"), "Bank assessment date", required=False)
        releases = []
        for index, release in enumerate(bank.get("releases") or [], start=1):
            current = dict(release or {})
            current["date"] = _date(current.get("date"), f"Loan release date {index}", required=False)
            releases.append(current)
        bank["releases"] = releases
    no_deviation = str(details.get("noDeviation") or "").lower()
    if no_deviation not in {"yes", "no"}:
        raise ValueError("Confirm whether the construction follows the sanctioned plan without deviation.")
    if no_deviation == "no" and not str(details.get("deviationRemarks") or "").strip():
        raise ValueError("Describe the observed deviation from the sanctioned plan.")
    materials = _number(details.get("materialsAtSite", 0), "Cost of materials at site")
    is_completion = all(item["completionPercent"] == 100 and item["balanceCost"] <= 0.005 for item in components)
    requested = str(payload.get("requestedReportType") or "progress").lower()
    if requested not in {"progress", "completion"}:
        raise ValueError("Select Progress or Completion as the report type.")
    if requested == "completion" and not is_completion:
        raise ValueError("A Completion report requires 100% completion and zero balance work for every component.")
    if requested == "progress" and is_completion:
        raise ValueError("All components are complete. Create this as a Completion report.")
    report_type = "completion" if is_completion else "progress"
    works_total = sum(item["completedCost"] for item in components)
    total_value = works_total + materials
    return {
        "institution": institution,
        "linked": linked,
        "details": details,
        "bank": bank,
        "components": components,
        "reportDate": report_date,
        "visitDate": visit_date,
        "reportType": report_type,
        "worksTotal": works_total,
        "materialsAtSite": materials,
        "totalValue": total_value,
        "noDeviation": no_deviation,
        "photos": photos,
        "map": map_image,
    }


def _project_table(document, data):
    institution = data["institution"]
    linked = data["linked"]
    details = data["details"]
    table = document.add_table(rows=6, cols=2)
    _normalize_table(table)
    _set_column_widths(table, [2.78, 3.98])
    rows = [
        ("1. Name of the Branch", f"{institution.get('name', '')}, {institution.get('branch', '')}".strip(", ")),
        ("2. Name & address of the borrower", str(linked.get("applicantName") or "").strip() if linked.get("identityVersion") == 2 else ", ".join(filter(None, [str(linked.get("applicantName") or "").strip(), str(linked.get("projectLocation") or "").strip()]))),
        ("3. Locality and address of the construction site", ", ".join(filter(None, [str(linked.get("workDescription") or "").strip().rstrip(", "), str((linked.get("workAddress") if linked.get("identityVersion") == 2 else linked.get("projectLocation")) or "").strip()]))),
        ("4. Name of panel valuer", VALUER_NAME),
        ("5. Name of Bank's official who accompanied the panel valuer", ", ".join(filter(None, [str(details.get("officialName") or "").strip(), str(details.get("officialDesignation") or "").strip()]))),
        ("6. Date of visit to the construction site", display_date(data["visitDate"])),
    ]
    for row, (label, value) in zip(table.rows, rows):
        _set_width(row.cells[0], 2.78)
        _set_width(row.cells[1], 3.98)
        _cell_text(row.cells[0], label, size=9)
        _cell_text(row.cells[1], value, size=9)


def _works_table(document, data, *, template=False):
    heading = _add_paragraph(document, "7. Details of works completed/investment made:", size=10, before=8, after=5, keep=True)
    heading.paragraph_format.keep_with_next = True
    table = document.add_table(rows=1, cols=6)
    _normalize_table(table)
    # Five main columns; the estimated-cost heading spans floor and amount.
    widths = [0.34, 1.65, 1.0, 1.25, 1.25, 1.25]
    _set_column_widths(table, widths)
    table.rows[0].cells[2].merge(table.rows[0].cells[3])
    headings = [
        "Sl. No.",
        "Construction details (Construction of house/ Flat/ Addl. Construction/ Renovation/ Repairs)",
        "Total estimated cost (As submitted in the proposal) (Rs)",
        "Details of works completed/ stage of construction/ % of work completed",
        "Cost of works completed/ incurred (Rs)",
    ]
    for index, text in zip([0, 1, 2, 4, 5], headings):
        _cell_text(table.rows[0].cells[index], text, bold=True, size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    _set_repeat_header(table.rows[0])
    for component in data["components"]:
        row = table.add_row()
        _cant_split(row)
        values = [
            "", "",
            component["label"],
            _currency(component["estimatedCost"]),
            "" if template else f"{component['completionPercent']:g}%",
            "" if template else _currency(component["completedCost"]),
        ]
        for column, (cell, value) in enumerate(zip(row.cells, values)):
            _set_width(cell, widths[column])
            _cell_text(cell, value, size=9, align=WD_ALIGN_PARAGRAPH.LEFT if column == 2 else WD_ALIGN_PARAGRAPH.RIGHT if column in {3, 5} else WD_ALIGN_PARAGRAPH.CENTER)
    for cell in table.rows[0].cells:
        for paragraph in cell.paragraphs:
            paragraph.paragraph_format.keep_with_next = True
    total = table.add_row()
    _cant_split(total)
    _cell_text(total.cells[2], "Total", bold=True, size=9)
    _cell_text(total.cells[3], _currency(sum(item["estimatedCost"] for item in data["components"])), bold=True, size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _cell_text(total.cells[4], "Total (Rs)", bold=True, size=9, align=WD_ALIGN_PARAGRAPH.CENTER)
    _cell_text(total.cells[5], _currency(data["worksTotal"], blank=template), bold=True, size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    final_row = len(table.rows) - 1
    _cell_text(table.cell(1, 0).merge(table.cell(final_row, 0)), "1.", size=9, align=WD_ALIGN_PARAGRAPH.CENTER)
    description = str(data["linked"].get("workDescription") or "").strip()
    _cell_text(table.cell(1, 1).merge(table.cell(final_row, 1)), description, size=9)
    materials = table.add_row()
    _cant_split(materials)
    materials.cells[0].merge(materials.cells[4])
    _cell_text(materials.cells[0], "Add: Cost of materials at site (Rs.)", bold=True, size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _cell_text(materials.cells[5], _currency(data["materialsAtSite"], blank=template), bold=True, size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    words = table.add_row()
    _cant_split(words)
    words.cells[0].merge(words.cells[4])
    _cell_text(words.cells[0], "(Rupees ____________________ only)" if template else f"(Rupees {amount_in_words(data['totalValue'])} only)", bold=True, size=9, align=WD_ALIGN_PARAGRAPH.CENTER)
    _cell_text(words.cells[5], _currency(data["totalValue"], blank=template), bold=True, size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)


def _certificate(document, data, *, template=False):
    heading = _add_paragraph(document, "8. Certificate by the Valuer:", size=10, before=7, after=3, keep=True)
    heading.paragraph_format.keep_with_next = True
    details = data["details"]
    if template:
        plan_text = "[Record whether work follows the sanctioned plan and describe any deviations.]"
    elif data["noDeviation"] == "yes":
        plan_text = "I hereby certify that the construction is being carried out as per the sanctioned plan without any deviation."
    else:
        plan_text = f"Deviation from the sanctioned plan was observed: {str(details.get('deviationRemarks') or '').strip()}"
    paragraph = _add_paragraph(document, align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=9, after=2)
    paragraph.style = document.styles["List Bullet"]
    paragraph.paragraph_format.keep_together = True
    paragraph.add_run(plan_text + " The value of works put up till date is ").font.name = "Arial"
    amount_run = paragraph.add_run("____________" if template else _currency(data["totalValue"]))
    amount_run.bold = True
    amount_run.underline = True
    amount_run.font.name = "Arial"
    amount_run.font.size = Pt(9)
    paragraph.add_run(" (Rupees ____________________ only)." if template else f" (Rupees {amount_in_words(data['totalValue'])} only).").font.name = "Arial"
    photo_text = "Photos taken at the site showing the progress, duly authenticated, are enclosed." if data["photos"] else "No authenticated site photographs were provided with this report."
    photo = _add_paragraph(document, "[Record site photographs enclosed, if applicable.]" if template else photo_text, size=9, after=2)
    photo.style = document.styles["List Bullet"]
    table = document.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_width(table.cell(0, 0), 3.2)
    _set_width(table.cell(0, 1), 3.55)
    _cell_text(table.cell(0, 0), f"Place : {str(details.get('place') or 'Adoni').strip()},\nDate  : {display_date(data['reportDate'])}.", size=9)
    _cell_text(table.cell(0, 1), "Seal and Signature of the Valuer", size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    borders = table._tbl.tblPr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        table._tbl.tblPr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "nil")
        borders.append(node)


def _bank_page(document, data, *, template=False):
    document.add_page_break()
    _add_paragraph(document, "BRANCH SANCTION", align=WD_ALIGN_PARAGRAPH.CENTER, size=11, bold=True, after=6)
    bank = data["bank"]
    linked = data["linked"]
    _add_paragraph(document, "Loan disbursement details:", size=10, after=3)
    releases = [entry for entry in (bank.get("releases") or []) if str((entry or {}).get("date") or "").strip() or str((entry or {}).get("amount") or "").strip()]
    release_rows = max(3, len(releases))
    table = document.add_table(rows=2 + release_rows + 1, cols=6)
    _normalize_table(table)
    widths = [1.02, 1.42, 0.96, 1.0, 0.94, 1.15]
    _set_column_widths(table, widths)
    table.cell(0, 4).merge(table.cell(0, 5))
    headers = ["TL/PSTL Account No.", "Name of the borrower", "Limit sanctioned", "Balance O/s. as on", "Loan amount already released"]
    for column, (cell, text) in enumerate(zip(table.rows[0].cells[:5], headers)):
        _set_width(cell, widths[min(column, len(widths) - 1)])
        _cell_text(cell, text, size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    table.cell(0, 0).merge(table.cell(1, 0))
    table.cell(0, 1).merge(table.cell(1, 1))
    table.cell(0, 2).merge(table.cell(1, 2))
    table.cell(0, 3).merge(table.cell(1, 3))
    _cell_text(table.cell(1, 4), "Date", size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    _cell_text(table.cell(1, 5), "Amount", size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    base_values = [bank.get("accountNumber", ""), linked.get("applicantName", ""), _currency(bank.get("limitSanctioned"), blank=True), display_date(str(bank.get("balanceAsOn") or "")), "", ""]
    for column, value in enumerate(base_values):
        _cell_text(table.cell(2, column), value, size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    _cell_text(table.cell(2, 3), "\n".join(filter(None, [display_date(str(bank.get("balanceAsOn") or "")), _currency(bank.get("balanceOutstanding"), blank=True)])), size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    released_total = 0.0
    for index in range(release_rows):
        row_index = 2 + index
        release = releases[index] if index < len(releases) else {}
        amount = _number(release.get("amount"), "Released amount", allow_blank=True) if release else None
        if amount is not None:
            released_total += amount
        _cell_text(table.cell(row_index, 4), display_date(str(release.get("date") or "")), size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
        _cell_text(table.cell(row_index, 5), _currency(amount, blank=True), size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)
    total_row = table.rows[-1]
    total_row.cells[0].merge(total_row.cells[4])
    _cell_text(total_row.cells[0], "Total", bold=True, size=8.5, align=WD_ALIGN_PARAGRAPH.RIGHT)
    _cell_text(total_row.cells[5], _currency(None if template else released_total, blank=template), bold=True, size=8.5, align=WD_ALIGN_PARAGRAPH.CENTER)

    _add_paragraph(document, "Assessment of loan/instalment amount to be released:", size=10, before=9, after=3)
    margin_percent = _number(bank.get("marginPercent"), "Margin percentage", allow_blank=True)
    margin = data["totalValue"] * margin_percent / 100 if margin_percent is not None else None
    eligible = data["totalValue"] - margin if margin is not None else None
    instalment = max(0.0, eligible - released_total) if eligible is not None else None
    assessment = [
        ("a.", "Construction cost estimated as per proposal", sum(item["estimatedCost"] for item in data["components"])),
        ("b.", "Cost incurred so far as per valuer's report overleaf", data["totalValue"]),
        ("c.", f"Margin to be maintained on the cost incurred/invested as per sanction terms ({margin_percent:g}% )" if margin_percent is not None else "Margin to be maintained on the cost incurred/invested as per sanction terms (____%)", margin),
        ("d.", "Total loan amount eligible for release (b-c)", eligible),
        ("e.", "Loan amount already released (as in the above table)", None if template else released_total),
        ("f.", "Loan instalment/amount eligible for release now (d-e)", instalment),
    ]
    assessment_table = document.add_table(rows=len(assessment), cols=3)
    _normalize_table(assessment_table)
    _set_column_widths(assessment_table, [0.35, 3.7, 2.7])
    for row, (letter, label, value) in zip(assessment_table.rows, assessment):
        _set_width(row.cells[0], 0.35)
        _set_width(row.cells[1], 3.7)
        _set_width(row.cells[2], 2.7)
        _cell_text(row.cells[0], letter, size=8.5)
        _cell_text(row.cells[1], label, size=8.5)
        _cell_text(row.cells[2], _currency(value, blank=True), size=8.5)

    _add_paragraph(document, "Submitted to the Branch Head:", size=10, underline=True, before=9, after=4)
    official = str(data["details"].get("officialName") or "________________").strip()
    site = str((linked.get("workAddress") if linked.get("identityVersion") == 2 else linked.get("projectLocation")) or "________________").strip()
    text = (f"I have accompanied Shri {VALUER_NAME}, who is in the panel of approved valuers of the Bank, during the work in progress assessment visit to the construction site of the above borrower, at {site}.\n"
            "The loan/instalment amount as assessed above may be released now against the progress made by the borrower in construction.")
    _add_paragraph(document, text, align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=9, after=8)
    signature = document.add_table(rows=2, cols=2)
    signature.alignment = WD_TABLE_ALIGNMENT.CENTER
    _cell_text(signature.cell(0, 0), f"Place: {str(bank.get('place') or data['details'].get('place') or 'Adoni').strip()}\nDate: {display_date(str(bank.get('date') or data['reportDate']))}", size=9)
    _cell_text(signature.cell(0, 1), f"(Name: {official})\nOfficer/ABM/Branch Head\n(who accompanied the valuer)", size=9)
    _cell_text(signature.cell(1, 0), "ASST. BRANCH MANAGER", size=9)
    _cell_text(signature.cell(1, 1), "BRANCH HEAD", size=9)
    for row in signature.rows:
        _set_width(row.cells[0], 3.35)
        _set_width(row.cells[1], 3.4)
    borders = signature._tbl.tblPr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        signature._tbl.tblPr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "nil")
        borders.append(node)


def _document(data, *, template=False):
    document = Document()
    section = document.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.left_margin = Inches(1.0)
    section.right_margin = Inches(0.49)
    section.top_margin = Inches(0.55)
    section.bottom_margin = Inches(0.55)
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    is_karnataka = str(data["institution"].get("code") or "").upper() == "KB" or str(data["institution"].get("name") or "").strip().lower() == "karnataka bank"
    _add_title(document, data["reportType"], is_karnataka)
    metadata = document.add_table(rows=1, cols=2)
    metadata.alignment = WD_TABLE_ALIGNMENT.CENTER
    ref_text = f"Ref: {str(data['details'].get('referenceNumber') or '').strip()}" if is_karnataka else ""
    _cell_text(metadata.cell(0, 0), ref_text, size=9)
    _cell_text(metadata.cell(0, 1), f"Date: {display_date(data['reportDate'])}", size=9, align=WD_ALIGN_PARAGRAPH.RIGHT)
    for cell in metadata.rows[0].cells:
        _set_width(cell, 3.37)
    borders = metadata._tbl.tblPr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        metadata._tbl.tblPr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "nil")
        borders.append(node)
    _project_table(document, data)
    _works_table(document, data, template=template)
    _certificate(document, data, template=template)
    if is_karnataka:
        _bank_page(document, data, template=template)
    photo = document.add_paragraph()
    photo.paragraph_format.page_break_before = True
    photo.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = photo.add_run("PROPERTY PHOTOGRAPHS")
    run.bold = True
    run.font.name = "Arial"
    run.font.size = Pt(11)
    return document


def generate_progress_template(payload: Mapping[str, Any], report_type: str) -> bytes:
    """Build a fillable report with known project data and blank assessment results."""
    components = [{
        "label": str(component.get("label") or ""),
        "estimatedCost": _number(component.get("estimatedCost"), "Estimated cost"),
    } for component in payload.get("components") or []]
    if not components:
        raise ValueError("The linked estimation report has no component estimates.")
    data = {
        "institution": payload["institution"], "linked": payload.get("linkedEstimation") or {},
        "details": {}, "bank": {}, "components": components, "reportType": report_type,
        "reportDate": "", "visitDate": "", "worksTotal": None, "materialsAtSite": None,
        "totalValue": None, "photos": [],
    }
    stream = BytesIO()
    _document(data, template=True).save(stream)
    return stream.getvalue()


def generate_progress_report(payload: Mapping[str, Any], output_path: str | Path | None = None) -> GeneratedProgressReport:
    data = _validate(payload)
    document = _document(data)
    stream = BytesIO()
    document.save(stream)
    temporary = Path(output_path) if output_path else None
    if temporary is None:
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(suffix=".docx", delete=False) as handle:
            temporary = Path(handle.name)
        temporary.write_bytes(stream.getvalue())
        remove_after = True
    else:
        temporary.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_bytes(stream.getvalue())
        remove_after = False
    try:
        insert_uploaded_media(temporary, data["photos"], data["map"])
        content = temporary.read_bytes()
    finally:
        if remove_after:
            temporary.unlink(missing_ok=True)
    applicant = data["linked"].get("applicantName") or data["reportType"]
    file_name = f"{_safe_name(applicant)}_{data['reportType'].title()}_Report.docx"
    summary = _summary(data)
    return GeneratedProgressReport(content, file_name, data["reportType"], summary)


def _summary(data):
    return {
        "linkedEstimationId": str(data["linked"].get("taskId") or ""),
        "reportType": data["reportType"],
        "reportDate": data["reportDate"],
        "visitDate": data["visitDate"],
        "components": data["components"],
        "worksTotal": data["worksTotal"],
        "materialsAtSite": data["materialsAtSite"],
        "totalValue": data["totalValue"],
    }

def retrospective_summary(draft, report_type, linked_task_code):
    components = [
        {key: item.get(key) for key in ("label", "estimatedCost", "completionPercent")}
        | ({"completedCost": item.get("completedCost")} if item.get("manualCompleted") else {})
        for item in (draft.get("components") or [])
    ]
    data = _validate({
        **draft,
        "components": components,
        "requestedReportType": report_type,
        "linkedEstimation": {"taskId": linked_task_code},
    }, require_media=False)
    return _summary(data)
