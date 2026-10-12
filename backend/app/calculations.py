"""Business calculations and template replacement values."""

import json

from .config import AGRICULTURAL_MAPPING, DEFAULT_VALUER_NAME, DEFAULT_VALUER_NAME_ADDRESS
from .formatting import (
    AREA_LABELS,
    amount_in_words,
    converted_area,
    currency,
    display_date,
    document_indexes,
    floor_indexes,
    normalized_document_values,
    number_value,
)

def calculate_floor(values, index):
    prefix = f"building.floors.{index}."
    area = number_value(values.get(prefix + "plinth_area")) or 0
    rate = number_value(values.get(prefix + "replacement_rate")) or 0
    age = max(0, number_value(values.get(prefix + "age")) or 0)
    life = number_value(values.get(prefix + "total_life"))
    if not life:
        life = {"rcc": 60, "industrial": 35, "temporary": 20}.get(values.get(prefix + "structure_type"), 60)
    replacement = area * rate
    depreciation = replacement * min(age, life) / life * 0.9 if life else 0
    net = max(0, replacement - depreciation)
    return replacement, depreciation, net, int(life)

def calculated_replacements(values):
    result = {k: display_date(v) if k.startswith("report.") and k.endswith("date") else v for k, v in values.items()}
    if values.get("building.plan_validity"):
        result["building.plan_validity"] = f"Dt.{display_date(values['building.plan_validity'])}"
    valuation_date = display_date(values.get("report.valuation_date"))
    inspection_date = display_date(values.get("report.inspection_date"))
    if valuation_date:
        result["report.valuation_date"] = valuation_date
        result["report.valuation_date_detail"] = valuation_date
        result["VALUATION_DATE"] = valuation_date
    if inspection_date:
        result["report.inspection_date"] = inspection_date
        result["INSPECTION_DATE"] = inspection_date

    extent_in_rate_unit = converted_area(values.get("land.extent_value"), values.get("land.extent_unit"), values.get("land.rate_unit"))
    adopted_rate = number_value(values.get("land.adopted_rate_value"))
    land = extent_in_rate_unit * adopted_rate if extent_in_rate_unit is not None and adopted_rate is not None else number_value(values.get("land.estimated_value"))
    if land is not None:
        result["land.estimated_value"] = currency(land, prefix=True)
        result["abstract.land"] = currency(land)
        result["property.valuation_extent"] = f"{number_value(values.get('land.extent_value')) or 0:g} {values.get('land.extent_unit_label', values.get('land.extent_unit', ''))}"

    building_values = []
    floor_summaries = []
    plinth_summaries = []
    for index in floor_indexes(values):
        prefix = f"building.floors.{index}."
        replacement, depreciation, net, life = calculate_floor(values, index)
        result[prefix + "replacement_cost"] = currency(replacement)
        result[prefix + "depreciation"] = currency(depreciation)
        result[prefix + "net_value"] = currency(net)
        result[prefix + "total_life"] = str(life)
        building_values.append(net)
        name = values.get(prefix + "name", f"Floor {index}")
        height = values.get(prefix + "roof_height", "")
        area = values.get(prefix + "plinth_area", "")
        floor_summaries.append(f"{name}: {height} ft" if height else str(name))
        plinth_summaries.append(f"{name}: {area} Sq.ft" if area else str(name))
    building = sum(building_values)
    if building_values:
        result["abstract.building"] = currency(building)
        result["BUILDING_VALUE"] = currency(building)
        result["building.floor_summary"] = ", ".join(floor_summaries)
        result["building.plinth_summary"] = ", ".join(plinth_summaries)

    components = [land or 0, building]
    for key in ("abstract.extra", "abstract.amenities", "abstract.miscellaneous", "abstract.services", "abstract.machinery"):
        amount = number_value(values.get(key)) or 0
        result[key] = currency(amount) if amount else "-"
        components.append(amount)
    pmv = sum(components)
    if pmv <= 0:
        pmv = number_value(values.get("valuation.present_market_value")) or number_value(values.get("abstract.total"))
    if pmv is not None:
        pmv_text = currency(pmv)
        realizable_text = currency(pmv * 0.90)
        distress_text = currency(pmv * 0.80)
        result.update({
            "valuation.present_market_value": pmv_text,
            "valuation.realizable_value": realizable_text,
            "valuation.distress_value": distress_text,
            "abstract.present_market_value": pmv_text,
            "abstract.total": pmv_text,
            "PRESENT_MARKET_VALUE": pmv_text,
        })
    else:
        pmv_text = realizable_text = distress_text = "-"

    return result, pmv_text, realizable_text, distress_text

def agricultural_replacements(values):
    values = normalized_document_values(values)
    mapping = json.loads(AGRICULTURAL_MAPPING.read_text(encoding="utf-8"))["slots"]
    replacements = {}
    for field_id, placeholder in mapping.items():
        if field_id.startswith("media."):
            continue
        token = placeholder.removeprefix("{{").removesuffix("}}")
        value = values.get(field_id, "")
        if field_id.endswith("_date") or field_id in {
            "report.assignment_date", "report.inspection_date", "report.valuation_date", "report.report_date"
        }:
            value = display_date(value)
        replacements[token] = value

    bank_name = str(values.get("bank.name", ""))
    replacements["BANK_NAME_UPPER"] = bank_name.upper()
    replacements["BANK_NAME"] = bank_name
    replacements["BRANCH_NAME"] = values.get("bank.branch", "")
    replacements["VALUER_NAME_ADDRESS"] = DEFAULT_VALUER_NAME_ADDRESS
    replacements["VALUER_NAME"] = DEFAULT_VALUER_NAME
    if number_value(values.get("property.annual_income")) is not None:
        replacements["ANNUAL_INCOME"] = currency(values["property.annual_income"], prefix=True)

    rows = []
    for index in document_indexes(values):
        doc_type = str(values.get(f"documents.{index}.type", "")).strip()
        details = str(values.get(f"documents.{index}.details", "")).strip()
        replacements[f"DOCUMENT_{index}_TYPE"] = doc_type
        replacements[f"DOCUMENT_{index}_DETAILS"] = details
        if doc_type or details:
            rows.append(" - ".join(part for part in (doc_type, details) if part))
    replacements["DOCUMENTS_SUMMARY"] = "; ".join(rows)

    extent = number_value(values.get("valuation.total_extent_value"))
    extent_unit = values.get("valuation.extent_unit")
    rate = number_value(values.get("valuation.adopted_rate_value"))
    rate_unit = values.get("valuation.adopted_rate_unit")
    converted_extent = converted_area(extent, extent_unit, rate_unit)
    estimated = converted_extent * rate if converted_extent is not None and rate is not None else None
    unit_label = AREA_LABELS.get(extent_unit, str(extent_unit or ""))
    rate_unit_label = AREA_LABELS.get(rate_unit, str(rate_unit or ""))

    total_extent_text = f"{extent:g} {unit_label}" if extent is not None else ""
    replacements["TOTAL_EXTENT"] = total_extent_text
    replacements["VALUATION_EXTENT"] = total_extent_text
    if not replacements.get("SITE_EXTENT"):
        replacements["SITE_EXTENT"] = total_extent_text

    for source, token in (
        ("valuation.prevailing_rate_value", "PREVAILING_RATE"),
        ("valuation.guideline_rate_value", "GUIDELINE_RATE"),
        ("valuation.adopted_rate_value", "ADOPTED_RATE"),
    ):
        amount = number_value(values.get(source))
        unit = values.get(source.replace("_value", "_unit")) or rate_unit
        label = AREA_LABELS.get(unit, str(unit or ""))
        replacements[token] = f"Rs.{currency(amount)} per {label}" if amount is not None else ""

    if estimated is not None:
        book = estimated
        distress = estimated * 0.80
        replacements.update({
            "ESTIMATED_VALUE": currency(estimated),
            "ESTIMATED_VALUE_WORDS": amount_in_words(estimated),
            "BOOK_VALUE": currency(book),
            "BOOK_VALUE_WORDS": amount_in_words(book),
            "DISTRESS_VALUE": currency(distress),
            "DISTRESS_VALUE_WORDS": amount_in_words(distress),
        })
    replacements["CONVERTED_EXTENT"] = f"{converted_extent:g} {rate_unit_label}" if converted_extent is not None else ""
    return replacements

