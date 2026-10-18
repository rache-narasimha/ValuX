/** New-assignment controller: validation, local draft recovery, dates, routing, and creation. */
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
  const initialNote = document.getElementById("initial-note");
  const currentUser = WorkflowAccess.currentUser();
  const DRAFT_KEY = `sln.workflow.new-assignment-draft.v1.${currentUser.role}`;
  const draftStatus = document.getElementById("draft-status");
  const discardDraft = document.getElementById("discard-draft");
  let draftTimer = null;
  let hasUnsavedChanges = false;
  const picker = EmployeePicker.mount(document.getElementById("assignee-picker"), {
    required: currentUser.role === "employee",
    includeUnassigned: currentUser.role === "father",
    label: "Assign to employee",
  });

  // Institution/report options and priority-derived dates.
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
    const priority = document.getElementById("priority").value;
    const range = TaskStore.dueDateRange(priority, assignedDate.value);
    dueDate.min = assignedDate.value;
    dueDate.max = range.maximum;
    dueDate.value = range.suggested;
    document.getElementById("due-date-help").textContent = `${priority} priority: suggested ${range.suggested}; latest allowed ${range.maximum} (calendar days).`;
  }

  function draftValues() {
    return {
      institutionType: institutionType.value,
      institution: institution.value,
      branch: document.getElementById("branch").value,
      customerName: document.getElementById("customer-name").value,
      propertyBrief: document.getElementById("property-brief").value,
      reportType: reportType.value,
      valuationType: valuationType.value,
      assigneeSearch: picker.input.value,
      priority: document.getElementById("priority").value,
      assignedDate: assignedDate.value,
      dueDate: dueDate.value,
      initialNote: initialNote.value,
      savedAt: new Date().toISOString(),
    };
  }

  // Local draft persistence for an unfinished assignment.
  function showDraftState(message, canDiscard = true) {
    draftStatus.textContent = message;
    discardDraft.hidden = !canDiscard;
  }

  function saveDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = null;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftValues()));
      hasUnsavedChanges = false;
      showDraftState("Draft saved locally");
    } catch (_error) {
      hasUnsavedChanges = true;
      showDraftState("Draft could not be saved", false);
    }
  }

  function scheduleDraftSave() {
    hasUnsavedChanges = true;
    showDraftState("Saving draft…");
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 250);
  }

  function restoreDraft() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch (_error) {
      showDraftState("Saved draft could not be read", true);
      return;
    }
    if (!saved || typeof saved !== "object") return;
    institutionType.value = saved.institutionType || "";
    refreshInstitutions();
    institution.value = saved.institution || "";
    document.getElementById("branch").value = saved.branch || "";
    document.getElementById("customer-name").value = saved.customerName || "";
    document.getElementById("property-brief").value = saved.propertyBrief || "";
    reportType.value = saved.reportType || "";
    refreshReportType();
    valuationType.value = saved.valuationType || "";
    picker.input.value = saved.assigneeSearch || "";
    document.getElementById("priority").value = saved.priority || "Normal";
    assignedDate.value = saved.assignedDate || iso(new Date());
    refreshDates();
    if (saved.dueDate && saved.dueDate >= dueDate.min && saved.dueDate <= dueDate.max) dueDate.value = saved.dueDate;
    initialNote.value = saved.initialNote || "";
    initialNote.required = Boolean(picker.input.value.trim());
    showDraftState("Draft restored locally");
  }

  function clearDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = null;
    hasUnsavedChanges = false;
    localStorage.removeItem(DRAFT_KEY);
  }

  function resetForm() {
    clearDraft();
    form.reset();
    picker.setValue("");
    institution.innerHTML = '<option value="">Select institution</option>';
    institution.disabled = true;
    assignedDate.value = iso(new Date());
    assignedDate.max = iso(new Date());
    refreshReportType();
    refreshDates();
    initialNote.required = false;
    errorMessage.hidden = true;
    showDraftState("Draft discarded", false);
  }

  // Form initialization, event handling, and submission.
  institutionType.addEventListener("change", refreshInstitutions);
  reportType.addEventListener("change", refreshReportType);
  assignedDate.addEventListener("change", refreshDates);
  document.getElementById("priority").addEventListener("change", refreshDates);
  picker.input.addEventListener("change", () => {
    try { initialNote.required = Boolean(picker.value()); } catch (_error) { initialNote.required = Boolean(picker.input.value.trim()); }
  });
  assignedDate.max = iso(new Date());
  assignedDate.value = iso(new Date());
  refreshDates();
  refreshReportType();
  restoreDraft();
  if (currentUser.role === "employee") {
    document.getElementById("assignee-label").classList.add("required");
    document.querySelector("#assignee-label .optional-label")?.remove();
    document.getElementById("assignee-help").textContent = "Employees must route a new task to themselves or another employee.";
  }

  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
  discardDraft.addEventListener("click", () => {
    if (confirm("Discard the locally saved assignment draft?")) resetForm();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

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
      const selectedAssignee = picker.value();
      if (currentUser.role === "employee" && !selectedAssignee) throw new Error("Employees must assign a new task before creating it.");
      if (selectedAssignee && !initialNote.value.trim()) {
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
        assignee: selectedAssignee,
        priority: document.getElementById("priority").value,
        assignedDate: assignedDate.value,
        dueDate: dueDate.value,
        initialNote: initialNote.value,
      });
      clearDraft();
      window.location.replace(`/tasks/detail?id=${encodeURIComponent(task.id)}`);
    } catch (error) {
      errorMessage.textContent = error.message || "The assignment could not be created. Please try again.";
      errorMessage.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = "Create assignment";
      errorMessage.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
})();
