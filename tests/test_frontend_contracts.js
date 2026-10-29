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
  ["frontend/pages/estimation.html", "frontend/assets/js/pages/estimation.js"],
  ["frontend/pages/progress-completion.html", "frontend/assets/js/pages/progress-completion.js"],
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

const institutionsSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "core", "institutions.js"), "utf8");
assert.match(institutionsSource, /code:\s*"CANARA",\s*name:\s*"Canara Bank"/, "Canara Bank must be included in the default institution registry");

const taskStoreSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "core", "task-store.js"), "utf8");
assert.match(taskStoreSource, /progress:\s*\{[^}]*route:\s*"\/progress-completion"/, "Progress assignments must open the linked report form");
assert.match(taskStoreSource, /completion:\s*\{[^}]*route:\s*"\/progress-completion"/, "Completion assignments must open the linked report form");
assert.match(taskStoreSource, /requiresInstitutionOfflineArtifact/, "Institution-specific offline valuation artifacts must be lifecycle-gated");

const generalPage = fs.readFileSync(path.join(root, "frontend", "pages", "general.html"), "utf8");
assert.match(generalPage, /institution-valuation-offline\.js/, "General valuation must load the institution-specific offline workflow controller");
const institutionOfflineSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "institution-valuation-offline.js"), "utf8");
assert.match(institutionOfflineSource, /\/templates\/kvb-valuation\.xlsx/, "KVB workflow must provide the approved Excel template");
assert.match(institutionOfflineSource, /\/api\/valuation\/karnataka\/upload/, "Karnataka Bank workflow must accept the Valocity artifact");
assert.match(institutionOfflineSource, /removeInstitutionArtifact/, "Institution-specific uploads must be removable before task completion");
assert.match(institutionOfflineSource, /offline-artifact-download[\s\S]*?Download completed report/, "Institution-specific uploads must reuse an icon-only download control");
const institutionOfflineCss = fs.readFileSync(path.join(root, "frontend", "assets", "css", "institution-valuation-offline.css"), "utf8");
assert.match(institutionOfflineCss, /\.institution-offline-valuation \.file-input\s*\{\s*display:\s*none;/, "Institution-specific uploads must hide the native file input");

const tasksPage = fs.readFileSync(path.join(root, "frontend", "pages", "tasks.html"), "utf8");
assert.match(tasksPage, /id="export-tasks"/, "Assignment lists must expose the filtered Excel export");
assert.match(tasksPage, /id="export-institutions"/, "The institution directory must expose its Excel export");
assert.match(tasksPage, /export-icon-button[^>]*title="Export to Excel"/, "Excel exports must use an icon with a hover label");
assert.match(tasksPage, /src="\/assets\/js\/core\/workbook-export\.js"/, "Task exports must load the workbook download helper");

const workflowUiSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "components", "workflow-ui.js"), "utf8");
assert.match(workflowUiSource, /function openTaskControl\(task\)/, "Task rows must use one consistent open-task control");
assert.match(workflowUiSource, /class="task-row-action"/, "Dashboard rows must reserve a consistent action column");

const estimationController = fs.readFileSync(
  path.join(root, "frontend", "assets", "js", "pages", "estimation.js"),
  "utf8",
);
assert.match(
  estimationController,
  /function setWorkMode\(mode\)\s*\{[\s\S]*?state\.details\.workMode = mode;[\s\S]*?renderAll\([\s\S]*?persistDraftNow\(\);/,
  "Selecting a preparation mode must persist the selection immediately",
);
assert.match(
  estimationController,
  /component-mode-separator[\s\S]*?function reportModePanel\(\)[\s\S]*?class="subgroup report-mode-panel"/,
  "Estimation preparation mode must remain a separate component-selection section",
);
assert.match(
  estimationController,
  /const online = state\.details\.workMode === "online";[\s\S]*?const offline = state\.details\.workMode === "offline";[\s\S]*?Choose preparation method/,
  "A missing preparation mode must not be presented as the online route",
);
assert.match(
  estimationController,
  /function selectedWorkModeControl\(\)[\s\S]*?work-mode[\s\S]*?:checked[\s\S]*?function synchroniseWorkMode\(\)/,
  "The selected preparation-mode control must be available for reconciliation",
);
assert.match(
  estimationController,
  /async function downloadWorkbook\(mode\)\s*\{[\s\S]*?const selectedMode = synchroniseWorkMode\(\);[\s\S]*?const requiredWorkMode = mode === "completed" \? "online" : "offline";[\s\S]*?selectedMode !== requiredWorkMode/,
  "Completed Excel generation must map to the Fill online preparation mode before validating it",
);

console.log("PASS: frontend pages, controllers, IDs, and local assets are consistent");
