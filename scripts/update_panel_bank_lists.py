"""Apply the approved Canara Bank addition to retained DOCX/XLSX masters."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree


ROOT = Path(__file__).resolve().parents[1]
GENERAL = ROOT / "resources" / "general" / "master_template.docx"
ESTIMATION_FILES = [
    ROOT / "resources" / "estimation" / "estimation_compact_abstract_master.xlsx",
    ROOT / "resources" / "estimation" / "estimation_detail_masters.xlsx",
]

GENERAL_OLD = "Panel Valuer - AMF, APGB, BOB, BOI, BOM, CBoI, CUB, KB, KVB, PNB, PUB"
GENERAL_NEW = "Panel Valuer - AMF, APGB, BOB, BOI, BOM, Canara Bank, CBoI, CUB, KB, KVB, PNB, PUB"
ESTIMATION_OLD = "AMF, APGB, BOB, BOI, Central Bank, Corp Bank, KB, KVB, PUB"
ESTIMATION_NEW = "AMF, APGB, BOB, BOI, Canara Bank, Central Bank, Corp Bank, KB, KVB, PUB"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def rewrite_package(path: Path, updates: dict[str, bytes]):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with ZipFile(path) as source, ZipFile(temporary, "w", ZIP_DEFLATED) as target:
        for item in source.infolist():
            target.writestr(item, updates.get(item.filename, source.read(item.filename)))
    temporary.replace(path)


def update_general():
    with ZipFile(GENERAL) as archive:
        xml = archive.read("word/document.xml")
    root = etree.fromstring(xml)
    changed = 0
    current = 0
    for paragraph in root.xpath(".//w:p", namespaces={"w": W}):
        texts = paragraph.xpath(".//w:t", namespaces={"w": W})
        joined = "".join(node.text or "" for node in texts)
        if GENERAL_NEW in joined:
            current += 1
            continue
        if GENERAL_OLD not in joined:
            continue
        replacement = joined.replace(GENERAL_OLD, GENERAL_NEW)
        texts[0].text = replacement
        for node in texts[1:]:
            node.text = ""
        changed += 1
    if changed + current != 2:
        raise RuntimeError(f"Expected two general-template panel lists; found {changed + current}.")
    if changed:
        rewrite_package(GENERAL, {"word/document.xml": etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")})


def update_estimation(path: Path):
    updates = {}
    changed = 0
    current = 0
    with ZipFile(path) as archive:
        parts = [name for name in archive.namelist() if name == "xl/sharedStrings.xml" or name.startswith("xl/worksheets/") and name.endswith(".xml")]
        for part in parts:
            root = etree.fromstring(archive.read(part))
            part_changed = False
            for container in root.xpath(".//s:si | .//s:is", namespaces={"s": S}):
                texts = container.xpath(".//s:t", namespaces={"s": S})
                joined = "".join(node.text or "" for node in texts)
                if ESTIMATION_NEW in joined:
                    current += 1
                    continue
                if ESTIMATION_OLD not in joined:
                    continue
                texts[0].text = joined.replace(ESTIMATION_OLD, ESTIMATION_NEW)
                for node in texts[1:]:
                    node.text = ""
                changed += 1
                part_changed = True
            for node in root.xpath(".//s:c[@t='str']/s:v", namespaces={"s": S}):
                value = node.text or ""
                if ESTIMATION_NEW in value:
                    current += 1
                    continue
                if ESTIMATION_OLD not in value:
                    continue
                node.text = value.replace(ESTIMATION_OLD, ESTIMATION_NEW)
                changed += 1
                part_changed = True
            if part_changed:
                updates[part] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
    if changed + current < 1:
        raise RuntimeError(f"No estimation panel list found in {path.name}.")
    if updates:
        rewrite_package(path, updates)


def main():
    update_general()
    for path in ESTIMATION_FILES:
        update_estimation(path)
    print("Updated Canara Bank in general and estimation master templates.")


if __name__ == "__main__":
    main()
