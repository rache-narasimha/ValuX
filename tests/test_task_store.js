"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const values = new Map();
const context = {
  console, Date, JSON, Math,
  CustomEvent: class CustomEvent {},
  localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  },
  window: { crypto: {}, dispatchEvent() {} },
};
context.window.window = context.window;
context.window.localStorage = context.localStorage;
context.window.CustomEvent = context.CustomEvent;
context.window.WorkflowAccess = {
  currentRole: () => "father",
  currentUser: () => ({ name: "K. Sivaprasad" }),
  visible: () => true,
  can: () => true,
};
context.WorkflowAccess = context.window.WorkflowAccess;

const source = fs.readFileSync(
  path.join(__dirname, "..", "frontend", "assets", "js", "core", "task-store.js"),
  "utf8",
);
vm.runInNewContext(source, context);
const store = context.window.TaskStore;

function input(overrides = {}) {
  return {
    institutionType: "Bank", institutionCode: "BOB", institutionName: "Bank of Baroda",
    branch: "Adoni", customerName: "WiFi Browser Test", propertyBrief: "Compatibility test",
    reportKey: "valuation-general", assignee: "K. Sivaprasad", priority: "Normal",
    assignedDate: "2026-10-13", dueDate: "2026-10-15", initialNote: "Acknowledged.", ...overrides,
  };
}

const active = store.create(input());
assert.equal(active.id, "BOB-WIFI-VAL-131026");
assert.equal(active.status, "In Progress");
assert.equal(active.activity.length, 2);
assert.ok(active.activity.every((event) => event.id));
const activePayment = store.updatePayment(active.id, { estimated: 5000, agreed: 4500, received: 1000, note: "Advance received." });
assert.equal(activePayment.status, "In Progress");
assert.equal(activePayment.payment.status, "Partially Received");
assert.equal(store.paymentSummary(activePayment).basis, 4500);
assert.equal(store.paymentSummary(activePayment).outstanding, 3500);

const unassigned = store.create(input({ customerName: "Unassigned Customer", assignee: "", initialNote: "" }));
assert.equal(unassigned.status, "Unassigned");
assert.equal(unassigned.assignee, "");
assert.equal(store.query({ institution: "BOB", period: "monthly" }).total, 2);
assert.equal(store.query({ institution: "PNB", period: "monthly" }).total, 0);
assert.equal(store.matchesPeriod(active, "daily"), false);
assert.equal(store.matchesPeriod(active, "monthly"), true);
const estimatedOnly = store.updatePayment(unassigned.id, { estimated: 3000, agreed: "", received: 500, dueDate: "2026-10-20" });
assert.equal(store.paymentSummary(estimatedOnly).basis, 3000);
assert.equal(store.paymentSummary(estimatedOnly).outstanding, 2500);

const claimed = store.assign(unassigned.id, "Lavakumar", "Acknowledged by employee.");
assert.equal(claimed.status, "In Progress");
assert.equal(claimed.assignee, "Lavakumar");

const held = store.putOnHold(active.id, "Awaiting Review", "Please review the generated values.");
assert.equal(held.status, "On Hold");
assert.equal(held.holdReason, "Awaiting Review");
assert.equal(store.summary().awaitingReview, 1);

const activityBeforeResume = held.activity.length;
const resumed = store.resume(active.id);
assert.equal(resumed.status, "In Progress");
assert.equal(resumed.holdReason, "");
assert.equal(resumed.activity.length, activityBeforeResume + 1);

store.markReportGenerated(active.id, "docx", { url: "/downloads/valuation-report-1.docx", filename: "valuation-report-1.docx" });
const completed = store.complete(active.id, "Report issued.");
assert.equal(completed.status, "Completed");
const paid = store.updatePayment(active.id, { estimated: 5000, agreed: 4500, received: 4500, note: "Received." });
assert.equal(paid.payment.status, "Received");
assert.ok(paid.payment.updatedAt);
const closed = store.close(active.id, "Request closed.");
assert.equal(closed.status, "Closed");
assert.equal(closed.finalDocx.url, "/downloads/valuation-report-1.docx");
assert.throws(() => store.updatePayment(active.id, { agreed: 4500, received: 4500 }), /closed task/i);
assert.equal(store.canReopen(closed), true);
assert.equal(store.canReopen(closed, new Date(new Date(closed.closedAt).getTime() + 8 * 24 * 60 * 60 * 1000)), false);
const reopened = store.reopen(active.id, "A correction is required.");
assert.equal(reopened.status, "In Progress");
assert.equal(reopened.reportGeneratedAt, null);
store.markReportGenerated(active.id, "pdf");
assert.throws(() => store.complete(active.id, "Correction completed."), /new DOCX/i);
store.markReportGenerated(active.id, "docx", { url: "/downloads/valuation-report-2.docx" });
assert.equal(store.complete(active.id, "Corrected report completed.").status, "Completed");

const estimation = store.create(input({
  customerName: "Estimation Customer", reportKey: "estimation", propertyBrief: "Commercial estimate",
}));
assert.equal(store.REPORTS.estimation.route, "/estimation");
assert.throws(() => store.complete(estimation.id, "Estimate completed."), /Generate the report/i);
store.markReportGenerated(estimation.id, "xlsx", {
  url: "/downloads/estimation-report-1.xlsx", filename: "estimate.xlsx", source: "Generated Excel",
  estimationSummary: { applicantName: "Estimation Customer", components: [{ id: "gf", label: "Ground Floor", estimatedCost: 1000000 }], totalEstimatedCost: 1000000 },
});
assert.equal(store.complete(estimation.id, "Estimate completed.").status, "Completed");
store.updatePayment(estimation.id, { estimated: 3000, agreed: 3000, received: 3000 });
const closedEstimation = store.close(estimation.id, "Estimate issued.");
assert.equal(closedEstimation.finalXlsx.url, "/downloads/estimation-report-1.xlsx");
assert.equal(store.finalArtifact(closedEstimation).filename, "estimate.xlsx");
store.reopen(estimation.id, "Estimate correction required.");
assert.throws(() => store.complete(estimation.id, "Correction completed."), /Generate the report/i);
store.markReportGenerated(estimation.id, "xlsx", {
  url: "/downloads/estimation-upload-2.xlsx", filename: "corrected-estimate.xlsx", source: "Uploaded Excel",
});
assert.equal(store.complete(estimation.id, "Corrected estimate completed.").status, "Completed");

assert.equal(store.estimationCandidates()[0].id, estimation.id);
assert.throws(() => store.create(input({ customerName: "Unlinked Progress", reportKey: "progress" })), /finalized estimation report/i);
const progress = store.create(input({
  customerName: "Estimation Customer", reportKey: "progress", propertyBrief: "Commercial estimate",
  linkedEstimationId: estimation.id,
}));
assert.equal(store.REPORTS.progress.route, "/progress-completion");
assert.equal(progress.linkedEstimationId, estimation.id);
store.markReportGenerated(progress.id, "docx", {
  url: "/downloads/progress-report.docx", filename: "progress.docx",
  progressSummary: { linkedEstimationId: estimation.id, reportType: "progress", reportDate: "2026-10-13", components: [{ label: "Ground Floor", completionPercent: 50 }] },
});
assert.equal(store.progressReportsFor(estimation.id)[0].id, progress.id);

assert.throws(() => store.cancel(unassigned.id, "Custom", ""), /explain the cancellation/i);
values.set("sln.workflow.tasks.v1", "{damaged-json");
assert.equal(store.storageStatus().ok, false);
assert.throws(() => store.create(input({ customerName: "Protected Data" })), /has not been overwritten/i);
console.log("PASS: finalized task lifecycle works without secure-context browser APIs");
