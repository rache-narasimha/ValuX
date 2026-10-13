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

  const statusField = document.getElementById("task-status");
  TaskStore.STATUSES.filter((item) => item !== "Cancelled").forEach((item) => statusField.add(new Option(item, item)));

  function paymentOutstanding() {
    return Math.max(0, (Number(task.payment.agreed) || 0) - (Number(task.payment.received) || 0));
  }

  function render() {
    task = TaskStore.get(taskId);
    document.title = `${task.id} · SLN Property Reports`;
    document.getElementById("task-id").textContent = task.id;
    document.getElementById("task-name").textContent = task.reportName;
    document.getElementById("task-subtitle").textContent = `${task.institutionName}, ${task.branch}`;
    document.getElementById("task-badges").innerHTML = `<span class="status-badge status-${task.status.toLowerCase().replaceAll(" ", "-")}">${WorkflowUI.escape(task.status)}</span><span class="soft-badge">${WorkflowUI.escape(task.priority)} priority</span><span class="soft-badge">Assigned to ${WorkflowUI.escape(task.assignee)}</span>`;
    document.getElementById("assignment-details").innerHTML = [
      ["Applicant / customer", task.customerName],
      ["Property", task.propertyBrief],
      ["Institution", `${task.institutionName} (${task.institutionType})`],
      ["Branch", task.branch],
      ["Report type", task.reportLabel],
      ["Assigned date", WorkflowUI.date(task.assignedDate)],
      ["Due date", WorkflowUI.date(task.dueDate)],
      ["On-hold reason", task.holdReason || "—"],
    ].map(([label, value]) => `<div><dt>${WorkflowUI.escape(label)}</dt><dd>${WorkflowUI.escape(value)}</dd></div>`).join("");

    const report = TaskStore.REPORTS[task.reportKey];
    const openReport = document.getElementById("open-report");
    if (report.route) {
      openReport.href = `${report.route}?task=${encodeURIComponent(task.id)}`;
      openReport.textContent = "Open report";
      openReport.classList.remove("disabled-link");
      openReport.removeAttribute("aria-disabled");
    } else {
      openReport.href = "#";
      openReport.textContent = "Report form pending";
      openReport.classList.add("disabled-link");
      openReport.setAttribute("aria-disabled", "true");
    }

    statusField.value = task.status === "Cancelled" ? "Assigned" : task.status;
    document.getElementById("hold-reason").value = task.holdReason || "";
    document.getElementById("new-assignee").value = task.assignee;
    document.getElementById("estimated-fee").value = task.payment.estimated || "";
    document.getElementById("agreed-fee").value = task.payment.agreed || "";
    document.getElementById("received-fee").value = task.payment.received || "";
    document.getElementById("outstanding-fee").textContent = WorkflowUI.currency(paymentOutstanding());
    document.getElementById("payment-status").textContent = task.payment.status;
    document.getElementById("activity-list").innerHTML = task.activity.slice().reverse().map((event) => `<li><span class="activity-dot activity-${WorkflowUI.escape(event.type)}"></span><div><p>${WorkflowUI.escape(event.text)}</p><small>${WorkflowUI.escape(event.author)} · ${WorkflowUI.date(event.createdAt)}</small></div></li>`).join("");
    refreshHoldFields();
  }

  function refreshHoldFields() {
    const isHold = statusField.value === "On Hold";
    document.getElementById("hold-reason-wrap").hidden = !isHold;
    document.getElementById("hold-custom-wrap").hidden = !isHold || document.getElementById("hold-reason").value !== "Custom";
  }

  statusField.addEventListener("change", refreshHoldFields);
  document.getElementById("hold-reason").addEventListener("change", refreshHoldFields);
  document.getElementById("open-report").addEventListener("click", (event) => {
    if (event.currentTarget.getAttribute("aria-disabled") === "true") event.preventDefault();
  });

  document.getElementById("note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const note = document.getElementById("work-note");
    TaskStore.addNote(taskId, note.value);
    note.value = "";
    render();
  });

  document.getElementById("status-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const note = document.getElementById("status-note");
    if (["On Hold", "Awaiting Review", "Returned for Correction"].includes(statusField.value) && !note.value.trim()) {
      return alert("Add a work note for this status change.");
    }
    let reason = "";
    if (statusField.value === "On Hold") {
      reason = document.getElementById("hold-reason").value;
      if (!reason) return alert("Select an on-hold reason.");
      if (reason === "Custom") {
        reason = document.getElementById("hold-custom").value.trim();
        if (!reason) return alert("Enter the custom hold reason.");
      }
    }
    TaskStore.updateStatus(taskId, statusField.value, note.value, reason);
    note.value = "";
    render();
  });

  document.getElementById("reassign-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const assignee = document.getElementById("new-assignee").value;
    const note = document.getElementById("reassign-note");
    if (assignee === task.assignee) return alert("Select a different assignee.");
    TaskStore.reassign(taskId, assignee, note.value);
    note.value = "";
    render();
  });

  document.getElementById("payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    TaskStore.updatePayment(taskId, {
      estimated: document.getElementById("estimated-fee").value,
      agreed: document.getElementById("agreed-fee").value,
      received: document.getElementById("received-fee").value,
    });
    render();
  });

  document.getElementById("cancel-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const reason = document.getElementById("cancel-reason");
    if (!confirm("Cancel this task? Its history will be retained.")) return;
    TaskStore.cancel(taskId, reason.value);
    reason.value = "";
    render();
  });

  render();
})();
