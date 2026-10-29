/** Authenticated workflow API adapter with a page-session task cache. */
(function () {
  "use strict";

  const STATUSES = ["Unassigned", "In Progress", "On Hold", "Completed", "Closed", "Cancelled"];
  const HOLD_REASONS = ["Awaiting Documents", "Scheduled Site Visit", "Awaiting Review", "Returned for Correction", "Custom"];
  const CANCELLATION_REASONS = ["Created by Mistake", "Wrong Details", "Custom"];
  const EMPLOYEES = window.__VALUX_BUSINESS_CONTEXT__?.employees || [];
  const PRIORITY_DUE_DAYS = {
    Urgent: { suggested: 0, maximum: 1 },
    High: { suggested: 1, maximum: 2 },
    Normal: { suggested: 2, maximum: 4 },
  };
  const REPORTS = {
    "valuation-general": { group: "valuation", code: "VAL", label: "General Property Valuation", route: "/valuation/general" },
    "valuation-agricultural": { group: "valuation", code: "VAL", label: "Agricultural Land Valuation", route: "/valuation/agricultural" },
    estimation: { group: "estimation", code: "EST", label: "Detailed Building Estimate", route: "/estimation" },
    progress: { group: "progress", code: "PRG", label: "Construction Progress Report", route: "/progress-completion" },
    completion: { group: "completion", code: "CMP", label: "Completion Report", route: "/progress-completion" },
  };
  const REOPEN_WINDOW_DAYS = 7;
  const remoteMode = true;
  const remoteTasks = new Map();

  function copyTask(task) {
    return typeof window.structuredClone === "function" ? window.structuredClone(task) : JSON.parse(JSON.stringify(task));
  }

  function localDate(value) {
    if (!value) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(value, amount) {
    const date = localDate(value);
    if (!date) return "";
    date.setDate(date.getDate() + Number(amount || 0));
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function periodBounds(period, reference = new Date()) {
    reference = localDate(reference) || new Date();
    const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const end = new Date(start);
    if (period === "daily") {
      end.setDate(end.getDate() + 1);
    } else if (period === "weekly") {
      const mondayOffset = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - mondayOffset);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 7);
    } else if (period === "yearly") {
      start.setMonth(0, 1);
      end.setFullYear(start.getFullYear() + 1, 0, 1);
    } else {
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 1);
    }
    return { start, end };
  }

  function matchesPeriod(task, period = "monthly", field = "assignedDate", reference = new Date()) {
    const value = localDate(task[field]);
    if (!value) return false;
    const { start, end } = periodBounds(period, reference);
    return value >= start && value < end;
  }

  function numericOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(String(value).replaceAll(",", ""));
    if (!Number.isFinite(number) || number < 0) throw new Error("Payment amounts must be valid positive numbers or left blank.");
    return number;
  }

  function billingBasis(payment) {
    const agreed = numericOrNull(payment?.agreed);
    if (agreed !== null) return { amount: agreed, source: "Agreed fee" };
    const estimated = numericOrNull(payment?.estimated);
    return estimated !== null ? { amount: estimated, source: "Estimated fee" } : null;
  }

  function paymentSummary(task, reference = new Date()) {
    const payment = task?.payment || {};
    const basis = billingBasis(payment);
    const received = numericOrNull(payment.received) || 0;
    if (!basis) return { basis: null, basisSource: "", outstanding: null, status: "Not Set", overdue: false, outsideStandard: false };
    const outstanding = Math.max(0, basis.amount - received);
    const due = localDate(payment.dueDate);
    const current = localDate(reference) || new Date();
    const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const overdue = Boolean(due && today > due && outstanding > 0);
    const status = overdue ? "Overdue" : received <= 0 ? "Pending" : outstanding > 0 ? "Partially Received" : "Received";
    const standardMaximum = task?.completedAt ? localDate(addDays(task.completedAt, 7)) : null;
    const outsideStandard = Boolean(due && standardMaximum && due > standardMaximum);
    return { basis: basis.amount, basisSource: basis.source, outstanding, status, overdue, outsideStandard };
  }

  function dueDateRange(priority, assignedDate) {
    const rule = PRIORITY_DUE_DAYS[priority] || PRIORITY_DUE_DAYS.Normal;
    return { suggested: addDays(assignedDate, rule.suggested), maximum: addDays(assignedDate, rule.maximum) };
  }

  function normalize(task) {
    const copy = { ...task };
    copy.assignee = copy.assignee || "";
    copy.holdReason = copy.holdReason || "";
    copy.reportGeneratedAt = copy.reportGeneratedAt || null;
    copy.latestDocx = copy.latestDocx || null;
    copy.finalDocx = copy.finalDocx || null;
    copy.latestXlsx = copy.latestXlsx || null;
    copy.finalXlsx = copy.finalXlsx || null;
    copy.latestInstitutionArtifact = copy.latestInstitutionArtifact || null;
    copy.finalInstitutionArtifact = copy.finalInstitutionArtifact || null;
    copy.linkedEstimationId = copy.linkedEstimationId || "";
    copy.estimationSummary = copy.estimationSummary || null;
    copy.progressSummary = copy.progressSummary || null;
    copy.completedAt = copy.completedAt || null;
    copy.closedAt = copy.closedAt || null;
    copy.reopenedAt = copy.reopenedAt || null;
    copy.payment = { estimated: null, agreed: null, received: 0, dueDate: null, status: "Not Set", updatedAt: null, ...(copy.payment || {}) };
    Object.assign(copy.payment, paymentSummary(copy));
    copy.activity = Array.isArray(copy.activity) ? copy.activity : [];
    return copy;
  }

  function cacheRemote(task, _previous = remoteTasks.get(task?.id), silent = false) {
    if (!task) return null;
    const normalized = normalize(task);
    remoteTasks.set(normalized.id, normalized);
    if (!silent) window.dispatchEvent(new CustomEvent("sln:tasks-changed"));
    return normalized;
  }

  function all() { return Array.from(remoteTasks.values()).map((task) => normalize(copyTask(task))); }
  function get(taskId) { const task = remoteTasks.get(taskId); return task ? normalize(copyTask(task)) : null; }

  async function loadTask(taskId) {
    const payload = await BusinessApi.get(`/api/tasks/${encodeURIComponent(taskId)}`);
    return cacheRemote(payload.task);
  }

  async function loadAll() {
    const collected = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const payload = await BusinessApi.get("/api/tasks", { offset, limit: 100 });
      collected.push(...payload.items);
      offset += payload.items.length;
      hasMore = payload.hasMore && payload.items.length > 0;
    }
    remoteTasks.clear();
    collected.forEach((task) => cacheRemote(task, null, true));
    window.dispatchEvent(new CustomEvent("sln:tasks-changed"));
    return all();
  }

  async function fetchTasks(options = {}) {
    const queryValues = { ...options };
    if (queryValues.periodReference instanceof Date) {
      const value = queryValues.periodReference;
      queryValues.periodReference = [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
    }
    const payload = await BusinessApi.get("/api/tasks", queryValues);
    payload.items.forEach((task) => cacheRemote(task, remoteTasks.get(task.id), true));
    return { total: payload.total, items: payload.items.map((task) => get(task.id)), hasMore: payload.hasMore };
  }

  async function remoteAction(taskId, action, values = {}) {
    const current = remoteTasks.get(taskId) || await loadTask(taskId);
    const payload = await BusinessApi.post(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, { version: current.version, ...values });
    return cacheRemote(payload.task, current);
  }

  function create(input) { return BusinessApi.post("/api/tasks", input).then((payload) => cacheRemote(payload.task)); }
  function addNote(taskId, note) { return remoteAction(taskId, "notes", { note: String(note || "").trim() }); }
  function assign(taskId, assignee, note) { return remoteAction(taskId, "assign", { assignee, note }); }
  function putOnHold(taskId, reason, note) { return remoteAction(taskId, "hold", { reason, note }); }
  function resume(taskId, note) { return remoteAction(taskId, "resume", { note }); }
  function markReportGenerated(taskId, format) { return remoteAction(taskId, "report-generated", { format }); }
  function complete(taskId, note) { return remoteAction(taskId, "complete", { note }); }
  function updatePayment(taskId, values) { return remoteAction(taskId, "payment", values); }
  function close(taskId, note) { return remoteAction(taskId, "close", { note }); }
  function reopen(taskId, note) { return remoteAction(taskId, "reopen", { note }); }
  function cancel(taskId, reason, note) { return remoteAction(taskId, "cancel", { reason, note }); }

  async function removeInstitutionArtifact(taskId) {
    const payload = await BusinessApi.delete(`/api/tasks/${encodeURIComponent(taskId)}/artifacts/latest`);
    return cacheRemote(payload.task);
  }

  function requiredArtifactLabel(task) {
    if (task?.reportGroup === "estimation") return "completed Excel report";
    if (task?.institutionCode === "KVB") return "completed KVB Excel report";
    if (task?.institutionCode === "KB") return "completed Valocity DOCX or PDF report";
    return "DOCX";
  }

  function latestArtifact(task) {
    if (task?.reportGroup === "estimation" || task?.institutionCode === "KVB") return task?.latestXlsx;
    if (task?.institutionCode === "KB") return task?.latestInstitutionArtifact;
    return task?.latestDocx;
  }

  function finalArtifact(task) {
    if (task?.reportGroup === "estimation" || task?.institutionCode === "KVB") return task?.finalXlsx;
    if (task?.institutionCode === "KB") return task?.finalInstitutionArtifact;
    return task?.finalDocx;
  }

  function requiresInstitutionOfflineArtifact(task) { return task?.reportGroup === "valuation" && ["KVB", "KB"].includes(task.institutionCode); }

  function hasFreshRequiredArtifact(task) {
    const artifact = latestArtifact(task);
    if (!artifact?.url || !artifact.generatedAt) return false;
    return !task.reopenedAt || new Date(artifact.generatedAt) >= new Date(task.reopenedAt);
  }

  function reopenReferenceAt(task) { return task && ["Completed", "Closed"].includes(task.status) ? task.closedAt || task.completedAt || "" : ""; }
  function reopenDeadline(task) { const reference = reopenReferenceAt(task); return reference ? addDays(reference, REOPEN_WINDOW_DAYS) : ""; }
  function canReopen(task, reference = new Date()) {
    if (!reopenReferenceAt(task)) return false;
    const deadline = localDate(reopenDeadline(task));
    const current = localDate(reference);
    if (!deadline || !current) return false;
    deadline.setHours(23, 59, 59, 999);
    return current <= deadline;
  }

  function storageStatus() {
    return window.BusinessApi && window.__VALUX_AUTH_CONTEXT__?.user
      ? { ok: true, error: null }
      : { ok: false, error: "The authenticated workflow service is unavailable. Refresh the page and sign in again." };
  }

  function query(options = {}) {
    const search = String(options.search || "").trim().toLowerCase();
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 20);
    let tasks = all().filter((task) => {
      if (window.WorkflowAccess && !WorkflowAccess.visible(task)) return false;
      if (options.group && options.group !== "all" && task.reportGroup !== options.group) return false;
      if (options.status && task.status !== options.status) return false;
      if (options.assignee && task.assignee !== options.assignee) return false;
      if (options.holdReason && task.holdReason !== options.holdReason) return false;
      if (options.payment && task.payment.status !== options.payment) return false;
      if (options.institution && task.institutionCode !== options.institution) return false;
      if (options.period && !matchesPeriod(task, options.period, "assignedDate", options.periodReference)) return false;
      if (search) {
        const haystack = [task.id, task.customerName, task.reportName, task.assignee, task.institutionName, task.institutionCode, task.branch, task.propertyBrief, task.status, task.holdReason, task.payment.status].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    tasks.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    return { total: tasks.length, items: tasks.slice(offset, offset + limit), hasMore: offset + limit < tasks.length };
  }

  function summary(group = "all") {
    const tasks = all().filter((task) => (!window.WorkflowAccess || WorkflowAccess.visible(task)) && (group === "all" || task.reportGroup === group));
    const count = (status) => tasks.filter((task) => task.status === status).length;
    return {
      total: tasks.length, unassigned: count("Unassigned"), inProgress: count("In Progress"), onHold: count("On Hold"),
      awaitingReview: tasks.filter((task) => task.status === "On Hold" && task.holdReason === "Awaiting Review").length,
      completed: count("Completed"), closed: count("Closed"), cancelled: count("Cancelled"),
    };
  }

  function estimationCandidates() {
    return all().filter((task) => task.reportGroup === "estimation" && ["Completed", "Closed"].includes(task.status)
      && task.latestXlsx?.url && task.estimationSummary?.components?.length);
  }

  async function progressReportsFor(estimationId) {
    const payload = await BusinessApi.get(`/api/estimations/${encodeURIComponent(estimationId)}/progress-reports`);
    payload.items.forEach((task) => cacheRemote(task, remoteTasks.get(task.id), true));
    return payload.items.map((task) => get(task.id));
  }

  async function eligibleEstimations(reportKey, assignedDate, options = {}) {
    const payload = await BusinessApi.get("/api/estimations/eligible", {
      reportKey, assignedDate, search: options.search || "", institution: options.institution || "",
      status: options.status || "", offset: options.offset || 0, limit: options.limit || 20,
    });
    payload.items.forEach((task) => cacheRemote(task, remoteTasks.get(task.id), true));
    return payload;
  }

  if (window.__VALUX_BUSINESS_CONTEXT__?.task) cacheRemote(window.__VALUX_BUSINESS_CONTEXT__.task, null, true);
  if (window.__VALUX_BUSINESS_CONTEXT__?.linkedTask) cacheRemote(window.__VALUX_BUSINESS_CONTEXT__.linkedTask, null, true);

  window.TaskStore = {
    STATUSES, HOLD_REASONS, CANCELLATION_REASONS, EMPLOYEES, REPORTS,
    create, get, query, summary, addNote, assign, putOnHold, resume,
    markReportGenerated, complete, updatePayment, close, reopen, cancel, removeInstitutionArtifact,
    matchesPeriod, periodBounds, dueDateRange, billingBasis, paymentSummary, all,
    canReopen, reopenDeadline, storageStatus, requiredArtifactLabel, latestArtifact,
    finalArtifact, hasFreshRequiredArtifact, requiresInstitutionOfflineArtifact, estimationCandidates, progressReportsFor,
    loadAll, loadTask, refresh: loadTask, acceptServerTask: cacheRemote, fetchTasks, eligibleEstimations,
    ready: loadAll, remoteMode, REOPEN_WINDOW_DAYS,
  };
})();
