"""Regression check for dynamic general-report documents and numeric parsing."""

import sys
import json
from pathlib import Path
from zipfile import ZipFile
from unittest.mock import patch

from docx import Document
from docx.enum.text import WD_TAB_ALIGNMENT
from lxml import etree


APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = APP_ROOT / "outputs" / "test_artifacts"
OUTPUT_PATH = OUTPUT_DIR / "general_dynamic_documents_test.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def load_reports():
    sys.path.insert(0, str(APP_ROOT))
    from backend.app.valuation import reports
    return reports


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    reports = load_reports()
    from backend.app.valuation.formatting import amount_in_words, valuation_amount_in_words
    assert valuation_amount_in_words(4542058) == "Forty-Five Lakh Forty-Two Thousand Fifty-Eight"
    assert amount_in_words(4542058) == "Forty Five Lakh Forty Two Thousand Fifty Eight", "Other report types retain their existing wording"
    offline_path = OUTPUT_DIR / "general_offline_template.docx"
    with patch("subprocess.run", side_effect=AssertionError("DOCX templates must not invoke LibreOffice")):
        reports.generate_offline_template("valuation-general", offline_path)
    with ZipFile(offline_path) as archive:
        offline_root = etree.fromstring(archive.read("word/document.xml"))
    offline_text = " ".join(offline_root.xpath(".//w:t/text()", namespaces=NS))
    assert not offline_root.xpath(".//w:sdt", namespaces=NS), "Offline copies must not retain automation controls or cloned IDs"
    for sample in ("B.Govind", "50,69,000", "24-09-2026", "Bank of Maharashtra", "{{"):
        assert sample not in offline_text, f"Offline template leaked sample content: {sample}"
    from backend.app.valuation.schemas import schema_payload, validate_report_values

    schema = schema_payload()
    required_values = {}
    for field in [*schema["setup_fields"], *schema["fields"]]:
        if not field.get("required") or field.get("calculated") or field.get("source") or field.get("conditional") == "property.has_building":
            continue
        options = field.get("options") or []
        required_values[field["id"]] = options[0] if options else "Example"
    required_values.update({
        "property.category": "residential_plot",
        "report.valuation_date": "2026-11-02",
        "land.extent_value": "1200",
        "land.adopted_rate_value": "2500",
        "documents.1.type": "Sale Deed",
        "documents.1.details": "Document No. 1",
    })
    validate_report_values("valuation-general", required_values)
    assert "report.valuation_date_detail" not in required_values
    assert "property.valuation_extent" not in required_values
    assert "land.adopted_rate" not in required_values
    try:
        validate_report_values("valuation-general", {**required_values, "report.valuation_date": ""})
    except ValueError as error:
        assert "Date of Valuation" in str(error)
    else:
        raise AssertionError("The canonical valuation date is still required.")
    try:
        validate_report_values("valuation-general", {**required_values, "documents.2.type": "EC"})
    except ValueError as error:
        assert "Document details for Document 2" in str(error)
    else:
        raise AssertionError("Every added document must require both its type and details.")

    values = {
        "institution.type": "NBFC",
        "bank.name": "HDB Financial Services Limited",
        "bank.branch": "Adoni",
        "report.valuation_date": "2026-10-11",
        "report.inspection_date": "2026-10-10",
        "property.status": "existing",
        "property.description": "Residential land and building",
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
        "extra.item_1": "Included",
        "extra.item_2": "2,500",
        "amenity.item_1": "1,500",
    }
    with patch("subprocess.run", side_effect=AssertionError("DOCX generation must not invoke LibreOffice")):
        reports.generate_docx(values, OUTPUT_PATH)
    with ZipFile(OUTPUT_PATH) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
    document_details = ("Document No. 1", "Rectification document", "Legal scrutiny report", "EC through 11-10-2026", "Agreement dated 01-10-2026")
    rows = [row for row in root.xpath(".//w:tr", namespaces=NS)
            if any(value in "".join(row.xpath(".//w:t/text()", namespaces=NS)) for value in document_details)]
    assert len(rows) == 5, len(rows)
    row_text = ["".join(row.xpath(".//w:t/text()", namespaces=NS)) for row in rows]
    assert any("Sale Deed" in text and "Document No. 1" in text for text in row_text)
    assert any("Encumbrance Certificate" in text and "EC through 11-10-2026" in text for text in row_text)
    assert any("Sale Agreement" in text and "Agreement dated 01-10-2026" in text for text in row_text)
    all_text = "\n".join(root.xpath(".//w:t/text()", namespaces=NS))
    assert not root.xpath(".//w:sdt", namespaces=NS), "Generated exports must not retain automation controls"
    assert "10,00,000/-" in all_text
    assert "HDB Financial Services Limited" in all_text
    assert any(p.text == "HDB Financial Services Limited" for p in Document(OUTPUT_PATH).paragraphs)
    assert "Canara Bank" in all_text
    assert "BANK OF MAHARASHTRA VALUATION REPORT" not in all_text
    assert "4(a)." in all_text and "Sample Owner, Adoni" in all_text
    assert "4(b)." in all_text and "Sample Purchaser, Adoni" in all_text
    assert "B.Govind" not in all_text
    assert "Specifications of construction (Proposed)" not in all_text
    assert "4,000/-" in all_text
    assert "{{" not in all_text
    document = Document(OUTPUT_PATH)
    for section in document.sections:
        assert section.left_margin == section.right_margin
    paragraphs = document.paragraphs
    method_index = next(i for i, p in enumerate(paragraphs) if p.text == "Method of Valuation")
    acknowledgment_index = next(i for i, p in enumerate(paragraphs) if p.text.startswith("The undersigned"))
    assert not any(p.text == "Bank manager acknowledgment" for p in paragraphs)
    # Office may encode explicit page breaks as section boundaries during its
    # compatibility export. Verify the authored boundary on the master too.
    master_paragraphs = Document(reports.TEMPLATE).paragraphs
    for heading in ("Method of Valuation",):
        assert next(p for p in master_paragraphs if p.text == heading).paragraph_format.page_break_before
    bank_index = next(i for i, p in enumerate(master_paragraphs) if p.text.startswith("The undersigned"))
    assert master_paragraphs[bank_index - 1].paragraph_format.page_break_before
    office_index = next(i for i, p in enumerate(paragraphs) if p.text == "For Office use only")
    office = paragraphs[office_index]
    assert office_index < acknowledgment_index and office.paragraph_format.space_after.pt == 12
    assert all(not run.bold for run in office.runs)
    declaration_block = paragraphs[method_index:office_index - 1]
    assert any(p.text == "Declaration" for p in declaration_block)
    assert any("Signature of Valuer" in p.text for p in declaration_block)
    assert not any("undersigned" in p.text for p in declaration_block)
    for p in declaration_block[:-1]:
        assert p.paragraph_format.keep_with_next, p.text
    for p in paragraphs:
        if p.text.startswith("Place:"):
            assert "\t" in p.text
            assert any(stop.alignment == WD_TAB_ALIGNMENT.CENTER for stop in p.paragraph_format.tab_stops)
    assert "Rs.5,00,000/- per Acre" in all_text
    assert "K. Siva Prasad" in all_text
    assert any("Bank Manager" in p.text for p in document.paragraphs)
    assert not any("The Branch Manager" in p.text for p in document.paragraphs)
    assert "Lakh Four Thousand Only" in all_text
    assert "Land and Building" in all_text
    for table, amount in zip(document.tables[7:11], ("2,500/-", "1,500/-", "0/-", "0/-")):
        assert amount == table.rows[-1].cells[-1].text, (amount, table.rows[-1].cells[-1].text)
    for p in document.paragraphs:
        if p.text == "Valuation Report":
            assert p.runs[0].bold and p.runs[0].underline
            assert str(p.runs[0].font.color.rgb) == "000000"
    banner = next(p for p in document.paragraphs if p.text == "Valuation Report (Land and Building)")
    assert banner._p.xpath("./w:pPr/w:shd[@w:fill='00B0F0']")
    assert str(banner.runs[0].font.color.rgb) == "FFFFFF"
    cover_value = next(p for p in document.paragraphs if p.text.startswith("The Fair Market Value"))
    assert cover_value._p.xpath(".//w:br"), "Amount-in-words must start on its own line"
    # Section names are shown once. Only data-column labels repeat.
    assert document.tables[0].rows[0]._tr.xpath("./w:trPr/w:tblHeader")
    assert not document.tables[1].rows[0]._tr.xpath("./w:trPr/w:tblHeader")
    assert any(p.text == "Building Valuation" for p in document.paragraphs)
    floor_table = next(t for t in document.tables if len(t.columns) == 9)
    assert len(floor_table.columns) == 9
    assert floor_table.rows[0]._tr.xpath("./w:trPr/w:tblHeader")
    assert "Plinth area" in floor_table.rows[0].cells[2].text
    assert "Depreciation" in floor_table.rows[0].cells[7].text

    proposed_path = OUTPUT_PATH.with_name("general_proposed_status_test.docx")
    reports.generate_docx({**values, "property.status": "proposed"}, proposed_path)
    with ZipFile(proposed_path) as archive:
        proposed_root = etree.fromstring(archive.read("word/document.xml"))
    proposed_text = "".join(proposed_root.xpath(".//w:t/text()", namespaces=NS))
    assert "Specifications of construction (Proposed)" in proposed_text
    red_proposed = proposed_root.xpath(".//w:r[w:t[contains(., '(Proposed)')]]/w:rPr/w:color[@w:val='FF0000']", namespaces=NS)
    assert red_proposed
    floors_path = OUTPUT_PATH.with_name("general_multiple_floors_test.docx")
    floor_values = dict(values)
    floor_values.update({"misc.item_1": "500", "service.item_1": "700"})
    for index, (name, area, rate) in enumerate((("GF", "1000", "2000"), ("FF", "500", "1800"), ("SF", "300", "1000")), 1):
        floor_values.update({
            f"building.floors.{index}.name": name,
            f"building.floors.{index}.plinth_area": area,
            f"building.floors.{index}.replacement_rate": rate,
            f"building.floors.{index}.age": "0",
        })
    reports.generate_docx(floor_values, floors_path)
    floors_doc = Document(floors_path)
    table = next(t for t in floors_doc.tables if len(t.columns) == 9)
    assert len(table.rows) == 5
    assert [row.cells[1].text for row in table.rows[1:4]] == ["GF", "FF", "SF"]
    assert "20,00,000/-" in table.rows[1].cells[8].text
    assert "9,00,000/-" in table.rows[2].cells[8].text
    assert "3,00,000/-" in table.rows[3].cells[8].text
    assert "32,00,000/-" in table.rows[4].cells[8].text
    assert any("42,05,000/-" in p.text for p in floors_doc.paragraphs)
    assert floors_doc.tables[9].rows[-1].cells[-1].text == "500/-"
    assert floors_doc.tables[10].rows[-1].cells[-1].text == "700/-"
    plot_path = OUTPUT_PATH.with_name("general_plot_only_test.docx")
    reports.generate_docx({**floor_values, "property.category": "residential_plot",
                          "calculation.overrides": '{"abstract.building":"750000"}'}, plot_path)
    plot_doc = Document(plot_path)
    plot_text = " ".join([p.text for p in plot_doc.paragraphs] +
                         [cell.text for table in plot_doc.tables for row in table.rows for cell in row.cells])
    assert "Building Valuation" not in plot_text
    assert "Specifications of construction" not in plot_text
    assert not any(len(table.columns) == 9 for table in plot_doc.tables)
    plot_summary = next(table for table in plot_doc.tables if "Summary of property Value" in table.cell(0, 0).text)
    building_row = next(row for row in plot_summary.rows if row.cells[1].text == "Building")
    assert building_row.cells[-1].text == "N/A"
    narrative_path = OUTPUT_PATH.with_name("general_formatted_documents_test.docx")
    blocks = [{"kind": "number", "runs": [{"text": text, "bold": True}]}
              for text in ("First document", "Second document")]
    reports.generate_docx({**values, "documents.1.details": "1. First document\n2. Second document",
                          "documents.1.details_formatting": json.dumps(blocks)}, narrative_path)
    with ZipFile(narrative_path) as archive:
        narrative_root = etree.fromstring(archive.read("word/document.xml"))
    numbered = narrative_root.xpath(".//w:p[w:pPr/w:numPr]", namespaces=NS)
    assert any("First document" in "".join(p.xpath(".//w:t/text()", namespaces=NS)) for p in numbered)
    assert any("Second document" in "".join(p.xpath(".//w:t/text()", namespaces=NS)) for p in numbered)
    assert narrative_root.xpath(".//w:r[w:t='First document']/w:rPr/w:b", namespaces=NS)
    from tests.test_agricultural_generation import image_item
    for count in (1, 9, 10):
        path = OUTPUT_PATH.with_name(f"general_media_{count}.docx")
        reports.generate_docx(values, path, [image_item(i, portrait=i % 2 == 0) for i in range(count)], image_item(99))
        media_document = Document(path)
        media_tables = [t for t in media_document.tables if t._tbl.xpath(".//w:drawing")]
        assert [len(t._tbl.xpath(".//w:drawing")) for t in media_tables] == [count, 1]
        assert abs(media_tables[-1].rows[0].height.mm - 86) < 0.05
        assert abs(media_tables[-1].cell(0, 0).width - sum(c.width for c in media_tables[0].columns)) < 36000
        assert media_tables[-1].rows[0].height_rule.name == "AT_LEAST"
    print(f"PASS: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
