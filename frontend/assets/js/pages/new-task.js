/** New-assignment controller: validation, local draft recovery, dates, routing, and creation. */
(function () {
  "use strict";

  const form = document.getElementById("new-task-form");
  const institutionType = document.getElementById("institution-type");
  const institution = document.getElementById("institution");
  const reportType = document.getElementById("report-type");
  const valuationType = document.getElementById("valuation-type");
  const valuationWrap = document.getElementById("valuation-type-wrap");
  const linkedEstimation = document.getElementById("linked-estimation");
  const linkedEstimationWrap = document.getElementById("linked-estimation-wrap");
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
    const linkedReport = ["progress", "completion"].includes(reportType.value);
    linkedEstimationWrap.hidden = !linkedReport;
    linkedEstimation.required = linkedReport;
    if (linkedReport) refreshLinkedEstimations();
    else {
      linkedEstimation.value = "";
      setLinkedIdentity(false);
    }
  }

  function setLinkedIdentity(locked) {
    institutionType.disabled = locked;
    institution.disabled = locked || !(window.INSTITUTIONS[institutionType.value] || []).length;
    document.getElementById("branch").readOnly = locked;
    document.getElementById("customer-name").readOnly = locked;
    document.getElementById("property-brief").readOnly = locked;
  }

  function refreshLinkedEstimations(selectedId = linkedEstimation.value) {
    const candidates = TaskStore.estimationCandidates(reportType.value, assignedDate.value);
    linkedEstimation.innerHTML = '<option value="">Select a finalized estimation report</option>';
    candidates.forEach((candidate) => {
      const amount = Number(candidate.estimationSummary?.totalEstimatedCost || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
      linkedEstimation.add(new Option(`${candidate.id} · ${candidate.customerName} · ₹${amount}`, candidate.id));
    });
    linkedEstimation.value = candidates.some((candidate) => candidate.id === selectedId) ? selectedId : "";
    document.getElementById("linked-estimation-help").textContent = candidates.length
      ? "Selecting an estimate reuses and locks its institution, applicant and property identity. Closed completion reports and duplicate report dates are excluded."
      : "No eligible estimation report is available. Finalize an estimate, or check whether a completion report is already closed or the selected report date is already in use.";
    applyLinkedEstimation();
  }

  function applyLinkedEstimation() {
    const linked = TaskStore.get(linkedEstimation.value);
    if (!linked) { setLinkedIdentity(false); return; }
    institutionType.value = linked.institutionType;
    refreshInstitutions();
    institution.value = linked.institutionCode;
    document.getElementById("branch").value = linked.branch;
    document.getElementById("customer-name").value = linked.customerName;
    document.getElementById("property-brief").value = linked.propertyBrief;
    setLinkedIdentity(true);
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
      linkedEstimation: linkedEstimation.value,
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
    draftStatus.classList.remove("is-saving");
    draftStatus.removeAttribute("aria-label");
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
    draftStatus.classList.add("is-saving");
    draftStatus.setAttribute("aria-label", "Saving draft locally");
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, 700);
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
    if (["progress", "completion"].includes(reportType.value)) refreshLinkedEstimations(saved.linkedEstimation || "");
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
  linkedEstimation.addEventListener("change", () => { applyLinkedEstimation(); scheduleDraftSave(); });
  assignedDate.addEventListener("change", () => {
    refreshDates();
    if (["progress", "completion"].includes(reportType.value)) refreshLinkedEstimations();
  });
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
        linkedEstimationId: linkedEstimation.value,
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
