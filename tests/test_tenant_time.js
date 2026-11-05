"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "assets", "js", "core", "time.js"), "utf8");
const context = { Date, Intl, window: { __VALUX_BUSINESS_CONTEXT__: { timeZone: "Asia/Kolkata" } } };
vm.runInNewContext(source, context);
const time = context.window.ValuxTime;

assert.equal(time.dateString(new Date("2026-10-30T18:29:00Z")), "2026-10-30");
assert.equal(time.dateString(new Date("2026-10-30T18:31:00Z")), "2026-10-31");
assert.equal(time.isoDate(time.parseDate("2026-10-30")), "2026-10-30");
assert.equal(time.addDays("2026-10-30", 2), "2026-11-01");
assert.match(time.formatDate("2026-10-30"), /30 Oct 2026/);

console.log("PASS: browser calendar helpers use IST while preserving date-only values");
