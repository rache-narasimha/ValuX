"""Regression check for dynamic general-report documents and numeric parsing."""

import importlib.util
from pathlib import Path
from zipfile import ZipFile

from lxml import etree


ROOT = Path(__file__).resolve().parent.parent
SERVER_PATH = ROOT / "valuation_app" / "server.py"
OUTPUT_PATH = Path(__file__).with_name("General_Dynamic_Documents_Test.docx")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def load_server():
    spec = importlib.util.spec_from_file_location("valuation_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    server = load_server()
    values = {
        "institution.type": "NBFC",
        "bank.name": "HDB Financial Services Limited",
        "bank.branch": "Adoni",
        "report.valuation_date": "2026-10-11",
        "report.inspection_date": "2026-10-10",
        "land.extent_value": "200 cents",
        "land.extent_unit": "cent",
        "land.rate_unit": "acre",
        "land.adopted_rate_value": "Rs. 5,00,000/- per acre",
        "documents.1.type": "Sale Deed",
        "documents.1.details": "Document No. 1",
        "documents.2.type": "LSR",
        "documents.2.details": "Legal scrutiny report",
        "documents.3.type": "Other Documents",
        "documents.3.details": "Tax receipt",
        "documents.4.type": "Custom",
        "documents.4.custom_type": "Encumbrance Certificate",
        "documents.4.details": "EC through 11-10-2026",
    }
    server.generate_docx(values, OUTPUT_PATH)
    with ZipFile(OUTPUT_PATH) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
    rows = root.xpath(".//w:tr[.//w:tag[starts-with(@w:val, 'documents.')]]", namespaces=NS)
    assert len(rows) == 4, len(rows)
    row_text = ["".join(row.xpath(".//w:t/text()", namespaces=NS)) for row in rows]
    assert any("Sale Deed" in text and "Document No. 1" in text for text in row_text)
    assert any("Encumbrance Certificate" in text and "EC through 11-10-2026" in text for text in row_text)
    all_text = "\n".join(root.xpath(".//w:t/text()", namespaces=NS))
    assert "10,00,000/-" in all_text
    assert "HDB Financial Services Limited" in all_text
    print(f"PASS: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
