"""Apply the approved valuation presentation rules to the production masters."""

import json
import re
import sys
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor
from docx.text.paragraph import Paragraph

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.valuation.config import qn
from backend.app.valuation.reports import align_signature_fields


def update(kind):
    path = ROOT / f"resources/{kind}/master_template.docx"
    document = Document(path)
    for node in document.element.iter(qn("t")):
        text = node.text or ""
        text = text.replace("K. Sivaprasad", "K. Siva Prasad")
        text = re.sub(r"\bvaluation report\b", "Valuation Report", text, flags=re.I)
        text = re.sub(r"\bvaluer\b", "Valuer", text, flags=re.I)
        text = re.sub(r"\bvalue\b", "Value", text, flags=re.I)
        node.text = text
    # Word can split a phrase across runs. Case-only edits preserve each run's
    # formatting and text length while covering those split phrases as well.
    for element in document.element.iter(qn("p")):
        nodes = list(element.iter(qn("t")))
        source = "".join(node.text or "" for node in nodes)
        normalized = re.sub(r"\bvaluation report\b", "Valuation Report", source, flags=re.I)
        offset = 0
        for node in nodes:
            length = len(node.text or "")
            node.text = normalized[offset:offset + length]
            offset += length
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text.lower() in {"general property valuation report", "valuation report (in respect of agricultural lands)"}:
            paragraph.text = "Valuation Report"
            run = paragraph.runs[0]
            run.font.name = "Calibri"
            run.font.size = Pt(13)
            run.bold = run.underline = True
            run.font.color.rgb = RGBColor.from_string("00B0F0")
            if kind == "agricultural":
                subtitle = paragraph.insert_paragraph_before("Agricultural Land")
                paragraph._p.addnext(subtitle._p)
                subtitle.alignment = paragraph.alignment
                subtitle.paragraph_format.keep_with_next = True
                subtitle.runs[0].font.name = "Calibri"
                subtitle.runs[0].font.size = Pt(12)
        elif text == "Land, site and building":
            paragraph.text = "Land and Building"
        elif text.casefold() == "declaration from valuer":
            paragraph.text = "Declaration from Valuer"
            paragraph.runs[0].font.name = "Calibri"
            paragraph.runs[0].font.size = Pt(13)
            paragraph.runs[0].bold = paragraph.runs[0].underline = True
        elif "SIGNATURE OF Valuer" in text:
            for run in paragraph.runs:
                run.text = run.text.replace("SIGNATURE OF Valuer", "Signature of Valuer")
        elif kind == "general" and text == "Bank manager acknowledgment":
            # Preserve the blank heading's height and explicit bank-page boundary.
            paragraph.text = ""
    for table in document.tables:
        for row in table.rows:
            for index, cell in enumerate(row._tr.findall(qn("tc"))):
                span = cell.find(f"{qn('tcPr')}/{qn('gridSpan')}")
                # Centre identifier cells, including secondary alphabetical/roman
                # identifiers; leave merged section headings and descriptions alone.
                visible = "".join(cell.xpath(".//w:t/text()")).strip()
                identifier = re.fullmatch(r"(?:\d+(?:\([a-z]\))?|[a-z]|[ivxlcdm]+|Part [A-G])[.)]?", visible, re.I)
                if (index == 0 and span is None) or identifier:
                    for element in cell.iter(qn("p")):
                        Paragraph(element, document).alignment = WD_ALIGN_PARAGRAPH.CENTER
    if kind == "general":
        abstract = document.tables[-1]
        for table, key in zip(document.tables[7:11], ("abstract.extra", "abstract.amenities", "abstract.miscellaneous", "abstract.services")):
            cell = table.rows[-1].cells[-1]._tc
            if cell.xpath(".//w:tag"):
                continue
            source = abstract._tbl.xpath(f".//w:sdt[w:sdtPr/w:tag[@w:val='{key}']]")[0]
            control = deepcopy(source)
            for element in list(cell):
                if element.tag != qn("tcPr"):
                    cell.remove(element)
            cell.append(control)
    align_signature_fields(document)
    document.save(path)
    if kind == "general":
        controls = []
        for table_index, table in enumerate(document.tables):
            for row_index, row in enumerate(table.rows):
                for cell_index, cell in enumerate(row._tr.findall(qn("tc"))):
                    for tag in cell.xpath(".//w:tag"):
                        controls.append({"id": tag.get(qn("val")), "kind": "table_cell", "table": table_index, "row": row_index, "cell": cell_index})
        mapping = ROOT / "resources/general/template_mapping.json"
        mapping.write_text(json.dumps({"template": "master_template.docx", "controls": controls}, indent=2) + "\n")


if __name__ == "__main__":
    for kind in ("general", "agricultural"):
        update(kind)
