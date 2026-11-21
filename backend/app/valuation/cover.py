"""Cover-page construction notes for General Valuation and Revaluation."""

from docx.shared import Pt
from lxml import etree

from .config import qn
from .construction import cover_notes, note_amount


def add_construction_notes(document, values, calculated):
    notes = cover_notes(values, calculated)
    if not notes:
        return
    enclosure = next((p for p in document.paragraphs if p.text.startswith("Enclosure:")), None)
    if enclosure is None:
        raise ValueError("The valuation cover is missing its enclosure position.")
    columns = 2 if len(notes) > 8 else 1
    rows = (len(notes) + columns - 1) // columns
    table = document.add_table(rows=rows, cols=columns)
    table.autofit = False
    width = document.sections[0].page_width - document.sections[0].left_margin - document.sections[0].right_margin
    for column in table.columns:
        column.width = width // columns
    properties = table._tbl.tblPr
    borders = etree.SubElement(properties, qn("tblBorders"))
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        etree.SubElement(borders, qn(edge)).set(qn("val"), "nil")
    # Fill down each column so numbering follows natural reading order.
    for index, (label, amount) in enumerate(notes):
        row_index, column_index = index % rows, index // rows
        cell = table.cell(row_index, column_index)
        paragraph = cell.paragraphs[0]
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.paragraph_format.line_spacing = 1
        paragraph.paragraph_format.keep_together = True
        paragraph.paragraph_format.keep_with_next = row_index < rows - 1
        remark = label == "Construction work not commenced yet."
        text = f"{'Note: ' if index == 0 else ''}{index + 1}. {label}"
        if not remark:
            text += f": {note_amount(amount)}"
        run = paragraph.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(11)
    for row in table.rows:
        etree.SubElement(row._tr.get_or_add_trPr(), qn("cantSplit"))
    enclosure.paragraph_format.space_after = Pt(5)
    enclosure.paragraph_format.keep_with_next = True
    enclosure._p.addnext(table._tbl)
    # Compact only the existing cover's paragraph gaps, keeping its type sizes.
    # The detailed report retains its explicit page boundary and original spacing.
    for paragraph in document.paragraphs:
        if paragraph is enclosure or paragraph._p is enclosure._p:
            break
        if paragraph.paragraph_format.space_after and paragraph.paragraph_format.space_after.pt > 5:
            paragraph.paragraph_format.space_after = Pt(5)
