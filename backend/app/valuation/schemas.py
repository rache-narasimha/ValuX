"""Public form-schema assembly for each report type."""

import json
import hashlib
import re

from .config import AGRICULTURAL_SCHEMA, AGRICULTURAL_TEMPLATE, SCHEMA, TEMPLATE


def _template_version(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]

def schema_payload():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    schema["template"] = TEMPLATE.name
    schema["template_version"] = _template_version(TEMPLATE)
    schema["defaults"] = {}
    schema["setup_fields"] = [
        {"id": "property.category", "label": "Property category", "type": "select", "required": True, "options": schema["property_categories"]},
        {"id": "property.status", "label": "Property status", "type": "select", "required": True, "options": schema["construction_statuses"]},
        {"id": "institution.type", "label": "Institution type", "type": "select", "required": True, "options": ["Bank", "NBFC"]},
        {"id": "bank.name", "label": "Bank / NBFC name", "type": "select", "required": True, "options": []},
        {"id": "bank.branch", "label": "Branch", "type": "text", "required": True},
    ]
    labels = {
        "extra.item_1": "Portico", "extra.item_2": "Ornamental front door",
        "extra.item_3": "Sit out / verandah with steel grills", "extra.item_4": "Overhead water tank",
        "extra.item_5": "Extra steel / collapsible gates",
        "amenity.item_1": "Wardrobes", "amenity.item_2": "Glazed tiles",
        "amenity.item_3": "Extra sinks and bath tub", "amenity.item_4": "Marble / ceramic tile flooring",
        "amenity.item_5": "Interior decorations", "amenity.item_6": "Architectural elevation works",
        "amenity.item_7": "Paneling works", "amenity.item_8": "Aluminum works",
        "amenity.item_9": "Aluminum hand rails", "amenity.item_10": "False ceiling",
        "misc.item_1": "Separate toilet room", "misc.item_2": "Separate lumber room",
        "misc.item_3": "Separate water tank / sump", "misc.item_4": "Trees and gardening",
        "service.item_1": "Water supply arrangements", "service.item_2": "Drainage arrangements",
        "service.item_3": "Compound wall", "service.item_4": "C.B. deposits and fittings",
        "service.item_5": "Pavement",
    }
    for field in schema["fields"]:
        field.pop("default", None)
        if field["id"] in labels:
            field["label"] = labels[field["id"]]
        if field["id"] == "building.plan_validity":
            field["type"] = "date"
            field["label"] = "Approved plan date and validity"
    return schema

def agricultural_schema_payload():
    schema = json.loads(AGRICULTURAL_SCHEMA.read_text(encoding="utf-8"))
    schema["template"] = AGRICULTURAL_TEMPLATE.name
    schema["template_version"] = _template_version(AGRICULTURAL_TEMPLATE)
    schema["defaults"] = {}
    return schema


def validate_report_values(report_key, values):
    """Enforce the required valuation fields on the server before generation."""
    if not isinstance(values, dict):
        raise ValueError("The report values are missing.")
    if report_key == "valuation-general":
        schema = schema_payload()
        fields = [*schema["setup_fields"], *schema["fields"]]
        legacy_dynamic = {
            "documents.deed_type", "documents.deed_details", "documents.approved_plan",
            "documents.legal_scrutiny", "documents.tax_receipt",
        }
        has_building = "land_building" in str(values.get("property.category", ""))
        fields = [field for field in fields if field.get("id") not in legacy_dynamic]
    elif report_key == "valuation-agricultural":
        fields = agricultural_schema_payload()["fields"]
        has_building = False
    else:
        raise ValueError("Unsupported valuation report type.")
    missing = []
    for field in fields:
        if not field.get("required") or field.get("calculated"):
            continue
        if field.get("conditional") == "property.has_building" and not has_building:
            continue
        # Template aliases are populated from their canonical form control.
        # They are not separate inputs (for example valuation_date_detail).
        value_id = field.get("source") or field["id"]
        if not str(values.get(value_id, "")).strip():
            missing.append(field.get("label") or field["id"])
    document_indexes = {1}
    for field_id in values:
        match = re.fullmatch(r"documents\.(\d+)\.(?:type|details)", str(field_id))
        if match:
            document_indexes.add(int(match.group(1)))
    for index in sorted(document_indexes):
        for suffix, label in (("type", "Document type"), ("details", "Document details")):
            if not str(values.get(f"documents.{index}.{suffix}", "")).strip():
                missing.append(f"{label} for Document {index}")
    if missing:
        raise ValueError(f"Complete the required field: {missing[0]}.")
    if report_key == "valuation-general" and has_building:
        from .construction import estimate_rows, floor_multiplier
        from .formatting import floor_indexes
        if values.get("property.status") in {"proposed", "under_construction"}:
            estimate_rows(values)
        for index in floor_indexes(values):
            floor_multiplier(values, index)
