/** Searchable task-list and institution drill-down controller. */
(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const list = document.getElementById("task-list");
  const loadMore = document.getElementById("load-more");
  const fields = {
    search: document.getElementById("task-search"),
    group: document.getElementById("group-filter"),
    institution: document.getElementById("institution-filter"),
    period: document.getElementById("period-filter"),
    status: document.getElementById("status-filter"),
    assignee: document.getElementById("assignee-filter"),
    holdReason: document.getElementById("hold-filter"),
    payment: document.getElementById("payment-filter"),
  };
  let visible = PAGE_SIZE;
  let periodReference = new Date();
  let directoryMode = false;
  const GROUP_LABELS = {
    all: "All work",
    valuation: "Valuation",
    estimation: "Estimation",
    progress: "Progress",
    completion: "Completion",
  };

  const storage = TaskStore.storageStatus();
  if (!storage.ok) {
    WorkflowUI.fatal(storage.error);
    list.innerHTML = WorkflowUI.empty("Tasks cannot be shown until the local data issue is resolved.");
    loadMore.hidden = true;
    return;
  }

  // Filter state, query construction, and task-row rendering.
  function populateFilters() {
    TaskStore.STATUSES.forEach((item) => fields.status.add(new Option(item, item)));
    Object.entries(window.INSTITUTIONS).forEach(([type, institutions]) => {
      const group = document.createElement("optgroup");
      group.label = type === "Bank" ? "Banks" : "NBFCs";
      institutions.forEach((institution) => group.append(new Option(`${institution.code} — ${institution.name}`, institution.code)));
      fields.institution.append(group);
    });
    const initial = new URLSearchParams(window.location.search);
    directoryMode = initial.get("view") === "institutions";
    if (initial.get("periodReference")) periodReference = new Date(`${initial.get("periodReference")}T00:00:00`);
    fields.group.value = initial.get("group") || "all";
    fields.institution.value = initial.get("institution") || "";
    fields.period.value = initial.get("period") || "";
    fields.status.value = initial.get("status") || "";
    fields.assignee.value = initial.get("assignee") || "";
    fields.holdReason.value = initial.get("holdReason") || "";
    fields.payment.value = initial.get("payment") || "";
    fields.search.value = initial.get("search") || "";
  }

  function queryOptions(limit = visible) {
    return Object.fromEntries([
      ["group", fields.group.value], ["institution", fields.institution.value],
      ["period", fields.period.value], ["status", fields.status.value],
      ["assignee", fields.assignee.value], ["holdReason", fields.holdReason.value],
      ["payment", fields.payment.value], ["search", fields.search.value], ["limit", limit],
      ["periodReference", periodReference],
    ]);
  }

  function exportSubtitle() {
    const parts = [];
    if (fields.group.value !== "all") parts.push(`Report section: ${GROUP_LABELS[fields.group.value]}`);
    if (fields.institution.value) parts.push(`Institution: ${fields.institution.options[fields.institution.selectedIndex]?.textContent || fields.institution.value}`);
    if (fields.period.value) parts.push(`Assigned during: ${fields.period.options[fields.period.selectedIndex].textContent}`);
    if (fields.status.value) parts.push(`Status: ${fields.status.value}`);
    if (fields.assignee.value) parts.push(`Assigned to: ${fields.assignee.value}`);
    if (fields.holdReason.value) parts.push(`On hold: ${fields.holdReason.value}`);
    if (fields.payment.value) parts.push(`Payment: ${fields.payment.value}`);
    if (fields.search.value.trim()) parts.push(`Search: ${fields.search.value.trim()}`);
    return parts.length ? parts.join(" · ") : "All assignments visible to the signed-in user";
  }

  function taskExportOptions() {
    const tasks = TaskStore.query(queryOptions(Number.MAX_SAFE_INTEGER)).items;
    return {
      title: "ValuX assignments",
      subtitle: exportSubtitle(),
      sheetName: "Assignments",
      fileName: "ValuX_Assignments.xlsx",
      columns: [
        { key: "taskId", label: "Task ID" }, { key: "applicant", label: "Applicant / customer" },
        { key: "report", label: "Report type" }, { key: "property", label: "Property" },
        { key: "institution", label: "Institution" }, { key: "branch", label: "Branch" },
        { key: "assignee", label: "Assigned to" }, { key: "assignedDate", label: "Assigned date", type: "date" },
        { key: "dueDate", label: "Due date", type: "date" }, { key: "status", label: "Status" },
        { key: "holdReason", label: "On-hold reason" }, { key: "paymentStatus", label: "Payment status" },
        { key: "fee", label: "Agreed / estimated fee (Rs.)", type: "currency" },
        { key: "received", label: "Received (Rs.)", type: "currency" },
        { key: "outstanding", label: "Outstanding (Rs.)", type: "currency" },
      ],
      rows: tasks.map((task) => {
        const payment = TaskStore.paymentSummary(task);
        return {
          taskId: task.id, applicant: task.customerName, report: task.reportLabel, property: task.propertyBrief,
          institution: task.institutionName, branch: task.branch, assignee: task.assignee || "Unassigned",
          assignedDate: task.assignedDate, dueDate: task.dueDate, status: task.status, holdReason: task.holdReason || "",
          paymentStatus: payment.status, fee: payment.basis, received: task.payment.received || 0, outstanding: payment.outstanding,
        };
      }),
    };
  }

  function institutionExportOptions() {
    const allTasks = TaskStore.all().filter(WorkflowAccess.visible);
    const rows = InstitutionMetrics.configured().map((institution) => {
      const tasks = allTasks.filter((task) => task.institutionCode === institution.code);
      const billable = tasks.filter((task) => task.status !== "Cancelled");
      return {
        code: institution.code, institution: institution.name, type: institution.type, total: tasks.length,
        unassigned: tasks.filter((task) => task.status === "Unassigned").length,
        inProgress: tasks.filter((task) => task.status === "In Progress").length,
        onHold: tasks.filter((task) => task.status === "On Hold").length,
        completed: tasks.filter((task) => task.status === "Completed").length,
        closed: tasks.filter((task) => task.status === "Closed").length,
        earned: billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).basis || 0), 0),
        received: billable.reduce((sum, task) => sum + Number(task.payment.received || 0), 0),
        outstanding: billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).outstanding || 0), 0),
      };
    });
    return {
      title: "ValuX institution overview", subtitle: "Configured banks and NBFCs · all visible assignments",
      sheetName: "Institutions", fileName: "ValuX_Institutions.xlsx",
      columns: [
        { key: "code", label: "Code" }, { key: "institution", label: "Institution" }, { key: "type", label: "Type" },
        { key: "total", label: "Total assignments", type: "integer" }, { key: "unassigned", label: "Unassigned", type: "integer" },
        { key: "inProgress", label: "In progress", type: "integer" }, { key: "onHold", label: "On hold", type: "integer" },
        { key: "completed", label: "Completed", type: "integer" }, { key: "closed", label: "Closed", type: "integer" },
        { key: "earned", label: "Income earned (Rs.)", type: "currency" }, { key: "received", label: "Payment received (Rs.)", type: "currency" },
        { key: "outstanding", label: "Outstanding (Rs.)", type: "currency" },
      ], rows,
    };
  }

  function renderRows(tasks) {
    if (!tasks.length) return WorkflowUI.empty("No assignments match the selected search and filters.");
    if (fields.status.value !== "On Hold" || WorkflowAccess.currentRole() !== "father") {
      return tasks.map((task) => WorkflowUI.taskRow(task, { variant: "table" })).join("");
    }
    const review = tasks.filter((task) => task.holdReason === "Awaiting Review");
    const other = tasks.filter((task) => task.holdReason !== "Awaiting Review");
    return `${review.length ? `<section class="task-list-group"><div class="task-list-group-heading"><h3>Awaiting my review</h3><span>${review.length}</span></div>${review.map((task) => WorkflowUI.taskRow(task, { variant: "table" })).join("")}</section>` : ""}
      ${other.length ? `<section class="task-list-group"><div class="task-list-group-heading"><h3>Other on-hold tasks</h3><span>${other.length}</span></div>${other.map((task) => WorkflowUI.taskRow(task, { variant: "table" })).join("")}</section>` : ""}`;
  }

  function selectedInstitution() {
    return InstitutionMetrics.configured().find((institution) => institution.code === fields.institution.value);
  }

  // Institution drill-down and all-institutions directory rendering.
  function renderInstitutionDrilldown() {
    const institution = selectedInstitution();
    const host = document.getElementById("institution-drilldown");
    host.hidden = !institution;
    if (!institution) return;
    const tasks = TaskStore.query({
      group: fields.group.value,
      institution: institution.code,
      period: fields.period.value,
      periodReference,
      limit: Number.MAX_SAFE_INTEGER,
    }).items;
    const mix = InstitutionMetrics.workflowMix(tasks);
    const maximum = Math.max(1, ...mix.map((item) => item.count));
    document.getElementById("institution-drilldown-title").textContent = `${institution.code} · ${institution.name}`;
    document.getElementById("institution-monogram").textContent = institution.code.slice(0, 4);
    document.getElementById("institution-monogram").style.setProperty("--institution-color", institution.color);
    document.getElementById("institution-drilldown-subtitle").textContent = fields.period.value
      ? `${tasks.length} assignments · ${InstitutionMetrics.periodLabel(fields.period.value, periodReference)}`
      : `${tasks.length} assignments · all dates`;
    document.getElementById("institution-workflow-mix").innerHTML = mix.map((item) => {
      const width = item.count ? Math.max(5, Math.round((item.count / maximum) * 100)) : 0;
      return `<button type="button" data-workflow-state="${WorkflowUI.escape(item.key)}"${item.count ? "" : " disabled"}>
        <span>${WorkflowUI.escape(item.label)}</span><i><b style="--width:${width}%;--state-color:${item.color}"></b></i><strong>${item.count}</strong>
      </button>`;
    }).join("");
    const billable = tasks.filter((task) => task.status !== "Cancelled");
    const earned = billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).basis || 0), 0);
    const received = billable.reduce((sum, task) => sum + Number(task.payment.received || 0), 0);
    const outstanding = billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).outstanding || 0), 0);
    const percent = (value) => earned ? `${Math.round((value / earned) * 100)}%` : "0%";
    document.getElementById("institution-total").textContent = tasks.length;
    document.getElementById("institution-earned").textContent = WorkflowUI.currency(earned);
    document.getElementById("institution-earned-count").textContent = `${billable.length} ${billable.length === 1 ? "report" : "reports"}`;
    document.getElementById("institution-received").textContent = WorkflowUI.currency(received);
    document.getElementById("institution-received-percent").textContent = percent(received);
    document.getElementById("institution-outstanding").textContent = WorkflowUI.currency(outstanding);
    document.getElementById("institution-outstanding-percent").textContent = percent(outstanding);
    document.querySelectorAll("[data-workflow-state]").forEach((button) => button.addEventListener("click", () => {
      fields.status.value = button.dataset.workflowState;
      reset();
      document.querySelector(".task-list-card").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function renderInstitutionDirectory() {
    const host = document.getElementById("institution-directory");
    host.hidden = !directoryMode || Boolean(selectedInstitution());
    if (host.hidden) return;
    const allTasks = TaskStore.all().filter(WorkflowAccess.visible);
    document.getElementById("institution-directory-list").innerHTML = InstitutionMetrics.configured().map((institution) => {
      const institutionTasks = allTasks.filter((task) => task.institutionCode === institution.code);
      const inProgress = institutionTasks.filter((task) => task.status === "In Progress").length;
      const onHold = institutionTasks.filter((task) => task.status === "On Hold").length;
      const outstanding = institutionTasks.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).outstanding || 0), 0);
      return `<a class="institution-directory-row" href="/tasks?institution=${encodeURIComponent(institution.code)}&period=monthly"><span class="institution-monogram" style="--institution-color:${WorkflowUI.escape(institution.color)}">${WorkflowUI.escape(institution.code.slice(0, 4))}</span><span><strong>${WorkflowUI.escape(institution.code)} · ${WorkflowUI.escape(institution.name)}</strong><small>${WorkflowUI.escape(institution.type)}</small></span><span><small>Total</small><strong>${institutionTasks.length}</strong></span><span><small>In progress</small><strong>${inProgress}</strong></span><span><small>On hold</small><strong>${onHold}</strong></span><span><small>Outstanding</small><strong>${WorkflowUI.currency(outstanding)}</strong></span><b aria-hidden="true">›</b></a>`;
    }).join("");
  }

  function renderContext() {
    const label = GROUP_LABELS[fields.group.value] || GROUP_LABELS.all;
    const institution = selectedInstitution();
    document.getElementById("task-list-title").textContent = institution
      ? `${label} · ${institution.code} tasks`
      : `${label} tasks`;
    document.getElementById("task-list-description").textContent = institution
      ? `Showing ${fields.group.value === "all" ? "all report types" : label.toLowerCase()} for ${institution.name}. Change any filter below when required.`
      : `Search and filter ${label.toLowerCase()} assignments.`;
    if (directoryMode && !institution) {
      document.getElementById("task-list-title").textContent = "Institutions";
      document.getElementById("task-list-description").textContent = "Review workload and payment position across every configured bank and NBFC.";
    }
  }

  // Page render cycle, URL synchronization, and event wiring.
  function updateUrl() {
    const params = new URLSearchParams();
    if (directoryMode && !selectedInstitution()) params.set("view", "institutions");
    if (fields.group.value !== "all") params.set("group", fields.group.value);
    if (fields.period.value) params.set("periodReference", periodReference.toISOString().slice(0, 10));
    ["institution", "period", "status", "assignee", "holdReason", "payment"].forEach((key) => {
      if (fields[key].value) params.set(key, fields[key].value);
    });
    if (fields.search.value.trim()) params.set("search", fields.search.value.trim());
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function render() {
    const result = TaskStore.query(queryOptions());
    list.innerHTML = renderRows(result.items);
    document.getElementById("result-count").textContent = `${result.total} ${result.total === 1 ? "task" : "tasks"}`;
    loadMore.hidden = !result.hasMore;
    renderContext();
    renderInstitutionDrilldown();
    renderInstitutionDirectory();
    document.querySelector(".task-list-card").hidden = directoryMode && !selectedInstitution();
    document.getElementById("task-filters").hidden = directoryMode && !selectedInstitution();
    updateUrl();
  }

  function reset() {
    visible = PAGE_SIZE;
    render();
  }

  populateFilters();
  Object.entries(fields).forEach(([key, field]) => field.addEventListener(key === "search" ? "input" : "change", reset));
  document.getElementById("clear-institution").addEventListener("click", () => { window.location.href = "/tasks?view=institutions"; });
  loadMore.addEventListener("click", () => { visible += PAGE_SIZE; render(); });
  document.getElementById("export-tasks").addEventListener("click", (event) => WorkbookExport.fromButton(event.currentTarget, taskExportOptions()));
  const institutionExport = document.getElementById("export-institutions");
  institutionExport.hidden = WorkflowAccess.currentRole() !== "father";
  institutionExport.addEventListener("click", (event) => WorkbookExport.fromButton(event.currentTarget, institutionExportOptions()));
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  render();
})();
