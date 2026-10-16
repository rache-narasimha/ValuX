/** Shared escaping, formatting, status styling, and task-row rendering helpers. */
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
    if (value === null || value === undefined || value === "") return "N/A";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function statusClass(status) {
    return `status-${String(status || "").toLowerCase().replaceAll(" ", "-")}`;
  }

  function paymentClass(status) {
    return `payment-${String(status || "pending").toLowerCase().replaceAll(" ", "-")}`;
  }

  function chartColor(indexOrInstitution) {
    if (typeof indexOrInstitution === "object" && indexOrInstitution?.color) return indexOrInstitution.color;
    return "#087ea4";
  }

  function taskRow(task, options = {}) {
    const hold = task.status === "On Hold" && task.holdReason ? `<span class="task-secondary">${escape(task.holdReason)}</span>` : "";
    const assignee = task.assignee || "Unassigned";
    const paymentSummary = TaskStore.paymentSummary(task);
    const payment = paymentSummary.status;
    const quickPayment = options.paymentAction !== false && WorkflowAccess.can("updatePayment", task)
      ? `<button class="row-action" type="button" data-payment-task="${escape(task.id)}">Payment</button>`
      : task.status === "Closed" && options.paymentAction !== false
        ? '<button class="row-action" type="button" disabled title="Payment is locked after closure">Payment locked</button>'
        : `<span class="row-arrow" aria-hidden="true">›</span>`;
    if (options.variant === "table") {
      return `<article class="task-table-row" data-task-id="${escape(task.id)}">
        <a class="task-row-link" href="/tasks/detail?id=${encodeURIComponent(task.id)}" aria-label="Open ${escape(task.reportName)}"></a>
        <div class="task-table-id"><span class="task-id">${escape(task.id)}</span></div>
        <div class="task-table-person"><strong>${escape(task.customerName)}</strong><small>${escape(task.reportLabel)}</small></div>
        <div class="task-table-property"><span>${escape(task.propertyBrief)}</span><small>${escape(task.institutionName)} · ${escape(task.branch)}</small></div>
        <div class="task-table-assignee"><span class="table-avatar">${escape(assignee.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span><strong>${escape(assignee)}</strong></div>
        <div class="task-table-due"><strong>${date(task.dueDate)}</strong></div>
        <div class="task-table-status"><span class="status-badge ${statusClass(task.status)}">${escape(task.status)}</span>${hold}</div>
        <div class="task-table-payment"><span class="payment-badge ${paymentClass(payment)}">${escape(payment)}</span><small>${paymentSummary.outstanding === null ? "N/A" : `${currency(paymentSummary.outstanding)} due`}</small></div>
        <div class="task-table-action">${quickPayment}</div>
      </article>`;
    }
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
      <div class="task-row-payment task-wide"><small>Payment</small><span class="payment-badge ${paymentClass(payment)}">${escape(payment)}</span><small>${paymentSummary.outstanding === null ? "N/A" : `${currency(paymentSummary.outstanding)} due`}</small></div>
      ${quickPayment}
    </article>`;
  }

  function empty(message) {
    return `<div class="empty-state compact-empty"><strong>No tasks to show</strong><p>${escape(message)}</p></div>`;
  }

  function fatal(message) {
    const alert = document.createElement("div");
    alert.className = "global-error";
    alert.setAttribute("role", "alert");
    alert.innerHTML = `<strong>Local data could not be loaded</strong><p>${escape(message)}</p>`;
    const target = document.querySelector("main") || document.body;
    target.prepend(alert);
  }

  window.WorkflowUI = { escape, date, currency, statusClass, paymentClass, chartColor, taskRow, empty, fatal };
})();
