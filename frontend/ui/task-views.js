import { h } from "vue";
import { emptyView, paint, taskUrl, text } from "./dom.js";

export function paintEmpty(host, message) {
  paint(host, emptyView(message));
}

function badge(value, kind, label = value) {
  const className = kind === "status" ? WorkflowUI.statusClass(value) : WorkflowUI.paymentClass(value);
  return h("span", { class: [`${kind}-badge`, className] }, text(label));
}

function rowAction(task) {
  const artifact = task.status === "Closed" ? TaskStore.finalArtifact(task)
    : task.status === "Completed" ? TaskStore.latestArtifact(task) : null;
  const download = Boolean(artifact?.url);
  const icon = download ? "M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" : "M5 12h13M13 6l6 6-6 6";
  return h("a", {
    class: ["row-open", { "row-download": download }],
    href: download ? artifact.url : taskUrl(task.id),
    download: download ? artifact.filename || "report" : undefined,
    title: download ? "Download retained report" : "Open task",
    "aria-label": `${download ? "Download retained report for" : "Open"} ${task.reportName}`,
  }, [h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [h("path", { d: icon })])]);
}

function paymentControl(task) {
  const className = "row-action row-payment-action";
  if (WorkflowAccess.can("updatePayment", task)) {
    return h("button", { class: className, type: "button", "data-payment-task": task.id }, "Payment");
  }
  return task.status === "Closed"
    ? h("button", { class: className, type: "button", disabled: true, title: "Payment is locked after closure" }, "Payment locked")
    : null;
}

function preparationBadge(task) {
  const label = { online: "Online", template: "Filled template", retrospective: "Retrospective" }[task.preparationSource] || "Not recorded";
  const prefix = ["progress", "completion"].includes(task.reportGroup) ? "Estimation: " : "";
  return h("span", { class: "soft-badge preparation-source" }, prefix + label);
}

function rowView(task, variant) {
  const assignee = task.assignee || "Unassigned";
  const hold = task.status === "On Hold" && task.holdReason
    ? h("span", { class: "task-secondary" }, text(task.holdReason)) : null;
  const dates = TaskStore.STATUS_DATE_FIELDS[task.status];
  const statusDate = dates ? task[dates] : null;
  const payment = TaskStore.paymentSummary(task);
  const statusBadge = badge(task.status, "status");
  const paymentParts = [
    badge(payment.status, "payment"),
    h("small", payment.outstanding === null ? "N/A" : `${WorkflowUI.currency(payment.outstanding)} due`),
    paymentControl(task),
  ];
  const institution = `${task.institutionName} · ${task.branch}`;
  const rowLink = h("a", {
    class: "task-row-link", href: taskUrl(task.id), "aria-hidden": "true", tabindex: -1,
    title: variant === "table" ? undefined : task.reportName,
  });
  if (variant === "table") {
    const dateNote = (value, label) => value && h("small", { class: "task-table-date" }, [
      `${label} `, h("span", WorkflowUI.date(value)),
    ]);
    return h("article", { class: "task-table-row", "data-task-id": task.id, key: task.id }, [
      rowLink,
      h("div", { class: "task-table-id" }, [h("span", { class: "task-id" }, text(task.id)), dateNote(task.assignedDate, "Assigned")]),
      h("div", { class: "task-table-person" }, [
        h("strong", text(task.customerName)), h("small", [`${text(task.reportLabel)} `, preparationBadge(task)]),
      ]),
      h("div", { class: "task-table-property" }, [h("span", text(task.propertyBrief)), h("small", institution)]),
      h("div", { class: "task-table-assignee" }, [
        h("span", { class: "table-avatar" }, assignee.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()),
        h("strong", assignee),
      ]),
      h("div", { class: "task-table-due" }, dates ? null : [h("strong", WorkflowUI.date(task.dueDate))]),
      h("div", { class: "task-table-status" }, [statusBadge, dateNote(statusDate, `${task.status} on`), hold]),
      h("div", { class: "task-table-payment" }, paymentParts),
      h("div", { class: "task-table-action" }, [rowAction(task)]),
    ]);
  }
  return h("article", { class: "task-row", "data-task-id": task.id, key: task.id }, [
    rowLink,
    h("div", { class: "task-row-main" }, [
      h("p", { class: "task-id" }, text(task.id)), h("h3", text(task.customerName)),
      h("p", { class: "task-row-report-type" }, text(task.reportLabel)), h("p", institution),
    ]),
    h("div", { class: "task-row-detail task-wide" }, [h("small", "Assigned to"), h("strong", assignee)]),
    h("div", { class: "task-row-detail task-row-dates task-wide" }, [
      h("small", "Assigned"), h("strong", WorkflowUI.date(task.assignedDate)),
      h("small", dates ? task.status : "Due"), h("strong", WorkflowUI.date(dates ? statusDate : task.dueDate)),
    ]),
    h("div", { class: "task-row-meta" }, [statusBadge, hold]),
    h("div", { class: "task-row-payment task-wide" }, [h("small", "Payment"), ...paymentParts]),
    h("div", { class: "task-row-action" }, [rowAction(task)]),
  ]);
}

export function paintTaskRows(host, tasks, { variant, empty, groups } = {}) {
  if (!tasks.length) return paintEmpty(host, empty);
  if (!groups) return paint(host, tasks.map(task => rowView(task, variant)));
  paint(host, groups.filter(group => group.tasks.length).map(group => h("section", { class: "task-list-group", key: group.title }, [
    h("div", { class: "task-list-group-heading" }, [h("h3", group.title), h("span", text(group.tasks.length))]),
    ...group.tasks.map(task => rowView(task, variant)),
  ])));
}

export function paintTaskBadges(host, task, canAssign, onAssign) {
  const assignee = task.assignee ? `Assigned to ${task.assignee}` : "Unassigned";
  paint(host, [
    badge(task.status, "status", `Task: ${task.status}`),
    h("span", { class: "soft-badge" }, `${task.priority} priority`),
    canAssign
      ? h("button", { type: "button", class: "soft-badge assignee-badge-action", id: "assignment-badge", onClick: onAssign }, [
        assignee, h("span", { "aria-hidden": "true" }, "›"),
      ])
      : h("span", { class: "soft-badge" }, assignee),
    badge(task.payment.status, "payment", `Payment: ${task.payment.status}`),
  ]);
}

export function paintPairs(host, rows) {
  paint(host, rows.map(([label, value]) => h("div", { key: label }, [h("dt", text(label)), h("dd", text(value))])));
}

export function paintActivity(host, events) {
  paint(host, [...events].reverse().map(event => h("li", { key: event.id }, [
    h("span", { class: ["activity-dot", `activity-${event.type}`] }),
    h("div", [h("p", text(event.text)), h("small", `${event.author} · ${WorkflowUI.date(event.createdAt)}`)]),
  ])));
}

export function paintRevaluations(host, task) {
  const link = id => h("a", { class: "quiet-link", href: taskUrl(id) }, id);
  if (task.reportGroup === "revaluation") {
    const source = task.linkedValuationId;
    const artifact = task.linkedValuationArtifactId;
    const download = artifact
      ? h("a", { class: "quiet-link", href: `/api/tasks/${encodeURIComponent(source)}/artifacts/${encodeURIComponent(artifact)}/download` }, "Download source report")
      : null;
    paint(host, [
      h("p", [link(source), artifact ? " · " : "", download]),
      task.revaluationManualEntry ? h("p", "Manual entry required for details available only in the original report.") : null,
    ]);
    return;
  }
  const children = task.revaluations || [];
  paint(host, children.length ? h("table", { class: "revaluation-history", "aria-labelledby": "revaluation-links-title" }, [
    h("thead", [h("tr", ["Task ID", "Assigned on", "Status"].map(label => h("th", { scope: "col" }, label)))]),
    h("tbody", children.map(child => h("tr", { key: child.id }, [
      h("td", [link(child.id)]), h("td", WorkflowUI.date(child.assignedDate)), h("td", [badge(child.status, "status")]),
    ]))),
  ]) : h("p", "No linked Re-Valuations."));
}

export function paintLinkedChoices(host, rows, completedDate, emptyMessage) {
  if (!rows.length) return paintEmpty(host, emptyMessage);
  paint(host, rows.map(candidate => h("button", {
    key: candidate.id, type: "button", class: "estimation-picker-row", "data-estimation-id": candidate.id,
  }, [
    h("span", [h("strong", candidate.id), h("small", `${candidate.institutionCode} · ${candidate.branch}`)]),
    h("span", [h("strong", candidate.customerName), h("small", candidate.propertyBrief)]),
    h("span", { class: "picker-dates" }, [
      h("strong", `Assigned: ${WorkflowUI.date(candidate.assignedDate)}`),
      h("small", `Completed: ${completedDate(candidate.completedAt)}`),
      h("small", { class: "status-badge" }, candidate.status),
    ]),
    h("em", "Select"),
  ])));
}
