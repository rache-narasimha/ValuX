# Application Architecture

## Directory map

```text
valuation_app/
├── backend/
│   ├── __init__.py
│   ├── server.py              # Minimal executable entry point
│   └── app/
│       ├── config.py          # Paths and settings
│       ├── schemas.py         # Form schema assembly
│       ├── formatting.py      # Shared parsing and formatting
│       ├── calculations.py    # Valuation business rules
│       ├── ooxml.py           # Word XML manipulation
│       ├── media.py           # Photograph and map layout
│       ├── reports.py         # Report-generation orchestration
│       └── web.py             # HTTP request handling
├── frontend/
│   ├── pages/
│   │   ├── index.html
│   │   ├── tasks.html
│   │   ├── new-task.html
│   │   ├── task.html
│   │   ├── institutions.html
│   │   ├── general.html
│   │   └── agricultural.html
│   └── assets/
│       ├── css/styles.css
│       ├── css/workflow.css
│       └── js/
│           ├── task-store.js
│           ├── workflow-access.js
│           ├── workflow-ui.js
│           ├── institution-metrics.js
│           ├── payment-dialog.js
│           ├── home.js
│           ├── new-task.js
│           ├── task-list.js
│           ├── task-detail.js
│           ├── task-context.js
│           ├── employee-picker.js
│           ├── appearance.js
│           ├── report-layout.js
│           ├── institution-settings.js
│           ├── shared.js
│           ├── general.js
│           ├── agricultural.js
│           └── institutions.js
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
│   └── test_agricultural_generation.py
├── outputs/
│   ├── generated_reports/
│   └── test_artifacts/
├── archive/template_development/
├── docs/
├── Dockerfile
├── compose.yaml
└── requirements.txt
```

## Component responsibilities

### Backend

`backend/server.py` is a minimal application entry point. The modules under
`backend/app/` separate configuration, schemas, calculations, formatting,
WordprocessingML manipulation, media layout, report orchestration and HTTP
routing.

The backend does not contain editable form markup. It reads form definitions and Word templates from `resources/`.

### Frontend

- `pages/index.html` and `assets/js/home.js` provide the work dashboard.
- `pages/new-task.html`, `tasks.html`, and `task.html` implement assignment
  creation, the searchable work queue, and the task workspace.
- `assets/js/task-store.js` is the temporary task repository boundary. It uses
  browser storage during workflow discovery and is designed to be replaced by
  the future PostgreSQL API without changing the page controllers. It also
  owns workflow transitions, payment locking, the seven-day reopen rule and
  final-DOCX metadata; page controllers do not recreate those rules.
- `assets/js/institutions.js` is a separate temporary repository boundary for
  bank/NBFC configuration, active state and chart colours. Deactivation keeps
  historical task labels intact.
- `assets/js/workflow-access.js` centralizes the temporary father/employee
  identity adapter and all task permissions so role rules are not hard-coded
  into individual pages.
- `assets/js/workflow-ui.js` renders shared work-task rows and display values.
- `assets/js/institution-metrics.js` owns configured-institution, period,
  workload, report-mix and financial aggregations used by dashboards and task
  lists. Institutions with no matching records remain present with zero values.
- `assets/js/payment-dialog.js` provides the reusable completed-report payment
  and close-request popup used wherever a completed task row appears.
- `assets/js/task-context.js` adds task status, action-note validation and
  return links around either valuation form when it is opened from a task.
- `assets/js/employee-picker.js` provides the shared employee-ID/name reference
  control used for initial assignment and the assignee-chip transfer dialog.
- `assets/js/appearance.js` owns the persisted light/dark preference used by
  all workflow and report-form pages. Generated reports remain white.
- `assets/js/report-layout.js` owns the persisted collapse state of the long
  report-form navigation.
- `pages/institutions.html` and `assets/js/institution-settings.js` provide the
  father-only institution configuration surface.
- `assets/js/shared.js` contains reusable controls, parsing, date, institution
  and file-reading helpers used by every valuation form.
- `pages/general.html` and `assets/js/general.js` implement residential, commercial and industrial valuation forms.
- `pages/agricultural.html` and `assets/js/agricultural.js` implement agricultural valuation forms.
- `assets/css/styles.css` is shared by every page.
- `assets/css/workflow.css` contains responsive dashboard and task-management
  layout rules.

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
- The father/reviewer may reopen a closed task for seven calendar days. A
  reopened task requires a newly generated DOCX before it can be completed
  again.
- Every generated DOCX receives a unique download path. Closing snapshots the
  latest successful DOCX as the task's final report; PDF and older DOCX
  versions are not offered from the closed-task view.
- Assignment creation, report completion and request closure use history
  replacement so browser Back does not revisit a submitted state.

## Adding another report type

1. Add a folder under `resources/<report_type>/` containing its template, schema and mapping.
2. Add its page under `frontend/pages/` and controller under `frontend/assets/js/`.
3. Add a backend generator under `backend/app/reports.py` and its API route in
   `backend/app/web.py`.
4. Add a regression test and sample payload under `tests/`.
5. Add the option to `frontend/pages/index.html` and its routing behavior to `frontend/assets/js/home.js`.
