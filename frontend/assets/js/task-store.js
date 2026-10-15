(function () {
  "use strict";

  const STORAGE_KEY = "sln.workflow.tasks.v1";
  const STATUSES = ["Unassigned", "In Progress", "On Hold", "Completed", "Closed", "Cancelled"];
  const HOLD_REASONS = ["Awaiting Documents", "Scheduled Site Visit", "Awaiting Review", "Returned for Correction", "Custom"];
  const CANCELLATION_REASONS = ["Created by Mistake", "Wrong Details", "Custom"];
  const EMPLOYEES = ["K. Sivaprasad", "Lavakumar"];
  const REPORTS = {
    "valuation-general": { group: "valuation", code: "VAL", label: "General Property Valuation", route: "/valuation/general" },
    "valuation-agricultural": { group: "valuation", code: "VAL", label: "Agricultural Land Valuation", route: "/valuation/agricultural" },
    estimation: { group: "estimation", code: "EST", label: "Detailed Building Estimate", route: null },
    progress: { group: "progress", code: "PRG", label: "Construction Progress Report", route: null },
    completion: { group: "completion", code: "CMP", label: "Completion Report", route: null },
  };

  function authorName() {
    return window.WorkflowAccess ? WorkflowAccess.currentUser().name : "K. Sivaprasad";
  }

  function normalize(task) {
    const copy = { ...task };
    if (["New", "Assigned"].includes(copy.status)) copy.status = copy.assignee ? "In Progress" : "Unassigned";
    if (["Awaiting Review", "Returned for Correction"].includes(copy.status)) {
      copy.holdReason = copy.status;
      copy.status = "On Hold";
    }
    copy.assignee = copy.assignee || "";
    copy.holdReason = copy.holdReason || "";
    copy.reportGeneratedAt = copy.reportGeneratedAt || null;
    copy.completedAt = copy.completedAt || null;
    copy.closedAt = copy.closedAt || null;
    copy.payment = { estimated: 0, agreed: 0, received: 0, status: "Pending", updatedAt: null, ...(copy.payment || {}) };
    if (String(copy.payment.status).toLowerCase() === "partially received") copy.payment.status = "Partially Received";
    copy.activity = Array.isArray(copy.activity) ? copy.activity : [];
    return copy;
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(data) ? data.map(normalize) : [];
    } catch (_error) {
      return [];
    }
  }

  function save(tasks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (_error) {
      throw new Error("This browser could not save the assignment. Check that browser storage is enabled and try again.");
    }
    window.dispatchEvent(new CustomEvent("sln:tasks-changed"));
  }

  function timestamp() { return new Date().toISOString(); }
  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  function copyTask(task) {
    return typeof window.structuredClone === "function" ? window.structuredClone(task) : JSON.parse(JSON.stringify(task));
  }
  function customerToken(name) {
    const ignored = new Set(["MR", "MRS", "SMT", "SHRI", "SRI", "KUMAR", "SO", "DO", "WO"]);
    const words = String(name || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length >= 3 && !ignored.has(word));
    return (words[0] || "CUSTOMER").slice(0, 12);
  }
  function compactDate(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
    return match ? `${match[3]}${match[2]}${match[1].slice(-2)}` : "000000";
  }
  function nextTaskId(input, tasks) {
    const report = REPORTS[input.reportKey];
    const base = [input.institutionCode, customerToken(input.customerName), report.code, compactDate(input.assignedDate)].join("-");
    const duplicates = tasks.filter((task) => task.id === base || task.id.startsWith(`${base}-`));
    return duplicates.length ? `${base}-${String(duplicates.length + 1).padStart(2, "0")}` : base;
  }
  function addActivity(task, type, text, author = authorName()) {
    task.activity.push({ id: randomId(), type, author, text, createdAt: timestamp() });
  }

  function localDate(value) {
    if (!value) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function periodBounds(period, reference = new Date()) {
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

  function matchesPeriod(task, period = "monthly", field = "assignedDate") {
    const value = localDate(task[field]);
    if (!value) return false;
    const { start, end } = periodBounds(period);
    return value >= start && value < end;
  }

  function create(input) {
    const tasks = load();
    const report = REPORTS[input.reportKey];
    if (!report) throw new Error("Select a supported report type.");
    const now = timestamp();
    const assignee = String(input.assignee || "").trim();
    const task = {
      id: nextTaskId(input, tasks), reportKey: input.reportKey, reportGroup: report.group,
      reportLabel: report.label, reportName: `${input.customerName.trim()} – ${report.label}`,
      institutionType: input.institutionType, institutionCode: input.institutionCode,
      institutionName: input.institutionName, branch: input.branch.trim(), customerName: input.customerName.trim(),
      propertyBrief: input.propertyBrief.trim(), assignee, priority: input.priority,
      status: assignee ? "In Progress" : "Unassigned", holdReason: "", assignedDate: input.assignedDate,
      dueDate: input.dueDate, createdAt: now, updatedAt: now, reportGeneratedAt: null,
      completedAt: null, closedAt: null,
      payment: { estimated: 0, agreed: 0, received: 0, status: "Pending", updatedAt: null }, activity: [],
    };
    addActivity(task, "created", assignee ? `Assignment created and routed to ${assignee}.` : "Assignment created without an assignee.");
    if (input.initialNote) addActivity(task, "note", input.initialNote.trim());
    tasks.push(task);
    save(tasks);
    return task;
  }

  function get(taskId) { return load().find((task) => task.id === taskId) || null; }
  function replace(taskId, mutate) {
    const tasks = load();
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new Error("Task not found.");
    const copy = copyTask(tasks[index]);
    mutate(copy);
    copy.updatedAt = timestamp();
    tasks[index] = copy;
    save(tasks);
    return copy;
  }
  function addNote(taskId, text) {
    const note = String(text || "").trim();
    if (!note) throw new Error("Enter a work note.");
    return replace(taskId, (task) => addActivity(task, "note", note));
  }
  function assign(taskId, assignee, note) {
    const target = String(assignee || "").trim();
    const workNote = String(note || "").trim();
    if (!target) throw new Error("Select an employee.");
    if (!workNote) throw new Error("Add a work note for the assignment or transfer.");
    return replace(taskId, (task) => {
      if (!["Unassigned", "In Progress", "On Hold"].includes(task.status)) throw new Error("This task cannot be assigned in its current state.");
      const previous = task.assignee;
      task.assignee = target;
      task.status = "In Progress";
      task.holdReason = "";
      addActivity(task, "assignment", previous ? `Task transferred from ${previous} to ${target}.` : `Task assigned to ${target} and started.`);
      addActivity(task, "note", workNote);
    });
  }
  function putOnHold(taskId, reason, note) {
    const holdReason = String(reason || "").trim();
    const workNote = String(note || "").trim();
    if (!HOLD_REASONS.includes(holdReason)) throw new Error("Select a valid on-hold reason.");
    if (!workNote) throw new Error("Add a work note for this status change.");
    return replace(taskId, (task) => {
      if (!task.assignee || !["In Progress", "On Hold"].includes(task.status)) throw new Error("Only active assigned work can be placed on hold.");
      const previousReason = task.holdReason;
      task.status = "On Hold";
      task.holdReason = holdReason;
      addActivity(task, "status", previousReason ? `On-hold reason changed from ${previousReason} to ${holdReason}.` : `Task placed on hold: ${holdReason}.`);
      addActivity(task, "note", workNote);
    });
  }
  function resume(taskId, note) {
    const workNote = String(note || "").trim();
    if (!workNote) throw new Error("Add a work note before resuming the task.");
    return replace(taskId, (task) => {
      if (task.status !== "On Hold") throw new Error("Only an on-hold task can be resumed.");
      const reason = task.holdReason;
      task.status = "In Progress";
      task.holdReason = "";
      addActivity(task, "status", `Task resumed from On Hold${reason ? ` (${reason})` : ""}.`);
      addActivity(task, "note", workNote);
    });
  }
  function markReportGenerated(taskId, format) {
    return replace(taskId, (task) => {
      task.reportGeneratedAt = timestamp();
      addActivity(task, "report", `${String(format || "report").toUpperCase()} report generated successfully.`);
    });
  }
  function complete(taskId, note) {
    const workNote = String(note || "").trim();
    if (!workNote) throw new Error("Add a completion work note.");
    return replace(taskId, (task) => {
      if (task.status !== "In Progress" || !task.reportGeneratedAt) throw new Error("Generate the report successfully before completing the task.");
      task.status = "Completed";
      task.completedAt = timestamp();
      addActivity(task, "status", "Task marked Completed after report generation.");
      addActivity(task, "note", workNote);
    });
  }
  function updatePayment(taskId, values) {
    const note = String(values.note || "").trim();
    return replace(taskId, (task) => {
      if (task.status === "Cancelled") throw new Error("Payment cannot be updated for a cancelled task.");
      const estimated = Math.max(0, Number(values.estimated) || 0);
      const agreed = Math.max(0, Number(values.agreed) || 0);
      const received = Math.max(0, Number(values.received) || 0);
      const status = received <= 0 ? "Pending" : received < agreed ? "Partially Received" : "Received";
      task.payment = { estimated, agreed, received, status, updatedAt: timestamp() };
      addActivity(task, "payment", `Payment updated: ${status}; outstanding ₹${Math.max(0, agreed - received).toLocaleString("en-IN")}.`);
      if (note) addActivity(task, "note", note);
    });
  }
  function close(taskId, note) {
    return replace(taskId, (task) => {
      const outstanding = Math.max(0, Number(task.payment.agreed) - Number(task.payment.received));
      if (task.status !== "Completed" || task.payment.status !== "Received" || outstanding !== 0) throw new Error("Close is available only when payment is Received and outstanding is ₹0.");
      task.status = "Closed";
      task.closedAt = timestamp();
      addActivity(task, "status", "Request closed after payment settlement.");
      if (String(note || "").trim()) addActivity(task, "note", String(note).trim());
    });
  }
  function cancel(taskId, reason, note) {
    if (!CANCELLATION_REASONS.includes(reason)) throw new Error("Select a valid cancellation reason.");
    if (reason === "Custom" && !String(note || "").trim()) throw new Error("For Custom, explain the cancellation in the work note.");
    return replace(taskId, (task) => {
      task.status = "Cancelled";
      task.holdReason = "";
      addActivity(task, "cancelled", `Task cancelled. Reason: ${reason}.`);
      if (String(note || "").trim()) addActivity(task, "note", String(note).trim());
    });
  }
  function query(options = {}) {
    const search = String(options.search || "").trim().toLowerCase();
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 20);
    let tasks = load().filter((task) => {
      if (window.WorkflowAccess && !WorkflowAccess.visible(task)) return false;
      if (options.group && options.group !== "all" && task.reportGroup !== options.group) return false;
      if (options.status && task.status !== options.status) return false;
      if (options.assignee && task.assignee !== options.assignee) return false;
      if (options.holdReason && task.holdReason !== options.holdReason) return false;
      if (options.payment && task.payment.status !== options.payment) return false;
      if (options.institution && task.institutionCode !== options.institution) return false;
      if (options.period && !matchesPeriod(task, options.period)) return false;
      if (search) {
        const haystack = [task.id, task.customerName, task.reportName, task.assignee, task.institutionName, task.institutionCode, task.branch, task.propertyBrief, task.status, task.holdReason, task.payment.status].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    tasks.sort((a, b) => {
      if (options.status === "On Hold" && window.WorkflowAccess?.currentRole() === "father") {
        const reviewDifference = Number(b.holdReason === "Awaiting Review") - Number(a.holdReason === "Awaiting Review");
        if (reviewDifference) return reviewDifference;
      }
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    return { total: tasks.length, items: tasks.slice(offset, offset + limit), hasMore: offset + limit < tasks.length };
  }
  function summary(group = "all") {
    const tasks = load().filter((task) => (!window.WorkflowAccess || WorkflowAccess.visible(task)) && (group === "all" || task.reportGroup === group));
    const count = (status) => tasks.filter((task) => task.status === status).length;
    return {
      total: tasks.length, unassigned: count("Unassigned"), inProgress: count("In Progress"), onHold: count("On Hold"),
      awaitingReview: tasks.filter((task) => task.status === "On Hold" && task.holdReason === "Awaiting Review").length,
      completed: count("Completed"), closed: count("Closed"), cancelled: count("Cancelled"),
    };
  }
  function ensureSamples() {
    if (load().length) return;
    const now = new Date();
    const date = (offset) => { const value = new Date(now); value.setDate(value.getDate() + offset); return value.toISOString().slice(0, 10); };
    const samples = [
      { institutionType: "Bank", institutionCode: "BOB", institutionName: "Bank of Baroda", branch: "Adoni", customerName: "Kuruba Siva Prasad", propertyBrief: "Residential property, Adoni", reportKey: "valuation-general", assignee: "K. Sivaprasad", priority: "Normal", assignedDate: date(-1), dueDate: date(6), initialNote: "Acknowledged for valuation." },
      { institutionType: "Bank", institutionCode: "APGB", institutionName: "Andhra Pradesh Grameena Bank", branch: "Yemmiganur", customerName: "Renu", propertyBrief: "Agricultural land near Yemmiganur", reportKey: "valuation-agricultural", assignee: "Lavakumar", priority: "High", assignedDate: date(-2), dueDate: date(5), initialNote: "Documents received for initial review." },
      { institutionType: "Bank", institutionCode: "KVB", institutionName: "Karur Vysya Bank", branch: "Adoni", customerName: "Amarnath Reddy", propertyBrief: "Residential plot", reportKey: "valuation-general", assignee: "", priority: "Normal", assignedDate: date(0), dueDate: date(7), initialNote: "Awaiting assignment." },
      { institutionType: "NBFC", institutionCode: "HDBFS", institutionName: "HDB Financial Services", branch: "Kurnool", customerName: "Madhava Gururaj", propertyBrief: "Industrial land and building", reportKey: "valuation-general", assignee: "Lavakumar", priority: "Urgent", assignedDate: date(-4), dueDate: date(2), initialNote: "Submit for review after document check." },
      { institutionType: "Bank", institutionCode: "PNB", institutionName: "Punjab National Bank", branch: "Adoni", customerName: "Lakshmi Devi", propertyBrief: "Residential building", reportKey: "valuation-general", assignee: "K. Sivaprasad", priority: "Normal", assignedDate: date(-8), dueDate: date(-1), initialNote: "Sample completed assignment." },
      { institutionType: "Bank", institutionCode: "CUB", institutionName: "City Union Bank", branch: "Adoni", customerName: "Ramesh Babu", propertyBrief: "Commercial property", reportKey: "valuation-general", assignee: "K. Sivaprasad", priority: "Normal", assignedDate: date(-14), dueDate: date(-7), initialNote: "Sample settled assignment." },
    ];
    const created = samples.map((sample) => create(sample));
    putOnHold(created[1].id, "Awaiting Review", "Report draft is ready for review.");
    putOnHold(created[3].id, "Awaiting Documents", "Legal scrutiny report is pending.");
    markReportGenerated(created[4].id, "docx");
    complete(created[4].id, "Report generated and completed.");
    updatePayment(created[4].id, { estimated: 5000, agreed: 4500, received: 2500, note: "Part payment received." });
    markReportGenerated(created[5].id, "pdf");
    complete(created[5].id, "Report issued to the bank.");
    updatePayment(created[5].id, { estimated: 4000, agreed: 4000, received: 4000, note: "Full payment received." });
    close(created[5].id, "Payment settled and request closed.");
  }

  window.TaskStore = {
    STATUSES, HOLD_REASONS, CANCELLATION_REASONS, EMPLOYEES, REPORTS,
    create, get, query, summary, addNote, assign, putOnHold, resume,
    markReportGenerated, complete, updatePayment, close, cancel, ensureSamples,
    matchesPeriod, periodBounds, all: load,
  };
})();
