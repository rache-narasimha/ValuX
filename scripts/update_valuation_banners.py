"""Apply the approved reference banners and value typography without rebuilding tables."""

from copy import deepcopy
from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def qn(name):
    return f"{{{W}}}{name}"


def property_node(parent, name, **attributes):
    node = parent.find(qn(name))
    if node is None:
        node = etree.SubElement(parent, qn(name))
    for key, value in attributes.items():
        node.set(qn(key), str(value))
    return node


def text(paragraph):
    return "".join(paragraph.xpath(".//w:t/text()", namespaces=NS))


def run(paragraph, content, color, size, bold=False, underline=False):
    element = etree.SubElement(paragraph, qn("r"))
    properties = etree.SubElement(element, qn("rPr"))
    property_node(properties, "rFonts", ascii="Calibri", hAnsi="Calibri", cs="Calibri")
    property_node(properties, "color", val=color)
    property_node(properties, "sz", val=size * 2)
    if bold:
        property_node(properties, "b")
    if underline:
        property_node(properties, "u", val="single")
    node = etree.SubElement(element, qn("t"))
    node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    node.text = content


def heading(paragraph, title, subtitle="", *, banner=True, margins=(0, 0)):
    properties = paragraph.find(qn("pPr"))
    if properties is None:
        properties = etree.Element(qn("pPr"))
        paragraph.insert(0, properties)
    for node in list(paragraph):
        if node is not properties:
            paragraph.remove(node)
    property_node(properties, "jc", val="center")
    property_node(properties, "keepNext")
    property_node(properties, "keepLines")
    property_node(properties, "spacing", before=100, after=100, line=300, lineRule="auto")
    if banner:
        property_node(properties, "shd", val="clear", color="auto", fill="00B0F0")
        property_node(properties, "ind", left=-margins[0], right=-margins[1], firstLine=0)
    else:
        for name in ("shd", "pBdr"):
            node = properties.find(qn(name))
            if node is not None:
                properties.remove(node)
        property_node(properties, "ind", left=0, right=0, firstLine=0)
    run(paragraph, title, "FFFFFF" if banner else "000000", 13, bold=True, underline=not banner)
    if subtitle:
        run(paragraph, f" ({subtitle})", "000000", 11)


def update(kind):
    path = ROOT / f"resources/{kind}/master_template.docx"
    with ZipFile(path) as archive:
        entries = [(item, archive.read(item.filename)) for item in archive.infolist()]
    with ZipFile(path, "w") as archive:
        for item, content in entries:
            if item.filename == "word/document.xml":
                root = etree.fromstring(content)
                margin = root.xpath("(.//w:sectPr/w:pgMar)[1]", namespaces=NS)[0]
                margins = (int(margin.get(qn("left"))), int(margin.get(qn("right"))))
                paragraphs = root.xpath("./w:body/w:p", namespaces=NS)
                if kind == "general":
                    bank = next(p for p in paragraphs if text(p) == "{{BANK_NAME}}")
                    heading(bank, "{{BANK_NAME}}", margins=margins)
                    titles = [p for p in paragraphs if text(p) == "Valuation Report"]
                    if titles:
                        heading(titles[0], "Valuation Report", banner=False)
                    if len(titles) > 1:
                        detail = titles[1]
                        subtitle = detail.getnext()
                        heading(detail, "Valuation Report", "Land and Building", margins=margins)
                        if subtitle is not None and text(subtitle).strip() == "Land and Building":
                            subtitle.getparent().remove(subtitle)
                else:
                    title = next((p for p in paragraphs if text(p) == "Valuation Report"), None)
                    if title is not None:
                        subtitle = title.getnext()
                        heading(title, "Valuation Report", "Agricultural Land", margins=margins)
                        if subtitle is not None and text(subtitle).strip() == "Agricultural Land":
                            subtitle.getparent().remove(subtitle)

                phrases = ("present fair market value", "present market value", "fair market value",
                           "realizable value", "distress value", "government value", "book value",
                           "estimated value", "land value", "building value", "net value", "total value")
                for paragraph in root.xpath(".//w:p", namespaces=NS):
                    nodes = paragraph.xpath(".//w:t", namespaces=NS)
                    source = "".join(node.text or "" for node in nodes)
                    normalized = source
                    for phrase in phrases:
                        normalized = re.sub(r"\b" + phrase + r"\b", phrase.title(), normalized, flags=re.I)
                    offset = 0
                    for node in nodes:
                        length = len(node.text or "")
                        node.text = normalized[offset:offset + length]
                        offset += length
                    # Use an intentional line break, not padding or an extra blank paragraph.
                    # Keep it in the same paragraph to retain the declaration's pagination chain.
                    for node in nodes:
                        if " (Rupees " not in (node.text or ""):
                            continue
                        parts = node.text.split(" (Rupees ")
                        node.text = parts[0].rstrip()
                        anchor = node
                        for part in parts[1:]:
                            line_break = etree.Element(qn("br"))
                            anchor.addnext(line_break)
                            continuation = deepcopy(node)
                            continuation.text = "(Rupees " + part
                            line_break.addnext(continuation)
                            anchor = continuation
                content = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
            archive.writestr(item, content)


if __name__ == "__main__":
    for report_kind in ("general", "agricultural"):
        update(report_kind)
