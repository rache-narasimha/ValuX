"""High-level generators for general and agricultural valuation reports."""

from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from docx.text.paragraph import Paragraph
from lxml import etree

from .calculations import agricultural_replacements, calculated_replacements
from .config import AGRICULTURAL_TEMPLATE, NS, TEMPLATE, qn
from .formatting import amount_in_words, document_indexes, normalized_document_values
from .media import insert_uploaded_media
from .ooxml import (
    prepare_floor_rows,
    prepare_general_document_rows,
    prepare_general_party_rows,
    replace_plain_tokens,
    replace_sdt_text,
    set_paragraph_text,
)

def normalize_agricultural_typography(docx_path):
    document = Document(docx_path)

    document.styles["Normal"].font.name = "Trebuchet MS"

    def normalize_paragraph(paragraph, in_table=False):
        if in_table:
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.0
        for run in paragraph.runs:
            run.font.name = "Trebuchet MS"
            run_properties = run._element.get_or_add_rPr()
            fonts = run_properties.find(qn("rFonts"))
            if fonts is None:
                fonts = etree.SubElement(run_properties, qn("rFonts"))
            for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                fonts.set(qn(attribute), "Trebuchet MS")

    for paragraph in document.paragraphs:
        normalize_paragraph(paragraph)

    format_label = next((paragraph for paragraph in document.paragraphs
                         if paragraph.text.strip() == "Format-B"), None)
    if format_label is not None:
        format_label.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        format_label.paragraph_format.left_indent = None
        format_label.paragraph_format.right_indent = None
        format_label.paragraph_format.first_line_indent = None
        format_label.paragraph_format.space_after = Pt(0)
        format_label.paragraph_format.keep_together = True

    for table_index, table in enumerate(document.tables):
        for row in table.rows:
            if table_index < 2:
                row_properties = row._tr.get_or_add_trPr()
                if row_properties.find(qn("cantSplit")) is None:
                    etree.SubElement(row_properties, qn("cantSplit"))
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    normalize_paragraph(paragraph, in_table=True)

    if document.tables:
        for row in document.tables[0].rows:
            row_number = row.cells[0].text.strip()
            if row_number not in {"4(a).", "4(b)."}:
                continue
            for paragraph in row.cells[-1].paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(10)

    if len(document.tables) > 2:
        for row in document.tables[2].rows:
            row_properties = row._tr.get_or_add_trPr()
            if row_properties.find(qn("cantSplit")) is None:
                etree.SubElement(row_properties, qn("cantSplit"))

    if len(document.tables) > 3 and len(document.tables[3].rows) > 1:
        summary_cell = document.tables[3].rows[1].cells[2]
        for paragraph in summary_cell.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(9)
    if document.tables:
        for row in document.tables[0].rows:
            if "Name of the owner(s)" not in " ".join(cell.text for cell in row.cells):
                continue
            value_cell = row.cells[-1]
            for paragraph in value_cell.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(10)
    document.save(docx_path)

def finalize_agricultural_pagination(docx_path):
    document = Document(docx_path)

    def remove_empty_paragraphs_before(paragraph):
        previous = paragraph._p.getprevious()
        while previous is not None and previous.tag == qn("p"):
            if "".join(previous.itertext()).strip() or previous.xpath(".//w:drawing"):
                break
            candidate = previous.getprevious()
            previous.getparent().remove(previous)
            previous = candidate

    photo = next((paragraph for paragraph in document.paragraphs
                  if paragraph.text.strip().startswith("PROPERTY PHOTOGRAPHS")), None)
    if photo is not None:
        remove_empty_paragraphs_before(photo)
    map_index = next((index for index, paragraph in enumerate(document.paragraphs)
                      if paragraph.text.strip().startswith("LOCATION MAP")), None)
    declaration_index = next((index for index, paragraph in enumerate(document.paragraphs)
                              if paragraph.text.strip() == "DECLARATION FROM VALUER"), None)
    if map_index is not None and declaration_index is not None and declaration_index > map_index:
        declaration = document.paragraphs[declaration_index]
        for paragraph in list(document.paragraphs[map_index + 1:declaration_index]):
            if not paragraph.text.strip() and not paragraph._p.xpath(".//w:drawing"):
                paragraph._p.getparent().remove(paragraph._p)
        declaration.paragraph_format.page_break_before = True

    # Word and LibreOffice paginate a page-break-before paragraph following the
    # declaration table differently.  The template already finishes that table
    # at a page boundary, so retaining the additional break creates a blank page
    # in the PDF preview even though Microsoft Word suppresses it.
    model_code = next((paragraph for paragraph in document.paragraphs
                       if paragraph.text.strip() == "MODEL CODE OF CONDUCT FOR VALUERS"), None)
    if model_code is not None:
        remove_empty_paragraphs_before(model_code)
        model_code.paragraph_format.page_break_before = True
        model_code.paragraph_format.keep_with_next = True
        next_element = model_code._p.getnext()
        kept = 0
        while next_element is not None and kept < 2:
            if next_element.tag == qn("p"):
                following = Paragraph(next_element, model_code._parent)
                following.paragraph_format.keep_with_next = True
                kept += 1
            next_element = next_element.getnext()
    document.save(docx_path)

def generate_agricultural_docx(values, output_path, photos=None, map_image=None):
    values = normalized_document_values(values)
    replacements = agricultural_replacements(values)
    replace_plain_tokens(AGRICULTURAL_TEMPLATE, output_path, replacements, len(document_indexes(values)))
    normalize_agricultural_typography(output_path)
    insert_uploaded_media(output_path, photos or [], map_image)
    finalize_agricultural_pagination(output_path)

def generate_docx(values, output_path, photos=None, map_image=None):
    values = normalized_document_values(values)
    replacements, pmv_text, realizable_text, distress_text = calculated_replacements(values)
    if values.get("bank.name"):
        replacements["BANK_NAME"] = values["bank.name"]
        replacements["BANK_NAME_UPPER"] = values["bank.name"].upper()
    if values.get("bank.branch"):
        replacements["BRANCH_NAME"] = values["bank.branch"]

    with ZipFile(TEMPLATE) as zin, ZipFile(output_path, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                prepare_general_document_rows(root, values)
                prepare_general_party_rows(root)
                prepare_floor_rows(root, values)
                for sdt in root.xpath(".//w:sdt", namespaces=NS):
                    tags = sdt.xpath("./w:sdtPr/w:tag/@w:val", namespaces=NS)
                    if tags and tags[0] in replacements:
                        replace_sdt_text(sdt, str(replacements[tags[0]]))
                pmv_words = amount_in_words(pmv_text)
                realizable_words = amount_in_words(realizable_text)
                for paragraph in root.xpath(".//w:body/w:p", namespaces=NS):
                    text_value = "".join(paragraph.xpath(".//w:t/text()", namespaces=NS)).strip()
                    if text_value.startswith("(Rupees Fifty"):
                        set_paragraph_text(paragraph, f"(Rupees {pmv_words} only)", color="0000FF")
                    elif text_value.startswith("CONCLUSION :"):
                        set_paragraph_text(paragraph, "CONCLUSION :As a result of my appraisal and analysis it is my considered opinion that "
                                           f"the present market value of the above property in the prevailing condition with aforesaid "
                                           f"specification is Rs.{pmv_text} (Rupees {pmv_words} only).")
                    elif text_value.startswith("Realizable Value"):
                        set_paragraph_text(paragraph, f"Realizable Value\t\t: 10% less than the Present Market Value i.e. Rs.{realizable_text}")
                    elif text_value.startswith("Distress Value"):
                        set_paragraph_text(paragraph, f"Distress Value \t\t: 20% less than the Present Market Value i.e. Rs.{distress_text}")
                    elif text_value == "Date   : 24-09-2026.":
                        set_paragraph_text(paragraph, f"Date   : {replacements.get('VALUATION_DATE', '')}.")
                    elif text_value.startswith("Place") and "Encl." in text_value:
                        set_paragraph_text(paragraph, f"Place    : Adoni,\nDate     : {replacements.get('VALUATION_DATE', '')}.\nEncl.     : Detailed Report.")
                    elif text_value.startswith("The undersigned has inspected"):
                        ack = (f"The undersigned has inspected the property detailed in the Valuation Report dated "
                               f"{replacements.get('VALUATION_DATE', '')} on {replacements.get('INSPECTION_DATE', '')}.\n"
                               f"We are satisfied that the fair and reasonable market value of the property is Rs.{pmv_text}\n"
                               f"(Rupees {pmv_words} only)\n"
                               f"and the realizable value of the property is Rs.{realizable_text}\n"
                               f"(Rupees {realizable_words} only)")
                        set_paragraph_text(paragraph, ack)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)
    insert_uploaded_media(output_path, photos or [], map_image)
