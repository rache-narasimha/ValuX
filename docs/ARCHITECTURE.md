# Application Architecture

## Directory map

```text
valuation_app/
├── backend/
│   ├── __init__.py
│   ├── server.py              # Minimal executable entry point
│   └── app/
│       ├── auth/              # Identity, sessions, MFA, policy, email and migrations
│       ├── valuation/         # Form schemas, calculation, DOCX and media generation
│       └── web/               # HTTP request handling and static delivery
├── frontend/
│   ├── pages/
│   │   ├── index.html
│   │   ├── auth.html
│   │   ├── tasks.html
│   │   ├── new-task.html
│   │   ├── task.html
│   │   ├── institutions.html
│   │   ├── practice.html
│   │   ├── general.html
│   │   └── agricultural.html
│   └── assets/
│       ├── css/
│       │   ├── styles.css     # Ordered report-form imports
│       │   ├── auth.css       # Ordered authentication imports
│       │   ├── workflow.css   # Ordered application imports
│       │   ├── report-form/   # Form foundations and workspace rules
│       │   ├── auth/          # Tokens, layout, components, responsive rules
│       │   └── workflow/      # Shell, dashboards, pages, charts, safeguards
│       └── js/
│           ├── core/          # Shared state, shell, access and utilities
│           ├── components/    # Reusable UI/workflow components
│           └── pages/         # One controller per HTML page
├── resources/
│   ├── general/
│   │   ├── master_template.docx
│   │   ├── form_schema.json
│   │   └── template_mapping.json
│   └── agricultural/
│       ├── master_template.docx
│       ├── form_schema.json
│       └── template_mapping.json
├── tests/
│   ├── fixtures/agricultural_sample_payload.json
│   ├── test_general_generation.py
│   ├── test_agricultural_generation.py
│   └── test_task_store.js
├── outputs/
│   ├── generated_reports/
│   └── test_artifacts/
├── archive/template_development/
├── scripts/                   # Local secret bootstrap and Gmail setup
├── docs/
├── Dockerfile
├── compose.yaml
└── requirements.txt
```

## Component responsibilities

### Backend

`backend/server.py` is a minimal application entry point. The modules under
`backend/app/` is divided into feature packages. `valuation/` owns
configuration, schemas, calculations, formatting, WordprocessingML
manipulation, media layout and report orchestration. `web/` owns HTTP routing
and static delivery.

The backend does not contain editable report-form markup. It reads form
definitions and Word templates from `resources/`. Authentication is isolated
under `backend/app/auth/`; its PostgreSQL `auth` schema does not contain report
or workflow data. `migrations.py` is the only migration entry point and also
maintains the restricted runtime role. The HTTP process never connects as the
database owner.

### Frontend

- `assets/js/core/app-shell.js` owns the shared Peach & Cream application header,
  icon navigation, assignment-state submenu, responsive drawer and persisted
  sidebar collapse state. Page controllers keep ownership of data and actions.
- `pages/index.html` and `assets/js/pages/home.js` provide the work dashboard.
- `pages/new-task.html`, `tasks.html`, and `task.html` implement assignment
  creation, the searchable work queue, and the task workspace.
- `assets/js/core/task-store.js` is the temporary task repository boundary. It uses
  browser storage during workflow discovery and is designed to be replaced by
  the future PostgreSQL API without changing the page controllers. It also
  owns workflow transitions, payment locking, the seven-day reopen rule and
  final-DOCX metadata; page controllers do not recreate those rules.
- `assets/js/core/institutions.js` is a separate temporary repository boundary for
  bank/NBFC configuration, active state and chart colours. Deactivation keeps
  historical task labels intact.
- `assets/js/core/workflow-access.js` adapts the authenticated server identity and
  centralizes task permissions so role rules are not hard-coded into pages.
- `assets/js/components/workflow-ui.js` renders shared work-task rows and display values.
- `assets/js/components/institution-metrics.js` owns configured-institution, period,
  workload, report-mix and financial aggregations used by dashboards and task
  lists. Institutions with no matching records remain present with zero values.
- `assets/js/components/payment-dialog.js` provides the reusable completed-report payment
  and close-request popup used wherever a completed task row appears.
- `assets/js/components/task-context.js` adds task status, action-note validation and
  return links around either valuation form when it is opened from a task.
- `assets/js/components/employee-picker.js` provides the shared employee-ID/name reference
  control used for initial assignment and the assignee-chip transfer dialog.
- `assets/js/core/appearance.js` owns the persisted light/dark preference used by
  all workflow and report-form pages. Generated reports remain white.
- `assets/js/components/report-layout.js` owns the persisted collapse state of the long
  report-form navigation.
- `pages/institutions.html` and `assets/js/pages/institution-settings.js` provide the
  CEO-only institution configuration surface.
- `pages/practice.html` provides safe links to report forms in practice mode,
  without creating or updating a workflow assignment.
- `assets/js/core/shared.js` contains reusable controls, parsing, date, institution
  and file-reading helpers used by every valuation form.
- `pages/general.html` and `assets/js/pages/general.js` implement residential, commercial and industrial valuation forms.
- `pages/agricultural.html` and `assets/js/pages/agricultural.js` implement agricultural valuation forms.
- CSS entry points keep page links stable while responsibility-specific files
  live under `assets/css/report-form/`, `assets/css/workflow/`, and
  `assets/css/auth/`.

### Browser script loading order

The frontend intentionally uses browser globals rather than a bundler. Script
order in each page is therefore part of the runtime contract:

1. `appearance.js` runs in the document head so the saved theme is applied
   before the page is displayed.
2. `app-shell.js` builds the shared header and navigation shell.
3. Repository and access modules (`institutions.js`, `workflow-access.js`, and
   `task-store.js`) publish the data and permission APIs used by page code.
4. Shared presentation modules such as `workflow-ui.js`,
   `institution-metrics.js`, `payment-dialog.js`, and `employee-picker.js`
   load before the page controller that consumes them.
5. Valuation pages load `shared.js` before their report-specific controller;
   `task-context.js` and `report-layout.js` then add assignment and navigation
   behavior around the completed form.

These globals and their order are compatibility boundaries. Moving scripts or
renaming their exported objects requires coordinated changes to every page that
loads them.

### Resources

Each report family has its own self-contained resource folder:

- `master_template.docx` controls the generated Word layout.
- `form_schema.json` defines the form fields and their grouping.
- `template_mapping.json` connects form values to template placeholders.

Production code must use these files. Earlier templates and the scripts used to construct them are kept only in `archive/template_development/`.

General-report cover headings are rewritten from the selected assignment/form
institution at generation time. Static bank names in the reference template
are never treated as application defaults.

### Outputs

Generated files are data, not source code. They are isolated in `outputs/` and excluded from the Docker build context.

### Authentication request flow

```text
ValuX login
    ↓ User ID/email + password
Temporary activation or MFA-scoped server session
    ↓ Password setup / TOTP / verified recovery email
Full server-side session in PostgreSQL
    ↓ Authenticated role context
Existing SLN workspace and report APIs
```

Browser workflow records stay local during this phase. The authentication
database establishes who the user is and which role view applies; it does not
yet synchronize assignments between browsers.

### Tests

Tests load the production backend and production templates directly. Test-generated documents go to `outputs/test_artifacts/`, keeping the test source directory clean.

## Request flow

```text
Browser form
    ↓ JSON
POST /api/preview or /api/agricultural/preview
    ↓
Fill the selected Word template
    ↓
Insert photographs and route map
    ↓
Save a versioned DOCX
    ↓
Convert that exact DOCX to the displayed preview PDF
    ↓
Reuse the same DOCX/PDF when Generate is clicked
```

## Workflow invariants

- Assigning or transferring a task moves it to **In Progress** and requires a
  work note.
- **Closed** tasks retain their payment values as read-only data.
- The CEO may reopen a closed task for seven calendar days. A
  reopened task requires a newly generated DOCX before it can be completed
  again.
- Every generated DOCX receives a unique download path. Closing snapshots the
  latest successful DOCX as the task's final report; PDF and older DOCX
  versions are not offered from the closed-task view.
- Assignment creation, report completion and request closure use history
  replacement so browser Back does not revisit a submitted state.

## Adding another report type

1. Add a folder under `resources/<report_type>/` containing its template, schema and mapping.
2. Add its page under `frontend/pages/` and controller under `frontend/assets/js/pages/`.
3. Add a backend generator under `backend/app/valuation/reports.py` and its API
   route in `backend/app/web/handler.py`.
4. Add a regression test and sample payload under `tests/`.
5. Add the option to `frontend/pages/index.html` and its routing behavior to `frontend/assets/js/pages/home.js`.
