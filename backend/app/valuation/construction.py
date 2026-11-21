"""General valuation construction assessments and cover-letter cost notes."""

import json
import math
import re

from .formatting import AREA_TO_SQFT as AREA_FACTORS, currency, floor_indexes, number_value

ESTIMATES = "construction.estimates"
VERSION = "construction.summary_version"


def floor_multiplier(values, index):
    prefix = f"building.floors.{index}."
    count = number_value(values.get(prefix + "count"))
    if count is None:
        count = 1
    if not math.isfinite(count) or count < 1 or count != int(count):
        raise ValueError("Enter a positive whole number of represented floors.")
    return int(count) if values.get(prefix + "basis") == "per_floor" else 1


def estimate_rows(values):
    raw_rows = values.get(ESTIMATES)
    try:
        rows = json.loads(raw_rows) if isinstance(raw_rows, str) and raw_rows.strip() else raw_rows
    except (ValueError, TypeError):
        raise ValueError("Review the estimated construction cost rows.") from None
    rows = [] if rows is None or rows == "" else rows
    if not isinstance(rows, list):
        raise ValueError("Review the estimated construction cost rows.")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Review the estimated construction cost rows.")
        label = str(row.get("label") or "").strip()
        raw = row.get("amount")
        amount = number_value(raw)
        if raw not in (None, "") and (amount is None or not math.isfinite(amount) or amount < 0):
            raise ValueError("Enter a valid non-negative estimated construction cost.")
        if label or raw not in (None, ""):
            result.append({"id": str(row.get("id") or ""), "label": label or "Building", "amount": amount})
    return result


def cover_description(values):
    description = str(values.get("property.description") or "").strip()
    description = re.sub(r"\s*\((?:u/c|proposed)\)\s*$", "", description, flags=re.I)
    suffix = {"under_construction": " (u/c)", "proposed": " (Proposed)"}.get(values.get("property.status"), "")
    return description + suffix


def cover_notes(values, calculated):
    status = values.get("property.status")
    if status not in {"proposed", "under_construction"} or str(values.get("property.category") or "").endswith("_plot"):
        return []
    extent = number_value(values.get("land.extent_value"))
    factor = AREA_FACTORS.get(values.get("land.extent_unit"))
    area = ""
    if extent is not None and factor:
        square_feet = extent * factor
        area = f" ({square_feet / AREA_FACTORS['sq_yd']:.2f} Sq.yd. / {square_feet / AREA_FACTORS['cent']:.2f} Cents)"
    notes = [(f"Cost of Site{area}", number_value(calculated.get("abstract.land")))]
    rows = estimate_rows(values)
    if not rows:
        rows = [{"label": str(values.get(f"building.floors.{index}.name") or ("GF" if index == 1 else f"Floor {index}")), "amount": None}
                for index in floor_indexes(values)]
    notes.extend((f"Cost of construction of {row['label']} as per Estimate", row["amount"]) for row in rows)
    total = sum(row["amount"] for row in rows) if rows and all(row["amount"] is not None for row in rows) else None
    notes.append(("Total Cost of construction", total))
    if status == "proposed":
        notes.append(("Construction work not commenced yet.", None))
    else:
        building = number_value(calculated.get("abstract.building"))
        notes.append(("Cost of Construction as on date", building))
        notes.append(("Cost of construction of balance work", total - building if total is not None and building is not None else None))
    return notes


def note_amount(amount):
    return "—" if amount is None else "Rs." + currency(amount)
