"""Versioned authentication migrations and least-privilege role grants."""

from psycopg import sql

from .config import (
    APP_DATABASE_PASSWORD,
    APP_DATABASE_USER,
    MIGRATION_DATABASE_URL,
    MIGRATIONS_DIR,
    validate_migration_settings,
)
from .database import connection, wait_for_database


MIGRATION_TABLE = "auth.schema_migrations"


def _prepare_migration_ledger(database) -> None:
    """Move the legacy public ledger or create the namespaced ledger."""
    database.execute("CREATE SCHEMA IF NOT EXISTS auth")
    legacy_exists = database.execute(
        "SELECT to_regclass('public.auth_schema_migrations') IS NOT NULL AS present"
    ).fetchone()["present"]
    ledger_exists = database.execute(
        "SELECT to_regclass('auth.schema_migrations') IS NOT NULL AS present"
    ).fetchone()["present"]

    if legacy_exists and not ledger_exists:
        database.execute(
            "ALTER TABLE public.auth_schema_migrations SET SCHEMA auth"
        )
        database.execute(
            "ALTER TABLE auth.auth_schema_migrations RENAME TO schema_migrations"
        )
        database.execute(
            "ALTER TABLE auth.schema_migrations "
            "RENAME CONSTRAINT auth_schema_migrations_pkey TO schema_migrations_pkey"
        )
    elif not ledger_exists:
        database.execute(
            """
            CREATE TABLE auth.schema_migrations (
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
    """Create/update the web role and grant only required runtime privileges."""
    role = sql.Identifier(APP_DATABASE_USER)
    password = sql.Literal(APP_DATABASE_PASSWORD)
    role_exists = database.execute(
        "SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_DATABASE_USER,)
    ).fetchone()

    if role_exists:
        database.execute(
            sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(role, password)
        )
    else:
        database.execute(
            sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD {}").format(role, password)
        )

    database_name = database.execute(
        "SELECT current_database() AS name"
    ).fetchone()["name"]
    database.execute(
        sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(
            sql.Identifier(database_name)
        )
    )
    database.execute(
        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
            sql.Identifier(database_name), role
        )
    )
    database.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
    database.execute("REVOKE ALL ON SCHEMA auth FROM PUBLIC")
    database.execute(sql.SQL("GRANT USAGE ON SCHEMA auth TO {}").format(role))
    database.execute(
        sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM {}").format(role)
    )
    database.execute(
        sql.SQL(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA auth "
            "REVOKE ALL ON TABLES FROM {}"
        ).format(role)
    )
    database.execute(
        sql.SQL(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON "
            "auth.users, auth.sessions, auth.mfa_credentials, "
            "auth.recovery_codes, auth.account_tokens TO {}"
        ).format(role)
    )
    database.execute(
        sql.SQL(
            "GRANT SELECT, INSERT, DELETE ON auth.password_history TO {}"
        ).format(role)
    )
    database.execute(
        sql.SQL("GRANT SELECT, INSERT ON auth.login_attempts TO {}").format(role)
    )
    database.execute(sql.SQL("GRANT INSERT ON auth.audit_events TO {}").format(role))
    database.execute(
        sql.SQL("ALTER ROLE {} SET search_path = auth, pg_catalog").format(role)
    )


def run_migrations() -> None:
    """Apply pending migrations and refresh runtime grants atomically."""
    validate_migration_settings()
    with connection(MIGRATION_DATABASE_URL) as database:
        _prepare_migration_ledger(database)
        _apply_pending_migrations(database)
        _configure_runtime_role(database)


def main() -> int:
    wait_for_database(MIGRATION_DATABASE_URL)
    run_migrations()
    print("ValuX authentication migrations completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
