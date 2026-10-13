"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const values = new Map();
const context = {
  console,
  Date,
  JSON,
  Math,
  CustomEvent: class CustomEvent {},
  localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  },
  window: {
    crypto: {},
    dispatchEvent() {},
  },
};
context.window.window = context.window;
context.window.localStorage = context.localStorage;
context.window.CustomEvent = context.CustomEvent;

const source = fs.readFileSync(
  path.join(__dirname, "..", "frontend", "assets", "js", "task-store.js"),
  "utf8",
);
vm.runInNewContext(source, context);

const task = context.window.TaskStore.create({
  institutionType: "Bank",
  institutionCode: "BOB",
  institutionName: "Bank of Baroda",
  branch: "Adoni",
  customerName: "WiFi Browser Test",
  propertyBrief: "Compatibility test",
  reportKey: "valuation-general",
  assignee: "K. Sivaprasad",
  priority: "Normal",
  assignedDate: "2026-10-13",
  dueDate: "2026-10-20",
  initialNote: "Created without secure-context browser APIs.",
});

assert.equal(task.id, "BOB-WIFI-VAL-131026");
assert.equal(task.activity.length, 2);
assert.ok(task.activity.every((event) => event.id));

const updated = context.window.TaskStore.updateStatus(
  task.id,
  "In Progress",
  "Started.",
);
assert.equal(updated.status, "In Progress");
assert.equal(context.window.TaskStore.get(task.id).status, "In Progress");

console.log("PASS: task store works without crypto.randomUUID or structuredClone");
