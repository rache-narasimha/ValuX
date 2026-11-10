"""Shared estimation identity and component labels, independent of workbook cells."""

import re

FLOORS = {"cellar": "Cellar", "stilt": "Stilt Floor", "ground": "Ground Floor", "first": "First Floor", "second": "Second Floor", "third": "Third Floor", "fourth": "Fourth Floor", "fifth": "Fifth Floor", "sixth": "Sixth Floor", "seventh": "Seventh Floor", "eighth": "Eighth Floor", "ninth": "Ninth Floor", "tenth": "Tenth Floor"}
ABBREVIATIONS = {"cellar": "Cellar", "stilt": "Stilt", "ground": "GF", "first": "FF", "second": "SF", "third": "TF", "fourth": "4F", "fifth": "5F", "sixth": "6F", "seventh": "7F", "eighth": "8F", "ninth": "9F", "tenth": "10F"}
LEVELS = {key: index - 1 for index, key in enumerate(FLOORS)}


def industrial_centre_line(state):
    return (
        state.get("propertyType") == "industrial"
        and (state.get("details") or {}).get("measurementMethod") == "centre_line"
    )


def modern_identity(details):
    return details.get("identityVersion") == 2 or "workAddress" in details


def compact_abstract(state):
    components = state.get("components") or []
    if state.get("propertyType") != "residential" or len(components) != 1:
        return False
    sheets = components[0].get("sheets") or []
    return bool(sheets) and all(
        max([float(sheet.get("level") or 0), *[LEVELS.get(key, 99) for key in sheet.get("typicalFloorKeys") or []]]) <= 3
        for sheet in sheets
    )


def component_name(component):
    name = re.sub(r"\s+", " ", str(component.get("name") or "Building")).strip()
    name = re.sub(r"^Residential Building\s*/?\s*Block\s*(\d+)$", r"Building \1", name, flags=re.I)
    name = re.sub(r"^RCC (?:Commercial )?Building\s*(\d+)$", r"Building \1", name, flags=re.I)
    return re.sub(r"Office\s*/\s*Amenity Building", "Office Building", name, flags=re.I)


def component_labels(state):
    """Keep source IDs stable; only worksheet tabs are shortened by the generator."""
    components = state.get("components") or []
    buildings = sum(bool(component.get("sheets")) for component in components)
    modern = modern_identity(state.get("details") or {})
    records = []
    for index, component in enumerate(components):
        sheets = sorted(component.get("sheets") or [], key=lambda sheet: float(sheet.get("level") or 0))
        for position, sheet in enumerate(sheets or [None]):
            legacy = f"{component.get('name')} - {sheet.get('label')}" if sheet else str(component.get("name") or "Estimate")
            label = component_name(component)
            if sheet:
                floor = str(sheet.get("label") or FLOORS.get(sheet.get("key"), "Floor"))
                typical = len(sheet.get("typicalFloorKeys") or []) > 1
                label = f"{label} {floor if typical else ABBREVIATIONS.get(sheet.get('key'), floor)}" if buildings > 1 else floor
            source_id = f"measure-{component.get('id') or index + 1}" + (f"-{sheet.get('id') or sheet.get('key') or position + 1}" if sheet else "")
            records.append({"id": source_id, "label": label if modern else legacy, "legacyLabel": legacy, "component": component, "sheet": sheet, "first": position == 0})
    return records



def typical_floor_names(sheet):
    keys = (sheet or {}).get("typicalFloorKeys") or []
    names = []
    for key in keys:
        upper = re.fullmatch(r"upper_(\d+)", key)
        names.append(ABBREVIATIONS.get(key, f"{int(upper[1]) + 1}F" if upper else key))
    return f"{', '.join(names[:-1])} & {names[-1]}" if len(names) > 1 else ""


def abstract_description(state, component, sheet, label):
    floors = typical_floor_names(sheet)
    if not floors:
        return f"Cost of construction of {label}"
    prefix = f"{component_name(component)}: " if sum(bool(item.get("sheets")) for item in state["components"]) > 1 else ""
    return f"Cost of construction for {prefix}{floors}"


def work_text(details, description=None):
    work = str(description if description is not None else details.get("workDescription") or "[Name of the Work]").strip()
    if modern_identity(details):
        address = str(details.get("workAddress") or "").strip()
        if not address:
            raise ValueError("Enter Address of the Work before preparing the report.")
        return f"{work.rstrip(' .')} at {address}"
    return f"{work} at {details.get('projectLocation') or '[Project / Location]'}"


def applicant_text(details):
    if modern_identity(details):
        return str(details.get("applicantName") or "[Name of the Applicant]").strip()
    return ", ".join(filter(None, (details.get("applicantName"), details.get("projectLocation")))) or "[Applicant name and property location]"


def component_work(component):
    name = re.sub(r"\s+", " ", str(component.get("name") or "building")).strip()
    name = re.sub(r"Residential Building\s*/\s*Block", "Residential Building", name, flags=re.I)
    name = re.sub(r"Office\s*/\s*Amenity Building", "Office Building", name, flags=re.I)
    floors = []
    for sheet in sorted(component.get("sheets") or [], key=lambda sheet: float(sheet.get("level") or 0)):
        floors.extend(FLOORS.get(key, key) for key in sheet.get("typicalFloorKeys") or [sheet.get("key") or sheet.get("label") or "Floor"])
    floors = list(dict.fromkeys(floors))
    article = "an" if name.upper().startswith("RCC") or name[0:1].lower() in "aeiou" and not name.lower().startswith(("utility", "university", "user")) else "a"
    scope = f" comprising {', '.join(floors[:-1]) + ' and ' + floors[-1] if len(floors) > 1 else floors[0]}" if floors else ""
    return f"Proposed construction of {article} {name}{scope}"
