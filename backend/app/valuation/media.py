"""Uploaded-image normalization and Word document media layout."""

import base64
from io import BytesIO

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.shared import Inches
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

def insert_photo_table(document, after_element, photos, columns):
    rows = (len(photos) + columns - 1) // columns
    table = document.add_table(rows=rows, cols=columns)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    max_width = {1: 6.0, 2: 2.9, 3: 1.95}[columns]
    max_height = {1: 7.7, 2: 3.75, 3: 2.45, 4: 1.85}.get(rows, 1.85)
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
            table.cell(index // columns, index % columns).paragraphs[0].add_run().add_picture(
                stream, width=Inches(width), height=Inches(height)
            )
    table_element = table._tbl
    table_element.getparent().remove(table_element)
    after_element.addnext(table_element)
    return table_element

def insert_uploaded_media(docx_path, photos, map_image):
    document = Document(docx_path)
    photo_paragraph = next((p for p in document.paragraphs if p.text.startswith("PROPERTY PHOTOGRAPHS")), None)
    map_paragraph = next((p for p in document.paragraphs if p.text.startswith(("LOCATION MAP", "ROUTE MAP"))), None)
    if photo_paragraph is not None:
        clear_paragraph(photo_paragraph)
        title = photo_paragraph.add_run("PROPERTY PHOTOGRAPHS")
        title.bold = True
        photo_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if photos:
            anchor = photo_paragraph._p
            for page_start in range(0, len(photos), 9):
                page_photos = photos[page_start:page_start + 9]
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
                columns = 1 if len(page_photos) <= 4 else (2 if len(page_photos) <= 6 else 3)
                anchor = insert_photo_table(document, anchor, page_photos, columns)
        else:
            photo_paragraph.add_run("\nNo photographs uploaded.")
    if map_paragraph is not None:
        clear_paragraph(map_paragraph)
        title = map_paragraph.add_run("LOCATION MAP")
        title.bold = True
        raw = decode_image((map_image or {}).get("data"))
        if raw:
            map_paragraph.add_run().add_break()
            map_paragraph.add_run().add_picture(normalize_photo(raw, (1600, 950)), width=Inches(6.15))
        else:
            map_paragraph.add_run("\nNo map screenshot uploaded.")
    document.save(docx_path)
