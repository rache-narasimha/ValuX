(function () {
  "use strict";

  const taskId = new URLSearchParams(window.location.search).get("task");
  const task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
  if (!task) return;

  const reportForm = document.querySelector("main form");
  if (!reportForm) return;

  const top = document.createElement("section");
  top.className = "report-task-context";
  top.innerHTML = `
    <div class="report-task-context__summary">
      <span class="report-task-context__eyebrow">Assignment ${WorkflowUI.escape(task.id)}</span>
      <strong>${WorkflowUI.escape(task.reportName)}</strong>
      <span id="report-task-status" class="status-badge"></span>
    </div>
    <form id="report-status-form" class="report-task-context__action">
      <label for="report-task-status-select">Status</label>
      <select id="report-task-status-select"></select>
      <label id="report-hold-reason-wrap" hidden>On-hold reason
        <select id="report-hold-reason"><option value="">Select reason</option><option>Awaiting documents</option><option>Site visit scheduled</option><option>Awaiting review</option><option>Custom</option></select>
      </label>
      <label id="report-hold-custom-wrap" hidden>Custom reason<input id="report-hold-custom" /></label>
      <label class="report-task-context__note" for="report-status-note">Work note <textarea id="report-status-note" placeholder="Required when the status changes"></textarea></label>
      <button type="submit" class="primary">Update status</button>
      <p id="report-status-error" class="report-task-context__error" role="alert" hidden></p>
    </form>
    <div class="report-task-context__links"><a id="back-to-assignment" href="/tasks/detail?id=${encodeURIComponent(task.id)}">Assignment details</a><a href="/">Work dashboard</a></div>`;
  document.querySelector("header").insertAdjacentElement("afterend", top);

  const bottom = document.createElement("section");
  bottom.className = "report-task-notes";
  bottom.innerHTML = `
    <div><h2>Work notes</h2><p>Add a progress or review note without changing the assignment status.</p></div>
    <form id="report-note-form"><label for="report-work-note">Add work note</label><textarea id="report-work-note" required placeholder="Record progress, ambiguity or review context"></textarea><button type="submit" class="secondary">Add work note</button></form>
    <div class="report-task-notes__links"><a href="/tasks/detail?id=${encodeURIComponent(task.id)}">Back to assignment details</a><a href="/">Back to work dashboard</a></div>`;
  reportForm.insertAdjacentElement("afterend", bottom);

  const statusSelect = document.getElementById("report-task-status-select");
  const statusBadge = document.getElementById("report-task-status");
  const error = document.getElementById("report-status-error");
  TaskStore.STATUSES.filter((status) => status !== "Cancelled").forEach((status) => statusSelect.add(new Option(status, status)));

  function currentTask() {
    return TaskStore.get(taskId);
  }

  function render() {
    const latest = currentTask();
    if (!latest) return;
    statusSelect.value = latest.status === "Cancelled" ? "Assigned" : latest.status;
    statusBadge.textContent = latest.status;
    statusBadge.className = `status-badge status-${latest.status.toLowerCase().replaceAll(" ", "-")}`;
    document.getElementById("report-hold-reason").value = latest.holdReason || "";
    refreshHoldFields();
  }

  function refreshHoldFields() {
    const isOnHold = statusSelect.value === "On Hold";
    const reason = document.getElementById("report-hold-reason");
    document.getElementById("report-hold-reason-wrap").hidden = !isOnHold;
    document.getElementById("report-hold-custom-wrap").hidden = !isOnHold || reason.value !== "Custom";
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  statusSelect.addEventListener("change", refreshHoldFields);
  document.getElementById("report-hold-reason").addEventListener("change", refreshHoldFields);
  document.getElementById("report-status-form").addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    const latest = currentTask();
    const note = document.getElementById("report-status-note");
    if (statusSelect.value === latest.status) return showError("Choose a different status to update the assignment.");
    if (!note.value.trim()) return showError("Add a work note for this status change.");
    let reason = "";
    if (statusSelect.value === "On Hold") {
      reason = document.getElementById("report-hold-reason").value;
      if (!reason) return showError("Select an on-hold reason.");
      if (reason === "Custom") {
        reason = document.getElementById("report-hold-custom").value.trim();
        if (!reason) return showError("Enter the custom hold reason.");
      }
    }
    TaskStore.updateStatus(taskId, statusSelect.value, note.value, reason);
    note.value = "";
    render();
  });
  document.getElementById("report-note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const note = document.getElementById("report-work-note");
    TaskStore.addNote(taskId, note.value);
    note.value = "";
  });

  render();
})();
