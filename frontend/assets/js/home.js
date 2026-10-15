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
  let selectedPeriod = "monthly";
  let selectedFinanceInstitution = "";

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
    return `/tasks${params.size ? `?${params}` : ""}`;
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
    const entries = InstitutionMetrics.workload(tasks, selectedPeriod);
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    document.getElementById("institution-workload").innerHTML = chartGroups(entries, (group) => `<div class="vertical-chart workload-chart" style="--columns:${group.length}">
      ${group.map((entry, index) => {
        const height = entry.count ? Math.max(8, Math.round((entry.count / maximum) * 100)) : 0;
        const href = buildQuery({ institution: entry.code, period: selectedPeriod });
        return `<a class="chart-column" href="${href}" title="${WorkflowUI.escape(entry.name)}: ${entry.count} reports" aria-label="View ${WorkflowUI.escape(entry.name)} tasks">
          <span class="chart-value">${entry.count}</span>
          <span class="chart-track"><i style="--height:${height}%;--chart-color:${WorkflowUI.chartColor(index)}"></i></span>
          <strong>${WorkflowUI.escape(entry.code)}</strong>
        </a>`;
      }).join("")}
    </div>`);
    setText("workload-period-label", InstitutionMetrics.periodLabel(selectedPeriod));
  }

  function renderFinanceSelection(entries) {
    const selected = entries.find((entry) => entry.code === selectedFinanceInstitution);
    const panel = document.getElementById("institution-finance-detail");
    if (!selected) {
      panel.innerHTML = "<strong>Select an institution</strong><span>Choose a bank or NBFC in the chart to view its three values.</span>";
      return;
    }
    panel.innerHTML = `<div><strong>${WorkflowUI.escape(selected.code)} · ${WorkflowUI.escape(selected.name)}</strong><span>${InstitutionMetrics.periodLabel(selectedPeriod)}</span></div><dl><div><dt>Income earned</dt><dd>${WorkflowUI.currency(selected.earned)}</dd></div><div><dt>Payment received</dt><dd>${WorkflowUI.currency(selected.received)}</dd></div><div><dt>Outstanding</dt><dd>${WorkflowUI.currency(selected.outstanding)}</dd></div></dl>`;
  }

  function renderFinance(tasks) {
    const entries = InstitutionMetrics.finance(tasks, selectedPeriod);
    const maximum = Math.max(1, ...entries.flatMap((entry) => [entry.earned, entry.received, entry.outstanding]));
    const height = (value) => value ? Math.max(7, Math.round((value / maximum) * 100)) : 0;
    document.getElementById("institution-finance-chart").innerHTML = chartGroups(entries, (group) => `<div class="vertical-chart finance-column-chart" style="--columns:${group.length}">
      ${group.map((entry) => `<button type="button" class="chart-column finance-column${entry.code === selectedFinanceInstitution ? " selected" : ""}" data-finance-institution="${WorkflowUI.escape(entry.code)}" title="${WorkflowUI.escape(entry.name)}">
        <span class="chart-value">${WorkflowUI.currency(entry.earned)}</span>
        <span class="chart-track grouped-bars"><i class="earned" style="--height:${height(entry.earned)}%"></i><i class="received" style="--height:${height(entry.received)}%"></i><i class="outstanding" style="--height:${height(entry.outstanding)}%"></i></span>
        <strong>${WorkflowUI.escape(entry.code)}</strong>
      </button>`).join("")}
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
      const active = button.dataset.dashboardPeriod === selectedPeriod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
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
    selectedPeriod = button.dataset.dashboardPeriod;
    selectedFinanceInstitution = "";
    render();
  }));
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
