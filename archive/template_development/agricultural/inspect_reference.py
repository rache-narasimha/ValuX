from pathlib import Path
from zipfile import ZipFile
import hashlib

from docx import Document


REFERENCE = Path("/Users/narasimharache/Downloads/Valuation Format for Agricultural Properties .docx")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


document = Document(REFERENCE)
print(f"paragraphs={len(document.paragraphs)} tables={len(document.tables)} sections={len(document.sections)}")
for index, paragraph in enumerate(document.paragraphs):
    if paragraph.text.strip():
        print(f"P{index}: {paragraph.text}")

print("TABLES")
for table_index, table in enumerate(document.tables):
    print(f"T{table_index}: rows={len(table.rows)} cols={len(table.columns)}")
    for row_index, row in enumerate(table.rows):
        text = " || ".join(cell.text.replace("\n", " / ") for cell in row.cells)
        print(f"  R{row_index}: {text}")

print("PACKAGE")
with ZipFile(REFERENCE) as archive:
    for info in archive.infolist():
        data = archive.read(info.filename)
        print(f"{info.filename}\t{len(data)}\t{digest(data)}")
