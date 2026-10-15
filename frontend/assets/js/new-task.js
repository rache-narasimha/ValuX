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
  const errorMessage = document.getElementById("task-error");
  const submitButton = form.querySelector('button[type="submit"]');
  const assignee = document.getElementById("assignee");
  const initialNote = document.getElementById("initial-note");

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
  assignee.addEventListener("change", () => {
    initialNote.required = Boolean(assignee.value);
  });
  assignedDate.max = iso(new Date());
  assignedDate.value = iso(new Date());
  refreshDates();
  refreshReportType();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    errorMessage.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = "Creating…";
    try {
      const selectedInstitution = (window.INSTITUTIONS[institutionType.value] || []).find((item) => item.code === institution.value);
      if (!selectedInstitution) throw new Error("Select a valid bank or NBFC.");
      const reportKey = reportType.value === "valuation" ? `valuation-${valuationType.value}` : reportType.value;
      if (assignee.value && !initialNote.value.trim()) {
        throw new Error("Add a brief description when assigning the task. Use an acknowledgement for self-assignment or a routing justification for another employee.");
      }
      const task = TaskStore.create({
        institutionType: institutionType.value,
        institutionCode: institution.value,
        institutionName: selectedInstitution.name,
        branch: document.getElementById("branch").value,
        customerName: document.getElementById("customer-name").value,
        propertyBrief: document.getElementById("property-brief").value,
        reportKey,
        assignee: assignee.value,
        priority: document.getElementById("priority").value,
        assignedDate: assignedDate.value,
        dueDate: dueDate.value,
        initialNote: initialNote.value,
      });
      window.location.href = `/tasks/detail?id=${encodeURIComponent(task.id)}`;
    } catch (error) {
      errorMessage.textContent = error.message || "The assignment could not be created. Please try again.";
      errorMessage.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = "Create assignment";
      errorMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
})();
