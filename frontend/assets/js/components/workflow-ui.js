/** Shared escaping, formatting, status styling, and task-row rendering helpers. */
(function () {
  "use strict";

  function escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function date(value) {
    return ValuxTime.formatDate(value);
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

  function taskUrl(task) {
    return `/tasks/detail?id=${encodeURIComponent(task.id)}`;
  }

  function openTaskControl(task) {
    return `<a class="row-open" href="${taskUrl(task)}" title="Open task" aria-label="Open ${escape(task.reportName)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></a>`;
  }

  function reportDownloadControl(task) {
    if (!["Completed", "Closed"].includes(task.status)) return "";
    const artifact = task.status === "Closed" ? TaskStore.finalArtifact(task) : TaskStore.latestArtifact(task);
    if (!artifact?.url) return "";
    return `<a class="row-open row-download" href="${escape(artifact.url)}" download="${escape(artifact.filename || "report")}" title="Download retained report" aria-label="Download retained report for ${escape(task.reportName)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a>`;
  }

  function paymentControl(task, options) {
    if (options.paymentAction === false) return "";
    if (WorkflowAccess.can("updatePayment", task)) {
      return `<button class="row-action row-payment-action" type="button" data-payment-task="${escape(task.id)}">Payment</button>`;
    }
    if (task.status === "Closed") {
      return '<button class="row-action row-payment-action" type="button" disabled title="Payment is locked after closure">Payment locked</button>';
    }
    return "";
  }

  function preparationBadge(task) {
    const label = {online: "Online", template: "Filled template", retrospective: "Retrospective"}[task.preparationSource] || "Not recorded";
    const prefix = ["progress", "completion"].includes(task.reportGroup) ? "Estimation: " : "";
    return `<span class="soft-badge preparation-source">${prefix}${label}</span>`;
  }

  function taskRow(task, options = {}) {
    const hold = task.status === "On Hold" && task.holdReason ? `<span class="task-secondary">${escape(task.holdReason)}</span>` : "";
    const assignee = task.assignee || "Unassigned";
    const paymentSummary = TaskStore.paymentSummary(task);
    const payment = paymentSummary.status;
    const paymentAction = paymentControl(task, options);
    const rowAction = reportDownloadControl(task) || openTaskControl(task);
    if (options.variant === "table") {
      return `<article class="task-table-row" data-task-id="${escape(task.id)}">
        <a class="task-row-link" href="${taskUrl(task)}" aria-hidden="true" tabindex="-1"></a>
        <div class="task-table-id"><span class="task-id">${escape(task.id)}</span></div>
        <div class="task-table-person"><strong>${escape(task.customerName)}</strong><small>${escape(task.reportLabel)} ${preparationBadge(task)}</small></div>
        <div class="task-table-property"><span>${escape(task.propertyBrief)}</span><small>${escape(task.institutionName)} · ${escape(task.branch)}</small></div>
        <div class="task-table-assignee"><span class="table-avatar">${escape(assignee.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span><strong>${escape(assignee)}</strong></div>
        <div class="task-table-due"><strong>${date(task.dueDate)}</strong></div>
        <div class="task-table-status"><span class="status-badge ${statusClass(task.status)}">${escape(task.status)}</span>${hold}</div>
        <div class="task-table-payment"><span class="payment-badge ${paymentClass(payment)}">${escape(payment)}</span><small>${paymentSummary.outstanding === null ? "N/A" : `${currency(paymentSummary.outstanding)} due`}</small>${paymentAction}</div>
        <div class="task-table-action">${rowAction}</div>
      </article>`;
    }
    return `<article class="task-row" data-task-id="${escape(task.id)}">
      <a class="task-row-link" href="${taskUrl(task)}" aria-hidden="true" tabindex="-1"></a>
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
      <div class="task-row-payment task-wide"><small>Payment</small><span class="payment-badge ${paymentClass(payment)}">${escape(payment)}</span><small>${paymentSummary.outstanding === null ? "N/A" : `${currency(paymentSummary.outstanding)} due`}</small>${paymentAction}</div>
      <div class="task-row-action">${rowAction}</div>
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
