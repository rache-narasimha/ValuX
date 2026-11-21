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
    words = row_containing(sheet, "(Rupees", 1)
    return {
        "total": words - 2,
        "estimated": words,
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


def assert_shared_work_header(generate):
    state = {
        "propertyType": "residential",
        "details": {"applicantName": "Work Name QA", "workDescription": "Residential development", "workAddress": "Adoni"},
        "components": [
            {
                "kind": "residential_building",
                "name": name,
                "sheets": [{"key": "ground", "label": "Ground Floor", "level": 1, "formData": {}}],
            }
            for name in ("Residential Building / Block 1", "Block 2")
        ],
    }
    for mode in ("completed", "offline"):
        workbook = workbook_from(generate(state, mode=mode))
        try:
            assert workbook.sheetnames == ["Abstract", "Building 1 GF", "Block 2 GF"]
            assert workbook["Building 1 GF"]["A8"].value == (
                "Name of the Work : Proposed construction of Residential development at Adoni"
            )
            assert workbook["Block 2 GF"]["A8"].value == (
                "Name of the Work : Proposed construction of Residential development at Adoni"
            )
            assert row_containing(workbook["Abstract"], "Proposed construction of Residential development at Adoni", 1)
        finally:
            workbook.close()


def assert_measurement_labels_are_literal_text(generate):
    state = controlled_industrial_state()
    state["components"][0]["sheets"][0]["formData"]["rows"]["concrete-footings"]["setupLabel"] = "=1+1"
    workbook = workbook_from(generate(state))
    try:
        labels = [cell for sheet in workbook for cell in sheet["B"] if cell.value == "=1+1"]
        assert labels, "The entered measurement label must be retained."
        assert all(cell.data_type == "s" for cell in labels), "Labels must never become Excel formulas."
    finally:
        workbook.close()


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
    assert "(Rupees One Lakh Ninety Three Thousand only)" in words
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


def assert_standard_item_removal(generate):
    state = controlled_industrial_state()
    form = state["components"][0]["sheets"][0]["formData"]
    form["omittedItems"] = {"standard-4": True}
    form["rows"]["steel-total"]["rate"] = 65
    form["rows"]["pcc-total"] = {"directQuantity": 42.0696, "rate": 3561.89}
    form["finalAmount"] = 999999
    form["customRows"] = {"concrete-plinth-long": [{"id": "removed-line", "label": "Removed plinth entry"}]}
    workbook = workbook_from(generate(state))
    sheet = workbook["RCC Building 1 - Ground Floor"]
    totals = detail_totals(sheet)
    serials = [sheet.cell(row, 1).value for row in range(17, totals["total"]) if sheet.cell(row, 1).data_type == "n" and sheet.cell(row, 1).value is not None]
    assert serials == list(range(1, 24))
    assert sheet.cell(38, 1).value == 5
    assert not any("Removed plinth entry" in str(sheet.cell(row, 2).value or "") for row in range(17, totals["total"]))
    steel = row_containing(sheet, "Footings @")
    assert sheet.cell(steel, 10).value == '=IF(ISNUMBER($XFD$1),$XFD$1*75,"")'
    pcc_total = next(cell.row for cell in sheet["J"] if cell.value == 42.0696)
    assert sheet.cell(pcc_total, 12).value.endswith(f'ROUND(ROUND(J{pcc_total},2)*ROUND(K{pcc_total},2),2),"")')
    assert sheet.cell(totals["estimated"], 12).data_type == "f"
    assert "One Lakh Fifty One Thousand" in sheet.cell(totals["estimated"], 1).value
    workbook.close()

    del form["omittedItems"]
    workbook = workbook_from(generate(state))
    sheet = workbook["RCC Building 1 - Ground Floor"]
    assert sheet.cell(row_containing(sheet, "Removed plinth entry"), 2).value == "Removed plinth entry"
    workbook.close()


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
                "formData": {"sheetTotalOverride": 100000, "rows": {"excavation-centre-1": {"no": 1, "length": 10, "breadth": 1, "depth": 1}}},
            }],
        }],
    }
    result = generate(state)
    workbook = workbook_from(result)
    detail = workbook["Commercial Building 1 - Ground"]
    assert row_containing(detail, "All-round Building")
    assert all(str(detail.cell(row, 2).value or "").strip() != "Long Walls" for row in range(1, detail.max_row + 1))
    abstract = workbook["Abstract"]
    assert abstract.cell(row_containing(abstract, "Custom component estimate"), 12).value == 3000
    assert abstract.cell(row_containing(abstract, "Custom common external work"), 12).value == 1000
    assert abstract.cell(row_containing(abstract, "Electrical Works"), 12).value == 1000
    total = row_containing(abstract, "(Rupees", 1) - 1
    total_formula = abstract.cell(total, 12).value
    assert f"L{row_containing(abstract, 'Custom component estimate')}" in total_formula
    assert f"L{row_containing(abstract, 'Custom common external work')}" in total_formula
    words = abstract.cell(total + 1, 1).value
    assert words == "(Rupees One Lakh Five Thousand only)"


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
                "formData": {"sheetTotalOverride": 300000},
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



def assert_ceiling_room_schedule(generate):
    from backend.app.estimation import generator

    state = controlled_industrial_state()
    state["propertyType"] = "commercial"
    state["details"]["measurementMethod"] = "centre_line"
    data = state["components"][0]["sheets"][0]["formData"]
    data["dimensionSetup"] = {"additions": {"ceiling-inside": [
        {"id": "setup-ceiling-inside-1", "label": "Room A"},
        {"id": "setup-ceiling-inside-2", "label": "Room B"},
    ]}}
    data["rows"] = {
        "ceiling-inside": {"setupOmitted": True},
        "setup-ceiling-inside-1": {"no": 2, "length": 5, "breadth": 4},
        "setup-ceiling-inside-2": {"no": 1, "setupQuantity": 10},
        "ceiling-beams": {"factor": 0.25},
        "ceiling-net": {"factor": 1, "rate": 100},
        "concrete-roof-slab": {"no": 1, "length": 27.2, "breadth": 17.89},
        "filling-basement": {"no": 1, "length": 27.2, "breadth": 17.89, "depth": 0.9},
        "waterproofing-roof": {"no": 1, "length": 27.2, "breadth": 17.89},
        "steel-roof-slab": {"factor": 8.75, "steelRate": 70, "slabDepth": 0.125},
    }
    manifest = generator._load_manifest()
    spec = generator._detail_specs(state, manifest)[0]
    assert generator._effective_final_amount(spec, manifest) == 6000
    workbook = workbook_from(generate(state))
    sheet = workbook[spec.name]
    room_a = row_containing(sheet, "Room A")
    room_b = row_containing(sheet, "Room B")
    beams = row_containing(sheet, "Add 25% for beams")
    assert room_a + 1 == room_b == beams - 1
    assert sheet.row_dimensions[room_a - 1].hidden
    assert [sheet.cell(room_a, col).value for col in (6, 7, 8)] == [2, 5, 4]
    assert sheet.cell(room_b, 10).value == 10
    assert all(f"J{row}" in sheet.cell(beams, 10).value for row in (room_a, room_b))
    assert all(f"J{row}" in sheet.cell(beams + 1, 10).value for row in (room_a, room_b, beams))
    assert "ROUND(ROUND(" in sheet.cell(beams + 1, 12).value
    coat = next(cell.row for cell in sheet["B"] if str(cell.value).strip().lower() == "over roof slab")
    assert [sheet.cell(coat, col).value for col in (6, 7, 8)] == [1, 27.2, 17.89]
    slab_steel = row_containing(sheet, "70 kg/m³, 0.125 m thick")
    assert "*0.125*70" in sheet.cell(slab_steel, 10).value
    workbook.close()

    items = manifest["worksheets"][spec.template_key]["items"]
    ceiling_index = next(index for index, item in enumerate(items)
                         if any(row["id"] == "ceiling-inside" for row in item["rows"]))
    data["omittedItems"] = {f"standard-{ceiling_index}": True}
    workbook = workbook_from(generate(state))
    assert not any(cell.value in {"Room A", "Room B"} for cell in workbook[spec.name]["B"])
    workbook.close()


    # The same schedule also generates wall-room rows for Long Wall / Short Wall.
    del data["omittedItems"]
    state["details"]["measurementMethod"] = "long_wall_short_wall"
    data["dimensionSetup"]["additions"]["plaster-gross"] = [
        {"id": "setup-plaster-gross-1", "label": "Room A walls"},
        {"id": "setup-plaster-gross-2", "label": "Room B walls"},
    ]
    data["rows"].update({
        "plaster-gross": {"setupOmitted": True},
        "setup-plaster-gross-1": {"no": 2, "length": 18, "depth": 3},
        "setup-plaster-gross-2": {"no": 1, "length": 14, "depth": 3},
        "plaster-net": {"rate": 100},
    })
    spec = generator._detail_specs(state, manifest)[0]
    assert generator._effective_final_amount(spec, manifest) == 20000
    workbook = workbook_from(generate(state))
    sheet = workbook[spec.name]
    wall_room = row_containing(sheet, "Room A walls")
    assert sheet.cell(wall_room + 1, 2).value == "Room B walls"
    assert not sheet.row_dimensions[wall_room - 1].hidden
    assert sheet.cell(wall_room - 1, 10).value is None
    assert [sheet.cell(wall_room, col).value for col in (6, 7, 9)] == [2, 18, 3]
    assert f"F{wall_room}*G{wall_room}*I{wall_room}" in sheet.cell(wall_room, 10).value
    assert all(f"J{row}" in sheet.cell(wall_room + 2, 10).value for row in (wall_room, wall_room + 1))
    workbook.close()


def assert_grouped_floor_amounts_and_direct_quantities(generate):
    from backend.app.estimation import generator

    assert generator._displayed_price(42.0696, 3561.89) == 149848.71

    state = controlled_industrial_state()
    state["propertyType"] = "commercial"
    state["details"]["measurementMethod"] = "centre_line"
    component = state["components"][0]
    component["sheets"] = [
        {"key": "stilt", "label": "Stilt Floor", "level": 0, "layoutVersion": 2},
        {
            "key": "ground", "label": "Typical GF, FF & SF", "level": 1, "layoutVersion": 2,
            "typicalFloorKeys": ["ground", "first", "second"], "typicalBasis": "per-floor",
            "formData": {"manualMeasurements": True, "dimensionsRequired": True, "rows": {
                "concrete-columns": {"directQuantity": 12.5, "rate": 100},
                "steel-columns": {"factor": 150},
                "steel-total": {"rate": 1},
                "whitewashing": {"amount": 250},
            }},
        },
    ]
    manifest = generator._load_manifest()
    spec = generator._detail_specs(state, manifest)[1]
    assert spec.template_key == "commercial_rcc_upper_centre_line"
    assert generator._effective_final_amount(spec, manifest) == 10000
    with_workbook = workbook_from(generate(state))
    sheet = with_workbook[spec.name]
    assert with_workbook["Abstract"]["B17"].value == "Cost of construction for GF, FF & SF"
    column = row_containing(sheet, "Columns")
    assert sheet.cell(column, 10).value == 12.5
    assert sheet.cell(column, 10).number_format == "#,##0.00"
    assert sheet.cell(column, 12).value.endswith('*3,"")')
    assert f"ROUND(ROUND(J{column},2)*ROUND(K{column},2),2)" in sheet.cell(column, 12).value
    assert sheet.cell(row_containing(sheet, "White washing"), 12).value == "=250*3"
    with_workbook.close()

    del component["sheets"][1]["typicalBasis"]
    legacy = generator._detail_specs(state, manifest)[1]
    assert legacy.floor_multiplier == 1
    assert generator._effective_final_amount(legacy, manifest) == 3000

def assert_industrial_centre_line_requires_upload(generate):
    state = controlled_industrial_state()
    state["details"]["measurementMethod"] = "centre_line"
    for mode in ("completed", "offline"):
        try:
            generate(state, mode=mode)
        except ValueError as error:
            assert "industrial Centre Line estimate offline" in str(error)
        else:
            raise AssertionError("Industrial Centre Line must use an externally completed report")
    state["details"]["measurementMethod"] = "long_wall_short_wall"
    assert workbook_from(generate(state, mode="offline")).sheetnames


def assert_ground_floor_ending(generate):
    from backend.app.estimation.generator import _rounded_estimate
    for amount, expected in ((499, 0), (500, 1000), (1499.49, 1000), (1500, 2000), (2743578.72, 2744000)):
        assert _rounded_estimate(amount) == expected
    state = controlled_industrial_state()
    state["propertyType"] = "residential"
    state["details"].update(identityVersion=2, workDescription="Residential Building in GF", workAddress="Adoni")
    component = state["components"][0]
    component["kind"] = "residential_building"
    component["sheets"][0]["formData"]["sheetTotalOverride"] = 2743578.72
    for mode in ("completed", "offline"):
        generated = generate(state, mode=mode)
        workbook = workbook_from(generated)
        assert len(workbook.sheetnames) == 1
        sheet = workbook.worksheets[0]
        text = [str(cell.value or "") for row in sheet.iter_rows(max_col=12) for cell in row]
        assert "A B S T R A C T" not in text
        assert "TOTAL CALCULATED COST" not in text
        assert "TOTAL ESTIMATED PROJECT COST" not in text
        ending = detail_totals(sheet)
        assert sheet.cell(ending["estimated"] - 1, 12).value is None
        assert sheet.cell(ending["total"], 1).value is None
        assert sheet["A8"].value == "Name of the Work : Proposed construction of Residential Building in GF at Adoni"
        assert text.count("SIGNATURE OF VALUER") == 1
        assert sheet["F18"].font.sz >= 12, "Empty offline measurement cells must also use readable fonts"
        assert "Phone : 9133669642" in sheet["A3"].value
        assert "  Phone" not in sheet["A3"].value
        assert sheet["A3"].alignment.wrap_text
        for row in sheet.iter_rows(max_col=12):
            for cell in row:
                if cell.value is not None:
                    assert cell.font.sz >= (11 if cell.row in (2, 3, 4) else 12), cell.coordinate
        if mode == "completed":
            assert generated.summary["totalEstimatedCost"] == 2744000
            assert sheet.cell(ending["estimated"], 12).value == 2744000
            assert "Twenty Seven Lakh Forty Four Thousand" in sheet.cell(ending["estimated"], 1).value
        workbook.close()


def main():
    generate = load_generator()
    identity_book = workbook_from(generate(controlled_industrial_state()))
    identity_text = "\n".join(str(cell.value or "") for sheet in identity_book for row in sheet for cell in row)
    assert "Name of the Applicant : Controlled QA, QA Location" in identity_text
    assert "QA Address" not in identity_text
    identity_book.close()
    assert_shared_work_header(generate)
    assert_measurement_labels_are_literal_text(generate)
    assert_ground_floor_ending(generate)
    assert_controlled_steel(generate)
    assert_industrial_centre_line_requires_upload(generate)
    assert_custom_rows_and_items(generate)
    assert_standard_item_removal(generate)
    assert_centre_line_and_abstract(generate)
    assert_compact_typical_and_offline(generate)
    assert_every_master_variant_is_selectable(generate)
    assert_a4_print_layout(generate)
    assert_canara_panel_list(generate)
    assert_offline_summary_validation()
    assert_grouped_floor_amounts_and_direct_quantities(generate)
    assert_ceiling_room_schedule(generate)
    print("PASS: deployable Python estimation generation")


if __name__ == "__main__":
    main()
