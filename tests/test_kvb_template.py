"""Regression checks for the cleaned Karur Vysya Bank valuation workbook."""

from io import BytesIO

from openpyxl import load_workbook

from backend.app.valuation.kvb_template import generate_kvb_template


def main():
    generated = generate_kvb_template()
    workbook = load_workbook(BytesIO(generated.content), data_only=False)
    sheet = workbook["Sheet1"]

    assert generated.file_name == "KVB_Valuation_Template.xlsx"
    assert sheet.print_area == "'Sheet1'!$A$1:$J$164"
    assert sheet.page_setup.orientation == "portrait"
    assert str(sheet.page_setup.paperSize) == str(sheet.PAPERSIZE_A4)
    assert len(sheet.merged_cells.ranges) == 198
    assert len(sheet._images) == 0
    assert sheet["A1"].value == "Valuation Report For Karur Vysya Bank Limited "
    assert sheet["C10"].value is None
    assert sheet["C12"].value == '=IF(C10="","",C10)'
    assert sheet["C29"].value is None
    assert sheet["C30"].value == '=IF(C29="","",C29)'
    assert sheet["G87"].value is None
    assert sheet["I91"].value is None
    assert sheet["A117"].value == "PROPERTY PHOTOGRAPHS"
    assert sheet["A152"].value == "Latitude and Longitude:"
    workbook.close()
    print("PASS: KVB template keeps the approved layout without sample case data or images")


if __name__ == "__main__":
    main()
