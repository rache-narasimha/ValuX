# Development and Verification

## Run automated checks

The Python report checks and the task-store check are executable regression
scripts. Run them directly as shown; they are not collected by a test runner.

```sh
python3 valuation_app/tests/test_general_generation.py
python3 valuation_app/tests/test_agricultural_generation.py
node valuation_app/tests/test_task_store.js
for file in valuation_app/frontend/assets/js/*.js; do node --check "$file"; done
```

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

## Generated files

- Application reports: `outputs/generated_reports/`
- Automated-test documents: `outputs/test_artifacts/`

These directories can be cleared without affecting source code or templates.

## Editing guidance

- Change form labels and field definitions in the relevant `resources/*/form_schema.json`.
- Change Word placement and formatting in the relevant `resources/*/master_template.docx`.
- Change calculations or generation rules in `backend/app/calculations.py` or
  report orchestration in `backend/app/reports.py`.
- Change browser behavior in the matching file under `frontend/assets/js/`.
- Change shared visual styling in `frontend/assets/css/styles.css`.
- Do not make production changes inside `archive/`; it is historical evidence only.
