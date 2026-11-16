"""Uploaded-image normalization and Word document media layout."""

import base64
from io import BytesIO

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Mm, Pt
from lxml import etree
from PIL import Image, ImageOps

from .config import qn

def decode_image(data_url):
    if not isinstance(data_url, str) or not data_url.startswith("data:image/") or "," not in data_url:
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

def require_online_media(photos, map_image):
    """Require site photographs and one separately supplied location map."""
    if not isinstance(photos, list) or not photos or any(
        not isinstance(photo, dict) or not decode_image(photo.get("data")) for photo in photos
    ):
        raise ValueError("Attach at least one valid site photograph.")
    if not isinstance(map_image, dict) or not decode_image(map_image.get("data")):
        raise ValueError("Attach one valid location map screenshot.")


def _photo_table(document, anchor, items, *, columns, row_height, center_last=False):
    section = document.sections[0]
    width = section.page_width - section.left_margin - section.right_margin
    column_width = int(width / columns)
    rows = (len(items) + columns - 1) // columns
    table = document.add_table(rows=rows, cols=columns)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for column in table.columns:
        column.width = column_width
    for row in table.rows:
        # Keep the initial spacing but allow Word to grow the row on resize.
        row.height = Mm(row_height)
        row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        etree.SubElement(row._tr.get_or_add_trPr(), qn("cantSplit"))
        for cell in row.cells:
            cell.width = column_width
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for index, item in enumerate(items):
        raw = decode_image(item.get("data"))
        if not raw:
            continue
        row, column = divmod(index, columns)
        cell = table.cell(row, column)
        picture_width = column_width
        if center_last and index == len(items) - 1:
            cell = cell.merge(table.cell(row, columns - 1))
            picture_width = width
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        paragraph.paragraph_format.line_spacing = 1
        stream, fitted_width, fitted_height = fitted_photo(
            raw, (picture_width - Mm(4)) / Inches(1), Mm(row_height - 5) / Inches(1)
        )
        paragraph.add_run().add_picture(stream, width=Inches(fitted_width), height=Inches(fitted_height))
    element = table._tbl
    element.getparent().remove(element)
    anchor.addnext(element)
    return element


def _add_media_heading(document, anchor, title, *, new_page=False):
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.page_break_before = new_page
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.space_before = Pt(3)
    paragraph.paragraph_format.space_after = Pt(3)
    paragraph.add_run(title).bold = True
    paragraph._p.getparent().remove(paragraph._p)
    anchor.addnext(paragraph._p)
    return paragraph._p


def insert_uploaded_media(docx_path, photos, map_image):
    document = Document(docx_path)
    photo_heading = next((p for p in document.paragraphs if p.text.startswith("PROPERTY PHOTOGRAPHS")), None)
    map_heading = next((p for p in document.paragraphs if p.text.startswith(("LOCATION MAP", "ROUTE MAP"))), None)
    has_map = bool(decode_image((map_image or {}).get("data")))
    if photo_heading is not None:
        if photos or has_map:
            clear_paragraph(photo_heading)
            photo_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
            photo_heading.paragraph_format.keep_with_next = True
            photo_heading.add_run("PROPERTY PHOTOGRAPHS" if photos else "LOCATION MAP").bold = True
            anchor = photo_heading._p
            count = len(photos)
            columns = 1 if count == 1 else 2 if count <= 6 else 3
            row_height = 86 if count <= 2 else 72 if count <= 4 else 43
            for start in range(0, count, 12):
                if start:
                    anchor = _add_media_heading(document, anchor, "PROPERTY PHOTOGRAPHS (CONTINUED)", new_page=True)
                anchor = _photo_table(
                    document, anchor, photos[start:start + 12],
                    columns=columns, row_height=row_height, center_last=count == 3,
                )
            if has_map:
                if photos:
                    anchor = _add_media_heading(document, anchor, "LOCATION MAP", new_page=count >= 10)
                _photo_table(document, anchor, [map_image], columns=1, row_height=86)
        else:
            previous = photo_heading._p.getprevious()
            photo_heading._p.getparent().remove(photo_heading._p)
            while previous is not None and previous.tag == qn("p") and not "".join(previous.itertext()).strip() and not previous.xpath(".//w:drawing"):
                candidate = previous.getprevious()
                previous.getparent().remove(previous)
                previous = candidate
    if map_heading is not None:
        map_heading._p.getparent().remove(map_heading._p)
    document.save(docx_path)
