# Codebase Guide

This guide is the starting point for developers who need to understand or
maintain SLN Property Reports. It describes the current architecture; it does
not prescribe a future framework or database design.

The approved durable business-data rollout is tracked separately in
`docs/DATABASE_IMPLEMENTATION_PLAN.md`.

## Read this first

The application is intentionally a small, dependency-light Python web server
and browser JavaScript application. It does not use a JavaScript bundler or
framework. Browser scripts communicate through documented `window.*` globals,
and the order in which a page loads scripts is therefore significant.

Before changing a feature:

1. Identify whether it belongs to the durable workflow service, a valuation
   form, generated documents, or a browser-only draft/preference.
2. Change the narrowest owning module listed below.
3. Keep public HTML IDs, CSS classes, script URLs, browser-storage keys, API
   routes, and report-template placeholders stable unless the whole integration
   is changed together.
4. Run the checks in `docs/DEVELOPMENT.md` and manually exercise the affected
   workflow.

## Where a change belongs

| Need | Primary owner | Related files to inspect |
| --- | --- | --- |
| Start the server or change static-file mapping | `backend/server.py`, `backend/app/web/handler.py` | `compose.yaml` |
| Change login, sessions or account recovery | `backend/app/auth/service.py` | `routes.py`, `frontend/assets/js/pages/auth.js` |
| Change authenticator behavior | `backend/app/auth/mfa.py` | `security.py`, auth migrations |
| Change password reuse rules | `backend/app/auth/password_policy.py` | `config.py`, `security.py` |
| Change durable business schema or grants | `backend/app/persistence/migrations.py` | `persistence/migrations/`, `backend/app/migrations.py` |
| Add or change a report field | `resources/<type>/form_schema.json` | matching page controller and mapping |
| Change report placeholder placement | `resources/<type>/template_mapping.json` | `backend/app/valuation/ooxml.py` |
| Change calculations or depreciation | `backend/app/valuation/calculations.py` | `frontend/assets/js/pages/general.js` when the live form also displays it |
| Change DOCX assembly | `backend/app/valuation/reports.py` | `backend/app/valuation/ooxml.py`, `backend/app/valuation/media.py` |
| Change estimation XLSX assembly | `backend/app/estimation/generator.py` | `resources/estimation/`, `frontend/assets/js/pages/estimation-schema.js` |
| Change progress/completion DOCX assembly | `backend/app/progress/generator.py` | `frontend/assets/js/pages/progress-completion.js` |
| Change photo/map behavior | `backend/app/valuation/media.py` | general or agricultural controller |
| Change task lifecycle or payment rules | `backend/app/workflow/service.py` | `workflow/routes.py`, `core/task-store.js` adapter |
| Change father/employee task policy | `backend/app/workflow/service.py` | `core/workflow-access.js`, authenticated role from `backend/app/auth/` |
| Change institution persistence | `backend/app/reference/service.py` | `core/institutions.js`, `pages/institution-settings.js` |
| Change workflow API transport | `backend/app/workflow/routes.py` | `core/business-api.js`, `core/task-store.js` |
| Change task-linked report drafts or local-file registration | `backend/app/reports/service.py` | `reports/routes.py`, `core/report-data.js` |
| Change dashboard totals or charts | `frontend/assets/js/components/institution-metrics.js` | `pages/home.js` |
| Change assignment list/filter behavior | `frontend/assets/js/pages/task-list.js` | `components/workflow-ui.js` |
| Change one task's workspace | `frontend/assets/js/pages/task-detail.js` | `components/payment-dialog.js`, `components/employee-picker.js` |
| Change form workflow context | `frontend/assets/js/components/task-context.js` | general/agricultural page controller |
| Change global page chrome | `frontend/assets/js/core/app-shell.js` | `workflow.css` imports |
| Change My Account or its photo/password controls | `backend/app/auth/account.py` | `auth/routes.py`, `pages/account.js`, `workflow/account.css` |
| Change durable task notifications | `backend/app/workflow/notifications.py` | `workflow/service.py`, `workflow/routes.py`, `components/account-chrome.js` |
| Change report-form visual primitives | `frontend/assets/css/styles.css` | matching page HTML |
| Change dashboard/task visual styling | `frontend/assets/css/workflow.css` | matching workflow page |

## Runtime map

```text
Browser page
  ├─ core/                      shared state, shell, access and utilities
  ├─ components/                reusable UI and workflow components
  └─ pages/                     one controller per HTML page

Python HTTP server
  ├─ auth/                     users, sessions, MFA, email, migration and CLI
  ├─ workflow/                 authoritative assignments, transitions and payments
  ├─ reference/                durable institution directory
  ├─ reports/                  task drafts, artifacts, snapshots and local files
  ├─ persistence/              app-schema migrations and grants
  ├─ web/handler.py            routes, static files, preview/download responses
  └─ valuation/                form schemas, calculations, DOCX and media generation
```

## Frontend boundaries

### Shared browser APIs

These modules deliberately publish browser globals because pages use plain
script tags rather than imports. Their public names are integration boundaries:

| Global | Owner | Responsibility |
| --- | --- | --- |
| `BusinessApi` | `core/business-api.js` | Authenticated JSON transport and CSRF handling |
| `ReportData` | `core/report-data.js` | Durable task drafts and browser-local practice drafts |
| `TaskStore` | `core/task-store.js` | Workflow API adapter, task cache and legacy test compatibility |
| `WorkflowAccess` | `core/workflow-access.js` | Current role and presentation-level action visibility |
| `Institutions` / `INSTITUTIONS` | `core/institutions.js` | Institution API adapter and compatibility view |
| `InstitutionMetrics` | `components/institution-metrics.js` | Workload, finance, period and report-mix aggregation |
| `WorkflowUI` | `components/workflow-ui.js` | Escaping, display formatting and shared task rows |
| `EmployeePicker` | `components/employee-picker.js` | Assignment/transfer employee selector |
| `PaymentDialog` | `components/payment-dialog.js` | Completed-task payment popup |
| `ValuationUI` | `core/shared.js` | Shared report-form controls, parsing, dates and file reading |
| `Appearance` | `core/appearance.js` | Persisted light/dark preference |
| `AppShell` | `core/app-shell.js` | Header, sidebar and responsive navigation |

Do not rename these globals, alter their public methods, or change their script
order as a local cleanup. Those changes affect multiple pages at once.

### Page controllers

- `home.js`: dashboard state, charts, recent activity and finance views.
- `task-list.js`: filters, pagination, institution drill-down and directory.
- `new-task.js`: assignment creation, validation and eligible-estimation selection.
- `task-detail.js`: a single task's actions, payment, history and final DOCX.
- `task-context.js`: workflow controls shown around a report form opened from a task.
- `general.js`: general-property valuation form only.
- `agricultural.js`: agricultural valuation form only.
- `estimation.js`: preparation choice, detailed-estimation configuration, measurements, drafts and online XLSX workflow.
- `estimation-naming.js`: display labels and compact-Abstract rules mirrored by `estimation/presentation.py`.
- `estimation-offline.js`: attachment-first XLSX/DOCX/PDF entry and reviewed component totals.
- `retrospective-valuation.js`: standard offline valuation uploads, explicit upload type and task-recorded template downloads.
- `progress-completion.js`: linked-estimation progress/completion entry, photographs, preview and DOCX generation.
- `institution-settings.js`: CEO-only institution maintenance.
- `report-layout.js`: long-form navigation collapse state and mounting the shared scratch calculator.
- `report-calculator.js`: safe Basic/Scientific expression parsing, angle modes, memory and local per-user/task/day scratch history.
- `estimation-processing.js`: one busy indicator and conflicting-action guard for estimation requests.
- `report-readonly.js`: locks terminal report inputs/actions while preserving section navigation. `ReportData.readOnly` also guards browser persistence; backend write guards remain authoritative.

`core/valuation-calculations.js` owns general/agricultural live calculated-result
dependencies and explicit draft overrides. It mirrors valuation arithmetic from
`valuation/calculations.py`; it does not change section visibility or workflow
permissions. Manual results are stored under `calculation.overrides` inside the
existing report values so draft and artifact freshness include those edits.

## Backend boundaries

The backend modules are intentionally organized by domain responsibility rather
than by HTTP endpoint:

- `valuation/config.py`: filesystem paths and XML namespace utilities.
- `valuation/schemas.py`: loads and prepares field schemas from `resources/`.
- `valuation/formatting.py`: parsing and presentation utilities shared by reports.
- `valuation/calculations.py`: valuation-only arithmetic and result assembly.
- `valuation/ooxml.py`: low-level WordprocessingML edits. Keep business decisions out.
- `valuation/media.py`: image normalization and Word media placement. Keep form rules out.
- `valuation/reports.py`: coordinates schema values, templates, calculations and output.
- `estimation/generator.py`: copies approved XLSX masters, applies estimation form state and returns completed or offline workbooks.
- `estimation/presentation.py`: identity-version compatibility, shared work/address composition, stable component labels and compact-Abstract selection.
- `estimation/summary.py`: extracts the retained component-cost snapshot from an attached completed estimation workbook.
- `progress/generator.py`: validates linked-estimation progress state and creates bank-aware Progress/Completion DOCX reports.
- `exports/workbook.py`: validates approved browser-table export payloads and
  creates typed, filter-aware A4 Excel workbooks inside the existing Python
  application container.
- `web/handler.py`: HTTP parsing, validation, static delivery, previews and downloads.
- `auth/`: PostgreSQL identity boundary. `routes.py` adapts HTTP, `service.py`
  owns account/session use cases, `security.py` owns cryptographic primitives,
  `database.py` owns runtime connections, `migrations.py` owns migration and
  role orchestration, and `migrations/` contains ordered SQL changes for the
  dedicated `auth` schema.
- `persistence/`: PostgreSQL migration boundary for the separate `app` schema.
  It owns durable business tables and least-privilege grants but no workflow
  decisions.
- `workflow/service.py`: authoritative task creation, assignment, transitions,
  duplicate/concurrency checks, payments, paginated lists, CEO-only preparation
  filtering, task template-download records and linked-estimation correction cascades.
  Dependant source tags join the current parent method; immutable cost snapshots
  advance only through the explicit reopen/finalize/review correction workflow.
  `workflow/routes.py` is its authenticated HTTP adapter.
- `reference/service.py`: durable bank/NBFC directory and CEO-only mutations.
- `reports/service.py`: durable task-linked drafts, task-scoped image files,
  report revisions, generated/uploaded artifacts and immutable estimation
  snapshots for online XLSX and offline XLSX/DOCX/PDF. Explicit preparation choices
  are saved with drafts/artifacts; Filled template registration checks only the
  task download timestamp. `reports/routes.py` is the authenticated draft/file
  adapter.

Do not place workflow or reference-data queries in `auth/` merely because all
three domains use PostgreSQL.

## CSS ownership

- `styles.css` is the stable report-form entry point. Its ordered files under
  `css/report-form/` separate foundational controls from workspace additions.
- `workflow/dashboard-overview.css` is loaded only by the dashboard and owns
  its responsive analysis grid, shared-period controls and distribution charts.
- `action-controls.css` supplies shared action typography, safe wrapping,
  payment/picker spacing and retained-report view styling to both entry points.
- `workflow.css` is the stable application entry point. Its ordered files under
  `css/workflow/` separate the shell, dashboard, institution pages,
  visualizations, and final compatibility adjustments.
- `auth.css` is the stable authentication entry point. Its files under
  `css/auth/` separate tokens, layout, components, and responsive behavior.

Do not reorder these imports without desktop, mobile, light, and dark visual
regression checks. The entry-point URLs remain stable for page compatibility.

## Resources and generated files

`resources/general/`, `resources/agricultural/`, and `resources/estimation/`
are production inputs, not examples. Their templates, schemas, mappings, and
estimation manifest must change together when a report format changes.

`outputs/` contains generated data. It is not source code. The historical
`archive/template_development/` directory is retained for reference and is not
used at runtime.

## Safe maintenance checklist

1. Preserve the current working tree before a change set.
2. Make changes in one ownership area at a time.
3. Keep durable task state and permission enforcement in the backend workflow
   service. Keep `TaskStore` and `WorkflowAccess` aligned for frontend behavior.
4. Keep calculation rules in backend calculation modules; mirror only the
   display calculation that a form must show before generation.
5. For document changes, run both generated-document regression scripts.
6. For workflow changes, run `tests/test_task_store.js`.
7. For frontend changes, run `node --check` across `frontend/assets/js/`.
8. Inspect `git diff --check` and the final diff before committing.

## Intentionally deferred refactors

The following are known candidates, but should be separate, fully tested work:

- Extracting common report-form behavior from `general.js` and
  `agricultural.js`.
- Replacing browser-global JavaScript with bundled modules.

The report controllers remain cohesive because they share page-local mutable
form state. Extracting pieces without introducing a real module boundary would
obscure dependencies and risk report values, drafts, and media behavior.
