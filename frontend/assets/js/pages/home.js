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
  const initial = new URLSearchParams(window.location.search);
  const initialPeriod = initial.get("period");
  const categoryButtons = document.querySelectorAll("#report-navigation button[data-group]");
  const typePickers = document.querySelectorAll("#report-navigation .report-type-split");
  const valuationTypes = { valuation: "", revaluation: "" };
  const useStatusDates = initial.get("dateBasis") === "status";
  let selectedGroup = Object.hasOwn(descriptions, initial.get("group")) ? initial.get("group") : "all";
  let selectedWorkloadPeriod = ["", "daily", "weekly", "monthly", "yearly"].includes(initialPeriod) ? initialPeriod : "monthly";
  let selectedWorkloadReference = ValuxTime.parseDate(initial.get("periodReference") || "") || ValuxTime.todayDate();
  let selectedFinanceInstitution = "";
  const initialType = initial.get("valuationType");
  if (Object.hasOwn(valuationTypes, selectedGroup) && TaskStore.VALUATION_TYPES.includes(initialType)) {
    valuationTypes[selectedGroup] = initialType;
  }

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
    return allVisibleTasks().filter((task) => {
      if (selectedGroup !== "all" && task.reportGroup !== selectedGroup) return false;
      const type = valuationTypes[selectedGroup];
      return !type || task.reportKey === `valuation-${type}`;
    });
  }

  function buildQuery(values = {}) {
    const params = new URLSearchParams(values);
    if (selectedGroup !== "all" && !params.has("group")) params.set("group", selectedGroup);
    if (params.get("group") === selectedGroup && valuationTypes[selectedGroup]) {
      params.set("valuationType", valuationTypes[selectedGroup]);
    }
    if (values.period) params.set("periodReference", isoDate(selectedWorkloadReference));
    return `/tasks${params.size ? `?${params}` : ""}`;
  }

  function statusQuery(status) {
    const filters = { status, period: selectedWorkloadPeriod };
    if (useStatusDates && TaskStore.STATUS_DATE_FIELDS[status]) filters.dateBasis = "status";
    return buildQuery(filters);
  }

  function isoDate(value) {
    return ValuxTime.isoDate(value);
  }

  function renderRows(hostId, tasks, empty) {
    ValuxUI.paintTaskRows(document.getElementById(hostId), tasks, { empty });
  }

  function renderWorkload(tasks) {
    const entries = InstitutionMetrics.workload(tasks, selectedWorkloadPeriod, selectedWorkloadReference);
    const groups = ["Bank", "NBFC"].map(type => {
      const rows = entries.filter(entry => entry.type === type).map(entry => ({
        ...entry, color: WorkflowUI.chartColor(entry),
        href: buildQuery({ institution: entry.code, period: selectedWorkloadPeriod }),
      }));
      const count = rows.reduce((sum, entry) => sum + entry.count, 0);
      const href = buildQuery({ view: "summary", institution: `type:${type}`, period: selectedWorkloadPeriod });
      return { type, rows, count, href };
    });
    const segments = groups.map(({ type, count }) => ({
      type, count, value: count, label: type === "Bank" ? "Banks" : "NBFCs",
      color: type === "Bank" ? "#a35884" : "#8b9655",
      href: buildQuery({ view: "summary", institution: `type:${type}`, institutionScope: "active", period: selectedWorkloadPeriod }),
    }));
    const overall = document.getElementById("workload-overall-total");
    overall.textContent = `Selected Period Total: ${entries.reduce((sum, entry) => sum + entry.count, 0)} reports`;
    overall.href = buildQuery({ view: "summary", period: selectedWorkloadPeriod });
    ValuxUI.paintWorkload(document.getElementById("institution-workload"), entries, groups, segments);
    setText("workload-period-label", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
  }

  // The summary selector scopes the retained financial totals.
  function renderFinance(tasks) {
    const entries = InstitutionMetrics.finance(tasks, selectedWorkloadPeriod, selectedWorkloadReference);
    const selector = document.getElementById("finance-institution-select");
    ValuxUI.paintFinanceOptions(selector, entries);
    selector.value = selectedFinanceInstitution;
    if (selector.selectedIndex < 0) selector.value = "";
    selectedFinanceInstitution = selector.value;
    const institutionType = { "type:Bank": "Bank", "type:NBFC": "NBFC" }[selectedFinanceInstitution];
    const scopedEntries = entries.filter((entry) => !selectedFinanceInstitution
      || (institutionType ? entry.type === institutionType : entry.code === selectedFinanceInstitution));
    const summary = scopedEntries.reduce((total, entry) => ({earned: total.earned + entry.earned, received: total.received + entry.received, outstanding: total.outstanding + entry.outstanding}), {earned: 0, received: 0, outstanding: 0});
    setText("income-earned", WorkflowUI.currency(summary.earned));
    ValuxUI.paintFinanceDetail(document.getElementById("institution-finance-detail"),
      selector.selectedOptions[0].textContent, InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
    const financeFilters = { period: selectedWorkloadPeriod };
    if (selectedFinanceInstitution) financeFilters.institution = selectedFinanceInstitution;
    if (institutionType) financeFilters.institutionScope = "active";
    const paymentSegments = [
      { id: "income-received", view: "payment-received", label: "Payment received", value: summary.received, color: "#248c79", payment: TaskStore.PAYMENT_STATUS_PAIRS.received },
      { id: "income-outstanding", view: "payment-outstanding", label: "Outstanding", value: summary.outstanding, color: "#c5754f", payment: TaskStore.PAYMENT_STATUS_PAIRS.pending },
    ].map((entry) => {
      const amount = WorkflowUI.currency(entry.value);
      const href = buildQuery({ ...financeFilters, payment: entry.payment });
      const amountLink = document.getElementById(entry.id);
      amountLink.textContent = amount;
      amountLink.href = href;
      amountLink.setAttribute("aria-label", `${entry.label}: ${amount}. View ${entry.payment.split(",").join(" and ")} assignments`);
      return { ...entry, amount, href: buildQuery({ ...financeFilters, view: entry.view, payment: entry.payment }) };
    });
    const collected = summary.outstanding ? Math.min(99.9, Math.round(summary.received / summary.earned * 1000) / 10) : 100;
    ValuxUI.paintPaymentChart(document.getElementById("payment-collection-chart"), paymentSegments, summary.earned,
      summary.earned ? `${collected}%` : "—", summary.earned ? "Collected" : "No fees recorded");
    const institutionCodes = new Set(scopedEntries.map((entry) => entry.code));
    const scopedTasks = tasks.filter((task) => task.status !== "Cancelled" && (!selectedFinanceInstitution || institutionCodes.has(task.institutionCode))
      && TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    const notSet = scopedTasks.filter((task) => TaskStore.paymentSummary(task).basis == null).length;
    setText("finance-summary-note", `Current payment position for assignments in this period.${notSet ? ` ${notSet} ${notSet === 1 ? "assignment has" : "assignments have"} no fee recorded.` : ""}`);
  }

  function renderDistribution(statusTasks, assignedTasks) {
    const entries = InstitutionMetrics.workflowMix(statusTasks);
    const cancelled = statusTasks.filter((task) => task.status === "Cancelled").length;
    if (cancelled) entries.push({key: "Cancelled", label: "Cancelled", color: "var(--red)", count: cancelled});
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    setText("assignment-status-total", `${total} assignments`);
    const periodLabel = InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference);
    setText("status-period-label", useStatusDates && selectedWorkloadPeriod ? `${periodLabel} · Completed and Closed by status date` : periodLabel);
    const segments = entries.map((entry) => ({
      ...entry, value: entry.count,
      href: statusQuery(entry.key),
    }));
    ValuxUI.paintStatusChart(document.getElementById("assignment-status-chart"), segments, total);
    const mix = InstitutionMetrics.reportMix(assignedTasks).map(entry => ({
      ...entry, href: buildQuery({ group: entry.key, period: selectedWorkloadPeriod }),
    }));
    setText("report-types-total", `Total: ${assignedTasks.length}`);
    setText("report-types-period", InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference));
    ValuxUI.paintReportMix(document.getElementById("dashboard-report-mix"), mix);
  }

  function renderPreparation(tasks) {
    const { methods, unrecorded } = InstitutionMetrics.preparationMix(tasks);
    const preparationLink = key => buildQuery({ preparationSource: key, period: selectedWorkloadPeriod });
    ValuxUI.paintPreparation(document.getElementById("report-preparation-chart"),
      document.getElementById("report-preparation-unrecorded"), methods, unrecorded, preparationLink);
  }

  function renderBusiness(tasks, role) {
    document.getElementById("father-business").hidden = role !== "father";
    document.getElementById("dashboard-finance").hidden = role !== "father";
    document.getElementById("report-preparation-section").hidden = role !== "father";
    document.getElementById("dashboard-analysis").classList.toggle("employee-analysis", role !== "father");
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
    if (!period) return ValuxUI.paintPeriodPicker(host);
    const field = { id: `${hostId}-value` };
    if (period === "daily") {
      Object.assign(field, { label: "Date", inputType: "date", value: isoDate(reference) });
    } else if (period === "weekly") {
      Object.assign(field, {
        label: "Week", className: "dashboard-week-select", options: weekOptions(),
        value: isoDate(TaskStore.periodBounds("weekly", reference).start),
      });
    } else if (period === "monthly") {
      Object.assign(field, { label: "Month", inputType: "month", value: isoDate(reference).slice(0, 7) });
    } else {
      const year = reference.getUTCFullYear();
      const options = Array.from({ length: 7 }, (_, index) => {
        const value = year - 3 + index;
        return { value, label: value };
      });
      Object.assign(field, { label: "Year", options, value: year });
    }
    field.onChange = (event) => {
      const value = event.target.value;
      const date = period === "monthly" ? `${value}-01` : period === "yearly" ? `${value}-01-01` : value;
      onChange(ValuxTime.parseDate(date));
    };
    ValuxUI.paintPeriodPicker(host, field);
  }

  function render() {
    const tasks = groupTasks();
    const periodTasks = tasks.filter((task) => TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    const statusTasks = useStatusDates ? tasks.filter((task) => TaskStore.matchesPeriod(
      task, selectedWorkloadPeriod, TaskStore.STATUS_DATE_FIELDS[task.status] || "assignedDate", selectedWorkloadReference,
    )) : periodTasks;
    const count = (status) => statusTasks.filter((task) => task.status === status).length;
    const summary = {unassigned: count("Unassigned"), inProgress: count("In Progress"), onHold: count("On Hold"), completed: count("Completed"), closed: count("Closed"), awaitingReview: periodTasks.filter((task) => task.status === "On Hold" && task.holdReason === "Awaiting Review").length};
    const role = WorkflowAccess.currentRole();
    const recentStatus = document.getElementById("recent-status-filter").value;
    const recent = tasks.filter((task) => !recentStatus || task.status === recentStatus)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
    const paymentTasks = tasks.filter((task) => task.status === "Completed")
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

    const subtype = valuationTypes[selectedGroup];
    const groupLabel = InstitutionMetrics.REPORT_GROUPS.find(({ key }) => key === selectedGroup)?.label;
    const typeLabel = { general: "General ", agricultural: "Agricultural " }[subtype] || "";
    setText("dashboard-title", selectedGroup === "all" ? "Property Reports" : `${typeLabel}${groupLabel} Reports`);
    setText("dashboard-description", descriptions[selectedGroup]);
    for (const button of categoryButtons) {
      const active = button.dataset.group === selectedGroup;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const picker of typePickers) {
      const group = picker.querySelector("[data-group]").dataset.group;
      for (const option of picker.querySelectorAll("[data-type]")) {
        option.setAttribute("aria-pressed", String(option.dataset.type === valuationTypes[group]));
      }
    }
    setText("metric-unassigned", summary.unassigned);
    setText("metric-progress", summary.inProgress);
    setText("metric-hold", summary.onHold);
    setText("metric-completed", summary.completed);
    setText("metric-closed", summary.closed);
    setText("completed-card-note", useStatusDates && selectedWorkloadPeriod ? "By completion date" : "Payment tracking");
    setText("closed-card-note", useStatusDates && selectedWorkloadPeriod ? "By closure date" : "Payment settled");
    setText("hold-review-count", role === "father" && summary.awaitingReview ? `${summary.awaitingReview} awaiting my review` : "Needs follow-up");
    document.getElementById("dashboard-period-summary").textContent = InstitutionMetrics.periodLabel(selectedWorkloadPeriod, selectedWorkloadReference);
    const allPeriodTasks = allVisibleTasks().filter((task) => TaskStore.matchesPeriod(task, selectedWorkloadPeriod, "assignedDate", selectedWorkloadReference));
    setText("count-all", allPeriodTasks.length);
    ["valuation", "revaluation", "estimation", "progress", "completion"].forEach((group) => {
      setText(`count-${group}`, allPeriodTasks.filter((task) => task.reportGroup === group).length);
    });

    renderRows("payment-tracking", paymentTasks, "Completed reports awaiting payment action will appear here.");
    renderRows("recent-activity", recent, "No recent activity matches this filter.");
    renderDistribution(statusTasks, periodTasks);
    renderBusiness(tasks, role);
    if (role === "father") renderPreparation(periodTasks);
    renderPeriodControls();
    document.getElementById("view-all-recent").href = buildQuery(recentStatus ? { status: recentStatus } : {});
    document.getElementById("view-all-payments").href = buildQuery({ status: "Completed" });
  }

  // Dashboard interactions and initial rendering.
  function closeTypePickers() {
    for (const picker of typePickers) {
      picker.querySelector(".report-type-options").hidden = true;
      picker.querySelector(".report-type-chevron").setAttribute("aria-expanded", "false");
    }
  }

  categoryButtons.forEach((button) => button.addEventListener("click", () => {
    closeTypePickers();
    selectedGroup = button.dataset.group;
    render();
  }));
  for (const picker of typePickers) {
    const group = picker.querySelector("[data-group]").dataset.group;
    const toggle = picker.querySelector(".report-type-chevron");
    const options = picker.querySelector(".report-type-options");
    toggle.addEventListener("click", () => {
      const open = options.hidden;
      closeTypePickers();
      options.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    options.addEventListener("click", (event) => {
      const option = event.target.closest("[data-type]");
      if (!option) return;
      selectedGroup = group;
      valuationTypes[group] = option.dataset.type;
      closeTypePickers();
      render();
      toggle.focus();
    });
    picker.addEventListener("focusout", (event) => {
      if (!picker.contains(event.relatedTarget)) closeTypePickers();
    });
    picker.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || options.hidden) return;
      closeTypePickers();
      toggle.focus();
    });
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".report-type-split")) closeTypePickers();
  });
  document.querySelectorAll(".metric-card").forEach((card) => card.addEventListener("click", () => {
    window.location.href = statusQuery(card.dataset.status);
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
  TaskStore.loadAll(window.__VALUX_BUSINESS_CONTEXT__?.dashboardPage).then(() => {
    const target = location.hash.slice(1);
    if (["dashboard-finance", "payment-dashboard-card", "recent-activity-card"].includes(target)) {
      document.getElementById(target).scrollIntoView();
    }
  }).catch((error) => WorkflowUI.fatal(error.message || "Assignments could not be loaded."));
})();
