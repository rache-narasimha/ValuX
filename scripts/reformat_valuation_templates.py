"""Normalize the two production valuation DOCX masters in place."""

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = {
    "general": ROOT / "resources/general/master_template.docx",
    "agricultural": ROOT / "resources/agricultural/master_template.docx",
}
FONT = "Calibri"


def set_run_font(run, size=11, bold=None, color=None):
    run.font.name = FONT
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:ascii"), FONT)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:hAnsi"), FONT)
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = color


def style_paragraph(paragraph, size=11, bold=None):
    paragraph.paragraph_format.space_after = Pt(2)
    paragraph.paragraph_format.line_spacing = 1.0
    for run in paragraph.runs:
        set_run_font(run, size, bold)


def repeat_row(row):
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:tblHeader")) is None:
        header = OxmlElement("w:tblHeader")
        header.set(qn("w:val"), "true")
        tr_pr.append(header)


def keep_row_together(row):
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:cantSplit")) is None:
        tr_pr.append(OxmlElement("w:cantSplit"))


def prepend_section_row(table, title):
    if " ".join(table.rows[0].cells[0].text.split()) == title:
        repeat_row(table.rows[0])
        keep_row_together(table.rows[0])
        return
    row = table.add_row()
    table._tbl.remove(row._tr)
    table._tbl.insert(1, row._tr)
    cell = row.cells[0]
    for other in row.cells[1:]:
        cell = cell.merge(other)
    paragraph = row.cells[0].paragraphs[0]
    paragraph.text = title
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_paragraph(paragraph, 12, True)
    repeat_row(row)
    keep_row_together(row)


def replace_paragraph_text(paragraph, text, size=11, bold=None):
    paragraph.clear()
    run = paragraph.add_run(text)
    set_run_font(run, size, bold)


def keep_block(document, start_text, end_text, page_break=True):
    active = False
    block = []
    for paragraph in document.paragraphs:
        text = " ".join(paragraph.text.split())
        if text.startswith(start_text):
            active = True
            if page_break:
                paragraph.paragraph_format.page_break_before = True
        if active:
            block.append(paragraph)
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.space_after = Pt(1)
        if active and text.startswith(end_text):
            break
    for paragraph in block[:-1]:
        paragraph.paragraph_format.keep_with_next = True


def compact_block(document, start_text, end_text):
    active = False
    removable = []
    for paragraph in document.paragraphs:
        text = " ".join(paragraph.text.split())
        if text.startswith(start_text):
            active = True
        if active:
            paragraph.paragraph_format.page_break_before = False
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.space_before = Pt(0)
            paragraph.paragraph_format.space_after = Pt(1)
            paragraph.paragraph_format.line_spacing = 1.0
            if not text:
                removable.append(paragraph._p)
        if active and text.startswith(end_text):
            break
    for element in removable:
        element.getparent().remove(element)
    keep_block(document, start_text, end_text, page_break=False)


def normalize_document(document):
    for section in document.sections:
        section.top_margin = Mm(15)
        section.bottom_margin = Mm(15)
        section.left_margin = Mm(16)
        section.right_margin = Mm(16)
    normal = document.styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    normal.font.size = Pt(11)
    for paragraph in document.paragraphs:
        text = " ".join(paragraph.text.split())
        size = 13 if text in {"VALUATION REPORT", "DECLARATION:", "DECLARATION FROM VALUER"} else 12 if (
            text.isupper() and len(text) < 100
        ) else 11
        style_paragraph(paragraph, size, True if size >= 12 else None)
    for table in document.tables:
        for row in table.rows:
            keep_row_together(row)
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    style_paragraph(paragraph, 11)


def general():
    # The rebuilt general master owns its section tables, margins and page
    # boundaries. Do not apply the legacy table indexes or combine the bank
    # manager acknowledgment with the valuer declaration.
    path = TEMPLATES["general"]
    document = Document(path)
    for run in document.element.iter(qn("w:r")):
        properties = run.find(qn("w:rPr"))
        if properties is None:
            continue
        fonts = properties.find(qn("w:rFonts"))
        if fonts is not None:
            for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                fonts.set(qn("w:" + attribute), FONT)
    document.save(path)


def agricultural():
    path = TEMPLATES["agricultural"]
    document = Document(path)
    normalize_document(document)
    for table in document.tables:
        repeat_row(table.rows[0])
    further = next(
        (paragraph for paragraph in document.paragraphs if paragraph.text.strip().startswith("Further, I hereby provide")),
        None,
    )
    if further is not None:
        parent = further._p.getparent()
        body = list(parent)
        further_index = body.index(further._p)
        information_table_index = next(
            (index for index in range(further_index + 1, len(body)) if body[index].tag == qn("w:tbl")),
            None,
        )
        declaration_date = None
        declaration_place = None
        if information_table_index is not None:
            for element in body[information_table_index + 1 :]:
                if element.tag != qn("w:p"):
                    continue
                text = " ".join("".join(element.xpath(".//w:t/text()" )).split())
                if text.startswith("MODEL CODE OF CONDUCT"):
                    break
                if declaration_date is None and text.startswith("Date :"):
                    declaration_date = element
                elif declaration_place is None and text.startswith("Place :"):
                    declaration_place = element
                if declaration_date is not None and declaration_place is not None:
                    break
        if declaration_date is not None and declaration_place is not None:
            parent.remove(declaration_date)
            parent.remove(declaration_place)
            position = parent.index(further._p)
            parent.insert(position, declaration_date)
            parent.insert(position + 1, declaration_place)
        further.paragraph_format.page_break_before = True
    keep_block(document, "DECLARATION FROM VALUER", "(Name of the Approved Valuer & seal of the firm /company)", page_break=True)
    keep_block(document, "MODEL CODE OF CONDUCT FOR VALUERS", "Place : {{REPORT_PLACE}}", page_break=True)
    path.unlink(missing_ok=True)
    document.save(path)


if __name__ == "__main__":
    general()
    agricultural()
