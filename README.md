# SLN Property Report Application

Local web application for managing property-report assignments, preparing
valuation forms, and generating matching DOCX and PDF reports.

## Start the application

From the workspace root:

```sh
docker compose -f valuation_app/compose.yaml up --build -d
```

Open <http://127.0.0.1:4180>.

Stop the application with:

```sh
docker compose -f valuation_app/compose.yaml down
```

## Where to look

| Location                        | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `backend/server.py`             | Small application entry point                                          |
| `backend/app/config.py`         | Paths and immutable application settings                               |
| `backend/app/schemas.py`        | General and agricultural form-schema assembly                          |
| `backend/app/formatting.py`     | Numbers, currency, dates, area conversion and repeatable-field helpers |
| `backend/app/calculations.py`   | Valuation and depreciation business calculations                       |
| `backend/app/ooxml.py`          | Low-level Word XML row and placeholder operations                      |
| `backend/app/media.py`          | Photograph normalization and document image layout                     |
| `backend/app/reports.py`        | High-level DOCX generators for both valuation types                    |
| `backend/app/web.py`            | HTTP routes, previews, static files and downloads                      |
| `frontend/pages/`               | Dashboard, task workflow and report-form HTML                          |
| `frontend/pages/institutions.html` | Father-only bank/NBFC configuration                                 |
| `frontend/assets/js/shared.js`  | Shared controls, parsing, dates, institutions and file-reading helpers  |
| `frontend/assets/js/`           | Report-specific browser controllers and home-page behavior              |
| `frontend/assets/css/`          | Shared application styling                                             |
| `resources/general/`            | General-property Word template, form schema and template mapping       |
| `resources/agricultural/`       | Agricultural Word template, form schema and template mapping           |
| `tests/`                        | Repeatable generation and document-layout checks                       |
| `outputs/generated_reports/`    | Reports produced by the running application                            |
| `outputs/test_artifacts/`       | DOCX files produced by automated tests                                 |
| `archive/template_development/` | Historical template builders, audits, renders and earlier prototypes   |
| `docs/ARCHITECTURE.md`          | Detailed component map and request flow                                |
| `docs/DEVELOPMENT.md`           | Common development and verification commands                           |

The archive is retained for reference but is not copied into the Docker image and is not used at runtime.

## Runtime behavior

- Form text is saved in the current browser's local storage.
- Workflow tasks are temporarily stored behind a browser repository adapter
  until the PostgreSQL phase replaces it with durable application storage.
- Institution configuration and the appearance preference are also kept in
  browser storage during this prototype phase.
- Estimated fee is the billable fallback until an agreed fee exists;
  outstanding is always the current billable fee minus receipts.
- Priority due-date limits use calendar days. Payment due date defaults to
  seven calendar days after completion and becomes overdue only while money
  remains outstanding.
- Uploaded photographs remain in the current browser session and must be selected again after a refresh.
- New-assignment input is auto-saved locally and restored until the draft is
  discarded or the assignment is created.
- Preview creates a DOCX first, renders that exact DOCX to PDF, and reuses the same files for download.
- Generated report downloads use unique filenames beneath
  `outputs/generated_reports/`, allowing a closed task to retain only its
  final DOCX reference.
- Closed payments are read-only. The father/reviewer can reopen a closed task
  within seven calendar days, after which a new DOCX must be generated before
  recompletion.

For a deeper explanation, continue with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
