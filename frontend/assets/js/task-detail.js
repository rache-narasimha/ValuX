(function () {
  "use strict";

  const taskId = new URLSearchParams(window.location.search).get("id");
  let task = TaskStore.get(taskId);
  const content = document.getElementById("task-content");
  const notFound = document.getElementById("task-not-found");

  if (!task) {
    notFound.hidden = false;
    return;
  }
  content.hidden = false;

  const workNote = document.getElementById("work-note");
  const actionError = document.getElementById("action-error");
  const assignmentForm = document.getElementById("assignment-form");
  const assigneeField = document.getElementById("new-assignee");
  const holdReason = document.getElementById("hold-reason");
  const cancelModal = document.getElementById("cancel-modal");
  const holdModal = document.getElementById("hold-modal");

  TaskStore.HOLD_REASONS.forEach((reason) => holdReason.add(new Option(reason, reason)));
  const cancelReason = document.getElementById("cancel-reason");
  cancelReason.add(new Option("Select reason", ""));
  TaskStore.CANCELLATION_REASONS.forEach((reason) => cancelReason.add(new Option(reason, reason)));

  function outstanding() {
    return Math.max(0, Number(task.payment.agreed || 0) - Number(task.payment.received || 0));
  }

  function showError(error) {
    actionError.textContent = error.message || String(error);
    actionError.hidden = false;
    document.getElementById("activity-card").scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => workNote.focus(), 350);
  }

  function clearActionNote() {
    workNote.value = "";
    actionError.hidden = true;
  }

  function configureAssignment() {
    const user = WorkflowAccess.currentUser();
    const canAssign = WorkflowAccess.can(task.status === "Unassigned" ? "assignUnassigned" : "transferTask", task);
    assignmentForm.hidden = !canAssign;
    if (!canAssign) return;
    assigneeField.innerHTML = "";
    if (user.role === "father" || task.assignee === user.name) {
      TaskStore.EMPLOYEES.forEach((employee) => assigneeField.add(new Option(employee === user.name ? `${employee} (me)` : employee, employee)));
    } else {
      assigneeField.add(new Option(`${user.name} (assign to me)`, user.name));
    }
    if (task.assignee && [...assigneeField.options].some((option) => option.value === task.assignee)) assigneeField.value = task.assignee;
    document.getElementById("assignment-action-title").textContent = task.status === "Unassigned" ? "Assign to" : "Transfer to";
    document.getElementById("assignment-help").textContent = task.status === "Unassigned"
      ? "Assignment immediately starts the task In Progress. Add an acknowledgement or routing justification below."
      : "The task remains In Progress after transfer. Explain the transfer in the work note below.";
  }

  function configureWorkflow() {
    const allowed = WorkflowAccess.can("changeWorkflow", task);
    document.getElementById("hold-task-button").hidden = !allowed || task.status !== "In Progress";
    document.getElementById("resume-task-button").hidden = !allowed || task.status !== "On Hold";
  }

  function configurePayment() {
    const canUpdate = WorkflowAccess.can("updatePayment", task);
    document.getElementById("payment-card").classList.toggle("is-disabled", !canUpdate);
    ["estimated-fee", "agreed-fee", "received-fee", "save-payment"].forEach((id) => { document.getElementById(id).disabled = !canUpdate; });
    const closeButton = document.getElementById("detail-close-request");
    closeButton.hidden = task.status === "Closed";
    closeButton.disabled = !WorkflowAccess.can("closeTask", task) || task.payment.status !== "Received" || outstanding() !== 0;
  }

  function render() {
    task = TaskStore.get(taskId);
    document.title = `${task.id} · SLN Property Reports`;
    document.getElementById("task-id").textContent = task.id;
    document.getElementById("task-name").textContent = task.reportName;
    document.getElementById("task-subtitle").textContent = `${task.institutionName}, ${task.branch}`;
    document.getElementById("task-badges").innerHTML = `<span class="status-badge ${WorkflowUI.statusClass(task.status)}">Task: ${WorkflowUI.escape(task.status)}</span><span class="soft-badge">${WorkflowUI.escape(task.priority)} priority</span><span class="soft-badge">${task.assignee ? `Assigned to ${WorkflowUI.escape(task.assignee)}` : "Unassigned"}</span><span class="payment-badge ${WorkflowUI.paymentClass(task.payment.status)}">Payment: ${WorkflowUI.escape(task.payment.status)}</span>`;
    document.getElementById("assignment-details").innerHTML = [
      ["Applicant / customer", task.customerName], ["Property", task.propertyBrief],
      ["Institution", `${task.institutionName} (${task.institutionType})`], ["Branch", task.branch],
      ["Report type", task.reportLabel], ["Assigned date", WorkflowUI.date(task.assignedDate)],
      ["Due date", WorkflowUI.date(task.dueDate)], ["On-hold reason", task.holdReason || "—"],
    ].map(([label, value]) => `<div><dt>${WorkflowUI.escape(label)}</dt><dd>${WorkflowUI.escape(value)}</dd></div>`).join("");

    const report = TaskStore.REPORTS[task.reportKey];
    const openReport = document.getElementById("open-report");
    const canOpen = report.route && WorkflowAccess.can("openReport", task);
    openReport.href = canOpen ? `${report.route}?task=${encodeURIComponent(task.id)}` : "#";
    openReport.textContent = !report.route ? "Report form pending" : task.status === "Unassigned" ? "Assign before opening report" : canOpen ? "Open report" : "Assigned employee only";
    openReport.classList.toggle("disabled-link", !canOpen);
    openReport.setAttribute("aria-disabled", String(!canOpen));

    document.getElementById("cancel-task-button").hidden = !WorkflowAccess.can("cancelTask", task);
    document.getElementById("estimated-fee").value = task.payment.estimated || "";
    document.getElementById("agreed-fee").value = task.payment.agreed || "";
    document.getElementById("received-fee").value = task.payment.received || "";
    document.getElementById("outstanding-fee").textContent = WorkflowUI.currency(outstanding());
    document.getElementById("payment-status").textContent = task.payment.status;
    document.getElementById("activity-list").innerHTML = task.activity.slice().reverse().map((event) => `<li><span class="activity-dot activity-${WorkflowUI.escape(event.type)}"></span><div><p>${WorkflowUI.escape(event.text)}</p><small>${WorkflowUI.escape(event.author)} · ${WorkflowUI.date(event.createdAt)}</small></div></li>`).join("");
    configureAssignment();
    configureWorkflow();
    configurePayment();
    document.getElementById("note-form").hidden = !WorkflowAccess.can("addNote", task);
  }

  document.getElementById("open-report").addEventListener("click", (event) => {
    if (event.currentTarget.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
  document.getElementById("note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try { TaskStore.addNote(taskId, workNote.value); clearActionNote(); render(); } catch (error) { showError(error); }
  });
  assignmentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (assigneeField.value === task.assignee) throw new Error("Select a different employee, or use another task action.");
      TaskStore.assign(taskId, assigneeField.value, workNote.value);
      clearActionNote();
      render();
    } catch (error) { showError(error); }
  });
  document.getElementById("hold-task-button").addEventListener("click", () => {
    document.getElementById("hold-work-note").value = "";
    document.getElementById("hold-error").hidden = true;
    holdModal.hidden = false;
    document.body.classList.add("modal-open");
  });
  document.querySelectorAll("[data-close-hold]").forEach((button) => button.addEventListener("click", () => {
    holdModal.hidden = true;
    document.body.classList.remove("modal-open");
  }));
  document.getElementById("hold-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const errorOutput = document.getElementById("hold-error");
    try {
      TaskStore.putOnHold(taskId, holdReason.value, document.getElementById("hold-work-note").value);
      holdModal.hidden = true;
      document.body.classList.remove("modal-open");
      render();
    } catch (error) {
      errorOutput.textContent = error.message;
      errorOutput.hidden = false;
    }
  });
  document.getElementById("resume-task-button").addEventListener("click", () => {
    try {
      TaskStore.resume(taskId, workNote.value);
      clearActionNote();
      render();
    } catch (error) { showError(error); }
  });
  document.getElementById("payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      TaskStore.updatePayment(taskId, { estimated: document.getElementById("estimated-fee").value, agreed: document.getElementById("agreed-fee").value, received: document.getElementById("received-fee").value });
      render();
    } catch (error) { showError(error); }
  });
  document.getElementById("detail-close-request").addEventListener("click", () => {
    try { TaskStore.close(taskId, workNote.value); clearActionNote(); render(); } catch (error) { showError(error); }
  });
  document.getElementById("cancel-task-button").addEventListener("click", () => { cancelModal.hidden = false; document.body.classList.add("modal-open"); });
  document.querySelectorAll("[data-close-cancel]").forEach((button) => button.addEventListener("click", () => { cancelModal.hidden = true; document.body.classList.remove("modal-open"); }));
  document.getElementById("cancel-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (!confirm("Cancel this task? Its history will be retained.")) return;
      TaskStore.cancel(taskId, cancelReason.value, workNote.value);
      cancelModal.hidden = true;
      document.body.classList.remove("modal-open");
      clearActionNote();
      render();
    } catch (error) { cancelModal.hidden = true; document.body.classList.remove("modal-open"); showError(error); }
  });

  render();
})();
