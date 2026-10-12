"""Focused Phase 2 generation test for calculations, EXIF handling, and media pagination."""

import base64
import json
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from docx import Document
from docx.shared import Pt


APP_ROOT = Path(__file__).resolve().parents[1]
PAYLOAD_PATH = Path(__file__).with_name("fixtures") / "agricultural_sample_payload.json"
OUTPUT_DIR = APP_ROOT / "outputs" / "test_artifacts"
OUTPUT_PATH = OUTPUT_DIR / "agricultural_photo_layout_test.docx"


def load_reports():
    sys.path.insert(0, str(APP_ROOT))
    from backend.app import reports
    return reports


def image_item(index, portrait=False, exif_orientation=None):
    size = (700, 1100) if portrait else (1100, 700)
    image = Image.new("RGB", size, (235, 244, 247))
    draw = ImageDraw.Draw(image)
    draw.rectangle((25, 25, size[0] - 25, size[1] - 25), outline=(0, 91, 120), width=12)
    draw.text((55, 55), f"TOP - PHOTO {index}", fill=(0, 40, 60))
    draw.text((55, size[1] - 90), "BOTTOM", fill=(120, 35, 20))
    output = BytesIO()
    exif = image.getexif()
    if exif_orientation:
        exif[274] = exif_orientation
    image.save(output, "JPEG", quality=90, exif=exif)
    return {"name": f"photo-{index}.jpg", "data": "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    reports = load_reports()
    payload = json.loads(PAYLOAD_PATH.read_text())
    route_map = image_item(99)
    expected_layouts = {
        4: [(4, 1, 4)],
        6: [(3, 2, 6)],
        10: [(3, 3, 9), (1, 1, 1)],
    }
    for count, expected in expected_layouts.items():
        photos = [image_item(index, portrait=index % 2 == 0, exif_orientation=6 if index == 1 else None) for index in range(1, count + 1)]
        output_path = OUTPUT_PATH if count == 10 else OUTPUT_PATH.with_name(f"phase2_photo_test_{count}.docx")
        reports.generate_agricultural_docx(payload["values"], output_path, photos, route_map)
        layout_document = Document(output_path)
        media_tables = [
            (len(table.rows), len(table.columns), len(table._tbl.xpath(".//w:drawing")))
            for table in layout_document.tables if table._tbl.xpath(".//w:drawing")
        ]
        assert media_tables == expected, (count, media_tables)

    document = Document(OUTPUT_PATH)
    text = "\n".join(p.text for p in document.paragraphs)
    table_text = "\n".join(" | ".join(c.text for c in row.cells) for table in document.tables for row in table.rows)
    combined = text + "\n" + table_text
    assert "{{" not in combined
    assert "10,00,000/-" in combined
    assert "8,00,000/-" in combined
    assert "K.Sivaprasad,B.E.,M.I.E.,F.I.V." in combined
    assert "H.No:21-2/16A1,SKD Colony Adoni." in combined
    assert "\\nH.No:21-2/16A1" not in combined
    valuer_paragraph = next(p for p in document.paragraphs if "K.Sivaprasad,B.E." in p.text)
    assert len(valuer_paragraph._p.xpath(".//w:br")) == 1
    format_label = next(p for p in document.paragraphs if p.text.strip() == "Format-B")
    assert format_label.paragraph_format.left_indent is None
    assert format_label.paragraph_format.keep_together is True
    model_code = next(p for p in document.paragraphs if p.text.strip() == "MODEL CODE OF CONDUCT FOR VALUERS")
    assert model_code.paragraph_format.page_break_before is True
    assert "Adangal / Pahani" in combined
    assert "Latest revenue record" in combined
    assert sum("Sale Deed" in row.cells[1].text or "LSR" in row.cells[1].text or
               "Other Documents" in row.cells[1].text or "Adangal / Pahani" in row.cells[1].text or
               "Sale Agreement" in row.cells[1].text
               for table in document.tables for row in table.rows if len(row.cells) > 2) >= 5
    assert "4(a)." in combined and "Mr. Sample Owner" in combined
    assert "4(b)." in combined and "Mr. Sample Purchaser" in combined
    party_rows = [row for row in document.tables[0].rows if row.cells[0].text.strip() in {"4(a).", "4(b)."}]
    assert all(run.font.size == Pt(10) for row in party_rows for paragraph in row.cells[-1].paragraphs
               for run in paragraph.runs if run.text)
    assert document.tables[2].rows[0]._tr.xpath("./w:trPr/w:cantSplit")
    summary_cell = document.tables[3].rows[1].cells[2]
    assert all(run.font.size == Pt(9) for paragraph in summary_cell.paragraphs for run in paragraph.runs if run.text)
    assert len(document.inline_shapes) == 11, len(document.inline_shapes)
    print(f"PASS: {OUTPUT_PATH}")
    print(f"inline images: {len(document.inline_shapes)} (10 photos + 1 route map)")


if __name__ == "__main__":
    main()
