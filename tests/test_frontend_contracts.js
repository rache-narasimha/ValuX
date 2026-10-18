"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pairs = [
  ["frontend/pages/index.html", "frontend/assets/js/pages/home.js"],
  ["frontend/pages/tasks.html", "frontend/assets/js/pages/task-list.js"],
  ["frontend/pages/task.html", "frontend/assets/js/pages/task-detail.js"],
  ["frontend/pages/new-task.html", "frontend/assets/js/pages/new-task.js"],
  ["frontend/pages/institutions.html", "frontend/assets/js/pages/institution-settings.js"],
];
const generatedIds = new Set(["assignment-badge"]);

for (const [htmlPath, scriptPath] of pairs) {
  const html = fs.readFileSync(path.join(root, htmlPath), "utf8");
  const script = fs.readFileSync(path.join(root, scriptPath), "utf8");
  const htmlIds = new Set(Array.from(html.matchAll(/\bid=["']([^"']+)["']/g), (match) => match[1]));
  const requiredIds = new Set([
    ...Array.from(script.matchAll(/getElementById\(["']([^"']+)["']\)/g), (match) => match[1]),
    ...Array.from(script.matchAll(/\belement\(["']([^"']+)["']\)/g), (match) => match[1]),
  ]);
  const missing = [...requiredIds].filter((id) => !htmlIds.has(id) && !generatedIds.has(id));
  assert.deepEqual(missing, [], `${scriptPath} references IDs missing from ${htmlPath}: ${missing.join(", ")}`);
  assert.ok(html.includes(`src="/${scriptPath.replace("frontend/", "")}"`), `${htmlPath} does not load ${scriptPath}`);
}

for (const htmlPath of fs.readdirSync(path.join(root, "frontend", "pages")).filter((name) => name.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(root, "frontend", "pages", htmlPath), "utf8");
  const ids = Array.from(html.matchAll(/\bid=["']([^"']+)["']/g), (match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `${htmlPath} contains duplicate element IDs`);
  for (const source of Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/g), (match) => match[1])) {
    assert.ok(source.startsWith("/assets/"), `${htmlPath} loads an unexpected script URL: ${source}`);
    assert.ok(fs.existsSync(path.join(root, "frontend", source)), `${htmlPath} loads a missing script: ${source}`);
  }
  for (const href of Array.from(html.matchAll(/<link[^>]+href=["']([^"']+)["']/g), (match) => match[1])) {
    if (!href.startsWith("/assets/")) continue;
    assert.ok(fs.existsSync(path.join(root, "frontend", href)), `${htmlPath} loads a missing stylesheet: ${href}`);
  }
}

const reportWorkspaceCss = fs.readFileSync(
  path.join(root, "frontend", "assets", "css", "report-form", "workspace.css"),
  "utf8",
);
assert.match(
  reportWorkspaceCss,
  /body\.report-linked\s+\.report-shell-title\s*\{[^}]*display:\s*none;/s,
  "Task-linked report forms must hide the duplicate report-shell title",
);

console.log("PASS: frontend pages, controllers, IDs, and local assets are consistent");
