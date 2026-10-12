const reportType = document.getElementById("report-type");
const valuationType = document.getElementById("valuation-type");
const valuationWrap = document.getElementById("valuation-type-wrap");
const note = document.getElementById("selection-note");
const start = document.getElementById("start-report");
function refreshSelection() {
  const report = reportType.value;
  valuationWrap.hidden = report !== "valuation";
  if (report !== "valuation") valuationType.value = "";
  if (!report) {
    note.textContent = "Select a report type to continue.";
    start.disabled = true;
    return;
  }
  if (report === "estimation") {
    note.textContent =
      "Estimation is planned and will be enabled after its approved template is added.";
    start.disabled = true;
    return;
  }
  if (report === "progress_completion") {
    note.textContent =
      "Progress / Completion Report is planned and will be enabled after its approved template is added.";
    start.disabled = true;
    return;
  }
  if (!valuationType.value) {
    note.textContent =
      "Choose General Property or Agricultural Land Valuation.";
    start.disabled = true;
    return;
  }
  note.textContent =
    valuationType.value === "general_property"
      ? "The general property workflow will open."
      : "The five-section agricultural valuation workflow will open.";
  start.disabled = false;
}
reportType.addEventListener("change", refreshSelection);
valuationType.addEventListener("change", refreshSelection);
document
  .getElementById("report-selector")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    if (start.disabled) return;
    window.location.href =
      valuationType.value === "agricultural_land"
        ? "/valuation/agricultural"
        : "/valuation/general";
  });
refreshSelection();
