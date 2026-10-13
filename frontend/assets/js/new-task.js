(function () {
  "use strict";

  const form = document.getElementById("new-task-form");
  const institutionType = document.getElementById("institution-type");
  const institution = document.getElementById("institution");
  const reportType = document.getElementById("report-type");
  const valuationType = document.getElementById("valuation-type");
  const valuationWrap = document.getElementById("valuation-type-wrap");
  const assignedDate = document.getElementById("assigned-date");
  const dueDate = document.getElementById("due-date");

  function iso(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function refreshInstitutions() {
    institution.innerHTML = '<option value="">Select institution</option>';
    const choices = window.INSTITUTIONS[institutionType.value] || [];
    choices.forEach((item) => institution.add(new Option(item.name, item.code)));
    institution.disabled = !choices.length;
  }

  function refreshReportType() {
    valuationWrap.hidden = reportType.value !== "valuation";
    valuationType.required = reportType.value === "valuation";
    if (reportType.value !== "valuation") valuationType.value = "";
  }

  function refreshDates() {
    const start = assignedDate.value ? new Date(`${assignedDate.value}T00:00:00`) : new Date();
    const suggested = new Date(start);
    suggested.setDate(suggested.getDate() + 7);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const maximum = suggested > monthEnd ? monthEnd : suggested;
    dueDate.min = assignedDate.value;
    dueDate.max = iso(monthEnd);
    dueDate.value = iso(maximum);
  }

  institutionType.addEventListener("change", refreshInstitutions);
  reportType.addEventListener("change", refreshReportType);
  assignedDate.addEventListener("change", refreshDates);
  assignedDate.max = iso(new Date());
  assignedDate.value = iso(new Date());
  refreshDates();
  refreshReportType();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const selectedInstitution = (window.INSTITUTIONS[institutionType.value] || []).find((item) => item.code === institution.value);
    const reportKey = reportType.value === "valuation" ? `valuation-${valuationType.value}` : reportType.value;
    const task = TaskStore.create({
      institutionType: institutionType.value,
      institutionCode: institution.value,
      institutionName: selectedInstitution.name,
      branch: document.getElementById("branch").value,
      customerName: document.getElementById("customer-name").value,
      propertyBrief: document.getElementById("property-brief").value,
      reportKey,
      assignee: document.getElementById("assignee").value,
      priority: document.getElementById("priority").value,
      assignedDate: assignedDate.value,
      dueDate: dueDate.value,
      initialNote: document.getElementById("initial-note").value,
    });
    window.location.href = `/tasks/detail?id=${encodeURIComponent(task.id)}`;
  });
})();
