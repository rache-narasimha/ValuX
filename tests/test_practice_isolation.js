/** Practice requests cannot acquire a live task context through URL parameters. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

(async () => {
  let value, calls = 0;
  const window = {location: {search: "?practice=1&task=LIVE-TASK"},
    localStorage: {getItem: () => value || null, setItem: (_, next) => { value = next; }},
    BusinessApi: {csrf: async () => "practice-test-csrf", get: () => { calls++; }, post: () => { calls++; }},
    TaskStore: {get: () => ({status: "Closed"})}};
  const context = {window, URLSearchParams, localStorage: window.localStorage, BusinessApi: window.BusinessApi};
  vm.runInNewContext(fs.readFileSync("frontend/assets/js/core/report-data.js", "utf8"), context);
  assert.equal(window.ReportData.taskCode, "");
  assert.equal(window.ReportData.readOnly, false);
  await window.ReportData.save("practice", "valuation-general", {marker: "local"});
  assert.equal((await window.ReportData.load("practice")).marker, "local");
  assert.equal(calls, 0);
  const headers = await window.ReportData.requestHeaders();
  assert.equal(headers["X-Practice-Mode"], "1");
  assert.equal(headers["X-Task-Code"], undefined);
  assert.equal(headers["X-CSRF-Token"], "practice-test-csrf");
  assert.equal(window.ReportData.requestPayload({value: 1}).taskCode, undefined);
  console.log("PASS: Practice uses local drafts and isolated, CSRF-protected request context");
})().catch(error => { console.error(error); process.exitCode = 1; });
