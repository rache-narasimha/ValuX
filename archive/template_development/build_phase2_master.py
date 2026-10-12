from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree


ROOT = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1")
SOURCE = ROOT / "Valuation_Report_Master_Template_Revised.docx"
OUTPUT = ROOT / "Valuation_Report_Master_Template_Phase2.docx"
SCHEMA_OUTPUT = ROOT / "phase2_form_schema.json"
MAPPING_OUTPUT = ROOT / "phase2_template_mapping.json"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
qn = lambda name: f"{{{W}}}{name}"


def cell(field_id, table, row, col, label, group, field_type="text", required=False, **extra):
    item = {
        "id": field_id,
        "label": label,
        "group": group,
        "type": field_type,
        "required": required,
        "locator": {"kind": "table_cell", "table": table, "row": row, "cell": col},
    }
    item.update(extra)
    return item


FIELDS = [
    cell("report.valuation_date", 0, 1, 0, "Date of valuation", "Report", "date", True),
    cell("property.summary_description", 0, 1, 1, "Property description for cover letter", "Property", required=True),
    cell("valuation.present_market_value", 0, 1, 2, "Present market value", "Valuation", "currency", True, calculated=True),
    cell("valuation.realizable_value", 0, 1, 3, "Realizable value", "Valuation", "currency", True, calculated=True, formula="present_market_value * 0.90"),
    cell("valuation.distress_value", 0, 1, 4, "Distress value", "Valuation", "currency", True, calculated=True, formula="present_market_value * 0.80"),
    cell("valuation.government_value", 0, 1, 5, "Government value", "Valuation", "currency"),
    cell("report.purpose", 1, 1, 2, "Purpose of valuation", "Report", required=True),
    cell("report.inspection_date", 1, 2, 4, "Date of inspection", "Report", "date", True),
    cell("report.valuation_date_detail", 1, 3, 4, "Date of valuation", "Report", "date", True, source="report.valuation_date"),
    cell("documents.deed_type", 1, 5, 1, "Deed type", "Documents", "select", True, options=["Sale Deed", "Rectification Deed", "Partition Deed", "Relinquishment Deed"]),
    cell("documents.deed_details", 1, 5, 3, "Deed number and date", "Documents", required=True),
    cell("documents.approved_plan", 1, 6, 3, "Approved plan details", "Documents"),
    cell("documents.legal_scrutiny", 1, 7, 3, "Legal scrutiny report", "Documents"),
    cell("documents.tax_receipt", 1, 8, 3, "Tax paid receipt", "Documents"),
    cell("owner.details", 1, 9, 3, "Owner name address and phone", "Parties", "textarea", True),
    cell("property.description", 1, 10, 3, "Brief description of property", "Property", required=True),
    cell("property.plot_survey_number", 1, 12, 4, "Plot and survey number", "Property", required=True),
    cell("property.door_number", 1, 13, 4, "Door number", "Property"),
    cell("property.village", 1, 14, 4, "Village or locality", "Property", required=True),
    cell("property.ward_taluka", 1, 15, 4, "Ward or taluka", "Property"),
    cell("property.mandal_district", 1, 16, 4, "Mandal and district", "Property", required=True),
    cell("property.postal_address", 1, 17, 3, "Postal address", "Property", "textarea", True),
    cell("property.city", 1, 18, 3, "City or town", "Property", required=True),
    cell("property.area.residential", 1, 19, 3, "Residential area", "Property", "boolean"),
    cell("property.area.commercial", 1, 20, 3, "Commercial area", "Property", "boolean"),
    cell("property.area.industrial", 1, 21, 3, "Industrial area", "Property", "boolean"),
    cell("property.area_quality", 1, 23, 4, "Area classification", "Property", "select", options=["High", "Middle", "Poor"]),
    cell("property.urban_classification", 1, 24, 4, "Urban classification", "Property", "select", options=["Urban", "Semi Urban", "Rural"]),
    cell("property.local_authority_limit", 1, 25, 3, "Local authority limit", "Property"),
    cell("property.government_enactment", 1, 26, 3, "Government enactment coverage", "Property"),
    cell("property.agricultural_conversion", 1, 27, 3, "Agricultural conversion", "Property", conditional="property.category == agricultural"),
]

for direction, row in zip(["north", "south", "east", "west"], range(29, 33)):
    FIELDS.append(cell(f"property.boundary.{direction}.deed", 1, row, 3, f"{direction.title()} boundary as per deed", "Boundaries", required=True))
    FIELDS.append(cell(f"property.boundary.{direction}.actual", 1, row, 4, f"{direction.title()} boundary as per actual", "Boundaries", required=True))

for direction, row in zip(["north", "south", "east", "west"], range(35, 39)):
    FIELDS.append(cell(f"property.dimension.{direction}.deed", 1, row, 3, f"{direction.title()} dimension as per deed", "Dimensions"))
    FIELDS.append(cell(f"property.dimension.{direction}.actual", 1, row, 4, f"{direction.title()} dimension as per actual", "Dimensions"))

FIELDS += [
    cell("property.coordinates", 1, 39, 3, "Latitude and longitude", "Property"),
    cell("property.site_extent", 1, 40, 3, "Site extent", "Land", required=True),
    cell("property.valuation_extent", 1, 41, 3, "Extent considered for valuation", "Land", required=True),
    cell("property.road_affected_area", 1, 42, 3, "Road affected area", "Property"),
    cell("property.occupancy", 1, 43, 3, "Occupancy and rent details", "Property"),
    cell("site.classification", 1, 45, 3, "Locality classification", "Site"),
    cell("site.surrounding_development", 1, 46, 3, "Development of surrounding area", "Site"),
    cell("site.flooding", 1, 47, 3, "Flooding or submerging possibility", "Site"),
    cell("site.civic_amenities", 1, 48, 3, "Distance to civic amenities", "Site"),
    cell("site.topography", 1, 49, 3, "Topographical condition", "Site"),
    cell("site.shape", 1, 50, 3, "Shape of land", "Site"),
    cell("site.permitted_use", 1, 51, 3, "Permitted use", "Site"),
    cell("site.usage_restriction", 1, 52, 3, "Usage restriction", "Site"),
    cell("site.layout_approval", 1, 53, 3, "Town-planning layout approval", "Site"),
    cell("site.plot_position", 1, 54, 3, "Corner or intermediate plot", "Site"),
    cell("site.road_facilities", 1, 55, 3, "Road facilities", "Site"),
    cell("site.road_type", 1, 56, 3, "Road type", "Site"),
    cell("site.road_width", 1, 57, 3, "Road width", "Site"),
    cell("site.land_locked", 1, 58, 3, "Landlocked property", "Site", "boolean"),
    cell("site.water_potential", 1, 59, 3, "Water potential", "Site"),
    cell("site.sewerage", 1, 60, 3, "Underground sewerage", "Site"),
    cell("site.power_supply", 1, 61, 3, "Power supply", "Site", "boolean"),
    cell("site.advantage_1", 1, 63, 4, "Site advantage 1", "Site", required=False),
    cell("site.advantage_2", 1, 64, 4, "Site advantage 2", "Site", required=False),
    cell("site.special_remarks", 1, 65, 3, "Special remarks", "Site", "textarea", required=False),
    cell("site.special_remark_1", 1, 66, 4, "Additional remark 1", "Site", required=False),
    cell("site.special_remark_2", 1, 67, 4, "Additional remark 2", "Site", required=False),
    cell("land.north_south_size", 1, 70, 3, "North south size", "Land"),
    cell("land.east_west_size", 1, 71, 3, "East west size", "Land"),
    cell("land.total_extent", 1, 72, 3, "Total plot extent", "Land", required=True),
    cell("land.prevailing_market_rate", 1, 73, 3, "Prevailing market rate", "Land", required=True),
    cell("land.guideline_rate", 1, 74, 3, "Government guideline rate", "Land", required=True),
    cell("land.adopted_rate", 1, 75, 3, "Adopted land rate", "Land", "currency_rate", True),
    cell("land.estimated_value", 1, 76, 3, "Estimated land value", "Land", "currency", True, calculated=True, formula="valuation_extent * adopted_rate"),
    cell("building.type", 1, 79, 4, "Building use type", "Building", "select", False, options=["Residential", "Commercial", "Industrial"], conditional="property.has_building"),
    cell("building.construction_type", 1, 80, 4, "Construction type", "Building", "select", False, options=["Load Bearing", "RCC Framed", "Steel Framed"], conditional="property.has_building"),
    cell("building.year_age_residual", 1, 81, 4, "Construction year age and residual life", "Building", conditional="property.has_building"),
    cell("building.floor_summary", 1, 82, 4, "Floor and height summary", "Building", conditional="property.has_building", calculated=True),
    cell("building.plinth_summary", 1, 83, 4, "Floor-wise plinth area", "Building", conditional="property.has_building", calculated=True),
    cell("building.condition", 1, 84, 4, "Building condition", "Building", conditional="property.has_building"),
    cell("building.plan_validity", 1, 85, 4, "Approved plan date and validity", "Building", conditional="property.has_building"),
    cell("building.plan_authority", 1, 86, 4, "Plan issuing authority", "Building", conditional="property.has_building"),
    cell("building.plan_verified", 1, 87, 4, "Plan authenticity verified", "Building", "boolean", conditional="property.has_building"),
    cell("building.plan_comments", 1, 88, 4, "Plan authenticity comments", "Building", conditional="property.has_building"),
]

construction_rows = {
    "foundation": 1, "basement": 2, "superstructure": 3, "joinery": 4,
    "rcc_works": 5, "plastering": 6, "flooring": 7, "special_finish": 8,
    "roofing": 9, "drainage": 10,
}
for key, row in construction_rows.items():
    FIELDS.append(cell(f"construction.{key}", 2, row, 2, key.replace("_", " ").title(), "Construction", conditional="property.has_building"))

for field_id, row, label in [
    ("construction.compound_wall_height", 12, "Compound wall height"),
    ("construction.compound_wall_length", 13, "Compound wall length"),
    ("construction.compound_wall_type", 14, "Compound wall construction"),
    ("construction.wiring", 16, "Type of wiring"),
    ("construction.fittings_class", 17, "Class of electrical fittings"),
    ("construction.light_points", 18, "Number of light points"),
    ("construction.fan_points", 19, "Fan points"),
    ("construction.spare_plugs", 20, "Spare plug points"),
    ("construction.electrical_other", 21, "Other electrical item"),
]:
    FIELDS.append(cell(field_id, 2, row, 3, label, "Construction", conditional="property.has_building"))

for field_id, row, label in [
    ("construction.water_closets", 23, "Water closets"),
    ("construction.wash_basins", 24, "Wash basins"),
    ("construction.urinals", 25, "Urinals"),
    ("construction.bath_tubs", 26, "Bath tubs"),
    ("construction.water_meters_taps", 27, "Water meters and taps"),
    ("construction.other_fixtures", 28, "Other plumbing fixtures"),
]:
    FIELDS.append(cell(field_id, 2, row, 4, label, "Construction", conditional="property.has_building"))

floor_fields = ["name", "plinth_area", "roof_height", "age", "replacement_rate", "replacement_cost", "depreciation", "net_value"]
floor_cols = [1, 2, 3, 4, 5, 6, 7, 8]
for index, row in enumerate([31, 32], start=1):
    for name, col in zip(floor_fields, floor_cols):
        FIELDS.append(cell(f"building.floors.{index}.{name}", 2, row, col, f"Floor {index} {name.replace('_', ' ')}", "Floors", conditional="property.has_building", repeatable_group="building.floors", calculated=name in {"replacement_cost", "depreciation", "net_value"}))

for table, prefix, group in [(3, "extra", "Extra Items"), (4, "amenity", "Amenities"), (5, "misc", "Miscellaneous"), (6, "service", "Services")]:
    row_count = {3: 5, 4: 10, 5: 4, 6: 5}[table]
    for row in range(row_count):
        FIELDS.append(cell(f"{prefix}.item_{row+1}", table, row, 3, f"{group} item {row+1}", group, required=False, conditional="property.has_building"))

for field_id, row, label in [
    ("abstract.land", 0, "Land value"), ("abstract.building", 1, "Building value"),
    ("abstract.extra", 2, "Extra items value"), ("abstract.amenities", 3, "Amenities value"),
    ("abstract.miscellaneous", 4, "Miscellaneous value"), ("abstract.services", 5, "Services value"),
    ("abstract.machinery", 6, "Machinery value"), ("abstract.total", 7, "Total value"),
    ("abstract.present_market_value", 8, "Present market value"),
]:
    FIELDS.append(cell(field_id, 7, row, 3, label, "Valuation Abstract", "currency", calculated=True))


def text_of(element):
    return "".join(element.xpath(".//w:t/text()", namespaces=NS))


def unwrap_sdts(element):
    for sdt in list(element.xpath(".//w:sdt", namespaces=NS)):
        content = sdt.find(qn("sdtContent"))
        parent = sdt.getparent()
        position = parent.index(sdt)
        if content is not None:
            for child in list(content):
                content.remove(child)
                parent.insert(position, child)
                position += 1
        parent.remove(sdt)


def wrap_cell(tc, tag, control_id):
    unwrap_sdts(tc)
    contents = [child for child in list(tc) if etree.QName(child).localname != "tcPr"]
    if not contents:
        paragraph = etree.Element(qn("p"))
        run = etree.SubElement(paragraph, qn("r"))
        etree.SubElement(run, qn("t")).text = ""
        contents = [paragraph]
        tc.append(paragraph)
    for child in contents:
        tc.remove(child)
    sdt = etree.Element(qn("sdt"))
    props = etree.SubElement(sdt, qn("sdtPr"))
    alias = etree.SubElement(props, qn("alias")); alias.set(qn("val"), tag)
    tag_el = etree.SubElement(props, qn("tag")); tag_el.set(qn("val"), tag)
    id_el = etree.SubElement(props, qn("id")); id_el.set(qn("val"), str(control_id))
    content = etree.SubElement(sdt, qn("sdtContent"))
    for child in contents:
        content.append(child)
    tc.append(sdt)


def build():
    with ZipFile(SOURCE) as zin:
        xml = etree.fromstring(zin.read("word/document.xml"))
        tables = xml.xpath(".//w:body/w:tbl", namespaces=NS)
        mappings = []
        control_id = 810000
        for field in FIELDS:
            loc = field["locator"]
            table = tables[loc["table"]]
            rows = table.xpath("./w:tr", namespaces=NS)
            cells = rows[loc["row"]].xpath("./w:tc", namespaces=NS)
            tc = cells[loc["cell"]]
            control_id += 1
            original = text_of(tc)
            wrap_cell(tc, field["id"], control_id)
            mappings.append({"id": field["id"], **loc, "sample_text": original})

        with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = etree.tostring(xml, xml_declaration=True, encoding="UTF-8", standalone="yes")
                zout.writestr(item, data)

    groups = []
    for name in ["Report", "Documents", "Parties", "Property", "Boundaries", "Dimensions", "Site", "Land", "Building", "Construction", "Floors", "Extra Items", "Amenities", "Miscellaneous", "Services", "Valuation", "Valuation Abstract", "Media"]:
        groups.append({"id": name.lower().replace(" ", "_"), "label": name})
    schema = {
        "version": 2,
        "template": OUTPUT.name,
        "property_categories": ["residential_plot", "commercial_plot", "industrial_plot", "residential_land_building", "commercial_land_building", "industrial_land_building"],
        "construction_statuses": ["existing", "under_construction", "proposed", "purchase_loan"],
        "groups": groups,
        "fields": [{k: v for k, v in field.items() if k != "locator"} for field in FIELDS],
        "media": {"photos": {"max_per_page": 9, "columns": 3}, "map": {"position": "last"}},
        "fixed_rules": {"realizable_percent": 90, "distress_percent": 80, "highlight_only": "present_market_value", "cover_fair_market_value_color": "#0070C0", "depreciation_formula_status": "pending_user_confirmation"},
    }
    SCHEMA_OUTPUT.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    MAPPING_OUTPUT.write_text(json.dumps({"template": OUTPUT.name, "controls": mappings}, indent=2) + "\n", encoding="utf-8")
    print(f"{OUTPUT}\n{SCHEMA_OUTPUT}\n{MAPPING_OUTPUT}\ncontrols={len(mappings)}")


if __name__ == "__main__":
    build()
