"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("frontend/assets/js/pages/estimation-offline.js", "utf8");

for (const uuidAvailable of [true, false]) {
  for (const initialized of [true, false]) {
    const state = {details: initialized ? {offlineComponents: []} : {}};
    let add, saved = 0, rendered = 0, dirtied = 0, sequence = 0;
    const browser = {
      crypto: uuidAvailable ? {randomUUID: () => `test-${++sequence}`} : {},
      ReportData: {localOnly: true},
    };
    const document = {
      getElementById: (id) => id === "estimation-add-summary"
        ? {addEventListener: (_event, handler) => { add = handler; }} : null,
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    vm.runInNewContext(source, {window: browser, document});
    const controller = browser.EstimationOffline.create({
      state, currentTask: () => null,
      dirty: () => { dirtied++; }, save: () => { saved++; }, render: () => { rendered++; },
    });
    controller.wire();
    add();
    state.details.offlineComponents[0].label = "Ground Floor";
    state.details.offlineComponents[0].estimatedCost = "0";
    add();
    assert.equal(state.details.offlineComponents.length, 2);
    assert.equal(state.details.offlineComponents[0].label, "Ground Floor");
    assert.equal(state.details.offlineComponents[0].estimatedCost, "0");
    const ids = state.details.offlineComponents.map((row) => row.id);
    assert.ok(ids.every(Boolean));
    assert.equal(new Set(ids).size, 2);
    assert.equal(saved, 2);
    assert.equal(rendered, 2);
    assert.equal(dirtied, 2);
  }
}
console.log("PASS: offline Add component retains rows with uninitialized drafts and without randomUUID");

for (const status of ["Completed", "Closed"]) {
  const state = {details: {uploadType: "retrospective", offlineComponents: [
    {label: "Ground Floor", estimatedCost: 0, plinthArea: 500},
  ]}};
  const before = JSON.stringify(state);
  const browser = {
    ReportData: {localOnly: false, readOnly: true},
    WorkflowUI: {escape: (value) => String(value ?? "")},
    TaskStore: {
      latestArtifact: () => ({filename: "latest.pdf", url: "/latest.pdf"}),
      finalArtifact: () => ({filename: "final.pdf", url: "/final.pdf"}),
    },
  };
  vm.runInNewContext(source, {window: browser});
  const controller = browser.EstimationOffline.create({state, currentTask: () => ({status, reportFresh: false})});
  const html = controller.panel();
  assert.ok(html.includes(status === "Closed" ? "/final.pdf" : "/latest.pdf"));
  assert.ok(html.includes("Retained component totals"));
  assert.ok(html.includes('readonly value="Ground Floor"'));
  assert.ok(html.includes('readonly value="0"'));
  assert.ok(!html.includes('id="estimation-offline-file"'));
  assert.equal(JSON.stringify(state), before);
}
console.log("PASS: terminal offline views use the retained artifact and preserve captured zero component totals");
