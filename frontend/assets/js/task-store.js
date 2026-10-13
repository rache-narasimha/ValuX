(function () {
  "use strict";

  const STORAGE_KEY = "sln.workflow.tasks.v1";
  const STATUSES = [
    "New",
    "Assigned",
    "In Progress",
    "On Hold",
    "Awaiting Review",
    "Returned for Correction",
    "Completed",
    "Closed",
    "Cancelled",
  ];
  const REPORTS = {
    "valuation-general": {
      group: "valuation",
      code: "VAL",
      label: "General Property Valuation",
      route: "/valuation/general",
    },
    "valuation-agricultural": {
      group: "valuation",
      code: "VAL",
      label: "Agricultural Land Valuation",
      route: "/valuation/agricultural",
    },
    estimation: {
      group: "estimation",
      code: "EST",
      label: "Detailed Building Estimate",
      route: null,
    },
    progress: {
      group: "progress",
      code: "PRG",
      label: "Construction Progress Report",
      route: null,
    },
    completion: {
      group: "completion",
      code: "CMP",
      label: "Completion Report",
      route: null,
    },
  };

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (_error) {
      return [];
    }
  }

  function save(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent("sln:tasks-changed"));
  }

  function timestamp() {
    return new Date().toISOString();
  }

  function customerToken(name) {
    const ignored = new Set(["MR", "MRS", "SMT", "SHRI", "SRI", "KUMAR", "SO", "DO", "WO"]);
    const words = String(name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !ignored.has(word));
    return (words[0] || "CUSTOMER").slice(0, 12);
  }

  function compactDate(isoDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
    if (!match) return "000000";
    return `${match[3]}${match[2]}${match[1].slice(-2)}`;
  }

  function nextTaskId(input, tasks) {
    const report = REPORTS[input.reportKey];
    const base = [
      input.institutionCode,
      customerToken(input.customerName),
      report.code,
      compactDate(input.assignedDate),
    ].join("-");
    const duplicates = tasks.filter((task) => task.id === base || task.id.startsWith(`${base}-`));
    return duplicates.length ? `${base}-${String(duplicates.length + 1).padStart(2, "0")}` : base;
  }

  function create(input) {
    const tasks = load();
    const report = REPORTS[input.reportKey];
    if (!report) throw new Error("Select a supported report type.");
    const now = timestamp();
    const task = {
      id: nextTaskId(input, tasks),
      reportKey: input.reportKey,
      reportGroup: report.group,
      reportLabel: report.label,
      reportName: `${input.customerName.trim()} – ${report.label}`,
      institutionType: input.institutionType,
      institutionCode: input.institutionCode,
      institutionName: input.institutionName,
      branch: input.branch.trim(),
      customerName: input.customerName.trim(),
      propertyBrief: input.propertyBrief.trim(),
      assignee: input.assignee,
      priority: input.priority,
      status: "Assigned",
      holdReason: "",
      assignedDate: input.assignedDate,
      dueDate: input.dueDate,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      payment: { estimated: 0, agreed: 0, received: 0, status: "Pending" },
      activity: [
        {
          id: crypto.randomUUID(),
          type: "created",
          author: "K. Sivaprasad",
          text: `Assignment created and assigned to ${input.assignee}.`,
          createdAt: now,
        },
      ],
    };
    if (input.initialNote) {
      task.activity.push({
        id: crypto.randomUUID(),
        type: "note",
        author: "K. Sivaprasad",
        text: input.initialNote.trim(),
        createdAt: now,
      });
    }
    tasks.push(task);
    save(tasks);
    return task;
  }

  function get(taskId) {
    return load().find((task) => task.id === taskId) || null;
  }

  function replace(taskId, mutate) {
    const tasks = load();
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new Error("Task not found.");
    const copy = structuredClone(tasks[index]);
    mutate(copy);
    copy.updatedAt = timestamp();
    tasks[index] = copy;
    save(tasks);
    return copy;
  }

  function addActivity(task, type, text, author = "K. Sivaprasad") {
    task.activity.push({ id: crypto.randomUUID(), type, author, text, createdAt: timestamp() });
  }

  function addNote(taskId, text) {
    return replace(taskId, (task) => addActivity(task, "note", text.trim()));
  }

  function updateStatus(taskId, status, note, holdReason = "") {
    return replace(taskId, (task) => {
      const previous = task.status;
      task.status = status;
      task.holdReason = status === "On Hold" ? holdReason : "";
      task.completedAt = ["Completed", "Closed"].includes(status) ? timestamp() : null;
      const reason = task.holdReason ? ` (${task.holdReason})` : "";
      addActivity(task, "status", `Status changed from ${previous} to ${status}${reason}.`);
      if (note) addActivity(task, "note", note.trim());
    });
  }

  function reassign(taskId, assignee, note) {
    return replace(taskId, (task) => {
      const previous = task.assignee;
      task.assignee = assignee;
      task.status = task.status === "New" ? "Assigned" : task.status;
      addActivity(task, "assignment", `Task reassigned from ${previous} to ${assignee}.`);
      addActivity(task, "note", note.trim());
    });
  }

  function updatePayment(taskId, values) {
    return replace(taskId, (task) => {
      const agreed = Math.max(0, Number(values.agreed) || 0);
      const received = Math.max(0, Number(values.received) || 0);
      const status = received <= 0 ? "Pending" : received < agreed ? "Partially received" : "Received";
      task.payment = {
        estimated: Math.max(0, Number(values.estimated) || 0),
        agreed,
        received,
        status,
      };
      addActivity(task, "payment", `Payment updated: ${status}.`);
    });
  }

  function cancel(taskId, reason) {
    return replace(taskId, (task) => {
      task.status = "Cancelled";
      task.holdReason = "";
      addActivity(task, "cancelled", `Task cancelled. Reason: ${reason.trim()}`);
    });
  }

  function query(options = {}) {
    const search = String(options.search || "").trim().toLowerCase();
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 20);
    let tasks = load().filter((task) => {
      if (options.group && options.group !== "all" && task.reportGroup !== options.group) return false;
      if (options.status && task.status !== options.status) return false;
      if (options.assignee && task.assignee !== options.assignee) return false;
      if (search) {
        const haystack = [task.id, task.customerName, task.reportName, task.assignee, task.institutionName, task.branch, task.propertyBrief].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    tasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return { total: tasks.length, items: tasks.slice(offset, offset + limit), hasMore: offset + limit < tasks.length };
  }

  function summary(group = "all") {
    const tasks = load().filter((task) => group === "all" || task.reportGroup === group);
    const count = (status) => tasks.filter((task) => task.status === status).length;
    return {
      total: tasks.length,
      assigned: count("Assigned"),
      inProgress: count("In Progress"),
      onHold: count("On Hold"),
      awaitingReview: count("Awaiting Review"),
      completed: tasks.filter((task) => ["Completed", "Closed"].includes(task.status)).length,
    };
  }

  window.TaskStore = {
    STATUSES,
    REPORTS,
    create,
    get,
    query,
    summary,
    addNote,
    updateStatus,
    reassign,
    updatePayment,
    cancel,
    all: load,
  };
})();
