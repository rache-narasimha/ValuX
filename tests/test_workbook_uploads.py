"""Normal uploads retain their values; hostile XML and expensive parsing are contained."""

from io import BytesIO
import os
import subprocess
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook
from openpyxl.drawing.image import Image as WorkbookImage
from openpyxl.xml import DEFUSEDXML
from PIL import Image

from backend.app.reports import workbook_uploads as uploads


def workbook_bytes():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Abstract"
    sheet.append(["Description of Component / Work"])
    sheet["B2"] = "Cost of construction of Ground Floor"
    sheet["L2"] = 2744000
    sheet["B3"] = "Custom utility"
    sheet["L3"] = 0
    sheet["L5"] = 2744000
    sheet["A6"] = "(Rupees Twenty Seven Lakh Forty Four Thousand only)"
    sheet["L6"] = 2744000
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def replace_part(content, name, value):
    output = BytesIO()
    with ZipFile(BytesIO(content)) as source, ZipFile(output, "w", ZIP_DEFLATED) as target:
        for entry in source.infolist():
            target.writestr(entry, value if entry.filename == name else source.read(entry))
    return output.getvalue()


def photo_workbook_bytes():
    """A realistic, image-heavy workbook just below the existing upload limit."""
    image = Image.frombytes("RGB", (4096, 2048), os.urandom(24 * 1024 * 1024))
    photo = BytesIO()
    image.save(photo, format="PNG", compress_level=0)
    photo.seek(0)
    workbook = Workbook()
    workbook.active.add_image(WorkbookImage(photo), "A1")
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def main():
    assert DEFUSEDXML, "Uploaded worksheet streaming must select the hardened XML parser"
    normal = workbook_bytes()
    result = uploads.extract_uploaded_estimation_summary(normal)
    assert result["totalEstimatedCost"] == 2744000
    assert [row["estimatedCost"] for row in result["components"]] == [2744000, 0]
    uploads.validate_uploaded_workbook(normal)
    uploads.inspect_uploaded_workbook(normal)
    large = photo_workbook_bytes()
    assert 24 * 1024 * 1024 < len(large) < uploads.MAX_UPLOAD_BYTES
    uploads.validate_uploaded_workbook(large)

    # A tiny, harmless entity declaration exercises rejection without a bomb.
    entity = b'<!DOCTYPE worksheet [<!ENTITY sample "text">]><worksheet>&sample;</worksheet>'
    hostile = replace_part(normal, "xl/worksheets/sheet1.xml", entity)
    malformed = replace_part(normal, "xl/workbook.xml", b"<workbook><broken>")
    for content in (hostile, malformed, b"not a ZIP workbook", b"PK broken ZIP package"):
        for operation in (uploads.extract_uploaded_estimation_summary, uploads.inspect_uploaded_workbook, uploads.validate_uploaded_workbook):
            try:
                operation(content)
            except uploads.WorkbookUploadError:
                pass
            else:
                raise AssertionError("Unsafe or malformed XLSX content was accepted")

    # Budget exhaustion changes automatic extraction only: manual totals can
    # still accompany the original attachment, rather than lowering 25 MB.
    with patch.object(uploads, "MAX_AUTO_XML_BYTES", 1):
        assert not uploads._within_processing_budget(normal)
    with patch.object(uploads.subprocess, "run", side_effect=subprocess.TimeoutExpired("parser", 20)):
        assert uploads.extract_uploaded_estimation_summary(normal) is None
    assert uploads.extract_uploaded_estimation_summary(normal)["totalEstimatedCost"] == 2744000, "Timed-out work must release its processing slot"
    assert uploads.MAX_UPLOAD_BYTES == 25 * 1024 * 1024
    print("PASS: unchanged normal workbook totals, zero values, hardened XML, bounded worker and manual fallback")


if __name__ == "__main__":
    main()
