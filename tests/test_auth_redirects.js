"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the actual private redirect helper without starting the login UI/network.
const source = fs.readFileSync(path.join(__dirname, "../frontend/assets/js/pages/auth.js"), "utf8")
  .replace(/\n  initialize\(\);\n\}\)\(\);\s*$/, "\n  globalThis.redirectForTest = safeDestination;\n})();");
const origin = "https://valux.test";
for (const value of ["https://example.invalid", "//example.invalid", "/\\example.invalid", "javascript:alert(1)", "data:text/html,probe", "/auth", "/auth?next=/", "/\t/example.invalid", " /tasks"]) {
  const context = {document:{getElementById(){return {}; }},URL,URLSearchParams,location:{origin,search:"?next="+encodeURIComponent(value)}};
  vm.runInNewContext(source, context);
  assert.equal(context.redirectForTest(), "/", value);
}
for (const value of ["/tasks?group=valuation", "/tasks/detail?id=SECURITY-PROBE", "/auth/../tasks", "/%2f%2fexample.invalid"]) {
  const context = {document:{getElementById(){return {}; }},URL,URLSearchParams,location:{origin,search:"?next="+encodeURIComponent(value)}};
  vm.runInNewContext(source, context);
  const result = new URL(context.redirectForTest(), origin);
  assert.equal(result.origin, origin, value);
  assert.ok(!result.pathname.startsWith("/auth"), value);
}
console.log("PASS: actual sign-in redirect helper rejects external, script/data, backslash and whitespace destinations while preserving internal routes");
