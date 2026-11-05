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

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(current) : [current];
  });
}

const javascriptRoot = path.join(root, "frontend", "assets", "js");
const browserStorageUsers = filesUnder(javascriptRoot)
  .filter((file) => file.endsWith(".js") && /(?:local|session)Storage/.test(fs.readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file).replaceAll(path.sep, "/"));
assert.deepEqual(browserStorageUsers.sort(), [
  "frontend/assets/js/components/report-layout.js",
  "frontend/assets/js/core/app-shell.js",
  "frontend/assets/js/core/appearance.js",
  "frontend/assets/js/core/report-data.js",
  "frontend/assets/js/core/shared.js",
  "frontend/assets/js/pages/auth.js",
].sort(), "Browser storage must remain limited to appearance/navigation, practice drafts, and temporary auth recovery codes");

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

for (const htmlPath of ["index.html", "tasks.html", "task.html", "new-task.html", "institutions.html", "general.html", "agricultural.html", "estimation.html", "progress-completion.html"]) {
  const html = fs.readFileSync(path.join(root, "frontend", "pages", htmlPath), "utf8");
  const apiPosition = html.indexOf('src="/assets/js/core/business-api.js"');
  const taskStorePosition = html.indexOf('src="/assets/js/core/task-store.js"');
  const institutionPosition = html.indexOf('src="/assets/js/core/institutions.js"');
  const timePosition = html.indexOf('src="/assets/js/core/time.js"');
  assert.ok(apiPosition >= 0, `${htmlPath} must load the authenticated business API adapter`);
  assert.ok(timePosition >= 0, `${htmlPath} must load tenant-calendar support`);
  if (taskStorePosition >= 0) {
    assert.ok(apiPosition < taskStorePosition, `${htmlPath} must load BusinessApi before TaskStore`);
    assert.ok(timePosition < taskStorePosition, `${htmlPath} must load tenant-calendar support before TaskStore`);
  }
  if (institutionPosition >= 0) assert.ok(apiPosition < institutionPosition, `${htmlPath} must load BusinessApi before InstitutionStore`);
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
assert.doesNotMatch(taskStoreSource, /localStorage|sessionStorage/, "TaskStore must not retain business data in browser storage");
assert.match(taskStoreSource, /progress-reports/, "Progress history must come from the targeted backend endpoint");
assert.match(taskStoreSource, /progress:\s*\{[^}]*route:\s*"\/progress-completion"/, "Progress assignments must open the linked report form");
assert.match(taskStoreSource, /completion:\s*\{[^}]*route:\s*"\/progress-completion"/, "Completion assignments must open the linked report form");
assert.match(taskStoreSource, /requiresInstitutionOfflineArtifact/, "Institution-specific offline valuation artifacts must be lifecycle-gated");

const progressControllerSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "progress-completion.js"), "utf8");
assert.match(progressControllerSource, /ReportData\.setPreview\(\{ id: result\.preview_id, url: result\.preview \}\)/, "Progress previews must be retained across unchanged reloads");
assert.match(progressControllerSource, /new CustomEvent\("sln:report-dirty"\)/, "Progress input changes must invalidate retained reports");
assert.match(progressControllerSource, /Please preview the latest report before downloading the DOCX/, "Progress DOCX generation must require the latest preview");
assert.match(progressControllerSource, /Attach at least one authenticated site photograph/, "Progress and Completion reports must require a site photograph before preview or generation");

const generalPage = fs.readFileSync(path.join(root, "frontend", "pages", "general.html"), "utf8");
assert.match(generalPage, /institution-valuation-offline\.js/, "General valuation must load the institution-specific offline workflow controller");
const institutionOfflineSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "institution-valuation-offline.js"), "utf8");
assert.match(institutionOfflineSource, /\/templates\/kvb-valuation\.xlsx/, "KVB workflow must provide the approved Excel template");
assert.match(institutionOfflineSource, /\/api\/valuation\/karnataka\/upload/, "Karnataka Bank workflow must accept the Valocity artifact");
assert.match(institutionOfflineSource, /ReportData\.requestHeaders[\s\S]*method:\s*"DELETE"/, "Institution-specific uploads must be removed through the authenticated artifact endpoint");
assert.match(institutionOfflineSource, /offline-artifact-download[\s\S]*?Download completed report/, "Institution-specific uploads must reuse an icon-only download control");
const institutionOfflineCss = fs.readFileSync(path.join(root, "frontend", "assets", "css", "institution-valuation-offline.css"), "utf8");
assert.match(institutionOfflineCss, /\.institution-offline-valuation \.file-input\s*\{\s*display:\s*none;/, "Institution-specific uploads must hide the native file input");

const valuationPreparationSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "retrospective-valuation.js"), "utf8");
assert.match(valuationPreparationSource, /\["father", "employee"\][\s\S]*supportsChoice/, "CEO and employees must both receive the standard valuation preparation choice");
assert.match(valuationPreparationSource, /Fill online[\s\S]*Complete offline and upload/, "Valuation preparation must present one online and one offline route");
assert.match(valuationPreparationSource, /function preparationPanel[\s\S]*function offlinePanel/, "Preparation choice and offline upload must be separate report sections");
assert.doesNotMatch(valuationPreparationSource, /CEO-only|data-retrospective-mode|Import retrospective report/, "Offline valuation controls must not expose the superseded CEO-only nested route UI");

const generalControllerSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "general.js"), "utf8");
const agriculturalControllerSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "agricultural.js"), "utf8");
for (const [label, source] of [["General", generalControllerSource], ["Agricultural", agriculturalControllerSource]]) {
  assert.match(source, /preparationMethod[\s\S]*ReportData\.save/, `${label} preparation method must be retained in the durable draft`);
  assert.match(source, /Preparation Method[\s\S]*Complete & Upload Report/, `${label} must place preparation before the dedicated offline upload section`);
  assert.doesNotMatch(source, /RetrospectiveValuation\?\.attach|RetrospectiveValuation\.attach/, `${label} must not append offline upload controls to Photos & Map`);
}

const agriculturalSchema = JSON.parse(fs.readFileSync(path.join(root, "resources", "agricultural", "form_schema.json"), "utf8"));
assert.deepEqual(agriculturalSchema.sections.map((section) => section.label), ["Report Setup", "Documents & Property", "Site & Land", "Valuation", "Photos & Map"], "Agricultural section names must match the standard valuation terminology");

const reportFoundationCss = fs.readFileSync(path.join(root, "frontend", "assets", "css", "report-form", "foundation.css"), "utf8");
assert.doesNotMatch(reportFoundationCss, /\.hint\s*\{[^}]*margin:\s*-[^;}]+/s, "Report helper text must not use negative margins that crowd section headings");
const reportContextCss = fs.readFileSync(path.join(root, "frontend", "assets", "css", "workflow", "report-context.css"), "utf8");
assert.match(reportContextCss, /\.report-task-context__summary\s*\{[^}]*min-width:\s*0/s, "Long assignment names must be allowed to wrap inside their banner column");
assert.match(reportContextCss, /\.report-direct-actions button\s*\{[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/s, "Assignment action buttons must retain stable dimensions beside long names");

for (const pageName of ["general.html", "agricultural.html", "estimation.html", "progress-completion.html"]) {
  const page = fs.readFileSync(path.join(root, "frontend", "pages", pageName), "utf8");
  assert.match(page, /src="\/assets\/js\/core\/report-data\.js"/, `${pageName} must load durable task-report data support`);
}

const tasksPage = fs.readFileSync(path.join(root, "frontend", "pages", "tasks.html"), "utf8");
assert.match(tasksPage, /id="export-tasks"/, "Assignment lists must expose the filtered Excel export");
assert.match(tasksPage, /id="export-institutions"/, "The institution directory must expose its Excel export");
assert.match(tasksPage, /export-icon-button[^>]*title="Export to Excel"/, "Excel exports must use an icon with a hover label");
assert.match(tasksPage, /src="\/assets\/js\/core\/workbook-export\.js"/, "Task exports must load the workbook download helper");
assert.match(tasksPage, /id="task-period-switch"/, "Assignment lists must use the selectable date-period control");
assert.match(tasksPage, /id="task-period-picker"/, "Assignment lists must allow a selected day, week, month, or year");
const taskListSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "task-list.js"), "utf8");
assert.match(taskListSource, /\["", "All time"\]/, "Assignment lists must label the unbounded date filter as All time");
assert.match(taskListSource, /function weekOptions\(\)/, "Assignment lists must provide selectable week ranges");
assert.match(taskListSource, /index < 52/, "Assignment weekly filters must offer the current and preceding 51 weeks");
assert.match(taskListSource, /ValuxTime\.todayDate\(\)/, "Assignment periods must use the tenant calendar");
assert.match(taskListSource, /type="month"/, "Assignment lists must provide a month picker beyond the current month");

const newTaskPage = fs.readFileSync(path.join(root, "frontend", "pages", "new-task.html"), "utf8");
const newTaskSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "pages", "new-task.js"), "utf8");
assert.doesNotMatch(newTaskSource, /localStorage|sessionStorage|DRAFT_KEY/, "Live assignment creation must not store business drafts in the browser");
assert.doesNotMatch(newTaskPage, /draft-status|discard-draft/, "Live assignment creation must not advertise a browser-local business draft");
assert.match(newTaskPage, /id="linked-estimation-modal"/, "Progress and Completion creation must use the eligible-estimation selection dialog");
assert.match(newTaskPage, /id="estimation-picker-search"/, "The eligible-estimation dialog must be searchable");
assert.match(newTaskPage, /id="estimation-picker-institution"/, "The eligible-estimation dialog must support institution filtering");
assert.match(newTaskPage, /id="estimation-picker-more"/, "The eligible-estimation dialog must expose bounded pagination");
assert.match(newTaskPage, /id="similar-task-warning"/, "Assignment creation must show a reviewable similar-task warning");
assert.match(newTaskSource, /allowSimilarTaskId/, "A user must be able to explicitly create genuinely separate similar work");
assert.match(newTaskSource, /error\.code === "duplicate"/, "Exact duplicate assignments must remain blocked with the existing task shown");

const institutionStoreSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "core", "institutions.js"), "utf8");
assert.doesNotMatch(institutionStoreSource, /localStorage|sessionStorage/, "Institution data must come only from the backend API");
const appShellSource = fs.readFileSync(path.join(root, "frontend", "assets", "js", "core", "app-shell.js"), "utf8");
assert.doesNotMatch(appShellSource, /sln\.workflow\.tasks/, "The shared shell must not read the retired browser task repository");

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
  /function sectionDefinitions\(\)[\s\S]*?key: "setup"[\s\S]*?key: "preparation"[\s\S]*?label: "Preparation Method"/,
  "Estimation preparation method must precede component selection",
);
assert.match(
  estimationController,
  /if \(state\.details\.workMode !== "online"\) return setup;/,
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
assert.match(
  estimationController,
  /confirmReportInvalidation[\s\S]*?Change the preparation method to[\s\S]*?Existing component data was retained/,
  "Changing estimation preparation mode must warn about output invalidation while retaining component data",
);
assert.match(
  estimationController,
  /ReportData\.preview\(\)[\s\S]*?Preview the current workbook before generating the completed Excel report/,
  "Online estimation generation must require the current persisted preview",
);
assert.match(
  estimationController,
  /ReportData\.setPreview\(\{ id: preview\.preview_id, url: preview\.preview \}\)/,
  "Estimation preview approval must be retained by the shared report-data boundary",
);

console.log("PASS: frontend pages, controllers, IDs, and local assets are consistent");
