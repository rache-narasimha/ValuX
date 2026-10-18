# Development and Verification

## Run automated checks

The Python report checks and the task-store check are executable regression
scripts. Run them directly as shown; they are not collected by a test runner.

```sh
docker compose -f valuation_app/compose.yaml exec -T valuation-report python -m tests.test_auth_security
docker compose -f valuation_app/compose.yaml exec -T valuation-report python -m tests.test_database_boundaries
docker compose -f valuation_app/compose.yaml exec -T valuation-report python -m tests.test_auth_flow
docker compose -f valuation_app/compose.yaml exec -T valuation-report python -m tests.test_general_generation
docker compose -f valuation_app/compose.yaml exec -T valuation-report python -m tests.test_agricultural_generation
node valuation_app/tests/test_task_store.js
find valuation_app/frontend/assets/js -type f -name '*.js' -print0 \
  | xargs -0 -n1 node --check
```

The authentication flow test is intentionally run inside Docker because it
uses the internal PostgreSQL and Mailpit services. It creates unique accounts
and removes them when complete.

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

## Authentication development setup

```sh
python3 valuation_app/scripts/bootstrap_dev_env.py
docker compose -f valuation_app/compose.yaml up --build -d
docker compose -f valuation_app/compose.yaml exec -T valuation-report \
  python -m backend.app.auth.cli seed-dev
```

`.env` and `development-credentials.txt` are ignored and owner-readable only.
Do not copy their contents into source, issue reports or command output.
The one-shot `db-migrate` Compose service applies authentication migrations
before the web service starts. It uses the owner connection only for DDL and
grants. The long-running web service uses the restricted `valsphere_app` role.

To run migrations explicitly:

```sh
docker compose -f valuation_app/compose.yaml run --rm db-migrate
```

See `docs/AUTHENTICATION.md` for activation, Gmail and operator recovery.

## Generated files

- Application reports: `outputs/generated_reports/`
- Automated-test documents: `outputs/test_artifacts/`

These directories can be cleared without affecting source code or templates.

## Editing guidance

- Change form labels and field definitions in the relevant `resources/*/form_schema.json`.
- Change Word placement and formatting in the relevant `resources/*/master_template.docx`.
- Change calculations or generation rules in `backend/app/valuation/calculations.py` or
  report orchestration in `backend/app/valuation/reports.py`.
- Change shared browser state or utilities under `frontend/assets/js/core/`.
- Change reusable UI behavior under `frontend/assets/js/components/`.
- Change page-specific behavior under `frontend/assets/js/pages/`.
- Change styling inside the responsibility folder imported by the stable
  `frontend/assets/css/*.css` entry point.
- Do not make production changes inside `archive/`; it is historical evidence only.
