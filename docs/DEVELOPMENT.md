# Development and Verification

## Run automated checks

The Python report checks and the task-store check are executable regression
scripts. Run them directly as shown; they are not collected by a test runner.

```sh
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_auth_security
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_database_boundaries
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_business_database_foundation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_business_database_constraints
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_workflow_service
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_reference_service
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_report_data_service
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_password_history
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_auth_flow
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_account
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_notifications
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_general_generation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_agricultural_generation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_estimation_generation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_progress_generation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_export_generation
docker compose -f valuation_app/compose.yaml exec -T app python -m tests.test_kvb_template
node valuation_app/tests/test_task_store.js
node valuation_app/tests/test_task_store_remote.js
node valuation_app/tests/test_workflow_access.js
node valuation_app/tests/test_frontend_contracts.js
find valuation_app/frontend/assets/js -type f -name '*.js' -print0 \
  | xargs -0 -n1 node --check
sh valuation_app/tests/development_persistence_smoke.sh
sh valuation_app/tests/database_recovery_smoke.sh
```

The authentication flow test is intentionally run inside Docker because it
uses the internal PostgreSQL and Mailpit services. It creates unique accounts
and removes them when complete.
The signed-in account check also requires Mailpit. If normal development uses
SMTP, temporarily override all mail settings to Mailpit for both the server and
the test process, then restore the original Compose configuration afterward.

The Phase 4 persistence smoke test creates one uniquely identified task, draft
and local artifact, restarts PostgreSQL and the application, verifies their
metadata and bytes, and removes the fixture. The database recovery smoke test
restores a fresh PostgreSQL backup into an isolated temporary database, checks
both migration ledgers and core tables, and then drops only that temporary
database.

When browser execution is available, run `valuation_app/tests/browser_role_smoke.sh`
after shared-shell, dashboard, permission, or role-specific UI changes. It
checks both CEO and employee views at desktop and mobile sizes. The script
creates one uniquely named workflow record and removes that exact record before
it exits.

## Rebuild Docker

```sh
docker compose -f valuation_app/compose.yaml up --build -d
docker compose -f valuation_app/compose.yaml ps
docker compose -f valuation_app/compose.yaml logs --tail=100
```

The Compose service bind-mounts `backend/`, `frontend/`, and `resources/`
read-only into the running container. Frontend and resource-file changes are
therefore available without rebuilding the image; backend Python changes need
only a container restart. Rebuilding is required when the Dockerfile or Python
dependencies change.

The default Compose project is `valux`. Before changing the project name on an
existing installation, record the current project name, database volume and
generated-report directory. Stop the original application before taking the
final PostgreSQL dump and report-file backup. Restore into the replacement
database with `pg_restore --no-owner --no-privileges --exit-on-error`, and run
`db-migrate` with the replacement owner and application role settings to
recreate the grants. Keep the authentication encryption key and recovery pepper
with the database backup in restricted storage.

Compare the restored database rows and stored-file checksums with the original.
Preserve task-file paths relative to `outputs/generated_reports/task_files/`,
and keep a rollback backup until the new stack serves existing report downloads.

## Authentication development setup

```sh
python3 valuation_app/scripts/bootstrap_dev_env.py
docker compose -f valuation_app/compose.yaml up --build -d
docker compose -f valuation_app/compose.yaml exec -T app \
  python -m backend.app.auth.cli seed-dev
```

`.env` and `development-credentials.txt` are ignored and owner-readable only.
Do not copy their contents into source, issue reports or command output.
The one-shot `db-migrate` Compose service applies authentication migrations
first and durable business-data migrations second before the web service
starts. It uses the owner connection only for DDL and grants. The long-running
web service uses the configured restricted role (`valux_app` by default).

For an existing development installation, keep its configured database and
role names. Before applying Compose changes to the PostgreSQL volume key,
find the physical volume name attached to the running PostgreSQL container
and set `POSTGRES_DATA_VOLUME` to that name and
`POSTGRES_DATA_VOLUME_EXTERNAL=true` in the ignored `.env` file.

To run migrations explicitly:

```sh
docker compose -f valuation_app/compose.yaml run --rm db-migrate
```

See `docs/AUTHENTICATION.md` for activation, Gmail and operator recovery.

## Generated files

Local development defaults to filesystem storage for task-linked reports and
draft media. To use the staging R2 bucket, configure `VALUX_REPORT_STORAGE=object`,
`R2_ENDPOINT_URL` (the HTTPS R2 account endpoint), and `R2_BUCKET`. Supply
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` through Secret Manager. Cloud Run's
filesystem is temporary and is still used by document generation. The database
records which backend owns each retained file. Existing local files are not
copied by changing the storage setting.

- Application reports: `outputs/generated_reports/`
- Task-linked draft media and report artifacts: `outputs/generated_reports/task_files/`
- Automated-test documents: `outputs/test_artifacts/`

Test artifacts can be cleared freely. Task-linked files must not be removed
independently of their PostgreSQL metadata; use the report workflow or a future
reconciliation/maintenance command.

## Cloud staging names

| Component | Name |
| --- | --- |
| Google Cloud project | `valux-staging` |
| Cloud Run service | `valux-staging` |
| Cloud Run service account | `valux-staging-run` |
| Artifact Registry repository and image | `valux/app` in Mumbai (`asia-south1`) |
| Neon project and database | `ValuX-Staging` / `valux` |
| Neon database roles | `valux_owner` for migrations, `valux_app` for requests |
| Cloudflare R2 bucket | `valux-staging` |
| Cloudflare R2 token | `valux-staging-app` |

Neon's branch labeled `production` is the default branch **inside the staging
project**. Staging secrets live under `valux-staging` in Google Secret Manager.
The `valux-neon-migration-url` secret belongs to schema setup.
`valux-neon-runtime-url`, `valux-r2-*`, and `valux-auth-*` supply the runtime
connections and keys. Use the image digest to identify what a revision runs.

## Editing guidance

- Change form labels and field definitions in the relevant `resources/*/form_schema.json`.
- Change Word placement and formatting in the relevant `resources/*/master_template.docx`.
- Change calculations or generation rules in `backend/app/valuation/calculations.py` or
  report orchestration in `backend/app/valuation/reports.py`.
- Change estimation workbook generation in `backend/app/estimation/generator.py` and keep
  `resources/estimation/estimation_manifest.json` synchronized with the approved masters.
- Change linked Progress/Completion DOCX generation in `backend/app/progress/generator.py`
  and verify both Karnataka Bank and non-Karnataka Bank variants.
- Change shared browser state or utilities under `frontend/assets/js/core/`.
- Change reusable UI behavior under `frontend/assets/js/components/`.
- Change page-specific behavior under `frontend/assets/js/pages/`.
- Change styling inside the responsibility folder imported by the stable
  `frontend/assets/css/*.css` entry point.
- Do not make production changes inside `archive/`; it is historical evidence only.
