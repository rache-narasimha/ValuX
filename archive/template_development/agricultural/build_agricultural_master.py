from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.text.paragraph import Paragraph
from docx.shared import Inches, Pt
from docx.oxml.ns import qn


FONT = "Trebuchet MS"
BLACK = "000000"


def set_run_font(run, size=None, bold=None, color=BLACK):
    run.font.name = FONT
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:ascii"), FONT)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:hAnsi"), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    run.font.color.rgb = None
    color_node = run._element.get_or_add_rPr().find(qn("w:color"))
    if color_node is None:
        color_node = OxmlElement("w:color")
        run._element.get_or_add_rPr().append(color_node)
    color_node.set(qn("w:val"), color)


def clear_paragraph(paragraph):
    for child in list(paragraph._p):
        if child.tag != qn("w:pPr"):
            paragraph._p.remove(child)


def replace_paragraph(paragraph, text, size=None, bold=None, align=None):
    original = paragraph.runs[0] if paragraph.runs else None
    inherited_size = original.font.size.pt if original and original.font.size else size
    inherited_bold = original.bold if original and original.bold is not None else bold
    clear_paragraph(paragraph)
    run = paragraph.add_run(text)
    set_run_font(run, size=inherited_size or size or 10, bold=inherited_bold)
    if align is not None:
        paragraph.alignment = align
    return paragraph


def set_cell(cell, text, size=10, align=WD_ALIGN_PARAGRAPH.LEFT):
    paragraph = cell.paragraphs[0]
    replace_paragraph(paragraph, text, size=size, align=align)
    for extra in list(cell.paragraphs[1:]):
        extra._element.getparent().remove(extra._element)


def insert_after(paragraph, text, page_break_before=False, size=12, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER):
    new_p = OxmlElement("w:p")
    paragraph._p.addnext(new_p)
    created = Paragraph(new_p, paragraph._parent)
    created.paragraph_format.page_break_before = page_break_before
    replace_paragraph(created, text, size=size, bold=bold, align=align)
    return created


def find_paragraph(document, startswith):
    return next(p for p in document.paragraphs if p.text.strip().startswith(startswith))


def split_table_before_row(table, row_index):
    """Split a table at a row and place the continuation on a new page."""
    source = table._tbl
    continuation = OxmlElement("w:tbl")
    if source.tblPr is not None:
        continuation.append(deepcopy(source.tblPr))
    grid = source.find(qn("w:tblGrid"))
    if grid is not None:
        continuation.append(deepcopy(grid))
    rows = list(source.findall(qn("w:tr")))
    for row in rows[row_index:]:
        continuation.append(row)

    page_break = OxmlElement("w:p")
    run = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    run.append(br)
    page_break.append(run)
    source.addnext(page_break)
    page_break.addnext(continuation)


def insert_page_break_before_table(table):
    page_break = OxmlElement("w:p")
    run = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    run.append(br)
    page_break.append(run)
    table._tbl.addprevious(page_break)


def build(input_path: Path, output_path: Path):
    document = Document(input_path)

    replace_paragraph(find_paragraph(document, "(Name & address of Valuer)"), "{{VALUER_NAME_ADDRESS}}", size=10, bold=True, align=WD_ALIGN_PARAGRAPH.RIGHT)
    replace_paragraph(find_paragraph(document, "UNION BANK OF INDIA"), "{{BANK_NAME_UPPER}}", size=11)
    replace_paragraph(find_paragraph(document, "BRANCH:"), "BRANCH: {{BRANCH_NAME}}", size=11)

    general = document.tables[0]
    set_cell(general.cell(1, 5), "{{VALUATION_PURPOSE}}")
    set_cell(general.cell(2, 5), "{{INSPECTION_DATE}}")
    set_cell(general.cell(3, 5), "{{VALUATION_DATE}}")
    for row, index in ((5, 1), (6, 2), (7, 3)):
        set_cell(general.cell(row, 1), f"{{{{DOCUMENT_{index}_TYPE}}}}")
        set_cell(general.cell(row, 5), f"{{{{DOCUMENT_{index}_DETAILS}}}}")
    values = {
        8: "{{OWNER_DETAILS}}", 9: "{{PROPERTY_DESCRIPTION}}", 11: "{{SURVEY_NUMBER}}",
        12: "{{DOOR_NUMBER}}", 13: "{{VILLAGE}}", 14: "{{TALUKA}}",
        15: "{{MANDAL_DISTRICT}}", 16: "{{POSTAL_ADDRESS}}", 17: "{{LOCAL_AUTHORITY}}",
        18: "{{ENACTMENT_STATUS}}", 19: "{{CONVERSION_CONTEMPLATED}}", 31: "{{SITE_EXTENT}}",
        32: "{{COORDINATES}}", 33: "{{VALUATION_EXTENT}}", 34: "{{OCCUPATION_DETAILS}}",
        35: "{{ANNUAL_INCOME}}", 37: "{{CULTIVATION_SUITABLE}}", 38: "{{IRRIGATION_FACILITIES}}",
        39: "{{FLOODING_RISK}}", 40: "{{TOPOGRAPHY}}", 41: "{{LAND_SHAPE}}",
        42: "{{LAND_LOCKED}}", 43: "{{EXISTING_BUILDINGS}}", 44: "{{FENCING_GATES}}",
        45: "{{LAND_CONDITION}}", 46: "{{SOIL_QUALITY}}", 47: "{{ROAD_ACCESS}}",
        48: "{{CROPS_GROWN}}", 49: "{{WATER_ELECTRICITY}}", 51: "{{ADVANTAGE_1}}",
        52: "{{ADVANTAGE_2}}", 54: "{{DISADVANTAGE_1}}", 55: "{{DISADVANTAGE_2}}",
        56: "{{SPECIAL_REMARKS}}",
    }
    for row, token in values.items():
        set_cell(general.cell(row, 5), token)

    directions = ("NORTH", "SOUTH", "EAST", "WEST")
    for offset, direction in enumerate(directions):
        row = 21 + offset
        set_cell(general.cell(row, 1), f"{direction.title()} : {{{{BOUNDARY_DEED_{direction}}}}}")
        set_cell(general.cell(row, 5), f"{{{{BOUNDARY_ACTUAL_{direction}}}}}")
        dimension_row = 27 + offset
        short_direction = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W"}[direction]
        set_cell(general.cell(dimension_row, 5), f"{{{{DIM_DEED_{short_direction}}}}}", size=9)
        set_cell(general.cell(dimension_row, 6), f"{{{{DIM_ACTUAL_{short_direction}}}}}", size=9)

    valuation = document.tables[1]
    set_cell(valuation.cell(2, 3), "{{SIZE_NORTH_SOUTH}}")
    set_cell(valuation.cell(3, 3), "{{SIZE_EAST_WEST}}")
    set_cell(valuation.cell(4, 3), "{{TOTAL_EXTENT}}")
    set_cell(valuation.cell(5, 3), "{{PREVAILING_RATE}}")
    set_cell(valuation.cell(6, 3), "{{GUIDELINE_RATE}}")
    set_cell(valuation.cell(7, 3), "{{ADOPTED_RATE}}")
    set_cell(valuation.cell(8, 3), "{{ESTIMATED_VALUE}}")

    conclusion = document.tables[2].cell(0, 0)
    conclusion_text = (
        "As a result of my appraisal and analysis, it is my considered opinion that the present fair market value "
        "of the above property in the prevailing condition with aforesaid specifications is Rs. {{ESTIMATED_VALUE}} "
        "(Rupees {{ESTIMATED_VALUE_WORDS}} only). The book value of the above property as of {{REPORT_DATE}} "
        "(Report date) is Rs. {{BOOK_VALUE}} (Rupees {{BOOK_VALUE_WORDS}} only) and the distress value is "
        "Rs. {{DISTRESS_VALUE}} (Rupees {{DISTRESS_VALUE_WORDS}} only)."
    )
    replace_paragraph(conclusion.paragraphs[0], conclusion_text, size=10)

    photos = find_paragraph(document, "Photos Route Map")
    photos.paragraph_format.page_break_before = True
    replace_paragraph(photos, "PROPERTY PHOTOGRAPHS\n{{PROPERTY_PHOTOGRAPHS}}", size=12, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    route = insert_after(photos, "ROUTE MAP\n{{ROUTE_MAP}}", page_break_before=True)
    declaration = find_paragraph(document, "DECLARATION FROM VALUER")

    replace_paragraph(find_paragraph(document, "The information furnished in my Valuation Report"),
                      "The information furnished in my Valuation Report dt.{{REPORT_DATE}} is true and correct to the best of my knowledge and belief and I have made an impartial and true valuation of the property.", size=10)
    replace_paragraph(find_paragraph(document, "I have personally inspected"),
                      "I have personally inspected the right property on {{INSPECTION_DATE}}. The work is not sub contracted to any other valuer and carried-out by myself.", size=10)

    disclosure = document.tables[3]
    set_cell(disclosure.cell(1, 2), "{{DOCUMENTS_SUMMARY}}", size=9)
    set_cell(disclosure.cell(2, 2), "{{VALUATION_PURPOSE}}", size=9)
    set_cell(disclosure.cell(3, 2), "{{VALUER_NAME}}", size=9)
    date_cell = disclosure.cell(5, 2)
    set_cell(date_cell, "{{ASSIGNMENT_DATE}}\n{{VALUATION_DATE}}\n{{REPORT_DATE}}", size=9)
    set_cell(disclosure.cell(11, 2),
             "1. This report is issued to {{BANK_NAME}}, {{BRANCH_NAME}}. This report is not to be referred to anybody including the owner for any other purpose.\n"
             "2. The bank is requested to accept only the original copy of this report.\n"
             "3. Value varies with the purpose. It is a function of place, purpose and date. This certified value holds good as on the date of valuation and for the specific purpose mentioned in the report.",
             size=9)

    overflow = disclosure.cell(8, 1).paragraphs[0]
    overflow.paragraph_format.left_indent = Pt(0)
    overflow.paragraph_format.first_line_indent = Pt(0)
    overflow.paragraph_format.right_indent = Pt(0)

    declaration_date = replace_paragraph(
        find_paragraph(document, "Date : 06-07-2026"),
        "Date : {{REPORT_DATE}}\tSignature",
        size=10,
    )
    declaration_date.paragraph_format.tab_stops.add_tab_stop(Inches(4.65), WD_TAB_ALIGNMENT.CENTER)
    declaration_place = replace_paragraph(
        find_paragraph(document, "Place : Adoni"),
        "Place : {{REPORT_PLACE}}\t(Name of the Approved Valuer\n\t& seal of the firm / company)",
        size=10,
    )
    declaration_place.paragraph_format.tab_stops.add_tab_stop(Inches(4.65), WD_TAB_ALIGNMENT.CENTER)
    replace_paragraph(find_paragraph(document, "Date  : 06-07-2026"),
                      "Date : {{REPORT_DATE}}\t\t\tSIGNATURE OF VALUER", size=10)
    replace_paragraph(find_paragraph(document, "Place : Adoni."), "Place : {{REPORT_PLACE}}", size=10)

    # The reference ends with a styled empty paragraph that can spill onto a
    # completely blank page after rendering. It carries no content or layout
    # value, so remove trailing empty body paragraphs after the final place line.
    while document.paragraphs and not document.paragraphs[-1].text.strip():
        trailing = document.paragraphs[-1]
        trailing._element.getparent().remove(trailing._element)

    model_code = find_paragraph(document, "MODEL CODE OF CONDUCT FOR VALUERS")
    model_code.paragraph_format.page_break_before = True
    model_code.paragraph_format.keep_with_next = True

    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            if "{{" in run.text or paragraph.text.strip() in {
                "VALUATION REPORT (IN RESPECT OF AGRICULTURAL LANDS)",
                "DECLARATION FROM VALUER",
                "MODEL CODE OF CONDUCT FOR VALUERS",
            }:
                set_run_font(run, size=run.font.size.pt if run.font.size else None, bold=run.bold)

    # Word does not reliably honor paragraph page breaks inside the merged
    # cells of Field 12. Split the table immediately before Field 12 and use a
    # real page break so its heading, subheading and dimension rows begin
    # together on page 2 in both Word and LibreOffice.
    split_table_before_row(general, 25)

    # Keep the agricultural valuation heading with its rows instead of
    # leaving the heading orphaned at the bottom of page 2.
    insert_page_break_before_table(valuation)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.input, args.output)
