/** Searchable task-list and institution drill-down controller. */
(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const FEE_RECORDED = "fee-recorded";
  const list = document.getElementById("task-list");
  const loadMore = document.getElementById("load-more");
  const dateBasisControl = document.getElementById("task-date-basis");
  const fields = {
    search: document.getElementById("task-search"),
    preparationSource: document.getElementById("preparation-filter"),
    group: document.getElementById("group-filter"),
    valuationType: document.getElementById("valuation-type-filter"),
    institution: document.getElementById("institution-filter"),
    period: document.getElementById("period-filter"),
    status: document.getElementById("status-filter"),
    assignee: document.getElementById("assignee-filter"),
    holdReason: document.getElementById("hold-filter"),
    payment: document.getElementById("payment-filter"),
  };
  let visible = PAGE_SIZE;
  let periodReference = ValuxTime.todayDate();
  let dateBasis = "assigned";
  let directoryMode = false;
  let summaryMode = false;
  let paymentView = "";
  let activeInstitutionScope = false;
  let analyticsLoadPromise = null;
  let renderSequence = 0;
  const GROUP_LABELS = {
    all: "All work",
    valuation: "Valuation",
    revaluation: "Re-Valuation",
    estimation: "Estimation",
    progress: "Progress",
    completion: "Completion",
  };

  const storage = TaskStore.storageStatus();
  if (!storage.ok) {
    WorkflowUI.fatal(storage.error);
    list.innerHTML = WorkflowUI.empty("Tasks cannot be shown until the authenticated workflow service is available.");
    loadMore.hidden = true;
    return;
  }

  // Filter state, query construction, and task-row rendering.
  function populateFilters() {
    const initial = new URLSearchParams(window.location.search);
    const view = initial.get("view");
    directoryMode = view === "institutions";
    summaryMode = view === "summary";
    if (WorkflowAccess.currentRole() === "father" && ["payment-received", "payment-outstanding"].includes(view)) {
      paymentView = view;
    }
    TaskStore.STATUSES.forEach((item) => fields.status.add(new Option(item, item)));
    fields.assignee.innerHTML = '<option value="">Everyone</option>';
    TaskStore.EMPLOYEES.forEach((employee) => fields.assignee.add(new Option(employee.name, employee.name)));
    fields.institution.add(new Option("All banks", "type:Bank"));
    fields.institution.add(new Option("All NBFCs", "type:NBFC"));
    Object.entries(window.INSTITUTIONS).forEach(([type, institutions]) => {
      const group = document.createElement("optgroup");
      group.label = type === "Bank" ? "Banks" : "NBFCs";
      institutions.forEach((institution) => group.append(new Option(`${institution.code} — ${institution.name}`, institution.code)));
      fields.institution.append(group);
    });
    if (WorkflowAccess.currentRole() === "father") {
      const collection = document.createElement("optgroup");
      collection.label = "Payment collection";
      for (const pair of Object.values(TaskStore.PAYMENT_STATUS_PAIRS)) {
        collection.append(new Option(pair.split(",").join(" + "), pair));
      }
      if (paymentView) collection.append(new Option("Fee recorded", FEE_RECORDED));
      fields.payment.append(collection);
    }
    if (initial.get("periodReference")) periodReference = ValuxTime.parseDate(initial.get("periodReference")) || ValuxTime.todayDate();
    fields.group.value = initial.get("group") || "all";
    fields.valuationType.value = TaskStore.VALUATION_TYPES.includes(initial.get("valuationType")) ? initial.get("valuationType") : "";
    fields.preparationSource.value = WorkflowAccess.currentRole() === "father" ? initial.get("preparationSource") || "" : "";
    fields.institution.value = initial.get("institution") || "";
    activeInstitutionScope = Boolean(selectedInstitutionType() && initial.get("institutionScope") === "active");
    fields.period.value = initial.get("period") || "";
    fields.status.value = initial.get("status") || "";
    dateBasis = initial.get("dateBasis") === "status" && TaskStore.STATUS_DATE_FIELDS[fields.status.value] ? "status" : "assigned";
    fields.assignee.value = initial.get("assignee") || "";
    fields.holdReason.value = initial.get("holdReason") || "";
    fields.payment.value = initial.get("payment") || "";
    if (fields.payment.selectedIndex < 0) fields.payment.value = "";
    fields.search.value = initial.get("search") || "";
  }

  function isoDate(value) {
    return ValuxTime.isoDate(value);
  }

  function selectedValuationType() {
    return ["valuation", "revaluation"].includes(fields.group.value) ? fields.valuationType.value : "";
  }

  function selectedDateBasis() {
    return TaskStore.STATUS_DATE_FIELDS[fields.status.value] && dateBasis === "status" ? "status" : "assigned";
  }

  function periodBasisLabel() {
    return selectedDateBasis() === "status" ? `${fields.status.value} during` : "Assigned during";
  }

  function renderAssignmentFilters() {
    const typeFilter = document.getElementById("valuation-type-filter-wrap");
    typeFilter.hidden = !["valuation", "revaluation"].includes(fields.group.value);
    if (!typeFilter.hidden) typeFilter.firstElementChild.textContent = `${GROUP_LABELS[fields.group.value]} type`;
    dateBasisControl.hidden = !TaskStore.STATUS_DATE_FIELDS[fields.status.value];
    const basis = selectedDateBasis();
    dateBasisControl.querySelectorAll("[data-date-basis]").forEach((button) => {
      const active = button.dataset.dateBasis === basis;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (button.dataset.dateBasis === "status" && !dateBasisControl.hidden) {
        button.textContent = `${fields.status.value} during`;
      }
    });
    document.getElementById("task-period-label-text").textContent = periodBasisLabel();

    const dashboard = document.getElementById("tasks-dashboard-link");
    const params = new URLSearchParams();
    if (selectedValuationType()) params.set("valuationType", selectedValuationType());
    if (basis === "status") params.set("dateBasis", basis);
    if (params.size || fields.period.value) {
      params.set("group", fields.group.value);
      params.set("period", fields.period.value);
      if (fields.period.value) params.set("periodReference", isoDate(periodReference));
    }
    dashboard.href = params.size ? `/?${params}` : "/";
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

  function renderPeriodFilter() {
    const switcher = document.getElementById("task-period-switch");
    const picker = document.getElementById("task-period-picker");
    const activePeriod = fields.period.value;
    const options = [
      ["", "All time"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"],
    ];
    switcher.innerHTML = options.map(([value, label]) => `<button type="button" data-task-period="${value}" class="${value === activePeriod ? "active" : ""}" aria-pressed="${value === activePeriod}">${label}</button>`).join("");
    switcher.querySelectorAll("[data-task-period]").forEach((button) => button.addEventListener("click", () => {
      const next = button.dataset.taskPeriod;
      if (next === fields.period.value) return;
      fields.period.value = next;
      renderPeriodFilter();
      reset();
    }));
    picker.hidden = !activePeriod;
    if (!activePeriod) {
      picker.innerHTML = "";
      return;
    }
    const inputId = "task-period-picker-value";
    if (activePeriod === "daily") {
      picker.innerHTML = `<label>Date<input id="${inputId}" type="date" value="${isoDate(periodReference)}" /></label>`;
    } else if (activePeriod === "weekly") {
      const weeks = weekOptions();
      let selectedMonday = isoDate(TaskStore.periodBounds("weekly", periodReference).start);
      if (!weeks.some((week) => week.value === selectedMonday)) {
        selectedMonday = weeks[0].value;
        periodReference = ValuxTime.parseDate(selectedMonday);
      }
      picker.innerHTML = `<label>Week<select id="${inputId}">${weeks.map((week) => `<option value="${week.value}"${week.value === selectedMonday ? " selected" : ""}>${week.label}</option>`).join("")}</select></label>`;
    } else if (activePeriod === "monthly") {
      picker.innerHTML = `<label>Month<input id="${inputId}" type="month" value="${isoDate(periodReference).slice(0, 7)}" /></label>`;
    } else {
      const year = periodReference.getUTCFullYear();
      picker.innerHTML = `<label>Year<select id="${inputId}">${Array.from({ length: 7 }, (_, index) => year - 3 + index).map((value) => `<option value="${value}"${value === year ? " selected" : ""}>${value}</option>`).join("")}</select></label>`;
    }
    document.getElementById(inputId).addEventListener("change", (event) => {
      const value = event.target.value;
      periodReference = activePeriod === "monthly"
        ? ValuxTime.parseDate(`${value}-01`)
        : activePeriod === "yearly"
          ? ValuxTime.parseDate(`${value}-01-01`)
          : ValuxTime.parseDate(value);
      renderPeriodFilter();
      reset();
    });
  }

  function queryOptions(limit = visible) {
    return Object.fromEntries([
      ["preparationSource", WorkflowAccess.currentRole() === "father" ? fields.preparationSource.value : ""], ["group", fields.group.value], ["institution", selectedInstitutionType() ? "" : fields.institution.value],
      ["valuationType", selectedValuationType()], ["dateBasis", selectedDateBasis() === "status" ? "status" : ""],
      ["institutionType", selectedInstitutionType()], ["institutionScope", activeInstitutionScope ? "active" : ""],
      ["period", fields.period.value], ["status", fields.status.value],
      ["assignee", fields.assignee.value], ["holdReason", fields.holdReason.value],
      ["payment", fields.payment.value], ["search", fields.search.value], ["limit", limit],
      ["periodReference", periodReference],
    ]);
  }

  function exportSubtitle() {
    const parts = [];
    if (fields.group.value !== "all") parts.push(`Report section: ${GROUP_LABELS[fields.group.value]}`);
    if (selectedValuationType()) parts.push(`${GROUP_LABELS[fields.group.value]} type: ${fields.valuationType.selectedOptions[0].textContent}`);
    if (fields.institution.value) parts.push(`Institution: ${fields.institution.options[fields.institution.selectedIndex]?.textContent || fields.institution.value}`);
    if (fields.period.value) parts.push(`${periodBasisLabel()}: ${InstitutionMetrics.periodLabel(fields.period.value, periodReference)}`);
    if (fields.status.value) parts.push(`Status: ${fields.status.value}`);
    if (fields.assignee.value) parts.push(`Assigned to: ${fields.assignee.value}`);
    if (fields.holdReason.value) parts.push(`On hold: ${fields.holdReason.value}`);
    if (fields.preparationSource.value) parts.push(`Preparation: ${fields.preparationSource.selectedOptions[0].textContent}`);
    if (fields.payment.value) parts.push(`Payment: ${fields.payment.selectedOptions[0].textContent}`);
    if (activeInstitutionScope) parts.push("Active institutions only");
    if (fields.search.value.trim()) parts.push(`Search: ${fields.search.value.trim()}`);
    return parts.length ? parts.join(" · ") : "All assignments visible to the signed-in user";
  }

  function taskExportFileName(options) {
    const institution = { Bank: "All Banks", NBFC: "All NBFCs" }[options.institutionType] || options.institution;
    const payment = {
      [TaskStore.PAYMENT_STATUS_PAIRS.received]: "Received and Partially Received",
      [TaskStore.PAYMENT_STATUS_PAIRS.pending]: "Outstanding",
      [FEE_RECORDED]: "Fee Recorded",
    }[options.payment] || options.payment;
    const report = options.valuationType ? `${fields.valuationType.selectedOptions[0].textContent} ${GROUP_LABELS[options.group]}`
      : options.group === "all" ? "" : GROUP_LABELS[options.group];
    const period = options.period ? InstitutionMetrics.periodLabel(options.period, options.periodReference) : "";
    const preparation = options.preparationSource ? fields.preparationSource.selectedOptions[0].textContent : "";
    const section = paymentView ? "Payments" : "Assignments";
    let status = options.status;
    if (!status && !paymentView && !report && !institution && !payment && !period && !preparation) {
      status = options.search.trim() || options.assignee || options.holdReason ? "Filtered" : "All";
    }
    const basis = options.period && options.dateBasis === "status" ? `${options.status} Date` : "";
    const parts = ["ValuX", status, report, section, institution, payment, basis, period, preparation];
    const name = parts.filter(Boolean).join("_").replace(/[^a-z0-9_-]+/gi, "_").replace(/_+/g, "_");
    return `${name.slice(0, 115).replace(/_$/, "")}.xlsx`;
  }

  function taskExportOptions(tasks, { subtitle, fileName }) {
    return {
      title: "ValuX assignments",
      subtitle,
      sheetName: "Assignments",
      fileName,
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
      sheetName: "Institutions", fileName: "ValuX_Institution_Overview.xlsx",
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

  function selectedInstitutionType() {
    return { "type:Bank": "Bank", "type:NBFC": "NBFC" }[fields.institution.value] || "";
  }

  function summaryLabel() {
    if (activeInstitutionScope) return selectedInstitutionType() === "Bank" ? "Active banks" : "Active NBFCs";
    return { Bank: "All banks", NBFC: "All NBFCs" }[selectedInstitutionType()] || "All banks and NBFCs";
  }

  function renderPaymentBars({ earned, received, outstanding, counts }) {
    const earnedBar = { label: "Total Earned", amount: earned, color: "var(--blue)", filter: FEE_RECORDED };
    const receivedBar = { label: "Payment Received", amount: received, color: "#248c79", filter: TaskStore.PAYMENT_STATUS_PAIRS.received };
    const outstandingBar = { label: "Outstanding", amount: outstanding, color: "#c5754f", filter: TaskStore.PAYMENT_STATUS_PAIRS.pending };
    const bars = paymentView === "payment-outstanding"
      ? [outstandingBar, receivedBar, earnedBar]
      : [receivedBar, outstandingBar, earnedBar];
    const scale = Math.max(earned, received, outstanding) || 1;
    const chart = document.getElementById("payment-summary-bars");
    const focusedFilter = document.activeElement?.dataset.paymentBarFilter;
    chart.innerHTML = bars.map(({ label, amount, color, filter }) => {
      const selected = filter === fields.payment.value;
      return `<li><button type="button" class="payment-summary-bar" data-payment-bar-filter="${filter}" aria-pressed="${selected}">
        <span>${label}</span><span class="horizontal-track" aria-hidden="true"><i style="--width:${amount / scale * 100}%;--chart-color:${color}"></i></span>
        <strong>${WorkflowUI.currency(amount)}</strong>
      </button></li>`;
    }).join("");
    if (focusedFilter !== undefined) {
      Array.from(chart.querySelectorAll("[data-payment-bar-filter]"))
        .find((button) => button.dataset.paymentBarFilter === focusedFilter)?.focus({ preventScroll: true });
    }
    const statuses = ["Received", "Partially Received", "Pending"];
    for (const status of ["Overdue", "Not Set"]) {
      if (counts.has(status)) statuses.push(status);
    }
    document.getElementById("payment-status-counts").innerHTML = statuses.map((status) =>
      `<div><dt>${status}</dt><dd>${counts.get(status) || 0}</dd></div>`,
    ).join("");
  }

  function paymentScopeTasks(options) {
    const activeCodes = new Set(InstitutionMetrics.configured().map(({ code }) => code));
    return TaskStore.query({
      periodReference, ...options, institutionScope: "active", limit: Number.MAX_SAFE_INTEGER,
    }).items.filter((task) => task.status !== "Cancelled" && activeCodes.has(task.institutionCode));
  }

  function queryCachedTasks(options = queryOptions()) {
    if (options.payment !== FEE_RECORDED) return TaskStore.query(options);
    const tasks = paymentScopeTasks({ ...options, payment: "" }).filter((task) => TaskStore.paymentSummary(task).basis !== null);
    const { limit } = options;
    return { total: tasks.length, items: tasks.slice(0, limit), hasMore: tasks.length > limit };
  }

  // Institution drill-down and all-institutions directory rendering.
  function renderInstitutionDrilldown() {
    const institution = selectedInstitution();
    const host = document.getElementById("institution-drilldown");
    host.hidden = !paymentView && !institution && !summaryMode && !selectedInstitutionType();
    if (host.hidden) return;
    const { group, institution: institutionCode, institutionType, period, valuationType } = queryOptions();
    const tasks = paymentView
      ? paymentScopeTasks({ group, institution: institutionCode, institutionType, period, valuationType })
      : TaskStore.query(queryOptions(Number.MAX_SAFE_INTEGER)).items;
    const workflowChart = document.getElementById("institution-workflow-mix");
    const paymentChart = document.getElementById("institution-payment-summary");
    host.classList.toggle("is-payment-view", Boolean(paymentView));
    workflowChart.hidden = Boolean(paymentView);
    paymentChart.hidden = !paymentView;
    document.getElementById("institution-drilldown-label").textContent = paymentView ? "Payment summary" : "Institution view";
    document.getElementById("institution-drilldown-title").textContent = institution ? `${institution.code} · ${institution.name}` : summaryLabel();
    document.getElementById("institution-monogram").textContent = institution ? institution.code.slice(0, 4) : selectedInstitutionType() === "NBFC" ? "NBFC" : "ALL";
    document.getElementById("institution-monogram").style.setProperty("--institution-color", institution?.color || "#087ea4");
    document.querySelectorAll(".institution-summary-cards article:not(:first-child)").forEach((card) => {
      card.hidden = !institution && WorkflowAccess.currentRole() !== "father";
    });
    const summaryBasis = selectedDateBasis() === "status" ? `${paymentView ? "Assigned during" : periodBasisLabel()} ` : "";
    document.getElementById("institution-drilldown-subtitle").textContent = fields.period.value
      ? `${tasks.length} assignments · ${summaryBasis}${InstitutionMetrics.periodLabel(fields.period.value, periodReference)}`
      : `${tasks.length} assignments · all dates`;
    if (!paymentView) {
      const mix = InstitutionMetrics.workflowMix(tasks);
      const maximum = Math.max(1, ...mix.map((item) => item.count));
      workflowChart.innerHTML = mix.map((item) => {
        const width = item.count ? Math.max(5, Math.round((item.count / maximum) * 100)) : 0;
        return `<button type="button" data-workflow-state="${WorkflowUI.escape(item.key)}"${item.count ? "" : " disabled"}>
          <span>${WorkflowUI.escape(item.label)}</span><i><b style="--width:${width}%;--state-color:${item.color}"></b></i><strong>${item.count}</strong>
        </button>`;
      }).join("");
    }
    const billable = tasks.filter((task) => task.status !== "Cancelled");
    let earned = 0, received = 0, outstanding = 0;
    const counts = new Map();
    for (const task of billable) {
      const payment = TaskStore.paymentSummary(task);
      earned += Number(payment.basis || 0);
      received += Number(task.payment.received || 0);
      outstanding += Number(payment.outstanding || 0);
      counts.set(payment.status, (counts.get(payment.status) || 0) + 1);
    }
    if (paymentView) renderPaymentBars({ earned, received, outstanding, counts });
    const percent = (value) => earned ? `${Math.round((value / earned) * 100)}%` : "0%";
    document.getElementById("institution-total").textContent = tasks.length;
    document.getElementById("institution-earned").textContent = WorkflowUI.currency(earned);
    document.getElementById("institution-earned-count").textContent = `${billable.length} ${billable.length === 1 ? "report" : "reports"}`;
    document.getElementById("institution-received").textContent = WorkflowUI.currency(received);
    document.getElementById("institution-received-percent").textContent = percent(received);
    document.getElementById("institution-outstanding").textContent = WorkflowUI.currency(outstanding);
    document.getElementById("institution-outstanding-percent").textContent = percent(outstanding);
    workflowChart.querySelectorAll("[data-workflow-state]").forEach((button) => button.addEventListener("click", () => {
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
      : paymentView || summaryMode || selectedInstitutionType() ? `${label} · ${summaryLabel()}` : `${label} tasks`;
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
    if (paymentView) params.set("view", paymentView);
    else if (directoryMode && !selectedInstitution()) params.set("view", "institutions");
    else if (summaryMode || selectedInstitutionType()) params.set("view", "summary");
    if (fields.group.value !== "all") params.set("group", fields.group.value);
    if (selectedValuationType()) params.set("valuationType", selectedValuationType());
    if (selectedDateBasis() === "status") params.set("dateBasis", "status");
    if (activeInstitutionScope) params.set("institutionScope", "active");
    if (fields.period.value) params.set("periodReference", isoDate(periodReference));
    ["institution", "period", "status", "assignee", "holdReason", "payment", "preparationSource"].forEach((key) => {
      if (fields[key].value) params.set(key, fields[key].value);
    });
    if (fields.search.value.trim()) params.set("search", fields.search.value.trim());
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function needsFullAnalytics() {
    return Boolean(paymentView) || directoryMode || summaryMode || Boolean(selectedInstitution()) || Boolean(selectedInstitutionType());
  }

  async function ensureFullAnalytics() {
    if (!analyticsLoadPromise) {
      analyticsLoadPromise = TaskStore.loadAll().catch((error) => {
        analyticsLoadPromise = null;
        throw error;
      });
    }
    return analyticsLoadPromise;
  }

  async function resultForCurrentView() {
    if (needsFullAnalytics()) {
      await ensureFullAnalytics();
      return queryCachedTasks();
    }
    const items = [];
    let offset = 0;
    let total = 0;
    while (items.length < visible) {
      const page = await TaskStore.fetchTasks({
        ...queryOptions(Math.min(100, visible - items.length)), offset,
      });
      total = page.total;
      items.push(...page.items);
      offset += page.items.length;
      if (!page.hasMore || !page.items.length) break;
    }
    return { total, items, hasMore: items.length < total };
  }

  async function render() {
    const sequence = ++renderSequence;
    renderAssignmentFilters();
    list.setAttribute("aria-busy", "true");
    let result;
    try {
      result = await resultForCurrentView();
    } catch (error) {
      if (sequence !== renderSequence) return;
      WorkflowUI.fatal(error.message || "Assignments could not be loaded.");
      list.innerHTML = WorkflowUI.empty("Assignments could not be loaded. Refresh the page and try again.");
      loadMore.hidden = true;
      return;
    } finally {
      if (sequence === renderSequence) list.removeAttribute("aria-busy");
    }
    if (sequence !== renderSequence) return;
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

  async function allFilteredTasks(options, useCache) {
    if (useCache) {
      await ensureFullAnalytics();
      return queryCachedTasks(options).items;
    }
    const items = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await TaskStore.fetchTasks({ ...options, limit: 100, offset });
      items.push(...result.items);
      offset += result.items.length;
      hasMore = result.hasMore && result.items.length > 0;
    }
    return items;
  }

  async function exportTasks(button) {
    try {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("title", "Loading assignments…");
      const options = queryOptions(Number.MAX_SAFE_INTEGER);
      const details = { subtitle: exportSubtitle(), fileName: taskExportFileName(options) };
      const tasks = await allFilteredTasks(options, needsFullAnalytics());
      await WorkbookExport.fromButton(button, taskExportOptions(tasks, details));
    } catch (error) {
      window.alert(error.message || "The assignments could not be loaded for export.");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.setAttribute("title", "Export to Excel");
    }
  }

  const preparationFilterEnabled = WorkflowAccess.currentRole() === "father";
  document.getElementById("preparation-filter-wrap").hidden = !preparationFilterEnabled;
  document.getElementById("task-filters").classList.toggle("has-preparation-filter", preparationFilterEnabled);
  populateFilters();
  renderPeriodFilter();
  dateBasisControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date-basis]");
    if (!button || dateBasisControl.hidden || dateBasis === button.dataset.dateBasis) return;
    dateBasis = button.dataset.dateBasis;
    reset();
  });
  Object.entries(fields).forEach(([key, field]) => {
    if (key !== "period") field.addEventListener(key === "search" ? "input" : "change", () => {
      if (key === "institution") {
        summaryMode = true;
        activeInstitutionScope = Boolean(paymentView && selectedInstitutionType());
      }
      reset();
    });
  });
  document.getElementById("clear-institution").addEventListener("click", () => { window.location.href = "/tasks?view=institutions"; });
  document.getElementById("payment-summary-bars").addEventListener("click", (event) => {
    const bar = event.target.closest("[data-payment-bar-filter]");
    if (!bar || fields.payment.value === bar.dataset.paymentBarFilter) return;
    fields.payment.value = bar.dataset.paymentBarFilter;
    reset();
  });
  loadMore.addEventListener("click", () => { visible += PAGE_SIZE; render(); });
  document.getElementById("export-tasks").addEventListener("click", (event) => exportTasks(event.currentTarget));
  const institutionExport = document.getElementById("export-institutions");
  institutionExport.hidden = WorkflowAccess.currentRole() !== "father";
  institutionExport.addEventListener("click", async (event) => {
    try {
      await ensureFullAnalytics();
      await WorkbookExport.fromButton(event.currentTarget, institutionExportOptions());
    } catch (error) {
      window.alert(error.message || "The institution overview could not be loaded for export.");
    }
  });
  window.addEventListener("sln:tasks-changed", render);
  window.addEventListener("sln:payment-updated", render);
  render();
})();
