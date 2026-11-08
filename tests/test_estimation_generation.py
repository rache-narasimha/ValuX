"""Regression checks for the deployable Python estimation workbook engine."""

import sys
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook


APP_ROOT = Path(__file__).resolve().parents[1]


def load_generator():
    sys.path.insert(0, str(APP_ROOT))
    from backend.app.estimation import generate_estimation_workbook

    return generate_estimation_workbook


def workbook_from(result):
    return load_workbook(BytesIO(result.content), data_only=False)


def row_containing(sheet, text, column=2):
    for row in range(1, sheet.max_row + 1):
        if text.lower() in str(sheet.cell(row, column).value or "").lower():
            return row
    raise AssertionError(f"{sheet.title}: missing row containing {text!r}")


def detail_totals(sheet):
    return {
        "total": row_containing(sheet, "TOTAL CALCULATED COST", 1),
        "estimated": row_containing(sheet, "ESTIMATED COST (Rs.)", 1),
    }


def controlled_industrial_state():
    rows = {
        "concrete-footings": {"no": 1, "length": 2, "breadth": 3, "depth": 1},
        "concrete-pedestals": {"no": 1, "length": 2, "breadth": 1, "depth": 1},
        "concrete-plinth-long": {"no": 1, "length": 4, "breadth": 1, "depth": 1},
        "concrete-plinth-short": {"no": 1, "length": 3, "breadth": 1, "depth": 1},
        "concrete-columns": {"no": 1, "length": 2, "breadth": 2, "depth": 1},
        "concrete-lintel-long": {"no": 1, "length": 3, "breadth": 1, "depth": 1},
        "concrete-lintel-short": {"no": 1, "length": 1, "breadth": 1, "depth": 1},
        "concrete-roof-long": {"no": 1, "length": 2, "breadth": 1, "depth": 1},
        "concrete-roof-short": {"no": 1, "length": 1, "breadth": 1, "depth": 1},
        "concrete-roof-slab": {"no": 1, "length": 10, "breadth": 5},
        "steel-staircase": {"quantity": 20},
        "steel-sunshades": {"quantity": 5},
        "steel-total": {"rate": 65},
    }
    return {
        "propertyType": "industrial",
        "details": {
            "applicantName": "Controlled QA",
            "applicantAddress": "QA Address",
            "estimateDate": "2026-10-22",
            "place": "QA",
            "projectLocation": "QA Location",
            "workDescription": "Controlled RCC estimate",
        },
        "components": [{
            "kind": "rcc_building",
            "name": "RCC Building 1",
            "sheets": [{"key": "ground", "label": "Ground Floor", "level": 1, "formData": {"rows": rows}}],
        }],
    }


def assert_controlled_steel(generate):
    result = generate(controlled_industrial_state())
    workbook = workbook_from(result)
    sheet = workbook["RCC Building 1 - Ground Floor"]
    expected_factors = {
        "Footings @": "*75",
        "Pedestals @": "*100",
        "Columns  @": "*125",
        "Plinth Beams  @": "*100",
        "Lintels  @": "*75",
        "Roof Beams  @": "*100",
        "Roof Slab  @": "*0.125*80",
    }
    steel_rows = []
    for label, factor in expected_factors.items():
        row = row_containing(sheet, label)
        steel_rows.append(row)
        assert factor in sheet.cell(row, 10).value
    stair = row_containing(sheet, "Stair case Slab")
    shades = row_containing(sheet, "Sun Shades")
    assert sheet.cell(stair, 10).value == 20
    assert sheet.cell(shades, 10).value == 5
    steel_total = shades + 1
    formula = sheet.cell(steel_total, 10).value
    assert all(f"J{row}" in formula for row in [*steel_rows, stair, shades]), formula
    words = [sheet.cell(row, 1).value for row in range(1, sheet.max_row + 1)]
    assert "(Rupees One Lakh Ninety Three Thousand Three Hundred Seventy Five only)" in words
    assert sheet.freeze_panes is None
    assert workbook.calculation.fullCalcOnLoad is True
    assert workbook.calculation.forceFullCalc is True


def assert_custom_rows_and_items(generate):
    state = controlled_industrial_state()
    form_data = state["components"][0]["sheets"][0]["formData"]
    form_data["customRows"] = {
        "concrete-plinth-long": [{"id": "custom-plinth", "label": "Additional plinth line"}],
    }
    form_data["rows"]["custom-plinth"] = {"no": 1, "length": 2, "breadth": 1, "depth": 1}
    form_data["customItems"] = {
        "standard-0": [{"id": "custom-excavation", "shortDescription": "Special excavation", "detailedDescription": "Special excavation for equipment base"}],
    }
    form_data["rows"].update({
        "custom-excavation:excavation-long": {"no": 1, "length": 2, "breadth": 2, "depth": 1},
        "custom-excavation:excavation-total": {"rate": 100},
    })
    result = generate(state)
    sheet = workbook_from(result)["RCC Building 1 - Ground Floor"]
    custom_section = row_containing(sheet, "CUSTOM ITEMS / MEASUREMENTS", 1)
    custom_plinth = row_containing(sheet, "Additional plinth line")
    custom_item_total = next(
        row for row in range(custom_section + 1, sheet.max_row + 1)
        if "total excavation quantity" in str(sheet.cell(row, 2).value or "").lower()
    )
    assert sheet.cell(custom_plinth, 10).value == (
        f'=IF(COUNT(F{custom_plinth},G{custom_plinth},H{custom_plinth},I{custom_plinth})<4,"",'
        f'F{custom_plinth}*G{custom_plinth}*H{custom_plinth}*I{custom_plinth})'
    )
    assert sheet.cell(custom_item_total, 12).value.startswith("=IF(AND(ISNUMBER(J")
    plinth_total = next(
        row for row in range(17, custom_section)
        if f"J{custom_plinth}" in str(sheet.cell(row, 10).value or "")
    )
    assert f"J{custom_plinth}" in sheet.cell(plinth_total, 10).value
    totals = detail_totals(sheet)
    assert f"L{custom_item_total}" in sheet.cell(totals["total"], 12).value


def assert_centre_line_and_abstract(generate):
    state = {
        "propertyType": "commercial",
        "details": {
            "applicantName": "Centre Line QA",
            "measurementMethod": "centre_line",
            "customComponentEstimates": [{"description": "Custom component estimate", "amount": 2500}],
            "customCommonExternalWorks": [{"description": "Custom common external work", "amount": 750}],
            "commonExternalWorks": {"Electrical Works": 500},
        },
        "components": [{
            "kind": "rcc_building",
            "name": "Commercial Building 1",
            "sheets": [{
                "key": "ground",
                "label": "Ground Floor",
                "level": 1,
                "formData": {"finalAmount": 100000, "rows": {"excavation-centre-1": {"no": 1, "length": 10, "breadth": 1, "depth": 1}}},
            }],
        }],
    }
    result = generate(state)
    workbook = workbook_from(result)
    detail = workbook["Commercial Building 1 - Ground"]
    assert row_containing(detail, "All-round Building")
    assert all(str(detail.cell(row, 2).value or "").strip() != "Long Walls" for row in range(1, detail.max_row + 1))
    abstract = workbook["Abstract"]
    assert abstract.cell(row_containing(abstract, "Custom component estimate"), 12).value == 2500
    assert abstract.cell(row_containing(abstract, "Custom common external work"), 12).value == 750
    assert abstract.cell(row_containing(abstract, "Electrical Works"), 12).value == 500
    total = row_containing(abstract, "TOTAL ESTIMATED PROJECT COST", 1)
    total_formula = abstract.cell(total, 12).value
    assert f"L{row_containing(abstract, 'Custom component estimate')}" in total_formula
    assert f"L{row_containing(abstract, 'Custom common external work')}" in total_formula
    words = abstract.cell(total + 1, 1).value
    assert words == "(Rupees One Lakh Three Thousand Seven Hundred Fifty only)"


def assert_compact_typical_and_offline(generate):
    state = {
        "propertyType": "residential",
        "details": {"applicantName": "Typical QA", "measurementMethod": "centre_line"},
        "components": [{
            "kind": "residential_building",
            "name": "Residential Building 1",
            "sheets": [{
                "key": "ground",
                "label": "Typical GF, FF & SF",
                "level": 1,
                "typicalFloorKeys": ["ground", "first", "second"],
                "formData": {"finalAmount": 300000},
            }],
        }],
    }
    result = generate(state)
    assert result.sheet_names == ("Typical GF, FF & SF",)
    sheet = workbook_from(result)["Typical GF, FF & SF"]
    abstract_row = row_containing(sheet, "A B S T R A C T", 1)
    place_row = row_containing(sheet, "Place :", 1)
    assert abstract_row < place_row
    assert sheet.cell(abstract_row + 3, 1).value == "(Rupees Three Lakh only)"

    offline = generate(state, mode="offline")
    offline_sheet = workbook_from(offline)["Typical GF, FF & SF"]
    all_words = [str(offline_sheet.cell(row, 1).value or "") for row in range(1, offline_sheet.max_row + 1)]
    assert all_words.count("(Rupees [amount in words to be generated by the application] only)") == 2


def assert_every_master_variant_is_selectable(generate):
    def building(kind, name):
        return {
            "kind": kind,
            "name": name,
            "sheets": [
                {"key": "cellar", "label": "Cellar", "level": -1, "formData": {}},
                {"key": "stilt", "label": "Stilt", "level": 0, "formData": {}},
                {"key": "ground", "label": "Ground", "level": 1, "formData": {}},
                {"key": "first", "label": "First", "level": 2, "formData": {}},
            ],
        }

    states = [
        {
            "propertyType": "industrial",
            "details": {},
            "components": [
                {"kind": "heavy_machinery_hall", "name": "Heavy Hall", "formData": {}},
                {"kind": "normal_machinery_hall", "name": "Normal Hall", "formData": {}},
                building("rcc_building", "Industrial RCC"),
            ],
        },
        {
            "propertyType": "commercial",
            "details": {"measurementMethod": "long_wall_short_wall"},
            "components": [{"kind": "shed_hall", "name": "Commercial Shed", "formData": {}}, building("rcc_building", "Commercial RCC")],
        },
        {
            "propertyType": "commercial",
            "details": {"measurementMethod": "centre_line"},
            "components": [building("rcc_building", "Commercial CL")],
        },
        {
            "propertyType": "residential",
            "details": {"measurementMethod": "long_wall_short_wall"},
            "components": [building("residential_building", "Residential RCC")],
        },
        {
            "propertyType": "residential",
            "details": {"measurementMethod": "centre_line"},
            "components": [building("residential_building", "Residential CL")],
        },
    ]
    expected_sheet_counts = (7, 6, 5, 4, 4)
    for state, expected in zip(states, expected_sheet_counts):
        result = generate(state, mode="offline")
        workbook = workbook_from(result)
        assert len(workbook.sheetnames) == expected
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str) and cell.value.startswith("="):
                        assert "#REF!" not in cell.value


def assert_a4_print_layout(generate):
    state = controlled_industrial_state()
    for mode in ("completed", "offline"):
        workbook = workbook_from(generate(state, mode=mode))
        for sheet in workbook.worksheets:
            assert str(sheet.page_setup.paperSize) == str(sheet.PAPERSIZE_A4)
            assert sheet.page_setup.orientation == sheet.ORIENTATION_LANDSCAPE
            assert sheet.page_setup.fitToWidth == 1
            assert sheet.page_setup.fitToHeight == 0
            assert sheet.page_setup.scale is None
            assert sheet.sheet_properties.pageSetUpPr.fitToPage is True
            assert sheet.print_options.horizontalCentered is True
            assert sheet.print_area.endswith(f"$A$1:$L${sheet.max_row}"), sheet.print_area


def assert_canara_panel_list(generate):
    workbook = workbook_from(generate(controlled_industrial_state()))
    for sheet in workbook.worksheets:
        header = " ".join(
            str(sheet.cell(row, column).value or "")
            for row in range(1, min(sheet.max_row, 6) + 1)
            for column in range(1, min(sheet.max_column, 12) + 1)
        )
        assert "Canara Bank" in header, sheet.title


def assert_offline_summary_validation():
    from backend.app.estimation.summary import validate_estimation_summary

    state = {
        "propertyType": "industrial",
        "components": [
            {"name": "Production Hall", "kind": "normal_machinery_hall", "sheets": []},
            {"name": "RCC Building", "kind": "rcc_building", "sheets": [{"key": "ground", "label": "Ground Floor", "level": 1}]},
        ],
    }
    valid = validate_estimation_summary(state, {
        "components": [
            {"label": "Production Hall", "estimatedCost": 0, "source": "workbook"},
            {"label": "RCC Building - Ground Floor", "estimatedCost": 125000, "source": "workbook"},
        ],
        "worksheetNames": ["Abstract", "Production Hall", "RCC Building - Ground Floor"],
        "totalEstimatedCost": 125000,
    })
    assert [item["label"] for item in valid["components"]] == ["Production Hall", "RCC Building - Ground Floor"]

    try:
        validate_estimation_summary(state, {
            "components": [
                {"label": "Production Hall", "estimatedCost": None},
                {"label": "Additional custom work", "estimatedCost": 5000},
            ],
            "worksheetNames": ["Abstract", "Production Hall", "Unrelated Sheet"],
        })
    except ValueError as error:
        message = str(error)
        assert "Missing worksheets: RCC Building - Ground Floor" in message
        assert "Unexpected worksheets: Unrelated Sheet" in message
        assert "Missing components: RCC Building - Ground Floor" in message
        assert "Unexpected components: Additional custom work" in message
        assert "Final value missing for: Production Hall" in message
    else:
        raise AssertionError("Missing, blank and additional workbook content must be rejected")


def main():
    generate = load_generator()
    identity_book = workbook_from(generate(controlled_industrial_state()))
    identity_text = "\n".join(str(cell.value or "") for sheet in identity_book for row in sheet for cell in row)
    assert "Name of the Applicant : Controlled QA, QA Location" in identity_text
    assert "QA Address" not in identity_text
    identity_book.close()
    assert_controlled_steel(generate)
    assert_custom_rows_and_items(generate)
    assert_centre_line_and_abstract(generate)
    assert_compact_typical_and_offline(generate)
    assert_every_master_variant_is_selectable(generate)
    assert_a4_print_layout(generate)
    assert_canara_panel_list(generate)
    assert_offline_summary_validation()
    print("PASS: deployable Python estimation generation")


if __name__ == "__main__":
    main()
