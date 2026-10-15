(function () {
  "use strict";

  const REPORT_GROUPS = [
    { key: "valuation", label: "Valuation" },
    { key: "estimation", label: "Estimation" },
    { key: "progress", label: "Progress" },
    { key: "completion", label: "Completion" },
  ];

  const WORKFLOW_STATES = [
    { key: "Unassigned", label: "Unassigned", color: "#71838b" },
    { key: "In Progress", label: "In progress", color: "#087ea4" },
    { key: "On Hold", label: "On hold", color: "#d59024" },
    { key: "Completed", label: "Completed", color: "#31956b" },
    { key: "Closed", label: "Closed", color: "#6f63b6" },
  ];

  function configured() {
    return window.InstitutionStore
      ? InstitutionStore.active()
      : Object.entries(window.INSTITUTIONS || {}).flatMap(([type, institutions]) =>
        institutions.map((institution) => ({ ...institution, type })),
      );
  }

  function forInstitution(tasks, institutionCode) {
    return tasks.filter((task) => task.institutionCode === institutionCode);
  }

  function workload(tasks, period, reference) {
    return configured().map((institution) => ({
      ...institution,
      count: forInstitution(tasks, institution.code)
        .filter((task) => TaskStore.matchesPeriod(task, period, "assignedDate", reference)).length,
    }));
  }

  function finance(tasks, period, reference) {
    return configured().map((institution) => {
      const billable = forInstitution(tasks, institution.code)
        .filter((task) => task.status !== "Cancelled")
        .filter((task) => TaskStore.matchesPeriod(task, period, "assignedDate", reference));
      const earned = billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).basis || 0), 0);
      const received = billable.reduce((sum, task) => sum + Number(task.payment.received || 0), 0);
      const outstanding = billable.reduce((sum, task) => sum + Number(TaskStore.paymentSummary(task).outstanding || 0), 0);
      return { ...institution, earned, received, outstanding };
    });
  }

  function reportMix(tasks) {
    return REPORT_GROUPS.map((group) => ({
      ...group,
      count: tasks.filter((task) => task.reportGroup === group.key).length,
    }));
  }

  function workflowMix(tasks) {
    return WORKFLOW_STATES.map((state) => ({
      ...state,
      count: tasks.filter((task) => task.status === state.key).length,
    }));
  }

  function periodLabel(period, reference = new Date()) {
    const format = (date, options) => new Intl.DateTimeFormat("en-IN", options).format(date);
    const { start, end } = TaskStore.periodBounds(period, reference);
    const inclusiveEnd = new Date(end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    if (period === "daily") return format(start, { day: "2-digit", month: "short", year: "numeric" });
    if (period === "weekly") return `${format(start, { day: "2-digit", month: "short" })} – ${format(inclusiveEnd, { day: "2-digit", month: "short", year: "numeric" })}`;
    if (period === "yearly") return String(start.getFullYear());
    return format(start, { month: "long", year: "numeric" });
  }

  window.InstitutionMetrics = {
    REPORT_GROUPS,
    WORKFLOW_STATES,
    configured,
    workload,
    finance,
    reportMix,
    workflowMix,
    periodLabel,
  };
})();
