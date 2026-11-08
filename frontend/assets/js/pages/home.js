/** Dashboard controller: status summaries, institution workload, finance charts, and recent work. */
(function () {
  "use strict";

  const descriptions = {
    all: "An overview of valuation and construction reporting, from assignment progress to fees and payments.",
    valuation: "General and agricultural property valuation assignments.",
    revaluation: "Re-Valuation assignments linked to completed or closed valuations.",
    estimation: "Detailed building estimate assignments.",
    progress: "Construction progress assessment assignments.",
    completion: "Completion report assignments.",
  };
  let selectedGroup = "all";
  let selectedWorkloadPeriod = "monthly";
  let selectedWorkloadReference = ValuxTime.todayDate();
  let selectedFinanceInstitution = "";

  const storage = TaskStore.storageStatus();
  if (!storage.ok) {
    WorkflowUI.fatal(storage.error);
    return;
  }

  // Shared dashboard data access and rendering helpers.
  function setText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function allVisibleTasks() {
    return TaskStore.all().filter(WorkflowAccess.visible);
  }

  function groupTasks() {
    return allVisibleTasks().filter((task) => selectedGroup === "all" || task.reportGroup === selectedGroup);
  }

  function buildQuery(values = {}) {
    const params = new URLSearchParams(values);
    if (selectedGroup !== "all" && !params.has("group")) params.set("group", selectedGroup);
    if (values.period) params.set("periodReference", isoDate(selectedWorkloadReference));
    return `/tasks${params.size ? `?${params}` : ""}`;
  }

  function isoDate(value) {
    return ValuxTime.isoDate(value);
  }

  function renderRows(hostId, tasks, emptyMessage) {
    document.getElementById(hostId).innerHTML = tasks.length
      ? tasks.map((task) => WorkflowUI.taskRow(task)).join("")
      : WorkflowUI.empty(emptyMessage);
  }

  // Static presentation icons; report keys and drill-down targets stay unchanged.
  function chartIcon(name) {
    const paths = {
      bank: '<path d="m3 8 9-5 9 5M4 9h16M6 10v8m6-8v8m6-8v8M3 21h18M4 18h16"/>',
      nbfc: '<path d="M5 21V5h10v16M15 10h4v11M3 21h18M8 8h1m2 0h1M8 12h1m2 0h1M8 16h1m2 0h1"/>',
      institutions: '<path d="M3 21V9l6-3v15M9 21V3h8v18M17 12h4v9M1 21h22M12 7h2m-2 4h2m-2 4h2M5 12h1m-1 4h1"/>',
      valuation: '<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h7"/>',
      estimation: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 18h1m3 0h1m3 0h.1"/>',
      progress: '<path d="M4 20V4M4 20h17M7 15l4-5 4 3 5-7M16 6h4v4"/>',
      completion: '<path d="M6 3h9l4 4v14H6zM15 3v5h4m-9 6 2 2 4-4"/>',
    };
    return `<svg class="dashboard-chart-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.valuation}</svg>`;
  }

  function legendHeading() {
    return '<div class="distribution-legend-heading" aria-hidden="true"><span></span><span></span><span>Count</span><span>%</span></div>';
  }

  function chartGroups(entries, renderer) {
    return ["Bank", "NBFC"].map((type) => {
      const group = entries.filter((entry) => entry.type === type);
      return `<section class="data-chart-card"><h3>${chartIcon(type === "Bank" ? "bank" : "nbfc")}${type === "Bank" ? "Banks" : "NBFCs"} <small>(${group.length})</small></h3>${renderer(group, type)}</section>`;
    }).join("");
  }

  function renderWorkload(tasks) {
    const entries = InstitutionMetrics.workload(tasks, selectedWorkloadPeriod, selectedWorkloadReference);
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    document.getElementById("workload-overall-total").textContent = `Selected Period Total: ${entries.reduce((sum, entry) => sum + entry.count, 0)} reports`;
    document.getElementById("workload-overall-total").href = buildQuery({ view: "summary", period: selectedWorkloadPeriod });
    document.getElementById("institution-workload").innerHTML = chartGroups(entries, (group, type) => `<div class="horizontal-chart workload-chart">
      ${group.map((entry) => {
        const width = entry.count ? Math.max(8, Math.round((entry.count / maximum) * 100)) : 0;
        const href = buildQuery({ institution: entry.code, period: selectedWorkloadPeriod });
        return `<a class="horizontal-chart-row" href="${href}" title="${WorkflowUI.escape(entry.name)}: ${entry.count} reports" aria-label="View ${WorkflowUI.escape(entry.name)} tasks">
          <strong>${WorkflowUI.escape(entry.code)}</strong>
          <span class="horizontal-track"><i style="--width:${width}%;--chart-color:${WorkflowUI.chartColor(entry)}"></i></span>
          <span class="chart-value">${entry.count}</span>
        </a>`;
      }).join("")}
    </div><a class="chart-total" href="${buildQuery({ view: "summary", institution: `type:${type}`, period: selectedWorkloadPeriod })}" aria-label="View all ${type === "Bank" ? "bank" : "NBFC"} tasks">Total: <strong>${group.reduce((sum, entry) => sum + entry.count, 0)} reports</strong></a>${type === "NBFC" ? institutionTotals(entries) : ""}`);
    setText("workload-period-label", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
    return entries;
  }

  function institutionTotals(entries) {
    const banks = entries.filter((entry) => entry.type === "Bank").length;
    const nbfcs = entries.filter((entry) => entry.type === "NBFC").length;
    return `<section class="institution-totals" aria-label="Total configured institutions"><h4>${chartIcon("institutions")}Total Institutions</h4><div class="institution-counts"><div><strong data-institution-count="Bank">${banks}</strong><span>Banks</span></div><div><strong data-institution-count="NBFC">${nbfcs}</strong><span>NBFCs</span></div></div><p><strong data-institution-count="all">${banks + nbfcs}</strong> in total</p></section>`;
  }

  function renderInstitutionDistribution(workload) {
    const entries = [
      {type: "Bank", label: "Banks", color: "#087ea4"},
      {type: "NBFC", label: "NBFCs", color: "#d59024"},
    ].map((entry) => ({...entry, count: workload.filter((row) => row.type === entry.type).reduce((sum, row) => sum + row.count, 0)}));
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    document.getElementById("institution-workload-chart").innerHTML = ring(
      entries.map((entry) => ({value: entry.count, color: entry.color})), total, total, total ? "Assignments" : "No assignments", true,
    ) + `<div class="distribution-legend">${legendHeading()}${entries.map((entry) => `<a href="${buildQuery({view: "summary", institution: `type:${entry.type}`, period: selectedWorkloadPeriod})}" data-institution-type="${entry.type}"><i style="--state-color:${entry.color}"></i><span>${entry.label}</span><strong>${entry.count}</strong><small>${percent(entry.count, total)}%</small></a>`).join("")}</div>`;
  }

  function percent(value, total) { return total > 0 ? Math.round(value / total * 100) : 0; }

  function ring(segments, total, label, caption, small = false) {
    const radius = 42;
    let offset = 0;
    const arcs = segments.filter((entry) => entry.value > 0).map((entry) => {
      const fraction = entry.value / total;
      if (fraction >= 1) return `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="${entry.color}" stroke-width="12"/>`;
      const start = offset * 2 * Math.PI - Math.PI / 2;
      offset += fraction;
      const end = offset * 2 * Math.PI - Math.PI / 2;
      const point = (angle) => `${50 + radius * Math.cos(angle)} ${50 + radius * Math.sin(angle)}`;
      return `<path d="M ${point(start)} A ${radius} ${radius} 0 ${fraction > .5 ? 1 : 0} 1 ${point(end)}" fill="none" stroke="${entry.color}" stroke-width="12" stroke-linecap="butt"/>`;
    }).join("");
    return `<div class="dashboard-ring${small ? " dashboard-ring-small" : ""}" role="img" aria-label="${WorkflowUI.escape(label + " " + caption)}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" stroke-width="12"/>${arcs}</svg><div><strong>${WorkflowUI.escape(label)}</strong><span>${WorkflowUI.escape(caption)}</span></div></div>`;
  }

  // The summary selector scopes the retained financial totals.
  function renderFinance(tasks) {
    const entries = InstitutionMetrics.finance(tasks, selectedWorkloadPeriod, selectedWorkloadReference);
    const selector = document.getElementById("finance-institution-select");
    selector.innerHTML = `<option value="">All institutions</option>${["Bank", "NBFC"].map((type) => `<optgroup label="${type === "Bank" ? "Banks" : "NBFCs"}">${entries.filter((entry) => entry.type === type).map((entry) => `<option value="${WorkflowUI.escape(entry.code)}">${WorkflowUI.escape(entry.code)} · ${WorkflowUI.escape(entry.name)}</option>`).join("")}</optgroup>`).join("")}`;
    selector.value = selectedFinanceInstitution;
    const selected = entries.find((entry) => entry.code === selectedFinanceInstitution);
    const summary = (selected ? [selected] : entries).reduce((total, entry) => ({earned: total.earned + entry.earned, received: total.received + entry.received, outstanding: total.outstanding + entry.outstanding}), {earned: 0, received: 0, outstanding: 0});
    setText("income-earned", WorkflowUI.currency(summary.earned));
    setText("income-received", WorkflowUI.currency(summary.received));
    setText("income-outstanding", WorkflowUI.currency(summary.outstanding));
    document.getElementById("institution-finance-detail").innerHTML = `<strong>${WorkflowUI.escape(selected ? selected.code + " · " + selected.name : "All institutions")}</strong><span>${InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference)}</span>`;
    document.getElementById("payment-collection-chart").innerHTML = ring([
      {value: summary.received, color: "var(--green)"}, {value: summary.outstanding, color: "var(--amber)"},
    ], summary.earned, summary.earned ? `${summary.outstanding ? Math.min(99.9, Math.round(summary.received / summary.earned * 1000) / 10) : 100}%` : "—", summary.earned ? "Collected" : "No fees recorded", true);
    const scopedTasks = tasks.filter((task) => task.status !== "Cancelled" && (!selected || task.institutionCode === selected.code) && TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    const notSet = scopedTasks.filter((task) => TaskStore.paymentSummary(task).basis == null).length;
    setText("finance-summary-note", `Current payment position for assignments in this period.${notSet ? ` ${notSet} ${notSet === 1 ? "assignment has" : "assignments have"} no fee recorded.` : ""}`);
  }

  function renderDistribution(tasks) {
    const entries = InstitutionMetrics.workflowMix(tasks);
    const cancelled = tasks.filter((task) => task.status === "Cancelled").length;
    if (cancelled) entries.push({key: "Cancelled", label: "Cancelled", color: "var(--red)", count: cancelled});
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    setText("assignment-status-total", `${total} assignments`);
    setText("status-period-label", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
    document.getElementById("assignment-status-chart").innerHTML = ring(entries.map((entry) => ({value: entry.count, color: entry.color})), total, total, total ? "Assignments" : "No assignments") + `<div class="distribution-legend">${legendHeading()}${entries.map((entry) => `<a href="${buildQuery({status: entry.key, period: selectedWorkloadPeriod})}"><i style="--state-color:${entry.color}"></i><span>${entry.label}</span><strong>${entry.count}</strong><small>${percent(entry.count, total)}%</small></a>`).join("")}</div>`;
    const mix = InstitutionMetrics.reportMix(tasks), maximum = Math.max(1, ...mix.map((entry) => entry.count));
    setText("report-types-total", `Total: ${tasks.length}`);
    setText("report-types-period", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
    document.getElementById("dashboard-report-mix").innerHTML = mix.map((entry) => `<a href="${buildQuery({group: entry.key, period: selectedWorkloadPeriod})}" class="report-type-row"><span class="report-type-label">${chartIcon(entry.key)}<span>${entry.label}</span></span><i><b style="width:${entry.count / maximum * 100}%"></b></i><strong>${entry.count}</strong></a>`).join("");
  }

  function renderBusiness(tasks, role) {
    document.getElementById("father-business").hidden = role !== "father";
    document.getElementById("dashboard-finance").hidden = role !== "father";
    document.getElementById("institution-type-section").hidden = role !== "father";
    document.getElementById("dashboard-analysis").classList.toggle("employee-analysis", role !== "father");
    if (role !== "father") return;
    renderInstitutionDistribution(renderWorkload(tasks));
    renderFinance(tasks);
  }

  // Date/period controls used by workload and finance views.
  function renderPeriodControls() {
    document.querySelectorAll("[data-dashboard-period]").forEach((button) => {
      const active = button.dataset.dashboardPeriod === selectedWorkloadPeriod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderPeriodPicker("dashboard-period-picker", selectedWorkloadPeriod, selectedWorkloadReference, (value) => {
      selectedWorkloadReference = value;
      render();
    });

  }

  function weekOptions() {
    const currentMonday = TaskStore.periodBounds("weekly", ValuxTime.todayDate()).start;
    const weeks = [];
    for (let index = 0; index < 52; index += 1) {
      const monday = ValuxTime.parseDate(ValuxTime.addDays(currentMonday, -(index * 7)));
      const fullLabel = InstitutionMetrics.periodLabel("weekly", monday);
      const label = fullLabel.replace(/^(\d{2}) ([A-Za-z]+) – (\d{2}) \2 (\d{4})$/, "$1–$3 $2 $4").replace(" – ", "–");
      weeks.push({ value: isoDate(monday), label, fullLabel });
    }
    return weeks;
  }

  function renderPeriodPicker(hostId, period, reference, onChange) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.hidden = !period;
    if (!period) {
      host.innerHTML = "";
      return;
    }
    const inputId = `${hostId}-value`;
    if (period === "daily") {
      host.innerHTML = `<label><span>Date</span><input id="${inputId}" type="date" aria-label="Assigned during date" value="${isoDate(reference)}"></label>`;
    } else if (period === "weekly") {
      const selectedMonday = isoDate(TaskStore.periodBounds("weekly", reference).start);
      host.innerHTML = `<label><span>Week</span><select class="dashboard-week-select" id="${inputId}" aria-label="Assigned during week">${weekOptions().map((week) => `<option title="${week.fullLabel}" value="${week.value}"${week.value === selectedMonday ? " selected" : ""}>${week.label}</option>`).join("")}</select></label>`;
    } else if (period === "monthly") {
      host.innerHTML = `<label><span>Month</span><input id="${inputId}" type="month" aria-label="Assigned during month" value="${isoDate(reference).slice(0, 7)}"></label>`;
    } else {
      const year = reference.getUTCFullYear();
      host.innerHTML = `<label><span>Year</span><select id="${inputId}" aria-label="Assigned during year">${Array.from({ length: 7 }, (_, index) => year - 3 + index).map((value) => `<option${value === year ? " selected" : ""}>${value}</option>`).join("")}</select></label>`;
    }
    document.getElementById(inputId).addEventListener("change", (event) => {
      const value = event.target.value;
      const nextReference = period === "monthly"
        ? ValuxTime.parseDate(`${value}-01`)
        : period === "yearly"
          ? ValuxTime.parseDate(`${value}-01-01`)
          : ValuxTime.parseDate(value);
      onChange(nextReference);
    });
  }

  function render() {
    const tasks = groupTasks();
    const periodTasks = tasks.filter((task) => TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    const count = (status) => periodTasks.filter((task) => task.status === status).length;
    const summary = {unassigned: count("Unassigned"), inProgress: count("In Progress"), onHold: count("On Hold"), completed: count("Completed"), closed: count("Closed"), awaitingReview: periodTasks.filter((task) => task.status === "On Hold" && task.holdReason === "Awaiting Review").length};
    const role = WorkflowAccess.currentRole();
    const recentStatus = document.getElementById("recent-status-filter").value;
    const recent = tasks.filter((task) => !recentStatus || task.status === recentStatus)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
    const paymentTasks = tasks.filter((task) => task.status === "Completed")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

    setText("dashboard-title", selectedGroup === "all" ? "Property Reports" : `${InstitutionMetrics.REPORT_GROUPS.find(({ key }) => key === selectedGroup).label} Reports`);
    setText("dashboard-description", descriptions[selectedGroup]);
    setText("metric-unassigned", summary.unassigned);
    setText("metric-progress", summary.inProgress);
    setText("metric-hold", summary.onHold);
    setText("metric-completed", summary.completed);
    setText("metric-closed", summary.closed);
    setText("completed-card-note", "Payment tracking");
    setText("closed-card-note", "Payment settled");
    setText("hold-review-count", role === "father" && summary.awaitingReview ? `${summary.awaitingReview} awaiting my review` : "Needs follow-up");
    document.getElementById("dashboard-period-summary").textContent = InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference);
    const allPeriodTasks = allVisibleTasks().filter((task) => TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    setText("count-all", allPeriodTasks.length);
    ["valuation", "revaluation", "estimation", "progress", "completion"].forEach((group) => {
      setText(`count-${group}`, allPeriodTasks.filter((task) => task.reportGroup === group).length);
    });

    renderRows("payment-tracking", paymentTasks, "Completed reports awaiting payment action will appear here.");
    renderRows("recent-activity", recent, "No recent activity matches this filter.");
    renderDistribution(periodTasks);
    renderBusiness(tasks, role);
    renderPeriodControls();
    document.getElementById("view-all-recent").href = buildQuery(recentStatus ? { status: recentStatus } : {});
    document.getElementById("view-all-payments").href = buildQuery({ status: "Completed" });
  }

  // Dashboard interactions and initial rendering.
  document.querySelectorAll("#report-navigation button").forEach((button) => button.addEventListener("click", () => {
    selectedGroup = button.dataset.group;
    document.querySelectorAll("#report-navigation button").forEach((item) => item.classList.toggle("active", item === button));
    render();
  }));
  document.querySelectorAll(".metric-card").forEach((card) => card.addEventListener("click", () => {
    window.location.href = buildQuery({ status: card.dataset.status, period: selectedWorkloadPeriod });
  }));
  document.querySelectorAll("[data-dashboard-period]").forEach((button) => button.addEventListener("click", () => {
    selectedWorkloadPeriod = button.dataset.dashboardPeriod;
    render();
  }));
  document.getElementById("finance-institution-select").addEventListener("change", (event) => {
    selectedFinanceInstitution = event.target.value;
    render();
  });
  document.getElementById("recent-status-filter").addEventListener("change", render);
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  TaskStore.loadAll().then(render).catch((error) => WorkflowUI.fatal(error.message || "Assignments could not be loaded."));
})();
