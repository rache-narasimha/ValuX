from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree


BASE = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1/Phase1_Reference_Data_Test.docx")
OUTPUT = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1/Valuation_Report_Master_Template.docx")
MANIFEST = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1/master_template_controls.json")

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
qn = lambda local: f"{{{W}}}{local}"


# The visible text intentionally remains realistic sample data. The tag is the
# machine-readable identifier used by the future form-to-DOCX generator.
CONTROL_VALUES = {
    "BANK_NAME_UPPER": "BANK OF MAHARASHTRA",
    "BANK_NAME": "Bank of Maharashtra",
    "BRANCH_NAME": "ADONI",
    "INSPECTION_DATE": "09-09-2026",
    "VALUATION_DATE": "24-09-2026",
    "DEED_TYPE": "Rectification Deed",
    "DEED_DETAILS": "No.4258/2015 dt. 19-05-2015",
    "PLAN_DETAILS": "PER No. 67-2016-G1 Dt.29-03-2016",
    "TAX_RECEIPT_DETAILS": "09/2026-27/23017 Dt. 01-09-2026",
    "OWNER_NAME": "B.Govindu S/o Late B.Jambanna,",
    "OWNER_COVER_LINE": "B.Govind S/o Late B.Jambanna, Adoni.",
    "PROPERTY_DESCRIPTION": "Residential Building in GF",
    "PROPERTY_ADDRESS": "H.No. 5/390/280/44, Plot No.44, Sy.No. 313 A/2, 313D, L.P.No.32/93, Near Ravindra School, Hanuman Nagar, Adoni, Kurnool Dist.",
    "COORDINATES": "15.635543,77.268148",
    "SITE_AREA": "202.6 sq.yd. / 4.18 Cents",
    "MARKET_RATE_RANGE": "Rs.5.0-7.0 lakhs per cent",
    "GOVERNMENT_GUIDELINE_RATE": "Rs. 3,14,600/-per Cent",
    "ADOPTED_LAND_RATE": "Rs.6,00,000/- per cent",
    "LAND_VALUE": "Rs.25,08,000/-",
    "PLINTH_AREA": "1,158.42",
    "REPLACEMENT_RATE": "2500/-",
    "REPLACEMENT_COST": "28,96,050/-",
    "DEPRECIATION": "3,35,050/-",
    "BUILDING_VALUE": "25,61,000/-",
    "PRESENT_MARKET_VALUE": "50,69,000/-",
    "REALIZABLE_VALUE": "45,62,000/-",
    "DISTRESS_VALUE": "40,55,000/-",
    "GOVERNMENT_VALUE": "30,44,000/-",
    "PRESENT_MARKET_VALUE_WORDS": "Rupees Fifty lakhs sixty nine thousands only",
}


def text_of(el: etree._Element) -> str:
    return "".join(el.xpath(".//w:t/text()", namespaces=NS))


def set_page_break_before(paragraph: etree._Element) -> None:
    p_pr = paragraph.find(qn("pPr"))
    if p_pr is None:
        p_pr = etree.Element(qn("pPr"))
        paragraph.insert(0, p_pr)
    if p_pr.find(qn("pageBreakBefore")) is None:
        etree.SubElement(p_pr, qn("pageBreakBefore"))


def make_run_like(source_run: etree._Element, value: str) -> etree._Element:
    run = etree.Element(qn("r"))
    r_pr = source_run.find(qn("rPr"))
    if r_pr is not None:
        run.append(deepcopy(r_pr))
    text = etree.SubElement(run, qn("t"))
    if value[:1].isspace() or value[-1:].isspace():
        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = value
    return run


def make_sdt(tag: str, runs: list[etree._Element], control_id: int) -> etree._Element:
    sdt = etree.Element(qn("sdt"))
    props = etree.SubElement(sdt, qn("sdtPr"))
    alias = etree.SubElement(props, qn("alias"))
    alias.set(qn("val"), tag)
    tag_el = etree.SubElement(props, qn("tag"))
    tag_el.set(qn("val"), tag)
    id_el = etree.SubElement(props, qn("id"))
    id_el.set(qn("val"), str(control_id))
    etree.SubElement(props, qn("text"))
    content = etree.SubElement(sdt, qn("sdtContent"))
    for run in runs:
        content.append(run)
    return sdt


def add_content_controls(root: etree._Element) -> dict[str, int]:
    # Longest values first prevents smaller strings from matching inside larger ones.
    value_to_tag = {value: tag for tag, value in CONTROL_VALUES.items()}
    ordered = sorted(value_to_tag, key=len, reverse=True)
    counts = {tag: 0 for tag in CONTROL_VALUES}
    control_id = 720000

    for paragraph in list(root.xpath(".//w:p", namespaces=NS)):
        children = list(paragraph)
        plain_runs = [c for c in children if etree.QName(c).localname == "r"]
        if not plain_runs:
            continue
        # Skip paragraphs whose direct runs contain fields, drawings, tabs, or
        # other non-text payloads. Those structures must remain byte-stable.
        if any(
            len(run.xpath("./w:t", namespaces=NS)) != 1
            or any(etree.QName(c).localname not in {"rPr", "t"} for c in run)
            for run in plain_runs
        ):
            continue

        source = "".join(text_of(run) for run in plain_runs)
        matches: list[tuple[int, int, str]] = []
        cursor = 0
        while cursor < len(source):
            found = None
            for value in ordered:
                idx = source.find(value, cursor)
                if idx >= 0 and (found is None or idx < found[0] or (idx == found[0] and len(value) > found[1] - found[0])):
                    found = (idx, idx + len(value), value_to_tag[value])
            if found is None:
                break
            matches.append(found)
            cursor = found[1]
        if not matches:
            continue

        char_tags: list[str | None] = [None] * len(source)
        for start, end, tag in matches:
            char_tags[start:end] = [tag] * (end - start)

        rebuilt: list[etree._Element] = []
        global_pos = 0
        active_tag: str | None = None
        active_runs: list[etree._Element] = []

        def flush_control() -> None:
            nonlocal active_tag, active_runs, control_id
            if active_tag is None:
                return
            control_id += 1
            rebuilt.append(make_sdt(active_tag, active_runs, control_id))
            counts[active_tag] += 1
            active_tag = None
            active_runs = []

        for child in children:
            if etree.QName(child).localname != "r":
                flush_control()
                rebuilt.append(child)
                continue
            run_value = text_of(child)
            if not run_value:
                flush_control()
                rebuilt.append(child)
                continue
            local = 0
            while local < len(run_value):
                tag = char_tags[global_pos + local]
                end = local + 1
                while end < len(run_value) and char_tags[global_pos + end] == tag:
                    end += 1
                piece = make_run_like(child, run_value[local:end])
                if tag is None:
                    flush_control()
                    rebuilt.append(piece)
                else:
                    if active_tag != tag:
                        flush_control()
                        active_tag = tag
                    active_runs.append(piece)
                local = end
            global_pos += len(run_value)
        flush_control()

        for child in list(paragraph):
            paragraph.remove(child)
        for child in rebuilt:
            paragraph.append(child)

    return {tag: count for tag, count in counts.items() if count}


def mutate_document(root: etree._Element) -> dict[str, int]:
    # The supplied screenshot shows the valuer signature block and bank
    # acknowledgement together on a fresh page. Starting the block on a new
    # page prevents the acknowledgement sentence from splitting across pages.
    for paragraph in root.xpath(".//w:body/w:p", namespaces=NS):
        value = text_of(paragraph)
        if "Place :Adoni" in value and "Signature of Valuer" in value:
            set_page_break_before(paragraph)
            break
    else:
        raise RuntimeError("Could not locate the valuer signature block")

    return add_content_controls(root)


def main() -> None:
    with ZipFile(BASE, "r") as zin, ZipFile(OUTPUT, "w", ZIP_DEFLATED) as zout:
        counts: dict[str, int] = {}
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                counts = mutate_document(root)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)

    manifest = {
        "template": str(OUTPUT),
        "base_sha256": hashlib.sha256(BASE.read_bytes()).hexdigest(),
        "control_count": sum(counts.values()),
        "controls": counts,
        "display_values": CONTROL_VALUES,
        "layout_change": "Valuer signature and branch-manager acknowledgement start together on a new page.",
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
