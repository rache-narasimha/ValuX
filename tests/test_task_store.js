"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const timeSource = fs.readFileSync(path.join(__dirname, "..", "frontend", "assets", "js", "core", "time.js"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "assets", "js", "core", "task-store.js"), "utf8");
assert.doesNotMatch(source, /localStorage|sessionStorage/, "TaskStore must not persist business data in browser storage");

const requests = [];
const task = {
  id: "CANARA-CUTOVER-VAL-291026", version: 3,
  reportKey: "valuation-general", reportGroup: "valuation", reportLabel: "General Property Valuation",
  institutionCode: "CANARA", institutionName: "Canara Bank", institutionType: "Bank",
  branch: "Adoni", customerName: "Cutover Test", propertyBrief: "Remote workflow adapter",
  assignee: "K. Sivaprasad", priority: "Normal", status: "Completed",
  assignedDate: "2026-10-29", dueDate: "2026-10-31", completedAt: "2026-10-29T10:00:00Z",
  payment: { estimated: 5000, agreed: 4500, received: 1000, dueDate: "2026-10-31" },
  activity: [], createdAt: "2026-10-29T09:00:00Z", updatedAt: "2026-10-29T10:00:00Z",
};
const context = {
  console, Date, JSON, Math, structuredClone,
  CustomEvent: class CustomEvent {},
  window: {
    structuredClone,
    __VALUX_AUTH_CONTEXT__: { user: { role: "father", name: "K. Sivaprasad" } },
    __VALUX_BUSINESS_CONTEXT__: { task: structuredClone(task), employees: [], timeZone: "Asia/Kolkata" },
    dispatchEvent() {},
    BusinessApi: {
      async get(requestPath, values) {
        requests.push({ method: "GET", path: requestPath, values });
        if (requestPath === "/api/tasks") return { total: 1, items: [structuredClone(task)], hasMore: false };
        if (requestPath === "/api/estimations/eligible") return { total: 0, items: [], hasMore: false };
        if (requestPath.endsWith("/progress-reports")) return { items: [] };
        return { task: structuredClone(task) };
      },
      async post(requestPath, body) {
        requests.push({ method: "POST", path: requestPath, body });
        return { task: structuredClone(task) };
      },
      async delete(requestPath, body) {
        requests.push({ method: "DELETE", path: requestPath, body });
        return { task: structuredClone(task) };
      },
    },
  },
};
context.window.window = context.window;
context.window.CustomEvent = context.CustomEvent;
context.BusinessApi = context.window.BusinessApi;
vm.runInNewContext(timeSource, context);
context.ValuxTime = context.window.ValuxTime;
vm.runInNewContext(source, context);
const store = context.window.TaskStore;

(async () => {
  assert.equal(store.remoteMode, true);
  assert.equal(store.storageStatus().ok, true);
  assert.equal(store.get(task.id).id, task.id);
  assert.deepEqual(JSON.parse(JSON.stringify(store.dueDateRange("Normal", "2026-10-29"))), { suggested: "2026-10-31", maximum: "2026-11-02" });
  assert.equal(store.paymentSummary(task).basis, 4500);
  assert.equal(store.paymentSummary(task).outstanding, 3500);
  assert.equal(store.matchesPeriod(task, "", "assignedDate", new Date("2030-01-01T00:00:00Z")), true);
  assert.equal(store.query({ institutionType: "Bank" }).total, 1);
  assert.equal(store.query({ institutionType: "NBFC" }).total, 0);
  assert.equal(store.canReopen({ ...task, status: "Completed" }, new Date("2030-01-01T12:00:00Z")), true);
  const closed = { ...task, status: "Closed", closedAt: "2026-10-29T12:00:00Z" };
  assert.equal(store.canReopen(closed, new Date("2026-11-13T12:00:00Z")), true);
  assert.equal(store.canReopen(closed, new Date("2026-11-14T12:00:00Z")), false);
  const historicalPdf = { url: "/historical.pdf", artifactType: "valuation_pdf" };
  assert.equal(store.latestArtifact({
    reportGroup: "valuation", institutionCode: "KVB", retrospectiveReady: true,
    latestInstitutionArtifact: historicalPdf,
  }), historicalPdf);
  assert.equal(store.finalArtifact({
    reportGroup: "valuation", institutionCode: "KVB", retrospectiveReady: true,
    finalInstitutionArtifact: historicalPdf,
  }), historicalPdf);
  const page = await store.fetchTasks({ offset: 0, limit: 20 });
  assert.equal(page.total, 1);
  await store.progressReportsFor("CANARA-EST-291026");
  await store.removeInstitutionArtifact(task.id);
  assert.ok(requests.some((entry) => entry.path === "/api/tasks"));
  assert.ok(requests.some((entry) => entry.path === "/api/estimations/CANARA-EST-291026/progress-reports"));
  assert.ok(requests.some((entry) => entry.method === "DELETE" && entry.path.endsWith("/artifacts/latest")));
  console.log("PASS: TaskStore is a remote-only workflow adapter with page-session caching");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
