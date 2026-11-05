"""Correct approved wording while retaining the masters' existing XML layout."""

from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def correct(kind):
    path = ROOT / f"resources/{kind}/master_template.docx"
    with ZipFile(path) as archive:
        entries = [(item, archive.read(item.filename)) for item in archive.infolist()]
    with ZipFile(path, "w") as archive:
        for item, content in entries:
            if item.filename == "word/document.xml":
                root = etree.fromstring(content)
                for paragraph in root.xpath(".//w:p", namespaces=NS):
                    nodes = paragraph.xpath(".//w:t", namespaces=NS)
                    amount_paragraph = "Rupees" in "".join(node.text or "" for node in nodes)
                    misconduct_paragraph = "found guilt of misconduct" in "".join(node.text or "" for node in nodes)
                    for node in nodes:
                        text = node.text or ""
                        if kind == "general" and text == "The Branch Manager":
                            text = "Bank Manager"
                        text = re.sub(r"\batleast\b", "at least", text)
                        text = text.replace("hand book", "handbook").replace("sub contracted", "subcontracted")
                        text = text.replace("carried-out by myself", "carried out by myself")
                        if misconduct_paragraph:
                            text = re.sub(r"\bguilt\b", "guilty", text)
                        if amount_paragraph:
                            text = re.sub(r"\bonly\b", "Only", text)
                        node.text = text
                content = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
            archive.writestr(item, content)


if __name__ == "__main__":
    for report_kind in ("general", "agricultural"):
        correct(report_kind)
