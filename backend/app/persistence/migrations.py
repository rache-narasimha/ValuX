"""Versioned business-data migrations and least-privilege runtime grants."""

from pathlib import Path

from psycopg import sql

from ..auth.config import (
    APP_DATABASE_USER,
    MIGRATION_DATABASE_URL,
    validate_migration_settings,
)
from ..auth.database import connection


MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
MIGRATION_TABLE = "app.schema_migrations"


def _prepare_migration_ledger(database) -> None:
    database.execute("CREATE SCHEMA IF NOT EXISTS app")
    database.execute(
        """
        CREATE TABLE IF NOT EXISTS app.schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _apply_pending_migrations(database) -> None:
    applied = {
        row["version"]
        for row in database.execute(f"SELECT version FROM {MIGRATION_TABLE}")
    }
    for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if migration.name in applied:
            continue
        database.execute(migration.read_text(encoding="utf-8"))
        database.execute(
            f"INSERT INTO {MIGRATION_TABLE} (version) VALUES (%s)",
            (migration.name,),
        )


def _configure_runtime_role(database) -> None:
    """Grant the web role only the operations needed by business services."""
    role = sql.Identifier(APP_DATABASE_USER)
    role_exists = database.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_DATABASE_USER,)
    ).fetchone()
    if not role_exists:
        raise RuntimeError(
            "The application database role is missing; run authentication migrations first."
        )

    database.execute("REVOKE ALL ON SCHEMA app FROM PUBLIC")
    database.execute(sql.SQL("GRANT USAGE ON SCHEMA app TO {}").format(role))
    database.execute(
        sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA app FROM {}").format(role)
    )
    database.execute(
        sql.SQL(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA app "
            "REVOKE ALL ON TABLES FROM {}"
        ).format(role)
    )

    database.execute(
        sql.SQL(
            "GRANT SELECT, INSERT, UPDATE ON "
            "app.institutions, app.tasks, app.task_payments, "
            "app.stored_files, app.task_artifacts TO {}"
        ).format(role)
    )
    database.execute(
        sql.SQL(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON "
            "app.report_drafts, app.report_draft_files TO {}"
        ).format(role)
    )
    database.execute(
        sql.SQL(
            "GRANT SELECT, INSERT ON "
            "app.task_activities, app.report_revisions, "
            "app.estimation_snapshots, app.estimation_snapshot_items TO {}"
        ).format(role)
    )


def run_migrations() -> None:
    """Apply business migrations and refresh runtime grants atomically."""
    validate_migration_settings()
    with connection(MIGRATION_DATABASE_URL) as database:
        _prepare_migration_ledger(database)
        _apply_pending_migrations(database)
        _configure_runtime_role(database)
