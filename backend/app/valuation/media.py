"""Uploaded-image normalization and Word document media layout."""

import base64
from io import BytesIO

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Inches, Mm, Pt
from lxml import etree
from PIL import Image, ImageOps

from .config import qn

def decode_image(data_url):
    if not data_url or "," not in data_url:
        return None
    return base64.b64decode(data_url.split(",", 1)[1])

def normalize_photo(raw, size=(1200, 900)):
    """Fit an entire image inside a fixed canvas without cropping or distortion."""
    image = ImageOps.exif_transpose(Image.open(BytesIO(raw))).convert("RGB")
    image = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, "white")
    canvas.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    output = BytesIO()
    canvas.save(output, "JPEG", quality=90, optimize=True)
    output.seek(0)
    return output

def fitted_photo(raw, max_width, max_height):
    """Return an EXIF-corrected image sized to fit a page cell without cropping."""
    image = ImageOps.exif_transpose(Image.open(BytesIO(raw))).convert("RGB")
    image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
    aspect = image.width / image.height
    width = min(max_width, max_height * aspect)
    height = width / aspect
    output = BytesIO()
    image.save(output, "JPEG", quality=88, optimize=True)
    output.seek(0)
    return output, width, height

def clear_paragraph(paragraph):
    for child in list(paragraph._p):
        if child.tag != qn("pPr"):
            paragraph._p.remove(child)

def insert_photo_table(document, after_element, photos, columns=3):
    rows = (len(photos) + columns - 1) // columns
    table = document.add_table(rows=rows, cols=columns)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    max_width = {1: 6.0, 2: 2.9, 3: 1.95}[columns]
    max_height = {1: 7.7, 2: 3.75, 3: 2.35, 4: 1.72}.get(rows, 1.72)
    cell_width = Inches({1: 6.15, 2: 3.05, 3: 2.03}[columns])
    for row in table.rows:
        tr_pr = row._tr.get_or_add_trPr()
        etree.SubElement(tr_pr, qn("cantSplit"))
        for cell in row.cells:
            cell.width = cell_width
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    for index, item in enumerate(photos):
        raw = decode_image(item.get("data"))
        if raw:
            stream, width, height = fitted_photo(raw, max_width, max_height)
            paragraph = table.cell(index // columns, index % columns).paragraphs[0]
            if item.get("is_map"):
                label = paragraph.add_run("LOCATION MAP\n")
                label.bold = True
            paragraph.add_run().add_picture(
                stream, width=Inches(width), height=Inches(height)
            )
    table_element = table._tbl
    table_element.getparent().remove(table_element)
    after_element.addnext(table_element)
    return table_element

def _valuation_media_table(document, anchor, items, *, map_slot=False):
    """Use 43 mm photo rows; a map occupies one merged three-by-two slot."""
    rows = 2 if map_slot else (len(items) + 2) // 3
    section = document.sections[0]
    width = section.page_width - section.left_margin - section.right_margin
    table = document.add_table(rows=rows, cols=3)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for column in table.columns:
        column.width = int(width / 3)
    for row in table.rows:
        row.height = Mm(43)
        row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        etree.SubElement(row._tr.get_or_add_trPr(), qn("cantSplit"))
        for cell in row.cells:
            cell.width = int(width / 3)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    if map_slot:
        table.cell(0, 0).merge(table.cell(1, 2))
    for index, item in enumerate(items):
        raw = decode_image(item.get("data"))
        if not raw:
            continue
        cell = table.cell(0, 0) if map_slot else table.cell(index // 3, index % 3)
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        paragraph.paragraph_format.line_spacing = 1
        max_width = (width - Mm(4)) if map_slot else (width / 3 - Mm(4))
        stream, fitted_width, fitted_height = fitted_photo(raw, max_width / Inches(1), (Mm(80) if map_slot else Mm(39)) / Inches(1))
        paragraph.add_run().add_picture(stream, width=Inches(fitted_width), height=Inches(fitted_height))
    element = table._tbl
    element.getparent().remove(element)
    anchor.addnext(element)
    return element


def _valuation_media(document, photo_paragraph, map_paragraph, photos, map_image):
    clear_paragraph(photo_paragraph)
    photo_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    photo_paragraph.paragraph_format.keep_with_next = True
    photo_paragraph.add_run("PROPERTY PHOTOGRAPHS" if photos else "LOCATION MAP").bold = True
    anchor = photo_paragraph._p
    for start in range(0, len(photos), 12):
        if start:
            paragraph = document.add_paragraph("PROPERTY PHOTOGRAPHS (CONTINUED)")
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.page_break_before = True
            paragraph.paragraph_format.keep_with_next = True
            paragraph.runs[0].bold = True
            paragraph._p.getparent().remove(paragraph._p)
            anchor.addnext(paragraph._p)
            anchor = paragraph._p
        anchor = _valuation_media_table(document, anchor, photos[start:start + 12])
    if photos:
        paragraph = document.add_paragraph("LOCATION MAP")
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.page_break_before = len(photos) >= 10
        paragraph.paragraph_format.keep_with_next = True
        paragraph.paragraph_format.space_before = Pt(3)
        paragraph.paragraph_format.space_after = Pt(3)
        paragraph.runs[0].bold = True
        paragraph._p.getparent().remove(paragraph._p)
        anchor.addnext(paragraph._p)
        anchor = paragraph._p
    _valuation_media_table(document, anchor, [map_image], map_slot=True)
    if map_paragraph is not None:
        map_paragraph._p.getparent().remove(map_paragraph._p)


def insert_uploaded_media(docx_path, photos, map_image, *, valuation_map=False):
    document = Document(docx_path)
    photo_paragraph = next((p for p in document.paragraphs if p.text.startswith("PROPERTY PHOTOGRAPHS")), None)
    map_paragraph = next((p for p in document.paragraphs if p.text.startswith(("LOCATION MAP", "ROUTE MAP"))), None)
    if valuation_map and photo_paragraph is not None and decode_image((map_image or {}).get("data")):
        _valuation_media(document, photo_paragraph, map_paragraph, photos, map_image)
        document.save(docx_path)
        return
    media = list(photos)
    if decode_image((map_image or {}).get("data")):
        media.append({**map_image, "is_map": True})
    if photo_paragraph is not None:
        if not media:
            previous = photo_paragraph._p.getprevious()
            photo_paragraph._p.getparent().remove(photo_paragraph._p)
            while previous is not None and previous.tag == qn("p") and not "".join(previous.itertext()).strip() and not previous.xpath(".//w:drawing"):
                candidate = previous.getprevious()
                previous.getparent().remove(previous)
                previous = candidate
            if map_paragraph is not None:
                map_paragraph._p.getparent().remove(map_paragraph._p)
            document.save(docx_path)
            return
        clear_paragraph(photo_paragraph)
        title = photo_paragraph.add_run("PROPERTY PHOTOGRAPHS")
        title.bold = True
        photo_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if media:
            anchor = photo_paragraph._p
            for page_start in range(0, len(media), 12):
                page_photos = media[page_start:page_start + 12]
                if page_start:
                    continued_paragraph = document.add_paragraph()
                    continued_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    continued_paragraph.add_run().add_break(WD_BREAK.PAGE)
                    continued = continued_paragraph.add_run("PROPERTY PHOTOGRAPHS (CONTINUED)")
                    continued.bold = True
                    continued_element = continued_paragraph._p
                    continued_element.getparent().remove(continued_element)
                    anchor.addnext(continued_element)
                    anchor = continued_element
                anchor = insert_photo_table(document, anchor, page_photos, 3)
    if map_paragraph is not None:
        map_paragraph._p.getparent().remove(map_paragraph._p)
    document.save(docx_path)
