from pathlib import Path

from docx import Document


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "Valuation_Report_Master_Template_Phase2.docx"
OUTPUT = HERE / "Valuation_Report_Master_Template_Phase3.docx"


document = Document(SOURCE)

# Keep the valuer's letterhead artwork, but remove the retained property photos
# and Google Maps screenshot from the final two pages.
for paragraph in document.paragraphs[103:]:
    for drawing in paragraph._p.xpath(".//w:drawing"):
        drawing.getparent().remove(drawing)

document.paragraphs[103].text = "PROPERTY PHOTOGRAPHS\nUploaded property photographs will be arranged here."
document.paragraphs[105].text = "LOCATION MAP\nThe uploaded map screenshot will be placed here."
document.paragraphs[105].paragraph_format.page_break_before = True

document.save(OUTPUT)
print(OUTPUT)
