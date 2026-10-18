# ValSphere / SLN Property Reports

ValSphere provides the authenticated entry point for the SLN workspace used to
manage property-report assignments, prepare valuation forms, and generate
matching DOCX and PDF reports.

## Start the application

Create ignored development configuration once:

```sh
python3 valuation_app/scripts/bootstrap_dev_env.py
```

Then, from the workspace root:

```sh
docker compose -f valuation_app/compose.yaml up --build -d
```

Open <http://127.0.0.1:4180>. The application redirects unauthenticated users
to the ValSphere sign-in page. Mailpit's local regression inbox is available
only on the host at <http://127.0.0.1:8026>.

Provision the two configured development accounts:

```sh
docker compose -f valuation_app/compose.yaml exec -T valuation-report \
  python -m backend.app.auth.cli seed-dev
```

The ignored `valuation_app/development-credentials.txt` file contains the
one-time development credentials generated on this machine. Delete it after
the accounts have been activated.

Stop the application with:

```sh
docker compose -f valuation_app/compose.yaml down
```

## Where to look

| Location                        | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `backend/server.py`             | Small application entry point                                          |
| `backend/app/valuation/config.py`       | Paths and immutable application settings                               |
| `backend/app/valuation/schemas.py`      | General and agricultural form-schema assembly                          |
| `backend/app/valuation/formatting.py`   | Numbers, currency, dates, area conversion and repeatable-field helpers |
| `backend/app/valuation/calculations.py` | Valuation and depreciation business calculations                       |
| `backend/app/valuation/ooxml.py`        | Low-level Word XML row and placeholder operations                      |
| `backend/app/valuation/media.py`        | Photograph normalization and document image layout                     |
| `backend/app/valuation/reports.py`      | High-level DOCX generators for both valuation types                    |
| `backend/app/web/handler.py`            | HTTP routes, previews, static files and downloads                      |
| `backend/app/auth/`             | PostgreSQL authentication, sessions, MFA, email and operator commands  |
| `backend/app/auth/migrations.py` | Transactional migrations and least-privilege runtime grants          |
| `frontend/pages/auth.html`      | ValSphere login and activation shell                                  |
| `frontend/assets/js/pages/auth.js` | Login, MFA, email verification and recovery flow                  |
| `frontend/assets/css/auth.css`  | Responsive ValSphere authentication presentation                       |
| `frontend/pages/`               | Dashboard, task workflow and report-form HTML                          |
| `frontend/pages/institutions.html` | Father-only bank/NBFC configuration                                 |
| `frontend/assets/js/core/`      | Shared state, shell, access policy and form utilities                 |
| `frontend/assets/js/components/` | Reusable UI, workflow, payment and metrics components               |
| `frontend/assets/js/pages/`     | Page-specific browser controllers                                     |
| `frontend/assets/css/`          | Stable CSS entry points and responsibility-based subfolders           |
| `frontend/README.md`            | Frontend ownership, script-order and CSS-entry-point guide             |
| `resources/general/`            | General-property Word template, form schema and template mapping       |
| `resources/agricultural/`       | Agricultural Word template, form schema and template mapping           |
| `tests/`                        | Repeatable generation and document-layout checks                       |
| `outputs/generated_reports/`    | Reports produced by the running application                            |
| `outputs/test_artifacts/`       | DOCX files produced by automated tests                                 |
| `archive/template_development/` | Historical template builders, audits, renders and earlier prototypes   |
| `docs/ARCHITECTURE.md`          | Detailed component map and request flow                                |
| `docs/DEVELOPMENT.md`           | Common development and verification commands                           |
| `docs/AUTHENTICATION.md`        | Account lifecycle, operator commands, email and LAN testing             |

The archive is retained for reference but is not copied into the Docker image and is not used at runtime.

## Runtime behavior

- User accounts, sessions, MFA credentials, recovery codes and authentication
  audit events are durable in PostgreSQL's dedicated `auth` schema. PostgreSQL
  is exposed only on this Mac's loopback interface for pgAdmin access.
- A one-shot migration service connects as the database owner. The web service
  connects as `valsphere_app`, which has DML access to auth data but no schema,
  migration-ledger, database-creation, or role-management privileges.
- Every account is operator-provisioned. Full activation requires a permanent
  password, authenticator enrollment, saved recovery codes and a verified
  recovery email. TOTP is required at every fresh login.
- Form text is saved in the current browser's local storage.
- Workflow tasks are temporarily stored behind a browser repository adapter
  until a later business-data phase replaces it with durable application
  storage. Authentication being shared does not yet make tasks shared between
  devices.
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
For a practical developer map of responsibilities and safe change locations,
read [docs/CODEBASE_GUIDE.md](docs/CODEBASE_GUIDE.md).
For account setup and recovery, read
[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).
