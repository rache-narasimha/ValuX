"""Read both retained legacy totals and the current unlabelled ending rows."""

from io import BytesIO
from openpyxl import Workbook
from backend.app.estimation.summary import extract_estimation_summary


def extract(workbook):
    output = BytesIO()
    workbook.save(output)
    return extract_estimation_summary(output.getvalue())


def main():
    for compact in (False, True):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Ground Floor" if compact else "Abstract"
        if compact:
            sheet["A8"] = "Name of the Work : Proposed construction of a house at Adoni"
            sheet["I14"] = "Estimated Cost (Rs.)"
            sheet["L14"] = 2744000
            sheet["A20"] = "(Rupees Twenty Seven Lakh Forty Four Thousand only)"
        sheet["A24"] = "A B S T R A C T" if compact else "Description of Component / Work"
        sheet["B25"] = "Cost of construction of Ground Floor"
        sheet["L25"] = 2744000
        sheet["B26"] = "Custom utility"
        sheet["L26"] = 3000
        sheet["L28"] = 2747000
        sheet["A29"] = "(Rupees Twenty Seven Lakh Forty Seven Thousand only)"
        sheet["L29"] = 2747000
        current = extract(workbook)
        assert [item["label"] for item in current["components"]] == ["Ground Floor", "Custom utility"]
        assert current["totalEstimatedCost"] == 2747000
        # Retained older exports still use the labelled aggregate row.
        sheet["A28"] = "TOTAL ESTIMATED PROJECT COST"
        assert extract(workbook) == current
        workbook.close()
    print("PASS: current and retained Abstract extraction, including compact custom components")


if __name__ == "__main__":
    main()
