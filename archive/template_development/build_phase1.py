from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree


REFERENCE = Path("/Users/narasimharache/Desktop/SLN_poc/Valuation_report_res:com:indus.docx")
OUT_DIR = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1")
RAW_TEMPLATE = OUT_DIR / "Valuation_Report_Master_Template_raw.docx"
TEMPLATE = OUT_DIR / "Valuation_Report_Master_Template.docx"
RAW_SAMPLE = OUT_DIR / "Phase1_Reference_Data_Test_raw.docx"
SAMPLE = OUT_DIR / "Phase1_Reference_Data_Test.docx"
MAPPING = OUT_DIR / "phase1_field_mapping.json"
EXPECTED_SHA = "928bb139fac37bd9706dcec00436ced963e21102f258768175db4387a3ae2af0"
PYTHON = Path("/Users/narasimharache/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3")
SKILL = Path("/Users/narasimharache/.codex/plugins/cache/openai-primary-runtime/documents/26.1004.11800/skills/documents")

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
qn = lambda local: f"{{{W}}}{local}"


FIELD_VALUES = {
    "[[BANK_U]]": "BANK OF MAHARASHTRA",
    "[[BANK]]": "Bank of Maharashtra",
    "[[BRANCH]]": "ADONI",
    "[[D_INSP]]": "09-09-2026",
    "[[D_VAL]]": "24-09-2026",
    "[[DEED]]": "Rectification Deed",
    "[[DEED_NO]]": "No.4258/2015 dt. 19-05-2015",
    "[[PLAN]]": "PER No. 67-2016-G1 Dt.29-03-2016",
    "[[TAX]]": "09/2026-27/23017 Dt. 01-09-2026",
    "[[OWNER]]": "B.Govindu S/o Late B.Jambanna,",
    "[[OWNER_C]]": "B.Govind S/o Late B.Jambanna, Adoni.",
    "[[PROP]]": "Residential Building in GF",
    "[[ADDRESS]]": "H.No. 5/390/280/44, Plot No.44, Sy.No. 313 A/2, 313D, L.P.No.32/93, Near Ravindra School, Hanuman Nagar, Adoni, Kurnool Dist.",
    "[[COORD]]": "15.635543,77.268148",
    "[[AREA]]": "202.6 sq.yd. / 4.18 Cents",
    "[[MKT_RATE]]": "Rs.5.0-7.0 lakhs per cent",
    "[[GUIDE]]": "Rs. 3,14,600/-per Cent",
    "[[RATE]]": "Rs.6,00,000/- per cent",
    "[[LAND_VAL]]": "Rs.25,08,000/-",
    "[[PLINTH]]": "1,158.42",
    "[[REPL_RATE]]": "2500/-",
    "[[REPL_COST]]": "28,96,050/-",
    "[[DEPR]]": "3,35,050/-",
    "[[BLDG_VAL]]": "25,61,000/-",
    "[[PMV]]": "50,69,000/-",
    "[[REAL_VAL]]": "45,62,000/-",
    "[[DIST_VAL]]": "40,55,000/-",
    "[[GOVT_VAL]]": "30,44,000/-",
    "[[PMV_WORDS]]": "Rupees Fifty lakhs sixty nine thousands only",
}

SOURCE_TO_FIELD = {
    "BANK OF MAHARASHTRA": "[[BANK_U]]",
    "Bank of Maharashtra": "[[BANK]]",
    "ADONI BRANCH.": "[[BRANCH]] BRANCH.",
    "ADONI Branch.": "[[BRANCH]] Branch.",
    "09-09-2026": "[[D_INSP]]",
    "24-09-2026": "[[D_VAL]]",
    "Rectification Deed": "[[DEED]]",
    "No.4258/2015 dt. 19-05-2015": "[[DEED_NO]]",
    "PER No. 67-2016-G1 Dt.29-03-2016": "[[PLAN]]",
    "09/2026-27/23017 Dt. 01-09-2026": "[[TAX]]",
    "B.Govindu S/o Late B.Jambanna,": "[[OWNER]]",
    "B.Govind S/o Late B.Jambanna, Adoni.": "[[OWNER_C]]",
    "Residential Building in GF": "[[PROP]]",
    "H.No. 5/390/280/44, Plot No.44, Sy.No. 313 A/2, 313D, L.P.No.32/93, Near Ravindra School, Hanuman Nagar, Adoni, Kurnool Dist.": "[[ADDRESS]]",
    "15.635543,77.268148": "[[COORD]]",
    "202.6 sq.yd. / 4.18 Cents": "[[AREA]]",
    "Rs.5.0-7.0 lakhs per cent": "[[MKT_RATE]]",
    "Rs. 3,14,600/-per Cent": "[[GUIDE]]",
    "Rs.6,00,000/- per cent": "[[RATE]]",
    "Rs.25,08,000/-": "[[LAND_VAL]]",
    "1,158.42": "[[PLINTH]]",
    "2500/-": "[[REPL_RATE]]",
    "28,96,050/-": "[[REPL_COST]]",
    "3,35,050/-": "[[DEPR]]",
    "25,61,000/-": "[[BLDG_VAL]]",
    "50,69,000/-": "[[PMV]]",
    "45,62,000/-": "[[REAL_VAL]]",
    "40,55,000/-": "[[DIST_VAL]]",
    "30,44,000/-": "[[GOVT_VAL]]",
    "Rupees Fifty lakhs sixty nine thousands only": "[[PMV_WORDS]]",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def text_of(el) -> str:
    return "".join(el.xpath(".//w:t/text()", namespaces=NS))


def set_page_break_before(paragraph: etree._Element) -> None:
    if etree.QName(paragraph).localname != "p":
        raise ValueError("Page-break target must be a paragraph")
    p_pr = paragraph.find(qn("pPr"))
    if p_pr is None:
        p_pr = etree.Element(qn("pPr"))
        paragraph.insert(0, p_pr)
    if p_pr.find(qn("pageBreakBefore")) is None:
        etree.SubElement(p_pr, qn("pageBreakBefore"))


def remove_all_highlights(root: etree._Element) -> None:
    for el in root.xpath(".//w:highlight", namespaces=NS):
        el.getparent().remove(el)
    for el in root.xpath(".//w:shd", namespaces=NS):
        # Preserve cyan title bands; remove only yellow cell/paragraph shading.
        if (el.get(qn("fill")) or "").upper() in {"FFFF00", "FFF200", "YELLOW"}:
            el.getparent().remove(el)


def shade_present_market_value_row(root: etree._Element) -> None:
    for tr in root.xpath(".//w:tr", namespaces=NS):
        if "Present Market Value" not in text_of(tr):
            continue
        for tc in tr.xpath("./w:tc", namespaces=NS):
            tc_pr = tc.find(qn("tcPr"))
            if tc_pr is None:
                tc_pr = etree.Element(qn("tcPr"))
                tc.insert(0, tc_pr)
            shd = tc_pr.find(qn("shd"))
            if shd is None:
                shd = etree.SubElement(tc_pr, qn("shd"))
            shd.set(qn("val"), "clear")
            shd.set(qn("color"), "auto")
            shd.set(qn("fill"), "FFFF00")


def set_run_blue(run: etree._Element) -> None:
    r_pr = run.find(qn("rPr"))
    if r_pr is None:
        r_pr = etree.Element(qn("rPr"))
        run.insert(0, r_pr)
    color = r_pr.find(qn("color"))
    if color is None:
        color = etree.SubElement(r_pr, qn("color"))
    color.set(qn("val"), "0070C0")
    color.attrib.pop(qn("themeColor"), None)


def enforce_cover_letter_blue(root: etree._Element) -> None:
    body = root.find(qn("body"))
    in_cover = False
    for child in body:
        txt = text_of(child)
        if "BANK OF MAHARASHTRA" in txt:
            in_cover = True
        if not in_cover:
            continue
        if any(value in txt for value in ("50,69,000/-", "Rupees Fifty lakhs sixty nine thousands only")):
            for run in child.xpath(".//w:r", namespaces=NS):
                run_text = text_of(run)
                if "50,69,000/-" in run_text or "Rupees Fifty lakhs sixty nine thousands only" in run_text:
                    set_run_blue(run)


def replace_text_nodes(root: etree._Element, replacements: dict[str, str]) -> None:
    # Longest first prevents shorter amounts from being substituted inside larger tokens.
    ordered = sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True)
    for node in root.xpath(".//w:t", namespaces=NS):
        value = node.text or ""
        for source, target in ordered:
            value = value.replace(source, target)
        node.text = value


def reorder_body(root: etree._Element) -> None:
    body = root.find(qn("body"))
    children = list(body)
    sect_pr = children[-1]
    assert etree.QName(sect_pr).localname == "sectPr"

    # Identified from the structural inventory: cover letter 75..120,
    # detailed report 0..74, photos/map 121..166.
    cover = children[75:121]
    detail = children[0:75]
    media = children[121:-1]

    # The source positioned the cover letter halfway down page 7 and carried
    # several empty spacer paragraphs after "Encl.". Once the cover becomes
    # page 1, those spacers would create an empty page before the detailed
    # report, so remove only trailing empty cover paragraphs.
    while cover:
        candidate = cover[-1]
        if etree.QName(candidate).localname != "p":
            break
        if text_of(candidate).strip() or candidate.xpath(".//w:drawing|.//w:br", namespaces=NS):
            break
        cover.pop()

    # Cached Word pagination markers no longer correspond to the reordered
    # flow and can confuse non-Word renderers. Explicit paragraph-level page
    # starts replace them.
    for marker in root.xpath(".//w:lastRenderedPageBreak", namespaces=NS):
        marker.getparent().remove(marker)
    set_page_break_before(detail[0])
    set_page_break_before(media[0])

    for child in children:
        body.remove(child)
    for child in cover:
        body.append(child)
    for child in detail:
        body.append(child)
    for child in media:
        body.append(child)
    body.append(sect_pr)

    # Remove empty trailing paragraphs before sectPr; this eliminates the source's blank page.
    while len(body) >= 2:
        candidate = body[-2]
        if etree.QName(candidate).localname != "p":
            break
        if text_of(candidate).strip() or candidate.xpath(".//w:drawing|.//w:br", namespaces=NS):
            break
        body.remove(candidate)


def write_docx(source: Path, target: Path, mutate) -> None:
    with ZipFile(source, "r") as zin, ZipFile(target, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                mutate(root)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)


def build_template(root: etree._Element) -> None:
    reorder_body(root)
    remove_all_highlights(root)
    shade_present_market_value_row(root)
    enforce_cover_letter_blue(root)
    replace_text_nodes(root, SOURCE_TO_FIELD)


def fill_sample(root: etree._Element) -> None:
    replace_text_nodes(root, FIELD_VALUES)


def strip_comments(source: Path, target: Path) -> None:
    subprocess.run(
        [
            str(PYTHON),
            str(SKILL / "scripts/comments_strip.py"),
            str(source),
            "--out",
            str(target),
        ],
        check=True,
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    actual_sha = sha256(REFERENCE)
    if actual_sha != EXPECTED_SHA:
        raise SystemExit(f"Reference SHA mismatch: {actual_sha}")

    write_docx(REFERENCE, RAW_TEMPLATE, build_template)
    strip_comments(RAW_TEMPLATE, TEMPLATE)
    write_docx(TEMPLATE, RAW_SAMPLE, fill_sample)
    strip_comments(RAW_SAMPLE, SAMPLE)
    RAW_TEMPLATE.unlink(missing_ok=True)
    RAW_SAMPLE.unlink(missing_ok=True)

    MAPPING.write_text(
        json.dumps(
            {
                "reference_sha256": EXPECTED_SHA,
                "fields": FIELD_VALUES,
                "rules": {
                    "realizable_value_percent": 90,
                    "distress_value_percent": 80,
                    "highlight_only": "Present Market Value row",
                    "cover_letter_fair_market_value_color": "#0070C0",
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    if "[[" in ZipFile(SAMPLE).read("word/document.xml").decode("utf-8", "ignore"):
        raise SystemExit("Unresolved placeholder remains in sample output")
    print(TEMPLATE)
    print(SAMPLE)
    print(MAPPING)


if __name__ == "__main__":
    main()
