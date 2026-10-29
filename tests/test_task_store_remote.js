"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requests = [];
const baseTask = {
  id: "CANARA-REMOTE-VAL-291026", version: 1,
  reportKey: "valuation-general", reportGroup: "valuation", reportLabel: "General Property Valuation",
  institutionCode: "CANARA", institutionName: "Canara Bank", institutionType: "Bank",
  branch: "Adoni", customerName: "Remote Adapter", propertyBrief: "API regression",
  assignee: "K. Sivaprasad", assigneeId: "racheshiva01", priority: "Normal", status: "In Progress",
  assignedDate: "2026-10-29", dueDate: "2026-10-31", reportGeneratedAt: null,
  payment: { estimated: null, agreed: null, received: 0, dueDate: null }, activity: [],
  createdAt: "2026-10-29T10:00:00Z", updatedAt: "2026-10-29T10:00:00Z",
};
let serverTask = structuredClone(baseTask);

const context = {
  console, Date, JSON, Math, structuredClone,
  CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
  window: {
    __VALUX_AUTH_CONTEXT__: { user: { role: "father", name: "K. Sivaprasad" } },
    __VALUX_BUSINESS_CONTEXT__: { task: structuredClone(baseTask), linkedTask: null, employees: [] },
    dispatchEvent() {},
    BusinessApi: {
      async get(requestPath, values) {
        requests.push({ method: "GET", path: requestPath, values });
        if (requestPath === "/api/tasks") return { total: 1, items: [structuredClone(serverTask)], hasMore: false };
        if (requestPath === "/api/estimations/eligible") return { total: 0, items: [], hasMore: false };
        if (requestPath.endsWith("/progress-reports")) return { items: [] };
        return { task: structuredClone(serverTask) };
      },
      async post(requestPath, body) {
        requests.push({ method: "POST", path: requestPath, body });
        assert.equal(body.version, serverTask.version);
        serverTask.version += 1;
        if (requestPath.endsWith("/close")) {
          serverTask.status = "Closed";
          serverTask.finalDocx = structuredClone(serverTask.latestDocx);
        }
        if (requestPath.endsWith("/reopen")) {
          serverTask.status = "In Progress";
          serverTask.reportGeneratedAt = null;
          serverTask.reopenedAt = "2026-10-29T12:00:00Z";
          serverTask.latestDocx = null;
        }
        return { task: structuredClone(serverTask) };
      },
      async delete(requestPath, body) {
        requests.push({ method: "DELETE", path: requestPath, body });
        serverTask.version += 1;
        return { task: structuredClone(serverTask) };
      },
    },
  },
};
context.window.window = context.window;
context.window.CustomEvent = context.CustomEvent;
context.BusinessApi = context.window.BusinessApi;

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "assets", "js", "core", "task-store.js"), "utf8");
vm.runInNewContext(source, context);
const store = context.window.TaskStore;

(async () => {
  assert.equal(store.remoteMode, true);
  const page = await store.fetchTasks({ limit: 10, offset: 0 });
  assert.equal(page.total, 1);

  serverTask.version += 1;
  serverTask.reportGeneratedAt = "2026-10-29T11:00:00Z";
  serverTask.latestDocx = { url: "/api/tasks/CANARA-REMOTE-VAL-291026/artifacts/1/download", filename: "remote.docx", generatedAt: serverTask.reportGeneratedAt };
  const generated = await store.refresh(baseTask.id);
  assert.equal(generated.latestDocx.filename, "remote.docx");
  const closed = await store.close(baseTask.id, "Settled.");
  assert.equal(closed.finalDocx.filename, "remote.docx");
  const reopened = await store.reopen(baseTask.id, "Correction required.");
  assert.equal(reopened.latestDocx, null);
  assert.equal(reopened.reportGeneratedAt, null);

  assert.ok(requests.some((request) => request.path === "/api/tasks"));
  assert.ok(requests.some((request) => request.path === `/api/tasks/${baseTask.id}`));
  assert.ok(requests.every((request) => request.method !== "POST" || Number.isInteger(request.body?.version)));
  console.log("PASS: authenticated TaskStore uses versioned workflow APIs and backend-owned artifacts");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
