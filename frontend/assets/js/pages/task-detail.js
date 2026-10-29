/** Assignment workspace controller: workflow actions, payment, activity, and final-report access. */
(function () {
  "use strict";

  const taskId = new URLSearchParams(window.location.search).get("id");
  let task = TaskStore.get(taskId);
  let assigneePicker = null;

  const element = (id) => document.getElementById(id);
  const content = element("task-content");
  const notFound = element("task-not-found");
  const workNote = element("work-note");
  const actionError = element("action-error");
  const assignmentModal = element("assignment-modal");
  const holdModal = element("hold-modal");
  const cancelModal = element("cancel-modal");
  const reopenModal = element("reopen-modal");

  // Initial task lookup and common dialog/error helpers.
  function showMissingTask(title, message) {
    const storage = TaskStore.storageStatus();
    notFound.querySelector("strong").textContent = title || (storage.ok ? "Task not found" : "Saved task data needs attention");
    notFound.querySelector("p").textContent = message || (storage.ok ? "The requested assignment is unavailable or you no longer have access to it." : storage.error);
    notFound.hidden = false;
  }

  if (!task) {
    showMissingTask();
    return;
  }
  content.hidden = false;

  TaskStore.HOLD_REASONS.forEach((reason) => element("hold-reason").add(new Option(reason, reason)));
  element("cancel-reason").add(new Option("Select reason", ""));
  TaskStore.CANCELLATION_REASONS.forEach((reason) => element("cancel-reason").add(new Option(reason, reason)));

  function openModal(modal) {
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function showError(error) {
    actionError.textContent = error.message || String(error);
    actionError.hidden = false;
    element("activity-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showModalError(id, error) {
    const output = element(id);
    output.textContent = error.message || String(error);
    output.hidden = false;
  }

  function clearActionNote() {
    workNote.value = "";
    actionError.hidden = true;
  }

  function paymentSummary() {
    return TaskStore.paymentSummary(task);
  }

  function assignmentAccess() {
    const action = task.status === "Unassigned" ? "assignUnassigned" : "transferTask";
    return WorkflowAccess.can(action, task);
  }

  function openAssignmentModal() {
    if (!assignmentAccess()) return;
    const user = WorkflowAccess.currentUser();
    const assigning = task.status === "Unassigned";
    const allowed = user.role === "father" || task.assignee === user.name
      ? EmployeePicker.employees()
      : EmployeePicker.employees().filter((employee) => employee.name === user.name);
    assigneePicker = EmployeePicker.mount(element("task-assignee-picker"), {
      value: assigning ? "" : task.assignee,
      required: true,
      allowed,
      label: assigning ? "Assign to" : "Transfer to",
    });
    element("assignment-modal-title").textContent = assigning ? "Assign task" : "Transfer task";
    element("assignment-modal-help").textContent = assigning
      ? "Assignment starts the task In Progress. Add an acknowledgement or routing justification."
      : "Select the new employee and explain the transfer in the required work note.";
    element("assignment-submit").textContent = assigning ? "Assign task" : "Transfer task";
    element("assignment-work-note").value = "";
    element("assignment-error").hidden = true;
    openModal(assignmentModal);
  }

  // State-dependent controls for workflow, report access, payments, and closure.
  function configureWorkflow() {
    const canChange = WorkflowAccess.can("changeWorkflow", task);
    element("hold-task-button").hidden = !canChange || task.status !== "In Progress";
    element("resume-task-button").hidden = !canChange || task.status !== "On Hold";
    const reopen = element("reopen-task-button");
    const fatherTerminalView = WorkflowAccess.currentRole() === "father" && ["Completed", "Closed"].includes(task.status);
    reopen.hidden = !fatherTerminalView;
    reopen.disabled = fatherTerminalView && !WorkflowAccess.can("reopenTask", task);
    reopen.title = reopen.disabled ? `The ${TaskStore.REOPEN_WINDOW_DAYS}-day reopening window has expired.` : "";
  }

  function configureReportLink() {
    const report = TaskStore.REPORTS[task.reportKey];
    const openReport = element("open-report");
    const canOpen = report.route && WorkflowAccess.can("openReport", task);
    openReport.href = canOpen ? `${report.route}?task=${encodeURIComponent(task.id)}` : "#";
    if (!report.route) openReport.textContent = "Report form pending";
    else if (task.status === "Unassigned") openReport.textContent = "Assign before opening report";
    else if (["Completed", "Closed", "Cancelled"].includes(task.status)) openReport.textContent = "Report editing unavailable";
    else openReport.textContent = canOpen ? "Open report" : "Assigned employee only";
    openReport.classList.toggle("disabled-link", !canOpen);
    openReport.setAttribute("aria-disabled", String(!canOpen));
  }

  function configurePayment() {
    const canUpdate = WorkflowAccess.can("updatePayment", task);
    const closed = task.status === "Closed";
    element("payment-card").classList.toggle("is-disabled", !canUpdate);
    ["estimated-fee", "agreed-fee", "received-fee", "payment-due-date", "save-payment"].forEach((id) => {
      element(id).disabled = !canUpdate;
    });
    const notice = element("payment-readonly-reason");
    notice.hidden = !closed;
    notice.textContent = closed ? "Payment is locked because this request is closed. Reopen the task within the allowed window to edit it." : "";

    const closeButton = element("detail-close-request");
    const summary = paymentSummary();
    closeButton.hidden = closed;
    closeButton.disabled = !WorkflowAccess.can("closeTask", task) || summary.status !== "Received" || summary.outstanding !== 0;
    const reason = task.status !== "Completed"
      ? "Complete the report task to enable closing."
      : summary.outstanding === null
        ? "Enter the agreed or estimated fee before closing."
        : summary.outstanding !== 0
          ? "Settle the outstanding payment before closing."
          : "Payment is settled; the request can be closed.";
    element("detail-close-reason").textContent = reason;
    element("detail-close-wrapper").hidden = closed;
    element("detail-close-wrapper").title = reason;
  }

  function configureFinalReport() {
    const card = element("final-report-card");
    const terminal = ["Completed", "Closed"].includes(task.status);
    const closed = task.status === "Closed";
    card.hidden = !terminal;
    if (!terminal) return;
    const download = element("download-final-docx");
    const artifact = closed ? TaskStore.finalArtifact(task) : TaskStore.latestArtifact(task);
    const artifactLabel = task.reportGroup === "estimation" || task.institutionCode === "KVB" ? "Excel report" : task.institutionCode === "KB" ? "Valocity report" : "DOCX";
    if (artifact?.url) {
      download.hidden = false;
      download.textContent = `Download final ${artifactLabel}`;
      download.href = artifact.url;
      download.setAttribute("download", artifact.filename || (task.reportGroup === "estimation" || task.institutionCode === "KVB" ? "final-estimation.xlsx" : task.institutionCode === "KB" ? "final-valocity-report" : "final-report.docx"));
      element("final-report-message").textContent = closed
        ? `Final ${artifactLabel} recorded ${WorkflowUI.date(artifact.generatedAt)} and retained at closure.`
        : `Completed ${artifactLabel} recorded ${WorkflowUI.date(artifact.generatedAt)}.`;
      verifyFinalReport(artifact);
    } else {
      download.hidden = true;
      element("final-report-message").textContent = closed
        ? `The final ${artifactLabel} is unavailable because no downloadable file reference was captured before this request was closed.`
        : `No completed ${artifactLabel} is currently available for download.`;
    }
    const deadline = TaskStore.reopenDeadline(task);
    element("reopen-deadline").textContent = WorkflowAccess.currentRole() === "father"
      ? TaskStore.canReopen(task)
        ? `Reopening is available through ${WorkflowUI.date(deadline)}.`
        : `The reopening window ended on ${WorkflowUI.date(deadline)}.`
      : "Only the CEO can reopen a completed or closed task.";
  }

  async function verifyFinalReport(artifact) {
    try {
      const response = await fetch(artifact.url, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw new Error("File not found");
    } catch (_error) {
      const current = TaskStore.get(taskId);
      const currentArtifact = current?.status === "Closed" ? TaskStore.finalArtifact(current) : TaskStore.latestArtifact(current);
      if (!current || !["Completed", "Closed"].includes(current.status) || currentArtifact?.url !== artifact.url) return;
      element("download-final-docx").hidden = true;
      element("final-report-message").textContent = "The final report reference is recorded, but the file is no longer available on this installation.";
    }
  }

  // Assignment detail rendering and page-level event handlers.
  function renderBadges() {
    const assigneeLabel = task.assignee ? `Assigned to ${WorkflowUI.escape(task.assignee)}` : "Unassigned";
    const assignee = assignmentAccess()
      ? `<button type="button" class="soft-badge assignee-badge-action" id="assignment-badge">${assigneeLabel}<span aria-hidden="true">›</span></button>`
      : `<span class="soft-badge">${assigneeLabel}</span>`;
    element("task-badges").innerHTML = `<span class="status-badge ${WorkflowUI.statusClass(task.status)}">Task: ${WorkflowUI.escape(task.status)}</span><span class="soft-badge">${WorkflowUI.escape(task.priority)} priority</span>${assignee}<span class="payment-badge ${WorkflowUI.paymentClass(task.payment.status)}">Payment: ${WorkflowUI.escape(task.payment.status)}</span>`;
    element("assignment-badge")?.addEventListener("click", openAssignmentModal);
  }

  function render() {
    task = TaskStore.get(taskId);
    if (!task) {
      content.hidden = true;
      showMissingTask();
      return;
    }
    document.title = `${task.id} · SLN Property Reports`;
    element("task-id").textContent = task.id;
    element("task-name").textContent = task.reportName;
    element("task-subtitle").textContent = `${task.institutionName}, ${task.branch}`;
    renderBadges();
    const assignmentDetails = [
      ["Applicant / customer", task.customerName], ["Property", task.propertyBrief],
      ["Institution", `${task.institutionName} (${task.institutionType})`], ["Branch", task.branch],
      ["Report type", task.reportLabel], ["Assigned date", WorkflowUI.date(task.assignedDate)],
      ["Due date", WorkflowUI.date(task.dueDate)], ["On-hold reason", task.holdReason || "—"],
    ];
    if (task.linkedEstimationId) assignmentDetails.splice(5, 0, ["Linked estimation", task.linkedEstimationId]);
    element("assignment-details").innerHTML = assignmentDetails.map(([label, value]) => `<div><dt>${WorkflowUI.escape(label)}</dt><dd>${WorkflowUI.escape(value)}</dd></div>`).join("");

    configureReportLink();
    configureWorkflow();
    element("cancel-task-button").hidden = !WorkflowAccess.can("cancelTask", task);
    element("estimated-fee").value = task.payment.estimated ?? "";
    element("agreed-fee").value = task.payment.agreed ?? "";
    element("received-fee").value = task.payment.received ?? "";
    element("payment-due-date").value = task.payment.dueDate || "";
    const summary = paymentSummary();
    element("outstanding-fee").textContent = summary.outstanding === null ? "N/A" : WorkflowUI.currency(summary.outstanding);
    element("payment-status").textContent = summary.status;
    element("payment-warning").hidden = !summary.outsideStandard;
    element("payment-warning").textContent = summary.outsideStandard ? "This payment due date is beyond the standard seven-day period after completion." : "";
    element("activity-list").innerHTML = task.activity.slice().reverse().map((event) => `<li><span class="activity-dot activity-${WorkflowUI.escape(event.type)}"></span><div><p>${WorkflowUI.escape(event.text)}</p><small>${WorkflowUI.escape(event.author)} · ${WorkflowUI.date(event.createdAt)}</small></div></li>`).join("");
    element("reopen-title").textContent = `Reopen ${task.status.toLowerCase()} task`;
    element("reopen-artifact-message").textContent = `The task returns to In Progress and requires a newly generated or attached ${TaskStore.requiredArtifactLabel(task)} before completion.`;
    configurePayment();
    configureFinalReport();
    element("note-form").hidden = !WorkflowAccess.can("addNote", task);
  }

  element("open-report").addEventListener("click", (event) => {
    if (event.currentTarget.getAttribute("aria-disabled") === "true") event.preventDefault();
  });

  element("note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await TaskStore.addNote(taskId, workNote.value);
      clearActionNote();
      render();
    } catch (error) { showError(error); }
  });

  element("assignment-modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const selectedAssignee = assigneePicker.value();
      if (selectedAssignee === task.assignee) throw new Error("Select a different employee for the transfer.");
      await TaskStore.assign(taskId, assigneePicker.id(), element("assignment-work-note").value);
      closeModal(assignmentModal);
      render();
    } catch (error) { showModalError("assignment-error", error); }
  });
  document.querySelectorAll("[data-close-assignment]").forEach((button) => button.addEventListener("click", () => closeModal(assignmentModal)));

  element("hold-task-button").addEventListener("click", () => {
    element("hold-work-note").value = "";
    element("hold-error").hidden = true;
    openModal(holdModal);
  });
  document.querySelectorAll("[data-close-hold]").forEach((button) => button.addEventListener("click", () => closeModal(holdModal)));
  element("hold-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await TaskStore.putOnHold(taskId, element("hold-reason").value, element("hold-work-note").value);
      closeModal(holdModal);
      render();
    } catch (error) { showModalError("hold-error", error); }
  });

  element("resume-task-button").addEventListener("click", async () => {
    try {
      await TaskStore.resume(taskId);
      render();
    } catch (error) { showError(error); }
  });

  element("payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await TaskStore.updatePayment(taskId, {
        estimated: element("estimated-fee").value,
        agreed: element("agreed-fee").value,
        received: element("received-fee").value,
        dueDate: element("payment-due-date").value,
      });
      render();
    } catch (error) { showError(error); }
  });

  element("detail-close-request").addEventListener("click", async () => {
    try {
      await TaskStore.close(taskId, workNote.value);
      clearActionNote();
      window.location.replace("/");
    } catch (error) { showError(error); }
  });

  element("cancel-task-button").addEventListener("click", () => {
    element("cancel-work-note").value = "";
    element("cancel-error").hidden = true;
    openModal(cancelModal);
  });
  document.querySelectorAll("[data-close-cancel]").forEach((button) => button.addEventListener("click", () => closeModal(cancelModal)));
  element("cancel-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!confirm("Cancel this task? Its history will be retained.")) return;
      await TaskStore.cancel(taskId, element("cancel-reason").value, element("cancel-work-note").value);
      closeModal(cancelModal);
      render();
    } catch (error) { showModalError("cancel-error", error); }
  });

  element("reopen-task-button").addEventListener("click", () => {
    if (!WorkflowAccess.can("reopenTask", task)) return;
    element("reopen-work-note").value = "";
    element("reopen-error").hidden = true;
    openModal(reopenModal);
  });
  document.querySelectorAll("[data-close-reopen]").forEach((button) => button.addEventListener("click", () => closeModal(reopenModal)));
  element("reopen-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await TaskStore.reopen(taskId, element("reopen-work-note").value);
      closeModal(reopenModal);
      render();
    } catch (error) { showModalError("reopen-error", error); }
  });

  render();
})();
