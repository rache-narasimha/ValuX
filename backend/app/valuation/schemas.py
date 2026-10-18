"""Public form-schema assembly for each report type."""

import json

from .config import AGRICULTURAL_SCHEMA, AGRICULTURAL_TEMPLATE, SCHEMA, TEMPLATE

def schema_payload():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    schema["template"] = TEMPLATE.name
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
    schema["defaults"] = {}
    return schema
