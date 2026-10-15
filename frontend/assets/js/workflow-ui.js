(function () {
  "use strict";

  function escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function date(value) {
    if (!value) return "—";
    const source = value.length === 10 ? `${value}T00:00:00` : value;
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(source));
  }

  function currency(value) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function statusClass(status) {
    return `status-${String(status || "").toLowerCase().replaceAll(" ", "-")}`;
  }

  function paymentClass(status) {
    return `payment-${String(status || "pending").toLowerCase().replaceAll(" ", "-")}`;
  }

  const CHART_COLORS = ["#087ea4", "#e17b42", "#49a078", "#7b6fc2", "#d5a12d", "#d85c70", "#399bb0", "#8b67a9", "#5a9c45", "#c66b2c", "#3e6daf", "#b84b87", "#68858f", "#9a7b25"];

  function chartColor(index) {
    return CHART_COLORS[Math.abs(Number(index) || 0) % CHART_COLORS.length];
  }

  function taskRow(task, options = {}) {
    const hold = task.status === "On Hold" && task.holdReason ? `<span class="task-secondary">${escape(task.holdReason)}</span>` : "";
    const assignee = task.assignee || "Unassigned";
    const payment = task.payment?.status || "Pending";
    const quickPayment = options.paymentAction !== false && WorkflowAccess.can("updatePayment", task)
      ? `<button class="row-action" type="button" data-payment-task="${escape(task.id)}">Payment</button>`
      : `<span class="row-arrow" aria-hidden="true">›</span>`;
    return `<article class="task-row" data-task-id="${escape(task.id)}">
      <a class="task-row-link" href="/tasks/detail?id=${encodeURIComponent(task.id)}" aria-label="Open ${escape(task.reportName)}"></a>
      <div class="task-row-main">
        <p class="task-id">${escape(task.id)}</p>
        <h3>${escape(task.reportName)}</h3>
        <p>${escape(task.institutionName)} · ${escape(task.branch)}</p>
      </div>
      <div class="task-row-detail task-wide"><small>Assigned to</small><strong>${escape(assignee)}</strong></div>
      <div class="task-row-detail task-wide"><small>Due date</small><strong>${date(task.dueDate)}</strong></div>
      <div class="task-row-meta">
        <span class="status-badge ${statusClass(task.status)}">${escape(task.status)}</span>${hold}
      </div>
      <div class="task-row-payment task-wide"><small>Payment</small><span class="payment-badge ${paymentClass(payment)}">${escape(payment)}</span><small>${currency(Math.max(0, Number(task.payment?.agreed || 0) - Number(task.payment?.received || 0)))} due</small></div>
      ${quickPayment}
    </article>`;
  }

  function empty(message) {
    return `<div class="empty-state compact-empty"><strong>No tasks to show</strong><p>${escape(message)}</p></div>`;
  }

  window.WorkflowUI = { escape, date, currency, statusClass, paymentClass, chartColor, taskRow, empty };
})();
