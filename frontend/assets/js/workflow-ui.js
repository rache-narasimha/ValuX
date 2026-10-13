(function () {
  "use strict";

  function escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function date(value) {
    if (!value) return "—";
    const source = value.length === 10 ? `${value}T00:00:00` : value;
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(source));
  }

  function currency(value) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function taskRow(task) {
    const hold = task.status === "On Hold" && task.holdReason ? ` · ${escape(task.holdReason)}` : "";
    return `<a class="task-row" href="/tasks/detail?id=${encodeURIComponent(task.id)}">
      <div class="task-row-main">
        <p class="task-id">${escape(task.id)}</p>
        <h3>${escape(task.reportName)}</h3>
        <p>${escape(task.institutionCode)} · ${escape(task.branch)} · Assigned to ${escape(task.assignee)}</p>
      </div>
      <div class="task-row-meta">
        <span class="status-badge status-${escape(task.status.toLowerCase().replaceAll(" ", "-"))}">${escape(task.status)}${hold}</span>
        <small>Due ${date(task.dueDate)}</small>
      </div>
      <span class="row-arrow" aria-hidden="true">›</span>
    </a>`;
  }

  function empty(message) {
    return `<div class="empty-state compact-empty"><strong>No tasks to show</strong><p>${escape(message)}</p></div>`;
  }

  window.WorkflowUI = { escape, date, currency, taskRow, empty };
})();
