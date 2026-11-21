"""Editable-result and final-rounding regression checks, shared with the browser arithmetic."""

import json
from pathlib import Path

from backend.app.valuation.calculations import (
    agricultural_replacements, calculated_replacements, rounded_valuation_value,
)


def cases():
    general = {
        "land.extent_value": "1", "land.extent_unit": "acre", "land.rate_unit": "acre",
        "land.adopted_rate_value": "4542058",
        "building.floors.1.structure_type": "rcc",
    }
    agricultural = {
        "valuation.total_extent_value": "1", "valuation.extent_unit": "acre",
        "valuation.adopted_rate_value": "4542058", "valuation.adopted_rate_unit": "acre",
    }
    return [
        {"kind": "general", "values": general, "overrides": {},
         "expected": {"abstract.total": 4542058, "valuation.present_market_value": 4542000,
                      "valuation.realizable_value": 4088000, "valuation.distress_value": 3634000,
                      "abstract.extra": 0, "abstract.services": 0}},
        {"kind": "general", "values": general,
         "overrides": {"valuation.present_market_value": "1234567", "valuation.distress_value": "0"},
         "expected": {"valuation.present_market_value": 1234567, "valuation.realizable_value": 1111000,
                      "valuation.distress_value": 0}},
        {"kind": "general", "values": general,
         "overrides": {"abstract.total": "1000500", "valuation.realizable_value": "987654"},
         "expected": {"abstract.total": 1000500, "valuation.present_market_value": 1000500,
                      "valuation.realizable_value": 987654, "valuation.distress_value": 800000}},
        {"kind": "general", "values": {**general, "land.adopted_rate_value": "1000",
             "building.floors.1.plinth_area": "1000", "building.floors.1.replacement_rate": "1000",
             "building.floors.1.age": "10", "extra.item_1": "300", "extra.item_2": "Included"},
         "overrides": {"land.converted_extent": "2", "land.estimated_value": "12345",
             "building.floors.1.total_life": "50", "building.floors.1.replacement_cost": "800000",
             "building.floors.1.depreciation": "120000", "building.floors.1.net_value": "700000",
             "abstract.building": "750000", "abstract.extra": "1000", "abstract.services": "0"},
         "expected": {"land.estimated_value": 12345, "building.floors.1.total_life": 50,
             "building.floors.1.replacement_cost": 800000, "building.floors.1.depreciation": 120000,
             "building.floors.1.net_value": 700000, "abstract.building": 750000,
             "abstract.extra": 1000, "abstract.services": 0, "abstract.total": 763345,
             "valuation.present_market_value": 763000}},
        {"kind": "agricultural", "values": agricultural, "overrides": {},
         "expected": {"valuation.estimated_value_display": 4542000, "valuation.book_value_display": 4542000,
                      "valuation.distress_value_display": 3634000}},
        {"kind": "agricultural", "values": agricultural,
         "overrides": {"valuation.converted_extent_display": "2", "valuation.estimated_value_display": "1234567",
                       "valuation.book_value_display": "1200000", "valuation.distress_value_display": "0"},
         "expected": {"valuation.estimated_value_display": 1234567, "valuation.book_value_display": 1200000,
                      "valuation.distress_value_display": 0}},
        {"kind": "agricultural", "values": {**agricultural, "valuation.adopted_rate_value": "4542500"}, "overrides": {},
         "expected": {"valuation.estimated_value_display": 4542500, "valuation.distress_value_display": 3634000}},
    ]


def main():
    from backend.app.valuation.formatting import number_value
    for amount, expected in ((0, 0), (499, 0), (500, 500), (501, 1000),
                             (4542058, 4542000), (4542758, 4543000), (4542500, 4542500)):
        assert rounded_valuation_value(amount) == expected
    aliases = {"valuation.estimated_value_display": "ESTIMATED_VALUE",
               "valuation.book_value_display": "BOOK_VALUE", "valuation.distress_value_display": "DISTRESS_VALUE"}
    for case in cases():
        values = {**case["values"], "calculation.overrides": json.dumps(case["overrides"])}
        results = calculated_replacements(values)[0] if case["kind"] == "general" else agricultural_replacements(values)
        for key, expected in case["expected"].items():
            assert number_value(results[aliases.get(key, key)]) == expected, (key, results, expected)
        if case["kind"] == "general":
            for key in ("abstract.extra", "abstract.amenities", "abstract.miscellaneous", "abstract.services", "abstract.machinery"):
                if not number_value(results[key]):
                    assert results[key] == "0/-", (key, results[key])
        elif "valuation.estimated_value_display" in case["overrides"]:
            assert results["ESTIMATED_VALUE_WORDS"] == "Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven"
    stale_building = {**cases()[3]["values"], "property.category": "residential_plot",
                      "calculation.overrides": json.dumps({"abstract.building": "750000"})}
    plot = calculated_replacements(stale_building)[0]
    assert plot["abstract.building"] == "N/A"
    assert number_value(plot["abstract.total"]) == 1300, plot["abstract.total"]
    # Exercise the same scenario data in the JavaScript display engine.
    path = Path(__file__).with_name("fixtures") / "editable_valuation_cases.json"
    if "--write-fixtures" in __import__("sys").argv:
        path.write_text(json.dumps(cases(), indent=2) + "\n")
    print("Valuation rounding and manual calculation checks passed")


if __name__ == "__main__":
    main()
