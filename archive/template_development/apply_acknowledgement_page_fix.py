from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from copy import deepcopy

from lxml import etree


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
qn = lambda name: f"{{{W}}}{name}"


def text_of(element):
    return "".join(element.xpath(".//w:t/text()", namespaces=NS))


def patch(source: Path, target: Path):
    with ZipFile(source) as zin, ZipFile(target, "w", ZIP_DEFLATED) as zout:
        found = False
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                root = etree.fromstring(data)
                for paragraph in root.xpath(".//w:body/w:p", namespaces=NS):
                    value = text_of(paragraph)
                    if "Place :Adoni" in value and "Signature of Valuer" in value:
                        p_pr = paragraph.find(qn("pPr"))
                        if p_pr is None:
                            p_pr = etree.Element(qn("pPr"))
                            paragraph.insert(0, p_pr)
                        page_break = p_pr.find(qn("pageBreakBefore"))
                        if page_break is None:
                            page_break = etree.SubElement(p_pr, qn("pageBreakBefore"))
                        page_break.set(qn("val"), "1")
                        found = True
                        break
                if not found:
                    raise RuntimeError("Valuer signature block was not found")

                body = root.find(qn("body"))
                body_children = list(body)
                ack_index = next(
                    i for i, child in enumerate(body_children)
                    if etree.QName(child).localname == "p"
                    and "The undersigned has inspected" in text_of(child)
                )
                acknowledgement = body_children[ack_index]
                first_run = acknowledgement.find(qn("r"))
                r_pr = deepcopy(first_run.find(qn("rPr"))) if first_run is not None and first_run.find(qn("rPr")) is not None else None
                p_pr = acknowledgement.find(qn("pPr"))
                for child in list(acknowledgement):
                    if child is not p_pr:
                        acknowledgement.remove(child)

                lines = [
                    "The undersigned has inspected the property detailed in the Valuation Report dated ______________ on ______________.",
                    "We are satisfied that the fair and reasonable market value of the property is Rs.__________________",
                    "(Rupees ________________________________________________________________________ only)",
                    "and the realizable value of the property is Rs.__________________",
                    "(Rupees ________________________________________________________________________ only)",
                ]
                for index, line in enumerate(lines):
                    run = etree.SubElement(acknowledgement, qn("r"))
                    if r_pr is not None:
                        run.append(deepcopy(r_pr))
                    text = etree.SubElement(run, qn("t"))
                    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                    text.text = line
                    if index != len(lines) - 1:
                        etree.SubElement(run, qn("br"))

                # Remove the legacy continuation paragraphs now represented by
                # the explicit five-line acknowledgement block.
                for child in body_children[ack_index + 1:ack_index + 4]:
                    if etree.QName(child).localname == "p" and (
                        "market value of the property" in text_of(child)
                        or text_of(child).lstrip().startswith("(Rupees")
                        or "realizable value of the property" in text_of(child)
                    ):
                        body.remove(child)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
            zout.writestr(item, data)


folder = Path("/Users/narasimharache/Documents/ChatGPT/2.0/valuation_phase1")
patch(folder / "Phase1_Reference_Data_Test.docx", folder / "Phase1_Reference_Data_Test_Revised.docx")
patch(folder / "Valuation_Report_Master_Template.docx", folder / "Valuation_Report_Master_Template_Revised.docx")
