"""Numeric, date, currency, area, and repeatable-field helpers."""

import re

ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
AREA_TO_SQFT = {
    "sq_ft": 1.0,
    "sq_yd": 9.0,
    "cent": 435.6,
    "acre": 43560.0,
    "sq_m": 10.7639104167,
}
AREA_LABELS = {
    "sq_ft": "Sq.ft",
    "sq_yd": "Sq.yd",
    "cent": "Cent",
    "acre": "Acre",
    "sq_m": "Sq.m",
}

def number_value(value):
    """Accept Indian-formatted currency text and return its numeric value."""
    if value is None:
        return None
    source = str(value).strip()
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", source)
    cleaned = match.group(0).replace(",", "") if match else ""
    try:
        return float(cleaned) if cleaned not in {"", "-", "."} else None
    except ValueError:
        return None

def indian_number(value):
    rounded = int(round(float(value)))
    sign = "-" if rounded < 0 else ""
    digits = str(abs(rounded))
    if len(digits) <= 3:
        return sign + digits
    tail, head = digits[-3:], digits[:-3]
    groups = []
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return sign + ",".join(groups + [tail])

def currency(value, prefix=False):
    amount = number_value(value)
    if amount is None:
        return str(value or "-")
    return f"{'Rs.' if prefix else ''}{indian_number(amount)}/-"


ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

def under_thousand(n):
    parts = []
    if n >= 100:
        parts.extend([ONES[n // 100], "hundred"])
        n %= 100
    if n >= 20:
        parts.append(TENS[n // 10])
        n %= 10
    if n:
        parts.append(ONES[n])
    return " ".join(parts)

def amount_in_words(value):
    amount = number_value(value)
    if amount is None:
        return ""
    n = int(round(amount))
    if n == 0:
        return "Zero"
    parts = []
    for divisor, label in ((10_000_000, "crore"), (100_000, "lakh"), (1_000, "thousand")):
        if n >= divisor:
            parts.extend([under_thousand(n // divisor), label])
            n %= divisor
    if n:
        parts.append(under_thousand(n))
    return " ".join(parts).title()

def display_date(value):
    text = str(value or "")
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    return f"{match.group(3)}-{match.group(2)}-{match.group(1)}" if match else text

def converted_area(value, source_unit, target_unit):
    amount = number_value(value)
    if amount is None or source_unit not in AREA_TO_SQFT or target_unit not in AREA_TO_SQFT:
        return None
    return amount * AREA_TO_SQFT[source_unit] / AREA_TO_SQFT[target_unit]

def floor_indexes(values):
    indexes = set()
    for key in values:
        match = re.match(r"building\.floors\.(\d+)\.", key)
        if match:
            indexes.add(int(match.group(1)))
    return sorted(indexes) or [1]

def document_indexes(values):
    indexes = set()
    for key in values:
        match = re.match(r"documents\.(\d+)\.(?:type|custom_type|details)$", key)
        if match:
            indexes.add(int(match.group(1)))
    return sorted(indexes) or [1]

def normalized_document_values(values):
    result = dict(values)
    for index in document_indexes(values):
        prefix = f"documents.{index}."
        selected = str(values.get(prefix + "type", "")).strip()
        result[prefix + "type"] = str(values.get(prefix + "custom_type", "")).strip() if selected == "Custom" else selected
    sale_agreement_available = str(values.get("sale_agreement.used", "")).strip().lower() in {"yes", "true", "1", "on"}
    existing_types = {
        str(result.get(f"documents.{index}.type", "")).strip().lower()
        for index in document_indexes(result)
    }
    if sale_agreement_available and "sale agreement" not in existing_types:
        index = max(document_indexes(result)) + 1
        details = str(values.get("sale_agreement.details", "")).strip()
        agreement_value = str(values.get("sale_agreement.value", "")).strip()
        if agreement_value:
            value_text = f"Agreement value: {agreement_value}"
            details = f"{details}; {value_text}" if details else value_text
        result[f"documents.{index}.type"] = "Sale Agreement"
        result[f"documents.{index}.details"] = details
    return result
