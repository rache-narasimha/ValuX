"""Low-level WordprocessingML row and token operations."""

import re
from copy import deepcopy
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree

from .config import NS, qn
from .formatting import document_indexes, floor_indexes

def replace_sdt_text(sdt, value):
    content = sdt.find(qn("sdtContent"))
    if content is None:
        return
    texts = content.xpath(".//w:t", namespaces=NS)
    if texts:
        texts[0].text = value
        if value[:1].isspace() or value[-1:].isspace():
            texts[0].set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        for node in texts[1:]:
            node.text = ""
        return
    paragraphs = content.xpath(".//w:p", namespaces=NS)
    paragraph = paragraphs[0] if paragraphs else etree.SubElement(content, qn("p"))
    run = etree.SubElement(paragraph, qn("r"))
    etree.SubElement(run, qn("t")).text = value

def set_paragraph_text(paragraph, value, color=None, preserve_style=False):
    existing_properties = paragraph.xpath(".//w:rPr", namespaces=NS)
    retained_properties = deepcopy(existing_properties[0]) if preserve_style and existing_properties else None
    ppr = paragraph.find(qn("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = etree.SubElement(paragraph, qn("r"))
    if retained_properties is not None:
        run.append(retained_properties)
    if color:
        rpr = run.find(qn("rPr"))
        if rpr is None:
            rpr = etree.SubElement(run, qn("rPr"))
        existing_color = rpr.find(qn("color"))
        if existing_color is not None:
            rpr.remove(existing_color)
        etree.SubElement(rpr, qn("color")).set(qn("val"), color)
    lines = str(value).split("\n")
    for index, line in enumerate(lines):
        if index:
            etree.SubElement(run, qn("br"))
        text = etree.SubElement(run, qn("t"))
        text.text = line
        if line[:1].isspace() or line[-1:].isspace():
            text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def set_text_node_with_breaks(text_node, value):
    """Replace one Word text node while translating newlines to real line breaks."""
    run = text_node.getparent()
    position = run.index(text_node)
    run.remove(text_node)

    for index, line in enumerate(str(value).split("\n")):
        if index:
            run.insert(position, etree.Element(qn("br")))
            position += 1
        replacement = etree.Element(qn("t"))
        replacement.text = line
        if line[:1].isspace() or line[-1:].isspace():
            replacement.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        run.insert(position, replacement)
        position += 1


def prepare_general_document_rows(root, values):
    old_tags = {
        "documents.deed_type", "documents.deed_details", "documents.approved_plan",
        "documents.legal_scrutiny", "documents.tax_receipt",
    }
    rows = root.xpath(".//w:tr[.//w:tag]", namespaces=NS)
    document_rows = []
    base_row = None
    for row in rows:
        tags = set(row.xpath(".//w:tag/@w:val", namespaces=NS))
        if tags & old_tags:
            document_rows.append(row)
        if "documents.deed_type" in tags:
            base_row = row
    if base_row is None:
        return
    parent = base_row.getparent()
    position = min(parent.index(row) for row in document_rows)
    template = deepcopy(base_row)
    for row in document_rows:
        parent.remove(row)
    for offset, index in enumerate(document_indexes(values)):
        clone = deepcopy(template)
        for tag in clone.xpath(".//w:tag", namespaces=NS):
            current = tag.get(qn("val"))
            if current == "documents.deed_type":
                tag.set(qn("val"), f"documents.{index}.type")
            elif current == "documents.deed_details":
                tag.set(qn("val"), f"documents.{index}.details")
        parent.insert(position + offset, clone)

def _set_cell_text(cell, value):
    texts = cell.xpath(".//w:t", namespaces=NS)
    if texts:
        texts[0].text = value
        for node in texts[1:]:
            node.text = ""

def prepare_general_party_rows(root):
    rows = root.xpath(".//w:tr[.//w:tag[@w:val='owner.details']]", namespaces=NS)
    if not rows:
        return
    owner_row = rows[0]
    owner_cells = owner_row.xpath("./w:tc", namespaces=NS)
    if len(owner_cells) >= 2:
        _set_cell_text(owner_cells[0], "4(a).")
        _set_cell_text(owner_cells[1], "Name and address of the owner(s) with phone number")
    purchaser_row = deepcopy(owner_row)
    for tag in purchaser_row.xpath(".//w:tag[@w:val='owner.details']", namespaces=NS):
        tag.set(qn("val"), "purchaser.details")
    purchaser_cells = purchaser_row.xpath("./w:tc", namespaces=NS)
    if len(purchaser_cells) >= 2:
        _set_cell_text(purchaser_cells[0], "4(b).")
        _set_cell_text(purchaser_cells[1], "Name and address of the purchaser with phone number")
    owner_row.addnext(purchaser_row)

def prepare_agricultural_party_rows(root):
    rows = root.xpath(".//w:tr[contains(string(.), '{{OWNER_DETAILS}}')]", namespaces=NS)
    if not rows:
        return
    owner_row = rows[0]
    owner_cells = owner_row.xpath("./w:tc", namespaces=NS)
    if len(owner_cells) >= 2:
        _set_cell_text(owner_cells[0], "4(a).")
        _set_cell_text(owner_cells[1], "Name and address of the owner(s) with phone number")
    purchaser_row = deepcopy(owner_row)
    for node in purchaser_row.xpath(".//w:t", namespaces=NS):
        node.text = (node.text or "").replace("{{OWNER_DETAILS}}", "{{PURCHASER_DETAILS}}")
    purchaser_cells = purchaser_row.xpath("./w:tc", namespaces=NS)
    if len(purchaser_cells) >= 2:
        _set_cell_text(purchaser_cells[0], "4(b).")
        _set_cell_text(purchaser_cells[1], "Name and address of the purchaser with phone number")
    owner_row.addnext(purchaser_row)

def roman_document_number(index):
    return {1: "i)", 2: "ii)", 3: "iii)", 4: "iv)", 5: "v)", 6: "vi)", 7: "vii)", 8: "viii)", 9: "ix)"}.get(index, f"{index})")

def prepare_agricultural_document_rows(root, count):
    rows = root.xpath(".//w:tr[contains(string(.), '{{DOCUMENT_') and contains(string(.), '_TYPE}}')]", namespaces=NS)
    if not rows:
        return
    parent = rows[0].getparent()
    position = min(parent.index(row) for row in rows)
    templates = [deepcopy(row) for row in rows]
    for row in rows:
        parent.remove(row)
    for offset in range(count):
        index = offset + 1
        clone = deepcopy(templates[min(offset, len(templates) - 1)])
        for text_node in clone.xpath(".//w:t", namespaces=NS):
            text = text_node.text or ""
            text = re.sub(r"DOCUMENT_\d+_", f"DOCUMENT_{index}_", text)
            if text.strip().lower() in {"i)", "ii)", "iii)"}:
                text = roman_document_number(index)
            text_node.text = text
        parent.insert(position + offset, clone)

def prepare_floor_rows(root, values):
    indexes = floor_indexes(values)
    rows = root.xpath(".//w:tr[.//w:tag[starts-with(@w:val, 'building.floors.2.')]]", namespaces=NS)
    if not rows:
        return
    template_row = rows[0]
    parent = template_row.getparent()
    if len(indexes) == 1:
        parent.remove(template_row)
        return
    for index in indexes[2:]:
        clone = deepcopy(template_row)
        for tag in clone.xpath(".//w:tag", namespaces=NS):
            tag.set(qn("val"), tag.get(qn("val")).replace("building.floors.2.", f"building.floors.{index}."))
        first_text = clone.xpath(".//w:tc[1]//w:t", namespaces=NS)
        if first_text:
            first_text[0].text = str(index)
        parent.insert(parent.index(template_row) + index - 2, clone)

def replace_plain_tokens(template_path, output_path, replacements, document_count=1):
    token_map = {f"{{{{{key}}}}}": str(value or "") for key, value in replacements.items()}
    with ZipFile(template_path) as zin, ZipFile(output_path, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                prepare_agricultural_document_rows(root, document_count)
                prepare_agricultural_party_rows(root)
                for text_node in root.xpath(".//w:t", namespaces=NS):
                    text = text_node.text or ""
                    for token, value in token_map.items():
                        if token in text:
                            text = text.replace(token, value)
                    if "\n" in text:
                        set_text_node_with_breaks(text_node, text)
                    else:
                        text_node.text = text
                for paragraph in root.xpath(".//w:p", namespaces=NS):
                    nodes = paragraph.xpath(".//w:t", namespaces=NS)
                    joined = "".join(node.text or "" for node in nodes)
                    if "{{" not in joined or any(media in joined for media in ("{{PROPERTY_PHOTOGRAPHS}}", "{{ROUTE_MAP}}")):
                        continue
                    replaced = joined
                    for token, value in token_map.items():
                        replaced = replaced.replace(token, value)
                    replaced = re.sub(r"\{\{[A-Z0-9_]+\}\}", "", replaced)
                    if nodes:
                        nodes[0].text = replaced
                        for node in nodes[1:]:
                            node.text = ""
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)
