"""Regression check for dynamic general-report documents and numeric parsing."""

import sys
from pathlib import Path
from zipfile import ZipFile

from lxml import etree


APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = APP_ROOT / "outputs" / "test_artifacts"
OUTPUT_PATH = OUTPUT_DIR / "general_dynamic_documents_test.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def load_reports():
    sys.path.insert(0, str(APP_ROOT))
    from backend.app import reports
    return reports


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    reports = load_reports()
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
        "documents.2.type": "Rectification Deed",
        "documents.2.details": "Rectification document",
        "documents.3.type": "Legal Scrutiny Report",
        "documents.3.details": "Legal scrutiny report",
        "documents.4.type": "Custom",
        "documents.4.custom_type": "Encumbrance Certificate",
        "documents.4.details": "EC through 11-10-2026",
        "sale_agreement.used": "Yes",
        "sale_agreement.details": "Agreement dated 01-10-2026",
        "sale_agreement.value": "Rs. 12,00,000/-",
        "owner.details": "Sample Owner, Adoni",
        "purchaser.details": "Sample Purchaser, Adoni",
    }
    reports.generate_docx(values, OUTPUT_PATH)
    with ZipFile(OUTPUT_PATH) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
    rows = root.xpath(".//w:tr[.//w:tag[starts-with(@w:val, 'documents.')]]", namespaces=NS)
    assert len(rows) == 5, len(rows)
    row_text = ["".join(row.xpath(".//w:t/text()", namespaces=NS)) for row in rows]
    assert any("Sale Deed" in text and "Document No. 1" in text for text in row_text)
    assert any("Encumbrance Certificate" in text and "EC through 11-10-2026" in text for text in row_text)
    assert any("Sale Agreement" in text and "Agreement dated 01-10-2026" in text for text in row_text)
    all_text = "\n".join(root.xpath(".//w:t/text()", namespaces=NS))
    assert "10,00,000/-" in all_text
    assert "HDB Financial Services Limited" in all_text
    assert "HDB FINANCIAL SERVICES LIMITED" in all_text
    assert "BANK OF MAHARASHTRA VALUATION REPORT" not in all_text
    assert "4(a)." in all_text and "Sample Owner, Adoni" in all_text
    assert "4(b)." in all_text and "Sample Purchaser, Adoni" in all_text
    print(f"PASS: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
