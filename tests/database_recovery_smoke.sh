#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

docker compose exec -T postgres sh -ceu '
  restore_db="valux_phase4_recovery_$$"
  backup_file="/tmp/${restore_db}.dump"
  cleanup() { dropdb -U "$POSTGRES_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true; rm -f "$backup_file"; }
  trap cleanup EXIT INT TERM
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$backup_file"
  createdb -U "$POSTGRES_USER" "$restore_db"
  pg_restore -U "$POSTGRES_USER" -d "$restore_db" --no-owner --no-privileges "$backup_file"
  auth_count=$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc "SELECT COUNT(*) FROM auth.schema_migrations")
  app_count=$(psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc "SELECT COUNT(*) FROM app.schema_migrations")
  test "$auth_count" -gt 0
  test "$app_count" -gt 0
  psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc "SELECT 1 FROM auth.users LIMIT 1" >/dev/null
  psql -U "$POSTGRES_USER" -d "$restore_db" -Atqc "SELECT 1 FROM app.tasks LIMIT 1" >/dev/null
  echo "PASS: PostgreSQL backup restored into an isolated database with auth and app schemas"
'
