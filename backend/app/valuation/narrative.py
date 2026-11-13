"""Render the supported valuation field formatting as native Word paragraphs."""

import json
import re
from copy import deepcopy

from lxml import etree

from .config import NS, qn

NUMBERING_PART = "word/numbering.xml"
FORMAT_SUFFIX = "_formatting"
LIST_KINDS = {"number", "bullet"}
BLOCK_KINDS = LIST_KINDS | {"paragraph"}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def formatted_fields(values):
    fields = {}
    for key, value in values.items():
        if key != "site.special_remarks" and not re.fullmatch(r"documents\.\d+\.details", key):
            continue
        raw = values.get(key + FORMAT_SUFFIX)
        if not isinstance(raw, str):
            continue
        try:
            blocks = json.loads(raw)
        except (ValueError, RecursionError):
            continue
        if not isinstance(blocks, list):
            continue
        lines = []
        number = 0
        for block in blocks:
            if not isinstance(block, dict):
                break
            kind = block.get("kind")
            if not isinstance(kind, str) or kind not in BLOCK_KINDS or not isinstance(block.get("runs"), list):
                break
            runs = block["runs"]
            if any(not isinstance(run, dict) or not isinstance(run.get("text"), str)
                   or not isinstance(run.get("bold"), bool) for run in runs):
                break
            text = "".join(run["text"] for run in runs)
            if kind != "number":
                number = 0
            elif text.strip():
                number += 1
            prefix = f"{number}. " if number else "• " if kind == "bullet" else ""
            lines.append(prefix + text if text.strip() else text)
        else:
            if "\n".join(lines) == value:
                fields[key] = blocks
    return fields


def _property(parent, name, **attributes):
    return etree.SubElement(parent, qn(name), {qn(key): str(value) for key, value in attributes.items()})


class WordNarrative:
    def __init__(self, numbering_xml):
        self.numbering = etree.fromstring(numbering_xml)
        self.abstract_ids = {}

    def _next_id(self, tag, attribute):
        ids = self.numbering.xpath(f"./w:{tag}/@w:{attribute}", namespaces=NS)
        return max(map(int, ids), default=0) + 1

    def _list_id(self, kind):
        if kind not in self.abstract_ids:
            abstract_id = self._next_id("abstractNum", "abstractNumId")
            abstract = etree.Element(qn("abstractNum"), {qn("abstractNumId"): str(abstract_id)})
            first_num = self.numbering.find(qn("num"))
            if first_num is None:
                self.numbering.append(abstract)
            else:
                first_num.addprevious(abstract)
            _property(abstract, "multiLevelType", val="singleLevel")
            level = _property(abstract, "lvl", ilvl=0)
            _property(level, "start", val=1)
            _property(level, "numFmt", val="decimal" if kind == "number" else "bullet")
            _property(level, "lvlText", val="%1." if kind == "number" else "•")
            _property(level, "lvlJc", val="left")
            _property(_property(level, "pPr"), "ind", left=300, hanging=240)
            self.abstract_ids[kind] = abstract_id
        num_id = self._next_id("num", "numId")
        _property(_property(self.numbering, "num", numId=num_id), "abstractNumId", val=self.abstract_ids[kind])
        return num_id

    def render(self, paragraph, blocks):
        ppr = paragraph.find(qn("pPr"))
        rpr = paragraph.find(".//" + qn("rPr"))
        list_kind = None
        for block in blocks or [{"kind": "paragraph", "runs": []}]:
            line = etree.Element(qn("p"))
            line_properties = deepcopy(ppr) if ppr is not None else etree.Element(qn("pPr"))
            line.append(line_properties)
            existing_num = line_properties.find(qn("numPr"))
            if existing_num is not None:
                line_properties.remove(existing_num)
            kind = block["kind"]
            if kind in LIST_KINDS:
                if list_kind != kind:
                    num_id = self._list_id(kind)
                if any(run["text"].strip() for run in block["runs"]):
                    num = etree.Element(qn("numPr"))
                    prior = {qn(name) for name in ("pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl")}
                    offset = next((i for i, child in enumerate(line_properties) if child.tag not in prior), len(line_properties))
                    line_properties.insert(offset, num)
                    _property(num, "ilvl", val=0)
                    _property(num, "numId", val=num_id)
            list_kind = kind
            for part in block["runs"]:
                run = _property(line, "r")
                properties = deepcopy(rpr) if rpr is not None else etree.Element(qn("rPr"))
                for bold in properties.findall(qn("b")):
                    properties.remove(bold)
                # Bold belongs after the font definition in the run properties.
                index = next((i for i, child in enumerate(properties) if child.tag not in {qn("rStyle"), qn("rFonts")}), len(properties))
                properties.insert(index, etree.Element(qn("b"), {qn("val"): "1" if part["bold"] else "0"}))
                run.append(properties)
                for index, text in enumerate(part["text"].split("\n")):
                    if index:
                        _property(run, "br")
                    node = _property(run, "t")
                    node.text = text
                    if text[:1].isspace() or text[-1:].isspace():
                        node.set(XML_SPACE, "preserve")
            paragraph.addprevious(line)
        paragraph.getparent().remove(paragraph)

    def to_xml(self):
        return etree.tostring(self.numbering, xml_declaration=True, encoding="UTF-8", standalone="yes")
