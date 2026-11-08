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
  const similarWarning = document.getElementById("similar-task-warning");
  const similarTitle = document.getElementById("similar-task-title");
  const similarDescription = document.getElementById("similar-task-description");
  const similarDetails = document.getElementById("similar-task-details");
  const similarOpen = document.getElementById("similar-task-open");
  const similarProceed = document.getElementById("similar-task-proceed");
  const similarCancel = document.getElementById("similar-task-cancel");
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
  let pendingSimilarTask = null;
  const picker = EmployeePicker.mount(document.getElementById("assignee-picker"), {
    required: currentUser.role === "employee",
    includeUnassigned: currentUser.role === "father",
    label: "Assign to employee",
  });

  // Institution/report options and priority-derived dates.
  function refreshInstitutions() {
    institution.innerHTML = '<option value="">Select institution</option>';
    const choices = window.INSTITUTIONS[institutionType.value] || [];
    choices.forEach((item) => institution.add(new Option(item.name, item.code)));
    institution.disabled = !choices.length;
  }

  function isRevaluation() { return reportType.value === "revaluation"; }
  function needsLinkedReport() { return ["progress", "completion", "revaluation"].includes(reportType.value); }
  function linkedReportName() { return isRevaluation() ? "valuation" : "estimation"; }
  function linkedRequiredMessage() {
    return isRevaluation() ? "Select a Completed or Closed valuation before creating this assignment."
      : "Select one eligible finalized estimation report before creating this assignment.";
  }

  function refreshReportType() {
    valuationWrap.hidden = reportType.value !== "valuation";
    valuationType.required = reportType.value === "valuation";
    if (reportType.value !== "valuation") valuationType.value = "";
    const linkedReport = needsLinkedReport();
    linkedEstimationWrap.hidden = !linkedReport;
    linkedEstimation.required = false;
    if (linkedReport) {
      linkedEstimationWrap.querySelector("label").textContent = `Linked ${linkedReportName()} report`;
      document.getElementById("linked-estimation-selection").textContent = selectedEstimationLabel(null);
      document.getElementById("linked-estimation-help").textContent = isRevaluation()
        ? "Choose a Completed or Closed valuation to start the Re-Valuation."
        : "Choose one finalized eligible estimation. Search and filtering are available in the selection window.";
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
    return candidate ? `${candidate.id} · ${candidate.customerName} · ${candidate.propertyBrief}` : `Choose an eligible ${linkedReportName()} report`;
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
    const completedDate = (value) => value ? new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: ValuxTime.timeZone, timeZoneName: "short",
    }).format(new Date(value)) : "Not recorded";
    linkedResults.innerHTML = linkedRows.length ? linkedRows.map((candidate) => `<button type="button" class="estimation-picker-row" data-estimation-id="${WorkflowUI.escape(candidate.id)}">
      <span><strong>${WorkflowUI.escape(candidate.id)}</strong><small>${WorkflowUI.escape(candidate.institutionCode)} · ${WorkflowUI.escape(candidate.branch)}</small></span>
      <span><strong>${WorkflowUI.escape(candidate.customerName)}</strong><small>${WorkflowUI.escape(candidate.propertyBrief)}</small></span>
      <span class="picker-dates"><strong>Assigned: ${WorkflowUI.date(candidate.assignedDate)}</strong><small>Completed: ${completedDate(candidate.completedAt)}</small><small class="status-badge">${WorkflowUI.escape(candidate.status)}</small></span>
      <em>Select</em>
    </button>`).join("") : WorkflowUI.empty(`No eligible ${linkedReportName()} report matches the current search and filters.`);
    const noun = isRevaluation() ? "valuation" : "estimate";
    document.getElementById("estimation-picker-count").textContent = `${total} eligible ${noun}${total === 1 ? "" : "s"}`;
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
      error.textContent = exception.message || `Eligible ${linkedReportName()} reports could not be loaded.`;
      error.hidden = false;
      if (!linkedRows.length) linkedResults.innerHTML = WorkflowUI.empty(`Eligible ${linkedReportName()} reports could not be loaded. Try again.`);
    } finally {
      linkedMore.disabled = false;
      linkedResults.removeAttribute("aria-busy");
    }
  }

  function openLinkedPicker() {
    if (!needsLinkedReport() || !assignedDate.value) return;
    document.getElementById("linked-estimation-title").textContent = `Select ${linkedReportName()} report`;
    document.getElementById("linked-estimation-description").textContent = isRevaluation()
      ? "Search Completed and Closed valuations and select the original report."
      : "Search the eligible finalized estimates and select one report for this task.";
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
    if (isRevaluation() && !Array.from(institution.options).some((option) => option.value === linked.institutionCode)) {
      institution.add(new Option(linked.institutionName, linked.institutionCode));
    }
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
    dueDate.value = range.suggested;
    document.getElementById("due-date-help").textContent = `${priority} priority: suggested ${range.suggested} (you may choose another calendar date).`;
  }

  function hideSimilarWarning() {
    pendingSimilarTask = null;
    similarWarning.hidden = true;
  }

  function showSimilarWarning(task, exact = false) {
    pendingSimilarTask = exact ? null : task;
    similarTitle.textContent = exact ? "This assignment already exists" : "A very similar assignment was just created";
    similarDescription.textContent = exact
      ? "Open the existing task instead of creating an exact duplicate."
      : "Review the existing task first. If this is genuinely separate work, you can still create the new assignment.";
    similarDetails.textContent = `${task.id} · ${task.customerName} · ${task.propertyBrief} · ${task.institutionName}, ${task.branch} · ${WorkflowUI.date(task.assignedDate)} · ${task.status}`;
    similarOpen.href = task.url;
    similarProceed.hidden = exact;
    similarWarning.hidden = false;
    similarWarning.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function taskPayload(allowSimilarTaskId = "") {
    const reportKey = reportType.value === "valuation" ? `valuation-${valuationType.value}` : reportType.value;
    if (needsLinkedReport() && !linkedEstimation.value) throw new Error(linkedRequiredMessage());
    const original = isRevaluation() ? TaskStore.get(linkedEstimation.value) : null;
    const selectedInstitution = original ? { name: original.institutionName }
      : (window.INSTITUTIONS[institutionType.value] || []).find((item) => item.code === institution.value);
    if (!selectedInstitution) throw new Error("Select a valid bank or NBFC.");
    const selectedAssignee = picker.value();
    const assigneeReference = picker.id();
    if (currentUser.role === "employee" && !selectedAssignee) throw new Error("Employees must assign a new task before creating it.");
    if (selectedAssignee && !initialNote.value.trim()) {
      throw new Error("Add an initial work note when assigning the task. Use an acknowledgement for self-assignment or a routing justification for another employee.");
    }
    return {
      institutionType: institutionType.value,
      institutionCode: institution.value,
      institutionName: selectedInstitution.name,
      branch: document.getElementById("branch").value,
      customerName: document.getElementById("customer-name").value,
      propertyBrief: document.getElementById("property-brief").value,
      reportKey,
      linkedEstimationId: isRevaluation() ? "" : linkedEstimation.value,
      linkedValuationId: isRevaluation() ? linkedEstimation.value : "",
      assignee: assigneeReference,
      priority: document.getElementById("priority").value,
      assignedDate: assignedDate.value,
      dueDate: dueDate.value,
      initialNote: initialNote.value,
      allowSimilarTaskId,
    };
  }

  async function createAssignment(allowSimilarTaskId = "") {
    errorMessage.hidden = true;
    submitButton.disabled = true;
    similarProceed.disabled = true;
    submitButton.textContent = "Creating…";
    try {
      const task = await TaskStore.create(taskPayload(allowSimilarTaskId));
      hasUnsavedChanges = false;
      window.location.replace(`/tasks/detail?id=${encodeURIComponent(task.id)}`);
    } catch (error) {
      if (error.code === "similar_task" && error.similarTask) {
        showSimilarWarning(error.similarTask, false);
      } else if (error.code === "duplicate" && error.existingTask) {
        showSimilarWarning(error.existingTask, true);
      } else {
        errorMessage.textContent = error.message || "The assignment could not be created. Please try again.";
        errorMessage.hidden = false;
        errorMessage.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } finally {
      submitButton.disabled = false;
      similarProceed.disabled = false;
      submitButton.textContent = "Create assignment";
    }
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
  assignedDate.value = ValuxTime.today();
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

  form.addEventListener("input", () => { hasUnsavedChanges = true; hideSimilarWarning(); });
  form.addEventListener("change", () => { hasUnsavedChanges = true; hideSimilarWarning(); });
  similarProceed.addEventListener("click", () => {
    if (pendingSimilarTask?.id) createAssignment(pendingSimilarTask.id);
  });
  similarCancel.addEventListener("click", hideSimilarWarning);
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (needsLinkedReport() && !linkedEstimation.value) {
      errorMessage.textContent = linkedRequiredMessage();
      errorMessage.hidden = false;
      document.getElementById("open-linked-estimation").focus();
      return;
    }
    if (!form.reportValidity()) return;
    hideSimilarWarning();
    await createAssignment();
  });
})();
