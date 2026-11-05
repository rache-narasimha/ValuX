/** Dashboard controller: status summaries, institution workload, finance charts, and recent work. */
(function () {
  "use strict";

  const descriptions = {
    all: "Review assignments, continue reports and follow up on pending work.",
    valuation: "General and agricultural property valuation assignments.",
    estimation: "Detailed building estimate assignments.",
    progress: "Construction progress assessment assignments.",
    completion: "Completion report assignments.",
  };
  let selectedGroup = "all";
  let selectedWorkloadPeriod = "monthly";
  let selectedWorkloadReference = ValuxTime.todayDate();
  let selectedFinancePeriod = "monthly";
  let selectedFinanceReference = ValuxTime.todayDate();
  let selectedFinanceInstitution = "";
  let selectedFinanceMetric = "all";

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
    if (selectedGroup !== "all") params.set("group", selectedGroup);
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

  function chartGroups(entries, renderer) {
    return ["Bank", "NBFC"].map((type) => {
      const group = entries.filter((entry) => entry.type === type);
      return `<section class="data-chart-card"><h3>${type === "Bank" ? "Banks" : "NBFCs"}</h3>${renderer(group, type)}</section>`;
    }).join("");
  }

  function renderWorkload(tasks) {
    const entries = InstitutionMetrics.workload(tasks, selectedWorkloadPeriod, selectedWorkloadReference);
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    document.getElementById("workload-overall-total").textContent = `Overall total: ${entries.reduce((sum, entry) => sum + entry.count, 0)} reports`;
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
    </div><a class="chart-total" href="${buildQuery({ view: "summary", institution: `type:${type}`, period: selectedWorkloadPeriod })}" aria-label="View all ${type === "Bank" ? "bank" : "NBFC"} tasks">Total: <strong>${group.reduce((sum, entry) => sum + entry.count, 0)} reports</strong></a>`);
    setText("workload-period-label", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
  }

  // Finance chart rendering and selected-institution detail.
  function renderFinanceSelection(entries) {
    const selected = entries.find((entry) => entry.code === selectedFinanceInstitution);
    const panel = document.getElementById("institution-finance-detail");
    if (!selected) {
      panel.innerHTML = "<strong>Select an institution</strong><span>Choose a bank or NBFC in the chart to view its three values.</span>";
      return;
    }
    panel.innerHTML = `<div><strong>${WorkflowUI.escape(selected.code)} · ${WorkflowUI.escape(selected.name)}</strong><span>${InstitutionMetrics.periodLabel(selectedFinancePeriod, selectedFinanceReference)}</span></div><dl><div><dt>Income earned</dt><dd>${WorkflowUI.currency(selected.earned)}</dd></div><div><dt>Payment received</dt><dd>${WorkflowUI.currency(selected.received)}</dd></div><div><dt>Outstanding</dt><dd>${WorkflowUI.currency(selected.outstanding)}</dd></div></dl>`;
  }

  function renderFinance(tasks) {
    const entries = InstitutionMetrics.finance(tasks, selectedFinancePeriod, selectedFinanceReference);
    const maximum = Math.max(1, ...entries.map((entry) => selectedFinanceMetric === "all" ? entry.earned : entry[selectedFinanceMetric]));
    const width = (value) => value ? Math.max(2, Math.round((value / maximum) * 100)) : 0;
    const segment = (kind, value, earned) => {
      const chartWidth = width(value);
      const share = earned ? Math.round((value / earned) * 100) : 0;
      const label = share >= 16 ? `<span>${share}%</span>` : "";
      return `<i class="${kind}" style="--width:${chartWidth}%" title="${kind === "received" ? "Received" : "Outstanding"}: ${share}%">${label}</i>`;
    };
    document.getElementById("institution-finance-chart").innerHTML = chartGroups(entries, (group) => `<div class="horizontal-chart finance-horizontal-chart">
      ${group.map((entry) => {
        const metricValue = selectedFinanceMetric === "all" ? entry.earned : entry[selectedFinanceMetric];
        const bars = selectedFinanceMetric === "all"
          ? `${segment("received", entry.received, entry.earned)}${segment("outstanding", entry.outstanding, entry.earned)}`
          : `<i class="${selectedFinanceMetric} single" style="--width:${width(metricValue)}%"></i>`;
        return `<button type="button" class="horizontal-chart-row finance-column${entry.code === selectedFinanceInstitution ? " selected" : ""}" data-finance-institution="${WorkflowUI.escape(entry.code)}" title="${WorkflowUI.escape(entry.name)}" style="--institution-color:${entry.color}">
        <strong>${WorkflowUI.escape(entry.code)}</strong>
        <span class="horizontal-track grouped-bars">${bars}</span>
        <span class="chart-value">${WorkflowUI.currency(metricValue)}</span>
      </button>`;
      }).join("")}
    </div>`);
    document.querySelectorAll("[data-finance-institution]").forEach((button) => button.addEventListener("click", () => {
      selectedFinanceInstitution = button.dataset.financeInstitution;
      renderFinance(tasks);
    }));
    const earned = entries.reduce((sum, entry) => sum + entry.earned, 0);
    const received = entries.reduce((sum, entry) => sum + entry.received, 0);
    setText("income-earned", WorkflowUI.currency(earned));
    setText("income-received", WorkflowUI.currency(received));
    setText("income-outstanding", WorkflowUI.currency(Math.max(0, earned - received)));
    setText("finance-period-label", InstitutionMetrics.periodLabel(selectedFinancePeriod, selectedFinanceReference));
    const legend = document.getElementById("finance-legend");
    legend.hidden = selectedFinanceMetric !== "all";
    legend.innerHTML = '<span class="received">Received</span><span class="outstanding">Outstanding</span>';
    renderFinanceSelection(entries);
  }

  function renderBusiness(tasks, role) {
    const host = document.getElementById("father-business");
    host.hidden = role !== "father";
    if (role !== "father") return;
    renderWorkload(tasks);
    renderFinance(tasks);
  }

  // Date/period controls used by workload and finance views.
  function renderPeriodControls() {
    document.querySelectorAll("[data-dashboard-period]").forEach((button) => {
      const active = button.dataset.dashboardPeriod === selectedWorkloadPeriod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("finance-period-select").value = selectedFinancePeriod;
    document.getElementById("finance-metric-select").value = selectedFinanceMetric;
    renderPeriodPicker("dashboard-period-picker", selectedWorkloadPeriod, selectedWorkloadReference, (value) => {
      selectedWorkloadReference = value;
      render();
    });
    renderPeriodPicker("finance-period-picker", selectedFinancePeriod, selectedFinanceReference, (value) => {
      selectedFinanceReference = value;
      selectedFinanceInstitution = "";
      render();
    });
  }

  function weekOptions() {
    const currentMonday = TaskStore.periodBounds("weekly", ValuxTime.todayDate()).start;
    const weeks = [];
    for (let index = 0; index < 52; index += 1) {
      const monday = ValuxTime.parseDate(ValuxTime.addDays(currentMonday, -(index * 7)));
      weeks.push({ value: isoDate(monday), label: InstitutionMetrics.periodLabel("weekly", monday) });
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
      host.innerHTML = `<label>Date<input id="${inputId}" type="date" value="${isoDate(reference)}"></label>`;
    } else if (period === "weekly") {
      const selectedMonday = isoDate(TaskStore.periodBounds("weekly", reference).start);
      host.innerHTML = `<label>Week<select id="${inputId}">${weekOptions().map((week) => `<option value="${week.value}"${week.value === selectedMonday ? " selected" : ""}>${week.label}</option>`).join("")}</select></label>`;
    } else if (period === "monthly") {
      host.innerHTML = `<label>Month<input id="${inputId}" type="month" value="${isoDate(reference).slice(0, 7)}"></label>`;
    } else {
      const year = reference.getUTCFullYear();
      host.innerHTML = `<label>Year<select id="${inputId}">${Array.from({ length: 7 }, (_, index) => year - 3 + index).map((value) => `<option${value === year ? " selected" : ""}>${value}</option>`).join("")}</select></label>`;
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
    const summary = TaskStore.summary(selectedGroup);
    const role = WorkflowAccess.currentRole();
    const recentStatus = document.getElementById("recent-status-filter").value;
    const recent = tasks.filter((task) => !recentStatus || task.status === recentStatus)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
    const paymentTasks = tasks.filter((task) => task.status === "Completed")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

    setText("dashboard-title", selectedGroup === "all" ? "All work" : `${selectedGroup[0].toUpperCase()}${selectedGroup.slice(1)} work`);
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
    setText("count-all", allVisibleTasks().length);
    ["valuation", "estimation", "progress", "completion"].forEach((group) => {
      setText(`count-${group}`, allVisibleTasks().filter((task) => task.reportGroup === group).length);
    });

    renderRows("payment-tracking", paymentTasks, "Completed reports awaiting payment action will appear here.");
    renderRows("recent-activity", recent, "No recent activity matches this filter.");
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
    window.location.href = buildQuery({ status: card.dataset.status });
  }));
  document.querySelectorAll("[data-dashboard-period]").forEach((button) => button.addEventListener("click", () => {
    selectedWorkloadPeriod = button.dataset.dashboardPeriod;
    render();
  }));
  document.getElementById("finance-period-select").addEventListener("change", (event) => {
    selectedFinancePeriod = event.target.value;
    selectedFinanceInstitution = "";
    render();
  });
  document.getElementById("finance-metric-select").addEventListener("change", (event) => {
    selectedFinanceMetric = event.target.value;
    render();
  });
  document.getElementById("recent-status-filter").addEventListener("change", render);
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  TaskStore.loadAll().then(render).catch((error) => WorkflowUI.fatal(error.message || "Assignments could not be loaded."));
})();
