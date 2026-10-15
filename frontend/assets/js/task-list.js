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

  function populateFilters() {
    TaskStore.STATUSES.forEach((item) => fields.status.add(new Option(item, item)));
    Object.entries(window.INSTITUTIONS).forEach(([type, institutions]) => {
      const group = document.createElement("optgroup");
      group.label = type === "Bank" ? "Banks" : "NBFCs";
      institutions.forEach((institution) => group.append(new Option(`${institution.code} — ${institution.name}`, institution.code)));
      fields.institution.append(group);
    });
    const initial = new URLSearchParams(window.location.search);
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

  function renderRows(tasks) {
    if (!tasks.length) return WorkflowUI.empty("No assignments match the selected search and filters.");
    if (fields.status.value !== "On Hold" || WorkflowAccess.currentRole() !== "father") {
      return tasks.map((task) => WorkflowUI.taskRow(task)).join("");
    }
    const review = tasks.filter((task) => task.holdReason === "Awaiting Review");
    const other = tasks.filter((task) => task.holdReason !== "Awaiting Review");
    return `${review.length ? `<section class="task-list-group"><div class="task-list-group-heading"><h3>Awaiting my review</h3><span>${review.length}</span></div>${review.map((task) => WorkflowUI.taskRow(task)).join("")}</section>` : ""}
      ${other.length ? `<section class="task-list-group"><div class="task-list-group-heading"><h3>Other on-hold tasks</h3><span>${other.length}</span></div>${other.map((task) => WorkflowUI.taskRow(task)).join("")}</section>` : ""}`;
  }

  function selectedInstitution() {
    return InstitutionMetrics.configured().find((institution) => institution.code === fields.institution.value);
  }

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
    document.getElementById("institution-drilldown-subtitle").textContent = fields.period.value
      ? `${tasks.length} assignments · ${InstitutionMetrics.periodLabel(fields.period.value, periodReference)}`
      : `${tasks.length} assignments · all dates`;
    document.getElementById("institution-workflow-mix").innerHTML = mix.map((item) => {
      const width = item.count ? Math.max(5, Math.round((item.count / maximum) * 100)) : 0;
      return `<button type="button" data-workflow-state="${WorkflowUI.escape(item.key)}"${item.count ? "" : " disabled"}>
        <span>${WorkflowUI.escape(item.label)}</span><i><b style="--width:${width}%;--state-color:${item.color}"></b></i><strong>${item.count}</strong>
      </button>`;
    }).join("");
    document.querySelectorAll("[data-workflow-state]").forEach((button) => button.addEventListener("click", () => {
      fields.status.value = button.dataset.workflowState;
      reset();
      document.querySelector(".task-list-card").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
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
  }

  function updateUrl() {
    const params = new URLSearchParams();
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
    updateUrl();
  }

  function reset() {
    visible = PAGE_SIZE;
    render();
  }

  populateFilters();
  Object.entries(fields).forEach(([key, field]) => field.addEventListener(key === "search" ? "input" : "change", reset));
  document.getElementById("clear-institution").addEventListener("click", () => { fields.institution.value = ""; reset(); });
  loadMore.addEventListener("click", () => { visible += PAGE_SIZE; render(); });
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  render();
})();
