#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

cleanup() {
  identifiers=$(docker compose exec -T app python -m tests.test_development_persistence identify 2>/dev/null || true)
  test -n "$identifiers" || return 0
  set -- $identifiers
  task_code=$1
  user_id=$2
  storage_key=$3
  docker compose exec -T app python -m tests.test_development_persistence cleanup-files >/dev/null 2>&1 || true
  docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql \
    -v ON_ERROR_STOP=1 -v task_code="$task_code" -v user_id="$user_id" -v storage_key="$storage_key" >/dev/null <<'SQL'
BEGIN;
UPDATE app.tasks SET latest_artifact_id = NULL, final_artifact_id = NULL WHERE task_code = :'task_code';
DELETE FROM app.report_draft_files WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.report_drafts WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.task_payments WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.task_artifacts WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.report_revisions WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.task_activities WHERE task_id = (SELECT id FROM app.tasks WHERE task_code = :'task_code');
DELETE FROM app.tasks WHERE task_code = :'task_code';
DELETE FROM app.stored_files WHERE storage_key = :'storage_key';
DELETE FROM auth.users WHERE id = :'user_id'::uuid;
COMMIT;
SQL
  docker compose exec -T app python -m tests.test_development_persistence finish-cleanup >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker compose exec -T app python -m tests.test_development_persistence create
docker compose restart postgres app >/dev/null
docker compose exec -T postgres sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do sleep 1; done'
docker compose exec -T app python -m tests.test_development_persistence verify
cleanup
trap - EXIT INT TERM
