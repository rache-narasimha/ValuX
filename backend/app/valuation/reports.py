"""High-level generators for general and agricultural valuation reports."""

from zipfile import ZIP_DEFLATED, ZipFile
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.shared import Mm, Pt
from docx.text.paragraph import Paragraph
from lxml import etree

from .calculations import agricultural_replacements, calculated_replacements
from .config import AGRICULTURAL_TEMPLATE, NS, SOFFICE, TEMPLATE, qn
from .formatting import valuation_amount_in_words, document_indexes, normalized_document_values
from .media import insert_uploaded_media
from .ooxml import (
    prepare_floor_rows,
    prepare_general_document_rows,
    prepare_general_party_rows,
    relabel_revaluation,
    replace_plain_tokens,
    replace_sdt_text,
    set_paragraph_text,
    unwrap_content_controls,
)

def keep_table_opening_together(document):
    """Keep each report table's opening row and its first detail row together."""
    for table in document.tables:
        if len(table.rows) < 2:
            continue
        for index, row in enumerate(table.rows[:2]):
            properties = row._tr.get_or_add_trPr()
            if properties.find(qn("cantSplit")) is None:
                etree.SubElement(properties, qn("cantSplit"))
            if index == 0:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        paragraph.paragraph_format.keep_with_next = True


def normalize_agricultural_typography(docx_path):
    document = Document(docx_path)

    document.styles["Normal"].font.name = "Calibri"
    document.styles["Normal"].font.size = Pt(11)

    def normalize_paragraph(paragraph, in_table=False):
        if in_table:
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.0
        for run in paragraph.runs:
            run.font.name = "Calibri"
            run_properties = run._element.get_or_add_rPr()
            fonts = run_properties.find(qn("rFonts"))
            if fonts is None:
                fonts = etree.SubElement(run_properties, qn("rFonts"))
            for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                fonts.set(qn(attribute), "Calibri")
            size = run.font.size.pt if run.font.size else 11
            run.font.size = Pt(13 if size > 12 else 12 if size > 11 else 11)

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

    if len(document.tables) > 2:
        for row in document.tables[2].rows:
            row_properties = row._tr.get_or_add_trPr()
            if row_properties.find(qn("cantSplit")) is None:
                etree.SubElement(row_properties, qn("cantSplit"))

    keep_table_opening_together(document)
    align_signature_fields(document)
    document.save(docx_path)


def align_signature_fields(document):
    """Keep Place/Date left and signatures centred near the 14 cm ruler mark."""
    section = document.sections[0]
    usable_width = section.page_width - section.left_margin - section.right_margin
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            # A merged cell can be exposed more than once by python-docx.
            cells = {id(cell._tc): cell for cell in row.cells}
            paragraphs.extend(paragraph for cell in cells.values() for paragraph in cell.paragraphs)
    for paragraph in paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        if text.startswith(("Date", "Place")) and ("Signature" in text or "SIGNATURE" in text):
            left, right = re.split(r"(?i)(?=signature)", text, maxsplit=1)
            paragraph.text = f"{left.strip()}\t{right.strip()}"
        elif text.startswith("Place") and "(Name of the Approved Valuer" in text:
            left, right = text.split("(Name of the Approved Valuer", 1)
            right = " ".join(right.split()).replace("/company", "/ company")
            paragraph.text = f"{left.strip()}\t(Name of the Approved Valuer\n\t{right}"
        if "\t" in paragraph.text and text.startswith(("Date", "Place")):
            fmt = paragraph.paragraph_format
            fmt.tab_stops.clear_all()
            fmt.tab_stops.add_tab_stop(Mm(140), WD_TAB_ALIGNMENT.CENTER)
            fmt.left_indent = fmt.right_indent = Mm(0)
            fmt.first_line_indent = Mm(0)
            paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
        elif text.lower().startswith("signature") or text.startswith(("(Name and Official Seal", "(Name of the Branch Manager")):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.left_indent = Mm(110)
            paragraph.paragraph_format.right_indent = max(0, usable_width - Mm(170))
        elif text.startswith(("Date", "Place")):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
            paragraph.paragraph_format.left_indent = Mm(0)
        else:
            continue
        for run in paragraph.runs:
            run.font.name = "Calibri"
            run.font.size = Pt(11)


def normalize_word_package(docx_path):
    """Re-export the completed general report with the established Word-safe filter.

    This must run after filling controls and inserting media. The office filter
    removes legacy package residue, so the same finalization serves both app
    reports and blank offline templates.
    """
    # Filled reports no longer need automation wrappers. Cloned controls can
    # retain duplicate IDs, and their removal also avoids office-version
    # differences in interpreting control content during compatibility export.
    unwrap_content_controls(docx_path)
    with tempfile.TemporaryDirectory(prefix="valuation-word-") as temporary:
        temporary = Path(temporary)
        source = temporary / "source.docx"
        destination = temporary / "normalized"
        destination.mkdir()
        shutil.copyfile(docx_path, source)
        result = subprocess.run(
            [SOFFICE, f"-env:UserInstallation={(temporary / 'profile').as_uri()}",
             "--headless", "--convert-to", "docx:Office Open XML Text",
             "--outdir", str(destination), str(source)],
            capture_output=True, timeout=120, check=False,
        )
        normalized = destination / source.name
        if result.returncode or not normalized.is_file():
            raise ValueError("The Word report could not be prepared. Please try again.")
        shutil.copyfile(normalized, docx_path)


def set_construction_heading(paragraph, proposed):
    set_paragraph_text(paragraph, "Specifications of construction", color="000000", preserve_style=True)
    if not proposed:
        return
    run = etree.SubElement(paragraph, qn("r"))
    properties = etree.SubElement(run, qn("rPr"))
    etree.SubElement(properties, qn("b"))
    color = etree.SubElement(properties, qn("color"))
    color.set(qn("val"), "FF0000")
    size = etree.SubElement(properties, qn("sz"))
    size.set(qn("val"), "24")
    text = etree.SubElement(run, qn("t"))
    text.text = " (Proposed)"
    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")

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
                              if paragraph.text.strip().casefold() == "declaration from valuer"), None)
    if declaration_index is not None:
        remove_empty_paragraphs_before(document.paragraphs[declaration_index])
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

def generate_agricultural_docx(values, output_path, photos=None, map_image=None, *, revaluation=False):
    values = normalized_document_values(values)
    replacements = agricultural_replacements(values)
    replace_plain_tokens(AGRICULTURAL_TEMPLATE, output_path, replacements, len(document_indexes(values)), revaluation=revaluation)
    normalize_agricultural_typography(output_path)
    insert_uploaded_media(output_path, photos or [], map_image, valuation_map=True)
    finalize_agricultural_pagination(output_path)


def generate_offline_template(report_key, output_path, *, revaluation=False):
    """Produce a fillable blank copy, never expose sample data in the engine master."""
    from .schemas import agricultural_schema_payload, schema_payload

    if report_key == "valuation-general":
        schema = schema_payload()
        fields = [*schema["setup_fields"], *schema["fields"]]
        generator = _generate_general_docx
    elif report_key == "valuation-agricultural":
        fields = agricultural_schema_payload()["fields"]
        generator = generate_agricultural_docx
    else:
        raise ValueError("Unsupported valuation template.")
    blank_values = {field["id"]: "" for field in fields}
    if report_key == "valuation-general":
        generator(blank_values, output_path, blank=True, revaluation=revaluation)
    else:
        generator(blank_values, output_path, revaluation=revaluation)

    # Offline copies contain editable blank cells, without automation IDs or
    # computed values left inside controls by the normal generator.
    unwrap_content_controls(output_path, clear=True)
    if report_key == "valuation-general":
        normalize_word_package(output_path)

def generate_docx(values, output_path, photos=None, map_image=None, *, revaluation=False):
    _generate_general_docx(values, output_path, photos, map_image, revaluation=revaluation)
    normalize_word_package(output_path)


def _generate_general_docx(values, output_path, photos=None, map_image=None, *, blank=False, revaluation=False):
    values = normalized_document_values(values)
    replacements, pmv_text, realizable_text, distress_text = calculated_replacements(values)
    replacements.update({
        "BANK_NAME": values.get("bank.name", ""),
        "BRANCH_NAME": values.get("bank.branch", ""),
        "OWNER_DETAILS": values.get("owner.details", ""),
        "VALUATION_DATE": replacements.get("VALUATION_DATE", ""),
        "INSPECTION_DATE": replacements.get("INSPECTION_DATE", ""),
        "PRESENT_MARKET_VALUE": pmv_text,
        "REALIZABLE_VALUE": realizable_text,
        "DISTRESS_VALUE": distress_text,
        "PMV_WORDS": valuation_amount_in_words(pmv_text),
        "REALIZABLE_WORDS": valuation_amount_in_words(realizable_text),
    })
    if blank:
        for token in ("BANK_NAME", "BRANCH_NAME", "OWNER_DETAILS", "VALUATION_DATE", "INSPECTION_DATE",
                      "PRESENT_MARKET_VALUE", "REALIZABLE_VALUE", "DISTRESS_VALUE"):
            replacements[token] = "________________"
        replacements["PMV_WORDS"] = replacements["REALIZABLE_WORDS"] = "________________________________"

    with ZipFile(TEMPLATE) as zin, ZipFile(output_path, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                prepare_general_document_rows(root, values)
                prepare_general_party_rows(root)
                prepare_floor_rows(root, values)
                if revaluation:
                    relabel_revaluation(root)
                for sdt in root.xpath(".//w:sdt", namespaces=NS):
                    tags = sdt.xpath("./w:sdtPr/w:tag/@w:val", namespaces=NS)
                    if tags and tags[0] in replacements:
                        replace_sdt_text(sdt, str(replacements[tags[0]]))
                for paragraph in root.xpath(".//w:p", namespaces=NS):
                    # Replace only tokens from the master. User-entered text is
                    # never normalized or searched again for further tokens.
                    for node in paragraph.xpath("./w:r/w:t", namespaces=NS):
                        original = node.text or ""
                        node.text = re.sub(r"\{\{([A-Z_]+)\}\}",
                                           lambda match: str(replacements.get(match[1], "")), original)
                    text_value = "".join(paragraph.xpath(".//w:t/text()", namespaces=NS))
                    if text_value.startswith("Specifications of construction"):
                        set_construction_heading(paragraph, values.get("property.status") == "proposed")
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)
    document = Document(output_path)
    keep_table_opening_together(document)
    document.save(output_path)
    insert_uploaded_media(output_path, photos or [], map_image, valuation_map=True)
