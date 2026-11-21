"""Construction notes and typical-floor assessment, without changing estimate totals."""

import json
from pathlib import Path

from docx import Document

from backend.app.valuation.calculations import calculated_replacements
from backend.app.valuation.construction import cover_description, cover_notes, estimate_rows
from backend.app.valuation.formatting import number_value
from backend.app.valuation.reports import generate_docx
from backend.app.valuation.schemas import schema_payload, validate_report_values


def fixture():
    return {
        "property.category": "residential_land_building", "property.status": "under_construction",
        "property.description": "Residential Building in GF & FF", "construction.summary_version": "1",
        "owner.details": "Sample Applicant W/o Sample Relation, D.No.24/42, Havanpet, Adoni.",
        "property.postal_address": "Plot No.29, LP No.11/2020/1015/KUDA/DPMS, Sy.No.363, 364-2A, BVR Colony, Near Siva Shankar Nagar, Mandigiri (V), Adoni Municipality, Adoni.",
        "bank.name": "Bank of Baroda", "bank.branch": "G H Road, Adoni",
        "report.valuation_date": "2026-11-20", "report.inspection_date": "2026-11-19",
        "land.extent_value": "146.66", "land.extent_unit": "sq_yd", "land.rate_unit": "sq_yd", "land.adopted_rate_value": "14462",
        "building.floors.1.name": "GF & FF", "building.floors.1.count": "2", "building.floors.1.basis": "per_floor",
        "building.floors.1.structure_type": "rcc", "building.floors.1.plinth_area": "1000", "building.floors.1.roof_height": "10",
        "building.floors.1.replacement_rate": "1200", "building.floors.1.age": "0",
        "construction.estimates": json.dumps([{"id": "typical", "label": "GF & FF", "amount": "4872000"}]),
    }


def main():
    values = fixture()
    result = calculated_replacements(values)[0]
    assert number_value(result["abstract.building"]) == 2400000
    assert number_value(result["building.floors.1.net_value"]) == 2400000
    assert result["building.floors.1.plinth_area"] == "2000"
    assert number_value(cover_notes(values, result)[-1][1]) == 2472000
    assert cover_notes(values, result)[1][1] == 4872000, "Adopted estimate already includes all typical floors"
    combined = {**values, "building.floors.1.basis": "combined"}
    assert number_value(calculated_replacements(combined)[0]["abstract.building"]) == 1200000
    manual = {**values, "calculation.overrides": json.dumps({"building.floors.1.net_value": "500000", "abstract.building": "9999999"})}
    assert number_value(calculated_replacements(manual)[0]["abstract.building"]) == 1000000
    assert cover_notes({**values, "property.status": "existing"}, result) == []
    assert cover_notes({**values, "property.category": "residential_plot"}, result) == []
    assert cover_description({**values, "property.description": "Residential Building (Proposed)"}).endswith("(u/c)")
    assert cover_description({**values, "property.description": "Residential Building (u/c)", "property.status": "existing"}) == "Residential Building"
    blank = {**values, "construction.estimates": json.dumps([{"label": "GF & FF", "amount": ""}])}
    assert cover_notes(blank, result)[-1][1] is None
    assert estimate_rows({"construction.estimates": '[{"label":"GF","amount":0}]'})[0]["amount"] == 0
    for bad in ("-2", "unknown"):
        try:
            estimate_rows({"construction.estimates": json.dumps([{"label": "GF", "amount": bad}])})
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid adopted amounts must not become zero")
    schema = schema_payload()
    required = {field["id"]: (field.get("options") or ["Example"])[0]
                for field in [*schema["setup_fields"], *schema["fields"]]
                if field.get("required") and not field.get("calculated") and not field.get("source")}
    inactive = {**required, **values, "property.status": "existing", "construction.estimates": "unfinished optional JSON",
                "documents.1.type": "Sale Deed", "documents.1.details": "Document No.1"}
    validate_report_values("valuation-general", inactive)
    try:
        validate_report_values("valuation-general", {**inactive, "property.status": "proposed"})
    except ValueError as error:
        assert "estimated construction" in str(error)
    else:
        raise AssertionError("Applicable malformed estimated costs must be rejected")
    output = Path("outputs/generated_reports/local-validation-20261120")
    output.mkdir(parents=True, exist_ok=True)
    for count in (1, 4, 5, 8):
        entries = [{"id": str(i), "label": f"Building {i + 1} GF & FF", "amount": "4872000"} for i in range(count)]
        data = {**values, "construction.estimates": json.dumps(entries)}
        for revaluation in (False, True):
            path = output / f"construction-{count}-{'reval' if revaluation else 'val'}.docx"
            generate_docx(data, path, revaluation=revaluation)
            document = Document(path)
            table = next(table for table in document.tables if table.cell(0, 0).text.startswith("Note:"))
            note_count = count + 4
            assert len(table.columns) == (1 if note_count <= 8 else 2)
            text = " ".join(cell.text for row in table.rows for cell in row.cells)
            assert "Cost of Site (146.66 Sq.yd. / 3.03 Cents)" in text
            assert "balance work" in text
            assert "Residential Building in GF & FF (u/c)" in document.tables[0].cell(1, 1).text
            assert "For Office use only" in [p.text for p in document.paragraphs]
    print("PASS: valuation/revaluation notes, unknown versus zero, typical-floor multiplication and combined estimate costs")


if __name__ == "__main__":
    main()
