from pathlib import Path
from zipfile import ZipFile
from lxml import etree

DOCX = Path("/Users/narasimharache/Desktop/SLN_poc/Valuation_report_res:com:indus.docx")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W, "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

with ZipFile(DOCX) as zf:
    root = etree.fromstring(zf.read("word/document.xml"))

body = root.find(f"{{{W}}}body")
for i, child in enumerate(body):
    kind = etree.QName(child).localname
    text = "".join(child.xpath(".//w:t/text()", namespaces=NS)).replace("\n", " ")
    text = " ".join(text.split())
    page_breaks = len(child.xpath('.//w:br[@w:type="page"]', namespaces=NS))
    rendered_breaks = len(child.xpath(".//w:lastRenderedPageBreak", namespaces=NS))
    drawings = len(child.xpath(".//w:drawing", namespaces=NS))
    print(f"{i:03d} {kind:4s} pb={page_breaks} lrb={rendered_breaks} drawings={drawings} {text[:150]}")
