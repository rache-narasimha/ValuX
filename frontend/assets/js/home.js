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
  let selectedWorkloadReference = new Date();
  let selectedFinancePeriod = "monthly";
  let selectedFinanceReference = new Date();
  let selectedFinanceInstitution = "";
  let selectedFinanceMetric = "all";

  const storage = TaskStore.storageStatus();
  if (!storage.ok) {
    WorkflowUI.fatal(storage.error);
    return;
  }
  TaskStore.ensureSamples();

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
    const date = value instanceof Date ? value : new Date(value);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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
    document.getElementById("institution-workload").innerHTML = chartGroups(entries, (group) => `<div class="vertical-chart workload-chart" style="--columns:${group.length}">
      ${group.map((entry) => {
        const height = entry.count ? Math.max(8, Math.round((entry.count / maximum) * 100)) : 0;
        const href = buildQuery({ institution: entry.code, period: selectedWorkloadPeriod });
        return `<a class="chart-column" href="${href}" title="${WorkflowUI.escape(entry.name)}: ${entry.count} reports" aria-label="View ${WorkflowUI.escape(entry.name)} tasks">
          <span class="chart-value">${entry.count}</span>
          <span class="chart-track"><i style="--height:${height}%;--chart-color:${WorkflowUI.chartColor(entry)}"></i></span>
          <strong>${WorkflowUI.escape(entry.code)}</strong>
        </a>`;
      }).join("")}
    </div>`);
    setText("workload-period-label", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
  }

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
    const visibleValues = selectedFinanceMetric === "all"
      ? entries.flatMap((entry) => [entry.earned, entry.received, entry.outstanding])
      : entries.map((entry) => entry[selectedFinanceMetric]);
    const maximum = Math.max(1, ...visibleValues);
    const height = (value) => value ? Math.max(7, Math.round((value / maximum) * 100)) : 0;
    document.getElementById("institution-finance-chart").innerHTML = chartGroups(entries, (group) => `<div class="vertical-chart finance-column-chart" style="--columns:${group.length}">
      ${group.map((entry) => {
        const metricValue = selectedFinanceMetric === "all" ? entry.earned : entry[selectedFinanceMetric];
        const bars = selectedFinanceMetric === "all"
          ? `<i class="earned" style="--height:${height(entry.earned)}%"></i><i class="received" style="--height:${height(entry.received)}%"></i><i class="outstanding" style="--height:${height(entry.outstanding)}%"></i>`
          : `<i class="${selectedFinanceMetric} single" style="--height:${height(metricValue)}%"></i>`;
        return `<button type="button" class="chart-column finance-column${entry.code === selectedFinanceInstitution ? " selected" : ""}" data-finance-institution="${WorkflowUI.escape(entry.code)}" title="${WorkflowUI.escape(entry.name)}" style="--institution-color:${entry.color}">
        <span class="chart-value">${WorkflowUI.currency(metricValue)}</span>
        <span class="chart-track grouped-bars">${bars}</span>
        <strong>${WorkflowUI.escape(entry.code)}</strong>
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
    document.getElementById("finance-legend").hidden = selectedFinanceMetric !== "all";
    renderFinanceSelection(entries);
  }

  function renderBusiness(tasks, role) {
    const host = document.getElementById("father-business");
    host.hidden = role !== "father";
    if (role !== "father") return;
    renderWorkload(tasks);
    renderFinance(tasks);
  }

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

  function weekOptions(reference) {
    const years = [reference.getFullYear() - 1, reference.getFullYear(), reference.getFullYear() + 1];
    const weeks = [];
    years.forEach((year) => {
      const date = new Date(year, 0, 1);
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      while (date.getFullYear() <= year || (date.getFullYear() === year + 1 && date.getMonth() === 0)) {
        const monday = new Date(date);
        const sunday = new Date(date);
        sunday.setDate(sunday.getDate() + 6);
        if (monday.getFullYear() === year || sunday.getFullYear() === year) {
          weeks.push({ value: isoDate(monday), label: InstitutionMetrics.periodLabel("weekly", monday) });
        }
        date.setDate(date.getDate() + 7);
      }
    });
    return weeks;
  }

  function renderPeriodPicker(hostId, period, reference, onChange) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const inputId = `${hostId}-value`;
    if (period === "daily") {
      host.innerHTML = `<label>Date<input id="${inputId}" type="date" value="${isoDate(reference)}"></label>`;
    } else if (period === "weekly") {
      const selectedMonday = isoDate(TaskStore.periodBounds("weekly", reference).start);
      host.innerHTML = `<label>Week<select id="${inputId}">${weekOptions(reference).map((week) => `<option value="${week.value}"${week.value === selectedMonday ? " selected" : ""}>${week.label}</option>`).join("")}</select></label>`;
    } else if (period === "monthly") {
      host.innerHTML = `<label>Month<input id="${inputId}" type="month" value="${isoDate(reference).slice(0, 7)}"></label>`;
    } else {
      const year = reference.getFullYear();
      host.innerHTML = `<label>Year<select id="${inputId}">${Array.from({ length: 7 }, (_, index) => year - 3 + index).map((value) => `<option${value === year ? " selected" : ""}>${value}</option>`).join("")}</select></label>`;
    }
    document.getElementById(inputId).addEventListener("change", (event) => {
      const value = event.target.value;
      const nextReference = period === "monthly"
        ? new Date(`${value}-01T00:00:00`)
        : period === "yearly"
          ? new Date(`${value}-01-01T00:00:00`)
          : new Date(`${value}T00:00:00`);
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
    setText("hold-review-count", role === "father" && summary.awaitingReview ? `${summary.awaitingReview} awaiting my review` : "Needs follow-up");
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
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    const shell = document.querySelector(".app-shell");
    const collapsed = shell.classList.toggle("sidebar-collapsed");
    document.getElementById("sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
    localStorage.setItem("sln.dashboard.sidebar-collapsed", String(collapsed));
  });
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  if (localStorage.getItem("sln.dashboard.sidebar-collapsed") === "true") {
    document.querySelector(".app-shell").classList.add("sidebar-collapsed");
    document.getElementById("sidebar-toggle").setAttribute("aria-expanded", "false");
  }
  render();
})();
