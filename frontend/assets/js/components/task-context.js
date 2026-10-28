/** Connects a valuation form to its assignment workflow, completion action, and work notes. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const taskId = params.get("task");
  const practiceMode = params.get("practice") === "1";
  const reportForm = document.querySelector("main form");
  if (!reportForm) return;

  // Practice mode intentionally does not create a task context.
  if (practiceMode && !taskId) {
    const banner = document.createElement("section");
    banner.className = "practice-banner";
    banner.innerHTML = `<div><strong>Practice mode</strong><span>Preview and generate test documents safely. Nothing is linked to an assignment.</span></div><a href="/practice">Back to practice forms</a>`;
    document.querySelector("header").insertAdjacentElement("afterend", banner);
    return;
  }

  let task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
  if (!task) return;
  if (!WorkflowAccess.can("openReport", task)) {
    alert("This report can be edited only after the task is assigned to you. Open assignment details to claim or transfer it first.");
    window.location.replace(`/tasks/detail?id=${encodeURIComponent(task.id)}`);
    return;
  }

  document.body.classList.add("report-linked");

  const top = document.createElement("section");
  top.className = "report-task-context report-task-context-compact";
  top.innerHTML = `<div class="report-task-context__summary">
      <span class="report-task-context__eyebrow">Assignment ${WorkflowUI.escape(task.id)}</span>
      <strong>${WorkflowUI.escape(task.reportName)}</strong>
      <span class="report-task-context__meta" id="report-task-meta"></span>
    </div>
    <div class="report-task-context__state"><span id="report-task-status" class="status-badge"></span></div>
    <div class="report-direct-actions">
      <button type="button" class="secondary" id="report-hold">Put on hold</button>
      <button type="button" class="secondary" id="report-resume" hidden>Resume work</button>
      <button type="button" class="secondary" id="report-add-note">Add note</button>
      <button type="button" class="primary" id="report-complete-top">Mark Completed</button>
    </div>
    <div class="report-task-context__links"><a href="/tasks/detail?id=${encodeURIComponent(task.id)}">Assignment details</a></div>`;
  document.querySelector("header").insertAdjacentElement("afterend", top);

  const bottom = document.createElement("section");
  bottom.className = "report-task-notes";
  bottom.innerHTML = `<div class="report-completion-heading"><div><h2>Work note</h2><p>Record progress, review context or completion details.</p></div><span id="generation-state" class="soft-badge">Report not generated</span></div>
    <form id="report-note-form"><label for="report-work-note">Work note</label><textarea id="report-work-note" placeholder="Add a clear update for this assignment"></textarea><div class="report-note-actions"><button type="submit" class="secondary">Add note</button><button type="button" class="secondary" id="view-report-history" aria-expanded="false">View history</button><button type="button" class="primary" id="complete-task">Mark Completed</button></div><p id="report-note-error" class="report-task-context__error" role="alert" hidden></p></form>
    <section id="report-history" class="report-inline-history" hidden><div class="compact-section-heading"><h3>Task history</h3><span id="report-history-count" class="soft-badge"></span></div><ol id="report-history-list" class="activity-list"></ol></section>
    <div class="report-task-notes__links"><a href="/tasks/detail?id=${encodeURIComponent(task.id)}">Back to assignment details</a><a href="/">Back to work dashboard</a></div>`;
  reportForm.insertAdjacentElement("afterend", bottom);

  const holdModal = document.createElement("div");
  holdModal.className = "workflow-modal";
  holdModal.id = "report-hold-modal";
  holdModal.hidden = true;
  holdModal.innerHTML = `<section class="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="report-hold-title">
    <div class="dialog-heading"><div><h2 id="report-hold-title">Put task on hold</h2><p>Select a reason and add the required work note.</p></div><button type="button" class="modal-x" data-close-report-hold aria-label="Close">×</button></div>
    <form id="report-hold-form" class="stack-form">
      <div class="field"><label for="report-hold-reason">On-hold reason</label><select id="report-hold-reason"></select></div>
      <div class="field"><label for="report-hold-note">Work note</label><textarea id="report-hold-note" placeholder="Explain what is awaited or what must happen next"></textarea></div>
      <p id="report-hold-error" class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button type="button" class="secondary" data-close-report-hold>Cancel</button><button type="submit" class="primary">Put on hold</button></div>
    </form>
  </section>`;
  document.body.append(holdModal);

  const statusBadge = document.getElementById("report-task-status");
  const noteError = document.getElementById("report-note-error");
  const workNote = document.getElementById("report-work-note");
  const holdReason = document.getElementById("report-hold-reason");
  TaskStore.HOLD_REASONS.forEach((item) => holdReason.add(new Option(item, item)));

  // Linked-task state and report-completion validation.
  function currentTask() {
    return TaskStore.get(taskId);
  }

  function requestWorkNote(message) {
    noteError.textContent = message;
    noteError.hidden = false;
    bottom.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => workNote.focus(), 350);
  }

  function completionBlockReason(current) {
    if (current.status === "On Hold") return "Resume work before marking this task Completed.";
    if (current.status !== "In Progress") return `A ${current.status} task cannot be marked Completed.`;
    if (!current.reportGeneratedAt) return "Generate the report successfully before marking this task Completed.";
    if (current.reportGroup === "estimation" && !TaskStore.hasFreshRequiredArtifact(current)) {
      return "Generate or attach the completed Excel report before marking this task Completed.";
    }
    if (current.reopenedAt && !TaskStore.hasFreshRequiredArtifact(current)) {
      return `Generate a new ${TaskStore.requiredArtifactLabel(current)} after reopening before marking this task Completed.`;
    }
    if (!WorkflowAccess.can("completeTask", current)) return "Only the assigned employee or CEO can complete this task.";
    return "";
  }

  function render() {
    task = currentTask();
    statusBadge.textContent = `Task: ${task.status}`;
    statusBadge.className = `status-badge ${WorkflowUI.statusClass(task.status)}`;
    document.getElementById("report-task-meta").textContent = `${task.assignee} · Due ${WorkflowUI.date(task.dueDate)}`;
    const canChange = WorkflowAccess.can("changeWorkflow", task);
    document.getElementById("report-hold").hidden = !canChange || task.status !== "In Progress";
    document.getElementById("report-resume").hidden = !canChange || task.status !== "On Hold";
    const generated = Boolean(task.reportGeneratedAt);
    document.getElementById("generation-state").textContent = generated ? `Generated ${WorkflowUI.date(task.reportGeneratedAt)}` : "Report not generated";
    const completionReason = completionBlockReason(task);
    [document.getElementById("complete-task"), document.getElementById("report-complete-top")].forEach((button) => {
      button.classList.toggle("is-unavailable", Boolean(completionReason));
      button.setAttribute("aria-disabled", String(Boolean(completionReason)));
      button.title = completionReason;
    });
    const activities = task.activity.slice().reverse();
    document.getElementById("report-history-count").textContent = `${activities.length} updates`;
    document.getElementById("report-history-list").innerHTML = activities.map((event) => `<li><span class="activity-dot activity-${WorkflowUI.escape(event.type)}"></span><div><p>${WorkflowUI.escape(event.text)}</p><small>${WorkflowUI.escape(event.author)} · ${WorkflowUI.date(event.createdAt)}</small></div></li>`).join("");
  }

  function completeTask() {
    noteError.hidden = true;
    const completionReason = completionBlockReason(currentTask());
    if (completionReason) {
      requestWorkNote(completionReason);
      return;
    }
    if (!workNote.value.trim()) {
      requestWorkNote("Add the completion work note, then select Mark Completed again.");
      return;
    }
    try {
      TaskStore.complete(taskId, workNote.value);
      window.location.replace("/");
    } catch (error) {
      requestWorkNote(error.message);
    }
  }

  function closeHoldModal() {
    holdModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  // Form and workflow event handlers.
  document.getElementById("report-hold").addEventListener("click", () => {
    document.getElementById("report-hold-note").value = "";
    document.getElementById("report-hold-error").hidden = true;
    holdModal.hidden = false;
    document.body.classList.add("modal-open");
  });
  holdModal.querySelectorAll("[data-close-report-hold]").forEach((button) => button.addEventListener("click", closeHoldModal));
  document.getElementById("report-hold-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const errorOutput = document.getElementById("report-hold-error");
    try {
      TaskStore.putOnHold(taskId, holdReason.value, document.getElementById("report-hold-note").value);
      closeHoldModal();
      render();
    } catch (error) {
      errorOutput.textContent = error.message;
      errorOutput.hidden = false;
    }
  });
  document.getElementById("report-resume").addEventListener("click", () => {
    noteError.hidden = true;
    try {
      TaskStore.resume(taskId);
      render();
    } catch (error) { requestWorkNote(error.message); }
  });
  document.getElementById("report-add-note").addEventListener("click", () => {
    bottom.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => workNote.focus(), 350);
  });
  document.getElementById("report-note-form").addEventListener("submit", (event) => {
    event.preventDefault();
    noteError.hidden = true;
    try {
      TaskStore.addNote(taskId, workNote.value);
      workNote.value = "";
    } catch (error) { requestWorkNote(error.message); }
  });
  document.getElementById("complete-task").addEventListener("click", completeTask);
  document.getElementById("report-complete-top").addEventListener("click", completeTask);
  document.getElementById("view-report-history").addEventListener("click", (event) => {
    const history = document.getElementById("report-history");
    history.hidden = !history.hidden;
    event.currentTarget.textContent = history.hidden ? "View history" : "Hide history";
    event.currentTarget.setAttribute("aria-expanded", String(!history.hidden));
  });
  window.addEventListener("sln:report-generated", (event) => {
    TaskStore.markReportGenerated(taskId, event.detail?.format || "report", {
      url: event.detail?.download || "",
      filename: event.detail?.filename || "",
      source: event.detail?.source || "",
      estimationSummary: event.detail?.estimationSummary || null,
      progressSummary: event.detail?.progressSummary || null,
    });
    render();
  });
  render();
})();
