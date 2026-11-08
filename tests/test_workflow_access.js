"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "frontend", "assets", "js", "core", "workflow-access.js"),
  "utf8",
);

function accessFor(user) {
  const document = {
    readyState: "complete",
    body: { dataset: {} },
    querySelectorAll() { return []; },
  };
  const window = { __VALUX_AUTH_CONTEXT__: { user }, document };
  const context = { window, document, console };
  vm.runInNewContext(source, context);
  return window.WorkflowAccess;
}

const executive = accessFor({
  role: "father", name: "K. Sivaprasad", userId: "racheshiva01",
  initials: "KS", roleLabel: "CEO", email: "ceo@valux.test",
});
const employee = accessFor({
  role: "employee", name: "Lavakumar", userId: "lavk0401",
  initials: "L", roleLabel: "Employee", email: "employee@valux.test",
});

const assigned = { reportGroup: "valuation", assignee: "Lavakumar", status: "In Progress", reportGeneratedAt: "2026-10-18T00:00:00Z" };
const anotherEmployee = { ...assigned, assignee: "K. Sivaprasad" };
const unassigned = { ...assigned, assignee: "", status: "Unassigned" };
const completed = { ...assigned, status: "Completed" };
const closed = { ...assigned, status: "Closed" };

assert.equal(executive.visible(assigned), true);
assert.equal(executive.visible(unassigned), true);
assert.equal(executive.can("viewFinance", assigned), true);
assert.equal(executive.can("createTask"), true);
assert.equal(executive.can("assignUnassigned", unassigned), true);

assert.equal(employee.visible(assigned), true);
assert.equal(employee.visible(anotherEmployee), true);
assert.equal(employee.visible(unassigned), true);
assert.equal(employee.can("viewTask", assigned), true);
assert.equal(employee.can("viewTask", anotherEmployee), true);
assert.equal(employee.can("viewFinance", assigned), true);
assert.equal(employee.can("updatePayment", assigned), true);
assert.equal(employee.can("createTask"), true);
assert.equal(employee.can("assignUnassigned", unassigned), true);
assert.equal(employee.can("transferTask", assigned), true);
assert.equal(employee.can("changeWorkflow", assigned), true);
assert.equal(employee.can("changeWorkflow", anotherEmployee), false);
assert.equal(employee.can("completeTask", assigned), true);
assert.equal(employee.can("closeTask", completed), true);
assert.equal(employee.can("updatePayment", completed), true);
assert.equal(employee.can("updatePayment", closed), false);
assert.equal(employee.can("cancelTask", assigned), false);
assert.equal(employee.can("reopenTask", closed), false);
for (const terminal of [completed, closed, {...completed, assignee: "K. Sivaprasad"}]) {
  assert.equal(employee.can("openReport", terminal), true);
  assert.equal(executive.can("openReport", terminal), true);
  assert.equal(employee.can("changeWorkflow", terminal), false);
  assert.equal(employee.can("completeTask", terminal), false);
}
assert.equal(employee.can("openReport", {...assigned, status: "Cancelled"}), false);
assert.equal(employee.can("openReport", anotherEmployee), false);

console.log("PASS: CEO and employee workflow permissions remain distinct");
