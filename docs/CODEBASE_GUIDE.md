# Codebase Guide

This guide is the starting point for developers who need to understand or
maintain SLN Property Reports. It describes the current architecture; it does
not prescribe a future framework or database design.

## Read this first

The application is intentionally a small, dependency-light Python web server
and browser JavaScript application. It does not use a JavaScript bundler or
framework. Browser scripts communicate through documented `window.*` globals,
and the order in which a page loads scripts is therefore significant.

Before changing a feature:

1. Identify whether it belongs to the workflow, a valuation form, generated
   documents, or the temporary browser repositories.
2. Change the narrowest owning module listed below.
3. Keep public HTML IDs, CSS classes, script URLs, browser-storage keys, API
   routes, and report-template placeholders stable unless the whole integration
   is changed together.
4. Run the checks in `docs/DEVELOPMENT.md` and manually exercise the affected
   workflow.

## Where a change belongs

| Need | Primary owner | Related files to inspect |
| --- | --- | --- |
| Start the server or change static-file mapping | `backend/server.py`, `backend/app/web.py` | `compose.yaml` |
| Add or change a report field | `resources/<type>/form_schema.json` | matching page controller and mapping |
| Change report placeholder placement | `resources/<type>/template_mapping.json` | `backend/app/ooxml.py` |
| Change calculations or depreciation | `backend/app/calculations.py` | `frontend/assets/js/general.js` when the live form also displays it |
| Change DOCX assembly | `backend/app/reports.py` | `backend/app/ooxml.py`, `backend/app/media.py` |
| Change photo/map behavior | `backend/app/media.py` | general or agricultural controller |
| Change task lifecycle or payment rules | `frontend/assets/js/task-store.js` | `workflow-access.js` |
| Change father/employee access | `frontend/assets/js/workflow-access.js` | page controller only for display changes |
| Change dashboard totals or charts | `frontend/assets/js/institution-metrics.js` | `home.js` |
| Change assignment list/filter behavior | `frontend/assets/js/task-list.js` | `workflow-ui.js` |
| Change one task's workspace | `frontend/assets/js/task-detail.js` | `payment-dialog.js`, `employee-picker.js` |
| Change form workflow context | `frontend/assets/js/task-context.js` | general/agricultural controller |
| Change global page chrome | `frontend/assets/js/app-shell.js` | `workflow.css` |
| Change report-form visual primitives | `frontend/assets/css/styles.css` | matching page HTML |
| Change dashboard/task visual styling | `frontend/assets/css/workflow.css` | matching workflow page |

## Runtime map

```text
Browser page
  ├─ app-shell.js              shared header and sidebar
  ├─ workflow-access.js        current prototype role and permissions
  ├─ institutions.js           configured bank/NBFC browser repository
  ├─ task-store.js             task browser repository and workflow invariants
  ├─ shared UI helper modules   formatting, metrics, dialogs, employee picker
  └─ page controller            one page's interactive behavior

Python HTTP server
  ├─ web.py                    routes, static files, preview/download responses
  ├─ schemas.py                resource-backed form schemas
  ├─ calculations.py           report values and depreciation rules
  ├─ reports.py                report orchestration
  ├─ ooxml.py                  Word table, token, and paragraph operations
  └─ media.py                  EXIF correction and document media layout
```

## Frontend boundaries

### Shared browser APIs

These modules deliberately publish browser globals because pages use plain
script tags rather than imports. Their public names are integration boundaries:

| Global | Owner | Responsibility |
| --- | --- | --- |
| `TaskStore` | `task-store.js` | Browser persistence, lifecycle transitions, payment rules, task queries |
| `WorkflowAccess` | `workflow-access.js` | Current role, visible tasks, permission decisions |
| `Institutions` / `INSTITUTIONS` | `institutions.js` | Configurable institutions and compatibility view |
| `InstitutionMetrics` | `institution-metrics.js` | Workload, finance, period and report-mix aggregation |
| `WorkflowUI` | `workflow-ui.js` | Escaping, display formatting and shared task rows |
| `EmployeePicker` | `employee-picker.js` | Assignment/transfer employee selector |
| `PaymentDialog` | `payment-dialog.js` | Completed-task payment popup |
| `ValuationUI` | `shared.js` | Shared report-form controls, parsing, dates and file reading |
| `Appearance` | `appearance.js` | Persisted light/dark preference |
| `AppShell` | `app-shell.js` | Header, sidebar and responsive navigation |

Do not rename these globals, alter their public methods, or change their script
order as a local cleanup. Those changes affect multiple pages at once.

### Page controllers

- `home.js`: dashboard state, charts, recent activity and finance views.
- `task-list.js`: filters, pagination, institution drill-down and directory.
- `new-task.js`: assignment creation, validation and local draft recovery.
- `task-detail.js`: a single task's actions, payment, history and final DOCX.
- `task-context.js`: workflow controls shown around a report form opened from a task.
- `general.js`: general-property valuation form only.
- `agricultural.js`: agricultural valuation form only.
- `institution-settings.js`: father-only institution maintenance.
- `report-layout.js`: long-form navigation collapse state.

## Backend boundaries

The backend modules are intentionally organized by responsibility rather than
by HTTP endpoint:

- `config.py`: filesystem paths and XML namespace utilities.
- `schemas.py`: loads and prepares field schemas from `resources/`.
- `formatting.py`: parsing and presentation utilities shared by reports.
- `calculations.py`: valuation-only arithmetic and result assembly.
- `ooxml.py`: low-level WordprocessingML edits. Keep business decisions out.
- `media.py`: image normalization and Word media placement. Keep form rules out.
- `reports.py`: coordinates schema values, templates, calculations and output.
- `web.py`: HTTP parsing, validation, static delivery, previews and downloads.

## CSS ownership

- `styles.css` owns universal report-form elements: fields, panels, document
  previews, uploads and report-form responsive rules.
- `workflow.css` owns the shell, dashboard, task pages, workflow dialogs,
  status/presentation components and dark-mode rules.

`workflow.css` contains deliberate compatibility overrides accumulated during
the UI redesign. Do not move, merge or reorder selector groups without visual
regression checks at desktop and mobile widths in both themes.

## Resources and generated files

`resources/general/` and `resources/agricultural/` are production inputs, not
examples. Their `.docx` templates, schemas and mappings must change together
when a report format changes.

`outputs/` contains generated data. It is not source code. The historical
`archive/template_development/` directory is retained for reference and is not
used at runtime.

## Safe maintenance checklist

1. Preserve the current working tree before a change set.
2. Make changes in one ownership area at a time.
3. Keep task state changes in `TaskStore`, and keep role checks in
   `WorkflowAccess`.
4. Keep calculation rules in backend calculation modules; mirror only the
   display calculation that a form must show before generation.
5. For document changes, run both generated-document regression scripts.
6. For workflow changes, run `tests/test_task_store.js`.
7. For frontend changes, run `node --check` across `frontend/assets/js/`.
8. Inspect `git diff --check` and the final diff before committing.

## Intentionally deferred refactors

The following are known candidates, but should be separate, fully tested work:

- Consolidating or reordering `workflow.css`.
- Extracting common report-form behavior from `general.js` and
  `agricultural.js`.
- Replacing browser-global JavaScript with bundled modules.
- Replacing temporary browser storage with the durable database layer.
- Moving source files into a different folder hierarchy.

They are not ordinary cleanup because each can affect page load order, visual
cascade, report values, drafts, or workflow state.
