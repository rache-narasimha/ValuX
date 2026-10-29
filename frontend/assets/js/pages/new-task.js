/** New-assignment controller: validation, dates, routing, and durable creation. */
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
  const linkedModal = document.getElementById("linked-estimation-modal");
  const linkedResults = document.getElementById("estimation-picker-results");
  const linkedSearch = document.getElementById("estimation-picker-search");
  const linkedInstitution = document.getElementById("estimation-picker-institution");
  const linkedStatus = document.getElementById("estimation-picker-status");
  const linkedMore = document.getElementById("estimation-picker-more");
  const currentUser = WorkflowAccess.currentUser();
  let hasUnsavedChanges = false;
  let linkedOffset = 0;
  let linkedRows = [];
  let linkedSearchTimer = null;
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
    linkedEstimation.required = false;
    if (linkedReport) {
      document.getElementById("linked-estimation-help").textContent = "Choose one finalized eligible estimation. Search and filtering are available in the selection window.";
    }
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

  function selectedEstimationLabel(candidate) {
    return candidate ? `${candidate.id} · ${candidate.customerName} · ${candidate.propertyBrief}` : "Choose an eligible estimation report";
  }

  function selectLinkedEstimation(candidate) {
    linkedEstimation.innerHTML = '<option value="">Select a finalized estimation report</option>';
    if (candidate) linkedEstimation.add(new Option(selectedEstimationLabel(candidate), candidate.id));
    linkedEstimation.value = candidate?.id || "";
    document.getElementById("linked-estimation-selection").textContent = selectedEstimationLabel(candidate);
    applyLinkedEstimation();
    hasUnsavedChanges = true;
  }

  function renderLinkedResults(total) {
    linkedResults.innerHTML = linkedRows.length ? linkedRows.map((candidate) => `<button type="button" class="estimation-picker-row" data-estimation-id="${WorkflowUI.escape(candidate.id)}">
      <span><strong>${WorkflowUI.escape(candidate.id)}</strong><small>${WorkflowUI.escape(candidate.institutionCode)} · ${WorkflowUI.escape(candidate.branch)}</small></span>
      <span><strong>${WorkflowUI.escape(candidate.customerName)}</strong><small>${WorkflowUI.escape(candidate.propertyBrief)}</small></span>
      <span><strong>${WorkflowUI.date(candidate.assignedDate)}</strong><small>${WorkflowUI.escape(candidate.status)}</small></span>
      <em>Select</em>
    </button>`).join("") : WorkflowUI.empty("No eligible estimation report matches the current search and filters.");
    document.getElementById("estimation-picker-count").textContent = `${total} eligible ${total === 1 ? "estimate" : "estimates"}`;
  }

  async function loadLinkedEstimations(reset = false) {
    const error = document.getElementById("estimation-picker-error");
    error.hidden = true;
    if (reset) { linkedOffset = 0; linkedRows = []; }
    linkedMore.disabled = true;
    linkedResults.setAttribute("aria-busy", "true");
    try {
      const result = await TaskStore.eligibleEstimations(reportType.value, assignedDate.value, {
        search: linkedSearch.value, institution: linkedInstitution.value, status: linkedStatus.value,
        offset: linkedOffset, limit: 20,
      });
      linkedRows.push(...result.items.filter((item) => !linkedRows.some((existing) => existing.id === item.id)));
      linkedOffset = linkedRows.length;
      renderLinkedResults(result.total);
      linkedMore.hidden = !result.hasMore;
    } catch (exception) {
      error.textContent = exception.message || "Eligible estimations could not be loaded.";
      error.hidden = false;
      if (!linkedRows.length) linkedResults.innerHTML = WorkflowUI.empty("Eligible estimations could not be loaded. Try again.");
    } finally {
      linkedMore.disabled = false;
      linkedResults.removeAttribute("aria-busy");
    }
  }

  function openLinkedPicker() {
    if (!["progress", "completion"].includes(reportType.value) || !assignedDate.value) return;
    linkedModal.hidden = false;
    document.body.classList.add("modal-open");
    loadLinkedEstimations(true);
    linkedSearch.focus();
  }

  function closeLinkedPicker() {
    linkedModal.hidden = true;
    document.body.classList.remove("modal-open");
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

  // Form initialization, event handling, and submission.
  institutionType.addEventListener("change", refreshInstitutions);
  reportType.addEventListener("change", () => {
    selectLinkedEstimation(null);
    refreshReportType();
  });
  linkedEstimation.addEventListener("change", () => { applyLinkedEstimation(); hasUnsavedChanges = true; });
  assignedDate.addEventListener("change", () => {
    refreshDates();
    if (["progress", "completion"].includes(reportType.value)) selectLinkedEstimation(null);
  });
  document.getElementById("open-linked-estimation").addEventListener("click", openLinkedPicker);
  document.querySelectorAll("[data-close-estimation-picker]").forEach((button) => button.addEventListener("click", closeLinkedPicker));
  linkedResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-estimation-id]");
    if (!button) return;
    const candidate = linkedRows.find((item) => item.id === button.dataset.estimationId);
    if (!candidate) return;
    selectLinkedEstimation(candidate);
    closeLinkedPicker();
  });
  linkedMore.addEventListener("click", () => loadLinkedEstimations(false));
  [linkedInstitution, linkedStatus].forEach((field) => field.addEventListener("change", () => loadLinkedEstimations(true)));
  linkedSearch.addEventListener("input", () => {
    window.clearTimeout(linkedSearchTimer);
    linkedSearchTimer = window.setTimeout(() => loadLinkedEstimations(true), 300);
  });
  document.getElementById("priority").addEventListener("change", refreshDates);
  picker.input.addEventListener("change", () => {
    try { initialNote.required = Boolean(picker.value()); } catch (_error) { initialNote.required = Boolean(picker.input.value.trim()); }
  });
  assignedDate.max = iso(new Date());
  assignedDate.value = iso(new Date());
  refreshDates();
  refreshReportType();
  Object.entries(window.INSTITUTIONS).forEach(([type, institutions]) => {
    const group = document.createElement("optgroup");
    group.label = type === "Bank" ? "Banks" : "NBFCs";
    institutions.forEach((item) => group.append(new Option(`${item.code} — ${item.name}`, item.code)));
    linkedInstitution.append(group);
  });
  if (currentUser.role === "employee") {
    document.getElementById("assignee-label").classList.add("required");
    document.querySelector("#assignee-label .optional-label")?.remove();
    document.getElementById("assignee-help").textContent = "Employees must route a new task to themselves or another employee.";
  }

  form.addEventListener("input", () => { hasUnsavedChanges = true; });
  form.addEventListener("change", () => { hasUnsavedChanges = true; });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (["progress", "completion"].includes(reportType.value) && !linkedEstimation.value) {
      errorMessage.textContent = "Select one eligible finalized estimation report before creating this assignment.";
      errorMessage.hidden = false;
      document.getElementById("open-linked-estimation").focus();
      return;
    }
    if (!form.reportValidity()) return;
    errorMessage.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = "Creating…";
    try {
      const reportKey = reportType.value === "valuation" ? `valuation-${valuationType.value}` : reportType.value;
      if (["progress", "completion"].includes(reportKey) && !linkedEstimation.value) {
        throw new Error("Select one eligible finalized estimation report before creating this assignment.");
      }
      const selectedInstitution = (window.INSTITUTIONS[institutionType.value] || []).find((item) => item.code === institution.value);
      if (!selectedInstitution) throw new Error("Select a valid bank or NBFC.");
      const selectedAssignee = picker.value();
      const assigneeReference = picker.id();
      if (currentUser.role === "employee" && !selectedAssignee) throw new Error("Employees must assign a new task before creating it.");
      if (selectedAssignee && !initialNote.value.trim()) {
        throw new Error("Add a brief description when assigning the task. Use an acknowledgement for self-assignment or a routing justification for another employee.");
      }
      const task = await TaskStore.create({
        institutionType: institutionType.value,
        institutionCode: institution.value,
        institutionName: selectedInstitution.name,
        branch: document.getElementById("branch").value,
        customerName: document.getElementById("customer-name").value,
        propertyBrief: document.getElementById("property-brief").value,
        reportKey,
        linkedEstimationId: linkedEstimation.value,
        assignee: assigneeReference,
        priority: document.getElementById("priority").value,
        assignedDate: assignedDate.value,
        dueDate: dueDate.value,
        initialNote: initialNote.value,
      });
      hasUnsavedChanges = false;
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
