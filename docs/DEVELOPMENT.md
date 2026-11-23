# Development and Verification

## Run automated checks

For source-mounted development and frontend checks, build the Assignments
controls after installing the locked frontend dependencies:

```sh
npm --prefix frontend/ui ci --ignore-scripts
npm --prefix frontend/ui run build
```

Docker builds run the same steps in a Node build stage. The runtime image serves
the resulting browser bundle from ValuX's existing origin.

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

## Identical app image in local development and staging

Use `compose.image.yaml` with the normal Compose file and set
`VALUX_RUNTIME_IMAGE` to the tested Artifact Registry `image@sha256:digest`.
This keeps the existing `valux` stack and its database, Mailpit and report
volume, while removing app source-code bind mounts. The app and migration
runner use the baked Linux/AMD64 image; the Mac runs it under emulation.
Local and staging configuration/secrets/storage remain independent.

Build the candidate once, test and scan it, then tag/push that exact candidate.
Promote its registry digest rather than rebuilding separately for staging.
Compare the serving Cloud Run revision's image digest with the local
container's manifest digest and verify the baked app source fingerprint using
`scripts/image_source_fingerprint.py`. A matching multi-architecture tag alone
is insufficient proof of a matching executable image.

Changing code while using the immutable-image override requires a rebuilt,
retested app image. To intentionally return to source-mounted development,
use only `compose.yaml`; that mode does not certify image parity with staging.

Offline Practice regression checks:

```sh
node tests/test_practice_isolation.js
docker compose exec -T app python -m tests.test_practice_uploads  # source-mounted development
```

The immutable image intentionally omits test fixtures. Temporarily copy only `tests/` into `/app/tests` in the running app container
and run its test modules; do not copy or mount replacement backend, frontend
or resource directories. Remove that temporary test directory after validation
and recheck the app-source fingerprint. Test-created records and files must be
cleaned.

## Ubuntu runtime candidate and rollback

The Ubuntu 26.04 candidate uses a digest-pinned official base and upstream
Python 3.14.10, built from its SHA-256-verified official source in a separate
Ubuntu build stage. Only `/opt/python` is copied into the runtime; compilers and
OS development packages stay out. The app uses `/opt/valux-venv`. No-GUI Writer/Calc
retain the existing report fonts and server conversion entry points. Pip and
its bootstrap files are removed after dependency installation.
Build it under a separate candidate tag. A successful build is not a release
approval: scan the complete image, run the regression checks, and compare
rendered reports before changing the running app's image reference.

When official package downloads are interrupted, an optional BuildKit context
can supply the same dependencies without network access during installation:

```sh
docker build --platform linux/amd64 --provenance=false \
  --build-context wheelhouse=/absolute/path/to/verified-wheels \
  --build-arg VALUX_SOURCE_FINGERPRINT="$(python3 scripts/image_source_fingerprint.py)" \
  --tag valux-app:ubuntu2604-candidate .
```

That directory must contain the official wheels and `requirements.lock`, with
every dependency pinned and its published SHA-256 hash. Pip validates the hashes,
then checks the app's `requirements.txt` against the installed packages with no
package source available; incompatible or missing packages fail the build.
Wheels are mounted for that build step only
and are not copied into the final image. With no context supplied, the empty
`wheelhouse` stage selects the usual online installation path. Keep downloaded
wheels outside Git and do not substitute unverified package mirrors.
The same optional context can contain `Python-3.14.10.tar.xz`; the Dockerfile
always verifies its pinned Python.org checksum before unpacking it. Without
that cached archive, the build downloads it from Python.org with TLS verification.

Workbook upload regression checks:

```sh
docker compose exec -T app python -m tests.test_workbook_uploads
docker compose exec -T app python -m tests.test_workbook_uploads_http
```

They exercise ordinary and photo-heavy XLSX files near 25 MB, zero/manual
component totals, immutable attachment bytes, XML declaration rejection,
processing budgets, timeout recovery and existing estimation/KVB HTTP routes.
They also verify uploader-only Practice downloads, HEAD availability and bank
attachment removal, expired legacy links and unchanged live business-data counts.
As with other immutable-image checks, copy only the test fixtures temporarily
and remove them after validation. Generated-workbook verification remains
separate from uploaded-workbook inspection.

Before switching images, retain the running app's immutable image reference,
add a local rollback tag, and save the current Dockerfile, requirements and
Compose settings. Keep any environment-file backup owner-readable and outside
Git. Do not prune the rollback image while validating the replacement.
For recovery after Docker cache removal, export the rollback tag with
`docker image save` into restricted local backup storage and record its file
checksum. Load that saved archive with `docker image load --input <archive>`
before selecting its recorded tag or digest.

For an app-image-only rollback, set `VALUX_RUNTIME_IMAGE` to that recorded
reference and recreate only `app`, with the same local configuration:

```sh
VALUX_RUNTIME_IMAGE='<recorded-image-reference>' \
  docker compose -f compose.yaml -f compose.image.yaml up -d --no-deps --no-build app
docker compose exec -T app python -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:4173/api/health').read().decode())"
```

After recovery, persist the restored image reference in the ignored local
environment file so later Compose commands cannot select the rejected image.
An app-only runtime change must not run schema migrations or replace database
and report-storage volumes. Image rollback does not undo application data
written while an image was running; those records remain in the shared database.
Keep the previous Cloud Run revision and its digest when promoting staging;
route traffic back to that recorded revision if the replacement fails checks.
Staging and local configuration remain separate.

### Browser security verification

Run `tests/test_browser_security.py`, `tests/test_browser_security_http.py`
and `node tests/test_auth_redirects.js` when changing response policy or sign-in.
The HTTP test uses the existing local app and revokes its temporary session.
Run the normal authentication/Mailpit and role smoke checks as well.

`tests/browser_security_smoke.mjs` accepts `VALUX_SECURITY_BASE_URL`, a private
`VALUX_SECURITY_OUTPUT` directory, and optional temporary operator-created
`VALUX_SECURITY_SESSION` / `VALUX_SECURITY_SECOND_SESSION` environment values.
It checks desktop/mobile sign-in, same-origin redirects, CSP enforcement,
authenticated pages, Practice file isolation, PDF preview/download and logout.
It removes its synthetic Practice attachment. Revoke test sessions afterward;
never print or commit them. Operator-assisted sessions do not test password/TOTP
sign-in, which remains covered by the normal local authentication flow tests.

Verify the public URL separately in a normal browser and check the correct
Search Console property. Automated browser checks and vulnerability scanners
cannot guarantee Google's Safe Browsing or hosting-abuse decisions. A cleared
Search Console report does not clear a separate Cloud hosting suspension.
Use the published application URL for `APP_BASE_URL` so recovery links resolve;
retain any existing hosting appeal rather than submitting duplicate appeals.

### WhatsApp rollout

The default mode is disabled. Apply the additive business migration before
enabling the feature. For local checks only, use `WHATSAPP_MODE=mock`,
a loopback `APP_BASE_URL` such as `http://127.0.0.1:4180`, and Mailpit.
The mock code is delivered only to the local Mailpit address
`whatsapp-verification@valux.test`. `WHATSAPP_REQUIRE_VERIFICATION=true` gates
workspace access until a number is verified. Leave the requirement off during
the live provider pilot.

Live mode requires `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_SENDER_ID`,
`WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_OTP_TEMPLATE` and
`WHATSAPP_ASSIGNMENT_TEMPLATE`. Supply `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` through Secret Manager.
Use the approved Copy Code authentication template. The assignment template's
body variables, in order, are report type, institution and branch, assigned
date, due date and masked applicant. The URL button appends its variable
to `<APP_BASE_URL>/alerts/assignment/`. Test both templates with the actual
sender before requiring the verification step for either role.

Register `/api/integrations/whatsapp/webhook` for signed message events and
status updates. Keep the setup verification token out of request log exports,
including the Cloud Run request URL. For manual opt-outs received through an
operator, use `python -m backend.app.whatsapp.worker --opt-out-user USER_ID`
under the app's operator context.

Run `python -m backend.app.whatsapp.worker` as a separate Cloud Run service
from the same image. Require authentication at Cloud Run and grant
`roles/run.invoker` only to its Scheduler service account. The Scheduler uses
OIDC and calls `POST /dispatch`. Use a separate worker database login with
schema usage, the required reads of tasks and assignment contacts, the
`auth.users` ID and status columns, and read/update access to the WhatsApp
outbox and challenges. Supply the phone encryption key and Meta sender settings
under the worker's service account. Keep the worker private and verify that
unauthenticated requests fail before scheduling it. Run the batch locally
with `python -m backend.app.whatsapp.worker --once`.

Disable mandatory verification using the WhatsApp-capable revision before
rolling back to a revision predating enrollment. This allows any activation
in progress to finish when the user returns. Pause the worker before turning
off the live provider.
