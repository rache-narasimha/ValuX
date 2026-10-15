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

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "assets", "js", "task-store.js"), "utf8");
vm.runInNewContext(source, context);
const store = context.window.TaskStore;

function input(overrides = {}) {
  return {
    institutionType: "Bank", institutionCode: "BOB", institutionName: "Bank of Baroda",
    branch: "Adoni", customerName: "WiFi Browser Test", propertyBrief: "Compatibility test",
    reportKey: "valuation-general", assignee: "K. Sivaprasad", priority: "Normal",
    assignedDate: "2026-10-13", dueDate: "2026-10-20", initialNote: "Acknowledged.", ...overrides,
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

const unassigned = store.create(input({ customerName: "Unassigned Customer", assignee: "", initialNote: "" }));
assert.equal(unassigned.status, "Unassigned");
assert.equal(unassigned.assignee, "");
assert.equal(store.query({ institution: "BOB", period: "monthly" }).total, 2);
assert.equal(store.query({ institution: "PNB", period: "monthly" }).total, 0);
assert.equal(store.matchesPeriod(active, "daily"), false);
assert.equal(store.matchesPeriod(active, "monthly"), true);

const claimed = store.assign(unassigned.id, "Lavakumar", "Acknowledged by employee.");
assert.equal(claimed.status, "In Progress");
assert.equal(claimed.assignee, "Lavakumar");

const held = store.putOnHold(active.id, "Awaiting Review", "Please review the generated values.");
assert.equal(held.status, "On Hold");
assert.equal(held.holdReason, "Awaiting Review");
assert.equal(store.summary().awaitingReview, 1);

const resumed = store.resume(active.id, "Review correction completed.");
assert.equal(resumed.status, "In Progress");
assert.equal(resumed.holdReason, "");

store.markReportGenerated(active.id, "docx");
const completed = store.complete(active.id, "Report issued.");
assert.equal(completed.status, "Completed");
const paid = store.updatePayment(active.id, { estimated: 5000, agreed: 4500, received: 4500, note: "Received." });
assert.equal(paid.payment.status, "Received");
assert.ok(paid.payment.updatedAt);
const closed = store.close(active.id, "Request closed.");
assert.equal(closed.status, "Closed");

assert.throws(() => store.cancel(unassigned.id, "Custom", ""), /explain the cancellation/i);
console.log("PASS: finalized task lifecycle works without secure-context browser APIs");
